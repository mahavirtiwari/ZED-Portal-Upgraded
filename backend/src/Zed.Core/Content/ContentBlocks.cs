using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;

namespace Zed.Core.Content;

/// <summary>Where a text is shown.</summary>
public enum ContentChannel { Web, App }

/// <summary>
/// A disclaimer, instruction, undertaking or pledge the Admin can edit (Admin → Texts). <paramref name="DefaultHtml"/>
/// is the standard text; <paramref name="Placeholders"/> are the {{Fields}} the page or the app fills in (HTML-encoded).
/// </summary>
public sealed record ContentBlock(string Key, string Name, string Group, ContentChannel Channel, PortalSystem[] Systems,
    string DefaultHtml, string[] Placeholders);

/// <summary>The Admin's version of a text (dbo.V4ContentBlocks, migration 0016): shown or not, and optionally its own HTML.</summary>
public sealed record ContentBlockOverride(string BlockKey, bool Enabled, string? BodyHtml, string? UpdatedBy, DateTime? UpdatedOn);

/// <summary>A text as the page or the app shows it: the Admin's text, or the standard one; not shown when switched off.</summary>
public sealed record ContentText(string Key, bool Enabled, string Html);

public interface IContentBlockStore
{
    Task<IReadOnlyDictionary<string, ContentBlockOverride>> AllAsync(CancellationToken ct = default);

    Task SaveAsync(string key, bool enabled, string? bodyHtml, string userId, CancellationToken ct = default);

    /// <summary>Back to the standard text (the row is removed).</summary>
    Task ResetAsync(string key, CancellationToken ct = default);
}

public sealed class SqlContentBlockStore(ISqlExecutor db, ILogger<SqlContentBlockStore> log) : IContentBlockStore
{
    internal const string SelectSql = "SELECT BlockKey, Enabled, BodyHtml, UpdatedBy, UpdatedOn FROM dbo.V4ContentBlocks;";
    private static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(30);
    private sealed record Cached(IReadOnlyDictionary<string, ContentBlockOverride> Rows, DateTime Until);
    private volatile Cached? cached;

    public async Task<IReadOnlyDictionary<string, ContentBlockOverride>> AllAsync(CancellationToken ct = default)
    {
        if (cached is { } c && c.Until > DateTime.UtcNow) return c.Rows;
        IReadOnlyDictionary<string, ContentBlockOverride> rows;
        try
        {
            rows = (await db.QuerySqlAsync<ContentBlockOverride>(SelectSql, null, ct)).ToDictionary(r => r.BlockKey, StringComparer.OrdinalIgnoreCase);
        }
        catch (SqlException ex)
        {
            log.LogWarning(ex, "Could not read dbo.V4ContentBlocks (is migration 0016 applied?); the standard texts are shown.");
            rows = new Dictionary<string, ContentBlockOverride>();
        }
        cached = new Cached(rows, DateTime.UtcNow + Lifetime);
        return rows;
    }

    public async Task SaveAsync(string key, bool enabled, string? bodyHtml, string userId, CancellationToken ct = default)
    {
        await db.ExecuteSqlAsync(
            "MERGE dbo.V4ContentBlocks AS t USING (SELECT @BlockKey AS BlockKey) AS s ON t.BlockKey = s.BlockKey " +
            "WHEN MATCHED THEN UPDATE SET Enabled = @Enabled, BodyHtml = @BodyHtml, UpdatedBy = @UpdatedBy, UpdatedOn = SYSUTCDATETIME() " +
            "WHEN NOT MATCHED THEN INSERT (BlockKey, Enabled, BodyHtml, UpdatedBy) VALUES (@BlockKey, @Enabled, @BodyHtml, @UpdatedBy);",
            new { BlockKey = key, Enabled = enabled, BodyHtml = string.IsNullOrWhiteSpace(bodyHtml) ? null : bodyHtml.Trim(), UpdatedBy = userId.Length <= 50 ? userId : userId[..50] }, ct);
        cached = null;
    }

    public async Task ResetAsync(string key, CancellationToken ct = default)
    {
        await db.ExecuteSqlAsync("DELETE FROM dbo.V4ContentBlocks WHERE BlockKey = @BlockKey;", new { BlockKey = key }, ct);
        cached = null;
    }
}

/// <summary>The texts of a system and channel as shown (served to the web pages and to the apps).</summary>
public sealed class ContentTexts(IContentBlockStore store)
{
    public async Task<IReadOnlyList<ContentText>> ForAsync(PortalSystem system, ContentChannel channel, CancellationToken ct = default)
    {
        var saved = await store.AllAsync(ct);
        return ContentCatalogue.For(system).Where(b => b.Channel == channel).Select(b =>
        {
            var o = saved.GetValueOrDefault(b.Key);
            return new ContentText(b.Key, o?.Enabled ?? true, o is { Enabled: true, BodyHtml: { Length: > 0 } html } ? html : b.DefaultHtml);
        }).ToList();
    }

    /// <summary>The {{Fields}} a text may use: its own, nothing else (the page fills them in).</summary>
    public static IEnumerable<string> UnknownPlaceholders(ContentBlock block, string? html) =>
        EmailPlaceholders.Used(html).Where(p => !block.Placeholders.Contains(p, StringComparer.OrdinalIgnoreCase));
}
