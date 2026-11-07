using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Msme;

namespace Zed.Main.Api.Tests;

/// <summary>"Forgot password" by ZED ID, PAN or e-mail (migration 0053): web login and the ZED MSME app.</summary>
public sealed class MsmeAccountFinderTests : IDisposable
{
    private const string Unit = "ZEDM000123";
    private const string Pan = "ABCDE1234F";
    private readonly TestHost _host = new();
    private readonly Zed.TestSupport.FakeStaffResets _resets;

    public MsmeAccountFinderTests()
    {
        _resets = new Zed.TestSupport.FakeStaffResets().Attach(_host.Sql.Procs);
        _resets.Users[Unit] = new Zed.TestSupport.FakeStaffResets.User(Unit, 5, true, "rakesh@gmail.com", "Acme Foods");
        _resets.Users["ZEDM000456"] = new Zed.TestSupport.FakeStaffResets.User("ZEDM000456", 5, false, "off@acme.test", "Acme Foods 2");
        _host.Sql.Procs["SP_V4_MSME_FIND_ACCOUNTS"] = args =>
            FakeSql.Arg(args, "PanNo") == Pan || FakeSql.Arg(args, "Email") == "owner@acme.test"
                ? FakeSql.Sets([
                    new { ZedId = Unit, UnitName = "Acme Foods Unit 1", DistrictName = "East Delhi", StateName = "Delhi", IsActive = true },
                    new { ZedId = "ZEDM000456", UnitName = "Acme Foods Unit 2", DistrictName = "Kanpur", StateName = "Uttar Pradesh", IsActive = false },
                ])
                : FakeSql.Sets([]);
    }

    public void Dispose() => _host.Dispose();

    private static async Task<JsonElement> Json(HttpResponseMessage r) => JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement.Clone();

    [Fact]
    public void Masks_keep_only_a_few_characters()
    {
        Assert.Equal("ZEDM•••123", MsmeAccountFinder.MaskZedId("ZEDM000123"));
        Assert.Equal("ZEDM•••••••588", MsmeAccountFinder.MaskZedId("ZEDMSME1092588"));
        Assert.Equal("ra•••••@gm•••.com", MsmeAccountFinder.MaskEmail("rakesh@gmail.com"));
        Assert.Equal("a•••••@q•••.org.in", MsmeAccountFinder.MaskEmail("a@q.org.in"));
    }

    [Fact]
    public async Task Web_lists_the_units_of_a_pan_without_email_or_full_zed_id_and_mails_the_chosen_one()
    {
        var client = await _host.CreateBrowserAsync();
        var found = await client.PostAsJsonAsync("/api/msme/auth/forgot-password/find", new { by = "pan", value = "abcde1234f" });
        Assert.Equal(HttpStatusCode.OK, found.StatusCode);
        var body = await found.Content.ReadAsStringAsync();
        Assert.DoesNotContain(Unit, body);
        Assert.DoesNotContain("@", body);
        var units = (await Json(found)).GetProperty("units");
        Assert.Equal(2, units.GetArrayLength());
        Assert.Equal("Acme Foods Unit 1", units[0].GetProperty("unitName").GetString());
        Assert.Equal("East Delhi", units[0].GetProperty("district").GetString());
        Assert.Equal("ZEDM•••123", units[0].GetProperty("zedId").GetString());

        var sent = await client.PostAsJsonAsync("/api/msme/auth/forgot-password/send", new { @ref = units[0].GetProperty("ref").GetString() });
        Assert.Equal(HttpStatusCode.OK, sent.StatusCode);
        Assert.Equal("ra•••••@gm•••.com", (await Json(sent)).GetProperty("maskedEmail").GetString());
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("rakesh@gmail.com", mail.To);
        Assert.Equal("MSME Reset Password Details - " + Unit, mail.Subject);
        Assert.Contains(Unit, mail.HtmlBody);

        // The inactive unit gets no link; a made-up or changed reference is refused.
        var inactive = await client.PostAsJsonAsync("/api/msme/auth/forgot-password/send", new { @ref = units[1].GetProperty("ref").GetString() });
        Assert.Equal(HttpStatusCode.BadRequest, inactive.StatusCode);
        var forged = await client.PostAsJsonAsync("/api/msme/auth/forgot-password/send", new { @ref = "ZEDM000123" });
        Assert.Equal(HttpStatusCode.BadRequest, forged.StatusCode);
        Assert.Single(_host.Email.Sent);
    }

    [Fact]
    public async Task Web_refuses_a_bad_pan_or_email_and_says_when_nothing_is_found()
    {
        var client = await _host.CreateBrowserAsync();
        var bad = await client.PostAsJsonAsync("/api/msme/auth/forgot-password/find", new { by = "pan", value = "12345" });
        Assert.Equal(MsmeAccountFinder.InvalidPan, await bad.ProblemTitle());
        var badMail = await client.PostAsJsonAsync("/api/msme/auth/forgot-password/find", new { by = "email", value = "not-an-address" });
        Assert.Equal(MsmeAccountFinder.InvalidEmail, await badMail.ProblemTitle());
        var none = await client.PostAsJsonAsync("/api/msme/auth/forgot-password/find", new { by = "email", value = "nobody@acme.test" });
        Assert.Equal(MsmeAccountFinder.NotFound, await none.ProblemTitle());
    }

    [Fact]
    public async Task App_finds_by_email_and_sends_the_link_with_the_masked_address()
    {
        var app = _host.CreateClient();
        var found = await Json(await app.PostAsJsonAsync("/Msme/FindAccounts", new { by = "email", value = "owner@acme.test" }));
        Assert.Equal("1", found.GetProperty("status").GetString());
        var units = found.GetProperty("Units");
        Assert.Equal(2, units.GetArrayLength());
        Assert.Equal("ZEDM•••123", units[0].GetProperty("ZedId").GetString());

        var sent = await Json(await app.PostAsJsonAsync("/Msme/SendResetLink", new { reference = units[0].GetProperty("Ref").GetString() }));
        Assert.Equal("1", sent.GetProperty("status").GetString());
        Assert.Equal("ra•••••@gm•••.com", sent.GetProperty("MaskedEmail").GetString());
        Assert.Equal("rakesh@gmail.com", Assert.Single(_host.Email.Sent).To);

        var none = await Json(await app.PostAsJsonAsync("/Msme/FindAccounts", new { by = "pan", value = "ZZZZZ9999Z" }));
        Assert.Equal("0", none.GetProperty("status").GetString());
        Assert.Equal(MsmeAccountFinder.NotFound, none.GetProperty("errorMessage").GetString());
    }
}
