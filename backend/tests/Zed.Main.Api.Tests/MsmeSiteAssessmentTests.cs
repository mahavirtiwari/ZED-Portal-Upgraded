using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Data;
using Zed.Portal.Features.Msme;

namespace Zed.Main.Api.Tests;

public sealed class MsmeSiteAssessmentTests : IDisposable
{
    private const string Me = "ZEDMSME000001";
    private const string Other = "ZEDMSME000002";
    private const string Site = "https://loginzed.msme.gov.in";

    private readonly TestHost _host = new();

    public MsmeSiteAssessmentTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args => FakeSql.Sets(
            [new { UserId = FakeSql.Arg(args, "UserId"), UserName = "Acme", RoleId = 5, Email = "a@acme.test" }],
            [new { ERRORMSG = "SUCCESS" }]);
        _host.Sql.Procs["SP_MSME_GET_DETAILS"] = args => FakeSql.Sets(
            [new Dictionary<string, object?> { ["ZedId"] = FakeSql.Arg(args, "ZedId"), ["EnterpriseName"] = "Acme Castings", ["PUnitName"] = "Unit 1", ["Password"] = "secret", ["MobileNo"] = "9999999999" }],
            [new Dictionary<string, object?> { ["UdyogAadharNo"] = "UDYAM-UP-29-0003915", ["PanNo"] = "ABCDE1234F" }],
            [], []);
        _host.Sql.Procs["SP_ASSESSMENT_DA_DETAILS"] = args => FakeSql.Arg(args, "Certification")!.Contains("Milestone") ? MilestoneDa() : AssessmentDa(FakeSql.Arg(args, "ZedId")!);
        _host.Sql.Procs["SP_ASSESSMENT_SA_DETAILS"] = args => FakeSql.Arg(args, "Certification")!.Contains("Milestone") ? MilestoneSa(FakeSql.Arg(args, "ZedId")!) : AssessmentSa(FakeSql.Arg(args, "ZedId")!);
    }

    public void Dispose() => _host.Dispose();

    // ----- procedure-shaped fake data -----

    private static Dictionary<string, object?> Row(params (string Key, object? Value)[] values) =>
        values.ToDictionary(v => v.Key, v => v.Value, StringComparer.OrdinalIgnoreCase);

    private static ResultSets AssessmentDa(string zedId) => FakeSql.Sets(
        [Row(("Id", 7), ("ZedId", zedId), ("AuditsConducted", "Yes"), ("DomesticCustomers", "Tata"), ("SaDomesticCustomers", "Tata, Mahindra"),
            ("InternationalCustomers", "-"), ("RawMaterialImported", "Yes"), ("SaRawMaterialImported", "Yes"), ("EnergySources", "Electricity, Solar"),
            ("AssessorRemarks", "Well maintained"), ("DesktopAssessorName", "Assessor A"), ("SiteAssessorName", "Assessor B"), ("AgencyName", "Agency X"),
            ("PlantAddress", "Plot 4"), ("PhotosPath", null), ("CertificationStatus", 13), ("IsCoAssessorLogin", 1))],
        [
            Row(("Id", 11), ("ZedId", zedId), ("Certification", "Silver"), ("ProductName", "Castings"), ("Exported", "No"), ("ProductPhoto", "p1.jpg"),
                ("ProductDescriptionPhoto", "d1.pdf"), ("ProductDescOpenedTime", null), ("AssessorRemarks", "internal")),
            Row(("Id", 12), ("ProductName", "Bad photo"), ("Exported", "Yes"), ("ProductPhoto", "../../../web.config"), ("ProductDescriptionPhoto", "")),
        ],
        [Row(("ModeOfAssessment", "DA"), ("Id", 1), ("ZedId", zedId), ("RawMaterialName", "Steel"), ("Percentage", "20"), ("CountryName", "Japan"))],
        [
            Row(("Id", 1), ("SectionCode", "1"), ("SectionName", "Leadership"), ("iButton", "About leadership"), ("IsAssessmentExcempted", null), ("AllotedAssessorName", "Assessor B")),
            Row(("Id", 2), ("SectionCode", "2"), ("SectionName", "Swachh Workplace"), ("iButton", "About 5S"), ("IsAssessmentExcempted", "Yes")),
        ],
        [
            Row(("Id", 101), ("SectionCode", "1"), ("RequirementCode", "1"), ("RequirementId", 1), ("SaConformance", "Yes"), ("SaAssessorRemarks", "internal")),
            Row(("Id", 102), ("SectionCode", "1"), ("RequirementCode", "11"), ("RequirementId", 11)),
            Row(("Id", 103), ("SectionCode", "2"), ("RequirementCode", "1"), ("RequirementId", 21)),
        ],
        [
            Row(("SectionCode", "1"), ("RequirementCode", "1"), ("OptionCode", "1"), ("OptionName", "Vision displayed")),
            Row(("SectionCode", "1"), ("RequirementCode", "11"), ("OptionCode", "1"), ("OptionName", "Other option")),
        ],
        [Row(("SectionCode", "1"), ("RequirementCode", "1"), ("OptionCode", "1"), ("SubOptionName", "In local language"))],
        [
            Row(("SectionCode", "1"), ("RequirementCode", "1"), ("EvidenceId", "E55"), ("EvidenceName", "Vision statement"), ("AssessorRemarks", "internal")),
            Row(("SectionCode", "1"), ("RequirementCode", "11"), ("EvidenceId", "E56"), ("EvidenceName", "Other evidence")),
        ]);

    private static ResultSets AssessmentSa(string zedId)
    {
        var sets = Enumerable.Range(0, 15).Select(_ => (IEnumerable<object>)Array.Empty<object>()).ToArray();
        sets[1] = [Row(("Id", 1), ("MeetingType", "Open Meeting"), ("Comments", "internal meeting"), ("NcCount", 0))];
        sets[2] = [Row(("Name", "Participant P"), ("Designation", "Owner"))];
        sets[6] =
        [
            Row(("name", "Shop floor"), ("src", $"{Site}/mobileapi/SaPhotos/{zedId}/Silver/SiteTour/9.jpg"), ("Latitude", "28.1"), ("AssessorId", "ASR1")),
            Row(("name", "Someone else"), ("src", $"{Site}/mobileapi/SaPhotos/{Other}/Silver/SiteTour/9.jpg")),
            Row(("name", "Bad"), ("src", "javascript:alert(1)")),
        ];
        sets[7] =
        [
            Row(("name", "Vision board"), ("RequirementId", 1), ("src", $"{Site}/mobileapi/SaPhotos/{zedId}/Silver/SiteTour/31.jpg"), ("CreatedDate", "May 01, 2024 10:00 AM"), ("NcCount", 0)),
            Row(("name", "Other board"), ("RequirementId", 11), ("src", $"{Site}/mobileapi/SaPhotos/{zedId}/Silver/SiteTour/32.jpg")),
        ];
        sets[9] = [Row(("Id", 501), ("ProductName", "Added on site"), ("Exported", "Yes"), ("ProductPhoto", "x.jpg"))];
        sets[11] = [Row(("name", "Product photo"), ("ProductId", 11), ("src", $"{Site}/mobileapi/SaPhotos/{zedId}/Silver/BasicInfo/41.jpg"))];
        sets[12] = [Row(("name", "Selfie"), ("src", $"{Site}/mobileapi/SaPhotos/{zedId}/Silver/ASR1.jpg"))];
        sets[13] = [Row(("name", "Surveillance tour"), ("src", $"{Site}/surveillancemobileapi/SaPhotos/{zedId}/Silver/SiteTour/5.jpg"))];
        sets[14] = [Row(("name", "Surveillance evidence"), ("RequirementId", 1), ("src", $"/surveillancemobileapi/SaPhotos/{zedId}/Silver/SiteTour/6.jpg"))];
        return FakeSql.Sets(sets);
    }

    private static ResultSets MilestoneDa() => FakeSql.Sets(
        [Row(("Id", 9), ("AssessorRemarks", "Milestone remarks"), ("TechExpertName", "Expert E"), ("SiteAssessorName", "Consultant C"))],
        [], [],
        [Row(("SectionCode", "1"), ("SectionName", "Leadership"), ("iButton", "i"), ("IsAssessmentExcempted", "No"), ("NcCount", 2))],
        [Row(("Id", 301), ("SectionCode", "1"), ("RequirementCode", "1"), ("RequirementId", 1), ("SaConformance", "Partially"), ("BaselineRemarks", "Baseline ok"),
            ("EstimatedTimeInDays", "30"), ("HActionPlanRemarks", "Plan ok"), ("Intervention", "Needs ERP"), ("InterventionRemarks", "Tech ok"),
            ("IsProposedActivityCompleted", "Yes"), ("ProgressReviewRemarks", "Done"), ("IsProposedActivityCompleted2", null), ("ProgressReviewRemarks2", null),
            ("SaAssessorRemarks", "internal"), ("BaselineDate", "2024-01-01"))],
        [], [], []);

    private static ResultSets MilestoneSa(string zedId)
    {
        var sets = Enumerable.Range(0, 21).Select(_ => (IEnumerable<object>)Array.Empty<object>()).ToArray();
        sets[0] =
        [
            Row(("name", "Site Exterior Photo"), ("NcCount", 1), ("CreatedDate", new DateTime(2024, 5, 1, 14, 30, 0)), ("src", $"{Site}/consultancymobileapi/SaPhotos/{zedId}/Silver/Site Exterior Photo_1.jpg")),
            Row(("name", "Site Exterior Photo"), ("NcCount", 2), ("src", $"{Site}/consultancymobileapi/SaPhotos/{zedId}/Silver/Site Exterior Photo_2.jpg")),
        ];
        sets[1] = [Row(("NcCount", 1), ("Comments", "internal")), Row(("NcCount", 2))];
        sets[6] = [Row(("name", "Tour"), ("src", $"{Site}/consultancymobileapi/SaPhotos/{zedId}/Silver/SiteTour/7.jpg"))];
        sets[7] =
        [
            Row(("name", "Baseline"), ("RequirementId", 1), ("NcCount", 1), ("CreatedDate", "May 02, 2024 10:00 AM"), ("src", $"{Site}/consultancymobileapi/SaPhotos/{zedId}/Silver/BaselineDiagnosticStudy/8.jpg")),
            Row(("name", "Review"), ("RequirementId", 1), ("NcCount", 2), ("src", $"{Site}/consultancymobileapi/SaPhotos/{zedId}/Silver/ProgressReview/9.jpg")),
        ];
        sets[13] = [Row(("TrainingType", "ZedTraining"), ("Comments", "internal"))];
        sets[17] = [Row(("Id", 1), ("ZedId", zedId), ("NcCount", 1), ("NumOfAccedents", "0"), ("TurnOver", "10 Cr"), ("RefId", "R1"))];
        sets[18] =
        [
            Row(("Id", 1), ("RequirementId", 301), ("ReqType", "BaselineDiagnostic"), ("BulletPoints", "Gap one")),
            Row(("Id", 2), ("RequirementId", 301), ("ReqType", "HandholdingActionPlan"), ("BulletPoints", "Plan one")),
            Row(("Id", 3), ("RequirementId", 301), ("ReqType", "TechnologyIntervention"), ("BulletPoints", "ERP")),
            Row(("Id", 4), ("RequirementId", 3010), ("ReqType", "BaselineDiagnostic"), ("BulletPoints", "Not this requirement")),
        ];
        sets[20] = [Row(("SectionCode", "1"), ("AllotedAssessorName", "Consultant C"))];
        return FakeSql.Sets(sets);
    }

    private async Task<HttpClient> SignInAsync(string zedId = Me)
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = zedId, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    private string WriteFile(string relative, string content = "jpeg-bytes")
    {
        var path = Path.Combine(_host.StorageRoot, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
        return path;
    }

    private static string PhotoUrl(string relative) =>
        SitePhotoPaths.ApiPrefix + string.Join('/', relative.Split('/').Select(Uri.EscapeDataString));

    // ----- data endpoint -----

    [Theory]
    [InlineData("/api/msme/site-assessment/Silver")]
    [InlineData("/api/msme/site-assessment/photos/mobileapi/SaPhotos/ZEDMSME000001/Silver/SiteTour/9.jpg")]
    public async Task Endpoints_require_a_signed_in_msme(string url)
    {
        WriteFile($"mobileapi/SaPhotos/{Me}/Silver/SiteTour/9.jpg");
        var client = await _host.CreateBrowserAsync();

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(url)).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_ASSESSMENT", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Uses_the_signed_in_zed_id_as_msme_role_even_when_another_is_sent()
    {
        var client = await SignInAsync();
        var r = await client.GetAsync($"/api/msme/site-assessment/Silver?zedId={Other}&roleId=7");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        foreach (var proc in new[] { "SP_ASSESSMENT_DA_DETAILS", "SP_ASSESSMENT_SA_DETAILS" })
        {
            var call = Assert.Single(_host.Sql.Calls, c => c.Name == proc);
            Assert.Equal(Me, FakeSql.Arg(call.Args, "ZedId"));
            Assert.Equal(Me, FakeSql.Arg(call.Args, "UserId"));
            Assert.Equal("5", FakeSql.Arg(call.Args, "RoleId"));
            Assert.Equal("Silver", FakeSql.Arg(call.Args, "Certification"));
        }
        var details = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_GET_DETAILS");
        Assert.Equal(Me, FakeSql.Arg(details.Args, "ZedId"));
        Assert.Equal("Silver", FakeSql.Arg(details.Args, "CertificationType"));
    }

    [Theory]
    [InlineData("silver", "Silver", "assessment")]
    [InlineData("GOLD", "Gold", "assessment")]
    [InlineData("SilverSurveillance", "Silver", "assessment")]
    [InlineData("goldsurveillance", "Gold", "assessment")]
    [InlineData("SilverMilestone1", "SilverMilestone1", "milestone")]
    [InlineData("goldmilestone3", "GoldMilestone3", "milestone")]
    public async Task Certification_types_are_passed_in_the_spelling_the_procedures_expect(string requested, string expected, string kind)
    {
        var client = await SignInAsync();
        var json = await client.GetFromJsonAsync<JsonElement>($"/api/msme/site-assessment/{requested}");

        Assert.Equal(expected, json.GetProperty("certification").GetString());
        Assert.Equal(kind, json.GetProperty("kind").GetString());
        Assert.All(_host.Sql.Calls.Where(c => c.Name.StartsWith("SP_ASSESSMENT", StringComparison.Ordinal)),
            c => Assert.Equal(expected, FakeSql.Arg(c.Args, "Certification")));
    }

    [Theory]
    [InlineData("Bronze")]
    [InlineData("BronzeSurveillance")]
    [InlineData("Platinum")]
    [InlineData("SilverMilestone4")]
    [InlineData("Techupgrade")]
    [InlineData("Silver' OR 1=1 --")]
    public async Task Unknown_certification_types_are_rejected_without_calling_the_database(string certification)
    {
        var client = await SignInAsync();
        var r = await client.GetAsync($"/api/msme/site-assessment/{Uri.EscapeDataString(certification)}");

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal("Invalid certification.", await r.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_ASSESSMENT", StringComparison.Ordinal) || c.Name == "SP_MSME_GET_DETAILS");
    }

    [Fact]
    public async Task No_assessment_yet_returns_404_with_a_message()
    {
        _host.Sql.Procs["SP_ASSESSMENT_DA_DETAILS"] = _ => FakeSql.Sets([], [], []);
        var client = await SignInAsync();
        var r = await client.GetAsync("/api/msme/site-assessment/Gold");

        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.Equal("No site assessment details are available for this certification yet.", await r.ProblemTitle());
    }

    [Fact]
    public async Task Assessment_returns_only_the_columns_the_page_shows()
    {
        var client = await SignInAsync();
        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/site-assessment/Silver");
        var raw = json.GetRawText();

        Assert.Equal("Acme Castings", json.GetProperty("msme").GetProperty("EnterpriseName").GetString());
        Assert.Equal("UDYAM-UP-29-0003915", json.GetProperty("basicInfo").GetProperty("UdyogAadharNo").GetString());
        var a = json.GetProperty("assessment");
        Assert.Equal("Yes", a.GetProperty("AuditsConducted").GetString());
        Assert.Equal("Tata, Mahindra", a.GetProperty("SaDomesticCustomers").GetString());
        Assert.Equal("Well maintained", a.GetProperty("AssessorRemarks").GetString());
        Assert.Equal(JsonValueKind.Null, a.GetProperty("SaEnergySources").ValueKind);

        var rm = Assert.Single(json.GetProperty("rawMaterials").EnumerateArray());
        Assert.Equal(["RawMaterialName", "Percentage", "CountryName"], rm.EnumerateObject().Select(p => p.Name));

        // Assessor/agency details, internal remarks, meetings, selfies, locations and secrets are not sent.
        foreach (var hidden in new[] { "Assessor A", "Assessor B", "Agency X", "Plot 4", "internal", "Participant P", "Selfie", "ASR1", "28.1", "secret", "9999999999", "ABCDE1234F", "PhotosPath", "CertificationStatus" })
            Assert.DoesNotContain(hidden, raw);
        Assert.DoesNotContain(Site, raw);
    }

    [Fact]
    public async Task Parameters_nest_requirements_options_evidences_and_photos_by_exact_codes()
    {
        var client = await SignInAsync();
        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/site-assessment/Silver");

        var sections = json.GetProperty("sections").EnumerateArray().ToList();
        Assert.Equal(2, sections.Count);
        Assert.Equal("Leadership", sections[0].GetProperty("sectionName").GetString());
        Assert.Equal("About leadership", sections[0].GetProperty("iButton").GetString());
        Assert.Equal("Yes", sections[1].GetProperty("isAssessmentExcempted").GetString());

        var reqs = sections[0].GetProperty("requirements").EnumerateArray().ToList();
        Assert.Equal(["1", "11"], reqs.Select(r => r.GetProperty("requirementCode").GetString()));

        var r1 = reqs[0];
        var option = Assert.Single(r1.GetProperty("options").EnumerateArray());
        Assert.Equal("Vision displayed", option.GetProperty("optionName").GetString());
        Assert.Equal("In local language", Assert.Single(option.GetProperty("subOptions").EnumerateArray()).GetString());

        // "1" does not pick up requirement 11's evidence or photo (the old filters matched substrings).
        var evidence = Assert.Single(r1.GetProperty("evidences").EnumerateArray());
        Assert.Equal("Vision statement", evidence.GetProperty("evidenceName").GetString());
        Assert.Equal(PhotoUrl($"mobileapi/Photos/{Me}/Silver/Evidences/E55.pdf"), evidence.GetProperty("url").GetString());

        var photo = Assert.Single(r1.GetProperty("photos").EnumerateArray());
        Assert.Equal("Vision board", photo.GetProperty("name").GetString());
        Assert.Equal(PhotoUrl($"mobileapi/SaPhotos/{Me}/Silver/SiteTour/31.jpg"), photo.GetProperty("src").GetString());
        Assert.Equal("May 01, 2024 10:00 AM", photo.GetProperty("createdDate").GetString());

        var surveillance = Assert.Single(r1.GetProperty("surveillancePhotos").EnumerateArray());
        Assert.Equal(PhotoUrl($"surveillancemobileapi/SaPhotos/{Me}/Silver/SiteTour/6.jpg"), surveillance.GetProperty("src").GetString());

        Assert.Equal("Other board", Assert.Single(reqs[1].GetProperty("photos").EnumerateArray()).GetProperty("name").GetString());
        Assert.Empty(sections[1].GetProperty("requirements")[0].GetProperty("photos").EnumerateArray());
        Assert.Equal(JsonValueKind.Null, r1.GetProperty("bullets").ValueKind);
        Assert.Empty(r1.GetProperty("milestone").EnumerateObject());
    }

    [Fact]
    public async Task Products_site_tour_and_surveillance_photos_link_to_the_photo_api_for_own_files_only()
    {
        var client = await SignInAsync();
        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/site-assessment/Silver");

        var products = json.GetProperty("products").EnumerateArray().ToList();
        Assert.Equal(["Castings", "Bad photo", "Added on site"], products.Select(p => p.GetProperty("productName").GetString()));
        Assert.Equal(PhotoUrl($"mobileapi/Photos/{Me}/Silver/BasicInfo/p1.jpg"), products[0].GetProperty("productPhoto").GetString());
        Assert.Equal(PhotoUrl($"mobileapi/Photos/{Me}/Silver/BasicInfo/d1.pdf"), products[0].GetProperty("productDescriptionPhoto").GetString());
        Assert.Equal("pdf", products[0].GetProperty("productDescriptionKind").GetString());
        Assert.Equal(PhotoUrl($"mobileapi/SaPhotos/{Me}/Silver/BasicInfo/41.jpg"), Assert.Single(products[0].GetProperty("photos").EnumerateArray()).GetProperty("src").GetString());
        Assert.Equal(JsonValueKind.Null, products[1].GetProperty("productPhoto").ValueKind);   // ../ in the file name
        Assert.Equal(JsonValueKind.Null, products[2].GetProperty("productPhoto").ValueKind);   // site products had no DA upload

        var tour = json.GetProperty("siteTourPhotos").EnumerateArray().Select(p => p.GetProperty("src").GetString()).ToList();
        Assert.Equal([PhotoUrl($"mobileapi/SaPhotos/{Me}/Silver/SiteTour/9.jpg"), null, null], tour);

        Assert.Equal(PhotoUrl($"surveillancemobileapi/SaPhotos/{Me}/Silver/SiteTour/5.jpg"),
            Assert.Single(json.GetProperty("surveillancePhotos").EnumerateArray()).GetProperty("src").GetString());
        Assert.Empty(json.GetProperty("siteExteriorPhotos").EnumerateArray());
    }

    [Fact]
    public async Task Certified_photos_folder_is_used_once_the_files_were_moved()
    {
        _host.Sql.Procs["SP_ASSESSMENT_DA_DETAILS"] = args =>
        {
            var sets = AssessmentDa(Me);
            var first = new Dictionary<string, object?>(sets[0][0], StringComparer.OrdinalIgnoreCase) { ["PhotosPath"] = "\\\\nas\\zed" };
            return FakeSql.Sets(Enumerable.Range(0, 8).Select(i => i == 0 ? (IEnumerable<object>)[first] : sets[i]).ToArray());
        };
        var client = await SignInAsync();
        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/site-assessment/Silver");

        Assert.Equal(PhotoUrl($"mobileapi/CertifiedPhotos/{Me}/Silver/BasicInfo/p1.jpg"), json.GetProperty("products")[0].GetProperty("productPhoto").GetString());
        Assert.DoesNotContain("nas", json.GetRawText());
    }

    [Fact]
    public async Task Milestone_returns_handholding_data()
    {
        var client = await SignInAsync();
        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/site-assessment/SilverMilestone2");
        var raw = json.GetRawText();

        Assert.Equal("Milestone remarks", json.GetProperty("assessment").GetProperty("AssessorRemarks").GetString());
        Assert.Empty(json.GetProperty("products").EnumerateArray());

        var exterior = json.GetProperty("siteExteriorPhotos").EnumerateArray().ToList();
        Assert.Equal([1, 2], exterior.Select(m => m.GetProperty("ncCount").GetInt32()));
        var p1 = Assert.Single(exterior[0].GetProperty("photos").EnumerateArray());
        Assert.Equal(PhotoUrl($"consultancymobileapi/SaPhotos/{Me}/Silver/Site Exterior Photo_1.jpg"), p1.GetProperty("src").GetString());
        Assert.Equal("May 01, 2024 02:30 PM", p1.GetProperty("createdDate").GetString());

        var info = Assert.Single(json.GetProperty("consultancyBasicInfo").EnumerateArray());
        Assert.Equal(1, info.GetProperty("NcCount").GetInt32());
        Assert.Equal("10 Cr", info.GetProperty("TurnOver").GetString());
        Assert.False(info.TryGetProperty("RefId", out _));
        Assert.False(info.TryGetProperty("ZedId", out _));

        var section = Assert.Single(json.GetProperty("sections").EnumerateArray());
        Assert.Equal(2, section.GetProperty("ncCount").GetInt32());
        var req = Assert.Single(section.GetProperty("requirements").EnumerateArray());
        var m = req.GetProperty("milestone");
        Assert.Equal("Partially", m.GetProperty("SaConformance").GetString());
        Assert.Equal("Needs ERP", m.GetProperty("Intervention").GetString());
        Assert.Equal("Done", m.GetProperty("ProgressReviewRemarks").GetString());
        Assert.False(m.TryGetProperty("SaAssessorRemarks", out _));
        Assert.Equal(["Gap one"], req.GetProperty("bullets").GetProperty("baselineDiagnostic").EnumerateArray().Select(b => b.GetString()));
        Assert.Equal(["Plan one"], req.GetProperty("bullets").GetProperty("handholdingActionPlan").EnumerateArray().Select(b => b.GetString()));
        Assert.Equal(["ERP"], req.GetProperty("bullets").GetProperty("technologyIntervention").EnumerateArray().Select(b => b.GetString()));
        Assert.Equal([1, 2], req.GetProperty("photos").EnumerateArray().Select(p => p.GetProperty("ncCount").GetInt32()));
        Assert.Equal(PhotoUrl($"consultancymobileapi/SaPhotos/{Me}/Silver/SiteTour/7.jpg"), Assert.Single(json.GetProperty("siteTourPhotos").EnumerateArray()).GetProperty("src").GetString());

        foreach (var hidden in new[] { "internal", "Expert E", "Consultant C", "Not this requirement", "BaselineDate" })
            Assert.DoesNotContain(hidden, raw);
    }

    // ----- photo endpoint -----

    [Fact]
    public async Task Own_photo_is_served_inline()
    {
        WriteFile($"mobileapi/SaPhotos/{Me}/Silver/SiteTour/9.jpg", "photo-9");
        var client = await SignInAsync();

        var r = await client.GetAsync(PhotoUrl($"mobileapi/SaPhotos/{Me}/Silver/SiteTour/9.jpg"));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("image/jpeg", r.Content.Headers.ContentType!.MediaType);
        Assert.Equal("inline", r.Content.Headers.ContentDisposition!.DispositionType);
        Assert.Equal("nosniff", r.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("photo-9", await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Photos_with_spaces_evidence_pdfs_and_other_stores_are_served()
    {
        WriteFile($"consultancymobileapi/SaPhotos/{Me}/Silver/Site Exterior Photo_1.jpg");
        WriteFile($"mobileapi/Photos/{Me}/Silver/Evidences/E55.pdf", "%PDF-1.4");
        WriteFile($"surveillancemobileapi/SaPhotos/{Me}/Gold/SiteTour/5.jpg");
        var client = await SignInAsync();

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(PhotoUrl($"consultancymobileapi/SaPhotos/{Me}/Silver/Site Exterior Photo_1.jpg"))).StatusCode);
        var pdf = await client.GetAsync(PhotoUrl($"mobileapi/Photos/{Me}/Silver/Evidences/E55.pdf"));
        Assert.Equal(HttpStatusCode.OK, pdf.StatusCode);
        Assert.Equal("application/pdf", pdf.Content.Headers.ContentType!.MediaType);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(PhotoUrl($"surveillancemobileapi/SaPhotos/{Me}/Gold/SiteTour/5.jpg"))).StatusCode);
    }

    [Fact]
    public async Task Moved_photos_are_found_in_the_certified_folder()
    {
        WriteFile($"mobileapi/SaCertifiedPhotos/{Me}/Silver/SiteTour/9.jpg", "moved");
        WriteFile($"mobileapi/Photos/{Me}/Silver/BasicInfo/p1.jpg", "not moved");
        var client = await SignInAsync();

        Assert.Equal("moved", await client.GetStringAsync(PhotoUrl($"mobileapi/SaPhotos/{Me}/Silver/SiteTour/9.jpg")));
        Assert.Equal("not moved", await client.GetStringAsync(PhotoUrl($"mobileapi/CertifiedPhotos/{Me}/Silver/BasicInfo/p1.jpg")));
    }

    [Theory]
    [InlineData("mobileapi/SaPhotos/ZEDMSME000002/Silver/SiteTour/9.jpg")]       // another MSME's photo
    [InlineData("mobileapi/Photos/ZEDMSME000002/Silver/Evidences/E1.pdf")]
    [InlineData("mobileapi/SaPhotos/ZEDMSME0000010/Silver/SiteTour/9.jpg")]      // ZED ID prefix is not enough
    [InlineData("mobileapi/SaPhotos/Silver/ZEDMSME000001/9.jpg")]                // ZED ID in the wrong place
    [InlineData("mobileapi/Videos/ZEDMSME000001/Silver/9.jpg")]                  // not a photo store
    [InlineData("Certificates/ZEDMSME000001/Silver/Pledge.pdf")]
    [InlineData("mobileapi/SaPhotos/ZEDMSME000001/Silver/SiteTour/missing.jpg")] // not in storage
    [InlineData("mobileapi/SaPhotos/ZEDMSME000001/Silver/notes.txt")]            // not an image or PDF
    [InlineData("mobileapi/SaPhotos/ZEDMSME000001/Silver/data.json")]
    public async Task Photos_outside_the_signed_in_msme_folder_are_not_found(string relative)
    {
        WriteFile("mobileapi/SaPhotos/ZEDMSME000002/Silver/SiteTour/9.jpg");
        WriteFile("mobileapi/Photos/ZEDMSME000002/Silver/Evidences/E1.pdf");
        WriteFile("mobileapi/SaPhotos/ZEDMSME0000010/Silver/SiteTour/9.jpg");
        WriteFile("mobileapi/SaPhotos/Silver/ZEDMSME000001/9.jpg");
        WriteFile("mobileapi/Videos/ZEDMSME000001/Silver/9.jpg");
        WriteFile("Certificates/ZEDMSME000001/Silver/Pledge.pdf");
        WriteFile("mobileapi/SaPhotos/ZEDMSME000001/Silver/notes.txt");
        WriteFile("mobileapi/SaPhotos/ZEDMSME000001/Silver/data.json");
        var client = await SignInAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(PhotoUrl(relative))).StatusCode);
    }

    [Fact]
    public async Task The_other_msme_can_read_its_own_photo()
    {
        WriteFile($"mobileapi/SaPhotos/{Other}/Silver/SiteTour/9.jpg");
        var client = await SignInAsync(Other);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(PhotoUrl($"mobileapi/SaPhotos/{Other}/Silver/SiteTour/9.jpg"))).StatusCode);
    }

    [Theory]
    [InlineData("/api/msme/site-assessment/photos/mobileapi/SaPhotos/ZEDMSME000001/..%2F..%2F..%2F..%2Fsecret.jpg")]
    [InlineData("/api/msme/site-assessment/photos/mobileapi/SaPhotos/ZEDMSME000001/..%5C..%5C..%5C..%5Csecret.jpg")]
    [InlineData("/api/msme/site-assessment/photos/mobileapi/SaPhotos/ZEDMSME000001/%2E%2E/%2E%2E/%2E%2E/%2E%2E/secret.jpg")]
    [InlineData("/api/msme/site-assessment/photos/mobileapi/SaPhotos/ZEDMSME000001/x/../../../../secret.jpg")]
    [InlineData("/api/msme/site-assessment/photos/mobileapi/SaPhotos/ZEDMSME000001/.../secret.jpg")]
    [InlineData("/api/msme/site-assessment/photos/C:%2Fsecret.jpg")]
    [InlineData("/api/msme/site-assessment/photos/%5C%5Cserver%5Cshare%5Csecret.jpg")]
    public async Task Path_traversal_is_refused(string url)
    {
        var outside = Path.Combine(Path.GetDirectoryName(_host.StorageRoot)!, "secret.jpg");
        WriteFile($"mobileapi/SaPhotos/{Me}/Silver/SiteTour/9.jpg");
        var client = await SignInAsync();
        try
        {
            File.WriteAllText(outside, "secret");
            var r = await client.GetAsync(url);
            // Dot segments the client resolves can land on the data endpoint (400 Invalid certification); never a file.
            Assert.Contains(r.StatusCode, new[] { HttpStatusCode.NotFound, HttpStatusCode.BadRequest });
            Assert.DoesNotContain("secret", await r.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }
        finally { File.Delete(outside); }
    }
}

public sealed class SitePhotoPathsTests
{
    private const string Me = "ZEDMSME000001";

    [Theory]
    [InlineData("https://loginzed.msme.gov.in/mobileapi/SaPhotos/ZEDMSME000001/Silver/SiteTour/1.jpg", "/api/msme/site-assessment/photos/mobileapi/SaPhotos/ZEDMSME000001/Silver/SiteTour/1.jpg")]
    [InlineData("http://localhost:4200/consultancymobileapi/SaPhotos/ZEDMSME000001/Gold/Opening Meeting Photo_3.jpg", "/api/msme/site-assessment/photos/consultancymobileapi/SaPhotos/ZEDMSME000001/Gold/Opening%20Meeting%20Photo_3.jpg")]
    [InlineData("/surveillancemobileapi/SaPhotos/ZEDMSME000001/Silver/SiteTour/2.jpg", "/api/msme/site-assessment/photos/surveillancemobileapi/SaPhotos/ZEDMSME000001/Silver/SiteTour/2.jpg")]
    [InlineData("mobileapi\\Photos\\ZEDMSME000001\\Silver\\Evidences\\E1.pdf", "/api/msme/site-assessment/photos/mobileapi/Photos/ZEDMSME000001/Silver/Evidences/E1.pdf")]
    [InlineData("https://loginzed.msme.gov.in/mobileapi/SaCertifiedPhotos/zedmsme000001/Silver/x.PNG", "/api/msme/site-assessment/photos/mobileapi/SaCertifiedPhotos/zedmsme000001/Silver/x.PNG")]
    public void Own_legacy_addresses_map_to_the_photo_api(string legacy, string expected) =>
        Assert.Equal(expected, SitePhotoPaths.ToApiUrl(legacy, Me));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:image/png;base64,AAAA")]
    [InlineData("//evil.example/mobileapi/SaPhotos/ZEDMSME000001/a.jpg")]
    [InlineData("https://loginzed.msme.gov.in/mobileapi/SaPhotos/ZEDMSME000002/Silver/1.jpg")]
    [InlineData("https://loginzed.msme.gov.in/mobileapi/SaPhotos/ZEDMSME000001/../ZEDMSME000002/1.jpg")]
    [InlineData("https://loginzed.msme.gov.in/mobileapi/SaPhotos/ZEDMSME000001.jpg")]
    [InlineData("https://loginzed.msme.gov.in/mobileapi/SaPhotos/ZEDMSME000001/Silver/page.html")]
    [InlineData("https://loginzed.msme.gov.in/Certificates/ZEDMSME000001/Pledge.pdf")]
    [InlineData("https://loginzed.msme.gov.in/mobileapi/Attendance/ZEDMSME000001/Silver/1.jpg")]
    public void Other_values_are_not_linked(string? legacy) => Assert.Null(SitePhotoPaths.ToApiUrl(legacy, Me));

    [Fact]
    public void Moved_counterparts_are_candidates()
    {
        Assert.Equal(["mobileapi/SaPhotos/Z1/S/1.jpg", "mobileapi/SaCertifiedPhotos/Z1/S/1.jpg"], SitePhotoPaths.StorageCandidates("mobileapi/SaPhotos/Z1/S/1.jpg"));
        Assert.Equal(["mobileapi/CertifiedPhotos/Z1/S/1.jpg", "mobileapi/Photos/Z1/S/1.jpg"], SitePhotoPaths.StorageCandidates("mobileapi/CertifiedPhotos/Z1/S/1.jpg"));
        Assert.Equal(["consultancymobileapi/SaPhotos/Z1/S/1.jpg"], SitePhotoPaths.StorageCandidates("consultancymobileapi/SaPhotos/Z1/S/1.jpg"));
    }
}
