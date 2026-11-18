using System.Data.Common;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Portal.Features.Staff.Tat;

/// <summary>
/// The TAT rules of the portal's own database (migration 0101: dbo.TatStatusDays, dbo.TatRelations), read and written by
/// Administration → TAT and read by the monitoring pages. Before the migration nothing can be read (no TAT anywhere) and
/// nothing saved (the Admin is told to apply it).
/// </summary>
public static class TatStore
{
    public const int MaxStatusDays = 365;
    public const int MaxRelationDays = 999;
    public const int MaxRelations = 60;
    public const int MaxName = 100;

    public const string NotSaved = "The TAT could not be saved. Please ask the administrator to apply database migration 0101.";

    internal const string StatusDaysSql = "SELECT Certification, StatusCode, Days FROM dbo.TatStatusDays;";

    internal const string RelationsSql =
        "SELECT Id, Name, Certification, FromStatus, ToStatus, Days, IsActive, SortOrder FROM dbo.TatRelations ORDER BY SortOrder, Id;";

    /// <summary>One level's days: the statuses given are replaced (a blank one is removed), the others stay.</summary>
    internal const string SaveStatusDaySql =
        "DELETE FROM dbo.TatStatusDays WHERE Certification = @Certification AND StatusCode = @StatusCode; " +
        "IF @Days IS NOT NULL INSERT INTO dbo.TatStatusDays (Certification, StatusCode, Days, UpdatedBy, UpdatedOn) " +
        "VALUES (@Certification, @StatusCode, @Days, @UpdatedBy, GETDATE());";

    internal const string InsertRelationSql =
        "INSERT INTO dbo.TatRelations (Name, Certification, FromStatus, ToStatus, Days, IsActive, SortOrder, UpdatedBy, UpdatedOn) " +
        "VALUES (@Name, @Certification, @FromStatus, @ToStatus, @Days, @IsActive, " +
        "(SELECT ISNULL(MAX(SortOrder), 0) + 1 FROM dbo.TatRelations), @UpdatedBy, GETDATE());";

    internal const string UpdateRelationSql =
        "UPDATE dbo.TatRelations SET Name = @Name, Certification = @Certification, FromStatus = @FromStatus, ToStatus = @ToStatus, " +
        "Days = @Days, IsActive = @IsActive, UpdatedBy = @UpdatedBy, UpdatedOn = GETDATE() WHERE Id = @Id;";

    internal const string DeleteRelationSql = "DELETE FROM dbo.TatRelations WHERE Id = @Id;";

    private sealed class RelationRow
    {
        public int Id { get; init; }
        public string? Name { get; init; }
        public string? Certification { get; init; }
        public string? FromStatus { get; init; }
        public string? ToStatus { get; init; }
        public int Days { get; init; }
        public bool IsActive { get; init; }
        public int SortOrder { get; init; }
    }

    private sealed class StatusRow
    {
        public string? Certification { get; init; }
        public string? StatusCode { get; init; }
        public int Days { get; init; }
    }

    public static async Task<IReadOnlyList<TatStatusRule>> StatusDaysAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<StatusRow>(StatusDaysSql, null, ct))
                .Where(r => !string.IsNullOrWhiteSpace(r.Certification) && !string.IsNullOrWhiteSpace(r.StatusCode) && r.Days > 0)
                .Select(r => new TatStatusRule(r.Certification!.Trim(), r.StatusCode!.Trim(), r.Days)).ToList();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "TAT days per status not readable (is migration 0101 applied?)");
            return [];
        }
    }

    public static async Task<IReadOnlyList<TatRelation>> RelationsAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<RelationRow>(RelationsSql, null, ct))
                .Where(r => !string.IsNullOrWhiteSpace(r.FromStatus) && !string.IsNullOrWhiteSpace(r.ToStatus))
                .Select(r => new TatRelation(r.Id, r.Name?.Trim() ?? "", string.IsNullOrWhiteSpace(r.Certification) ? null : r.Certification.Trim(),
                    r.FromStatus!.Trim(), r.ToStatus!.Trim(), r.Days, r.IsActive, r.SortOrder)).ToList();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "TAT relations not readable (is migration 0101 applied?)");
            return [];
        }
    }

    /// <summary>The portal's rules for the evaluator (none before migration 0101).</summary>
    public static async Task<TatRules> RulesAsync(ISqlExecutor db, ILogger log, CancellationToken ct) =>
        new(await StatusDaysAsync(db, log, ct), await RelationsAsync(db, log, ct));

    // ------------------------------------------------------------------ validation

    /// <summary>The levels whose TAT the portal keeps: the handholding levels on the Consultancy portal, else every level.</summary>
    public static IReadOnlyList<string> Levels(PortalSystem system) =>
        system == PortalSystem.Consultancy ? LevelRegistry.Handholding : LevelRegistry.Codes;

    /// <summary>The stored spelling of a level the portal has; null otherwise.</summary>
    public static string? Level(PortalSystem system, string? code) =>
        Levels(system).FirstOrDefault(l => string.Equals(l, code?.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>Null when a status's days can be saved (blank = no TAT); otherwise why not.</summary>
    public static string? StatusDaysProblem(PortalSystem system, string? status, int? days)
    {
        var point = TatCatalog.Find(system, status);
        if (point is null || !point.IsStatus) return "Please choose a valid status.";
        if (point.Final && days is not null) return $"\"{point.Name}\" is a final status: it takes no days.";
        if (days is not null and not (>= 1 and <= MaxStatusDays)) return $"Days allowed must be 1 to {MaxStatusDays} (blank = no TAT).";
        return null;
    }

    /// <summary>Null when the relation can be saved; otherwise why not.</summary>
    public static string? RelationProblem(PortalSystem system, string? name, string? certification, string? from, string? to, int? days,
        IEnumerable<TatRelation> others)
    {
        var n = name?.Trim() ?? "";
        if (n.Length == 0) return "Please enter the relation's name.";
        if (n.Length > MaxName) return $"The name can have at most {MaxName} characters.";
        if (!string.IsNullOrWhiteSpace(certification) && Level(system, certification) is null) return "Please choose a valid level (or all levels).";
        if (TatCatalog.Find(system, from) is null) return "Please choose the status the relation starts from.";
        if (TatCatalog.Find(system, to) is null) return "Please choose the status the relation ends at.";
        if (string.Equals(from!.Trim(), to!.Trim(), StringComparison.OrdinalIgnoreCase)) return "The relation must end at another status.";
        if (TatCatalog.Find(system, from)!.Final) return "A relation cannot start from a final status.";
        if (days is not (>= 1 and <= MaxRelationDays)) return $"Days must be 1 to {MaxRelationDays}.";
        var level = string.IsNullOrWhiteSpace(certification) ? null : Level(system, certification);
        if (others.Any(o => string.Equals(o.Name, n, StringComparison.OrdinalIgnoreCase) && string.Equals(o.Certification, level, StringComparison.OrdinalIgnoreCase)))
            return $"A relation named \"{n}\" already exists for {(level is null ? "all levels" : LevelRegistry.NameOf(level))}.";
        return null;
    }

    // ------------------------------------------------------------------ writes (false before migration 0101)

    public static async Task<bool> SaveStatusDaysAsync(ISqlExecutor db, string level, IEnumerable<(string Status, int? Days)> days, string userId,
        ILogger log, CancellationToken ct)
    {
        try
        {
            foreach (var (status, d) in days)
                await db.ExecuteSqlAsync(SaveStatusDaySql, new { Certification = level, StatusCode = status, Days = d, UpdatedBy = userId }, ct);
            return true;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "TAT days of {Level} not saved (is migration 0101 applied?)", level);
            return false;
        }
    }

    public static async Task<bool> SaveRelationAsync(ISqlExecutor db, int? id, string name, string? level, string from, string to, int days, bool active,
        string userId, ILogger log, CancellationToken ct)
    {
        try
        {
            var args = new { Id = id, Name = name, Certification = level, FromStatus = from, ToStatus = to, Days = days, IsActive = active, UpdatedBy = userId };
            await db.ExecuteSqlAsync(id is null ? InsertRelationSql : UpdateRelationSql, args, ct);
            return true;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "TAT relation {Name} not saved (is migration 0101 applied?)", name);
            return false;
        }
    }

    public static async Task<bool> DeleteRelationAsync(ISqlExecutor db, int id, ILogger log, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(DeleteRelationSql, new { Id = id }, ct);
            return true;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "TAT relation {Id} not deleted (is migration 0101 applied?)", id);
            return false;
        }
    }
}
