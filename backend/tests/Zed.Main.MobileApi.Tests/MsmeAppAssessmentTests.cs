using System.Net;
using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Mobile;
using Zed.Main.MobileApi.Controllers;

namespace Zed.Main.MobileApi.Tests;

public sealed class MsmeAppAssessmentTests : MsmeAppTestBase
{
    [Fact]
    public async Task GetParametersByType_nests_sections_requirements_options_and_evidences()
    {
        Host.Sql.Procs["SP_APP_MSME_GET_QUESTIONS_BY_TYPE"] = _ => FakeSql.Sets(
            [new { Id = 10, SectionCode = "1", SectionName = "Leadership" }, new { Id = 11, SectionCode = "2", SectionName = "Swachh" }],
            [new { Id = 100, SectionCode = "1", RequirementCode = "A" }, new { Id = 101, SectionCode = "2 ", RequirementCode = "a" }],
            [new { Id = 1000, SectionCode = "1", RequirementCode = "A", OptionCode = "L1", OptionName = "Level 1" }],
            [new { Id = 5000, SectionCode = "1", RequirementCode = "A", OptionCode = "L1", SubOptionCode = "x", SubOptionName = "Sub" }],
            [new { Id = 9000, SectionCode = "1", RequirementCode = "A", EvidenceCode = "E1", EvidenceName = "Photo", EvidenceHelpText = "help", ValidationRequired = true }]);
        var e = await Post("/Msme/GetParametersByType", Json($$"""{"userName":"{{ZedId}}","certificationType":"Bronze","version":"1.0.0"}"""));
        Assert.Equal("1", e.GetProperty("status").GetString());
        var p = e.GetProperty("parameters");
        Assert.Equal(2, p.GetArrayLength());
        Assert.Equal("Leadership", p[0].GetProperty("label").GetString());
        var req = p[0].GetProperty("requirements")[0];
        Assert.Equal(100, req.GetProperty("id").GetInt32());
        Assert.Equal(JsonValueKind.Null, req.GetProperty("assessorRemarks").ValueKind);
        Assert.Equal("Sub", req.GetProperty("options")[0].GetProperty("subOptions")[0].GetProperty("label").GetString());
        var ev = req.GetProperty("evidences")[0];
        Assert.Equal("help", ev.GetProperty("iButton").GetString());
        Assert.True(ev.GetProperty("validationRequired").GetBoolean());
        // Codes match like the old DataTable filters: case-insensitive, trailing spaces ignored.
        Assert.Equal(101, p[1].GetProperty("requirements")[0].GetProperty("id").GetInt32());
    }

    private static string BasicInfo(string user = ZedId, string cert = "Bronze", string sitePhotoId = "site1") => $$$"""
        {"userName":"{{{user}}}","certificationType":"{{{cert}}}","deviceInfo":{"deviceId":"dev-1"},
         "basicInformation":{"auditsConducted":"Yes","domesticCustomers":"A, B","rawMaterialImported":"No","energySources":["Solar","Grid"],
           "monthlyManufacturingCapacityUnits":"10",
           "productDetailsList":[{"productName":"Bolt","exported":"No","productPhoto":{"photoId":"pp1","isPdf":false,"timeStamp":"t"}}],
           "rawMaterialsList":[{"rawMaterialName":"Steel","rawMaterialPercentage":"60","countryName":"India"}],
           "siteExteriorPhotos":[{"photoId":"{{{sitePhotoId}}}","photo":"{{{PngBase64}}}","latitude":"1","longitude":"2"}],
           "assessorSelfie":{"photoId":"selfie1","photo":"{{{PngBase64}}}" } } }
        """;

    [Fact]
    public async Task SubmitBasicInformation_saves_the_photos_and_calls_the_procedure_with_its_tables()
    {
        Stage("Bronze", 1);
        AssertOk(await Post("/Msme/SubmitBasicInformation", Json(BasicInfo())));

        Assert.True(File.Exists(StoragePath("Photos", ZedId, "Bronze", "SiteExteriorPhotos", "site1.jpg")));
        Assert.True(File.Exists(StoragePath("Photos", ZedId, "Bronze", "Selfie", "selfie1.jpg")));
        var args = Args("SP_APP_MSME_INSERT_BASIC_INFO");
        Assert.Equal(ZedId, FakeSql.Arg(args, "ZedId"));
        Assert.Equal("Solar,Grid", FakeSql.Arg(args, "EnergySources"));
        Assert.Equal("10", FakeSql.Arg(args, "ManufacturingCapacityUnits"));
        var products = Tvp(args, "ProductList")!;
        Assert.Equal(new[] { "Bolt", "No", "pp1.jpg", ".jpg" }, products.Rows[0].ItemArray.Select(v => v?.ToString() ?? "").ToArray());
        Assert.Equal("SiteExteriorPhotos", Tvp(args, "SiteExteriorPhotos")!.Rows[0]["Name"]);
        Assert.Equal("jpg", Tvp(args, "Selfie")!.Rows[0]["PhotoType"]);
        Assert.Equal("Steel", Tvp(args, "RawMaterialList")!.Rows[0]["Name"]);
        Assert.Null(Tvp(args, "ProductDescriptionPhotos"));
    }

    [Fact]
    public async Task SubmitBasicInformation_is_refused_after_final_submit_and_for_unknown_levels()
    {
        Stage("Bronze", 2);
        AssertFail(await Post("/Msme/SubmitBasicInformation", Json(BasicInfo())), "Invalid Details.");
        Stage("Bronze", 1);
        AssertFail(await Post("/Msme/SubmitBasicInformation", Json(BasicInfo(cert: "Platinum"))), "Invalid Details.");
        Assert.Empty(CallsTo("SP_APP_MSME_INSERT_BASIC_INFO"));
        Assert.False(Directory.Exists(StoragePath("Photos")));
    }

    [Fact]
    public async Task SubmitBasicInformation_keeps_the_old_no_data_message() =>
        AssertFail(await Post("/Msme/SubmitBasicInformation", Json("""{"userName":"ZEDMSME000001","certificationType":"Bronze"}""")), "No data found.");

    [Fact]
    public async Task SubmitBasicInformation_refuses_path_traversal_in_photo_ids_and_user_names()
    {
        Stage("Bronze", 1);
        AssertFail(await Post("/Msme/SubmitBasicInformation", Json(BasicInfo(sitePhotoId: "../../../evil-basic"))), "Invalid Data.");
        AssertFail(await Post("/Msme/SubmitBasicInformation", Json(BasicInfo(user: "..\\\\..\\\\evil-user"))), "Invalid Data.");
        AssertNothingOutside("evil-basic.jpg");
        AssertNothingOutside("evil-user");
        Assert.Empty(CallsTo("SP_APP_MSME_INSERT_BASIC_INFO"));
    }

    [Fact]
    public async Task SubmitEsgChecklist_passes_both_lists_and_returns_the_procedures_answer()
    {
        Host.Sql.Procs["SP_APP_MSME_INSERT_ESG_CHECKLIST"] = _ => FakeSql.Sets([new { Status = 1, ErrorMessage = "Data submitted Successfully." }]);
        var e = await Post("/Msme/SubmitEsgChecklist", Json($$"""
            {"userName":"{{ZedId}}","certificationType":"Silver",
             "esgChecklist":[{"code":"1","question":"Q1","answer":"Yes"}],"socialOhsChecklist":[{"code":2,"question":"Q2","answer":"No","ifNoAnswer":"r"}]}
            """));
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal("Data submitted Successfully.", e.GetProperty("errorMessage").GetString());
        var args = Args("SP_APP_MSME_INSERT_ESG_CHECKLIST");
        Assert.Equal("1", Tvp(args, "EsgChecklist")!.Rows[0]["Code"]);
        Assert.Equal("", Tvp(args, "EsgChecklist")!.Rows[0]["ifYesQuestion"]);
        Assert.Equal("r", Tvp(args, "SocialOhsChecklist")!.Rows[0]["ifNoAnswer"]);

        AssertFail(await Post("/Msme/SubmitEsgChecklist", Json("""{"userName":"x","esgChecklist":[]}""")), "No data found.");
    }

    [Fact]
    public async Task GetEsgChecklist_returns_the_checklist_json_and_prefers_the_old_sites_copy()
    {
        var r = await Client.GetAsync("/Msme/GetEsgChecklist");
        Assert.Equal("application/json", r.Content.Headers.ContentType!.MediaType);
        var e = JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("ESG check list", e.GetProperty("sections")[0].GetProperty("section_title").GetString());

        Directory.CreateDirectory(StoragePath("App_Data"));
        await File.WriteAllTextAsync(StoragePath("App_Data", "EnvironmentalChecklist.json"), """{"version":"9.9"}""");
        var r2 = await Client.PostAsync("/Msme/GetEsgChecklist", null);
        Assert.Equal("9.9", JsonDocument.Parse(await r2.Content.ReadAsStringAsync()).RootElement.GetProperty("version").GetString());
    }

    private static MultipartFormDataContent EvidenceForm(string photoJson, string evidenceId = "1.2", bool isFirst = true, bool isLast = true,
        byte[]? file = null, string fileName = "e1.png")
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(ZedId), "userName" },
            { new StringContent("Bronze"), "certificationType" },
            { new StringContent(evidenceId), "evidenceId" },
            { new StringContent(isFirst ? "true" : "false"), "isFirst" },
            { new StringContent(isLast ? "true" : "false"), "isLast" },
            { new StringContent(photoJson), "photo" },
        };
        if (file is not null) form.Add(FilePart(file), "file_data", fileName);
        return form;
    }

    [Fact]
    public async Task SubmitEvidenceV2_saves_the_upload_and_builds_the_evidence_pdf_on_the_last_photo()
    {
        Stage("Bronze", 1);
        AssertOk(await Post("/Msme/SubmitEvidenceV2", EvidenceForm("""{"photoId":"e1","isPdf":false,"timeStamp":"t1"}""", file: Png())));

        Assert.True(File.Exists(StoragePath("Photos", ZedId, "Bronze", "Evidences", "e1.png")));
        Assert.True(IsPdf(StoragePath("Photos", ZedId, "Bronze", "Evidences", "1_2.pdf")));
        var args = Args("SP_APP_MSME_INSERT_EVIDENCE");
        Assert.Equal("1.2", FakeSql.Arg(args, "EvidenceId"));
        Assert.Equal("True", FakeSql.Arg(args, "IsLast"));
        var row = Tvp(args, "PhotoList")!.Rows[0];
        Assert.Equal(("e1", "Evidences", "jpg"), ((string)row["PhotoId"], (string)row["Name"], (string)row["PhotoType"]));
    }

    [Fact]
    public async Task SubmitEvidenceV2_uses_earlier_photos_and_reports_missing_ones()
    {
        Stage("Bronze", 1);
        Host.Sql.Procs["SP_APP_MSME_GET_EVIDENCE_PHOTOS"] = _ => FakeSql.Sets([new { PhotoPath = "e0.jpg" }]);
        AssertFail(await Post("/Msme/SubmitEvidenceV2", EvidenceForm($$"""{"photoId":"e1","photo":"{{PngBase64}}"}""", isFirst: false)),
            "Evidence Photos not synced.");
        Assert.Empty(CallsTo("SP_APP_MSME_INSERT_EVIDENCE"));

        await File.WriteAllBytesAsync(StoragePath("Photos", ZedId, "Bronze", "Evidences", "e0.jpg"), Png());
        AssertOk(await Post("/Msme/SubmitEvidenceV2", EvidenceForm($$"""{"photoId":"e1","photo":"{{PngBase64}}"}""", isFirst: false)));
        Assert.True(IsPdf(StoragePath("Photos", ZedId, "Bronze", "Evidences", "1_2.pdf")));
    }

    [Fact]
    public async Task SubmitEvidenceV2_stores_a_pdf_upload_as_the_evidence_pdf()
    {
        Stage("Bronze", 1);
        var pdf = "%PDF-1.4 test"u8.ToArray();
        AssertOk(await Post("/Msme/SubmitEvidenceV2", EvidenceForm("""{"photoId":"d1","isPdf":true}""", evidenceId: "7", file: pdf, fileName: "d1.pdf")));
        Assert.Equal(pdf, await File.ReadAllBytesAsync(StoragePath("Photos", ZedId, "Bronze", "Evidences", "7.pdf")));
        Assert.True(File.Exists(StoragePath("Photos", ZedId, "Bronze", "Evidences", "d1.pdf")));
    }

    [Fact]
    public async Task SubmitEvidenceV2_refuses_traversal_bad_extensions_and_missing_photo_metadata()
    {
        Stage("Bronze", 1);
        AssertFail(await Post("/Msme/SubmitEvidenceV2", EvidenceForm("""{"photoId":"e1"}""", evidenceId: "../../../evil-ev", file: Png())), "Invalid Data.");
        AssertFail(await Post("/Msme/SubmitEvidenceV2", EvidenceForm("""{"photoId":"..\\..\\..\\evil-ev2"}""", file: Png())), "Invalid Data.");
        AssertFail(await Post("/Msme/SubmitEvidenceV2", EvidenceForm("""{"photoId":"e1"}""", file: Png(), fileName: "e1.aspx")), "Invalid Data.");
        AssertFail(await Post("/Msme/SubmitEvidenceV2", EvidenceForm("not json", file: Png())), "Invalid Data.");
        AssertNothingOutside("evil-ev.pdf");
        AssertNothingOutside("evil-ev2.png");
        Assert.Empty(CallsTo("SP_APP_MSME_INSERT_EVIDENCE"));
        Stage("Bronze", 2);
        AssertFail(await Post("/Msme/SubmitEvidenceV2", EvidenceForm("""{"photoId":"e1"}""", file: Png())), "Invalid Details.");
    }

    [Fact]
    public async Task SubmitEvidenceNotUsed_builds_the_pdf_from_the_base64_photos()
    {
        Stage("Silver", 1);
        AssertOk(await Post("/Msme/SubmitEvidenceNotUsed", Json($$"""
            {"userName":"{{ZedId}}","certificationType":"Silver","evidenceId":"3.1","isFirst":true,"isLast":true,
             "photos":[{"photoId":"a","photo":"{{PngBase64}}"},{"photoId":"b","photo":"{{PngBase64}}"}]}
            """)));
        Assert.True(File.Exists(StoragePath("Photos", ZedId, "Silver", "Evidences", "a.jpg")));
        Assert.True(IsPdf(StoragePath("Photos", ZedId, "Silver", "Evidences", "3_1.pdf")));
        Assert.Equal(2, Tvp(Args("SP_APP_MSME_INSERT_EVIDENCE"), "PhotoList")!.Rows.Count);
        AssertFail(await Post("/Msme/SubmitEvidenceNotUsed", Json($$"""{"userName":"{{ZedId}}","certificationType":"Silver","evidenceId":"3.1"}""")), "No photos found.");
    }

    [Fact]
    public async Task SubmitPhotos_saves_base64_file_data_and_files_under_BasicInfo()
    {
        Stage("Bronze", 1);
        var form = new MultipartFormDataContent
        {
            { new StringContent(ZedId), "userName" },
            { new StringContent("Bronze"), "certificationType" },
            { new StringContent("p1"), "photos[0].photoId" },
            { FilePart(Png()), "photos[0].file_data", "anything.png" },
            { new StringContent("p2"), "photos[1].photoId" },
            { new StringContent(PngBase64), "photos[1].photo" },
            { FilePart(Png()), "files", "..\\..\\..\\evil-photos.jpg" },
        };
        AssertOk(await Post("/Msme/SubmitPhotos", form));
        var folder = StoragePath("Photos", ZedId, "Bronze", "BasicInfo");
        Assert.True(File.Exists(Path.Combine(folder, "p1.png")));
        Assert.True(File.Exists(Path.Combine(folder, "p2.jpg")));
        // An uploaded file name keeps only its last part.
        Assert.True(File.Exists(Path.Combine(folder, "evil-photos.jpg")));
        AssertNothingOutside("evil-photos.jpg");
    }

    [Fact]
    public async Task SubmitPhotos_refuses_unknown_types_traversal_and_closed_stages()
    {
        Stage("Bronze", 1);
        var bad = new MultipartFormDataContent
        {
            { new StringContent(ZedId), "userName" }, { new StringContent("Bronze"), "certificationType" },
            { FilePart(Png()), "files", "shell.aspx" },
        };
        AssertFail(await Post("/Msme/SubmitPhotos", bad), "Invalid Data.");
        AssertFail(await Post("/Msme/SubmitPhotos", Json($$"""{"userName":"{{ZedId}}","certificationType":"Bronze","photos":[{"photoId":"../../../evil-p","photo":"{{PngBase64}}"}]}""")),
            "Invalid Data.");
        AssertNothingOutside("evil-p.jpg");
        AssertFail(await Post("/Msme/SubmitPhotos", Json("""{"userName":"ZEDMSME000001","certificationType":"Bronze"}""")), "No photos found.");
        Stage("Bronze", 2, ncCount: 1, ncStatus: 2);
        AssertFail(await Post("/Msme/SubmitPhotos", Json($$"""{"userName":"{{ZedId}}","certificationType":"Bronze","photos":[{"photoId":"x","photo":"{{PngBase64}}"}]}""")),
            "Invalid Details.");
        Stage("Bronze", 2, ncCount: 1, ncStatus: 1);
        AssertOk(await Post("/Msme/SubmitPhotos", Json($$"""{"userName":"{{ZedId}}","certificationType":"Bronze","photos":[{"photoId":"x","photo":"{{PngBase64}}"}]}""")));
    }

    [Fact]
    public async Task SubmitVideo_keeps_the_old_failure_shapes_and_stores_nothing()
    {
        AssertFail(await Post("/Msme/SubmitVideo", Json("""{"username":"x"}""")), "No video found.");
        AssertFail(await Post("/Msme/SubmitVideo", Json("""{"username":"x","videoId":"v1"}""")), "Invalid Data.");
        var form = new MultipartFormDataContent
        {
            { new StringContent("v1"), "videoId" }, { new StringContent("../../evil-ulb"), "ulbCode" }, { new StringContent("g"), "ghatId" },
            { FilePart([1, 2, 3], "video/mp4"), "video_data", "v.mp4" },
        };
        var e = await Post("/Msme/SubmitVideo", form);
        AssertFail(e, "An error has occurred, please try again later.");
        Assert.False(Directory.Exists(StoragePath("Videos")));
        AssertNothingOutside("evil-ulb");
        Assert.Empty(Host.Sql.Calls);
    }

    private void FinalSubmitProcs(int ncCount, params string[] sitePhotoPaths)
    {
        Host.Sql.Procs["SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT"] = _ => FakeSql.Sets([new { AllowFinalSubmit = 1, ErrorMessage = "" }]);
        Host.Sql.Procs["SP_ASSESSMENT_CHECK_NC_PHOTO_AVAILABILITY"] = _ => FakeSql.Sets(sitePhotoPaths.Select(p => (object)new { PhotoPath = p, PhotoId = "x" }).ToArray(), [], []);
        Host.Sql.Procs["SP_EMAIL_GET_DETAILS"] = _ => FakeSql.Sets([new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
        {
            ["EmailId"] = "unit@example.com", ["EnterpriseName"] = "Acme", ["NcCount"] = ncCount, ["AssessorEmailId"] = "assessor@example.com",
            ["AgencyEmailId"] = "agency@example.com", ["Password"] = "AssessorSecret1", ["MsmePassword"] = "MsmeSecret1",
        }]);
    }

    private Task<JsonElement> FinalSubmit() => Post("/Msme/FinalSubmit", Json($$"""{"userName":"{{ZedId}}","certificationType":"Bronze"}"""));

    [Fact]
    public async Task FinalSubmit_submits_and_mails_a_confirmation_without_passwords()
    {
        Host.Settings["Email:RegistrationCc"] = "zed.office@example.test";
        FinalSubmitProcs(0);
        AssertOk(await FinalSubmit());
        Assert.Single(CallsTo("SP_APP_MSME_FINAL_SUBMIT"));
        var mail = Assert.Single(Host.Email.Sent);
        Assert.Equal("unit@example.com", mail.To);
        // The office copy is blind, as the old ccAddress copy was.
        Assert.Equal(["zed.office@example.test"], mail.Bcc!);
        Assert.Null(mail.Cc);
        Assert.Equal("ZED Basic information and Document Upload Confirmation – " + ZedId, mail.Subject);
        Assert.DoesNotContain("Secret1", mail.HtmlBody);
    }

    [Fact]
    public async Task FinalSubmit_of_an_NC_response_copies_assessor_and_agency()
    {
        FinalSubmitProcs(2);
        AssertOk(await FinalSubmit());
        var mail = Assert.Single(Host.Email.Sent);
        Assert.StartsWith("Submission of response to Non-conformance(s)", mail.Subject);
        Assert.Equal(new[] { "assessor@example.com", "agency@example.com" }, mail.Cc!.ToArray());
        Assert.DoesNotContain("Secret1", mail.HtmlBody);
    }

    [Fact]
    public async Task FinalSubmit_returns_the_procedures_refusal_and_checks_photos_under_the_storage_root()
    {
        Host.Sql.Procs["SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT"] = _ => FakeSql.Sets([new { AllowFinalSubmit = 0, ErrorMessage = "Basic info not submitted. Please review." }]);
        AssertFail(await FinalSubmit(), "Basic info not submitted. Please review.");

        const string legacy = @"E:\Publish\ZEDCS_LIVE\ZEDCS_V2_LIVE_SERVICES\Photos/ZEDMSME000001/Bronze/SiteExteriorPhotos/s1.jpg";
        FinalSubmitProcs(0, legacy);
        AssertFail(await FinalSubmit(), "Site Exterior Photos not synced.");
        Directory.CreateDirectory(StoragePath("Photos", ZedId, "Bronze", "SiteExteriorPhotos"));
        await File.WriteAllBytesAsync(StoragePath("Photos", ZedId, "Bronze", "SiteExteriorPhotos", "s1.jpg"), Png());
        AssertOk(await FinalSubmit());

        FinalSubmitProcs(0, @"E:\Publish\Photos/../../../Windows/win.ini");
        AssertFail(await FinalSubmit(), "Site Exterior Photos not synced.");
        Assert.Single(CallsTo("SP_APP_MSME_FINAL_SUBMIT"));
    }

    private static MultipartFormDataContent FacilitatorForm(string photoId, string fileName = "selfie.jpg") => new()
    {
        { new StringContent(ZedId), "userName" },
        { new StringContent("Silver"), "certificationType" },
        { new StringContent("f@example.com"), "email" },
        { new StringContent("9999999999"), "phoneNumber" },
        { new StringContent($$"""{"photoId":"{{photoId}}","latitude":"1.5","longitude":"2.5","timeStamp":"ts"}"""), "selfieMetadata" },
        { FilePart(Png(), "image/jpeg"), "files", fileName },
    };

    [Fact]
    public async Task SubmitFacilitatorDetails_saves_the_selfie_and_returns_the_procedures_answer()
    {
        Stage("Silver", 2);
        Host.Sql.Procs["SP_INSERT_FACILITATOR_DETAILS"] = _ => FakeSql.Sets([new { Status = 1, Message = "FACILITATOR DETAILS ADDED SUCCESSFULLY" }]);
        var e = await Post("/Msme/SubmitFacilitatorDetails", FacilitatorForm("fs1"));
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal("FACILITATOR DETAILS ADDED SUCCESSFULLY", e.GetProperty("errorMessage").GetString());
        Assert.True(File.Exists(StoragePath("FacilitatorSelfies", ZedId, "Silver", "fs1.jpg")));
        var args = Args("SP_INSERT_FACILITATOR_DETAILS");
        Assert.Equal("fs1", FakeSql.Arg(args, "PhotoId"));
        Assert.Equal("f@example.com", FakeSql.Arg(args, "EmailId"));
    }

    [Fact]
    public async Task SubmitFacilitatorDetails_refuses_traversal_non_images_and_unpaid_levels()
    {
        Stage("Silver", 2);
        AssertFail(await Post("/Msme/SubmitFacilitatorDetails", FacilitatorForm("../../../../evil-fs")), "Invalid Data.");
        AssertFail(await Post("/Msme/SubmitFacilitatorDetails", FacilitatorForm("fs1", "selfie.pdf")), "Invalid Data.");
        AssertNothingOutside("evil-fs.jpg");
        Stage("Silver", 0);
        AssertFail(await Post("/Msme/SubmitFacilitatorDetails", FacilitatorForm("fs1")), "Invalid Details.");
        Assert.Empty(CallsTo("SP_INSERT_FACILITATOR_DETAILS"));
    }

    [Fact]
    public void Every_action_that_acts_for_a_user_is_device_bound()
    {
        string[] unbound = ["Login", "ResetPassword", "GetEsgChecklist"];
        var actions = typeof(MsmeController).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => m.GetCustomAttributes().Any(a => a is HttpPostAttribute or AcceptVerbsAttribute))
            .ToList();
        Assert.Equal(21, actions.Count);
        foreach (var action in actions.Where(a => !unbound.Contains(a.Name)))
        {
            var bound = action.GetCustomAttribute<DeviceBoundAttribute>();
            Assert.True(bound is not null, action.Name + " is not device-bound");
            Assert.Equal(MobileApps.Msme, bound!.App);
        }
    }

    [Fact]
    public async Task Enforce_mode_refuses_a_write_from_an_unknown_device()
    {
        Host.Settings["Mobile:DeviceBinding"] = "Enforce";
        Stage("Bronze", 2, ncCount: 1, ncStatus: 1);
        await Host.Devices.RememberAsync(MobileApps.Msme, ZedId, new DeviceInfo { deviceId = "phone-1" }, null);
        string Body(string device) => $$"""
            {"userName":"{{ZedId}}","certificationType":"Bronze","deviceInfo":{"deviceId":"{{device}}"},"photos":[{"photoId":"s1","photo":"{{PngBase64}}"}]}
            """;

        var refused = await Post("/Msme/SubmitSiteExteriorInfo", Json(Body("attacker")));
        AssertFail(refused, "This device is not registered for your account. Please login again.");
        Assert.Empty(CallsTo("SP_APP_MSME_INSERT_SITE_EXTERIOR"));
        Assert.False(Directory.Exists(StoragePath("Photos")));

        AssertOk(await Post("/Msme/SubmitSiteExteriorInfo", Json(Body("phone-1"))));
    }

    [Fact]
    public async Task Unhandled_errors_return_the_generic_body()
    {
        Host.Sql.Procs["SP_APP_MSME_GET_QUESTIONS_BY_TYPE"] = _ => throw new InvalidOperationException("secret detail");
        var r = await Client.PostAsync("/Msme/GetParametersByType", Json("""{"userName":"x"}"""));
        Assert.Equal(HttpStatusCode.InternalServerError, r.StatusCode);
        Assert.DoesNotContain("secret", await r.Content.ReadAsStringAsync());
    }
}
