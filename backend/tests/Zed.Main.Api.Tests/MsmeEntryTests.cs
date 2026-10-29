using System.Data;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using SkiaSharp;
using Zed.Core.Forms;
using Zed.Portal.Features.Msme.Entry;

namespace Zed.Main.Api.Tests;

/// <summary>ZED-X basic information, documents and final submit on the web (api/msme/entry, MsmeEntryController).</summary>
public sealed class MsmeEntryTests : IDisposable
{
    private const string Me = MsmeSchemesTestSupport.Me;
    private const string Url = "/api/msme/entry/ZEDX";
    private readonly TestHost _host = new();

    private bool _paid = true;
    private int? _status;
    private int _ncCount;
    private bool _basicSaved;
    private readonly HashSet<int> _synced = [];

    public MsmeEntryTests()
    {
        MsmeSchemesTestSupport.RegisterUsers(_host);
        _host.Sql.Queries[MsmeEntry.StageSql("ZEDX")] = args => FakeSql.Arg(args, "ZedId") != Me ? [] :
            [new { Paid = _paid, CertificationStatus = _status, NcCount = _status is null ? (int?)null : _ncCount, CertificationId = _status is null ? (int?)null : 41 }];
        _host.Sql.Queries[MsmeEntryController.AnswersSql] = _ => !_basicSaved ? [] :
            [new { AuditsConducted = "Yes", DomesticCustomers = "Tata", RawMaterialImported = "No", EnergySources = "Electricity,Solar",
                ManufacturingCapacityUnits = "Number", ManufacturingCapacityValue = "100", MonthlyUtilizationUnits = "Number", MonthlyUtilizationValue = "80" }];
        _host.Sql.Queries[MsmeEntryController.SyncedSql] = _ => _synced.Select(id => (object)new { EvidenceId = id }).ToList();
        _host.Sql.Queries[MsmeEntryController.EvidenceSql] = args => FakeSql.Arg(args, "EvidenceId") is "501" or "502" ? [new { EvidenceId = int.Parse(FakeSql.Arg(args, "EvidenceId")!) }] : [];
        _host.Sql.Procs["SP_APP_MSME_GET_QUESTIONS_BY_TYPE"] = _ => FakeSql.Sets(
            [new { Id = 1, SectionCode = "1", SectionName = "Leadership" }],
            [new { Id = 11, SectionCode = "1", RequirementCode = "1.1", RequirementName = "Policy" }],
            [], [],
            [new Dictionary<string, object?> { ["Id"] = 501, ["SectionCode"] = "1", ["RequirementCode"] = "1.1", ["EvidenceCode"] = "a", ["EvidenceName"] = "Quality policy", ["ValidationRequired"] = false, ["EvidenceHelpText"] = "Signed copy" },
             new Dictionary<string, object?> { ["Id"] = 502, ["SectionCode"] = "1", ["RequirementCode"] = "1.1", ["EvidenceCode"] = "b", ["EvidenceName"] = "Optional record", ["ValidationRequired"] = true }]);
        _host.Sql.Procs["SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT"] = _ => FakeSql.Sets([new { AllowFinalSubmit = 1, ErrorMessage = "" }]);
        _host.Sql.Procs["SP_ASSESSMENT_CHECK_NC_PHOTO_AVAILABILITY"] = _ => FakeSql.Sets(
            [new { PhotoPath = $@"E:\Publish\ZEDCS_LIVE\ZEDCS_V2_LIVE_SERVICES\Photos/{Me}/ZEDX/SiteExteriorPhotos/{Me}100.jpg", PhotoId = Me + "100" }], [], []);
        _host.Sql.Procs["SP_EMAIL_GET_DETAILS"] = _ => FakeSql.Sets([new { EnterpriseName = "Acme Castings", EmailId = "a@acme.test", NcCount = 0, Password = "Secret#1" }]);
    }

    public void Dispose() => _host.Dispose();

    private static byte[] Image(int w = 40, int h = 20)
    {
        using var bmp = new SKBitmap(w, h);
        bmp.Erase(SKColors.Teal);
        using var img = SKImage.FromBitmap(bmp);
        return img.Encode(SKEncodedImageFormat.Png, 100).ToArray();
    }

    private static MultipartFormDataContent Form(object data, params (string Name, byte[] Content, string FileName)[] files)
    {
        var form = new MultipartFormDataContent { { new StringContent(JsonSerializer.Serialize(data, JsonSerializerOptions.Web)), "data" } };
        foreach (var (name, content, fileName) in files)
        {
            var f = new ByteArrayContent(content);
            f.Headers.ContentType = new MediaTypeHeaderValue(fileName.EndsWith(".pdf") ? "application/pdf" : "image/png");
            form.Add(f, name, fileName);
        }
        return form;
    }

    private static object Basic(object? site = null, object? products = null, string rawImported = "No", object? raw = null, string exported = "No") => new
    {
        answers = new Dictionary<string, object?>
        {
            ["auditsConducted"] = "Yes", ["domesticCustomers"] = "Tata Steel", ["internationalCustomers"] = "Should be dropped",
            ["rawMaterialImported"] = rawImported, ["energySources"] = new[] { "Electricity", "Solar" },
            ["monthlyManufacturingCapacityUnits"] = "Number", ["monthlyManufacturingCapacityValue"] = "100",
            ["monthlyUtilizationUnits"] = "Number", ["monthlyUtilizationValue"] = "80",
        },
        products = products ?? new[] { new { productName = "Valve", exported, productPhoto = new { upload = "p0" }, productDescriptionPhoto = new { upload = "d0" } } },
        rawMaterials = raw,
        siteExteriorPhotos = site ?? new[] { new { upload = "s0" } },
        latitude = "26.4499", longitude = "80.3319",
    };

    private DataTable Table(object? args, string name)
    {
        var dp = (Dapper.DynamicParameters)args!;
        var tvp = dp.Get<object>(name);
        var field = tvp.GetType().GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public).First(f => f.FieldType == typeof(DataTable));
        return (DataTable)field.GetValue(tvp)!;
    }

    private string Stored(string folder, string name) =>
        Path.Combine(_host.StorageRoot, "mobileapi", "Photos", Me, "ZEDX", folder, name);

    [Fact]
    public async Task Only_a_paid_web_level_is_open()
    {
        var client = await MsmeSchemesTestSupport.MsmeAsync(_host);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/entry/Bronze")).StatusCode);
        _paid = false;
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(Url)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync($"{Url}/basic-info", Form(Basic()))).StatusCode);
        Assert.Empty(MsmeSchemesTestSupport.CallsTo(_host, "SP_APP_MSME_INSERT_BASIC_INFO"));
    }

    [Fact]
    public async Task The_page_gets_the_admins_form_the_questionnaire_and_what_is_saved()
    {
        _status = 1;
        _basicSaved = true;
        _synced.Add(501);
        MsmeSchemesTestSupport.WriteFile(_host, $"mobileapi/Photos/{Me}/ZEDX/Evidences/501.pdf", MsmeSchemesTestSupport.Pdf);
        var client = await MsmeSchemesTestSupport.MsmeAsync(_host);

        var state = (await client.GetFromJsonAsync<JsonElement>(Url));
        Assert.True(state.GetProperty("editable").GetBoolean());
        Assert.True(state.GetProperty("basicInfoSaved").GetBoolean());
        var keys = state.GetProperty("form").GetProperty("fields").EnumerateArray().Select(f => f.GetProperty("key").GetString()).ToList();
        Assert.Contains("siteExteriorPhotos", keys);
        Assert.Contains("productDetailsList", keys);
        Assert.DoesNotContain("assessorSelfie", keys); // a field of the surveillance build only
        Assert.Equal(["Electricity", "Solar"], state.GetProperty("saved").GetProperty("answers").GetProperty("energySources").EnumerateArray().Select(e => e.GetString()));

        var evidences = state.GetProperty("sections")[0].GetProperty("requirements")[0].GetProperty("evidences");
        Assert.True(evidences[0].GetProperty("required").GetBoolean());
        Assert.True(evidences[0].GetProperty("uploaded").GetBoolean());
        Assert.Equal("/api/msme/entry/ZEDX/files/Evidences/501.pdf", evidences[0].GetProperty("url").GetString());
        Assert.False(evidences[1].GetProperty("required").GetBoolean());
        Assert.Equal(JsonValueKind.Null, evidences[1].GetProperty("url").ValueKind);

        var file = await client.GetAsync("/api/msme/entry/ZEDX/files/Evidences/501.pdf");
        Assert.Equal(HttpStatusCode.OK, file.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/entry/ZEDX/files/Certificates/501.pdf")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/entry/ZEDX/files/Evidences/..%2F..%2Fx.pdf")).StatusCode);
    }

    [Fact]
    public async Task Basic_information_is_saved_with_the_apps_procedure_and_folders()
    {
        var client = await MsmeSchemesTestSupport.MsmeAsync(_host);
        var r = await client.PostAsync($"{Url}/basic-info",
            Form(Basic(), ("s0", Image(), "site.png"), ("p0", Image(2000, 1000), "valve.png"), ("d0", MsmeSchemesTestSupport.Pdf, "label.pdf")));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var args = Assert.Single(MsmeSchemesTestSupport.CallsTo(_host, "SP_APP_MSME_INSERT_BASIC_INFO"));
        Assert.Equal("ZEDX", FakeSql.Arg(args, "CertificationType"));
        Assert.Equal("Tata Steel", FakeSql.Arg(args, "DomesticCustomers"));
        Assert.Null(FakeSql.Arg(args, "InternationalCustomers")); // nothing is exported
        Assert.Equal("Electricity,Solar", FakeSql.Arg(args, "EnergySources"));

        var product = Table(args, "ProductList").Rows[0];
        Assert.Equal("Valve", product["ProductName"]);
        var photoId = ((string)product["ProductPhoto"]).Replace(".jpg", "");
        var labelId = ((string)product["ProductDescriptionPhoto"]).Replace(".pdf", "");
        Assert.StartsWith(Me, photoId);
        Assert.Equal("pdf", Table(args, "ProductDescriptionPhotos").Rows[0]["PhotoType"]);
        var site = Table(args, "SiteExteriorPhotos").Rows[0];
        Assert.Equal("26.4499", site["Latitude"]);

        // Photos as the app stores them: JPEG, longest side 1080 px; the PDF as sent.
        using (var stored = SKBitmap.Decode(Stored("BasicInfo", photoId + ".jpg")))
            Assert.Equal(1080, stored.Width);
        Assert.Equal(MsmeSchemesTestSupport.Pdf, File.ReadAllBytes(Stored("BasicInfo", labelId + ".pdf")));
        Assert.True(File.Exists(Stored("SiteExteriorPhotos", site["PhotoId"] + ".jpg")));

        // Saved again with the same photos by id: no file needed.
        var again = await client.PostAsync($"{Url}/basic-info", Form(Basic(
            site: new[] { new { id = (string)site["PhotoId"] } },
            products: new[] { new { productName = "Valve", exported = "Yes", productPhoto = new { id = photoId }, productDescriptionPhoto = new { id = labelId } } })));
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        var second = MsmeSchemesTestSupport.CallsTo(_host, "SP_APP_MSME_INSERT_BASIC_INFO").Last();
        Assert.Equal("Should be dropped", FakeSql.Arg(second, "InternationalCustomers")); // exported now
        Assert.Equal(labelId + ".pdf", Table(second, "ProductList").Rows[0]["ProductDescriptionPhoto"]);
    }

    [Fact]
    public async Task Required_fields_unknown_photos_and_bad_files_are_refused()
    {
        var client = await MsmeSchemesTestSupport.MsmeAsync(_host);

        var noSite = await client.PostAsync($"{Url}/basic-info", Form(Basic(site: Array.Empty<object>()), ("p0", Image(), "p.png"), ("d0", Image(), "d.png")));
        Assert.Equal(HttpStatusCode.BadRequest, noSite.StatusCode);
        Assert.Contains("Site Exterior", await noSite.ProblemTitle());

        var other = await client.PostAsync($"{Url}/basic-info", Form(Basic(site: new[] { new { id = "ZEDMSME000002123" } }), ("p0", Image(), "p.png"), ("d0", Image(), "d.png")));
        Assert.Equal(HttpStatusCode.BadRequest, other.StatusCode);

        var notImage = await client.PostAsync($"{Url}/basic-info", Form(Basic(), ("s0", "hello"u8.ToArray(), "s.png"), ("p0", Image(), "p.png"), ("d0", Image(), "d.png")));
        Assert.Equal(HttpStatusCode.BadRequest, notImage.StatusCode);

        var rawMissing = await client.PostAsync($"{Url}/basic-info", Form(Basic(rawImported: "Yes"), ("s0", Image(), "s.png"), ("p0", Image(), "p.png"), ("d0", Image(), "d.png")));
        Assert.Equal(HttpStatusCode.BadRequest, rawMissing.StatusCode);
        Assert.Contains("Raw Materials", await rawMissing.ProblemTitle());

        Assert.Empty(MsmeSchemesTestSupport.CallsTo(_host, "SP_APP_MSME_INSERT_BASIC_INFO"));
    }

    [Fact]
    public async Task A_document_is_one_pdf_or_photos_made_into_one()
    {
        var client = await MsmeSchemesTestSupport.MsmeAsync(_host);
        MultipartFormDataContent Files(params (byte[] Content, string Name)[] files)
        {
            var form = new MultipartFormDataContent();
            foreach (var (content, name) in files) form.Add(new ByteArrayContent(content), "files", name);
            return form;
        }

        // Before the basic information exists the procedure has nothing to attach the document to.
        var early = await client.PostAsync($"{Url}/evidences/501", Files((MsmeSchemesTestSupport.Pdf, "a.pdf")));
        Assert.Equal(MsmeEntryController.SaveBasicInfoFirst, await early.ProblemTitle());

        _status = 1;
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync($"{Url}/evidences/999", Files((MsmeSchemesTestSupport.Pdf, "a.pdf")))).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"{Url}/evidences/501", Files((Image(), "1.png"), (Image(), "2.png")))).StatusCode);
        var args = Assert.Single(MsmeSchemesTestSupport.CallsTo(_host, "SP_APP_MSME_INSERT_EVIDENCE"));
        Assert.Equal("501", FakeSql.Arg(args, "EvidenceId"));
        Assert.Equal("True", FakeSql.Arg(args, "IsFirst"));
        Assert.Equal("True", FakeSql.Arg(args, "IsLast"));
        Assert.Equal(2, Table(args, "PhotoList").Rows.Count);
        Assert.StartsWith("%PDF", System.Text.Encoding.ASCII.GetString(File.ReadAllBytes(Stored("Evidences", "501.pdf")), 0, 4));

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"{Url}/evidences/502", Files((MsmeSchemesTestSupport.Pdf, "b.pdf")))).StatusCode);
        Assert.Equal(MsmeSchemesTestSupport.Pdf, File.ReadAllBytes(Stored("Evidences", "502.pdf")));

        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsync($"{Url}/evidences/501", Files((MsmeSchemesTestSupport.Pdf, "a.pdf"), (Image(), "1.png")))).StatusCode);
    }

    [Fact]
    public async Task Final_submit_runs_the_apps_checks_then_allots_by_the_units_kind()
    {
        _status = 1;
        var client = await MsmeSchemesTestSupport.MsmeAsync(_host);

        // The procedure's refusal is shown as it is.
        _host.Sql.Procs["SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT"] = _ => FakeSql.Sets([new { AllowFinalSubmit = 0, ErrorMessage = "One of the evidences are not synced. Please review." }]);
        var refused = await client.PostAsync($"{Url}/final-submit", null);
        Assert.Equal("One of the evidences are not synced. Please review.", await refused.ProblemTitle());

        // A listed photo missing from storage.
        _host.Sql.Procs["SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT"] = _ => FakeSql.Sets([new { AllowFinalSubmit = 1, ErrorMessage = "" }]);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync($"{Url}/final-submit", null)).StatusCode);
        Assert.Empty(MsmeSchemesTestSupport.CallsTo(_host, "SP_APP_MSME_FINAL_SUBMIT"));

        MsmeSchemesTestSupport.WriteFile(_host, $"mobileapi/Photos/{Me}/ZEDX/SiteExteriorPhotos/{Me}100.jpg", Image());
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"{Url}/final-submit", null)).StatusCode);
        Assert.Equal("ZEDX", FakeSql.Arg(Assert.Single(MsmeSchemesTestSupport.CallsTo(_host, "SP_APP_MSME_FINAL_SUBMIT")), "CertificationType"));
        Assert.Equal("ZEDX", FakeSql.Arg(Assert.Single(MsmeSchemesTestSupport.CallsTo(_host, "SP_V4_AUTO_ALLOT_AGENCY")), "CertificationType"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Contains(Me, mail.Subject);
        Assert.Contains("ZED-X", mail.HtmlBody);
        Assert.DoesNotContain("Secret#1", mail.HtmlBody);

        // Submitted: nothing can be changed any more.
        _status = 2;
        Assert.Equal(MsmeEntryController.NotOpen, await (await client.PostAsync($"{Url}/final-submit", null)).ProblemTitle());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync($"{Url}/basic-info", Form(Basic()))).StatusCode);
    }

    [Fact]
    public void The_answers_use_the_app_servers_keys()
    {
        var a = MsmeEntryController.StandardAnswers(new Dictionary<string, string?> { ["auditsConducted"] = "Yes" }, ["Solar"],
            [("Valve", "No", "P1", "D1")], [], ["S1"]);
        Assert.Equal(["Valve"], a["productDetailsList" + AppFormCatalogue.ColumnSeparator + "productName"]);
        Assert.Equal(["S1"], a["siteExteriorPhotos"]);
    }
}
