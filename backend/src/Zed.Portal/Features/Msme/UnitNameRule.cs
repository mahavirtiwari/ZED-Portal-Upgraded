namespace Zed.Portal.Features.Msme;

/// <summary>
/// 2026-11-19 (the user): units were registering with plant names such as "N/A", "NA", "1", "2", "3". A plant whose unit
/// name (from the Udyam record) is blank or such a placeholder cannot be registered (web, ZED MSME app, partner API) until
/// the name is corrected on the Udyam portal.
/// </summary>
public static class UnitNameRule
{
    public const string Refused =
        "The plant / unit name in your Udyam registration is not a valid name (for example N/A, NA, 1, 2 or 3). " +
        "Please update the unit name of this plant on the Udyam portal and then register.";

    /// <summary>Placeholder words, compared in capitals with letters and digits only ("N.A." → "NA").</summary>
    private static readonly HashSet<string> Placeholders = new(StringComparer.Ordinal)
    {
        "NA", "NAN", "NIL", "NULL", "NONE", "NO", "NOT", "NOTAPPLICABLE", "NOTAVAILABLE", "NOTKNOWN", "UNKNOWN",
        "TEST", "TESTING", "DUMMY", "SAMPLE", "XYZ", "ABC", "ABCD", "ASDF", "QWERTY",
        "UNIT", "UNITS", "PLANT", "FACTORY", "UNITNAME", "PLANTNAME", "NAME", "SAME", "SAMEASABOVE", "DITTO", "DO", "OTHER", "OTHERS",
    };

    /// <summary>True when the unit name is blank or a placeholder (N/A, NA, 1, 2, "Unit 1", "Plant-2", "XXX", ...).</summary>
    public static bool IsPlaceholder(string? unitName)
    {
        var n = new string((unitName ?? "").ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
        if (n.Length < 2) return true;                                   // "", "-", ".", "A", "1"
        if (n.All(char.IsDigit)) return true;                            // "12", "001"
        if (n.Distinct().Count() == 1) return true;                      // "XXX", "AAAA"
        if (Placeholders.Contains(n)) return true;
        // A placeholder word followed by a number: "Unit 1", "Plant No. 2", "NA1".
        var word = n.TrimEnd('0', '1', '2', '3', '4', '5', '6', '7', '8', '9');
        if (word.EndsWith("NO", StringComparison.Ordinal) && word.Length > 2 && word.Length < n.Length) word = word[..^2];
        return word.Length < n.Length && Placeholders.Contains(word);
    }
}
