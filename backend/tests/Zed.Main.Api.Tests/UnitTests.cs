using System.Text;
using Zed.Core.Certificates;
using Zed.Core.Http;
using Zed.Portal.Features.Msme;

namespace Zed.Main.Api.Tests;

public sealed class UdyamParsingTests
{
    [Fact]
    public void Parses_tables_and_keeps_legacy_column_names()
    {
        const string xml = """
            <NewDataSet>
              <BasicDetail><UdyogAadharNo>UDYAM-UP-29-0003915</UdyogAadharNo><EnterpriseName>Acme</EnterpriseName><State_Id>9</State_Id><DISTRICT_NAME>KANPUR</DISTRICT_NAME></BasicDetail>
              <Plant><PlantIdNo>P1</PlantIdNo><UnitName>Unit 1</UnitName></Plant>
              <Plant><PlantIdNo>P2</PlantIdNo><UnitName>Unit 2</UnitName></Plant>
              <Activities><Activity>Manufacturing</Activity><Two_DigitActivity>24</Two_DigitActivity></Activities>
            </NewDataSet>
            """;
        var r = UdyamClient.Parse(new MemoryStream(Encoding.UTF8.GetBytes(xml)));

        Assert.Equal("UDYAM-UP-29-0003915", r.BasicDetails["UdyogAadharNo"]);
        Assert.Equal("KANPUR", r.BasicDetails["DISTRICT_NAME"]);
        Assert.Equal(["P1", "P2"], r.Plants.Select(p => p["PlantIdNo"]));
        Assert.Equal("24", Assert.Single(r.Activities)["Two_DigitActivity"]);
    }

    [Fact]
    public void Missing_tables_come_back_empty()
    {
        var r = UdyamClient.Parse(new MemoryStream("<NewDataSet><BasicDetail><UdyogAadharNo>NO</UdyogAadharNo></BasicDetail></NewDataSet>"u8.ToArray()));
        Assert.Equal("NO", r.BasicDetails["UdyogAadharNo"]);
        Assert.Empty(r.Plants);
        Assert.Empty(r.Activities);
    }

    [Fact]
    public void Builds_the_legacy_path_with_the_key_as_configured()
    {
        // A made-up key in the service's format (prefix + base64 ending in '=').
        Assert.Equal("GetUdyam/UDYAM-XX-00-0000001,9000000000,testkey-QUJDRA==",
            UdyamClient.BuildPath("UDYAM-XX-00-0000001", "9000000000", "testkey-QUJDRA=="));
        // Typed values are escaped, so they cannot add path segments or a query.
        Assert.Equal("GetUdyam/UDYAM%2F..%3Fx%3D1,90%2C00,k+1",
            UdyamClient.BuildPath("UDYAM/..?x=1", "90,00", "k+1"));
        // A key character that would break the path is escaped.
        Assert.EndsWith(",a%2Fb", UdyamClient.BuildPath("U", "M", "a/b"));
        // The full address keeps the key as built.
        var uri = new Uri(new Uri("https://udyogaadhaar.gov.in/sv/UAMRestServiceAssist.svc/"), UdyamClient.BuildPath("UDYAM-XX-00-0000001", "9000000000", "testkey-QUJDRA=="));
        Assert.EndsWith("/sv/UAMRestServiceAssist.svc/GetUdyam/UDYAM-XX-00-0000001,9000000000,testkey-QUJDRA==", uri.AbsoluteUri);
    }

    [Fact]
    public void Rejects_dtd_entities()
    {
        const string xml = """<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///c:/windows/win.ini">]><NewDataSet><BasicDetail><A>&e;</A></BasicDetail></NewDataSet>""";
        Assert.ThrowsAny<System.Xml.XmlException>(() => UdyamClient.Parse(new MemoryStream(Encoding.UTF8.GetBytes(xml))));
    }
}

public sealed class PasswordPolicyTests
{
    [Theory]
    [InlineData("Abcdef1!", true)]
    [InlineData("abcdef1!", false)]
    [InlineData("ABCDEF1!", false)]
    [InlineData("Abcdefg!", false)]
    [InlineData("Abcdefg1", false)]
    [InlineData("Ab1!", false)]
    public void Validates(string password, bool ok) => Assert.Equal(ok, PasswordPolicy.Validate(password) is null);
}

public sealed class CertificateTests
{
    [Fact]
    public void Renders_a_one_page_pdf_from_the_pledge_template()
    {
        var dir = Path.Combine(AppContext.BaseDirectory, "Assets", "Certificates");
        var pdf = CertificateComposer.RenderPdf(new CertificateRequest(
            Path.Combine(dir, "Pledge.jpg"),
            CertificateComposer.LoadLayout(Path.Combine(dir, "PledgeCertification.json")),
            [new("Name", "Acme Unit 1", Bold: true), new("CertificateNo", "ZED/PLEDGE/0001"),
             new("Address", "Plot 4, Industrial Area, Kanpur, Uttar Pradesh 208001", Anchor: TextAnchor.BoxBottomCenter)],
            "QrCode", "QR0001"));

        var text = Encoding.Latin1.GetString(pdf);
        Assert.StartsWith("%PDF", text);
        Assert.Contains("/Type /Page", text);
        Assert.InRange(pdf.Length, 100_000, 3_000_000); // template JPEG embedded once, not re-rasterised
    }

    /// <summary>
    /// 2026-11-21 (the user: the QR "is not as per the original one"): the old sites drew the ThoughtWorks QR (scale 3, a
    /// 96 dpi bitmap) at its physical size on the 300 dpi artwork, 300/96 larger: 308 px of modules on the old portal's
    /// certificates, on a white square of about 312 px. V4 had drawn 3 px modules (99 px) on the assessment certificates.
    /// </summary>
    [Fact]
    public void The_qr_is_drawn_at_the_old_sites_size_on_every_certificate()
    {
        Assert.Equal(9.375f, CertificateComposer.QrModulePixels(null));
        Assert.InRange(CertificateComposer.QrModules * CertificateComposer.QrModulePixels(null), 305, 312);
        Assert.Equal(312.5f, CertificateComposer.QrSidePixels(null));

        var assets = Path.Combine(AppContext.BaseDirectory, "Assets");
        string[] layouts =
        [
            Path.Combine("Certificates", "PledgeCertification.json"),
            Path.Combine("Documents", "DaCertification.json"), Path.Combine("Documents", "SaCertification.json"),
            Path.Combine("Documents", "Surveillance", "DaCertification.json"), Path.Combine("Documents", "Surveillance", "SaCertification.json"),
        ];
        foreach (var layout in layouts)
        {
            var qr = CertificateComposer.LoadLayout(Path.Combine(assets, layout))["QrCode"];
            Assert.True(qr.Module is null or 3, layout); // the legacy encoder's scale; no layout draws its own size
        }

        // ZED_DUMP_CERTS=<folder>: writes every certificate with a QR, to look at them (and decode the QR) by eye.
        if (Environment.GetEnvironmentVariable("ZED_DUMP_CERTS") is { Length: > 0 } dump)
        {
            Directory.CreateDirectory(dump);
            (string Template, string Layout, string Url)[] all =
            [
                ("Certificates/Pledge.jpg", "Certificates/PledgeCertification.json", "https://zedv3.qci.org.in/Verify/PC/400953111112T5Q"),
                ("Documents/DaBronze.jpg", "Documents/DaCertification.json", "https://zedv3.qci.org.in/Verify/BC/40095311112ab3d"),
                ("Documents/SaSilver.jpg", "Documents/SaCertification.json", "https://zedv3.qci.org.in/Verify/SC/40095311113ab3d"),
                ("Documents/SaGold.jpg", "Documents/SaCertification.json", "https://zedv3.qci.org.in/Verify/GC/40095311114ab3d"),
                ("Documents/SaZEDX.jpg", "Documents/SaCertification.json", "https://zedv3.qci.org.in/Verify/XC/40095311115ab3d"),
                ("Documents/Surveillance/DaBronze.jpg", "Documents/Surveillance/DaCertification.json", "https://zedv3.qci.org.in/Verify/BC/40095311112ab3d"),
                ("Documents/Surveillance/SaGold.jpg", "Documents/Surveillance/SaCertification.json", "https://zedv3.qci.org.in/Verify/GC/40095311114ab3d"),
                ("Documents/Surveillance/SaZEDX.jpg", "Documents/Surveillance/SaCertification.json", "https://zedv3.qci.org.in/Verify/XC/40095311115ab3d"),
            ];
            foreach (var (template, layout, url) in all)
            {
                var pdf = CertificateComposer.RenderPdf(new CertificateRequest(Path.Combine(assets, template),
                    CertificateComposer.LoadLayout(Path.Combine(assets, layout)), [new("Name", "Acme Unit 1", Bold: true)], "QrCode", url));
                File.WriteAllBytes(Path.Combine(dump, template.Replace('/', '_').Replace(".jpg", ".pdf")), pdf);
            }
        }
    }
}

public sealed class LegacyClockTests
{
    [Theory]
    // 2026-11-22: legacy procedures' FORMAT(x, 'MMMM dd, yyyy HH:mm tt') put a 24-hour time before AM/PM.
    [InlineData("November 17, 2026 17:29 PM", "November 17, 2026 05:29 PM")]
    [InlineData("November 17, 2026 00:10 AM", "November 17, 2026 12:10 AM")]
    [InlineData("November 17, 2026 05:02 PM", "November 17, 2026 05:02 PM")]
    [InlineData("November 17, 2026 12:30 PM", "November 17, 2026 12:30 PM")]
    [InlineData("Room 13:45 PMx", "Room 13:45 PMx")]
    [InlineData("plain text", "plain text")]
    public void A_24_hour_time_with_am_pm_goes_back_to_the_12_hour_clock(string text, string expected) =>
        Assert.Equal(expected, Zed.Core.Data.LegacyClock.Fix(text));
}

public sealed class UserLevelCountsParameterTests
{
    [Fact]
    public void The_whole_list_sends_a_null_valued_agency_parameter_never_a_missing_one()
    {
        // 2026-11-22: a null DbString made Dapper throw, so the Master Admin's agency and assessor lists answered 500.
        var all = Zed.Portal.Features.Staff.Users.UserLevelCounts.Parameters(null);
        Assert.NotNull(all.AgencyId);
        Assert.Null(all.AgencyId.Value);
        Assert.Equal("ZEDAA0001", Zed.Portal.Features.Staff.Users.UserLevelCounts.Parameters(" ZEDAA0001 ").AgencyId.Value);
        FakeSql.RefuseNullCustomParameters(all);
        Assert.Throws<InvalidOperationException>(() => FakeSql.RefuseNullCustomParameters(new { AgencyId = (Dapper.DbString?)null }));
    }
}
