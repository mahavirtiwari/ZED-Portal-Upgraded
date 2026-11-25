using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Zed.Portal.Features.Incentives;
using Zed.Portal.Features.Incentives.Applicant;

namespace Zed.Main.Api.Tests;

/// <summary>
/// 2026-11-25 (the product owner: the Admin's incentive schemes in the ZED MSME app with the full forms): the app-token endpoints
/// (Msme/AppIncentiveSchemes…) answer what the web's api/msme/incentive-schemes answers, through the same service, for the unit
/// of the sign-in token only.
/// </summary>
public sealed partial class MsmeIncentiveSchemesTests
{
    private const string Other = MsmeSchemesTestSupport.Other;

    /// <summary>The portal with the shared app-token key, and an app client that sends the token it is given.</summary>
    private sealed class AppHost(WebApplicationFactory<Program> app) : IDisposable
    {
        public WebApplicationFactory<Program> App { get; } = app;
        public HttpClient Client { get; } = app.CreateClient();

        public Task<string> TokenAsync(string zedId) =>
            App.Services.GetRequiredService<Zed.Core.Mobile.AppTokens>().IssueAsync(Zed.Core.Mobile.MobileApps.Msme, zedId, zedId);

        public Task<HttpResponseMessage> SendAsync(HttpMethod method, string url, string? token, HttpContent? content = null)
        {
            var r = new HttpRequestMessage(method, url) { Content = content };
            if (token is not null) r.Headers.Add(Zed.Core.Mobile.AppTokens.Header, token);
            return Client.SendAsync(r);
        }

        public void Dispose()
        {
            Client.Dispose();
            App.Dispose();
        }
    }

    private AppHost MobileHost()
    {
        var key = Convert.ToBase64String(Enumerable.Range(1, 32).Select(i => (byte)i).ToArray());
        return new AppHost(_app.WithWebHostBuilder(b => b.UseSetting("Mobile:AppTokenKey", key)));
    }

    /// <summary>An app answer: status "1" with the named part, or fails the test with the refusal.</summary>
    private static async Task<JsonElement> AppJson(HttpResponseMessage r, string part)
    {
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("status").GetString() == "1", body.GetRawText());
        return body.GetProperty(part);
    }

    /// <summary>An app refusal: status "0" and the sentence.</summary>
    private static async Task<string> AppRefusal(HttpResponseMessage r)
    {
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("0", body.GetProperty("status").GetString());
        return body.GetProperty("errorMessage").GetString()!;
    }

    private static async Task<string> AppUploadAsync(AppHost host, string token, string code, string section, int item, string field)
    {
        var file = new ByteArrayContent(MsmeSchemesTestSupport.Pdf);
        file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/pdf");
        var form = new MultipartFormDataContent
        {
            { new StringContent(section), "section" }, { new StringContent(item.ToString()), "item" }, { new StringContent(field), "field" }, { file, "file", "doc.pdf" },
        };
        var upload = await AppJson(await host.SendAsync(HttpMethod.Post, $"/Msme/AppIncentiveSchemes/{code}/Document", token, form), "upload");
        Assert.True(upload.GetProperty("isPdf").GetBoolean());
        Assert.StartsWith($"/Msme/AppIncentiveSchemes/{code}/File?name=", upload.GetProperty("url").GetString());
        return upload.GetProperty("fileName").GetString()!;
    }

    /// <summary>The applications of the unit asked for only, and a draft of the unit that starts it (the constructor's fakes are Me's).</summary>
    private void AppsByUnit()
    {
        _host.Sql.Queries["INSERT INTO dbo.FinancialAssistance (ZedId, CertificationType, SchemeCode"] = args =>
        {
            lock (_apps)
            {
                var id = _nextId++;
                var row = App(id, "Draft", FakeSql.Arg(args, "SchemeLevel"), FakeSql.Arg(args, "SchemeCertNo"), FakeSql.Arg(args, "SchemeCode"));
                row["ZedId"] = FakeSql.Arg(args, "ZedId");
                _apps.Add(row);
                return [id];
            }
        };
        _host.Sql.Queries["SELECT Id, ZedId, SchemeCode, SchemeLevel"] = args =>
        {
            lock (_apps)
            {
                var id = FakeSql.Arg(args, "Id");
                var code = FakeSql.Arg(args, "SchemeCode");
                var unit = FakeSql.Arg(args, "ZedId");
                return _apps.Where(a => (unit is null || (string?)a["ZedId"] == unit) && (id is not null ? a["Id"]!.ToString() == id : code is null || (string?)a["SchemeCode"] == code))
                    .OrderByDescending(a => (int)a["Id"]!).Select(a => (object)new Dictionary<string, object?>(a)).ToList();
            }
        };
    }

    [Fact]
    public async Task App_scheme_endpoints_need_the_units_sign_in_token()
    {
        DirectTu();
        using var host = MobileHost();
        foreach (var (method, url, body) in new (HttpMethod, string, Func<HttpContent?>)[]
        {
            (HttpMethod.Get, "/Msme/AppIncentiveSchemes", () => null),
            (HttpMethod.Get, $"/Msme/AppIncentiveSchemes/{Code}", () => null),
            (HttpMethod.Post, $"/Msme/AppIncentiveSchemes/{Code}/Draft", () => null),
            (HttpMethod.Post, $"/Msme/AppIncentiveSchemes/{Code}/Item", () => JsonContent.Create(new { section = "technologies", index = 0, values = new { } })),
            (HttpMethod.Post, $"/Msme/AppIncentiveSchemes/{Code}/Submit", () => JsonContent.Create(new { declaration = true })),
            (HttpMethod.Get, $"/Msme/AppIncentiveSchemes/{Code}/File?name=x.pdf", () => null),
        })
        {
            foreach (var token in new string?[] { null, "not-a-token" })
            {
                var r = await host.SendAsync(method, url, token, body());
                Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
                Assert.Equal(Zed.Core.Mobile.AppTokens.ExpiredMessage, (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errorMessage").GetString());
            }
        }
        Assert.Empty(_apps);
    }

    [Fact]
    public async Task App_dashboard_and_page_are_the_webs()
    {
        DirectTu();
        AddScheme(SchemeTemplates.FinancialAssistance("GREEN") with { Card = new() { Title = "Green", Icon = "star" } });
        FaCard();
        _apps.Add(App(7, "Verifying", "Bronze", "B-1", "GREEN"));
        using var host = MobileHost();
        var token = await host.TokenAsync(Me);

        var dashboard = await AppJson(await host.SendAsync(HttpMethod.Get, "/Msme/AppIncentiveSchemes", token), "dashboard");
        var web = await Json(await (await SignInAsync()).GetAsync("/api/msme/incentive-schemes"));
        Assert.Equal(web.GetRawText(), dashboard.GetRawText());
        Assert.Equal(("GREEN", "progress"), (dashboard.GetProperty("schemes")[0].GetProperty("code").GetString(), dashboard.GetProperty("schemes")[0].GetProperty("state").GetString()));
        Assert.Equal("open", dashboard.GetProperty("tu").GetProperty("scheme").GetProperty("state").GetString());
        Assert.Equal("open", dashboard.GetProperty("fa").GetProperty("scheme").GetProperty("state").GetString());

        var page = await AppJson(await host.SendAsync(HttpMethod.Get, $"/Msme/AppIncentiveSchemes/{Code}", token), "page");
        Assert.Equal((await Json(await (await SignInAsync()).GetAsync($"/api/msme/incentive-schemes/{Code}"))).GetRawText(), page.GetRawText());
        Assert.True(page.GetProperty("canApply").GetBoolean());
        Assert.Equal("Acme Castings", page.GetProperty("unit").GetProperty("EnterpriseName").GetString());

        // A scheme that is not there: the app's refusal, not a 404.
        Assert.Equal(MsmeAppIncentiveSchemesController.NotAvailableMessage,
            await AppRefusal(await host.SendAsync(HttpMethod.Get, "/Msme/AppIncentiveSchemes/NOPE", token)));
    }

    [Fact]
    public async Task App_draft_section_item_documents_and_submit_go_through_the_webs_rules()
    {
        DirectTu();
        using var host = MobileHost();
        var token = await host.TokenAsync(Me);
        var url = $"/Msme/AppIncentiveSchemes/{Code}";

        // Before the draft nothing can be saved.
        Assert.Equal("Please start the application first.",
            await AppRefusal(await host.SendAsync(HttpMethod.Post, url + "/Item", token, JsonContent.Create(new { section = "technologies", index = 0, values = new { } }))));

        var page = await AppJson(await host.SendAsync(HttpMethod.Post, url + "/Draft", token), "page");
        Assert.Equal(("Draft", "Bronze"), (page.GetProperty("application").GetProperty("status").GetString(), page.GetProperty("application").GetProperty("level").GetString()));
        Assert.Equal(Me, Assert.Single(_apps)["ZedId"]);

        // The TU scheme has no plain section: the section save says so (as the web's 404).
        Assert.Equal(MsmeAppIncentiveSchemesController.NotAvailableMessage,
            await AppRefusal(await host.SendAsync(HttpMethod.Post, url + "/Section", token, JsonContent.Create(new { section = "technologies", values = new { } }))));

        Dictionary<string, string?> Values(string picture, string invoice, string amount = "240000") => new()
        {
            ["manufacturer"] = "Acme Solar", ["model"] = "S-200", ["purchased_on"] = Day(-3), ["supplier"] = "Acme", ["invoice_no"] = "INV-1",
            ["invoice_date"] = Day(-3), ["amount_paid"] = amount, ["payment_mode"] = "Online", ["technology_picture"] = Files(picture), ["invoice_copy"] = Files(invoice),
        };
        var picture = await AppUploadAsync(host, token, Code, "technologies", 0, "technology_picture");
        var invoice = await AppUploadAsync(host, token, Code, "technologies", 0, "invoice_copy");

        // The web's checks: a date before the certification is refused with the web's sentence.
        var early = Values(picture, invoice);
        early["purchased_on"] = Day(-30);
        Assert.Contains("Date of Purchase",
            await AppRefusal(await host.SendAsync(HttpMethod.Post, url + "/Item", token, JsonContent.Create(new { section = "technologies", index = 0, pick = "T1", values = early }))));

        page = await AppJson(await host.SendAsync(HttpMethod.Post, url + "/Item", token,
            JsonContent.Create(new { section = "technologies", index = 0, pick = "T1", values = Values(picture, invoice) })), "page");
        Assert.Equal(240000, page.GetProperty("application").GetProperty("claimAmount").GetDecimal());
        Assert.Equal(192000, page.GetProperty("application").GetProperty("eligibleAmount").GetDecimal());

        // Add more, then remove it.
        var picture2 = await AppUploadAsync(host, token, Code, "technologies", 1, "technology_picture");
        var invoice2 = await AppUploadAsync(host, token, Code, "technologies", 1, "invoice_copy");
        var second = Values(picture2, invoice2, "60000");
        second["invoice_no"] = "INV-2";
        page = await AppJson(await host.SendAsync(HttpMethod.Post, url + "/Item", token, JsonContent.Create(new { section = "technologies", index = 1, pick = "T2", values = second })), "page");
        Assert.Equal(2, page.GetProperty("application").GetProperty("answers").GetProperty("sections").GetProperty("technologies").GetArrayLength());
        page = await AppJson(await host.SendAsync(HttpMethod.Post, url + "/RemoveItem", token, JsonContent.Create(new { section = "technologies", index = 1 })), "page");
        Assert.Equal(1, page.GetProperty("application").GetProperty("answers").GetProperty("sections").GetProperty("technologies").GetArrayLength());

        // The unit's own document opens with its token.
        var file = await host.SendAsync(HttpMethod.Get, $"{url}/File?name={picture}", token);
        Assert.Equal(HttpStatusCode.OK, file.StatusCode);

        // Submit: the declaration first, then the claim, the bank account and the cheque as on the web.
        var cheque = await AppUploadAsync(host, token, Code, "_bank", 0, "cheque");
        var account = new { accountNo = "123456789012", confirmAccountNo = "123456789012", ifscCode = "sbin0001234", branchAddress = "MG Road", bankName = "SBI" };
        Assert.Equal("Please accept the declaration.", await AppRefusal(await host.SendAsync(HttpMethod.Post, url + "/Submit", token,
            JsonContent.Create(new { account, cheque = new[] { cheque }, unitConfirmed = true, declaration = false }))));
        page = await AppJson(await host.SendAsync(HttpMethod.Post, url + "/Submit", token,
            JsonContent.Create(new { account, cheque = new[] { cheque }, unitConfirmed = true, declaration = true })), "page");
        Assert.Equal(("Submitted", "progress"), (page.GetProperty("application").GetProperty("status").GetString(), page.GetProperty("state").GetString()));
        var args = Assert.Single(_submits);
        Assert.Equal(Me, FakeSql.Arg(args, "ZedId"));
        Assert.Equal("240000", FakeSql.Arg(args, "ClaimAmount"));
        Assert.Equal("SBIN0001234", FakeSql.Arg(args, "IfscCode"));
        Assert.Equal(new[] { (int)_apps[0]["Id"]! }, _workflow.Submitted.ToArray());

        // Each change is in the unit's Edit History, from the app.
        var recorded = _host.Sql.Calls.Where(c => c.Name.Contains("V4MsmeEditHistory") && c.Name.StartsWith("INSERT")).ToList();
        Assert.Contains(recorded, c => FakeSql.Arg(c.Args, "Action") == "Incentive scheme: application submitted" && FakeSql.Arg(c.Args, "Channel") == "Mobile"
            && FakeSql.Arg(c.Args, "ZedId") == Me);
    }

    [Fact]
    public async Task App_correction_round_changes_only_the_answers_found_not_valid()
    {
        DirectTu();
        using var host = MobileHost();
        var token = await host.TokenAsync(Me);
        var url = $"/Msme/AppIncentiveSchemes/{Code}";
        await AppJson(await host.SendAsync(HttpMethod.Post, url + "/Draft", token), "page");
        var picture = await AppUploadAsync(host, token, Code, "technologies", 0, "technology_picture");
        var invoice = await AppUploadAsync(host, token, Code, "technologies", 0, "invoice_copy");
        var values = new Dictionary<string, string?>
        {
            ["manufacturer"] = "Acme Solar", ["model"] = "S-200", ["purchased_on"] = Day(-3), ["supplier"] = "Acme", ["invoice_no"] = "INV-1",
            ["invoice_date"] = Day(-3), ["amount_paid"] = "100000", ["payment_mode"] = "Online", ["technology_picture"] = Files(picture), ["invoice_copy"] = Files(invoice),
        };
        await AppJson(await host.SendAsync(HttpMethod.Post, url + "/Item", token, JsonContent.Create(new { section = "technologies", index = 0, pick = "T1", values })), "page");
        var cheque = await AppUploadAsync(host, token, Code, "_bank", 0, "cheque");
        var account = new { accountNo = "123456789012", confirmAccountNo = "123456789012", ifscCode = "SBIN0001234", branchAddress = "MG Road", bankName = "SBI" };
        await AppJson(await host.SendAsync(HttpMethod.Post, url + "/Submit", token,
            JsonContent.Create(new { account, cheque = new[] { cheque }, unitConfirmed = true, declaration = true })), "page");

        var app = _apps[0];
        app["SchemeStatus"] = "Correction";
        app["CorrectionRound"] = 1;
        app["CorrectionDueOn"] = DateTime.Today.AddDays(5);
        app["FormChecks"] = FieldCheck.Serialize(new() { ["technologies/0/amount_paid"] = new("No", "The invoice says 90,000.", 1, "DA1", DateTime.Today) });

        var page = await AppJson(await host.SendAsync(HttpMethod.Get, url, token), "page");
        var check = Assert.Single(page.GetProperty("application").GetProperty("checks").EnumerateArray());
        Assert.Equal("The invoice says 90,000.", check.GetProperty("remarks").GetString());

        values["amount_paid"] = "90000";
        values["manufacturer"] = "Changed";
        page = await AppJson(await host.SendAsync(HttpMethod.Post, url + "/Item", token, JsonContent.Create(new { section = "technologies", index = 0, pick = "T1", values })), "page");
        var saved = page.GetProperty("application").GetProperty("answers").GetProperty("sections").GetProperty("technologies")[0].GetProperty("values");
        Assert.Equal(("90000", "Acme Solar"), (saved.GetProperty("amount_paid").GetString(), saved.GetProperty("manufacturer").GetString()));

        page = await AppJson(await host.SendAsync(HttpMethod.Post, url + "/Correction", token, JsonContent.Create(new { })), "page");
        Assert.Equal("Verifying", page.GetProperty("application").GetProperty("status").GetString());
        Assert.Equal(Me, FakeSql.Arg(Assert.Single(_corrections), "ZedId"));
        Assert.Equal(new[] { (int)app["Id"]! }, _workflow.Corrected.ToArray());
    }

    [Fact]
    public async Task App_token_of_another_unit_never_reaches_the_units_application()
    {
        DirectTu();
        AppsByUnit();
        using var host = MobileHost();
        var mine = await host.TokenAsync(Me);
        var url = $"/Msme/AppIncentiveSchemes/{Code}";
        await AppJson(await host.SendAsync(HttpMethod.Post, url + "/Draft", mine), "page");
        var picture = await AppUploadAsync(host, mine, Code, "technologies", 0, "technology_picture");
        var draft = (int)Assert.Single(_apps)["Id"]!;

        // The other unit sees no application of Me's, cannot save into it (a ZED ID in the body changes nothing) nor open its files.
        var other = await host.TokenAsync(Other);
        var page = await AppJson(await host.SendAsync(HttpMethod.Get, url, other), "page");
        Assert.Equal(JsonValueKind.Null, page.GetProperty("application").ValueKind);
        Assert.Equal("Please start the application first.", await AppRefusal(await host.SendAsync(HttpMethod.Post, url + "/Item", other,
            JsonContent.Create(new { zedId = Me, userName = Me, section = "technologies", index = 0, pick = "T1", values = new { manufacturer = "X" } }))));
        Assert.Equal("Please start the application first.", await AppRefusal(await host.SendAsync(HttpMethod.Post, url + "/RemoveItem", other,
            JsonContent.Create(new { zedId = Me, section = "technologies", index = 0 }))));
        Assert.Equal(HttpStatusCode.NotFound, (await host.SendAsync(HttpMethod.Get, $"{url}/File?name={picture}", other)).StatusCode);
        var submit = await AppRefusal(await host.SendAsync(HttpMethod.Post, url + "/Submit", other,
            JsonContent.Create(new { zedId = Me, cheque = Array.Empty<string>(), unitConfirmed = true, declaration = true })));
        Assert.Equal("Please fill in the application first.", submit);
        Assert.DoesNotContain("\"X\"", (string?)Find(draft)["FormAnswers"] ?? "");
        Assert.Empty(_submits);

        // Its own draft is its own row.
        await AppJson(await host.SendAsync(HttpMethod.Post, url + "/Draft", other), "page");
        Assert.Equal([Me, Other], _apps.Select(a => (string?)a["ZedId"]).Order());
    }
}
