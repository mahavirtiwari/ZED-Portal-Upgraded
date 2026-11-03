using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Zed.Core.Mobile;
using Zed.Portal.Features.AssessorApp;
using Zed.Portal.Features.Documents;
using Zed.Portal.Features.Staff.Assessment;
using Zed.TestSupport;

namespace Zed.Main.Api.Tests;

/// <summary>The redesigned site assessor app's calls to the portal: the report PDF and "Forgot password" (AssessorAppController).</summary>
public sealed class AssessorAppTests : IDisposable
{
    private const string Lead = "ZEDAS0001";
    private const string Co = "ZEDAS0002";
    private const string Other = "ZEDAS0099";
    private static readonly string Key = Convert.ToBase64String(Enumerable.Range(1, 32).Select(i => (byte)i).ToArray());
    private readonly TestHost _host = new();
    private readonly FakeReports _reports = new();
    private readonly WebApplicationFactory<Program> _app;

    public AssessorAppTests()
    {
        _host.Sql.Queries[AssessmentRecords.CertificationSql] = args => (FakeSql.Arg(args, "ZedId"), FakeSql.Arg(args, "Certification")) switch
        {
            ("ZEDMSME000004", "Gold") => [new { ZedId = "ZEDMSME000004", Certification = "Gold", CertificationStatus = 16, SiteAssessorId = Lead, CoAssessorId = Co }],
            ("ZEDMSME000006_D_45", "Silver") => [new { ZedId = "ZEDMSME000006_D_45", Certification = "Silver", CertificationStatus = 99, SiteAssessorId = Other, CoAssessorId = Co }],
            ("ZEDMSME000007", "Gold") => [new { ZedId = "ZEDMSME000007", Certification = "Gold", CertificationStatus = 13, SiteAssessorId = Lead, CoAssessorId = Co }],
            _ => [],
        };
        _app = _host.WithWebHostBuilder(b =>
        {
            b.UseSetting("Mobile:AppTokenKey", Key);
            b.ConfigureTestServices(s => { s.RemoveAll<IAssessmentDocuments>(); s.AddSingleton<IAssessmentDocuments>(_reports); });
        });
    }

    public void Dispose()
    {
        _app.Dispose();
        _host.Dispose();
    }

    private sealed class FakeReports : IAssessmentDocuments
    {
        public List<(string ZedId, string Level)> Drawn { get; } = [];
        public Task<DocumentFile> IssueCertificateAsync(string zedId, string certification, CancellationToken ct) => throw new DocumentNotAvailableException("none");
        public Task<DocumentFile> RenderReportAsync(string zedId, string certification, CancellationToken ct)
        {
            Drawn.Add((zedId, certification));
            return Task.FromResult(new DocumentFile($"PDFs/SA/{zedId}/{certification}_Report.pdf", "%PDF-1.4 report"u8.ToArray()));
        }
    }

    private Task<string> Token(string app, string user) => _app.Services.GetRequiredService<AppTokens>().IssueAsync(app, user, null);

    private async Task<HttpResponseMessage> Report(string zedId, string level, string? token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/SA/AppReport?zedId={Uri.EscapeDataString(zedId)}&certificationType={level}");
        if (token is not null) request.Headers.Add(AppTokens.Header, token);
        return await _app.CreateClient().SendAsync(request);
    }

    [Fact]
    public async Task The_report_is_served_to_the_records_lead_or_co_assessor_with_the_app_token()
    {
        var lead = await Token(MobileApps.SiteAssessor, Lead);
        var r = await Report("ZEDMSME000004", "gold", lead);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("application/pdf", r.Content.Headers.ContentType!.MediaType);
        Assert.Equal("%PDF-1.4 report", await r.Content.ReadAsStringAsync());
        Assert.Equal(("ZEDMSME000004", "Gold"), Assert.Single(_reports.Drawn));

        // A rejected copy, to its co-assessor.
        Assert.Equal(HttpStatusCode.OK, (await Report("ZEDMSME000006_D_45", "Silver", await Token(MobileApps.SiteAssessor, Co))).StatusCode);
    }

    [Fact]
    public async Task The_report_is_refused_without_a_genuine_token_to_others_and_before_certification()
    {
        var lead = await Token(MobileApps.SiteAssessor, Lead);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Report("ZEDMSME000004", "Gold", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Report("ZEDMSME000004", "Gold", "h1.forged.token")).StatusCode);
        // Another app's token (the MSME app) is not the assessor's.
        Assert.Equal(HttpStatusCode.Unauthorized, (await Report("ZEDMSME000004", "Gold", await Token(MobileApps.Msme, Lead))).StatusCode);
        // Not this assessor's record, a record without a report yet (closing meeting only), Bronze, an unknown level, a bad id.
        Assert.Equal(HttpStatusCode.NotFound, (await Report("ZEDMSME000004", "Gold", await Token(MobileApps.SiteAssessor, Other))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Report("ZEDMSME000007", "Gold", lead)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Report("ZEDMSME000004", "Bronze", lead)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Report("ZEDMSME000004", "Platinum", lead)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Report("../ZEDMSME000004", "Gold", lead)).StatusCode);
        Assert.Empty(_reports.Drawn);
    }

    // ----- Forgot password

    private FakeStaffResets Resets()
    {
        var resets = new FakeStaffResets().Attach(_host.Sql.Procs);
        resets.Add(Lead, 3, "lead@zed.test");
        resets.Add(Co, 3, "shared@zed.test");
        resets.Add("ZEDAS0003", 3, "shared@zed.test");
        resets.Add("ZEDAA0001", 2, "agency@zed.test");
        _host.Sql.Queries[AssessorAppController.AssessorsByEmailSql] = args => FakeSql.Arg(args, "Email") switch
        {
            "shared@zed.test" => ["ZEDAS0002", "ZEDAS0003"],
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
    public async Task Forgot_password_by_assessor_id_or_email_sends_the_webs_reset_mail()
    {
        var resets = Resets();
        var e = await Forgot(new { assessorId = Lead });
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal(AssessorAppController.ForgotPasswordAnswer, e.GetProperty("errorMessage").GetString());
        await Eventually(() => _host.Email.Sent.Any(m => m.To == "lead@zed.test"));
        var mail = _host.Email.Sent.Single(m => m.To == "lead@zed.test");
        Assert.Equal("ZED Password Reset - " + Lead, mail.Subject);
        Assert.Contains("/reset-password#token=", mail.HtmlBody);

        // By e-mail: each active assessor with that address.
        await Forgot(new { email = "shared@zed.test" });
        await Eventually(() => _host.Email.Sent.Count(m => m.To == "shared@zed.test") == 2);
        Assert.Equal(["ZED Password Reset - ZEDAS0002", "ZED Password Reset - ZEDAS0003"],
            _host.Email.Sent.Where(m => m.To == "shared@zed.test").Select(m => m.Subject).Order());
        Assert.Equal(3, resets.Rows.Count);
    }

    [Fact]
    public async Task Forgot_password_answers_the_same_for_anyone_and_mails_assessors_only()
    {
        var resets = Resets();
        var answers = new List<string?>();
        foreach (var body in new object[] { new { assessorId = "ZEDAA0001" }, new { assessorId = "NOBODY" }, new { email = "nobody@zed.test" } })
            answers.Add((await Forgot(body)).GetProperty("errorMessage").GetString());
        Assert.All(answers, a => Assert.Equal(AssessorAppController.ForgotPasswordAnswer, a));
        // A later request is processed after these (one background queue): once its mail is out, the others were refused.
        await Forgot(new { assessorId = Lead });
        await Eventually(() => _host.Email.Sent.Any(m => m.To == "lead@zed.test"));
        Assert.DoesNotContain(_host.Email.Sent, m => m.To == "agency@zed.test");
        Assert.Single(resets.Rows);

        var empty = await Forgot(new { assessorId = " ", email = "" });
        Assert.Equal("0", empty.GetProperty("status").GetString());
        Assert.Equal(AssessorAppController.ForgotPasswordInput, empty.GetProperty("errorMessage").GetString());
    }
}
