using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Core.Content;

/// <summary>
/// Who may open a document of Admin → Documents/Videos, its description and, for a video, its address: the columns
/// AccessRoles, Description and VideoUrl of dbo.MyDocuments (migration 0023). Keyed by MyDocuments.Id;
/// <see cref="OrderNo"/> is MyDocuments.OrderNo, the only key SP_MSME_GET_MY_DOCUMENTS returns. A document whose
/// AccessRoles is empty is shown to the MSMEs only, as before V4.
/// </summary>
public sealed record DocumentAccessRow(long DocumentId, int? OrderNo, string? Description, string? VideoUrl, string Roles, string? UpdatedBy, DateTime? UpdatedOn)
{
    public IReadOnlyList<string> RoleKeys => DocumentRoles.Parse(Roles);

    public bool IsFor(string roleKey) => RoleKeys.Contains(roleKey, StringComparer.OrdinalIgnoreCase);
}

/// <summary>The account types a document can be given to, with this system's names for them.</summary>
public static class DocumentRoles
{
    public const string Msme = "msme";

    /// <summary>Role key of each staff role (the Admin manages the documents and sees them all).</summary>
    private static readonly (string Key, UserRole Role)[] StaffKeys =
    [
        ("masteradmin", UserRole.MasterAdmin), ("agency", UserRole.Agency), ("assessor", UserRole.DesktopAssessor),
        ("coordinator", UserRole.StateCoordinator), ("ministry", UserRole.Ministry), ("superadmin", UserRole.SuperAdmin),
        ("citizenfeedback", UserRole.CitizenFeedback), ("qc", UserRole.QC),
    ];

    public sealed record RoleOption(string Key, string Label);

    /// <summary>The roles of a system, in the order the page lists them.</summary>
    public static IReadOnlyList<RoleOption> For(PortalSystem system) => system switch
    {
        PortalSystem.Consultancy =>
        [
            new("masteradmin", "Master Admin"), new("agency", "Consultant Organisations"), new("assessor", "Consultants / Experts"),
            new("coordinator", "State Coordinators"), new("ministry", "Ministry of MSME"), new("superadmin", "Dashboard - Super Admin"),
            new("citizenfeedback", "Dashboard - Citizen Feedback"), new("qc", "Dashboard - QC"),
        ],
        _ =>
        [
            new(Msme, "MSME Enterprises"), new("masteradmin", "Master Admin"), new("agency", "Assessment Agencies"), new("assessor", "Assessors"),
            new("coordinator", "MSME DFO / State"), new("ministry", "Ministry of MSME"), new("superadmin", "Dashboard - Super Admin"),
            new("citizenfeedback", "Dashboard - Citizen Feedback"), new("qc", "Dashboard - QC"),
        ],
    };

    /// <summary>The role key of a staff role, or null (the Admin, and roles that get no documents).</summary>
    public static string? KeyOf(int roleId) => StaffKeys.FirstOrDefault(k => (int)k.Role == roleId).Key;

    public static IReadOnlyList<string> Parse(string? roles) =>
        (roles ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
}

public interface IDocumentAccessStore
{
    /// <summary>Every document with its access set (empty when migration 0023 is not applied: the documents then go to the MSMEs only).</summary>
    Task<IReadOnlyList<DocumentAccessRow>> AllAsync(CancellationToken ct = default);

    Task SaveAsync(long documentId, string? description, string? videoUrl, IReadOnlyList<string> roles, string userId, CancellationToken ct = default);

    Task DeleteAsync(long documentId, CancellationToken ct = default);
}

public sealed class SqlDocumentAccessStore(ISqlExecutor db, ILogger<SqlDocumentAccessStore> log) : IDocumentAccessStore
{
    internal const string SelectSql =
        "SELECT d.Id AS DocumentId, d.OrderNo, d.Description, d.VideoUrl, d.AccessRoles AS Roles, d.AccessUpdatedBy AS UpdatedBy, d.AccessUpdatedOn AS UpdatedOn " +
        "FROM dbo.MyDocuments d WHERE d.AccessRoles IS NOT NULL;";
    private static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(30);
    private sealed record Cached(IReadOnlyList<DocumentAccessRow> Rows, DateTime Until);
    private volatile Cached? cached;

    public async Task<IReadOnlyList<DocumentAccessRow>> AllAsync(CancellationToken ct = default)
    {
        if (cached is { } c && c.Until > DateTime.UtcNow) return c.Rows;
        IReadOnlyList<DocumentAccessRow> rows;
        try
        {
            rows = await db.QuerySqlAsync<DocumentAccessRow>(SelectSql, null, ct);
        }
        catch (SqlException ex)
        {
            log.LogWarning(ex, "Could not read the access columns of dbo.MyDocuments (is migration 0023 applied?); the documents go to the MSMEs only.");
            rows = [];
        }
        cached = new Cached(rows, DateTime.UtcNow + Lifetime);
        return rows;
    }

    public async Task SaveAsync(long documentId, string? description, string? videoUrl, IReadOnlyList<string> roles, string userId, CancellationToken ct = default)
    {
        await db.ExecuteSqlAsync(
            "UPDATE dbo.MyDocuments SET Description = @Description, VideoUrl = @VideoUrl, AccessRoles = @Roles, AccessUpdatedBy = @UpdatedBy, " +
            "AccessUpdatedOn = SYSUTCDATETIME() WHERE Id = @DocumentId;",
            new
            {
                DocumentId = documentId, Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim(),
                VideoUrl = string.IsNullOrWhiteSpace(videoUrl) ? null : videoUrl.Trim(), Roles = string.Join(',', roles),
                UpdatedBy = userId.Length <= 50 ? userId : userId[..50],
            }, ct);
        cached = null;
    }

    public async Task DeleteAsync(long documentId, CancellationToken ct = default)
    {
        await db.ExecuteSqlAsync(
            "UPDATE dbo.MyDocuments SET Description = NULL, VideoUrl = NULL, AccessRoles = NULL, AccessUpdatedBy = NULL, AccessUpdatedOn = NULL WHERE Id = @DocumentId;",
            new { DocumentId = documentId }, ct);
        cached = null;
    }
}

/// <summary>The guideline documents of SP_MSME_GET_MY_DOCUMENTS as an MSME may see them.</summary>
public static class MsmeGuidelines
{
    /// <summary>
    /// Set 0 (the guidelines) keeps the documents given to the MSMEs (or with no row: those from before V4), with their
    /// Description and VideoUrl; the other sets are unchanged. <paramref name="videoAsPath"/>: the old apps open
    /// DocumentPath, so a video's address is put there.
    /// </summary>
    public static ResultSets ForMsme(ResultSets sets, IReadOnlyList<DocumentAccessRow> access, bool videoAsPath = false)
    {
        var byOrder = access.Where(a => a.OrderNo is not null).GroupBy(a => a.OrderNo!.Value).ToDictionary(g => g.Key, g => g.First());
        var guidelines = new List<IDictionary<string, object?>>();
        foreach (var row in sets[0])
        {
            var a = int.TryParse(row.Text("OrderNo"), out var order) ? byOrder.GetValueOrDefault(order) : null;
            if (a is not null && !a.IsFor(DocumentRoles.Msme)) continue;
            var copy = new Dictionary<string, object?>(row, StringComparer.OrdinalIgnoreCase)
            {
                ["Description"] = a?.Description,
                ["VideoUrl"] = a?.VideoUrl,
            };
            if (videoAsPath && a?.VideoUrl is { Length: > 0 } video) copy["DocumentPath"] = video;
            guidelines.Add(copy);
        }
        return new ResultSets([guidelines, .. Enumerable.Range(1, Math.Max(0, sets.Count - 1)).Select(i => sets[i])]);
    }
}
