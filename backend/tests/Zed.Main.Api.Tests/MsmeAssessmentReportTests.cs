using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Msme;

namespace Zed.Main.Api.Tests;

public sealed class MsmeAssessmentReportTests : IDisposable
{
    private const string Me = "ZEDMSME000001";
    private const string Other = "ZEDMSME000002";
    private const string Base = "https://loginzed.msme.gov.in/mobileapi/Photos/";

    private readonly TestHost _host = new();

    public MsmeAssessmentReportTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args => FakeSql.Arg(args, "UserId") switch
        {
            Me or Other => FakeSql.Sets([new { UserId = FakeSql.Arg(args, "UserId"), UserName = "Acme", RoleId = 5, Email = "a@acme.test" }], [new { ERRORMSG = "SUCCESS" }]),
            "ASSESSOR1" => FakeSql.Sets([new { UserId = "ASSESSOR1", UserName = "Assessor", RoleId = 3, Email = "as@zed.test" }], [new { ERRORMSG = "SUCCESS" }]),
            _ => FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]),
        };
        _host.Sql.Procs["SP_GET_SUB_ROLE"] = _ => FakeSql.Sets([new { DesktopVerification = 1, SiteVerification = 1, FinancialVerification = 0 }]);

        // Shaped like the real procedures: every row belongs to @ZedId; file names come from the rows.
        _host.Sql.Procs[MsmeAssessment.DesktopProcedure] = args => Desktop(FakeSql.Arg(args, "ZedId")!, FakeSql.Arg(args, "Certification")!);
        _host.Sql.Procs[MsmeAssessment.RoundProcedure] = args => Round(FakeSql.Arg(args, "ZedId")!, FakeSql.Arg(args, "Certification")!, int.Parse(FakeSql.Arg(args, "NcCount")!));
        _host.Sql.Procs[MsmeAssessment.SiteProcedure] = args => Site(FakeSql.Arg(args, "ZedId")!, FakeSql.Arg(args, "Certification")!);
    }

    public void Dispose() => _host.Dispose();

    private static Zed.Core.Data.ResultSets Desktop(string zedId, string cert, int ncCount = 2)
    {
        var sets = new List<IEnumerable<object>>
        {
            new object[] { new Dictionary<string, object?>
            {
                ["Id"] = 1, ["ZedId"] = zedId, ["Certification"] = cert, ["NcCount"] = ncCount, ["AuditsConducted"] = "Yes",
                ["DomesticCustomers"] = "Tata", ["EnergySources"] = "Solar, Grid", ["ManufacturingCapacityValue"] = 100, ["ManufacturingCapacityUnits"] = "Tons",
                ["DesktopAssessorId"] = "ASSESSOR1", ["DesktopAssessorName"] = "Assessor Name", ["AgencyName"] = "Agency", ["SendBackRemarks"] = "internal",
                ["PhotosPath"] = null, ["PhotosBasePath"] = Base,
            } },
            new object[] { new Dictionary<string, object?> { ["Id"] = 11, ["ZedId"] = zedId, ["Certification"] = cert, ["ProductName"] = "Valve", ["Exported"] = "No", ["ProductPhoto"] = "p1.jpg", ["ProductDescriptionPhoto"] = "d1.pdf", ["AssessorRemarks"] = "hidden" } },
            new object[] { new { RawMaterialName = "Steel", Percentage = 20, CountryName = "Japan", ZedId = zedId } },
            new object[] { new { Id = 1, ZedId = zedId, SectionCode = "1", SectionName = "Leadership", iButton = "Info" } },
            new object[] { new { Id = 2, ZedId = zedId, SectionCode = "1", RequirementCode = "1", Conformance = "No", AssessorRemarks = "da remark" } },
            new object[] { new { ZedId = zedId, SectionCode = "1", RequirementCode = "1", OptionCode = "1", OptionName = "Has a policy" } },
            new object[] { new { ZedId = zedId, SectionCode = "1", RequirementCode = "1", OptionCode = "1", SubOptionName = "Written" } },
            new object[]
            {
                new { Id = 5, ZedId = zedId, Certification = cert, SectionCode = "1", RequirementCode = "1", EvidenceId = "E1", EvidenceName = "Policy", GeneratedTime = "May 1, 2024", AssessorRemarks = "x" },
                new { Id = 6, ZedId = zedId, Certification = cert, SectionCode = "1", RequirementCode = "1", EvidenceId = "../../x", EvidenceName = "Bad", GeneratedTime = "May 1, 2024", AssessorRemarks = "x" },
            },
            new object[]
            {
                new { Id = 7, ZedId = zedId, Certification = cert, PhotoId = "S1", PhotoType = "Selfie", TimeStamp = "t", CreatedDate = "c", UpdatedDate = "u", AssessorRemarks = "ok", ProductId = (int?)null, PhotoExtension = "jpg", Latitude = 1.2 },
                new { Id = 8, ZedId = zedId, Certification = cert, PhotoId = "X1", PhotoType = "SiteExteriorPhotos", TimeStamp = "t", CreatedDate = "c", UpdatedDate = "u", AssessorRemarks = "blurred", ProductId = (int?)null, PhotoExtension = "jpg", Latitude = 1.2 },
                new { Id = 9, ZedId = zedId, Certification = cert, PhotoId = "P9", PhotoType = "ProductPhotos", TimeStamp = "t", CreatedDate = "c", UpdatedDate = "u", AssessorRemarks = "", ProductId = (int?)11, PhotoExtension = "png", Latitude = 1.2 },
            },
            new object[] { new { Latitude = 1.2, Longitude = 3.4 } },
            Array.Empty<object>(), // screenshots
            new object[] { new { Id = 1, ZedId = zedId, Code = "1", Question = "Do you treat effluents?", Answer = "Yes", IfYesQuestion = "How?", IfYesAnswer = "ETP", IfNoQuestion = "", IfNoAnswer = "", CheckListType = "ESG" } },
        };
        return FakeSql.Sets([.. sets]);
    }

    private static Zed.Core.Data.ResultSets Round(string zedId, string cert, int n) => FakeSql.Sets(
        [new { Id = 20 + n, ZedId = zedId, Certification = cert, ProductName = "Valve", ProductParentId = 11, PreviousAssessorRemarks = $"fix label {n}", PreviousAssessorUpdatedDate = "d", MsmeRemarks = "done", MsmeUpdatedDate = "m", SaProductPhoto = "secret" }],
        [new { ZedId = zedId, SectionCode = "1", SectionName = "Leadership", iButton = "Info" }],
        [new { ZedId = zedId, SectionCode = "1", RequirementCode = "1", PreviousAssessorRemarks = $"NC{n}: add policy", PreviousAssessorUpdatedDate = "d", MsmeComments = "added", MsmeUpdatedDate = "m", AssessorRemarks = "next round notes" }],
        [new { ZedId = zedId, SectionCode = "1", RequirementCode = "1", OptionCode = "1", OptionName = "Has a policy" }],
        [],
        [new { ZedId = zedId, Certification = cert, SectionCode = "1", RequirementCode = "1", EvidenceId = $"N{n}", EvidenceName = "Policy v2", GeneratedTime = "g" }],
        [new { ZedId = zedId, Certification = cert, PhotoId = $"X{n}", PhotoType = "SiteExteriorPhotos", TimeStamp = "t", CreatedDate = "c", MsmeRemarks = "new photo", PhotoExtension = "jpg" }],
        [new { AssessorRemarksNc = "summary" }],
        [],
        [new { ProductId = 20 + n, ProductParentId = 11, TimeStamp = "t", CreatedDate = "c", Photo = $"https://loginzed.msme.gov.in/mobileapi/SaPhotos/{zedId}/{cert}/BasicInfo/R{n}.jpg" }]);

    private static Zed.Core.Data.ResultSets Site(string zedId, string cert) => FakeSql.Sets(
        [], [], [], [], [], [], [],
        [
            new { Name = "Policy photo", SectionCode = "1", RequirementCode = "1", GeneratedTime = "g", Photo = $"https://loginzed.msme.gov.in/mobileapi/SaPhotos/{zedId}/{cert}/Evidences/SA1.jpg" },
            new { Name = "Foreign", SectionCode = "1", RequirementCode = "1", GeneratedTime = "g", Photo = $"https://loginzed.msme.gov.in/mobileapi/SaPhotos/{Other}/{cert}/Evidences/SA2.jpg" },
            new { Name = "Elsewhere", SectionCode = "1", RequirementCode = "1", GeneratedTime = "g", Photo = $"https://loginzed.msme.gov.in/Certificates/{zedId}/Pledge.pdf" },
        ]);

    private async Task<HttpClient> SignInAsync(string zedId = Me)
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = zedId, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    private string WriteFile(string relative, string content = "%PDF-1.4 test")
    {
        var path = Path.Combine(_host.StorageRoot, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
        return path;
    }

    private static IEnumerable<string?> Strings(JsonElement array, string field) =>
        array.EnumerateArray().Select(e => e.GetProperty(field).ValueKind == JsonValueKind.Null ? null : e.GetProperty(field).GetString());

    // ----- access -----

    [Theory]
    [InlineData("/api/msme/assessment/Bronze/basic-info")]
    [InlineData("/api/msme/assessment/Bronze/non-conformances")]
    [InlineData("/api/msme/assessment/Bronze/files/da/mobileapi/Photos/ZEDMSME000001/Bronze/Selfie/S1.jpg")]
    public async Task Endpoints_require_a_signed_in_msme(string url)
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(url)).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_ASSESSMENT", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("/api/msme/assessment/Bronze/basic-info")]
    [InlineData("/api/msme/assessment/Bronze/non-conformances")]
    [InlineData("/api/msme/assessment/Bronze/files/da/mobileapi/Photos/ZEDMSME000001/Bronze/Selfie/S1.jpg")]
    public async Task Staff_accounts_are_forbidden(string url)
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = "ASSESSOR1", password = "Right#Pass1" })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(url)).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_ASSESSMENT", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("UpdateConfirmance")]
    [InlineData("ValidateEvidence")]
    [InlineData("ValidateProduct")]
    [InlineData("ValidateSiteExterior")]
    [InlineData("SaveTimestamp")]
    [InlineData("ExemptedFromAssessment")]
    [InlineData("ConfirmFinalSubmit")]
    [InlineData("FinalSubmit")]
    [InlineData("UpdateRemarks")]
    [InlineData("UpdateMeetingComments")]
    [InlineData("Bronze/basic-info")]
    [InlineData("Bronze/non-conformances")]
    [InlineData("Bronze/final-submit")]
    public async Task No_assessor_or_agency_action_exists(string action)
    {
        var client = await SignInAsync();
        var body = JsonContent.Create(new { zedId = Me, certification = "Bronze", id = "5", conformance = "Yes", comments = "ok" });

        var r = await client.PostAsync($"/api/msme/assessment/{action}", body);

        Assert.True(r.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed, $"POST {action} gave {r.StatusCode}");
        Assert.True((await client.PutAsync("/api/msme/assessment/Bronze/basic-info", body)).StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed);
        // Nothing but the read procedures is ever called.
        Assert.All(_host.Sql.Calls.Where(c => c.Name.StartsWith("SP_ASSESSMENT", StringComparison.Ordinal)),
            c => Assert.Contains(c.Name, new[] { MsmeAssessment.DesktopProcedure, MsmeAssessment.RoundProcedure, MsmeAssessment.SiteProcedure }));
    }

    // ----- basic information -----

    [Fact]
    public async Task Basic_info_uses_the_cookie_zed_id_and_the_canonical_certification()
    {
        var client = await SignInAsync();
        var r = await client.GetAsync($"/api/msme/assessment/bronze/basic-info?zedId={Other}");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var call = Assert.Single(_host.Sql.Calls, c => c.Name == MsmeAssessment.DesktopProcedure);
        Assert.Equal(Me, FakeSql.Arg(call.Args, "ZedId"));
        Assert.Equal("Bronze", FakeSql.Arg(call.Args, "Certification"));
        // Like MsmeController.GetBasicInfo: no UserId/RoleId, the procedure treats the caller as the MSME.
        Assert.Null(FakeSql.Arg(call.Args, "UserId"));
    }

    [Theory]
    [InlineData("Platinum")]
    [InlineData("SilverMilestone1")]
    [InlineData("Techupgrade")]
    [InlineData("Bronze' OR 1=1 --")]
    public async Task Unknown_certifications_are_rejected_without_calling_the_database(string certification)
    {
        var client = await SignInAsync();
        foreach (var page in new[] { "basic-info", "non-conformances" })
        {
            var r = await client.GetAsync($"/api/msme/assessment/{Uri.EscapeDataString(certification)}/{page}");
            Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
            Assert.Equal("Invalid certification.", await r.ProblemTitle());
        }
        var file = await client.GetAsync($"/api/msme/assessment/{Uri.EscapeDataString(certification)}/files/da/mobileapi/Photos/{Me}/Bronze/Selfie/S1.jpg");
        Assert.Equal(HttpStatusCode.NotFound, file.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_ASSESSMENT", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Basic_info_returns_only_displayed_columns_with_file_links_to_the_api()
    {
        var client = await SignInAsync();
        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/assessment/Bronze/basic-info");
        var raw = json.GetRawText();

        Assert.Equal("Bronze", json.GetProperty("certification").GetString());
        var a = json.GetProperty("assessment");
        Assert.Equal("Tata", a.GetProperty("DomesticCustomers").GetString());
        Assert.Equal(2, a.GetProperty("NcCount").GetInt32());
        foreach (var hidden in new[] { "DesktopAssessorName", "Assessor Name", "AgencyName", "SendBackRemarks", "PhotosBasePath", "loginzed.msme.gov.in", "da remark", "Latitude" })
            Assert.DoesNotContain(hidden, raw);

        var product = json.GetProperty("products")[0];
        Assert.Equal("Valve", product.GetProperty("ProductName").GetString());
        Assert.Equal($"/api/msme/assessment/Bronze/files/da/mobileapi/Photos/{Me}/Bronze/BasicInfo/p1.jpg", product.GetProperty("PhotoUrl").GetString());
        Assert.Equal("pdf", product.GetProperty("DescriptionType").GetString());
        Assert.Equal($"/api/msme/assessment/Bronze/files/da/mobileapi/Photos/{Me}/Bronze/BasicInfo/d1.pdf", product.GetProperty("DescriptionUrl").GetString());
        Assert.False(product.TryGetProperty("AssessorRemarks", out _));

        Assert.Equal([$"/api/msme/assessment/Bronze/files/da/mobileapi/Photos/{Me}/Bronze/Evidences/E1.pdf", null],
            Strings(json.GetProperty("evidences"), "FileUrl"));
        Assert.Equal([
            $"/api/msme/assessment/Bronze/files/da/mobileapi/Photos/{Me}/Bronze/Selfie/S1.jpg",
            $"/api/msme/assessment/Bronze/files/da/mobileapi/Photos/{Me}/Bronze/SiteExteriorPhotos/X1.jpg",
            $"/api/msme/assessment/Bronze/files/da/mobileapi/Photos/{Me}/Bronze/BasicInfo/P9.png",
        ], Strings(json.GetProperty("photos"), "FileUrl"));

        Assert.Equal("Steel", json.GetProperty("rawMaterials")[0].GetProperty("RawMaterialName").GetString());
        Assert.Equal("Has a policy", json.GetProperty("options")[0].GetProperty("OptionName").GetString());
        Assert.Equal("Written", json.GetProperty("subOptions")[0].GetProperty("SubOptionName").GetString());
        Assert.Equal("ESG", json.GetProperty("esgCheckList")[0].GetProperty("CheckListType").GetString());
    }

    [Fact]
    public async Task Missing_assessment_gives_404_with_a_message()
    {
        _host.Sql.Procs[MsmeAssessment.DesktopProcedure] = _ => FakeSql.Sets([], [], []);
        var client = await SignInAsync();

        var r = await client.GetAsync("/api/msme/assessment/SilverSurveillance/basic-info");

        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.Equal("No assessment details are available for this certification yet.", await r.ProblemTitle());
        Assert.Equal("SilverSurveillance", FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == MsmeAssessment.DesktopProcedure).Args, "Certification"));
    }

    // ----- non-conformances -----

    [Fact]
    public async Task Bronze_non_conformances_load_each_raised_round_as_the_msme()
    {
        var client = await SignInAsync();
        var json = await client.GetFromJsonAsync<JsonElement>($"/api/msme/assessment/Bronze/non-conformances?zedId={Other}");

        Assert.Equal("da", json.GetProperty("variant").GetString());
        Assert.Equal(2, json.GetProperty("ncCount").GetInt32());
        var calls = _host.Sql.Calls.Where(c => c.Name == MsmeAssessment.RoundProcedure).ToList();
        Assert.Equal(["1", "2"], calls.Select(c => FakeSql.Arg(c.Args, "NcCount")));
        Assert.All(calls, c =>
        {
            Assert.Equal(Me, FakeSql.Arg(c.Args, "ZedId"));
            Assert.Equal(Me, FakeSql.Arg(c.Args, "UserId"));
            Assert.Equal("5", FakeSql.Arg(c.Args, "RoleId"));
            Assert.Equal("Bronze", FakeSql.Arg(c.Args, "Certification"));
        });
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == MsmeAssessment.SiteProcedure);

        var rounds = json.GetProperty("rounds");
        Assert.Equal(2, rounds.GetArrayLength());
        var nc2 = rounds[1];
        Assert.Equal(2, nc2.GetProperty("number").GetInt32());
        Assert.Equal("NC2: add policy", nc2.GetProperty("requirements")[0].GetProperty("PreviousAssessorRemarks").GetString());
        Assert.Equal("added", nc2.GetProperty("requirements")[0].GetProperty("MsmeComments").GetString());
        Assert.Equal($"/api/msme/assessment/Bronze/files/nc2/mobileapi/Photos/{Me}/Bronze/Evidences/N2.pdf", nc2.GetProperty("evidences")[0].GetProperty("FileUrl").GetString());
        Assert.Equal($"/api/msme/assessment/Bronze/files/nc2/mobileapi/Photos/{Me}/Bronze/SiteExteriorPhotos/X2.jpg", nc2.GetProperty("photos")[0].GetProperty("FileUrl").GetString());
        Assert.Equal("new photo", nc2.GetProperty("photos")[0].GetProperty("MsmeRemarks").GetString());
        Assert.DoesNotContain("next round notes", json.GetRawText());
        Assert.DoesNotContain("SaProductPhoto", json.GetRawText());
        // The desktop assessment is the NC1 starting point.
        Assert.Equal("blurred", json.GetProperty("assessment").GetProperty("photos")[1].GetProperty("AssessorRemarks").GetString());
    }

    [Fact]
    public async Task Silver_non_conformances_add_the_site_assessment_evidence_photos()
    {
        var client = await SignInAsync();
        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/assessment/Silver/non-conformances");

        Assert.Equal("sa", json.GetProperty("variant").GetString());
        var sa = Assert.Single(_host.Sql.Calls, c => c.Name == MsmeAssessment.SiteProcedure);
        Assert.Equal(Me, FakeSql.Arg(sa.Args, "ZedId"));
        Assert.Equal("Silver", FakeSql.Arg(sa.Args, "Certification"));

        Assert.Equal([$"/api/msme/assessment/Silver/files/sa/mobileapi/SaPhotos/{Me}/Silver/Evidences/SA1.jpg", null, null],
            Strings(json.GetProperty("saEvidencePhotos"), "FileUrl"));
        Assert.Equal($"/api/msme/assessment/Silver/files/nc1/mobileapi/SaPhotos/{Me}/Silver/BasicInfo/R1.jpg",
            json.GetProperty("rounds")[0].GetProperty("productPhotos")[0].GetProperty("FileUrl").GetString());
    }

    [Fact]
    public async Task Nc_count_is_limited_to_five_rounds()
    {
        _host.Sql.Procs[MsmeAssessment.DesktopProcedure] = args => Desktop(FakeSql.Arg(args, "ZedId")!, "Bronze", ncCount: 9);
        var client = await SignInAsync();
        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/assessment/Bronze/non-conformances");

        Assert.Equal(5, json.GetProperty("rounds").GetArrayLength());
        Assert.Equal(5, _host.Sql.Calls.Count(c => c.Name == MsmeAssessment.RoundProcedure));
    }

    // ----- evidence files -----

    [Fact]
    public async Task Listed_files_of_the_signed_in_msme_are_served_inline()
    {
        WriteFile($"mobileapi/Photos/{Me}/Bronze/Evidences/E1.pdf", "%PDF-1.4 evidence");
        WriteFile($"mobileapi/Photos/{Me}/Bronze/Selfie/S1.jpg", "jpeg");
        WriteFile($"mobileapi/Photos/{Me}/Bronze/Evidences/N2.pdf", "%PDF-1.4 nc2");
        WriteFile($"mobileapi/SaPhotos/{Me}/Silver/Evidences/SA1.jpg", "jpeg sa");
        var client = await SignInAsync();

        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/assessment/Bronze/basic-info");
        var evidence = await client.GetAsync(json.GetProperty("evidences")[0].GetProperty("FileUrl").GetString());
        Assert.Equal(HttpStatusCode.OK, evidence.StatusCode);
        Assert.Equal("application/pdf", evidence.Content.Headers.ContentType!.MediaType);
        Assert.Equal("inline", evidence.Content.Headers.ContentDisposition!.DispositionType);
        Assert.Equal("%PDF-1.4 evidence", await evidence.Content.ReadAsStringAsync());
        Assert.Equal("nosniff", evidence.Headers.GetValues("X-Content-Type-Options").Single());

        var selfie = await client.GetAsync($"/api/msme/assessment/Bronze/files/da/mobileapi/Photos/{Me}/Bronze/Selfie/S1.jpg");
        Assert.Equal("image/jpeg", selfie.Content.Headers.ContentType!.MediaType);

        Assert.Equal("%PDF-1.4 nc2", await client.GetStringAsync($"/api/msme/assessment/Bronze/files/nc2/mobileapi/Photos/{Me}/Bronze/Evidences/N2.pdf"));
        Assert.Equal("jpeg sa", await client.GetStringAsync($"/api/msme/assessment/Silver/files/sa/mobileapi/SaPhotos/{Me}/Silver/Evidences/SA1.jpg"));
    }

    [Fact]
    public async Task Another_msmes_files_are_not_served_even_when_they_exist()
    {
        WriteFile($"mobileapi/Photos/{Other}/Bronze/Evidences/E1.pdf");
        WriteFile($"mobileapi/SaPhotos/{Other}/Silver/Evidences/SA2.jpg");
        var client = await SignInAsync();

        // The other MSME's own procedure rows would list it, but the cookie's ZED ID is used.
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/msme/assessment/Bronze/files/da/mobileapi/Photos/{Other}/Bronze/Evidences/E1.pdf")).StatusCode);
        // A foreign path in this MSME's rows is not listed either.
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/msme/assessment/Silver/files/sa/mobileapi/SaPhotos/{Other}/Silver/Evidences/SA2.jpg")).StatusCode);

        // Signed in as the other MSME the same file is fine.
        var other = await SignInAsync(Other);
        Assert.Equal(HttpStatusCode.OK, (await other.GetAsync($"/api/msme/assessment/Bronze/files/da/mobileapi/Photos/{Other}/Bronze/Evidences/E1.pdf")).StatusCode);
    }

    [Theory]
    [InlineData("da/mobileapi/Photos/ZEDMSME000001/Bronze/Evidences/E9.pdf")]            // not in the rows
    [InlineData("nc1/mobileapi/Photos/ZEDMSME000001/Bronze/Evidences/E1.pdf")]           // listed by another source
    [InlineData("nc3/mobileapi/Photos/ZEDMSME000001/Bronze/Evidences/N3.pdf")]           // round not raised (NcCount 2)
    [InlineData("sa/mobileapi/Photos/ZEDMSME000001/Bronze/Evidences/E1.pdf")]            // no site assessment for Bronze
    [InlineData("xx/mobileapi/Photos/ZEDMSME000001/Bronze/Evidences/E1.pdf")]            // unknown source
    [InlineData("da/mobileapi/Photos/ZEDMSME000001/Bronze/Evidences/..%2F..%2Fweb.config")]
    [InlineData("da/Certificates/ZEDMSME000001/Pledge.pdf")]                               // outside the mobile app folders
    [InlineData("da/mobileapi/Photos/ZEDMSME000001/Bronze/Evidences/E1.exe")]
    public async Task Unlisted_or_malformed_paths_are_404(string rest)
    {
        WriteFile($"mobileapi/Photos/{Me}/Bronze/Evidences/E1.pdf");
        WriteFile($"mobileapi/Photos/{Me}/Bronze/Evidences/E9.pdf");
        WriteFile($"mobileapi/Photos/{Me}/Bronze/Evidences/N3.pdf");
        WriteFile($"Certificates/{Me}/Pledge.pdf");
        var client = await SignInAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/msme/assessment/Bronze/files/{rest}")).StatusCode);
    }

    [Fact]
    public async Task Listed_file_missing_from_storage_is_404()
    {
        var client = await SignInAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/msme/assessment/Bronze/files/da/mobileapi/Photos/{Me}/Bronze/Evidences/E1.pdf")).StatusCode);
    }

    [Fact]
    public void Servable_paths_must_be_images_or_pdfs_of_the_zed_id_in_the_mobile_app_folders()
    {
        Assert.Equal($"mobileapi/Photos/{Me}/Bronze/Selfie/1.jpg", AssessmentFileLinks.Servable($"{Base}{Me}/Bronze/Selfie/1.jpg", Me));
        Assert.Equal($"surveillancemobileapi/CertifiedPhotos/{Me}/Gold/Evidences/E.pdf",
            AssessmentFileLinks.Servable($"https://loginzed.msme.gov.in/surveillancemobileapi/CertifiedPhotos/{Me}/Gold/Evidences/E.pdf", Me));
        Assert.Null(AssessmentFileLinks.Servable($"{Base}{Other}/Bronze/Selfie/1.jpg", Me));
        Assert.Null(AssessmentFileLinks.Servable($"{Base}{Me}/Bronze/Evidences/E.docx", Me));
        Assert.Null(AssessmentFileLinks.Servable($"https://loginzed.msme.gov.in/Uploads/DA/{Me}/x.pdf", Me));
        Assert.Null(AssessmentFileLinks.Servable($"//evil/mobileapi/Photos/{Me}/a.jpg", Me));
        Assert.Null(AssessmentFileLinks.Servable(null, Me));
    }
}
