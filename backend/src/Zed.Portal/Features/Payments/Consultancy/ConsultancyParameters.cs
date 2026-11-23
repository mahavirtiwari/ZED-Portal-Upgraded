using System.Data.Common;
using Zed.Core.Data;

namespace Zed.Portal.Features.Payments.Consultancy;

/// <summary>
/// Right after a milestone payment copied the level's questionnaire into the unit's handholding questionnaire
/// (ZED_CONSULTANT.dbo.MsmeSections, MsmeRequirements, ...; the legacy payment procedures copy every parameter), the
/// parameters that do not apply are taken out of that copy, as main's SP_V4_CERTIFICATION_PAID does for a certification:
/// the ones the Admin disabled in the Consultancy questionnaire (ZED_CONSULTANT.dbo.Sections.IsDisabled), and the ones of
/// other NIC sectors (Sections.NicSectors, empty = every sector; the unit's sector is Msme.TwoDigitActivity).
/// 2026-11-23 (migration 0113): Consultancy has its own questionnaire, so main's Sections.InConsultancy is no longer read.
/// Only the copy of the milestone just paid (its NcCount) is touched; earlier milestones keep theirs.
/// </summary>
public static class ConsultancyParameters
{
    internal const string RemoveSql = """
        DECLARE @Nc int = (SELECT MAX(NcCount) FROM ZED_CONSULTANT.dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification);
        DECLARE @Nic varchar(10) = (SELECT TOP 1 LEFT(LTRIM(TwoDigitActivity), 2) FROM ZED_CONSULTANT.dbo.Msme WHERE ZedId = @ZedId);
        DECLARE @Off TABLE (SectionCode varchar(50) PRIMARY KEY);
        INSERT INTO @Off (SectionCode)
            SELECT DISTINCT LTRIM(RTRIM(SectionCode)) FROM ZED_CONSULTANT.dbo.Sections
            WHERE SectionType = @Certification AND SectionCode IS NOT NULL
              AND (ISNULL(IsDisabled, 0) = 1
                   OR (@Nic IS NOT NULL AND LEN(@Nic) = 2
                       AND NULLIF(LTRIM(RTRIM(NicSectors)), '') IS NOT NULL
                       AND CHARINDEX(',' + @Nic + ',', ',' + REPLACE(NicSectors, ' ', '') + ',') = 0));
        IF @Nc IS NOT NULL AND EXISTS (SELECT 1 FROM @Off)
        BEGIN
            DELETE x FROM ZED_CONSULTANT.dbo.MsmeEvidences x JOIN @Off o ON o.SectionCode = LTRIM(RTRIM(x.SectionCode))
                WHERE x.ZedId = @ZedId AND x.SectionType = @Certification AND x.NcCount = @Nc;
            DELETE x FROM ZED_CONSULTANT.dbo.MsmeSubOptions x JOIN @Off o ON o.SectionCode = LTRIM(RTRIM(x.SectionCode))
                WHERE x.ZedId = @ZedId AND x.SectionType = @Certification AND x.NcCount = @Nc;
            DELETE x FROM ZED_CONSULTANT.dbo.MsmeOptions x JOIN @Off o ON o.SectionCode = LTRIM(RTRIM(x.SectionCode))
                WHERE x.ZedId = @ZedId AND x.SectionType = @Certification AND x.NcCount = @Nc;
            DELETE x FROM ZED_CONSULTANT.dbo.MsmeRequirements x JOIN @Off o ON o.SectionCode = LTRIM(RTRIM(x.SectionCode))
                WHERE x.ZedId = @ZedId AND x.SectionType = @Certification AND x.NcCount = @Nc;
            DELETE x FROM ZED_CONSULTANT.dbo.MsmeSections x JOIN @Off o ON o.SectionCode = LTRIM(RTRIM(x.SectionCode))
                WHERE x.ZedId = @ZedId AND x.SectionType = @Certification AND x.NcCount = @Nc;
        END
        """;

    /// <summary>Never fails the payment: an error (e.g. migration 0113 not applied) is logged and the full copy stays.</summary>
    public static async Task ApplyAsync(ISqlExecutor db, string zedId, string certification, ILogger log, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(RemoveSql, new { ZedId = zedId, Certification = certification }, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Disabled / other-sector parameters were not removed from the handholding copy of {ZedId}/{Level} (is migration 0113 applied?)", zedId, certification);
        }
    }
}
