using System.Data.Common;
using Zed.Core.Data;

namespace Zed.Portal.Features.Payments.Consultancy;

/// <summary>
/// The parameters the Admin marked "not used in consultancy" (main's Sections.InConsultancy = 'No', migration 0035) are taken
/// out of a unit's handholding questionnaire right after a milestone payment copied the level's parameters into
/// ZED_CONSULTANT (the legacy payment procedures copy every parameter and are not changed). Only the copy of the milestone
/// just paid (its NcCount) is touched; earlier milestones keep theirs.
/// </summary>
public static class ConsultancyParameters
{
    internal const string RemoveSql = """
        DECLARE @Nc int = (SELECT MAX(NcCount) FROM ZED_CONSULTANT.dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification);
        DECLARE @Off TABLE (SectionCode varchar(50) PRIMARY KEY);
        INSERT INTO @Off (SectionCode)
            SELECT DISTINCT LTRIM(RTRIM(SectionCode)) FROM ZEDCS_V2_LIVE.dbo.Sections
            WHERE SectionType = @Certification AND InConsultancy = 'No' AND SectionCode IS NOT NULL;
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

    /// <summary>Never fails the payment: an error (e.g. migration 0035 not applied) is logged and the full copy stays.</summary>
    public static async Task ApplyAsync(ISqlExecutor db, string zedId, string certification, ILogger log, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(RemoveSql, new { ZedId = zedId, Certification = certification }, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Parameters not used in consultancy were not removed for {ZedId}/{Level} (is migration 0035 applied?)", zedId, certification);
        }
    }
}
