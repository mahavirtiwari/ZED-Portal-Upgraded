using System.Text.RegularExpressions;

namespace Zed.Core.Data;

/// <summary>
/// A unit's ZED ID. Units registered before migration 0051 have ZEDMSME followed by digits (ZEDMSME000123); new units
/// have their sector's letter: ZEDM000123 (Manufacturing) or ZEDS000123 (Services), each sector with its own counter
/// from 000001 (7 digits after 999999). Rejected or archived copies of a record add a suffix (ZEDM000123_D_45): they are
/// not unit IDs here.
/// </summary>
public static partial class ZedIds
{
    [GeneratedRegex(@"^(?:ZEDMSME\d{1,12}|ZED[MS]\d{6,12})$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex UnitPattern();

    /// <summary>A unit's own ZED ID, old (ZEDMSME000123) or new (ZEDM000123 / ZEDS000123); nothing else.</summary>
    public static bool IsUnitId(string? value) => value is { Length: <= 30 } && UnitPattern().IsMatch(value);

    /// <summary>
    /// The serial part of a certificate number (date_serial), as dbo.FN_V4_CERTIFICATE_SERIAL (migration 0051): old IDs
    /// lose "ZEDMSME" (ZEDMSME129350 → 129350), new IDs lose "ZED" (ZEDM000123 → M000123, ZEDS000045 → S000045).
    /// </summary>
    public static string CertificateSerial(string zedId)
    {
        if (zedId.StartsWith("ZEDMSME", StringComparison.OrdinalIgnoreCase)) return zedId[7..];
        if (zedId.Length > 4 && zedId.StartsWith("ZED", StringComparison.OrdinalIgnoreCase)
            && (zedId[3] is 'M' or 'S' or 'm' or 's') && char.IsAsciiDigit(zedId[4]))
            return zedId[3..];
        return zedId.Length > 7 ? zedId[7..] : zedId;
    }
}
