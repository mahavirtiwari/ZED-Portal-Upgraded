using System.Data;
using System.Data.Common;
using System.Globalization;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Security;
using Zed.Main.MobileApi.Models.Consultancy;
using LoginServiceRequest = Zed.Main.MobileApi.Models.LoginServiceRequest;

namespace Zed.Main.MobileApi.Controllers.Consultancy;

/// <summary>
/// The consultant app and the TU verifier (DFO) app of ZEDCS_CONSULTANCY (old SwachhSurvekshanServices SAController of
/// that code base, site /Consultancymobileapi), at the same addresses (/SA/{action}) with the same request and response
/// formats. Served by the Consultancy deployment of the mobile host only; on that deployment Main's
/// <see cref="Zed.Main.MobileApi.Controllers.SAController"/> is removed by the controller filter, so the routes do not clash.
/// <para>
/// Added over the old code: the user named in a call must be allotted to the unit and certification named in it, by
/// exact user id (the lead consultant MsmeCertifications.SiteAssessorId, a co-consultant in AllotedCoAssessors or a
/// technical expert in AllotedTechExperts for the current milestone, or the DFO FinancialAssistance.FinancialAssessorId
/// where the DFO app calls), never the old <c>CoAssessorId LIKE '%id%'</c> (SECURITY-FINDINGS #93); upload paths go
/// through <see cref="MobileStorage"/> with fixed extensions (#91); request bodies are no longer written to App_Data/Json;
/// exception texts are no longer returned.
/// </para>
/// </summary>
[PortalSystems(PortalSystem.Consultancy)]
[Route("SA/[action]/{id?}")]
public sealed partial class ConsultancySAController(
    ISqlExecutor db,
    IConfiguration config,
    IDeviceBindings devices,
    LoginThrottle throttle,
    MobileStorage storage,
    ILogger<ConsultancySAController> log) : LegacyMobileController
{
    /// <summary>Device records and the login throttle use the site assessor app's key: the consultant app is its fork.</summary>
    public const string App = MobileApps.SiteAssessor;

    public const string UpdateAppMessage = "Download new app from store.";
    /// <summary>SP_APP_SA_CHECK_LOGIN_V2's own text for a wrong user id or password.</summary>
    public const string InvalidCredentials = "Invalid Credentials. Please check";
    public const string InvalidDetails = "Invalid details.";
    public const string TooManyAttempts = "Too many failed attempts. Please try again after 15 minutes.";
    /// <summary>SP_APP_SA_CHECK_LOGIN_V2's texts for a user who is not allotted to the unit.</summary>
    public const string NotAllocated = "Handholding Consultant not yet allocated for the ZEDID: ";
    public const string DfoNotAllocated = "DFO not yet allocated for the ZEDID: ";
    // Stage texts of the consultancy code (the "MSME SA" prefix was dropped there, except for the two below).
    public const string Closed = "Closing Meeting Submitted for the ZEDID: ";
    public const string OpenNotSubmitted = "Open Meeting not Submitted for the ZEDID: ";
    public const string OpenSubmitted = "MSME SA Open Meeting Submitted for the ZEDID: ";
    public const string NotSynced = "All Parameters not synced yet for the ZEDID: ";
    public const string FinalDone = "Final Submission done for the ZEDID: ";
    public const string FinalSubmitDone = "MSME SA Final Submit done for the ZEDID: ";
    public const string FinalNotSynced = "Final submissions not synced yet by Assessors for the ZEDID: ";
    /// <summary>Replaces the exception text the old actions returned.</summary>
    public const string ErrorText = "An error has occurred, please try again later.";

    /// <summary>
    /// Everyone allotted to the unit's current milestone of a certification, one row per person and role. The current
    /// milestone is the MsmeCertifications row the procedures use (SiteAssessorId set, SaCertificateNo empty); a
    /// re-allotment renames the old AllotedCoAssessors / AllotedTechExperts rows (ZedId + '_del'), so they drop out.
    /// The DFO row matches SP_APP_TU_CHECK_LOGIN (VerificationStatus 2) and SP_APP_SA_CHECK_LOGIN_V2 (TechUpgradeStatus
    /// 4, 5 or 10) on the same FinancialAssistance row.
    /// </summary>
    public const string AllotmentSql = """
        SELECT 'Lead' AS Role, M.SiteAssessorId AS UserId FROM MsmeCertifications M
         WHERE M.ZedId = @ZedId AND M.Certification = @Certification AND M.SiteAssessorId IS NOT NULL AND M.SaCertificateNo IS NULL
        UNION ALL
        SELECT 'Co', A.CoAssessorId FROM AllotedCoAssessors A
         INNER JOIN MsmeCertifications M ON M.ZedId = A.ZedId AND M.Certification = A.Certification AND M.NcCount = A.NcCount
         WHERE M.ZedId = @ZedId AND M.Certification = @Certification AND M.SiteAssessorId IS NOT NULL AND M.SaCertificateNo IS NULL
        UNION ALL
        SELECT 'Expert', T.TechExpertId FROM AllotedTechExperts T
         INNER JOIN MsmeCertifications M ON M.ZedId = T.ZedId AND M.Certification = T.Certification AND M.NcCount = T.NcCount
         WHERE M.ZedId = @ZedId AND M.Certification = @Certification AND M.SiteAssessorId IS NOT NULL AND M.SaCertificateNo IS NULL
        UNION ALL
        SELECT 'Dfo', F.FinancialAssessorId FROM FinancialAssistance F
         WHERE F.ZedId = @ZedId AND F.CertificationType = @Certification AND F.FinancialAssessorId IS NOT NULL
           AND F.VerificationStatus = 2 AND F.TechUpgradeStatus IN (4, 5, 10)
        """;

    /// <summary>Certifications that handholding is done for; used in upload paths.</summary>
    internal static readonly IReadOnlySet<string> Certifications =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Bronze", "Silver", "Gold" };

    /// <summary>Who may make a call.</summary>
    private enum Role
    {
        /// <summary>Lead consultant, co-consultant or technical expert.</summary>
        Team,
        /// <summary>The team or the allotted DFO (calls the TU verifier app makes: attendance, file uploads).</summary>
        TeamOrDfo,
        Lead,
        Co,
    }

    // ------------------------------------------------------------------ Login

    /// <summary>
    /// SP_APP_SA_CHECK_LOGIN_V2: set 0 is the Users row with StatusCode/ErrorMessage (or only those two on a failure);
    /// then, from SP_APP_SA_CONSULTANCY_CHECK_LOGIN (consultant, SiteVerification) or SP_APP_TU_CHECK_LOGIN (DFO,
    /// FinancialVerification): 1 unit (one row per co-consultant), 2 sections, 3 products, 4 raw materials,
    /// 5 requirements, 6 options, 7 sub-options, 8 flags, 9 requirement bullets.
    /// </summary>
    [HttpPost]
    public Task<IActionResult> Login(LoginServiceRequest request, CancellationToken ct) => Guarded(nameof(Login), async () =>
    {
        // The old mobile Web.config had no checkSAVersion, so the old code failed before its try; here the check is
        // off unless Mobile:CheckSaVersion is set for this deployment.
        if (config.GetValue<bool>("Mobile:CheckSaVersion") &&
            !string.Equals(config["Mobile:SaVersion"] ?? "", request.version, StringComparison.Ordinal))
            return LegacyJson(new ServiceResponse { status = "2", errorMessage = UpdateAppMessage });

        var userId = First(request.assessorId, request.userName)?.Trim();
        if (string.IsNullOrEmpty(userId) || string.IsNullOrEmpty(request.password)) return LoginFail(InvalidCredentials);
        if (throttle.IsLocked(App, userId)) return LoginFail(TooManyAttempts);

        var passwords = PasswordStore.For(db, HttpContext.RequestServices);
        var login = await passwords.BeginLoginAsync(userId, request.password, ct);
        var sets = await db.QueryProcMultipleAsync("SP_APP_SA_CHECK_LOGIN_V2",
            new { UserId = userId, Password = login.ProcedurePassword, ZedId = request.zedId }, ct);

        var first = sets.Count > 0 ? sets[0].FirstOrDefault() : null;
        if (first is null)
        {
            throttle.Failed(App, userId);
            return LoginFail(InvalidDetails);
        }
        if (first.Text("StatusCode") != "1")
        {
            // Only the procedure's last branch is about the password; the others are reached with a valid one.
            var message = first.Text("ErrorMessage");
            if (!first.ContainsKey("UserId") && message.StartsWith("Invalid Credentials", StringComparison.OrdinalIgnoreCase))
                throttle.Failed(App, userId);
            return LoginFail(message);
        }

        // The Users row: the password must be the account's own (PasswordStore; the V2 procedure compares it too).
        if (first.Text("RoleId") != "3" || !await passwords.CompleteLoginAsync(login, first, ct))
        {
            log.LogWarning("Blocked consultant app login for {UserId}: password or role does not match the Users row", userId);
            throttle.Failed(App, userId);
            return LoginFail(InvalidCredentials);
        }
        throttle.Succeeded(App, userId);

        // SP_APP_SA_CHECK_LOGIN_V2 takes the consultant branch whenever SiteVerification is set.
        var dfo = !first.Bool("SiteVerification") && first.Bool("FinancialVerification");
        var notAllotted = (dfo ? DfoNotAllocated : NotAllocated) + request.zedId;

        // Set 1 is empty (or a placeholder without UserType) when the sub-procedure found no allotment; the old code
        // then failed on Convert.ToInt32 and returned the exception text.
        var unit = sets[1].FirstOrDefault();
        if (unit is null || unit.Text("UserType").Length == 0)
            return LoginFail(notAllotted);

        // SP_APP_SA_CHECK_LOGIN_V2 lets a co-consultant through with CoAssessorId LIKE '%id%' (#93): check the
        // allotment by exact id before answering.
        var certification = unit.Text("CertificationType");
        var allotted = await AllotmentsAsync(request.zedId, certification, ct);
        var ok = dfo
            ? allotted.Any(a => a.Role == "Dfo" && Same(a.UserId, userId))
            : allotted.Any(a => a.Role is "Lead" or "Co" && Same(a.UserId, userId));
        if (!ok)
        {
            log.LogWarning("Refused consultant app login: {UserId} is not allotted to {ZedId} {Certification}", userId, request.zedId, certification);
            return LoginFail(notAllotted);
        }

        // The app's technology upgradation calls to the consultancy web site carry no identity; the portal accepts them for a
        // unit whose allotted DFO signed in here recently (dbo.V4AppSessions, migration 0010; TuAppController).
        await AppSessions.RecordAsync(db, log, AppSessions.Consultant, first.Text("UserId") is { Length: > 0 } uid ? uid : userId,
            request.zedId!.Trim(), certification, ClientIp, ct);

        var flags = sets.FirstRow(8);
        var response = new AssessmentDetails
        {
            status = "1",
            userType = unit.Int("UserType"),
            milestone = unit.Int("Milestone"),
            certificationType = certification,
            isSelfieSubmitted = flags.Bool("SelfieSubmitted"),
            isOpenMeetingSubmitted = flags.Bool("OpenMeetingSubmitted"),
            companyProfile = new MSMEProfile
            {
                bdsFromDate = unit.Text("BdsFromDate"),
                bdsToDate = unit.Text("BdsToDate"),
                hapFromDate = unit.Text("HapFromDate"),
                hapToDate = unit.Text("HapToDate"),
                saDate = unit.Text("AssessmentDate"),
                zedId = unit.Text("ZedId"),
                msmeName = unit.Text("EnterpriseName"),
                sectorName = unit.Text("Sector"),
                unitAddress = unit.Text("UnitAddress"),
                email = unit.Text("Email"),
                phone = unit.Text("PhoneNumber"),
                address = unit.Text("PAddress"),
                districtName = unit.Text("PDistrictName"),
                stateName = unit.Text("PStateName"),
                pincode = unit.Text("PPincode"),
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
            assessors = Assessors(sets[1]),
        };

        if (unit.Text("CertificationStatus") == "8")
        {
            // The lead consultant still has to allot the parameters.
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
                element.requirements = sets[5].Where(r => Same(r.Text("SectionCode"), element.parameterCode))
                    .Select(r => Requirement(r, element.parameterCode, sets)).ToList();
        }

        var userKey = first.Text("UserId") is { Length: > 0 } id ? id : userId;
        await devices.RememberAsync(App, userKey, request.deviceInfo, ClientIp, ct);
        log.LogInformation("Consultancy app login ({Branch}) for {UserId} on {ZedId}", dfo ? "DFO" : "consultant", userKey, request.zedId);
        return LegacyJson(response);
    });

    private static ContentResult LoginFail(string message) => LegacyJson(new AssessmentDetails { status = "0", errorMessage = message });

    /// <summary>Old SetAssessorDetails: the lead from the first row, then the co-consultant of every row.</summary>
    private static List<AssessorDetails> Assessors(IReadOnlyList<IDictionary<string, object?>> rows)
    {
        var lead = rows[0];
        var list = new List<AssessorDetails>
        {
            new() { assessorId = lead.Text("LeadAssessorId"), assessorName = lead.Text("LeadAssessorName"), userType = "1" },
        };
        foreach (var row in rows)
            if (row.TryGetValue("CoAssessorId", out var co) && co is not null and not DBNull)
                list.Add(new AssessorDetails { assessorId = row.Text("CoAssessorId"), assessorName = row.Text("CoAssessorName"), userType = "2" });
        return list;
    }

    private static RequirementDetails Requirement(IDictionary<string, object?> r, string? sectionCode, ResultSets sets)
    {
        var requirement = new RequirementDetails
        {
            id = r.Int("Id"),
            code = r.Text("RequirementCode"),
            assessorRemarks = r.Text("AssessorRemarks"),
            estimatedTimeInDays = r.Text("EstimatedTimeInDays"),
            technologyInterventionRationale = r.Text("Intervention"),
            conformance = r.Text("SaConformance"),
            isProposedActivityCompleted = r.Text("IsProposedActivityCompleted"),
            baselineRemarks = r.Text("BaselineRemarks"),
            handholdingActionPlanRemarks = r.Text("HActionPlanRemarks"),
            technologyInterventionRemarks = r.Text("InterventionRemarks"),
            progressReview1Remarks = r.Text("ProgressReviewRemarks"),
            evidences = [],
        };

        // Bullets were saved against the milestone-1 requirement row (PrevReqId).
        var previous = r.Int("PrevReqId");
        List<string> Bullets(string type) => sets[9]
            .Where(b => b.Int("RequirementId") == previous && string.Equals(b.Text("ReqType"), type, StringComparison.OrdinalIgnoreCase))
            .Select(b => b.Text("BulletPoints")).ToList();
        requirement.gapsIdentified = Bullets("BaselineDiagnostic");
        requirement.plannedActivities = Bullets("HandholdingActionPlan");
        requirement.suggestedTechnologyIntervention = Bullets("TechnologyIntervention");

        requirement.options = sets[6]
            .Where(o => Same(o.Text("SectionCode"), sectionCode) && Same(o.Text("RequirementCode"), requirement.code))
            .Select(o =>
            {
                var option = new OptionInfo { id = o.Int("Id"), code = o.Text("OptionCode"), label = o.Text("OptionName") };
                option.subOptions = sets[7]
                    .Where(s => Same(s.Text("SectionCode"), sectionCode) && Same(s.Text("RequirementCode"), requirement.code) &&
                                Same(s.Text("OptionCode"), option.code))
                    .Select(s => new SubOption { id = s.Int("Id"), code = s.Text("SubOptionCode"), label = s.Text("SubOptionName") })
                    .ToList();
                return option;
            }).ToList();
        return requirement;
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
            log.LogError(ex, "Consultancy SA/{Action} failed", action);
            return Fail(ErrorText);
        }
    }

    private static string RequireCertification(string? certification)
    {
        if (certification is null || !Certifications.Contains(certification.Trim()))
            throw new UnsafePathException($"'{certification}' is not a handholding certification.");
        return certification.Trim();
    }

    /// <summary>
    /// A section folder name from the request (SaPhotos/{zed}/{cert}/{section}); the portal's own names are words with
    /// spaces ("Training on ZED", "Baseline Diagnostic Selfie"), so letters, digits, spaces, '_' and '-' are allowed.
    /// </summary>
    private static string Section(string? sectionName)
    {
        var s = MobileStorage.Segment(sectionName);
        if (s.Length > 100 || !s.All(c => char.IsAsciiLetterOrDigit(c) || c is ' ' or '_' or '-'))
            throw new UnsafePathException($"'{sectionName}' is not a section name.");
        return s;
    }

    private async Task<IReadOnlyList<ConsultancyAllotment>> AllotmentsAsync(string? zedId, string? certification, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(zedId) || string.IsNullOrWhiteSpace(certification)) return [];
        return await db.QuerySqlAsync<ConsultancyAllotment>(AllotmentSql, new
        {
            ZedId = new DbString { Value = zedId.Trim(), IsAnsi = true, Length = 50 },
            Certification = new DbString { Value = certification.Trim(), IsAnsi = true, Length = 50 },
        }, ct);
    }

    private async Task<bool> IsAllottedAsync(string? userId, string? zedId, string? certification, Role role, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(userId)) return false;
        var rows = (await AllotmentsAsync(zedId, certification, ct)).Where(a => Same(a.UserId, userId)).Select(a => a.Role).ToList();
        return role switch
        {
            Role.Lead => rows.Contains("Lead"),
            Role.Co => rows.Contains("Co"),
            Role.TeamOrDfo => rows.Count > 0,
            _ => rows.Any(r => r is "Lead" or "Co" or "Expert"),
        };
    }

    /// <summary>Null when <paramref name="userId"/> may act on the unit; otherwise the refusal (logged).</summary>
    private async Task<IActionResult?> RefuseAsync(string action, string? userId, string? zedId, string? certification, Role role, CancellationToken ct) =>
        await IsAllottedAsync(userId, zedId, certification, role, ct) ? null : NotAllotted(action, userId, zedId);

    private IActionResult NotAllotted(string action, string? userId, string? zedId)
    {
        log.LogWarning("Refused consultancy SA/{Action}: {UserId} is not allotted to {ZedId}", action, userId, zedId);
        return Fail(NotAllocated + zedId);
    }

    private IActionResult EmptyList(string action)
    {
        // The old code passed an empty SqlDataRecord list here, which SqlClient rejects.
        log.LogInformation("Consultancy SA/{Action} sent an empty list; refused as the old service did", action);
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

    /// <summary>The closing / open meeting checks most writes start with; null when the call may go on.</summary>
    private async Task<IActionResult?> RequireOpenAsync(string? zedId, string? certification, string? assessorId, CancellationToken ct)
    {
        var st = await CheckSaStatusAsync(zedId, certification, assessorId, ct);
        if (st.ClosingMeetingSubmitted) return Fail(Closed + zedId);
        if (!st.OpenMeetingSubmitted) return Fail(OpenNotSubmitted + zedId);
        return null;
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

    private async Task<ServiceResponse> SavePhotosAsync(string action, string? assessorId, string? zedId, string? certification, string photoType,
        DataTable photos, CancellationToken ct)
    {
        if (photos.Rows.Count == 0)
        {
            log.LogInformation("Consultancy SA/{Action} sent no photos; refused as the old service did", action);
            return ServiceResponse.Fail(ErrorText);
        }
        var args = new DynamicParameters();
        args.Add("ZedId", zedId);
        args.Add("AssessorId", assessorId);
        args.Add("CertificationType", certification);
        args.Add("PhotoType", photoType);
        args.Add("PhotoList", photos.AsTableValuedParameter("DynamicPhotoList2"));
        return await ExecAsync("SP_APP_SA_SAVE_PHOTOS", args, ct);
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

    /// <summary>Columns of DynamicParticipants (old ParticipantCollection), also used for the requirement bullets.</summary>
    private static DataTable ParticipantTable() => Table("Name", "Designation");

    private static string RefId() => DateTime.Now.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture);

    private static string Invariant(int value) => value.ToString(CultureInfo.InvariantCulture);

    private static string? First(params string?[] values) => values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));

    private static bool Same(string? a, string? b) =>
        !string.IsNullOrWhiteSpace(a) && !string.IsNullOrWhiteSpace(b) &&
        string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);
}
