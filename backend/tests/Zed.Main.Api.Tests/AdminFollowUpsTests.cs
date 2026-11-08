using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Assessment;
using Zed.Portal.Features.Staff.Masters;
using Zed.Portal.Templates;

namespace Zed.Main.Api.Tests;

/// <summary>
/// The Admin follow-ups of 2026-11-08: states from the LG Directory masters, the requirement videos, the split e-mail
/// templates, the MSME's own level fees and the app's incentive cards.
/// </summary>
public sealed class AdminFollowUpsTests : IDisposable
{
    private readonly TestHost _host = new();

    public AdminFollowUpsTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args => FakeSql.Arg(args, "UserId") switch
        {
            "ZEDMSME000001" => FakeSql.Sets([new { UserId = "ZEDMSME000001", UserName = "Acme", RoleId = 5, Email = "a@acme.test" }], [new { ERRORMSG = "SUCCESS" }]),
            _ => FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]),
        };
    }

    public void Dispose() => _host.Dispose();

    // ------------------------------------------------------------------ states

    [Fact]
    public void States_are_normalised_one_per_code()
    {
        var list = StateMaster.Normalise([
            new("09", " uttar pradesh "), new("9", "Duplicate"), new("37", "Ladakh"), new("", "No code"), new("40", " "),
        ]);
        Assert.Equal([("9", "UTTAR PRADESH"), ("37", "LADAKH")], list.Select(s => (s.Code, s.Name)));
        Assert.Equal("9", StateMaster.Code("009"));
        Assert.Equal("0", StateMaster.Code("0"));
    }

    [Fact]
    public async Task The_public_states_list_has_every_state_with_its_lgd_code()
    {
        var client = _host.CreateClient();
        var states = await client.GetFromJsonAsync<JsonElement>("/api/public/states");
        Assert.True(states.GetArrayLength() >= 36);
        Assert.Contains(states.EnumerateArray(), s => s.GetProperty("code").GetString() == "37" && s.GetProperty("name").GetString() == "LADAKH");
    }

    [Fact]
    public void The_dashboard_filters_read_the_masters_and_keep_the_two_former_names()
    {
        Assert.Equal("ANDHRA PRADESH", Zed.Portal.Features.Staff.Dashboard.DashboardFilters.States["28"]);
        Assert.Contains("DAMAN AND DIU", Zed.Portal.Features.Staff.Dashboard.DashboardFilters.StateNames);
        Assert.Contains("WEST BENGAL", Zed.Portal.Features.Staff.Users.StaffUserRules.States);
        Assert.Equal(["Common", "Other", "Financial"], Zed.Portal.Features.Staff.Schemes.IncentiveMasterController.Types.Take(3));
    }

    // ------------------------------------------------------------------ requirement videos

    [Fact]
    public void Requirement_videos_are_found_by_parameter_and_requirement_code_and_only_web_addresses_count()
    {
        var map = RequirementVideos.From([
            new(" 1 ", "2", " https://youtu.be/abc "), new("1", "3", "javascript:alert(1)"), new("2", "1", "http://example.test/v"),
            new("2", "1", "https://second.test"), new("3", null, "https://no-code.test"),
        ]);
        Assert.Equal(2, map.Count);
        Assert.Equal("https://youtu.be/abc", map.For("1", "2"));
        Assert.Null(map.For("1", "3"));
        Assert.Equal("http://example.test/v", map.For(2, "1"));

        var rows = new List<Dictionary<string, object?>>
        {
            new() { ["SectionCode"] = "1", ["RequirementCode"] = "2" },
            new() { ["SectionCode"] = "9", ["RequirementCode"] = "9" },
        };
        map.AttachTo(rows);
        Assert.Equal("https://youtu.be/abc", rows[0]["VideoUrl"]);
        Assert.Null(rows[1]["VideoUrl"]);
    }

    [Fact]
    public void The_handholding_video_query_reads_main_questionnaire()
    {
        Assert.Contains("FROM ZEDCS_V2_LIVE.dbo.Requirements", RequirementVideos.Sql("ZEDCS_V2_LIVE.dbo"));
        Assert.Contains("FROM dbo.Requirements WHERE SectionType = @SectionType", RequirementVideos.Sql("dbo"));
    }

    // ------------------------------------------------------------------ e-mail templates

    [Fact]
    public void Each_case_of_the_login_details_and_password_changed_mails_has_its_own_key()
    {
        Assert.Equal("StaffLoginDetailsEmail", EmailTemplateVariants.LoginDetails(reset: false, subUser: false));
        Assert.Equal("StaffLoginDetailsEmail.Reset", EmailTemplateVariants.LoginDetails(reset: true, subUser: true));
        Assert.Equal("StaffLoginDetailsEmail.SubUser", EmailTemplateVariants.LoginDetails(reset: false, subUser: true));
        Assert.Equal("PasswordChangedEmail.Msme", EmailTemplateVariants.PasswordChanged(msme: true));
        Assert.Equal("PasswordChangedEmail", EmailTemplateVariants.PasswordChanged(msme: false));
    }

    // ------------------------------------------------------------------ level fees

    [Fact]
    public async Task The_dashboard_level_fees_are_the_units_own_fee_without_the_joining_reward()
    {
        _host.Sql.Procs["SP_MSME_GET_PAYMENT_DETAILS"] = args => FakeSql.Arg(args, "Certification") switch
        {
            "Bronze" => FakeSql.Sets([new { Id = 1, ApplicantContributionAfterSubsidy = 0m }], [new { Id = 2, ApplicantContributionAfterSubsidy = 2360m }], [new { IsCouponUsed = 0 }]),
            "Silver" => FakeSql.Sets([], [], []),
            _ => FakeSql.Sets([], [], []),
        };
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = "ZEDMSME000001", password = "Right#Pass1" })).EnsureSuccessStatusCode();
        var fees = await client.GetFromJsonAsync<Dictionary<string, decimal?>>("/api/msme/dashboard/level-fees");
        Assert.Equal(2360m, fees!["Bronze"]);
        Assert.Null(fees["Silver"]);
        Assert.All(_host.Sql.Calls.Where(c => c.Name == "SP_MSME_GET_PAYMENT_DETAILS"), c => Assert.Equal("ZEDMSME000001", FakeSql.Arg(c.Args, "ZedId")));
    }

    [Fact]
    public async Task Level_fees_need_a_signed_in_msme()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/msme/dashboard/level-fees")).StatusCode);
    }

    // ------------------------------------------------------------------ incentive cards for the app

    [Fact]
    public async Task The_app_reads_the_admins_incentive_cards_without_a_session()
    {
        _host.Sql.Queries[Zed.Portal.Features.Msme.MsmeDashboardController.BuiltInCardsSql] = _ =>
            [new { Card = "JOINING_REWARD", Title = "Joining Reward", Highlight = "Rs. 10,000", Details = "<p>Text</p>", Active = true }];
        _host.Sql.Queries[Zed.Portal.Features.Msme.MsmeDashboardController.IncentiveCardsSql] = _ =>
            [new { Id = 7L, Title = "State scheme", Highlight = (string?)null, Details = "x", Department = "MSME Dept", ContactPerson = (string?)null,
                Email = (string?)null, MobileNo = (string?)null, WebLink = "javascript:alert(1)", VideoLink = "https://youtu.be/v",
                ApplicableForBronze = true, ApplicableForSilver = false, ApplicableForGold = false }];
        var json = await _host.CreateClient().GetFromJsonAsync<JsonElement>("/api/public/incentive-cards");
        Assert.Equal("JOINING_REWARD", json.GetProperty("builtIn")[0].GetProperty("card").GetString());
        var card = json.GetProperty("incentives")[0];
        Assert.Equal(JsonValueKind.Null, card.GetProperty("webLink").ValueKind);
        Assert.Equal("https://youtu.be/v", card.GetProperty("videoLink").GetString());
    }
}
