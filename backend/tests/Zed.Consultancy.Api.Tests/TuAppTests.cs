using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Data;
using Zed.Main.Api.Tests;

namespace Zed.Consultancy.Api.Tests;

/// <summary>
/// The consultant app's technology upgradation calls to the consultancy web site (FinancialAssistance/GetDetails,
/// ValidateEvidence, updatetechnology, FinalSubmit), which carry no identity (app source, 2026-10-22).
/// </summary>
public sealed class TuAppTests : IDisposable
{
    private const string Zed = "ZEDMSME000700";
    private readonly TestHost _host = new();
    private string? _signedIn;

    private readonly Dictionary<string, object?> _fa = new()
    {
        ["Id"] = 41, ["ZedId"] = Zed, ["CertificationType"] = "Silver", ["VerificationStatus"] = 2, ["TechUpgradeStatus"] = 5, ["IsApproved"] = 0,
        ["CertificationBodyUserId"] = "CO1", ["FinancialAssessorId"] = "DFO1", ["FinancialAssistanceId"] = 900,
        ["AccountNo"] = "123456789012", ["IfscCode"] = "SBIN0001234", ["MeetingSubmitted"] = 1, ["Password"] = "leak",
    };

    private readonly List<Dictionary<string, object?>> _photos =
    [
        new() { ["Id"] = 7001, ["ZedId"] = Zed, ["PhotoId"] = "20250101.pdf", ["PhotoType"] = "Purchased Technology", ["TechnologyCode"] = "12", ["CertificationType"] = "Silver", ["FinancialAssistanceId"] = 900 },
    ];

    private readonly List<Dictionary<string, object?>> _techs =
    [
        new() { ["Id"] = 301, ["ZedId"] = Zed, ["TechnologyCode"] = "12", ["MsmeAmountPaid"] = "125000", ["AmountPaid"] = "125000", ["FinancialAssistanceId"] = 900, ["CertificationType"] = "Silver" },
    ];

    public TuAppTests()
    {
        _host.Sql.Procs["SP_FINANCIAL_ASSISTANCE_GET_DETAILS"] = args => FakeSql.Arg(args, "ZedId") != Zed
            ? FakeSql.Sets()
            : FakeSql.Sets([], [_fa], [], [], _photos, [], [], [], [], [], _techs, [], [], [], [], [], [], [], []);
        _host.Sql.Procs["SP_EMAIL_GET_DETAILS_FA"] = _ => FakeSql.Sets([new { EmailId = "msme@acme.test", EnterpriseName = "Acme", PUnitName = "Acme Unit" }]);
        // dbo.V4AppSessions: the DFO named in _signedIn signed in to the app for the unit a minute ago.
        _host.Sql.Queries["SELECT TOP (1) SignedInAt FROM dbo.V4AppSessions"] = args =>
            _signedIn is not null && FakeSql.Arg(args, "UserId") == _signedIn && FakeSql.Arg(args, "ZedId") == Zed
                ? [DateTime.UtcNow.AddMinutes(-1)]
                : [];
    }

    public void Dispose() => _host.Dispose();

    private IEnumerable<object?> CallsTo(string proc) => _host.Sql.Calls.Where(c => c.Name == proc).Select(c => c.Args);

    /// <summary>The app's client: no cookies, no anti-forgery token.</summary>
    private async Task<JsonElement> Post(string path, object body)
    {
        var r = await _host.CreateClient().PostAsJsonAsync(path, body);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
    }

    private static void AssertFail(JsonElement e, string? message = null)
    {
        Assert.Equal("0", e.GetProperty("status").GetString());
        if (message is not null) Assert.Equal(message, e.GetProperty("errorMessage").GetString());
    }

    [Fact]
    public async Task GetDetails_needs_the_allotted_dfo_signed_in_and_drops_secrets()
    {
        AssertFail(await Post("/FinancialAssistance/GetDetails", new { zedId = Zed }), "Technology upgradation details are not available for this unit. Please login again in the app for this unit.");

        _signedIn = "DFO2"; // signed in, but not the allotted DFO
        AssertFail(await Post("/FinancialAssistance/GetDetails", new { zedId = Zed }));

        _signedIn = "DFO1";
        var e = await Post("/FinancialAssistance/GetDetails", new { zedId = Zed });
        var app = e.GetProperty("Table1")[0];
        Assert.Equal(41, app.GetProperty("Id").GetInt32());
        Assert.Equal("SBIN0001234", app.GetProperty("IfscCode").GetString());
        Assert.False(app.TryGetProperty("Password", out _));
        Assert.Equal("20250101.pdf", e.GetProperty("Table4")[0].GetProperty("PhotoId").GetString());

        _fa["VerificationStatus"] = 1; // not yet with the DFO
        AssertFail(await Post("/FinancialAssistance/GetDetails", new { zedId = Zed }));
    }

    private static MultipartFormDataContent Evidence(string id = "7001", string isVerified = "Yes", byte[]? file = null)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(id), "Id" }, { new StringContent(Zed), "ZedId" }, { new StringContent("Silver"), "CertificationType" },
            { new StringContent(isVerified), "IsVerified" }, { new StringContent("Portal"), "SourceOfValidation" }, { new StringContent("checked"), "Remarks" },
        };
        if (file is not null)
        {
            var part = new ByteArrayContent(file);
            part.Headers.ContentType = new MediaTypeHeaderValue("image/*");
            form.Add(part, "files", "IMG_1.jpg");
        }
        return form;
    }

    private async Task<JsonElement> PostForm(MultipartFormDataContent form)
    {
        var r = await _host.CreateClient().PostAsync("/FinancialAssistance/ValidateEvidence", form);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
    }

    [Fact]
    public async Task ValidateEvidence_saves_the_screenshot_under_a_generated_name_for_the_signed_in_dfo()
    {
        byte[] jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46, 0, 1];
        AssertFail(await PostForm(Evidence(file: jpeg)));
        Assert.Empty(CallsTo("SP_FINANCIAL_ASSISTANCE_VALIDATE_EVIDENCES"));

        _signedIn = "DFO1";
        AssertFail(await PostForm(Evidence(id: "9999", file: jpeg)), "Invalid Data.");
        AssertFail(await PostForm(Evidence(file: "<%@ Page Language=\"C#\" %>"u8.ToArray())));
        AssertFail(await PostForm(Evidence(isVerified: "Maybe")), "Invalid Data.");

        var ok = await PostForm(Evidence(file: jpeg));
        Assert.Equal("1", ok.GetProperty("status").GetString());
        var call = Assert.Single(CallsTo("SP_FINANCIAL_ASSISTANCE_VALIDATE_EVIDENCES"));
        Assert.Equal("Yes", FakeSql.Arg(call, "IsVerified"));
        Assert.Equal("Silver", FakeSql.Arg(call, "CertificationType"));
        var folder = Path.Combine(_host.StorageRoot, "Uploads", "TechnologyUpgradation", Zed, "Silver", "Screenshots");
        var saved = Assert.Single(Directory.GetFiles(folder));
        Assert.EndsWith(".jpg", saved);
        Assert.DoesNotContain("IMG_1", Path.GetFileName(saved));

        _fa["VerificationStatus"] = 3; // decided by the DFO: no more validations
        AssertFail(await PostForm(Evidence(file: jpeg)), "This application is not with the DFO for verification.");
    }

    [Fact]
    public async Task UpdateTechnology_is_for_the_dfo_stage_and_at_most_the_declared_amount()
    {
        object Body(string amount) => new Dictionary<string, string> { ["ZedID"] = Zed, ["Id"] = "301", ["AmountPaid"] = amount };
        AssertFail(await Post("/FinancialAssistance/updatetechnology", Body("120000")));

        _signedIn = "DFO1";
        AssertFail(await Post("/FinancialAssistance/updatetechnology", Body("130000")));
        AssertFail(await Post("/FinancialAssistance/updatetechnology", Body("-5")));
        var ok = await Post("/FinancialAssistance/updatetechnology", Body("120000"));
        Assert.Equal("1", ok.GetProperty("status").GetString());
        var call = Assert.Single(CallsTo("SP_FINANCIAL_ASSISTANCE_UPDATE_TECHNOLOGY_DATA"));
        Assert.Equal("120000.00", FakeSql.Arg(call, "AmountPaid"));
        Assert.Equal("301", FakeSql.Arg(call, "Id"));

        _fa["VerificationStatus"] = 4;
        AssertFail(await Post("/FinancialAssistance/updatetechnology", Body("110000")));
        Assert.Single(CallsTo("SP_FINANCIAL_ASSISTANCE_UPDATE_TECHNOLOGY_DATA"));
    }

    [Fact]
    public async Task FinalSubmit_decides_as_the_allotted_dfo_and_mails_a_rejection()
    {
        object Body(int isApproved, string? comments, int id = 41) => new Dictionary<string, object?>
        {
            ["Id"] = id, ["ZedId"] = Zed, ["certificationType"] = "Silver", ["IsApproved"] = isApproved, ["Comments"] = comments, ["FinancialAssessorId"] = "SOMEONE",
        };
        AssertFail(await Post("/FinancialAssistance/FinalSubmit", Body(1, "ok")));

        _signedIn = "DFO1";
        AssertFail(await Post("/FinancialAssistance/FinalSubmit", Body(1, "ok", id: 42)), "Invalid Data.");
        AssertFail(await Post("/FinancialAssistance/FinalSubmit", Body(2, null)), "Please enter the comments.");
        AssertFail(await Post("/FinancialAssistance/FinalSubmit", Body(3, "x")), "Invalid Data.");

        var ok = await Post("/FinancialAssistance/FinalSubmit", Body(1, "verified"));
        Assert.Equal("1", ok.GetProperty("status").GetString());
        var call = Assert.Single(CallsTo("SP_FINANCIAL_ASSISTANCE_FINAL_AUBMIT"));
        Assert.Equal("DFO1", FakeSql.Arg(call, "UserId")); // the allotted DFO, never the body's FinancialAssessorId
        Assert.Equal("3", FakeSql.Arg(call, "RoleId"));
        Assert.Equal("1", FakeSql.Arg(call, "IsApproved"));
        Assert.Empty(_host.Email.Sent);

        var rejected = await Post("/FinancialAssistance/FinalSubmit", Body(2, "invoice mismatch"));
        Assert.Equal("1", rejected.GetProperty("status").GetString());
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("msme@acme.test", mail.To);
        Assert.Contains("invoice mismatch", mail.HtmlBody);
    }

    [Fact]
    public async Task The_login_check_can_be_switched_off_but_the_dfo_stage_still_applies()
    {
        _ = _host.Server; // start the host, then change the setting the controller reads on every call
        _host.Services.GetRequiredService<IConfiguration>()["Consultancy:TuApp:LoginHours"] = "0";
        var e = await Post("/FinancialAssistance/GetDetails", new { zedId = Zed });
        Assert.Equal(41, e.GetProperty("Table1")[0].GetProperty("Id").GetInt32());
        _fa["VerificationStatus"] = 1;
        AssertFail(await Post("/FinancialAssistance/GetDetails", new { zedId = Zed }));
    }
}
