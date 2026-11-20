using System.Data.Common;
using Zed.Core.Data;

namespace Zed.Portal.Features.Incentives;

/// <summary>
/// The schemes (dbo.Incentives rows with a SchemeCode, DashboardCard = 'SCHEME', the definition in SchemeJson; migration 0105)
/// and the settings of the built-in cards that this work added: the Technology Upgradation card's RecommendationRequired and
/// DirectSchemeCode, and every built-in card's ActivatesAfter (the Financial Assistance card: Bronze / Silver / Gold only).
/// Before migration 0105 there are no schemes and the cards keep their own rules.
/// </summary>
public sealed class SchemeStore(ISqlExecutor db, ILogger<SchemeStore> log)
{
    /// <summary>dbo.Incentives.DashboardCard of a scheme row: the Admin's incentive lists (DashboardCard IS NULL) never show it.</summary>
    public const string SchemeCard = "SCHEME";

    internal const string AllSql =
        "SELECT Id, SchemeCode, SchemeJson, CAST(ISNULL(ActiveStatus, 0) AS bit) AS Active, OrderNo FROM dbo.Incentives " +
        "WHERE SchemeCode IS NOT NULL ORDER BY OrderNo, Id;";

    internal const string InsertSql =
        "INSERT INTO dbo.Incentives (Incentive, Details, CardHighlight, DashboardCard, SchemeCode, SchemeJson, ActiveStatus, OrderNo, DisplayOn) " +
        "VALUES (@Title, @Details, @Highlight, 'SCHEME', @Code, @Json, @Active, @OrderNo, 'Scheme');";

    internal const string UpdateSql =
        "UPDATE dbo.Incentives SET Incentive = @Title, Details = @Details, CardHighlight = @Highlight, SchemeJson = @Json, ActiveStatus = @Active, " +
        "OrderNo = @OrderNo WHERE SchemeCode = @Code;";

    internal const string CardSettingsSql =
        "SELECT DashboardCard AS Card, ActivatesAfter, RecommendationRequired, DirectSchemeCode FROM dbo.Incentives " +
        "WHERE DashboardCard IN ('FINANCIAL_ASSISTANCE', 'TECHNOLOGY_UPGRADATION', 'JOINING_REWARD', 'HANDHOLDING');";

    internal const string SaveCardSettingsSql =
        "UPDATE dbo.Incentives SET ActivatesAfter = @ActivatesAfter, RecommendationRequired = @RecommendationRequired, " +
        "DirectSchemeCode = @DirectSchemeCode WHERE DashboardCard = @Card;";

    public sealed record Row(long Id, string? SchemeCode, string? SchemeJson, bool Active, int? OrderNo);

    /// <summary>A built-in card's settings added by migration 0105.</summary>
    /// <param name="ActivatesAfter">Level codes, or 'Registration' / 'Handholding'; null = the card's own rule.</param>
    /// <param name="RecommendationRequired">Technology Upgradation: null or true = after the consultant's recommendation.</param>
    public sealed record CardSettings(string Card, string? ActivatesAfter, bool? RecommendationRequired, string? DirectSchemeCode)
    {
        public IReadOnlyList<string> ActivationList =>
            (ActivatesAfter ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

        /// <summary>The Technology Upgradation card opens the direct scheme (no consultant's recommendation needed).</summary>
        public bool Direct => RecommendationRequired == false && !string.IsNullOrWhiteSpace(DirectSchemeCode);
    }

    /// <summary>Every scheme (active or not) with its definition; empty before migration 0105.</summary>
    public async Task<IReadOnlyList<SchemeDefinition>> AllAsync(CancellationToken ct)
    {
        try
        {
            var rows = await db.QuerySqlAsync<Row>(AllSql, null, ct);
            return rows.Select(r => SchemeRules.Parse(r.SchemeJson) is { } d ? d with { Code = r.SchemeCode!.Trim(), Active = r.Active, OrderNo = r.OrderNo ?? 0 } : null)
                .Where(d => d is not null).Select(d => d!).ToList();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Schemes not readable (is migration 0105 applied?)");
            return [];
        }
    }

    public async Task<SchemeDefinition?> FindAsync(string? code, CancellationToken ct) =>
        string.IsNullOrWhiteSpace(code) ? null
            : (await AllAsync(ct)).FirstOrDefault(d => string.Equals(d.Code, code.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>Saves (inserts or replaces) a definition the caller has checked with <see cref="SchemeRules.Problem"/>.</summary>
    public async Task SaveAsync(SchemeDefinition d, bool isNew, CancellationToken ct)
    {
        var args = new
        {
            Code = Ansi(d.Code, 40), Title = Ansi(d.Card.Title, 4000), Details = Ansi(d.Card.Details, 4000),
            Highlight = d.Card.Highlight, Json = SchemeRules.Serialize(d), d.Active, d.OrderNo,
        };
        await db.ExecuteSqlAsync(isNew ? InsertSql : UpdateSql, args, ct);
    }

    /// <summary>The built-in cards' settings (empty before migration 0105: every card keeps its own rule).</summary>
    public async Task<IReadOnlyDictionary<string, CardSettings>> CardSettingsAsync(CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<CardSettings>(CardSettingsSql, null, ct))
                .GroupBy(c => c.Card, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Card settings not readable (is migration 0105 applied?)");
            return new Dictionary<string, CardSettings>(StringComparer.OrdinalIgnoreCase);
        }
    }

    public Task SaveCardSettingsAsync(CardSettings s, CancellationToken ct) =>
        db.ExecuteSqlAsync(SaveCardSettingsSql, new
        {
            s.Card, ActivatesAfter = string.IsNullOrWhiteSpace(s.ActivatesAfter) ? null : s.ActivatesAfter,
            s.RecommendationRequired, DirectSchemeCode = string.IsNullOrWhiteSpace(s.DirectSchemeCode) ? null : s.DirectSchemeCode,
        }, ct);

    private static Dapper.DbString Ansi(string? v, int length) => new() { Value = v, IsAnsi = true, Length = length };
}
