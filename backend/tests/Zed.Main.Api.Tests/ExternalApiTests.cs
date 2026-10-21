using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Zed.Portal.Features.ExternalApi;

namespace Zed.Main.Api.Tests;

/// <summary>
/// The APIs other systems call (Token/…, ApiSecure/…, Msme/… lookups, incentives, Udyami, invoices): legacy
/// addresses and bodies, token rules, input checks, files confined to storage.
/// </summary>
public sealed class ExternalApiTests : IDisposable
{
    private const string ClientsSql = "SELECT Id, Client, ClientId, Token, ReverseToken, AesKey, AesIV FROM dbo.ApiClientTokens";
    private const string DynamicSql = "SELECT TOP 1 Id, DynamicToken, OriginalToken FROM dbo.ApiClientDynamicTokens";

    private const string SecureSecret = "6189ABF58B6A4C5F925CB0C50F3AFB2A83459102F81D439CBCD995D8393183EE";
    private const string SecureClientId = "4947838";
    private const string StaticToken = "STATICTOKEN0001SAATHIPARTNERXYZ";
    private const string ReverseToken = "REVERSETOKEN0001STATEPORTAL";
    private const string UdyamiToken = "UDYAMICLIENTTOKEN000000000001";
    private const string OtherSecret = "OTHERCLIENTSECRET0000000000000000000000";
    private const string Udyam = "UDYAM-UP-29-0003915";
    private const string Cert = "28062022_002426";
    private const string ZedId = "ZEDMSME000123";

    private const string ApiServiceResponseNulls = "\"Data\":null,\"BasicDetails\":null,\"ActivityDetails\":null,\"PlantDetails\":null,\"CertificationDetails\":null";

    private readonly TestHost _host = new();
    private readonly byte[] _aesKey = RandomNumberGenerator.GetBytes(32);
    private readonly List<ClientRow> _clients;
    private readonly List<Dynamic> _dynamic = [];
    private long _nextDynamicId = 100;

    private sealed class ClientRow
    {
        public long Id { get; set; }
        public string? ClientName { get; set; }
        public string? ClientId { get; set; }
        public string Token { get; set; } = "";
        public bool ReverseToken { get; set; }
        public string? AesKey { get; set; }
        public string? AesIV { get; set; }
    }

    private sealed record Dynamic(long Id, string Token, string Original, int AgeMinutes)
    {
        public bool Valid { get; set; } = true;
    }

    public ExternalApiTests()
    {
        _clients =
        [
            new() { Id = 1, ClientName = "RAMP", ClientId = SecureClientId, Token = SecureSecret, AesKey = Convert.ToBase64String(_aesKey), AesIV = Convert.ToBase64String(new byte[16]) },
            new() { Id = 2, ClientName = "Saathi", ClientId = null, Token = StaticToken },
            new() { Id = 3, ClientName = "State portal", ClientId = "STATE01", Token = ReverseToken, ReverseToken = true },
            new() { Id = 4, ClientName = "Udyami", ClientId = "UB", Token = UdyamiToken },
            new() { Id = 5, ClientName = "Other", ClientId = "OTHER", Token = OtherSecret, AesKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)), AesIV = Convert.ToBase64String(new byte[16]) },
        ];

        _host.Sql.Queries[ClientsSql] = _ => _clients.Select(c => (object)new
        {
            c.Id, Client = c.ClientName, c.ClientId, c.Token, ReverseToken = (bool?)c.ReverseToken, c.AesKey, c.AesIV,
        }).ToList();
        _host.Sql.Queries[DynamicSql] = args =>
        {
            var token = FakeSql.Arg(args, "Token");
            var minutes = int.Parse(FakeSql.Arg(args, "Minutes")!);
            return _dynamic.Where(d => d.Valid && string.Equals(d.Token, token, StringComparison.OrdinalIgnoreCase) && d.AgeMinutes <= minutes)
                .OrderByDescending(d => d.Id).Take(1)
                .Select(d => (object)new { d.Id, DynamicToken = d.Token, OriginalToken = d.Original }).ToList();
        };
        _host.Sql.Procs["SP_API_INSERT_DYNAMIC_TOKEN"] = args =>
        {
            var original = FakeSql.Arg(args, "OriginalToken")!;
            foreach (var d in _dynamic.Where(d => d.Original == original)) d.Valid = false;
            _dynamic.Add(new Dynamic(++_nextDynamicId, FakeSql.Arg(args, "DynamicToken")!, original, 0));
            return FakeSql.Sets();
        };
        _host.Sql.Procs["SP_API_GET_AES_KEYS"] = args =>
        {
            var client = _clients.Single(c => c.Token == FakeSql.Arg(args, "Token"));
            if (FakeSql.Arg(args, "IsNewAesIV") == "True") client.AesIV = FakeSql.Arg(args, "AesIV");
            return FakeSql.Sets();
        };
        _host.Sql.Procs["SP_API_GET_CERTIFIED_UNIT_DETAILS_BY_UDYAM"] = args =>
            FakeSql.Arg(args, "UdyamNumber") == Udyam && FakeSql.Arg(args, "CertificationNumber") == Cert
                ? UnitSets(ZedId, gold: "Yes")
                : FakeSql.Sets([], [], []);
    }

    public void Dispose() => _host.Dispose();

    private static Zed.Core.Data.ResultSets UnitSets(string zedId, string bronze = "No", string silver = "No", string gold = "No") => FakeSql.Sets(
        [new
        {
            ZedId = zedId, ApplicationId = "APP1", PUnitIdNo = "U1", PUnitName = "Acme Unit 1", UamNumber = "", PlantIdNo = "P1",
            PPin = "208001", PAddress = "Plot 4", PStateName = "UTTAR PRADESH", PDistrictName = "KANPUR", PLgDistrictCode = "164",
            Activity = "Manufacturing", TwoDigitActivity = "24", FourDigitActivity = "2431", FiveDigitActivity = "24311",
            IncorporationDate = "01/01/2010", WhetherProdCommenced = "Yes", CertificationStatusDate = "01/04/2025", Password = "secret!",
        }],
        [new
        {
            ZedId = zedId, ApplicationId = "APP1", UdyogAadharNo = Udyam, OwnerName = "A Kumar", EnterpriseName = "Acme",
            OrganisationTypeName = "Proprietary", SocialCategoryName = "General", Gender = "Male", PH = "No", PanNo = "ABCDE1234F",
            Address = "Kanpur", StateName = "UTTAR PRADESH", DistrictName = "KANPUR", LgDistrictCode = "164", PinCode = "208001",
            MobileNo = "9999999999", EmailId = "owner@acme.test", MajorActivityName = "Manufacturing", EnterpriseTypee = "Micro",
            CommmenceDate = "01/01/2010", TotalEmp = "12", DicName = "Kanpur", AppliedDate = "01/01/2021",
        }],
        [new
        {
            RegisteredDate = "01/01/2023", BronzeCertified = bronze, SilverCertified = silver, GoldCertified = gold, ExpiryDate = "01/04/2028",
            CertificationFee = "50000.00", SubsidyAmount = "40000.00", AmountPaid = "10000.00",
        }]);

    private WebApplicationFactory<Program> App(params (string Key, string Value)[] settings) => _host.WithWebHostBuilder(b =>
    {
        foreach (var (k, v) in settings) b.UseSetting(k, v);
    });

    private HttpClient Http(params (string Key, string Value)[] settings) =>
        settings.Length == 0 ? _host.CreateClient() : App(settings).CreateClient();

    private string IssueDynamic(string original = SecureSecret, int ageMinutes = 0)
    {
        var token = "dyn-" + Guid.NewGuid().ToString("N");
        _dynamic.Add(new Dynamic(++_nextDynamicId, token, original, ageMinutes));
        return token;
    }

    private IEnumerable<(string Name, object? Args)> CallsTo(string name) => _host.Sql.Calls.Where(c => c.Name == name);

    private static async Task<JsonElement> Json(HttpResponseMessage r)
    {
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.StartsWith("application/json", r.Content.Headers.ContentType?.ToString());
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement.Clone();
    }

    private static FormUrlEncodedContent Form(params (string Key, string Value)[] fields) =>
        new(fields.Select(f => new KeyValuePair<string, string>(f.Key, f.Value)));

    private string Encrypt(object payload, byte[]? iv = null) =>
        AesEnvelope.Encrypt(JsonSerializer.Serialize(payload), _aesKey, iv ?? Convert.FromBase64String(_clients[0].AesIV!));

    private string Decrypt(string data) =>
        AesEnvelope.TryDecrypt(data, _aesKey, Convert.FromBase64String(_clients[0].AesIV!)) ?? throw new Xunit.Sdk.XunitException("did not decrypt");

    private void WriteStored(string relative, byte[] content)
    {
        var path = Path.Combine(_host.StorageRoot, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, content);
    }

    // ===== Token/GenerateToken =====

    [Fact]
    public async Task Token_GenerateToken_issues_a_strong_token_in_the_old_shape()
    {
        var r = await Http().PostAsync("/Token/GenerateToken", Form(("clientId", SecureClientId), ("clientSecret", SecureSecret)));
        var body = await r.Content.ReadAsStringAsync();

        var issued = Assert.Single(_dynamic);
        Assert.Equal(SecureSecret, issued.Original);
        Assert.Equal("{\"StatusCode\":\"1\",\"Token\":\"" + issued.Token + "\"}", body);
        Assert.Equal(43, issued.Token.Length);
        Assert.Matches("^[A-Za-z0-9_-]+$", issued.Token);
        // No token was written to a request log table.
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name is "SP_API_GET_TOKEN" or "SP_API_GET_DYNAMIC_TOKEN");
    }

    [Theory]
    [InlineData(SecureClientId, "WRONG")]
    [InlineData("OTHER", SecureSecret)]      // another client's id with this secret
    [InlineData("", SecureSecret)]
    public async Task Token_GenerateToken_refuses_wrong_credentials(string clientId, string secret)
    {
        var r = await Http().PostAsJsonAsync("/Token/GenerateToken", new { clientId, clientSecret = secret });

        Assert.Equal("{\"StatusCode\":\"401\",\"StatusMessage\":\"Invalid Client ID or Client Secret.\"," + ApiServiceResponseNulls + "}",
            await r.Content.ReadAsStringAsync());
        Assert.Empty(_dynamic);
    }

    [Fact]
    public async Task Token_GenerateToken_accepts_the_secret_in_any_case_as_the_database_did()
    {
        var r = await Http().PostAsync("/Token/GenerateToken", Form(("clientId", SecureClientId), ("clientSecret", SecureSecret.ToLowerInvariant())));
        Assert.Equal("1", (await Json(r)).GetProperty("StatusCode").GetString());
    }

    [Fact]
    public async Task Token_requests_are_rate_limited_per_ip()
    {
        var client = Http(("ExternalApi:TokenRequestsPerMinute", "3"));
        for (var i = 0; i < 3; i++)
            Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/Token/GenerateToken", Form(("clientId", "x"), ("clientSecret", "y")))).StatusCode);

        var limited = await client.PostAsync("/Token/GenerateToken", Form(("clientId", "x"), ("clientSecret", "y")));
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.Equal("{\"StatusCode\":\"429\",\"StatusMessage\":\"Too many requests. Please try again later.\"}", await limited.Content.ReadAsStringAsync());
    }

    // ===== ApiSecure =====

    [Fact]
    public async Task ApiSecure_GenerateToken_round_trip_stores_the_new_iv_and_encrypts_the_token()
    {
        var iv = RandomNumberGenerator.GetBytes(16);
        var r = await Http().PostAsJsonAsync("/ApiSecure/GenerateToken", new
        {
            ClientSecret = SecureSecret,
            AesIV = Convert.ToBase64String(iv),
            EncryptedData = Encrypt(new { ClientId = SecureClientId, ClientSecret = SecureSecret }, iv),
        });

        var json = await Json(r);
        Assert.Equal("200", json.GetProperty("StatusCode").GetString());
        Assert.Equal("Success", json.GetProperty("StatusMessage").GetString());
        Assert.Equal(Convert.ToBase64String(iv), _clients[0].AesIV);
        var token = Assert.Single(_dynamic).Token;
        Assert.Equal("{\"Token\":\"" + token + "\"}", Decrypt(json.GetProperty("Data").GetString()!));
    }

    [Fact]
    public async Task ApiSecure_GenerateToken_does_not_change_the_iv_for_unverified_requests()
    {
        var iv = RandomNumberGenerator.GetBytes(16);
        var before = _clients[0].AesIV;
        var r = await Http().PostAsJsonAsync("/ApiSecure/GenerateToken", new
        {
            ClientSecret = SecureSecret,
            AesIV = Convert.ToBase64String(iv),
            EncryptedData = Encrypt(new { ClientId = "OTHER", ClientSecret = OtherSecret }, iv),   // another client's credentials
        });

        Assert.Equal("401", (await Json(r)).GetProperty("StatusCode").GetString());
        Assert.Equal(before, _clients[0].AesIV);
        Assert.Empty(CallsTo("SP_API_GET_AES_KEYS"));
        Assert.Empty(_dynamic);
    }

    [Fact]
    public async Task ApiSecure_GetDetailsByCertification_answers_encrypted_details()
    {
        var token = IssueDynamic();
        var r = await Http().PostAsJsonAsync("/ApiSecure/GetDetailsByCertification", new
        {
            ClientSecret = SecureSecret,
            EncryptedData = Encrypt(new { Token = token, UdyamNumber = Udyam, CertificationNumber = Cert }),
        });

        var json = await Json(r);
        Assert.Equal("200", json.GetProperty("StatusCode").GetString());
        Assert.Equal(
            "{\"PlantDetails\":{\"UnitName\":\"Acme Unit 1\",\"PAddress\":\"Plot 4\",\"PPin\":\"208001\",\"state_name\":\"UTTAR PRADESH\",\"DISTRICT_NAME\":\"KANPUR\",\"LG_DT_Code\":\"164\"}," +
            "\"CertificationDetails\":{\"CertificationDate\":\"01/04/2025\",\"ExpiryDate\":\"01/04/2028\",\"BronzeCertified\":\"No\",\"SilverCertified\":\"No\",\"GoldCertified\":\"Yes\",\"CertificationFee\":\"50000.00\",\"SubsidyAmount\":\"40000.00\",\"AmountPaid\":\"10000.00\"}}",
            Decrypt(json.GetProperty("Data").GetString()!));
    }

    [Fact]
    public async Task ApiSecure_refuses_another_clients_token_and_expired_tokens()
    {
        var foreign = IssueDynamic(OtherSecret);
        var old = IssueDynamic(SecureSecret, ageMinutes: 90);
        var client = Http(("ExternalApi:TokenLifetimeMinutes", "60"));

        foreach (var token in new[] { foreign, old, "made-up" })
        {
            var r = await client.PostAsJsonAsync("/ApiSecure/GetDetailsByCertification", new
            {
                ClientSecret = SecureSecret,
                EncryptedData = Encrypt(new { Token = token, UdyamNumber = Udyam, CertificationNumber = Cert }),
            });
            var json = await Json(r);
            Assert.Equal("401", json.GetProperty("StatusCode").GetString());
            Assert.Equal("Invalid Token.", json.GetProperty("StatusMessage").GetString());
        }
        Assert.Empty(CallsTo("SP_API_GET_CERTIFIED_UNIT_DETAILS_BY_UDYAM"));
    }

    [Fact]
    public async Task ApiSecure_unknown_secret_or_undecryptable_data_gives_the_old_500_without_details()
    {
        var unknown = await Http().PostAsJsonAsync("/ApiSecure/GetMsmeList", new { ClientSecret = "nope", EncryptedData = "abc" });
        Assert.Equal("{\"StatusCode\":\"500\",\"StatusMessage\":\"Unable process your request, please try again later.\"," + ApiServiceResponseNulls + "}",
            await unknown.Content.ReadAsStringAsync());

        var garbage = await Http().PostAsJsonAsync("/ApiSecure/GetMsmeList", new { ClientSecret = SecureSecret, EncryptedData = "bm90IGVuY3J5cHRlZA==" });
        Assert.Equal("500", (await Json(garbage)).GetProperty("StatusCode").GetString());
    }

    [Fact]
    public async Task ApiSecure_GetMsmeList_returns_the_ramp_rows_and_paging()
    {
        var token = IssueDynamic();
        _host.Sql.Procs["SP_API_RAMP_REPORT_ZED"] = _ => FakeSql.Sets(
            [new { StatusCode = 200, StatusMessage = "Success." }],
            [new { Id = 7, ZedId, UnitName = "Acme", StateName = "UP", Certification = "Bronze", Gender = "Male", UdyogAadharNo = Udyam, MsmeCertId = "9" }],
            [new { TotalCount = 1234, PageNo = 2, PageSize = 50 }]);

        var r = await Http().PostAsJsonAsync("/ApiSecure/GetMsmeList", new
        {
            ClientSecret = SecureSecret,
            EncryptedData = Encrypt(new { Token = token, PageNo = "2", PageSize = "50" }),
        });

        var json = await Json(r);
        Assert.Equal(1234, json.GetProperty("ToalCount").GetInt32());
        Assert.Equal(2, json.GetProperty("PageNo").GetInt32());
        Assert.Equal("200", json.GetProperty("StatusCode").GetString());
        var row = Assert.Single(json.GetProperty("msmeList").EnumerateArray().ToList());
        Assert.Equal("7", row.GetProperty("Id").GetString());
        Assert.Equal(ZedId, row.GetProperty("ZedId").GetString());
        Assert.Equal("", row.GetProperty("ReasonForRejection").GetString());
        var call = Assert.Single(CallsTo("SP_API_RAMP_REPORT_ZED"));
        Assert.Equal("2", FakeSql.Arg(call.Args, "PageNo"));
        Assert.Equal("50", FakeSql.Arg(call.Args, "PageSize"));
    }

    [Fact]
    public async Task ApiSecure_GetMsmeList_passes_the_procedures_page_size_error_and_refuses_bad_numbers()
    {
        var token = IssueDynamic();
        _host.Sql.Procs["SP_API_RAMP_REPORT_CONSULTANCY"] = _ => FakeSql.Sets([new { StatusCode = 400, StatusMessage = "Page Size should be less than 1000." }], [], []);

        var tooBig = await Json(await Http().PostAsJsonAsync("/ApiSecure/GetMsmeHandholdingList", new
        {
            ClientSecret = SecureSecret,
            EncryptedData = Encrypt(new { Token = token, PageNo = "1", PageSize = "5000" }),
        }));
        Assert.Equal("400", tooBig.GetProperty("StatusCode").GetString());
        Assert.Equal("Page Size should be less than 1000.", tooBig.GetProperty("StatusMessage").GetString());

        var text = await Json(await Http().PostAsJsonAsync("/ApiSecure/GetMsmeHandholdingList", new
        {
            ClientSecret = SecureSecret,
            EncryptedData = Encrypt(new { Token = token, PageNo = "1; DROP", PageSize = "10" }),
        }));
        Assert.Equal("400", text.GetProperty("StatusCode").GetString());
        Assert.Single(CallsTo("SP_API_RAMP_REPORT_CONSULTANCY"));
    }

    [Theory]
    [InlineData("/ApiSecure/GetAesKey")]
    [InlineData("/ApiSecure/GetAesIV")]
    [InlineData("/ApiSecure/GenerateEncryptedTokenRequest")]
    [InlineData("/ApiSecure/GetDetailsByCertificationDecrypt")]
    [InlineData("/Unit/GetDetails")]
    public async Task Test_helpers_and_the_hotel_unit_api_are_not_served(string path)
    {
        var r = await Http().PostAsJsonAsync(path, new { ClientSecret = SecureSecret, ClientId = SecureClientId, token = StaticToken });
        var body = await r.Content.ReadAsStringAsync();
        Assert.DoesNotContain("AesKey", body);
        Assert.DoesNotContain("StatusCode", body);
    }

    // ===== Msme/… lookups =====

    [Fact]
    public async Task GetZedDetails_accepts_only_static_tokens_without_a_client_id_and_maps_the_old_fields()
    {
        _host.Sql.Procs["SP_API_GET_CERTIFIED_UNIT_DETAILS"] = _ => UnitSets(ZedId, bronze: "Yes");

        var refused = await Json(await Http().GetAsync($"/Msme/GetZedDetails?token={SecureSecret}&zedid={ZedId}&email=owner@acme.test"));
        Assert.Equal("401", refused.GetProperty("StatusCode").GetString());

        var r = await Http().GetAsync($"/Msme/GetZedDetails?token={StaticToken}&zedid={ZedId}&email=owner@acme.test");
        var json = await Json(r);
        Assert.Equal("200", json.GetProperty("StatusCode").GetString());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("Data").ValueKind);
        var basic = json.GetProperty("BasicDetails");
        Assert.Equal("Proprietary", basic.GetProperty("OrganisationType").GetString());
        Assert.Equal("01/01/2010", basic.GetProperty("IncorporationDate").GetString());
        Assert.Equal("Micro", basic.GetProperty("EnterpriseType").GetString());
        Assert.Equal("Acme Unit 1", json.GetProperty("PlantDetails").GetProperty("UnitName").GetString());
        Assert.Equal("2431", json.GetProperty("ActivityDetails").GetProperty("Four_DigitActivity").GetString());
        Assert.Equal("Yes", json.GetProperty("CertificationDetails").GetProperty("BronzeCertified").GetString());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("CertificationDetails").GetProperty("ExpiryDate").ValueKind);
        Assert.DoesNotContain("secret!", await r.Content.ReadAsStringAsync());
        Assert.Single(CallsTo("SP_API_GET_CERTIFIED_UNIT_DETAILS"));
    }

    [Fact]
    public async Task Lookups_refuse_unsafe_input_before_the_database()
    {
        var r = await Http().GetAsync($"/Msme/GetDetailsByUdyam?token={StaticToken}&udyamNumber=%3Cscript%3E&certificationNumber={Cert}");
        var json = await Json(r);
        Assert.Equal("400", json.GetProperty("StatusCode").GetString());
        Assert.Empty(CallsTo("SP_API_GET_CERTIFIED_UNIT_DETAILS_BY_UDYAM"));
    }

    [Fact]
    public async Task GetDetailsByUdyam_and_GetDetailsByCertification_use_their_own_token_kinds()
    {
        var byUdyam = await Json(await Http().GetAsync($"/Msme/GetDetailsByUdyam?token={StaticToken}&udyamNumber={Udyam}&certificationNumber={Cert}"));
        Assert.Equal("200", byUdyam.GetProperty("StatusCode").GetString());
        Assert.Equal("Yes", byUdyam.GetProperty("CertificationDetails").GetProperty("GoldCertified").GetString());

        // GetDetailsByCertification takes a token from GenerateToken only.
        var withStatic = await Json(await Http().PostAsync("/Msme/GetDetailsByCertification",
            Form(("token", StaticToken), ("udyamNumber", Udyam), ("certificationNumber", Cert))));
        Assert.Equal("401", withStatic.GetProperty("StatusCode").GetString());

        var dynamic = await Json(await Http().PostAsync("/Msme/GetDetailsByCertification",
            Form(("token", IssueDynamic()), ("udyamNumber", Udyam), ("certificationNumber", "OTHER"))));
        Assert.Equal("404", dynamic.GetProperty("StatusCode").GetString());
        Assert.Equal("Invalid Details.", dynamic.GetProperty("StatusMessage").GetString());
    }

    [Fact]
    public async Task DownloadCertificate_serves_the_highest_level_from_storage()
    {
        var pdf = "%PDF-1.4 gold"u8.ToArray();
        WriteStored($"Certifications/SA/{ZedId}/Gold.pdf", pdf);

        var r = await Http().GetAsync($"/Msme/DownloadCertificate?token={StaticToken}&udyamNumber={Udyam}&certificationNumber={Cert}");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("application/pdf", r.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Cert + ".pdf", r.Content.Headers.ContentDisposition?.FileName?.Trim('"'));
        Assert.Equal(pdf, await r.Content.ReadAsByteArrayAsync());

        Assert.Equal(HttpStatusCode.Unauthorized, (await Http().GetAsync($"/Msme/DownloadCertificate?token=x&udyamNumber={Udyam}&certificationNumber={Cert}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Http().GetAsync($"/Msme/DownloadCertificate?token={StaticToken}&udyamNumber={Udyam}&certificationNumber=X")).StatusCode);
    }

    [Fact]
    public async Task Certificate_paths_never_leave_storage_even_with_a_bad_zed_id_from_the_database()
    {
        WriteStored("Certifications/SA/secret/Gold.pdf", "%PDF-x"u8.ToArray());
        _host.Sql.Procs["SP_API_GET_CERTIFIED_UNIT_DETAILS_BY_UDYAM"] = _ => UnitSets("../secret", gold: "Yes");

        var r = await Http().GetAsync($"/Msme/DownloadCertificate?token={StaticToken}&udyamNumber={Udyam}&certificationNumber={Cert}");
        Assert.Equal(HttpStatusCode.InternalServerError, r.StatusCode);
        Assert.Empty(await r.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task GetZedDetailsByUdyam_includes_the_certificate_as_base64()
    {
        var pdf = "%PDF-1.4 bronze"u8.ToArray();
        WriteStored($"Certificates/DA/{ZedId}/Bronze.pdf", pdf);
        _host.Sql.Procs["SP_API_GET_CERTIFIED_UNIT_DETAILS_BY_UDYAM"] = _ => UnitSets(ZedId, bronze: "Yes");

        var json = await Json(await Http().PostAsync("/Msme/GetZedDetailsByUdyam", Form(("token", StaticToken), ("udyamNumber", Udyam), ("certificationNumber", Cert))));
        var cert = json.GetProperty("CertificationDetails");
        Assert.Equal("01/04/2028", cert.GetProperty("ExpiryDate").GetString());
        Assert.Equal(Convert.ToBase64String(pdf), cert.GetProperty("Certificate").GetString());
    }

    [Fact]
    public async Task GetDetailsByCertifications_passes_the_pairs_as_a_table()
    {
        var token = IssueDynamic(UdyamiToken);
        _host.Sql.Procs["SP_API_GET_CERTIFIED_UNIT_DETAILS_BY_MULTIPLE_UDYAMS"] = _ => FakeSql.Sets(
            [new { Id = 1 }],
            [new { PUnitName = "Acme", PStateName = "UP", PDistrictName = "KANPUR", UdyamNo = Udyam, CertificateNo = Cert, CertificationType = "Gold", CertificationStatusDate = "01/04/2028", Expired = "No" }]);

        var r = await Http().PostAsJsonAsync("/Msme/GetDetailsByCertifications", new
        {
            token,
            udyamNumbers = new[] { new { UdyamNumber = Udyam, CertificationNumber = Cert }, new { UdyamNumber = "UDYAM-MH-01-0000001", CertificationNumber = "C2" } },
        });

        var json = await Json(r);
        Assert.Equal("200", json.GetProperty("StatusCode").GetString());
        Assert.Equal("Gold", json.GetProperty("certifications")[0].GetProperty("CertificationType").GetString());
        var args = (Dapper.DynamicParameters)Assert.Single(CallsTo("SP_API_GET_CERTIFIED_UNIT_DETAILS_BY_MULTIPLE_UDYAMS")).Args!;
        Assert.Contains("ParametersTable", args.ParameterNames);

        var refused = await Json(await Http().PostAsJsonAsync("/Msme/GetDetailsByCertifications", new { token = StaticToken, udyamNumbers = Array.Empty<object>() }));
        Assert.Equal("{\"StatusCode\":\"401\",\"StatusMessage\":\"Invalid Token.\",\"certifications\":null}", refused.GetRawText());
    }

    [Fact]
    public async Task GetStateCertificationsByPage_no_longer_multiplies_the_fee_by_the_page_number()
    {
        var token = IssueDynamic();
        _host.Sql.Procs["SP_API_GET_STATE_CERTIFIED_UNIT_DETAILS"] = _ => FakeSql.Sets(
            [new { Id = 1 }],
            [new { StatusCode = 200, StatusMessage = "Success." }],
            [new { RefId = 11, EnterpriseName = "Acme", ApplicationFee = 50000.00m, CentralGovernmentSubsidyPercentage = 80.0m, AndhraPradeshGovernmentSubsidyPercentage = 10m, AndhraPradeshGovernmentSubsidyAmount = 5000.5m, JoiningReward = "No" }],
            [new { TotalCount = 41, PageNo = 3, PageSize = 20 }]);

        var json = await Json(await Http().PostAsJsonAsync("/Msme/GetStateCertificationsByPage", new { token, applicationType = "Certification", pageNo = 3, pageSize = 20 }));

        Assert.Equal("200", json.GetProperty("StatusCode").GetString());
        Assert.Equal(41, json.GetProperty("TotalCount").GetInt32());
        Assert.Equal(3, json.GetProperty("PageNo").GetInt32());
        var row = json.GetProperty("certifications")[0];
        Assert.Equal(50000m, row.GetProperty("ApplicationFee").GetDecimal());
        Assert.Equal("11", row.GetProperty("RefId").GetString());
        Assert.Equal(5000.5m, row.GetProperty("AndhraPradeshGovernmentSubsidyAmount").GetDecimal());
    }

    [Fact]
    public async Task GetCertifiedUnits_passes_filters_and_numbers()
    {
        _host.Sql.Procs["SP_API_GET_LIST_OF_CERTIFIED_MSME"] = _ => FakeSql.Sets(
            [new { Sno = 1, EnterpriseName = "Acme", TwoDigitActivity = "24", UnitAddress = "Kanpur", StateName = "UP", EnterpriseTypee = "Micro", Certification = "Gold" }],
            [new { TotalCounts = 1, PageNo = 1, NoOfRecords = 200 }]);

        var json = await Json(await Http().GetAsync($"/Msme/GetCertifiedUnits?token={StaticToken}&state=9&pageNo=1&pageSize=50&sector="));
        Assert.Equal("200", json.GetProperty("StatusCode").GetString());
        Assert.Equal(200, json.GetProperty("PageSize").GetInt32());
        Assert.Equal("1", json.GetProperty("Data")[0].GetProperty("Sno").GetString());
        var call = Assert.Single(CallsTo("SP_API_GET_LIST_OF_CERTIFIED_MSME"));
        Assert.Equal("9", FakeSql.Arg(call.Args, "State"));
        Assert.Null(FakeSql.Arg(call.Args, "Sector"));
        Assert.Equal("50", FakeSql.Arg(call.Args, "NoOfRecords"));

        var bad = await Json(await Http().GetAsync($"/Msme/GetCertifiedUnits?token={StaticToken}&pageNo=abc"));
        Assert.Equal("400", bad.GetProperty("StatusCode").GetString());
    }

    // ===== Incentives =====

    private static object Incentive(string token, string incentiveName = "Capital subsidy", string amount = "125000.50") => new
    {
        token,
        UdyamNo = Udyam, Certificateno = Cert, Pin = "208001", ApplicationId = "APP-9", UnitName = "Acme", District = "Kanpur",
        FCI = "1000000", ServiceName = "Capital Investment Subsidy", ApprovalId = "AP-1", IncentiveName = incentiveName,
        DisbursedAmount = amount, DisbursedDate = "2026-03-31", AppliedDate = "15/01/2026",
    };

    [Fact]
    public async Task SubmitIncentive_passes_the_request_to_the_procedure_with_unambiguous_dates()
    {
        _host.Sql.Procs["SP_API_SUBMIT_INCENTIVE_DETAILS"] = _ => FakeSql.Sets([new { StatusCode = 200, StatusMessage = "Success" }]);
        var token = IssueDynamic(ReverseToken);

        var r = await Http().PostAsJsonAsync("/Msme/SubmitIncentive", Incentive(token));

        Assert.Equal("{\"StatusCode\":\"200\",\"StatusMessage\":\"Success\"}", await r.Content.ReadAsStringAsync());
        var call = Assert.Single(CallsTo("SP_API_SUBMIT_INCENTIVE_DETAILS"));
        Assert.Equal(token, FakeSql.Arg(call.Args, "Token"));
        Assert.Equal("2026-03-31T00:00:00", FakeSql.Arg(call.Args, "DisbursedDate"));
        Assert.Equal("2026-01-15T00:00:00", FakeSql.Arg(call.Args, "AppliedDate"));
        Assert.Null(FakeSql.Arg(call.Args, "ApprovedDate"));
        Assert.Equal("125000.50", FakeSql.Arg(call.Args, "DisbursedAmount"));
    }

    [Fact]
    public async Task SubmitIncentive_accepts_reverse_static_tokens_but_V2_only_issued_tokens()
    {
        _host.Sql.Procs["SP_API_SUBMIT_INCENTIVE_DETAILS"] = _ => FakeSql.Sets([new { StatusCode = 200, StatusMessage = "Success" }]);

        Assert.Equal("200", (await Json(await Http().PostAsJsonAsync("/Msme/SubmitIncentive", Incentive(ReverseToken)))).GetProperty("StatusCode").GetString());

        foreach (var (path, token) in new[] { ("/Msme/SubmitIncentive", StaticToken), ("/Msme/SubmitIncentiveV2", ReverseToken), ("/Msme/SubmitIncentiveV2", "made-up") })
        {
            var json = await Json(await Http().PostAsJsonAsync(path, Incentive(token)));
            Assert.Equal("401", json.GetProperty("StatusCode").GetString());
            Assert.Equal("Unauthorized User", json.GetProperty("StatusMessage").GetString());
        }
        Assert.Single(CallsTo("SP_API_SUBMIT_INCENTIVE_DETAILS"));
        Assert.Empty(CallsTo("SP_API_SUBMIT_INCENTIVE_DETAILS_ALL_OPTIONAL"));
    }

    [Theory]
    [InlineData("<img src=x onerror=alert(1)>", "100")]
    [InlineData("{{constructor}}", "100")]
    [InlineData("Capital subsidy", "1,00,000 rupees")]
    public async Task SubmitIncentiveV2_now_checks_input_like_V1(string incentiveName, string amount)
    {
        var json = await Json(await Http().PostAsJsonAsync("/Msme/SubmitIncentiveV2", Incentive(IssueDynamic(), incentiveName, amount)));

        Assert.Equal("{\"StatusCode\":\"400\",\"StatusMessage\":\"Bad Request\"}", json.GetRawText());
        Assert.Empty(CallsTo("SP_API_SUBMIT_INCENTIVE_DETAILS_ALL_OPTIONAL"));
    }

    [Fact]
    public async Task Incentive_tokens_older_than_the_configured_lifetime_are_refused()
    {
        var json = await Json(await Http(("ExternalApi:TokenLifetimeMinutes", "30"))
            .PostAsJsonAsync("/Msme/SubmitIncentiveV2", Incentive(IssueDynamic(ageMinutes: 45))));

        Assert.Equal("401", json.GetProperty("StatusCode").GetString());
        Assert.Empty(CallsTo("SP_API_SUBMIT_INCENTIVE_DETAILS_ALL_OPTIONAL"));
    }

    [Fact]
    public async Task Errors_never_return_exception_text()
    {
        _host.Sql.Procs["SP_API_SUBMIT_INCENTIVE_DETAILS_ALL_OPTIONAL"] = _ => throw new InvalidOperationException("Login failed for user 'sa' at 10.0.0.5");

        var r = await Http().PostAsJsonAsync("/Msme/SubmitIncentiveV2", Incentive(IssueDynamic()));

        var body = await r.Content.ReadAsStringAsync();
        Assert.Equal("{\"StatusCode\":\"500\",\"StatusMessage\":null," + ApiServiceResponseNulls + "}", body);
    }

    // ===== Udyami =====

    private static object Registration(string token, string email = "owner@acme.test") => new
    {
        Token = token, RequestId = "REQ-1", ReqTimeStamp = "2026-10-21T10:00:00", UserMobileNo = "9999999999", UserEmail = email,
        UdyamDetails = new { UdyogAadharNo = Udyam, EnterpriseName = "Acme", OwnerName = "A Kumar", PanNo = "ABCDE1234F", State_Id = "9", EmailId = "owner@acme.test" },
        PlantDetails = new { PlantIdNo = "P1", UnitName = "Acme Unit 1", PAddress = "Plot 4", ZedCertified = false },
        ActivityDetails = new { Activity = "Manufacturing", Two_DigitActivity = "24" },
        Password = "attacker-chosen",
    };

    [Fact]
    public async Task RegisterPlant_registers_returns_the_pledge_certificate_and_mails_it()
    {
        _host.Sql.Procs["SP_API_MSME_INSERT_UDYAM_DETAILS"] = args => FakeSql.Sets(
            [new { Status = 200, ErrorMessage = "Success.", RequestId = "REQ-1", UdyogAadharNo = Udyam, PlantId = "P1", RefId = "UB000001", FileType = "Pledge", FileExtension = ".pdf" }],
            [new { ZedId = "ZEDMSME999001", MsmeId = 5, Password = FakeSql.Arg(args, "Password"), CertificateNo = "PLEDGE-1", QrCodeNo = "QR1", DateOfPledge = "21-10-2026", Address = "Plot 4, Kanpur" }]);

        var r = await Http().PostAsJsonAsync("/Msme/RegisterPlant", Registration(UdyamiToken));

        var json = await Json(r);
        Assert.Equal("200", json.GetProperty("StatusCode").GetString());
        Assert.Equal("ZEDMSME999001", json.GetProperty("ZedId").GetString());
        Assert.Equal("UB000001", json.GetProperty("RefId").GetString());
        Assert.Equal("Pledge", json.GetProperty("FileType").GetString());
        var pdf = Convert.FromBase64String(json.GetProperty("Base64File").GetString()!);
        Assert.Equal("%PDF-"u8.ToArray(), pdf[..5]);
        Assert.True(File.Exists(Path.Combine(_host.StorageRoot, "Certificates", "ZEDMSME999001", "Pledge.pdf")));

        var call = Assert.Single(CallsTo("SP_API_MSME_INSERT_UDYAM_DETAILS"));
        var password = FakeSql.Arg(call.Args, "Password")!;
        Assert.Equal(10, password.Length);
        Assert.NotEqual("attacker-chosen", password);
        Assert.Equal("ABCDE1234F", FakeSql.Arg(call.Args, "PanNo"));
        Assert.Equal("owner@acme.test", FakeSql.Arg(call.Args, "PledgeEmailId"));
        Assert.DoesNotContain(password, await r.Content.ReadAsStringAsync());

        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("owner@acme.test", mail.To);
        Assert.Equal("Pledge.pdf", Assert.Single(mail.Attachments!).FileName);
        Assert.False(Directory.Exists(Path.Combine(AppContext.BaseDirectory, "App_Data", "Json", "API")));
    }

    [Fact]
    public async Task RegisterPlant_refuses_bad_tokens_and_input_without_calling_the_procedure()
    {
        var bad = await Json(await Http().PostAsJsonAsync("/Msme/RegisterPlant", Registration("wrong")));
        Assert.Equal("401", bad.GetProperty("StatusCode").GetString());
        Assert.Equal("Invalid Token.", bad.GetProperty("StatusMessage").GetString());

        var badMail = await Json(await Http().PostAsJsonAsync("/Msme/RegisterPlant", Registration(UdyamiToken, "a@b.test, victim@x.test")));
        Assert.Equal("400", badMail.GetProperty("StatusCode").GetString());

        Assert.Empty(CallsTo("SP_API_MSME_INSERT_UDYAM_DETAILS"));
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task RegisterPlant_passes_the_procedures_refusal_through()
    {
        _host.Sql.Procs["SP_API_MSME_INSERT_UDYAM_DETAILS"] = _ => FakeSql.Sets([new { Status = 400, ErrorMessage = "Plant (P1) Already registered." }]);

        var json = await Json(await Http().PostAsJsonAsync("/Msme/RegisterPlant", Registration(UdyamiToken)));

        Assert.Equal("400", json.GetProperty("StatusCode").GetString());
        Assert.Equal("Plant (P1) Already registered.", json.GetProperty("StatusMessage").GetString());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("ZedId").ValueKind);
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task GetCertificatesByUdyam_lists_units_in_the_old_shape()
    {
        _host.Sql.Procs["SP_API_MSME_GET_CERTIFICATIONS_BY_UDYAM_NO"] = _ => FakeSql.Sets(
            [new { Status = 200, ErrorMessage = "Success." }],
            [new { ZedId, UdyogAadharNo = Udyam, PlantId = "P1", Date = "01/02/2025", ApplicationStatus = "Gold Certified", Certification = "Gold", RefId = "ZED_77", FileName = "Gold_Certification_77" }]);

        var json = await Json(await Http().PostAsync("/Msme/GetCertificatesByUdyam", Form(("Udyamid", Udyam), ("RequestId", "R1"), ("Token", UdyamiToken))));

        Assert.Equal("200", json.GetProperty("StatusCode").GetString());
        var unit = json.GetProperty("Certificates")[0];
        Assert.Equal(ZedId, unit.GetProperty("ZED").GetString());
        Assert.Equal("Gold Certified", unit.GetProperty("Applicationstatus").GetString());
        Assert.Equal("ZED_77", unit.GetProperty("file")[0].GetProperty("FileID").GetString());
    }

    [Fact]
    public async Task GetCertificateDetails_reads_the_units_own_certificate_from_storage()
    {
        var pdf = "%PDF-1.4 pledge"u8.ToArray();
        WriteStored($"Certificates/{ZedId}/Pledge.pdf", pdf);
        WriteStored("Certificates/ZEDMSME000999/Pledge.pdf", "%PDF-other"u8.ToArray());
        var pledgePath = $"/Certificates/{ZedId}/Pledge.pdf";
        _host.Sql.Procs["SP_API_MSME_GET_CERTIFICATIONS_BY_UDYAM_NO_AND_ZEDID"] = _ => FakeSql.Sets(
            [new { Status = 200, ErrorMessage = "Success." }],
            [new { ZedId, UdyogAadharNo = Udyam, PlantId = "P1", Certification = "Pledge", FileExtension = ".pdf", FileName = "Pledge_Certification_5", PledgePath = pledgePath }]);

        var json = await Json(await Http().GetAsync($"/Msme/GetCertificateDetails?Udyamid={Udyam}&ZEDID={ZedId}&FileID=ZED_5&RequestId=R1&Token={UdyamiToken}"));
        Assert.Equal("200", json.GetProperty("StatusCode").GetString());
        Assert.Equal(Convert.ToBase64String(pdf), json.GetProperty("file")[0].GetProperty("File").GetString());

        // A path naming another unit (or leaving storage) is not read.
        pledgePath = "/Certificates/ZEDMSME000999/Pledge.pdf";
        var other = await Json(await Http().GetAsync($"/Msme/GetCertificateDetails?Udyamid={Udyam}&ZEDID={ZedId}&FileID=ZED_5&RequestId=R1&Token={UdyamiToken}"));
        Assert.Equal("500", other.GetProperty("StatusCode").GetString());
        Assert.Equal("Certificate file not found.", other.GetProperty("StatusMessage").GetString());
        Assert.False(other.TryGetProperty("file", out _));
    }

    // ===== UploadReceiptInvoice =====

    private static object Invoice(string token, string invoiceNo = "ZED/2526/3461", string zedId = ZedId, string type = "Invoice", byte[]? content = null) => new
    {
        token, zedId, documentType = type, tadaInvoiceNo = invoiceNo,
        base64InvoiceData = Convert.ToBase64String(content ?? "%PDF-1.7 invoice"u8.ToArray()),
    };

    [Fact]
    public async Task UploadReceiptInvoice_stores_the_pdf_where_my_documents_finds_it()
    {
        _host.Sql.Procs["SP_API_FINANCE_SAVE_INVOICE_RECEIPT_DETAILS"] = _ => FakeSql.Sets([new { Status = "SUCCESS", ErrorMessage = "Invoice Saved Successfully" }]);

        var json = await Json(await Http().PostAsJsonAsync("/Msme/UploadReceiptInvoice", Invoice(IssueDynamic())));

        Assert.Equal("SUCCESS", json.GetProperty("StatusCode").GetString());
        Assert.Equal("Invoice Saved Successfully", json.GetProperty("StatusMessage").GetString());
        var call = Assert.Single(CallsTo("SP_API_FINANCE_SAVE_INVOICE_RECEIPT_DETAILS"));
        Assert.Equal($"ReceiptInvoice\\ZED/2526/3461_{ZedId}_Invoice.pdf", FakeSql.Arg(call.Args, "InvoicePath"));
        var file = Path.Combine(_host.StorageRoot, "ReceiptInvoice", "ZED", "2526", $"3461_{ZedId}_Invoice.pdf");
        Assert.Equal("%PDF-1.7 invoice"u8.ToArray(), File.ReadAllBytes(file));
        Assert.Empty(Directory.GetFiles(Path.GetDirectoryName(file)!, "*.tmp"));
    }

    [Theory]
    [InlineData("../../web.config", ZedId, "Invoice", false)]
    [InlineData("ZED/2526/3461", "..\\..\\x", "Invoice", false)]
    [InlineData("ZED/2526/3461", ZedId, "Invoice.aspx;", false)]
    [InlineData("ZED/2526/3461", ZedId, "Invoice", true)]        // not a PDF
    public async Task UploadReceiptInvoice_refuses_unsafe_values_and_content(string invoiceNo, string zedId, string type, bool notPdf)
    {
        var json = await Json(await Http().PostAsJsonAsync("/Msme/UploadReceiptInvoice",
            Invoice(IssueDynamic(), invoiceNo, zedId, type, notPdf ? "<%@ Page Language=\"C#\" %>"u8.ToArray() : null)));

        Assert.Equal("400", json.GetProperty("StatusCode").GetString());
        Assert.Empty(CallsTo("SP_API_FINANCE_SAVE_INVOICE_RECEIPT_DETAILS"));
        Assert.False(Directory.Exists(Path.Combine(_host.StorageRoot, "ReceiptInvoice")));
    }

    [Fact]
    public async Task UploadReceiptInvoice_keeps_no_file_for_an_unknown_invoice_or_token()
    {
        _host.Sql.Procs["SP_API_FINANCE_SAVE_INVOICE_RECEIPT_DETAILS"] = _ => FakeSql.Sets([new { Status = "ERROR", ErrorMessage = "TadaInvoiceNo Not Found" }]);

        var json = await Json(await Http().PostAsJsonAsync("/Msme/UploadReceiptInvoice", Invoice(IssueDynamic())));
        Assert.Equal("ERROR", json.GetProperty("StatusCode").GetString());
        Assert.Empty(Directory.GetFiles(Path.Combine(_host.StorageRoot, "ReceiptInvoice"), "*", SearchOption.AllDirectories));

        var noToken = await Json(await Http().PostAsJsonAsync("/Msme/UploadReceiptInvoice", Invoice(StaticToken)));
        Assert.Equal("401", noToken.GetProperty("StatusCode").GetString());
        Assert.Single(CallsTo("SP_API_FINANCE_SAVE_INVOICE_RECEIPT_DETAILS"));
    }

    // ===== Input rules =====

    [Theory]
    [InlineData(null, true)]
    [InlineData("Capital Investment Subsidy", true)]
    [InlineData("<b>", false)]
    [InlineData("JavaScript:void(0)", false)]
    [InlineData("subSCRIPTion", false)]    // fn_IsSafeInput's '%script%' also matches this, as in the database
    [InlineData("{{7*7}}", false)]
    public void SafeInput_follows_fn_IsSafeInput(string? value, bool safe) => Assert.Equal(safe, SafeInput.IsSafe(value));

    [Fact]
    public void Aes_envelope_matches_cbc_pkcs7()
    {
        var key = RandomNumberGenerator.GetBytes(32);
        var iv = RandomNumberGenerator.GetBytes(16);
        using var aes = Aes.Create();
        aes.Key = key;
        var expected = Convert.ToBase64String(aes.EncryptCbc(Encoding.UTF8.GetBytes("{\"a\":\"ü\"}"), iv));

        Assert.Equal(expected, AesEnvelope.Encrypt("{\"a\":\"ü\"}", key, iv));
        Assert.Equal("{\"a\":\"ü\"}", AesEnvelope.TryDecrypt(expected, key, iv));
        Assert.Null(AesEnvelope.TryDecrypt("not base64!", key, iv));
        Assert.Null(AesEnvelope.TryDecrypt(Convert.ToBase64String(new byte[15]), key, iv));   // not a whole block
    }
}
