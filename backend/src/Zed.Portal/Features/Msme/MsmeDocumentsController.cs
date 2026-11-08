using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Content;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Portal.Features.Msme;

/// <summary>My Documents. Port of MsmeController.MyDocuments / GetMyDocuments.</summary>
[Route("api/msme/documents")]
public sealed class MsmeDocumentsController(
    ISqlExecutor db, IDocumentAccessStore access, IWebHostEnvironment env, IOptions<PortalOptions> portal) : MsmeApiController
{
    /// <summary>
    /// SP_MSME_GET_MY_DOCUMENTS for the signed-in ZED ID: <c>{ Guidelines, Certificates,
    /// PaymentReceipts, Invoices }</c> with the procedure's column names. File columns hold
    /// api/msme/files URLs instead of the old public URLs, or null when there is no servable file — also when the file is
    /// not in storage, so the page shows "not available" instead of a link that fails.
    /// </summary>
    [HttpGet]
    public async Task<Dictionary<string, IReadOnlyList<IDictionary<string, object?>>>> Get(CancellationToken ct)
    {
        var root = MsmeFilePaths.Root(env, portal.Value);
        var sets = await MsmeMyDocuments.LoadAsync(db, ZedId, ct);
        await MsmeMyDocuments.AddV4LevelsAsync(db, sets, ZedId, ct);
        return MsmeMyDocuments.ToClient(MsmeGuidelines.ForMsme(sets, await access.AllAsync(ct)), ZedId,
            path => MsmeFilePaths.Find(root, path) is not null);
    }
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
        "SELECT Certification FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification NOT IN ('Bronze', 'Silver', 'Gold') " +
        "AND ((CertificationStatus = 16 AND SaCertificateNo IS NOT NULL) OR (CertificationStatus = 6 AND DaCertificateNo IS NOT NULL));";

    public sealed record V4Certificate(string Certification);

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
            row[level] = certified.Any(c => string.Equals(c.Certification?.Trim(), level, StringComparison.OrdinalIgnoreCase))
                ? Documents.DocumentLevels.CertificatePath(zedId, level) : null;
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
