using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Zed.Portal.Features.Incentives;
using Zed.Portal.Features.Incentives.Applicant;
using static Zed.Portal.Features.Incentives.SchemeEligibility;

namespace Zed.Main.Api.Tests;

/// <summary>
/// 2026-11-20 (incentive schemes, approved design, part B): the applicant's claim windows, the dashboard tiles, the draft, the
/// "Add more" items, the submission (amounts, documents, the staff workflow), the correction round and the FA card's levels.
/// </summary>
public sealed partial class MsmeIncentiveSchemesTests : IDisposable
{
    private const string Me = MsmeSchemesTestSupport.Me;
    private const string Code = "TU_DIRECT";
    private readonly TestHost _host = new();
    private readonly WebApplicationFactory<Program> _app;
    private readonly FakeWorkflow _workflow = new();

    private int _benefits = 1;
    private readonly List<Dictionary<string, object?>> _schemes = [];
    private readonly List<object> _cards = [];
    private readonly List<object> _certs = [];
    private object? _handholding;
    private readonly List<Dictionary<string, object?>> _apps = [];
    private readonly ConcurrentQueue<object?> _submits = new();
    private readonly ConcurrentQueue<object?> _corrections = new();
    private string? _faCurrent = "Silver";
    private int _nextId = 100;
    private int _financial = 1;
    private readonly List<object> _legacyFa = [];
    private readonly List<object> _legacyTu = [];
    private readonly List<object> _archived = [];

    public MsmeIncentiveSchemesTests()
    {
        MsmeSchemesTestSupport.RegisterUsers(_host);
        var sql = _host.Sql;
        sql.Procs["SP_MSME_GET_DETAILS"] = args => MsmeSchemesTestSupport.MsmeDetails(FakeSql.Arg(args, "ZedId")!, _financial, _benefits);
        sql.Procs["SP_FINANCIAL_ASSISTANCE_GET_CURRENT_CERTIFICATE"] = _ => _faCurrent is null ? FakeSql.Sets() : FakeSql.Sets([new { CertificationType = _faCurrent }]);
        sql.Queries["SELECT Id, SchemeCode, SchemeJson"] = _ => { lock (_schemes) return _schemes.Select(s => (object)new Dictionary<string, object?>(s)).ToList(); };
        // The built-in schemes added (or upgraded) on first use land in the same list.
        sql.Procs[SchemeStore.InsertSql] = args =>
        {
            lock (_schemes)
                _schemes.Add(new()
                {
                    ["Id"] = (long)(_schemes.Count + 1), ["SchemeCode"] = FakeSql.Arg(args, "Code"), ["SchemeJson"] = FakeSql.Arg(args, "Json"),
                    ["Active"] = FakeSql.Arg(args, "Active") == "True", ["OrderNo"] = int.Parse(FakeSql.Arg(args, "OrderNo")!),
                });
            return FakeSql.Sets();
        };
        sql.Procs[SchemeStore.UpdateSql] = args =>
        {
            lock (_schemes)
            {
                var row = _schemes.First(s => (string?)s["SchemeCode"] == FakeSql.Arg(args, "Code"));
                row["SchemeJson"] = FakeSql.Arg(args, "Json");
                row["Active"] = FakeSql.Arg(args, "Active") == "True";
            }
            return FakeSql.Sets();
        };
        sql.Queries[SchemeEligibility.LegacyFaSql] = _ => _legacyFa;
        sql.Queries[SchemeEligibility.LegacyTuSql] = _ => _legacyTu;
        sql.Queries[SchemeEligibility.ArchivedSql] = _ => _archived;
        sql.Queries["SELECT DashboardCard AS Card, ActivatesAfter"] = _ => _cards;
        sql.Queries["SELECT TOP 1 M.EnterpriseType"] = _ => [new { EnterpriseType = "Micro", TwoDigitActivity = "24", RegisteredOn = new DateTime(2025, 1, 1) }];
        sql.Queries["SELECT Certification, CAST(CASE"] = _ => _certs;
        sql.Queries["SELECT TOP 1 CAST(Id AS varchar(20)) AS Ref"] = _ => _handholding is null ? [] : [_handholding];
        sql.Queries["SELECT TechnologyCode AS Code"] = args => FakeSql.Arg(args, "Sector") == "24"
            ? [new { Code = "T1", Name = "Solar rooftop", Description = "PV" }, new { Code = "T2", Name = "LED lighting", Description = (string?)null }]
            : [];
        sql.Queries["SELECT Id, ZedId, SchemeCode, SchemeLevel"] = args =>
        {
            lock (_apps)
            {
                var id = FakeSql.Arg(args, "Id");
                var code = FakeSql.Arg(args, "SchemeCode");
                return _apps.Where(a => id is not null ? a["Id"]!.ToString() == id : code is null || (string?)a["SchemeCode"] == code)
                    .OrderByDescending(a => (int)a["Id"]!).Select(a => (object)new Dictionary<string, object?>(a)).ToList();
            }
        };
        sql.Queries["INSERT INTO dbo.FinancialAssistance (ZedId, CertificationType, SchemeCode"] = args =>
        {
            lock (_apps)
            {
                var id = _nextId++;
                _apps.Add(App(id, "Draft", FakeSql.Arg(args, "SchemeLevel"), FakeSql.Arg(args, "SchemeCertNo"), FakeSql.Arg(args, "SchemeCode")));
                return [id];
            }
        };
        sql.Procs[MsmeIncentiveSchemesController.SaveAnswersSql] = args =>
        {
            lock (_apps) Find(int.Parse(FakeSql.Arg(args, "Id")!))["FormAnswers"] = FakeSql.Arg(args, "FormAnswers");
            return FakeSql.Sets();
        };
        sql.Queries[MsmeIncentiveSchemesController.SubmitSql] = args =>
        {
            _submits.Enqueue(args);
            lock (_apps)
            {
                var a = Find(int.Parse(FakeSql.Arg(args, "Id")!));
                if ((string?)a["SchemeStatus"] != "Draft") return [0];
                a["SchemeStatus"] = "Submitted";
                a["FormAnswers"] = FakeSql.Arg(args, "FormAnswers");
                a["ClaimAmount"] = decimal.Parse(FakeSql.Arg(args, "ClaimAmount")!, System.Globalization.CultureInfo.InvariantCulture);
                a["EligibleAmount"] = FakeSql.Arg(args, "EligibleAmount");
                a["SubmittedOn"] = DateTime.Today;
                return [1];
            }
        };
        sql.Queries[MsmeIncentiveSchemesController.CorrectionSql] = args =>
        {
            _corrections.Enqueue(args);
            lock (_apps)
            {
                var a = Find(int.Parse(FakeSql.Arg(args, "Id")!));
                if ((string?)a["SchemeStatus"] != "Correction") return [0];
                a["SchemeStatus"] = "Verifying";
                a["FormAnswers"] = FakeSql.Arg(args, "FormAnswers");
                return [1];
            }
        };
        _app = _host.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddSingleton<ISchemeWorkflow>(_workflow)));
    }

    public void Dispose()
    {
        _app.Dispose();
        _host.Dispose();
    }

    private Dictionary<string, object?> Find(int id) => _apps.First(a => (int)a["Id"]! == id);

    private static Dictionary<string, object?> App(int id, string status, string? level, string? cert, string? code = Code) => new()
    {
        ["Id"] = id, ["ZedId"] = Me, ["SchemeCode"] = code, ["SchemeLevel"] = level, ["SchemeCertNo"] = cert, ["SchemeStatus"] = status,
        ["VerificationStatus"] = status == "Paid" ? 6 : 1, ["FormAnswers"] = null, ["FormChecks"] = null, ["CreatedDate"] = DateTime.Today,
    };

    private void AddScheme(SchemeDefinition d, bool active = true) =>
        _schemes.Add(new() { ["Id"] = (long)(_schemes.Count + 1), ["SchemeCode"] = d.Code, ["SchemeJson"] = SchemeRules.Serialize(d), ["Active"] = active, ["OrderNo"] = _schemes.Count });

    private SchemeDefinition Stored(string code) => SchemeRules.Parse((string)_schemes.Single(s => (string?)s["SchemeCode"] == code)["SchemeJson"]!)!;

    private static object LegacyRow(int id, string level, int? status, DateTime created, string? invoice = null) =>
        new { Id = id, Level = level, VerificationStatus = status, CreatedOn = (DateTime?)created, InvoiceNo = invoice };

    private void Certified(string level, string no, DateTime on, string? phase = null) =>
        _certs.Add(new { Certification = level, CertNo = no, CertifiedOn = on, Phase = phase });

    private async Task<HttpClient> SignInAsync()
    {
        var cookies = new System.Net.CookieContainer();
        var client = _app.CreateDefaultClient(new Xsrf(cookies, _app.Server.BaseAddress));
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = Me, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<JsonElement> Json(HttpResponseMessage r)
    {
        Assert.True(r.IsSuccessStatusCode, $"{(int)r.StatusCode}: {await r.Content.ReadAsStringAsync()}");
        return await r.Content.ReadFromJsonAsync<JsonElement>();
    }

    private async Task<string> UploadAsync(HttpClient client, string section, int item, string field, byte[]? content = null, string code = Code)
    {
        var file = new ByteArrayContent(content ?? MsmeSchemesTestSupport.Pdf);
        file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/pdf");
        var form = new MultipartFormDataContent
        {
            { new StringContent(section), "section" }, { new StringContent(item.ToString()), "item" }, { new StringContent(field), "field" }, { file, "file", "doc.pdf" },
        };
        return (await Json(await client.PostAsync($"/api/msme/incentive-schemes/{code}/documents", form))).GetProperty("fileName").GetString()!;
    }

    private static string Files(params string[] names) => JsonSerializer.Serialize(names);

    private static string Day(int offset) => DateTime.Today.AddDays(offset).ToString("yyyy-MM-dd");

    private sealed record ItemBody(string Pick, Dictionary<string, string?> Values);

    private sealed record SubmitBody(object? Account, string[] Cheque, bool UnitConfirmed, bool Declaration);

    private async Task<ItemBody> TechnologyAsync(HttpClient client, int index, string pick = "T1", decimal amount = 240000m, string? purchased = null) => new(
        pick,
        new Dictionary<string, string?>
        {
            ["manufacturer"] = "Acme Solar", ["model"] = "S-200", ["purchased_on"] = purchased ?? Day(-3), ["supplier"] = "Acme",
            ["invoice_no"] = "INV-" + index, ["invoice_date"] = Day(-3), ["amount_paid"] = amount.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["payment_mode"] = "Online",
            ["technology_picture"] = Files(await UploadAsync(client, "technologies", index, "technology_picture")),
            ["invoice_copy"] = Files(await UploadAsync(client, "technologies", index, "invoice_copy")),
        });

    // ----- claim windows (the rules the tiles and the page use) -----

    private static UnitFacts Unit(IReadOnlyList<Certificate>? certs = null, bool benefits = true, HandholdingRow? hh = null) =>
        new(Me, "Micro", "24", benefits, new DateTime(2025, 1, 1), certs ?? [], [], hh);

    private static Certificate Cert(string level, string no, int rank) => new(level, no, new DateTime(2026, 11, 1), null, rank);

    private static SchemeApplications.Row Row(int id, string status, string level, string cert) =>
        new() { Id = id, SchemeCode = Code, SchemeStatus = status, SchemeLevel = level, SchemeCertNo = cert, VerificationStatus = status == "Paid" ? 6 : 1 };

    [Theory]
    [InlineData("24 - Manufacture of basic metals", "24")]
    [InlineData("24", "24")]
    [InlineData(" 10-Food products", "10")]
    [InlineData("Manufacturing", null)]
    [InlineData(null, null)]
    public void Technologies_are_matched_on_the_sector_code(string? activity, string? code) =>
        // 2026-11-23 (end-to-end run): Masters stores "24-Name", the unit "24 - Name"; the SQL matches ",24-" on the code.
        Assert.Equal(code, Zed.Portal.Features.Incentives.Applicant.MsmeIncentiveSchemesController.SectorCode(activity));

    [Fact]
    public void Windows_follow_the_levels_upgrades_payments_and_recertification()
    {
        var d = SchemeTemplates.TechnologyUpgradation() with { Activation = new() { Mode = SchemeRules.Levels, Levels = ["Bronze", "Silver"] } };

        var s = ApplicantState.Of(d, Unit(certs: [Cert("Bronze", "B-1", 1)]), []);
        Assert.Equal((ApplicantState.Open, "Bronze", "B-1"), (s.State, s.Window!.Level, s.Window.CertRef));
        Assert.Equal(80m, s.Window.Grade!.SharePercent);   // by enterprise size: Micro

        // Paid for Bronze B-1: availed; an upgrade to Silver opens Silver; a re-certification (B-2) opens Bronze again.
        IReadOnlyList<SchemeApplications.Row> paid = [Row(1, "Paid", "Bronze", "B-1")];
        Assert.Equal(ApplicantState.Availed, ApplicantState.Of(d, Unit(certs: [Cert("Bronze", "B-1", 1)]), paid).State);
        var up = ApplicantState.Of(d, Unit(certs: [Cert("Bronze", "B-1", 1), Cert("Silver", "S-1", 2)]), paid);
        Assert.Equal((ApplicantState.Open, "Silver", "S-1"), (up.State, up.Window!.Level, up.Window.CertRef));
        Assert.Equal(ApplicantState.Open, ApplicantState.Of(d, Unit(certs: [Cert("Bronze", "B-2", 1)]), paid).State);

        // Gold (not covered) closes it; with a paid claim it shows availed, without it is locked.
        var gold = ApplicantState.Of(d, Unit(certs: [Cert("Bronze", "B-1", 1), Cert("Gold", "G-1", 3)]), []);
        Assert.Equal((ApplicantState.Locked, "levelNotCovered"), (gold.State, gold.Note));
        Assert.Equal(ApplicantState.Availed, ApplicantState.Of(d, Unit(certs: [Cert("Gold", "G-1", 3)]), paid).State);

        // In progress and on hold; rejected may apply again.
        Assert.Equal(ApplicantState.Progress, ApplicantState.Of(d, Unit(certs: [Cert("Bronze", "B-1", 1)]), [Row(2, "Verifying", "Bronze", "B-1")]).State);
        Assert.Equal(ApplicantState.OnHold, ApplicantState.Of(d, Unit(certs: [Cert("Bronze", "B-1", 1)]), [Row(2, "OnHold", "Bronze", "B-1")]).State);
        Assert.Equal(ApplicantState.Open, ApplicantState.Of(d, Unit(certs: [Cert("Bronze", "B-1", 1)]), [Row(2, "Rejected", "Bronze", "B-1")]).State);
        var draft = ApplicantState.Of(d, Unit(certs: [Cert("Bronze", "B-1", 1)]), [Row(3, "Draft", "Bronze", "B-1")]);
        Assert.Equal((ApplicantState.Open, 3), (draft.State, draft.Application!.Id));

        // No benefits; registration; handholding.
        Assert.Equal("notEligible", ApplicantState.Of(d, Unit(benefits: false, certs: [Cert("Bronze", "B-1", 1)]), []).Note);
        Assert.Equal(ApplicantState.Open, ApplicantState.Of(d with { Activation = new() { Mode = SchemeRules.Registration } }, Unit(), []).State);
        Assert.Equal("handholding", ApplicantState.Of(d with { Activation = new() { Mode = SchemeRules.Handholding } }, Unit(), []).Note);
        var hh = ApplicantState.Of(d with { Activation = new() { Mode = SchemeRules.Handholding } }, Unit(hh: new HandholdingRow("77", new DateTime(2026, 10, 1))), []).Window!;
        Assert.Equal(("Handholding", "77"), (hh.Level, hh.CertRef));
    }

    [Fact]
    public async Task Dashboard_lists_active_schemes_with_their_state_the_direct_tu_scheme_and_the_fa_scheme()
    {
        AddScheme(SchemeTemplates.TechnologyUpgradation());
        AddScheme(SchemeTemplates.FinancialAssistance("GREEN") with { Card = new() { Title = "Green", Icon = "star" } });
        AddScheme(SchemeTemplates.FinancialAssistance("OFF"), active: false);
        _cards.Add(new { Card = "TECHNOLOGY_UPGRADATION", ActivatesAfter = (string?)null, RecommendationRequired = false, DirectSchemeCode = Code });
        _cards.Add(new { Card = "FINANCIAL_ASSISTANCE", ActivatesAfter = "Bronze,Gold", RecommendationRequired = (bool?)null, DirectSchemeCode = (string?)null });
        Certified("Bronze", "B-1", new DateTime(2026, 11, 1));
        _apps.Add(App(7, "Verifying", "Bronze", "B-1", "GREEN"));

        var json = await Json(await (await SignInAsync()).GetAsync("/api/msme/incentive-schemes"));
        var schemes = json.GetProperty("schemes").EnumerateArray().ToList();
        // The two built-in schemes are on their cards, never tiles of their own.
        Assert.Equal(["GREEN"], schemes.Select(s => s.GetProperty("code").GetString()));
        Assert.Equal("progress", schemes[0].GetProperty("state").GetString());
        Assert.Equal(7, schemes[0].GetProperty("applicationId").GetInt32());
        var tu = json.GetProperty("tu");
        Assert.True(tu.GetProperty("direct").GetBoolean());
        Assert.False(tu.GetProperty("legacy").GetBoolean());
        Assert.Equal("open", tu.GetProperty("scheme").GetProperty("state").GetString());
        Assert.Equal("Bronze", tu.GetProperty("scheme").GetProperty("level").GetString());
        Assert.Equal(80, tu.GetProperty("scheme").GetProperty("grade").GetProperty("sharePercent").GetDecimal());
        var fa = json.GetProperty("fa");
        Assert.Equal(("FA", "open", false), (fa.GetProperty("scheme").GetProperty("code").GetString(), fa.GetProperty("scheme").GetProperty("state").GetString(),
            fa.GetProperty("legacy").GetBoolean()));
        Assert.Equal(["Bronze", "Gold"], fa.GetProperty("scheme").GetProperty("activationLevels").EnumerateArray().Select(e => e.GetString()));

        // 2026-11-20: a suspended Silver certificate (higher than the active Bronze) closes the windows.
        Certified("Silver", "S-1", new DateTime(2026, 11, 10), "SUSPENDED");
        json = await Json(await (await SignInAsync()).GetAsync("/api/msme/incentive-schemes"));
        Assert.Equal(("locked", "suspended"), (json.GetProperty("tu").GetProperty("scheme").GetProperty("state").GetString(),
            json.GetProperty("tu").GetProperty("scheme").GetProperty("note").GetString()));
        _certs.RemoveAt(1);

        // Benefits withdrawn: locked with the reason.
        _benefits = 0;
        json = await Json(await (await SignInAsync()).GetAsync("/api/msme/incentive-schemes"));
        Assert.Equal(("locked", "notEligible"), (json.GetProperty("tu").GetProperty("scheme").GetProperty("state").GetString(),
            json.GetProperty("tu").GetProperty("scheme").GetProperty("note").GetString()));
        Assert.Equal("locked", json.GetProperty("fa").GetProperty("scheme").GetProperty("state").GetString());
    }

    // ----- 2026-11-20: Financial Assistance on the framework -----

    private void FaCard(string levels = "Bronze,Silver,Gold") =>
        _cards.Add(new { Card = "FINANCIAL_ASSISTANCE", ActivatesAfter = levels, RecommendationRequired = (bool?)null, DirectSchemeCode = (string?)null });

    [Fact]
    public async Task The_financial_assistance_card_opens_the_built_in_scheme_added_on_first_use()
    {
        FaCard("Bronze,ZEDX");
        Certified("Bronze", "B-1", DateTime.Today.AddDays(-10));
        var client = await SignInAsync();
        var fa = (await Json(await client.GetAsync("/api/msme/incentive-schemes"))).GetProperty("fa");
        Assert.Equal(("FA", "open"), (fa.GetProperty("scheme").GetProperty("code").GetString(), fa.GetProperty("scheme").GetProperty("state").GetString()));

        // Stored once, switched on, opening after the card's levels and graded for each (ZED-X: a copy of the first row).
        await client.GetAsync("/api/msme/incentive-schemes");
        Assert.Single(_schemes, s => (string?)s["SchemeCode"] == SchemeTemplates.FaCode);
        Assert.True((bool)_schemes.Single(s => (string?)s["SchemeCode"] == SchemeTemplates.FaCode)["Active"]!);
        var stored = Stored(SchemeTemplates.FaCode);
        Assert.Equal(["Bronze", "ZEDX"], stored.Activation.Levels);
        Assert.Contains(stored.Grading.Rows, r => r.Key == "ZEDX" && r.SharePercent == 75);
        // The direct TU scheme is added too, switched off.
        Assert.False((bool)_schemes.Single(s => (string?)s["SchemeCode"] == Code)["Active"]!);

        // The page: the FA form with its own texts; the draft is for the Bronze certificate.
        var page = await Json(await client.GetAsync("/api/msme/incentive-schemes/FA"));
        Assert.Equal(SchemeTemplates.FaDisclaimer.Trim(), page.GetProperty("scheme").GetProperty("disclaimer").GetString());
        Assert.Equal(SchemeTemplates.DeclarationText, page.GetProperty("scheme").GetProperty("declaration").GetString());
        page = await Json(await client.PostAsync("/api/msme/incentive-schemes/FA/draft", null));
        Assert.Equal(("Draft", "Bronze"), (page.GetProperty("application").GetProperty("status").GetString(), page.GetProperty("application").GetProperty("level").GetString()));
        Assert.Equal("B-1", _apps.Single()["SchemeCertNo"]);
    }

    [Fact]
    public async Task A_legacy_financial_assistance_in_progress_finishes_on_the_old_page()
    {
        FaCard();
        Certified("Silver", "S-1", DateTime.Today.AddDays(-10));
        // Made on the old page for Bronze, still with the agency.
        _legacyFa.Add(LegacyRow(9, "Bronze", 2, DateTime.Today.AddDays(-40)));
        var client = await SignInAsync();
        var fa = (await Json(await client.GetAsync("/api/msme/incentive-schemes"))).GetProperty("fa");
        Assert.True(fa.GetProperty("legacy").GetBoolean());
        Assert.Equal(("locked", "legacyInProgress"), (fa.GetProperty("scheme").GetProperty("state").GetString(), fa.GetProperty("scheme").GetProperty("note").GetString()));
        var r = await client.PostAsync("/api/msme/incentive-schemes/FA/draft", null);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("earlier application", await r.ProblemTitle());

        // Rejected (no longer read): the framework opens for Silver.
        _legacyFa.Clear();
        fa = (await Json(await client.GetAsync("/api/msme/incentive-schemes"))).GetProperty("fa");
        Assert.Equal(("open", false), (fa.GetProperty("scheme").GetProperty("state").GetString(), fa.GetProperty("legacy").GetBoolean()));
    }

    [Fact]
    public async Task A_legacy_financial_assistance_paid_is_the_claim_of_its_level_and_certificate()
    {
        FaCard();
        Certified("Bronze", "B-1", new DateTime(2026, 1, 10));
        _legacyFa.Add(LegacyRow(9, "Bronze", 6, new DateTime(2026, 2, 1), "INV-OLD"));
        var client = await SignInAsync();
        async Task<string?> StateAsync() => (await Json(await client.GetAsync("/api/msme/incentive-schemes"))).GetProperty("fa").GetProperty("scheme").GetProperty("state").GetString();
        Assert.Equal("availed", await StateAsync());

        // An upgrade opens the next level.
        Certified("Silver", "S-1", new DateTime(2026, 6, 1));
        Assert.Equal("open", await StateAsync());

        // A re-certification of Bronze (the earlier certificate kept under {ZedId}_R_{Id}, a new number) opens Bronze again.
        _certs.Clear();
        Certified("Bronze", "B-2", new DateTime(2026, 9, 1));
        _archived.Add(new { Certification = "Bronze", CertNo = "B-1", CertifiedOn = (DateTime?)new DateTime(2026, 1, 10), Phase = "EXPIRED" });
        Assert.Equal("open", await StateAsync());

        // The legacy invoice number cannot be claimed again (unique field).
        await Json(await client.PostAsync("/api/msme/incentive-schemes/FA/draft", null));
        var invoices = new[] { await UploadAsync(client, "expenditure", 0, "invoice_copy", code: "FA"), await UploadAsync(client, "expenditure", 0, "invoice_copy", code: "FA") };
        var values = new Dictionary<string, string?>
        {
            ["invoice_no"] = "inv-old", ["invoice_date"] = Day(-3), ["amount_paid"] = "40000", ["payment_mode"] = "Online", ["invoice_copy"] = Files(invoices),
        };
        var r = await client.PutAsJsonAsync("/api/msme/incentive-schemes/FA/sections/expenditure", new { values });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("earlier Financial Assistance application", await r.ProblemTitle());
        // Another value is accepted; two invoice copies satisfy the "at least 2 files" rule without the optional CA certificate.
        values["invoice_no"] = "INV-NEW";
        await Json(await client.PutAsJsonAsync("/api/msme/incentive-schemes/FA/sections/expenditure", new { values }));
    }

    [Fact]
    public async Task A_document_takes_up_to_three_files_and_a_unique_value_is_not_reused_across_applications()
    {
        FaCard();
        Certified("Silver", "S-1", DateTime.Today.AddDays(-10));
        // A paid framework claim of an earlier certificate used INV-9.
        var paid = App(50, "Paid", "Bronze", "B-0", SchemeTemplates.FaCode);
        paid["FormAnswers"] = new FormAnswers { Sections = new() { ["expenditure"] = [new FormItem { Values = new() { ["invoice_no"] = "INV-9" } }] } }.Serialize();
        _apps.Add(paid);
        var client = await SignInAsync();
        await Json(await client.PostAsync("/api/msme/incentive-schemes/FA/draft", null));
        var files = new List<string>();
        for (var i = 0; i < 4; i++) files.Add(await UploadAsync(client, "expenditure", 0, "invoice_copy", code: "FA"));
        var values = new Dictionary<string, string?>
        {
            ["invoice_no"] = "INV-1", ["invoice_date"] = Day(-3), ["amount_paid"] = "40000", ["payment_mode"] = "Online", ["invoice_copy"] = Files([.. files]),
        };
        var url = "/api/msme/incentive-schemes/FA/sections/expenditure";
        Assert.Equal("\"Copy of Invoice\": up to 3 file(s).", await (await client.PutAsJsonAsync(url, new { values })).ProblemTitle());
        values["invoice_copy"] = Files([.. files.Take(3)]);
        values["invoice_no"] = "inv-9";
        Assert.Contains("application no. 50", await (await client.PutAsJsonAsync(url, new { values })).ProblemTitle());
        values["invoice_no"] = "INV-1";
        var page = await Json(await client.PutAsJsonAsync(url, new { values }));
        Assert.Equal(3, JsonSerializer.Deserialize<string[]>(page.GetProperty("application").GetProperty("answers").GetProperty("sections")
            .GetProperty("expenditure")[0].GetProperty("values").GetProperty("invoice_copy").GetString()!)!.Length);
    }

    [Fact]
    public async Task A_unit_blocked_for_financial_assistance_cannot_apply_to_any_scheme()
    {
        DirectTu();
        _financial = 0;
        var client = await SignInAsync();
        var tu = (await Json(await client.GetAsync("/api/msme/incentive-schemes"))).GetProperty("tu").GetProperty("scheme");
        Assert.Equal(("locked", "financialBlocked"), (tu.GetProperty("state").GetString(), tu.GetProperty("note").GetString()));
        var r = await client.PostAsync($"/api/msme/incentive-schemes/{Code}/draft", null);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(ApplicantState.LockedMessage("financialBlocked", new()), await r.ProblemTitle());
    }

    [Fact]
    public async Task A_window_without_a_grade_cannot_be_applied_for()
    {
        // Stored before the coverage check: graded for small enterprises only; the unit is micro.
        var tu = SchemeTemplates.TechnologyUpgradation();
        AddScheme(tu with { Grading = tu.Grading with { Rows = [new("Small", 60, 300000)] } });
        _cards.Add(new { Card = "TECHNOLOGY_UPGRADATION", ActivatesAfter = (string?)null, RecommendationRequired = false, DirectSchemeCode = Code });
        Certified("Bronze", "B-1", DateTime.Today.AddDays(-10));
        var client = await SignInAsync();
        var page = await Json(await client.GetAsync($"/api/msme/incentive-schemes/{Code}"));
        Assert.Equal(("locked", "notGraded", false), (page.GetProperty("state").GetString(), page.GetProperty("note").GetString(), page.GetProperty("canApply").GetBoolean()));
        var r = await client.PostAsync($"/api/msme/incentive-schemes/{Code}/draft", null);
        Assert.Contains("not yet set up", await r.ProblemTitle());
        Assert.Empty(_apps);
    }

    [Fact]
    public async Task On_hold_the_applicant_sees_a_friendly_reason_and_each_scheme_its_own_texts()
    {
        DirectTu();
        var app = App(30, "OnHold", "Bronze", "B-1");
        app["HoldReason"] = "Certificate B-1 SUSPENDED (was Verifying)";
        _apps.Add(app);
        var page = await Json(await (await SignInAsync()).GetAsync($"/api/msme/incentive-schemes/{Code}"));
        var a = page.GetProperty("application");
        Assert.Equal("suspended", a.GetProperty("holdKind").GetString());
        Assert.Equal("Your certificate is suspended; the ZED team will resume or close the application.", a.GetProperty("holdReason").GetString());
        Assert.DoesNotContain("was Verifying", page.GetRawText());
        Assert.Contains("suspended", page.GetProperty("message").GetString());
        Assert.Equal("withdrawn", ApplicantState.HoldKind("Certificate B-1 WITHDRAWN (was Qc)", "OnHold"));
        Assert.Null(ApplicantState.HoldKind("x", "Verifying"));
        // The TU template's texts, not the FA ones; empty texts fall back to the global wording (null).
        Assert.Contains("technolog", page.GetProperty("scheme").GetProperty("disclaimer").GetString());
        _schemes.Clear();
        AddScheme(SchemeTemplates.TechnologyUpgradation() with { Disclaimer = " ", Instructions = null });
        page = await Json(await (await SignInAsync()).GetAsync($"/api/msme/incentive-schemes/{Code}"));
        Assert.Equal(JsonValueKind.Null, page.GetProperty("scheme").GetProperty("disclaimer").ValueKind);
        Assert.Equal(JsonValueKind.Null, page.GetProperty("scheme").GetProperty("instructions").ValueKind);
    }

    // ----- 2026-11-20: the Technology Upgradation card's toggle switches cleanly -----

    [Fact]
    public async Task Toggle_off_a_legacy_tu_in_progress_continues_and_blocks_the_direct_scheme()
    {
        DirectTu();
        _legacyTu.Add(LegacyRow(4, "Silver", null, DateTime.Today.AddDays(-2)));   // a draft on the old page
        var client = await SignInAsync();
        var tu = (await Json(await client.GetAsync("/api/msme/incentive-schemes"))).GetProperty("tu");
        Assert.True(tu.GetProperty("legacy").GetBoolean());
        Assert.Equal("legacyInProgress", tu.GetProperty("scheme").GetProperty("note").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync($"/api/msme/incentive-schemes/{Code}/draft", null)).StatusCode);
        // The old page lets it continue; without it, the old page refuses a new application.
        _host.Sql.Procs["SP_MSME_GET_DETAILS"] = args => FakeSql.Arg(args, "CertificationType") == "Techupgrade"
            ? FakeSql.Sets([], [], [], [], [])
            : MsmeSchemesTestSupport.MsmeDetails(Me, 1, 1);
        var legacy = await Json(await client.GetAsync("/api/msme/schemes/tu"));
        Assert.NotEqual(Zed.Portal.Features.Msme.Schemes.MsmeTechnologyUpgradationController.NewApplicationsMessage, legacy.GetProperty("message").GetString());
        _legacyTu.Clear();
        legacy = await Json(await client.GetAsync("/api/msme/schemes/tu"));
        Assert.Equal(Zed.Portal.Features.Msme.Schemes.MsmeTechnologyUpgradationController.NewApplicationsMessage, legacy.GetProperty("message").GetString());

        // A legacy TU paid for the same certificate is the TU claim.
        _legacyTu.Add(LegacyRow(4, "Bronze", 6, DateTime.Today.AddDays(-2)));
        tu = (await Json(await client.GetAsync("/api/msme/incentive-schemes"))).GetProperty("tu");
        Assert.Equal(("availed", false), (tu.GetProperty("scheme").GetProperty("state").GetString(), tu.GetProperty("legacy").GetBoolean()));
    }

    [Fact]
    public async Task Toggle_on_a_direct_application_not_final_still_shows_and_blocks_the_old_page()
    {
        AddScheme(SchemeTemplates.TechnologyUpgradation());
        _cards.Add(new { Card = "TECHNOLOGY_UPGRADATION", ActivatesAfter = (string?)null, RecommendationRequired = true, DirectSchemeCode = Code });
        Certified("Bronze", "B-1", DateTime.Today.AddDays(-10));
        var client = await SignInAsync();
        var tu = (await Json(await client.GetAsync("/api/msme/incentive-schemes"))).GetProperty("tu");
        Assert.Equal((false, JsonValueKind.Null), (tu.GetProperty("direct").GetBoolean(), tu.GetProperty("scheme").ValueKind));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/msme/incentive-schemes/{Code}")).StatusCode);

        _apps.Add(App(60, "Verifying", "Bronze", "B-1"));
        tu = (await Json(await client.GetAsync("/api/msme/incentive-schemes"))).GetProperty("tu");
        Assert.Equal(("progress", 60), (tu.GetProperty("scheme").GetProperty("state").GetString(), tu.GetProperty("scheme").GetProperty("applicationId").GetInt32()));
        await Json(await client.GetAsync($"/api/msme/incentive-schemes/{Code}"));
        // No double claim: the old page refuses while it is in progress.
        var legacy = await Json(await client.GetAsync("/api/msme/schemes/tu"));
        Assert.Equal(Zed.Portal.Features.Msme.Schemes.MsmeTechnologyUpgradationController.DirectInProgressMessage, legacy.GetProperty("message").GetString());

        // Rejected: no tile, and no new direct draft while the card needs the recommendation.
        _apps[0]["SchemeStatus"] = "Rejected";
        tu = (await Json(await client.GetAsync("/api/msme/incentive-schemes"))).GetProperty("tu");
        Assert.Equal(JsonValueKind.Null, tu.GetProperty("scheme").ValueKind);
        var r = await client.PostAsync($"/api/msme/incentive-schemes/{Code}/draft", null);
        Assert.Equal("This scheme is not taking new applications now.", await r.ProblemTitle());
    }

    // ----- draft, items, submission -----

    private void DirectTu()
    {
        AddScheme(SchemeTemplates.TechnologyUpgradation());
        _cards.Add(new { Card = "TECHNOLOGY_UPGRADATION", ActivatesAfter = (string?)null, RecommendationRequired = false, DirectSchemeCode = Code });
        Certified("Bronze", "B-1", DateTime.Today.AddDays(-10));
    }

    [Fact]
    public async Task One_draft_at_a_time_and_only_while_the_window_is_open()
    {
        DirectTu();
        var client = await SignInAsync();
        var page = await Json(await client.GetAsync($"/api/msme/incentive-schemes/{Code}"));
        Assert.True(page.GetProperty("canApply").GetBoolean());
        Assert.Equal(JsonValueKind.Null, page.GetProperty("application").ValueKind);
        Assert.Equal(["T1", "T2"], page.GetProperty("picks").GetProperty("technologies").EnumerateArray().Select(p => p.GetProperty("code").GetString()));

        page = await Json(await client.PostAsync($"/api/msme/incentive-schemes/{Code}/draft", null));
        Assert.Equal("Draft", page.GetProperty("application").GetProperty("status").GetString());
        await Json(await client.PostAsync($"/api/msme/incentive-schemes/{Code}/draft", null));
        Assert.Single(_apps);

        // An application in progress: no new draft.
        _apps[0]["SchemeStatus"] = "Verifying";
        var r = await client.PostAsync($"/api/msme/incentive-schemes/{Code}/draft", null);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal("An application for this scheme is already in progress.", await r.ProblemTitle());

        // Rejected: a new draft (apply again).
        _apps[0]["SchemeStatus"] = "Rejected";
        await Json(await client.PostAsync($"/api/msme/incentive-schemes/{Code}/draft", null));
        Assert.Equal(2, _apps.Count);

        // Not eligible.
        _apps.Clear();
        _benefits = 0;
        r = await client.PostAsync($"/api/msme/incentive-schemes/{Code}/draft", null);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("not eligible", await r.ProblemTitle());
    }

    [Fact]
    public async Task An_item_is_checked_as_a_whole()
    {
        DirectTu();
        var client = await SignInAsync();
        await Json(await client.PostAsync($"/api/msme/incentive-schemes/{Code}/draft", null));
        var url = $"/api/msme/incentive-schemes/{Code}/sections/technologies/items/";

        // A purchase before the certification (the window opened 10 days ago).
        var r = await client.PutAsJsonAsync(url + 0, await TechnologyAsync(client, 0, purchased: Day(-30)));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("Date of Purchase", await r.ProblemTitle());

        // A required document missing.
        var values = new Dictionary<string, string?>((await TechnologyAsync(client, 0)).Values) { ["invoice_copy"] = null };
        r = await client.PutAsJsonAsync(url + 0, new { pick = "T1", values });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal("Please fill in \"Copy of Invoice\".", await r.ProblemTitle());

        // A technology not of the unit's sector.
        r = await client.PutAsJsonAsync(url + 0, await TechnologyAsync(client, 0, pick: "T9"));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);

        var page = await Json(await client.PutAsJsonAsync(url + 0, await TechnologyAsync(client, 0)));
        var saved = page.GetProperty("application").GetProperty("answers").GetProperty("sections").GetProperty("technologies")[0];
        Assert.True(saved.GetProperty("saved").GetBoolean());
        Assert.Equal("Solar rooftop", saved.GetProperty("pickName").GetString());
        Assert.Equal(240000, page.GetProperty("application").GetProperty("claimAmount").GetDecimal());
        Assert.Equal(192000, page.GetProperty("application").GetProperty("eligibleAmount").GetDecimal());

        // The same technology twice.
        r = await client.PutAsJsonAsync(url + 1, await TechnologyAsync(client, 1));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("already added", await r.ProblemTitle());

        // Add more, then remove it.
        page = await Json(await client.PutAsJsonAsync(url + 1, await TechnologyAsync(client, 1, pick: "T2", amount: 60000)));
        Assert.Equal(2, page.GetProperty("application").GetProperty("answers").GetProperty("sections").GetProperty("technologies").GetArrayLength());
        page = await Json(await client.DeleteAsync(url + 1));
        Assert.Equal(1, page.GetProperty("application").GetProperty("answers").GetProperty("sections").GetProperty("technologies").GetArrayLength());

        // Someone else's or an unknown file name is refused.
        r = await client.PutAsJsonAsync(url + 1, new { pick = "T2", values = new Dictionary<string, string?>(values) { ["invoice_copy"] = Files("20260101000000000abcdef01.pdf") } });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    private async Task<SubmitBody> SubmitBodyAsync(HttpClient client) => new(
        new { accountNo = "123456789012", confirmAccountNo = "123456789012", ifscCode = "sbin0001234", branchAddress = "MG Road", bankName = "SBI" },
        [await UploadAsync(client, "_bank", 0, "cheque")], true, true);

    [Fact]
    public async Task Submit_computes_the_claim_and_the_eligible_amount_records_the_documents_and_calls_the_workflow()
    {
        DirectTu();
        var client = await SignInAsync();
        await Json(await client.PostAsync($"/api/msme/incentive-schemes/{Code}/draft", null));
        var url = $"/api/msme/incentive-schemes/{Code}/sections/technologies/items/";

        // Nothing added yet.
        var r = await client.PostAsJsonAsync($"/api/msme/incentive-schemes/{Code}/submit", await SubmitBodyAsync(client));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("at least 1", await r.ProblemTitle());

        await Json(await client.PutAsJsonAsync(url + 0, await TechnologyAsync(client, 0, amount: 300000.75m)));
        await Json(await client.PutAsJsonAsync(url + 1, await TechnologyAsync(client, 1, pick: "T2", amount: 200000)));

        // The declaration and the bank account are required.
        var body = await SubmitBodyAsync(client);
        r = await client.PostAsJsonAsync($"/api/msme/incentive-schemes/{Code}/submit", body with { Declaration = false });
        Assert.Equal("Please accept the declaration.", await r.ProblemTitle());
        r = await client.PostAsJsonAsync($"/api/msme/incentive-schemes/{Code}/submit", body with { Account = new { accountNo = "12" } });
        Assert.Contains("account number", await r.ProblemTitle());

        _workflow.Fail = true;   // a workflow failure never undoes the submission
        var page = await Json(await client.PostAsJsonAsync($"/api/msme/incentive-schemes/{Code}/submit", body));
        Assert.Equal("Submitted", page.GetProperty("application").GetProperty("status").GetString());
        Assert.Equal("progress", page.GetProperty("state").GetString());

        var args = Assert.Single(_submits);
        Assert.Equal("500000.75", FakeSql.Arg(args, "ClaimAmount"));
        // Micro: 80 % of 5,00,000 (whole rupees) = 4,00,000, capped at 3,00,000.
        Assert.Equal("300000", FakeSql.Arg(args, "EligibleAmount"));
        Assert.Equal("Bronze", FakeSql.Arg(args, "SchemeLevel"));
        Assert.Equal("B-1", FakeSql.Arg(args, "SchemeCertNo"));
        Assert.Equal("SBIN0001234", FakeSql.Arg(args, "IfscCode"));
        var docs = JsonDocument.Parse(FakeSql.Arg(args, "Documents")!).RootElement.EnumerateArray().Select(d => d.GetProperty("name").GetString()).ToList();
        Assert.Equal(["technologies/0/technology_picture", "technologies/0/invoice_copy", "technologies/1/technology_picture", "technologies/1/invoice_copy", "_bank/0/cheque"], docs);
        Assert.Equal(new[] { (int)_apps[0]["Id"]! }, _workflow.Submitted.ToArray());

        // Submitted: no second submission, no change.
        r = await client.PostAsJsonAsync($"/api/msme/incentive-schemes/{Code}/submit", body);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        r = await client.PutAsJsonAsync(url + 0, new ItemBody("T1", new()));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task During_a_correction_only_the_answers_found_not_valid_change_until_the_due_date()
    {
        DirectTu();
        var client = await SignInAsync();
        await Json(await client.PostAsync($"/api/msme/incentive-schemes/{Code}/draft", null));
        var url = $"/api/msme/incentive-schemes/{Code}/sections/technologies/items/";
        await Json(await client.PutAsJsonAsync(url + 0, await TechnologyAsync(client, 0, amount: 100000)));
        await Json(await client.PostAsJsonAsync($"/api/msme/incentive-schemes/{Code}/submit", await SubmitBodyAsync(client)));

        var app = _apps[0];
        app["SchemeStatus"] = "Correction";
        app["CorrectionRound"] = 1;
        app["CorrectionDueOn"] = DateTime.Today.AddDays(5);
        app["FormChecks"] = FieldCheck.Serialize(new()
        {
            ["technologies/0/amount_paid"] = new("No", "The invoice says 90,000.", 1, "DA1", DateTime.Today),
            ["technologies/0/manufacturer"] = new("Yes", null, 1, "DA1", DateTime.Today),
        });

        var page = await Json(await client.GetAsync($"/api/msme/incentive-schemes/{Code}"));
        var checks = page.GetProperty("application").GetProperty("checks").EnumerateArray().ToList();
        Assert.Equal(("technologies/0/amount_paid", "The invoice says 90,000."), (checks.Single().GetProperty("path").GetString(), checks[0].GetProperty("remarks").GetString()));
        Assert.True(page.GetProperty("application").GetProperty("correctionOpen").GetBoolean());

        // The amount changes; the manufacturer (valid) stays as submitted.
        var values = page.GetProperty("application").GetProperty("answers").GetProperty("sections").GetProperty("technologies")[0].GetProperty("values")
            .EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetString());
        values["amount_paid"] = "90000";
        values["manufacturer"] = "Changed";
        page = await Json(await client.PutAsJsonAsync(url + 0, new ItemBody("T2", values)));
        var saved = page.GetProperty("application").GetProperty("answers").GetProperty("sections").GetProperty("technologies")[0].GetProperty("values");
        Assert.Equal(("90000", "Acme Solar"), (saved.GetProperty("amount_paid").GetString(), saved.GetProperty("manufacturer").GetString()));

        // A document that was found valid cannot be uploaded again; nothing can be removed.
        var file = new ByteArrayContent(MsmeSchemesTestSupport.Pdf);
        var r = await client.PostAsync($"/api/msme/incentive-schemes/{Code}/documents", new MultipartFormDataContent
        {
            { new StringContent("technologies"), "section" }, { new StringContent("0"), "item" }, { new StringContent("invoice_copy"), "field" }, { file, "file", "x.pdf" },
        });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.DeleteAsync(url + 0)).StatusCode);

        page = await Json(await client.PostAsJsonAsync($"/api/msme/incentive-schemes/{Code}/correction", new { }));
        Assert.Equal("Verifying", page.GetProperty("application").GetProperty("status").GetString());
        Assert.Single(_corrections);
        Assert.Equal(new[] { (int)app["Id"]! }, _workflow.Corrected.ToArray());

        // Past the due date: refused.
        app["SchemeStatus"] = "Correction";
        app["CorrectionDueOn"] = DateTime.Today.AddDays(-1);
        r = await client.PostAsJsonAsync($"/api/msme/incentive-schemes/{Code}/correction", new { });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("were due by", await r.ProblemTitle());
        Assert.Single(_corrections);
    }

    // ----- the Financial Assistance card's levels -----

    [Fact]
    public async Task The_old_financial_assistance_page_takes_no_new_application_and_points_to_the_card()
    {
        _host.Sql.Procs["SP_FINANCIAL_ASSISTANCE_GET_DETAILS"] = _ => FakeSql.Sets([], [], [], [], [], [], [], [], []);
        FaCard("Silver,Gold");
        var client = await SignInAsync();
        var page = await Json(await client.GetAsync("/api/msme/schemes/fa"));
        Assert.False(page.GetProperty("canApply").GetBoolean());
        Assert.Equal(Zed.Portal.Features.Msme.Schemes.MsmeFinancialAssistanceController.NewApplicationsMessage, page.GetProperty("message").GetString());
        var r = await client.PostAsJsonAsync("/api/msme/schemes/fa", new { declaration = true });
        Assert.Equal(Zed.Portal.Features.Msme.Schemes.MsmeFinancialAssistanceController.NewApplicationsMessage, await r.ProblemTitle());
        Assert.Empty(MsmeSchemesTestSupport.CallsTo(_host, "SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE"));
    }

    private sealed class FakeWorkflow : ISchemeWorkflow
    {
        public ConcurrentQueue<int> Submitted { get; } = new();
        public ConcurrentQueue<int> Corrected { get; } = new();
        public bool Fail { get; set; }

        public Task AfterSubmitAsync(int id, CancellationToken ct)
        {
            Submitted.Enqueue(id);
            return Fail ? throw new InvalidOperationException("mail server down") : Task.CompletedTask;
        }

        public Task AfterCorrectionAsync(int id, CancellationToken ct)
        {
            Corrected.Enqueue(id);
            return Task.CompletedTask;
        }
    }

    private sealed class Xsrf(System.Net.CookieContainer cookies, Uri baseAddress) : DelegatingHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var uri = request.RequestUri!.IsAbsoluteUri ? request.RequestUri : new Uri(baseAddress, request.RequestUri);
            var header = cookies.GetCookieHeader(uri);
            if (header.Length > 0) request.Headers.Add("Cookie", header);
            if (request.Method != HttpMethod.Get && cookies.GetCookies(uri)["XSRF-TOKEN"] is { } xsrf)
                request.Headers.Add("X-XSRF-TOKEN", Uri.UnescapeDataString(xsrf.Value));
            var response = await base.SendAsync(request, ct);
            if (response.Headers.TryGetValues("Set-Cookie", out var set))
                foreach (var c in set) cookies.SetCookies(uri, c);
            return response;
        }
    }
}
