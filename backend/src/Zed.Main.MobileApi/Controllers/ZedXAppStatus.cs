using System.Data.Common;
using Zed.Core.Data;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// ZED-X (level code ZEDX, migrations 0028-0031) in the MSME app's status. SP_APP_MSME_STATUS and SP_APP_MSME_CHECK_LOGIN
/// return fixed columns for Bronze, Silver and Gold; these are ZED-X's under the same names (ZEDXStatus, ZEDXStatusOfNc,
/// ZEDXStatusOfNc1..5, Nc1StatusTextZEDX..Nc5, ZEDXSelfieStatus), computed as the procedure computes Gold's: 4 certified
/// (status &gt; 15), 3 site assessment (&gt; 8), 2 submitted (&gt;= 2), 1 paid (Msme.IsZEDXPaymentDone), 0 otherwise.
/// </summary>
internal static class ZedXAppStatus
{
    public const string Level = "ZEDX";

    public sealed record Row(int ZEDXStatus, int ZEDXStatusOfNc, int ZEDXStatusOfNc1, int ZEDXStatusOfNc2, int ZEDXStatusOfNc3,
        int ZEDXStatusOfNc4, int ZEDXStatusOfNc5, int ZEDXSelfieStatus, string? Nc1StatusTextZEDX, string? Nc2StatusTextZEDX,
        string? Nc3StatusTextZEDX, string? Nc4StatusTextZEDX, string? Nc5StatusTextZEDX, string? ZEDXCertificatePath = null);

    private static string NcText(int n) =>
        $"(SELECT TOP 1 h.Descrip FROM dbo.MsmeHistory h WHERE h.ZedId = m.ZedId AND h.StatusType IN ('Nc{n}Raised', 'Nc{n}Submitted') " +
        $"AND h.CertificationType = 'ZEDX' ORDER BY h.Id DESC) AS Nc{n}StatusTextZEDX";

    internal static readonly string Sql =
        "SELECT CASE WHEN c.CertificationStatus > 15 THEN 4 WHEN c.CertificationStatus > 8 THEN 3 WHEN c.CertificationStatus >= 2 THEN 2 " +
        "WHEN m.IsZEDXPaymentDone = 1 THEN 1 ELSE 0 END AS ZEDXStatus, ISNULL(c.NcCount, 0) AS ZEDXStatusOfNc, " +
        "ISNULL(c.Nc1Status, 0) AS ZEDXStatusOfNc1, ISNULL(c.Nc2Status, 0) AS ZEDXStatusOfNc2, ISNULL(c.Nc3Status, 0) AS ZEDXStatusOfNc3, " +
        "ISNULL(c.Nc4Status, 0) AS ZEDXStatusOfNc4, ISNULL(c.Nc5Status, 0) AS ZEDXStatusOfNc5, ISNULL(c.IsSaSelfieSubmitted, 0) AS ZEDXSelfieStatus, " +
        string.Join(", ", Enumerable.Range(1, 5).Select(NcText)) + ", " +
        // The certificate as My Documents lists it (MsmeMyDocuments.AddV4LevelsAsync): certified, certificate number given.
        "CASE WHEN c.CertificationStatus = 16 AND c.SaCertificateNo IS NOT NULL THEN 'Certificates/SA/' + m.ZedId + '/ZEDX.pdf' END AS ZEDXCertificatePath " +
        "FROM dbo.Msme m LEFT JOIN dbo.MsmeCertifications c ON c.ZedId = m.ZedId AND c.Certification = 'ZEDX' WHERE m.ZedId = @ZedId;";

    /// <summary>ZED-X's row for the unit, or null (unknown unit, or migration 0029 not applied).</summary>
    public static async Task<Row?> ReadAsync(ISqlExecutor db, string? zedId, ILogger log, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(zedId)) return null;
        try
        {
            return (await db.QuerySqlAsync<Row>(Sql, new { ZedId = zedId }, ct)).FirstOrDefault();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "ZED-X app status not read for {ZedId} (is migration 0029 applied?)", zedId);
            return null;
        }
    }

    /// <summary>Adds ZED-X's columns to a status row of SP_APP_MSME_STATUS (left as it is when they cannot be read).</summary>
    public static async Task MergeAsync(ISqlExecutor db, string? zedId, IDictionary<string, object?> row, ILogger log, CancellationToken ct)
    {
        if (await ReadAsync(db, zedId, log, ct) is not { } r) return;
        row["ZEDXStatus"] = r.ZEDXStatus;
        row["ZEDXStatusOfNc"] = r.ZEDXStatusOfNc;
        row["ZEDXStatusOfNc1"] = r.ZEDXStatusOfNc1;
        row["ZEDXStatusOfNc2"] = r.ZEDXStatusOfNc2;
        row["ZEDXStatusOfNc3"] = r.ZEDXStatusOfNc3;
        row["ZEDXStatusOfNc4"] = r.ZEDXStatusOfNc4;
        row["ZEDXStatusOfNc5"] = r.ZEDXStatusOfNc5;
        row["ZEDXSelfieStatus"] = r.ZEDXSelfieStatus;
        row["Nc1StatusTextZEDX"] = r.Nc1StatusTextZEDX;
        row["Nc2StatusTextZEDX"] = r.Nc2StatusTextZEDX;
        row["Nc3StatusTextZEDX"] = r.Nc3StatusTextZEDX;
        row["Nc4StatusTextZEDX"] = r.Nc4StatusTextZEDX;
        row["Nc5StatusTextZEDX"] = r.Nc5StatusTextZEDX;
        row["ZEDXCertificatePath"] = r.ZEDXCertificatePath;
    }

    /// <summary>
    /// GetMyDocuments: adds the ZEDX column to the certificates row (SP_MSME_GET_MY_DOCUMENTS lists Bronze, Silver and Gold
    /// only), null until certified, as the portal's My Documents does.
    /// </summary>
    public static async Task AddCertificateAsync(ISqlExecutor db, string? zedId, IDictionary<string, object?>? certificates, ILogger log, CancellationToken ct)
    {
        if (certificates is null) return;
        certificates["ZEDX"] = (await ReadAsync(db, zedId, log, ct))?.ZEDXCertificatePath;
    }
}
