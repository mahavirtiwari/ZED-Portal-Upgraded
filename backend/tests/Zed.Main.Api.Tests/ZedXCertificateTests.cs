using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using SkiaSharp;
using Zed.Core.Data;
using Zed.Portal.Features.CertLevels;
using Zed.Portal.Features.Documents;
using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Staff.Monitoring;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Main.Api.Tests;

/// <summary>The ZED-X (Export) certificate: artwork, the Admin's validity, number format and logo, the QR address, My Documents.</summary>
public sealed class ZedXCertificateTests : IDisposable
{
    private const string Me = DocumentsTestData.Me;
    private readonly TestHost _host = new();
    private string? _logoPath = "Uploads/Levels/ZEDX.png";

    public ZedXCertificateTests()
    {
        DocumentsTestData.Register(_host);
        _host.Sql.Procs["SP_RA_GET_CERTIFICATE_DETAILS"] = args => FakeSql.Arg(args, "CertificationType") != "ZEDX"
            ? FakeSql.Sets([])
            : FakeSql.Sets([new Dictionary<string, object?>
            {
                ["EnterpriseName"] = "ACME PRECISION CASTINGS UNIT 1", ["SaCertificateNo"] = "ZEDX/M/2026/000001", ["DateOfCertification"] = "October 29, 2026",
                ["Address"] = "Plot No. 4, Sector 7, Industrial Area, Kanpur Nagar, Uttar Pradesh-208020", ["UdyogAadharNo"] = "UDYAM-UP-29-0003915",
                ["NicCode"] = "24 - Manufacture of basic metals", ["AssessmentAgency"] = "Quality Assessors Private Limited",
                ["QrCodeSeqNo"] = "https://loginzed.msme.gov.in/Verify/GC/P115AB12",
            }]);
        _host.Sql.Queries[CertificationLevels.Sql] = _ => [Level()];
    }

    public void Dispose() => _host.Dispose();

    private object Level(int validity = 24) => new
    {
        Code = "ZEDX", Name = "ZED-X (Export)", OrderNo = 40, Description = (string?)null, Comment = (string?)null, LogoPath = _logoPath, IsEnabled = true,
        AssessmentMode = "Site", ValidityMonths = validity, SurveillanceEnabled = true, FirstSurveillanceMonths = 18,
        CertNoFormat = "ZEDX/{YYYY}/{ZEDNO}", CertNoFormatManufacturing = "ZEDX/M/{YYYY}/{ZEDNO}", CertNoFormatService = (string?)null, Fee = 75000m,
    };

    private static byte[] Logo()
    {
        using var bmp = new SKBitmap(300, 300);
        bmp.Erase(new SKColor(0x2E, 0xCA, 0xD0));
        using var img = SKImage.FromBitmap(bmp);
        return img.Encode(SKEncodedImageFormat.Png, 100).ToArray();
    }

    private async Task<DocumentFile> IssueAsync()
    {
        using var scope = _host.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<IAssessmentDocuments>().IssueCertificateAsync(Me, "ZEDX", default);
    }

    [Fact]
    public async Task The_certificate_is_drawn_on_the_zedx_artwork_with_the_admins_logo()
    {
        var withoutLogo = await IssueAsync();
        Assert.Equal($"Certificates/SA/{Me}/ZEDX.pdf", withoutLogo.RelativePath);
        Assert.True(File.Exists(Path.Combine(_host.StorageRoot, "Certificates", "SA", Me, "ZEDX.pdf")));

        var logo = Path.Combine(_host.StorageRoot, "Uploads", "Levels", "ZEDX.png");
        Directory.CreateDirectory(Path.GetDirectoryName(logo)!);
        await File.WriteAllBytesAsync(logo, Logo());
        var withLogo = await IssueAsync();
        Assert.NotEqual(withoutLogo.Content.Length, withLogo.Content.Length); // the logo is embedded over the badge

        var samples = Environment.GetEnvironmentVariable("ZED_DOC_SAMPLES");
        if (!string.IsNullOrEmpty(samples))
        {
            Directory.CreateDirectory(samples);
            await File.WriteAllBytesAsync(Path.Combine(samples, "ZEDX.pdf"), withoutLogo.Content);
            await File.WriteAllBytesAsync(Path.Combine(samples, "ZEDX_with_logo.pdf"), withLogo.Content);
        }
    }

    [Fact]
    public void Validity_and_qr_address_follow_the_admin_and_this_portal()
    {
        Assert.Equal("Three years from the date of issue", DocumentLevels.ValidityText(36));
        Assert.Equal("One year from the date of issue", DocumentLevels.ValidityText(12));
        Assert.Equal("18 months from the date of issue", DocumentLevels.ValidityText(18));
        Assert.Equal("https://zedv3.qci.org.in/Verify/XC/P115AB12",
            DocumentRenderer.VerifyUrl("https://zedv3.qci.org.in/", "ZEDX", "https://loginzed.msme.gov.in/Verify/GC/P115AB12"));
        Assert.Equal("GC", VerifyController.CodeOf("Gold"));
    }

    [Fact]
    public async Task The_number_and_first_surveillance_come_from_the_admins_settings()
    {
        var certified = new DateTime(2026, 10, 29, 11, 0, 0);
        _host.Sql.Queries[LevelCertification.RowSql] = _ => [new { SaCertificateNo = "29102026_000001", CertificationStatusDate = certified }];
        _host.Sql.Queries[UserSectorActivity.UnitSql] = _ => [new { Activity = "Manufacturing", TwoDigitActivity = "24 - Metals" }];

        var number = await LevelCertification.ApplyAsync(_host.Sql, Me, "ZEDX", NullLogger.Instance, default);
        Assert.Equal("ZEDX/M/2026/000001", number);
        var update = Assert.Single(_host.Sql.Calls, c => c.Name == LevelCertification.UpdateSql).Args;
        Assert.Equal("ZEDX/M/2026/000001", FakeSql.Arg(update, "CertificateNo"));
        Assert.Equal(certified.AddMonths(18).ToString(), FakeSql.Arg(update, "FirstSurveDueDate"));
        Assert.Equal("29102026_000001", FakeSql.Arg(update, "ProcedureNo"));

        // A number given earlier is kept; Gold keeps the procedure's.
        _host.Sql.Queries[LevelCertification.RowSql] = _ => [new { SaCertificateNo = "ZEDX/M/2026/000001", CertificationStatusDate = certified }];
        Assert.Equal("ZEDX/M/2026/000001", await LevelCertification.ApplyAsync(_host.Sql, Me, "ZEDX", NullLogger.Instance, default));
        Assert.Null(await LevelCertification.ApplyAsync(_host.Sql, Me, "Gold", NullLogger.Instance, default));
        Assert.Single(_host.Sql.Calls, c => c.Name == LevelCertification.UpdateSql);
    }

    [Fact]
    public async Task The_qr_code_opens_the_verify_page()
    {
        _host.Sql.Procs["SP_VERIFY_QR_CODE"] = args => FakeSql.Arg(args, "CertificationType") == "ZEDX" && FakeSql.Arg(args, "QrCodeNo") == "P115AB12"
            ? FakeSql.Sets([new Dictionary<string, object?> { ["EnterpriseName"] = "ACME", ["CertificateNo"] = "ZEDX/M/2026/000001", ["CertificationPhase"] = "ACTIVE" }])
            : FakeSql.Sets([]);
        var client = _host.CreateClient();
        var r = await client.GetFromJsonAsync<JsonElement>("/api/verify/XC/P115AB12");
        Assert.Equal("ZEDX", r.GetProperty("certification").GetString());
        Assert.Equal("ZEDX/M/2026/000001", r.GetProperty("details").GetProperty("CertificateNo").GetString());
    }

    [Fact]
    public async Task My_documents_list_the_zedx_certificate_once_certified()
    {
        var sets = FakeSql.Sets([], [new Dictionary<string, object?> { ["Pledge"] = null, ["Bronze"] = null, ["Silver"] = null, ["Gold"] = null }], [], []);
        _host.Sql.Queries[MsmeMyDocuments.V4CertificatesSql] = _ => [new { Certification = "ZEDX" }];
        await MsmeMyDocuments.AddV4LevelsAsync(_host.Sql, sets, Me, default);
        var client = MsmeMyDocuments.ToClient(sets, Me);
        Assert.Equal($"/api/msme/files/Certificates/SA/{Me}/ZEDX.pdf", client["Certificates"][0]["ZEDX"]);

        _host.Sql.Queries[MsmeMyDocuments.V4CertificatesSql] = _ => [];
        await MsmeMyDocuments.AddV4LevelsAsync(_host.Sql, sets, Me, default);
        Assert.Null(MsmeMyDocuments.ToClient(sets, Me)["Certificates"][0]["ZEDX"]);
    }
}
