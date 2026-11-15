using Zed.Portal.Features.Documents;
using Zed.Portal.Features.Payments;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Main.Api.Tests;

/// <summary>2026-11-15: every flow for every level; a record says where it was certified (migration 0078).</summary>
public sealed class LevelFlowsRecordTests
{
    [Theory]
    // Old records keep their answers.
    [InlineData("Bronze", 6, "01012025_1", "ACTIVE", true)]
    [InlineData("Bronze", 6, null, "ACTIVE", true)]        // an old Bronze without its number: its phase says certified
    [InlineData("Bronze", 6, null, "UPGRADED", true)]
    [InlineData("Silver", 6, null, null, false)]           // a Silver waiting for its visit
    [InlineData("Silver", 16, null, "ACTIVE", true)]
    // New flows.
    [InlineData("Bronze", 16, null, "ACTIVE", true)]       // a Bronze certified after a visit
    [InlineData("Bronze", 6, null, null, false)]           // a Bronze waiting for its visit
    [InlineData("Silver", 6, "15112026_1", "ACTIVE", true)] // a Silver certified at the desktop
    [InlineData("Bronze", 9, null, null, false)]
    public void A_record_is_certified_by_its_own_status_number_and_phase(string level, int status, string? da, string? phase, bool certified)
    {
        Assert.Equal(certified, DocumentLevels.IsCertifiedRecord(status, da, phase));
        var record = new CertificationRecord { Certification = level, CertificationStatus = status, DaCertificateNo = da, CertificationPhase = phase };
        Assert.Equal(certified, record.IsCertified);
        Assert.Equal(certified ? status == 6 : null, record.CertifiedAtDesktop);
    }

    [Fact]
    public void The_certificate_is_where_the_record_was_certified_whatever_the_flow_is_now()
    {
        Assert.Equal("Certificates/SA/ZEDM000001/Bronze.pdf", DocumentLevels.CertificatePath("ZEDM000001", "Bronze", atDesktop: false));
        Assert.Equal("Certificates/DA/ZEDM000001/Silver.pdf", DocumentLevels.CertificatePath("ZEDM000001", "Silver", atDesktop: true));
        Assert.Equal(["Certificates/DA/ZEDM000001/Bronze.pdf", "Certificates/SA/ZEDM000001/Bronze.pdf"], DocumentLevels.CertificatePaths("ZEDM000001", "Bronze"));
    }

    [Fact]
    public void In_progress_follows_the_records_when_they_are_known()
    {
        var bronzeCertified = new HashSet<string>(["Bronze"], StringComparer.OrdinalIgnoreCase);
        var none = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        Assert.False(Certifications.InProgress("Bronze", 6, bronzeCertified));   // certified at the desktop
        Assert.True(Certifications.InProgress("Bronze", 6, none));               // waiting for its visit
        Assert.True(Certifications.InProgress("Bronze", 13, none));              // its site assessment
        Assert.False(Certifications.InProgress("Bronze", 16, none));             // certified after the visit
        Assert.True(Certifications.InProgress("Silver", 17, none));              // a rejection to confirm
        Assert.False(Certifications.InProgress("Silver", 99, none));
        // Without the records: the levels' flows, as before.
        Assert.False(Certifications.InProgress("Bronze", 6));
        Assert.True(Certifications.InProgress("Silver", 6));
    }
}
