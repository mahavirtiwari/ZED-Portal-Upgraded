using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Zed.Main.Api.Tests.Staff;

public sealed class NeftTests : IDisposable
{
    private readonly TestHost _host = new();

    // FinancialAssistance rows joined with Msme, as SP_NEFT_TRANSACTIONS_BY_STATUS returns them.
    private readonly List<Dictionary<string, object?>> _rows =
    [
        Row(11, "ZEDMSME000011", state: 9, verification: 4, transaction: null),   // UP, new
        Row(12, "ZEDMSME000012", state: 27, verification: 4, transaction: null),  // Maharashtra, new
        Row(13, "ZEDMSME000013", state: 9, verification: 4, transaction: 2),      // UP, rejected
        Row(14, "ZEDMSME000014", state: 9, verification: 6, transaction: 1),      // UP, reimbursed
        Row(15, "ZEDMSME000015", state: 9, verification: 4, transaction: 1),      // UP, approved but status not moved
    ];

    private static Dictionary<string, object?> Row(int id, string zedId, int state, int verification, int? transaction) => new()
    {
        ["Id"] = 900 + id, // Msme.Id comes first in the procedure's SELECT M.*, F.*
        ["TransactionId"] = id, ["ZedId"] = zedId, ["StateId"] = state, ["PStateId"] = null, ["PUnitName"] = "Unit " + zedId,
        ["CertificationType"] = "Bronze", ["VerificationStatus"] = verification, ["TransactionStatus"] = transaction,
        ["AmountPaid"] = "50000", ["AccountNo"] = "123456789012", ["IfscCode"] = "SBIN0001234", ["Password"] = "msme-password",
        ["OTP"] = "1234", ["UdyogAadharNo"] = "UDYAM-UP-01-0000011", ["TotalEmp"] = 25, ["Gender"] = "Male",
        ["SocialCategoryName"] = "General", ["IsCouponUsed"] = true,
    };

    public NeftTests()
    {
        SchemesTestUsers.Register(_host);
        _host.Sql.Procs["SP_NEFT_TRANSACTIONS_BY_STATUS"] = args => FakeSql.Arg(args, "Status") == "1"
            ? FakeSql.Sets(_rows.Where(r => (int)r["VerificationStatus"]! == 6).Cast<object>())
            : FakeSql.Sets(_rows.Where(r => (int)r["VerificationStatus"]! == 4).Cast<object>());
        _host.Sql.Procs["SP_EMAIL_GET_DETAILS_FA"] = _ => FakeSql.Sets([new
        {
            EmailId = "msme@acme.test", EnterpriseName = "Acme & <i>Sons</i>", CategoryOfCertificate = "Product Certification", Password = "x",
        }]);
    }

    public void Dispose() => _host.Dispose();

    private Task<HttpClient> SignIn(string user) => SchemesTestUsers.SignInAsync(_host, user);

    private IEnumerable<object?> Updates => _host.Sql.Calls.Where(c => c.Name == "SP_NEFT_UPDATE_TRANSACTION_STATUS").Select(c => c.Args);

    private static object Approval(string zedId, string? date = null, string reference = "UTR123456", string amount = "40000") =>
        new { zedId, dateOfReceiptOfPayment = date ?? DateTime.Now.ToString("yyyy-MM-dd"), referenceNo = reference, amount, status = "1", userId = "SOMEONE" };

    private static List<string?> ZedIds(JsonElement json) =>
        json.GetProperty("transactions").EnumerateArray().Select(t => t.GetProperty("ZedId").GetString()).ToList();

    [Fact]
    public async Task Endpoints_require_sign_in()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/staff/neft/transactions?list=new")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/staff/neft/transactions/11/approve", Approval("ZEDMSME000011"))).StatusCode);
        Assert.Empty(Updates);
    }

    [Theory]
    [InlineData("MADMIN")]
    [InlineData("SUPER1")]
    [InlineData("AGENCY1")]
    [InlineData("DA1")]
    public async Task Only_state_coordinators_can_use_neft(string user)
    {
        var client = await SignIn(user);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/staff/neft/transactions?list=new")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/staff/neft/transactions/11/approve", Approval("ZEDMSME000011"))).StatusCode);
        Assert.Empty(Updates);
    }

    [Fact]
    public async Task Lists_show_only_the_coordinators_state_and_no_sensitive_columns()
    {
        var up = await SignIn("SC_UP");
        Assert.Equal(["ZEDMSME000011"], ZedIds(await up.GetFromJsonAsync<JsonElement>("/api/staff/neft/transactions?list=new")));
        Assert.Equal(["ZEDMSME000013"], ZedIds(await up.GetFromJsonAsync<JsonElement>("/api/staff/neft/transactions?list=rejected")));
        Assert.Equal(["ZEDMSME000014"], ZedIds(await up.GetFromJsonAsync<JsonElement>("/api/staff/neft/transactions?list=approved")));

        var json = await up.GetFromJsonAsync<JsonElement>("/api/staff/neft/transactions");
        var t = json.GetProperty("transactions")[0];
        Assert.Equal(11, t.GetProperty("TransactionId").GetInt32());
        Assert.False(t.TryGetProperty("Password", out _));
        Assert.False(t.TryGetProperty("OTP", out _));
        Assert.False(t.TryGetProperty("Id", out _));

        var mh = await SignIn("SC_MH");
        Assert.Equal(["ZEDMSME000012"], ZedIds(await mh.GetFromJsonAsync<JsonElement>("/api/staff/neft/transactions?list=new")));

        // A coordinator without a state sees nothing (unless listed in Neft:AllStatesUserIds).
        var none = await SignIn("SC_NONE");
        Assert.Empty(ZedIds(await none.GetFromJsonAsync<JsonElement>("/api/staff/neft/transactions?list=new")));
        Assert.Equal(HttpStatusCode.BadRequest, (await none.GetAsync("/api/staff/neft/transactions?list=all")).StatusCode);
    }

    [Fact]
    public async Task Lists_include_the_unit_columns_of_the_legacy_rejected_page()
    {
        var up = await SignIn("SC_UP");
        var t = (await up.GetFromJsonAsync<JsonElement>("/api/staff/neft/transactions?list=rejected")).GetProperty("transactions")[0];
        Assert.Equal("UDYAM-UP-01-0000011", t.GetProperty("UdyogAadharNo").GetString());
        Assert.Equal(25, t.GetProperty("TotalEmp").GetInt32());
        Assert.Equal("Male", t.GetProperty("Gender").GetString());
        Assert.Equal("General", t.GetProperty("SocialCategoryName").GetString());
        Assert.True(t.GetProperty("IsCouponUsed").GetBoolean());
        // GSTIN / TAN / UTR are not returned by the procedure (MsmePaymentInfo is not joined).
        Assert.False(t.TryGetProperty("GstinNumber", out _));
    }

    [Fact]
    public async Task Approve_records_the_payment_with_database_values_audits_and_mails_the_msme()
    {
        var up = await SignIn("SC_UP");
        var r = await up.PostAsJsonAsync("/api/staff/neft/transactions/11/approve", Approval("ZEDMSME000011", date: "2026-01-05", amount: "40000.5"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var call = Assert.Single(Updates);
        Assert.Equal("1", FakeSql.Arg(call, "Status"));
        Assert.Equal("11", FakeSql.Arg(call, "TransactionId"));
        Assert.Equal("ZEDMSME000011", FakeSql.Arg(call, "ZedId"));
        Assert.Equal("2026-01-05", FakeSql.Arg(call, "DateOfReceiptOfPayment"));
        Assert.Equal("UTR123456", FakeSql.Arg(call, "ApproverReferenceNo"));
        Assert.Equal("40000.50", FakeSql.Arg(call, "ApproverAmount"));

        var history = Assert.Single(_host.Sql.Calls, c => c.Name.StartsWith("INSERT INTO MsmeHistory"));
        Assert.Contains("SC_UP", FakeSql.Arg(history.Args, "Descrip"));
        Assert.Equal("ZEDMSME000011", FakeSql.Arg(history.Args, "ZedId"));

        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("msme@acme.test", mail.To);
        Assert.Contains("ZEDMSME000011", mail.Subject);
        Assert.Contains("Acme &amp; &lt;i&gt;Sons&lt;/i&gt;", mail.HtmlBody);
        Assert.Contains("40000.50", mail.HtmlBody);
        Assert.Contains("05-Jan-2026", mail.HtmlBody);
    }

    [Fact]
    public async Task Approve_is_refused_for_another_state_or_a_mismatched_zed_id()
    {
        var mh = await SignIn("SC_MH");
        Assert.Equal(HttpStatusCode.NotFound, (await mh.PostAsJsonAsync("/api/staff/neft/transactions/11/approve", Approval("ZEDMSME000011"))).StatusCode);
        var up = await SignIn("SC_UP");
        Assert.Equal(HttpStatusCode.NotFound, (await up.PostAsJsonAsync("/api/staff/neft/transactions/11/approve", Approval("ZEDMSME000012"))).StatusCode);
        Assert.Empty(Updates);
        Assert.Empty(_host.Email.Sent);
    }

    [Theory]
    [InlineData(13)] // rejected
    [InlineData(15)] // already approved
    public async Task A_transaction_is_approved_only_once(int id)
    {
        var up = await SignIn("SC_UP");
        var r = await up.PostAsJsonAsync($"/api/staff/neft/transactions/{id}/approve", Approval($"ZEDMSME0000{id}"));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal("This transaction has already been processed.", await r.ProblemTitle());
        // Reimbursed rows are not in the "new" list at all.
        Assert.Equal(HttpStatusCode.NotFound, (await up.PostAsJsonAsync("/api/staff/neft/transactions/14/approve", Approval("ZEDMSME000014"))).StatusCode);
        Assert.Empty(Updates);
    }

    [Fact]
    public async Task Second_approval_after_the_status_moved_is_refused()
    {
        var up = await SignIn("SC_UP");
        Assert.Equal(HttpStatusCode.OK, (await up.PostAsJsonAsync("/api/staff/neft/transactions/11/approve", Approval("ZEDMSME000011"))).StatusCode);
        // What the procedure does for Status=1.
        _rows[0]["TransactionStatus"] = 1;
        _rows[0]["VerificationStatus"] = 6;
        Assert.Equal(HttpStatusCode.NotFound, (await up.PostAsJsonAsync("/api/staff/neft/transactions/11/approve", Approval("ZEDMSME000011"))).StatusCode);
        Assert.Single(Updates);
    }

    [Theory]
    [InlineData("2999-01-01", "UTR1", "100")]       // future date
    [InlineData("05/01/2026", "UTR1", "100")]       // not ISO
    [InlineData(null, "", "100")]                   // no reference
    [InlineData(null, "<script>", "100")]           // bad reference
    [InlineData(null, "UTR1", "0")]
    [InlineData(null, "UTR1", "-5")]
    [InlineData(null, "UTR1", "12.345")]
    [InlineData(null, "UTR1", "1e5")]
    [InlineData(null, "UTR1", "50000.01")]          // more than the unit paid
    public async Task Invalid_payment_details_are_refused(string? date, string reference, string amount)
    {
        var up = await SignIn("SC_UP");
        var r = await up.PostAsJsonAsync("/api/staff/neft/transactions/11/approve", Approval("ZEDMSME000011", date, reference, amount));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Empty(Updates);
    }
}
