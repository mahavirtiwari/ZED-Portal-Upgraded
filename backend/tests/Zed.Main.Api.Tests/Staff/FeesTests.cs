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

    private List<(string Name, object? Args)> Updates() => _host.Sql.Calls.Where(c => c.Name == "SP_MASTER_UPDATE_ASSESSMENT_FEE").ToList();

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
}
