using System.Net.Http.Json;
using System.Text.Json;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Consultancy.Milestones;

namespace Zed.Consultancy.Api.Tests;

/// <summary>2026-11-21: the Consultancy Master Admin UI audit (attendance pairing, consultant-app photos, payments received).</summary>
public sealed class ConsultancyAuditTests : IDisposable
{
    private readonly TestHost _host = new();

    public ConsultancyAuditTests() => ConsultancyLogin.Setup(_host);

    public void Dispose() => _host.Dispose();

    private static MilestoneAttendance.Punch P(string type, string stamp, string id = "ZEDCC4631", string milestone = "1", string? photo = null) =>
        new() { ConsultantId = id, MileStoneNo = milestone, AttendanceType = type, Stamp = stamp, PhotoId = photo ?? type + stamp.Replace(" ", "").Replace(",", "").Replace(":", "") };

    [Fact]
    public void A_punch_out_pairs_with_the_latest_punch_in_before_it_and_no_duration_is_negative()
    {
        var rows = MilestoneAttendance.Build(
        [
            P("LOGIN", "Nov 17, 2026 9:00 AM"),
            P("LOGOUT", "Nov 17, 2026 4:42 PM"),
            P("LOGIN", "Nov 17, 2026 5:14 PM"),   // after the punch-out: no punch-out of its own
            P("LOGIN", "Nov 18, 2026 10:00 AM"),
            P("LOGIN", "Nov 18, 2026 10:30 AM"),
            P("LOGOUT", "Nov 18, 2026 1:00 PM"),
            P("LOGOUT", "Nov 19, 2026 6:00 PM"),  // no punch-in that day
        ], id => "/photo/" + id);

        Assert.Equal(5, rows.Count);
        Assert.Equal(("09:00 AM", "04:42 PM", 7, 42), ((string?)rows[0]["LoginTime"], (string?)rows[0]["LogoutTime"], (int?)rows[0]["NoOfHours"], (int?)rows[0]["NoOfMinutes"]));
        Assert.Equal("05:14 PM", rows[1]["LoginTime"]);
        Assert.Null(rows[1]["LogoutTime"]);
        Assert.Null(rows[1]["NoOfHours"]);
        // Day 2: the 10:00 punch-in stays open, the 13:00 punch-out pairs with 10:30.
        Assert.Equal(("10:00 AM", (string?)null), ((string?)rows[2]["LoginTime"], (string?)rows[2]["LogoutTime"]));
        Assert.Equal(("10:30 AM", "01:00 PM", 2, 30), ((string?)rows[3]["LoginTime"], (string?)rows[3]["LogoutTime"], (int?)rows[3]["NoOfHours"], (int?)rows[3]["NoOfMinutes"]));
        Assert.Equal(2, rows[3]["RowNumber"]);
        Assert.Null(rows[4]["LoginTime"]);
        Assert.Equal("06:00 PM", rows[4]["LogoutTime"]);
        Assert.Equal(3, rows[4]["RowNumber"]);
        // Dates only.
        Assert.Equal("November 17, 2026", rows[0]["TimeStamps"]);
        Assert.All(rows, r => Assert.True(r["NoOfMinutes"] is null || (int)r["NoOfMinutes"]! >= 0));
        Assert.StartsWith("/photo/LOGIN", (string)rows[0]["LoginPhotoUrl"]!);
    }

    [Fact]
    public void Consultant_app_files_are_found_in_the_mobile_apis_own_folder()
    {
        var temp = Directory.CreateTempSubdirectory("zed-cons-app-");
        try
        {
            var portalRoot = Directory.CreateDirectory(Path.Combine(temp.FullName, "portal")).FullName;
            var appRoot = Path.Combine(temp.FullName, "consultancymobileapi-storage");
            var folder = Directory.CreateDirectory(Path.Combine(appRoot, "Attendance", "ZEDM000005", "Silver")).FullName;
            File.WriteAllBytes(Path.Combine(folder, "ZEDCC46311794913956736.jpg"), [0xFF, 0xD8, 0xFF]);
            const string path = "consultancymobileapi/Attendance/ZEDM000005/Silver/ZEDCC46311794913956736.jpg";

            // Only the portal's root (the old lookup): not found.
            Assert.Null(MilestoneFiles.Find(MilestoneFiles.Roots(temp.FullName, portalRoot, null), path, "ZEDM000005"));
            // With the consultant mobile API's root: found, without the consultancymobileapi folder.
            var found = MilestoneFiles.Find(MilestoneFiles.Roots(temp.FullName, portalRoot, appRoot), path, "ZEDM000005");
            Assert.Equal(Path.Combine(folder, "ZEDCC46311794913956736.jpg"), found);
            // A path leaving the roots is never served.
            Assert.Null(MilestoneFiles.Find(MilestoneFiles.Roots(temp.FullName, portalRoot, appRoot), "consultancymobileapi/Attendance/../../x.jpg", "ZEDM000005"));
        }
        finally
        {
            temp.Delete(recursive: true);
        }
    }

    [Fact]
    public async Task Payments_received_show_the_level_and_milestone_of_the_milestone_row_and_filter_on_them()
    {
        _host.Sql.Procs["SP_DASHBOARD_PAYMENT_TRANSACTIONS"] = _ => FakeSql.Sets(
        [
            new { RowNumber = 1, ZedId = "ZEDM000005", Certification = "Bronze", MileStoneNum = "MileStone 5", TransactionId = 7, FinalAmountPaid = 0, IsCouponUsed = true, PaymentType = "ZeroAmount" },
            new { RowNumber = 2, ZedId = "ZEDM000006", Certification = "Gold", MileStoneNum = "MileStone 2", TransactionId = 8, FinalAmountPaid = 5900, IsCouponUsed = false, PaymentType = "PaymentGateway" },
        ]);
        _host.Sql.Queries["SELECT P.Id, LTRIM(RTRIM(H.Certification))"] = _ => [new { Id = 7, Level = "Silver", MileStone = 1 }];
        var master = await ConsultancyLogin.SignInAsync(_host, "MASTER1");

        var rows = await master.GetFromJsonAsync<JsonElement>("/api/staff/dashboard/payments-received");
        Assert.Equal("Silver", rows[0].GetProperty("Certification").GetString());
        Assert.Equal("MileStone 1", rows[0].GetProperty("MileStoneNum").GetString());
        // A payment without a matching milestone row keeps its own values.
        Assert.Equal("Gold", rows[1].GetProperty("Certification").GetString());

        // The level filter is applied after the mapping (the procedure is asked for every level), Bronze is not a handholding level.
        var silver = await master.GetFromJsonAsync<JsonElement>("/api/staff/dashboard/payments-received?certification=Silver");
        Assert.Equal(1, silver.GetArrayLength());
        Assert.Null(FakeSql.Arg(_host.Sql.Calls.Last(c => c.Name == "SP_DASHBOARD_PAYMENT_TRANSACTIONS").Args, "CertificationType"));
        Assert.Equal(System.Net.HttpStatusCode.BadRequest, (await master.GetAsync("/api/staff/dashboard/payments-received?certification=Bronze")).StatusCode);
    }

    [Fact]
    public async Task The_consultants_milestone_counts_are_read_per_consultant()
    {
        _host.Sql.Queries["SELECT X.ConsultantId AS UserId"] = _ => [new { UserId = "ZEDCC4631", M1 = 0, M2 = 0, M3 = 0, InProgress = 1 }];
        var master = await ConsultancyLogin.SignInAsync(_host, "MASTER1");
        var rows = await master.GetFromJsonAsync<List<Zed.Portal.Features.Staff.Dashboard.StaffDashboardController.ConsultantMilestones>>(
            "/api/staff/dashboard/consultant-milestones");
        Assert.Equal("ZEDCC4631", rows![0].UserId);
        Assert.Equal(1, rows[0].InProgress);
        // A consultant organisation: its own allotments only.
        var co = await ConsultancyLogin.SignInAsync(_host, "CO1");
        await co.GetFromJsonAsync<JsonElement>("/api/staff/dashboard/consultant-milestones");
        Assert.Equal("CO1", FakeSql.Arg(_host.Sql.Calls.Last(c => c.Name.StartsWith("SELECT X.ConsultantId", StringComparison.Ordinal)).Args, "AgencyId"));
    }
}
