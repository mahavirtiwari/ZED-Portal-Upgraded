using System.Globalization;
using System.Text.RegularExpressions;
using Zed.Core.Data;
using Zed.Portal.Features.CertLevels;
using Zed.Portal.Features.Documents;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff.Monitoring;

/// <summary>
/// The Admin's settings for a certificate of a V4 level (ZED-X), applied right after SP_MONITORING_RA_FINAL_SUBMIT
/// certified it (status 16): the number in the level's format (Administration → Certification Levels, the unit's
/// Manufacturing / Services format when set) instead of the procedure's {DDMMYYYY}_{ZEDNO}, and the first surveillance
/// date from the level's settings instead of the procedure's 365 days. Bronze, Silver and Gold keep the procedure's.
/// A number given earlier (a certification issued again keeps its number in the procedure too) is not changed.
/// </summary>
public static partial class LevelCertification
{
    internal const string RowSql =
        "SELECT SaCertificateNo, CertificationStatusDate FROM dbo.MsmeCertifications " +
        "WHERE ZedId = @ZedId AND Certification = @Level AND CertificationStatus = 16;";

    internal const string UpdateSql =
        "UPDATE dbo.MsmeCertifications SET SaCertificateNo = @CertificateNo, FirstSurveDueDate = @FirstSurveDueDate " +
        "WHERE ZedId = @ZedId AND Certification = @Level AND CertificationStatus = 16 AND SaCertificateNo = @ProcedureNo;";

    public sealed record Row(string? SaCertificateNo, DateTime? CertificationStatusDate);

    /// <summary>The number SP_MONITORING_RA_FINAL_SUBMIT writes: ddMMyyyy_{ZED ID digits}.</summary>
    [GeneratedRegex(@"^\d{8}_\d+$")]
    private static partial Regex ProcedureNumber();

    /// <summary>The certificate number now in force (null when the record is not certified).</summary>
    public static async Task<string?> ApplyAsync(ISqlExecutor db, string zedId, string level, ILogger log, CancellationToken ct)
    {
        if (DocumentLevels.IsBuiltIn(level)) return null;
        var row = (await db.QuerySqlAsync<Row>(RowSql, new { ZedId = zedId, Level = level }, ct)).FirstOrDefault();
        if (row?.SaCertificateNo is not { Length: > 0 } current || !ProcedureNumber().IsMatch(current)) return row?.SaCertificateNo;
        var settings = await CertificationLevels.FindAsync(db, level, log, ct);
        if (settings is null) return current;

        var date = row.CertificationStatusDate ?? DateTime.Now;
        var category = await UserSectorActivity.UnitCategoryAsync(db, zedId, log, ct);
        var number = CertificateNumbers.Format(CertificateNumbers.FormatFor(settings, category), date, zedId, level, category);
        DateTime? surveillance = settings.SurveillanceEnabled ? date.AddMonths(settings.FirstSurveillanceMonths ?? 12) : null;
        await db.ExecuteSqlAsync(UpdateSql, new
        {
            ZedId = zedId,
            Level = level,
            CertificateNo = number.Length > 50 ? number[..50] : number,
            FirstSurveDueDate = surveillance,
            ProcedureNo = current,
        }, ct);
        log.LogInformation("{Level} certificate of {ZedId} numbered {Number} (Admin format); first surveillance {Due}", level, zedId, number,
            surveillance?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "none");
        return number;
    }
}
