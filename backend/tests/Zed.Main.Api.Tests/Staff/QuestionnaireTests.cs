using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Staff.Questionnaire;

namespace Zed.Main.Api.Tests.Staff;

public sealed class QuestionnaireTests : IDisposable
{
    private const string Base = "/api/staff/questionnaire/Bronze/P1/requirements";
    private readonly TestHost _host = new();

    public QuestionnaireTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Procs["SP_MASTER_GET_SECTIONS"] = args => FakeSql.Arg(args, "SectionType") == "Bronze"
            ? FakeSql.Sets([new { Id = 3, SectionType = "Bronze", SectionCode = "P1", SectionName = "Leadership", iButton = "x" }])
            : FakeSql.Sets([]);
        _host.Sql.Procs["SP_MASTER_GET_REQUIREMENTS_BY_QUESTION_ID"] = _ => FakeSql.Sets(
            [
                new { Id = 11L, SectionType = "Bronze", SectionCode = "P1", RequirementCode = "1", RequirementName = (string?)null, OrderNo = 1 },
                new { Id = 12L, SectionType = "Bronze", SectionCode = "P1", RequirementCode = "2", RequirementName = (string?)null, OrderNo = 2 },
            ],
            [
                new { Id = 101L, RequirementCode = "1", OptionCode = "1", OptionName = "Has a <b>policy</b>", OptionImage = "" },
                new { Id = 201L, RequirementCode = "2", OptionCode = "1", OptionName = "First", OptionImage = "" },
                new { Id = 202L, RequirementCode = "2", OptionCode = "2", OptionName = "Second", OptionImage = "" },
                new { Id = 203L, RequirementCode = "2", OptionCode = "3", OptionName = "Third", OptionImage = "" },
            ],
            [new { Id = 501L, RequirementCode = "1", OptionCode = "1", SubOptionCode = "1", SubOptionName = "Bullet A" }],
            [new { Id = 701L, RequirementCode = "1", EvidenceCode = "1", EvidenceName = "Policy document", EvidenceType = true, ValidationRequired = true, HelpText = "Signed copy" }],
            [new { Id = 702L, RequirementCode = "1", EvidenceCode = "2", EvidenceName = "Photo", EvidenceType = false, ValidationRequired = false, HelpText = (string?)null }]);
    }

    public void Dispose() => _host.Dispose();

    private (string Name, object? Args) Call(string proc) => _host.Sql.Calls.Last(c => c.Name == proc);

    [Fact]
    public async Task Anonymous_gets_401_and_other_staff_roles_403()
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(Base)).StatusCode);
        foreach (var user in new[] { "MASTER1", "AGENCY1", "SUPER1", "ASSESSOR1" })
        {
            var client = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(Base)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(Base, new { points = new[] { new { name = "x" } } })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.DeleteAsync(Base + "/12")).StatusCode);
        }
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_MASTER_INSERT", StringComparison.Ordinal) || c.Name.StartsWith("SP_MASTER_REMOVE", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Lists_requirements_with_points_bullets_and_evidences()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var body = await admin.GetFromJsonAsync<JsonElement>("/api/staff/questionnaire/bronze/p1/requirements");
        Assert.Equal("Bronze", body.GetProperty("sectionType").GetString());
        Assert.Equal("P1", body.GetProperty("sectionCode").GetString());
        Assert.Equal("Leadership", body.GetProperty("sectionName").GetString());
        var reqs = body.GetProperty("requirements");
        Assert.Equal(2, reqs.GetArrayLength());
        var first = reqs[0];
        Assert.Equal("Has a <b>policy</b>", first.GetProperty("points")[0].GetProperty("name").GetString());
        Assert.Equal("Bullet A", first.GetProperty("points")[0].GetProperty("bullets")[0].GetProperty("name").GetString());
        Assert.True(first.GetProperty("mandatoryEvidences")[0].GetProperty("validationRequired").GetBoolean());
        Assert.Equal("Signed copy", first.GetProperty("mandatoryEvidences")[0].GetProperty("helpText").GetString());
        Assert.Equal("Photo", first.GetProperty("optionalEvidences")[0].GetProperty("evidenceName").GetString());
        Assert.False(first.GetProperty("canRemove").GetBoolean());
        Assert.True(reqs[1].GetProperty("canRemove").GetBoolean());
        // Only the shown columns are returned.
        Assert.False(first.TryGetProperty("requirementName", out _));
        Assert.Equal("P1", FakeSql.Arg(Call("SP_MASTER_GET_REQUIREMENTS_BY_QUESTION_ID").Args, "SectionCode"));
    }

    [Fact]
    public async Task Points_carry_their_option_image_from_the_procedure()
    {
        // The procedure selects Options.*, OptionImage included; points saved by this page store "" there.
        _host.Sql.Procs["SP_MASTER_GET_REQUIREMENTS_BY_QUESTION_ID"] = _ => FakeSql.Sets(
            [new { Id = 11L, RequirementCode = "1", OrderNo = 1 }],
            [
                new { Id = 101L, RequirementCode = "1", OptionCode = "1", OptionName = "With image", OptionImage = (string?)" Images/Questions/p1.png " },
                new { Id = 102L, RequirementCode = "1", OptionCode = "2", OptionName = "Blank", OptionImage = (string?)"" },
                new { Id = 103L, RequirementCode = "1", OptionCode = "3", OptionName = "Null", OptionImage = (string?)null },
            ],
            [], [], []);
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var points = (await admin.GetFromJsonAsync<JsonElement>(Base)).GetProperty("requirements")[0].GetProperty("points");
        Assert.Equal("Images/Questions/p1.png", points[0].GetProperty("optionImage").GetString());
        Assert.Equal(JsonValueKind.Null, points[1].GetProperty("optionImage").ValueKind);
        Assert.Equal(JsonValueKind.Null, points[2].GetProperty("optionImage").ValueKind);
    }

    [Theory]
    [InlineData("/api/staff/questionnaire/Hotel/P1/requirements")]
    [InlineData("/api/staff/questionnaire/Silver/P1/requirements")]
    [InlineData("/api/staff/questionnaire/Bronze/P9/requirements")]
    [InlineData("/api/staff/questionnaire/Bronze/..%2F..%2Fweb/requirements")]
    public async Task Unknown_parameters_are_404(string url)
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync(url, new { points = new[] { new { name = "x" } } })).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MASTER_INSERT_REQUIREMENT");
    }

    [Fact]
    public async Task Adds_a_requirement_with_points_and_bullets()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var empty = await admin.PostAsJsonAsync(Base, new { points = Array.Empty<object>() });
        Assert.Equal("Please add at least one point to the requirement.", await empty.ProblemTitle());
        var tooLong = await admin.PostAsJsonAsync(Base, new { points = new[] { new { name = new string('x', 1991) } } });
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);

        var ok = await admin.PostAsJsonAsync(Base, new
        {
            points = new object[]
            {
                new { name = " Point one ", bullets = new[] { "a", " ", "b" } },
                new { name = "Point two" },
            },
        });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var args = (Dapper.DynamicParameters)Call("SP_MASTER_INSERT_REQUIREMENT").Args!;
        Assert.Equal("Bronze", args.Get<object>("SectionType"));
        Assert.Equal("P1", args.Get<object>("SectionCode"));
        Assert.Contains("PointList", args.ParameterNames);
        Assert.Contains("BulletList", args.ParameterNames);
    }

    [Fact]
    public void Point_and_bullet_tables_are_numbered_like_the_old_action()
    {
        var (points, error) = QuestionnaireController.ValidatePoints(
        [
            new("First", ["x", null, "y"]),
            new("Second", null),
        ]);
        Assert.Null(error);
        var p = QuestionnaireController.PointTable(points!);
        Assert.Equal(["1", "2"], p.Rows.Cast<System.Data.DataRow>().Select(r => (string)r["OptionCode"]));
        Assert.Equal("Second", p.Rows[1]["OptionText"]);
        var b = QuestionnaireController.BulletTable(points!);
        Assert.Equal(2, b.Rows.Count);
        Assert.Equal(("1", "2", "y"), ((string)b.Rows[1]["OptionCode"], (string)b.Rows[1]["SubOptionCode"], (string)b.Rows[1]["SubOptionText"]));

        var (evidences, eError) = QuestionnaireController.ValidateEvidences([new("Doc", "help", true), new("Photo", null, false)]);
        Assert.Null(eError);
        var e = QuestionnaireController.EvidenceTable(evidences!, 3);
        Assert.Equal(("3", "1", "help"), ((string)e.Rows[0]["OptionCode"], (string)e.Rows[0]["OptionImage"], (string)e.Rows[0]["HelpText"]));
        Assert.Equal(("4", "0"), ((string)e.Rows[1]["OptionCode"], (string)e.Rows[1]["OptionImage"]));
        Assert.Equal(DBNull.Value, e.Rows[1]["HelpText"]);
    }

    [Fact]
    public async Task Evidences_are_saved_only_for_requirements_of_the_parameter()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var body = new
        {
            mandatoryEvidences = new[] { new { evidenceName = "Policy document", helpText = "Signed copy", validationRequired = true } },
            optionalEvidences = new[] { new { evidenceName = "Photo", helpText = (string?)null, validationRequired = false } },
        };
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync(Base + "/999/evidences", body)).StatusCode);
        var none = await admin.PutAsJsonAsync(Base + "/11/evidences", new { mandatoryEvidences = Array.Empty<object>() });
        Assert.Equal("Please add at least one evidence.", await none.ProblemTitle());

        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync(Base + "/11/evidences", body)).StatusCode);
        var args = (Dapper.DynamicParameters)Call("SP_MASTER_INSERT_EVIDENCES").Args!;
        Assert.Equal("1", args.Get<object>("RequirementCode"));
        Assert.Contains("EvidenceList", args.ParameterNames);
        Assert.Contains("EvidenceListOpt", args.ParameterNames);
    }

    [Fact]
    public async Task Only_the_last_requirement_and_last_extra_point_can_be_removed()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal("Only the last requirement can be removed.", await (await admin.DeleteAsync(Base + "/11")).ProblemTitle());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync(Base + "/999")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync(Base + "/12")).StatusCode);
        Assert.Equal("12", FakeSql.Arg(Call("SP_MASTER_REMOVE_REQUIREMENT").Args, "RequirementId"));

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.DeleteAsync(Base + "/12/points/201")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.DeleteAsync(Base + "/12/points/202")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.DeleteAsync(Base + "/11/points/101")).StatusCode);
        // A point of another requirement is not found under this one.
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync(Base + "/11/points/203")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync(Base + "/12/points/203")).StatusCode);
        Assert.Equal("203", FakeSql.Arg(Call("SP_MASTER_REMOVE_OPTION").Args, "OptionId"));
    }
}
