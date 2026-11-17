using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Content;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Portal.Features.Msme;

/// <summary>My Documents. Port of MsmeController.MyDocuments / GetMyDocuments.</summary>
[Route("api/msme/documents")]
public sealed class MsmeDocumentsController(
    ISqlExecutor db, IDocumentAccessStore access, IWebHostEnvironment env, IOptions<PortalOptions> portal,
    PledgeCertificateService pledge, ILogger<MsmeDocumentsController> log) : MsmeApiController
{
    /// <summary>
    /// SP_MSME_GET_MY_DOCUMENTS for the signed-in ZED ID: <c>{ Guidelines, Certificates,
    /// PaymentReceipts, Invoices }</c> with the procedure's column names. File columns hold
    /// api/msme/files URLs instead of the old public URLs, or null when there is no servable file — also when the file is
    /// not in storage, so the page shows "not available" instead of a link that fails.
    /// </summary>
    /// <remarks>
    /// 2026-11-18 (the user's applicant designs: each card shows its issue date or validity): also <c>Unit</c> (the ZED ID and
    /// the pledge date, as the pledge certificate prints it) and <c>Certified</c> (per level, the date of certification and
    /// the date the certificate is valid till), both from existing data (<see cref="MsmeDocumentDates"/>).
    /// </remarks>
    [HttpGet]
    public async Task<Dictionary<string, IReadOnlyList<IDictionary<string, object?>>>> Get(CancellationToken ct)
    {
        var root = MsmeFilePaths.Root(env, portal.Value);
        var sets = await MsmeMyDocuments.LoadAsync(db, ZedId, ct);
        await MsmeMyDocuments.AddV4LevelsAsync(db, sets, ZedId, ct);
        var result = MsmeMyDocuments.ToClient(MsmeGuidelines.ForMsme(sets, await access.AllAsync(ct)), ZedId,
            path => MsmeFilePaths.Find(root, path) is not null);

        var pledged = await pledge.LoadAsync(db, ZedId, ct);
        result["Unit"] = [new Dictionary<string, object?>
        {
            ["ZedId"] = ZedId,
            ["PledgeOn"] = MsmeDocumentDates.IsoDate(pledged?.DateOfPledge),
        }];
        result["Certified"] = await MsmeDocumentDates.CertifiedAsync(db, ZedId, log, ct);
        return result;
    }
}

/// <summary>
/// 2026-11-18 (the user's applicant designs): the dates My Documents shows under each certificate and report, from existing
/// data: the date of certification is MsmeCertifications.CertificationStatusDate of the certified record (the date the
/// certificate prints, SP_DA/RA_GET_CERTIFICATE_DETAILS' DateOfCertification), and the certificate is valid till that date
/// plus the level's validity (Administration → Certification Levels, the validity the certificate prints; 36 months when it
/// cannot be read).
/// </summary>
public static class MsmeDocumentDates
{
    /// <summary>
    /// The latest certified record of each level (the rule of <see cref="Documents.DocumentLevels.IsCertifiedRecord"/>: 16, or 6
    /// with its desktop number or a certification phase).
    /// </summary>
    internal const string CertifiedSql =
        "SELECT Certification, MAX(CertificationStatusDate) AS CertifiedOn FROM dbo.MsmeCertifications WHERE ZedId = @ZedId " +
        "AND CertificationStatusDate IS NOT NULL AND (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL " +
        "OR ISNULL(CertificationPhase, 'PENDING') NOT IN ('PENDING', 'REJECTED')))) GROUP BY Certification;";

    public sealed record CertifiedRow(string? Certification, DateTime? CertifiedOn);

    /// <summary>{ Level, CertifiedOn, ValidTill } (yyyy-MM-dd) per certified level; none when the table cannot be read.</summary>
    public static async Task<IReadOnlyList<IDictionary<string, object?>>> CertifiedAsync(ISqlExecutor db, string zedId, ILogger log, CancellationToken ct)
    {
        IReadOnlyList<CertifiedRow> rows;
        try
        {
            rows = await db.QuerySqlAsync<CertifiedRow>(CertifiedSql, new { ZedId = zedId }, ct);
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "My Documents: the certification dates of {ZedId} were not read", zedId);
            return [];
        }
        if (rows.Count == 0) return [];
        var levels = await CertLevels.CertificationLevels.AllAsync(db, log, ct);
        return rows.Where(r => r.CertifiedOn is not null && !string.IsNullOrWhiteSpace(r.Certification)).Select(r =>
        {
            var code = r.Certification!.Trim();
            var months = levels.FirstOrDefault(l => string.Equals(l.Code, code, StringComparison.OrdinalIgnoreCase))?.ValidityMonths
                         ?? Documents.DocumentLevels.DefaultValidityMonths;
            if (months <= 0) months = Documents.DocumentLevels.DefaultValidityMonths;
            var on = r.CertifiedOn!.Value.Date;
            return (IDictionary<string, object?>)new Dictionary<string, object?>
            {
                ["Level"] = code,
                ["CertifiedOn"] = Iso(on),
                ["ValidTill"] = Iso(on.AddMonths(months)),
            };
        }).ToList();
    }

    /// <summary>"January 1, 2026" (the procedures' FORMAT 'MMMM d, yyyy') as 2026-01-01; null when it is not such a date.</summary>
    public static string? IsoDate(string? text) =>
        DateTime.TryParseExact((text ?? "").Trim(), ["MMMM d, yyyy", "MMM d, yyyy", "dd/MM/yyyy", "dd-MM-yyyy", "yyyy-MM-dd"],
            System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var d)
            ? Iso(d) : null;

    private static string Iso(DateTime d) => d.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
}

/// <summary>Reads SP_MSME_GET_MY_DOCUMENTS and knows which of its columns name files.</summary>
public static class MsmeMyDocuments
{
    public const string Procedure = "SP_MSME_GET_MY_DOCUMENTS";

    private static readonly string[] SetNames = ["Guidelines", "Certificates", "PaymentReceipts", "Invoices"];

    /// <summary>2026-11-08: the certificate of every V4 level (ZED-X and the levels the Admin added) as ZEDX's.</summary>
    private static (int Set, string Column, MsmeFileScope Scope)[] FileColumns =>
    [
        (0, "DocumentPath", MsmeFileScope.Public),
        (1, "Pledge", MsmeFileScope.Own),
        (1, "Bronze", MsmeFileScope.Own),
        (1, "Silver", MsmeFileScope.Own),
        (1, "Gold", MsmeFileScope.Own),
        .. Zed.Core.Data.LevelRegistry.V4Codes.Select(c => (1, c, MsmeFileScope.Own)),
        (2, "BronzeReceipt", MsmeFileScope.Own),
        (2, "SilverReceipt", MsmeFileScope.Own),
        (2, "GoldReceipt", MsmeFileScope.Own),
        (3, "InvoicePath", MsmeFileScope.Own),
    ];

    /// <summary>
    /// WASH and webinar certificates of MSME KAWACH (the procedure's Wash and Webinar columns, links to the KAWACH
    /// portal): not offered since MSME KAWACH was removed (2026-11-06), so they are taken out of the answer.
    /// </summary>
    internal static readonly string[] KawachColumns = ["Wash", "Webinar"];

    public static Task<ResultSets> LoadAsync(ISqlExecutor db, string zedId, CancellationToken ct) =>
        db.QueryProcMultipleAsync(Procedure, new { ZedId = zedId }, ct);

    /// <summary>
    /// The certificates of V4 levels (ZED-X and, since 2026-11-08, the levels the Admin added; the procedure lists Bronze,
    /// Silver and Gold only): Certificates/SA/{ZedId}/{Level}.pdf once certified (a desktop level: status 6 with its desktop
    /// number, Certificates/DA/...).
    /// </summary>
    internal const string V4CertificatesSql =
        "SELECT Certification, CAST(CASE WHEN CertificationStatus = 6 THEN 1 ELSE 0 END AS bit) AS AtDesktop " +
        "FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification NOT IN ('Bronze', 'Silver', 'Gold') " +
        "AND ((CertificationStatus = 16 AND SaCertificateNo IS NOT NULL) OR (CertificationStatus = 6 AND DaCertificateNo IS NOT NULL));";

    /// <param name="AtDesktop">Certified at the desktop (status 6; 2026-11-15: by the record, whatever the level's flow is now).</param>
    public sealed record V4Certificate(string Certification, bool? AtDesktop = null);

    /// <summary>Adds a column per V4 level (ZEDX, ...) to the certificates row (null when not certified), as the procedure's Gold column.</summary>
    public static async Task AddV4LevelsAsync(ISqlExecutor db, ResultSets sets, string zedId, CancellationToken ct)
    {
        if (sets[1].FirstOrDefault() is not { } row) return;
        IReadOnlyList<V4Certificate> certified;
        try
        {
            certified = await db.QuerySqlAsync<V4Certificate>(V4CertificatesSql, new { ZedId = zedId }, ct);
        }
        catch (System.Data.Common.DbException)
        {
            certified = [];
        }
        foreach (var level in Zed.Core.Data.LevelRegistry.V4Codes)
            row[level] = certified.FirstOrDefault(c => string.Equals(c.Certification?.Trim(), level, StringComparison.OrdinalIgnoreCase)) is { } c
                ? Documents.DocumentLevels.CertificatePath(zedId, level, c.AtDesktop) : null;
    }

    /// <summary>The files the procedure lists for this ZED ID that pass the path checks (pass sets already through <see cref="MsmeGuidelines.ForMsme"/>).</summary>
    public static IEnumerable<MsmeFileEntry> Files(ResultSets sets, string zedId)
    {
        foreach (var (set, column, scope) in FileColumns)
            foreach (var row in sets[set])
                if (Servable(row.Text(column), scope, zedId) is { } path)
                    yield return new MsmeFileEntry(path, scope);
    }

    /// <param name="stored">When given, a file it does not find is listed without a link (the pledge certificate is drawn, never read).</param>
    public static Dictionary<string, IReadOnlyList<IDictionary<string, object?>>> ToClient(ResultSets sets, string zedId, Func<string, bool>? stored = null)
    {
        var result = sets.ToClient(SetNames);
        foreach (var (set, column, scope) in FileColumns)
            foreach (var row in result[SetNames[set]])
                if (row.ContainsKey(column))
                    row[column] = Servable(row.Text(column), scope, zedId) is { } path &&
                                  (stored is null || MsmeFilePaths.IsPledge(path, zedId) || stored(path))
                        ? MsmeFilePaths.ToApiUrl(path)
                        : null;

        // The WASH and webinar certificates of MSME KAWACH are not offered (removed 2026-11-06).
        foreach (var row in result[SetNames[1]])
            foreach (var column in KawachColumns)
                row.Remove(column);
        return result;
    }

    private static string? Servable(string value, MsmeFileScope scope, string zedId)
    {
        var path = MsmeFilePaths.FromLegacy(value);
        if (path is null) return null;
        var ok = scope == MsmeFileScope.Public ? MsmeFilePaths.IsPublicFolder(path) : MsmeFilePaths.BelongsTo(path, zedId);
        return ok ? path : null;
    }

}
