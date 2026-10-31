using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Zed.Core.Http;
using Zed.Portal.Features.CertLevels;
using Zed.Portal.Features.Documents;
using Zed.Portal.Features.Payments;

namespace Zed.Main.Api.Tests;

/// <summary>ZED-X surveillance (migrations 0032 / 0033): the Admin's schedule, payment, dashboard and certificate.</summary>
public sealed class LevelSurveillanceTests : IDisposable
{
    private const string Me = "ZEDMSME000001";
    private const string Api = "/api/msme/surveillance-payments";
    private readonly TestHost _host = new();

    public LevelSurveillanceTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = _ =>
            FakeSql.Sets([new { UserId = Me, UserName = "Acme", RoleId = 5, Email = "a@acme.test" }], [new { ERRORMSG = "SUCCESS" }]);
        _host.Sql.Procs["SP_MSME_GET_DETAILS"] = _ => FakeSql.Sets(
            [new Dictionary<string, object?> { ["ZedId"] = Me, ["EnterpriseName"] = "Acme", ["GoldDashboardSurStatus"] = 0 }],
            [new Dictionary<string, object?> { ["UdyogAadharNo"] = "UDYAM-UP-29-0003915" }],
            [new Dictionary<string, object?> { ["BronzeStatus"] = 0 }]);
        // The legacy procedure knows Bronze / Silver / Gold only: it must not decide for ZED-X.
        _host.Sql.Procs["SP_SURVEILLANCE_MSME_GET_PAYMENT_STATUS"] = _ => FakeSql.Sets([new { PaymentStatus = 1 }]);
    }

    public void Dispose() => _host.Dispose();

    private async Task<HttpClient> SignedInAsync()
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = Me, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    private void Status(int? round, string? phase = "ACTIVE", bool paid = false) =>
        _host.Sql.Queries[LevelSurveillance.StatusSql("ZEDX")] = _ => round is null ? [] : [new { Round = round, Phase = phase, Paid = paid }];

    [Fact]
    public async Task Zedx_surveillance_can_be_paid_once_the_schedule_opens_a_round()
    {
        var client = await SignedInAsync();
        async Task<bool> Eligible() => (await client.GetFromJsonAsync<JsonElement>($"{Api}/zedx/status")).GetProperty("eligible").GetBoolean();

        Status(null);
        Assert.False(await Eligible());                 // not certified, or no round open yet
        Status(1);
        Assert.True(await Eligible());
        Assert.Equal("ZEDX", (await client.GetFromJsonAsync<JsonElement>($"{Api}/zedx/status")).GetProperty("certification").GetString());
        Status(2);
        Assert.True(await Eligible());                  // second surveillance
        Status(1, paid: true);
        Assert.False(await Eligible());
        Status(1, phase: "WITHDRAWN");
        Assert.False(await Eligible());
        Status(1, phase: "EXPIRED");
        Assert.False(await Eligible());

        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_SURVEILLANCE_MSME_GET_PAYMENT_STATUS");
        Assert.All(_host.Sql.Calls.Where(c => c.Name == LevelSurveillance.StatusSql("ZEDX")), c =>
        {
            Assert.Equal(Me, FakeSql.Arg(c.Args, "ZedId"));
            Assert.Equal("ZEDX", FakeSql.Arg(c.Args, "Level"));
        });
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync($"{Api}/Platinum/status")).StatusCode);
    }

    [Fact]
    public async Task The_dashboard_shows_the_zedx_surveillance_box_and_its_payment()
    {
        var client = await SignedInAsync();
        Status(null);
        var none = (await client.GetFromJsonAsync<JsonElement>("/api/msme/dashboard")).GetProperty("msme");
        Assert.Equal(0, none.GetProperty("ZEDXDashboardSurStatus").GetInt32());

        Status(1);
        var open = (await client.GetFromJsonAsync<JsonElement>("/api/msme/dashboard")).GetProperty("msme");
        Assert.Equal((1, 0), (open.GetProperty("ZEDXDashboardSurStatus").GetInt32(), open.GetProperty("IsSurZEDXPaymentDone").GetInt32()));

        Status(1, paid: true);
        var paid = (await client.GetFromJsonAsync<JsonElement>("/api/msme/dashboard")).GetProperty("msme");
        Assert.Equal((1, 1), (paid.GetProperty("ZEDXDashboardSurStatus").GetInt32(), paid.GetProperty("IsSurZEDXPaymentDone").GetInt32()));
    }

    [Fact]
    public async Task A_recorded_zedx_surveillance_payment_sets_up_the_surveillance()
    {
        await LevelSurveillance.PaidAsync(_host.Sql, Me, "ZEDX", NullLogger.Instance, default);
        var call = Assert.Single(_host.Sql.Calls, c => c.Name == LevelSurveillance.PaidSql);
        Assert.Equal((Me, "ZEDX"), (FakeSql.Arg(call.Args, "ZedId"), FakeSql.Arg(call.Args, "Certification")));

        // Bronze / Silver / Gold: the legacy payment procedures do it all.
        await LevelSurveillance.PaidAsync(_host.Sql, Me, "Gold", NullLogger.Instance, default);
        Assert.Single(_host.Sql.Calls, c => c.Name == LevelSurveillance.PaidSql);

        // Every completed surveillance payment goes through it (zero path, gateway, mobile).
        using var scope = _host.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<SurveillancePaymentCompletion>().CompleteAsync(Me, "ZEDX", postToErp: false, default);
        Assert.Equal(2, _host.Sql.Calls.Count(c => c.Name == LevelSurveillance.PaidSql));
    }

    [Fact]
    public async Task A_zedx_surveillance_zero_payment_counts_only_when_its_round_was_recorded()
    {
        Status(1);
        _host.Sql.Procs["SP_SURVEILLANCE_MSME_GET_PAYMENT_DETAILS"] = _ => FakeSql.Sets(
            [], [new { Id = 41, Total = "29500.00", ApplicantContributionAfterSubsidy = "0.00", UdyamPanNo = "ABCDE1234F" }], [new { IsCouponUsed = 1 }]);
        var rows = 0;
        _host.Sql.Queries[LevelSurveillance.PaymentsSql] = _ => [rows];
        var client = await SignedInAsync();
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();   // the signed-in XSRF token
        var choices = new { useReward = false, gstinApplicable = false, tdsDeductible = false };

        // The procedure skipped (it records only while ZED_SURVEILLANCE's IsBronzePaymentDone is unset): no new payment row.
        // Before, the legacy status procedure decided, and on the server it answers 0 for ZED-X, which read as recorded.
        var skipped = await client.PostAsJsonAsync($"{Api}/ZEDX/checkout", choices);
        Assert.Equal("The payment could not be recorded. Please contact zed.support@qcin.org.", await skipped.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == LevelSurveillance.PaidSql);

        // Recorded: the round's payment row is there.
        _host.Sql.Procs["SP_SURVEILLANCE_MSME_ZERO_PAYMENT_DETAILS"] = _ =>
        {
            rows++;
            return FakeSql.Sets();
        };
        var ok = await client.PostAsJsonAsync($"{Api}/ZEDX/checkout", choices);
        Assert.Equal("paid", (await ok.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());
        Assert.Single(_host.Sql.Calls, c => c.Name == LevelSurveillance.PaidSql);
        Assert.All(_host.Sql.Calls.Where(c => c.Name == LevelSurveillance.PaymentsSql), c =>
            Assert.Equal((Me, "ZEDX"), (FakeSql.Arg(c.Args, "ZedId"), FakeSql.Arg(c.Args, "Certification"))));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_SURVEILLANCE_MSME_GET_PAYMENT_STATUS");
    }

    [Fact]
    public void The_schedule_is_checked_against_the_validity()
    {
        var d = SurveillanceSchedule.Default;
        Assert.Null(d.Problem(36));
        Assert.Equal(new DateTime(2028, 1, 29), d.Due(new DateTime(2026, 10, 29), 1));   // 15 months
        Assert.Equal(new DateTime(2029, 1, 29), d.Due(new DateTime(2026, 10, 29), 2));   // + 12
        Assert.NotNull(d.Problem(27));                                                  // the second is due at 27 months
        Assert.NotNull((d with { Count = 6 }).Problem(120));
        Assert.NotNull((d with { WithdrawAfterDays = 0 }).Problem(36));
        Assert.NotNull((d with { Reminders = 2, ReminderEveryMonths = 0 }).Problem(36));
        Assert.Null((d with { Count = 1, IntervalMonths = 0 }).Problem(36));             // one round: no interval needed
    }

    [Fact]
    public async Task The_zedx_surveillance_certificate_shows_the_round_and_the_admins_validity()
    {
        _host.Sql.Procs["SP_RA_GET_CERTIFICATE_DETAILS"] = _ => FakeSql.Sets([new Dictionary<string, object?>
        {
            ["EnterpriseName"] = "ACME PRECISION CASTINGS UNIT 1", ["SaCertificateNo"] = "ZEDX/M/2026/000001", ["DateOfCertification"] = "October 29, 2026",
            ["Address"] = "Plot No. 4, Sector 7, Industrial Area, Kanpur Nagar, Uttar Pradesh-208020", ["UdyogAadharNo"] = "UDYAM-UP-29-0003915",
            ["NicCode"] = "24 - Manufacture of basic metals", ["AssessmentAgency"] = "Quality Assessors Private Limited",
            ["QrCodeSeqNo"] = "https://loginzed.msme.gov.in/Verify/GC/P115AB12", ["DateOfSurveillance"] = "January 29, 2028", ["SurveillanceNo"] = "2",
        }]);
        _host.Sql.Queries[CertificationLevels.FromMain(CertificationLevels.Sql)] = _ => [new
        {
            Code = "ZEDX", Name = "ZED-X (Export)", OrderNo = 40, IsEnabled = true, AssessmentMode = "Site", ValidityMonths = 36,
            SurveillanceEnabled = true, FirstSurveillanceMonths = 15, CertNoFormat = "{DDMMYYYY}_{ZEDNO}", Fee = 75000m,
        }];
        _host.Sql.Queries[DocumentRenderer.SurveillanceRoundSql] = _ => [3];

        var renderer = new DocumentRenderer(_host.Services.GetRequiredService<IWebHostEnvironment>(),
            _host.Services.GetRequiredService<IOptions<PortalOptions>>(), NullLogger.Instance);
        var pdf = await renderer.IssueSurveillanceCertificateAsync(_host.Sql, Me, "ZEDX", default);
        Assert.Equal($"Surveillance/Certificates/SA/{Me}/ZEDX.pdf", pdf.RelativePath);
        Assert.Contains(_host.Sql.Calls, c => c.Name == CertificationLevels.FromMain(CertificationLevels.Sql));
        Assert.Contains("ZEDCS_V2_LIVE.dbo.SectionTypes", CertificationLevels.FromMain(CertificationLevels.Sql));
        Assert.True(File.Exists(Path.Combine(AppContext.BaseDirectory, "Assets", "Documents", "Surveillance", "SaZEDX.jpg")));

        var samples = Environment.GetEnvironmentVariable("ZED_DOC_SAMPLES");
        if (!string.IsNullOrEmpty(samples))
        {
            Directory.CreateDirectory(samples);
            await File.WriteAllBytesAsync(Path.Combine(samples, "ZEDX_surveillance.pdf"), pdf.Content);
        }
    }

    [Theory]
    [InlineData("1", "1")]
    [InlineData("2", "2")]
    [InlineData("Surveillance 2", "2")]
    [InlineData("", "1")]
    [InlineData("x", "1")]
    public void The_round_falls_back_to_the_surveillance_number(string surveillanceNo, string round) =>
        Assert.Equal(round, DocumentRenderer.SurveillanceRound(surveillanceNo));
}
