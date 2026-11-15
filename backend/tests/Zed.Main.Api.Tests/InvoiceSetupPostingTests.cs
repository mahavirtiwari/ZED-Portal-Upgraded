using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Zed.Core.Finance;

namespace Zed.Main.Api.Tests;

/// <summary>2026-11-15: the Admin's invoice setup in what ErpFinanceService posts (test units, Board, ledger, item names).</summary>
public sealed class InvoiceSetupPostingTests
{
    private readonly FakeSql _sql = new();
    private readonly List<string> _bodies = [];
    private readonly InvoicesOnSettings _settings = new();

    private ErpFinanceService Service() => new(
        new HttpClient(new Capture(_bodies)), _sql,
        Options.Create(new ErpOptions { Enabled = true, TenantId = "tenant", ClientId = "id", ClientSecret = "secret", CompanyBaseUrl = "https://erp.example.test/company" }),
        _settings, NullLogger<ErpFinanceService>.Instance);

    private const string UdyamQuery = "SELECT TOP (1) UdyogAadharNo FROM dbo.MsmeBasicInformation";

    public InvoiceSetupPostingTests()
    {
        _sql.Procs["SP_API_FINANCE_GET_INVOICE_DETAILS"] = _ => FakeSql.Sets([new
        {
            Board = "ZED", Portal = "NDIE", Location_Code = "NDIE", TA_DA_LedgerName = "ASSESSMENT FEE",
            Sub_Discipline_Name = "ZMS - ZED SILVER CERTIFICATION", Invoice_No = "ZEDM/2627/1", Quantity = 1,
        }]);
        _sql.Procs["SP_API_FINANCE_GET_RECEIPT_DETAILS"] = _ => FakeSql.Sets([new { Board = "ZED", PortalName = "NDIE", Amount_Received = 1180.00m }]);
        _sql.Queries[UdyamQuery] = _ => [new { UdyogAadharNo = "UDYAM-KA-03-0000001" }];
    }

    [Fact]
    public async Task By_default_the_procedures_values_are_posted_and_the_three_test_units_are_skipped()
    {
        await Service().PushAsync(new ErpPush("ZEDM000001", "Silver", ErpDocument.Invoice));
        var posted = JsonDocument.Parse(Assert.Single(_bodies)).RootElement;
        Assert.Equal("ZED", posted.GetProperty("Board").GetString());
        Assert.Equal("ZMS - ZED SILVER CERTIFICATION", posted.GetProperty("Sub_Discipline_Name").GetString());

        _bodies.Clear();
        _sql.Queries[UdyamQuery] = _ => [new { UdyogAadharNo = "UDYAM-UP-29-0003915" }];
        await Service().PushAsync(new ErpPush("ZEDM000002", "Silver", ErpDocument.Invoice));
        Assert.Empty(_bodies);
        Assert.DoesNotContain(_sql.Calls, c => c.Name == "SP_API_FINANCE_GET_INVOICE_DETAILS" && FakeSql.Arg(c.Args, "ZedId") == "ZEDM000002");
    }

    [Fact]
    public async Task Saved_values_replace_the_procedures_and_the_saved_list_decides_the_test_units()
    {
        _settings.Values[InvoiceSetup.Board] = "ZEDX";
        _settings.Values[InvoiceSetup.Portal] = "MSME";
        _settings.Values[InvoiceSetup.LocationCode] = "DELHI";
        _settings.Values[InvoiceSetup.FeeLedger] = "CERTIFICATION FEE";
        _settings.Values[InvoiceSetup.ItemSilver] = "ZED SILVER";
        _settings.Values[InvoiceSetup.ExcludedUdyam] = "UDYAM-KA-03-0000001";

        await Service().PushAsync(new ErpPush("ZEDM000001", "Silver", ErpDocument.Invoice));
        Assert.Empty(_bodies);   // now a test unit

        _sql.Queries[UdyamQuery] = _ => [new { UdyogAadharNo = "UDYAM-UP-29-0003915" }];   // no longer one
        await Service().PushAsync(new ErpPush("ZEDM000001", "Silver", ErpDocument.Invoice));
        var invoice = JsonDocument.Parse(Assert.Single(_bodies)).RootElement;
        Assert.Equal("ZEDX", invoice.GetProperty("Board").GetString());
        Assert.Equal("MSME", invoice.GetProperty("Portal").GetString());
        Assert.Equal("DELHI", invoice.GetProperty("Location_Code").GetString());
        Assert.Equal("CERTIFICATION FEE", invoice.GetProperty("TA_DA_LedgerName").GetString());
        Assert.Equal("ZED SILVER", invoice.GetProperty("Sub_Discipline_Name").GetString());

        await Service().PushAsync(new ErpPush("ZEDM000001", "Silver", ErpDocument.Receipt));
        var receipt = JsonDocument.Parse(_bodies[1]).RootElement;
        Assert.Equal("ZEDX", receipt.GetProperty("Board").GetString());
        Assert.Equal("MSME", receipt.GetProperty("PortalName").GetString());

        // "none": no test units at all.
        _bodies.Clear();
        _settings.Values[InvoiceSetup.ExcludedUdyam] = InvoiceSetup.NoUnits;
        _sql.Queries[UdyamQuery] = _ => [new { UdyogAadharNo = "UDYAM-KA-03-0000001" }];
        await Service().PushAsync(new ErpPush("ZEDM000001", "Silver", ErpDocument.Invoice));
        Assert.Single(_bodies);
    }

    [Fact]
    public void The_item_name_is_replaced_only_on_certification_invoices()
    {
        var v = new InvoiceSetup.Values("ZEDM", "ZEDS", "ZED", "NDIE", "NDIE", "ASSESSMENT FEE", "B", "S", "G", []);
        var surveillance = new Dictionary<string, object?> { ["Sub_Discipline_Name"] = "ZMS - ZED GOLD SURVEILLANCE", ["Board"] = null };
        InvoiceSetup.Apply(surveillance, ErpDocument.Invoice, "SURVEILLANCE", "Gold", v);
        Assert.Equal("ZMS - ZED GOLD SURVEILLANCE", surveillance["Sub_Discipline_Name"]);
        Assert.Null(surveillance["Board"]);   // the procedure's empty row stays empty
        var zed = new Dictionary<string, object?> { ["Sub_Discipline_Name"] = "ZMS - ZED GOLD CERTIFICATION" };
        InvoiceSetup.Apply(zed, ErpDocument.Invoice, "ZED", "Gold", v);
        Assert.Equal("G", zed["Sub_Discipline_Name"]);
    }

    private sealed class Capture(List<string> bodies) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            if (request.RequestUri!.Host == "login.microsoftonline.com")
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(new { access_token = "token" }) };
            bodies.Add(await request.Content!.ReadAsStringAsync(ct));
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}") };
        }
    }
}
