using System.Data;
using System.Data.Common;
using System.Globalization;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Portal.Features.Staff.Schemes;

namespace Zed.Portal.Features.Consultancy.TechnologyUpgradation;

/// <summary>DataModels.SubmitAssessmentRequest as the DFO app posts it (field names and casing of the legacy contract).</summary>
public sealed class TuOpenMeetingRequest
{
    public DeviceInfo? deviceInfo { get; set; }
    public string? version { get; set; }
    public int userType { get; set; }
    public string? saId { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public string? sectionName { get; set; }
    public string? latitude { get; set; }
    public string? longitude { get; set; }
    public List<TuMeetingPhoto>? assessmentPhotos { get; set; }
    public List<TuMeetingParticipant>? startParticipants { get; set; }
    public List<TuMeetingParticipant>? endParticipants { get; set; }
    public string? inputComment { get; set; }
    public string? endComment { get; set; }
}

/// <summary>DataModels.PhotoInformation (the fields this action reads, plus the ones the app sends).</summary>
public sealed class TuMeetingPhoto
{
    public bool isPdf { get; set; }
    public string? photoId { get; set; }
    public string? photo { get; set; }
    public string? photoPath { get; set; }
    public string? timeStamp { get; set; }
    public string? name { get; set; }
    public string? photoType { get; set; }
    public string? latitude { get; set; }
    public string? longitude { get; set; }
    public string? comment { get; set; }
}

public sealed class TuMeetingParticipant
{
    public string? name { get; set; }
    public string? designation { get; set; }
}

/// <summary>
/// The DFO app's opening meeting of a technology upgradation verification, at its old address on the consultancy web
/// site: <c>POST /Consultancy/FinancialAssistance/SubmitOpenMeeting</c> (the consultancy API runs under the path base
/// <c>/Consultancy</c>). Port of the consultancy FinancialAssistanceController.SubmitOpenMeeting with the same request
/// (<c>saId</c>, <c>zedId</c>, <c>certificationType</c>, base64 <c>assessmentPhotos</c>, <c>startParticipants</c>,
/// <c>inputComment</c>) and response (<c>{"status":"1"}</c> or <c>{"status":"0","errorMessage":...}</c>).
/// <para>
/// Legacy problems fixed here (finding #88): anyone could post a meeting for any unit; the photo path was built from
/// the request's <c>zedId</c>, <c>certificationType</c>, <c>name</c> and <c>photoId</c> under the web root; the whole
/// request, photos included, was written to <c>App_Data/Json/TU</c>; the SQL error text was returned. Now the DFO named
/// in <c>saId</c> must be the one allotted to the unit's application while it is with them (VerificationStatus 2), the
/// meeting can be submitted once, the device is checked as for the SA app (<see cref="DeviceBoundAttribute"/>), names
/// are plain names, photos must be JPEG or PNG and are stored under Portal:StorageRoot only, and nothing is logged but
/// the outcome.
/// </para>
/// </summary>
[PortalSystems(PortalSystem.Consultancy)]
public sealed class TuOpenMeetingController(
    ISqlExecutor db,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    IConfiguration config,
    ILogger<TuOpenMeetingController> log) : LegacyMobileController
{
    public const int MaxPhotos = 20;
    public const long MaxPhotoBytes = 5 * 1024 * 1024;
    internal const string ErrorText = "An error has occurred, please try again later.";
    internal const string NotAllotted = "You are not allotted to this unit for the verification.";
    internal const string AlreadySubmitted = "MSME SA Open Meeting Submitted for the ZEDID: ";

    [HttpPost("/FinancialAssistance/SubmitOpenMeeting")]
    [DeviceBound(MobileApps.SiteAssessor, "saId")]
    [RequestSizeLimit(MaxPhotos * MaxPhotoBytes * 4 / 3 + 1024 * 1024)]
    public async Task<IActionResult> SubmitOpenMeeting(TuOpenMeetingRequest request, CancellationToken ct)
    {
        var zedId = request.zedId?.Trim();
        var saId = request.saId?.Trim();
        if (!SchemeRows.IsZedId(zedId) || FaApplications.Canonical(request.certificationType) is not { } cert || string.IsNullOrWhiteSpace(saId))
            return Fail("Invalid Data.");

        var photos = request.assessmentPhotos?.Where(p => !string.IsNullOrEmpty(p.photo)).ToList() ?? [];
        if (photos.Count > MaxPhotos) return Fail("Invalid Data.");
        var files = new List<(TuMeetingPhoto Photo, string File, byte[] Bytes)>();
        foreach (var p in photos)
        {
            if (TuStorage.MeetingFile(p.name, p.photoId) is not { } file || Image(p.photo!) is not { } bytes)
            {
                log.LogWarning("TU open meeting for {ZedId} by {SaId}: photo '{Name}' refused", zedId, saId, p.name);
                return Fail("Invalid Data.");
            }
            files.Add((p, file, bytes));
        }
        var participants = request.startParticipants ?? [];
        if (participants.Count > 50 || participants.Any(p => p.name?.Length > 500 || p.designation?.Length > 500)) return Fail("Invalid Data.");
        if (request.inputComment?.Length > 5000) return Fail("Invalid Data.");

        using (await SchemeLocks.EnterAsync(ct))
        {
            var app = await TuApplications.FindAsync(db, zedId!, cert, ct);
            if (app is null || !SchemeRows.Same(app.AssessorUserId, saId) || app.Status != FaStatus.InProgress)
            {
                log.LogWarning("Refused TU open meeting: {SaId} is not the allotted DFO of {ZedId}/{Certification} (or it is not with the DFO)", saId, zedId, cert);
                return Fail(NotAllotted);
            }
            if (app.MeetingDone) return Fail(AlreadySubmitted + zedId);

            var storage = new TuStorage(env, portal, config);
            var saved = new List<string>();
            var table = new DataTable();
            foreach (var c in new[] { "PhotoId", "Name", "TimeStamp", "Latitude", "Longitude" }) table.Columns.Add(c, typeof(string));
            foreach (var (p, file, bytes) in files)
            {
                var target = storage.Target($"{TuStorage.MeetingFolder(app.ZedId, app.Certification)}/{file}");
                if (target is null) return Fail("Invalid Data.");
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                await System.IO.File.WriteAllBytesAsync(target, bytes, ct);
                saved.Add(target);
                table.Rows.Add(p.photoId, p.name, Cut(p.timeStamp, 50), Cut(p.latitude, 50), Cut(p.longitude, 50));
            }

            var args = new DynamicParameters();
            args.Add("RefId", DateTime.Now.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture));
            args.Add("ZedId", app.ZedId);
            args.Add("AssessorId", app.AssessorUserId);
            args.Add("CertificationType", app.Certification);
            args.Add("PhotoType", "Open Meeting");
            args.Add("Latitude", Cut(request.latitude, 200));
            args.Add("Longitude", Cut(request.longitude, 200));
            args.Add("Comments", request.inputComment);
            if (participants.Count > 0)
            {
                var people = new DataTable();
                people.Columns.Add("Name", typeof(string));
                people.Columns.Add("Designation", typeof(string));
                foreach (var p in participants) people.Rows.Add(p.name ?? "", p.designation ?? "");
                args.Add("ParticipantsList", people.AsTableValuedParameter("DynamicParticipants"));
            }
            if (table.Rows.Count > 0) args.Add("PhotoList", table.AsTableValuedParameter("DynamicPhotoList"));

            string? code, message;
            try
            {
                var row = (await db.QueryProcMultipleAsync("SP_FINANCIAL_ASSISTANCE_SUBMIT_OPEN_MEETING", args, ct))[0].FirstOrDefault();
                code = row?.Text("StatusCode");
                message = row?.Text("StatusMessage");
            }
            catch (DbException ex)
            {
                log.LogError(ex, "SP_FINANCIAL_ASSISTANCE_SUBMIT_OPEN_MEETING failed for {ZedId}", app.ZedId);
                code = null;
                message = null;
            }
            if (code != "200")
            {
                log.LogError("TU open meeting of {ZedId}/{Certification} not saved: {Code} {Message}", app.ZedId, app.Certification, code, message);
                foreach (var f in saved) TryDelete(f);
                return Fail(ErrorText);
            }
            log.LogInformation("TU open meeting of {ZedId}/{Certification} submitted by DFO {SaId} ({Photos} photos)", app.ZedId, app.Certification, saId, saved.Count);
        }
        return LegacyJson(new ServiceResponse { status = "1" });
    }

    /// <summary>The decoded photo when it is a JPEG or PNG of at most <see cref="MaxPhotoBytes"/>, else null.</summary>
    internal static byte[]? Image(string base64)
    {
        var comma = base64.IndexOf(',');
        var data = base64.StartsWith("data:", StringComparison.OrdinalIgnoreCase) && comma > 0 ? base64[(comma + 1)..] : base64;
        byte[] bytes;
        try { bytes = Convert.FromBase64String(data); }
        catch (FormatException) { return null; }
        if (bytes.Length is < 8 or > (int)MaxPhotoBytes) return null;
        var jpeg = bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF;
        var png = bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A });
        return jpeg || png ? bytes : null;
    }

    private static string? Cut(string? s, int max) => s is null ? null : s.Length <= max ? s : s[..max];

    private void TryDelete(string path)
    {
        try { System.IO.File.Delete(path); }
        catch (IOException ex) { log.LogWarning(ex, "Could not delete {Path}", path); }
    }
}
