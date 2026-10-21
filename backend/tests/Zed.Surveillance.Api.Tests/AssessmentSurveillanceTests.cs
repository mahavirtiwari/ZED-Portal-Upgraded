using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Http;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Surveillance.Api.Tests;

/// <summary>Bronze surveillance: allotment, desktop assessment, results and monitoring on the Surveillance host.</summary>
public sealed class AssessmentSurveillanceTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private readonly AssessmentStaff _s = new();
    private object _record = Record(3);

    private static object Record(int status) => new
    {
        ZedId = Zed, Certification = "Bronze", CertificationStatus = status, NcCount = 0, NcStatus = 0, Nc1Status = 0, Nc2Status = 0, Nc3Status = 0,
        Nc4Status = 0, Nc5Status = 0, DesktopAssessorId = "ASSESSOR1", DesktopAccepted = true, DesktopReasonForRejection = (string?)null,
        CertificationBodyUserId = "AGENCY1", SiteAssessorId = (string?)null, CoAssessorId = (string?)null,
    };

    public AssessmentSurveillanceTests()
    {
        var sql = _s.Sql;
        sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = args => (FakeSql.Arg(args, "RoleId"), FakeSql.Arg(args, "AllotmentType")) switch
        {
            ("7", _) => FakeSql.Sets([new
            {
                ZedId = Zed, Certification = "Bronze", PUnitName = "Unit 1", CertificationStatus = 1, SurveillanceNo = "2nd Surveillance",
                AutoAllocationDate = "May 1, 2026", MobileNo = "9999999999",
            }], [new { UserId = "AGENCY1", UserName = "Agency One" }]),
            // The surveillance procedure returns ONE assessor list: the agency's assessors allowed for Bronze surveillance.
            ("2", "DA") => FakeSql.Sets(
                [new { ZedId = Zed, Certification = "Bronze", CertificationStatus = 1, DesktopAssessorId = (string?)null, LeadInCertification = "LEAD1", CoInCertification = "CO1", DaAssessorEmail = "d@x.test" }],
                [new { UserId = "ASSESSOR1", UserName = "Bronze surveillance assessor" }]),
            _ => FakeSql.Sets([]),
        };
        sql.Procs["SP_ASSESSMENT_AGENCIES_TO_ALLOT"] = _ => FakeSql.Sets([
            new { UserId = "AGENCY1", UserName = "Agency One", DesktopVerification = false, SiteVerification = true, FinancialVerification = false, AllowBronzeSurveillance = true },
            new { UserId = "AGENCY2", UserName = "Agency Two", DesktopVerification = true, SiteVerification = false, FinancialVerification = false, AllowBronzeSurveillance = false },
        ]);
        sql.Procs["SP_EMAIL_GET_DETAILS"] = _ => FakeSql.Sets([new
        {
            EmailId = "unit@x.test", EnterpriseName = "Acme", Address = "Plot 4", AgencyEmailId = "agency@x.test", AgencyName = "Agency One",
            AgencyUserId = "AGENCY1", AssessorEmailId = "assessor@x.test", AssessorUserId = "ASSESSOR1", PUnitName = "Unit 1",
            Password = "Secret#1", MsmePassword = "Secret#2", NcCount = 1, NcFinalClosureDt = "May 01, 2026", MeetingLink = (string?)null,
        }]);
        sql.Queries[AssessmentRecords.CertificationSql] = args => FakeSql.Arg(args, "ZedId") == Zed ? [_record] : [];
    }

    public void Dispose() => _s.Dispose();

    [Fact]
    public async Task Allot_list_adds_surveillance_columns()
    {
        var client = await _s.SignInAsync("MADMIN", 7);
        var row = (await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/allot")).GetProperty("rows")[0];
        Assert.Equal("2nd Surveillance", row.GetProperty("SurveillanceNo").GetString());
        Assert.Equal("May 1, 2026", row.GetProperty("AutoAllocationDate").GetString());
        Assert.False(row.TryGetProperty("MobileNo", out _));
    }

    [Fact]
    public async Task Bronze_is_offered_only_to_agencies_allowed_for_bronze_surveillance()
    {
        var client = await _s.SignInAsync("MADMIN", 7);
        var agencies = await client.GetFromJsonAsync<JsonElement>($"/api/staff/assessment/allot/agencies?zedId={Zed}&certification=Bronze");
        Assert.Equal(["AGENCY1"], agencies.EnumerateArray().Select(a => a.GetProperty("userId").GetString()));

        var refused = await client.PostAsJsonAsync("/api/staff/assessment/allot", new { zedId = Zed, certification = "Bronze", agencyUserId = "AGENCY2" });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);

        var ok = await client.PostAsJsonAsync("/api/staff/assessment/allot", new { zedId = Zed, certification = "Bronze", agencyUserId = "AGENCY1" });
        ok.EnsureSuccessStatusCode();
        var mail = Assert.Single(_s.Email.Sent);
        Assert.StartsWith("Allocation of MSME for ZED Surveillance Assessment under", mail.Subject);
        Assert.DoesNotContain("Secret#", mail.HtmlBody);
    }

    [Fact]
    public async Task Agency_allots_from_the_single_bronze_surveillance_assessor_list()
    {
        var client = await _s.SignInAsync("AGENCY1", 2, "DesktopVerification");
        var json = await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/da-allotment");
        Assert.Equal("ASSESSOR1", json.GetProperty("bronzeAssessors")[0].GetProperty("userId").GetString());
        var row = json.GetProperty("rows")[0];
        Assert.Equal("LEAD1", row.GetProperty("LeadInCertification").GetString());
        Assert.False(row.TryGetProperty("DaAssessorEmail", out _));

        var res = await client.PostAsJsonAsync("/api/staff/assessment/da-allotment/allot", new { zedId = Zed, certification = "Bronze", desktopAssessorId = "ASSESSOR1" });
        res.EnsureSuccessStatusCode();
        Assert.Single(_s.Sql.Calls, c => c.Name == "SP_ASSESSMENT_ACCEPT_UNIT_FOR_DA");
        Assert.StartsWith("Allocation of Surveillance Assessment under", Assert.Single(_s.Email.Sent).Subject);
    }

    [Fact]
    public async Task Da_details_reads_the_surveillance_sets_and_files_without_FromSurveillance()
    {
        _s.Sql.Procs["SP_ASSESSMENT_DA_DETAILS"] = _ => FakeSql.Sets(
            [new { ZedId = Zed, Certification = "Bronze", PUnitName = "Unit 1", CertificationStatus = 3, NcCount = 0, PhotosPath = (string?)null }],
            [], [], [], [], [], [],
            [new { Id = 31, SectionCode = "1", RequirementCode = "2", EvidenceId = 5551, EvidenceCode = "3", ValidationRequired = true, SyncedDate = "May 01, 2024" }],
            [new { Id = 61, PhotoId = "777", PhotoType = "SiteExteriorPhotos" }],
            [new { Latitude = "28.6", Longitude = "77.2" }],
            [new { RefEvidenceId = 31, FileName = "Screenshot_1.pdf" }],
            [new { ZedLatitude = "28.5", ZedLongitude = "77.1" }],
            [new { Code = "E1", Question = "Q", Answer = "Yes", CheckListType = "ESG" }],
            [new { FinancialAssistanceAvailed = "Yes", AnyDocuments = "No", DocumentTypes = (string?)null }],
            [new { SuitableForSilverUpgrade = "Yes", HandholdingSupport = "No" }]);
        var client = await _s.SignInAsync("MADMIN", 7);
        var json = await client.GetFromJsonAsync<JsonElement>($"/api/staff/assessment/da/{Zed}/Bronze");

        var args = _s.Sql.Calls.First(c => c.Name == "SP_ASSESSMENT_DA_DETAILS").Args!;
        Assert.Null(args.GetType().GetProperty("FromSurveillance"));
        Assert.Equal("E1", json.GetProperty("esgCheckList")[0].GetProperty("Code").GetString());
        var extra = json.GetProperty("surveillance");
        Assert.Equal("28.5", extra.GetProperty("zedLocation").GetProperty("ZedLatitude").GetString());
        Assert.Equal("Yes", extra.GetProperty("additionalSupport").GetProperty("SuitableForSilverUpgrade").GetString());
        Assert.Contains("/files/surveillancemobileapi/Photos/ZEDMSME000001/Bronze/Evidences/5551.pdf", json.GetProperty("evidences")[0].GetProperty("FileUrl").GetString());
        Assert.Contains("/files/Surveillance/Uploads/DA/ZEDMSME000001/Bronze/1.2.3/Screenshot_1.pdf",
            json.GetProperty("evidences")[0].GetProperty("Screenshots")[0].GetString());
        Assert.Contains("surveillancemobileapi/Photos", json.GetProperty("photos")[0].GetProperty("Url").GetString());
    }

    [Fact]
    public async Task Surveillance_files_are_served_from_their_own_folders_only()
    {
        var file = Path.Combine(_s.Host.StorageRoot, "surveillancemobileapi", "Photos", Zed, "Bronze", "Evidences", "5551.pdf");
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        await File.WriteAllTextAsync(file, "%PDF-1.4");
        var client = await _s.SignInAsync("MADMIN", 7);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/staff/assessment/da/{Zed}/Bronze/files/surveillancemobileapi/Photos/{Zed}/Bronze/Evidences/5551.pdf")).StatusCode);
        // Main's app folder is not a store of this system.
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/staff/assessment/da/{Zed}/Bronze/files/mobileapi/Photos/{Zed}/Bronze/Evidences/5551.pdf")).StatusCode);
    }

    [Fact]
    public void Archived_second_surveillance_records_find_the_msme_folder()
    {
        var candidates = DaFiles.StorageCandidates($"surveillancemobileapi/Photos/{Zed}_S_45/Bronze/Selfie/1.jpg", $"{Zed}_S_45", PortalSystem.Surveillance).ToList();
        Assert.Contains($"surveillancemobileapi/CertifiedPhotos/{Zed}/Bronze/Selfie/1.jpg", candidates);
        Assert.True(DaFiles.BelongsTo($"Surveillance/Uploads/DA/{Zed}/Bronze/1.2.3/a.pdf", $"{Zed}_S_45", "Bronze", PortalSystem.Surveillance));
        Assert.False(DaFiles.BelongsTo($"Uploads/DA/{Zed}/Bronze/1.2.3/a.pdf", Zed, "Bronze", PortalSystem.Surveillance));
    }

    [Fact]
    public async Task Completed_list_uses_the_monitoring_list_with_paging_and_search_here()
    {
        _s.Sql.Procs["SP_MONITORING_GET_LIST"] = _ => FakeSql.Sets(Enumerable.Range(1, 25).Select(i => (object)new
        {
            RowNumber = i, ZedId = $"ZEDMSME{i:000000}", Certification = "Bronze", SurveillanceNo = "1st Surveillance", UamNumber = $"UDYAM-{i}", PUnitName = "Unit " + i,
        }).ToList());
        var client = await _s.SignInAsync("MADMIN", 7);
        var page2 = await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/completed?pageNo=2&pageSize=10");
        Assert.Equal(25, page2.GetProperty("totalCount").GetInt32());
        Assert.Equal(10, page2.GetProperty("rows").GetArrayLength());
        Assert.Equal("ZEDMSME000011", page2.GetProperty("rows")[0].GetProperty("ZedId").GetString());
        Assert.Equal("1st Surveillance", page2.GetProperty("rows")[0].GetProperty("SurveillanceNo").GetString());

        var found = await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/rejected?searchBy=Udyam%20Number&search=UDYAM-22");
        Assert.Equal(1, found.GetProperty("totalCount").GetInt32());

        var args = _s.Sql.Calls.Last(c => c.Name == "SP_MONITORING_GET_LIST").Args!;
        Assert.Equal("99", FakeSql.Arg(args, "Status"));
        Assert.Null(args.GetType().GetProperty("PageSize"));
        Assert.DoesNotContain(_s.Sql.Calls, c => c.Name == "SP_MONITORING_GET_LIST_PAGINATION");
    }

    [Fact]
    public async Task Monitoring_hides_re_allot_and_returns_surveillance_columns()
    {
        _s.Sql.Procs["SP_MONITORING_GET_LIST"] = args => FakeSql.Sets(
            [new { ZedId = Zed, Certification = "Silver", CertificationStatus = 8, SurveillanceNo = "1st Surveillance", SameUdyamAddress = 2 }],
            [new { NotStarted = 1, InProgress = 0, Qc = 0, Nc = 0, Rj = 0 }]);
        var client = await _s.SignInAsync("MADMIN", 7);
        var row = (await client.GetFromJsonAsync<JsonElement>("/api/staff/monitoring?certification=Silver&status=2")).GetProperty("units")[0];
        Assert.Equal("1st Surveillance", row.GetProperty("SurveillanceNo").GetString());
        Assert.False(row.TryGetProperty("SameUdyamAddress", out _));

        var res = await client.PostAsJsonAsync("/api/staff/monitoring/send-back-to-agency", new { zedId = Zed, certification = "Silver" });
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        Assert.DoesNotContain(_s.Sql.Calls, c => c.Name == "SP_MONITORING_SEND_BACK_TO_AGENCY_FOR_REALLOCATION");
    }

    [Fact]
    public async Task Nc_raised_mail_has_the_surveillance_subject_and_no_msme_sign_in()
    {
        _record = Record(3);
        _s.Sql.Procs["SP_ASSESSMENT_DA_CONFIRM_FINAL_SUBMIT"] = _ => FakeSql.Sets([new { AllowFinalSubmit = 1 }], [new { RaisedForNc = 1 }]);
        var client = await _s.SignInAsync("ASSESSOR1", 3, "DesktopVerification");
        var res = await client.PostAsJsonAsync($"/api/staff/assessment/da/{Zed}/Bronze/final-submit", new { remarks = "NCs" });
        res.EnsureSuccessStatusCode();
        var mail = Assert.Single(_s.Email.Sent);
        Assert.StartsWith("First Non-conformance(s) raised for Surveillance Assessment under", mail.Subject);
        Assert.DoesNotContain("msme/login", mail.HtmlBody);
        Assert.DoesNotContain("Secret#", mail.HtmlBody);
    }
}
