using System.Data;
using System.Data.Common;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
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
public sealed class SAController(
    ISqlExecutor db,
    IConfiguration config,
    IDeviceBindings devices,
    LoginThrottle throttle,
    MobileStorage storage,
    PortalHost portal,
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
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Bronze", "Silver", "Gold" };

    private enum Role { LeadOrCo, Lead, Co }

    // ------------------------------------------------------------------ Login

    [HttpPost]
    [LoginAudit(LoginChannels.Mobile, "Site assessment app")]
    public Task<IActionResult> Login(LoginServiceRequest request, CancellationToken ct) => Guarded(nameof(Login), async () =>
    {
        if (config.GetValue<bool>("Mobile:CheckSaVersion") &&
            !string.Equals(config["Mobile:SaVersion"] ?? "", request.version, StringComparison.Ordinal))
            return LegacyJson(new ServiceResponse { status = "2", errorMessage = UpdateAppMessage });

        var assessorId = request.assessorId?.Trim();
        if (string.IsNullOrEmpty(assessorId) || string.IsNullOrEmpty(request.password))
            return LegacyJson(new AssessmentDetails { status = "0", errorMessage = InvalidCredentials });
        if (throttle.IsLocked(MobileApps.SiteAssessor, assessorId))
            return LegacyJson(new AssessmentDetails { status = "0", errorMessage = TooManyAttempts });

        var passwords = PasswordStore.For(db, HttpContext.RequestServices);
        var login = await passwords.BeginLoginAsync(assessorId, request.password, ct);
        var sets = await db.QueryProcMultipleAsync("SP_APP_SA_CHECK_LOGIN",
            new { ZedId = request.zedId, UserId = assessorId, Password = login.ProcedurePassword }, ct);

        // Set 0 is the Users row (RoleId 3, SiteVerification 1, active). The procedure family has
        // hard-coded master passwords, so the typed password must equal the row's own.
        var user = sets.Count > 0 ? sets[0].FirstOrDefault() : null;
        var masterPassword = user is not null && !await passwords.CompleteLoginAsync(login, user, ct);
        if (user is null || masterPassword || user.Text("RoleId") != "3")
        {
            if (masterPassword) log.LogWarning("Blocked SA app login with a procedure master password for {UserId}", assessorId);
            throttle.Failed(MobileApps.SiteAssessor, assessorId);
            return LegacyJson(new AssessmentDetails { status = "0", errorMessage = InvalidCredentials });
        }
        throttle.Succeeded(MobileApps.SiteAssessor, assessorId);

        // Set 1 only has a row when this assessor is the lead or co-assessor of the unit.
        if (sets[1].Count == 0)
            return LegacyJson(new AssessmentDetails { status = "0", errorMessage = NotAllocated + request.zedId });
        var unit = sets[1][0];
        if (unit.Int("CertificationStatus") >= 13)
            return LegacyJson(new AssessmentDetails { status = "0", errorMessage = LoginClosed + request.zedId });

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

        var userKey = user.Text("UserId") is { Length: > 0 } id ? id : assessorId;
        await devices.RememberAsync(MobileApps.SiteAssessor, userKey, request.deviceInfo, ClientIp, ct);
        log.LogInformation("SA app login for {UserId} on {ZedId}", userKey, request.zedId);
        return LegacyJson(response);
    });

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

        var photos = PhotoTable();
        foreach (var p in request.siteTourPhotos ?? [])
        {
            if (string.IsNullOrEmpty(p.photo)) continue;
            var folder = storage.Folder("SaPhotos", request.zedId, request.certificationType, "SiteTour");
            await storage.SaveBase64Async(p.photo, folder, MobileStorage.FileName(p.photoId, ".jpg"), ct);
            AddPhoto(photos, p.photoId, p.comment, p.timeStamp, p.latitude, p.longitude);
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

        var reqs = Table("RequirementId", "RequirementCode", "Conformance", "AssessorRemarks");
        var photos = PhotoTable();
        foreach (var r in requirements)
        {
            AddRow(reqs, r.id.ToString(System.Globalization.CultureInfo.InvariantCulture), r.code ?? "", r.conformance, r.comments ?? "");
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
        return LegacyJson(await ExecAsync("SP_APP_SA_SAVE_PARAMETER", args, ct));
    });

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
        // The old code joined the list without a null check and failed here.
        if (info.energySources is null) return Fail(ErrorText);

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
        // made SqlClient throw; so exactly one empty photo list failed the call. Kept as it was.
        if ((productPhotos.Rows.Count > 0) != (descriptionPhotos.Rows.Count > 0)) return EmptyList(nameof(SubmitBasicInformation));
        if (productPhotos.Rows.Count > 0)
        {
            args.Add("ProductDescriptionPhotos", descriptionPhotos.AsTableValuedParameter("DynamicPhotoList2"));
            args.Add("ProductPhotos", productPhotos.AsTableValuedParameter("DynamicPhotoList2"));
        }
        if (products.Rows.Count > 0) args.Add("ProductList", products.AsTableValuedParameter("ProductDetails2"));
        if (rawMaterials.Rows.Count > 0) args.Add("RawMaterialList", rawMaterials.AsTableValuedParameter("RawMaterial"));
        return LegacyJson(await ExecAsync("SP_APP_SA_INSERT_BASIC_INFO", args, ct));
    });

    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "userName")]
    public Task<IActionResult> SubmitBasicInfoPhotos(SubmitPhotosRequest request, CancellationToken ct) => Guarded(nameof(SubmitBasicInfoPhotos), async () =>
    {
        RequireCertification(request.certificationType);
        if (await CheckNamedAssessorAsync(nameof(SubmitBasicInfoPhotos), request.userName, request.zedId, request.certificationType, ct) is { } refused)
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

    // ------------------------------------------------------------------ Hotel self-assessment leftovers
    // These four act on SelfAssessments / SaPaymentCases (the hotel self-certification product this
    // code base was copied from) and carry no identity. No app calls them: the portal pages that do
    // (Frontend/Login/Index.cshtml) post to their own site's /SA/... controller.

    /// <summary>
    /// SP_SA_GET_REG_DETAILS cannot be created in any of the three databases (ambiguous column), so the
    /// old action always returned the empty DataSet "{}"; that stays the answer when the call fails.
    /// Only the columns the old page read are returned, never contact details.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> GetSiteAssessmentDetails(string? registrationNo, CancellationToken ct)
    {
        log.LogInformation("SA/GetSiteAssessmentDetails called for {RegistrationNo}", registrationNo);
        ResultSets sets;
        try
        {
            sets = await db.QueryProcMultipleAsync("SP_SA_GET_REG_DETAILS", new { RegistrationNo = registrationNo }, ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "SP_SA_GET_REG_DETAILS failed (it does not exist in the current databases)");
            return LegacyContent("{}");
        }
        var kept = new List<IReadOnlyList<IDictionary<string, object?>>>();
        for (var i = 0; i < sets.Count; i++)
        {
            var allowed = i switch { 0 => RegDetailsColumns, 1 => AmountColumns, _ => EmptyColumns };
            kept.Add(sets[i].Select(r => (IDictionary<string, object?>)r.Where(kv => allowed.Contains(kv.Key))
                .ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.OrdinalIgnoreCase)).ToList());
        }
        return LegacyContent(LegacyResults.DataSetJson(new ResultSets(kept)));
    }

    private static readonly IReadOnlySet<string> RegDetailsColumns = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        { "RegistrationNumber", "SaDate", "SaDateForm", "UtrNumber", "GstNumber", "FinalSaDate", "SaStatus", "SaStatusDisplay", "PaymentDate" };
    private static readonly IReadOnlySet<string> AmountColumns = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        { "Amount", "Gst", "Total" };
    private static readonly IReadOnlySet<string> EmptyColumns = new HashSet<string>();

    [HttpPost]
    public async Task<IActionResult> UpdateSaDeclaration(string? registrationNo, CancellationToken ct)
    {
        log.LogInformation("SA/UpdateSaDeclaration called for {RegistrationNo}", registrationNo);
        var response = await ExecAsync("SP_SA_UPDATE_DECLARATION", new { RegistrationNumber = registrationNo }, ct);
        return LegacyContent(System.Text.Json.JsonSerializer.Serialize(response, Zed.Core.Mobile.LegacyJson.Write));
    }

    [HttpPost]
    public async Task<IActionResult> SubmitSaReg(string? SaDate, string? RegistrationNumber, CancellationToken ct)
    {
        log.LogInformation("SA/SubmitSaReg called for {RegistrationNo}", RegistrationNumber);
        ResultSets check;
        try
        {
            check = await db.QueryProcMultipleAsync("SP_SA_CHECK_VALID_DATE", new { RegistrationNumber, SaDate }, ct);
        }
        catch (DbException ex)
        {
            // The old code read Tables[0].Rows[0] of the empty DataSet and returned the exception as JSON.
            log.LogWarning(ex, "SP_SA_CHECK_VALID_DATE failed");
            return Fail(ErrorText);
        }
        if (check.Count == 0 || check[0].Count == 0) return Fail(ErrorText);

        var response = check[0][0].Text("ValidDate") == "1"
            ? await ExecAsync("SP_SA_INSERT_REGISTRATION_DATA", new { RegistrationNumber, SaDate }, ct)
            : ServiceResponse.Fail("Please select valid date.");
        return LegacyContent(System.Text.Json.JsonSerializer.Serialize(response, Zed.Core.Mobile.LegacyJson.Write));
    }

    /// <summary>The hotel self-assessment fee table (public price list).</summary>
    [HttpPost]
    public async Task<IActionResult> GetAmounts(CancellationToken ct)
    {
        try
        {
            var sets = await db.QueryProcMultipleAsync("SP_SA_GET_AMOUNTS_MASTER", null, ct);
            return LegacyContent(LegacyResults.DataSetJson(sets));
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "SP_SA_GET_AMOUNTS_MASTER failed");
            return LegacyContent("{}");
        }
    }

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
    /// For the basic-information calls, whose procedures do not record the assessor: an assessor named
    /// in the request must be allotted; a request that names none cannot be checked (logged).
    /// </summary>
    private async Task<IActionResult?> CheckNamedAssessorAsync(string action, string? assessorId, string? zedId, string? certification, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(assessorId))
        {
            log.LogWarning("SA/{Action} for {ZedId} names no assessor; allotment not checked", action, zedId);
            return null;
        }
        return await IsAllottedAsync(assessorId, zedId, certification, Role.LeadOrCo, ct) ? null : NotAllotted(action, assessorId, zedId);
    }

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
