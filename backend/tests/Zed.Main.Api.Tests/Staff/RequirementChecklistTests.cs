using System.Data.Common;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Staff.Questionnaire;
using Zed.Portal.Features.Staff.Reports;
using Zed.Portal.Features.Staff.Schemes;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>V4 requirements: purpose, benefits, Yes / No checkpoints with their evidence and actions (migration 0034), and their Excel.</summary>
public sealed class RequirementChecklistTests : IDisposable
{
    private const string Base = "/api/staff/questionnaire/Bronze/P1/requirements";
    private readonly TestHost _host = new();

    private sealed class MissingColumn : DbException
    {
        public MissingColumn() : base("Invalid column name 'Purpose'.") { }
    }

    public RequirementChecklistTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Procs["SP_MASTER_GET_SECTIONS"] = _ => FakeSql.Sets([new { Id = 3, SectionType = "Bronze", SectionCode = "P1", SectionName = "Leadership" }]);
        _host.Sql.Procs["SP_MASTER_GET_REQUIREMENTS_BY_QUESTION_ID"] = _ => FakeSql.Sets(
            [
                new { Id = 11L, RequirementCode = "1", OrderNo = 1 },
                new { Id = 12L, RequirementCode = "2", OrderNo = 2 },
            ],
            [
                new { Id = 101L, RequirementCode = "1", OptionCode = "1", OptionName = "Roles are defined?", OptionImage = "" },
                new { Id = 201L, RequirementCode = "2", OptionCode = "1", OptionName = "First", OptionImage = "" },
                new { Id = 202L, RequirementCode = "2", OptionCode = "2", OptionName = "Second", OptionImage = "" },
                new { Id = 203L, RequirementCode = "2", OptionCode = "3", OptionName = "Third", OptionImage = "" },
            ],
            [new { Id = 501L, RequirementCode = "1", OptionCode = "1", SubOptionCode = "1", SubOptionName = "Bullet A" }],
            [
                new { Id = 701L, RequirementCode = "1", EvidenceCode = "1", EvidenceName = "Org chart", EvidenceType = true, ValidationRequired = true, HelpText = "Signed" },
                new { Id = 702L, RequirementCode = "1", EvidenceCode = "2", EvidenceName = "Old policy", EvidenceType = true, ValidationRequired = false, HelpText = (string?)null },
            ],
            [new { Id = 703L, RequirementCode = "1", EvidenceCode = "3", EvidenceName = "Photo", EvidenceType = false, ValidationRequired = false, HelpText = (string?)null }]);
        _host.Sql.Queries[QuestionnaireController.RequirementExtrasSql] = _ => [new QuestionnaireController.RequirementExtra("1", "Clear roles", "Fewer gaps")];
        _host.Sql.Queries[QuestionnaireController.OptionExtrasSql] = _ => [new QuestionnaireController.OptionExtra("1", "1", "Prepare a chart\nWrite job descriptions")];
        _host.Sql.Queries[QuestionnaireController.EvidenceExtrasSql] = _ =>
            [new QuestionnaireController.EvidenceExtra("1", "1", "1", "sample_20261030_abcd1234.pdf"), new QuestionnaireController.EvidenceExtra("1", "3", "1", null)];
    }

    public void Dispose() => _host.Dispose();

    private Task<HttpClient> Admin() => UsersMastersLogin.SignInAsync(_host, "ADMIN1");

    private List<(string Name, object? Args)> Calls(string name) => _host.Sql.Calls.Where(c => c.Name == name).ToList();

    private static object Checkpoint(string? code, string text, object[]? evidences = null, string[]? actions = null) =>
        new { optionCode = code, text, evidences = evidences ?? [], actions = actions ?? [] };

    [Fact]
    public async Task Requirements_show_purpose_benefits_and_each_checkpoints_evidence_and_actions()
    {
        var body = await (await Admin()).GetFromJsonAsync<JsonElement>(Base);
        Assert.True(body.GetProperty("checklistReady").GetBoolean());
        var r = body.GetProperty("requirements")[0];
        Assert.Equal(("Clear roles", "Fewer gaps"), (r.GetProperty("purpose").GetString(), r.GetProperty("benefits").GetString()));
        Assert.Equal(["Prepare a chart", "Write job descriptions"], r.GetProperty("points")[0].GetProperty("actions").EnumerateArray().Select(a => a.GetString()));
        var org = r.GetProperty("mandatoryEvidences")[0];
        Assert.Equal(("1", "sample_20261030_abcd1234.pdf"), (org.GetProperty("optionCode").GetString(), org.GetProperty("sampleFile").GetString()));
        // Added before V4: the whole requirement's.
        Assert.Equal(JsonValueKind.Null, r.GetProperty("mandatoryEvidences")[1].GetProperty("optionCode").ValueKind);
    }

    [Fact]
    public async Task Without_migration_0034_the_page_still_lists_and_saving_says_what_is_missing()
    {
        _host.Sql.Queries[QuestionnaireController.RequirementExtrasSql] = _ => throw new MissingColumn();
        var admin = await Admin();
        var body = await admin.GetFromJsonAsync<JsonElement>(Base);
        Assert.False(body.GetProperty("checklistReady").GetBoolean());
        Assert.Equal(2, body.GetProperty("requirements").GetArrayLength());
        var r = await admin.PostAsJsonAsync(Base + "/checklist", new { requirementName = "R", checkpoints = new[] { Checkpoint(null, "Q?") } });
        Assert.Contains("migration 0034", await r.ProblemTitle());
        Assert.Empty(Calls("SP_MASTER_INSERT_REQUIREMENT"));
    }

    [Fact]
    public async Task Adding_a_requirement_saves_its_checkpoints_purpose_actions_and_evidence_by_checkpoint()
    {
        var r = await (await Admin()).PostAsJsonAsync(Base + "/checklist", new
        {
            requirementName = "Roles and responsibilities are defined", purpose = "Why", benefits = "What for",
            checkpoints = new[]
            {
                Checkpoint(null, "Defined?", [new { evidenceName = "Chart", mandatory = true, sampleFile = "sample_20261030_abcd1234.pdf" }, new { evidenceName = "Photo", mandatory = false }], ["Prepare a chart", " "]),
                Checkpoint(null, "Communicated?", [new { evidenceName = "Training record", mandatory = true }]),
            },
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("Requirement P1.3 saved.", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString());
        Assert.Single(Calls("SP_MASTER_INSERT_REQUIREMENT"));
        var purpose = Assert.Single(Calls(QuestionnaireController.PurposeSql));
        Assert.Equal(("3", "Why", "What for"), (FakeSql.Arg(purpose.Args, "RequirementCode"), FakeSql.Arg(purpose.Args, "Purpose"), FakeSql.Arg(purpose.Args, "Benefits")));
        Assert.Equal("Roles and responsibilities are defined", FakeSql.Arg(purpose.Args, "RequirementName"));
        Assert.Equal("Roles and responsibilities are defined", FakeSql.Arg(Assert.Single(Calls("SP_MASTER_INSERT_REQUIREMENT")).Args, "RequirementName"));
        Assert.Equal("Prepare a chart", FakeSql.Arg(Calls(QuestionnaireController.ActionsSql)[0].Args, "ActionsNeeded"));
        Assert.Null(FakeSql.Arg(Calls(QuestionnaireController.ActionsSql)[1].Args, "ActionsNeeded"));
        Assert.Single(Calls("SP_MASTER_INSERT_EVIDENCES"));
        // Mandatory first (1 Chart, 2 Training record), then the others (3 Photo): each linked to its checkpoint.
        var links = Calls(QuestionnaireController.EvidenceExtraSql).Select(c => (FakeSql.Arg(c.Args, "EvidenceCode"), FakeSql.Arg(c.Args, "OptionCode"), FakeSql.Arg(c.Args, "SampleFile"))).ToList();
        Assert.Equal([("1", "1", "sample_20261030_abcd1234.pdf"), ("2", "2", null), ("3", "1", null)], links);
    }

    [Fact]
    public async Task A_requirement_keeps_its_video_tutorial_and_a_bad_link_is_refused()
    {
        _host.Sql.Queries[QuestionnaireController.VideoSql] = _ => [new QuestionnaireController.RequirementVideo("1", "https://youtu.be/abc123")];
        var admin = await Admin();
        var body = await admin.GetFromJsonAsync<JsonElement>(Base);
        Assert.Equal("https://youtu.be/abc123", body.GetProperty("requirements")[0].GetProperty("videoUrl").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("requirements")[1].GetProperty("videoUrl").ValueKind);

        var saved = await admin.PutAsJsonAsync(Base + "/11/checklist", new { requirementName = "R", videoUrl = " https://www.youtube.com/watch?v=xyz ", checkpoints = new[] { Checkpoint("1", "Roles are defined?") } });
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var video = Assert.Single(Calls(QuestionnaireController.VideoUpdateSql));
        Assert.Equal(("1", "https://www.youtube.com/watch?v=xyz"), (FakeSql.Arg(video.Args, "RequirementCode"), FakeSql.Arg(video.Args, "VideoUrl")));

        foreach (var bad in new[] { "javascript:alert(1)", "youtube.com/watch", "https://x.com/a b", "https://" + new string('a', 500) + ".com" })
        {
            var r = await admin.PutAsJsonAsync(Base + "/11/checklist", new { requirementName = "R", videoUrl = bad, checkpoints = new[] { Checkpoint("1", "Roles are defined?") } });
            Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
            Assert.Contains("video link", await r.ProblemTitle());
        }
        Assert.Single(Calls(QuestionnaireController.VideoUpdateSql));
    }

    [Theory]
    [InlineData("purpose", "Purpose can be up to 500 characters.")]
    [InlineData("action", "Checkpoint 1: each action needed can be up to 100 characters.")]
    [InlineData("none", "Please add at least one checkpoint.")]
    [InlineData("name", "Please enter the requirement (up to 2000 characters).")]
    [InlineData("sample", "Checkpoint 1: the sample copy of \"Chart\" is not valid. Please upload it again.")]
    public async Task Checklists_are_validated(string what, string message)
    {
        object body = what switch
        {
            "purpose" => new { requirementName = "R", purpose = new string('x', 501), checkpoints = new[] { Checkpoint(null, "Q?") } },
            "action" => new { requirementName = "R", checkpoints = new[] { Checkpoint(null, "Q?", actions: [new string('x', 101)]) } },
            "none" => new { requirementName = "R", checkpoints = Array.Empty<object>() },
            "name" => new { requirementName = " ", checkpoints = new[] { Checkpoint(null, "Q?") } },
            _ => new { requirementName = "R", checkpoints = new[] { Checkpoint(null, "Q?", [new { evidenceName = "Chart", mandatory = true, sampleFile = "../../web.config" }]) } },
        };
        var r = await (await Admin()).PostAsJsonAsync(Base + "/checklist", body);
        Assert.Equal(message, await r.ProblemTitle());
        Assert.Empty(Calls("SP_MASTER_INSERT_REQUIREMENT"));
    }

    [Fact]
    public async Task Editing_keeps_checkpoints_by_code_adds_new_ones_after_the_last_and_removes_the_others()
    {
        var admin = await Admin();
        var r = await admin.PutAsJsonAsync(Base + "/12/checklist", new
        {
            requirementName = "R", purpose = "P", checkpoints = new[] { Checkpoint("1", "First, reworded", actions: ["Do it"]), Checkpoint(null, "Fourth") },
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var text = Assert.Single(Calls(QuestionnaireController.PointTextSql));
        Assert.Equal(("2", "1", "First, reworded", "Do it"), (FakeSql.Arg(text.Args, "RequirementCode"), FakeSql.Arg(text.Args, "OptionCode"), FakeSql.Arg(text.Args, "OptionName"), FakeSql.Arg(text.Args, "ActionsNeeded")));
        Assert.Equal("4", FakeSql.Arg(Assert.Single(Calls(QuestionnaireController.AddPointSql)).Args, "OptionCode"));
        Assert.Equal(["2", "3"], Calls(QuestionnaireController.RemovePointSql).Select(c => FakeSql.Arg(c.Args, "OptionCode")));
        // No evidence left: the requirement's evidences are cleared (the procedure would need a list).
        Assert.Single(Calls(QuestionnaireController.ClearEvidencesSql));

        r = await admin.PutAsJsonAsync(Base + "/12/checklist", new { requirementName = "R", checkpoints = new[] { Checkpoint("9", "Unknown") } });
        Assert.Equal("Checkpoint 9 is not a checkpoint of this requirement.", await r.ProblemTitle());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync(Base + "/99/checklist", new { requirementName = "R", checkpoints = new[] { Checkpoint(null, "Q?") } })).StatusCode);
    }

    [Fact]
    public async Task Editing_keeps_the_evidences_of_the_whole_requirement()
    {
        var r = await (await Admin()).PutAsJsonAsync(Base + "/11/checklist", new
        {
            requirementName = "R", checkpoints = new[] { Checkpoint("1", "Roles are defined?", [new { evidenceName = "Org chart", mandatory = true, sampleFile = "sample_20261030_abcd1234.pdf", helpText = "Signed", validationRequired = true }]) },
            generalEvidences = new[] { new { evidenceName = "Old policy", mandatory = true } },
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var links = Calls(QuestionnaireController.EvidenceExtraSql).Select(c => (FakeSql.Arg(c.Args, "EvidenceCode"), FakeSql.Arg(c.Args, "OptionCode"))).ToList();
        Assert.Equal([("1", "1")], links); // "Old policy" (2) stays without a checkpoint
    }

    [Fact]
    public async Task Sample_copies_are_pdf_image_or_office_files_and_can_be_downloaded()
    {
        var admin = await Admin();
        var part = new ByteArrayContent("%PDF-1.4\n%test\n"u8.ToArray());
        part.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        var r = await admin.PostAsync(Base + "/samples", new MultipartFormDataContent { { part, "file", "chart.pdf" } });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var name = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("fileName").GetString()!;
        Assert.Matches("^sample_[0-9]{14}_[0-9a-f]{8}\\.pdf$", name);
        var download = await admin.GetAsync($"{Base}/samples/{name}");
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        Assert.Equal("application/pdf", download.Content.Headers.ContentType?.MediaType);

        var exe = new ByteArrayContent("MZ"u8.ToArray());
        exe.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync(Base + "/samples", new MultipartFormDataContent { { exe, "file", "x.exe" } })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync(Base + "/samples/..%2F..%2Fappsettings.json")).StatusCode);
        var other = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync($"{Base}/samples/{name}")).StatusCode);
    }

    private static MultipartFormDataContent Xlsx(params string?[][] rows)
    {
        // Eight columns: a file exported before the Requirement text column (2026-11-13); nine with it.
        var columns = new[] { "Requirement", "Checkpoint", "Purpose", "Benefits", "Checkpoint text", "Evidence (if Yes)", "Mandatory evidence", "Action needed (if No / Partial)" };
        if (rows.Any(r => r.Length > 8)) columns = [.. columns, "Requirement text"];
        var part = new ByteArrayContent(XlsxWriter.Write([new XlsxSheet("Sheet1", columns, rows.Select(r => (IReadOnlyList<object?>)r.Cast<object?>().ToList()))]));
        part.Headers.ContentType = new MediaTypeHeaderValue(XlsxWriter.ContentType);
        return new MultipartFormDataContent { { part, "file", "requirements.xlsx" } };
    }

    [Fact]
    public async Task The_excel_has_a_row_per_checkpoint_and_new_ones_follow_on_from_the_last()
    {
        var admin = await Admin();
        var export = XlsxSheetReader.ReadFirstSheet(await (await admin.GetAsync(Base + "/excel")).Content.ReadAsStreamAsync());
        Assert.Equal(["1", "1", "Clear roles", "Fewer gaps", "Roles are defined?", "Org chart\nPhoto", "Yes\nNo", "Prepare a chart\nWrite job descriptions"], export[1][..8]);
        Assert.Equal(5, export.Count); // the header and four checkpoints

        // A file without the Requirement text column (exported before it) still uploads.
        var old = await (await admin.PostAsync(Base + "/excel/check", Xlsx(
            ["1", "1", "", "", "Roles are defined?", "Org chart\nPhoto", "yes\nno", "Prepare a chart\nWrite job descriptions"]))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("same", old.GetProperty("rows")[0].GetProperty("result").GetString());

        var check = await (await admin.PostAsync(Base + "/excel/check", Xlsx(
            ["1", "1", "", "", "Roles are defined?", "Org chart\nPhoto", "yes\nno", "Prepare a chart\nWrite job descriptions", ""],
            ["2", "4", "", "", "Fourth", "Plan", "", "Make a plan", "Second requirement"],
            ["3", "1", "New purpose", "", "New requirement?", "", "", "", "A new requirement"],
            ["5", "1", "", "", "Skipped a number", "", "", "", "Text"],
            ["2", "6", "", "", "Gap", "", "", "", ""]))).Content.ReadFromJsonAsync<JsonElement>();
        var rows = check.GetProperty("rows");
        Assert.Equal(["same", "new", "new", "error", "error"], rows.EnumerateArray().Select(r => r.GetProperty("result").GetString()));
        Assert.Equal("A new requirement takes the next number: 4.", rows[3].GetProperty("errors")[0].GetString());
        Assert.Equal("A new checkpoint of requirement 2 takes the next number: 5.", rows[4].GetProperty("errors")[0].GetString());
        // An older requirement without its text: the row must give it.
        var unnamed = await (await admin.PostAsync(Base + "/excel/check", Xlsx(["2", "4", "", "", "Fourth", "", "", "", ""]))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Requirement 2 has no Requirement text yet: please add it on this row.", unnamed.GetProperty("rows")[0].GetProperty("errors")[0].GetString());

        var r = await admin.PostAsync(Base + "/excel/apply", Xlsx(["2", "4", "", "", "Fourth", "Plan", "", "Make a plan", "Second requirement"], ["3", "1", "New purpose", "", "New requirement?", "", "", "", "A new requirement"]));
        var applied = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, applied.GetProperty("added").GetInt32());
        Assert.Equal("4", FakeSql.Arg(Assert.Single(Calls(QuestionnaireController.AddPointSql)).Args, "OptionCode"));
        Assert.Single(Calls("SP_MASTER_INSERT_REQUIREMENT"));
        Assert.Contains(Calls(QuestionnaireController.PurposeSql), c => FakeSql.Arg(c.Args, "Purpose") == "New purpose" && FakeSql.Arg(c.Args, "RequirementCode") == "3"
            && FakeSql.Arg(c.Args, "RequirementName") == "A new requirement");
    }

    private static MultipartFormDataContent LevelXlsx(params string?[][] rows)
    {
        var columns = new[] { "Parameter", "Requirement", "Checkpoint", "Purpose", "Benefits", "Checkpoint text", "Evidence (if Yes)", "Mandatory evidence",
            "Action needed (if No / Partial)", "Requirement text" };
        var part = new ByteArrayContent(XlsxWriter.Write([new XlsxSheet("Sheet1", columns, rows.Select(r => (IReadOnlyList<object?>)r.Cast<object?>().ToList()))]));
        part.Headers.ContentType = new MediaTypeHeaderValue(XlsxWriter.ContentType);
        return new MultipartFormDataContent { { part, "file", "bronze-requirements.xlsx" } };
    }

    [Fact]
    public async Task The_level_excel_has_every_parameter_and_saves_each_row_in_its_parameter()
    {
        _host.Sql.Procs["SP_MASTER_GET_SECTIONS"] = _ => FakeSql.Sets([
            new { Id = 4, SectionType = "Bronze", SectionCode = "P2", SectionName = "Planning" },
            new { Id = 3, SectionType = "Bronze", SectionCode = "P1", SectionName = "Leadership" }]);
        const string level = "/api/staff/questionnaire/Bronze/all-requirements/excel";
        var admin = await Admin();

        var export = XlsxSheetReader.ReadFirstSheet(await (await admin.GetAsync(level)).Content.ReadAsStreamAsync());
        Assert.Equal("Parameter", export[0][0]);
        Assert.Equal("Requirement text", export[0][9]);
        Assert.Equal(9, export.Count); // the header and four checkpoints of each of the two parameters
        Assert.Equal(["P1", "P1", "P1", "P1", "P2", "P2", "P2", "P2"], export.Skip(1).Select(r => r[0]));

        var check = await (await admin.PostAsync(level + "/check", LevelXlsx(
            ["P1", "1", "1", "", "", "Roles are defined?", "Org chart\nPhoto", "yes\nno", "Prepare a chart\nWrite job descriptions", ""],
            ["p2", "2", "4", "", "", "Fourth", "Plan", "", "Make a plan", "Second requirement"],
            ["P9", "1", "1", "", "", "Unknown parameter", "", "", "", "Text"]))).Content.ReadFromJsonAsync<JsonElement>();
        var rows = check.GetProperty("rows");
        Assert.Equal(["same", "new", "error"], rows.EnumerateArray().Select(r => r.GetProperty("result").GetString()));
        Assert.Equal("Bronze has no parameter P9: please add it on the Parameters page first.", rows[2].GetProperty("errors")[0].GetString());

        var applied = await (await admin.PostAsync(level + "/apply", LevelXlsx(
            ["P2", "2", "4", "", "", "Fourth", "Plan", "", "Make a plan", "Second requirement"]))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, applied.GetProperty("added").GetInt32());
        var add = Assert.Single(Calls(QuestionnaireController.AddPointSql));
        Assert.Equal(("P2", "2", "4"), (FakeSql.Arg(add.Args, "SectionCode"), FakeSql.Arg(add.Args, "RequirementCode"), FakeSql.Arg(add.Args, "OptionCode")));
    }
}
