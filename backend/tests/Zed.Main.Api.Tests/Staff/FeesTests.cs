using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Staff.Fees;

namespace Zed.Main.Api.Tests.Staff;

public sealed class FeesTests : IDisposable
{
    private readonly TestHost _host = new();

    private static Dictionary<string, object?> Row(int id, string type, string level, decimal fee, decimal? coupon, decimal subsidyPct, int special = 0) => new()
    {
        ["Id"] = id, ["EnterpriseTypee"] = type, ["Certification"] = level, ["AssessmentFee"] = fee, ["Gst"] = fee * 0.18m, ["Total"] = fee * 1.18m,
        ["Coupon"] = coupon, ["AssessmentFeeAfterCoupon"] = null, ["GstAfterCoupon"] = null, ["TotalAfterCoupon"] = null,
        ["SubsidyPer"] = 0m, ["SubsidyAmount"] = 0m, ["GstAfterSubsidy"] = 0m, ["ApplicantContributionAfterSubsidy"] = 0m,
        ["Tds15"] = 0m, ["Tds75"] = 0m, ["NetPaybleTds15"] = 0m, ["NetPaybleTds75"] = 0m,
        ["IsActive"] = true, ["SpecialCategory"] = special, ["SubsidyPercentage"] = subsidyPct,
    };

    public FeesTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Procs["SP_MASTER_GET_ASSESSMENT_FEE"] = args => FakeSql.Arg(args, "MsmeType") switch
        {
            "Micro" => FakeSql.Sets(
            [
                Row(1, "Micro", "Bronze", 10000m, null, 80m),
                Row(2, "Micro", "Silver", 20000m, null, 80m),
                Row(3, "Micro", "Bronze", 10000m, 1000m, 80m),
                Row(4, "Micro", "Bronze", 9000m, null, 100m, 1),
            ]),
            "Rejected" => FakeSql.Sets([Row(9, "Rejected", "Bronze", 10000m, null, 0m)]),
            _ => FakeSql.Sets([]),
        };
    }

    public void Dispose() => _host.Dispose();

    /// <summary>The row saves: one batch per row (the share and the amounts in one transaction).</summary>
    private List<(string Name, object? Args)> Updates() =>
        _host.Sql.Calls.Where(c => c.Name.Contains("SP_MASTER_UPDATE_ASSESSMENT_FEE", StringComparison.Ordinal)).ToList();

    private static decimal Dec(object? args, string name) => decimal.Parse(FakeSql.Arg(args, name)!, System.Globalization.CultureInfo.CurrentCulture);

    [Fact]
    public async Task Anonymous_gets_401_and_other_staff_roles_403()
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/staff/fees/Micro")).StatusCode);
        foreach (var user in new[] { "MASTER1", "AGENCY1", "SUPER1", "ASSESSOR1" })
        {
            var client = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/staff/fees/Micro")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.PutAsJsonAsync("/api/staff/fees/Micro",
                new { levels = new[] { new { certification = "Bronze", assessmentFee = 1m, coupon = 0m } } })).StatusCode);
        }
        Assert.Empty(Updates());
    }

    [Fact]
    public async Task Lists_rows_and_level_inputs()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/staff/fees/Huge")).StatusCode);
        var body = await admin.GetFromJsonAsync<JsonElement>("/api/staff/fees/micro");
        Assert.Equal("Micro", body.GetProperty("enterpriseType").GetString());
        Assert.Equal(4, body.GetProperty("rows").GetArrayLength());
        var bronze = body.GetProperty("levels")[0];
        Assert.Equal("Bronze", bronze.GetProperty("certification").GetString());
        Assert.Equal(1000m, bronze.GetProperty("coupon").GetDecimal());
        Assert.True(bronze.GetProperty("hasCouponRows").GetBoolean());
        Assert.False(body.GetProperty("levels")[1].GetProperty("hasCouponRows").GetBoolean());
    }

    [Fact]
    public async Task Derived_amounts_are_computed_on_the_server_and_only_changed_rows_saved()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.PutAsJsonAsync("/api/staff/fees/Micro",
            new { levels = new[] { new { certification = "Bronze", assessmentFee = 10000m, coupon = 1800m, total = 1m, applicantContributionAfterSubsidy = 1m } } });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var updates = Updates();
        Assert.DoesNotContain(updates, u => FakeSql.Arg(u.Args, "Id") == "2"); // Silver not in the request
        var plain = updates.Single(u => FakeSql.Arg(u.Args, "Id") == "1").Args;
        Assert.Equal(1800m, Dec(plain, "Gst"));
        Assert.Equal(11800m, Dec(plain, "Total"));
        Assert.Equal(2000m, Dec(plain, "SubsidyPer"));               // 20 % of the fee (80 % subsidy)
        Assert.Equal(2360m, Dec(plain, "ApplicantContributionAfterSubsidy"));
        Assert.Equal(2320m, Dec(plain, "NetPaybleTds15"));
        Assert.Equal(2160m, Dec(plain, "NetPaybleTds75"));
        Assert.Null(FakeSql.Arg(plain, "Coupon"));

        var coupon = updates.Single(u => FakeSql.Arg(u.Args, "Id") == "3").Args;
        Assert.Equal(1800m, Dec(coupon, "Coupon"));
        Assert.Equal(10000m, Dec(coupon, "TotalAfterCoupon"));
        Assert.Equal(1525.42m, Dec(coupon, "GstAfterCoupon"));
        Assert.Equal(8474.58m, Dec(coupon, "AssessmentFeeAfterCoupon"));
        Assert.Equal(1694.92m, Dec(coupon, "SubsidyPer"));

        var full = updates.Single(u => FakeSql.Arg(u.Args, "Id") == "4").Args;
        Assert.Equal(0m, Dec(full, "ApplicantContributionAfterSubsidy")); // 100 % subsidy
    }

    [Theory]
    [InlineData(-1, 0, "cannot be negative")]
    [InlineData(10000.123, 0, "at most 2 decimals")]
    [InlineData(20000000, 0, "cannot be more than")]
    [InlineData(10000, 12000, "cannot be more than the total fee")]
    public async Task Invalid_amounts_are_refused(decimal fee, decimal coupon, string message)
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.PutAsJsonAsync("/api/staff/fees/Micro", new { levels = new[] { new { certification = "Bronze", assessmentFee = fee, coupon } } });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains(message, await r.ProblemTitle());
        Assert.Empty(Updates());
    }

    [Fact]
    public async Task Unknown_levels_and_coupons_for_rejected_units_are_refused()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/staff/fees/Micro",
            new { levels = new[] { new { certification = "Gold", assessmentFee = 1m, coupon = 0m } } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/staff/fees/Micro",
            new { levels = new[] { new { certification = "Bronze", assessmentFee = 1m, coupon = 0m }, new { certification = "bronze", assessmentFee = 2m, coupon = 0m } } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/staff/fees/Rejected",
            new { levels = new[] { new { certification = "Bronze", assessmentFee = 1m, coupon = 5m } } })).StatusCode);
        Assert.Empty(Updates());

        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/staff/fees/Rejected",
            new { levels = new[] { new { certification = "Bronze", assessmentFee = 5000m } } })).StatusCode);
        var rejected = Updates().Single().Args;
        Assert.Equal(5000m, Dec(rejected, "SubsidyPer")); // rejected units pay the whole fee
        Assert.Equal(5900m, Dec(rejected, "ApplicantContributionAfterSubsidy"));
    }

    [Fact]
    public async Task Preview_computes_without_saving()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.PostAsJsonAsync("/api/staff/fees/Micro/preview", new { levels = new[] { new { certification = "Silver", assessmentFee = 30000m } } });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = await r.Content.ReadFromJsonAsync<JsonElement>();
        var silver = body.GetProperty("rows").EnumerateArray().Single(x => x.GetProperty("id").GetInt32() == 2);
        Assert.Equal(7080m, silver.GetProperty("applicantContributionAfterSubsidy").GetDecimal());
        Assert.Empty(Updates());
    }

    [Fact]
    public void A_row_without_subsidy_percentage_is_not_recalculated()
    {
        var row = FeeRow.From(Row(5, "Small", "Gold", 1m, null, 0m)) with { SubsidyPercentage = null };
        var (updated, error) = FeeCalculator.Recalculate(row, 100m, null, rejected: false);
        Assert.Null(updated);
        Assert.Contains("no valid subsidy percentage", error);
    }

    [Fact]
    public async Task The_share_and_the_amounts_of_a_row_are_saved_in_one_transaction()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/staff/fees/Micro/subsidy", new { certification = "Bronze", category = 0, baseShare = 75m })).StatusCode);

        // Rows 1, 3 and 4 change: each is one batch, the share update and the procedure inside one transaction.
        Assert.Equal(3, Updates().Count);
        Assert.Empty(_host.Sql.Calls.Where(c => c.Name == "SP_MASTER_UPDATE_ASSESSMENT_FEE" || c.Name.StartsWith("UPDATE AssessmentFee", StringComparison.Ordinal)));
        Assert.All(Updates(), u =>
        {
            Assert.StartsWith("SET XACT_ABORT ON; BEGIN TRANSACTION;", u.Name);
            Assert.True(u.Name.IndexOf("SET SubsidyPercentage", StringComparison.Ordinal) < u.Name.IndexOf("EXEC dbo.SP_MASTER_UPDATE_ASSESSMENT_FEE", StringComparison.Ordinal));
            Assert.EndsWith("COMMIT;", u.Name);
            Assert.IsType<Dapper.DynamicParameters>(u.Args);
        });

        // A fee change that leaves the share alone sends the procedure only, still in its transaction.
        _host.Sql.Calls.Clear();
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/staff/fees/Micro", new { levels = new[] { new { certification = "Silver", assessmentFee = 30000m } } })).StatusCode);
        var silver = Assert.Single(Updates());
        Assert.Equal(AssessmentFeesController.SaveSql(shareChanged: false), silver.Name);
        Assert.DoesNotContain("SubsidyPercentage =", silver.Name);
        Assert.Equal(7080m, Dec(silver.Args, "ApplicantContributionAfterSubsidy"));
        Assert.Equal(6000m, Dec(silver.Args, "SubsidyAmount"));
    }

    [Fact]
    public void Net_payable_is_the_stored_contribution_less_the_stored_tds()
    {
        // 80 % subsidy on 10,000.15: share 2,000.03; contribution 2,360.0354 -> 2,360.04; TDS 40.0006 -> 40.00, 200.003 -> 200.00.
        // Rounding the full-precision difference gave 2,320.03 / 2,160.03: one paisa off the page's contribution less TDS.
        var row = FeeRow.From(Row(5, "Micro", "Bronze", 1m, null, 80m));
        var (updated, error) = FeeCalculator.Recalculate(row, 10000.15m, null, rejected: false);
        Assert.Null(error);
        Assert.Equal(2360.04m, updated!.ApplicantContributionAfterSubsidy);
        Assert.Equal((40.00m, 200.00m), (updated.Tds15, updated.Tds75));
        Assert.Equal((2320.04m, 2160.04m), (updated.NetPaybleTds15, updated.NetPaybleTds75));
        Assert.Equal(updated.ApplicantContributionAfterSubsidy - updated.Tds15, updated.NetPaybleTds15);
    }

    [Fact]
    public async Task Saving_without_changes_writes_nothing()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        _host.Sql.Procs["SP_MASTER_GET_ASSESSMENT_FEE"] = _ => FakeSql.Sets([new Dictionary<string, object?>
        {
            ["Id"] = 1, ["EnterpriseTypee"] = "Micro", ["Certification"] = "Bronze", ["AssessmentFee"] = 10000m, ["Gst"] = 1800m, ["Total"] = 11800m,
            ["Coupon"] = null, ["SubsidyPer"] = 2000m, ["GstAfterSubsidy"] = 360m, ["ApplicantContributionAfterSubsidy"] = 2360m,
            ["Tds15"] = 40m, ["Tds75"] = 200m, ["NetPaybleTds15"] = 2320m, ["NetPaybleTds75"] = 2160m, ["SubsidyPercentage"] = 80m,
        }]);
        var r = await admin.PutAsJsonAsync("/api/staff/fees/Micro", new { levels = new[] { new { certification = "Bronze", assessmentFee = 10000m } } });
        Assert.Equal("No changes to save.", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString());
        Assert.Empty(Updates());
    }
    // ----- subsidy shares (V4) -----

    private List<(string Name, object? Args)> ShareUpdates() =>
        _host.Sql.Calls.Where(c => c.Name.Contains("UPDATE AssessmentFee SET SubsidyPercentage", StringComparison.Ordinal)).ToList();

    private static string Share(object? args) => decimal.Parse(FakeSql.Arg(args, "SubsidyPercentage")!, System.Globalization.CultureInfo.CurrentCulture).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);

    [Fact]
    public async Task The_base_share_moves_every_category_and_keeps_their_additional_share()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.PutAsJsonAsync("/api/staff/fees/Micro/subsidy", new { certification = "Bronze", category = 0, baseShare = 75m });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        // Rows 1 and 3 (general, with and without the joining reward) go to 75%; row 4 (category 1, +20%) to 95%; Silver is untouched.
        Assert.Equal(["1:75", "3:75", "4:95"], ShareUpdates().Select(u => $"{FakeSql.Arg(u.Args, "Id")}:{Share(u.Args)}"));
        var row1 = Updates().Single(u => FakeSql.Arg(u.Args, "Id") == "1");
        Assert.Equal(2500m, Dec(row1.Args, "SubsidyPer"));
        Assert.Equal(2950m, Dec(row1.Args, "ApplicantContributionAfterSubsidy"));
        // The joining reward row keeps its reward.
        Assert.Equal(1000m, Dec(Updates().Single(u => FakeSql.Arg(u.Args, "Id") == "3").Args, "Coupon"));
    }

    [Fact]
    public async Task An_additional_share_is_set_on_top_of_the_base_for_one_category_or_every_level()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/staff/fees/Micro/subsidy", new { certification = "Bronze", category = 1, additionalShare = 10m })).StatusCode);
        Assert.Equal(["4:90"], ShareUpdates().Select(u => $"{FakeSql.Arg(u.Args, "Id")}:{Share(u.Args)}"));

        // All levels: Silver has no category 1 row, so only Bronze changes; the base share would move Silver too.
        _host.Sql.Calls.Clear();
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/staff/fees/Micro/subsidy", new { category = 0, baseShare = 70m, allLevels = true })).StatusCode);
        Assert.Equal(["1:70", "2:70", "3:70", "4:90"], ShareUpdates().Select(u => $"{FakeSql.Arg(u.Args, "Id")}:{Share(u.Args)}").Order());
    }

    [Theory]
    [InlineData("""{"certification":"Bronze","category":3,"additionalShare":5}""", "category")]
    [InlineData("""{"certification":"Bronze","category":1}""", "additional share")]
    [InlineData("""{"certification":"Bronze","category":0,"baseShare":101}""", "between 0 and 100")]
    [InlineData("""{"certification":"Bronze","category":0,"baseShare":90}""", "would be 110%")]
    [InlineData("""{"certification":"Platinum","category":0,"baseShare":50}""", "certification level")]
    [InlineData("""{"certification":"Bronze","category":2,"additionalShare":5.555}""", "2 decimals")]
    public async Task Refuses_shares_that_cannot_be_charged(string body, string message)
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.PutAsync("/api/staff/fees/Micro/subsidy", new StringContent(body, System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains(message, await r.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        Assert.Empty(ShareUpdates());
        Assert.Empty(Updates());
    }

    [Fact]
    public async Task Rejected_units_have_no_subsidy_to_edit_and_other_roles_cannot()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/staff/fees/Rejected/subsidy", new { certification = "Bronze", category = 0, baseShare = 10m })).StatusCode);
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.Forbidden, (await master.PutAsJsonAsync("/api/staff/fees/Micro/subsidy", new { certification = "Bronze", category = 0, baseShare = 10m })).StatusCode);
        Assert.Empty(ShareUpdates());
    }
}
