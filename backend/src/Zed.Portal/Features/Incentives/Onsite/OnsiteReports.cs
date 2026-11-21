using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal.Features.Incentives.Staff;
using Zed.Portal.Features.Msme.Schemes;
using static Zed.Portal.Features.Incentives.SchemeApplications;

namespace Zed.Portal.Features.Incentives.Onsite;

/// <summary>A photo of the visit: <see cref="Kind"/> "selfie", "site" or "item" (then <see cref="Title"/> is the item's).</summary>
public sealed record OnsitePhoto(string PhotoId, string Kind, string? Title, string Url, string? TimeStamp, string? Latitude, string? Longitude, DateTime? On);

/// <summary>An answer the onsite assessor checks, with its check (Yes / No and the remark) once made.</summary>
public sealed record OnsiteCheck(string Path, string Label, string? Value, string? Status, string? Remarks, string? By, DateTime? On);

/// <summary>
/// The onsite stage of a Desktop + Onsite application as the Master Admin and the onsite agency see it: the agency and its assessor,
/// the visit (the date of verification = <see cref="VisitStartedOn"/>), the unit's representative, the photos, the onsite checks,
/// the remarks and the verified claim (with its eligible amount).
/// </summary>
public sealed record OnsiteReport(
    SchemeReview.Person? Agency, SchemeReview.Person? Assessor, string? AllotmentType, DateTime? AllotmentDate, string? RejectedAgencies,
    DateTime? VisitStartedOn, DateTime? VisitSubmittedOn, string? Latitude, string? Longitude, string? RepresentativeName, string? RepresentativeMobile,
    string? Remarks, decimal? VerifiedClaim, decimal? Eligible, int PhotosMin, int PhotosMax, IReadOnlyList<OnsitePhoto> Photos, IReadOnlyList<OnsiteCheck> Checks);

/// <summary>Builds <see cref="OnsiteReport"/> and serves the visit's photos (dbo.FinancialAssistancePhotos rows named "onsite/…").</summary>
public static class OnsiteReports
{
    /// <summary>The unit's folders the assessor app's onsite photos may be stored in (under mobileapi/Photos/{ZedId}/).</summary>
    public static readonly IReadOnlyList<string> PhotoFolders = ["Schemes", "SchemeOnsite"];

    internal const string PhotosSql =
        "SELECT PhotoId, Name, TimeStamp, Latitude, Longitude, CreatedDate, PhotoType FROM dbo.FinancialAssistancePhotos " +
        "WHERE FinancialAssistanceId = @Id AND Name LIKE 'onsite/%' ORDER BY Id;";

    public sealed class PhotoRow
    {
        public string? PhotoId { get; init; }
        public string? Name { get; init; }
        public string? TimeStamp { get; init; }
        public string? Latitude { get; init; }
        public string? Longitude { get; init; }
        public DateTime? CreatedDate { get; init; }
        /// <summary>'OnsiteEarlier': a photo of an earlier visit (the visit was started again after the onsite QC sent it back).</summary>
        public string? PhotoType { get; init; }
    }

    internal static async Task<IReadOnlyList<PhotoRow>> PhotoRowsAsync(ISqlExecutor db, int id, ILogger log, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<PhotoRow>(PhotosSql, new { Id = id }, ct)).Where(p => !string.IsNullOrWhiteSpace(p.PhotoId)).ToList();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Onsite photos of scheme application {Id} not read", id);
            return [];
        }
    }

    internal static async Task<OnsiteReport> BuildAsync(ISqlExecutor db, SchemeDefinition? def, SchemeCase c, string fileBase, ILogger log, CancellationToken ct)
    {
        var row = c.Row;
        var answers = row.Answers;
        var checks = c.Checks;
        var agency = c.OnsiteAgency is null ? null : new SchemeReview.Person(c.OnsiteAgency, (await SchemeCases.UserAsync(db, c.OnsiteAgency, ct))?.UserName);
        var assessor = c.OnsiteAssessor is null ? null : new SchemeReview.Person(c.OnsiteAssessor, (await SchemeCases.UserAsync(db, c.OnsiteAssessor, ct))?.UserName);

        var items = def is null ? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) : OnsiteItemsOf(def, answers).ToDictionary(i => OnsitePhotoName(i.Section, i.Index), i => i.Title, StringComparer.OrdinalIgnoreCase);
        var photos = (await PhotoRowsAsync(db, c.Id, log, ct)).Select(p =>
        {
            var name = p.Name?.Trim() ?? "";
            var earlier = string.Equals(p.PhotoType?.Trim(), "OnsiteEarlier", StringComparison.OrdinalIgnoreCase);
            var kind = earlier ? "earlier"
                : name.Equals("onsite/selfie", StringComparison.OrdinalIgnoreCase) ? "selfie"
                : name.Equals("onsite/site", StringComparison.OrdinalIgnoreCase) ? "site" : "item";
            var what = name.Equals("onsite/selfie", StringComparison.OrdinalIgnoreCase) ? "Selfie"
                : name.Equals("onsite/site", StringComparison.OrdinalIgnoreCase) ? "Site photo" : items.GetValueOrDefault(name) ?? name["onsite/".Length..];
            var title = earlier ? what : kind == "item" ? what : null;
            return new OnsitePhoto(p.PhotoId!.Trim(), kind, title, $"{fileBase}/{c.Id}/onsite-photos/{Uri.EscapeDataString(p.PhotoId!.Trim())}",
                p.TimeStamp, p.Latitude, p.Longitude, p.CreatedDate);
        }).ToList();

        var places = def is null ? new List<OnsiteCheck>() : OnsitePlacesOf(def, answers).Select(pl =>
        {
            var value = answers.Sections.GetValueOrDefault(pl.Section) is { } list && pl.Index < list.Count ? list[pl.Index].Values.GetValueOrDefault(pl.Field) : null;
            var x = checks.GetValueOrDefault(OnsiteKey(pl.Path));
            return new OnsiteCheck(pl.Path, pl.Label, value, x?.Status, x?.Remarks, x?.By, x?.On);
        }).ToList();

        decimal? eligible = null;
        if (row.OnsiteVerifiedClaim is { } verified)
            eligible = SchemeEligibility.Eligible(verified, await SchemeReview.GradeAsync(db, def, row, log, ct));

        return new OnsiteReport(agency, assessor, c.OnsiteAllotmentType, c.OnsiteAllotmentDate, c.OnsiteRejectedAgencies,
            row.VisitStartedOn, row.VisitSubmittedOn, row.VisitLatitude, row.VisitLongitude, row.RepresentativeName, row.RepresentativeMobile,
            row.OnsiteRemarks, row.OnsiteVerifiedClaim, eligible, def?.Verification.OnsitePhotosMin ?? 0, def?.Verification.OnsitePhotosMax ?? 0, photos, places);
    }

    /// <summary>The eligible amount of the onsite QC: on the onsite verified claim (else the desktop's verified claim).</summary>
    internal static async Task<decimal> EligibleAsync(ISqlExecutor db, SchemeDefinition? def, SchemeCase c, ILogger log, CancellationToken ct)
    {
        var verified = c.Row.OnsiteVerifiedClaim
            ?? (def is null ? c.Row.ClaimAmount ?? 0 : SchemeReview.Verified(def.Form, c.Row.Answers, c.Checks));
        return SchemeEligibility.Eligible(verified, await SchemeReview.GradeAsync(db, def, c.Row, log, ct));
    }

    /// <summary>One photo of the visit (only a PhotoId of the application's onsite rows), from the unit's folder.</summary>
    internal static async Task<IActionResult> PhotoAsync(ControllerBase controller, ISqlExecutor db, SchemeCase c, string photoId, IWebHostEnvironment env,
        PortalOptions portal, ILogger log, CancellationToken ct)
    {
        var rows = await PhotoRowsAsync(db, c.Id, log, ct);
        if (!rows.Any(r => string.Equals(r.PhotoId?.Trim(), photoId, StringComparison.OrdinalIgnoreCase))) return controller.NotFound();
        var root = SchemeUploads.StorageRoot(env, portal);
        var full = PhotoFolders.Select(f => SchemeUploads.Find(root, c.ZedId, f, photoId)).FirstOrDefault(p => p is not null);
        return full is null ? controller.NotFound() : SchemeUploads.Serve(controller, full);
    }
}
