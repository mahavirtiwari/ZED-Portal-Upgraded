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
    public async Task The_first_list_adds_the_built_in_schemes_once_fa_on_and_direct_tu_off()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var body = await client.GetFromJsonAsync<JsonElement>(Url);
        var schemes = body.GetProperty("schemes").EnumerateArray().ToDictionary(s => s.GetProperty("code").GetString()!);
        Assert.Equal([SchemeTemplates.FaCode, SchemeTemplates.DirectTuCode], schemes.Keys.Order());
        var tu = schemes[SchemeTemplates.DirectTuCode];
        Assert.False(tu.GetProperty("active").GetBoolean());
        Assert.Equal("Size", tu.GetProperty("grading").GetProperty("mode").GetString());
        // 2026-11-20: the Financial Assistance card's scheme, switched on (the card opens it).
        Assert.True(schemes[SchemeTemplates.FaCode].GetProperty("active").GetBoolean());
        Assert.Equal(["FA", "TU"], body.GetProperty("templates").EnumerateArray().Select(t => t.GetString()));
        Assert.Contains(body.GetProperty("levels").EnumerateArray(), l => l.GetProperty("code").GetString() == "Bronze");
        Assert.Equal(["Micro", "Small", "Medium"], body.GetProperty("sizes").EnumerateArray().Select(t => t.GetString()));

        await client.GetFromJsonAsync<JsonElement>(Url);
        Assert.Equal(2, Calls(SchemeStore.InsertSql).Count);
        // The built-in codes are not offered to a new scheme.
        Assert.Equal("The code FA is already used.", await (await client.PostAsJsonAsync(Url, new { template = "FA", code = "FA", name = "Other" })).ProblemTitle());
    }

    [Fact]
    public async Task The_list_gives_the_icon_the_rounds_and_whether_the_tu_setting_hides_the_direct_scheme()
    {
        // 2026-11-23 (list design): "On, not shown" for the direct TU scheme while the card needs the recommendation.
        var tu = SchemeTemplates.TechnologyUpgradation() with { Active = true };
        Seed(tu);
        Seed(SchemeTemplates.FinancialAssistance(SchemeTemplates.FaCode) with { Active = true });
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        JsonElement Row(JsonElement body, string code) => body.GetProperty("schemes").EnumerateArray().Single(s => s.GetProperty("code").GetString() == code);

        var body = await client.GetFromJsonAsync<JsonElement>(Url);
        Assert.True(Row(body, SchemeTemplates.DirectTuCode).GetProperty("hiddenByTuSetting").GetBoolean());
        Assert.False(Row(body, SchemeTemplates.FaCode).GetProperty("hiddenByTuSetting").GetBoolean());
        Assert.Equal(tu.Card.Icon, Row(body, SchemeTemplates.DirectTuCode).GetProperty("icon").GetString());
        Assert.Equal(tu.Verification.CorrectionRounds, Row(body, SchemeTemplates.DirectTuCode).GetProperty("correctionRounds").GetInt32());

        // The card opens the direct scheme: units see it.
        _cards[1] = new("TECHNOLOGY_UPGRADATION", null, false, SchemeTemplates.DirectTuCode);
        body = await client.GetFromJsonAsync<JsonElement>(Url);
        Assert.False(Row(body, SchemeTemplates.DirectTuCode).GetProperty("hiddenByTuSetting").GetBoolean());
    }

    [Fact]
    public async Task The_main_dashboard_cards_page_sets_up_the_built_in_schemes_too()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var body = await client.GetFromJsonAsync<JsonElement>($"{Url}/cards");
        Assert.True(_rows.ContainsKey(SchemeTemplates.DirectTuCode));
        Assert.True(_rows.ContainsKey(SchemeTemplates.FaCode));
        // The direct scheme is offered to the Technology Upgradation card; the Financial Assistance scheme is not.
        Assert.Equal(SchemeTemplates.DirectTuCode,
            Assert.Single(body.GetProperty("technologyUpgradation").GetProperty("schemes").EnumerateArray()).GetProperty("code").GetString());
        // Every certification level is offered to the Financial Assistance card.
        Assert.Contains(body.GetProperty("financialAssistance").GetProperty("levels").EnumerateArray(), l => l.GetProperty("code").GetString() == "ZEDX");
    }

    [Fact]
    public async Task A_stored_built_in_scheme_of_an_older_template_is_upgraded_once()
    {
        var old = SchemeTemplates.TechnologyUpgradation() with { TemplateVersion = 0, Name = "TU (ours)", Disclaimer = null };
        var s = old.Form.Sections[0];
        Seed(old with { Form = old.Form with { Sections = [s with { Fields = s.Fields.Select(f => f.Type == "document" ? f with { MaxFiles = 1 } : f).ToList() }] } });
        Seed(SchemeTemplates.FinancialAssistance(SchemeTemplates.FaCode));
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        await client.GetFromJsonAsync<JsonElement>(Url);
        await client.GetFromJsonAsync<JsonElement>(Url);
        var up = SchemeRules.Parse(_rows[SchemeTemplates.DirectTuCode].Json)!;
        Assert.Equal((SchemeTemplates.Version, "TU (ours)", SchemeTemplates.TuDisclaimer), (up.TemplateVersion, up.Name, up.Disclaimer));
        Assert.All(up.Form.Sections[0].Fields.Where(f => f.Type == "document"), f => Assert.Equal(3, f.MaxFiles));
        Assert.Single(Calls(SchemeStore.UpdateSql));
        Assert.Empty(Calls(SchemeStore.InsertSql));
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

        var badLevel = await client.PutAsJsonAsync($"{Url}/cards", new { financialAssistance = new { activatesAfter = new[] { "Bronze", "Platinum" } }, technologyUpgradation = new { recommendationRequired = true } });
        Assert.Equal("Financial Assistance: choose among the certification levels.", await badLevel.ProblemTitle());
        var none = await client.PutAsJsonAsync($"{Url}/cards", new { financialAssistance = new { activatesAfter = Array.Empty<string>() }, technologyUpgradation = new { recommendationRequired = true } });
        Assert.Equal("Financial Assistance: tick at least one level it opens after.", await none.ProblemTitle());
        var noScheme = await client.PutAsJsonAsync($"{Url}/cards", new { financialAssistance = new { activatesAfter = new[] { "Silver" } }, technologyUpgradation = new { recommendationRequired = false } });
        Assert.Equal("Choose the scheme Technology Upgradation opens without the recommendation.", await noScheme.ProblemTitle());
        var unknown = await client.PutAsJsonAsync($"{Url}/cards", new { financialAssistance = new { activatesAfter = new[] { "Silver" } }, technologyUpgradation = new { recommendationRequired = false, directSchemeCode = "NOPE" } });
        Assert.Equal("The direct scheme was not found.", await unknown.ProblemTitle());
        var fa = await client.PutAsJsonAsync($"{Url}/cards", new { financialAssistance = new { activatesAfter = new[] { "Silver" } }, technologyUpgradation = new { recommendationRequired = false, directSchemeCode = "FA" } });
        Assert.Equal("The direct scheme was not found.", await fa.ProblemTitle());
        Assert.Empty(Calls(SchemeStore.SaveCardSettingsSql));

        // Off with the direct scheme switched off: it is switched on with the card, and the message says so.
        var ok = await client.PutAsJsonAsync($"{Url}/cards", new { financialAssistance = new { activatesAfter = new[] { "gold", "Silver" } }, technologyUpgradation = new { recommendationRequired = false, directSchemeCode = "tu_direct" } });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Contains("now switched on", (await ok.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString());
        Assert.True(_rows[SchemeTemplates.DirectTuCode].Active);
        var writes = Calls(SchemeStore.SaveCardSettingsSql);
        Assert.Equal(2, writes.Count);
        Assert.Equal(("FINANCIAL_ASSISTANCE", "Silver,Gold"), (FakeSql.Arg(writes[0].Args, "Card"), FakeSql.Arg(writes[0].Args, "ActivatesAfter")));
        Assert.Equal(("TECHNOLOGY_UPGRADATION", "False", "TU_DIRECT"),
            (FakeSql.Arg(writes[1].Args, "Card"), FakeSql.Arg(writes[1].Args, "RecommendationRequired"), FakeSql.Arg(writes[1].Args, "DirectSchemeCode")));
        // The card's levels are the Financial Assistance scheme's activation.
        Assert.Equal(["Silver", "Gold"], SchemeRules.Parse(_rows[SchemeTemplates.FaCode].Json)!.Activation.Levels);
    }

    [Fact]
    public async Task Financial_assistance_opens_after_any_level_graded_for_each()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        await client.GetFromJsonAsync<JsonElement>($"{Url}/cards");
        var r = await client.PutAsJsonAsync($"{Url}/cards", new { financialAssistance = new { activatesAfter = new[] { "Bronze", "ZEDX" } }, technologyUpgradation = new { recommendationRequired = true } });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Contains("grading added for ZED-X", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString());
        var fa = SchemeRules.Parse(_rows[SchemeTemplates.FaCode].Json)!;
        Assert.Equal(["Bronze", "ZEDX"], fa.Activation.Levels);
        Assert.Contains(fa.Grading.Rows, g => g.Key == "ZEDX" && g.SharePercent == 75 && g.MaxAmount == 50000);
        Assert.Null(SchemeRules.Problem(fa, Zed.Core.Data.LevelRegistry.Codes));

        // Changed in the scheme editor: the levels go back to the card; Registration / Handholding are refused.
        var edited = fa with { Activation = new() { Mode = SchemeRules.Levels, Levels = ["Silver"] }, Grading = fa.Grading with { Rows = [new("All", 75, 50000)] } };
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync($"{Url}/FA", edited, SchemeRules.Json)).StatusCode);
        Assert.Equal("Silver", FakeSql.Arg(Calls(SchemeStore.SaveCardSettingsSql)[^1].Args, "ActivatesAfter"));
        var registration = edited with { Activation = new() { Mode = SchemeRules.Registration } };
        Assert.Equal("Financial Assistance opens after certification levels only.", await (await client.PutAsJsonAsync($"{Url}/FA", registration, SchemeRules.Json)).ProblemTitle());
    }

    [Fact]
    public async Task A_direct_scheme_that_cannot_be_switched_on_is_refused_with_the_reason()
    {
        Seed(SchemesAdminController.Blank("NEW_ONE", "New one"));
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await client.PutAsJsonAsync($"{Url}/cards", new { financialAssistance = new { activatesAfter = new[] { "Bronze" } }, technologyUpgradation = new { recommendationRequired = false, directSchemeCode = "NEW_ONE" } });
        Assert.Contains("cannot be switched on", await r.ProblemTitle());
        Assert.Empty(Calls(SchemeStore.SaveCardSettingsSql));
        Assert.False(_rows["NEW_ONE"].Active);
    }

    [Fact]
    public async Task The_editor_saves_the_scheme_texts_and_the_unique_mark()
    {
        var tu = SchemeTemplates.TechnologyUpgradation();
        Seed(tu);
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var s = tu.Form.Sections[0];
        var edited = tu with
        {
            Disclaimer = "  Our disclaimer\r\nline 2  ", Instructions = " ", Declaration = "We declare.",
            Form = tu.Form with { Sections = [s with { Fields = s.Fields.Select(f => f.Key == "invoice_no" ? f with { Unique = true } : f).ToList() }] },
        };
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync($"{Url}/{tu.Code}", edited, SchemeRules.Json)).StatusCode);
        var saved = SchemeRules.Parse(_rows[tu.Code].Json)!;
        Assert.Equal(("Our disclaimer\nline 2", null, "We declare."), (saved.Disclaimer, saved.Instructions, saved.Declaration));
        Assert.True(saved.Form.Sections[0].Fields.Single(f => f.Key == "invoice_no").Unique);
        // A grading that leaves a level of the activation without a row is refused.
        var gap = tu with { Grading = tu.Grading with { Rows = [new("Micro", 80, 300000)] } };
        Assert.Contains("Small", await (await client.PutAsJsonAsync($"{Url}/{tu.Code}", gap, SchemeRules.Json)).ProblemTitle());
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
