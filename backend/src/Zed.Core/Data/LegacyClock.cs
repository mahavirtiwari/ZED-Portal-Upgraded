using System.Globalization;
using System.Text.RegularExpressions;

namespace Zed.Core.Data;

/// <summary>
/// 2026-11-22 (Consultant audit: a photo "Generated at November 17, 2026 17:29 PM"): several legacy procedures
/// (SP_ASSESSMENT_SA_DETAILS and its kin, in every database) format times with <c>FORMAT(x, 'MMMM dd, yyyy HH:mm tt')</c>, a
/// 24-hour clock followed by AM/PM. The pages read those texts as they are, so a 24-hour time with AM/PM is put back on the
/// 12-hour clock ("05:29 PM"; "00:10 AM" → "12:10 AM"). Any other text is returned unchanged.
/// </summary>
public static partial class LegacyClock
{
    [GeneratedRegex(@"\b(1[3-9]|2[0-3]|00):([0-5]\d) (AM|PM)\b", RegexOptions.CultureInvariant)]
    private static partial Regex TwentyFourHourWithMarker();

    public static string Fix(string text) =>
        text.Length is < 8 or > 200 ? text : TwentyFourHourWithMarker().Replace(text, m =>
        {
            var hour = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
            var twelve = hour == 0 ? 12 : hour - 12;
            var marker = hour == 0 ? "AM" : "PM";
            return $"{twelve:00}:{m.Groups[2].Value} {marker}";
        });
}
