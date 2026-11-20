using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Mobile;
using Zed.Main.MobileApi.Controllers;
using Zed.Portal.Features.Incentives;

namespace Zed.Main.MobileApi.Tests;

/// <summary>
/// 2026-11-20 (incentive schemes, phase 2): the onsite assessor's scheme visits in the assessor app (SchemeVisits/*): the list and
/// detail of the applications allotted to the assessor, the start of the visit, item photos, checks and the representative,
/// Recommend (verified claim, eligible amount) and Reject, and the refusals (another assessor's application, writes after submit).
/// </summary>
public sealed class SchemeVisitsTests : IDisposable
{
    private const string Me = "ZEDAS0101";
    private const string Other = "ZEDAS0102";
    private const string Zed = "ZEDMSME000321";
    private const int Id = 501;
    // A JPEG's first bytes (FF D8 FF E0 ...): enough for the storage's content check.
    private const string Jpeg = "/9j/4AAQSkZJRgABAQ==";

    private readonly MobileTestHost _host = new();
    private string _status = SchemeApplications.OnsiteWithAssessor;
    private string _assessor = Me;
    private string? _checks;
    private string? _repName;
    private string? _repMobile;
    private readonly List<object> _photos = [];

    public SchemeVisitsTests()
    {
        _host.Settings["Mobile:AppTokenKey"] = AppTokenTests.Key;
        var q = _host.Sql.Queries;
        q[SchemeVisitsController.AssessorSql] = a => FakeSql.Arg(a, "UserId") is Me or Other ? [new { UserId = FakeSql.Arg(a, "UserId"), RoleId = 3, IsActive = true }] : [];
        q[SchemeApplications.ByIdWithOnsiteSql] = a => FakeSql.Arg(a, "Id") == Id.ToString() ? [Row()] : [];
        q[SchemeVisitsController.SchemesSql] = _ => [new { SchemeCode = "FA_ONSITE", SchemeJson = SchemeRules.Serialize(Definition()) }];
        q[SchemeVisitsController.UnitSql] = _ => [new { EnterpriseName = "Acme Forgings", PAddress = "Plot 7, MIDC", PCity = "Pune", PDistrictName = "Pune", PStateName = "Maharashtra", PPin = "411001" }];
        q[SchemeVisitsController.PhotosSql] = _ => _photos;
        q[SchemeVisitsController.ListSql] = a => FakeSql.Arg(a, "UserId") == Me
            ? [new { Id, ZedId = Zed, SchemeCode = "FA_ONSITE", SchemeLevel = "Silver", SchemeStatus = _status, ClaimAmount = 80000m, OnsiteAllotmentDate = new DateTime(2026, 11, 19, 10, 0, 0), EnterpriseName = "Acme Forgings", PCity = "Pune", PStateName = "Maharashtra" }]
            : [];
        foreach (var sql in new[] { SchemeVisitsController.StartSql, SchemeVisitsController.AddPhotoSql, SchemeVisitsController.SaveSql, SchemeVisitsController.RecommendSql, SchemeVisitsController.RejectSql, SchemeVisitsController.DeletePhotoSql })
            q[sql] = _ => [1];
    }

    public void Dispose() => _host.Dispose();

    private static SchemeDefinition Definition() => new()
    {
        Code = "FA_ONSITE",
        Name = "Financial Assistance (onsite)",
        Active = true,
        Grading = new SchemeGrading { Mode = SchemeRules.ByLevel, Rows = [new SchemeGrade("Silver", 75, 50000)] },
        Verification = new SchemeVerification { Flow = SchemeRules.DesktopOnsite, OnsitePhotosMin = 1, OnsitePhotosMax = 2 },
        Form = new SchemeForm
        {
            Sections =
            [
                new FormSection
                {
                    Key = "certs", Title = "Certification", Repeating = true, MinItems = 1, MaxItems = 5,
                    Fields =
                    [
                        new FormField { Key = "body", Label = "Certifying body", Type = "text", AssessorChecks = true, CheckStage = SchemeRules.StageOnsite },
                        new FormField { Key = "cost", Label = "Cost", Type = "amount", IsClaim = true, AssessorChecks = true, CheckStage = SchemeRules.StageBoth },
                        new FormField { Key = "invoice", Label = "Invoice", Type = "document", AssessorChecks = true },
                    ],
                },
                new FormSection { Key = "unit", Title = "Unit", Fields = [new FormField { Key = "note", Label = "Note", Type = "text", Required = false }] },
            ],
        },
    };

    private static string Answers() => new FormAnswers
    {
        Sections = new()
        {
            ["certs"] =
            [
                new FormItem { Saved = true, Values = new() { ["body"] = "BIS", ["cost"] = "60000", ["invoice"] = "[\"20261101101010123abcdef01.pdf\"]" } },
                new FormItem { Saved = true, Values = new() { ["body"] = "NABCB", ["cost"] = "20000" } },
                new FormItem { Saved = false, Values = new() { ["body"] = "draft" } },
            ],
            ["unit"] = [new FormItem { Values = new() { ["note"] = "Night shift" } }],
        },
    }.Serialize();

    private object Row() => new
    {
        Id, ZedId = Zed, SchemeCode = "FA_ONSITE", SchemeLevel = "Silver", SchemeStatus = _status, VerificationStatus = SchemeApplications.VerificationStatus(_status),
        FormAnswers = Answers(), FormChecks = _checks, ClaimAmount = 80000m, SharePercent = 75m, MaxAmount = 50000m, EligibleAmount = "50000.00",
        CorrectionRound = 1, OnsiteAgencyId = "ZEDAG0901", OnsiteAssessorId = _assessor, RepresentativeName = _repName, RepresentativeMobile = _repMobile,
        VisitStartedOn = _status == SchemeApplications.OnsiteVisit ? new DateTime(2026, 11, 20, 11, 0, 0) : (DateTime?)null,
    };

    private async Task<JsonElement> Call(string action, object body, string user = Me)
    {
        var token = await _host.Services.GetRequiredService<AppTokens>().IssueAsync(MobileApps.SiteAssessor, user, null);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/SchemeVisits/" + action)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        request.Headers.Add(AppTokens.Header, token);
        var r = await _host.CreateClient().SendAsync(request);
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement.Clone();
    }

    private object Last(string sql) => _host.Sql.Calls.Last(c => c.Name == sql).Args!;

    private static void AssertFail(JsonElement e, string message)
    {
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Contains(message, e.GetProperty("errorMessage").GetString());
    }

    private static object Photo(string id) => new { photoId = id, photo = Jpeg, timeStamp = "Nov 20, 2026 11:05 AM", latitude = "18.5204", longitude = "73.8567" };

    private void Visiting()
    {
        _status = SchemeApplications.OnsiteVisit;
        _photos.Add(new { PhotoId = "20261120110000000aaaaaaaa.jpg", Name = "onsite/selfie", TimeStamp = "t", Latitude = "18.5", Longitude = "73.8" });
    }

    // ------------------------------------------------------------------ reads

    [Fact]
    public async Task The_list_shows_the_applications_allotted_to_the_assessor()
    {
        var e = await Call("List", new { saId = Me });
        Assert.Equal("1", e.GetProperty("status").GetString());
        var v = Assert.Single(e.GetProperty("visits").EnumerateArray());
        Assert.Equal(Id, v.GetProperty("applicationId").GetInt32());
        Assert.Equal("Acme Forgings", v.GetProperty("unitName").GetString());
        Assert.Equal("Pune, Maharashtra", v.GetProperty("address").GetString());
        Assert.Equal("Financial Assistance (onsite)", v.GetProperty("schemeName").GetString());
        Assert.Equal("OnsiteWithAssessor", v.GetProperty("status").GetString());
        Assert.Equal(80000m, v.GetProperty("claimAmount").GetDecimal());
        Assert.Equal("2026-11-19T10:00:00", v.GetProperty("allottedOn").GetString());
    }

    [Fact]
    public async Task A_call_without_the_assessors_token_is_refused()
    {
        var r = await _host.CreateClient().PostAsync("/SchemeVisits/List", new StringContent(JsonSerializer.Serialize(new { saId = Me }), Encoding.UTF8, "application/json"));
        var e = JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
        AssertFail(e, AppTokens.ExpiredMessage);
    }

    [Fact]
    public async Task The_detail_has_the_answers_places_items_and_what_the_visit_saved()
    {
        _checks = FieldCheck.Serialize(new()
        {
            ["certs/0/cost"] = new FieldCheck("Yes", null, 1, "DA1", null),
            ["onsite:certs/0/body"] = new FieldCheck("No", "Different body on the certificate", 1, Me, null),
        });
        Visiting();
        _photos.Add(new { PhotoId = "20261120110500000bbbbbbbb.jpg", Name = "onsite/certs/0", TimeStamp = "t", Latitude = "18.5", Longitude = "73.8" });

        var v = (await Call("Detail", new { saId = Me, applicationId = Id })).GetProperty("visit");
        Assert.Equal("Acme Forgings", v.GetProperty("unitName").GetString());
        Assert.True(v.GetProperty("open").GetBoolean());
        Assert.Equal(1, v.GetProperty("photosMin").GetInt32());
        Assert.Equal(2, v.GetProperty("photosMax").GetInt32());
        Assert.Equal(75m, v.GetProperty("sharePercent").GetDecimal());

        // The unsaved "Add more" item is left out; paths keep the item's index.
        var certs = v.GetProperty("sections")[0];
        Assert.Equal(2, certs.GetProperty("items").GetArrayLength());
        var first = certs.GetProperty("items")[0].GetProperty("answers");
        Assert.Equal("certs/0/body", first[0].GetProperty("path").GetString());
        Assert.True(first[0].GetProperty("checkOnsite").GetBoolean());
        Assert.Equal("Yes", first[1].GetProperty("desktop").GetProperty("status").GetString());
        Assert.Equal("20261101101010123abcdef01.pdf", first[2].GetProperty("files")[0].GetProperty("name").GetString());
        Assert.False(first[2].GetProperty("checkOnsite").GetBoolean());

        // Body and cost of both items are checked onsite; both items and the plain section are photographed.
        Assert.Equal(["certs/0/body", "certs/0/cost", "certs/1/body", "certs/1/cost"], v.GetProperty("places").EnumerateArray().Select(p => p.GetProperty("path").GetString()));
        var items = v.GetProperty("items");
        Assert.Equal(3, items.GetArrayLength());
        Assert.Equal("Certification 1", items[0].GetProperty("title").GetString());
        Assert.Single(items[0].GetProperty("photos").EnumerateArray());
        Assert.Equal("onsite/selfie", v.GetProperty("selfie").GetProperty("slot").GetString());
        var check = v.GetProperty("checks").GetProperty("certs/0/body");
        Assert.Equal("No", check.GetProperty("status").GetString());
        Assert.False(v.GetProperty("checks").TryGetProperty("certs/0/cost", out _));
    }

    [Fact]
    public async Task Another_assessors_application_is_refused()
    {
        _assessor = Other;
        AssertFail(await Call("Detail", new { saId = Me, applicationId = Id }), SchemeVisitsController.NotAllotted);
        AssertFail(await Call("Start", new { saId = Me, applicationId = Id, selfie = Photo("s1"), site = Photo("s2") }), SchemeVisitsController.NotAllotted);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == SchemeVisitsController.StartSql);
    }

    [Fact]
    public async Task A_document_of_the_answers_opens_with_the_token_and_nothing_else_does()
    {
        const string Doc = "20261101101010123abcdef01.pdf";
        var folder = Path.Combine(_host.StorageRoot, "Photos", Zed, "Schemes");
        Directory.CreateDirectory(folder);
        await File.WriteAllTextAsync(Path.Combine(folder, Doc), "%PDF-1.4 test");
        await File.WriteAllTextAsync(Path.Combine(folder, "20261101101010123abcdef02.pdf"), "%PDF-1.4 other");
        var token = await _host.Services.GetRequiredService<AppTokens>().IssueAsync(MobileApps.SiteAssessor, Me, null);

        async Task<HttpResponseMessage> Get(string name, string? withToken)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, $"/SchemeVisits/Document?saId={Me}&applicationId={Id}&name={name}");
            if (withToken is not null) request.Headers.Add(AppTokens.Header, withToken);
            return await _host.CreateClient().SendAsync(request);
        }

        var ok = await Get(Doc, token);
        Assert.Equal(System.Net.HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal("application/pdf", ok.Content.Headers.ContentType?.MediaType);
        Assert.StartsWith("%PDF", await ok.Content.ReadAsStringAsync());
        // A file of the folder that the answers do not list, and a call without the token.
        Assert.Equal(System.Net.HttpStatusCode.NotFound, (await Get("20261101101010123abcdef02.pdf", token)).StatusCode);
        // Without the token: the legacy refusal (signed out), not the file.
        Assert.Contains(AppTokens.ExpiredMessage, await (await Get(Doc, null)).Content.ReadAsStringAsync());
        _assessor = Other;
        Assert.Equal(System.Net.HttpStatusCode.NotFound, (await Get(Doc, token)).StatusCode);
    }

    // ------------------------------------------------------------------ start

    [Fact]
    public async Task The_start_stores_the_selfie_and_site_photo_and_opens_the_visit()
    {
        var e = await Call("Start", new { saId = Me, applicationId = Id, selfie = Photo("SELF-1"), site = Photo("SITE-1") });
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal("OnsiteVisit", e.GetProperty("visitStatus").GetString());

        var args = Last(SchemeVisitsController.StartSql);
        Assert.Equal("18.5204", FakeSql.Arg(args, "Latitude"));
        Assert.Equal(Me, FakeSql.Arg(args, "UserId"));
        var selfie = FakeSql.Arg(args, "SelfieId")!;
        Assert.True(SchemeVisitRules.IsStoredName(selfie));
        Assert.True(SchemeVisitRules.SameUpload(selfie, Id, "SELF-1"));
        Assert.True(File.Exists(Path.Combine(_host.StorageRoot, "Photos", Zed, "Schemes", selfie)));
        Assert.Contains(_host.Sql.Calls, c => c.Name == SchemeVisitsController.HistorySql && FakeSql.Arg(c.Args, "Descrip")!.Contains("visit started"));
    }

    [Fact]
    public async Task The_start_needs_gps_and_is_refused_once_the_result_is_submitted()
    {
        AssertFail(await Call("Start", new { saId = Me, applicationId = Id, selfie = new { photoId = "S", photo = Jpeg }, site = Photo("T") }), SchemeVisitsController.GpsRequired);
        _status = SchemeApplications.Qc;
        AssertFail(await Call("Start", new { saId = Me, applicationId = Id, selfie = Photo("S"), site = Photo("T") }), SchemeVisitsController.NotOpen);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == SchemeVisitsController.StartSql);
    }

    [Fact]
    public async Task A_retried_start_answers_success_without_a_second_start()
    {
        _status = SchemeApplications.OnsiteVisit;
        _photos.Add(new { PhotoId = SchemeVisitRules.PhotoFileName(Id, "SELF-1", DateTime.Now), Name = "onsite/selfie" });
        var e = await Call("Start", new { saId = Me, applicationId = Id, selfie = Photo("SELF-1"), site = Photo("SITE-1") });
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == SchemeVisitsController.StartSql);
    }

    // ------------------------------------------------------------------ photos and saves

    [Fact]
    public async Task Item_photos_need_the_started_visit_and_stop_at_the_maximum()
    {
        AssertFail(await Call("SavePhoto", new { saId = Me, applicationId = Id, section = "certs", index = 0, photo = Photo("P1") }), SchemeVisitsController.NotStarted);
        Visiting();
        var e = await Call("SavePhoto", new { saId = Me, applicationId = Id, section = "certs", index = 0, photo = Photo("P1") });
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal("onsite/certs/0", FakeSql.Arg(Last(SchemeVisitsController.AddPhotoSql), "Name"));
        Assert.Equal("2", FakeSql.Arg(Last(SchemeVisitsController.AddPhotoSql), "Max"));

        // Not an item of the application (the unsaved third item).
        AssertFail(await Call("SavePhoto", new { saId = Me, applicationId = Id, section = "certs", index = 2, photo = Photo("P2") }), "not found");
        _photos.Add(new { PhotoId = "20261120110500000bbbbbbbb.jpg", Name = "onsite/certs/0" });
        _photos.Add(new { PhotoId = "20261120110600000cccccccc.jpg", Name = "onsite/certs/0" });
        AssertFail(await Call("SavePhoto", new { saId = Me, applicationId = Id, section = "certs", index = 0, photo = Photo("P3") }), "at most 2");
    }

    [Fact]
    public async Task Save_merges_onsite_checks_and_checks_the_representatives_mobile()
    {
        Visiting();
        _checks = FieldCheck.Serialize(new() { ["certs/0/cost"] = new FieldCheck("Yes", null, 1, "DA1", null) });
        AssertFail(await Call("Save", new { saId = Me, applicationId = Id, representativeMobile = "5123456789" }), "10-digit");
        AssertFail(await Call("Save", new { saId = Me, applicationId = Id, checks = new[] { new { path = "certs/0/body", status = "No", remarks = "" } } }), "please write what is not valid");
        AssertFail(await Call("Save", new { saId = Me, applicationId = Id, checks = new[] { new { path = "certs/0/invoice", status = "Yes", remarks = "" } } }), "not found");

        var e = await Call("Save", new
        {
            saId = Me, applicationId = Id, representativeName = "R. Kulkarni", representativeMobile = "9876543210", remarks = "Unit running",
            checks = new[] { new { path = "certs/0/body", status = "Yes", remarks = "" }, new { path = "certs/1/cost", status = "No", remarks = "Invoice shows 18,000" } },
        });
        Assert.Equal("1", e.GetProperty("status").GetString());
        var args = Last(SchemeVisitsController.SaveSql);
        Assert.Equal("9876543210", FakeSql.Arg(args, "RepresentativeMobile"));
        Assert.Equal("Unit running", FakeSql.Arg(args, "OnsiteRemarks"));
        var checks = FieldCheck.Parse(FakeSql.Arg(args, "FormChecks"));
        Assert.Equal("Yes", checks["certs/0/cost"].Status); // the desktop check stays
        Assert.Equal("Yes", checks["onsite:certs/0/body"].Status);
        Assert.Equal("No", checks["onsite:certs/1/cost"].Status);
        Assert.Equal(Me, checks["onsite:certs/1/cost"].By);
    }

    // ------------------------------------------------------------------ submit

    private void ReadyToRecommend()
    {
        Visiting();
        _repName = "R. Kulkarni";
        _repMobile = "9876543210";
        _checks = FieldCheck.Serialize(new()
        {
            ["onsite:certs/0/body"] = new FieldCheck("Yes", null, 1, Me, null),
            ["onsite:certs/0/cost"] = new FieldCheck("Yes", null, 1, Me, null),
            ["onsite:certs/1/body"] = new FieldCheck("Yes", null, 1, Me, null),
            ["onsite:certs/1/cost"] = new FieldCheck("Yes", null, 1, Me, null),
        });
        foreach (var slot in new[] { "onsite/certs/0", "onsite/certs/1", "onsite/unit/0" }) _photos.Add(new { PhotoId = "x", Name = slot });
    }

    [Fact]
    public async Task Recommend_needs_everything_and_computes_the_eligible_amount_on_the_verified_claim()
    {
        Visiting();
        AssertFail(await Call("Submit", new { saId = Me, applicationId = Id, decision = "recommend", verifiedClaim = 70000 }), "check every answer");

        ReadyToRecommend();
        AssertFail(await Call("Submit", new { saId = Me, applicationId = Id, decision = "recommend", verifiedClaim = 90000 }), "cannot be more than the claimed amount");
        AssertFail(await Call("Submit", new { saId = Me, applicationId = Id, decision = "recommend" }), "verified claim");

        var e = await Call("Submit", new { saId = Me, applicationId = Id, decision = "recommend", verifiedClaim = 60001.75m, remarks = "All seen" });
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal("Qc", e.GetProperty("visitStatus").GetString());
        var args = Last(SchemeVisitsController.RecommendSql);
        Assert.Equal("60001.75", FakeSql.Arg(args, "Verified"));
        // 75 % of 60,001 (whole rupees) = 45,000.75, under the maximum of 50,000.
        Assert.Equal("45000.75", FakeSql.Arg(args, "Eligible"));
        Assert.Equal("All seen", FakeSql.Arg(args, "OnsiteRemarks"));
        Assert.Contains(_host.Sql.Calls, c => c.Name == SchemeVisitsController.HistorySql && FakeSql.Arg(c.Args, "Descrip")!.Contains("recommended at the onsite visit"));
    }

    [Fact]
    public async Task Recommend_is_refused_with_a_not_valid_answer_or_missing_photos()
    {
        ReadyToRecommend();
        _checks = _checks!.Replace("{\"status\":\"Yes\",\"round\":1,\"by\":\"ZEDAS0101\"}", "{\"status\":\"No\",\"remarks\":\"x\",\"round\":1,\"by\":\"ZEDAS0101\"}");
        AssertFail(await Call("Submit", new { saId = Me, applicationId = Id, decision = "recommend", verifiedClaim = 1000 }), "Not valid");

        ReadyToRecommend();
        _photos.RemoveAll(p => p.ToString()!.Contains("onsite/unit/0"));
        AssertFail(await Call("Submit", new { saId = Me, applicationId = Id, decision = "recommend", verifiedClaim = 1000 }), "\"Unit\": take at least 1 photo");
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == SchemeVisitsController.RecommendSql);
    }

    [Fact]
    public async Task Reject_needs_a_reason_and_remarks_and_ends_the_application()
    {
        Visiting();
        AssertFail(await Call("Submit", new { saId = Me, applicationId = Id, decision = "reject", remarks = "Closed" }), "reason for rejection");
        AssertFail(await Call("Submit", new { saId = Me, applicationId = Id, decision = "reject", reason = "Unit not functional" }), "remarks");

        var e = await Call("Submit", new { saId = Me, applicationId = Id, decision = "reject", reason = "Unit not functional", remarks = "Plant closed for six months" });
        Assert.Equal("1", e.GetProperty("status").GetString());
        var args = Last(SchemeVisitsController.RejectSql);
        Assert.Equal("Unit not functional", FakeSql.Arg(args, "Reason"));
        Assert.Equal("5", FakeSql.Arg(args, "VerificationStatus"));
        Assert.Contains(_host.Sql.Calls, c => c.Name == SchemeVisitsController.HistorySql && FakeSql.Arg(c.Args, "Descrip")!.Contains("rejected at the onsite visit"));
    }

    [Fact]
    public async Task Writes_after_the_submit_are_refused()
    {
        _status = SchemeApplications.Qc;
        AssertFail(await Call("Save", new { saId = Me, applicationId = Id, remarks = "late" }), SchemeVisitsController.NotOpen);
        AssertFail(await Call("SavePhoto", new { saId = Me, applicationId = Id, section = "certs", index = 0, photo = Photo("P9") }), SchemeVisitsController.NotOpen);
        AssertFail(await Call("Submit", new { saId = Me, applicationId = Id, decision = "reject", reason = "r", remarks = "x" }), SchemeVisitsController.NotOpen);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name is SchemeVisitsController.SaveSql or SchemeVisitsController.RejectSql);
    }

    // ------------------------------------------------------------------ rules

    [Theory]
    [InlineData("9876543210", true)]
    [InlineData("6000000000", true)]
    [InlineData("5876543210", false)]
    [InlineData("987654321", false)]
    [InlineData("98765432101", false)]
    [InlineData("98765 4321", false)]
    public void The_representatives_mobile_is_a_10_digit_indian_number(string mobile, bool ok) => Assert.Equal(ok, SchemeVisitRules.IsMobile(mobile));

    [Fact]
    public void The_eligible_amount_is_the_share_of_the_whole_rupees_capped_at_the_maximum()
    {
        Assert.Equal(45000.75m, SchemeVisitRules.Eligible(60001.99m, 75, 50000));
        Assert.Equal(50000m, SchemeVisitRules.Eligible(100000m, 75, 50000));
        Assert.Equal(0m, SchemeVisitRules.Eligible(100000m, null, null));
        Assert.Null(SchemeVisitRules.VerifiedClaimProblem(80000m, 80000m));
        Assert.NotNull(SchemeVisitRules.VerifiedClaimProblem(10.555m, 80000m));
        Assert.NotNull(SchemeVisitRules.VerifiedClaimProblem(-1m, 80000m));
    }
}
