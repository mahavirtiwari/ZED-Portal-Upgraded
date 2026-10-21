using System.Text.Json;

namespace Zed.Main.MobileApi.Tests;

public sealed class MsmeAppNcTests : MsmeAppTestBase
{
    [Fact]
    public async Task GetNcDetailsByType_maps_site_photos_products_and_the_nc_questionnaire()
    {
        Host.Sql.Procs["SP_APP_MSME_GET_NC_DETAILS_BY_TYPE"] = _ => FakeSql.Sets(
            [new { PhotoPath = "https://x/s1.jpg", AssessorRemarks = "blurred" }, new { PhotoPath = "https://x/s2.jpg", AssessorRemarks = "dark" }],
            [new { Id = 7, ProductName = "Bolt", Exported = "No", ProductPhotoPath = "https://x/p.jpg", ProductDescriptionPhotoPath = "https://x/d.jpg", AssessorRemarks = "retake" }],
            [new { Id = 1, SectionCode = "1", SectionName = "Leadership" }],
            [new { Id = 2, SectionCode = "1", RequirementCode = "A", AssessorRemarks = "missing" }],
            [new { Id = 3, SectionCode = "1", RequirementCode = "A", OptionCode = "L1", OptionName = "Level 1" }],
            []);
        var e = await Post("/Msme/GetNcDetailsByType", Json($$"""{"userName":"{{ZedId}}","certificationType":"Bronze","ncCount":"1"}"""));
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal("1", FakeSql.Arg(Args("SP_APP_MSME_GET_NC_DETAILS_BY_TYPE"), "NcCount"));
        Assert.Equal("dark", e.GetProperty("assessorRemarksSite").GetString());
        Assert.Equal(2, e.GetProperty("siteExteriorPhotos").GetArrayLength());
        var product = e.GetProperty("products")[0];
        Assert.Equal(7, product.GetProperty("productId").GetInt32());
        Assert.Equal("retake", product.GetProperty("assessorRemarks").GetString());
        Assert.Equal(JsonValueKind.Null, product.GetProperty("productPhoto").ValueKind);
        var req = e.GetProperty("parameters")[0].GetProperty("requirements")[0];
        Assert.Equal("missing", req.GetProperty("assessorRemarks").GetString());
        Assert.Equal(0, req.GetProperty("evidences").GetArrayLength());
    }

    private void EvidenceId(string? id) =>
        Host.Sql.Procs["SP_APP_MSME_GET_EVIDENCE_ID"] = _ => id is null ? FakeSql.Sets([]) : FakeSql.Sets([new { EvidenceId = id }]);

    private static MultipartFormDataContent RequirementForm(string photoJson, string requirementId = "220") => new()
    {
        { new StringContent(ZedId), "userName" },
        { new StringContent("Bronze"), "certificationType" },
        { new StringContent(requirementId), "requirementId" },
        { new StringContent("A"), "requirementCode" },
        { new StringContent("fixed"), "msmeRemarks" },
        { new StringContent("true"), "isFirst" },
        { new StringContent("true"), "isLast" },
        { new StringContent(photoJson), "photo" },
    };

    [Fact]
    public async Task SubmitNcRequirement_names_the_pdf_after_the_current_evidence_and_saves_the_answer()
    {
        Stage("Bronze", 2, ncCount: 1, ncStatus: 1);
        EvidenceId("88001");
        AssertOk(await Post("/Msme/SubmitNcRequirement", RequirementForm($$"""{"photoId":"r1","photo":"{{PngBase64}}"}""")));
        Assert.True(File.Exists(StoragePath("Photos", ZedId, "Bronze", "Evidences", "r1.jpg")));
        Assert.True(IsPdf(StoragePath("Photos", ZedId, "Bronze", "Evidences", "88001.pdf")));
        Assert.Equal("220", FakeSql.Arg(Args("SP_APP_MSME_GET_EVIDENCE_ID"), "RequirementId"));
        var args = Args("SP_APP_MSME_INSERT_REQUIREMENT");
        Assert.Equal("220", FakeSql.Arg(args, "Id"));
        Assert.Equal("fixed", FakeSql.Arg(args, "MsmeRemarks"));
        Assert.Equal("r1", Tvp(args, "PhotoList")!.Rows[0]["PhotoId"]);
    }

    [Fact]
    public async Task SubmitNcRequirement_is_refused_without_an_open_nc_or_an_evidence_of_this_unit()
    {
        var form = () => RequirementForm($$"""{"photoId":"r1","photo":"{{PngBase64}}"}""");
        Stage("Bronze", 2, ncCount: 1, ncStatus: 2);
        EvidenceId("88001");
        AssertFail(await Post("/Msme/SubmitNcRequirement", form()), "Invalid Details.");
        Stage("Bronze", 2, ncCount: 1, ncStatus: 1);
        EvidenceId(null);
        AssertFail(await Post("/Msme/SubmitNcRequirement", form()), "Invalid Details.");
        EvidenceId("88001");
        AssertFail(await Post("/Msme/SubmitNcRequirement", RequirementForm("""{"photoId":"r1"}""", requirementId: "abc")), "Invalid Data.");
        AssertFail(await Post("/Msme/SubmitNcRequirement", RequirementForm($$"""{"photoId":"../../../../evil-nc","photo":"{{PngBase64}}"}""")), "Invalid Data.");
        EvidenceId("..\\..\\..\\evil-ncpdf");
        AssertFail(await Post("/Msme/SubmitNcRequirement", form()), "Invalid Data.");
        AssertNothingOutside("evil-nc.jpg");
        AssertNothingOutside("evil-ncpdf.pdf");
        Assert.Empty(CallsTo("SP_APP_MSME_INSERT_REQUIREMENT"));
        Assert.False(Directory.Exists(StoragePath("Photos")));
    }

    private static MultipartFormDataContent ProductForm(string productJson, string fileName = "pp2.jpg", bool withFile = true)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(ZedId), "userName" },
            { new StringContent("Bronze"), "certificationType" },
            { new StringContent(productJson), "productDetailsNc" },
        };
        if (withFile) form.Add(FilePart(Png()), "files", fileName);
        return form;
    }

    [Fact]
    public async Task SubmitNcProduct_saves_the_files_and_passes_the_photo_names()
    {
        Stage("Bronze", 2, ncCount: 1, ncStatus: 1);
        AssertOk(await Post("/Msme/SubmitNcProduct", ProductForm($$$"""
            {"productId":7,"msmeRemarks":"new photos","productPhoto":{"photoId":"pp2","isPdf":false},
             "productDescriptionPhoto":{"photoId":"pd2","photo":"{{{PngBase64}}}"}}
            """)));
        var folder = StoragePath("Photos", ZedId, "Bronze", "BasicInfo");
        Assert.True(File.Exists(Path.Combine(folder, "pp2.jpg")));
        Assert.True(File.Exists(Path.Combine(folder, "pd2.jpg")));
        var args = Args("SP_APP_MSME_INSERT_PRODUCT_INFO");
        Assert.Equal("7", FakeSql.Arg(args, "ProductId"));
        Assert.Equal("pp2.jpg", FakeSql.Arg(args, "ProductPhoto"));
        Assert.Equal("pd2.jpg", FakeSql.Arg(args, "ProductDescriptionPhoto"));
        Assert.Null(Tvp(args, "ProductPhotos"));
        Assert.Equal("BasicInfo", Tvp(args, "ProductDescriptionPhotos")!.Rows[0]["Name"]);
    }

    [Fact]
    public async Task SubmitNcProduct_keeps_the_old_messages_and_refuses_bad_files()
    {
        Stage("Bronze", 2, ncCount: 1, ncStatus: 1);
        AssertFail(await Post("/Msme/SubmitNcProduct", ProductForm("not json")), "No data found.");
        AssertFail(await Post("/Msme/SubmitNcProduct", ProductForm("""{"productId":7}""", withFile: false)), "No photos found.");
        AssertFail(await Post("/Msme/SubmitNcProduct", ProductForm("""{"productId":7}""", fileName: "x.exe")), "Invalid Data.");
        AssertFail(await Post("/Msme/SubmitNcProduct", ProductForm($$$"""{"productId":7,"productPhoto":{"photoId":"../../../evil-prod","photo":"{{{PngBase64}}}"}}""")), "Invalid Data.");
        AssertNothingOutside("evil-prod.jpg");
        Assert.Empty(CallsTo("SP_APP_MSME_INSERT_PRODUCT_INFO"));
    }

    [Fact]
    public async Task SubmitSiteExteriorInfo_saves_the_photos_and_maps_the_procedures_refusal()
    {
        Stage("Gold", 3, ncCount: 2, ncStatus: 1);
        var body = $$"""{"userName":"{{ZedId}}","certificationType":"Gold","msmeRemarks":"ok","photos":[{"photoId":"s9","photo":"{{PngBase64}}","timeStamp":"t"}]}""";
        AssertOk(await Post("/Msme/SubmitSiteExteriorInfo", Json(body)));
        Assert.True(File.Exists(StoragePath("Photos", ZedId, "Gold", "SiteExteriorPhotos", "s9.jpg")));
        var args = Args("SP_APP_MSME_INSERT_SITE_EXTERIOR");
        Assert.Equal("ok", FakeSql.Arg(args, "MsmeRemarks"));
        Assert.Equal("SiteExteriorPhotos", Tvp(args, "SiteExteriorPhotos")!.Rows[0]["Name"]);

        Host.Sql.Procs["SP_APP_MSME_INSERT_SITE_EXTERIOR"] = _ =>
            throw new MsmeAppDbException("Conversion failed when converting the varchar value 'ABC_SITE_EXTERIOR' to data type bit.");
        var refused = await Post("/Msme/SubmitSiteExteriorInfo", Json(body));
        AssertFail(refused, "Site exterior photos have no open non-conformance.");
        Assert.DoesNotContain("Conversion", refused.GetRawText());

        AssertFail(await Post("/Msme/SubmitSiteExteriorInfo",
            Json($$"""{"userName":"{{ZedId}}","certificationType":"Gold","photos":[{"photoId":"..\\..\\..\\evil-site","photo":"{{PngBase64}}"}]}""")), "Invalid Data.");
        AssertNothingOutside("evil-site.jpg");
    }
}

public sealed class MsmeAppFinancialTests : MsmeAppTestBase
{
    private void Certified(string? level = "Silver") =>
        Host.Sql.Procs["SP_FINANCIAL_ASSISTANCE_GET_CURRENT_CERTIFICATE"] = _ => level is null ? FakeSql.Sets() : FakeSql.Sets([new { CertificationType = level }]);

    private const string Claim = """
        {"ZedId":"ZEDMSME000001",
         "CertificationDetails":{"CategoryOfCertificate":"ISO","CertficateNumber":"C1","Photos":[{"photoId":"c1","isPdf":true}]},
         "ExpenditureDetails":{"InvoiceNo":"INV1","AmountPaid":"1000","Photos":[{"photoId":"x1"}],"InvoicePhotos":[{"photoId":"i1"}]},
         "AccountDetails":{"AccountNo":"123","IfscCode":"SBIN0000001","Photos":[{"photoId":"q1"}]}}
        """;

    [Fact]
    public async Task SubmitFinancialData_inserts_the_claim_answers_as_text_and_mails_a_confirmation()
    {
        Certified();
        Host.Sql.Procs["SP_EMAIL_GET_DETAILS"] = _ => FakeSql.Sets([new { EmailId = "unit@example.com", EnterpriseName = "Acme", Password = "AssessorSecret1" }]);
        var r = await Client.PostAsync("/Msme/SubmitFinancialData", Json(Claim));
        Assert.Equal("text/html", r.Content.Headers.ContentType!.MediaType);
        var e = JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
        AssertOk(e);

        var args = Args("SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE");
        Assert.Equal("App", FakeSql.Arg(args, "SubmittedFrom"));
        Assert.Equal("123", FakeSql.Arg(args, "AccountNo"));
        var photos = Tvp(args, "PhotoListApp")!;
        Assert.Equal(["c1.pdf", "x1.jpg", "i1.jpg", "q1.jpg"], photos.Rows.Cast<System.Data.DataRow>().Select(x => (string)x["PhotoId"]).ToArray());
        Assert.Equal("Copy of Cancelled Cheque", photos.Rows[3]["PhotoType"]);
        Assert.Equal("Silver", FakeSql.Arg(Args("SP_EMAIL_GET_DETAILS"), "Certification"));
        var mail = Assert.Single(Host.Email.Sent);
        Assert.Equal("ZED Financial Assistance Documents Upload Confirmation - " + ZedId, mail.Subject);
        Assert.DoesNotContain("Secret1", mail.HtmlBody);
    }

    [Fact]
    public async Task SubmitFinancialData_computes_the_eligible_amount_and_ignores_the_apps()
    {
        Certified();
        var claim = Claim.Replace("\"AmountPaid\":\"1000\"", "\"AmountPaid\":\"1000.80\",\"EligibleAmount\":\"999999\"");
        AssertOk(JsonDocument.Parse(await (await Client.PostAsync("/Msme/SubmitFinancialData", Json(claim))).Content.ReadAsStringAsync()).RootElement);
        var args = Args("SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE");
        Assert.Equal("1000.8", FakeSql.Arg(args, "AmountPaid"));
        Assert.Equal("750", FakeSql.Arg(args, "EligibleAmount"));

        Host.Sql.Calls.Clear();
        AssertOk(JsonDocument.Parse(await (await Client.PostAsync("/Msme/SubmitFinancialData",
            Json(Claim.Replace("\"AmountPaid\":\"1000\"", "\"AmountPaid\":\"900000\"")))).Content.ReadAsStringAsync()).RootElement);
        Assert.Equal("50000", FakeSql.Arg(Args("SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE"), "EligibleAmount"));

        Host.Sql.Calls.Clear();
        var bad = await Client.PostAsync("/Msme/SubmitFinancialData", Json(Claim.Replace("\"AmountPaid\":\"1000\"", "\"AmountPaid\":\"abc\"")));
        AssertFail(JsonDocument.Parse(await bad.Content.ReadAsStringAsync()).RootElement, "Invalid Details.");
        Assert.Empty(CallsTo("SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE"));
    }

    [Fact]
    public async Task SubmitFinancialData_needs_a_completed_certification_and_maps_the_procedures_refusal()
    {
        Certified(null);
        var r = await Client.PostAsync("/Msme/SubmitFinancialData", Json(Claim));
        AssertFail(JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement, "Invalid Details.");
        Assert.Empty(CallsTo("SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE"));

        Certified();
        Host.Sql.Procs["SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE"] = _ =>
            throw new MsmeAppDbException("Conversion failed when converting the varchar value 'ABC' to data type bit.");
        r = await Client.PostAsync("/Msme/SubmitFinancialData", Json(Claim));
        AssertFail(JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement,
            "Financial assistance has already been applied for, or the unit is not eligible.");
        Assert.Empty(Host.Email.Sent);

        r = await Client.PostAsync("/Msme/SubmitFinancialData", Json("""{"ZedId":"ZEDMSME000001"}"""));
        AssertFail(JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement, "No data found.");
    }

    [Fact]
    public async Task SubmitFinancialPhotos_saves_under_the_zed_id_and_refuses_traversal()
    {
        Certified();
        var form = new MultipartFormDataContent
        {
            { new StringContent("someone"), "userName" },
            { new StringContent(ZedId), "zedId" },
            { new StringContent("c1"), "photos[0].photoId" },
            { new StringContent("true"), "photos[0].isPdf" },
            { new StringContent(Convert.ToBase64String("%PDF-1.4"u8.ToArray())), "photos[0].photo" },
            { FilePart(Png()), "files", "inv1.png" },
        };
        AssertOk(await Post("/Msme/SubmitFinancialPhotos", form));
        Assert.True(File.Exists(StoragePath("Photos", ZedId, "FinancialAssistance", "c1.pdf")));
        Assert.True(File.Exists(StoragePath("Photos", ZedId, "FinancialAssistance", "inv1.png")));
        Assert.Equal(ZedId, FakeSql.Arg(Args("SP_FINANCIAL_ASSISTANCE_GET_CURRENT_CERTIFICATE"), "ZedId"));

        AssertFail(await Post("/Msme/SubmitFinancialPhotos",
            Json($$"""{"zedId":"../../../evil-fa","photos":[{"photoId":"c1","photo":"{{PngBase64}}"}]}""")), "Invalid Data.");
        AssertNothingOutside("evil-fa");
        AssertFail(await Post("/Msme/SubmitFinancialPhotos", Json("""{"zedId":"ZEDMSME000001"}""")), "No photos found.");
        Certified(null);
        AssertFail(await Post("/Msme/SubmitFinancialPhotos",
            Json($$"""{"zedId":"{{ZedId}}","photos":[{"photoId":"c2","photo":"{{PngBase64}}"}]}""")), "Invalid Details.");
        Assert.False(File.Exists(StoragePath("Photos", ZedId, "FinancialAssistance", "c2.jpg")));
    }
}
