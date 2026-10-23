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
}
