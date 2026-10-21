using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Zed.Main.Api.Tests;

public sealed class MsmeCertificationTests : IDisposable
{
    private readonly TestHost _host = new();

    public MsmeCertificationTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args => FakeSql.Arg(args, "UserId") == "ZEDMSME000001"
            ? FakeSql.Sets([new { UserId = "ZEDMSME000001", UserName = "Acme", RoleId = 5, Email = "a@acme.test" }], [new { ERRORMSG = "SUCCESS" }])
            : FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
        _host.Sql.Procs["SP_MSME_GET_DETAILS"] = args => FakeSql.Sets(
            [new Dictionary<string, object?> { ["ZedId"] = FakeSql.Arg(args, "ZedId"), ["EnterpriseName"] = "Acme", ["Password"] = "secret", ["MobileNo"] = "9999999999" }],
            [new Dictionary<string, object?> { ["UdyogAadharNo"] = "UDYAM-UP-29-0003915", ["PanNo"] = "ABCDE1234F" }],
            [new Dictionary<string, object?> { ["BronzeStatus"] = 3, ["CertPath"] = "Certificates", ["FaAmount"] = "50000" }],
            [new Dictionary<string, object?> { ["ApplicationReceived"] = "Application received on May 1, 2024", ["BasicInfoStatus"] = "In-progress", ["Nc1Raised"] = "NC raised", ["AvailIncentive"] = "https://loginzed.msme.gov.in/Incentive/Details/9?ct=Bronze" }],
            [new Dictionary<string, object?> { ["Total"] = 10000, ["TransactionId"] = "T1" }],
            [new Dictionary<string, object?> { ["AutoEmailForAgency"] = "agency@example.test" }]);
    }

    public void Dispose() => _host.Dispose();

    private async Task<HttpClient> SignedInAsync()
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = "ZEDMSME000001", password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    [Fact]
    public async Task Requires_a_signed_in_msme()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/msme/certifications/Bronze")).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_GET_DETAILS");
    }

    [Fact]
    public async Task Uses_the_signed_in_zed_id_even_when_another_is_sent()
    {
        var client = await SignedInAsync();
        var response = await client.GetAsync("/api/msme/certifications/Bronze?zedId=ZEDMSME999999");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var call = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_GET_DETAILS");
        Assert.Equal("ZEDMSME000001", FakeSql.Arg(call.Args, "ZedId"));
        Assert.Equal("Bronze", FakeSql.Arg(call.Args, "CertificationType"));
    }

    [Theory]
    [InlineData("Bronze", "Bronze")]
    [InlineData("silver", "Silver")]
    [InlineData("GOLD", "Gold")]
    [InlineData("BronzeSurveillance", "BronzeSurveillance")]
    [InlineData("goldsurveillance", "GoldSurveillance")]
    [InlineData("SilverMilestone1", "SilverMilestone1")]
    [InlineData("goldmilestone3", "GoldMilestone3")]
    public async Task Passes_the_certification_type_to_the_procedure_in_its_canonical_spelling(string requested, string expected)
    {
        var client = await SignedInAsync();
        var json = await client.GetFromJsonAsync<JsonElement>($"/api/msme/certifications/{requested}");

        var call = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_GET_DETAILS");
        Assert.Equal(expected, FakeSql.Arg(call.Args, "CertificationType"));
        Assert.Equal(expected, json.GetProperty("certification").GetString());
    }

    [Theory]
    [InlineData("Platinum")]
    [InlineData("Techupgrade")]
    [InlineData("SilverMilestone4")]
    [InlineData("Bronze' OR 1=1 --")]
    public async Task Unknown_certification_types_are_rejected_without_calling_the_database(string certification)
    {
        var client = await SignedInAsync();
        var response = await client.GetAsync($"/api/msme/certifications/{Uri.EscapeDataString(certification)}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Invalid certification.", await response.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_GET_DETAILS");
    }

    [Fact]
    public async Task Returns_the_four_sets_the_page_uses_with_only_the_fields_it_shows()
    {
        var client = await SignedInAsync();
        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/certifications/Bronze");

        Assert.Equal("Acme", json.GetProperty("msme").GetProperty("EnterpriseName").GetString());
        Assert.Equal("ZEDMSME000001", json.GetProperty("msme").GetProperty("ZedId").GetString());
        Assert.Equal("UDYAM-UP-29-0003915", json.GetProperty("basicInfo").GetProperty("UdyogAadharNo").GetString());
        Assert.Equal(3, json.GetProperty("certStatus").GetProperty("BronzeStatus").GetInt32());
        Assert.Equal("Certificates", json.GetProperty("certStatus").GetProperty("CertPath").GetString());
        Assert.Equal("NC raised", json.GetProperty("status").GetProperty("Nc1Raised").GetString());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("status").GetProperty("GetCertified").ValueKind);

        Assert.False(json.GetProperty("msme").TryGetProperty("Password", out _));
        Assert.False(json.GetProperty("msme").TryGetProperty("MobileNo", out _));
        Assert.False(json.GetProperty("basicInfo").TryGetProperty("PanNo", out _));
        Assert.False(json.GetProperty("certStatus").TryGetProperty("FaAmount", out _));
        // Payment and agency sets are not sent.
        Assert.DoesNotContain("TransactionId", json.GetRawText());
        Assert.DoesNotContain("agency@example.test", json.GetRawText());
    }

    [Fact]
    public async Task Missing_status_history_gives_empty_status_fields()
    {
        _host.Sql.Procs["SP_MSME_GET_DETAILS"] = args => FakeSql.Sets(
            [new Dictionary<string, object?> { ["ZedId"] = FakeSql.Arg(args, "ZedId") }], [], [], []);
        var client = await SignedInAsync();
        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/certifications/Silver");

        Assert.Equal(JsonValueKind.Null, json.GetProperty("status").GetProperty("ApplicationReceived").ValueKind);
        Assert.Equal(JsonValueKind.Null, json.GetProperty("basicInfo").GetProperty("UdyogAadharNo").ValueKind);
    }

    [Fact]
    public async Task Programme_not_joined_yet_returns_404_with_a_message()
    {
        _host.Sql.Procs["SP_MSME_GET_DETAILS"] = _ => FakeSql.Sets([], [], [new { BronzeStatus = 0 }], []);
        var client = await SignedInAsync();
        var response = await client.GetAsync("/api/msme/certifications/SilverSurveillance");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("No details are available for this certification yet.", await response.ProblemTitle());
    }
}
