using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Zed.Core.Mobile;

namespace Zed.Main.MobileApi.Tests;

/// <summary>
/// The Bronze surveillance app as built from its source (ZED_MSME_Bronze, com.qci.zed.bronzesurveillance 1.8,
/// docs/mobile/MSME-APP.md): the exact request shapes it sends to /surveillancemobileapi/surveillance/*. It never
/// fills deviceInfo, sends text parts of multipart bodies with Content-Type multipart/form-data (Retrofit @Part), photo
/// metadata with fields V4 does not know (associatedId, status), productId as a string and enum names in "status".
/// </summary>
public sealed class SurveillanceAppContractTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private const string Assessor = "ZEDBAS0001";
    private readonly SurveillanceAppHost _t = new();

    public void Dispose() => _t.Dispose();

    private static readonly byte[] Pdf = Encoding.ASCII.GetBytes("%PDF-1.4\n%test\n");

    private static void AssertOk(JsonElement e) => Assert.Equal("1", e.GetProperty("status").GetString());

    /// <summary>The app's PhotoData as Gson writes it once the base64 "photo" is cleared (the file goes as a part).</summary>
    private static string PhotoJson(string photoId, bool isPdf) => JsonSerializer.Serialize(new
    {
        photoId, name = photoId + (isPdf ? ".pdf" : ".jpg"), photoPath = "/data/user/0/com.qci.zed.bronzesurveillance/files/" + photoId,
        timeStamp = "20261022_101500", latitude = "17.38", longitude = "78.48", associatedId = "11" + Zed, status = 2, isPdf,
    });

    /// <summary>A Retrofit @Part text part: the app sends it with Content-Type multipart/form-data.</summary>
    private static StringContent RetrofitPart(string value)
    {
        var c = new StringContent(value);
        c.Headers.ContentType = new MediaTypeHeaderValue("multipart/form-data");
        return c;
    }

    private static ByteArrayContent FilePart(byte[] bytes, string mediaType)
    {
        var c = new ByteArrayContent(bytes);
        c.Headers.ContentType = new MediaTypeHeaderValue(mediaType);
        return c;
    }

    private void LoginProc() =>
        _t.Fake.Procs["SP_APP_SURVEILLANCE_CHECK_LOGIN"] = _ => FakeSql.Sets(
            [new { UserId = Assessor, RoleId = 3, Password = "pw" }],
            [new { MsmeId = "11", ZedId = Zed, PledgeCertificateNo = Zed, PUnitName = "Unit" }],
            [new { EnterpriseName = "Acme" }],
            [new { BronzeStatus = 1, SilverStatus = 0, GoldStatus = 0, BronzeStatusOfNc = 0, IsCouponUsed = true }],
            [new { ZedId = Zed, Certification = "Bronze", CertificationStatus = 1, DesktopAssessorId = Assessor }]);

    [Fact]
    public async Task Login_as_the_app_sends_it_without_deviceInfo()
    {
        LoginProc();
        // LoginRequest(userName, password, assessorId, zedId) + BaseServiceRequest.version; deviceInfo is never set.
        var e = await _t.Json("/Surveillance/login", new { userName = Zed, password = "pw", assessorId = Assessor, zedId = Zed, version = "1.8" });
        AssertOk(e);
        Assert.Equal(Zed, e.GetProperty("MsmeDetails").GetProperty("ZedId").GetString());
        Assert.Empty(_t.Devices.Known);
    }

    [Fact]
    public async Task Enforced_device_binding_lets_the_app_through_only_while_missing_devices_are_allowed()
    {
        _t.Settings["Mobile:DeviceBinding"] = "Enforce";
        _t.Sql.Unit(Zed, "Bronze", Assessor);
        _t.Devices.Known[("SURV", Assessor)] = ["dev-of-a-newer-app"];
        var body = new
        {
            userName = Zed, certificationType = "Bronze", version = "1.8",
            basicInformation = new { auditsConducted = "No", rawMaterialImported = "No", status = "IN_PROGRESS", sitePhotosSubmitted = true },
        };
        AssertOk(await _t.Json("/Surveillance/SubmitBasicInformation", body));
        Assert.Contains(_t.Devices.Events, ev => ev.App == "SURV" && ev.Outcome == DeviceCheck.Missing && !ev.Refused);
    }

    [Fact]
    public async Task Refusing_missing_devices_would_lock_this_app_version_out()
    {
        _t.Settings["Mobile:DeviceBinding"] = "Enforce";
        _t.Settings["Mobile:RefuseMissingDevice"] = "true";
        _t.Sql.Unit(Zed, "Bronze", Assessor);
        _t.Devices.Known[("SURV", Assessor)] = ["dev-of-a-newer-app"];
        var e = await _t.Json("/Surveillance/SubmitBasicInformation",
            new { userName = Zed, certificationType = "Bronze", version = "1.8", basicInformation = new { auditsConducted = "No" } });
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Empty(_t.CallsTo("SP_APP_SURVEILLANCE_INSERT_BASIC_INFO"));
    }

    [Fact]
    public async Task The_esg_checklist_is_fetched_with_GET()
    {
        var r = await _t.Client.GetAsync("/Surveillance/GetEsgChecklist");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var e = JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
        Assert.True(e.GetProperty("sections").GetArrayLength() > 0);
    }

    [Fact]
    public async Task Evidence_v2_as_a_retrofit_multipart_with_the_pdf_in_file_data()
    {
        _t.Sql.Unit(Zed, "Bronze", Assessor);
        using var form = new MultipartFormDataContent
        {
            { RetrofitPart(Zed), "userName" },
            { RetrofitPart("Bronze"), "certificationType" },
            { RetrofitPart("E101"), "evidenceId" },
            { RetrofitPart(PhotoJson("ev1", isPdf: true)), "photo" },
            { RetrofitPart("true"), "isFirst" },
            { RetrofitPart("true"), "isLast" },
            { FilePart(Pdf, "application/pdf"), "file_data", "4f1c0e2a.pdf" },
        };
        var (body, status) = await _t.Send("/Surveillance/SubmitEvidenceV2", form);
        Assert.Equal(HttpStatusCode.OK, status);
        AssertOk(body);
        var args = _t.Args("SP_APP_MSME_INSERT_EVIDENCE");
        Assert.Equal("E101", SurveillanceAppHost.Arg(args, "EvidenceId"));
        Assert.Equal(Zed, SurveillanceAppHost.Arg(args, "ZedId"));
        Assert.True(File.Exists(_t.FileUnderRoot("Photos", Zed, "Bronze", "Evidences", "E101.pdf")));
    }

    [Fact]
    public async Task Basic_info_photos_as_files_only()
    {
        _t.Sql.Unit(Zed, "Bronze", Assessor);
        using var form = new MultipartFormDataContent
        {
            { new StringContent(Zed), "userName" },
            { new StringContent("Bronze"), "certificationType" },
            { FilePart([0xFF, 0xD8, 0xFF, 0xE0, 0, 0], "image/*"), "files", "pp1.jpg" },
            { FilePart(Pdf, "application/pdf"), "files", "pd1.pdf" },
        };
        var (body, _) = await _t.Send("/Surveillance/SubmitPhotos", form);
        AssertOk(body);
        Assert.True(File.Exists(_t.FileUnderRoot("Photos", Zed, "Bronze", "BasicInfo", "pp1.jpg")));
        Assert.True(File.Exists(_t.FileUnderRoot("Photos", Zed, "Bronze", "BasicInfo", "pd1.pdf")));
    }

    [Fact]
    public async Task Nc_product_with_a_string_product_id_and_enum_status()
    {
        _t.Sql.Unit(Zed, "Bronze", Assessor, status: 4, ncCount: 1, ncStatus: 1);
        // ProductDetailsNc as Gson writes it: productId comes from the API as text, status is an enum name.
        var product = JsonSerializer.Serialize(new
        {
            id = "row-1", productId = "12", productName = "Bolt", exported = "No", assessorRemarks = "rusty", msmeRemarks = "replaced",
            productPhoto = new { photoId = "np1", isPdf = false, status = 2 }, productDescriptionPhoto = new { photoId = "nd1", isPdf = false },
            productPhotoPath = "/data/np1", status = "TO_START",
        });
        using var form = new MultipartFormDataContent
        {
            { new StringContent(Zed), "userName" },
            { new StringContent("Bronze"), "certificationType" },
            { new StringContent(product), "productDetailsNc" },
            { FilePart([0xFF, 0xD8, 0xFF, 0xE0, 0, 0], "image/*"), "files", "np1.jpg" },
            { FilePart([0xFF, 0xD8, 0xFF, 0xE0, 0, 0], "image/*"), "files", "nd1.jpg" },
        };
        var (body, _) = await _t.Send("/Surveillance/SubmitNcProduct", form);
        AssertOk(body);
        var args = _t.Args("SP_APP_MSME_INSERT_PRODUCT_INFO");
        Assert.Equal("12", SurveillanceAppHost.Arg(args, "ProductId"));
        Assert.Equal("replaced", SurveillanceAppHost.Arg(args, "MsmeRemarks"));
        Assert.Equal("np1.jpg", SurveillanceAppHost.Arg(args, "ProductPhoto"));
        Assert.Equal("nd1.jpg", SurveillanceAppHost.Arg(args, "ProductDescriptionPhoto"));
        Assert.True(File.Exists(_t.FileUnderRoot("Photos", Zed, "Bronze", "BasicInfo", "np1.jpg")));
    }

    [Fact]
    public async Task Nc_requirement_reply_with_the_pdf_in_file_data()
    {
        _t.Sql.Unit(Zed, "Bronze", Assessor, status: 4, ncCount: 1, ncStatus: 1);
        _t.Fake.Procs["SP_APP_MSME_GET_EVIDENCE_ID"] = _ => FakeSql.Sets([new { EvidenceId = "E205" }]);
        using var form = new MultipartFormDataContent
        {
            { new StringContent(Zed), "userName" },
            { new StringContent("Bronze"), "certificationType" },
            { new StringContent("205"), "requirementId" },
            { new StringContent("R2.5"), "requirementCode" },
            { new StringContent(PhotoJson("nr1", isPdf: true)), "photo" },
            { new StringContent("true"), "isFirst" },
            { new StringContent("true"), "isLast" },
            { new StringContent("documents attached"), "msmeRemarks" },
            { FilePart(Pdf, "application/pdf"), "file_data", "9a7b.pdf" },
        };
        var (body, _) = await _t.Send("/Surveillance/SubmitNcRequirement", form);
        AssertOk(body);
        var args = _t.Args("SP_APP_MSME_INSERT_REQUIREMENT");
        Assert.Equal("205", SurveillanceAppHost.Arg(args, "Id"));
        Assert.Equal("R2.5", SurveillanceAppHost.Arg(args, "Code"));
        Assert.Equal("documents attached", SurveillanceAppHost.Arg(args, "MsmeRemarks"));
        Assert.True(File.Exists(_t.FileUnderRoot("Photos", Zed, "Bronze", "Evidences", "E205.pdf")));
    }

    [Fact]
    public async Task Final_submit_and_financial_assistance_details_as_json()
    {
        _t.Sql.Unit(Zed, "Bronze", Assessor);
        _t.Fake.Procs["SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT"] = _ => FakeSql.Sets([new { AllowFinalSubmit = 0 }]);
        AssertOk(await _t.Json("/Surveillance/SubmitFinancialAssistanceDetails",
            new { userName = Zed, certificationType = "Bronze", version = "1.8", financialAssistanceAvailed = "Yes", anyDocuments = "Yes", documentTypes = "Invoice,Receipt" }));
        AssertOk(await _t.Json("/Surveillance/FinalSubmit",
            new { userName = Zed, certificationType = "Bronze", version = "1.8", suitableForSilverUpgrade = "Yes", handholdingSupport = "No" }));
        var final = _t.Args("SP_APP_MSME_FINAL_SUBMIT");
        Assert.Equal(Zed, SurveillanceAppHost.Arg(final, "ZedId"));
    }
}
