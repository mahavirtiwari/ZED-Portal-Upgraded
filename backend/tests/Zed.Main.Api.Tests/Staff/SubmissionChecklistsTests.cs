using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Assessment;
using Zed.Portal.Features.Staff.Quality;
using Zed.Portal.Features.Staff.Settings;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>2026-11-17 (approved): Admin → Submission checklists and Admin → Observation reasons.</summary>
public sealed class SubmissionChecklistsTests : IDisposable
{
    private const string Url = "/api/staff/settings/submission-checklists";
    private const string ReasonsUrl = "/api/staff/settings/observation-reasons";
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    private readonly TestHost _host = new();

    public SubmissionChecklistsTests() => UsersMastersLogin.Setup(_host);

    public void Dispose() => _host.Dispose();

    private List<(string Name, object? Args)> SettingWrites() =>
        _host.Sql.Calls.Where(c => c.Name.StartsWith("MERGE dbo.V4Settings") || c.Name.StartsWith("DELETE FROM dbo.V4Settings")).ToList();

    private static string Value(object? args) => (string)args!.GetType().GetProperty("SettingValue")!.GetValue(args)!;

    private static object Item(string id, string text, string[] stages, bool active = true) => new { id, text, stages, active };

    // ------------------------------------------------------------------ rules

    [Fact]
    public void Items_are_asked_by_stage_and_every_one_asked_must_be_ticked()
    {
        var all = SubmissionChecklists.AgencyQcKind.Defaults;
        Assert.Equal(["exemptions", "quality", "evidence", "nc-remarks"], SubmissionChecklists.Asked(all, SubmissionChecklists.Desktop).Select(i => i.Id));
        Assert.Equal(["quality", "evidence", "photos", "nc-remarks"], SubmissionChecklists.Asked(all, SubmissionChecklists.Site).Select(i => i.Id));
        var off = all.Select(i => i.Id == "photos" ? i with { Active = false } : i).ToList();
        Assert.DoesNotContain(SubmissionChecklists.Asked(off, SubmissionChecklists.Site), i => i.Id == "photos");

        var site = SubmissionChecklists.Asked(all, SubmissionChecklists.Site);
        Assert.Null(SubmissionChecklists.Unticked(site, ["QUALITY", "evidence", "photos", "nc-remarks", "extra"]));
        Assert.Equal("Please tick the checklist item before you submit.", SubmissionChecklists.Unticked(site, ["quality", "evidence", "photos"]));
        Assert.Equal("Please tick all 4 checklist items before you submit (4 not ticked).", SubmissionChecklists.Unticked(site, null));
        Assert.Null(SubmissionChecklists.Unticked([], null));
        // The handholding lists have no stages: every item in use is asked.
        Assert.Equal(4, SubmissionChecklists.Asked(SubmissionChecklists.CoQcKind.Defaults, null).Count);
    }

    [Fact]
    public void The_record_keeps_the_wording_as_ticked()
    {
        var asked = SubmissionChecklists.Asked(SubmissionChecklists.ConsultantSubmitKind.Defaults, null);
        var text = SubmissionChecklists.RecordText(asked);
        Assert.StartsWith("1. Every checkpoint is answered with my remarks.\n2. ", text);
        var record = new SubmissionChecklists.Record { Text = text, Checklist = SubmissionChecklists.ConsultantSubmit };
        Assert.Equal(asked.Select(i => i.Text), record.Items);
        Assert.Equal("Consultant final submit", record.Title);
        // The longest list fits AssessorComments.AssessorRemarks (varchar(5000)).
        Assert.True(SubmissionChecklists.MaxItems * (SubmissionChecklists.MaxText + 5) < 5000);
    }

    // ------------------------------------------------------------------ Admin → Submission checklists

    [Fact]
    public async Task Only_the_admin_sees_and_saves_the_checklists()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await (await _host.CreateBrowserAsync()).GetAsync(Url)).StatusCode);
        foreach (var user in new[] { "MASTER1", "SUPER1" })
        {
            var other = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync(Url)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.PutAsJsonAsync(Url + "/agency-qc", new { items = Array.Empty<object>() })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync(ReasonsUrl)).StatusCode);
        }
        Assert.Empty(SettingWrites());
    }

    [Fact]
    public async Task The_main_portal_has_the_agency_and_assessor_lists_with_their_standard_items()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = (await admin.GetFromJsonAsync<SubmissionChecklistsController.ChecklistsResponse>(Url, Web))!;
        Assert.Equal(["agency-qc", "assessor-submit"], r.Checklists.Select(c => c.Code));
        Assert.All(r.Checklists, c => Assert.False(c.Customised));
        Assert.Equal(["Desktop", "Site"], r.Checklists[0].Stages);
        Assert.Equal(["Desktop", "Remote", "Onsite"], r.Checklists[1].Stages);
        Assert.Equal(SubmissionChecklists.AgencyQcKind.Defaults.Count, r.Checklists[0].Items.Count);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync(Url + "/co-qc", new { items = Array.Empty<object>() })).StatusCode);
    }

    [Fact]
    public async Task Saves_a_list_and_refuses_invalid_items()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        async Task<string?> Refused(params object[] items) => await (await admin.PutAsJsonAsync(Url + "/agency-qc", new { items })).ProblemTitle();

        Assert.Equal("Every item needs its text.", await Refused(Item("a", " ", ["Desktop"])));
        Assert.Equal("\"Checked\": choose where it is asked.", await Refused(Item("a", "Checked", [])));
        Assert.Equal("\"Checked\": invalid stage.", await Refused(Item("a", "Checked", ["Onsite"])));
        Assert.Equal("\"checked\" is listed twice.", await Refused(Item("a", "Checked", ["Site"]), Item("b", "checked", ["Site"])));
        Assert.Equal($"An item can have at most {SubmissionChecklists.MaxText} characters.", await Refused(Item("a", new string('x', 251), ["Site"])));
        Assert.Empty(SettingWrites());

        (await admin.PutAsJsonAsync(Url + "/agency-qc", new { items = new[] { Item("a", "All photos seen", ["Site"]), Item("b", "Old", ["Desktop"], false) } }))
            .EnsureSuccessStatusCode();
        var write = Assert.Single(SettingWrites());
        Assert.Equal("Checklist.AgencyQc", FakeSql.Arg(write.Args, "SettingKey"));
        var saved = JsonSerializer.Deserialize<List<ChecklistItem>>(Value(write.Args), Web)!;
        Assert.Equal(["All photos seen", "Old"], saved.Select(i => i.Text));
        Assert.False(saved[1].Active);

        (await admin.DeleteAsync(Url + "/agency-qc")).EnsureSuccessStatusCode();
        Assert.StartsWith("DELETE FROM dbo.V4Settings", SettingWrites()[^1].Name);
    }

    [Fact]
    public async Task The_pop_up_gets_the_items_of_its_stage()
    {
        var agency = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var r = (await agency.GetFromJsonAsync<SubmissionChecklistController.AskedResponse>("/api/staff/submission-checklists/items/agency-qc?stage=Desktop", Web))!;
        Assert.Equal("Agency quality check", r.Title);
        Assert.Equal(["exemptions", "quality", "evidence", "nc-remarks"], r.Items.Select(i => i.Id));
        Assert.Equal(HttpStatusCode.BadRequest, (await agency.GetAsync("/api/staff/submission-checklists/items/agency-qc?stage=Milestone")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await agency.GetAsync("/api/staff/submission-checklists/items/co-qc")).StatusCode);
    }

    // ------------------------------------------------------------------ Admin → Observation reasons

    [Fact]
    public async Task Observation_reasons_start_from_the_standard_list_and_are_saved_with_their_severity()
    {
        _host.Sql.Queries[ObservationReasonsController.UsedSql] = _ => [new { Category = "Conduct", Count = 3 }];
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = (await admin.GetFromJsonAsync<ObservationReasonsController.ReasonsResponse>(ReasonsUrl, Web))!;
        Assert.False(r.Customised);
        Assert.False(r.Handholding);
        Assert.Equal(["Minor", "Major", "Critical"], r.Severities);
        Assert.Equal(ObservationReasons.Defaults.Select(d => d.Text), r.Reasons.Select(x => x.Text));
        Assert.Equal(3, r.Used["Conduct"]);

        async Task<string?> Refused(params object[] reasons) => await (await admin.PutAsJsonAsync(ReasonsUrl, new { reasons })).ProblemTitle();
        Assert.Equal("Add at least one reason.", await Refused());
        Assert.Equal("\"Late\": choose Minor, Major or Critical.", await Refused(new { id = "late", text = "Late", severity = "Severe", active = true }));
        Assert.Equal("At least one reason must be in use.", await Refused(new { id = "late", text = "Late", severity = "Minor", active = false }));
        Assert.Empty(SettingWrites());

        (await admin.PutAsJsonAsync(ReasonsUrl, new { reasons = new[] { new { id = "late", text = "Late reporting", severity = "major", active = true } } }))
            .EnsureSuccessStatusCode();
        var write = Assert.Single(SettingWrites());
        Assert.Equal(ObservationReasons.Key, FakeSql.Arg(write.Args, "SettingKey"));
        Assert.Equal("Major", JsonSerializer.Deserialize<List<ObservationReason>>(Value(write.Args), Web)!.Single().Severity);
    }

    [Fact]
    public void A_reason_is_found_in_use_by_its_key_or_wording()
    {
        IReadOnlyList<ObservationReason> list = [new("a", "Late", "Minor"), new("b", "Gone", "Major", Active: false)];
        Assert.Equal("a", ObservationReasons.Find(list, "late")?.Id);
        Assert.Equal("a", ObservationReasons.Find(list, "A")?.Id);
        Assert.Null(ObservationReasons.Find(list, "b"));
        Assert.Null(ObservationReasons.Find(list, " "));
    }
}
