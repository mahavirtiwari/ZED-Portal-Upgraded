using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace Zed.Core.Data;

/// <summary>
/// The ZED procedures and a few inline queries name the other databases with three-part names
/// (<c>ZED_CONSULTANT.dbo.PaymentGatewayTransactions</c>), so one SQL Server instance holds one set of those names. A
/// second set on the same instance (the V4 staging set next to an older one) carries a prefix, <c>Database:Prefix</c>
/// (e.g. <c>ZEDV4_</c>: ZEDV4_ZEDCS_V2_LIVE, ZEDV4_ZED_CONSULTANT, ...; database\setup.ps1 -DatabasePrefix builds it).
/// <see cref="SqlExecutor"/> maps the names in inline SQL with <see cref="Map(string)"/>; the procedures of a prefixed set
/// were mapped when it was built. Same rules as database\ZedDatabaseNames.ps1. Never in Production: the live
/// databases have their own names (<see cref="Problems"/>).
/// </summary>
public static partial class ZedDatabaseNames
{
    public const string PrefixSetting = "Database:Prefix";

    /// <summary>The logical names, as the scripts and the code write them.</summary>
    public static readonly IReadOnlyList<string> Logical =
        ["ZEDCS_V2_LIVE", "ZED_CONSULTANT", "ZED_SURVEILLANCE", "ZED_CENTER_AUDIT_PROFESSIONAL", "ZED_CENTER_AUDIT_V2", "ZED_IMPACT_ASSESSMENT", "KAWACH"];

    private const int CacheLimit = 2000;
    private static readonly ConcurrentDictionary<string, string> Cache = new(StringComparer.Ordinal);

    /// <summary>The prefix of this process ("" unless <c>Database:Prefix</c> is set).</summary>
    public static string Prefix { get; private set; } = "";

    public static void Configure(IConfiguration config) => UsePrefix(config[PrefixSetting]);

    public static void UsePrefix(string? prefix)
    {
        prefix = prefix?.Trim() ?? "";
        if (prefix.Length > 0 && !PrefixPattern().IsMatch(prefix))
            throw new InvalidOperationException($"{PrefixSetting} '{prefix}': use letters, digits and _ only (at most 20 characters, starting with a letter), e.g. ZEDV4_");
        Prefix = prefix;
        Cache.Clear();
    }

    /// <summary>Inline SQL with this process's prefix applied (unchanged without one).</summary>
    public static string Map(string sql)
    {
        if (Prefix.Length == 0 || string.IsNullOrEmpty(sql)) return sql;
        if (Cache.TryGetValue(sql, out var mapped)) return mapped;
        mapped = Map(sql, Prefix);
        if (Cache.Count < CacheLimit) Cache.TryAdd(sql, mapped);
        return mapped;
    }

    /// <summary>
    /// Rewrites database names followed by '.' (three- and four-part names, [X].dbo.Y), after USE and DATABASE, and quoted
    /// literals that are exactly a name ('X', N'X'). Names inside longer identifiers (SP_..._KAWACH), folders in file paths
    /// (E:\Publish\ZEDCS_LIVE\ZEDCS_V2_LIVE\...) and names already carrying the prefix are left as they are.
    /// </summary>
    public static string Map(string sql, string prefix)
    {
        if (prefix.Length == 0 || string.IsNullOrEmpty(sql)) return sql;
        string Replace(Match m)
        {
            var g = m.Groups["name"];
            var canonical = Logical.First(n => n.Equals(g.Value, StringComparison.OrdinalIgnoreCase));
            return string.Concat(m.Value.AsSpan(0, g.Index - m.Index), prefix, canonical, m.Value.AsSpan(g.Index - m.Index + g.Length));
        }
        sql = Dotted().Replace(sql, Replace);
        sql = AfterKeyword().Replace(sql, Replace);
        return Quoted().Replace(sql, Replace);
    }

    /// <summary>The name of a logical database on this instance.</summary>
    public static string Physical(string logical) =>
        Prefix.Length > 0 && Logical.Contains(logical, StringComparer.OrdinalIgnoreCase)
            ? Prefix + Logical.First(n => n.Equals(logical, StringComparison.OrdinalIgnoreCase))
            : logical;

    /// <summary>Startup check: a prefix is a test-environment setting and is refused in Production.</summary>
    public static IReadOnlyList<string> Problems(IConfiguration config, IHostEnvironment env)
    {
        var prefix = config[PrefixSetting];
        if (string.IsNullOrWhiteSpace(prefix)) return [];
        if (env.IsProduction()) return [$"{PrefixSetting} is set: the live databases have their own names, never a prefix"];
        return PrefixPattern().IsMatch(prefix.Trim()) ? [] : [$"{PrefixSetting} '{prefix}': use letters, digits and _ only (at most 20, starting with a letter)"];
    }

    private const string Names = "ZED_CENTER_AUDIT_PROFESSIONAL|ZED_IMPACT_ASSESSMENT|ZED_CENTER_AUDIT_V2|ZED_SURVEILLANCE|ZED_CONSULTANT|ZEDCS_V2_LIVE|KAWACH";

    [GeneratedRegex(@"(?<![A-Za-z0-9_\\/@#$])\[?(?<name>" + Names + @")\]?(?=\s*\.)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Dotted();

    [GeneratedRegex(@"\b(?:USE|DATABASE)\s+\[?(?<name>" + Names + @")\]?(?![A-Za-z0-9_])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex AfterKeyword();

    [GeneratedRegex(@"(?<![A-Za-z0-9_])N?'(?<name>" + Names + @")'", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Quoted();

    [GeneratedRegex("^[A-Za-z][A-Za-z0-9_]{0,19}$")]
    private static partial Regex PrefixPattern();
}
