using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Staff.Expenditure;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>2026-11-18 (approved design "Expenditure monitoring"): rates, purchase orders, the allotment stop, figures, invoices.</summary>
public sealed class ExpenditureTests : IDisposable
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    private static readonly Dictionary<string, int> Users = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ADMIN1"] = 1, ["AGENCY1"] = 2, ["AGENCY2"] = 2, ["MASTER1"] = 7, ["MASTER2"] = 7,
    };

    private readonly TestHost _host = new();
    private int _lockedCases;

    public ExpenditureTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args =>
        {
            var id = FakeSql.Arg(args, "UserId") ?? "";
            return Users.TryGetValue(id, out var role)
                ? FakeSql.Sets([new { UserId = id.ToUpperInvariant(), UserName = id + " name", RoleId = role, Email = id.ToLowerInvariant() + "@zed.test" }], [new { ERRORMSG = "SUCCESS" }])
                : FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
        };
        _host.Sql.Procs["SP_GET_SUB_ROLE"] = _ => FakeSql.Sets([new { DesktopVerification = 1, SiteVerification = 1, FinancialVerification = 1 }]);
        // AGENCY1 was created by MASTER1, AGENCY2 by MASTER2.
        _host.Sql.Queries[ExpenditureParties.PartiesSql] = _ =>
        [
            new { UserId = "AGENCY1", UserName = "Mahavir Agency", CreatedBy = "MASTER1", IsActive = true },
            new { UserId = "AGENCY2", UserName = "Other Agency", CreatedBy = "MASTER2", IsActive = true },
        ];
        _host.Sql.Queries[ExpenditureParties.MastersSql] = _ => [new { UserId = "MASTER1" }, new { UserId = "MASTER2" }];
        foreach (var sql in ExpenditureRates.LockSql(Expenditure.Agency)) _host.Sql.Queries[sql] = _ => [new { Cases = _lockedCases }];
    }

    public void Dispose() => _host.Dispose();

    private Task<HttpClient> SignIn(string user) => UsersMastersLogin.SignInAsync(_host, user);

    // ------------------------------------------------------------------ rules

    [Fact]
    public void A_case_counts_once_the_last_step_of_its_flow_is_done()
    {
        // Completed: certified (6 / 16); rejected only with the assessor of the flow's last step on the record.
        Assert.Contains("C.CertificationStatus IN (6, 16)", ExpenditureSweep.MainSql);
        Assert.Contains("C.CertificationStatus = 99 AND (CASE WHEN C.Certification IN @DesktopLevels THEN C.DesktopAssessorId ELSE C.SiteAssessorId END) IS NOT NULL",
            ExpenditureSweep.MainSql);
        Assert.Contains("WHERE C.ExpCountedOn IS NULL", ExpenditureSweep.MainSql);
        // The rate in force on the date it counted (current rows of the sets only).
        Assert.Contains("R.SupersededOn IS NULL", ExpenditureSweep.MainSql);
        Assert.Contains("R.EffectiveFrom <= CAST(ISNULL(C.CertificationStatusDate, GETDATE()) AS date) ORDER BY R.EffectiveFrom DESC", ExpenditureSweep.MainSql);
        Assert.Contains("ZED_SURVEILLANCE.dbo.MsmeCertifications", ExpenditureSweep.SurveillanceSql);
        Assert.Contains("'Surveillance'", ExpenditureSweep.SurveillanceSql);
        // A milestone (the user, 2026-11-18): milestone k counts when the MSME's payment of k+1 succeeds (its first payment
        // record, whatever the payment type); the level's last milestone when the unit is certified at the level on main.
        var m2 = ExpenditureSweep.MilestoneSql(2);
        Assert.Contains("WHEN C.Certification IN @PaidLevels THEN (SELECT MIN(P.CreatedDate) FROM dbo.MsmePaymentInfo P", m2);
        Assert.Contains("P.MileStoneNum = '3'", m2);
        Assert.DoesNotContain("PaymentType", m2);
        Assert.Contains("WHEN C.Certification IN @LastLevels THEN", m2);
        Assert.Contains("FROM ZEDCS_V2_LIVE.dbo.MsmeCertifications M WHERE M.ZedId = C.ZedId AND M.Certification = C.Certification", m2);
        Assert.Contains("M.CertificationStatus = 16 OR (M.CertificationStatus = 6", m2);
        // ... not an older certificate (before milestone 1 was paid), and not before the last milestone itself was paid.
        Assert.Contains(">= ISNULL((SELECT MIN(P.CreatedDate) FROM dbo.MsmePaymentInfo P WHERE P.ZedId = C.ZedId AND P.Certification = C.Certification AND P.MileStoneNum = '1')", m2);
        Assert.Contains("WHEN X.PaidOn > X.CertifiedOn THEN X.PaidOn", m2);
        Assert.Contains("C.NcCount >= 2 AND D.CountedOn IS NOT NULL", m2);
        Assert.DoesNotContain("CertificationStatus = 100", m2);
        Assert.Contains("ZEDCS_V2_LIVE.dbo.ExpenditureRates", m2);
        Assert.Contains("R.EffectiveFrom <= CAST(D.CountedOn AS date)", m2);
        Assert.Contains("ExpM2Rate", m2);
        // Silver 3 milestones, Gold 2, ZED-X 1: milestone 2 is paid-counted for Silver, the last for Gold, none for ZED-X.
        var levels = new Dictionary<string, int> { ["Silver"] = 3, ["Gold"] = 2, ["ZEDX"] = 1 };
        var args = ExpenditureSweep.MilestoneArgs(levels, 2);
        Assert.Equal(["Silver"], (List<string>)args.GetType().GetProperty("PaidLevels")!.GetValue(args)!);
        Assert.Equal(["Gold"], (List<string>)args.GetType().GetProperty("LastLevels")!.GetValue(args)!);
        var first = ExpenditureSweep.MilestoneArgs(levels, 1);
        Assert.Equal(["Silver", "Gold"], (List<string>)first.GetType().GetProperty("PaidLevels")!.GetValue(first)!);
        Assert.Equal(["ZEDX"], (List<string>)first.GetType().GetProperty("LastLevels")!.GetValue(first)!);
        // A finished milestone waiting for the next payment stays committed to the organisation's PO.
        Assert.Contains("CASE WHEN C.NcCount >= 1 AND C.ExpM1CountedOn IS NULL THEN 1 ELSE 0 END", PoLimits.ConsultancyInProgressSql);
    }

    [Fact]
    public void A_po_stops_when_its_cases_are_used_or_in_progress()
    {
        var day = new DateTime(2026, 4, 2);
        Assert.Equal("NoPo", new PoLevelStatus("A", "Bronze", 0, 5, 0, null).State);
        Assert.False(new PoLevelStatus("A", "Bronze", 0, 5, 0, null).Stopped);
        var open = new PoLevelStatus("A", "Bronze", 500, 300, 12, day);
        Assert.Equal(("Open", 188, 62), (open.State, open.Left, open.Percent));
        var low = new PoLevelStatus("A", "Silver", 120, 106, 5, day);
        Assert.Equal(("Low", 9), (low.State, low.Left));
        var stopped = new PoLevelStatus("A", "Gold", 40, 36, 4, day);
        Assert.True(stopped.Stopped);
        Assert.Equal(("Stopped", 0, 100), (stopped.State, stopped.Left, stopped.Percent));
        Assert.Contains("40 of 40 cases", PoLimits.StoppedMessage(stopped, "Mahavir Agency", "Gold"));
        // Surveillance visits do not use PO cases.
        Assert.Contains("X.Kind <> 'Surveillance'", PoLimits.MainUsedSql);
    }

    [Fact]
    public void Invoice_figures_add_gst_to_the_months_cases()
    {
        var oct = new DateTime(2026, 10, 1);
        var counts = new List<ExpenditureQueries.MonthCount>
        {
            new() { Month = oct, Kind = Expenditure.Completed, Cases = 41, Amount = 123000 },
            new() { Month = oct, Kind = Expenditure.Rejected, Cases = 3, Amount = 4500 },
            new() { Month = oct, Kind = Expenditure.Surveillance, Cases = 14, Amount = 28000 },
            new() { Month = oct.AddMonths(-1), Kind = Expenditure.Completed, Cases = 9, Amount = 1 },
        };
        var f = ExpenditureInvoices.Figure(oct, counts, 18);
        Assert.Equal((41, 3, 14, 58, 155500m, 183490m), (f.Completed, f.Rejected, f.Surveillance, f.Cases, f.Amount, f.Total));
        Assert.True(ExpenditureInvoices.ValidInvoiceNo("MA/26-27/031"));
        Assert.False(ExpenditureInvoices.ValidInvoiceNo("<script>"));
    }

    // ------------------------------------------------------------------ Admin → Fees → Expenditure rates

    [Fact]
    public async Task Only_the_admin_sees_and_saves_the_rates()
    {
        foreach (var user in new[] { "MASTER1", "AGENCY1" })
        {
            var other = await SignIn(user);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync("/api/staff/expenditure-rates")).StatusCode);
        }
        var admin = await SignIn("ADMIN1");
        var rates = await admin.GetFromJsonAsync<ExpenditureRatesController.RatesResponse>("/api/staff/expenditure-rates", Web);
        Assert.Equal(18m, rates!.GstPercent);
        Assert.Contains(rates.AgencyLevels, l => l.Level == "Bronze" && l.Flow == "Desktop only");
        // Milestones per level come from the Consultancy fee master; 3 without rows.
        Assert.All(rates.ConsultantLevels, l => Assert.Equal(3, l.Milestones));
    }

    [Fact]
    public async Task A_rate_set_is_added_with_its_date_of_effect_and_reprices_the_cases_not_approved()
    {
        var admin = await SignIn("ADMIN1");
        var from = DateTime.Today.AddDays(10).ToString("yyyy-MM-dd");
        var r = await admin.PutAsJsonAsync("/api/staff/expenditure-rates", new
        {
            kind = "Agency", effectiveFrom = from, edit = false, gstPercent = 18,
            levels = new[] { new { level = "Bronze", completed = 3000, rejected = 1500, surveillance = 2000 } },
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var save = _host.Sql.Calls.Single(c => c.Name.StartsWith("SET XACT_ABORT ON; BEGIN TRAN; UPDATE dbo.ExpenditureRates SET SupersededOn"));
        Assert.Equal("Bronze", FakeSql.Arg(save.Args, "L0"));
        Assert.Equal("3000", FakeSql.Arg(save.Args, "C0"));
        Assert.Contains(_host.Sql.Calls, c => c.Name == ExpenditureRates.RepriceSql(Expenditure.Agency));

        // A level with more milestones than it has is refused.
        var bad = await admin.PutAsJsonAsync("/api/staff/expenditure-rates", new
        {
            kind = "Consultant", effectiveFrom = from, edit = false, gstPercent = 18,
            levels = new[] { new { level = "Silver", milestones = new decimal?[] { 1, 2, 3, 4 } } },
        });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Equal("Please enter the GST % (0 to 100).", await (await admin.PutAsJsonAsync("/api/staff/expenditure-rates",
            new { kind = "Agency", effectiveFrom = from, gstPercent = 120, levels = Array.Empty<object>() })).ProblemTitle());
    }

    [Fact]
    public async Task A_rate_set_is_read_only_once_an_approved_invoice_has_its_cases()
    {
        var from = new DateTime(2026, 11, 1);
        _host.Sql.Queries[ExpenditureRates.ListSql] = _ => [new
        {
            Id = 1, Kind = "Agency", EffectiveFrom = from, Level = "Bronze", RateCompleted = 3000m, GstPercent = 18m, SavedBy = "ADMIN1", SavedOn = from,
        }];
        _lockedCases = 4;
        var admin = await SignIn("ADMIN1");
        var rates = await admin.GetFromJsonAsync<ExpenditureRatesController.RatesResponse>("/api/staff/expenditure-rates", Web);
        Assert.True(rates!.Sets.Single().Locked);
        var r = await admin.PutAsJsonAsync("/api/staff/expenditure-rates", new
        {
            kind = "Agency", effectiveFrom = "2026-11-01", edit = true, gstPercent = 18,
            levels = new[] { new { level = "Bronze", completed = 3500 } },
        });
        Assert.Equal("The rate set of 01-11-2026 is read-only: an approved invoice includes cases priced with it.", await r.ProblemTitle());
        var dup = await admin.PutAsJsonAsync("/api/staff/expenditure-rates", new
        {
            kind = "Agency", effectiveFrom = "2026-11-01", edit = false, gstPercent = 18, levels = new[] { new { level = "Bronze", completed = 3500 } },
        });
        Assert.Contains("exists", await dup.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.Contains("INSERT INTO dbo.ExpenditureRates"));
    }

    // ------------------------------------------------------------------ purchase orders

    [Fact]
    public async Task Only_the_master_admin_who_created_the_agency_adds_its_po()
    {
        var po = new { partyId = "AGENCY1", level = "Gold", poNumber = "QCI/ZED/PO/2026/116", poDate = "2026-04-02", cases = 40 };
        Assert.Equal(HttpStatusCode.Forbidden, (await (await SignIn("MASTER2")).PostAsJsonAsync("/api/staff/expenditure/po", po)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await (await SignIn("ADMIN1")).PostAsJsonAsync("/api/staff/expenditure/po", po)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await SignIn("MASTER2")).GetAsync("/api/staff/expenditure/po?partyId=AGENCY1")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await SignIn("ADMIN1")).GetAsync("/api/staff/expenditure/po?partyId=AGENCY1")).StatusCode);

        var master = await SignIn("MASTER1");
        Assert.Equal(HttpStatusCode.OK, (await master.PostAsJsonAsync("/api/staff/expenditure/po", po)).StatusCode);
        var add = _host.Sql.Calls.Single(c => c.Name == PurchaseOrdersController.AddSql);
        Assert.Equal(("AGENCY1", "Gold", "40", "Added"), (FakeSql.Arg(add.Args, "PartyId"), FakeSql.Arg(add.Args, "Level"), FakeSql.Arg(add.Args, "Cases"), FakeSql.Arg(add.Args, "Type")));
        Assert.Equal(HttpStatusCode.BadRequest, (await master.PostAsJsonAsync("/api/staff/expenditure/po", po with { cases = 0 })).StatusCode);
    }

    [Fact]
    public async Task Reopen_asks_a_reason_and_extra_cases_or_a_new_po()
    {
        _host.Sql.Queries[PurchaseOrdersController.ListSql] = _ =>
            [new { Id = 7, PartyId = "AGENCY1", Level = "Gold", PoNumber = "QCI/ZED/PO/2026/116", PoDate = new DateTime(2026, 4, 2), Cases = 40 }];
        var master = await SignIn("MASTER1");
        Assert.Equal("Please enter the reason for reopening.",
            await (await master.PostAsJsonAsync("/api/staff/expenditure/po/reopen", new { partyId = "AGENCY1", level = "Gold", extraCases = 10 })).ProblemTitle());
        Assert.Equal("Please enter either the extra cases or a new purchase order.",
            await (await master.PostAsJsonAsync("/api/staff/expenditure/po/reopen", new { partyId = "AGENCY1", level = "Gold", reason = "More units" })).ProblemTitle());
        Assert.Equal(HttpStatusCode.OK,
            (await master.PostAsJsonAsync("/api/staff/expenditure/po/reopen", new { partyId = "AGENCY1", level = "Gold", reason = "More units", extraCases = 10 })).StatusCode);
        var amend = _host.Sql.Calls.Single(c => c.Name == PurchaseOrdersController.AmendSql);
        Assert.Equal(("7", "10", "More units"), (FakeSql.Arg(amend.Args, "Id"), FakeSql.Arg(amend.Args, "Extra"), FakeSql.Arg(amend.Args, "Reason")));
        Assert.Equal(HttpStatusCode.OK, (await master.PostAsJsonAsync("/api/staff/expenditure/po/reopen", new
        {
            partyId = "AGENCY1", level = "Gold", reason = "New financial year", poNumber = "QCI/ZED/PO/2027/001", poDate = "2026-11-01", cases = 50,
        })).StatusCode);
        Assert.Contains(_host.Sql.Calls, c => c.Name == PurchaseOrdersController.AddSql && FakeSql.Arg(c.Args, "Type") == "NewPo");
    }

    // ------------------------------------------------------------------ the allotment stop

    [Fact]
    public async Task Allotment_stops_when_the_agencys_po_is_used_up()
    {
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = _ => FakeSql.Sets([new { ZedId = "ZEDMSME000001", Certification = "Bronze", PUnitName = "Unit 1" }]);
        _host.Sql.Procs["SP_ASSESSMENT_AGENCIES_TO_ALLOT"] = _ => FakeSql.Sets([
            new { UserId = "AGENCY1", UserName = "Mahavir Agency", DesktopVerification = true },
            new { UserId = "AGENCY2", UserName = "Other Agency", DesktopVerification = true },
        ]);
        _host.Sql.Queries[PoLimits.TotalsSql] = _ => [new { PartyId = "AGENCY1", Level = "Bronze", Cases = 10, FirstPo = new DateTime(2026, 4, 2) }];
        _host.Sql.Queries[PoLimits.MainUsedSql] = _ => [new { PartyId = "AGENCY1", Level = "Bronze", Cases = 8 }];
        _host.Sql.Queries[PoLimits.MainInProgressSql] = _ => [new { PartyId = "AGENCY1", Level = "Bronze", Cases = 2 }];
        var master = await SignIn("MASTER1");

        var agencies = await master.GetFromJsonAsync<JsonElement>("/api/staff/assessment/allot/agencies?zedId=ZEDMSME000001&certification=Bronze");
        var one = agencies.EnumerateArray().Single(a => a.GetProperty("userId").GetString() == "AGENCY1");
        Assert.True(one.GetProperty("poStopped").GetBoolean());
        Assert.Equal(0, one.GetProperty("poLeft").GetInt32());
        var two = agencies.EnumerateArray().Single(a => a.GetProperty("userId").GetString() == "AGENCY2");
        Assert.False(two.GetProperty("poStopped").GetBoolean());
        Assert.Equal(JsonValueKind.Null, two.GetProperty("poLeft").ValueKind);

        var r = await master.PostAsJsonAsync("/api/staff/assessment/allot", new { zedId = "ZEDMSME000001", certification = "Bronze", agencyUserId = "AGENCY1" });
        Assert.StartsWith("Allotment to Mahavir Agency for Bronze has stopped", await r.ProblemTitle());
        var bulk = await master.PostAsJsonAsync("/api/staff/assessment/allot/bulk",
            new { units = new[] { new { zedId = "ZEDMSME000001", certification = "Bronze" } }, agencyUserId = "AGENCY1" });
        var result = await bulk.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, result.GetProperty("allotted").GetInt32());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_ASSESSMENT_ALLOT_TO_AGENCY");
    }

    // ------------------------------------------------------------------ the Expenditure tab

    [Fact]
    public async Task A_master_admin_sees_the_agencies_it_created()
    {
        _host.Sql.Queries[ExpenditureQueries.MainCountSql] = _ =>
        [
            new { PartyId = "AGENCY1", Level = "Bronze", Kind = "Completed", Cases = 300, Amount = 900000m, Invoiced = 720000m },
            new { PartyId = "AGENCY1", Level = "Bronze", Kind = "Rejected", Cases = 12, Amount = 18000m, Invoiced = 0m },
            new { PartyId = "AGENCY2", Level = "Silver", Kind = "Completed", Cases = 5, Amount = 90000m, Invoiced = 0m },
        ];
        _host.Sql.Queries[ExpenditureQueries.SurveillanceCountSql] = _ => [new { PartyId = "AGENCY1", Level = "Bronze", Kind = "Surveillance", Cases = 31, Amount = 62000m, Invoiced = 0m }];
        _host.Sql.Queries[PoLimits.TotalsSql] = _ => [new { PartyId = "AGENCY1", Level = "Bronze", Cases = 500, FirstPo = new DateTime(2026, 4, 2) }];
        _host.Sql.Queries[PoLimits.MainUsedSql] = _ => [new { PartyId = "AGENCY1", Level = "Bronze", Cases = 312 }];

        var master = await SignIn("MASTER1");
        var s = await master.GetFromJsonAsync<ExpenditureController.SummaryResponse>("/api/staff/expenditure/summary?from=2026-04-01&to=2026-11-30", Web);
        var row = Assert.Single(s!.Rows);
        Assert.Equal(("AGENCY1", 300, 12, 31, 188, "Open"), (row.PartyId, row.Completed, row.Rejected, row.Surveillance, row.Balance!.Value, row.PoState));
        Assert.Equal((980000m, 720000m, 260000m), (row.Payable, row.Invoiced, row.Outstanding));
        Assert.Equal(500, s.Cards.PoCases);
        Assert.Equal(["AGENCY1"], s.Parties.Select(p => p.Code));
        Assert.Equal(HttpStatusCode.NotFound, (await master.GetAsync("/api/staff/expenditure/summary?partyId=AGENCY2")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await master.GetAsync("/api/staff/expenditure/summary?from=2026-12-01&to=2026-11-01")).StatusCode);

        var admin = await SignIn("ADMIN1");
        var all = await admin.GetFromJsonAsync<ExpenditureController.SummaryResponse>("/api/staff/expenditure/summary", Web);
        Assert.Equal(2, all!.Rows.Count);
        // 2026-11-18: the agency reads its own figures only.
        var own = await (await SignIn("AGENCY1")).GetFromJsonAsync<ExpenditureController.SummaryResponse>("/api/staff/expenditure/summary", Web);
        Assert.Equal(["AGENCY1"], own!.Rows.Select(r => r.PartyId).Distinct());
    }

    // ------------------------------------------------------------------ monthly invoices

    private static MultipartFormDataContent Invoice(string month, byte[] pdf, string amount = "495600")
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(month), "month" }, { new StringContent("MA/26-27/031"), "invoiceNo" },
            { new StringContent(month + "-28"), "invoiceDate" }, { new StringContent(amount), "invoiceAmount" },
        };
        var file = new ByteArrayContent(pdf);
        file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/pdf");
        form.Add(file, "file", "invoice.pdf");
        return form;
    }

    private static readonly byte[] Pdf = System.Text.Encoding.ASCII.GetBytes("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

    [Fact]
    public async Task The_agency_uploads_its_months_invoice_as_a_pdf_with_the_portals_figures()
    {
        var month = DateTime.Today.AddMonths(-1).ToString("yyyy-MM");
        var first = new DateTime(DateTime.Today.AddMonths(-1).Year, DateTime.Today.AddMonths(-1).Month, 1);
        _host.Sql.Queries[ExpenditureQueries.MainMonthSql] = _ =>
            [new { Month = first, Kind = "Completed", Cases = 41, Amount = 123000m }, new { Month = first, Kind = "Rejected", Cases = 3, Amount = 4500m }];
        TaxSubmitted();
        var agency = await SignIn("AGENCY1");

        Assert.Equal(HttpStatusCode.BadRequest, (await agency.PostAsync("/api/staff/expenditure/my/invoices",
            Invoice(month, System.Text.Encoding.ASCII.GetBytes("MZ not a pdf")))).StatusCode);
        Assert.Equal("Please choose a month that has ended.", await (await agency.PostAsync("/api/staff/expenditure/my/invoices",
            Invoice(DateTime.Today.ToString("yyyy-MM"), Pdf))).ProblemTitle());

        var r = await agency.PostAsync("/api/staff/expenditure/my/invoices", Invoice(month, Pdf));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var insert = _host.Sql.Calls.Single(c => c.Name == ExpenditureInvoices.InsertSql);
        Assert.Equal(("AGENCY1", "41", "3"), (FakeSql.Arg(insert.Args, "PartyId"), FakeSql.Arg(insert.Args, "Completed"), FakeSql.Arg(insert.Args, "Rejected")));
        Assert.Equal(127500m, decimal.Parse(FakeSql.Arg(insert.Args, "Amount")!, System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal(150450m, decimal.Parse(FakeSql.Arg(insert.Args, "Total")!, System.Globalization.CultureInfo.InvariantCulture));
        var path = FakeSql.Arg(insert.Args, "FilePath")!;
        Assert.StartsWith("Uploads/ExpenditureInvoices/AGENCY1/Invoice_", path);
        Assert.True(File.Exists(Path.Combine(_host.StorageRoot, path)));

        var mine = await agency.GetFromJsonAsync<MyInvoicesController.MyResponse>("/api/staff/expenditure/my", Web);
        Assert.Equal(MyInvoicesController.Months + 1, mine!.Months.Count);
        Assert.Equal(44, mine.Months[1].Cases);
    }

    [Fact]
    public async Task Its_master_admin_approves_or_returns_the_invoice_with_remarks()
    {
        _host.Sql.Queries[ExpenditureInvoices.FindSql] = _ => [new
        {
            Id = 5, PartyId = "AGENCY1", InvoiceMonth = new DateTime(2026, 10, 1), InvoiceNo = "MA/26-27/031", InvoiceDate = new DateTime(2026, 11, 5),
            InvoiceAmount = 495600m, FilePath = "Uploads/ExpenditureInvoices/AGENCY1/x.pdf", PortalCompleted = 41, PortalAmount = 420000m, GstPercent = 18m,
            PortalTotal = 495600m, Status = "Submitted",
        }];
        Assert.Equal(HttpStatusCode.NotFound, (await (await SignIn("MASTER2")).PostAsJsonAsync("/api/staff/expenditure/invoices/5/approve", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await (await SignIn("ADMIN1")).PostAsJsonAsync("/api/staff/expenditure/invoices/5/approve", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await (await SignIn("AGENCY1")).PostAsJsonAsync("/api/staff/expenditure/invoices/5/approve", new { })).StatusCode);

        var master = await SignIn("MASTER1");
        var detail = await master.GetFromJsonAsync<ExpenditureController.InvoiceDetail>("/api/staff/expenditure/invoices/5", Web);
        Assert.True(detail!.Invoice.CanReview);
        Assert.Equal("Please enter the remarks: they tell the agency what to correct.",
            await (await master.PostAsJsonAsync("/api/staff/expenditure/invoices/5/return", new { remarks = " " })).ProblemTitle());
        Assert.Equal(HttpStatusCode.OK, (await master.PostAsJsonAsync("/api/staff/expenditure/invoices/5/return", new { remarks = "Wrong GSTIN" })).StatusCode);
        Assert.Contains(_host.Sql.Calls, c => c.Name == ExpenditureInvoices.ReturnSql && FakeSql.Arg(c.Args, "Remarks") == "Wrong GSTIN");
        Assert.Equal(HttpStatusCode.OK, (await master.PostAsJsonAsync("/api/staff/expenditure/invoices/5/approve", new { })).StatusCode);
        Assert.Contains("ErpExport = 'Pending'", ExpenditureInvoices.ApproveSql);
        Assert.Contains(_host.Sql.Calls, c => c.Name == ExpenditureInvoices.ApproveSql && FakeSql.Arg(c.Args, "Id") == "5");
    }

    // ------------------------------------------------------------------ the agency's Expenditure page (2026-11-18)

    private const string Gstin = "27AAPFU0939F1ZV";
    private const string Pan = "AAPFU0939F";

    /// <summary>AGENCY1's tax details as submitted (files stored under the storage root); other agencies have none.</summary>
    private void TaxSubmitted()
    {
        var folder = Path.Combine(_host.StorageRoot, "Uploads", "ExpenditureTax", "AGENCY1");
        Directory.CreateDirectory(folder);
        File.WriteAllBytes(Path.Combine(folder, "GstCertificate_1.pdf"), Pdf);
        File.WriteAllBytes(Path.Combine(folder, "PanCard_1.png"), Png);
        _host.Sql.Queries[ExpenditureTax.ReadSql] = args => FakeSql.Arg(args, "PartyId") == "AGENCY1"
            ? [new
            {
                UserId = "AGENCY1", TaxGstin = Gstin, TaxPan = Pan, TaxGstFile = "Uploads/ExpenditureTax/AGENCY1/GstCertificate_1.pdf",
                TaxPanFile = "Uploads/ExpenditureTax/AGENCY1/PanCard_1.png", TaxSubmittedOn = new DateTime(2026, 11, 18, 5, 0, 0), TaxSubmittedBy = "AGENCY1",
            }]
            : [new { UserId = FakeSql.Arg(args, "PartyId") }];
    }

    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52];

    private static MultipartFormDataContent Tax(string? gstin = Gstin, string? pan = Pan, string declaration = "true",
        (byte[] Bytes, string Name, string Type)? gst = null, (byte[] Bytes, string Name, string Type)? panCard = null, bool withFiles = true)
    {
        var form = new MultipartFormDataContent { { new StringContent(declaration), "declaration" } };
        if (gstin is not null) form.Add(new StringContent(gstin), "gstin");
        if (pan is not null) form.Add(new StringContent(pan), "pan");
        if (!withFiles) return form;
        foreach (var (field, f) in new[] { ("gstFile", gst ?? (Pdf, "gst.pdf", "application/pdf")), ("panFile", panCard ?? (Png, "pan.png", "image/png")) })
        {
            var c = new ByteArrayContent(f.Bytes);
            c.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(f.Type);
            form.Add(c, field, f.Name);
        }
        return form;
    }

    [Fact]
    public void The_gstin_is_checked_by_format_state_code_and_check_digit_and_the_pan_by_the_gstin()
    {
        Assert.Null(ExpenditureTax.GstinProblem(Gstin));
        Assert.Equal('V', ExpenditureTax.CheckDigit(Gstin));
        Assert.Contains("check digit", ExpenditureTax.GstinProblem("27AAPFU0939F1ZA"));
        Assert.Contains("15 characters", ExpenditureTax.GstinProblem("99AAPFU0939F1ZV")); // no such state code
        Assert.Contains("15 characters", ExpenditureTax.GstinProblem("27AAPFU0939F1Z"));
        Assert.Null(ExpenditureTax.PanProblem(Pan, Gstin));
        Assert.Contains("(AAPFU0939F)", ExpenditureTax.PanProblem("AAPFU0939G", Gstin));
        Assert.Contains("10 characters", ExpenditureTax.PanProblem("AAPFU0939", Gstin));
        // Written once: only while nothing was submitted.
        Assert.EndsWith("WHERE RoleId = 2 AND UserId = @PartyId AND TaxSubmittedOn IS NULL;", ExpenditureTax.SubmitSql);
    }

    [Fact]
    public async Task The_agency_sees_only_its_own_figures_pos_cases_and_invoices()
    {
        _host.Sql.Queries[ExpenditureQueries.MainCountSql] = _ =>
        [
            new { PartyId = "AGENCY1", Level = "Bronze", Kind = "Completed", Cases = 300, Amount = 900000m, Invoiced = 720000m },
            new { PartyId = "AGENCY2", Level = "Silver", Kind = "Completed", Cases = 5, Amount = 90000m, Invoiced = 0m },
        ];
        _host.Sql.Queries[PoLimits.TotalsSql] = _ => [new { PartyId = "AGENCY1", Level = "Bronze", Cases = 500, FirstPo = new DateTime(2026, 4, 2) }];
        _host.Sql.Queries[PoLimits.MainUsedSql] = _ => [new { PartyId = "AGENCY1", Level = "Bronze", Cases = 300 }];
        _host.Sql.Queries[PurchaseOrdersController.ListSql] = args => FakeSql.Arg(args, "PartyId") == "AGENCY1"
            ? [new { Id = 7, PartyId = "AGENCY1", Level = "Bronze", PoNumber = "QCI/ZED/PO/2026/116", PoDate = new DateTime(2026, 4, 2), Cases = 500 }]
            : [];
        _host.Sql.Queries[ExpenditureQueries.MainCaseSql] = _ =>
            [new { ZedId = "ZEDMSME000001", UnitName = "Unit 1", State = "GOA", Level = "Bronze", Kind = "Completed", CountedOn = new DateTime(2026, 10, 3), Rate = 3000m }];
        TaxSubmitted();
        var agency = await SignIn("AGENCY1");

        var s = await agency.GetFromJsonAsync<ExpenditureController.SummaryResponse>("/api/staff/expenditure/summary", Web);
        var row = Assert.Single(s!.Rows);
        Assert.Equal(("AGENCY1", 300, 200, "Open"), (row.PartyId, row.Completed, row.Balance!.Value, row.PoState));
        Assert.Equal((900000m, 720000m, 180000m), (s.Cards.Payable, s.Cards.Invoiced, s.Cards.Outstanding));
        Assert.Equal(["AGENCY1"], s.Parties.Select(p => p.Code));
        Assert.Equal(HttpStatusCode.NotFound, (await agency.GetAsync("/api/staff/expenditure/summary?partyId=AGENCY2")).StatusCode);

        var cases = await agency.GetFromJsonAsync<List<ExpenditureController.CaseView>>("/api/staff/expenditure/cases?partyId=AGENCY1&level=Bronze", Web);
        Assert.Equal("ZEDMSME000001", Assert.Single(cases!).ZedId);
        Assert.Equal(HttpStatusCode.NotFound, (await agency.GetAsync("/api/staff/expenditure/cases?partyId=AGENCY2")).StatusCode);

        // Its POs, read-only (no edit, no history, no change).
        var po = await agency.GetFromJsonAsync<PurchaseOrdersController.PoView>("/api/staff/expenditure/po?partyId=AGENCY1", Web);
        Assert.False(po!.CanEdit);
        var level = Assert.Single(po.Levels);
        Assert.Equal(("QCI/ZED/PO/2026/116", 300, 200, 60, "Open"), (level.Pos.Single().PoNumber, level.Used, level.Left, level.Percent, level.State));
        Assert.Equal(HttpStatusCode.NotFound, (await agency.GetAsync("/api/staff/expenditure/po?partyId=AGENCY2")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.GetAsync("/api/staff/expenditure/po/history?partyId=AGENCY1")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.PostAsJsonAsync("/api/staff/expenditure/po",
            new { partyId = "AGENCY1", level = "Gold", poNumber = "X1", poDate = "2026-04-02", cases = 40 })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.PostAsJsonAsync("/api/staff/expenditure/po/reopen",
            new { partyId = "AGENCY1", level = "Bronze", reason = "x", extraCases = 10 })).StatusCode);

        // The managers' invoice list and review stay theirs; the agency opens its own invoice and PDF, not another's.
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.GetAsync("/api/staff/expenditure/invoices")).StatusCode);
        _host.Sql.Queries[ExpenditureInvoices.FindSql] = args =>
        {
            var id = FakeSql.Arg(args, "Id");
            Directory.CreateDirectory(Path.Combine(_host.StorageRoot, "Uploads", "ExpenditureInvoices", "AGENCY1"));
            File.WriteAllBytes(Path.Combine(_host.StorageRoot, "Uploads", "ExpenditureInvoices", "AGENCY1", "x.pdf"), Pdf);
            return [new
            {
                Id = int.Parse(id!), PartyId = id == "5" ? "AGENCY1" : "AGENCY2", InvoiceMonth = new DateTime(2026, 10, 1), InvoiceNo = "MA/26-27/031",
                InvoiceDate = new DateTime(2026, 11, 5), InvoiceAmount = 495600m, FilePath = "Uploads/ExpenditureInvoices/AGENCY1/x.pdf", Status = "Returned",
                Remarks = "Wrong amount",
            }];
        };
        var detail = await agency.GetFromJsonAsync<ExpenditureController.InvoiceDetail>("/api/staff/expenditure/invoices/5", Web);
        Assert.False(detail!.Invoice.CanReview);
        Assert.Equal(Gstin, detail.Tax!.Gstin);
        var pdf = await agency.GetAsync("/api/staff/expenditure/invoices/5/file");
        Assert.Equal(HttpStatusCode.OK, pdf.StatusCode);
        Assert.Equal("application/pdf", pdf.Content.Headers.ContentType!.MediaType);
        Assert.Equal(HttpStatusCode.NotFound, (await agency.GetAsync("/api/staff/expenditure/invoices/6")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await agency.GetAsync("/api/staff/expenditure/invoices/6/file")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.PostAsJsonAsync("/api/staff/expenditure/invoices/5/approve", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.PostAsJsonAsync("/api/staff/expenditure/invoices/5/return", new { remarks = "x" })).StatusCode);
    }

    [Fact]
    public async Task The_agencys_months_are_the_current_one_and_the_12_before_with_gst_and_the_invoice_status()
    {
        var today = DateTime.UtcNow.AddMinutes(330).Date;
        var current = new DateTime(today.Year, today.Month, 1);
        var last = current.AddMonths(-1);
        _host.Sql.Queries[ExpenditureQueries.MainMonthSql] = _ =>
        [
            new { Month = last, Kind = "Completed", Cases = 41, Amount = 123000m },
            new { Month = last, Kind = "Rejected", Cases = 3, Amount = 4500m },
            new { Month = current, Kind = "Completed", Cases = 2, Amount = 6000m },
        ];
        _host.Sql.Queries[ExpenditureQueries.SurveillanceMonthSql] = _ => [new { Month = last, Kind = "Surveillance", Cases = 14, Amount = 28000m }];
        _host.Sql.Queries[ExpenditureInvoices.ListSql] = _ => [new
        {
            Id = 3, PartyId = "AGENCY1", InvoiceMonth = last.AddMonths(-2), InvoiceNo = "MA/26-27/017", InvoiceDate = last.AddMonths(-1), InvoiceAmount = 1m,
            Status = "Returned", Remarks = "Wrong GSTIN",
        }];
        var agency = await SignIn("AGENCY1");

        var mine = await agency.GetFromJsonAsync<MyInvoicesController.MyResponse>("/api/staff/expenditure/my", Web);
        Assert.Equal(MyInvoicesController.Months + 1, mine!.Months.Count);
        var now = mine.Months[0];
        Assert.Equal((current.ToString("yyyy-MM"), 2, false, false), (now.Month, now.Cases, now.Ended, now.CanUpload));
        var m = mine.Months[1];
        Assert.Equal((41, 3, 14, 58), (m.Completed, m.Rejected, m.Surveillance, m.Cases));
        Assert.Equal((155500m, 18m, 27990m, 183490m), (m.Amount, m.GstPercent, m.GstAmount, m.Total));
        Assert.True(m.Ended && m.CanUpload && m.Invoice is null);
        var returned = mine.Months[3];
        Assert.Equal(("Returned", "Wrong GSTIN", true), (returned.Invoice!.Status, returned.Invoice.Remarks, returned.CanUpload));
        // No tax details yet: the page asks for them (pre-filled from the agency form's GSTIN when there is one).
        Assert.True(mine.Tax.Available);
        Assert.False(mine.Tax.Submitted);
        Assert.Null(mine.Tax.Gstin);
    }

    [Fact]
    public async Task Tax_details_come_before_any_invoice_upload()
    {
        var month = DateTime.UtcNow.AddMinutes(330).AddMonths(-1).ToString("yyyy-MM");
        _host.Sql.Queries[ExpenditureTax.ReadSql] = _ => [new { UserId = "AGENCY1", AgencyGstNumber = Gstin }];
        var agency = await SignIn("AGENCY1");
        var mine = await agency.GetFromJsonAsync<MyInvoicesController.MyResponse>("/api/staff/expenditure/my", Web);
        Assert.Equal(Gstin, mine!.Tax.SuggestedGstin);

        var r = await agency.PostAsync("/api/staff/expenditure/my/invoices", Invoice(month, Pdf));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(MyInvoicesController.TaxFirst, await r.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == ExpenditureInvoices.InsertSql);
    }

    [Fact]
    public async Task Tax_details_are_validated_saved_with_their_documents_and_locked()
    {
        _host.Sql.Queries[ExpenditureTax.ReadSql] = _ => [new { UserId = "AGENCY1" }];
        var agency = await SignIn("AGENCY1");
        async Task<string?> Refused(MultipartFormDataContent form)
        {
            var r = await agency.PostAsync("/api/staff/expenditure/my/tax", form);
            Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
            return await r.ProblemTitle();
        }

        Assert.Contains("valid GSTIN", await Refused(Tax(gstin: "27AAPFU0939F1Z")));
        Assert.Contains("check digit", await Refused(Tax(gstin: "27AAPFU0939F1ZA")));
        Assert.Contains("does not match the GSTIN", await Refused(Tax(pan: "AAPFU0939G")));
        Assert.Equal("Please upload the GST registration certificate (PDF, JPG or PNG, up to 5 MB).", await Refused(Tax(withFiles: false)));
        Assert.Contains("does not match its type", await Refused(Tax(gst: (System.Text.Encoding.ASCII.GetBytes("MZ not a pdf"), "gst.pdf", "application/pdf"))));
        Assert.Contains("not allowed", await Refused(Tax(panCard: (Png, "pan.exe", "application/octet-stream"))));
        Assert.Contains("not a complete PDF", await Refused(Tax(gst: (System.Text.Encoding.ASCII.GetBytes("%PDF-1.4 truncated"), "gst.pdf", "application/pdf"))));
        Assert.Contains("too large", await Refused(Tax(panCard: (new byte[ExpenditureTax.MaxBytes + 1], "pan.png", "image/png"))));
        Assert.Contains("declaration", await Refused(Tax(declaration: "false")));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == ExpenditureTax.SubmitSql);

        var ok = await agency.PostAsync("/api/staff/expenditure/my/tax", Tax(gstin: " 27aapfu0939f1zv ", pan: "aapfu0939f"));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var save = Assert.Single(_host.Sql.Calls, c => c.Name == ExpenditureTax.SubmitSql);
        Assert.Equal(("AGENCY1", Gstin, Pan, "AGENCY1"),
            (FakeSql.Arg(save.Args, "PartyId"), FakeSql.Arg(save.Args, "Gstin"), FakeSql.Arg(save.Args, "Pan"), FakeSql.Arg(save.Args, "By")));
        var gstPath = FakeSql.Arg(save.Args, "GstFile")!;
        var panPath = FakeSql.Arg(save.Args, "PanFile")!;
        Assert.StartsWith("Uploads/ExpenditureTax/AGENCY1/GstCertificate_", gstPath);
        Assert.EndsWith(".pdf", gstPath);
        Assert.StartsWith("Uploads/ExpenditureTax/AGENCY1/PanCard_", panPath);
        Assert.EndsWith(".png", panPath);
        Assert.True(File.Exists(Path.Combine(_host.StorageRoot, gstPath)) && File.Exists(Path.Combine(_host.StorageRoot, panPath)));

        // Once submitted they cannot be changed: a second submission is refused and nothing is written or stored.
        TaxSubmitted();
        var files = Directory.GetFiles(Path.Combine(_host.StorageRoot, "Uploads", "ExpenditureTax", "AGENCY1")).Length;
        var again = await agency.PostAsync("/api/staff/expenditure/my/tax", Tax(gstin: "29AAPFU0939F1ZR", pan: Pan));
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal("Your GSTIN and PAN were submitted on 18 Nov 2026 and cannot be changed.", await again.ProblemTitle());
        Assert.Single(_host.Sql.Calls, c => c.Name == ExpenditureTax.SubmitSql);
        Assert.Equal(files, Directory.GetFiles(Path.Combine(_host.StorageRoot, "Uploads", "ExpenditureTax", "AGENCY1")).Length);
        // There is no edit endpoint.
        Assert.Equal(HttpStatusCode.NotFound, (await agency.PutAsync("/api/staff/expenditure/my/tax", Tax())).StatusCode);
        Assert.Single(_host.Sql.Calls, c => c.Name == ExpenditureTax.SubmitSql);
        var mine = await agency.GetFromJsonAsync<MyInvoicesController.MyResponse>("/api/staff/expenditure/my", Web);
        Assert.Equal((true, Gstin, Pan, true, true), (mine!.Tax.Submitted, mine.Tax.Gstin, mine.Tax.Pan, mine.Tax.HasGstFile, mine.Tax.HasPanFile));
    }

    [Fact]
    public async Task The_master_admin_reads_the_tax_details_and_their_files_other_agencies_cannot()
    {
        TaxSubmitted();
        var master = await SignIn("MASTER1");
        var tax = await master.GetFromJsonAsync<ExpenditureTax.View>("/api/staff/expenditure/tax?partyId=AGENCY1", Web);
        Assert.Equal((true, Gstin, Pan), (tax!.Submitted, tax.Gstin, tax.Pan));
        var gst = await master.GetAsync("/api/staff/expenditure/tax/gst?partyId=AGENCY1");
        Assert.Equal(HttpStatusCode.OK, gst.StatusCode);
        Assert.Equal("application/pdf", gst.Content.Headers.ContentType!.MediaType);
        var pan = await master.GetAsync("/api/staff/expenditure/tax/pan?partyId=AGENCY1");
        Assert.Equal("image/png", pan.Content.Headers.ContentType!.MediaType);
        Assert.Equal(HttpStatusCode.NotFound, (await master.GetAsync("/api/staff/expenditure/tax/other?partyId=AGENCY1")).StatusCode);
        // The Expenditure tab with the agency chosen, and its purchase-order card, show them too.
        var sum = await master.GetFromJsonAsync<ExpenditureController.SummaryResponse>("/api/staff/expenditure/summary?partyId=AGENCY1", Web);
        Assert.Equal(Pan, sum!.Tax!.Pan);
        Assert.Null((await master.GetFromJsonAsync<ExpenditureController.SummaryResponse>("/api/staff/expenditure/summary", Web))!.Tax);
        var po = await master.GetFromJsonAsync<PurchaseOrdersController.PoView>("/api/staff/expenditure/po?partyId=AGENCY1", Web);
        Assert.Equal(Gstin, po!.Tax!.Gstin);
        // A master admin who does not see the agency, and another agency, get nothing; the agency gets its own.
        Assert.Equal(HttpStatusCode.NotFound, (await (await SignIn("MASTER2")).GetAsync("/api/staff/expenditure/tax?partyId=AGENCY1")).StatusCode);
        var other = await SignIn("AGENCY2");
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync("/api/staff/expenditure/tax?partyId=AGENCY1")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync("/api/staff/expenditure/tax/gst?partyId=AGENCY1")).StatusCode);
        Assert.False((await other.GetFromJsonAsync<ExpenditureTax.View>("/api/staff/expenditure/tax?partyId=AGENCY2", Web))!.Submitted);
        Assert.Equal(HttpStatusCode.OK, (await (await SignIn("AGENCY1")).GetAsync("/api/staff/expenditure/tax/pan?partyId=AGENCY1")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await SignIn("ADMIN1")).GetAsync("/api/staff/expenditure/tax?partyId=AGENCY1")).StatusCode);
    }
}
