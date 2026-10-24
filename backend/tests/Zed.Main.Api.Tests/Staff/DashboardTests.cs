using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Data;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Signs staff users in through the real login endpoint (SP_GET_USER_DETAILS faked).</summary>
internal static class DashboardStaffLogin
{
    public static void Register(TestHost host)
    {
        host.Sql.Procs["SP_GET_USER_DETAILS"] = args => FakeSql.Arg(args, "UserId") switch
        {
            "SUPER1" => User("SUPER1", 10),
            "MASTER1" => User("MASTER1", 7),
            "MINISTRY1" => User("MINISTRY1", 8),
            "MINSTATE1" => User("MINSTATE1", 8, stateCode: "9"),
            "AGENCY1" => User("AGENCY1", 2),
            "ASSESSOR1" => User("ASSESSOR1", 3),
            "CFB1" => User("CFB1", 11),
            "QC1" => User("QC1", 17),
            "ADMIN1" => User("ADMIN1", 1),
            "STATE1" => User("STATE1", 6),
            _ => FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]),
        };
        host.Sql.Procs["SP_GET_SUB_ROLE"] = _ =>
            FakeSql.Sets([new { DesktopVerification = 1, SiteVerification = 1, FinancialVerification = 1 }]);
    }

    private static ResultSets User(string id, int role, string? stateCode = null) =>
        FakeSql.Sets([new { UserId = id, UserName = id + " name", RoleId = role, Email = "x@y.test", StateCode = stateCode }], [new { ERRORMSG = "SUCCESS" }]);

    public static async Task<HttpClient> SignInAsync(this TestHost host, string userId)
    {
        var client = await host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    public static (string Name, object? Args) LastCall(this TestHost host, string proc) =>
        host.Sql.Calls.Last(c => string.Equals(c.Name, proc, StringComparison.OrdinalIgnoreCase));
}

public sealed class DashboardTests : IDisposable
{
    private readonly TestHost _host = new();

    public DashboardTests() => DashboardStaffLogin.Register(_host);

    public void Dispose() => _host.Dispose();

    [Theory]
    [InlineData("/api/staff/dashboard")]
    [InlineData("/api/staff/dashboard/counts")]
    [InlineData("/api/staff/dashboard/registered-msme")]
    [InlineData("/api/staff/dashboard/failed-transactions")]
    [InlineData("/api/staff/dashboard/payments-received")]
    [InlineData("/api/staff/dashboard/financial-support")]
    [InlineData("/api/staff/history/ZEDMSME000001")]
    public async Task Anonymous_requests_get_401(string url)
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(url)).StatusCode);
    }

    [Theory]
    [InlineData("ADMIN1", "/api/staff/dashboard")]
    [InlineData("STATE1", "/api/staff/dashboard/counts")]
    [InlineData("AGENCY1", "/api/staff/dashboard/registered-msme")]
    [InlineData("MASTER1", "/api/staff/dashboard/registered-msme")]
    [InlineData("CFB1", "/api/staff/dashboard/failed-transactions")]
    [InlineData("MASTER1", "/api/staff/dashboard/failed-transactions")]
    [InlineData("SUPER1", "/api/staff/dashboard/payments-received")]
    [InlineData("QC1", "/api/staff/dashboard/financial-support")]
    [InlineData("AGENCY1", "/api/staff/history/ZEDMSME000001")]
    [InlineData("MINISTRY1", "/api/staff/history/ZEDMSME000001")]
    public async Task Roles_outside_the_legacy_menu_get_403(string userId, string url)
    {
        var client = await _host.SignInAsync(userId);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task Summary_is_scoped_to_the_signed_in_agency_and_returns_only_the_card_columns()
    {
        _host.Sql.Procs["SP_DASHBOARD_GET_DETAILS"] = _ => FakeSql.Sets([new { BronzeTotal = 12, SaGoldCompleted = 3, AssessmentAgencies = 99, FaTotal = 4 }]);
        var client = await _host.SignInAsync("AGENCY1");

        var json = await client.GetFromJsonAsync<JsonElement>("/api/staff/dashboard");
        Assert.Equal(12, json.GetProperty("BronzeTotal").GetInt32());
        Assert.Equal(3, json.GetProperty("SaGoldCompleted").GetInt32());
        Assert.False(json.TryGetProperty("AssessmentAgencies", out _));

        var call = _host.LastCall("SP_DASHBOARD_GET_DETAILS");
        Assert.Equal("AGENCY1", FakeSql.Arg(call.Args, "UserId"));
        Assert.Equal("2", FakeSql.Arg(call.Args, "RoleId"));
    }

    [Fact]
    public async Task Counts_accept_only_the_page_filters()
    {
        _host.Sql.Procs["SP_DASHBOARD_COUNTS_BY_FILTERS"] = _ => FakeSql.Sets([new { Total = 40000, Bronze = 2000, Silver = 1000, Gold = 500 }]);
        var client = await _host.SignInAsync("SUPER1");

        var counts = await client.GetFromJsonAsync<JsonElement>("/api/staff/dashboard/counts?state=assam&size=Micro&gender=female");
        Assert.Equal(40000, counts.GetProperty("total").GetInt32());
        var call = _host.LastCall("SP_DASHBOARD_COUNTS_BY_FILTERS");
        Assert.Equal("ASSAM", FakeSql.Arg(call.Args, "State"));
        Assert.Equal("female", FakeSql.Arg(call.Args, "Gender"));

        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/staff/dashboard/counts?state=x' OR 1=1--")).StatusCode);
    }

    [Fact]
    public async Task State_bound_ministry_users_always_get_their_own_state()
    {
        _host.Sql.Procs["SP_DASHBOARD_REGISTERED_MSME"] = _ => FakeSql.Sets([], [new { TotalCounts = 0, PageNo = 1, PageSize = 10 }]);
        var client = await _host.SignInAsync("MINSTATE1");

        (await client.GetAsync("/api/staff/dashboard/registered-msme?state=27")).EnsureSuccessStatusCode();
        Assert.Equal("9", FakeSql.Arg(_host.LastCall("SP_DASHBOARD_REGISTERED_MSME").Args, "State"));

        (await client.GetAsync("/api/staff/dashboard/counts?state=MAHARASHTRA")).EnsureSuccessStatusCode();
        Assert.Equal("UTTAR PRADESH", FakeSql.Arg(_host.LastCall("SP_DASHBOARD_COUNTS_BY_FILTERS").Args, "State"));
    }

    private static object RegisteredRow => new
    {
        RowNumber = 1, ZedId = "ZEDMSME000001", Certification = "Bronze", CertificationPhase = "Certification", PUnitName = "Acme",
        RegisteredDate = new DateTime(2024, 1, 2), AssessmentStatus = "DA Verification in progress", FirstSurveDueDate = (string?)null,
        UnitAddress = "Plot 4", PStateName = "UTTAR PRADESH", CertificationStatus = 3,
        CertificationBodyUserId = "AGENCY1", UserName = "Agency One", UdyogAadharNo = "UDYAM-UP-29-0003915",
        DesktopReasonForRejection = "internal note", EnterpriseName = "Acme Pvt Ltd",
    };

    [Fact]
    public async Task Registered_msme_sends_agency_and_udyam_only_to_super_admin()
    {
        _host.Sql.Procs["SP_DASHBOARD_REGISTERED_MSME"] = _ => FakeSql.Sets([RegisteredRow], [new { TotalCounts = 31, PageNo = 2, PageSize = 10 }]);

        var super = await _host.SignInAsync("SUPER1");
        var list = await super.GetFromJsonAsync<JsonElement>("/api/staff/dashboard/registered-msme?pageNo=2&searchBy=Udyam%20Number&search=UDYAM-UP");
        Assert.Equal(31, list.GetProperty("totalCounts").GetInt32());
        var row = list.GetProperty("rows")[0];
        Assert.Equal("UDYAM-UP-29-0003915", row.GetProperty("UdyogAadharNo").GetString());
        Assert.False(row.TryGetProperty("DesktopReasonForRejection", out _));
        var call = _host.LastCall("SP_DASHBOARD_REGISTERED_MSME");
        Assert.Equal("Udyam Number", FakeSql.Arg(call.Args, "Status"));
        Assert.Equal("UDYAM-UP", FakeSql.Arg(call.Args, "ZedId"));
        Assert.Equal("10", FakeSql.Arg(call.Args, "RoleId"));

        var qc = await _host.SignInAsync("QC1");
        var qcRow = (await qc.GetFromJsonAsync<JsonElement>("/api/staff/dashboard/registered-msme")).GetProperty("rows")[0];
        Assert.Equal("ZEDMSME000001", qcRow.GetProperty("ZedId").GetString());
        Assert.False(qcRow.TryGetProperty("UdyogAadharNo", out _));
        Assert.False(qcRow.TryGetProperty("CertificationBodyUserId", out _));
        Assert.Equal("17", FakeSql.Arg(_host.LastCall("SP_DASHBOARD_REGISTERED_MSME").Args, "RoleId"));
    }

    [Theory]
    [InlineData("?pageSize=5000")]
    [InlineData("?pageNo=0")]
    [InlineData("?searchBy=Password")]
    [InlineData("?certification=Platinum")]
    public async Task Registered_msme_refuses_values_the_page_never_sent(string query)
    {
        var client = await _host.SignInAsync("CFB1");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/staff/dashboard/registered-msme" + query)).StatusCode);
    }

    [Fact]
    public async Task Resend_mails_a_reset_link_instead_of_the_stored_password()
    {
        var resets = new Zed.TestSupport.FakeStaffResets().Attach(_host.Sql.Procs);
        resets.Users["ZEDMSME000001"] = new Zed.TestSupport.FakeStaffResets.User("ZEDMSME000001", 5, true, "owner@acme.test", "Acme");

        var qc = await _host.SignInAsync("QC1");
        Assert.Equal(HttpStatusCode.Forbidden, (await qc.PostAsync("/api/staff/dashboard/registered-msme/ZEDMSME000001/resend", null)).StatusCode);

        var super = await _host.SignInAsync("SUPER1");
        (await super.PostAsync("/api/staff/dashboard/registered-msme/ZEDMSME000001/resend", null)).EnsureSuccessStatusCode();
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("owner@acme.test", mail.To);
        var token = System.Text.RegularExpressions.Regex.Match(mail.HtmlBody, "/msme/reset-password#token=([A-Za-z0-9_-]{43})").Groups[1].Value;
        var row = Assert.Single(resets.Rows);
        Assert.Equal(Zed.Core.Security.PasswordResetTokens.Hash(token), row.TokenHash);
        Assert.Equal("SUPER1", row.RequestedBy);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name is "SP_MSME_PWD_UPDATE_TOKEN" or "SP_RESEND_REGISTRATION_DETAILS");

        // An unknown or inactive unit gets no mail.
        Assert.Equal(HttpStatusCode.BadRequest, (await super.PostAsync("/api/staff/dashboard/registered-msme/ZEDMSME000009/resend", null)).StatusCode);
    }

    [Fact]
    public async Task Disable_is_for_super_admin_and_needs_a_reason()
    {
        var cfb = await _host.SignInAsync("CFB1");
        var denied = await cfb.PostAsJsonAsync("/api/staff/dashboard/registered-msme/ZEDMSME000001/disable", new { disableRemarks = "dup" });
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);

        var super = await _host.SignInAsync("SUPER1");
        Assert.Equal(HttpStatusCode.BadRequest,
            (await super.PostAsJsonAsync("/api/staff/dashboard/registered-msme/ZEDMSME000001/disable", new { disableRemarks = " " })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await super.PostAsJsonAsync("/api/staff/dashboard/registered-msme/ZED%25/disable", new { disableRemarks = "dup" })).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_DISABLE_PLANT");

        (await super.PostAsJsonAsync("/api/staff/dashboard/registered-msme/ZEDMSME000001/disable", new { disableRemarks = "Duplicate unit" })).EnsureSuccessStatusCode();
        var call = _host.LastCall("SP_MSME_DISABLE_PLANT");
        Assert.Equal("SUPER1", FakeSql.Arg(call.Args, "UserId"));
        Assert.Equal("10", FakeSql.Arg(call.Args, "RoleId"));
        Assert.Equal("Duplicate unit", FakeSql.Arg(call.Args, "DisableRemarks"));
    }

    private static object FailedRow(int allow = 1, int coupon = 0) => new
    {
        RowNumber = 1, ZedId = "ZEDMSME000001", Certification = "Silver", TransactionDate = "Mar  4 2026 10:00:00:000AM",
        PUnitName = "Acme", TransactionId = "TX123", EnterpriseTypee = "Micro", Gender = "male", SocialCategoryName = "General",
        IsCouponUsed = coupon, UseCoupon = coupon == 1 ? "Yes" : "No", AllowManualUpdate = allow, PStateName = "ASSAM", PDistrictName = "KAMRUP",
        FinalAmountPaid = 21240, Tds = 2, SubsidyPercentage = 80, GstinNumber = (string?)null, TanNumber = (string?)null,
        Gstin = (string?)null, PanNo = "ABCDE1234F", TanNo = (string?)null, MobileNo = "9999999999", EmailId = "owner@acme.test",
    };

    [Fact]
    public async Task Failed_transactions_return_the_shown_columns_only()
    {
        _host.Sql.Procs["SP_DASHBOARD_PAYMENT_FAILED_TRANSACTIONS"] = _ => FakeSql.Sets([FailedRow()]);
        var super = await _host.SignInAsync("SUPER1");
        var row = (await super.GetFromJsonAsync<JsonElement>("/api/staff/dashboard/failed-transactions?certification=Silver"))[0];
        Assert.Equal("TX123", row.GetProperty("TransactionId").GetString());
        Assert.Equal("ABCDE1234F", row.GetProperty("PanNo").GetString());
        Assert.False(row.TryGetProperty("MobileNo", out _));
        Assert.False(row.TryGetProperty("EmailId", out _));
    }

    private static object UpdateBody(string trackingId = "123456789012", string transactionId = "TX123") => new
    {
        zedId = "ZEDMSME000001", transactionId, certification = "Silver", pgType = "Unified Payments", trackingId,
        bankRefNumber = "BR1", bankCode = "", paymentReceivedDate = "2026-03-04", gstNumber = "22AAAAA0000A1Z5", paymentRemarks = "Bank confirmed",
    };

    [Fact]
    public async Task Update_payment_is_validated_against_the_failed_list()
    {
        var allow = 1;
        var coupon = 0;
        _host.Sql.Procs["SP_DASHBOARD_PAYMENT_FAILED_TRANSACTIONS"] = _ => FakeSql.Sets([FailedRow(allow, coupon)]);
        const string url = "/api/staff/dashboard/failed-transactions/update-payment";

        var cfb = await _host.SignInAsync("CFB1");
        Assert.Equal(HttpStatusCode.Forbidden, (await cfb.PostAsJsonAsync(url, UpdateBody())).StatusCode);

        var super = await _host.SignInAsync("SUPER1");
        Assert.Equal(HttpStatusCode.BadRequest, (await super.PostAsJsonAsync(url, UpdateBody(trackingId: "12345"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await super.PostAsJsonAsync(url, UpdateBody(transactionId: "OTHER"))).StatusCode);
        allow = 0;
        Assert.Equal(HttpStatusCode.BadRequest, (await super.PostAsJsonAsync(url, UpdateBody())).StatusCode);
        allow = 1; coupon = 1;
        Assert.Equal(HttpStatusCode.BadRequest, (await super.PostAsJsonAsync(url, UpdateBody())).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS_WITH_INFO");

        coupon = 0;
        (await super.PostAsJsonAsync(url, UpdateBody())).EnsureSuccessStatusCode();
        var call = _host.LastCall("SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS_WITH_INFO");
        Assert.Equal("10", FakeSql.Arg(call.Args, "RoleId"));
        Assert.Equal("SUPER1", FakeSql.Arg(call.Args, "Userid"));
        Assert.Equal("TX123", FakeSql.Arg(call.Args, "TransactionId"));
        Assert.Equal("22AAAAA0000A1Z5", FakeSql.Arg(call.Args, "GstNumber"));
        // 4 March 00:00 IST, sent as UTC because the procedure adds 5h30.
        Assert.Equal(new DateTime(2026, 3, 3, 18, 30, 0).ToString(), FakeSql.Arg(call.Args, "PaymentReceivedDate"));
    }

    [Fact]
    public async Task Payments_received_is_for_master_admin_with_the_shown_columns()
    {
        _host.Sql.Procs["SP_DASHBOARD_PAYMENT_TRANSACTIONS"] = _ => FakeSql.Sets([new
        {
            RowNumber = 1, ZedId = "ZEDMSME000001", Certification = "Gold", PUnitName = "Acme", FinalAmountPaid = 9000,
            MobileNo = "9999999999", EmailId = "owner@acme.test", PledgeEmailId = "owner@acme.test", OwnerName = "A Kumar",
        }]);
        var master = await _host.SignInAsync("MASTER1");
        var row = (await master.GetFromJsonAsync<JsonElement>("/api/staff/dashboard/payments-received?gender=female"))[0];
        Assert.Equal(9000, row.GetProperty("FinalAmountPaid").GetInt32());
        foreach (var hidden in new[] { "MobileNo", "EmailId", "PledgeEmailId", "OwnerName" })
            Assert.False(row.TryGetProperty(hidden, out _), hidden);
        var call = _host.LastCall("SP_DASHBOARD_PAYMENT_TRANSACTIONS");
        Assert.Equal("female", FakeSql.Arg(call.Args, "Gender"));
        Assert.Null(FakeSql.Arg(call.Args, "PageSize"));
    }

    [Fact]
    public async Task Financial_support_sends_show_all_as_null()
    {
        _host.Sql.Procs["SP_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS"] = _ => FakeSql.Sets([new { ZedId = "ZEDMSME000001", Certification = "Bronze", FinancialSupport = 8000, Gender = "male" }]);
        var cfb = await _host.SignInAsync("CFB1");
        var row = (await cfb.GetFromJsonAsync<JsonElement>("/api/staff/dashboard/financial-support?certification="))[0];
        Assert.Equal(8000, row.GetProperty("FinancialSupport").GetInt32());
        var call = _host.LastCall("SP_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS");
        Assert.Null(FakeSql.Arg(call.Args, "CertificationType"));
        Assert.Equal("11", FakeSql.Arg(call.Args, "RoleId"));
    }

    [Theory]
    [InlineData("MASTER1")]
    [InlineData("SUPER1")]
    [InlineData("CFB1")]
    [InlineData("QC1")]
    public async Task Customer_history_is_for_the_master_admin_and_dashboard_logins_and_takes_plain_zed_ids(string userId)
    {
        _host.Sql.Queries["SELECT Source_DB, ZedId"] = _ => [new
        {
            Source_DB = "CERTIFICATION", ZedId = "ZEDMSME000001", Description = "Registered",
            CreatedDate = new DateTime(2024, 1, 2), CertificationType = (string?)null, StatusType = (string?)null, MiletoneNo = "",
        }];
        var client = await _host.SignInAsync(userId);

        var rows = await client.GetFromJsonAsync<JsonElement>("/api/staff/history/ZEDMSME000001");
        Assert.Equal("Registered", rows[0].GetProperty("Description").GetString());
        Assert.Equal("CERTIFICATION", rows[0].GetProperty("Source_DB").GetString());
        var call = _host.Sql.Calls.Last(c => c.Name.StartsWith("SELECT Source_DB, ZedId"));
        Assert.Equal("ZEDMSME000001", FakeSql.Arg(call.Args, "ZedId"));
        // The three systems' history, without the procedure's MasterAdmin-only gate.
        Assert.Contains("ZEDCS_V2_LIVE.dbo.MsmeHistory", call.Name);
        Assert.Contains("ZED_CONSULTANT.dbo.MsmeHistory", call.Name);
        Assert.Contains("ZED_SURVEILLANCE.dbo.MsmeHistory", call.Name);

        var calls = _host.Sql.Calls.Count(c => c.Name.StartsWith("SELECT Source_DB"));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/staff/history/ZED%25")).StatusCode);
        Assert.Equal(calls, _host.Sql.Calls.Count(c => c.Name.StartsWith("SELECT Source_DB")));
    }
}
