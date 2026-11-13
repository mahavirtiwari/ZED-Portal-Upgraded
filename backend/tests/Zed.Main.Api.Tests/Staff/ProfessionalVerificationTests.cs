using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Data;
using Zed.Core.Payments;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Settings → Professional Verification and the Add Assessor form in each mode (2026-11-13).</summary>
public sealed class ProfessionalVerificationTests : IDisposable
{
    private const string SettingsQuery = "SELECT SettingKey, SettingValue FROM dbo.V4Settings";
    private const string Url = "/api/staff/settings/professional-verification";
    private readonly TestHost _host = new();

    public ProfessionalVerificationTests()
    {
        UsersMastersLogin.Setup(_host);
        new Zed.TestSupport.FakeStaffResets().Attach(_host.Sql.Procs);
        _host.Sql.Procs["SP_MASTER_GET_SECTORS"] = _ => FakeSql.Sets([new { Id = 1, SectorCode = "24", SectorName = "Basic metals" }]);
        _host.Sql.Procs["SP_MASTER_GET_AREA_OF_KNOWLEDGE"] = _ => FakeSql.Sets([new { AreaOfknowledge = "Quality" }]);
        _host.Sql.Procs["SP_INSERT_USER"] = _ => FakeSql.Sets([new Dictionary<string, object?> { [""] = "ZEDBA0099" }]);
        _host.Sql.Procs[StaffUserRules.ProfessionalProcedure] = args =>
            FakeSql.Arg(args, "CertificationNo") == "BA1234" && FakeSql.Arg(args, "EmailId") == "pro@zed.test"
                ? FakeSql.Sets([new { Email = "pro@zed.test", ContactNumber = "9111111111", Name = "Training Pro", CertificateNo = "{}" }],
                    [new { Status = 1, ErrorMessage = "Details Fetched Successfully" }])
                : FakeSql.Sets([], [new { Status = 0, ErrorMessage = "Invalid details." }]);
    }

    public void Dispose() => _host.Dispose();

    /// <summary>dbo.V4Settings with the verification mode (and other rows, such as the API's).</summary>
    public static void UseMode(TestHost host, string mode, params (string Key, string Value)[] more) =>
        host.Sql.Queries[SettingsQuery] = _ =>
            new[] { (Key: ProfessionalVerification.ModeKey, Value: mode) }.Concat(more).Select(r => new { SettingKey = r.Key, SettingValue = r.Value }).ToList();

    private void UseApi(string method = "POST", string? successField = "status") => UseMode(_host, "Api",
        (ProfessionalVerification.UrlKey, "https://pro.example.test/verify"), (ProfessionalVerification.MethodKey, method),
        (ProfessionalVerification.KeyHeaderKey, "x-api-key"), (ProfessionalVerification.KeyKey, SettingSecret.Protect("the-secret-key")),
        (ProfessionalVerification.NameFieldKey, "data.fullName"), (ProfessionalVerification.EmailFieldKey, "data.email"),
        (ProfessionalVerification.MobileFieldKey, "data.phone"),
        (ProfessionalVerification.SuccessFieldKey, successField ?? ""));

    private static HttpResponseMessage Json(object body, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = JsonContent.Create(body) };

    private static Dictionary<string, object?> Body(Dictionary<string, object?>? extra = null)
    {
        var body = new Dictionary<string, object?>
        {
            ["assessorType"] = "BronzeAssessor", ["certificateNo"] = "BA1234", ["pan"] = "abcde1234f", ["userName"] = "Typed Pro",
            ["emailId"] = "typed@zed.test", ["mobileNo"] = "9222222222", ["address"] = "12 Main Rd", ["pinCode"] = "411001",
            ["idProofType"] = "Aadhaar Card", ["idProofNumber"] = "123412341234", ["states"] = new[] { "MAHARASHTRA" },
            ["nicSectors"] = new[] { "24" }, ["areasOfKnowledge"] = new[] { "Quality" }, ["sectorActivity"] = "Both",
        };
        foreach (var (k, v) in extra ?? []) body[k] = v;
        return body;
    }

    private (string Name, object? Args) Call(string name) => _host.Sql.Calls.Last(c => c.Name == name);

    private IEnumerable<(string Name, object? Args)> Merges() => _host.Sql.Calls.Where(c => c.Name.StartsWith("MERGE dbo.V4Settings", StringComparison.Ordinal));

    private string? Saved(string key) => FakeSql.Arg(Merges().LastOrDefault(c => FakeSql.Arg(c.Args, "SettingKey") == key).Args, "SettingValue");

    // ---- the Add form, verification off (the default) ---------------------------------------

    [Fact]
    public async Task The_agency_list_shows_the_pan()
    {
        _host.Sql.Procs["SP_GET_USERS_BY_ROLE"] = _ => FakeSql.Sets([
            new { Id = 1, UserId = "ZEDBA0099", UserName = "Typed Pro", IsActive = true, IdStatus = "Active", IsCertAttached = 0 },
            new { Id = 2, UserId = "ZEDBA0100", UserName = "Old Pro", IsActive = true, IdStatus = "Active", IsCertAttached = 0 }]);
        _host.Sql.Queries[ProfessionalVerification.PansSql] = _ => [new { UserId = "ZEDBA0099 ", PanNo = "ABCDE1234F" }];
        var client = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");

        var rows = await client.GetFromJsonAsync<JsonElement>("/api/staff/users/assessors/mine");
        Assert.Equal("ABCDE1234F", rows[0].GetProperty("PanNo").GetString());
        Assert.Equal(JsonValueKind.Null, rows[1].GetProperty("PanNo").ValueKind);
    }

    [Fact]
    public async Task By_default_verification_is_off_and_the_agency_creates_with_the_typed_details_and_pan()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var options = await client.GetFromJsonAsync<JsonElement>("/api/staff/users/assessors/options");
        Assert.Equal("Off", options.GetProperty("verification").GetProperty("mode").GetString());
        Assert.True(options.GetProperty("verification").GetProperty("needsPan").GetBoolean());
        var lookup = await client.PostAsJsonAsync("/api/staff/users/assessors/lookup", new { assessorType = "BronzeAssessor", certificateNo = "BA1234", email = "pro@zed.test" });
        Assert.Equal(ProfessionalVerification.OffLookupMessage, await lookup.ProblemTitle());

        var r = await client.PostAsJsonAsync("/api/staff/users/assessors", Body());
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var insert = Call("SP_INSERT_USER");
        Assert.Equal("Typed Pro", FakeSql.Arg(insert.Args, "UserName"));
        Assert.Equal("typed@zed.test", FakeSql.Arg(insert.Args, "Email"));
        Assert.Equal("9222222222", FakeSql.Arg(insert.Args, "MobileNo"));
        Assert.Equal("BA1234", FakeSql.Arg(insert.Args, "CertificateNo"));
        Assert.Equal("typed@zed.test", FakeSql.Arg(insert.Args, "ProfessionalEmail"));
        Assert.Equal("AGENCY1", FakeSql.Arg(insert.Args, "CreatedBy"));
        Assert.Equal("BA1234", FakeSql.Arg(Call(ProfessionalVerification.CertificateInUseSql).Args, "CertificateNo"));
        var pan = Call(ProfessionalVerification.SavePanSql);
        Assert.Equal(("ZEDBA0099", "ABCDE1234F"), (FakeSql.Arg(pan.Args, "UserId"), FakeSql.Arg(pan.Args, "Pan")));
        // Main: the same PAN on the assessor's copy in ZED_SURVEILLANCE (SP_INSERT_USER writes that row too).
        var copy = Call(ProfessionalVerification.SaveSurveillancePanSql);
        Assert.Equal(("ZEDBA0099", "ABCDE1234F"), (FakeSql.Arg(copy.Args, "UserId"), FakeSql.Arg(copy.Args, "Pan")));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == StaffUserRules.ProfessionalProcedure);
        Assert.Equal("typed@zed.test", Assert.Single(_host.Email.Sent).To);
    }

    [Theory]
    [InlineData("pan", null, "Please enter a valid PAN (e.g. ABCDE1234F).")]
    [InlineData("pan", "ABCD1234F", "Please enter a valid PAN (e.g. ABCDE1234F).")]
    [InlineData("pan", "ABCDE12345", "Please enter a valid PAN (e.g. ABCDE1234F).")]
    [InlineData("userName", "", "Please enter the name (up to 100 characters).")]
    [InlineData("emailId", "not-a-mail", "Please enter a valid Email ID.")]
    [InlineData("mobileNo", "12345", "Please enter a valid 10 digit mobile number.")]
    [InlineData("certificateNo", "", "Please enter a valid Certificate Number.")]
    public async Task With_verification_off_the_pan_and_typed_details_are_required(string field, string? value, string message)
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var r = await client.PostAsJsonAsync("/api/staff/users/assessors", Body(new() { [field] = value }));
        Assert.Equal(message, await r.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_INSERT_USER");
    }

    [Fact]
    public async Task A_certificate_used_by_an_active_assessor_is_refused()
    {
        _host.Sql.Queries[ProfessionalVerification.CertificateInUseSql] = args => FakeSql.Arg(args, "CertificateNo") == "BA1234" ? [1] : [0];
        var client = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var r = await client.PostAsJsonAsync("/api/staff/users/assessors", Body());
        Assert.Equal(ProfessionalVerification.AlreadyMapped, await r.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_INSERT_USER");
        Assert.Empty(_host.Email.Sent);
    }

    // ---- training portal: as before ---------------------------------------------------------

    [Fact]
    public async Task The_training_portal_mode_still_uses_the_procedure_and_keeps_a_given_pan()
    {
        UseMode(_host, "TrainingPortal");
        var client = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var options = await client.GetFromJsonAsync<JsonElement>("/api/staff/users/assessors/options");
        Assert.Equal("TrainingPortal", options.GetProperty("verification").GetProperty("mode").GetString());
        Assert.False(options.GetProperty("verification").GetProperty("needsPan").GetBoolean());

        // No PAN on the training portal's form: none is written.
        var r = await client.PostAsJsonAsync("/api/staff/users/assessors", Body(new() { ["pan"] = null, ["professionalEmail"] = "pro@zed.test" }));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("Training Pro", FakeSql.Arg(Call("SP_INSERT_USER").Args, "UserName"));
        Assert.Equal("BA1234", FakeSql.Arg(Call(StaffUserRules.ProfessionalProcedure).Args, "CertificationNo"));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == ProfessionalVerification.SavePanSql);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == ProfessionalVerification.CertificateInUseSql);

        r = await client.PostAsJsonAsync("/api/staff/users/assessors", Body(new() { ["professionalEmail"] = "pro@zed.test" }));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("ABCDE1234F", FakeSql.Arg(Call(ProfessionalVerification.SavePanSql).Args, "Pan"));

        var bad = await client.PostAsJsonAsync("/api/staff/users/assessors", Body(new() { ["professionalEmail"] = "other@zed.test" }));
        Assert.Equal("Invalid details.", await bad.ProblemTitle());
    }

    // ---- another portal's API ---------------------------------------------------------------

    [Fact]
    public async Task The_api_mode_calls_the_other_portal_with_the_key_and_maps_its_answer()
    {
        UseApi();
        _host.ProfessionalApi.Respond = _ => Json(new { status = "success", data = new { fullName = "Api Pro", email = "api@zed.test", phone = "+91 93333 33333" } });
        var client = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var options = await client.GetFromJsonAsync<JsonElement>("/api/staff/users/assessors/options");
        Assert.Equal("Api", options.GetProperty("verification").GetProperty("mode").GetString());

        var noPan = await client.PostAsJsonAsync("/api/staff/users/assessors/lookup", new { assessorType = "BronzeAssessor", certificateNo = "BA1234" });
        Assert.Equal("Please enter a valid PAN (e.g. ABCDE1234F).", await noPan.ProblemTitle());
        var lookup = await client.PostAsJsonAsync("/api/staff/users/assessors/lookup", new { assessorType = "BronzeAssessor", certificateNo = "BA1234", pan = "abcde1234f" });
        Assert.Equal(HttpStatusCode.OK, lookup.StatusCode);
        var p = await lookup.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(("Api Pro", "api@zed.test", "9333333333"), (p.GetProperty("name").GetString(), p.GetProperty("email").GetString(), p.GetProperty("mobileNo").GetString()));
        var sent = Assert.Single(_host.ProfessionalApi.Requests);
        Assert.Equal(("POST", "https://pro.example.test/verify"), (sent.Method, sent.Uri.ToString()));
        Assert.Equal("the-secret-key", sent.Headers["x-api-key"]);
        var json = JsonDocument.Parse(sent.Body!).RootElement;
        Assert.Equal(("BA1234", "ABCDE1234F"), (json.GetProperty("certificateNo").GetString(), json.GetProperty("pan").GetString()));

        // Create: the API's details, not the typed ones.
        var r = await client.PostAsJsonAsync("/api/staff/users/assessors", Body());
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var insert = Call("SP_INSERT_USER");
        Assert.Equal(("Api Pro", "api@zed.test", "9333333333"), (FakeSql.Arg(insert.Args, "UserName"), FakeSql.Arg(insert.Args, "Email"), FakeSql.Arg(insert.Args, "MobileNo")));
        Assert.Equal("api@zed.test", FakeSql.Arg(insert.Args, "ProfessionalEmail"));
        Assert.Equal("ABCDE1234F", FakeSql.Arg(Call(ProfessionalVerification.SavePanSql).Args, "Pan"));
        Assert.Equal(2, _host.ProfessionalApi.Requests.Count);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == StaffUserRules.ProfessionalProcedure);
    }

    [Fact]
    public async Task The_api_mode_sends_a_query_with_get_and_explains_what_failed()
    {
        UseApi("GET");
        _host.ProfessionalApi.Respond = _ => new HttpResponseMessage(HttpStatusCode.NotFound);
        var client = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var r = await client.PostAsJsonAsync("/api/staff/users/assessors/lookup", new { assessorType = "BronzeAssessor", certificateNo = "BA1234", pan = "ABCDE1234F" });
        Assert.Equal("No certified professional was found for this certificate number and PAN.", await r.ProblemTitle());
        var sent = Assert.Single(_host.ProfessionalApi.Requests);
        Assert.Equal("GET", sent.Method);
        Assert.Equal("?certificateNo=BA1234&pan=ABCDE1234F", sent.Uri.Query);

        _host.ProfessionalApi.Respond = _ => Json(new { status = false, data = new { fullName = "X", email = "x@zed.test", phone = "9333333333" } });
        r = await client.PostAsJsonAsync("/api/staff/users/assessors", Body());
        Assert.Equal("The other portal did not confirm this certificate number and PAN.", await r.ProblemTitle());

        _host.ProfessionalApi.Respond = _ => Json(new { status = true, data = new { fullName = "X", email = "x@zed.test" } });
        r = await client.PostAsJsonAsync("/api/staff/users/assessors", Body());
        Assert.Equal("The other portal's answer has no valid 10 digit mobile number for this professional.", await r.ProblemTitle());

        _host.ProfessionalApi.Respond = _ => new HttpResponseMessage(HttpStatusCode.InternalServerError);
        r = await client.PostAsJsonAsync("/api/staff/users/assessors", Body());
        Assert.StartsWith("The other portal answered with an error (HTTP 500)", await r.ProblemTitle());

        _host.Sql.Queries[ProfessionalVerification.CertificateInUseSql] = _ => [1];
        var calls = _host.ProfessionalApi.Requests.Count;
        r = await client.PostAsJsonAsync("/api/staff/users/assessors", Body());
        Assert.Equal(ProfessionalVerification.AlreadyMapped, await r.ProblemTitle());
        Assert.Equal(calls, _host.ProfessionalApi.Requests.Count);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_INSERT_USER");
    }

    // ---- the Admin's setting ----------------------------------------------------------------

    [Theory]
    [InlineData("AGENCY1")]
    [InlineData("MASTER1")]
    [InlineData("SUPER1")]
    public async Task Only_the_admin_reaches_the_setting(string user)
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(Url)).StatusCode);
        var client = await UsersMastersLogin.SignInAsync(_host, user);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(Url)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PutAsJsonAsync(Url, new { mode = "Off" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(Url + "/test", new { certificateNo = "BA1", pan = "ABCDE1234F" })).StatusCode);
        Assert.Empty(Merges());
    }

    [Fact]
    public async Task The_setting_is_off_by_default_and_never_returns_the_key()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var view = await client.GetFromJsonAsync<JsonElement>(Url);
        Assert.Equal("Off", view.GetProperty("mode").GetString());
        Assert.Equal("main", view.GetProperty("portal").GetString());
        Assert.False(view.GetProperty("api").GetProperty("keySet").GetBoolean());
        Assert.Equal("certificateNo", view.GetProperty("api").GetProperty("certificateField").GetString());

        UseApi();
        await _host.Services.GetRequiredService<IPortalSettings>().SetAsync("Test.Unused", null, "TEST"); // clears the cache
        var text = await client.GetStringAsync(Url);
        Assert.DoesNotContain("the-secret-key", text);
        Assert.DoesNotContain("dpapi1:", text);
        view = JsonDocument.Parse(text).RootElement;
        Assert.Equal("Api", view.GetProperty("mode").GetString());
        Assert.True(view.GetProperty("api").GetProperty("keySet").GetBoolean());
        Assert.True(view.GetProperty("api").GetProperty("keyReadable").GetBoolean());
        Assert.Equal("x-api-key", view.GetProperty("api").GetProperty("keyHeader").GetString());
        Assert.Equal("data.fullName", view.GetProperty("api").GetProperty("nameField").GetString());
    }

    [Fact]
    public async Task Saving_the_api_encrypts_the_key_and_a_blank_key_keeps_it()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal("Please choose how professionals are verified.", await (await client.PutAsJsonAsync(Url, new { mode = "Sometimes" })).ProblemTitle());
        Assert.Equal("The API address must be a full https:// address (up to 500 characters).",
            await (await client.PutAsJsonAsync(Url, new { mode = "Api", url = "http://pro.example.test/verify" })).ProblemTitle());
        Assert.Equal("Please enter the key for the header x-api-key.",
            await (await client.PutAsJsonAsync(Url, new { mode = "Api", url = "https://pro.example.test/verify", keyHeader = "x-api-key" })).ProblemTitle());
        Assert.StartsWith("The name field name",
            await (await client.PutAsJsonAsync(Url, new { mode = "Api", url = "https://pro.example.test/verify", nameField = "full name" })).ProblemTitle());
        Assert.Empty(Merges());

        var r = await client.PutAsJsonAsync(Url, new
        {
            mode = "Api", url = "https://pro.example.test/verify", method = "get", keyHeader = "x-api-key", key = "k-123", nameField = "data.fullName",
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("Api", Saved(ProfessionalVerification.ModeKey));
        Assert.Equal("GET", Saved(ProfessionalVerification.MethodKey));
        Assert.Equal("pan", Saved(ProfessionalVerification.PanFieldKey));
        Assert.Equal("data.fullName", Saved(ProfessionalVerification.NameFieldKey));
        var key = Saved(ProfessionalVerification.KeyKey)!;
        Assert.NotEqual("k-123", key);
        Assert.Equal("k-123", SettingSecret.Unprotect(key));

        // With a saved key, a blank key keeps it.
        UseApi();
        var keyWrites = Merges().Count(c => FakeSql.Arg(c.Args, "SettingKey") == ProfessionalVerification.KeyKey);
        r = await client.PutAsJsonAsync(Url, new { mode = "Api", url = "https://pro.example.test/verify", keyHeader = "x-api-key" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(keyWrites, Merges().Count(c => FakeSql.Arg(c.Args, "SettingKey") == ProfessionalVerification.KeyKey));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("DELETE FROM dbo.V4Settings", StringComparison.Ordinal)
            && FakeSql.Arg(c.Args, "SettingKey") == ProfessionalVerification.KeyKey);

        // Off: only the mode.
        r = await client.PutAsJsonAsync(Url, new { mode = "off" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("Off", Saved(ProfessionalVerification.ModeKey));
    }

    [Fact]
    public async Task The_test_button_calls_the_api_as_on_the_form_with_the_saved_key()
    {
        UseApi();
        _host.ProfessionalApi.Respond = _ => Json(new { ok = 1, result = new[] { new { name = "Tested Pro", email = "t@zed.test", mobile = "9444444444" } } });
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal("Please enter a valid PAN (e.g. ABCDE1234F).",
            await (await client.PostAsJsonAsync(Url + "/test", new { certificateNo = "BA1234", pan = "123" })).ProblemTitle());
        var r = await client.PostAsJsonAsync(Url + "/test", new
        {
            certificateNo = "BA1234", pan = "abcde1234f", url = "https://other.example.test/check", method = "POST", keyHeader = "x-api-key",
            certificateField = "certNo", panField = "panNo", nameField = "result.name", emailField = "result.email", mobileField = "result.mobile",
            successField = "ok",
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var t = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(t.GetProperty("ok").GetBoolean());
        Assert.Equal(("Tested Pro", "t@zed.test", "9444444444"), (t.GetProperty("name").GetString(), t.GetProperty("email").GetString(), t.GetProperty("mobileNo").GetString()));
        var sent = Assert.Single(_host.ProfessionalApi.Requests);
        Assert.Equal("https://other.example.test/check", sent.Uri.ToString());
        Assert.Equal("the-secret-key", sent.Headers["x-api-key"]);
        Assert.Equal("ABCDE1234F", JsonDocument.Parse(sent.Body!).RootElement.GetProperty("panNo").GetString());
        Assert.Empty(Merges());

        _host.ProfessionalApi.Respond = _ => new HttpResponseMessage(HttpStatusCode.NotFound);
        t = await (await client.PostAsJsonAsync(Url + "/test", new { certificateNo = "BA1234", pan = "ABCDE1234F", url = "https://other.example.test/check" }))
            .Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(t.GetProperty("ok").GetBoolean());
        Assert.Equal("No certified professional was found for this certificate number and PAN.", t.GetProperty("error").GetString());
    }
}
