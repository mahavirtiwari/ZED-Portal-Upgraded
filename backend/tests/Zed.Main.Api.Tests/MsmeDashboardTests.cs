using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Zed.Main.Api.Tests;

public sealed class MsmeDashboardTests : IDisposable
{
    private readonly TestHost _host = new();

    public MsmeDashboardTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args => FakeSql.Arg(args, "UserId") switch
        {
            "ZEDMSME000001" => FakeSql.Sets([new { UserId = "ZEDMSME000001", UserName = "Acme", RoleId = 5, Email = "a@acme.test" }], [new { ERRORMSG = "SUCCESS" }]),
            "AGENCY1" => FakeSql.Sets([new { UserId = "AGENCY1", UserName = "Agency", RoleId = 2, Email = "x@agency.test" }], [new { ERRORMSG = "SUCCESS" }]),
            _ => FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]),
        };
        _host.Sql.Procs["SP_MSME_GET_DETAILS"] = args => FakeSql.Sets(
            [new Dictionary<string, object?> { ["ZedId"] = FakeSql.Arg(args, "ZedId"), ["EnterpriseName"] = "Acme", ["Password"] = "secret", ["IsBronzePaymentDone"] = 1 }],
            [new Dictionary<string, object?> { ["UdyogAadharNo"] = "UDYAM-UP-29-0003915", ["PanNo"] = "ABCDE1234F", ["ReCertification"] = 0 }],
            [new Dictionary<string, object?> { ["BronzeStatus"] = 3, ["SilverStatus"] = 0, ["GoldStatus"] = 0, ["PledgePath"] = "Certificates" }]);
    }

    public void Dispose() => _host.Dispose();

    private async Task<HttpClient> SignedInAsync(string userId = "ZEDMSME000001")
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    [Fact]
    public async Task Dashboard_requires_a_signed_in_msme()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/msme/dashboard")).StatusCode);
    }

    [Fact]
    public async Task Dashboard_returns_only_the_fields_the_page_uses_for_the_signed_in_zed_id()
    {
        var client = await SignedInAsync();
        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/dashboard?zedId=ZEDMSME999999");

        var call = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_GET_DETAILS");
        Assert.Equal("ZEDMSME000001", FakeSql.Arg(call.Args, "ZedId"));
        Assert.Null(FakeSql.Arg(call.Args, "CertificationType"));

        Assert.Equal("Acme", json.GetProperty("msme").GetProperty("EnterpriseName").GetString());
        Assert.Equal(3, json.GetProperty("certStatus").GetProperty("BronzeStatus").GetInt32());
        Assert.False(json.GetProperty("msme").TryGetProperty("Password", out _));
        Assert.False(json.GetProperty("basicInfo").TryGetProperty("PanNo", out _));
    }

    [Fact]
    public async Task Dashboard_incentive_cards_are_the_admins_with_safe_links()
    {
        _host.Sql.Queries[Zed.Portal.Features.Msme.MsmeDashboardController.BuiltInCardsSql] = _ =>
            [new { Card = "HANDHOLDING", Title = "Handholding Support", Highlight = "Rs. 2,00,000/-", Details = "Systems", Active = false }];
        _host.Sql.Queries[Zed.Portal.Features.Msme.MsmeDashboardController.IncentiveCardsSql] = _ =>
        [
            new { Id = 57L, Title = "Scheme B", Highlight = "Rs. 5,000/-", Details = "D", Department = "MoMSME", ContactPerson = "Officer", Email = "o@msme.gov.in",
                  MobileNo = "011", WebLink = "javascript:alert(1)", VideoLink = "https://youtu.be/x", ApplicableForBronze = true, ApplicableForSilver = false, ApplicableForGold = false },
        ];
        var client = await SignedInAsync();
        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/dashboard/incentives");
        var builtIn = json.GetProperty("builtIn")[0];
        Assert.Equal(("HANDHOLDING", false), (builtIn.GetProperty("card").GetString(), builtIn.GetProperty("active").GetBoolean()));
        // MSME KAWACH was removed: its row (migration 0026) is never read.
        Assert.Contains("DashboardCard <> 'KAWACH'", Zed.Portal.Features.Msme.MsmeDashboardController.BuiltInCardsSql);
        var card = json.GetProperty("incentives")[0];
        Assert.Equal(JsonValueKind.Null, card.GetProperty("webLink").ValueKind);
        Assert.Equal("https://youtu.be/x", card.GetProperty("videoLink").GetString());
        Assert.Equal(HttpStatusCode.Unauthorized, (await (await _host.CreateBrowserAsync()).GetAsync("/api/msme/dashboard/incentives")).StatusCode);
    }

    [Fact]
    public async Task Incentive_cards_of_the_other_activity_are_left_out_and_zedx_is_given()
    {
        // 2026-11-16 (migration 0091): a Manufacturing unit does not see a Services-only incentive.
        object Card(long id, string? activity, bool zedx = false) => new
        {
            Id = id, Title = $"Scheme {id}", Highlight = (string?)null, Details = "D", Department = "MoMSME", ContactPerson = "Officer", Email = "o@msme.gov.in",
            MobileNo = "011", WebLink = "https://msme.gov.in", VideoLink = (string?)null, ApplicableForBronze = !zedx, ApplicableForSilver = false,
            ApplicableForGold = false, ApplicableForZEDX = zedx, ApplicableActivity = activity,
        };
        _host.Sql.Queries[Zed.Portal.Features.Msme.MsmeDashboardController.BuiltInCardsSql] = _ => [];
        _host.Sql.Queries[Zed.Portal.Features.Msme.MsmeDashboardController.IncentiveCardsSql] = _ =>
            [Card(1, null), Card(2, "Services"), Card(3, "Manufacturing", zedx: true)];
        _host.Sql.Queries[Zed.Portal.Features.Msme.MsmeDashboardController.ActivitySql] = _ => [new { MajorActivityName = "Manufacturing" }];
        var json = await (await SignedInAsync()).GetFromJsonAsync<JsonElement>("/api/msme/dashboard/incentives");
        var cards = json.GetProperty("incentives").EnumerateArray().ToList();
        Assert.Equal([1L, 3L], cards.Select(c => c.GetProperty("id").GetInt64()));
        Assert.True(cards[1].GetProperty("applicableForZEDX").GetBoolean());

        // The ZED MSME app's public list keeps every card (it has no unit to filter by).
        var app = await (await _host.CreateBrowserAsync()).GetFromJsonAsync<JsonElement>("/api/public/incentive-cards");
        Assert.Equal(3, app.GetProperty("incentives").GetArrayLength());
    }

    /// <summary>The names of a SELECT's columns (the alias, else the column), in order.</summary>
    private static List<string> SelectedColumns(string sql)
    {
        var list = sql[(sql.IndexOf("SELECT ", StringComparison.Ordinal) + 7)..sql.IndexOf(" FROM ", StringComparison.Ordinal)];
        var names = new List<string>();
        var depth = 0;
        var start = 0;
        for (var i = 0; i <= list.Length; i++)
        {
            if (i < list.Length && list[i] == '(') depth++;
            else if (i < list.Length && list[i] == ')') depth--;
            else if (i == list.Length || (list[i] == ',' && depth == 0))
            {
                var item = list[start..i].Trim();
                var alias = item.LastIndexOf(" AS ", StringComparison.OrdinalIgnoreCase);
                names.Add(alias >= 0 && !item[alias..].Contains(')') ? item[(alias + 4)..].Trim() : item);
                start = i + 1;
            }
        }
        return names;
    }

    [Fact]
    public void Incentive_card_rows_are_read_by_dapper_as_the_server_reads_them()
    {
        // 2026-11-19 (admin audit): GET api/public/incentive-cards answered 500 every time. The test host converts rows through
        // JSON, but the server reads them with Dapper, which builds a positional record only through a constructor with exactly
        // the selected columns, in order and type, and checks it before reading any row. ApplicableForZEDX and
        // ApplicableActivity were init properties: 15 columns, a 13-parameter constructor, so every read threw.
        (string Name, Type Type, object Value)[] incentive =
        [
            ("Id", typeof(long), 57L), ("Title", typeof(string), "Scheme B"), ("Highlight", typeof(string), "Rs. 5,000/-"), ("Details", typeof(string), "D"),
            ("Department", typeof(string), "MoMSME"), ("ContactPerson", typeof(string), "Officer"), ("Email", typeof(string), "o@msme.gov.in"),
            ("MobileNo", typeof(string), "011"), ("WebLink", typeof(string), "https://msme.gov.in"), ("VideoLink", typeof(string), DBNull.Value),
            ("ApplicableForBronze", typeof(bool), true), ("ApplicableForSilver", typeof(bool), false), ("ApplicableForGold", typeof(bool), false),
            ("ApplicableForZEDX", typeof(bool), true), ("ApplicableActivity", typeof(string), "Services"),
        ];
        (string Name, Type Type, object Value)[] builtIn =
        [
            ("Card", typeof(string), "HANDHOLDING"), ("Title", typeof(string), "Handholding Support"), ("Highlight", typeof(string), DBNull.Value),
            ("Details", typeof(string), "Systems"), ("Active", typeof(bool), true),
        ];
        Assert.Equal(incentive.Select(c => c.Name), SelectedColumns(Zed.Portal.Features.Msme.MsmeDashboardController.IncentiveCardsSql));
        Assert.Equal(builtIn.Select(c => c.Name), SelectedColumns(Zed.Portal.Features.Msme.MsmeDashboardController.BuiltInCardsSql));

        static System.Data.DataTableReader Reader((string Name, Type Type, object Value)[] columns)
        {
            var table = new System.Data.DataTable();
            foreach (var c in columns) table.Columns.Add(c.Name, c.Type);
            table.Rows.Add(columns.Select(c => c.Value).ToArray());
            return table.CreateDataReader();
        }

        var card = Assert.Single(Dapper.SqlMapper.Parse<Zed.Portal.Features.Msme.MsmeDashboardController.IncentiveCard>(Reader(incentive)).ToList());
        Assert.Equal((57L, "Scheme B", true, "Services", (string?)null), (card.Id, card.Title, card.ApplicableForZEDX, card.ApplicableActivity, card.VideoLink));
        var shown = Assert.Single(Dapper.SqlMapper.Parse<Zed.Portal.Features.Msme.MsmeDashboardController.BuiltInCard>(Reader(builtIn)).ToList());
        Assert.Equal(("HANDHOLDING", true), (shown.Card, shown.Active));
    }

    [Fact]
    public async Task Dashboard_gives_the_zedx_flag_and_status()
    {
        var client = await SignedInAsync();
        var none = await client.GetFromJsonAsync<JsonElement>("/api/msme/dashboard");
        Assert.Equal(0, none.GetProperty("certStatus").GetProperty("ZEDXStatus").GetInt32());

        _host.Sql.Queries[Zed.Portal.Features.Msme.MsmeDashboardController.ZedXSql] = _ => [new { PaymentDone = 1, Status = (int?)null }];
        var paid = await client.GetFromJsonAsync<JsonElement>("/api/msme/dashboard");
        Assert.Equal(1, paid.GetProperty("msme").GetProperty("IsZEDXPaymentDone").GetInt32());
        Assert.Equal(1, paid.GetProperty("certStatus").GetProperty("ZEDXStatus").GetInt32());

        _host.Sql.Queries[Zed.Portal.Features.Msme.MsmeDashboardController.ZedXSql] = _ => [new { PaymentDone = 1, Status = (int?)16 }];
        Assert.Equal(16, (await client.GetFromJsonAsync<JsonElement>("/api/msme/dashboard")).GetProperty("certStatus").GetProperty("ZEDXStatus").GetInt32());
    }

    [Fact]
    public async Task Dashboard_gives_the_date_each_certified_level_was_certified()
    {
        // 2026-11-18 (the user's applicant designs): "Certified 14 Nov 2026", the validity end and the next surveillance.
        var client = await SignedInAsync();
        Assert.Equal(0, (await client.GetFromJsonAsync<JsonElement>("/api/msme/dashboard")).GetProperty("certifiedOn").EnumerateObject().Count());

        _host.Sql.Queries[Zed.Portal.Features.Msme.MsmeDashboardController.CertifiedOnSql] = _ =>
        [
            new { Level = "Bronze", Status = (int?)6, At = (DateTime?)new DateTime(2026, 11, 14, 10, 30, 0) },
            // Silver at 6 has passed its desktop check only: not certified.
            new { Level = "Silver", Status = (int?)6, At = (DateTime?)new DateTime(2026, 11, 15) },
            new { Level = "ZEDX", Status = (int?)16, At = (DateTime?)new DateTime(2027, 1, 2) },
        ];
        var on = (await client.GetFromJsonAsync<JsonElement>("/api/msme/dashboard")).GetProperty("certifiedOn");
        Assert.Equal("2026-11-14", on.GetProperty("Bronze").GetString());
        Assert.False(on.TryGetProperty("Silver", out _));
        Assert.Equal("2027-01-02", on.GetProperty("ZEDX").GetString());
        var call = _host.Sql.Calls.Last(c => c.Name == Zed.Portal.Features.Msme.MsmeDashboardController.CertifiedOnSql);
        Assert.Equal("ZEDMSME000001", FakeSql.Arg(call.Args, "ZedId"));
    }

    [Fact]
    public async Task Dashboard_is_forbidden_for_staff_roles()
    {
        // Staff cannot sign in through the MSME login, so sign in directly with the cookie helper route.
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = "AGENCY1", password = "Right#Pass1" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/msme/dashboard")).StatusCode);
    }
}

public sealed class AccountTests : IDisposable
{
    private readonly TestHost _host = new();

    public AccountTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = _ =>
            FakeSql.Sets([new { UserId = "ZEDMSME000001", UserName = "Acme", RoleId = 5, Email = "a@acme.test" }], [new { ERRORMSG = "SUCCESS" }]);
        _host.Sql.Procs["SP_GET_USER_DETAILS_BY_USER_ID"] = _ =>
            FakeSql.Sets([new { UserId = "ZEDMSME000001", UserName = "Acme", Password = "Old#Pass1", Email = "a@acme.test" }]);
    }

    public void Dispose() => _host.Dispose();

    private async Task<HttpClient> SignedInAsync()
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = "ZEDMSME000001", password = "Old#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    [Fact]
    public async Task Wrong_old_password_is_rejected()
    {
        var client = await SignedInAsync();
        var r = await client.PostAsJsonAsync("/api/account/change-password", new { oldPassword = "nope", newPassword = "New#Pass12", confirmPassword = "New#Pass12" });
        Assert.Equal("Invalid Old Password.", await r.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("UPDATE Users"));
    }

    [Fact]
    public async Task Change_password_updates_mails_without_the_password_and_signs_out()
    {
        var client = await SignedInAsync();
        var r = await client.PostAsJsonAsync("/api/account/change-password", new { oldPassword = "Old#Pass1", newPassword = "New#Pass12", confirmPassword = "New#Pass12" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var update = Assert.Single(_host.Sql.Calls, c => c.Name.StartsWith("UPDATE Users"));
        Assert.Equal("ZEDMSME000001", FakeSql.Arg(update.Args, "UserId"));
        Assert.DoesNotContain("New#Pass12", Assert.Single(_host.Email.Sent).HtmlBody);
        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Change_password_requires_sign_in()
    {
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync("/api/account/change-password", new { oldPassword = "a", newPassword = "New#Pass12", confirmPassword = "New#Pass12" });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }
}

public sealed class ContactTests : IDisposable
{
    private readonly TestHost _host = new();
    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task Query_is_stored_and_mailed_with_user_text_html_encoded()
    {
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync("/api/contact", new
        {
            name = "<b>Ravi</b>", mobile = "9999999999", email = "ravi@example.test", query = "Line 1\n<script>alert(1)</script>",
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var call = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_INSERT_QUERY");
        Assert.Equal("9999999999", FakeSql.Arg(call.Args, "MobileNumber"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("zed.support@example.test", mail.To);
        Assert.DoesNotContain("<script>", mail.HtmlBody);
        Assert.Contains("&lt;script&gt;", mail.HtmlBody);
    }

    [Theory]
    [InlineData("", "9999999999", "a@b.test", "q")]
    [InlineData("Ravi", "123", "a@b.test", "q")]
    [InlineData("Ravi", "9999999999", "not-an-email", "q")]
    public async Task Invalid_input_is_rejected(string name, string mobile, string email, string query)
    {
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync("/api/contact", new { name, mobile, email, query });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_INSERT_QUERY");
    }
}
