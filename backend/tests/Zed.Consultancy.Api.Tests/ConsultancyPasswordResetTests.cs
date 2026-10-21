using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Zed.Core.Security;
using Zed.Main.Api.Tests;
using Zed.TestSupport;

namespace Zed.Consultancy.Api.Tests;

/// <summary>Consultancy keeps its own staff accounts (ZED_CONSULTANT.Users): they are reset on this portal.</summary>
public sealed partial class ConsultancyPasswordResetTests : IDisposable
{
    private const string Consultant = "ZEDCC1019";
    private readonly TestHost _host = new();
    private readonly FakeStaffResets _resets;
    private readonly FakePasswords _passwords;

    public ConsultancyPasswordResetTests()
    {
        _resets = new FakeStaffResets().Attach(_host.Sql.Procs);
        _passwords = new FakePasswords().Attach(_host.Sql.Procs);
        _resets.Add(Consultant, 3, "consultant@zed.test");
    }

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task A_consultant_resets_on_the_consultancy_portal()
    {
        var app = _host.WithTestSignIn();
        var client = await StaffTestSignIn.BrowserAsync(app, null, 0);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/staff/auth/password-reset/request", new { userId = Consultant })).StatusCode);
        for (var i = 0; i < 100 && _host.Email.Sent.IsEmpty; i++) await Task.Delay(50);
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Contains("http://localhost:4201/reset-password#token=", mail.HtmlBody);
        var token = TokenPattern().Match(mail.HtmlBody).Groups[1].Value;

        var r = await client.PostAsJsonAsync("/api/staff/auth/password-reset/reset", new { token, newPassword = "New#Pass123", confirmPassword = "New#Pass123" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.True(_passwords.HashMatches(Consultant, "New#Pass123"));

        var master = await StaffTestSignIn.BrowserAsync(app, "MASTER1", (int)UserRole.MasterAdmin);
        Assert.Equal(HttpStatusCode.OK, (await master.PostAsync($"/api/staff/password-reset/{Consultant}", null)).StatusCode);
        Assert.Equal(2, _host.Email.Sent.Count(m => m.Subject.StartsWith("ZED Password Reset", StringComparison.Ordinal)));
    }

    [GeneratedRegex("reset-password#token=([A-Za-z0-9_-]{43})")] private static partial Regex TokenPattern();
}
