using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Forms;
using Zed.Portal.Features.Staff.Settings;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Admin → Questionnaire → ESG Checklist: the ESG and Social / OHS questions the apps ask.</summary>
public sealed class EsgChecklistTests : IDisposable
{
    private const string Url = "/api/staff/settings/esg-checklist";
    private readonly TestHost _host = new();

    public EsgChecklistTests() => UsersMastersLogin.Setup(_host);

    public void Dispose() => _host.Dispose();

    private void Stored(EsgChecklistDefinition d, int revision = 3) =>
        _host.Sql.Queries["SELECT Revision, ChecklistJson, UpdatedBy, UpdatedOn FROM dbo.V4EsgChecklist"] = _ =>
            [new EsgChecklistRow(revision, EsgChecklistFormat.ToStore(d), "ADMIN1", new DateTime(2026, 10, 27, 10, 0, 0))];

    private List<(string Name, object? Args)> Writes() =>
        _host.Sql.Calls.Where(c => c.Name.StartsWith("MERGE dbo.V4EsgChecklist") || c.Name.StartsWith("DELETE FROM dbo.V4EsgChecklist")).ToList();

    private static EsgChecklistDefinition Saved((string Name, object? Args) merge) =>
        EsgChecklistFormat.FromStore(FakeSql.Arg(merge.Args, "Json")!)!;

    private static EsgChecklistDefinition WithQuestion(EsgChecklistDefinition d, int section, EsgQuestion q) =>
        new(d.Sections.Select((s, i) => i == section ? s with { Questions = [.. s.Questions, q] } : s).ToList());

    [Fact]
    public async Task Only_the_Admin_sees_and_changes_the_checklist()
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(Url)).StatusCode);
        foreach (var user in new[] { "MASTER1", "AGENCY1", "SUPER1" })
        {
            var other = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync(Url)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.PutAsJsonAsync(Url, EsgChecklistFormat.Standard)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.DeleteAsync(Url)).StatusCode);
        }
        Assert.Empty(Writes());
    }

    [Fact]
    public async Task Without_a_saved_checklist_the_standard_one_is_shown()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = (await admin.GetFromJsonAsync<EsgChecklistController.EsgChecklistResponse>(Url))!;
        Assert.False(r.Customised);
        Assert.Equal("1.7", r.Version);
        Assert.Equal(["ESG check list", "Social / OHS check list"], r.Checklist.Sections.Select(s => s.Title));
        Assert.Equal([8, 6], r.Checklist.Sections.Select(s => s.Questions.Count));
        var coe = r.Checklist.Sections[0].Questions[1];
        Assert.Equal(2, coe.Id);
        Assert.Equal(["Yes", "No", "Not Applicable"], coe.Options);
        Assert.Equal(new EsgFollowUp(3, "Yes", "If yes, have you acquired the Certificate?", "single_choice", ["Yes", "No"]), coe.FollowUps.Single(), new FollowUpComparer());
        Assert.Equal("text_box", r.Checklist.Sections[1].Questions[2].FollowUps.Single().Type);
        Assert.Equal("No", r.Checklist.Sections[1].Questions[2].FollowUps.Single().ShowOn);
    }

    [Fact]
    public async Task Saving_keeps_the_codes_and_gives_a_new_question_the_next_free_one()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var edited = WithQuestion(EsgChecklistFormat.Standard, 1, new EsgQuestion(null, "  Is there a creche for the workers' children? ", ["yes", "No"],
            [new EsgFollowUp(null, "no", "If no, why?", "TEXT_BOX", [])]));
        var r = await admin.PutAsJsonAsync(Url, edited);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var saved = Saved(Writes().Single());
        Assert.Equal("ADMIN1", FakeSql.Arg(Writes().Single().Args, "UpdatedBy"));
        var added = saved.Sections[1].Questions[^1];
        Assert.Equal(23, added.Id);
        Assert.Equal("Is there a creche for the workers' children?", added.Question);
        // The apps compare the answer with "Yes" / "No" as written.
        Assert.Equal(["Yes", "No"], added.Options);
        Assert.Equal(24, added.FollowUps[0].Id);
        Assert.Equal(("No", "text_box"), (added.FollowUps[0].ShowOn, added.FollowUps[0].Type));
        Assert.Equal(EsgChecklistFormat.Standard.Sections[0].Questions.Select(q => q.Id), saved.Sections[0].Questions.Select(q => q.Id));
    }

    [Fact]
    public async Task A_removed_questions_code_is_not_given_to_a_new_one()
    {
        // The saved checklist dropped the last social question (22); a new one still gets 23, not 22.
        var saved = new EsgChecklistDefinition([EsgChecklistFormat.Standard.Sections[0],
            EsgChecklistFormat.Standard.Sections[1] with { Questions = EsgChecklistFormat.Standard.Sections[1].Questions.SkipLast(1).ToList() }]);
        Stored(saved);
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync(Url, WithQuestion(saved, 0, new EsgQuestion(null, "New?", ["Yes", "No"], [])))).StatusCode);
        Assert.Equal(23, Saved(Writes().Single()).Sections[0].Questions[^1].Id);
    }

    public static TheoryData<string, string> Refusals => new()
    {
        { "one-section", "two sections" },
        { "no-question-text", "please enter the question" },
        { "one-option", "give 2 to 6 options" },
        { "same-options", "the options must differ" },
        { "show-on-maybe", "shown on Yes or on No" },
        { "show-on-missing-option", "option to show it on" },
        { "two-on-yes", "only one follow-up can be shown on Yes" },
        { "bad-type", "single choice or text box" },
        { "duplicate-code", "is used twice" },
    };

    [Theory]
    [MemberData(nameof(Refusals))]
    public async Task Refuses_what_the_apps_cannot_ask(string change, string message)
    {
        var std = EsgChecklistFormat.Standard;
        EsgQuestion Q(IReadOnlyList<string>? options = null, params EsgFollowUp[] f) => new(null, "Q?", options ?? ["Yes", "No"], f);
        var body = change switch
        {
            "one-section" => new EsgChecklistDefinition([std.Sections[0]]),
            "no-question-text" => WithQuestion(std, 0, new EsgQuestion(null, " ", ["Yes", "No"], [])),
            "one-option" => WithQuestion(std, 0, Q(["Yes"])),
            "same-options" => WithQuestion(std, 0, Q(["Yes", "yes"])),
            "show-on-maybe" => WithQuestion(std, 0, Q(null, new EsgFollowUp(null, "Maybe", "Why?", "text_box", []))),
            "show-on-missing-option" => WithQuestion(std, 0, Q(["Yes", "Not Applicable"], new EsgFollowUp(null, "No", "Why?", "text_box", []))),
            "two-on-yes" => WithQuestion(std, 0, Q(null, new EsgFollowUp(null, "Yes", "A?", "text_box", []), new EsgFollowUp(null, "Yes", "B?", "text_box", []))),
            "bad-type" => WithQuestion(std, 0, Q(null, new EsgFollowUp(null, "Yes", "A?", "date", []))),
            "duplicate-code" => WithQuestion(std, 0, new EsgQuestion(1, "Again?", ["Yes", "No"], [])),
            _ => throw new ArgumentOutOfRangeException(nameof(change)),
        };
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.PutAsJsonAsync(Url, body);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains(message, await r.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        Assert.Empty(Writes());
    }

    [Fact]
    public async Task Shows_the_saved_checklist_and_resets_to_the_standard_one()
    {
        Stored(WithQuestion(EsgChecklistFormat.Standard, 0, new EsgQuestion(23, "Own question?", ["Yes", "No"], [])), revision: 4);
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = (await admin.GetFromJsonAsync<EsgChecklistController.EsgChecklistResponse>(Url))!;
        Assert.True(r.Customised);
        Assert.Equal("1.7.4", r.Version);
        Assert.Equal("ADMIN1", r.UpdatedBy);
        Assert.Equal("Own question?", r.Checklist.Sections[0].Questions[^1].Question);

        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync(Url)).StatusCode);
        Assert.StartsWith("DELETE FROM dbo.V4EsgChecklist", Writes().Single().Name);
    }

    [Fact]
    public void The_apps_json_has_the_old_files_fields_and_reads_back_the_same()
    {
        var json = EsgChecklistFormat.ToAppJson(EsgChecklistFormat.Standard, "1.7.2");
        var root = JsonDocument.Parse(json).RootElement;
        Assert.Equal("1.7.2", root.GetProperty("version").GetString());
        var field = root.GetProperty("sections")[0].GetProperty("fields")[1];
        Assert.Equal("2", field.GetProperty("id").GetString());
        Assert.Equal("single_choice", field.GetProperty("type").GetString());
        Assert.Equal("true", field.GetProperty("is_visable").GetString());
        var dep = field.GetProperty("dependent_fields")[0];
        Assert.Equal(("3", "Yes", "false"), (dep.GetProperty("id").GetString(), dep.GetProperty("selected_option").GetString(), dep.GetProperty("is_visable").GetString()));
        Assert.Equal(EsgChecklistFormat.ToStore(EsgChecklistFormat.Standard), EsgChecklistFormat.ToStore(EsgChecklistFormat.FromAppJson(json)));
    }

    private sealed class FollowUpComparer : IEqualityComparer<EsgFollowUp>
    {
        public bool Equals(EsgFollowUp? x, EsgFollowUp? y) =>
            x is not null && y is not null && (x.Id, x.ShowOn, x.Question, x.Type) == (y.Id, y.ShowOn, y.Question, y.Type) && x.Options.SequenceEqual(y.Options);

        public int GetHashCode(EsgFollowUp obj) => obj.Id.GetHashCode();
    }
}
