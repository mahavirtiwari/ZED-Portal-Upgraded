using System.Data.Common;
using Microsoft.Extensions.Logging;
using Zed.Core.Data;

namespace Zed.Core.Assessment;

/// <summary>
/// The site assessor's check of the evidences the Admin lists for a requirement (V4, redesigned SA app; migration 0043):
/// for each of the unit's rows of dbo.MsmeEvidences the assessor answers whether it is available at the site, and a Yes
/// needs 1 to <see cref="MaxPhotos"/> photos of it (taken, or picked from the site tour). A No keeps the requirement from conforming: the checkpoint it belongs to cannot be Yes, and an
/// evidence of no checkpoint (or a requirement without checkpoints) makes the requirement's conformance No. Partial / No
/// checkpoints already make it No (<see cref="CheckpointAnswers"/>). A requirement without listed evidences keeps the
/// app's own evidence photos.
/// </summary>
public static class SiteEvidenceChecks
{
    /// <param name="Checkpoint">The checkpoint's option code (dbo.Evidences.OptionCode), or null for an evidence of the requirement.</param>
    public sealed record Listed(long Id, long RequirementId, string? Checkpoint, string Name, bool Mandatory, bool Uploaded, string? Verified,
        string? Available, IReadOnlyList<string> PhotoIds);

    public sealed record Check(long Id, string? Available, IReadOnlyList<string>? PhotoIds);

    public const int MaxPhotos = 3;

    /// <summary>Every evidence of the unit's requirement rows, with the checkpoint it belongs to (if any) and the site answers.</summary>
    public static string Sql(string master) => CheckpointAnswers.Rows(
        "CAST(X.Id AS bigint) AS Id, NULLIF(LTRIM(RTRIM(m.OptionCode)), '') AS OptionCode, X.EvidenceName, " +
        "CAST(ISNULL(X.EvidenceType, 0) AS bit) AS Mandatory, CAST(CASE WHEN X.SyncedDate IS NULL THEN 0 ELSE 1 END AS bit) AS Uploaded, " +
        "X.IsVerified, X.SaAvailable, X.SaPhotoIds",
        "MsmeEvidences",
        $"""
        OUTER APPLY (SELECT TOP 1 e.OptionCode FROM {master}.Evidences e
            WHERE e.SectionType = X.SectionType AND LTRIM(RTRIM(e.SectionCode)) = X.Sc AND LTRIM(RTRIM(e.RequirementCode)) = X.Rc
              AND (e.Id = X.EvidenceId OR e.EvidenceName = X.EvidenceName)
            ORDER BY CASE WHEN e.Id = X.EvidenceId AND e.EvidenceName = X.EvidenceName THEN 0
                          WHEN e.EvidenceCode = X.EvidenceCode AND e.EvidenceName = X.EvidenceName THEN 1
                          WHEN e.Id = X.EvidenceId THEN 2 ELSE 3 END) m
        WHERE NULLIF(LTRIM(RTRIM(X.EvidenceName)), '') IS NOT NULL
        ORDER BY R.RequirementRowId, TRY_CAST(X.EvidenceCode AS int), X.Id;
        """);

    public sealed class Row
    {
        public long RequirementRowId { get; init; }
        public long Id { get; init; }
        public string? OptionCode { get; init; }
        public string? EvidenceName { get; init; }
        public bool Mandatory { get; init; }
        public bool Uploaded { get; init; }
        public string? IsVerified { get; init; }
        public string? SaAvailable { get; init; }
        public string? SaPhotoIds { get; init; }
    }

    /// <summary>The unit's listed evidences; empty before migration 0043 (or 0034): the app's own evidence photos then.</summary>
    public static async Task<IReadOnlyList<Listed>> LoadAsync(ISqlExecutor db, string zedId, string level, string master, ILogger log, CancellationToken ct)
    {
        try
        {
            var rows = await db.QuerySqlAsync<Row>(Sql(master), new
            {
                ZedId = new Dapper.DbString { Value = zedId, IsAnsi = true, Length = 50 },
                Certification = new Dapper.DbString { Value = level, IsAnsi = true, Length = 50 },
                RequirementId = (long?)null,
            }, ct);
            return rows.Select(r => new Listed(r.Id, r.RequirementRowId, r.OptionCode?.Trim(), r.EvidenceName?.Trim() ?? "", r.Mandatory, r.Uploaded,
                CheckpointAnswers.Normalise(r.IsVerified), Answer(r.SaAvailable), Ids(r.SaPhotoIds))).ToList();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Listed evidences not read (is migration 0043 applied?); the app's own evidence photos are used");
            return [];
        }
    }

    private static List<string> Ids(string? stored) => (stored ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).ToList();

    /// <summary>"Yes" or "No" (any case), else null.</summary>
    public static string? Answer(string? value) => CheckpointAnswers.Normalise(value) is { } v and not CheckpointAnswers.Partial ? v : null;

    /// <summary>
    /// The first problem of a requirement's checks, or null. <paramref name="photoIds"/>: the photos sent with the
    /// requirement; <paramref name="yesCheckpoints"/>: the option codes of its checkpoints answered Yes;
    /// <paramref name="conformance"/>: its conformance (from the checkpoints, or the app's Yes / No).
    /// </summary>
    public static string? Problem(IReadOnlyList<Listed> listed, IReadOnlyList<Check>? checks, IReadOnlyCollection<string> photoIds,
        IReadOnlyCollection<string> yesCheckpoints, string? conformance)
    {
        var given = checks ?? [];
        if (given.Any(c => listed.All(e => e.Id != c.Id)) || given.GroupBy(c => c.Id).Any(g => g.Count() > 1)) return "Invalid request.";
        foreach (var e in listed)
        {
            var c = given.FirstOrDefault(x => x.Id == e.Id);
            if (Answer(c?.Available) is not { } available) return $"Please answer whether \"{e.Name}\" is available at the site.";
            if (available == CheckpointAnswers.Yes)
            {
                var ids = (c!.PhotoIds ?? []).Select(p => p?.Trim() ?? "").Where(p => p.Length > 0).Distinct().ToList();
                if (ids.Count == 0 || ids.Any(p => !photoIds.Contains(p))) return $"Please capture a photo of \"{e.Name}\".";
                if (ids.Count > MaxPhotos) return $"\"{e.Name}\" takes at most {MaxPhotos} photos.";
                continue;
            }
            if (e.Checkpoint is { } code && yesCheckpoints.Contains(code))
                return $"Checkpoint {code} cannot be Yes: \"{e.Name}\" is not available at the site.";
            if (string.Equals(conformance, CheckpointAnswers.Yes, StringComparison.OrdinalIgnoreCase))
                return $"The conformance cannot be Yes: \"{e.Name}\" is not available at the site.";
        }
        return null;
    }

    public const string UpdateSql =
        "UPDATE dbo.MsmeEvidences SET SaAvailable = @Available, SaPhotoIds = @PhotoIds, SaAnsweredBy = @AnsweredBy, SaAnsweredOn = GETDATE() " +
        "WHERE Id = @Id AND ZedId = @ZedId;";

    public static async Task SaveAsync(ISqlExecutor db, string zedId, IReadOnlyList<Listed> listed, IReadOnlyList<Check> checks, string userId, CancellationToken ct)
    {
        foreach (var e in listed)
        {
            var c = checks.First(x => x.Id == e.Id);
            var available = Answer(c.Available)!;
            await db.ExecuteSqlAsync(UpdateSql, new
            {
                Available = new Dapper.DbString { Value = available, IsAnsi = true, Length = 10 },
                PhotoIds = new Dapper.DbString
                {
                    Value = available == CheckpointAnswers.Yes ? string.Join(',', c.PhotoIds!.Select(p => p.Trim()).Where(p => p.Length > 0).Distinct()) : null,
                    IsAnsi = true, Length = 200,
                },
                AnsweredBy = new Dapper.DbString { Value = userId.Length <= 50 ? userId : userId[..50], IsAnsi = true, Length = 50 },
                Id = e.Id,
                ZedId = new Dapper.DbString { Value = zedId, IsAnsi = true, Length = 50 },
            }, ct);
        }
    }
}
