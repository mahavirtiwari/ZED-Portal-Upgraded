using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Zed.Core.Data;

/// <summary>
/// The certification levels known to every host (portals, mobile API), for code that checks or lists level codes without a
/// database call of its own (2026-11-08, "generic certification levels"). Bronze, Silver and Gold are the legacy levels with
/// their own procedures and flags; every other level in dbo.SectionTypes (IsCertificationLevel = 1) is a "V4 level" and
/// behaves as ZED-X (code ZEDX), its precedent: per-level columns named after the code (<see cref="PaymentColumn"/>,
/// <see cref="AgencyColumn"/>), the V4 procedures, its own QR digit.
/// Read when the host starts and every few minutes (Levels:RefreshMinutes, default 5), and right after the Admin saves a
/// level. Until the first read, or when the table cannot be read, the four built-in levels are used; the built-in four are
/// always known, whatever the table holds.
/// </summary>
public static partial class LevelRegistry
{
    /// <param name="Code">As stored everywhere (Sections.SectionType, MsmeCertifications.Certification).</param>
    /// <param name="AssessmentMode">"Desktop" (desktop assessment only, as Bronze) or "Site" (desktop and site).</param>
    /// <param name="QrDigit">The digit between the plant ID and the random part of the certificate's QR number (SectionTypes.QrDigit, migration 0065).</param>
    public sealed record Entry(string Code, string Name, bool IsEnabled, string AssessmentMode, int OrderNo, string? QrDigit = null);

    public const string Desktop = "Desktop";
    public const string Site = "Site";
    public const string ZedX = "ZEDX";

    /// <summary>The levels of the legacy procedures (Is{Level}PaymentDone of the legacy payment procedures, the legacy jobs).</summary>
    public static readonly IReadOnlyList<string> Legacy = ["Bronze", "Silver", "Gold"];

    /// <summary>Bronze, Silver, Gold and ZED-X, as before the table is read.</summary>
    public static readonly IReadOnlyList<Entry> BuiltIn =
    [
        new("Bronze", "Bronze", true, Desktop, 10, "2"),
        new("Silver", "Silver", true, Site, 20),
        new("Gold", "Gold", true, Site, 30, "4"),
        new(ZedX, "ZED-X", true, Site, 40, "5"),
    ];

    /// <summary>Level codes: 2 to 20 letters and digits, starting with a letter (they name columns, so nothing else is accepted).</summary>
    [GeneratedRegex("^[A-Za-z][A-Za-z0-9]{1,19}$")]
    public static partial Regex CodePattern();

    /// <summary>The QR digits a new V4 level may get, in order (2 Bronze, 4 Gold, 5 ZED-X are taken; 3 is kept free).</summary>
    public static readonly IReadOnlyList<string> QrDigits =
        ["6", "7", "8", "9", .. Enumerable.Range('A', 26).Select(c => ((char)c).ToString())];

    public const string Sql =
        "SELECT SectionType AS Code, ISNULL(DisplayName, SectionType) AS Name, CAST(ISNULL(IsEnabled, 0) AS bit) AS IsEnabled, " +
        "ISNULL(AssessmentMode, 'Site') AS AssessmentMode, ISNULL(OrderNo, 0) AS OrderNo, QrDigit " +
        "FROM dbo.SectionTypes WHERE IsCertificationLevel = 1;";

    /// <summary>The same before migration 0065 (no QrDigit column yet).</summary>
    public static readonly string SqlWithoutQrDigit = Sql.Replace(", QrDigit ", ", CAST(NULL AS varchar(1)) AS QrDigit ");

    private static Snapshot current = new(BuiltIn);

    /// <summary>Every level, by order number (enabled or not).</summary>
    public static IReadOnlyList<Entry> All => current.List;

    public static IReadOnlyList<string> Codes => current.Codes;

    /// <summary>The V4 levels (not Bronze / Silver / Gold), ZED-X first among equals by order number.</summary>
    public static IReadOnlyList<string> V4Codes => current.V4;

    public static Entry? Find(string? code) =>
        code is not null && current.ByCode.TryGetValue(code.Trim(), out var e) ? e : null;

    /// <summary>The stored spelling of a known level code (any case); null for anything else.</summary>
    public static string? Canonical(string? code) => Find(code)?.Code;

    public static bool IsLegacy(string? code) =>
        code is not null && Legacy.Any(l => string.Equals(l, code.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>A known level that is not Bronze, Silver or Gold (ZED-X and the levels the Admin added).</summary>
    public static bool IsV4(string? code) => Find(code) is { } e && !IsLegacy(e.Code);

    /// <summary>What pages show ("ZED-X" for ZEDX); the code itself when unknown.</summary>
    public static string NameOf(string? code) => Find(code)?.Name ?? code ?? "";

    /// <summary>Assessed at the desktop only, as Bronze: Bronze, and V4 levels whose AssessmentMode is Desktop (ZED-X is always a site level).</summary>
    public static bool IsDesktop(string? code) =>
        Find(code) is { } e
            ? (string.Equals(e.Code, "Bronze", StringComparison.OrdinalIgnoreCase) || (!IsLegacy(e.Code) && e.AssessmentMode == Desktop))
            : string.Equals(code?.Trim(), "Bronze", StringComparison.OrdinalIgnoreCase);

    /// <summary>Msme.Is{Code}PaymentDone (main and ZED_SURVEILLANCE); null for an unknown code.</summary>
    public static string? PaymentColumn(string? code) => Canonical(code) is { } c ? $"Is{c}PaymentDone" : null;

    /// <summary>Main's Msme.IsSur{Code}PaymentDone (the surveillance fee paid); null for an unknown code.</summary>
    public static string? SurveillancePaymentColumn(string? code) => Canonical(code) is { } c ? $"IsSur{c}PaymentDone" : null;

    /// <summary>
    /// Users.Allow{Code}Assessments of an agency (NULL = allowed). ZED-X's was named by hand (AllowZedxAssessments, 0060);
    /// a new level's is exactly Allow + its code + Assessments (SQL Server ignores the case).
    /// </summary>
    public static string AgencyColumn(string code) => $"Allow{AgencySuffix(code)}Assessments";

    /// <summary>Users.ReasonForBlock{Code}: why the level was disabled for the agency.</summary>
    public static string AgencyReasonColumn(string code) => $"ReasonForBlock{AgencySuffix(code)}";

    private static string AgencySuffix(string code) =>
        string.Equals(code, ZedX, StringComparison.OrdinalIgnoreCase) ? "Zedx"
        : code.Length > 0 ? char.ToUpperInvariant(code[0]) + code[1..] : code;

    /// <summary>The QR digit of a level (ZED-X "5"); null when none is set.</summary>
    public static string? QrDigitOf(string? code) => Find(code)?.QrDigit;

    /// <summary>Reads the levels: main's own table, or main's table by name from another database's connection.</summary>
    public static async Task RefreshAsync(ISqlExecutor db, bool fromOtherDatabase, CancellationToken ct)
    {
        string Q(string sql) => fromOtherDatabase ? sql.Replace("FROM dbo.SectionTypes", "FROM ZEDCS_V2_LIVE.dbo.SectionTypes") : sql;
        IReadOnlyList<Entry> rows;
        try { rows = await db.QuerySqlAsync<Entry>(Q(Sql), null, ct); }
        catch (SqlException ex) when (ex.Number == 207)
        {
            rows = await db.QuerySqlAsync<Entry>(Q(SqlWithoutQrDigit), null, ct);   // migration 0065 not applied yet
        }
        Apply(rows);
    }

    /// <summary>
    /// Uses <paramref name="rows"/> with the built-in four (a row overrides the built-in level of its code). Keeps the last
    /// list when there is no row. Rows with a code that is not 2 to 20 letters and digits are ignored.
    /// </summary>
    public static bool Apply(IEnumerable<Entry> rows)
    {
        var list = rows.Where(r => r is not null && r.Code is not null && CodePattern().IsMatch(r.Code.Trim()))
            .Select(r => r with
            {
                Code = r.Code.Trim(),
                Name = string.IsNullOrWhiteSpace(r.Name) ? r.Code.Trim() : r.Name.Trim(),
                AssessmentMode = r.AssessmentMode == Desktop ? Desktop : Site,
                QrDigit = string.IsNullOrWhiteSpace(r.QrDigit) ? null : r.QrDigit.Trim(),
            })
            .DistinctBy(r => r.Code, StringComparer.OrdinalIgnoreCase).ToList();
        if (list.Count == 0) return false;
        foreach (var b in BuiltIn)
        {
            var i = list.FindIndex(r => string.Equals(r.Code, b.Code, StringComparison.OrdinalIgnoreCase));
            if (i < 0) list.Add(b);
            // The built-in levels keep their spelling and the rules of their procedures (Bronze desktop; Silver, Gold and
            // ZED-X site: the procedures treat ZED-X as Gold whatever its assessment mode says) and ZED-X's QR digit.
            else list[i] = list[i] with { Code = b.Code, AssessmentMode = b.AssessmentMode, QrDigit = list[i].QrDigit ?? b.QrDigit };
        }
        current = new Snapshot(list);
        return true;
    }

    /// <summary>Adds (or replaces) levels, keeping the others: for tests and for a level the Admin just added.</summary>
    public static void Register(params Entry[] entries) => Apply(current.List.Where(e => !entries.Any(n => string.Equals(n.Code, e.Code, StringComparison.OrdinalIgnoreCase))).Concat(entries));

    private sealed class Snapshot
    {
        public Snapshot(IEnumerable<Entry> entries)
        {
            List = entries.OrderBy(e => e.OrderNo).ThenBy(e => e.Code, StringComparer.OrdinalIgnoreCase).ToList();
            Codes = List.Select(e => e.Code).ToList();
            V4 = List.Where(e => !IsLegacy(e.Code)).Select(e => e.Code).ToList();
            ByCode = List.ToDictionary(e => e.Code, StringComparer.OrdinalIgnoreCase);
        }

        public IReadOnlyList<Entry> List { get; }
        public IReadOnlyList<string> Codes { get; }
        public IReadOnlyList<string> V4 { get; }
        public IReadOnlyDictionary<string, Entry> ByCode { get; }
    }
}

/// <summary>Reads the levels when the host starts, then every 5 minutes (Levels:RefreshMinutes; 0 = once, negative = never).</summary>
public sealed class LevelRegistryRefresher(IServiceScopeFactory scopes, IConfiguration config, ILogger<LevelRegistryRefresher> log, bool fromOtherDatabase)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var minutes = config.GetValue("Levels:RefreshMinutes", 5);
        if (minutes < 0) return;   // never read (tests): the built-in levels and those registered by hand
        var warned = false;
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    using var scope = scopes.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<ISqlExecutor>();
                    // Only against the database itself: a host whose executor was replaced (the tests' fakes) keeps the built-in
                    // levels and those registered by hand, and sees no extra database call.
                    if (db is not SqlExecutor) return;
                    await LevelRegistry.RefreshAsync(db, fromOtherDatabase, stoppingToken);
                    warned = false;
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    if (!warned) log.LogWarning(ex, "Certification levels could not be read from dbo.SectionTypes; the last list stays in use");
                    warned = true;
                }
                if (minutes <= 0) return;
                await Task.Delay(TimeSpan.FromMinutes(minutes), stoppingToken);
            }
        }
        catch (OperationCanceledException) { /* stopping */ }
    }
}
