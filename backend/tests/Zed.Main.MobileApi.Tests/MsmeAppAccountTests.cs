using System.Data;
using System.Data.Common;
using System.Net;
using System.Net.Http.Headers;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Dapper;
using SkiaSharp;
using Zed.Core.Mobile;

namespace Zed.Main.MobileApi.Tests;

/// <summary>Shared set-up for the MSME app action tests: a fresh host, request helpers and stage rows.</summary>
public abstract class MsmeAppTestBase : IDisposable
{
    protected const string ZedId = "ZEDMSME000001";
    protected readonly MobileTestHost Host = new();
    private HttpClient? _client;

    protected HttpClient Client => _client ??= Host.CreateClient();

    public void Dispose()
    {
        Host.Dispose();
        GC.SuppressFinalize(this);
    }

    protected static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    protected async Task<JsonElement> Post(string url, HttpContent content)
    {
        var r = await Client.PostAsync(url, content);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
    }

    protected static void AssertFail(JsonElement e, string message)
    {
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Equal(message, e.GetProperty("errorMessage").GetString());
    }

    protected static void AssertOk(JsonElement e)
    {
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, e.GetProperty("errorMessage").ValueKind);
    }

    /// <summary>SP_APP_MSME_STATUS row for one level.</summary>
    protected void Stage(string level, int status, int ncCount = 0, int ncStatus = 0)
    {
        var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
        {
            ["BronzeStatus"] = 0, ["SilverStatus"] = 0, ["GoldStatus"] = 0,
            [level + "Status"] = status,
            [level + "StatusOfNc"] = ncCount,
        };
        if (ncCount is >= 1 and <= 5) row[$"{level}StatusOfNc{ncCount}"] = ncStatus;
        Host.Sql.Procs["SP_APP_MSME_STATUS"] = _ => FakeSql.Sets([row]);
    }

    protected IReadOnlyList<(string Name, object? Args)> CallsTo(string name) =>
        Host.Sql.Calls.Where(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase)).ToList();

    protected object? Args(string name) => Assert.Single(CallsTo(name)).Args;

    /// <summary>The DataTable behind a table-valued parameter, or null when the parameter was left out.</summary>
    protected static DataTable? Tvp(object? args, string name)
    {
        var dp = Assert.IsType<DynamicParameters>(args);
        if (!dp.ParameterNames.Contains(name)) return null;
        var tvp = dp.Get<object>(name);
        return tvp.GetType().GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)
            .Select(f => f.GetValue(tvp)).OfType<DataTable>().Single();
    }

    protected string StoragePath(params string[] parts) => Path.Combine([Host.StorageRoot, .. parts]);

    /// <summary>No file or folder with this name next to or above the storage root (where a ../ name would land).</summary>
    protected void AssertNothingOutside(string name)
    {
        for (var dir = Path.GetDirectoryName(Host.StorageRoot); dir is not null; dir = Path.GetDirectoryName(dir))
        {
            Assert.False(File.Exists(Path.Combine(dir, name)), $"{name} written to {dir}");
            Assert.False(Directory.Exists(Path.Combine(dir, name)), $"{name} created in {dir}");
            if (Path.GetPathRoot(dir) == dir) break;
        }
    }

    protected static byte[] Png()
    {
        using var bmp = new SKBitmap(2, 2);
        bmp.Erase(SKColors.Teal);
        using var image = SKImage.FromBitmap(bmp);
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }

    protected static string PngBase64 => Convert.ToBase64String(Png());

    protected static ByteArrayContent FilePart(byte[] bytes, string contentType = "image/png")
    {
        var c = new ByteArrayContent(bytes);
        c.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        return c;
    }

    protected static bool IsPdf(string path) => File.Exists(path) && Encoding.ASCII.GetString(File.ReadAllBytes(path).AsSpan(0, 4)) == "%PDF";
}

/// <summary>A database error as the procedures raise it on purpose (marker written into a bit column).</summary>
public sealed class MsmeAppDbException(string message) : DbException(message);

public sealed class MsmeAppAccountTests : MsmeAppTestBase
{
    private const string OldPassword = "Old#Pass1";
    private const string NewPassword = "New#Pass12";

    private void UserRow(int roleId = 5) =>
        Host.Sql.Procs["SP_GET_USER_DETAILS_BY_USER_ID"] = _ => FakeSql.Sets(
            [new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
            {
                ["UserId"] = ZedId, ["Password"] = OldPassword, ["RoleId"] = roleId, ["Email"] = "unit@example.com", ["UserName"] = "Acme Pvt Ltd",
            }]);

    private Task<JsonElement> ChangePassword(string oldPassword, string newPassword) =>
        Post("/Msme/ChangePassword", Json($$"""{"userName":"{{ZedId}}","oldPassword":"{{oldPassword}}","newPassword":"{{newPassword}}"}"""));

    [Fact]
    public async Task ChangePassword_updates_the_password_and_mails_a_notice_without_any_password()
    {
        UserRow();
        var e = await ChangePassword(OldPassword, NewPassword);
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal("", e.GetProperty("errorMessage").GetString());

        var update = Assert.Single(Host.Sql.Calls, c => c.Name.StartsWith("UPDATE Users SET Password", StringComparison.Ordinal));
        Assert.Equal(NewPassword, FakeSql.Arg(update.Args, "NewPassword"));
        Assert.Equal(ZedId, FakeSql.Arg(update.Args, "UserId"));

        var mail = Assert.Single(Host.Email.Sent);
        Assert.Equal("unit@example.com", mail.To);
        Assert.Equal("New Login Details - " + ZedId, mail.Subject);
        Assert.Contains("Acme Pvt Ltd", mail.HtmlBody);
        Assert.DoesNotContain(NewPassword, mail.HtmlBody);
        Assert.DoesNotContain(OldPassword, mail.HtmlBody);
    }

    [Fact]
    public async Task ChangePassword_refuses_a_wrong_old_password_a_master_password_and_other_roles()
    {
        UserRow();
        AssertFail(await ChangePassword("wrong", NewPassword), "Invalid Old Password.");
        // The user row comes back for any password; a procedure-style master password does not match it.
        AssertFail(await ChangePassword("MASTER#123", NewPassword), "Invalid Old Password.");
        UserRow(roleId: 3);
        AssertFail(await ChangePassword(OldPassword, NewPassword), "Invalid Old Password.");
        Assert.DoesNotContain(Host.Sql.Calls, c => c.Name.StartsWith("UPDATE", StringComparison.Ordinal));
        Assert.Empty(Host.Email.Sent);
    }

    [Fact]
    public async Task ChangePassword_applies_the_password_policy()
    {
        UserRow();
        var e = await ChangePassword(OldPassword, "weak");
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Contains("8 to 50 characters", e.GetProperty("errorMessage").GetString());
        Assert.DoesNotContain(Host.Sql.Calls, c => c.Name.StartsWith("UPDATE", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ChangePassword_locks_after_five_wrong_old_passwords()
    {
        UserRow();
        for (var i = 0; i < 5; i++) await ChangePassword("wrong", NewPassword);
        var e = await ChangePassword(OldPassword, NewPassword);
        Assert.Contains("Too many failed attempts", e.GetProperty("errorMessage").GetString());
    }

    private Zed.TestSupport.FakeStaffResets ResetProcs()
    {
        var resets = new Zed.TestSupport.FakeStaffResets().Attach(Host.Sql.Procs);
        resets.Users[ZedId] = new Zed.TestSupport.FakeStaffResets.User(ZedId, 5, true, "pledge@example.com", "Acme Pvt Ltd");
        return resets;
    }

    private Task<JsonElement> Reset(string user) =>
        Post("/Msme/ResetPassword", new FormUrlEncodedContent(new Dictionary<string, string> { ["userName"] = user }));

    private static async Task Eventually(Func<bool> condition)
    {
        for (var i = 0; i < 100 && !condition(); i++) await Task.Delay(50);
        Assert.True(condition(), "condition not met within 5 seconds");
    }

    [Fact]
    public async Task ResetPassword_mails_a_portal_link_with_a_hashed_single_use_token()
    {
        Host.Settings["Portal:PublicBaseUrl"] = "https://portal.example.test/";
        var resets = ResetProcs();
        var e = await Reset(ZedId);
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal("A Reset link has been sent your Registered Email ID.", e.GetProperty("errorMessage").GetString());

        await Eventually(() => Host.Email.Sent.Count == 1);
        var mail = Assert.Single(Host.Email.Sent);
        Assert.Equal("pledge@example.com", mail.To);
        Assert.Equal("MSME Reset Password Details - " + ZedId, mail.Subject);
        var token = System.Text.RegularExpressions.Regex.Match(mail.HtmlBody, "msme/reset-password#token=([A-Za-z0-9_-]{43})").Groups[1].Value;
        Assert.Equal(43, token.Length);
        Assert.Contains("60 minutes", mail.HtmlBody);
        // Only the hash is stored; the legacy clear-text procedures are not used.
        var row = Assert.Single(resets.Rows);
        Assert.Equal(Zed.Core.Security.PasswordResetTokens.Hash(token), row.TokenHash);
        Assert.Empty(CallsTo("SP_MSME_PWD_UPDATE_TOKEN"));
    }

    [Fact]
    public async Task ResetPassword_answers_the_same_for_unknown_and_inactive_zed_ids()
    {
        var resets = ResetProcs();
        resets.Users["ZEDMSME000002"] = new Zed.TestSupport.FakeStaffResets.User("ZEDMSME000002", 5, false, "x@example.com", "Blocked Unit");
        foreach (var id in new[] { "ZEDMSME999999", "ZEDMSME000002" })
        {
            var e = await Reset(id);
            Assert.Equal("1", e.GetProperty("status").GetString());
            Assert.Equal("A Reset link has been sent your Registered Email ID.", e.GetProperty("errorMessage").GetString());
        }
        await Eventually(() => CallsTo("SP_V4_MSME_RESET_ACCOUNT").Count == 2);
        await Task.Delay(200);
        Assert.Empty(resets.Rows);
        Assert.Empty(Host.Email.Sent);
    }

    [Fact]
    public async Task ResetPassword_is_limited_per_user_name_and_per_hour_in_the_database()
    {
        var resets = ResetProcs();
        for (var i = 0; i < 5; i++) Assert.Equal("1", (await Reset(ZedId)).GetProperty("status").GetString());
        var throttled = await Reset(ZedId);
        Assert.Equal("0", throttled.GetProperty("status").GetString());
        Assert.Contains("15 minutes", throttled.GetProperty("errorMessage").GetString());

        // Five requests reached the background; the database allows three links an hour.
        await Eventually(() => CallsTo("SP_V4_STAFF_RESET_CREATE").Count == 5);
        await Eventually(() => Host.Email.Sent.Count == 3);
        await Task.Delay(200);
        Assert.Equal(3, Host.Email.Sent.Count);
        Assert.Equal(3, resets.Rows.Count);
    }

    [Fact]
    public async Task GetMsmeStatus_returns_the_button_states_with_remote_and_surveillance_fields()
    {
        Host.Sql.Procs["SP_APP_MSME_STATUS"] = _ => FakeSql.Sets([new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
        {
            ["BronzeStatus"] = 3, ["SilverStatus"] = 2, ["GoldStatus"] = 0, ["SilverStatusOfNc"] = 1, ["SilverStatusOfNc1"] = 1,
            ["SilverRemoteStatus"] = 1, ["SilverSurveillanceStatus"] = 2, ["SilverSurveillanceDate"] = "10/20/2026 10:00:00 AM",
            ["Nc1StatusTextSilver"] = "NC 1 raised", ["LatestCertification"] = "Bronze", ["IsCouponUsed"] = true, ["FinancialAssistanceStatus"] = 1,
        }]);
        var e = await Post("/Msme/GetMsmeStatus", Json($$"""{"userName":"{{ZedId}}","version":"1.0.0"}"""));
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal(3, e.GetProperty("BronzeStatus").GetInt32());
        var silver = e.GetProperty("silver");
        Assert.Equal(2, silver.GetProperty("status").GetInt32());
        Assert.Equal(1, silver.GetProperty("nc1Status").GetInt32());
        Assert.Equal("NC 1 raised", silver.GetProperty("nc1StatusText").GetString());
        Assert.Equal("1", silver.GetProperty("remoteStatus").GetString());
        Assert.Equal("2", silver.GetProperty("surveillanceStatus").GetString());
        Assert.Equal("10/20/2026 10:00:00 AM", silver.GetProperty("surveillanceDate").GetString());
        Assert.Equal("Bronze", e.GetProperty("latestCertification").GetString());
        Assert.True(e.GetProperty("isCouponUsed").GetBoolean());
        Assert.Equal(1, e.GetProperty("financialAssistanceStatus").GetInt32());
    }

    [Fact]
    public async Task GetMsmeStatus_says_invalid_ZED_ID_when_the_unit_does_not_exist()
    {
        Host.Sql.Procs["SP_APP_MSME_STATUS"] = _ => FakeSql.Sets([new Dictionary<string, object?> { ["BronzeStatus"] = DBNull.Value }]);
        AssertFail(await Post("/Msme/GetMsmeStatus", Json("""{"userName":"ZEDMSME999999"}""")), "Invalid ZED ID.");
    }

    [Fact]
    public async Task GetMyDocuments_returns_the_named_tables_as_text()
    {
        Host.Sql.Procs["SP_MSME_GET_MY_DOCUMENTS"] = _ => FakeSql.Sets(
            [new { ZedId, DocumentName = "Guideline", DocumentPath = "https://x/g.pdf", OrderNo = 1 }],
            [new { ZedId, Pledge = "https://x/Pledge.pdf", Bronze = (string?)null }],
            [new { ZedId, BronzeReceipt = "https://x/r.pdf" }],
            [new Dictionary<string, object?> { ["TadaInvoiceNo"] = "INV1", ["Password"] = "secret" }]);
        var r = await Client.PostAsync("/Msme/GetMyDocuments", Json($$"""{"zedId":"{{ZedId}}"}"""));
        Assert.Equal("text/html", r.Content.Headers.ContentType!.MediaType);
        var e = JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("Guideline", e.GetProperty("Guidelines")[0].GetProperty("DocumentName").GetString());
        Assert.Equal(JsonValueKind.Null, e.GetProperty("Certificates")[0].GetProperty("Bronze").ValueKind);
        Assert.Equal("https://x/r.pdf", e.GetProperty("PaymentReceipts")[0].GetProperty("BronzeReceipt").GetString());
        Assert.Equal("INV1", e.GetProperty("Table3")[0].GetProperty("TadaInvoiceNo").GetString());
        Assert.False(e.GetProperty("Table3")[0].TryGetProperty("Password", out _));
    }
    [Fact]
    public async Task ChangePassword_records_the_hash_and_after_the_old_sites_stores_a_random_value()
    {
        var passwords = new global::Zed.TestSupport.FakePasswords().Attach(Host.Sql.Procs);
        UserRow();
        Assert.Equal("1", (await ChangePassword(OldPassword, NewPassword)).GetProperty("status").GetString());
        Assert.True(passwords.HashMatches(ZedId, NewPassword));
        Assert.Equal(NewPassword, FakeSql.Arg(Host.Sql.Calls.Last(c => c.Name.StartsWith("UPDATE Users SET Password", StringComparison.Ordinal)).Args, "NewPassword"));

        // HashOnly: the old password is checked against the hash (the row now holds a random value).
        global::Zed.TestSupport.FakePasswords.SetMode(Host.Services, global::Zed.Core.Security.PasswordMode.HashOnly);
        Host.Sql.Procs["SP_GET_USER_DETAILS_BY_USER_ID"] = _ => FakeSql.Sets(
            [new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
            {
                ["UserId"] = ZedId, ["Password"] = global::Zed.Core.Security.PasswordStore.NewReplacement(), ["RoleId"] = 5, ["Email"] = "unit@example.com", ["UserName"] = "Acme Pvt Ltd",
            }]);
        AssertFail(await ChangePassword(OldPassword, "Third#Pass3"), "Invalid Old Password.");
        Assert.Equal("1", (await ChangePassword(NewPassword, "Third#Pass3")).GetProperty("status").GetString());
        Assert.True(global::Zed.Core.Security.PasswordStore.IsReplacement(FakeSql.Arg(Host.Sql.Calls.Last(c => c.Name.StartsWith("UPDATE Users SET Password", StringComparison.Ordinal)).Args, "NewPassword")));
        Assert.True(passwords.HashMatches(ZedId, "Third#Pass3"));
    }
}
