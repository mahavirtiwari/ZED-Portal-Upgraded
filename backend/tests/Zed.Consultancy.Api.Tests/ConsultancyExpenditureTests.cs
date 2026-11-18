using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Staff.Expenditure;

namespace Zed.Consultancy.Api.Tests;

/// <summary>2026-11-18 (expenditure monitoring) on the Consultancy host: consultant organisations, milestones, their POs.</summary>
public sealed class ConsultancyExpenditureTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    private readonly AssessmentStaff _s = new();

    public ConsultancyExpenditureTests()
    {
        _s.Sql.Queries[ExpenditureParties.PartiesSql] = _ =>
            [new { UserId = "CO1", UserName = "Consultant Org", CreatedBy = "MADMIN", IsActive = true }, new { UserId = "CO2", UserName = "Other", CreatedBy = "MADMIN2", IsActive = true }];
        _s.Sql.Queries[ExpenditureParties.MastersSql] = _ => [new { UserId = "MADMIN" }, new { UserId = "MADMIN2" }];
        _s.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = args => FakeSql.Arg(args, "RoleId") == "7"
            ? FakeSql.Sets([new { ZedId = Zed, Certification = "Silver", PUnitName = "Unit 1", CertificationStatus = 6, NcCount = 2 }])
            : FakeSql.Sets([]);
        _s.Sql.Procs["SP_ASSESSMENT_AGENCIES_TO_ALLOT"] = _ => FakeSql.Sets([
            new { UserId = "CO1", UserName = "Consultant Org", SiteVerification = true },
        ]);
    }

    public void Dispose() => _s.Dispose();

    [Fact]
    public async Task Milestone_allotment_stops_when_the_organisations_po_is_used_up()
    {
        _s.Sql.Queries[PoLimits.TotalsSql] = _ => [new { PartyId = "CO1", Level = "Silver", Cases = 6, FirstPo = new DateTime(2026, 4, 1) }];
        _s.Sql.Queries[PoLimits.ConsultancyUsedSql] = _ => [new { PartyId = "CO1", Level = "Silver", Cases = 5 }];
        _s.Sql.Queries[PoLimits.ConsultancyInProgressSql] = _ => [new { PartyId = "CO1", Level = "Silver", Cases = 1 }];
        var client = await _s.SignInAsync("MADMIN", 7);
        var co = (await client.GetFromJsonAsync<JsonElement>($"/api/staff/assessment/allot/agencies?zedId={Zed}&certification=Silver"))[0];
        Assert.True(co.GetProperty("poStopped").GetBoolean());
        var r = await client.PostAsJsonAsync("/api/staff/assessment/allot", new { zedId = Zed, certification = "Silver", agencyUserId = "CO1" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.DoesNotContain(_s.Sql.Calls, c => c.Name == "SP_ASSESSMENT_ALLOT_TO_AGENCY");
        // The milestones are counted on this database, with main's rates.
        Assert.Contains(_s.Sql.Calls, c => c.Name == ExpenditureSweep.MilestoneSql(1));
    }

    [Fact]
    public async Task The_master_admin_sees_its_organisations_milestones()
    {
        _s.Sql.Queries[ExpenditureQueries.MilestoneCountSql] = _ =>
        [
            new { PartyId = "CO1", Level = "Silver", Kind = "Milestone", Cases = 12, Amount = 400000m, Invoiced = 0m },
            new { PartyId = "CO2", Level = "Gold", Kind = "Milestone", Cases = 3, Amount = 1m, Invoiced = 0m },
        ];
        _s.Sql.Queries[ExpenditureRates.MilestoneCountSql] = _ => [new { Level = "Silver", Milestones = 3 }, new { Level = "Gold", Milestones = 2 }];
        var client = await _s.SignInAsync("MADMIN", 7);
        var s = await client.GetFromJsonAsync<ExpenditureController.SummaryResponse>("/api/staff/expenditure/summary", Web);
        Assert.Equal("Consultant", s!.Kind);
        var row = Assert.Single(s.Rows);
        Assert.Equal(("CO1", 12, 400000m, "NoPo"), (row.PartyId, row.Milestones, row.Payable, row.PoState));
        Assert.Equal(["Silver", "Gold", "ZEDX"], s.Levels.Select(l => l.Code));
        // The sweep before the figures counts each level's milestones by the fee master (Gold has 2: its 2nd is the last).
        var m2 = Assert.Single(_s.Sql.Calls, c => c.Name == ExpenditureSweep.MilestoneSql(2));
        Assert.Equal(["Silver", "ZEDX"], (List<string>)m2.Args!.GetType().GetProperty("PaidLevels")!.GetValue(m2.Args)!);
        Assert.Equal(["Gold"], (List<string>)m2.Args!.GetType().GetProperty("LastLevels")!.GetValue(m2.Args)!);
        // The rates screen is main's only.
        Assert.Equal(HttpStatusCode.NotFound, (await (await _s.SignInAsync("ADMIN", 1)).GetAsync("/api/staff/expenditure-rates")).StatusCode);
    }

    [Fact]
    public async Task The_organisation_sees_its_own_milestones_and_gives_its_gstin_and_pan_once_before_invoicing()
    {
        _s.Sql.Queries[ExpenditureQueries.MilestoneCountSql] = _ =>
        [
            new { PartyId = "CO1", Level = "Silver", Kind = "Milestone", Cases = 12, Amount = 400000m, Invoiced = 0m },
            new { PartyId = "CO2", Level = "Gold", Kind = "Milestone", Cases = 3, Amount = 1m, Invoiced = 0m },
        ];
        var submitted = false;
        _s.Sql.Queries[ExpenditureTax.ReadSql] = args => FakeSql.Arg(args, "PartyId") == "CO1" && submitted
            ? [new { UserId = "CO1", TaxGstin = "27AAPFU0939F1ZV", TaxPan = "AAPFU0939F", TaxGstFile = "g", TaxPanFile = "p", TaxSubmittedOn = DateTime.UtcNow, TaxSubmittedBy = "CO1" }]
            : [new { UserId = FakeSql.Arg(args, "PartyId") }];
        var org = await _s.SignInAsync("CO1", 2);

        var s = await org.GetFromJsonAsync<ExpenditureController.SummaryResponse>("/api/staff/expenditure/summary", Web);
        Assert.Equal(("CO1", 12), (Assert.Single(s!.Rows).PartyId, s.Cards.Milestones));
        Assert.Equal(HttpStatusCode.NotFound, (await org.GetAsync("/api/staff/expenditure/cases?partyId=CO2")).StatusCode);
        var mine = await org.GetFromJsonAsync<MyInvoicesController.MyResponse>("/api/staff/expenditure/my", Web);
        Assert.Equal(("Consultant", false), (mine!.Kind, mine.Tax.Submitted));

        var month = DateTime.UtcNow.AddMinutes(330).AddMonths(-1).ToString("yyyy-MM");
        var invoice = new MultipartFormDataContent
        {
            { new StringContent(month), "month" }, { new StringContent("CO/1"), "invoiceNo" }, { new StringContent(month + "-28"), "invoiceDate" },
            { new StringContent("100"), "invoiceAmount" },
        };
        Assert.Equal(MyInvoicesController.TaxFirst, await (await org.PostAsync("/api/staff/expenditure/my/invoices", invoice)).ProblemTitle());

        MultipartFormDataContent Tax()
        {
            var pdf = new ByteArrayContent(System.Text.Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF\n"));
            pdf.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/pdf");
            var jpg = new ByteArrayContent([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46]);
            jpg.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/jpeg");
            return new MultipartFormDataContent
            {
                { new StringContent("27AAPFU0939F1ZV"), "gstin" }, { new StringContent("AAPFU0939F"), "pan" }, { new StringContent("true"), "declaration" },
                { pdf, "gstFile", "gst.pdf" }, { jpg, "panFile", "pan.jpeg" },
            };
        }
        Assert.Equal(HttpStatusCode.OK, (await org.PostAsync("/api/staff/expenditure/my/tax", Tax())).StatusCode);
        var save = Assert.Single(_s.Sql.Calls, c => c.Name == ExpenditureTax.SubmitSql);
        Assert.StartsWith("Uploads/ExpenditureTax/CO1/PanCard_", FakeSql.Arg(save.Args, "PanFile"));
        Assert.EndsWith(".jpg", FakeSql.Arg(save.Args, "PanFile"));
        submitted = true;
        Assert.Equal(HttpStatusCode.Conflict, (await org.PostAsync("/api/staff/expenditure/my/tax", Tax())).StatusCode);
        Assert.Single(_s.Sql.Calls, c => c.Name == ExpenditureTax.SubmitSql);
        // Its master admin reads them; the other organisation does not.
        Assert.Equal("AAPFU0939F", (await (await _s.SignInAsync("MADMIN", 7)).GetFromJsonAsync<ExpenditureTax.View>("/api/staff/expenditure/tax?partyId=CO1", Web))!.Pan);
        Assert.Equal(HttpStatusCode.NotFound, (await (await _s.SignInAsync("CO2", 2)).GetAsync("/api/staff/expenditure/tax?partyId=CO1")).StatusCode);
    }
}
