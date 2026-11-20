using System.Data.Common;
using Zed.Core.Data;

namespace Zed.Portal.Features.Incentives;

/// <summary>
/// The schemes (dbo.Incentives rows with a SchemeCode, DashboardCard = 'SCHEME', the definition in SchemeJson; migration 0105)
/// and the settings of the built-in cards that this work added: the Technology Upgradation card's RecommendationRequired and
/// DirectSchemeCode, and every built-in card's ActivatesAfter (the Financial Assistance card: any level; since 2026-11-20 it is
/// also the activation of the built-in Financial Assistance scheme, <see cref="SchemeTemplates.FaCode"/>).
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

        /// <summary>The Technology Upgradation card's direct scheme (<see cref="SchemeTemplates.DirectTuCode"/> until the Admin chose one).</summary>
        public string DirectCode => DirectCodeOf(this);
    }

    /// <summary>The direct Technology Upgradation scheme of the card's settings (<see cref="SchemeTemplates.DirectTuCode"/> when none).</summary>
    public static string DirectCodeOf(CardSettings? tu) =>
        string.IsNullOrWhiteSpace(tu?.DirectSchemeCode) ? SchemeTemplates.DirectTuCode : tu.DirectSchemeCode.Trim();

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

    /// <summary>One creation / upgrade of the built-in schemes at a time on this server (the unique index guards the others).</summary>
    private static readonly SemaphoreSlim BuiltInLock = new(1, 1);

    /// <summary>
    /// Every scheme, after making sure the two built-in ones exist and are up to date (2026-11-20): <see cref="SchemeTemplates.FaCode"/>
    /// (the Financial Assistance card's scheme: added switched on, opening after the card's "Activates after" levels, Bronze /
    /// Silver / Gold when none) and <see cref="SchemeTemplates.DirectTuCode"/> (added switched off); a built-in scheme stored with
    /// an older template version is brought up to date by <see cref="SchemeTemplates.Upgrade"/> (the Admin's own changes kept).
    /// Called by the Admin's lists (Incentive Schemes, Main Dashboard Cards) and the applicant's dashboard and pages. Before
    /// migration 0105 nothing is added.
    /// </summary>
    public async Task<IReadOnlyList<SchemeDefinition>> EnsureBuiltInAsync(CancellationToken ct)
    {
        var all = await AllAsync(ct);
        if (UpToDate(all)) return all;
        await BuiltInLock.WaitAsync(ct);
        try
        {
            all = await AllAsync(ct);
            if (UpToDate(all)) return all;
            var list = all.ToList();
            foreach (var code in new[] { SchemeTemplates.FaCode, SchemeTemplates.DirectTuCode })
            {
                var index = list.FindIndex(d => Same(d.Code, code));
                if (index < 0)
                {
                    var next = list.Count == 0 ? 1 : list.Max(d => d.OrderNo) + 1;
                    var d = code == SchemeTemplates.FaCode
                        ? (await NewFaAsync(ct)) with { Active = true, OrderNo = next }
                        : SchemeTemplates.TechnologyUpgradation() with { Active = false, OrderNo = next };
                    try
                    {
                        await SaveAsync(d, isNew: true, ct);
                    }
                    catch (DbException ex)
                    {
                        log.LogDebug(ex, "Built-in scheme {Code} not added (is migration 0105 applied?)", code);
                        return list;
                    }
                    log.LogInformation("Built-in scheme {Code} added ({State})", code, d.Active ? "on" : "off");
                    list.Add(d);
                }
                else if (list[index].TemplateVersion < SchemeTemplates.Version)
                {
                    var up = SchemeTemplates.Upgrade(list[index]);
                    // The fixes touch the form only: an Admin's form the template cannot fix is left alone (logged).
                    if (SchemeRules.FormProblem(up.Form) is { } problem)
                    {
                        log.LogWarning("Built-in scheme {Code} not upgraded to template version {Version}: {Problem}", code, SchemeTemplates.Version, problem);
                        continue;
                    }
                    try
                    {
                        await SaveAsync(up, isNew: false, ct);
                    }
                    catch (DbException ex)
                    {
                        log.LogWarning(ex, "Built-in scheme {Code} not upgraded", code);
                        continue;
                    }
                    log.LogInformation("Built-in scheme {Code} upgraded from template version {From} to {To}", code, list[index].TemplateVersion, SchemeTemplates.Version);
                    list[index] = up;
                }
            }
            return list;
        }
        finally
        {
            BuiltInLock.Release();
        }

        static bool UpToDate(IReadOnlyList<SchemeDefinition> all) =>
            new[] { SchemeTemplates.FaCode, SchemeTemplates.DirectTuCode }.All(code =>
                all.FirstOrDefault(d => Same(d.Code, code)) is { } d && d.TemplateVersion >= SchemeTemplates.Version);
    }

    /// <summary>The Financial Assistance scheme as first added: the template, opening after the card's levels (graded for each).</summary>
    private async Task<SchemeDefinition> NewFaAsync(CancellationToken ct)
    {
        var fa = SchemeTemplates.FinancialAssistance(SchemeTemplates.FaCode);
        var card = (await CardSettingsAsync(ct)).GetValueOrDefault(FaCard);
        var levels = (card?.ActivationList ?? []).Select(LevelRegistry.Canonical).OfType<string>().Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (levels.Count == 0) return fa;
        var (grading, _) = SchemeTemplates.GradingFor(fa.Grading, levels);
        return fa with { Activation = new() { Mode = SchemeRules.Levels, Levels = levels }, Grading = grading };
    }

    /// <summary>dbo.Incentives.DashboardCard of the built-in Financial Assistance and Technology Upgradation cards.</summary>
    public const string FaCard = "FINANCIAL_ASSISTANCE";
    public const string TuCard = "TECHNOLOGY_UPGRADATION";

    public static bool Same(string? a, string? b) => string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);

    public Task SaveCardSettingsAsync(CardSettings s, CancellationToken ct) =>
        db.ExecuteSqlAsync(SaveCardSettingsSql, new
        {
            s.Card, ActivatesAfter = string.IsNullOrWhiteSpace(s.ActivatesAfter) ? null : s.ActivatesAfter,
            s.RecommendationRequired, DirectSchemeCode = string.IsNullOrWhiteSpace(s.DirectSchemeCode) ? null : s.DirectSchemeCode,
        }, ct);

    private static Dapper.DbString Ansi(string? v, int length) => new() { Value = v, IsAnsi = true, Length = length };
}
