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
public sealed record CertificationLevel(
    string Code, string Name, int OrderNo, string? Description, string? Comment, string? LogoPath, bool IsEnabled,
    string AssessmentMode, int ValidityMonths, bool SurveillanceEnabled, int? FirstSurveillanceMonths,
    string CertNoFormat, string? CertNoFormatManufacturing, string? CertNoFormatService, decimal? Fee,
    string? UpdatedBy = null, DateTime? UpdatedOn = null);

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
        "ISNULL(CertNoFormat, '{DDMMYYYY}_{ZEDNO}') AS CertNoFormat, CertNoFormatManufacturing, CertNoFormatService, Fee, UpdatedBy, UpdatedOn " +
        "FROM dbo.SectionTypes WHERE IsCertificationLevel = 1 ORDER BY ISNULL(OrderNo, 0), SectionType;";

    public static async Task<IReadOnlyList<CertificationLevel>> AllAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        try
        {
            var rows = await db.QuerySqlAsync<CertificationLevel>(Sql, null, ct);
            return rows.Count > 0 ? rows : BuiltIn;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Certification levels not read (is migration 0028 applied?); the built-in levels are used");
            return BuiltIn;
        }
    }

    /// <summary>The level of a code (any case), enabled or not.</summary>
    public static async Task<CertificationLevel?> FindAsync(ISqlExecutor db, string? code, ILogger log, CancellationToken ct) =>
        (await AllAsync(db, log, ct)).FirstOrDefault(l => string.Equals(l.Code, code?.Trim(), StringComparison.OrdinalIgnoreCase));
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
