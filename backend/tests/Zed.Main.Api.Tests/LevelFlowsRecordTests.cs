using Zed.Core.Data;
using Zed.Portal.Features.Documents;
using Zed.Portal.Features.Payments;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Main.Api.Tests;

/// <summary>2026-11-15: every flow for every level; a record says where it was certified (migration 0078).</summary>
public sealed class LevelFlowsRecordTests
{
    /// <summary>The report's "ZED Gold", and "ZED-X" itself (the walkthrough found "ZED ZED-X").</summary>
    [Theory]
    [InlineData("Gold", "ZED Gold")]
    [InlineData("ZED-X", "ZED-X")]
    [InlineData("zed-x", "zed-x")]
    [InlineData("Titanium", "ZED Titanium")]
    public void Zed_title_puts_zed_in_front_once(string name, string expected) => Assert.Equal(expected, LevelRegistry.ZedTitle(name));

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
    // 0084: PENDING is MsmeCertifications.CertificationPhase's default until certified, REJECTED the rejection's: neither counts.
    [InlineData("Silver", 6, null, "PENDING", false)]       // a Silver waiting for its visit, as the database has it
    [InlineData("Bronze", 6, null, "PENDING", false)]       // a Bronze with a visit, waiting for it
    [InlineData("Gold", 6, null, "pending", false)]
    [InlineData("Bronze", 6, null, "REJECTED", false)]
    [InlineData("Silver", 6, "15112026_1", "PENDING", true)] // the desktop number certifies whatever the phase
    [InlineData("Bronze", 6, null, "WITHDRAWN", true)]      // set only on certified records
    [InlineData("Bronze", 6, null, "EXPIRED", true)]
    [InlineData("Silver", 16, null, "PENDING", true)]       // 16 is only reached by certification
    public void A_record_is_certified_by_its_own_status_number_and_phase(string level, int status, string? da, string? phase, bool certified)
    {
        Assert.Equal(certified, DocumentLevels.IsCertifiedRecord(status, da, phase));
        var record = new CertificationRecord { Certification = level, CertificationStatus = status, DaCertificateNo = da, CertificationPhase = phase };
        Assert.Equal(certified, record.IsCertified);
        Assert.Equal(certified ? status == 6 : null, record.CertifiedAtDesktop);
    }

    [Theory]
    // 2026-11-15: the built-in levels take the Admin's flow from the table (AssessmentMode in step with it, migration 0078).
    [InlineData("Bronze", "Site", "Site")]        // Bronze with a visit (Remote only, Desktop + Onsite ...)
    [InlineData("Silver", "Desktop", "Desktop")]  // Silver Desktop only
    [InlineData("Gold", "desktop", "Desktop")]
    [InlineData("ZEDX", "Desktop", "Desktop")]
    // The default flows, and an empty column (older database): the built-in modes.
    [InlineData("Bronze", "Desktop", "Desktop")]
    [InlineData("Silver", "Site", "Site")]
    [InlineData("Bronze", "", "Desktop")]
    [InlineData("Silver", null, "Site")]
    [InlineData("ZEDX", " ", "Site")]
    public void The_registry_takes_a_built_in_levels_mode_from_the_table(string code, string? mode, string expected)
    {
        var list = LevelRegistry.Merge([new LevelRegistry.Entry(code.ToLowerInvariant(), code, true, mode!, 10)])!;
        var entry = Assert.Single(list, e => string.Equals(e.Code, code, StringComparison.OrdinalIgnoreCase));
        Assert.Equal(code, entry.Code);   // the built-in spelling
        Assert.Equal(expected, entry.AssessmentMode);
        // The other built-in levels are added with their defaults.
        Assert.Equal(LevelRegistry.BuiltIn.Select(b => b.Code).Order(), list.Select(e => e.Code).Order());
        Assert.All(list.Where(e => e != entry), e => Assert.Equal(LevelRegistry.BuiltIn.Single(b => b.Code == e.Code).AssessmentMode, e.AssessmentMode));
    }

    [Fact]
    public void The_registry_keeps_the_built_in_qr_digits_unless_the_table_sets_one()
    {
        var list = LevelRegistry.Merge([new LevelRegistry.Entry("Bronze", "Bronze", true, "Site", 10), new LevelRegistry.Entry("ZEDX", "ZED-X", true, "Site", 40, "7")])!;
        Assert.Equal("2", list.Single(e => e.Code == "Bronze").QrDigit);
        Assert.Equal("7", list.Single(e => e.Code == "ZEDX").QrDigit);
        Assert.Null(LevelRegistry.Merge([]));
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
