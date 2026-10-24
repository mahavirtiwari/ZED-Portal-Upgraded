using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Zed.Portal.Features.Remote;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Staff accounts of the remote-assessment tests (role and site-verification sub-role).</summary>
internal static class RemoteTestUsers
{
    // UserId → (RoleId, SiteVerification)
    public static readonly Dictionary<string, (int Role, int Sa)> Users = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ASSESSOR1"] = (3, 1),   // lead assessor of ZEDMSME000001 Silver
        ["ASSESSOR2"] = (3, 1),   // co-assessor
        ["ASSESSOR3"] = (3, 1),   // not allotted
        ["ASSESSORDA"] = (3, 0),  // desktop verification only
        ["AGENCY1"] = (2, 1),
        ["ADMIN1"] = (1, 1),
    };

    public static void Register(TestHost host)
    {
        host.Sql.Procs["SP_GET_USER_DETAILS"] = args =>
            FakeSql.Arg(args, "UserId") is { } id && Users.TryGetValue(id, out var u)
                ? FakeSql.Sets([new { UserId = id.ToUpperInvariant(), UserName = id + " name", RoleId = u.Role, Email = "x@y.test" }], [new { ERRORMSG = "SUCCESS" }])
                : FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
        host.Sql.Procs["SP_GET_SUB_ROLE"] = args =>
        {
            var u = Users[FakeSql.Arg(args, "UserId")!];
            return FakeSql.Sets([new { DesktopVerification = 1, SiteVerification = u.Sa, FinancialVerification = 0 }]);
        };
    }

    /// <summary>A browser-like client (cookies + XSRF header) for any factory of the test host.</summary>
    public static async Task<HttpClient> SignInAsync(WebApplicationFactory<Program> factory, string? userId)
    {
        var cookies = new CookieContainer();
        var client = factory.CreateDefaultClient(new Xsrf(cookies, factory.Server.BaseAddress));
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        if (userId is not null)
            (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    private sealed class Xsrf(CookieContainer cookies, Uri baseAddress) : DelegatingHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var uri = request.RequestUri!.IsAbsoluteUri ? request.RequestUri : new Uri(baseAddress, request.RequestUri);
            var header = cookies.GetCookieHeader(uri);
            if (header.Length > 0) request.Headers.Add("Cookie", header);
            if (request.Method != HttpMethod.Get && cookies.GetCookies(uri)["XSRF-TOKEN"] is { } x)
                request.Headers.Add("X-XSRF-TOKEN", Uri.UnescapeDataString(x.Value));
            var response = await base.SendAsync(request, ct);
            if (response.Headers.TryGetValues("Set-Cookie", out var set))
                foreach (var c in set) cookies.SetCookies(uri, c);
            return response;
        }
    }
}

public sealed class RemoteAssessmentTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private const string Base = "/api/staff/remote/" + Zed + "/Silver";
    private const string Secret = "test-secret-0123456789";

    private readonly TestHost _host = new();
    private readonly WebApplicationFactory<Program> _video;
    private int _status = 9;
    private bool _confirmAllowed = true;
    private bool _raisesNc;
    private readonly List<Dictionary<string, object?>> _photos = [];
    private long _nextPhotoId = 1000;

    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01];
    private static string JpegDataUrl => "data:image/jpeg;base64," + Convert.ToBase64String(Jpeg);

    public RemoteAssessmentTests()
    {
        RemoteTestUsers.Register(_host);
        _video = _host.WithWebHostBuilder(b =>
        {
            b.UseSetting("Twilio:AccountSid", "ACtest");
            b.UseSetting("Twilio:ApiKey", "SKtest");
            b.UseSetting("Twilio:ApiSecret", Secret);
        });

        _host.Sql.Queries[RemoteAssessmentController.RecordSql[..60]] = args => (FakeSql.Arg(args, "ZedId"), FakeSql.Arg(args, "Certification")) switch
        {
            (Zed, "Silver") => [new { Id = 5L, ZedId = Zed, Certification = "Silver", CertificationStatus = _status, NcCount = 0, SiteAssessorId = "ASSESSOR1", CoAssessorId = "ASSESSOR2", ModeOfAssessment = "Remote Assessment" }],
            ("ZEDMSME000002", "Silver") => [new { Id = 6L, ZedId = "ZEDMSME000002", Certification = "Silver", CertificationStatus = 9, NcCount = 0, SiteAssessorId = "ASSESSOR1", CoAssessorId = (string?)null, ModeOfAssessment = "Onsite Assessment" }],
            _ => [],
        };
        _host.Sql.Queries["SELECT TOP 1 CAST(Id AS bigint) AS Id, NcCount FROM MsmeRequirements"] = args =>
            FakeSql.Arg(args, "Id") == "51" && FakeSql.Arg(args, "ZedId") == Zed ? [new { Id = 51L, NcCount = 0 }] : [];
        _host.Sql.Queries["SELECT TOP 1 CAST(Id AS bigint) AS Id, NcCount FROM MsmeProducts"] = args =>
            FakeSql.Arg(args, "Id") == "31" && FakeSql.Arg(args, "ZedId") == Zed ? [new { Id = 31L, NcCount = 0 }] : [];
        _host.Sql.Queries["SELECT TOP 1 CAST(Id AS bigint) AS Id, NcCount, IsAssessmentExcempted FROM MsmeSections"] = args =>
            FakeSql.Arg(args, "Id") == "41" && FakeSql.Arg(args, "ZedId") == Zed ? [new { Id = 41L, NcCount = 0 }] : [];
        _host.Sql.Queries["SELECT TOP 1 CAST(Id AS bigint) AS Id, MeetingType FROM Meetings"] = args => FakeSql.Arg(args, "ZedId") != Zed ? [] : FakeSql.Arg(args, "Id") switch
        {
            "71" => [new { Id = 71L, MeetingType = "Open Meeting" }],
            "72" => [new { Id = 72L, MeetingType = "Close Meeting" }],
            _ => [],
        };
        _host.Sql.Queries["SELECT TOP 1 CAST(Id AS bigint) AS Id FROM SaPhotos"] = args =>
            _photos.Any(p => p["Id"]!.ToString() == FakeSql.Arg(args, "Id") && (string?)p["AssessorId"] == FakeSql.Arg(args, "UserId")) ||
            (FakeSql.Arg(args, "Id") == "61" && FakeSql.Arg(args, "UserId") == "ASSESSOR1")
                ? [new { Id = long.Parse(FakeSql.Arg(args, "Id")!) }] : [];

        _host.Sql.Procs["SP_ASSESSMENT_DA_DETAILS"] = _ => FakeSql.Sets(
            [new { ZedId = Zed, Certification = "Silver", EnterpriseName = "Acme", PlantAddress = "Plot 4", CertificationStatus = _status, NcCount = 0,
                   SiteAssessorId = "ASSESSOR1", PhotosPath = (string?)null, SaAuditsConducted = "Yes", UserName = "Agency A" }],
            [new { Id = 31L, ProductName = "Valve", Exported = "No", ProductPhoto = "p1.jpg", ProductDescriptionPhoto = "d1.pdf", IsSaVerified = (string?)null }],
            [new { ModeOfAssessment = "DA", RawMaterialName = "Steel", Percentage = "10", CountryName = "X", Id = 3 }],
            [new { Id = 41L, SectionCode = "1", SectionName = "Leadership", iButton = "<b>i</b>", IsAssessmentExcempted = "No", OfiComments = (string?)null, AllotedAssessorId = "ASSESSOR1" }],
            [new { Id = 51L, RequirementId = "R1", SectionCode = "1", RequirementCode = "1", Conformance = "Yes", SaConformance = (string?)null }],
            [new { SectionCode = "1", RequirementCode = "1", OptionCode = "1", OptionName = "Point" }],
            [],
            [new { Id = 81L, SectionCode = "1", RequirementCode = "1", EvidenceName = "Policy", EvidenceId = "E9", SyncedDate = DateTime.Today }],
            [new { Id = 91L, PhotoType = "Selfie", PhotoId = "7", Latitude = "1.1" }, new { Id = 92L, PhotoType = "ProductPhotos", PhotoId = "8" }],
            [new { Latitude = "26.1", Longitude = "80.2" }]);
        _host.Sql.Procs["SP_ASSESSMENT_SA_DETAILS"] = _ => FakeSql.Sets(
            [new { Id = 61L, Name = "Site Exterior Photo", src = @"https://old.example/SaPhotos\ZEDMSME000001\Silver\a.jpg", AssessorId = "ASSESSOR1" }],
            [new { Id = 71L, MeetingType = "Open Meeting", Comments = "Introductions", AssessorId = "ASSESSOR1" }],
            [new { Name = "R Sharma", Designation = "Owner", ZedId = Zed }],
            [new { Id = 72L, MeetingType = "Close Meeting", Comments = (string?)null }],
            [],
            [],
            [
                new { Id = 85L, name = "Shop floor", Photo = "https://old.example/SaPhotos/ZEDMSME000001/Silver/t.jpg", src = "https://old.example/SaPhotos/ZEDMSME000001/Silver/t.jpg", AssessorId = "ASSESSOR1" },
                new { Id = 86L, name = "Foreign", Photo = "https://old.example/SaPhotos/ZEDMSME000002/Silver/x.jpg", src = "https://old.example/SaPhotos/ZEDMSME000002/Silver/x.jpg", AssessorId = "ASSESSOR1" },
            ],
            [new { Id = 95L, RequirementId = "R1", src = "https://old.example/SaPhotos/ZEDMSME000001/Silver/r.jpg", AssessorId = (string?)null }],
            [],
            [],
            [],
            [new { Id = 96L, ProductId = 31L, name = "Product Photo", src = "https://old.example/SaPhotos/ZEDMSME000001/Silver/p.jpg", AssessorId = "ASSESSOR1" }],
            [new { PhotoPath = @"https://old.example/mobileapi//Photos\ZEDMSME000001\Silver\RA\Selfe.jpg", RepresentativeName = "Rep", Designation = "Owner" }]);

        _host.Sql.Procs["SP_ASSESSMENT_RA_UPDATE_PHOTOS"] = args =>
        {
            _photos.Add(new()
            {
                ["Id"] = ++_nextPhotoId, ["Name"] = FakeSql.Arg(args, "Name"), ["Photo"] = "https://old.example" + FakeSql.Arg(args, "Url"),
                ["AssessorId"] = FakeSql.Arg(args, "UserId"), ["TableName"] = FakeSql.Arg(args, "TableName"), ["TargetId"] = FakeSql.Arg(args, "Id"),
            });
            return FakeSql.Sets();
        };
        _host.Sql.Procs["SP_ASSESSMENT_RA_GET_UPDATED_PHOTOS"] = args =>
        {
            var table = FakeSql.Arg(args, "TableName");
            var rows = _photos.Where(p => (string?)p["TableName"] == table && (string?)p["TargetId"] == FakeSql.Arg(args, "Id")).Cast<object>().ToList();
            if (table == "MsmeCertifications")
                rows.Insert(0, new { Id = 85L, Name = "Shop floor", Photo = "https://old.example/SaPhotos/ZEDMSME000001/Silver/t.jpg", AssessorId = "ASSESSOR1" });
            return FakeSql.Sets(rows);
        };
        _host.Sql.Procs["SP_ASSESSMENT_RA_CONFIRM_FINAL_SUBMIT"] = _ => FakeSql.Sets(
            [new { AllowFinalSubmit = _confirmAllowed ? 1 : 0, ErrorMessage = _confirmAllowed ? "" : "You may have missed one or more OFI comments. Please review." }],
            [new { RaisedForNc = _raisesNc ? 1 : 0 }]);
        _host.Sql.Procs["SP_EMAIL_GET_DETAILS"] = _ => FakeSql.Sets([new
        {
            EmailId = "owner@acme.test", EnterpriseName = "Acme", PUnitName = "Acme Unit", NcCount = "1", MsmePassword = "msme-secret-pw",
            Password = "agency-secret-pw", CoAssessorPassword = "co-secret-pw", AssessorName = "Lead", AgencyName = "Agency A",
        }]);
    }

    public void Dispose()
    {
        _video.Dispose();
        _host.Dispose();
    }

    private Task<HttpClient> As(string? user) => RemoteTestUsers.SignInAsync(_video, user);

    private (string Name, object? Args) Call(string proc) => _host.Sql.Calls.Last(c => c.Name == proc);

    private bool Called(string proc) => _host.Sql.Calls.Any(c => c.Name == proc);

    [Fact]
    public async Task Anonymous_401_and_wrong_role_or_sub_role_403()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await (await As(null)).GetAsync(Base)).StatusCode);
        foreach (var user in new[] { "AGENCY1", "ADMIN1", "ASSESSORDA" })
        {
            var client = await As(user);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(Base)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsync(Base + "/join", null)).StatusCode);
        }
        Assert.False(Called("SP_ASSESSMENT_RA_UPDATE_JOIN_ROOM_STATUS"));
    }

    [Fact]
    public async Task Only_the_units_assessors_and_remote_mode_units_are_found()
    {
        var other = await As("ASSESSOR3");
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(Base)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsync(Base + "/join", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsJsonAsync(Base + "/requirements/51/conformance", new { conformance = "Yes" })).StatusCode);

        var lead = await As("ASSESSOR1");
        Assert.Equal(HttpStatusCode.NotFound, (await lead.GetAsync("/api/staff/remote/ZEDMSME000002/Silver")).StatusCode); // on-site unit
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.GetAsync("/api/staff/remote/" + Zed + "/Bronze")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.GetAsync("/api/staff/remote/ZED..%5C..%5Cx/Silver")).StatusCode);
        Assert.False(Called("SP_ASSESSMENT_DA_DETAILS"));
        Assert.False(Called("SP_ASSESSMENT_RA_UPDATE_REQUIREMENT"));
    }

    [Fact]
    public async Task Details_return_shown_columns_and_checked_photo_addresses()
    {
        var lead = await As("ASSESSOR1");
        var body = await lead.GetFromJsonAsync<JsonElement>(Base);
        var msme = body.GetProperty("msme");
        Assert.Equal("Acme", msme.GetProperty("EnterpriseName").GetString());
        Assert.False(msme.TryGetProperty("SiteAssessorId", out _));
        Assert.False(msme.TryGetProperty("PhotosPath", out _));
        Assert.Equal("ASSESSOR1", FakeSql.Arg(Call("SP_ASSESSMENT_SA_DETAILS").Args, "UserId"));
        Assert.Equal("3", FakeSql.Arg(Call("SP_ASSESSMENT_DA_DETAILS").Args, "RoleId"));

        Assert.Equal(Base + "/files/SaPhotos/ZEDMSME000001/Silver/a.jpg", body.GetProperty("siteExteriorPhotos")[0].GetProperty("url").GetString());
        Assert.True(body.GetProperty("siteExteriorPhotos")[0].GetProperty("deletable").GetBoolean());
        var tour = body.GetProperty("siteTourPhotos");
        Assert.Equal(Base + "/files/SaPhotos/ZEDMSME000001/Silver/t.jpg", tour[0].GetProperty("url").GetString());
        Assert.Equal(JsonValueKind.Null, tour[1].GetProperty("url").ValueKind); // another unit's folder
        Assert.Equal(Base + "/files/mobileapi/Photos/ZEDMSME000001/Silver/RA/Selfe.jpg", body.GetProperty("selfies")[0].GetProperty("url").GetString());

        var product = body.GetProperty("products")[0];
        Assert.Equal("/api/staff/assessment/da/ZEDMSME000001/Silver/files/mobileapi/Photos/ZEDMSME000001/Silver/BasicInfo/p1.jpg", product.GetProperty("PhotoUrl").GetString());
        Assert.Equal("pdf", product.GetProperty("DescriptionKind").GetString());
        Assert.Equal(JsonValueKind.Null, product.GetProperty("ProductDescOpenedTime").ValueKind);
        Assert.Equal(96, product.GetProperty("RemotePhotos")[0].GetProperty("id").GetInt64());
        var requirement = body.GetProperty("requirements")[0];
        Assert.False(requirement.TryGetProperty("RequirementId", out _));
        Assert.False(requirement.GetProperty("RemotePhotos")[0].GetProperty("deletable").GetBoolean());
        Assert.Equal(1, body.GetProperty("daPhotos").GetArrayLength()); // product photos are shown with the products
        Assert.Equal("Introductions", body.GetProperty("openMeeting").GetProperty("comments").GetString());
        Assert.Equal("R Sharma", body.GetProperty("openMeeting").GetProperty("participants")[0].GetProperty("Name").GetString());
        Assert.False(body.GetProperty("openMeeting").GetProperty("participants")[0].TryGetProperty("ZedId", out _));
        var permissions = body.GetProperty("permissions");
        Assert.True(permissions.GetProperty("canAssess").GetBoolean());
        Assert.True(permissions.GetProperty("videoConfigured").GetBoolean());
    }

    [Fact]
    public async Task Lead_records_opened_evidences_through_the_desktop_opened_call_as_the_old_page_did()
    {
        _host.Sql.Queries["SELECT TOP 1 CAST(Id AS bigint) AS Id, NcCount, SectionCode, RequirementCode, EvidenceCode"] = args =>
            FakeSql.Arg(args, "Id") == "81" && FakeSql.Arg(args, "ZedId") == Zed ? [new { Id = 81L, NcCount = 0 }] : [];
        const string Opened = "/api/staff/assessment/da/" + Zed + "/Silver/opened";

        var lead = await As("ASSESSOR1");
        Assert.Equal(HttpStatusCode.OK, (await lead.PostAsJsonAsync(Opened, new { type = "Evidence", id = 81 })).StatusCode);
        var call = Call("SP_ASSESSMENT_DA_UPDATE_TIMESTAMP").Args;
        Assert.Equal("81", FakeSql.Arg(call, "Id"));
        Assert.Null(FakeSql.Arg(call, "PhotoType"));

        // The old remote page recorded nothing else; the co-assessor and closed assessments record nothing.
        Assert.Equal(HttpStatusCode.NotFound, (await lead.PostAsJsonAsync(Opened, new { type = "ProductDescriptionPhoto", id = 31 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await As("ASSESSOR2")).PostAsJsonAsync(Opened, new { type = "Evidence", id = 81 })).StatusCode);
        _status = 10;
        Assert.Equal(HttpStatusCode.NotFound, (await lead.PostAsJsonAsync(Opened, new { type = "Evidence", id = 81 })).StatusCode);
        Assert.Single(_host.Sql.Calls, c => c.Name == "SP_ASSESSMENT_DA_UPDATE_TIMESTAMP");
    }

    [Fact]
    public async Task Co_assessor_can_view_but_not_assess_and_closed_assessments_are_read_only()
    {
        var co = await As("ASSESSOR2");
        var body = await co.GetFromJsonAsync<JsonElement>(Base);
        Assert.False(body.GetProperty("permissions").GetProperty("canAssess").GetBoolean());
        Assert.False(body.GetProperty("siteExteriorPhotos")[0].GetProperty("deletable").GetBoolean());
        var r = await co.PostAsJsonAsync(Base + "/requirements/51/conformance", new { conformance = "Yes" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await co.PostAsync(Base + "/join", null)).StatusCode);

        _status = 15;
        var lead = await As("ASSESSOR1");
        Assert.False((await lead.GetFromJsonAsync<JsonElement>(Base)).GetProperty("permissions").GetProperty("canAssess").GetBoolean());
        Assert.Equal("This remote assessment is not open.", await (await lead.PostAsJsonAsync(Base + "/final-submit", new { comments = "x" })).ProblemTitle());
        Assert.False(Called("SP_ASSESSMENT_RA_UPDATE_REQUIREMENT"));
        Assert.False(Called("SP_ASSESSMENT_RA_FINAL_SUBMIT"));
    }

    [Fact]
    public async Task Join_returns_a_video_token_for_the_units_room_only()
    {
        var lead = await As("ASSESSOR1");
        var r = await lead.PostAsync(Base + "/join", null);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(Zed + " Remote Assessment", body.GetProperty("room").GetString());
        Assert.Equal(Zed, FakeSql.Arg(Call("SP_ASSESSMENT_RA_UPDATE_JOIN_ROOM_STATUS").Args, "ZedId"));

        var parts = body.GetProperty("token").GetString()!.Split('.');
        Assert.Equal(3, parts.Length);
        var expected = TwilioVideoToken.Base64Url(HMACSHA256.HashData(Encoding.UTF8.GetBytes(Secret), Encoding.ASCII.GetBytes(parts[0] + "." + parts[1])));
        Assert.Equal(expected, parts[2]);
        var payload = JsonDocument.Parse(Convert.FromBase64String(Pad(parts[1]))).RootElement;
        Assert.Equal("SKtest", payload.GetProperty("iss").GetString());
        Assert.Equal("ACtest", payload.GetProperty("sub").GetString());
        Assert.Equal(Zed + " Remote Assessor", payload.GetProperty("grants").GetProperty("identity").GetString());
        Assert.Equal(Zed + " Remote Assessment", payload.GetProperty("grants").GetProperty("video").GetProperty("room").GetString());
        Assert.True(payload.GetProperty("exp").GetInt64() - payload.GetProperty("iat").GetInt64() == 3600);
        var header = JsonDocument.Parse(Convert.FromBase64String(Pad(parts[0]))).RootElement;
        Assert.Equal("twilio-fpa;v=1", header.GetProperty("cty").GetString());
        Assert.DoesNotContain(Secret, await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Join_without_twilio_settings_is_refused()
    {
        var lead = await RemoteTestUsers.SignInAsync(_host, "ASSESSOR1");
        var r = await lead.PostAsync(Base + "/join", null);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.False(Called("SP_ASSESSMENT_RA_UPDATE_JOIN_ROOM_STATUS"));
        Assert.False((await lead.GetFromJsonAsync<JsonElement>(Base)).GetProperty("permissions").GetProperty("videoConfigured").GetBoolean());
    }

    [Fact]
    public async Task Conformance_product_and_site_exterior_are_checked()
    {
        var lead = await As("ASSESSOR1");
        Assert.Equal(HttpStatusCode.NotFound, (await lead.PostAsJsonAsync(Base + "/requirements/52/conformance", new { conformance = "Yes" })).StatusCode);
        Assert.Equal("Please enter remarks.", await (await lead.PostAsJsonAsync(Base + "/requirements/51/conformance", new { conformance = "No" })).ProblemTitle());
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/requirements/51/conformance", new { conformance = "Maybe" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await lead.PostAsJsonAsync(Base + "/requirements/51/conformance", new { conformance = "no", remarks = " Missing " })).StatusCode);
        var args = Call("SP_ASSESSMENT_RA_UPDATE_REQUIREMENT").Args;
        Assert.Equal(("51", "No", "Missing", "Silver"), (FakeSql.Arg(args, "Id"), FakeSql.Arg(args, "Conformance"), FakeSql.Arg(args, "AssessorRemark"), FakeSql.Arg(args, "CertificationType")));

        Assert.Equal(HttpStatusCode.NotFound, (await lead.PostAsJsonAsync(Base + "/products/99/validate", new { isVerified = "Yes" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await lead.PostAsJsonAsync(Base + "/products/31/validate", new { isVerified = "Yes" })).StatusCode);
        Assert.Equal("31", FakeSql.Arg(Call("SP_ASSESSMENT_RA_UPDATE_PRODUCT").Args, "Id"));
        Assert.Equal(HttpStatusCode.OK, (await lead.PostAsJsonAsync(Base + "/site-exterior/validate", new { isVerified = "No", remarks = "Blurred" })).StatusCode);
        Assert.Equal("No", FakeSql.Arg(Call("SP_ASSESSMENT_RA_UPDATE_SITE_EXTERIOR").Args, "IsSaVerified"));
    }

    [Fact]
    public async Task Basic_info_columns_are_allow_listed_and_the_row_id_comes_from_the_record()
    {
        var lead = await As("ASSESSOR1");
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/basic-info", new { column = "CertificationStatus", value = "15" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/basic-info", new { column = "SaAuditsConducted", value = "Perhaps" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await lead.PostAsJsonAsync(Base + "/basic-info", new { column = "SaAuditsConducted", value = "yes", id = 999 })).StatusCode);
        var args = Call("SP_ASSESSMENT_RA_UPDATE_BASIC_INFO").Args;
        Assert.Equal(("5", "Yes", "SaAuditsConducted"), (FakeSql.Arg(args, "Id"), FakeSql.Arg(args, "Response"), FakeSql.Arg(args, "ColumnName")));
        Assert.Equal(HttpStatusCode.OK, (await lead.PostAsJsonAsync(Base + "/basic-info", new { column = "SaEnergySources", value = "Solar, grid" })).StatusCode);
    }

    [Fact]
    public async Task Comments_and_participants_need_ids_of_the_unit()
    {
        var lead = await As("ASSESSOR1");
        Assert.Equal(HttpStatusCode.NotFound, (await lead.PostAsJsonAsync(Base + "/sections/42/ofi", new { comments = "x" })).StatusCode);
        Assert.Equal("Please enter comments.", await (await lead.PostAsJsonAsync(Base + "/sections/41/ofi", new { comments = " " })).ProblemTitle());
        Assert.Equal(HttpStatusCode.OK, (await lead.PostAsJsonAsync(Base + "/sections/41/ofi", new { comments = "Improve records" })).StatusCode);
        Assert.Equal("MsmeSections", FakeSql.Arg(Call("SP_ASSESSMENT_RA_UPDATE_COMMENTS").Args, "TableName"));
        Assert.Equal(HttpStatusCode.NotFound, (await lead.PostAsJsonAsync(Base + "/meetings/73/comments", new { comments = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await lead.PostAsJsonAsync(Base + "/meetings/72/comments", new { comments = "Closed" })).StatusCode);
        Assert.Equal("Meetings", FakeSql.Arg(Call("SP_ASSESSMENT_RA_UPDATE_COMMENTS").Args, "TableName"));

        Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/meetings/71/participants", new { name = "A" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await lead.PostAsJsonAsync(Base + "/meetings/72/participants", new { name = "A Kumar", designation = "Manager", type = "Open Meeting" })).StatusCode);
        Assert.Equal("Close Meeting", FakeSql.Arg(Call("SP_ASSESSMENT_RA_ADD_PARTICIPANT").Args, "Type"));
    }

    [Fact]
    public async Task Captured_photos_are_checked_and_stored_under_server_chosen_names()
    {
        var lead = await As("ASSESSOR1");
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/photos", new { target = "SiteTour", image = "data:image/gif;base64,R0lGODlh" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/photos",
            new { target = "SiteTour", image = "data:image/jpeg;base64," + Convert.ToBase64String("<%@ Page %>"u8.ToArray()) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/photos", new { target = "Elsewhere", image = JpegDataUrl })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await lead.PostAsJsonAsync(Base + "/photos", new { target = "Requirement", targetId = 52, image = JpegDataUrl })).StatusCode);
        Assert.False(Called("SP_ASSESSMENT_RA_UPDATE_PHOTOS"));

        var r = await lead.PostAsJsonAsync(Base + "/photos", new { target = "Requirement", targetId = 51, name = "Fire extinguisher", image = JpegDataUrl, zedId = "../../web" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var args = Call("SP_ASSESSMENT_RA_UPDATE_PHOTOS").Args;
        Assert.Equal(("MsmeRequirements", "51", "Fire extinguisher", "ASSESSOR1"), (FakeSql.Arg(args, "TableName"), FakeSql.Arg(args, "Id"), FakeSql.Arg(args, "Name"), FakeSql.Arg(args, "UserId")));
        var url = FakeSql.Arg(args, "Url")!;
        Assert.Matches(@"^/SaPhotos/ZEDMSME000001/Silver/\d{17}_[0-9a-f]{6}\.jpg$", url);
        var file = Path.Combine(_host.StorageRoot, url.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
        Assert.Equal(Jpeg, await File.ReadAllBytesAsync(file));
        var photos = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("photos");
        var photoUrl = photos[0].GetProperty("url").GetString()!;
        Assert.Equal(Base + "/files" + url, photoUrl);

        // Served to the unit's assessors only.
        Assert.Equal(Jpeg, await lead.GetByteArrayAsync(photoUrl));
        Assert.Equal(HttpStatusCode.OK, (await (await As("ASSESSOR2")).GetAsync(photoUrl)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await As("ASSESSOR3")).GetAsync(photoUrl)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await lead.GetAsync(Base + "/files/SaPhotos/ZEDMSME000002/Silver/x.jpg")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await lead.GetAsync(Base + "/files/SaPhotos/ZEDMSME000001/Silver/..%2F..%2F..%2Fappsettings.json")).StatusCode);
    }

    [Fact]
    public async Task Photo_limits_fixed_names_and_site_tour_reuse()
    {
        var lead = await As("ASSESSOR1");
        Assert.Equal(HttpStatusCode.OK, (await lead.PostAsJsonAsync(Base + "/photos", new { target = "CloseMeeting", targetId = 72, name = "Anything", image = JpegDataUrl })).StatusCode);
        Assert.Equal("Closing Meeting Photo", FakeSql.Arg(Call("SP_ASSESSMENT_RA_UPDATE_PHOTOS").Args, "Name"));
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/photos", new { target = "CloseMeeting", targetId = 72, image = JpegDataUrl })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await lead.PostAsJsonAsync(Base + "/photos", new { target = "OpenMeeting", targetId = 72, image = JpegDataUrl })).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await lead.PostAsJsonAsync(Base + "/photos", new { target = "ProductDescriptionPhoto", targetId = 31, name = "x", image = JpegDataUrl })).StatusCode);
        Assert.Equal("Product Description Photo", FakeSql.Arg(Call("SP_ASSESSMENT_RA_UPDATE_PHOTOS").Args, "Name"));
        Assert.Equal(HttpStatusCode.OK, (await lead.PostAsJsonAsync(Base + "/photos", new { target = "ProductPhoto", targetId = 31, image = JpegDataUrl })).StatusCode);

        var before = Directory.GetFiles(_host.StorageRoot, "*", SearchOption.AllDirectories).Length;
        Assert.Equal(HttpStatusCode.NotFound, (await lead.PostAsJsonAsync(Base + "/photos", new { target = "Requirement", targetId = 51, fromPhotoId = 999 })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await lead.PostAsJsonAsync(Base + "/photos", new { target = "Requirement", targetId = 51, fromPhotoId = 85 })).StatusCode);
        var args = Call("SP_ASSESSMENT_RA_UPDATE_PHOTOS").Args;
        Assert.Equal(("/SaPhotos/ZEDMSME000001/Silver/t.jpg", "Shop floor"), (FakeSql.Arg(args, "Url"), FakeSql.Arg(args, "Name")));
        Assert.Equal(before, Directory.GetFiles(_host.StorageRoot, "*", SearchOption.AllDirectories).Length);
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/photos", new { target = "SiteTour", fromPhotoId = 85 })).StatusCode);
    }

    [Fact]
    public async Task Only_photos_the_assessor_captured_can_be_removed()
    {
        var lead = await As("ASSESSOR1");
        Assert.Equal(HttpStatusCode.NotFound, (await lead.DeleteAsync(Base + "/photos/95")).StatusCode);
        Assert.False(Called("SP_ASSESSMENT_RA_DELETE_PHOTOS"));
        Assert.Equal(HttpStatusCode.OK, (await lead.DeleteAsync(Base + "/photos/61")).StatusCode);
        var args = Call("SP_ASSESSMENT_RA_DELETE_PHOTOS").Args;
        Assert.Equal(("61", Zed, "Silver"), (FakeSql.Arg(args, "Id"), FakeSql.Arg(args, "ZedId"), FakeSql.Arg(args, "CertificationType")));
        Assert.Equal(HttpStatusCode.Forbidden, (await (await As("ASSESSOR2")).DeleteAsync(Base + "/photos/61")).StatusCode);
    }

    [Fact]
    public async Task Final_submit_rechecks_the_procedure_and_sends_the_nc_mail_without_passwords()
    {
        var lead = await As("ASSESSOR1");
        Assert.Equal("Please enter comments.", await (await lead.PostAsJsonAsync(Base + "/final-submit", new { comments = "" })).ProblemTitle());

        _confirmAllowed = false;
        var check = await (await lead.PostAsync(Base + "/final-submit/check", null)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(check.GetProperty("allowed").GetBoolean());
        var refused = await lead.PostAsJsonAsync(Base + "/final-submit", new { comments = "Done", isNcRaised = "0" });
        Assert.Equal("You may have missed one or more OFI comments. Please review.", await refused.ProblemTitle());
        Assert.False(Called("SP_ASSESSMENT_RA_FINAL_SUBMIT"));

        _confirmAllowed = true;
        _raisesNc = true;
        Assert.Equal(HttpStatusCode.OK, (await lead.PostAsJsonAsync(Base + "/final-submit", new { comments = "NCs raised", isNcRaised = "0" })).StatusCode);
        Assert.Equal("NCs raised", FakeSql.Arg(Call("SP_ASSESSMENT_RA_FINAL_SUBMIT").Args, "AssessorRemarks"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Contains("owner@acme.test", mail.To);
        Assert.DoesNotContain("secret-pw", mail.HtmlBody);
    }

    [Fact]
    public void Decoding_refuses_oversized_and_non_image_data()
    {
        Assert.NotNull(RemoteFiles.DecodeImage(new string('A', 8 * 1024 * 1024)).Error);
        Assert.NotNull(RemoteFiles.DecodeImage("not base64!").Error);
        var (bytes, ext, error) = RemoteFiles.DecodeImage("data:image/png;base64," + Convert.ToBase64String([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0]));
        Assert.Null(error);
        Assert.Equal(".png", ext);
        Assert.Equal(9, bytes!.Length);
        Assert.False(RemoteFiles.BelongsTo("SaPhotos/ZEDMSME000001/Gold/a.jpg", "ZEDMSME000001", "Silver"));
        Assert.True(RemoteFiles.BelongsTo("mobileapi/SaCertifiedPhotos/ZEDMSME000001/Silver/a.jpg", "ZEDMSME000001", "Silver"));
        Assert.Null(RemoteFiles.Normalise("SaPhotos/ZEDMSME000001/Silver/../../x.jpg"));
        Assert.Null(RemoteFiles.Normalise("SaPhotos/ZEDMSME000001/Silver/a.aspx"));
    }

    private static string Pad(string s)
    {
        s = s.Replace('-', '+').Replace('_', '/');
        return s + new string('=', (4 - s.Length % 4) % 4);
    }
}
