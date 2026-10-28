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
        return MsmeMyDocuments.ToClient(MsmeGuidelines.ForMsme(await MsmeMyDocuments.LoadAsync(db, ZedId, ct), await access.AllAsync(ct)), ZedId,
            path => MsmeFilePaths.Find(root, path) is not null);
    }
}

/// <summary>Reads SP_MSME_GET_MY_DOCUMENTS and knows which of its columns name files.</summary>
public static class MsmeMyDocuments
{
    public const string Procedure = "SP_MSME_GET_MY_DOCUMENTS";

    private static readonly string[] SetNames = ["Guidelines", "Certificates", "PaymentReceipts", "Invoices"];

    private static readonly (int Set, string Column, MsmeFileScope Scope)[] FileColumns =
    [
        (0, "DocumentPath", MsmeFileScope.Public),
        (1, "Pledge", MsmeFileScope.Own),
        (1, "Bronze", MsmeFileScope.Own),
        (1, "Silver", MsmeFileScope.Own),
        (1, "Gold", MsmeFileScope.Own),
        (2, "BronzeReceipt", MsmeFileScope.Own),
        (2, "SilverReceipt", MsmeFileScope.Own),
        (2, "GoldReceipt", MsmeFileScope.Own),
        (3, "InvoicePath", MsmeFileScope.Own),
    ];

    /// <summary>
    /// WASH and webinar certificates live on the KAWACH portal, which publishes them itself. The
    /// procedure returns those public URLs; they are passed through only for that host.
    /// </summary>
    private static readonly string[] KawachColumns = ["Wash", "Webinar"];
    public const string KawachHost = "msmekawach.org.in";

    public static Task<ResultSets> LoadAsync(ISqlExecutor db, string zedId, CancellationToken ct) =>
        db.QueryProcMultipleAsync(Procedure, new { ZedId = zedId }, ct);

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

        foreach (var row in result[SetNames[1]])
            foreach (var column in KawachColumns)
                if (row.ContainsKey(column))
                    row[column] = IsKawachUrl(row.Text(column)) ? row.Text(column) : null;
        return result;
    }

    private static string? Servable(string value, MsmeFileScope scope, string zedId)
    {
        var path = MsmeFilePaths.FromLegacy(value);
        if (path is null) return null;
        var ok = scope == MsmeFileScope.Public ? MsmeFilePaths.IsPublicFolder(path) : MsmeFilePaths.BelongsTo(path, zedId);
        return ok ? path : null;
    }

    private static bool IsKawachUrl(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var u) && u.Scheme == Uri.UriSchemeHttps &&
        string.Equals(u.Host, KawachHost, StringComparison.OrdinalIgnoreCase);
}
