using System.Net;
using System.Net.Http.Json;
using Zed.Core.Mobile;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Main.Api.Tests.Staff;

public sealed class AssessorMobileTests : IDisposable
{
    private const string Url = "/api/staff/assessor-mobile/ZEDAS0009";
    private readonly TestHost _host = new();
    private bool _registered = true;

    public AssessorMobileTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Queries[AssessorMobileController.AssessorSql] = args => [Arg(args, "UserId") == "ZEDAS0009" ? 1 : 0];
        _host.Sql.Queries[SqlDeviceBindings.RegisteredSql] = _ => _registered
            ? [new { DeviceId = "phone-1", Model = "Samsung SM-A515F", OsVersion = "13", FirstSeenAt = new DateTime(2026, 10, 12), LastLoginAt = new DateTime(2026, 11, 3, 9, 12, 0), LastIp = "49.36.1.2" }]
            : [];
        _host.Sql.Queries[AssessorMobileController.SignInsSql] = _ =>
        [
            new { At = new DateTime(2026, 11, 3, 3, 42, 0), Result = "Success", DeviceId = "phone-1", DeviceModel = "Samsung SM-A515F", OsVersion = "13", AppVersion = "2.0", IpAddress = "49.36.1.2" },
            new { At = new DateTime(2026, 11, 2, 13, 10, 0), Result = "Failed", Reason = "Your account is registered on another mobile (Samsung SM-A515F).", DeviceId = "phone-2", DeviceModel = "Xiaomi 2201117TI", AppVersion = "2.0", IpAddress = "106.20.1.1" },
        ];
    }

    public void Dispose() => _host.Dispose();

    private static string? Arg(object? args, string name) => args?.GetType().GetProperty(name)?.GetValue(args)?.ToString();

    [Fact]
    public async Task Only_the_admin_sees_and_releases_the_phone()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await (await _host.CreateBrowserAsync()).GetAsync(Url)).StatusCode);
        foreach (var user in new[] { "AGENCY1", "SUPER1" })
        {
            var other = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync(Url)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.DeleteAsync(Url)).StatusCode);
        }
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == SqlDeviceBindings.ReleaseSql);
    }

    [Fact]
    public async Task Shows_the_registered_phone_and_the_recent_sign_ins_and_releases_it()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = (await admin.GetFromJsonAsync<AssessorMobileController.MobileResponse>(Url))!;
        Assert.Equal("phone-1", r.Device!.DeviceId);
        Assert.Equal("Samsung SM-A515F", r.Device.Model);
        Assert.Equal(2, r.SignIns.Count);
        Assert.Equal("Failed", r.SignIns[1].Result);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/staff/assessor-mobile/ZEDAS0001")).StatusCode);

        var released = await admin.DeleteAsync(Url);
        released.EnsureSuccessStatusCode();
        var call = Assert.Single(_host.Sql.Calls, c => c.Name == SqlDeviceBindings.ReleaseSql);
        Assert.Equal("ZEDAS0009", Arg(call.Args, "User"));
        Assert.Equal(MobileApps.SiteAssessor, Arg(call.Args, "App"));

        _registered = false;
        Assert.Equal("No mobile is registered for this assessor.", await (await admin.DeleteAsync(Url)).ProblemTitle());
    }
}
