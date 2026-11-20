using System.Data.Common;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Main.MobileApi.Models.Assessor;
using Zed.Portal.Features.Incentives;
using static Zed.Portal.Features.Incentives.SchemeApplications;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// 2026-11-20 (incentive schemes, phase 2: onsite verification, docs/INCENTIVE-SCHEMES.md): the onsite assessor's scheme visits in
/// the site assessor app. The onsite agency names one of its assessors without a date (<c>OnsiteAssessorId</c>, status
/// <see cref="OnsiteWithAssessor"/>); the assessor starts the visit at the unit with a selfie and a site photo (GPS and time:
/// <c>VisitStartedOn</c>, the date of verification, server time; any number of visits a day; status <see cref="OnsiteVisit"/>),
/// photographs each item (<see cref="OnsiteItemsOf"/>, the scheme's minimum to maximum), checks the answers of
/// <see cref="OnsitePlacesOf"/> Valid / Not valid (FormChecks under <see cref="OnsiteKey"/>), writes the representative's name and
/// mobile and the overall remarks, then <b>recommends</b> (the verified claim: <c>OnsiteVerifiedClaim</c>, the eligible amount
/// recomputed; status <see cref="Qc"/> for the onsite agency's QC) or <b>rejects</b> (a reason and remarks; status
/// <see cref="Rejected"/>). No correction at the visit.
/// <para>
/// The calls are new and only the redesigned app makes them: a valid app token of the assessor named in <c>saId</c> is needed
/// (<see cref="DeviceBoundAttribute.TokenRequired"/>; the one-phone rule as the SA calls), the Users row must still be an active
/// assessor (RoleId 3), and every call names an application allotted to that assessor. Writes are refused once the result is
/// submitted (any status but <see cref="OnsiteVisit"/>; the start only from <see cref="OnsiteWithAssessor"/>). Each write is one
/// conditional statement on the status read, so a change made meanwhile on the web is never overwritten. Photos are stored as the
/// applicant's scheme documents (Photos/{ZedId}/Schemes/{name}, a name of the SchemeUploads form) and recorded in
/// dbo.FinancialAssistancePhotos (Name "onsite/selfie", "onsite/site", "onsite/{section}/{item}"). Main deployment only.
/// </para>
/// </summary>
[PortalSystems(PortalSystem.Main)]
public sealed class SchemeVisitsController(ISqlExecutor db, MobileStorage storage, ILogger<SchemeVisitsController> log) : LegacyMobileController
{
    public const string NotAllotted = "This application is not allotted to you for onsite verification.";
    public const string NotOpen = "The onsite result of this application is already submitted.";
    public const string NotStarted = "Please start the visit first (selfie and site photo at the unit).";
    public const string Changed = "The application has changed meanwhile. Please refresh it.";
    public const string GpsRequired = "The photo has no location. Please switch on GPS and take it again.";
    public const string PhotoMissing = "The photo was not received. Please take it again.";
    /// <summary>The unit's folder of scheme documents (the applicant's uploads and the onsite photos).</summary>
    public const string Folder = "Schemes";

    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    // ------------------------------------------------------------------ SQL

    public const string AssessorSql = "SELECT TOP 1 UserId, RoleId, IsActive FROM dbo.Users WHERE UserId = @UserId;";

    private const string UnitColumns =
        "M.EnterpriseName, M.PUnitName, M.PAddress, M.PCity, M.PDistrictName, M.PStateName, CAST(M.PPin AS varchar(20)) AS PPin";

    private const string UnitApply =
        "OUTER APPLY (SELECT TOP 1 X.EnterpriseName, X.PUnitName, X.PAddress, X.PCity, X.PDistrictName, X.PStateName, X.PPin FROM dbo.Msme X WHERE X.ZedId = F.ZedId) M";

    public const string ListSql =
        "SELECT F.Id, F.ZedId, F.SchemeCode, F.SchemeLevel, F.SchemeStatus, F.ClaimAmount, F.OnsiteAllotmentDate, F.VisitStartedOn, " + UnitColumns + " " +
        "FROM dbo.FinancialAssistance F " + UnitApply + " " +
        "WHERE F.SchemeCode IS NOT NULL AND F.OnsiteAssessorId = @UserId AND F.SchemeStatus IN ('OnsiteWithAssessor', 'OnsiteVisit') " +
        "AND ISNULL(F.VerificationStatus, 0) <> 6 ORDER BY F.OnsiteAllotmentDate, F.Id;";

    public const string UnitSql = "SELECT " + UnitColumns + " FROM (SELECT @ZedId AS ZedId) F " + UnitApply + ";";

    public const string SchemesSql = "SELECT SchemeCode, SchemeJson FROM dbo.Incentives WHERE SchemeCode IS NOT NULL;";

    public const string PhotosSql =
        "SELECT PhotoId, Name, TimeStamp, Latitude, Longitude FROM dbo.FinancialAssistancePhotos " +
        "WHERE FinancialAssistanceId = @Id AND Name LIKE 'onsite/%' ORDER BY Id;";

    private const string Allotted =
        "Id = @Id AND SchemeCode IS NOT NULL AND OnsiteAssessorId = @UserId AND ISNULL(VerificationStatus, 0) <> 6";

    private const string InsertPhoto =
        "INSERT INTO dbo.FinancialAssistancePhotos (ZedId, PhotoId, Name, TimeStamp, Latitude, Longitude, PhotoType, CreatedDate, CertificationType, FinancialAssistanceId) ";

    public const string StartSql =
        "SET XACT_ABORT ON;\nBEGIN TRAN;\n" +
        "UPDATE dbo.FinancialAssistance SET SchemeStatus = 'OnsiteVisit', VerificationStatus = 2, VisitStartedOn = GETDATE(), " +
        "VisitLatitude = @Latitude, VisitLongitude = @Longitude, VisitSubmittedOn = NULL WHERE " + Allotted + " AND SchemeStatus = 'OnsiteWithAssessor';\n" +
        "DECLARE @Updated int = @@ROWCOUNT;\nIF @Updated = 1\nBEGIN\n" +
        "DELETE FROM dbo.FinancialAssistancePhotos WHERE FinancialAssistanceId = @Id AND Name IN ('onsite/selfie', 'onsite/site');\n" +
        InsertPhoto + "VALUES (@ZedId, @SelfieId, 'onsite/selfie', @SelfieTime, @Latitude, @Longitude, 'Onsite', GETDATE(), @SchemeCode, @Id), " +
        "(@ZedId, @SiteId, 'onsite/site', @SiteTime, @SiteLatitude, @SiteLongitude, 'Onsite', GETDATE(), @SchemeCode, @Id);\nEND\n" +
        "COMMIT;\nSELECT @Updated;";

    /// <summary>One item photo, only while the visit is open and the item has fewer than the maximum (checked again in the statement).</summary>
    public const string AddPhotoSql =
        "SET XACT_ABORT ON;\nBEGIN TRAN;\n" +
        "DECLARE @Open int = (SELECT COUNT(*) FROM dbo.FinancialAssistance WITH (UPDLOCK, HOLDLOCK) WHERE " + Allotted + " AND SchemeStatus = 'OnsiteVisit');\n" +
        "DECLARE @Taken int = (SELECT COUNT(*) FROM dbo.FinancialAssistancePhotos WHERE FinancialAssistanceId = @Id AND Name = @Name);\n" +
        "DECLARE @Done int = CASE WHEN @Open = 1 AND @Taken < @Max THEN 1 ELSE 0 END;\n" +
        "IF @Done = 1\n" + InsertPhoto + "VALUES (@ZedId, @PhotoId, @Name, @TimeStamp, @Latitude, @Longitude, 'Onsite', GETDATE(), @SchemeCode, @Id);\n" +
        "COMMIT;\nSELECT @Done;";

    public const string DeletePhotoSql =
        "DELETE FROM dbo.FinancialAssistancePhotos WHERE FinancialAssistanceId = @Id AND PhotoId = @PhotoId AND Name LIKE 'onsite/%/%' " +
        "AND EXISTS (SELECT 1 FROM dbo.FinancialAssistance WHERE " + Allotted + " AND SchemeStatus = 'OnsiteVisit');\nSELECT @@ROWCOUNT;";

    public const string SaveSql =
        "UPDATE dbo.FinancialAssistance SET FormChecks = @FormChecks, RepresentativeName = @RepresentativeName, RepresentativeMobile = @RepresentativeMobile, " +
        "OnsiteRemarks = @OnsiteRemarks WHERE " + Allotted + " AND SchemeStatus = 'OnsiteVisit';\nSELECT @@ROWCOUNT;";

    public const string RecommendSql =
        "UPDATE dbo.FinancialAssistance SET SchemeStatus = 'Qc', VerificationStatus = 3, OnsiteVerifiedClaim = @Verified, EligibleAmount = @Eligible, " +
        "OnsiteRemarks = @OnsiteRemarks, VisitSubmittedOn = GETDATE() WHERE " + Allotted + " AND SchemeStatus = 'OnsiteVisit';\nSELECT @@ROWCOUNT;";

    public const string RejectSql =
        "UPDATE dbo.FinancialAssistance SET SchemeStatus = 'Rejected', VerificationStatus = @VerificationStatus, ReasonForRejection = @Reason, " +
        "OnsiteRemarks = @OnsiteRemarks, DecidedOn = GETDATE(), VisitSubmittedOn = GETDATE() WHERE " + Allotted + " AND SchemeStatus = 'OnsiteVisit';\nSELECT @@ROWCOUNT;";

    /// <summary>The history entry, as the portal's scheme pages write theirs (SchemeCommon.AuditAsync: MsmeHistory, StaffAction).</summary>
    public const string HistorySql =
        "INSERT INTO MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType) VALUES (@ZedId, @Descrip, GETDATE(), @CertificationType, 'StaffAction')";

    internal sealed class UserRow
    {
        public string? UserId { get; init; }
        public int? RoleId { get; init; }
        public bool? IsActive { get; init; }
    }

    internal sealed class UnitRow
    {
        public string? EnterpriseName { get; init; }
        public string? PUnitName { get; init; }
        public string? PAddress { get; init; }
        public string? PCity { get; init; }
        public string? PDistrictName { get; init; }
        public string? PStateName { get; init; }
        public string? PPin { get; init; }

        public string Name => (EnterpriseName ?? PUnitName ?? "").Trim();

        public string Address => string.Join(", ", new[] { PUnitName != EnterpriseName ? PUnitName : null, PAddress, PCity, PDistrictName, PStateName, PPin }
            .Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s!.Trim()));
    }

    internal sealed class ListRow
    {
        public int Id { get; init; }
        public string? ZedId { get; init; }
        public string? SchemeCode { get; init; }
        public string? SchemeLevel { get; init; }
        public string? SchemeStatus { get; init; }
        public decimal? ClaimAmount { get; init; }
        public DateTime? OnsiteAllotmentDate { get; init; }
        public DateTime? VisitStartedOn { get; init; }
        public string? EnterpriseName { get; init; }
        public string? PUnitName { get; init; }
        public string? PAddress { get; init; }
        public string? PCity { get; init; }
        public string? PDistrictName { get; init; }
        public string? PStateName { get; init; }
        public string? PPin { get; init; }

        public UnitRow Unit => new()
        {
            EnterpriseName = EnterpriseName, PUnitName = PUnitName, PAddress = PAddress, PCity = PCity, PDistrictName = PDistrictName,
            PStateName = PStateName, PPin = PPin,
        };
    }

    internal sealed class SchemeRow
    {
        public string? SchemeCode { get; init; }
        public string? SchemeJson { get; init; }
    }

    internal sealed class PhotoRow
    {
        public string? PhotoId { get; init; }
        public string? Name { get; init; }
        public string? TimeStamp { get; init; }
        public string? Latitude { get; init; }
        public string? Longitude { get; init; }
    }

    // ------------------------------------------------------------------ reads

    /// <summary>The applications allotted to the assessor for onsite verification: to visit, and visits started.</summary>
    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId", TokenRequired = true)]
    public async Task<IActionResult> List(SchemeVisitRequest request, CancellationToken ct)
    {
        if (await AssessorRefusalAsync(nameof(List), request.saId, ct) is { } refused) return refused;
        var rows = await db.QuerySqlAsync<ListRow>(ListSql, new { UserId = Ansi(request.saId!.Trim(), 50) }, ct);
        var schemes = await SchemesAsync(ct);
        return LegacyJson(new SchemeVisitListResponse
        {
            status = "1",
            visits = rows.Select(r => new SchemeVisitSummary
            {
                applicationId = r.Id,
                zedId = r.ZedId?.Trim(),
                unitName = r.Unit.Name,
                address = r.Unit.Address,
                schemeCode = r.SchemeCode?.Trim(),
                schemeName = schemes.GetValueOrDefault(r.SchemeCode?.Trim() ?? "")?.Name is { Length: > 0 } n ? n : r.SchemeCode?.Trim(),
                level = r.SchemeLevel?.Trim(),
                levelName = LevelName(r.SchemeLevel),
                claimAmount = r.ClaimAmount,
                status = r.SchemeStatus?.Trim(),
                allottedOn = SchemeVisitRules.Iso(r.OnsiteAllotmentDate),
                visitStartedOn = SchemeVisitRules.Iso(r.VisitStartedOn),
            }).ToList(),
        });
    }

    /// <summary>
    /// One application: the unit, the scheme, the applicant's answers by section and item (read-only, with their files), the
    /// answers checked at the visit, the items photographed (with the photos stored) and what the visit saved so far.
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId", TokenRequired = true)]
    public async Task<IActionResult> Detail(SchemeVisitRequest request, CancellationToken ct)
    {
        var (row, refusal) = await MineAsync(nameof(Detail), request, ct);
        if (row is null) return refusal!;
        var def = (await SchemesAsync(ct)).GetValueOrDefault(row.SchemeCode?.Trim() ?? "");
        if (def is null) return Fail("The scheme of this application is not available. Please contact the ZED team.");
        var unit = (await db.QuerySqlAsync<UnitRow>(UnitSql, new { ZedId = Ansi(row.ZedId?.Trim(), 50) }, ct)).FirstOrDefault() ?? new UnitRow();
        var photos = await PhotosAsync(row.Id, ct);
        return LegacyJson(new SchemeVisitDetailResponse { status = "1", visit = DetailOf(row, def, unit, photos) });
    }

    /// <summary>
    /// A document or photo of the application (an answer's file, or an onsite photo), as the app opens the other files: GET with
    /// the app token header (the phone's downloader). Only while it is allotted to the assessor.
    /// </summary>
    [HttpGet]
    [DeviceBound(MobileApps.SiteAssessor, "saId", TokenRequired = true)]
    public async Task<IActionResult> Document(SchemeVisitFileRequest request, CancellationToken ct)
    {
        var name = request.name?.Trim();
        if (!SchemeVisitRules.IsStoredName(name)) return NotFound();
        var (row, _) = await MineAsync(nameof(Document), request, ct);
        if (row is null) return NotFound();
        var def = (await SchemesAsync(ct)).GetValueOrDefault(row.SchemeCode?.Trim() ?? "");
        var allowed = SchemeVisitRules.AllFiles(def, row.Answers);
        allowed.UnionWith((await PhotosAsync(row.Id, ct)).Select(p => p.PhotoId?.Trim() ?? ""));
        if (!allowed.Contains(name!)) return NotFound();
        var zedId = MobileStorage.Segment(row.ZedId);
        foreach (var top in new[] { "Photos", "CertifiedPhotos" })
        {
            var path = Path.GetFullPath(Path.Combine(storage.Root, top, zedId, Folder, name!));
            if (!path.StartsWith(storage.Root, StringComparison.OrdinalIgnoreCase) || !System.IO.File.Exists(path)) continue;
            if (!ContentTypes.TryGetContentType(path, out var type)) type = "application/octet-stream";
            Response.Headers.CacheControl = "private, no-store";
            Response.Headers.XContentTypeOptions = "nosniff";
            return PhysicalFile(path, type);
        }
        log.LogInformation("Scheme document {Name} of application {Id} is missing from storage", name, row.Id);
        return NotFound();
    }

    // ------------------------------------------------------------------ writes

    /// <summary>
    /// The start of the visit at the unit: the selfie and the site photo, each with GPS and time. The date of verification
    /// (<c>VisitStartedOn</c>) is the server's time; the selfie's GPS is where the visit started. Only from
    /// <see cref="OnsiteWithAssessor"/>; the same photos sent again (a retry) answer success.
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId", TokenRequired = true)]
    public async Task<IActionResult> Start(SchemeVisitStartRequest request, CancellationToken ct)
    {
        var (row, refusal) = await MineAsync(nameof(Start), request, ct);
        if (row is null) return refusal!;
        if (request.selfie is not { } selfie || string.IsNullOrWhiteSpace(selfie.photo) || string.IsNullOrWhiteSpace(selfie.photoId)
            || request.site is not { } site || string.IsNullOrWhiteSpace(site.photo) || string.IsNullOrWhiteSpace(site.photoId))
            return Fail("Please take the selfie and the site photo.");
        if (!SchemeVisitRules.HasGps(selfie.latitude, selfie.longitude) || !SchemeVisitRules.HasGps(site.latitude, site.longitude)) return Fail(GpsRequired);

        if (row.Status == OnsiteVisit)
        {
            // A retry of a start that reached the server (the answer was lost): the same selfie is stored.
            var stored = await PhotosAsync(row.Id, ct);
            if (stored.Any(p => p.Name == SchemeVisitRules.SelfieSlot && SchemeVisitRules.SameUpload(p.PhotoId?.Trim(), row.Id, selfie.photoId!)))
                return LegacyJson(new SchemeVisitWriteResponse { status = "1", visitStatus = OnsiteVisit, visitStartedOn = SchemeVisitRules.Iso(row.VisitStartedOn) });
            return Fail("The visit is already started.");
        }
        if (row.Status != OnsiteWithAssessor) return Fail(NotOpen);

        var now = DateTime.Now;
        var selfieName = SchemeVisitRules.PhotoFileName(row.Id, selfie.photoId!.Trim(), now);
        var siteName = SchemeVisitRules.PhotoFileName(row.Id, site.photoId!.Trim(), now.AddMilliseconds(1));
        var folder = storage.Folder("Photos", row.ZedId, Folder);
        await storage.SaveBase64Async(selfie.photo!, folder, selfieName, ct);
        await storage.SaveBase64Async(site.photo!, folder, siteName, ct);

        var done = await FirstIntAsync(StartSql, new
        {
            row.Id,
            UserId = Ansi(request.saId!.Trim(), 50),
            ZedId = Ansi(row.ZedId?.Trim(), 50),
            SchemeCode = Ansi(row.SchemeCode?.Trim(), 50),
            SelfieId = Ansi(selfieName, 50),
            SelfieTime = Ansi(Cut(selfie.timeStamp, 50) ?? " ", 50),
            Latitude = Ansi(Cut(selfie.latitude, 50), 50),
            Longitude = Ansi(Cut(selfie.longitude, 50), 50),
            SiteId = Ansi(siteName, 50),
            SiteTime = Ansi(Cut(site.timeStamp, 50) ?? " ", 50),
            SiteLatitude = Ansi(Cut(site.latitude, 50), 50),
            SiteLongitude = Ansi(Cut(site.longitude, 50), 50),
        }, ct);
        if (done != 1) return Fail(Changed);
        await HistoryAsync(row, $"Onsite verification visit started by assessor {request.saId!.Trim()} at {selfie.latitude}, {selfie.longitude}", ct);
        log.LogInformation("Scheme visit started: application {Id} by {SaId}", row.Id, request.saId);
        return LegacyJson(new SchemeVisitWriteResponse { status = "1", visitStatus = OnsiteVisit, visitStartedOn = SchemeVisitRules.Iso(now) });
    }

    /// <summary>One geo-tagged photo of an item; at most the scheme's maximum per item. The same photo sent again answers its stored name.</summary>
    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId", TokenRequired = true)]
    public async Task<IActionResult> SavePhoto(SchemeVisitPhotoRequest request, CancellationToken ct)
    {
        var (row, refusal) = await OpenAsync(nameof(SavePhoto), request, ct);
        if (row is null) return refusal!;
        var def = (await SchemesAsync(ct)).GetValueOrDefault(row.SchemeCode?.Trim() ?? "");
        if (def is null) return Fail(Changed);
        var item = OnsiteItemsOf(def, row.Answers).FirstOrDefault(i => i.Section == request.section?.Trim() && i.Index == request.index);
        if (item is null) return Fail("The item to photograph was not found. Please refresh the application.");
        if (request.photo is not { } p || string.IsNullOrWhiteSpace(p.photo) || string.IsNullOrWhiteSpace(p.photoId)) return Fail(PhotoMissing);
        if (!SchemeVisitRules.HasGps(p.latitude, p.longitude)) return Fail(GpsRequired);

        var slot = OnsitePhotoName(item.Section, item.Index);
        var stored = await PhotosAsync(row.Id, ct);
        if (stored.FirstOrDefault(s => SchemeVisitRules.SameUpload(s.PhotoId?.Trim(), row.Id, p.photoId!.Trim())) is { } again)
            return LegacyJson(new SchemeVisitWriteResponse { status = "1", name = again.PhotoId?.Trim() });
        var max = Math.Max(1, def.Verification.OnsitePhotosMax);
        if (stored.Count(s => s.Name == slot) >= max) return Fail($"\"{item.Title}\": at most {max} photo(s). Remove one to take another.");

        var name = SchemeVisitRules.PhotoFileName(row.Id, p.photoId!.Trim(), DateTime.Now);
        await storage.SaveBase64Async(p.photo!, storage.Folder("Photos", row.ZedId, Folder), name, ct);
        var done = await FirstIntAsync(AddPhotoSql, new
        {
            row.Id,
            UserId = Ansi(request.saId!.Trim(), 50),
            ZedId = Ansi(row.ZedId?.Trim(), 50),
            SchemeCode = Ansi(row.SchemeCode?.Trim(), 50),
            PhotoId = Ansi(name, 50),
            Name = Ansi(slot, 200),
            TimeStamp = Ansi(Cut(p.timeStamp, 50) ?? " ", 50),
            Latitude = Ansi(Cut(p.latitude, 50), 50),
            Longitude = Ansi(Cut(p.longitude, 50), 50),
            Max = max,
        }, ct);
        if (done != 1) return Fail($"\"{item.Title}\": the photo could not be added (at most {max}, while the visit is open).");
        return LegacyJson(new SchemeVisitWriteResponse { status = "1", name = name });
    }

    /// <summary>Removes an item photo (taken again); one already gone answers success.</summary>
    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId", TokenRequired = true)]
    public async Task<IActionResult> DeletePhoto(SchemeVisitDeletePhotoRequest request, CancellationToken ct)
    {
        var (row, refusal) = await OpenAsync(nameof(DeletePhoto), request, ct);
        if (row is null) return refusal!;
        if (string.IsNullOrWhiteSpace(request.photoId)) return Fail(PhotoMissing);
        var stored = (await PhotosAsync(row.Id, ct)).FirstOrDefault(s =>
            s.Name?.StartsWith(SchemeVisitRules.SlotPrefix, StringComparison.Ordinal) == true && s.Name is not (SchemeVisitRules.SelfieSlot or SchemeVisitRules.SiteSlot)
            && (SchemeVisitRules.SameUpload(s.PhotoId?.Trim(), row.Id, request.photoId.Trim()) || string.Equals(s.PhotoId?.Trim(), request.photoId.Trim(), StringComparison.Ordinal)));
        if (stored is null) return LegacyJson(new SchemeVisitWriteResponse { status = "1" });
        await FirstIntAsync(DeletePhotoSql, new { row.Id, UserId = Ansi(request.saId!.Trim(), 50), PhotoId = Ansi(stored.PhotoId?.Trim(), 50) }, ct);
        return LegacyJson(new SchemeVisitWriteResponse { status = "1", name = stored.PhotoId?.Trim() });
    }

    /// <summary>
    /// The representative's name and mobile, the overall remarks and onsite checks (Valid / Not valid with a remark; an empty status
    /// removes the check), merged into FormChecks under <see cref="OnsiteKey"/>. What is not given stays.
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId", TokenRequired = true)]
    public async Task<IActionResult> Save(SchemeVisitSaveRequest request, CancellationToken ct)
    {
        var (row, refusal) = await OpenAsync(nameof(Save), request, ct);
        if (row is null) return refusal!;
        var def = (await SchemesAsync(ct)).GetValueOrDefault(row.SchemeCode?.Trim() ?? "");
        if (def is null) return Fail(Changed);

        var name = row.RepresentativeName;
        if (request.representativeName is not null)
        {
            if (request.representativeName.Trim().Length == 0) name = null;
            else if (SchemeVisitRules.Text(request.representativeName, SchemeVisitRules.MaxName) is { } n) name = n;
            else return Fail($"The representative's name: up to {SchemeVisitRules.MaxName} characters.");
        }
        var mobile = row.RepresentativeMobile;
        if (request.representativeMobile is not null)
        {
            var m = request.representativeMobile.Trim();
            if (m.Length == 0) mobile = null;
            else if (SchemeVisitRules.IsMobile(m)) mobile = m;
            else return Fail("Please enter a valid 10-digit mobile number of the representative.");
        }
        var remarks = row.OnsiteRemarks;
        if (request.remarks is not null)
        {
            if (request.remarks.Trim().Length == 0) remarks = null;
            else if (SchemeVisitRules.Text(request.remarks, SchemeVisitRules.MaxOverallRemarks, lines: true) is { } r) remarks = r;
            else return Fail($"The remarks: up to {SchemeVisitRules.MaxOverallRemarks} characters.");
        }

        var checks = row.Checks;
        if (request.checks is { Count: > 0 })
        {
            var places = OnsitePlacesOf(def, row.Answers).ToDictionary(x => x.Path, StringComparer.Ordinal);
            foreach (var c in request.checks)
            {
                var path = c.path?.Trim() ?? "";
                if (!places.TryGetValue(path, out var place)) return Fail("An answer to check was not found. Please refresh the application.");
                var status = c.status?.Trim() ?? "";
                if (status.Length == 0)
                {
                    checks.Remove(OnsiteKey(path));
                    continue;
                }
                if (status is not (SchemeVisitRules.Valid or SchemeVisitRules.NotValid)) return Fail($"\"{place.Label}\": choose Valid or Not valid.");
                if (c.remarks?.Trim().Length > SchemeVisitRules.MaxRemarks) return Fail($"\"{place.Label}\": the remark can have at most {SchemeVisitRules.MaxRemarks} characters.");
                var remark = SchemeVisitRules.Text(c.remarks, SchemeVisitRules.MaxRemarks, lines: true);
                if (status == SchemeVisitRules.NotValid && remark is null) return Fail($"\"{place.Label}\": please write what is not valid.");
                checks[OnsiteKey(path)] = new FieldCheck(status, remark, row.CorrectionRound ?? 0, request.saId!.Trim(), DateTime.Now);
            }
        }

        var done = await FirstIntAsync(SaveSql, new
        {
            row.Id,
            UserId = Ansi(request.saId!.Trim(), 50),
            FormChecks = FieldCheck.Serialize(checks),
            RepresentativeName = Ansi(name, 200),
            RepresentativeMobile = Ansi(mobile, 20),
            OnsiteRemarks = Ansi(remarks, 4000),
        }, ct);
        return done == 1 ? LegacyJson(new SchemeVisitWriteResponse { status = "1" }) : Fail(Changed);
    }

    /// <summary>
    /// The onsite result. <b>recommend</b>: every onsite answer checked and none Not valid, the minimum of photos for every item, the
    /// representative's details, and the verified claim (at most the claimed amount): <c>OnsiteVerifiedClaim</c>, the eligible amount
    /// on it (the row's share % and maximum), status <see cref="Qc"/> (the onsite agency's QC). <b>reject</b>: a reason and remarks,
    /// status <see cref="Rejected"/> (the applicant may apply again). Both set <c>VisitSubmittedOn</c> and close the visit.
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId", TokenRequired = true)]
    public async Task<IActionResult> Submit(SchemeVisitSubmitRequest request, CancellationToken ct)
    {
        var (row, refusal) = await OpenAsync(nameof(Submit), request, ct);
        if (row is null) return refusal!;
        var def = (await SchemesAsync(ct)).GetValueOrDefault(row.SchemeCode?.Trim() ?? "");
        if (def is null) return Fail(Changed);
        var saId = request.saId!.Trim();
        var remarks = row.OnsiteRemarks;
        if (!string.IsNullOrWhiteSpace(request.remarks))
        {
            if (SchemeVisitRules.Text(request.remarks, SchemeVisitRules.MaxOverallRemarks, lines: true) is { } r) remarks = r;
            else return Fail($"The remarks: up to {SchemeVisitRules.MaxOverallRemarks} characters.");
        }

        switch (request.decision?.Trim().ToLowerInvariant())
        {
            case SchemeVisitRules.Recommend:
            {
                var photos = await PhotosAsync(row.Id, ct);
                var problems = SchemeVisitRules.RecommendProblems(def, row.Answers, row.Checks, photos.Select(p => p.Name?.Trim() ?? "").ToList(),
                    row.RepresentativeName, row.RepresentativeMobile);
                if (problems.Count > 0) return Fail(problems[0]);
                if (SchemeVisitRules.VerifiedClaimProblem(request.verifiedClaim, row.ClaimAmount) is { } claimProblem) return Fail(claimProblem);
                var verified = request.verifiedClaim!.Value;
                var (share, max) = SchemeVisitRules.Grade(row, def);
                if (share is null) log.LogWarning("Scheme visit recommend: application {Id} has no grade; eligible 0", row.Id);
                var eligible = SchemeVisitRules.Eligible(verified, share, max);
                var done = await FirstIntAsync(RecommendSql, new
                {
                    row.Id, UserId = Ansi(saId, 50), Verified = verified, Eligible = Ansi(SchemeVisitRules.Money(eligible), 50), OnsiteRemarks = Ansi(remarks, 4000),
                }, ct);
                if (done != 1) return Fail(Changed);
                await HistoryAsync(row, $"Scheme application recommended at the onsite visit by assessor {saId}: verified claim Rs. {SchemeVisitRules.Money(verified)}, " +
                    $"eligible Rs. {SchemeVisitRules.Money(eligible)}", ct);
                log.LogInformation("Scheme visit recommended: application {Id} by {SaId}", row.Id, saId);
                return LegacyJson(new SchemeVisitWriteResponse
                {
                    status = "1", errorMessage = "Recommended. It goes to the onsite agency for QC.", visitStatus = Qc, eligibleAmount = eligible,
                });
            }
            case SchemeVisitRules.Reject:
            {
                if (SchemeVisitRules.Text(request.reason, SchemeVisitRules.MaxRemarks, lines: true) is not { } reason)
                    return Fail($"Please enter the reason for rejection (up to {SchemeVisitRules.MaxRemarks} characters).");
                if (string.IsNullOrWhiteSpace(remarks)) return Fail("Please write your remarks on the visit.");
                var done = await FirstIntAsync(RejectSql, new
                {
                    row.Id, UserId = Ansi(saId, 50), Reason = Ansi(reason, 2000), OnsiteRemarks = Ansi(remarks, 4000),
                    VerificationStatus = SchemeApplications.VerificationStatus(Rejected),
                }, ct);
                if (done != 1) return Fail(Changed);
                await HistoryAsync(row, $"Scheme application rejected at the onsite visit by assessor {saId}: {reason}", ct);
                log.LogInformation("Scheme visit rejected: application {Id} by {SaId}", row.Id, saId);
                return LegacyJson(new SchemeVisitWriteResponse { status = "1", errorMessage = "Application rejected.", visitStatus = Rejected });
            }
            default:
                return Fail("Choose recommend or reject.");
        }
    }

    // ------------------------------------------------------------------ helpers

    /// <summary>The token proves the sign-in; the Users row must still be an active assessor (RoleId 3), else the app is signed out.</summary>
    private async Task<IActionResult?> AssessorRefusalAsync(string action, string? saId, CancellationToken ct)
    {
        var user = string.IsNullOrWhiteSpace(saId) ? null
            : (await db.QuerySqlAsync<UserRow>(AssessorSql, new { UserId = Ansi(saId.Trim(), 50) }, ct)).FirstOrDefault();
        if (user is { RoleId: 3, IsActive: true }) return null;
        log.LogWarning("Refused SchemeVisits/{Action}: {SaId} is not an active assessor", action, saId);
        return Fail(AppTokens.ExpiredMessage);
    }

    /// <summary>The application, when it is allotted to the signed-in assessor for onsite verification.</summary>
    private async Task<(Row? Row, IActionResult? Refusal)> MineAsync(string action, SchemeVisitRequest request, CancellationToken ct)
    {
        if (await AssessorRefusalAsync(action, request.saId, ct) is { } refused) return (null, refused);
        var row = request.applicationId <= 0 ? null : (await db.QuerySqlAsync<Row>(ByIdWithOnsiteSql, new { Id = request.applicationId }, ct)).FirstOrDefault();
        if (row is null || !string.Equals(row.OnsiteAssessorId?.Trim(), request.saId!.Trim(), StringComparison.OrdinalIgnoreCase) || row.VerificationStatus == 6)
        {
            log.LogWarning("Refused SchemeVisits/{Action}: application {Id} is not allotted to {SaId}", action, request.applicationId, request.saId);
            return (null, Fail(NotAllotted));
        }
        return (row, null);
    }

    /// <summary>The application with its visit started and not submitted (the writes after the start).</summary>
    private async Task<(Row? Row, IActionResult? Refusal)> OpenAsync(string action, SchemeVisitRequest request, CancellationToken ct)
    {
        var (row, refusal) = await MineAsync(action, request, ct);
        if (row is null) return (null, refusal);
        if (row.Status == OnsiteVisit) return (row, null);
        return (null, Fail(row.Status == OnsiteWithAssessor ? NotStarted : NotOpen));
    }

    /// <summary>The scheme definitions by code (empty before migration 0105).</summary>
    private async Task<Dictionary<string, SchemeDefinition>> SchemesAsync(CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<SchemeRow>(SchemesSql, null, ct))
                .Select(r => SchemeRules.Parse(r.SchemeJson) is { } d && !string.IsNullOrWhiteSpace(r.SchemeCode) ? d with { Code = r.SchemeCode.Trim() } : null)
                .Where(d => d is not null)
                .GroupBy(d => d!.Code, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First()!, StringComparer.OrdinalIgnoreCase);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Scheme definitions not read (is migration 0105 applied?)");
            return new(StringComparer.OrdinalIgnoreCase);
        }
    }

    private async Task<List<PhotoRow>> PhotosAsync(int id, CancellationToken ct) =>
        (await db.QuerySqlAsync<PhotoRow>(PhotosSql, new { Id = id }, ct)).ToList();

    private async Task<int> FirstIntAsync(string sql, object args, CancellationToken ct) =>
        (await db.QuerySqlAsync<int>(sql, args, ct)).FirstOrDefault();

    private async Task HistoryAsync(Row row, string text, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(HistorySql, new
            {
                ZedId = row.ZedId?.Trim(),
                Descrip = text.Length > 2000 ? text[..2000] : text,
                CertificationType = row.SchemeCode?.Trim(),
            }, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Could not record the history entry of scheme application {Id}", row.Id);
        }
    }

    internal static string? LevelName(string? level) =>
        string.IsNullOrWhiteSpace(level) ? null : LevelRegistry.Find(level) is { } e ? e.Name : level.Trim();

    private static string? Cut(string? v, int max) => string.IsNullOrWhiteSpace(v) ? null : v.Trim().Length <= max ? v.Trim() : v.Trim()[..max];

    private static SchemeVisitSavedPhoto Saved(PhotoRow p) => new()
    {
        name = p.PhotoId?.Trim(), slot = p.Name?.Trim(), timeStamp = p.TimeStamp?.Trim(), latitude = p.Latitude?.Trim(), longitude = p.Longitude?.Trim(),
    };

    /// <summary>The detail answer (also used by the tests through the controller).</summary>
    internal static SchemeVisitDetail DetailOf(Row row, SchemeDefinition def, UnitRow unit, IReadOnlyList<PhotoRow> photos)
    {
        var answers = row.Answers;
        var formChecks = row.Checks;
        var places = OnsitePlacesOf(def, answers);
        var onsitePaths = places.Select(p => p.Path).ToHashSet(StringComparer.Ordinal);
        var items = OnsiteItemsOf(def, answers);
        var (share, max) = SchemeVisitRules.Grade(row, def);

        var sections = new List<SchemeVisitSection>();
        foreach (var s in def.Form.Sections)
        {
            var list = answers.Sections.GetValueOrDefault(s.Key) ?? [];
            var outItems = new List<SchemeVisitItem>();
            for (var i = 0; i < list.Count; i++)
            {
                var item = list[i];
                if (!item.Saved && s.Repeating) continue;
                var outAnswers = new List<SchemeVisitAnswer>();
                foreach (var f in s.Fields)
                {
                    var value = item.Values.GetValueOrDefault(f.Key);
                    var path = PathOf(s.Key, i, f.Key);
                    var checkOnsite = onsitePaths.Contains(path);
                    if (string.IsNullOrWhiteSpace(value) && !checkOnsite) continue;
                    var isFile = f.Type is "document" or "photo";
                    outAnswers.Add(new SchemeVisitAnswer
                    {
                        path = path,
                        field = f.Key,
                        label = f.Label,
                        type = f.Type,
                        value = isFile ? null : SchemeVisitRules.Display(value),
                        files = isFile ? SchemeVisitRules.FilesOf(value).Select(n => new SchemeVisitFile { name = n, isPdf = n.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) }).ToList() : null,
                        isClaim = f.IsClaim,
                        checkOnsite = checkOnsite,
                        desktop = formChecks.TryGetValue(path, out var d) ? new SchemeVisitCheckState { status = d.Status, remarks = d.Remarks } : null,
                    });
                }
                var title = items.FirstOrDefault(x => x.Section == s.Key && x.Index == i)?.Title ?? s.Title;
                outItems.Add(new SchemeVisitItem { index = i, title = title, answers = outAnswers });
            }
            if (outItems.Count > 0) sections.Add(new SchemeVisitSection { key = s.Key, title = s.Title, help = s.Help, repeating = s.Repeating, items = outItems });
        }

        return new SchemeVisitDetail
        {
            applicationId = row.Id,
            zedId = row.ZedId?.Trim(),
            unitName = unit.Name,
            address = unit.Address,
            schemeCode = def.Code,
            schemeName = string.IsNullOrWhiteSpace(def.Name) ? def.Code : def.Name,
            level = row.SchemeLevel?.Trim(),
            levelName = LevelName(row.SchemeLevel),
            status = row.Status,
            open = row.Status is OnsiteWithAssessor or OnsiteVisit,
            claimAmount = row.ClaimAmount,
            eligibleAmount = decimal.TryParse(row.EligibleAmount, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var e) ? e : null,
            sharePercent = share,
            maxAmount = max,
            photosMin = Math.Max(0, def.Verification.OnsitePhotosMin),
            photosMax = Math.Max(1, def.Verification.OnsitePhotosMax),
            visitStartedOn = SchemeVisitRules.Iso(row.VisitStartedOn),
            visitLatitude = row.VisitLatitude?.Trim(),
            visitLongitude = row.VisitLongitude?.Trim(),
            visitSubmittedOn = SchemeVisitRules.Iso(row.VisitSubmittedOn),
            representativeName = row.RepresentativeName?.Trim(),
            representativeMobile = row.RepresentativeMobile?.Trim(),
            remarks = row.OnsiteRemarks,
            verifiedClaim = row.OnsiteVerifiedClaim,
            sections = sections,
            places = places.Select(p => new SchemeVisitPlace { path = p.Path, label = p.Label, section = p.Section, index = p.Index, field = p.Field }).ToList(),
            items = items.Select(i => new SchemeVisitPhotoSlot
            {
                section = i.Section,
                index = i.Index,
                title = i.Title,
                photos = photos.Where(p => p.Name?.Trim() == OnsitePhotoName(i.Section, i.Index)).Select(Saved).ToList(),
            }).ToList(),
            selfie = photos.LastOrDefault(p => p.Name?.Trim() == SchemeVisitRules.SelfieSlot) is { } self ? Saved(self) : null,
            sitePhoto = photos.LastOrDefault(p => p.Name?.Trim() == SchemeVisitRules.SiteSlot) is { } sp ? Saved(sp) : null,
            checks = SchemeVisitRules.OnsiteChecks(formChecks).ToDictionary(c => c.Key, c => new SchemeVisitCheckState { status = c.Value.Status, remarks = c.Value.Remarks }),
        };
    }
}
