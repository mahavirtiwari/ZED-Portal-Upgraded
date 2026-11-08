using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Data;

using Zed.Portal.Features.Staff.Users;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Signs test clients in as staff users through the real staff login (SP_GET_USER_DETAILS faked).</summary>
internal static class UsersMastersLogin
{
    /// <summary>User ids accepted by <see cref="Setup"/> and their Users.RoleId.</summary>
    public static readonly Dictionary<string, int> Users = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ADMIN1"] = 1, ["AGENCY1"] = 2, ["AGENCY2"] = 2, ["ASSESSOR1"] = 3, ["MASTER1"] = 7, ["SUPER1"] = 10,
    };

    public static void Setup(TestHost host)
    {
        host.Sql.Procs["SP_GET_USER_DETAILS"] = args =>
        {
            var id = FakeSql.Arg(args, "UserId") ?? "";
            return Users.TryGetValue(id, out var role)
                ? FakeSql.Sets([new { UserId = id.ToUpperInvariant(), UserName = id + " name", RoleId = role, Email = id.ToLowerInvariant() + "@zed.test" }], [new { ERRORMSG = "SUCCESS" }])
                : FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
        };
        host.Sql.Procs["SP_GET_SUB_ROLE"] = _ => FakeSql.Sets([new { DesktopVerification = 1, SiteVerification = 1, FinancialVerification = 1 }]);
    }

    public static async Task<HttpClient> SignInAsync(TestHost host, string userId)
    {
        var client = await host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    public static string? Arg(object? args, string name) => FakeSql.Arg(args, name);
}

public sealed class UsersTests : IDisposable
{
    private readonly TestHost _host = new();

    private readonly Dictionary<string, object?> Agency1 = new()
    {
        ["Id"] = 11, ["UserId"] = "ZEDAA0001", ["UserName"] = "Acme Assessors", ["RoleId"] = 2, ["CreatedBy"] = "MASTER1",
        ["IsActive"] = true, ["Email"] = "spoc@acme.test", ["MobileNo"] = "9876543210", ["SpocName"] = "A Spoc",
        ["Address"] = "Plot 1", ["Pincode"] = "110001", ["Password"] = "agencypw", ["OrgPartnerId"] = "OP1",
        ["DesktopVerification"] = true, ["SiteVerification"] = false, ["FinancialVerification"] = false,
    };

    private static Dictionary<string, object?> Assessor(string id, string createdBy, bool active, string? cert = null) => new()
    {
        ["Id"] = 21, ["UserId"] = id, ["UserName"] = id + " name", ["RoleId"] = 3, ["CreatedBy"] = createdBy, ["IsActive"] = active,
        ["Email"] = id.ToLowerInvariant() + "@zed.test", ["MobileNo"] = "9000000001", ["Address"] = "Street 1", ["Pincode"] = "560001",
        ["IdProofType"] = "Aadhaar Card", ["IdProofNumber"] = "123456789012", ["Password"] = "assessorpw", ["PwdCode"] = "resetcode",
        ["AssessorType"] = "BronzeAssessor", ["CertificateNo"] = cert,
    };

    private readonly Dictionary<string, Dictionary<string, object?>> _users;

    public UsersTests()
    {
        UsersMastersLogin.Setup(_host);
        _users = new(StringComparer.OrdinalIgnoreCase)
        {
            ["ZEDAA0001"] = Agency1,
            ["ZEDAS0001"] = Assessor("ZEDAS0001", "AGENCY1", active: true),
            ["ZEDAS0002"] = Assessor("ZEDAS0002", "AGENCY2", active: true),
            ["ZEDAS0003"] = Assessor("ZEDAS0003", "AGENCY1", active: false, cert: "BA1234"),
        };
        _host.Sql.Procs["SP_GET_USER_DETAILS_BY_USER_ID"] = args =>
            _users.TryGetValue(UsersMastersLogin.Arg(args, "UserId") ?? "", out var u)
                ? FakeSql.Sets([u], [new { States = "DELHI" }], [new { States = "24" }], [new { States = "Quality" }])
                : FakeSql.Sets([], [], [], []);
        _host.Sql.Procs["SP_MASTER_GET_SECTORS"] = _ => FakeSql.Sets(
            [new { Id = 1, SectorCode = "24", SectorName = "Basic metals" }, new { Id = 2, SectorCode = "25", SectorName = "Metal products" }],
            [new { UserId = "OP2", FirstName = "Partner Two" }],
            [new { UserId = "OP1", FirstName = "Partner One" }, new { UserId = "OP2", FirstName = "Partner Two" }]);
        _host.Sql.Procs["SP_MASTER_GET_AREA_OF_KNOWLEDGE"] = _ => FakeSql.Sets([new { AreaOfknowledge = "Quality" }, new { AreaOfknowledge = "Safety" }]);
        _host.Sql.Procs["SP_INSERT_USER"] = args => FakeSql.Sets([new Dictionary<string, object?> { [""] = FakeSql.Arg(args, "RoleId") == "2" ? "ZEDAA0099" : "ZEDBA0099" }]);
        _host.Sql.Procs["SP_BLOCK_UNBLOCK_USER"] = _ => FakeSql.Sets([new { StatusCode = 200, Message = "OK" }]);
        _host.Sql.Procs["SP_BLOCK_UNBLOCK_BRONZE_AGENCY"] = _ => FakeSql.Sets([new { StatusCode = 200, Message = "OK" }]);
        _host.Sql.Procs[Zed.Portal.Features.Staff.Users.StaffUserRules.ProfessionalProcedure] = args =>
            FakeSql.Arg(args, "CertificationNo") == "BA1234" && FakeSql.Arg(args, "EmailId") == "pro@zed.test"
                ? FakeSql.Sets(
                    [new
                    {
                        Email = "pro@zed.test", ContactNumber = "9111111111", Name = "Real Professional",
                        CertificateNo = """{"Address":{"Street":"12 Main Rd","City":"Pune","District":"Pune","State":"MAHARASHTRA","PinCode":"411001"}}""",
                        SelfiePath = "https://training.zed.org.in/professional/selfie/1.jpg",
                    }],
                    [new { Status = 1, ErrorMessage = "Details Fetched Successfully" }])
                : FakeSql.Sets([], [new { Status = 0, ErrorMessage = "Invalid details." }]);
    }

    public void Dispose() => _host.Dispose();

    private (string Name, object? Args) Call(string proc) => _host.Sql.Calls.Last(c => c.Name == proc);

    private static object AgencyBody(object? extra = null) => new
    {
        userName = "New Agency", spocName = "Spoc", emailId = "new@agency.test", mobileNo = "9876501234", address = "Addr",
        pinCode = "110002", gstNumber = "07ABCDE1234F1Z5", states = new[] { "DELHI", "goa" }, nicSectors = new[] { "24" },
        orgPartnerId = "OP2", desktopVerification = true, siteVerification = true, financialVerification = false, sectorActivity = "Both",
    };

    // ---- authorisation -------------------------------------------------------------------

    [Theory]
    [InlineData("GET", "/api/staff/users/agencies")]
    [InlineData("POST", "/api/staff/users/agencies")]
    [InlineData("GET", "/api/staff/users/assessors")]
    [InlineData("GET", "/api/staff/users/assessors/mine")]
    [InlineData("POST", "/api/staff/users/assessors/lookup")]
    [InlineData("POST", "/api/staff/users/assessors/ZEDAS0001/block")]
    public async Task Anonymous_requests_get_401(string method, string url)
    {
        var client = await _host.CreateBrowserAsync();
        var r = method == "GET" ? await client.GetAsync(url) : await client.PostAsJsonAsync(url, new { });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Theory]
    [InlineData("AGENCY1", "GET", "/api/staff/users/agencies")]
    [InlineData("ADMIN1", "GET", "/api/staff/users/agencies")]
    [InlineData("AGENCY1", "POST", "/api/staff/users/agencies")]
    [InlineData("AGENCY1", "POST", "/api/staff/users/agencies/ZEDAA0001/block")]
    [InlineData("AGENCY1", "GET", "/api/staff/users/assessors")]
    [InlineData("MASTER1", "GET", "/api/staff/users/assessors/mine")]
    [InlineData("MASTER1", "POST", "/api/staff/users/assessors")]
    [InlineData("MASTER1", "POST", "/api/staff/users/assessors/lookup")]
    [InlineData("ASSESSOR1", "GET", "/api/staff/users/assessors/ZEDAS0001")]
    [InlineData("ASSESSOR1", "POST", "/api/staff/users/assessors/ZEDAS0001/block")]
    [InlineData("ADMIN1", "POST", "/api/staff/users/assessors/ZEDAS0001/unblock")]
    public async Task Wrong_roles_get_403(string user, string method, string url)
    {
        var client = await UsersMastersLogin.SignInAsync(_host, user);
        var r = method == "GET" ? await client.GetAsync(url) : await client.PostAsJsonAsync(url, new { reason = "x" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name is "SP_INSERT_USER" or "SP_BLOCK_UNBLOCK_USER" or "SP_GET_ASSESSORS");
    }

    [Fact]
    public async Task An_msme_cannot_use_user_management()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = _ => FakeSql.Sets([new { UserId = "ZEDMSME1", UserName = "M", RoleId = 5 }], [new { ERRORMSG = "SUCCESS" }]);
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = "ZEDMSME1", password = "Right#Pass1" })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/staff/users/assessors/ZEDAS0001")).StatusCode);
    }

    // ---- agencies (MasterAdmin) -------------------------------------------------------------

    [Fact]
    public async Task Master_admin_lists_its_agencies_without_passwords()
    {
        _host.Sql.Procs["SP_GET_USERS_BY_ROLE"] = _ => FakeSql.Sets([Agency1.Concat(new Dictionary<string, object?> { ["PwdCode"] = "x", ["IdStatus"] = "Active", ["NoOfUsers"] = 3 })
            .ToDictionary(k => k.Key, k => k.Value)]);
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var r = await client.GetAsync("/api/staff/users/agencies");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = await r.Content.ReadAsStringAsync();
        Assert.Contains("ZEDAA0001", body);
        Assert.DoesNotContain("agencypw", body);
        Assert.DoesNotContain("Password", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("PwdCode", body);
        var call = Call("SP_GET_USERS_BY_ROLE");
        Assert.Equal("MASTER1", UsersMastersLogin.Arg(call.Args, "UserId"));
        Assert.Equal("2", UsersMastersLogin.Arg(call.Args, "RoleId"));
    }

    [Fact]
    public async Task Creating_an_agency_mails_a_set_password_link_and_never_the_password()
    {
        var resets = new Zed.TestSupport.FakeStaffResets().Attach(_host.Sql.Procs);
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var r = await client.PostAsJsonAsync("/api/staff/users/agencies", AgencyBody());
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = await r.Content.ReadAsStringAsync();

        var insert = Call("SP_INSERT_USER");
        var password = UsersMastersLogin.Arg(insert.Args, "Password")!;
        Assert.Equal(10, password.Length);
        Assert.DoesNotContain(password, body);
        Assert.Contains("ZEDAA0099", body);
        Assert.Equal("2", UsersMastersLogin.Arg(insert.Args, "RoleId"));
        Assert.Equal("MASTER1", UsersMastersLogin.Arg(insert.Args, "CreatedBy"));
        Assert.Equal("DELHI,GOA", UsersMastersLogin.Arg(insert.Args, "PreferredStates"));
        Assert.Equal("OP2", UsersMastersLogin.Arg(insert.Args, "OrgPartnerId"));

        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("new@agency.test", mail.To);
        Assert.Null(mail.Cc);
        Assert.DoesNotContain(password, mail.HtmlBody);
        Assert.Contains("ZEDAA0099", mail.Subject);
        // A one-time link of 24 hours, recorded as sent by the MasterAdmin who created the agency.
        var link = Assert.Single(resets.Rows);
        Assert.Equal("ZEDAA0099", link.UserId);
        Assert.Equal("MASTER1", link.RequestedBy);
        Assert.InRange(link.ExpiresAt - link.CreatedAt, TimeSpan.FromHours(23.9), TimeSpan.FromHours(24));
        Assert.Matches("/reset-password#token=[A-Za-z0-9_-]{43}", mail.HtmlBody);
        Assert.Contains("within 24 hours", mail.HtmlBody);
    }

    [Fact]
    public async Task The_office_copy_of_a_new_agency_has_neither_the_password_nor_the_link()
    {
        new Zed.TestSupport.FakeStaffResets().Attach(_host.Sql.Procs);
        _host.Sql.Queries["SELECT SettingKey, SettingValue FROM dbo.V4Settings"] = _ =>
            [new Zed.Core.Data.PortalSettings.SettingRow(Zed.Core.Email.EmailAddresses.RegistrationCc, "office@zed.test")];
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/staff/users/agencies", AgencyBody())).StatusCode);

        var password = UsersMastersLogin.Arg(Call("SP_INSERT_USER").Args, "Password")!;
        var unit = Assert.Single(_host.Email.Sent, m => m.To == "new@agency.test");
        Assert.Null(unit.Cc);
        Assert.Contains("reset-password#token=", unit.HtmlBody);
        var office = Assert.Single(_host.Email.Sent, m => m.To == "office@zed.test");
        Assert.Equal(unit.Subject, office.Subject);
        Assert.DoesNotContain("reset-password#token=", office.HtmlBody);
        Assert.DoesNotContain(password, office.HtmlBody);
        Assert.Contains("Office copy", office.HtmlBody);
        Assert.Contains("ZEDAA0099", office.HtmlBody);
    }

    [Fact]
    public async Task With_set_password_links_switched_off_a_new_agency_gets_the_password_as_before()
    {
        // Each test has its own host, so the setting does not reach the others.
        _host.Services.GetRequiredService<Microsoft.Extensions.Configuration.IConfiguration>()["StaffPasswordReset:Enabled"] = "false";
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/staff/users/agencies", AgencyBody())).StatusCode);
        var password = UsersMastersLogin.Arg(Call("SP_INSERT_USER").Args, "Password")!;
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Contains(password, mail.HtmlBody);
        Assert.DoesNotContain("reset-password#token=", mail.HtmlBody);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_V4_STAFF_RESET_CREATE");
    }

    [Fact]
    public async Task When_the_link_cannot_be_recorded_the_mail_points_to_forgot_password()
    {
        // No FakeStaffResets: SP_V4_STAFF_RESET_CREATE answers nothing, as a failed insert.
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/staff/users/agencies", AgencyBody())).StatusCode);
        var password = UsersMastersLogin.Arg(Call("SP_INSERT_USER").Args, "Password")!;
        var mail = Assert.Single(_host.Email.Sent);
        Assert.DoesNotContain(password, mail.HtmlBody);
        Assert.DoesNotContain("reset-password#token=", mail.HtmlBody);
        Assert.Contains("Forgot password?", mail.HtmlBody);
    }

    [Fact]
    public async Task After_the_old_sites_a_new_agency_gets_a_random_stored_value_and_a_hash_of_a_password_nobody_is_told()
    {
        var passwords = new Zed.TestSupport.FakePasswords().Attach(_host.Sql.Procs);
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1"); // the fixture's staff login (no hash) under Dual
        Zed.TestSupport.FakePasswords.SetMode(_host.Services, Zed.Core.Security.PasswordMode.HashOnly);

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/staff/users/agencies", AgencyBody())).StatusCode);
        var stored = UsersMastersLogin.Arg(Call("SP_INSERT_USER").Args, "Password");
        Assert.True(Zed.Core.Security.PasswordStore.IsReplacement(stored)); // also what main's procedure copies to ZED_SURVEILLANCE
        var mail = Assert.Single(_host.Email.Sent).HtmlBody;
        Assert.DoesNotContain(stored!, mail);
        // A hash is recorded, of a generated password that no cell of the mail shows: the agency sets its own.
        Assert.NotNull(passwords.LastWrite("ZEDAA0099")?.Hash);
        Assert.DoesNotContain(System.Text.RegularExpressions.Regex.Matches(mail, "font-weight: 700;\">([^<]+)</td>"),
            m => passwords.HashMatches("ZEDAA0099", m.Groups[1].Value.Trim()));
    }

    [Theory]
    [InlineData("mobileNo", "12345", "mobile")]
    [InlineData("emailId", "not-an-email", "Email")]
    [InlineData("orgPartnerId", "OP1", "organising partner")] // already linked to another agency
    public async Task Agency_input_is_validated(string field, string value, string message)
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var body = JsonSerializer.SerializeToNode(AgencyBody())!.AsObject();
        body[field] = value;
        var r = await client.PostAsJsonAsync("/api/staff/users/agencies", body);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains(message, await r.ProblemTitle(), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_INSERT_USER");
    }

    [Fact]
    public async Task At_least_one_verification_is_required()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var body = JsonSerializer.SerializeToNode(AgencyBody())!.AsObject();
        body["desktopVerification"] = false;
        body["siteVerification"] = false;
        var r = await client.PostAsJsonAsync("/api/staff/users/agencies", body);
        Assert.Equal("Please select atleast one verification.", await r.ProblemTitle());
    }

    [Fact]
    public async Task Agency_details_do_not_include_the_password_and_only_agencies_are_found()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var r = await client.GetAsync("/api/staff/users/agencies/ZEDAA0001");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.DoesNotContain("agencypw", await r.Content.ReadAsStringAsync());
        // An assessor id is not an agency.
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/staff/users/agencies/ZEDAS0001")).StatusCode);
    }

    [Fact]
    public async Task Updating_an_agency_keeps_the_role_and_cannot_move_the_partner()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var body = JsonSerializer.SerializeToNode(AgencyBody())!.AsObject();
        body["orgPartnerId"] = "OP2"; // a different partner than the agency's OP1
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/staff/users/agencies/ZEDAA0001", body)).StatusCode);

        body["orgPartnerId"] = "OP1";
        body["roleId"] = 7;
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync("/api/staff/users/agencies/ZEDAA0001", body)).StatusCode);
        var update = Call("SP_UPDATE_USER");
        Assert.Equal("2", UsersMastersLogin.Arg(update.Args, "RoleId"));
        Assert.Equal("ZEDAA0001", UsersMastersLogin.Arg(update.Args, "UserId"));
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Block_needs_a_reason_and_unblock_mail_has_no_password()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/staff/users/agencies/ZEDAA0001/block", new { reason = " " })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/staff/users/agencies/ZEDAA0001/block", new { reason = "Complaint" })).StatusCode);
        var block = Call("SP_BLOCK_UNBLOCK_USER");
        Assert.Equal("False", UsersMastersLogin.Arg(block.Args, "IsActive"));
        Assert.Equal("Complaint", UsersMastersLogin.Arg(block.Args, "ReasonForRejection"));
        // The agency is told it is blocked (2026-11-08: on every portal, before only on some), without a password.
        var blocked = Assert.Single(_host.Email.Sent);
        Assert.Contains("Blocked as an Assessment Agency", blocked.HtmlBody);
        Assert.DoesNotContain("agencypw", blocked.HtmlBody);
        _host.Email.Sent.Clear();

        Agency1["IsActive"] = false;
        try
        {
            Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/api/staff/users/agencies/ZEDAA0001/unblock", null)).StatusCode);
        }
        finally { Agency1["IsActive"] = true; }
        var mail = Assert.Single(_host.Email.Sent);
        Assert.DoesNotContain("agencypw", mail.HtmlBody);
        Assert.Contains("unblocked", mail.HtmlBody);
    }

    [Fact]
    public async Task Block_with_get_is_not_possible()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var r = await client.GetAsync("/api/staff/users/agencies/ZEDAA0001/block?reason=x");
        Assert.NotEqual(HttpStatusCode.OK, r.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_BLOCK_UNBLOCK_USER");
    }

    [Fact]
    public async Task Disabling_bronze_assessments_mails_the_reason()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var r = await client.PostAsJsonAsync("/api/staff/users/agencies/ZEDAA0001/bronze-assessments", new { allow = false, reason = "Pending audit" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var call = Call("SP_BLOCK_UNBLOCK_BRONZE_AGENCY");
        Assert.Equal("False", UsersMastersLogin.Arg(call.Args, "AllowBronzeAssessments"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Contains("Disabled", mail.Subject);
        Assert.Contains("Pending audit", mail.HtmlBody);
    }

    [Fact]
    public async Task Disabling_gold_assessments_saves_the_level_and_mails_the_reason()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var noReason = await client.PostAsJsonAsync("/api/staff/users/agencies/ZEDAA0001/level-assessments", new { level = "Gold", allow = false, reason = "" });
        Assert.Equal("Please enter the reason for disabling Gold assessments (up to 2000 characters).", await noReason.ProblemTitle());
        var badLevel = await client.PostAsJsonAsync("/api/staff/users/agencies/ZEDAA0001/level-assessments", new { level = "Platinum", allow = false, reason = "x" });
        Assert.Equal(HttpStatusCode.BadRequest, badLevel.StatusCode);

        var r = await client.PostAsJsonAsync("/api/staff/users/agencies/ZEDAA0001/level-assessments", new { level = "Gold", allow = false, reason = "Pending re-empanelment" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var save = _host.Sql.Calls.Single(c => c.Name == AgencyLevels.SaveSql(AgencyLevels.Find("Gold")!));
        Assert.Contains("SET AllowGoldAssessments = @Allow, ReasonForBlockGold = @Reason", save.Name);
        Assert.Equal(("False", "Pending re-empanelment", "ZEDAA0001"),
            (UsersMastersLogin.Arg(save.Args, "Allow"), UsersMastersLogin.Arg(save.Args, "Reason"), UsersMastersLogin.Arg(save.Args, "UserId")));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_BLOCK_UNBLOCK_BRONZE_AGENCY");
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Contains("Allocation of Gold Assessment Disabled", mail.Subject);
        Assert.Contains("disabled for Gold assessments", mail.HtmlBody);
        Assert.Contains("Pending re-empanelment", mail.HtmlBody);

        // ZED-X back on: no reason needed; the reason is cleared.
        (await client.PostAsJsonAsync("/api/staff/users/agencies/ZEDAA0001/level-assessments", new { level = "ZEDX", allow = true })).EnsureSuccessStatusCode();
        var zedx = _host.Sql.Calls.Single(c => c.Name == AgencyLevels.SaveSql(AgencyLevels.Find("ZEDX")!));
        Assert.Equal(("True", null), (UsersMastersLogin.Arg(zedx.Args, "Allow"), UsersMastersLogin.Arg(zedx.Args, "Reason")));
    }

    [Fact]
    public async Task The_agency_list_carries_each_levels_switch_and_reason()
    {
        _host.Sql.Queries[AgencyLevels.ListSql] = _ =>
            [new { UserId = "ZEDAA0001", ReasonForRejectionForBA = (string?)null, AllowSilverAssessments = (bool?)null, AllowGoldAssessments = (bool?)false,
                   AllowZedxAssessments = (bool?)true, ReasonForBlockSilver = (string?)null, ReasonForBlockGold = "Pending", ReasonForBlockZedx = (string?)null }];
        _host.Sql.Procs["SP_GET_USERS_BY_ROLE"] = _ => FakeSql.Sets([Agency1]);
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var list = await client.GetFromJsonAsync<JsonElement>("/api/staff/users/agencies");
        var row = list.EnumerateArray().First(a => a.GetProperty("UserId").GetString() == "ZEDAA0001");
        Assert.True(row.GetProperty("AllowSilverAssessments").GetBoolean());
        Assert.False(row.GetProperty("AllowGoldAssessments").GetBoolean());
        Assert.True(row.GetProperty("AllowZedxAssessments").GetBoolean());
        Assert.Equal("Pending", row.GetProperty("LevelReasons").GetProperty("Gold").GetString());
    }

    [Fact]
    public async Task Reset_mobile_changes_only_the_mobile_number()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/staff/users/agencies/ZEDAA0001/mobile", new { mobileNo = "" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/staff/users/agencies/ZEDAA0001/mobile", new { mobileNo = "9123456780" })).StatusCode);
        var sql = _host.Sql.Calls.Last(c => c.Name.StartsWith("UPDATE Users", StringComparison.Ordinal));
        Assert.DoesNotContain("Password", sql.Name, StringComparison.OrdinalIgnoreCase);
        Assert.Equal("9123456780", UsersMastersLogin.Arg(sql.Args, "MobileNo"));
        Assert.Equal("ZEDAA0001", UsersMastersLogin.Arg(sql.Args, "UserId"));
    }

    // ---- assessors -------------------------------------------------------------------------

    [Fact]
    public async Task Agency_lists_only_its_own_assessors_masked_and_without_passwords()
    {
        _host.Sql.Procs["SP_GET_USERS_BY_ROLE"] = _ => FakeSql.Sets([_users["ZEDAS0001"]
            .Concat(new Dictionary<string, object?> { ["IsCertAttached"] = 0, ["PhotoPath"] = "https://evil.test/x.jpg" }).ToDictionary(k => k.Key, k => k.Value)]);
        var client = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var body = await client.GetStringAsync("/api/staff/users/assessors/mine");
        var call = Call("SP_GET_USERS_BY_ROLE");
        Assert.Equal("AGENCY1", UsersMastersLogin.Arg(call.Args, "UserId"));
        Assert.Equal("3", UsersMastersLogin.Arg(call.Args, "RoleId"));
        Assert.DoesNotContain("assessorpw", body);
        Assert.DoesNotContain("resetcode", body);
        Assert.DoesNotContain("123456789012", body);
        Assert.Contains("XXXXXXXX9012", body);
        Assert.DoesNotContain("evil.test", body);
    }

    [Theory]
    [InlineData("GET", "")]
    [InlineData("PUT", "")]
    [InlineData("POST", "/block")]
    [InlineData("POST", "/unblock")]
    [InlineData("POST", "/mobile")]
    public async Task An_agency_cannot_reach_another_agencys_assessor(string method, string action)
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var url = "/api/staff/users/assessors/ZEDAS0002" + action;
        var r = method switch
        {
            "GET" => await client.GetAsync(url),
            "PUT" => await client.PutAsJsonAsync(url, new { address = "x", pinCode = "560001", idProofType = "PAN Card", idProofNumber = "ABCDE1234F" }),
            _ => await client.PostAsJsonAsync(url, new { reason = "x", mobileNo = "9123456780" }),
        };
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name is "SP_BLOCK_UNBLOCK_USER" or "SP_UPDATE_USER" || c.Name.StartsWith("UPDATE", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Agency_blocks_its_own_assessor_and_master_admin_views_any_read_only()
    {
        var agency = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        Assert.Equal(HttpStatusCode.OK, (await agency.PostAsJsonAsync("/api/staff/users/assessors/ZEDAS0001/block", new { reason = "Absent" })).StatusCode);
        Assert.Equal("ZEDAS0001", UsersMastersLogin.Arg(Call("SP_BLOCK_UNBLOCK_USER").Args, "UserId"));

        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var details = await master.GetFromJsonAsync<JsonElement>("/api/staff/users/assessors/ZEDAS0002");
        Assert.False(details.GetProperty("canEdit").GetBoolean());
        Assert.Equal("XXXXXXXX9012", details.GetProperty("idProofNumberMasked").GetString());
        Assert.DoesNotContain("assessorpw", details.GetRawText());
        Assert.Equal(HttpStatusCode.Forbidden, (await master.PutAsJsonAsync("/api/staff/users/assessors/ZEDAS0002", new { })).StatusCode);
    }

    [Fact]
    public async Task Master_admin_blocks_and_unblocks_an_assessor_and_each_is_kept_in_the_history()
    {
        _host.Sql.Queries[StaffAssessorsController.OpenAssessmentsSql] = args => UsersMastersLogin.Arg(args, "UserId") == "ZEDAS0001" ? [2] : [0];
        _host.Sql.Queries[UserBlockHistory.ListSql] = _ =>
            [new UserBlockHistory.Entry("Blocked", "Certificate expired", "MASTER1", 7, new DateTime(2026, 11, 6, 15, 42, 0))];
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(2, (await master.GetFromJsonAsync<JsonElement>("/api/staff/users/assessors/ZEDAS0001/open-assessments")).GetProperty("count").GetInt32());

        (await master.PostAsJsonAsync("/api/staff/users/assessors/ZEDAS0001/block", new { reason = "Certificate expired" })).EnsureSuccessStatusCode();
        var blocked = _host.Sql.Calls.Single(c => c.Name == UserBlockHistory.InsertSql);
        Assert.Equal(("ZEDAS0001", "3", "Blocked", "Certificate expired", "MASTER1", "7"),
            (UsersMastersLogin.Arg(blocked.Args, "UserId"), UsersMastersLogin.Arg(blocked.Args, "RoleId"), UsersMastersLogin.Arg(blocked.Args, "Action"),
             UsersMastersLogin.Arg(blocked.Args, "Reason"), UsersMastersLogin.Arg(blocked.Args, "ActionBy"), UsersMastersLogin.Arg(blocked.Args, "ActionByRole")));

        _users["ZEDAS0001"]["IsActive"] = false;
        try
        {
            (await master.PostAsync("/api/staff/users/assessors/ZEDAS0001/unblock", null)).EnsureSuccessStatusCode();
        }
        finally { _users["ZEDAS0001"]["IsActive"] = true; }
        var unblocked = _host.Sql.Calls.Where(c => c.Name == UserBlockHistory.InsertSql).Last();
        Assert.Equal(("Unblocked", null), (UsersMastersLogin.Arg(unblocked.Args, "Action"), UsersMastersLogin.Arg(unblocked.Args, "Reason")));

        var history = await master.GetFromJsonAsync<JsonElement>("/api/staff/users/assessors/ZEDAS0001/history");
        Assert.Equal("Certificate expired", Assert.Single(history.EnumerateArray()).GetProperty("reason").GetString());
        // An agency sees only its own assessors' history.
        var other = await UsersMastersLogin.SignInAsync(_host, "AGENCY2");
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync("/api/staff/users/assessors/ZEDAS0001/history")).StatusCode);
    }

    [Fact]
    public async Task The_master_admins_assessor_list_shows_the_reason_and_date_of_a_block()
    {
        _host.Sql.Procs["SP_GET_ASSESSORS"] = _ => FakeSql.Sets([_users["ZEDAS0001"], _users["ZEDAS0003"]]);
        _host.Sql.Queries[UserBlockHistory.LatestBlocksSql] = _ =>
            [new { UserId = "ZEDAS0003", Reason = "Absent", ActionDate = (DateTime?)new DateTime(2026, 11, 6) },
             new { UserId = "ZEDAS0001", Reason = "Old", ActionDate = (DateTime?)new DateTime(2026, 1, 1) }];
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var rows = (await master.GetFromJsonAsync<JsonElement>("/api/staff/users/assessors")).EnumerateArray().ToList();
        Assert.False(rows[0].TryGetProperty("BlockReason", out _));
        Assert.Equal("Absent", rows[1].GetProperty("BlockReason").GetString());
    }

    [Fact]
    public async Task Assessor_with_a_certificate_attached_elsewhere_cannot_be_unblocked()
    {
        _host.Sql.Queries["SELECT COUNT(*) FROM Users"] = _ => [1];
        var client = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var r = await client.PostAsync("/api/staff/users/assessors/ZEDAS0003/unblock", null);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_BLOCK_UNBLOCK_USER");

        _host.Sql.Queries["SELECT COUNT(*) FROM Users"] = _ => [0];
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/api/staff/users/assessors/ZEDAS0003/unblock", null)).StatusCode);
    }

    [Fact]
    public async Task Lookup_returns_the_professional_and_passes_the_signed_in_agency()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var r = await client.PostAsJsonAsync("/api/staff/users/assessors/lookup", new { assessorType = "BronzeAssessor", certificateNo = "BA1234", email = "pro@zed.test" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var p = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Real Professional", p.GetProperty("name").GetString());
        Assert.Equal("12 Main Rd, Pune, Pune, MAHARASHTRA", p.GetProperty("address").GetString());
        Assert.Equal("411001", p.GetProperty("pinCode").GetString());
        var call = Call(Zed.Portal.Features.Staff.Users.StaffUserRules.ProfessionalProcedure);
        Assert.Equal("AGENCY1", UsersMastersLogin.Arg(call.Args, "UserId"));
        Assert.Equal("2", UsersMastersLogin.Arg(call.Args, "RoleId"));

        var bad = await client.PostAsJsonAsync("/api/staff/users/assessors/lookup", new { assessorType = "BronzeAssessor", certificateNo = "BA9999", email = "pro@zed.test" });
        Assert.Equal("Invalid details.", await bad.ProblemTitle());
    }

    [Fact]
    public async Task Agency_creates_an_assessor_under_itself_with_the_verified_identity()
    {
        var resets = new Zed.TestSupport.FakeStaffResets().Attach(_host.Sql.Procs);
        var client = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var r = await client.PostAsJsonAsync("/api/staff/users/assessors", new
        {
            // Role escalation and identity fields in the body are ignored.
            roleId = 2, createdBy = "AGENCY2", userName = "Someone Else", email = "attacker@evil.test", mobileNo = "9999999999",
            assessorType = "BronzeAssessor", certificateNo = "BA1234", professionalEmail = "pro@zed.test",
            address = "12 Main Rd", pinCode = "411001", idProofType = "PAN Card", idProofNumber = "abcde1234f",
            states = new[] { "MAHARASHTRA" }, nicSectors = new[] { "24", "25" }, areasOfKnowledge = new[] { "Quality" }, sectorActivity = "Services",
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = await r.Content.ReadAsStringAsync();
        var activity = Assert.Single(_host.Sql.Calls, c => c.Name == UserSectorActivity.UpdateSql);
        Assert.Equal("Services", UsersMastersLogin.Arg(activity.Args, "SectorActivity"));

        var insert = Call("SP_INSERT_USER");
        Assert.Equal("3", UsersMastersLogin.Arg(insert.Args, "RoleId"));
        Assert.Equal("AGENCY1", UsersMastersLogin.Arg(insert.Args, "CreatedBy"));
        Assert.Equal("Real Professional", UsersMastersLogin.Arg(insert.Args, "UserName"));
        Assert.Equal("pro@zed.test", UsersMastersLogin.Arg(insert.Args, "Email"));
        Assert.Equal("9111111111", UsersMastersLogin.Arg(insert.Args, "MobileNo"));
        Assert.Equal("ABCDE1234F", UsersMastersLogin.Arg(insert.Args, "IdProofNumber"));
        Assert.Equal("BronzeAssessor", UsersMastersLogin.Arg(insert.Args, "AssessorType"));
        var password = UsersMastersLogin.Arg(insert.Args, "Password")!;
        Assert.DoesNotContain(password, body);

        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("pro@zed.test", mail.To);
        Assert.DoesNotContain(password, mail.HtmlBody);
        Assert.Contains("reset-password#token=", mail.HtmlBody);
        Assert.Equal(("ZEDBA0099", "AGENCY1"), (Assert.Single(resets.Rows).UserId, resets.Rows[0].RequestedBy));
        Assert.StartsWith("Bronze Assessor Login Details", mail.Subject);
    }

    [Fact]
    public async Task Assessor_is_not_created_when_the_professional_lookup_fails()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var r = await client.PostAsJsonAsync("/api/staff/users/assessors", new
        {
            assessorType = "Assessor", certificateNo = "AS0000", professionalEmail = "pro@zed.test", address = "x", pinCode = "411001",
            idProofType = "Aadhaar Card", idProofNumber = "123412341234",
        });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_INSERT_USER");
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Updating_an_assessor_keeps_identity_and_stored_id_number()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var r = await client.PutAsJsonAsync("/api/staff/users/assessors/ZEDAS0001", new
        {
            userName = "Changed", address = "New address", pinCode = "560002", idProofType = "Aadhaar Card", idProofNumber = "",
            states = new[] { "KERALA" }, areasOfKnowledge = new[] { "Unknown area" },
        });
        Assert.Equal("Please select valid areas of knowledge and expertise.", await r.ProblemTitle());

        r = await client.PutAsJsonAsync("/api/staff/users/assessors/ZEDAS0001", new
        {
            userName = "Changed", address = "New address", pinCode = "560002", idProofType = "Aadhaar Card", idProofNumber = "",
            states = new[] { "KERALA" }, sectorActivity = "Manufacturing",
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(("ZEDAS0001", "Manufacturing"), (UsersMastersLogin.Arg(Call(UserSectorActivity.UpdateSql).Args, "UserId"), UsersMastersLogin.Arg(Call(UserSectorActivity.UpdateSql).Args, "SectorActivity")));
        var update = Call("SP_UPDATE_USER");
        Assert.Equal("ZEDAS0001 name", UsersMastersLogin.Arg(update.Args, "UserName"));
        Assert.Equal("123456789012", UsersMastersLogin.Arg(update.Args, "IdProofNumber"));
        Assert.Equal("3", UsersMastersLogin.Arg(update.Args, "RoleId"));
    }

    [Fact]
    public async Task Master_admin_lists_all_assessors_with_a_validated_filter()
    {
        _host.Sql.Procs["SP_GET_ASSESSORS"] = _ => FakeSql.Sets([_users["ZEDAS0001"]]);
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/staff/users/assessors?type=XX")).StatusCode);
        var body = await client.GetStringAsync("/api/staff/users/assessors?agencyId=ZEDAA0001&type=DA");
        Assert.Contains("ZEDAS0001", body);
        Assert.DoesNotContain("assessorpw", body);
        Assert.DoesNotContain("123456789012", body);
        var call = Call("SP_GET_ASSESSORS");
        Assert.Equal("ZEDAA0001", UsersMastersLogin.Arg(call.Args, "CertificationBodyUserId"));
        Assert.Equal("DA", UsersMastersLogin.Arg(call.Args, "AssessorType"));
    }

    // ---- Manufacturing / Services (V4, migration 0028) ------------------------------------

    [Fact]
    public async Task An_agency_needs_its_sector_type_and_its_assessors_stay_within_it()
    {
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var missing = new Dictionary<string, object?>(System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, object?>>(
            System.Text.Json.JsonSerializer.Serialize(AgencyBody()))!) { ["sectorActivity"] = null };
        Assert.Equal("Please select whether the agency assesses Manufacturing, Services or Both.",
            await (await master.PostAsJsonAsync("/api/staff/users/agencies", missing)).ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_INSERT_USER");

        // AGENCY1 assesses Manufacturing only: no Services assessor.
        _host.Sql.Queries[UserSectorActivity.OfUserSql] = args => UsersMastersLogin.Arg(args, "UserId") == "AGENCY1"
            ? [new UserSectorActivity.Row("AGENCY1", "Manufacturing")] : [];
        var agency = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var r = await agency.PutAsJsonAsync("/api/staff/users/assessors/ZEDAS0001", new
        {
            address = "New address", pinCode = "560002", idProofType = "Aadhaar Card", idProofNumber = "", states = new[] { "KERALA" }, sectorActivity = "Services",
        });
        Assert.Equal("Your agency assesses Manufacturing only, so its assessors cannot be set to Services.", await r.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_UPDATE_USER");

        // The lists show it.
        _host.Sql.Queries[UserSectorActivity.ByRoleSql] = _ => [new UserSectorActivity.Row("ZEDAS0001", "Manufacturing")];
        _host.Sql.Procs["SP_GET_USERS_BY_ROLE"] = _ => FakeSql.Sets([_users["ZEDAS0001"]]);
        var mine = await agency.GetFromJsonAsync<System.Text.Json.JsonElement>("/api/staff/users/assessors/mine");
        Assert.Contains(mine.EnumerateArray(), a => a.GetProperty("UserId").GetString() == "ZEDAS0001" && a.GetProperty("SectorActivity").GetString() == "Manufacturing");
    }
}
