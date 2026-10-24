using System.Net.Http.Json;
using System.Text.Json;

namespace Zed.Surveillance.Api.Tests;

/// <summary>User Management on the Surveillance host: the Admin's login types and the screens owners can give sub-users.</summary>
public sealed class UserManagementTests : IDisposable
{
    private readonly AssessmentStaff _staff = new();

    public void Dispose() => _staff.Dispose();

    private static IEnumerable<string> Strings(JsonElement list, string property) => list.EnumerateArray().Select(e => e.GetProperty(property).GetString()!);

    [Fact]
    public async Task Admin_creates_the_login_types_of_this_system()
    {
        var admin = await _staff.SignInAsync("ADMIN1", 1);
        var body = await admin.GetFromJsonAsync<JsonElement>("/api/staff/accounts");
        Assert.Equal(["Master Admin", "Ministry", "Dashboard - Super Admin", "Dashboard - Citizen Feedback", "Dashboard - QC"], Strings(body.GetProperty("types"), "label"));
    }

    [Fact]
    public async Task Owners_give_the_screens_of_their_own_menu()
    {
        var agency = await _staff.SignInAsync("AGENCY1", 2, "DesktopVerification", "SiteVerification", "FinancialVerification");
        var a = await agency.GetFromJsonAsync<JsonElement>("/api/staff/sub-users");
        Assert.Equal(["monitoring", "assessors", "da-allotment", "sa-allotment", "results", "reports"], Strings(a.GetProperty("permissions"), "key"));
        var master = await _staff.SignInAsync("MASTER1", 7);
        var m = await master.GetFromJsonAsync<JsonElement>("/api/staff/sub-users");
        Assert.Equal(["users", "payments", "allot", "monitoring", "results", "password-reset"], Strings(m.GetProperty("permissions"), "key"));
    }
}
