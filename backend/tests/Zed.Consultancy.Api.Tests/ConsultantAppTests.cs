using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Assessment;
using Zed.Core.Data;
using Zed.Core.Mobile;
using Zed.Core.Security;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Consultancy.ConsultantApp;
using Zed.Portal.Features.Consultancy.Milestones;
using Zed.Portal.Features.Staff.Settings;
using Zed.TestSupport;

namespace Zed.Consultancy.Api.Tests;

/// <summary>
/// The redesigned consultant app's calls to the consultancy portal (ConsultantAppController: the milestone report PDF and
/// "Forgot password") and the Admin's site tour sections of the Consultancy system.
/// </summary>
public sealed class ConsultantAppTests : IDisposable
{
    private const string Me = "ZEDMSME000001";
    private const string Lead = "ZEDCC0001";
    private const string Co = "ZEDCC1019";
    private const string Other = "ZEDCC0099";
    private static readonly string Key = Convert.ToBase64String(Enumerable.Range(1, 32).Select(i => (byte)i).ToArray());
    private readonly TestHost _host = new();
    private readonly WebApplicationFactory<Program> _app;
    private int _status = 16;

    private static Dictionary<string, object?> Row(params (string K, object? V)[] values) =>
        values.ToDictionary(v => v.K, v => v.V, StringComparer.OrdinalIgnoreCase);

    public ConsultantAppTests()
    {
        var sql = _host.Sql;
        // Milestone 2 is the unit's current one; the lead is on both milestones, the co-consultant on milestone 2 only.
        sql.Queries[MilestoneContext.RecordSql] = args => FakeSql.Arg(args, "ZedId") == Me && FakeSql.Arg(args, "Certification") == "Silver"
            ? [new { Id = 9L, ZedId = Me, Certification = "Silver", CertificationStatus = _status, NcCount = 2, CertificationBodyUserId = "CO1", SiteAssessorId = Lead }]
            : [];
        sql.Queries[ConsultantAppController.MilestoneTeamSql] = args =>
            [(FakeSql.Arg(args, "UserId"), FakeSql.Arg(args, "NcCount")) is (Lead, "1" or "2") or (Co, "2") ? 1 : 0];
        sql.Procs["SP_REPORT_GET_DETAILS"] = args => FakeSql.Arg(args, "ZedId") == Me && FakeSql.Arg(args, "NcCount") == "2" ? Sets() : FakeSql.Sets([]);
        _app = _host.WithTestSignIn().WithWebHostBuilder(b => b.UseSetting("Mobile:AppTokenKey", Key));
    }

    private ResultSets Sets()
    {
        var sets = Enumerable.Range(0, 17).Select(_ => (IEnumerable<object>)new List<object>()).ToArray();
        sets[0] = [Row(("ZedId", Me), ("Certification", "Silver"), ("PUnitName", "ACME UNIT 1"), ("CertificationStatus", _status), ("NcCount", 2),
            ("BdsFromDate", "October 1, 2026"), ("LastestCertification", "Bronze"))];
        sets[3] = [Row(("SectionCode", "1"), ("SectionName", "Leadership"))];
        sets[4] = [Row(("Id", 5), ("SectionCode", "1"), ("RequirementCode", "1"), ("IsProposedActivityCompleted", "Yes"), ("ProgressReviewRemarks", "Done."))];
        return FakeSql.Sets(sets);
    }

    public void Dispose()
    {
        _app.Dispose();
        _host.Dispose();
    }

    private Task<string> Token(string app, string user) => _app.Services.GetRequiredService<AppTokens>().IssueAsync(app, user, null);

    private async Task<HttpResponseMessage> Report(string query, string? token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/SA/AppReport?" + query);
        if (token is not null) request.Headers.Add(AppTokens.Header, token);
        return await _app.CreateClient().SendAsync(request);
    }

    private IEnumerable<object?> ReportCalls => _host.Sql.Calls.Where(c => c.Name == "SP_REPORT_GET_DETAILS").Select(c => c.Args);

    [Fact]
    public async Task The_milestone_report_is_served_to_the_milestones_consultants_with_the_app_token()
    {
        var r = await Report($"zedId={Me}&certificationType=silver&milestone=2", await Token(MobileApps.SiteAssessor, Co));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("application/pdf", r.Content.Headers.ContentType!.MediaType);
        Assert.Equal("Silver_Report_PR1.pdf", r.Content.Headers.ContentDisposition?.FileNameStar);
        Assert.Equal("2", FakeSql.Arg(Assert.Single(ReportCalls), "NcCount"));
        // Without a milestone: the current one.
        Assert.Equal(HttpStatusCode.OK, (await Report($"zedId={Me}&certificationType=Silver", await Token(MobileApps.SiteAssessor, Lead))).StatusCode);

        // An earlier milestone comes from the file stored when it was completed.
        var stored = Path.Combine(_host.StorageRoot, "Consultancy", "PDFs", "SA", Me, "Silver_Report.pdf");
        Directory.CreateDirectory(Path.GetDirectoryName(stored)!);
        await File.WriteAllTextAsync(stored, "%PDF-1.4 milestone 1");
        var first = await Report($"zedId={Me}&certificationType=Silver&milestone=1", await Token(MobileApps.SiteAssessor, Lead));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal("%PDF-1.4 milestone 1", await first.Content.ReadAsStringAsync());
        Assert.Equal(2, ReportCalls.Count());
    }

    [Fact]
    public async Task The_report_is_refused_without_a_genuine_token_to_others_and_before_completion()
    {
        var lead = await Token(MobileApps.SiteAssessor, Lead);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Report($"zedId={Me}&certificationType=Silver&milestone=2", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Report($"zedId={Me}&certificationType=Silver&milestone=2", "h1.forged.token")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Report($"zedId={Me}&certificationType=Silver&milestone=2", await Token(MobileApps.Msme, Lead))).StatusCode);
        // Not on the milestone (the co-consultant was not on milestone 1), Bronze, a fourth milestone, a bad id.
        Assert.Equal(HttpStatusCode.NotFound, (await Report($"zedId={Me}&certificationType=Silver&milestone=2", await Token(MobileApps.SiteAssessor, Other))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Report($"zedId={Me}&certificationType=Silver&milestone=1", await Token(MobileApps.SiteAssessor, Co))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Report($"zedId={Me}&certificationType=Bronze&milestone=1", lead)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Report($"zedId={Me}&certificationType=Silver&milestone=4", lead)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Report($"zedId=../{Me}&certificationType=Silver&milestone=2", lead)).StatusCode);
        // Closing meeting done, with the CO: no report yet; an earlier milestone never stored: none.
        _status = 15;
        Assert.Equal(HttpStatusCode.NotFound, (await Report($"zedId={Me}&certificationType=Silver&milestone=2", lead)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Report($"zedId={Me}&certificationType=Silver&milestone=1", lead)).StatusCode);
        Assert.Empty(ReportCalls);
    }

    // ----- Forgot password

    private FakeStaffResets Resets()
    {
        var resets = new FakeStaffResets().Attach(_host.Sql.Procs);
        resets.Add(Lead, 3, "lead@zed.test");
        resets.Add(Co, 3, "shared@zed.test");
        resets.Add("ZEDCC0003", 3, "shared@zed.test");
        resets.Add("ZEDCO0001", 2, "co@zed.test");
        _host.Sql.Queries[ConsultantAppController.ConsultantsByEmailSql] = args => FakeSql.Arg(args, "Email") switch
        {
            "shared@zed.test" => [Co, "ZEDCC0003"],
            "lead@zed.test" => [Lead],
            _ => [],
        };
        return resets;
    }

    private async Task<JsonElement> Forgot(object body)
    {
        var r = await _app.CreateClient().PostAsJsonAsync("/SA/AppForgotPassword", body);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement.Clone();
    }

    private static async Task Eventually(Func<bool> condition)
    {
        for (var i = 0; i < 100 && !condition(); i++) await Task.Delay(50);
        Assert.True(condition(), "condition not met within 5 seconds");
    }

    [Fact]
    public async Task Forgot_password_by_consultant_id_or_email_sends_the_portals_reset_mail()
    {
        var resets = Resets();
        var e = await Forgot(new { assessorId = Lead });
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal(ConsultantAppController.ForgotPasswordAnswer, e.GetProperty("errorMessage").GetString());
        await Eventually(() => _host.Email.Sent.Any(m => m.To == "lead@zed.test"));
        var mail = _host.Email.Sent.Single(m => m.To == "lead@zed.test");
        Assert.Equal("ZED Password Reset - " + Lead, mail.Subject);
        Assert.Contains("/reset-password#token=", mail.HtmlBody);

        await Forgot(new { email = "shared@zed.test" });
        await Eventually(() => _host.Email.Sent.Count(m => m.To == "shared@zed.test") == 2);
        Assert.Equal(3, resets.Rows.Count);
    }

    [Fact]
    public async Task Forgot_password_answers_the_same_for_anyone_and_mails_consultants_only()
    {
        var resets = Resets();
        var answers = new List<string?>();
        foreach (var body in new object[] { new { assessorId = "ZEDCO0001" }, new { assessorId = "NOBODY" }, new { email = "nobody@zed.test" } })
            answers.Add((await Forgot(body)).GetProperty("errorMessage").GetString());
        Assert.All(answers, a => Assert.Equal(ConsultantAppController.ForgotPasswordAnswer, a));
        // A later request is processed after these (one background queue): once its mail is out, the others were refused.
        await Forgot(new { assessorId = Lead });
        await Eventually(() => _host.Email.Sent.Any(m => m.To == "lead@zed.test"));
        Assert.DoesNotContain(_host.Email.Sent, m => m.To == "co@zed.test");
        Assert.Single(resets.Rows);

        var empty = await Forgot(new { assessorId = " ", email = "" });
        Assert.Equal("0", empty.GetProperty("status").GetString());
        Assert.Equal(ConsultantAppController.ForgotPasswordInput, empty.GetProperty("errorMessage").GetString());
    }

    // ----- Site tour sections of the Consultancy system

    private const string SectionsUrl = "/api/staff/settings/site-tour-sections";

    [Fact]
    public async Task The_admin_keeps_the_consultancy_site_tour_sections_with_handholding_levels_only()
    {
        var admin = await StaffTestSignIn.BrowserAsync(_app, "ADMIN1", (int)UserRole.Admin);
        var r = (await admin.GetFromJsonAsync<SiteTourSectionsController.SectionsResponse>(SectionsUrl))!;
        Assert.Equal(10, r.Sections.Count);
        Assert.Equal(["Silver", "Gold"], r.Levels.Select(l => l.Code));

        var section = new { id = "forge", title = "Forge shop", hint = "Furnaces", min = 2, max = 4, levels = new[] { "Gold" }, nicSectors = new[] { "24" }, active = true };
        (await admin.PutAsJsonAsync(SectionsUrl, new { sections = new[] { section } })).EnsureSuccessStatusCode();
        var write = Assert.Single(_host.Sql.Calls, c => c.Name.StartsWith("MERGE dbo.V4Settings", StringComparison.Ordinal));
        var value = (string)write.Args!.GetType().GetProperty("SettingValue")!.GetValue(write.Args)!;
        Assert.Equal("forge", Assert.Single(JsonSerializer.Deserialize<List<SiteTourSection>>(value, new JsonSerializerOptions(JsonSerializerDefaults.Web))!).Id);

        var consultant = await StaffTestSignIn.BrowserAsync(_app, Lead, 3, "SiteVerification");
        Assert.Equal(HttpStatusCode.Forbidden, (await consultant.GetAsync(SectionsUrl)).StatusCode);
    }
}
