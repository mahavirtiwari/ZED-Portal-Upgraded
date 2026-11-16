using Zed.Portal.Features.Staff.SiteReview;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>
/// 2026-11-16 (approved): the assessors' punch-in / punch-out on the site and remote assessment pages, read from
/// dbo.ZedDailyAttendance (the old result set went empty once an NC was raised; surveillance had none).
/// </summary>
public sealed class SiteAttendanceTests
{
    private const string Zed = "ZEDMSME000001";

    private static SiteAttendance.Punch P(string id, string type, string stamp, string photo, string? lat = "17.38", string? lng = "78.48", string? name = "R Sharma") =>
        new() { ConsultantId = id, AssessorName = name, AttendanceType = type, Stamp = stamp, PhotoId = photo, Latitude = lat, Longitude = lng, CreatedDate = new DateTime(2026, 11, 20) };

    [Fact]
    public void One_row_per_assessor_and_day_with_the_first_punch_in_the_last_punch_out_their_selfies_and_places()
    {
        var punches = new[]
        {
            P("SA1", "LOGIN", "Nov 14, 2026 9:42 AM", "p1"),
            P("SA1", "LOGIN", "Nov 14, 2026 10:00 AM", "p2"),        // a second punch-in that day: the first counts
            P("sa1 ", "LOGOUT", "Nov 14, 2026 5:55 PM", "p3"),       // same assessor, other spelling
            P("SA1", "LOGIN", "Nov 15, 2026 10:05 AM", "p4", lat: "0", lng: "0"),
            P("SA9", "LOGIN", "Nov 15, 2026 11:00 AM", "p5", name: "Replaced Assessor"),
        };
        var allotted = new[] { new Dictionary<string, object?> { ["ConsultantId"] = "SA1", ["AssessorType"] = "Lead Assessor" } };

        var (rows, assessors) = SiteAttendance.Build(punches, allotted, Zed, "Silver", "mobileapi");

        Assert.Equal(3, rows.Count);
        var day1 = rows[0];
        Assert.Equal((1, "14 Nov 2026", "09:42 AM", "05:55 PM", 8, 13),
            ((int)day1["RowNumber"]!, day1["TimeStamps"], day1["LoginTime"], day1["LogoutTime"], (int?)day1["NoOfHours"], (int?)day1["NoOfMinutes"]));
        Assert.Equal("/api/staff/site-review/ZEDMSME000001/Silver/files/mobileapi/Attendance/ZEDMSME000001/Silver/p1.jpg", day1["LoginPhotoUrl"]);
        Assert.EndsWith("/p3.jpg", (string)day1["LogoutPhotoUrl"]!);
        Assert.Equal("17.38,78.48", day1["LoginLocation"]);

        var day2 = rows[1];
        Assert.Equal((2, "10:05 AM", null, null), ((int)day2["RowNumber"]!, day2["LoginTime"], day2["LogoutTime"], day2["NoOfHours"]));
        Assert.Null(day2["LoginLocation"]);   // 0,0: the phone had no location

        // The allotted assessor gets the name; someone else who punched in (replaced later) is listed too.
        Assert.Equal(2, assessors.Count);
        Assert.Equal(("SA1", "Lead Assessor", "R Sharma"), (assessors[0]["ConsultantId"], assessors[0]["AssessorType"], assessors[0]["AssessorName"]));
        Assert.Equal(("SA9", "Replaced Assessor"), (assessors[1]["ConsultantId"], assessors[1]["AssessorName"]));
    }

    [Fact]
    public void Surveillance_selfies_are_served_from_its_own_store_and_no_punches_mean_no_rows()
    {
        var (rows, _) = SiteAttendance.Build([P("SA1", "LOGIN", "Nov 14, 2026 9:42 AM", "p1")], [], Zed, "Gold", "surveillancemobileapi");
        Assert.Equal("/api/staff/site-review/ZEDMSME000001/Gold/files/surveillancemobileapi/Attendance/ZEDMSME000001/Gold/p1.jpg", rows.Single()["LoginPhotoUrl"]);

        var (none, assessors) = SiteAttendance.Build([], [new() { ["ConsultantId"] = "SA1", ["AssessorType"] = "Lead Assessor" }], Zed, "Gold", "mobileapi");
        Assert.Empty(none);
        Assert.Single(assessors);
    }

    [Fact]
    public void A_time_stamp_the_app_did_not_format_falls_back_to_when_it_arrived()
    {
        var p = new SiteAttendance.Punch { Stamp = "garbled", CreatedDate = new DateTime(2026, 11, 14, 9, 0, 0) };
        Assert.Equal(new DateTime(2026, 11, 14, 9, 0, 0), SiteAttendance.When(p));
    }
}
