using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Incentives;
using Zed.Portal.Features.Incentives.Admin;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>2026-11-20 (approved design): Admin → Incentive Schemes (the definitions) and the two built-in cards' settings.</summary>
public sealed class SchemesAdminTests : IDisposable
{
    private const string Url = "/api/staff/settings/schemes";
    private readonly TestHost _host = new();

    /// <summary>The dbo.Incentives scheme rows the fake database holds (code → JSON, active, order).</summary>
    private readonly Dictionary<string, (string Json, bool Active, int Order)> _rows = new(StringComparer.OrdinalIgnoreCase);

    private readonly List<SchemeStore.CardSettings> _cards =
    [
        new("FINANCIAL_ASSISTANCE", null, null, null),
        new("TECHNOLOGY_UPGRADATION", null, null, null),
    ];

    private sealed class MissingColumns() : DbException("Invalid column name 'SchemeCode'.");

    public SchemesAdminTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Queries[SchemeStore.AllSql] = _ => _rows.Select((r, i) => (object)new { Id = (long)i + 1, SchemeCode = r.Key, SchemeJson = r.Value.Json, r.Value.Active, OrderNo = (int?)r.Value.Order }).ToList();
        _host.Sql.Queries[SchemeStore.CardSettingsSql] = _ => _cards.Cast<object>().ToList();
        _host.Sql.Procs[SchemeStore.InsertSql] = args =>
        {
            _rows[FakeSql.Arg(args, "Code")!] = (FakeSql.Arg(args, "Json")!, FakeSql.Arg(args, "Active") == "True", int.Parse(FakeSql.Arg(args, "OrderNo")!));
            return FakeSql.Sets();
        };
        _host.Sql.Procs[SchemeStore.UpdateSql] = args =>
        {
            _rows[FakeSql.Arg(args, "Code")!] = (FakeSql.Arg(args, "Json")!, FakeSql.Arg(args, "Active") == "True", int.Parse(FakeSql.Arg(args, "OrderNo")!));
            return FakeSql.Sets();
        };
    }

    public void Dispose() => _host.Dispose();

    private List<(string Name, object? Args)> Calls(string sql) => _host.Sql.Calls.Where(c => c.Name == sql).ToList();

    private void Seed(SchemeDefinition d) => _rows[d.Code] = (SchemeRules.Serialize(d), d.Active, d.OrderNo);

    [Fact]
    public async Task The_first_list_adds_the_direct_technology_upgradation_scheme_once_and_off()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var body = await client.GetFromJsonAsync<JsonElement>(Url);
        var tu = Assert.Single(body.GetProperty("schemes").EnumerateArray());
        Assert.Equal(SchemeTemplates.DirectTuCode, tu.GetProperty("code").GetString());
        Assert.False(tu.GetProperty("active").GetBoolean());
        Assert.Equal("Size", tu.GetProperty("grading").GetProperty("mode").GetString());
        Assert.Equal(["FA", "TU"], body.GetProperty("templates").EnumerateArray().Select(t => t.GetString()));
        Assert.Contains(body.GetProperty("levels").EnumerateArray(), l => l.GetProperty("code").GetString() == "Bronze");
        Assert.Equal(["Micro", "Small", "Medium"], body.GetProperty("sizes").EnumerateArray().Select(t => t.GetString()));

        await client.GetFromJsonAsync<JsonElement>(Url);
        Assert.Single(Calls(SchemeStore.InsertSql));
    }

    [Fact]
    public async Task Before_the_migration_the_list_is_empty()
    {
        _host.Sql.Procs[SchemeStore.InsertSql] = _ => throw new MissingColumns();
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var body = await client.GetFromJsonAsync<JsonElement>(Url);
        Assert.Empty(body.GetProperty("schemes").EnumerateArray());
    }

    [Fact]
    public async Task A_scheme_starts_from_a_template_off_and_codes_are_not_reused()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await client.PostAsJsonAsync(Url, new { template = "FA", code = "fa_state", name = "State FA" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var saved = SchemeRules.Parse(_rows["FA_STATE"].Json)!;
        Assert.Equal(("FA_STATE", "State FA", false), (saved.Code, saved.Name, saved.Active));
        Assert.Equal(2, saved.Form.Sections.Count);

        var again = await client.PostAsJsonAsync(Url, new { template = "TU", code = "FA_STATE", name = "Other" });
        Assert.Equal("The code FA_STATE is already used.", await again.ProblemTitle());

        var blank = await client.PostAsJsonAsync(Url, new { code = "NEW_ONE", name = "New one" });
        Assert.Equal(HttpStatusCode.OK, blank.StatusCode);
        var b = (await client.GetFromJsonAsync<SchemeDefinition>($"{Url}/NEW_ONE", SchemeRules.Json))!;
        Assert.Single(b.Form.Sections);
        Assert.Equal("New one", b.Card.Title);

        Assert.Equal("Choose a template: Financial Assistance, Technology Upgradation or blank.",
            await (await client.PostAsJsonAsync(Url, new { template = "XX", code = "OTHER", name = "Other" })).ProblemTitle());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{Url}/NOPE")).StatusCode);
    }

    [Fact]
    public async Task Saving_refuses_an_invalid_definition_with_the_problem()
    {
        var tu = SchemeTemplates.TechnologyUpgradation();
        Seed(tu);
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");

        var noClaim = tu with { Form = tu.Form with { Sections = [tu.Form.Sections[0] with { Fields = tu.Form.Sections[0].Fields.Select(f => f with { IsClaim = false }).ToList() }] } };
        var r = await client.PutAsJsonAsync($"{Url}/{tu.Code}", noClaim, SchemeRules.Json);
        Assert.Equal("Mark one amount field as the claim.", await r.ProblemTitle());
        Assert.Empty(Calls(SchemeStore.UpdateSql));

        var otherCode = await client.PutAsJsonAsync($"{Url}/{tu.Code}", tu with { Code = "OTHER" }, SchemeRules.Json);
        Assert.Equal("The code cannot be changed.", await otherCode.ProblemTitle());

        var ok = await client.PutAsJsonAsync($"{Url}/{tu.Code}", tu with { Name = "TU for all", Verification = tu.Verification with { CorrectionRounds = 3 } }, SchemeRules.Json);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var saved = SchemeRules.Parse(_rows[tu.Code].Json)!;
        Assert.Equal(("TU for all", 3), (saved.Name, saved.Verification.CorrectionRounds));

        var on = await client.PostAsJsonAsync($"{Url}/{tu.Code}/active", new { active = true });
        Assert.Equal(HttpStatusCode.OK, on.StatusCode);
        Assert.True(_rows[tu.Code].Active);
    }

    [Fact]
    public async Task A_blank_scheme_is_not_switched_on_before_it_is_graded()
    {
        Seed(SchemesAdminController.Blank("NEW_ONE", "New one"));
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await client.PostAsJsonAsync($"{Url}/NEW_ONE/active", new { active = true });
        Assert.Equal("Set the share and maximum of the grading before switching the scheme on.", await r.ProblemTitle());
        Assert.False(_rows["NEW_ONE"].Active);
    }

    [Fact]
    public async Task The_card_settings_are_read_and_checked()
    {
        Seed(SchemeTemplates.TechnologyUpgradation());
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var body = await client.GetFromJsonAsync<JsonElement>($"{Url}/cards");
        Assert.Equal(["Bronze", "Silver", "Gold"], body.GetProperty("financialAssistance").GetProperty("activatesAfter").EnumerateArray().Select(l => l.GetString()));
        var tu = body.GetProperty("technologyUpgradation");
        Assert.True(tu.GetProperty("recommendationRequired").GetBoolean());
        Assert.Equal(SchemeTemplates.DirectTuCode, Assert.Single(tu.GetProperty("schemes").EnumerateArray()).GetProperty("code").GetString());

        var badLevel = await client.PutAsJsonAsync($"{Url}/cards", new { financialAssistance = new { activatesAfter = new[] { "Bronze", "ZEDX" } }, technologyUpgradation = new { recommendationRequired = true } });
        Assert.Equal("Financial Assistance opens after Bronze, Silver or Gold only.", await badLevel.ProblemTitle());
        var noScheme = await client.PutAsJsonAsync($"{Url}/cards", new { financialAssistance = new { activatesAfter = new[] { "Silver" } }, technologyUpgradation = new { recommendationRequired = false } });
        Assert.Equal("Choose the scheme Technology Upgradation opens without the recommendation.", await noScheme.ProblemTitle());
        var unknown = await client.PutAsJsonAsync($"{Url}/cards", new { financialAssistance = new { activatesAfter = new[] { "Silver" } }, technologyUpgradation = new { recommendationRequired = false, directSchemeCode = "NOPE" } });
        Assert.Equal("The direct scheme was not found.", await unknown.ProblemTitle());
        Assert.Empty(Calls(SchemeStore.SaveCardSettingsSql));

        var ok = await client.PutAsJsonAsync($"{Url}/cards", new { financialAssistance = new { activatesAfter = new[] { "gold", "Silver" } }, technologyUpgradation = new { recommendationRequired = false, directSchemeCode = "tu_direct" } });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Contains("is off", (await ok.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString());
        var writes = Calls(SchemeStore.SaveCardSettingsSql);
        Assert.Equal(2, writes.Count);
        Assert.Equal(("FINANCIAL_ASSISTANCE", "Silver,Gold"), (FakeSql.Arg(writes[0].Args, "Card"), FakeSql.Arg(writes[0].Args, "ActivatesAfter")));
        Assert.Equal(("TECHNOLOGY_UPGRADATION", "False", "TU_DIRECT"),
            (FakeSql.Arg(writes[1].Args, "Card"), FakeSql.Arg(writes[1].Args, "RecommendationRequired"), FakeSql.Arg(writes[1].Args, "DirectSchemeCode")));

        // No level ticked = all three.
        await client.PutAsJsonAsync($"{Url}/cards", new { financialAssistance = new { activatesAfter = Array.Empty<string>() }, technologyUpgradation = new { recommendationRequired = true } });
        Assert.Equal("Bronze,Silver,Gold", FakeSql.Arg(Calls(SchemeStore.SaveCardSettingsSql)[2].Args, "ActivatesAfter"));
    }

    [Theory]
    [InlineData("MASTER1")]
    [InlineData("AGENCY1")]
    public async Task Only_the_admin_manages_schemes(string user)
    {
        var client = await UsersMastersLogin.SignInAsync(_host, user);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(Url)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PutAsJsonAsync($"{Url}/cards", new { })).StatusCode);
    }

    [Fact]
    public void The_dashboard_cards_list_never_shows_scheme_rows() =>
        Assert.Contains("'SCHEME'", Zed.Portal.Features.Staff.Schemes.IncentiveMasterController.BuiltInSql);
}
