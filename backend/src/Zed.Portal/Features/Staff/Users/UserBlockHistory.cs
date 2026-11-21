using Zed.Core.Data;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// The history of a staff account: dbo.UserBlockHistory (migration 0061, in ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE),
/// named like the legacy history tables.
/// <list type="bullet">
/// <item>2026-11-08 (the Master Admin): every block and unblock, with its reason, who did it and when.</item>
/// <item>2026-11-21 (the product owner: "profile edit histories etc. are missing"; migration 0109 widens the Action check and adds
/// Details): the account's creation (<see cref="Created"/>), every profile save that changed something with its change list
/// (<see cref="Edited"/>, <see cref="AccountChanges"/>), the password links and new passwords sent (<see cref="PasswordLink"/>) and
/// the mobile number changes (<see cref="MobileReset"/>). Never a password or a token.</item>
/// <item>Its allotments are read, not written: from dbo.AgencyAllotmentHistory, the "Alotted to …" lines of dbo.MsmeHistory and
/// dbo.SaAllotmentHistory (<see cref="ListAsync"/>), merged by date into the same list as <see cref="Allotment"/> entries.</item>
/// </list>
/// Before the migrations nothing is recorded (a warning is logged) and the action itself works as before: a history write never
/// fails the user's action.
/// </summary>
public static class UserBlockHistory
{
    public const string Blocked = "Blocked";
    public const string Unblocked = "Unblocked";
    public const string Created = "Created";
    public const string Edited = "Edited";
    public const string PasswordLink = "PasswordLink";
    public const string MobileReset = "MobileReset";
    /// <summary>Allowed by migration 0109 for an explicit "sign out everywhere" (none of the staff user pages has one yet).</summary>
    public const string SessionsEnded = "SessionsEnded";
    /// <summary>Not stored: an allotment read from the allotment histories (<see cref="ListAsync"/>).</summary>
    public const string Allotment = "Allotment";

    /// <summary><see cref="PasswordLink"/>'s Reason: the user asked for it ("Forgot password?"); a new password was e-mailed instead of a link.</summary>
    public const string SelfService = "self";
    public const string NewPassword = "newPassword";

    /// <summary>The allotment sources of <see cref="ListAsync"/>.</summary>
    public enum Allotments { None, Agency, Assessor }

    internal const int ReasonLength = 2000;
    internal const int ActorLength = 50;
    /// <summary>The allotments read per source (the latest).</summary>
    internal const int AllotmentLimit = 300;

    internal const string InsertSql =
        "INSERT INTO dbo.UserBlockHistory (UserId, RoleId, Action, Reason, ActionBy, ActionByRole, ActionDate) " +
        "VALUES (@UserId, @RoleId, @Action, @Reason, @ActionBy, @ActionByRole, GETDATE());";

    /// <summary>With the change list (Details, migration 0109).</summary>
    internal const string InsertDetailsSql =
        "INSERT INTO dbo.UserBlockHistory (UserId, RoleId, Action, Reason, Details, ActionBy, ActionByRole, ActionDate) " +
        "VALUES (@UserId, @RoleId, @Action, @Reason, @Details, @ActionBy, @ActionByRole, GETDATE());";

    /// <remarks>
    /// 2026-11-21 (Assessment Agency UI audit, item 5): with the name of who did it (Users.UserName), so the history reads "By A. Kumar
    /// (Master Admin)" rather than a login ID; the ID is shown when the name is not found. 2026-11-21: with Details (0109), and a
    /// sub-user's action ("owner / sub-user", <see cref="ActorOf"/>) named as "owner's name / sub-user's name" (dbo.V4SubUsers).
    /// </remarks>
    internal const string ListSql =
        "SELECT h.Action, h.Reason, h.Details, h.ActionBy, h.ActionByRole, h.ActionDate, " +
        "CASE WHEN s.P > 0 THEN CONCAT(ISNULL(n.UserName, LEFT(h.ActionBy, s.P - 1)), ' / ', ISNULL(v.UserName, SUBSTRING(h.ActionBy, s.P + 3, 50))) ELSE n.UserName END AS ActionByName " +
        "FROM dbo.UserBlockHistory h " +
        "CROSS APPLY (SELECT CHARINDEX(' / ', ISNULL(h.ActionBy, '')) AS P) s " +
        "OUTER APPLY (SELECT TOP (1) NULLIF(LTRIM(RTRIM(u.UserName)), '') AS UserName FROM dbo.Users u " +
        "WHERE u.UserId = CASE WHEN s.P > 0 THEN LEFT(h.ActionBy, s.P - 1) ELSE h.ActionBy END) n " +
        "OUTER APPLY (SELECT TOP (1) NULLIF(LTRIM(RTRIM(x.UserName)), '') AS UserName FROM dbo.V4SubUsers x " +
        "WHERE s.P > 0 AND x.UserId = SUBSTRING(h.ActionBy, s.P + 3, 50)) v " +
        "WHERE h.UserId = @UserId ORDER BY h.ActionDate DESC, h.Id DESC;";

    /// <summary><see cref="ListSql"/> before migration 0109 (no Details).</summary>
    internal const string LegacyListSql =
        "SELECT h.Action, h.Reason, h.ActionBy, h.ActionByRole, h.ActionDate, n.UserName AS ActionByName FROM dbo.UserBlockHistory h " +
        "OUTER APPLY (SELECT TOP (1) NULLIF(LTRIM(RTRIM(u.UserName)), '') AS UserName FROM dbo.Users u WHERE u.UserId = h.ActionBy) n " +
        "WHERE h.UserId = @UserId ORDER BY h.ActionDate DESC, h.Id DESC;";

    /// <summary>The latest block of each user that is blocked now (for the reason and date under the Blocked badge).</summary>
    internal const string LatestBlocksSql =
        "SELECT h.UserId, h.Reason, h.ActionDate FROM dbo.UserBlockHistory h " +
        "WHERE h.Action = 'Blocked' AND h.Id = (SELECT MAX(x.Id) FROM dbo.UserBlockHistory x WHERE x.UserId = h.UserId);";

    private const string NoAllotments =
        "ELSE SELECT TOP (0) CAST(NULL AS varchar(50)) AS ZedId, CAST(NULL AS varchar(50)) AS Level, CAST(NULL AS varchar(50)) AS AllotType, " +
        "CAST(NULL AS varchar(2000)) AS Descrip, CAST(NULL AS datetime) AS At;";

    /// <summary>
    /// An agency's allotments in dbo.AgencyAllotmentHistory (main and Surveillance: every manual, automatic, direct, re-allotment and
    /// incentive onsite allotment; the table is not in ZED_CONSULTANT).
    /// </summary>
    internal const string AgencyAllotmentsSql =
        "IF OBJECT_ID(N'dbo.AgencyAllotmentHistory', N'U') IS NOT NULL " +
        "SELECT TOP (300) ZedId, CertificationType AS Level, AllotType, Descrip, CreatedDate AS At FROM dbo.AgencyAllotmentHistory " +
        "WHERE AgencyId = @UserId ORDER BY CreatedDate DESC, Id DESC; " + NoAllotments;

    /// <summary>
    /// The "DA for {level} Alotted to Agency {id}" lines of dbo.MsmeHistory that no AgencyAllotmentHistory row repeats: the Consultancy
    /// portal's ('CoAlloted') and Surveillance's manual allotment (no status type). Main's own line ('AgencyAlloted') repeats its
    /// 'Manual' row and is left out. @Like ends with the agency's ID, so another ID that ends the same is not matched.
    /// </summary>
    internal const string AgencyLinesSql =
        "SELECT TOP (300) ZedId, CertificationType AS Level, ISNULL(StatusType, 'Manual') AS AllotType, Descrip, CreatedDate AS At FROM dbo.MsmeHistory " +
        "WHERE (StatusType IS NULL OR StatusType = 'CoAlloted') AND Descrip LIKE @Like ESCAPE '\\' ORDER BY CreatedDate DESC, Id DESC;";

    /// <summary>
    /// An assessor's / consultant's allotments: the dbo.MsmeHistory lines of the legacy and V4 allotment procedures ("DA for {level}
    /// Alotted to Desktop Assessor {id}", "SA for {level} Alotted to{lead} and {co}[ and {experts}]", "Onsite surveillance for {level}
    /// allotted to {lead}[ and {co}]"), found by the ID anywhere in the line and then matched exactly (<see cref="AllotmentRole"/>).
    /// </summary>
    internal const string AssessorAllotmentsSql =
        "SELECT TOP (300) ZedId, CertificationType AS Level, StatusType AS AllotType, Descrip, CreatedDate AS At FROM dbo.MsmeHistory " +
        "WHERE Descrip LIKE @Like ESCAPE '\\' AND (Descrip LIKE 'DA for %' OR Descrip LIKE 'SA for %' OR Descrip LIKE 'Onsite surveillance for %') " +
        "ORDER BY CreatedDate DESC, Id DESC;";

    /// <summary>
    /// dbo.SaAllotmentHistory: the old scheme's self-assessment allotments (by registration number) that the agency or assessor
    /// rejected (SP_SA_REJECT_UNIT copies the allotment there with its reason).
    /// </summary>
    internal const string OldSchemeAllotmentsSql =
        "IF OBJECT_ID(N'dbo.SaAllotmentHistory', N'U') IS NOT NULL " +
        "SELECT TOP (300) RegistrationNumber AS ZedId, CAST(NULL AS varchar(50)) AS Level, 'OldSchemeRejected' AS AllotType, ReasonForRejection AS Descrip, " +
        "ISNULL(AcceptOrRejectDate, CreatedDate) AS At FROM dbo.SaAllotmentHistory " +
        "WHERE (@Agency = 1 AND CertificationBodyUserId = @UserId) OR (@Agency = 0 AND AssessorUserId = @UserId) ORDER BY CreatedDate DESC, Id DESC; " +
        NoAllotments;

    /// <param name="Details">The change list (JSON of <see cref="AccountChange"/>) of a Created, Edited, MobileReset or PasswordLink entry.</param>
    /// <param name="ZedId">An allotment's ZED ID (or the old scheme's registration number).</param>
    /// <param name="Allotment">An allotment's kind: the agency's allotment type (Manual, Auto, Direct, Reallot, SchemeOnsite, CoAlloted,
    /// OldSchemeRejected …) or the assessor's part (Desktop, Site, SiteCo, Expert, OnsiteSurveillance, OnsiteSurveillanceCo).</param>
    /// <param name="Replaced">An assessor's allotment that was later given to another assessor (the procedures mark its line "_DEL").</param>
    public sealed record Entry(string Action, string? Reason, string? ActionBy, int? ActionByRole, DateTime? ActionDate, string? ActionByName = null,
        string? Details = null, string? ZedId = null, string? Level = null, string? Allotment = null, bool? Replaced = null);

    public sealed class LatestRow
    {
        public string? UserId { get; init; }
        public string? Reason { get; init; }
        public DateTime? ActionDate { get; init; }
    }

    public sealed class AllotmentRow
    {
        public string? ZedId { get; init; }
        public string? Level { get; init; }
        public string? AllotType { get; init; }
        public string? Descrip { get; init; }
        public DateTime? At { get; init; }
    }

    /// <summary>Who acts, as recorded in ActionBy: the login, or a sub-user as "owner / sub-user" (up to 50 characters).</summary>
    public static string ActorOf(ZedUser? user, string fallback)
    {
        var who = user is null ? fallback
            : user.IsSubUser && !string.IsNullOrWhiteSpace(user.ActingUserId) ? $"{user.UserId} / {user.ActingUserId}" : user.UserId;
        return who.Length > ActorLength ? who[..ActorLength] : who;
    }

    public static async Task RecordAsync(ISqlExecutor db, string userId, int? roleId, string action, string? reason, string? actionBy, int? actionByRole,
        ILogger log, CancellationToken ct, string? details = null)
    {
        try
        {
            var text = string.IsNullOrWhiteSpace(reason) ? null : reason.Length > ReasonLength ? reason[..ReasonLength] : reason;
            var by = actionBy is { Length: > ActorLength } ? actionBy[..ActorLength] : actionBy;
            if (details is null)
                await db.ExecuteSqlAsync(InsertSql, new
                {
                    UserId = userId, RoleId = roleId, Action = action, Reason = text, ActionBy = by, ActionByRole = actionByRole,
                }, ct);
            else
                await db.ExecuteSqlAsync(InsertDetailsSql, new
                {
                    UserId = userId, RoleId = roleId, Action = action, Reason = text, Details = details, ActionBy = by, ActionByRole = actionByRole,
                }, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "{Action} of {UserId} not recorded in the history (are migrations 0061 and 0109 applied?)", action, userId);
        }
    }

    /// <summary>
    /// A profile saved (<see cref="Edited"/>, nothing when nothing changed) or an account created (<see cref="Created"/>, with what it
    /// was created with): the change list from <paramref name="before"/> to <paramref name="after"/>.
    /// </summary>
    public static async Task RecordChangesAsync(ISqlExecutor db, string userId, int? roleId, string action, AccountProfile? before, AccountProfile after,
        string actionBy, int? actionByRole, ILogger log, CancellationToken ct)
    {
        string? details;
        try
        {
            var changes = AccountChanges.Diff(before, after);
            if (changes.Count == 0 && action != Created) return;
            details = AccountChanges.ToJson(changes) ?? "[]";
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "{Action} of {UserId} not recorded in the history (change list)", action, userId);
            return;
        }
        await RecordAsync(db, userId, roleId, action, null, actionBy, actionByRole, log, ct, details);
    }

    /// <summary>
    /// The account's history, latest first: what is recorded (<see cref="ListSql"/>; before migration 0109 <see cref="LegacyListSql"/>)
    /// and, by <paramref name="allotments"/>, its allotments merged in by date. A source that cannot be read is left out (a warning).
    /// </summary>
    public static async Task<IReadOnlyList<Entry>> ListAsync(ISqlExecutor db, string userId, ILogger log, CancellationToken ct, Allotments allotments = Allotments.None)
    {
        var entries = new List<Entry>();
        try
        {
            entries.AddRange(await db.QuerySqlAsync<Entry>(ListSql, new { UserId = userId }, ct));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "History of {UserId} not read with its details (is migration 0109 applied?); reading the blocks only", userId);
            try
            {
                entries.AddRange(await db.QuerySqlAsync<Entry>(LegacyListSql, new { UserId = userId }, ct));
            }
            catch (Exception ex2) when (ex2 is not OperationCanceledException)
            {
                log.LogWarning(ex2, "Block history of {UserId} not read (is migration 0061 applied?)", userId);
            }
        }
        if (allotments == Allotments.None) return entries;
        var merged = entries.Concat(await AllotmentsAsync(db, userId, allotments, log, ct)).ToList();
        // Latest first; recorded entries before allotments of the same moment; undated ones last.
        return merged.Select((e, i) => (e, i)).OrderByDescending(x => x.e.ActionDate ?? DateTime.MinValue).ThenBy(x => x.i).Select(x => x.e).ToList();
    }

    /// <summary>The account's allotments, each as an <see cref="Allotment"/> entry (by whom is not recorded by the procedures).</summary>
    internal static async Task<List<Entry>> AllotmentsAsync(ISqlExecutor db, string userId, Allotments source, ILogger log, CancellationToken ct)
    {
        var id = userId.Trim();
        var list = new List<Entry>();
        var agency = source == Allotments.Agency;
        // (row, true) = a dbo.MsmeHistory line, matched exactly; (row, false) = an AgencyAllotmentHistory row, the agency's by its AgencyId.
        var rows = new List<(AllotmentRow Row, bool FromLine)>();
        if (agency)
        {
            rows.AddRange((await TryReadAsync(db, AgencyAllotmentsSql, new { UserId = Ansi(id) }, id, log, ct)).Select(r => (r, false)));
            rows.AddRange((await TryReadAsync(db, AgencyLinesSql, new { Like = Ansi("%Alotted to Agency " + LikeEscape(id), 200) }, id, log, ct)).Select(r => (r, true)));
        }
        else
        {
            rows.AddRange((await TryReadAsync(db, AssessorAllotmentsSql, new { Like = Ansi("%" + LikeEscape(id) + "%", 200) }, id, log, ct)).Select(r => (r, true)));
        }
        foreach (var (r, fromLine) in rows)
        {
            var kind = r.AllotType;
            if (fromLine)
            {
                var role = AllotmentRole(r.Descrip, id);
                if (role is null || agency != (role == "Agency")) continue;
                if (!agency) kind = role;
            }
            var zedId = BaseZedId(r.ZedId, out var replaced);
            list.Add(new Entry(Allotment, fromLine ? null : NullIfEmpty(r.Descrip), null, null, r.At, null, null, zedId, NullIfEmpty(r.Level?.Trim()),
                NullIfEmpty(kind?.Trim()), replaced ? true : null));
        }
        foreach (var r in await TryReadAsync(db, OldSchemeAllotmentsSql, new { UserId = Ansi(id), Agency = agency ? 1 : 0 }, id, log, ct))
            list.Add(new Entry(Allotment, NullIfEmpty(r.Descrip), null, null, r.At, null, null, NullIfEmpty(r.ZedId?.Trim()), null, "OldSchemeRejected"));
        return list;
    }

    private static async Task<IReadOnlyList<AllotmentRow>> TryReadAsync(ISqlExecutor db, string sql, object args, string userId, ILogger log, CancellationToken ct)
    {
        try
        {
            return await db.QuerySqlAsync<AllotmentRow>(sql, args, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Allotments of {UserId} not read for its history", userId);
            return [];
        }
    }

    private static Dapper.DbString Ansi(string value, int length = 50) => new() { Value = value, IsAnsi = true, Length = length };

    /// <summary>
    /// Whose an "allotted to" line of dbo.MsmeHistory is, for <paramref name="userId"/>: "Agency", "Desktop", "Site" (the lead),
    /// "SiteCo" (the co-assessor / co-consultant), "Expert" (a technical expert), "OnsiteSurveillance" / "OnsiteSurveillanceCo";
    /// null when the line is not an allotment to that ID (another ID that merely contains it included).
    /// </summary>
    internal static string? AllotmentRole(string? descrip, string userId)
    {
        if (string.IsNullOrWhiteSpace(descrip) || string.IsNullOrWhiteSpace(userId)) return null;
        var d = descrip.Trim();
        var at = d.IndexOf("lotted to", StringComparison.OrdinalIgnoreCase);
        if (at < 0) return null;
        var who = d[(at + "lotted to".Length)..].Trim();
        var id = userId.Trim();
        bool Same(string s) => string.Equals(s.Trim(), id, StringComparison.OrdinalIgnoreCase);
        if (d.StartsWith("DA for ", StringComparison.OrdinalIgnoreCase))
        {
            if (who.StartsWith("Desktop Assessor ", StringComparison.OrdinalIgnoreCase)) return Same(who["Desktop Assessor ".Length..]) ? "Desktop" : null;
            if (who.StartsWith("Agency ", StringComparison.OrdinalIgnoreCase)) return Same(who["Agency ".Length..]) ? "Agency" : null;
            return null;
        }
        var onsite = d.StartsWith("Onsite surveillance for ", StringComparison.OrdinalIgnoreCase);
        if (!onsite && !d.StartsWith("SA for ", StringComparison.OrdinalIgnoreCase)) return null;
        // "lead and co[ and experts]"; a line without a co-assessor ends with " and" (trimmed above).
        var parts = (who + " ").Split(" and ", StringSplitOptions.None);
        for (var i = 0; i < parts.Length; i++)
        {
            if (!parts[i].Split(',').Any(Same)) continue;
            return i switch
            {
                0 => onsite ? "OnsiteSurveillance" : "Site",
                1 => onsite ? "OnsiteSurveillanceCo" : "SiteCo",
                _ => "Expert",
            };
        }
        return null;
    }

    /// <summary>A ZED ID without the "_DEL" marks the allotment procedures add to the lines of an allotment given to someone else.</summary>
    internal static string? BaseZedId(string? zedId, out bool replaced)
    {
        replaced = false;
        var z = zedId?.Trim();
        if (string.IsNullOrEmpty(z)) return null;
        while (z.EndsWith("_DEL", StringComparison.OrdinalIgnoreCase))
        {
            z = z[..^4];
            replaced = true;
        }
        return z;
    }

    private static string LikeEscape(string s) => s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_").Replace("[", "\\[");

    private static string? NullIfEmpty(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;

    public static async Task<Dictionary<string, LatestRow>> LatestBlocksAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<LatestRow>(LatestBlocksSql, null, ct)).Where(r => r.UserId is not null)
                .GroupBy(r => r.UserId!.Trim(), StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "Latest blocks not read (is migration 0061 applied?)");
            return new(StringComparer.OrdinalIgnoreCase);
        }
    }
}
