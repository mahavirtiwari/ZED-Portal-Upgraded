using System.Data;
using System.Data.Common;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Zed.Core.Assessment;
using Zed.Core.Data;
using Zed.Core.Forms;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Security;
using Zed.Main.MobileApi.Models.Assessor;
using LoginServiceRequest = Zed.Main.MobileApi.Models.LoginServiceRequest;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// The site assessment app's calls (old SwachhSurvekshanServices SAController), at the same
/// addresses (/SA/{action}) with the same request and response formats.
/// <para>
/// Added over the old code: the assessor named in a write (<c>saId</c>) must be the lead or co-assessor
/// of the unit and certification named in it (MsmeCertifications.SiteAssessorId / CoAssessorId),
/// the certification used in upload paths must be a known one, every upload path goes through
/// <see cref="MobileStorage"/>, and request bodies are no longer written to App_Data/Json.
/// </para>
/// <para>
/// Also served by the Surveillance deployment (old SurveillanceServices SAController, site assessment of
/// Silver/Gold surveillance against ZED_SURVEILLANCE). The procedures and parameters are the same there; the
/// login procedure answers IsSurveillance = 1 and the unit's MinimumParameters, and the only code difference is
/// the file name of open and closing meeting photos (see <see cref="MeetingPhotoName"/>). The old surveillance
/// SA/SaveCapturedPhoto was called by the web page Remote/Index only and is served by the portal instead.
/// </para>
/// </summary>
[PortalSystems(PortalSystem.Main, PortalSystem.Surveillance)]
public sealed partial class SAController(
    ISqlExecutor db,
    IConfiguration config,
    IDeviceBindings devices,
    AppTokens tokens,
    LoginThrottle throttle,
    MobileStorage storage,
    PortalHost portal,
    IPortalSettings settings,
    ILogger<SAController> log) : LegacyMobileController
{
    internal const string UpdateAppMessage = "Download new app from store.";
    internal const string InvalidCredentials = "Invalid credetials."; // sic: the app shows the old text
    internal const string TooManyAttempts = "Too many failed attempts. Please try again after 15 minutes.";
    internal const string NotAllocated = "Site Assessment data not yet allocated for the ZEDID: ";
    internal const string LoginClosed = "SA Closing Meeting Submitted, hence SA is deemed completed for the ZEDID: ";
    internal const string Closed = "MSME SA Closing Meeting Submitted, hence SA is deemed completed for the ZEDID: ";
    internal const string OpenNotSubmitted = "MSME SA Open Meeting not Submitted for the ZEDID: ";
    internal const string OpenSubmitted = "MSME SA Open Meeting Submitted for the ZEDID: ";
    internal const string NotSynced = "All Parameters not synced yet for the ZEDID: ";
    /// <summary>Replaces the exception text the old actions returned.</summary>
    internal const string ErrorText = "An error has occurred, please try again later.";

    /// <summary>Allotment of a unit's certification; the staff side uses the same columns (AssessmentRecords).</summary>
    internal const string AllotmentSql =
        "SELECT SiteAssessorId, CoAssessorId FROM MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification";

    /// <summary>Certifications that site assessments are done for; used in upload paths.</summary>
    internal static readonly IReadOnlySet<string> Certifications =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Bronze", "Silver", "Gold", "ZEDX" };

    private enum Role { LeadOrCo, Lead, Co }

    // ------------------------------------------------------------------ Login

    [HttpPost]
    [LoginAudit(LoginChannels.Mobile, "Site assessment app")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public Task<IActionResult> Login(LoginServiceRequest request, CancellationToken ct) => Guarded(nameof(Login), async () =>
    {
        var signIn = await CheckSignInAsync(request.assessorId, request.password, request.version, request.zedId, ct);
        if (signIn.Refusal is { } refusal)
            return LegacyJson(refusal.Status == "2"
                ? new ServiceResponse { status = refusal.Status, errorMessage = refusal.Message }
                : new AssessmentDetails { status = refusal.Status, errorMessage = refusal.Message });

        var answer = await UnitAnswerAsync(signIn.Sets!, request.zedId, ct);
        if (answer.Response is not { } response)
            return LegacyJson(new AssessmentDetails { status = "0", errorMessage = answer.Refusal });

        var userKey = signIn.UserKey!;
        if (await OtherPhoneAsync(userKey, request.deviceInfo, ct) is { } phone)
            return LegacyJson(new AssessmentDetails { status = "0", errorMessage = phone });
        await RegisterPhoneAsync(userKey, request.deviceInfo, ct);
        // The calls are checked against the assessor (saId); the unit is recorded but each call checks the allotment itself.
        response.appToken = await tokens.IssueAsync(MobileApps.SiteAssessor, userKey, answer.ZedId, ct);
        log.LogInformation("SA app login for {UserId} on {ZedId}", userKey, request.zedId);
        return LegacyJson(response);
    });

    /// <summary>
    /// V4: an assessor signs in to the SA app on one phone only (<c>Mobile:SaOnePhone</c>, on unless set to false): a
    /// sign-in from another phone than the one registered (the phone signed in from last) is refused until the Admin
    /// releases it (Admin → assessor → Registered mobile). The refusal is recorded as a device event and, by
    /// <see cref="LoginAuditAttribute"/>, in the sign-in log with the phone's make, model, OS, app version and IP.
    /// </summary>
    private async Task<string?> OtherPhoneAsync(string userKey, DeviceInfo? device, CancellationToken ct)
    {
        if (!config.GetValue("Mobile:SaOnePhone", true)) return null;
        var deviceId = device?.deviceId?.Trim();
        if (string.IsNullOrEmpty(deviceId)) return DeviceInfoMissing;
        if (await devices.RegisteredAsync(MobileApps.SiteAssessor, userKey, ct) is not { } registered
            || string.Equals(registered.DeviceId, deviceId, StringComparison.Ordinal)) return null;
        log.LogWarning("SA sign-in of {UserId} refused: registered on device {Registered}, tried {Device}", userKey, registered.DeviceId, deviceId);
        await devices.RecordAsync(MobileApps.SiteAssessor, userKey, deviceId, Request.Path, ClientIp, DeviceCheck.Unknown, refused: true, ct);
        return OtherPhone(registered.Model);
    }

    /// <summary>Registers the phone (make, model, OS, IP) and, with the one-phone rule, forgets the assessor's other phones.</summary>
    private async Task RegisterPhoneAsync(string userKey, DeviceInfo? device, CancellationToken ct)
    {
        await devices.RememberAsync(MobileApps.SiteAssessor, userKey, device, ClientIp, ct);
        if (config.GetValue("Mobile:SaOnePhone", true) && device?.deviceId?.Trim() is { Length: > 0 } id)
            await devices.KeepOnlyAsync(MobileApps.SiteAssessor, userKey, id, ct);
    }

    public const string DeviceInfoMissing = "Device information missing. Please update the ZED SA app.";

    public static string OtherPhone(string? model) =>
        $"Your account is registered on another mobile{(string.IsNullOrWhiteSpace(model) ? "" : $" ({model.Trim()})")}. Please ask the ZED Admin to release it to sign in on this mobile.";

    /// <summary>A refused sign-in: <c>status</c> "2" (update the app) or "0", and the text the app shows.</summary>
    private sealed record SignInRefusal(string Status, string Message);

    /// <summary>The checks of a sign-in passed: the procedure's result sets (set 0 the Users row) and the assessor's user id.</summary>
    private sealed record SignInCheck(SignInRefusal? Refusal, IDictionary<string, object?>? User, ResultSets? Sets, string? UserKey);

    /// <summary>
    /// The checks every sign-in of the app makes (<see cref="Login"/> for one unit, <see cref="SignIn"/> without one): the
    /// version gate, the per-assessor throttle, the password (PasswordStore; the procedure family has hard-coded master
    /// passwords, so the typed password must equal the row's own) and the Users row SP_APP_SA_CHECK_LOGIN answers in set 0
    /// (RoleId 3, SiteVerification 1, active). <paramref name="zedId"/> is passed to the procedure as it was; without one its
    /// unit sets are empty.
    /// </summary>
    private async Task<SignInCheck> CheckSignInAsync(string? typedAssessorId, string? password, string? version, string? zedId, CancellationToken ct)
    {
        static SignInCheck Refuse(string status, string message) => new(new SignInRefusal(status, message), null, null, null);

        if (config.GetValue<bool>("Mobile:CheckSaVersion") &&
            !string.Equals(config["Mobile:SaVersion"] ?? "", version, StringComparison.Ordinal))
            return Refuse("2", UpdateAppMessage);

        var assessorId = typedAssessorId?.Trim();
        if (string.IsNullOrEmpty(assessorId) || string.IsNullOrEmpty(password)) return Refuse("0", InvalidCredentials);
        if (throttle.IsLocked(assessorId)) return Refuse("0", TooManyAttempts);

        var passwords = PasswordStore.For(db, HttpContext.RequestServices);
        var login = await passwords.BeginLoginAsync(assessorId, password, ct);
        var sets = await db.QueryProcMultipleAsync("SP_APP_SA_CHECK_LOGIN",
            new { ZedId = zedId, UserId = assessorId, Password = login.ProcedurePassword }, ct);

        // Set 0 is the Users row (RoleId 3, SiteVerification 1, active). The procedure family has
        // hard-coded master passwords, so the typed password must equal the row's own.
        var user = sets.Count > 0 ? sets[0].FirstOrDefault() : null;
        var masterPassword = user is not null && !await passwords.CompleteLoginAsync(login, user, ct);
        if (user is null || masterPassword || user.Text("RoleId") != "3")
        {
            if (masterPassword) log.LogWarning("Blocked SA app login with a procedure master password for {UserId}", assessorId);
            throttle.Failed(assessorId);
            return Refuse("0", InvalidCredentials);
        }
        throttle.Succeeded(assessorId);
        return new SignInCheck(null, user, sets, user.Text("UserId") is { Length: > 0 } id ? id : assessorId);
    }

    /// <summary>The unit's answer of <see cref="Login"/>, or the text it is refused with; <c>ZedId</c> is the unit the token names.</summary>
    private sealed record UnitAnswer(AssessmentDetails? Response, string? Refusal, string? ZedId);

    /// <summary>
    /// The unit's part of SP_APP_SA_CHECK_LOGIN (sets 1 to 8) as the app reads it, shared by <see cref="Login"/> and
    /// <see cref="Assessment"/>: "not allocated" when set 1 is empty (the procedure answers it only for the unit's lead or
    /// co-assessor), "closed" from the closing meeting on (status 13).
    /// </summary>
    private async Task<UnitAnswer> UnitAnswerAsync(ResultSets sets, string? requestedZedId, CancellationToken ct)
    {
        // Set 1 only has a row when this assessor is the lead or co-assessor of the unit.
        if (sets[1].Count == 0) return new UnitAnswer(null, NotAllocated + requestedZedId, null);
        var unit = sets[1][0];
        if (unit.Int("CertificationStatus") >= 13) return new UnitAnswer(null, LoginClosed + requestedZedId, null);

        var flags = sets.FirstRow(8);
        var response = new AssessmentDetails
        {
            status = "1",
            userType = unit.Int("UserType"),
            certificationType = unit.Text("CertificationType"),
            isSelfieSubmitted = flags.Bool("SelfieSubmitted"),
            isOpenMeetingSubmitted = flags.Bool("OpenMeetingSubmitted"),
            allowFinalSubmit = flags.Bool("AllowFinalSubmitManual"),
            isSurveillance = unit.Bool("IsSurveillance"),
            minimumParameters = unit.Int("MinimumParameters"),
            companyProfile = new MSMEProfile
            {
                saDate = unit.Text("AssessmentDate"),
                zedId = unit.Text("ZedId"),
                msmeName = unit.Text("EnterpriseName"),
                sectorName = unit.Text("Sector"),
                unitAddress = unit.Text("UnitAddress"),
                email = unit.Text("Email"),
                phone = unit.Text("PhoneNumber"),
            },
            basicInformation = new BasicInformation
            {
                auditsConducted = unit.Text("AuditsConducted"),
                domesticCustomers = unit.Text("DomesticCustomers"),
                internationalCustomers = unit.Text("InternationalCustomers"),
                rawMaterialImported = unit.Text("RawMaterialImported"),
                outsourcedProcesses = unit.Text("OutsourcedProcesses"),
                productDetailsList = sets[3].Select(r => new ProductDetails
                {
                    productId = r.Int("Id"),
                    productName = r.Text("ProductName"),
                    exported = r.Text("Exported"),
                }).ToList(),
                rawMaterialsList = sets[4].Select(r => new RawMaterialDetails
                {
                    rawMaterialId = r.Int("Id"),
                    rawMaterialName = r.Text("RawMaterialName"),
                    rawMaterialPercentage = r.Text("RawMaterialPercentage"),
                    countryName = r.Text("CountryName"),
                }).ToList(),
                energySources = unit.Text("EnergySources").Split(',').ToList(),
            },
            assessors = Assessors(unit),
        };

        if (unit.Text("CertificationStatus") == "8")
        {
            // Lead assessor still has to allot the parameters.
            response.inputParameters = sets[2].Select(r => new ParametersDetails
            {
                parameterId = r.Text("SectionId"),
                parameterName = r.Text("SectionName"),
                parameterType = "Mandatory",
                parameterCode = r.Text("SectionCode"),
                isExcemptedFromSa = r.Text("IsAssessmentExcempted") == "Yes",
            }).ToList();
        }
        else
        {
            response.allottedParameters = sets[2].Select(r => new AllottedParameters
            {
                Id = r.Text("Id"),
                parameterId = r.Text("SectionId"),
                parameterName = r.Text("SectionName"),
                parameterType = "Mandatory",
                parameterCode = r.Text("SectionCode"),
            }).ToList();
            foreach (var element in response.allottedParameters)
            {
                element.requirements = sets[5].Where(r => Same(r.Text("SectionCode"), element.parameterCode)).Select(r =>
                {
                    var requirement = new RequirementDetails
                    {
                        id = r.Int("Id"),
                        code = r.Text("RequirementCode"),
                        assessorRemarks = r.Text("AssessorRemarks"),
                        evidences = [],
                    };
                    requirement.options = sets[6]
                        .Where(o => Same(o.Text("SectionCode"), element.parameterCode) && Same(o.Text("RequirementCode"), requirement.code))
                        .Select(o =>
                        {
                            var option = new OptionInfo { id = o.Int("Id"), code = o.Text("OptionCode"), label = o.Text("OptionName") };
                            option.subOptions = sets[7]
                                .Where(s => Same(s.Text("SectionCode"), element.parameterCode) &&
                                            Same(s.Text("RequirementCode"), requirement.code) && Same(s.Text("OptionCode"), option.code))
                                .Select(s => new SubOption { id = s.Int("Id"), code = s.Text("SubOptionCode"), label = s.Text("SubOptionName") })
                                .ToList();
                            return option;
                        }).ToList();
                    return requirement;
                }).ToList();
            }
        }

        // V4: the NIC sector's name with its code (the procedure answers the code only); the apps show "25. Name".
        if (response.companyProfile.sectorName is { Length: > 0 } sectorCode && sectorCode.Trim().All(char.IsAsciiDigit)
            && (await db.QuerySqlAsync<string?>(SectorNameSql, new { Code = new DbString { Value = sectorCode.Trim(), IsAnsi = true, Length = 50 } }, ct))
                .FirstOrDefault() is { Length: > 0 } sectorName)
        {
            response.companyProfile.sectorId = sectorCode.Trim();
            response.companyProfile.sectorName = sectorName.Trim();
        }

        var zedId = unit.Text("ZedId") is { Length: > 0 } z ? z : requestedZedId;
        if (response.allottedParameters is not null)
        {
            await AttachCheckpointsAsync(response.allottedParameters, zedId, response.certificationType, ct);
            await AttachListedEvidencesAsync(response.allottedParameters, zedId, response.certificationType, ct);
        }
        if (!string.IsNullOrEmpty(zedId) && !string.IsNullOrEmpty(response.certificationType))
        {
            // V4: the unit's site tour sections and the team's photos of each (redesigned app; older apps ignore them).
            var sections = await UnitSiteTourSectionsAsync(zedId, response.certificationType, ct);
            var counts = SiteTourSections.Count(sections, (await SiteTourSections.PhotosAsync(db, zedId, response.certificationType, ct)).Select(r => (r.PhotoId, r.Name)));
            response.siteTourSections = sections.Select((t, i) => SiteTourSectionInfo.Of(t, i + 1, counts[t.Id])).ToList();
        }
        return new UnitAnswer(response, null, zedId);
    }

    /// <summary>
    /// V4: the checkpoints of the unit's requirements (migration 0039) on their options, so the app answers Yes / Partial / No
    /// per checkpoint as the web does (CheckpointAnswers). A database before 0039 has none: the options stay plain.
    /// </summary>
    private async Task AttachCheckpointsAsync(List<AllottedParameters>? parameters, string? zedId, string? level, CancellationToken ct)
    {
        if (parameters is null || string.IsNullOrWhiteSpace(zedId) || string.IsNullOrWhiteSpace(level)) return;
        var checkpoints = await CheckpointAnswers.LoadAsync(db, zedId, level, null, "dbo", log, ct);
        if (checkpoints.Count == 0) return;
        foreach (var r in parameters.SelectMany(p => p.requirements ?? []))
        {
            var mine = checkpoints.Where(c => c.RequirementId == r.id).ToList();
            foreach (var o in r.options ?? [])
            {
                var c = mine.FirstOrDefault(x => x.Id == o.id) ?? mine.FirstOrDefault(x => Same(x.OptionCode, o.code));
                if (c is null) continue;
                o.checkpoint = new CheckpointInfo
                {
                    actions = [.. c.Actions],
                    evidences = c.Evidences.Select(e => new CheckpointEvidenceInfo { name = e.Name, mandatory = e.Mandatory, uploaded = e.Uploaded, verified = e.Verified }).ToList(),
                    desktopAnswer = c.Desktop?.Value,
                    siteAnswer = c.Site?.Value,
                    siteActions = c.Site is { Actions.Count: > 0 } s ? [.. s.Actions] : null,
                    siteRemarks = c.Site?.Remarks,
                };
            }
        }
    }

    /// <summary>V4: the evidences the Admin lists for each requirement, with the site's earlier answers (<see cref="SiteEvidenceChecks"/>).</summary>
    private async Task AttachListedEvidencesAsync(List<AllottedParameters> parameters, string? zedId, string? level, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(zedId) || string.IsNullOrWhiteSpace(level)) return;
        var listed = await SiteEvidenceChecks.LoadAsync(db, zedId, level, "dbo", log, ct);
        if (listed.Count == 0) return;
        foreach (var r in parameters.SelectMany(p => p.requirements ?? []))
        {
            var mine = listed.Where(e => e.RequirementId == r.id).ToList();
            if (mine.Count > 0)
                r.listedEvidences = mine.Select(e => new ListedEvidenceInfo
                {
                    id = e.Id, name = e.Name, mandatory = e.Mandatory, checkpoint = e.Checkpoint, uploaded = e.Uploaded, verified = e.Verified,
                    available = e.Available, photoIds = [.. e.PhotoIds],
                }).ToList();
        }
    }

    private static List<AssessorDetails> Assessors(IDictionary<string, object?> unit)
    {
        var list = new List<AssessorDetails>
        {
            new() { assessorId = unit.Text("LeadAssessorId"), assessorName = unit.Text("LeadAssessorName"), userType = "1" },
        };
        if (unit.TryGetValue("CoAssessorId", out var co) && co is not null and not DBNull)
            list.Add(new AssessorDetails { assessorId = unit.Text("CoAssessorId"), assessorName = unit.Text("CoAssessorName"), userType = "2" });
        return list;
    }

    // ------------------------------------------------------------------ Writes from the app

    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId")]
    public Task<IActionResult> SubmitAllocation(SubmitAllocationRequest request, CancellationToken ct) => Guarded(nameof(SubmitAllocation), async () =>
    {
        // Only the lead assessor allots parameters, and only to the unit's lead or co-assessor.
        var allotments = await AllotmentsAsync(request.zedId, request.certificationType, ct);
        if (!allotments.Any(a => Same(a.SiteAssessorId, request.saId)))
            return NotAllotted(nameof(SubmitAllocation), request.saId, request.zedId);

        var list = Table("Id", "SectionId", "SectionCode", "AssessorId");
        foreach (var p in request.allocatedParameters ?? [])
        {
            if (string.IsNullOrEmpty(p.assigneeId)) continue;
            if (!allotments.Any(a => Same(a.SiteAssessorId, p.assigneeId) || Same(a.CoAssessorId, p.assigneeId)))
                return NotAllotted(nameof(SubmitAllocation), p.assigneeId, request.zedId);
            AddRow(list, "0", p.parameterId, p.parameterCode, p.assigneeId);
        }
        if (list.Rows.Count == 0) return EmptyList(nameof(SubmitAllocation));

        var args = new DynamicParameters();
        args.Add("ZedId", request.zedId);
        args.Add("CertificationType", request.certificationType);
        args.Add("AllotList", list.AsTableValuedParameter("DynamicSectionAllot"));
        return LegacyJson(await ExecAsync("SP_APP_SA_ALLOT_SECTIONS_TO_COASSESSOR", args, ct));
    });

    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId")]
    public Task<IActionResult> SubmitSelfie(SubmitSelfieImageRequest request, CancellationToken ct) => Guarded(nameof(SubmitSelfie), async () =>
    {
        RequireCertification(request.certificationType);
        if (!await IsAllottedAsync(request.saId, request.zedId, request.certificationType, Role.LeadOrCo, ct))
            return NotAllotted(nameof(SubmitSelfie), request.saId, request.zedId);

        var st = await CheckSaStatusAsync(request.zedId, request.certificationType, request.saId, ct);
        if (st.ClosingMeetingSubmitted) return Fail(Closed + request.zedId);
        if (!st.OpenMeetingSubmitted) return Fail(OpenNotSubmitted + request.zedId);
        if (request.selfieImage is not { } selfie) return Fail(ErrorText);

        var photos = PhotoTable();
        if (!string.IsNullOrEmpty(selfie.photo))
        {
            var folder = storage.Folder("SaPhotos", request.zedId, request.certificationType);
            await storage.SaveBase64Async(selfie.photo, folder, MobileStorage.FileName(request.saId, ".jpg"), ct);
            AddPhoto(photos, selfie.photoId, selfie.name, selfie.timeStamp, selfie.latitude, selfie.longitude);
        }
        return LegacyJson(await SavePhotosAsync(nameof(SubmitSelfie), request.saId, request.zedId, request.certificationType, "Selfie", photos, ct));
    });

    /// <summary>
    /// Daily attendance of the site assessor app (punch in / punch out): the selfie is the multipart part <c>files</c>, its
    /// details the JSON text in <c>selfieMetadata</c>. SP_APP_SA_INSERT_DAILY_ATTENDANCE (ZEDCS_V2_LIVE) records it. The
    /// app calls SA/SubmitAttendance on the main services (app source, ZED_SA_Studio); the services source we were given
    /// has no such action although the procedure exists, so this follows the consultancy app's action: the lead or
    /// co-assessor allotted to the unit only, the photo stored as Attendance/{zed}/{cert}/{photoId}.jpg, the procedure's
    /// Status / Message answered as status / errorMessage.
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId")]
    public Task<IActionResult> SubmitAttendance(SubmitAttendanceRequest request, IFormFile? files, CancellationToken ct) => Guarded(nameof(SubmitAttendance), async () =>
    {
        RequireCertification(request.certificationType);
        if (!await IsAllottedAsync(request.saId, request.zedId, request.certificationType, Role.LeadOrCo, ct))
            return NotAllotted(nameof(SubmitAttendance), request.saId, request.zedId);
        if (files is null || files.Length <= 0) return Fail("Assessor selfie data not found.");
        if (request.attendanceType?.Length > 50 || request.comments?.Length > 4000) return Fail("Invalid Data.");

        PhotoInformation? selfie = null;
        try
        {
            if (!string.IsNullOrWhiteSpace(request.selfieMetadata))
                selfie = System.Text.Json.JsonSerializer.Deserialize<PhotoInformation>(request.selfieMetadata, Zed.Core.Mobile.LegacyJson.Read);
        }
        catch (System.Text.Json.JsonException)
        {
            selfie = null;
        }
        if (selfie is null || string.IsNullOrWhiteSpace(selfie.photoId)) return Fail(ErrorText);

        var folder = storage.Folder("Attendance", request.zedId, request.certificationType);
        await storage.SaveAsync(files, folder, MobileStorage.FileName(selfie.photoId, ".jpg"), ct);

        ResultSets sets;
        try
        {
            sets = await db.QueryProcMultipleAsync("SP_APP_SA_INSERT_DAILY_ATTENDANCE", new
            {
                RefId = DateTime.Now.ToString("yyyyMMddHHmmss", System.Globalization.CultureInfo.InvariantCulture),
                ZedId = request.zedId,
                AssessorId = request.saId,
                CertificationType = request.certificationType,
                AttendanceType = request.attendanceType,
                Comments = request.comments,
                PhotoId = selfie.photoId,
                Latitude = selfie.latitude,
                Longitude = selfie.longitude,
                TimeStamp = selfie.timeStamp,
            }, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "SP_APP_SA_INSERT_DAILY_ATTENDANCE failed for {ZedId}", request.zedId);
            return Fail(ErrorText);
        }
        // One row: Status, Message.
        if (sets.Count == 0 || sets[0].Count == 0) return Fail(ErrorText);
        var values = sets[0][0].Values.ToList();
        return LegacyJson(new ServiceResponse
        {
            status = values.Count > 0 ? Convert.ToString(values[0], System.Globalization.CultureInfo.InvariantCulture) : null,
            errorMessage = values.Count > 1 ? Convert.ToString(values[1], System.Globalization.CultureInfo.InvariantCulture) : null,
        });
    });

    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId")]
    public Task<IActionResult> SubmitSiteTour(SubmitSiteTourRequest request, CancellationToken ct) => Guarded(nameof(SubmitSiteTour), async () =>
    {
        RequireCertification(request.certificationType);
        if (!await IsAllottedAsync(request.saId, request.zedId, request.certificationType, Role.LeadOrCo, ct))
            return NotAllotted(nameof(SubmitSiteTour), request.saId, request.zedId);

        var st = await CheckSaStatusAsync(request.zedId, request.certificationType, request.saId, ct);
        if (st.ClosingMeetingSubmitted) return Fail(Closed + request.zedId);
        if (!st.OpenMeetingSubmitted) return Fail(OpenNotSubmitted + request.zedId);

        // V4 (redesigned app): a photo may name its site tour section (Admin → Site Tour Sections, the unit's level and NIC
        // sector); the name stored (SaPhotos.Name, which the web's site review and remote assessment pages show) is then
        // "3. Production / Machine Shop - remark", cut to 200 characters. Without one, the comment as before. A section takes
        // at most its maximum of photos, the team's photos already stored included.
        var sections = await UnitSiteTourSectionsAsync(request.zedId!, request.certificationType!, ct);
        var sent = (request.siteTourPhotos ?? []).Where(p => !string.IsNullOrEmpty(p.photo)).ToList();
        foreach (var p in sent)
            if (!string.IsNullOrWhiteSpace(p.section) && SiteTourSections.Find(sections, p.section) is null)
                return Fail(UnknownSiteTourSection);
        if (sent.Any(p => !string.IsNullOrWhiteSpace(p.section)))
        {
            var resent = sent.Select(p => p.photoId).ToHashSet(StringComparer.Ordinal);
            var stored = (await SiteTourSections.PhotosAsync(db, request.zedId!, request.certificationType!, ct)).Where(r => !resent.Contains(r.PhotoId ?? ""));
            var counts = SiteTourSections.Count(sections, stored.Select(r => (r.PhotoId, r.Name)));
            foreach (var p in sent)
                if (SiteTourSections.Find(sections, p.section) is { } section) counts[section.Id]++;
            if (sections.FirstOrDefault(t => counts[t.Id] > t.Max) is { } over)
            {
                log.LogInformation("SA/SubmitSiteTour: {ZedId} section {Section} over its maximum of {Max}", request.zedId, over.Id, over.Max);
                return Fail(TooManySiteTourPhotos(over));
            }
        }

        var photos = PhotoTable();
        foreach (var p in request.siteTourPhotos ?? [])
        {
            if (string.IsNullOrEmpty(p.photo)) continue;
            var folder = storage.Folder("SaPhotos", request.zedId, request.certificationType, "SiteTour");
            await storage.SaveBase64Async(p.photo, folder, MobileStorage.FileName(p.photoId, ".jpg"), ct);
            var name = SiteTourSections.Find(sections, p.section) is { } section
                ? SiteTourSections.Name(SiteTourSections.Label(sections, section), p.comment) : p.comment;
            AddPhoto(photos, p.photoId, name, p.timeStamp, p.latitude, p.longitude);
        }
        return LegacyJson(await SavePhotosAsync(nameof(SubmitSiteTour), request.saId, request.zedId, request.certificationType, "SiteTour", photos, ct));
    });

    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId")]
    public Task<IActionResult> SubmitParameter(SubmitParameterRequest request, CancellationToken ct) => Guarded(nameof(SubmitParameter), async () =>
    {
        if (!await IsAllottedAsync(request.saId, request.zedId, request.certificationType, Role.LeadOrCo, ct))
            return NotAllotted(nameof(SubmitParameter), request.saId, request.zedId);

        var st = await CheckSaStatusAsync(request.zedId, request.certificationType, request.saId, ct);
        if (st.ClosingMeetingSubmitted) return Fail(Closed + request.zedId);
        if (!st.OpenMeetingSubmitted) return Fail(OpenNotSubmitted + request.zedId);
        if (request.allottedParameterObj is not { requirements: { } requirements } parameter) return Fail(ErrorText);

        // V4: a requirement with checkpoints is answered checkpoint by checkpoint, with the web's rules (CheckpointAnswers);
        // its conformance and remarks follow from the answers, not from the app's Yes / No.
        var checkpoints = await CheckpointAnswers.LoadAsync(db, request.zedId ?? "", request.certificationType ?? "", null, "dbo", log, ct);
        var decisions = new Dictionary<int, CheckpointAnswers.Decision>();
        foreach (var r in requirements)
        {
            var mine = checkpoints.Where(c => c.RequirementId == r.id).ToList();
            if (mine.Count == 0) continue;
            if (r.checkpointAnswers is not { Count: > 0 } answers)
            {
                log.LogWarning("SA app {SaId} sent requirement {Id} of {ZedId} without its checkpoint answers (old app)", request.saId, r.id, request.zedId);
                return Fail(CheckpointsNeedUpdate);
            }
            var (decision, problem) = CheckpointAnswers.Decide(mine,
                new CheckpointAnswers.SaveRequest(answers.Select(a => new CheckpointAnswers.AnswerRequest(a.id, a.answer, a.actions, a.remarks)).ToList(), r.comments),
                CheckpointAnswers.Stage.Site);
            if (decision is null) return Fail($"{r.code}: {problem}");
            decisions[r.id] = decision;
        }

        // V4: each evidence the Admin lists for a requirement is answered at the site (Yes with its photo, or No); a No keeps
        // the requirement from conforming (SiteEvidenceChecks).
        var listed = await SiteEvidenceChecks.LoadAsync(db, request.zedId ?? "", request.certificationType ?? "", "dbo", log, ct);
        var checked_ = new List<(IReadOnlyList<SiteEvidenceChecks.Listed> Listed, List<SiteEvidenceChecks.Check> Checks)>();
        foreach (var r in requirements)
        {
            var mine = listed.Where(e => e.RequirementId == r.id).ToList();
            if (mine.Count == 0) continue;
            if (r.evidenceChecks is null)
            {
                log.LogWarning("SA app {SaId} sent requirement {Id} of {ZedId} without its evidence checks (old app)", request.saId, r.id, request.zedId);
                return Fail(EvidenceNeedUpdate);
            }
            var checks = r.evidenceChecks.Select(x => new SiteEvidenceChecks.Check(x.id, x.available, x.photoIds)).ToList();
            var decided = decisions.GetValueOrDefault(r.id);
            var yes = decided is null ? [] : decided.Answers.Where(a => a.Answer.Value == CheckpointAnswers.Yes).Select(a => a.Checkpoint.OptionCode).ToList();
            var photoIds = (r.addedEvidences ?? []).Select(p => p.photoId?.Trim() ?? "").Where(p => p.Length > 0).ToList();
            if (SiteEvidenceChecks.Problem(mine, checks, photoIds, yes, decided?.Conformance ?? r.conformance) is { } evidenceProblem)
                return Fail($"{r.code}: {evidenceProblem}");
            checked_.Add((mine, checks));
        }

        var reqs = Table("RequirementId", "RequirementCode", "Conformance", "AssessorRemarks");
        var photos = PhotoTable();
        foreach (var r in requirements)
        {
            var decided = decisions.GetValueOrDefault(r.id);
            AddRow(reqs, r.id.ToString(System.Globalization.CultureInfo.InvariantCulture), r.code ?? "",
                decided?.Conformance ?? r.conformance, decided is null ? r.comments ?? "" : decided.Remarks ?? "");
            foreach (var p in r.addedEvidences ?? [])
            {
                // Evidence photos were uploaded by SubmitEvidences; here only their ids are linked.
                if (!string.IsNullOrEmpty(p.photoId))
                    AddPhoto(photos, p.photoId, p.name, p.timeStamp, p.latitude, p.longitude,
                        r.id.ToString(System.Globalization.CultureInfo.InvariantCulture));
            }
        }
        if (reqs.Rows.Count == 0) return EmptyList(nameof(SubmitParameter));

        var args = new DynamicParameters();
        args.Add("ZedId", request.zedId);
        args.Add("AssessorId", request.saId);
        args.Add("CertificationType", request.certificationType);
        args.Add("ParameterId", parameter.parameterId);
        args.Add("ParameterCode", parameter.parameterCode);
        args.Add("PhotoType", "Parameters");
        args.Add("RequirementsList", reqs.AsTableValuedParameter("DynamicRequirementsList"));
        if (photos.Rows.Count > 0) args.Add("PhotoList", photos.AsTableValuedParameter("DynamicPhotoList2"));
        var result = await ExecAsync("SP_APP_SA_SAVE_PARAMETER", args, ct);
        if (result.status == "1")
        {
            foreach (var decision in decisions.Values)
                await CheckpointAnswers.SaveAsync(db, request.zedId!, request.certificationType!, CheckpointAnswers.Stage.Site, decision, request.saId ?? "", ct);
            foreach (var (mine, checks) in checked_)
                await SiteEvidenceChecks.SaveAsync(db, request.zedId!, mine, checks, request.saId ?? "", ct);
        }
        return LegacyJson(result);
    });

    /// <summary>The NIC 2-digit sector's name (dbo.Sectors, the sector master).</summary>
    public const string SectorNameSql = "SELECT TOP (1) SectorName FROM dbo.Sectors WHERE LTRIM(RTRIM(SectorCode)) = @Code;";

    /// <summary>SA/SubmitParameter: a requirement with listed evidences sent without their checks (an older app).</summary>
    public const string EvidenceNeedUpdate = "Please update the ZED SA app to answer the evidences listed for this requirement.";

    /// <summary>SA/SubmitSiteTour: a photo's section is not one of the unit's (<see cref="SiteTourSections"/>).</summary>
    /// 2026-11-08: worded for the usual cause, a section the Admin changed after the app read the sections.
    public const string UnknownSiteTourSection =
        "This site tour section has been changed. Please open the assessment again (sign in again if needed), choose the section and send the photo again.";

    /// <summary>SA/SubmitSiteTour: the section would have more photos than its maximum.</summary>
    public static string TooManySiteTourPhotos(SiteTourSection s) =>
        $"Site Tour: \"{s.Title}\" takes at most {s.Max} photo{(s.Max == 1 ? "" : "s")}. Please remove the extra photos.";

    /// <summary>The site tour sections asked of the unit (Admin → Site Tour Sections; its level and NIC sector).</summary>
    private async Task<IReadOnlyList<SiteTourSection>> UnitSiteTourSectionsAsync(string zedId, string certificationType, CancellationToken ct) =>
        SiteTourSections.For(await SiteTourSections.LoadAsync(settings, ct), await AppFormUnit.ForAsync(db, zedId.Trim(), certificationType, ct));

    /// <summary>An app without checkpoint answers (before V4) for a requirement that has checkpoints.</summary>
    internal const string CheckpointsNeedUpdate =
        "Please update the ZED SA app to answer this requirement checkpoint by checkpoint.";

    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId")]
    public Task<IActionResult> SubmitOfiComments(SubmitOfiCommentsRequest request, CancellationToken ct) => Guarded(nameof(SubmitOfiComments), async () =>
    {
        if (!await IsAllottedAsync(request.saId, request.zedId, request.certificationType, Role.LeadOrCo, ct))
            return NotAllotted(nameof(SubmitOfiComments), request.saId, request.zedId);

        var st = await CheckSaStatusAsync(request.zedId, request.certificationType, request.saId, ct);
        if (st.ClosingMeetingSubmitted) return Fail(Closed + request.zedId);
        if (!st.OpenMeetingSubmitted) return Fail(OpenNotSubmitted + request.zedId);

        return LegacyJson(await ExecAsync("SP_APP_SA_SAVE_OFI_COMMENTS", new
        {
            ZedId = request.zedId,
            AssessorId = request.saId,
            CertificationType = request.certificationType,
            ParameterId = request.parameterId,
            ParameterCode = request.parameterCode,
            OfiComments = request.ofiComments,
        }, ct));
    });

    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId")]
    public Task<IActionResult> SubmitStartAssessment(SubmitAssessmentRequest request, CancellationToken ct) => Guarded(nameof(SubmitStartAssessment), async () =>
    {
        RequireCertification(request.certificationType);
        if (!await IsAllottedAsync(request.saId, request.zedId, request.certificationType, Role.LeadOrCo, ct))
            return NotAllotted(nameof(SubmitStartAssessment), request.saId, request.zedId);

        var st = await CheckSaStatusAsync(request.zedId, request.certificationType, request.saId, ct);
        if (st.ClosingMeetingSubmitted) return Fail(Closed + request.zedId);
        if (st.OpenMeetingSubmitted) return Fail(OpenSubmitted + request.zedId);

        var participants = Participants(request.startParticipants);
        var photos = await SaveMeetingPhotosAsync(request, ct);
        return LegacyJson(await SaveMeetingAsync(request, participants, photos, "Open Meeting", request.inputComment, ct));
    });

    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId")]
    public Task<IActionResult> SubmitEndAssessment(SubmitAssessmentRequest request, CancellationToken ct) => Guarded(nameof(SubmitEndAssessment), async () =>
    {
        RequireCertification(request.certificationType);
        // userType 2 (co-assessor) records its final submit; anything else is the lead's closing
        // meeting, which completes the SA (status 13), so the role sent must be the real one.
        var coAssessor = request.userType == 2;
        if (!await IsAllottedAsync(request.saId, request.zedId, request.certificationType, coAssessor ? Role.Co : Role.Lead, ct))
            return NotAllotted(nameof(SubmitEndAssessment), request.saId, request.zedId);

        var st = await CheckSaStatusAsync(request.zedId, request.certificationType, request.saId, ct);
        if (coAssessor)
        {
            if (st.ClosingMeetingSubmitted) return Fail(Closed + request.zedId);
            if (!st.OpenMeetingSubmitted) return Fail(OpenNotSubmitted + request.zedId);
            if (st.FinalSubmissionDone) return Fail("MSME SA Final Submission done for the ZEDID: " + request.zedId);
            if (!st.AllParametersSyncedByCo) return Fail(NotSynced + request.zedId);
            return LegacyJson(await SaveMeetingAsync(request, null, null, "Final Submit", request.endComment, ct));
        }

        if (st.ClosingMeetingSubmitted) return Fail(Closed + request.zedId);
        if (!st.OpenMeetingSubmitted) return Fail(OpenNotSubmitted + request.zedId);
        if (!st.AllParametersSyncedByLead) return Fail(NotSynced + request.zedId);
        if (!st.AllParametersSyncedByCo) return Fail(NotSynced + request.zedId);
        if (!st.FinalSubmissionDone) return Fail("Final submissions not synced yet by Assessors for the ZEDID: " + request.zedId);

        // V4: every site tour section of the unit has its minimum of photos (the team's, as stored).
        var sections = await UnitSiteTourSectionsAsync(request.zedId!, request.certificationType!, ct);
        var counts = SiteTourSections.Count(sections, (await SiteTourSections.PhotosAsync(db, request.zedId!, request.certificationType!, ct)).Select(r => (r.PhotoId, r.Name)));
        if (SiteTourSections.Shortfall(sections, counts) is { } shortfall) return Fail(shortfall);

        var participants = Participants(request.endParticipants);
        var photos = await SaveMeetingPhotosAsync(request, ct);
        return LegacyJson(await SaveMeetingAsync(request, participants, photos, "Close Meeting", request.endComment, ct));
    });

    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId", "userName")]
    public Task<IActionResult> SubmitBasicInformation(BasicInformationRequest request, CancellationToken ct) => Guarded(nameof(SubmitBasicInformation), async () =>
    {
        if (await CheckNamedAssessorAsync(nameof(SubmitBasicInformation), First(request.saId, request.userName), request.zedId, request.certificationType, ct) is { } refused)
            return refused;
        if (request.basicInformation is not { } info) return Fail("No data found.");

        var st = await CheckSaStatusAsync(request.zedId, request.certificationType, request.saId, ct);
        if (st.ClosingMeetingSubmitted) return Fail(Closed + request.zedId);
        if (!st.OpenMeetingSubmitted) return Fail(OpenNotSubmitted + request.zedId);
        // Admin → App Forms: the Admin's fields (customFields) and, for builds that name the formVersion, the required fields.
        var appForm = await AppFormSubmission.CheckAsync(HttpContext, AppFormCatalogue.AssessorBasicInfo, portal.System,
            request.customFields, request.formVersion, AppFormSubmission.Answers(info), ct, request.zedId, request.certificationType);
        if (appForm.Error is { } formError) return Fail(formError);
        // The old code joined the list without a null check and failed here; it may be left out once the Admin made it optional or hid it.
        if (info.energySources is null)
        {
            if (appForm.Form.IsRequired("energySources")) return Fail(ErrorText);
            info.energySources = [];
        }

        var productPhotos = PhotoTable();
        var descriptionPhotos = PhotoTable();
        var products = Table("ProductName", "Exported", "ProductPhoto", "ProductDescriptionPhoto");
        var rawMaterials = Table("Name", "Percentage", "CountryName");
        foreach (var p in info.productDetailsList ?? [])
        {
            if (p.productPhoto is { } pp)
                AddPhoto(productPhotos, pp.photoId, "Product Photo", pp.timeStamp, pp.latitude, pp.longitude, pp.isPdf ? "pdf" : "jpg");
            if (p.productDescriptionPhoto is { } dp)
                AddPhoto(descriptionPhotos, dp.photoId, "Product Description Photo", dp.timeStamp, dp.latitude, dp.longitude, dp.isPdf ? "pdf" : "jpg");
            var photo = p.productPhoto ?? new PhotoInformation();
            var description = p.productDescriptionPhoto ?? new PhotoInformation();
            AddRow(products, p.productName, p.exported,
                photo.photoId + (photo.isPdf ? ".pdf" : ".jpg"),
                description.photoId + (description.isPdf ? ".pdf" : ".jpg"));
        }
        foreach (var r in info.rawMaterialsList ?? [])
            AddRow(rawMaterials, r.rawMaterialName, r.rawMaterialPercentage, r.countryName);

        var args = new DynamicParameters();
        args.Add("RefId", DateTime.Now.ToString("yyyyMMddHHmmss", System.Globalization.CultureInfo.InvariantCulture));
        args.Add("ZedId", request.zedId);
        args.Add("CertificationType", request.certificationType);
        args.Add("AuditsConducted", info.auditsConducted);
        args.Add("DomesticCustomers", info.domesticCustomers);
        args.Add("InternationalCustomers", info.internationalCustomers);
        args.Add("RawMaterialImported", info.rawMaterialImported);
        args.Add("OutsourcedProcesses", info.outsourcedProcesses);
        args.Add("EnergySources", string.Join(",", info.energySources));
        args.Add("ManufacturingCapacityUnits", info.monthlyManufacturingCapacityUnits);
        args.Add("ManufacturingCapacityValue", info.monthlyManufacturingCapacityValue);
        args.Add("MonthlyUtilizationUnits", info.monthlyUtilizationUnits);
        args.Add("MonthlyUtilizationValue", info.monthlyUtilizationValue);
        // The old code sent each photo list only when the *other* list had rows, and an empty list
        // made SqlClient throw; so exactly one empty photo list failed the call. Kept as it was, unless the Admin made the
        // missing photo optional or hid it: then only the list with rows is sent (an omitted table parameter is empty).
        if ((productPhotos.Rows.Count > 0) != (descriptionPhotos.Rows.Count > 0) &&
            appForm.Form.IsRequired(productPhotos.Rows.Count == 0 ? "productDetailsList/productPhoto" : "productDetailsList/productDescriptionPhoto"))
            return EmptyList(nameof(SubmitBasicInformation));
        if (descriptionPhotos.Rows.Count > 0) args.Add("ProductDescriptionPhotos", descriptionPhotos.AsTableValuedParameter("DynamicPhotoList2"));
        if (productPhotos.Rows.Count > 0) args.Add("ProductPhotos", productPhotos.AsTableValuedParameter("DynamicPhotoList2"));
        if (products.Rows.Count > 0) args.Add("ProductList", products.AsTableValuedParameter("ProductDetails2"));
        if (rawMaterials.Rows.Count > 0) args.Add("RawMaterialList", rawMaterials.AsTableValuedParameter("RawMaterial"));
        var result = await ExecAsync("SP_APP_SA_INSERT_BASIC_INFO", args, ct);
        if (result.status == "1" && !await appForm.SaveAsync(request.zedId ?? "", request.certificationType ?? "", First(request.saId, request.userName) ?? "", log, ct))
            result = ServiceResponse.Fail(ErrorText);
        return LegacyJson(result);
    });

    /// <summary>The app names the assessor in saId (the old model read userName, so nothing was checked); either is taken.</summary>
    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId", "userName")]
    public Task<IActionResult> SubmitBasicInfoPhotos(SubmitPhotosRequest request, CancellationToken ct) => Guarded(nameof(SubmitBasicInfoPhotos), async () =>
    {
        RequireCertification(request.certificationType);
        if (await CheckNamedAssessorAsync(nameof(SubmitBasicInfoPhotos), First(request.saId, request.userName), request.zedId, request.certificationType, ct) is { } refused)
            return refused;
        if (request.photos is null) return Fail("No photos found.");

        var st = await CheckSaStatusAsync(request.zedId, request.certificationType, null, ct);
        if (st.ClosingMeetingSubmitted) return Fail(Closed + request.zedId);
        if (!st.OpenMeetingSubmitted) return Fail(OpenNotSubmitted + request.zedId);

        foreach (var p in request.photos)
        {
            if (p?.photo is null) continue;
            var folder = storage.Folder("SaPhotos", request.zedId, request.certificationType, "BasicInfo");
            await storage.SaveBase64Async(p.photo, folder, MobileStorage.FileName(p.photoId, p.isPdf ? ".pdf" : ".jpg"), ct);
        }
        return LegacyJson(new ServiceResponse { status = "1" });
    });

    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId")]
    public Task<IActionResult> SubmitEvidences(SubmitAssessmentRequest request, CancellationToken ct) => Guarded(nameof(SubmitEvidences), async () =>
    {
        RequireCertification(request.certificationType);
        var coAssessor = request.userType == 2;
        if (!await IsAllottedAsync(request.saId, request.zedId, request.certificationType, coAssessor ? Role.Co : Role.LeadOrCo, ct))
            return NotAllotted(nameof(SubmitEvidences), request.saId, request.zedId);

        var st = await CheckSaStatusAsync(request.zedId, request.certificationType, request.saId, ct);
        if (st.ClosingMeetingSubmitted) return Fail(Closed + request.zedId);
        if (!st.OpenMeetingSubmitted) return Fail(OpenNotSubmitted + request.zedId);
        if (coAssessor && st.FinalSubmissionDone) return Fail("MSME SA Final Submit done for the ZEDID: " + request.zedId);

        if (request.addedEvidences is not { Count: > 0 } evidences) return LegacyJson(new ServiceResponse { status = "1" });
        var photos = PhotoTable();
        foreach (var p in evidences)
        {
            if (string.IsNullOrEmpty(p.photo)) continue;
            var folder = storage.Folder("SaPhotos", request.zedId, request.certificationType, "SiteTour");
            await storage.SaveBase64Async(p.photo, folder, MobileStorage.FileName(p.photoId, ".jpg"), ct);
            AddPhoto(photos, p.photoId, p.name, p.timeStamp, p.latitude, p.longitude);
        }
        return LegacyJson(await SavePhotosAsync(nameof(SubmitEvidences), request.saId, request.zedId, request.certificationType, "Evidences", photos, ct));
    });

    // The hotel self-assessment leftovers (GetSiteAssessmentDetails, UpdateSaDeclaration, SubmitSaReg, GetAmounts) were
    // removed before go-live: they acted on SelfAssessments / SaPaymentCases by registration number with no identity, and
    // no app calls them (SECURITY-FINDINGS #49).

    // ------------------------------------------------------------------ Helpers

    /// <summary>The old actions caught every exception and answered {status:"0"} with HTTP 200.</summary>
    private async Task<IActionResult> Guarded(string action, Func<Task<IActionResult>> body)
    {
        try
        {
            return await body();
        }
        catch (Exception ex) when (ex is not UnsafePathException and not OperationCanceledException)
        {
            log.LogError(ex, "SA/{Action} failed", action);
            return Fail(ErrorText);
        }
    }

    private static void RequireCertification(string? certification)
    {
        if (certification is null || !Certifications.Contains(certification.Trim()))
            throw new UnsafePathException($"'{certification}' is not a site assessment certification.");
    }

    private async Task<IReadOnlyList<AssessorAllotment>> AllotmentsAsync(string? zedId, string? certification, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(zedId) || string.IsNullOrWhiteSpace(certification)) return [];
        return await db.QuerySqlAsync<AssessorAllotment>(AllotmentSql, new
        {
            ZedId = new DbString { Value = zedId.Trim(), IsAnsi = true, Length = 50 },
            Certification = new DbString { Value = certification.Trim(), IsAnsi = true, Length = 50 },
        }, ct);
    }

    private async Task<bool> IsAllottedAsync(string? assessorId, string? zedId, string? certification, Role role, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(assessorId)) return false;
        var rows = await AllotmentsAsync(zedId, certification, ct);
        var lead = rows.Any(a => Same(a.SiteAssessorId, assessorId));
        var co = rows.Any(a => Same(a.CoAssessorId, assessorId));
        return role switch { Role.Lead => lead, Role.Co => co, _ => lead || co };
    }

    /// <summary>
    /// For the basic-information calls, whose procedures do not record the assessor: the assessor named in the
    /// request (saId or userName) must be allotted; a request that names none is refused like an unallotted one.
    /// </summary>
    private async Task<IActionResult?> CheckNamedAssessorAsync(string action, string? assessorId, string? zedId, string? certification, CancellationToken ct) =>
        await IsAllottedAsync(assessorId, zedId, certification, Role.LeadOrCo, ct) ? null : NotAllotted(action, assessorId, zedId);

    private IActionResult NotAllotted(string action, string? assessorId, string? zedId)
    {
        log.LogWarning("Refused SA/{Action}: {AssessorId} is not allotted to {ZedId}", action, assessorId, zedId);
        return Fail(NotAllocated + zedId);
    }

    private IActionResult EmptyList(string action)
    {
        // The old code passed an empty SqlDataRecord list here, which SqlClient rejects.
        log.LogInformation("SA/{Action} sent an empty list; refused as the old service did", action);
        return Fail(ErrorText);
    }

    private sealed record SaStatus(bool OpenMeetingSubmitted, bool AllParametersSyncedByLead, bool AllParametersSyncedByCo,
        bool FinalSubmissionDone, bool ClosingMeetingSubmitted);

    private async Task<SaStatus> CheckSaStatusAsync(string? zedId, string? certification, string? assessorId, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_SA_APP_CHECK_STATUS",
            new { ZedId = zedId, Certification = certification, AssessorId = assessorId }, ct);
        var r = sets.FirstRow(0);
        return new SaStatus(r.Bool("OpenMeetingSubmitted"), r.Bool("AllParametersSyncedByLead"), r.Bool("AllParametersSyncedByCo"),
            r.Bool("FinalSubmissionDone"), r.Bool("ClosingMeetingSubmitted"));
    }

    /// <summary>Old DbHelper.ExecuteNonStoredProcedure: a database error becomes {status:"0"} (now without its text).</summary>
    private async Task<ServiceResponse> ExecAsync(string procedure, object args, CancellationToken ct)
    {
        try
        {
            await db.ExecuteProcAsync(procedure, args, ct);
            return new ServiceResponse { status = "1" };
        }
        catch (DbException ex)
        {
            log.LogError(ex, "{Procedure} failed", procedure);
            return ServiceResponse.Fail(ErrorText);
        }
    }

    private async Task<ServiceResponse> SavePhotosAsync(string action, string? saId, string? zedId, string? certification, string photoType,
        DataTable photos, CancellationToken ct)
    {
        if (photos.Rows.Count == 0)
        {
            log.LogInformation("SA/{Action} sent no photos; refused as the old service did", action);
            return ServiceResponse.Fail(ErrorText);
        }
        var args = new DynamicParameters();
        args.Add("ZedId", zedId);
        args.Add("AssessorId", saId);
        args.Add("CertificationType", certification);
        args.Add("PhotoType", photoType);
        args.Add("PhotoList", photos.AsTableValuedParameter("DynamicPhotoList2"));
        return await ExecAsync("SP_APP_SA_SAVE_PHOTOS", args, ct);
    }

    private async Task<DataTable> SaveMeetingPhotosAsync(SubmitAssessmentRequest request, CancellationToken ct)
    {
        var photos = PhotoTable();
        foreach (var p in request.assessmentPhotos ?? [])
        {
            if (string.IsNullOrEmpty(p.photo)) continue;
            var folder = storage.Folder("SaPhotos", request.zedId, request.certificationType);
            await storage.SaveBase64Async(p.photo, folder, MobileStorage.FileName(MeetingPhotoName(p), ".jpg"), ct);
            AddPhoto(photos, p.photoId, p.name, p.timeStamp, p.latitude, p.longitude);
        }
        return photos;
    }

    /// <summary>
    /// Main: {name}_{photoId}.jpg (its SP_SA_APP_INSERT_OPEN_MEETING records PhotoFileName = Name_PhotoId).
    /// Surveillance: {name}.jpg, as the old SurveillanceServices saved them and its procedure has no PhotoFileName,
    /// so the review pages find the photo by its name.
    /// </summary>
    private string MeetingPhotoName(PhotoInformation p) =>
        portal.System == PortalSystem.Surveillance ? p.name ?? "" : p.name + "_" + p.photoId;

    private Task<ServiceResponse> SaveMeetingAsync(SubmitAssessmentRequest request, DataTable? participants, DataTable? photos,
        string photoType, string? comments, CancellationToken ct)
    {
        var args = new DynamicParameters();
        args.Add("ZedId", request.zedId);
        args.Add("AssessorId", request.saId);
        args.Add("CertificationType", request.certificationType);
        args.Add("PhotoType", photoType);
        args.Add("Latitude", request.latitude);
        args.Add("Longitude", request.longitude);
        args.Add("Comments", comments);
        if (participants is { Rows.Count: > 0 }) args.Add("ParticipantsList", participants.AsTableValuedParameter("DynamicParticipants"));
        if (photos is { Rows.Count: > 0 }) args.Add("PhotoList", photos.AsTableValuedParameter("DynamicPhotoList2"));
        return ExecAsync("SP_SA_APP_INSERT_OPEN_MEETING", args, ct);
    }

    private static DataTable Participants(List<Participant>? participants)
    {
        var table = Table("Name", "Designation");
        foreach (var p in participants ?? []) AddRow(table, p.name, p.designation ?? "");
        return table;
    }

    private static DataTable Table(params string[] columns)
    {
        var table = new DataTable();
        foreach (var c in columns) table.Columns.Add(c, typeof(string));
        return table;
    }

    private static void AddRow(DataTable table, params string?[] values) =>
        table.Rows.Add(values.Select(v => (object?)v ?? DBNull.Value).ToArray());

    /// <summary>Columns of the DynamicPhotoList2 table type (old PhotoCollection).</summary>
    private static DataTable PhotoTable() => Table("PhotoId", "Name", "TimeStamp", "Latitude", "Longitude", "PhotoType");

    private static void AddPhoto(DataTable table, string? photoId, string? name, string? timeStamp, string? latitude, string? longitude, string? photoType = null) =>
        AddRow(table, photoId, name ?? "", timeStamp, latitude, longitude, photoType ?? "");

    private static string? First(params string?[] values) => values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));

    private static bool Same(string? a, string? b) =>
        !string.IsNullOrWhiteSpace(a) && !string.IsNullOrWhiteSpace(b) &&
        string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);
}
