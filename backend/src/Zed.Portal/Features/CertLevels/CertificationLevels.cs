using System.Data.Common;
using System.Globalization;
using System.Text.RegularExpressions;
using Zed.Core.Data;

namespace Zed.Portal.Features.CertLevels;

/// <summary>
/// A ZED certification level as the Admin set it (Administration → Certification Levels; dbo.SectionTypes columns of
/// migration 0028). <see cref="Code"/> is the value stored everywhere (Sections.SectionType, AssessmentFee.Certification,
/// MsmeCertifications.Certification): "Bronze", "Silver", "Gold", "ZEDX"; <see cref="Name"/> is what pages show ("ZED-X").
/// </summary>
/// <param name="AssessmentMode">"Desktop" (desktop assessment only, as Bronze) or "Site" (desktop and site assessment).</param>
/// <param name="CertNoFormat">The certificate number (<see cref="CertificateNumbers"/>); the Manufacturing / Services formats apply once set.</param>
/// <param name="Fee">The fee shown on the level's box (the amounts charged are in Masters → Payments).</param>
/// <param name="SurveillanceCount">V4 levels (migration 0032): the surveillance schedule run by SP_V4_LEVEL_SURVEILLANCE_SCHEDULE;
/// null = the Silver / Gold value (<see cref="SurveillanceSchedule.Default"/>). Since migration 0037 the schedule runs Bronze, Silver
/// and Gold too (their legacy jobs switched off).</param>
/// <param name="SurveillanceAutoApply">0037: the last reminder applies the unit for its surveillance itself (desktop levels, as Bronze).</param>
/// <param name="SurveillanceSuspendRounds">0037: how many rounds suspend a unit that did not apply: null every round, 0 none
/// (Bronze), 1 the first only (Silver / Gold).</param>
/// <param name="SurveillanceScheduleFrom">0037: the day the V4 schedule started for the level (9999-12-31 = not yet; null = no limit).</param>
public sealed record CertificationLevel(
    string Code, string Name, int OrderNo, string? Description, string? Comment, string? LogoPath, bool IsEnabled,
    string AssessmentMode, int ValidityMonths, bool SurveillanceEnabled, int? FirstSurveillanceMonths,
    string CertNoFormat, string? CertNoFormatManufacturing, string? CertNoFormatService, decimal? Fee,
    string? UpdatedBy = null, DateTime? UpdatedOn = null,
    int? SurveillanceCount = null, int? SurveillanceIntervalMonths = null, int? SurveillanceNoticeMonths = null, int? SurveillanceReminders = null,
    int? SurveillanceReminderEveryMonths = null, int? SurveillanceSuspendAfterMonths = null, int? SurveillanceWithdrawAfterDays = null,
    bool? SurveillanceAutoApply = null, int? SurveillanceSuspendRounds = null, DateTime? SurveillanceScheduleFrom = null)
{
    /// <summary>The V4 schedule has not run for the level yet (Bronze / Silver / Gold before the switch-over).</summary>
    public bool ScheduleNotStarted => SurveillanceScheduleFrom is { Year: 9999 };

    /// <summary>The schedule in force (the Admin's values, the Silver / Gold ones where not set).</summary>
    public SurveillanceSchedule Schedule => new(
        FirstSurveillanceMonths ?? SurveillanceSchedule.Default.FirstDueMonths, SurveillanceCount ?? SurveillanceSchedule.Default.Count,
        SurveillanceIntervalMonths ?? SurveillanceSchedule.Default.IntervalMonths, SurveillanceNoticeMonths ?? SurveillanceSchedule.Default.NoticeMonths,
        SurveillanceReminders ?? SurveillanceSchedule.Default.Reminders, SurveillanceReminderEveryMonths ?? SurveillanceSchedule.Default.ReminderEveryMonths,
        SurveillanceSuspendAfterMonths ?? SurveillanceSchedule.Default.SuspendAfterMonths, SurveillanceWithdrawAfterDays ?? SurveillanceSchedule.Default.WithdrawAfterDays);
}

/// <summary>
/// When surveillance happens and what follows when it is not applied for (migration 0032), counted from the certification
/// date: round r is due <see cref="FirstDueMonths"/> + (r - 1) x <see cref="IntervalMonths"/> months after it.
/// </summary>
public sealed record SurveillanceSchedule(int FirstDueMonths, int Count, int IntervalMonths, int NoticeMonths, int Reminders,
    int ReminderEveryMonths, int SuspendAfterMonths, int WithdrawAfterDays)
{
    /// <summary>What the Silver / Gold jobs do: due at 15 and 27 months, mailed 4 months before, two monthly reminders,
    /// suspended a month after the due date, withdrawn about two months later.</summary>
    public static readonly SurveillanceSchedule Default = new(15, 2, 12, 4, 2, 1, 1, 64);

    public DateTime Due(DateTime certified, int round) => certified.AddMonths(FirstDueMonths + (round - 1) * IntervalMonths);

    /// <summary>What is wrong with the schedule for a certificate valid <paramref name="validityMonths"/> months, or null.</summary>
    public string? Problem(int validityMonths)
    {
        if (Count is < 1 or > 5) return "The number of surveillances must be 1 to 5.";
        if (FirstDueMonths is < 1 or > 120) return "The first surveillance must be due 1 to 120 months after certification.";
        if (Count > 1 && IntervalMonths is < 1 or > 60) return "The months between two surveillances must be 1 to 60.";
        if (FirstDueMonths + (Count - 1) * IntervalMonths >= validityMonths) return "The last surveillance must be due before the certificate expires.";
        if (NoticeMonths is < 0 or > 24) return "The notice must go 0 to 24 months before the due date.";
        if (Reminders is < 0 or > 5) return "The reminders must be 0 to 5.";
        if (Reminders > 0 && ReminderEveryMonths is < 1 or > 12) return "The months between reminders must be 1 to 12.";
        if (SuspendAfterMonths is < 0 or > 24) return "The suspension must come 0 to 24 months after the due date.";
        if (WithdrawAfterDays is < 1 or > 365) return "The withdrawal must come 1 to 365 days after the suspension.";
        return null;
    }
}

/// <summary>Reads the levels; before migration 0028 (or on an error) the three levels as the procedures hard-code them.</summary>
public static class CertificationLevels
{
    public const string Desktop = "Desktop";
    public const string Site = "Site";

    /// <summary>What the procedures do today (number ddMMyyyy_digits, 3 years, first surveillance after 450 / 365 days).</summary>
    public static readonly IReadOnlyList<CertificationLevel> BuiltIn =
    [
        new("Bronze", "Bronze", 10, null, null, null, true, Desktop, 36, true, 15, CertificateNumbers.Default, null, null, null),
        new("Silver", "Silver", 20, null, null, null, true, Site, 36, true, 12, CertificateNumbers.Default, null, null, null),
        new("Gold", "Gold", 30, null, null, null, true, Site, 36, true, 12, CertificateNumbers.Default, null, null, null),
    ];

    internal const string Sql =
        "SELECT SectionType AS Code, ISNULL(DisplayName, SectionType) AS Name, ISNULL(OrderNo, 0) AS OrderNo, Description, Comment, LogoPath, " +
        "CAST(ISNULL(IsEnabled, 0) AS bit) AS IsEnabled, ISNULL(AssessmentMode, 'Site') AS AssessmentMode, ISNULL(ValidityMonths, 36) AS ValidityMonths, " +
        "CAST(ISNULL(SurveillanceEnabled, 0) AS bit) AS SurveillanceEnabled, FirstSurveillanceMonths, " +
        "ISNULL(CertNoFormat, '{DDMMYYYY}_{ZEDNO}') AS CertNoFormat, CertNoFormatManufacturing, CertNoFormatService, Fee, UpdatedBy, UpdatedOn, " +
        ScheduleColumns + "FROM dbo.SectionTypes WHERE IsCertificationLevel = 1 ORDER BY ISNULL(OrderNo, 0), SectionType;";

    private const string ScheduleColumns =
        "SurveillanceCount, SurveillanceIntervalMonths, SurveillanceNoticeMonths, SurveillanceReminders, SurveillanceReminderEveryMonths, " +
        "SurveillanceSuspendAfterMonths, SurveillanceWithdrawAfterDays, " + Columns0037;

    private const string Columns0037 =
        "SurveillanceAutoApply, SurveillanceSuspendRounds, CAST(SurveillanceScheduleFrom AS datetime2) AS SurveillanceScheduleFrom ";

    private const string Null0037 =
        "CAST(NULL AS bit) AS SurveillanceAutoApply, CAST(NULL AS int) AS SurveillanceSuspendRounds, CAST(NULL AS datetime2) AS SurveillanceScheduleFrom ";

    /// <summary>The same before migration 0037 (no auto-apply, suspension rounds or start day yet).</summary>
    internal static readonly string Sql0032 = Sql.Replace(Columns0037, Null0037);

    /// <summary>The same before migration 0032 (no surveillance schedule columns yet).</summary>
    internal static readonly string Sql0028 = Sql.Replace(ScheduleColumns,
        "CAST(NULL AS int) AS SurveillanceCount, CAST(NULL AS int) AS SurveillanceIntervalMonths, CAST(NULL AS int) AS SurveillanceNoticeMonths, " +
        "CAST(NULL AS int) AS SurveillanceReminders, CAST(NULL AS int) AS SurveillanceReminderEveryMonths, " +
        "CAST(NULL AS int) AS SurveillanceSuspendAfterMonths, CAST(NULL AS int) AS SurveillanceWithdrawAfterDays, " + Null0037);

    /// <summary>The same queries from another database's connection (surveillance, consultancy): main's table by name.</summary>
    internal static string FromMain(string sql) => sql.Replace("FROM dbo.SectionTypes", "FROM ZEDCS_V2_LIVE.dbo.SectionTypes");

    /// <param name="fromOtherDatabase">The connection is not main's (the surveillance host's): read main's table.</param>
    public static async Task<IReadOnlyList<CertificationLevel>> AllAsync(ISqlExecutor db, ILogger log, CancellationToken ct, bool fromOtherDatabase = false)
    {
        try
        {
            IReadOnlyList<CertificationLevel> rows;
            try
            {
                rows = await db.QuerySqlAsync<CertificationLevel>(fromOtherDatabase ? FromMain(Sql) : Sql, null, ct);
            }
            catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number == 207)
            {
                // Invalid column: migration 0037 (or 0032) not applied yet.
                try
                {
                    rows = await db.QuerySqlAsync<CertificationLevel>(fromOtherDatabase ? FromMain(Sql0032) : Sql0032, null, ct);
                }
                catch (Microsoft.Data.SqlClient.SqlException ex2) when (ex2.Number == 207)
                {
                    rows = await db.QuerySqlAsync<CertificationLevel>(fromOtherDatabase ? FromMain(Sql0028) : Sql0028, null, ct);
                }
            }
            return rows.Count > 0 ? rows : BuiltIn;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Certification levels not read (is migration 0028 applied?); the built-in levels are used");
            return BuiltIn;
        }
    }

    /// <summary>The level of a code (any case), enabled or not.</summary>
    public static async Task<CertificationLevel?> FindAsync(ISqlExecutor db, string? code, ILogger log, CancellationToken ct, bool fromOtherDatabase = false) =>
        (await AllAsync(db, log, ct, fromOtherDatabase)).FirstOrDefault(l => string.Equals(l.Code, code?.Trim(), StringComparison.OrdinalIgnoreCase));
}

/// <summary>
/// Certificate numbers from the Admin's format. Tokens: {DDMMYYYY} {DD} {MM} {YYYY} {YY} (the date of certification),
/// {ZEDID} (ZEDMSME129350), {ZEDNO} (its digits, 129350), {LEVEL} (the level's code) and {CAT} (M for Manufacturing,
/// S for Services). Today's number is {DDMMYYYY}_{ZEDNO} (SP_MONITORING_DA/RA_FINAL_SUBMIT).
/// </summary>
public static partial class CertificateNumbers
{
    public const string Default = "{DDMMYYYY}_{ZEDNO}";
    public static readonly string[] Tokens = ["{DDMMYYYY}", "{DD}", "{MM}", "{YYYY}", "{YY}", "{ZEDID}", "{ZEDNO}", "{LEVEL}", "{CAT}"];

    [GeneratedRegex(@"\{[A-Z]+\}")]
    private static partial Regex TokenPattern();

    [GeneratedRegex(@"^[A-Za-z0-9_\-/.]*$")]
    private static partial Regex Literal();

    /// <summary>Null when the format can be used; otherwise what is wrong with it.</summary>
    public static string? Problem(string? format, bool required = true)
    {
        var f = format?.Trim() ?? "";
        if (f.Length == 0) return required ? "Please enter the certificate number format." : null;
        if (f.Length > 100) return "The certificate number format can be up to 100 characters.";
        foreach (Match m in TokenPattern().Matches(f))
            if (!Tokens.Contains(m.Value)) return $"{m.Value} is not a known part. Use {string.Join(", ", Tokens)}.";
        if (!Literal().IsMatch(TokenPattern().Replace(f, "")))
            return "Besides the parts in braces, the format can only have letters, digits and _ - / .";
        if (!f.Contains("{ZEDID}") && !f.Contains("{ZEDNO}"))
            return "The format must include {ZEDID} or {ZEDNO}, so that every certificate gets its own number.";
        return null;
    }

    public static string Format(string format, DateTime date, string zedId, string level, string? category)
    {
        var digits = zedId.Length > 7 ? zedId[7..] : zedId;
        var cat = string.Equals(category, "Services", StringComparison.OrdinalIgnoreCase) ? "S"
            : string.Equals(category, "Manufacturing", StringComparison.OrdinalIgnoreCase) ? "M" : "";
        return format
            .Replace("{DDMMYYYY}", date.ToString("ddMMyyyy", CultureInfo.InvariantCulture))
            .Replace("{YYYY}", date.ToString("yyyy", CultureInfo.InvariantCulture))
            .Replace("{YY}", date.ToString("yy", CultureInfo.InvariantCulture))
            .Replace("{MM}", date.ToString("MM", CultureInfo.InvariantCulture))
            .Replace("{DD}", date.ToString("dd", CultureInfo.InvariantCulture))
            .Replace("{ZEDID}", zedId)
            .Replace("{ZEDNO}", digits)
            .Replace("{LEVEL}", level)
            .Replace("{CAT}", cat);
    }

    /// <summary>The format for a unit's category: the category's own when set, else the general one.</summary>
    public static string FormatFor(CertificationLevel level, string? category) =>
        (string.Equals(category, "Manufacturing", StringComparison.OrdinalIgnoreCase) ? level.CertNoFormatManufacturing
            : string.Equals(category, "Services", StringComparison.OrdinalIgnoreCase) ? level.CertNoFormatService : null)
        is { Length: > 0 } own ? own : level.CertNoFormat;
}
