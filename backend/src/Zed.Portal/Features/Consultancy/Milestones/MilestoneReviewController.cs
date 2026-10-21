using System.Globalization;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Consultancy.Milestones;

/// <summary>
/// The handholding milestone page of ZEDCS_CONSULTANCY and the decisions on it. Port of Assessment/SaDetails (reads
/// SP_ASSESSMENT_DA_DETAILS / SP_ASSESSMENT_SA_DETAILS with the milestone), Assessment/UpdateColumnData and InsertBullet
/// (the consultant's and the CO's edits), Remote/ConfirmFinalSubmit and Remote/FinalSubmit (consultant and co-consultant
/// final submit, SP_ASSESSMENT_RA_CONFIRM_FINAL_SUBMIT / SP_ASSESSMENT_RA_FINAL_SUBMIT with @UserId), and the CO's
/// Monitoring/RaFinalSubmit, SendBackToAssessor and RejectFinalSubmit (CONSULTANCY-ANALYSIS 1.2 steps 5–6).
/// <para>
/// The old actions had no filter at all (UpdateColumnData: SQL injection into any table, #86; Monitoring decisions:
/// #87; the procedures check no state, #84; co-consultants were matched with LIKE, #93). Here: the unit's lead
/// consultant, co-consultants (exact ids in AllotedCoAssessors) and CO act, the master admin, super admin and ministry
/// only read; every write is checked against the unit, its current milestone, the user and the status; edits go
/// through allow-listed, parameterised statements (<see cref="MilestoneFields"/>).
/// </para>
/// </summary>
[PortalSystems(PortalSystem.Consultancy)]
[Route("api/consultancy/milestones/{zedId}/{certification}")]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency, UserRole.DesktopAssessor, UserRole.SuperAdmin, UserRole.Ministry)]
public sealed class MilestoneReviewController(
    ISqlExecutor db,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<MilestoneReviewController> log) : StaffApiController
{
    private const int MaxRemarks = 2000;
    private const string QrChars = "123456789abcdefghijklmnopqrstuvwxyz";
    /// <summary>The "add more" placeholder rows of SP_ASSESSMENT_SA_DETAILS set 18.</summary>
    private const long PlaceholderBulletId = 999999999;

    /// <summary>One decision at a time: the procedures read and write the status without locks.</summary>
    private static readonly SemaphoreSlim Decisions = new(1, 1);
    private static readonly FileExtensionContentTypeProvider ContentTypes = new();
    private static readonly string[] Levels = ["Silver", "Gold"];

    // ------------------------------------------------------------------ columns shown

    private static readonly string[] MilestoneRowFields =
    [
        "NcCount", "CertificationStatus", "CertificationStatusDate", "ZedId", "Certification", "EnterpriseName", "PUnitName", "UdyogAadharNo",
        "PlantAddress", "CertificationBodyUserId", "AgencyName", "SiteAssessorId", "SiteAssessorName", "CoAssessorId", "TechExpert", "TechExpertName",
        "BdsFromDate", "BdsToDate", "HapFromDate", "HapToDate", "ModeOfAssessment", "LastestCertification", "SendBackStatus", "SaAssessorRemarks",
    ];

    private static readonly string[] SectionFields = ["Id", "SectionCode", "SectionName", "iButton", "IsAssessmentExcempted", "NcCount"];

    private static readonly string[] RequirementFields =
    [
        "Id", "SectionCode", "RequirementCode", "RequirementId", "QuestionName", "RequirementName", "SaConformance", "SaAssessorRemarks", "SaUpdatedDate",
        "EstimatedTimeInDays", "Intervention", "BaselineRemarks", "BaselineDate", "InterventionRemarks", "InterventionDate",
        "HActionPlanRemarks", "HActionPlanDate", "IntConformance",
        "IsProposedActivityCompleted", "ProgressReviewRemarks", "ProgressReviewDate",
        "IsProposedActivityCompleted2", "ProgressReviewRemarks2", "ProgressReviewDate2",
    ];

    private static readonly string[] OptionFields = ["SectionCode", "RequirementCode", "OptionCode", "OptionName"];
    private static readonly string[] SubOptionFields = ["SectionCode", "RequirementCode", "OptionCode", "SubOptionCode", "SubOptionName"];
    private static readonly string[] AllotmentFields = ["SectionCode", "AllotedAssessorId", "AllotedAssessorName", "NcCount", "AssessorRank"];
    private static readonly string[] TrainingFields = ["Id", "TrainingType", "TrainingTopic", "TrainingDate", "TrainingTime", "Remarks", "NcCount", "AssessorId", "AssessorRank"];
    private static readonly string[] AttendanceFields = ["ConsultantId", "MileStoneNo", "RowNumber", "TimeStamps", "LoginTime", "LogoutTime", "NoOfHours", "NoOfMinutes"];

    /// <summary>ConsultancyBasicInformation, one row per milestone ("Basic Information" tab).</summary>
    private static readonly string[] BasicInfoFields =
    [
        "NcCount",
        "NumOfAccedents", "NumOfNearMisses", "ManHoursLast", "LosttimeInjuryfreqRate",
        "NumOfDeliveries", "NumOfDeliveriesOntimeFull",
        "MeanTimeToRepair", "MeanTimeBetweenFailure",
        "ElectriUnit", "ElectriTotConsumpPer", "SolarUnit", "SolarTotConsumpPer", "WindUnit", "WindTotConsumpPer",
        "FossilUnit", "FossilTotConsumpPer", "GasUnit", "GasTotConsumpPer", "OthersUnit", "OthersTotConsumpPer",
        "TotalCost", "EnergyMgmtMeasuresTaken",
        "Cox", "Nox", "Sox", "SuspPertiMaterial", "TotSuspenSolid", "BioChemOxyDemand",
        "SolidWaste", "PlasticWaste", "Ewaste", "hazardWaste", "NoiseLevel", "EnviMgmtMeasuresTaken",
        "EmpEngagedInActivities", "NumOfSuggestions", "HrmMeasuresTaken",
        "Defects", "ReWork", "CustRejections", "NumOfCustComplaints", "NumOfComplaintsResolved", "CustSatisLevel", "CostOfPoorQuality",
        "Water", "Minarals", "Wood", "NrmOthers", "WaterRecycling", "Waterreuse", "RainWaterHarvest", "NumofTreesPlanted", "NrmMeasuresTaken",
        "TurnOver", "GrossProfit",
    ];

    // ------------------------------------------------------------------ response

    public sealed record Photo(long? Id, string? Name, string? Url, string? CreatedDate, int? NcCount);

    public sealed record Meeting(long? Id, int? NcCount, string? Comments, IReadOnlyList<Photo> Photos, IReadOnlyList<Dictionary<string, object?>> Participants);

    public sealed record Bullet(long Id, string? RequirementId, string? ReqType, string? Text, int? NcCount, bool Editable);

    public sealed record CoConsultant(string UserId, bool Submitted, string? SubmittedOn);

    public sealed record Permissions(
        bool CanEdit,
        IReadOnlyList<string> EditableFields,
        bool CanEditBullets,
        bool CanConsultantFinalSubmit,
        bool CanCoFinalSubmit,
        bool CanSendBack,
        bool CanReject);

    public sealed record MilestoneDetails(
        string ZedId,
        string Certification,
        int Milestone,
        int Status,
        string Party,
        string Role,
        IReadOnlyList<Dictionary<string, object?>> Milestones,
        IReadOnlyList<CoConsultant> CoConsultants,
        IReadOnlyList<Dictionary<string, object?>> Allotments,
        IReadOnlyList<Dictionary<string, object?>> Sections,
        IReadOnlyList<Dictionary<string, object?>> Requirements,
        IReadOnlyList<Dictionary<string, object?>> Options,
        IReadOnlyList<Dictionary<string, object?>> SubOptions,
        IReadOnlyList<Bullet> Bullets,
        IReadOnlyList<Dictionary<string, object?>> ZedTrainings,
        IReadOnlyList<Photo> ZedTrainingPhotos,
        IReadOnlyList<Dictionary<string, object?>> HandholdingTrainings,
        IReadOnlyList<Photo> HandholdingTrainingPhotos,
        IReadOnlyList<Dictionary<string, object?>> BasicInformation,
        IReadOnlyList<Meeting> OpenMeetings,
        IReadOnlyList<Meeting> CloseMeetings,
        IReadOnlyList<Photo> SiteExterior,
        IReadOnlyList<Photo> SiteTour,
        IReadOnlyList<Photo> Selfies,
        IReadOnlyList<Dictionary<string, object?>> Attendance,
        IReadOnlyList<Dictionary<string, object?>> AttendanceConsultants,
        Permissions Permissions);

    public sealed record FieldRequest(string? Field, string? Value);

    public sealed record BulletRequest(long RequirementId, string? ReqType, string? Text);

    public sealed record TextRequest(string? Text);

    public sealed record RemarksRequest(string? Remarks);

    public sealed record ConfirmRequest(bool Confirmed);

    public sealed record CheckResponse(bool Allowed, string Message);

    // ================================================================== page

    [HttpGet]
    public async Task<ActionResult<MilestoneDetails>> Get(string zedId, string certification, CancellationToken ct)
    {
        var (ctx, error) = await Context(zedId, certification, ct);
        if (error is not null) return error;
        var (z, level) = (ctx!.ZedId, ctx.Level);

        var role = RoleId.ToString(CultureInfo.InvariantCulture);
        var daTask = db.QueryProcMultipleAsync("SP_ASSESSMENT_DA_DETAILS",
            new { UserId, RoleId = role, ZedId = z, Certification = level, Milestone = ctx.Milestone }, ct);
        var saTask = db.QueryProcMultipleAsync("SP_ASSESSMENT_SA_DETAILS",
            new { UserId, RoleId = role, ZedId = z, Certification = level, MileStone = ctx.Milestone }, ct);
        var ownTask = OwnSectionsAsync(ctx, ct);
        await Task.WhenAll(daTask, saTask, ownTask);
        var (da, sa, own) = (daTask.Result, saTask.Result, ownTask.Result);
        // The procedures answer with ZED ID '000' when they do not show the record to this user.
        if (da[0].FirstOrDefault() is not { } first || !MilestoneContext.Same(first.Text("ZedId"), z)) return NotFound();

        var fields = ctx.CanEdit
            ? MilestoneFields.Requirements.Values.Where(f => f.Milestone == ctx.Milestone).Select(f => f.Column).ToList()
            : [];
        bool RequirementEditable(IDictionary<string, object?> r) => ctx.CanEdit && CanTouchSection(ctx, own, r.Text("SectionCode"));

        var reqPhotos = sa[7];
        var requirements = da[4].Select(r =>
        {
            var d = Pick(r, RequirementFields);
            d["Editable"] = RequirementEditable(r);
            d["Photos"] = Photos(reqPhotos.Where(p => SameText(p, "RequirementId", r, "RequirementId")), z, level, "src", "Photo");
            return d;
        }).ToList();

        var editableRequirementIds = da[4].Where(RequirementEditable).Select(r => r.Text("Id")).ToHashSet(StringComparer.Ordinal);
        var bulletsEditable = ctx.CanEdit && ctx.Milestone == MilestoneFields.BulletMilestone;
        var bullets = sa[18]
            .Where(b => Long(b, "Id") is { } id && id != PlaceholderBulletId)
            .Select(b => new Bullet(Long(b, "Id")!.Value, Str(b, "RequirementId"), Str(b, "ReqType"), Str(b, "BulletPoints"), Int(b, "NcCount"),
                bulletsEditable && Int(b, "NcCount") == MilestoneFields.BulletMilestone && editableRequirementIds.Contains(b.Text("RequirementId").Trim())))
            .ToList();

        var trainingEditable = TrainingEditor(ctx);
        List<Dictionary<string, object?>> Trainings(IEnumerable<IDictionary<string, object?>> rows) => rows.Select(t =>
        {
            var d = Pick(t, TrainingFields);
            d["Editable"] = trainingEditable && Int(t, "NcCount") == ctx.Milestone;
            return d;
        }).ToList();

        var attendance = da[20].Select(a =>
        {
            var d = Pick(a, AttendanceFields);
            d["LoginPhotoUrl"] = a.Text("LoginPhotoId1").Length > 0 ? MilestoneFiles.Url(z, level, a.Text("LoginPhotoId")) : null;
            d["LogoutPhotoUrl"] = a.Text("LogoutPhotoId1").Length > 0 ? MilestoneFiles.Url(z, level, a.Text("LogoutPhotoId")) : null;
            return d;
        }).ToList();

        var permissions = new Permissions(
            ctx.CanEdit, fields, bulletsEditable,
            ctx.CanConsultantFinalSubmit, ctx.CoCanReview, ctx.CoCanReview, ctx.CoCanReview);

        return new MilestoneDetails(
            z, level, ctx.Milestone, ctx.Status, ctx.Party.ToString(), CurrentUser.RoleName,
            Pick(da[0], MilestoneRowFields),
            ctx.CoConsultants.Where(c => !string.IsNullOrWhiteSpace(c.CoAssessorId))
                .Select(c => new CoConsultant(c.CoAssessorId!.Trim(), c.WebFinalSubmitStatus == 1, Display(c.WebFinalSubmitDate)?.ToString())).ToList(),
            Pick(sa[19], AllotmentFields),
            Pick(da[3], SectionFields),
            requirements,
            Pick(da[5], OptionFields),
            Pick(da[6], SubOptionFields),
            bullets,
            Trainings(sa[13]),
            Photos(sa[14], z, level, "src"),
            Trainings(sa[15]),
            Photos(sa[16], z, level, "src"),
            Pick(sa[17], BasicInfoFields),
            Meetings(sa[1], sa[2], sa[5], z, level),
            Meetings(sa[3], sa[4], sa[8], z, level),
            Photos(sa[0], z, level, "src"),
            Photos(sa[6], z, level, "src", "PhotoPath"),
            Photos(sa[12], z, level, "PhotoPath", "src"),
            attendance,
            Pick(da[21], ["ConsultantId", "AssessorType"]),
            permissions);
    }

    /// <summary>GET .../files/consultancymobileapi/SaPhotos/{ZedId}/Silver/SiteTour/1.jpg</summary>
    [HttpGet("files/{**path}")]
    public async Task<IActionResult> File(string zedId, string certification, string? path, CancellationToken ct)
    {
        var requested = MilestoneFiles.Normalise(path);
        if (requested is null || !AssessmentInput.IsId(zedId) || !MilestoneFiles.BelongsTo(requested, zedId)) return NotFound();
        var (ctx, error) = await Context(zedId, certification, ct);
        if (error is not null || ctx is null) return NotFound();

        var root = Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));
        var fullPath = MilestoneFiles.StorageCandidates(requested, ctx.ZedId)
            .Select(c => MsmeFilePaths.Resolve(root, c))
            .FirstOrDefault(p => p is not null && System.IO.File.Exists(p));
        if (fullPath is null) return NotFound();

        var fileName = Path.GetFileName(fullPath);
        var contentType = ContentTypes.TryGetContentType(fileName, out var t) ? t : "application/octet-stream";
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = fileName }.ToString();
        return PhysicalFile(fullPath, contentType, enableRangeProcessing: true);
    }

    // ================================================================== edits (replace UpdateColumnData / InsertBullet)

    /// <summary>One allow-listed column of a milestone plan row (MsmeRequirements).</summary>
    [HttpPost("requirements/{id:long}")]
    [StaffRoles(UserRole.Agency, UserRole.DesktopAssessor)]
    public async Task<ActionResult<MessageResponse>> Requirement(string zedId, string certification, long id, FieldRequest req, CancellationToken ct)
    {
        var (ctx, error) = await ForEdit(zedId, certification, ct);
        if (error is not null) return error;
        if (req.Field is null || !MilestoneFields.Requirements.TryGetValue(req.Field.Trim(), out var field)) return this.Problem400("Invalid field.");
        if (field.Milestone != ctx!.Milestone) return Forbidden("This field is not edited in the current milestone.");
        var value = AssessmentInput.Text(req.Value);
        if (value is null) return this.Problem400("Please enter a value.");
        if (value.Length > field.MaxLength) return this.Problem400($"The value must be at most {field.MaxLength} characters.");

        var row = await Item(MilestoneFields.RequirementSql, id, ctx, ct);
        if (row is null || row.NcCount != 1) return NotFound();
        if (!CanTouchSection(ctx, await OwnSectionsAsync(ctx, ct), row.SectionCode)) return Forbidden("This parameter is not allotted to you.");

        await db.ExecuteSqlAsync(field.Sql, Args(ctx, id, value), ct);
        log.LogInformation("{UserId} ({Party}) set MsmeRequirements {Id}.{Column} of {ZedId} {Level} milestone {Milestone}",
            UserId, ctx.Party, id, field.Column, ctx.ZedId, ctx.Level, ctx.Milestone);
        return new MessageResponse("Updated.");
    }

    /// <summary>Adds a bullet to a requirement's baseline diagnostic, action plan or technology intervention list (SP_CONSULTANCY_INSERT_BULLETS).</summary>
    [HttpPost("bullets")]
    [StaffRoles(UserRole.Agency, UserRole.DesktopAssessor)]
    public async Task<ActionResult<MessageResponse>> AddBullet(string zedId, string certification, BulletRequest req, CancellationToken ct)
    {
        var (ctx, error) = await ForEdit(zedId, certification, ct);
        if (error is not null) return error;
        if (ctx!.Milestone != MilestoneFields.BulletMilestone) return Forbidden("These lists are edited in milestone 1 only.");
        if (MilestoneFields.BulletType(req.ReqType) is not { } type) return this.Problem400("Invalid list.");
        var text = BulletText(req.Text, out var problem);
        if (text is null) return this.Problem400(problem!);

        var row = await Item(MilestoneFields.RequirementSql, req.RequirementId, ctx, ct);
        if (row is null || row.NcCount != 1) return NotFound();
        if (!CanTouchSection(ctx, await OwnSectionsAsync(ctx, ct), row.SectionCode)) return Forbidden("This parameter is not allotted to you.");

        await db.ExecuteProcAsync("SP_CONSULTANCY_INSERT_BULLETS", new
        {
            ZedId = AssessmentInput.Ansi(ctx.ZedId),
            Certification = AssessmentInput.Ansi(ctx.Level),
            RequirementId = AssessmentInput.Ansi(row.Id.ToString(CultureInfo.InvariantCulture)),
            ReqType = AssessmentInput.Ansi(type, 200),
            BulletPoints = AssessmentInput.Ansi(text, 2000),
            UserId = AssessmentInput.Ansi(UserId),
        }, ct);
        log.LogInformation("{UserId} ({Party}) added a {Type} bullet to requirement {Id} of {ZedId} {Level}", UserId, ctx.Party, type, row.Id, ctx.ZedId, ctx.Level);
        return new MessageResponse("Added.");
    }

    [HttpPut("bullets/{id:long}")]
    [StaffRoles(UserRole.Agency, UserRole.DesktopAssessor)]
    public async Task<ActionResult<MessageResponse>> EditBullet(string zedId, string certification, long id, TextRequest req, CancellationToken ct)
    {
        var (ctx, bullet, error) = await ForBullet(zedId, certification, id, ct);
        if (error is not null) return error;
        var text = BulletText(req.Text, out var problem);
        if (text is null) return this.Problem400(problem!);
        await db.ExecuteSqlAsync(MilestoneFields.UpdateBulletSql, Args(ctx!, bullet!.Id, text), ct);
        log.LogInformation("{UserId} ({Party}) edited bullet {Id} of {ZedId} {Level}", UserId, ctx!.Party, id, ctx.ZedId, ctx.Level);
        return new MessageResponse("Updated.");
    }

    /// <summary>Soft delete, as SP_CONSULTANCY_UPDATE_COLUMN_VALUE did ('DELETED' appended to the ZED ID and requirement).</summary>
    [HttpDelete("bullets/{id:long}")]
    [StaffRoles(UserRole.Agency, UserRole.DesktopAssessor)]
    public async Task<ActionResult<MessageResponse>> DeleteBullet(string zedId, string certification, long id, CancellationToken ct)
    {
        var (ctx, bullet, error) = await ForBullet(zedId, certification, id, ct);
        if (error is not null) return error;
        await db.ExecuteSqlAsync(MilestoneFields.DeleteBulletSql, Args(ctx!, bullet!.Id, null), ct);
        log.LogInformation("{UserId} ({Party}) deleted bullet {Id} of {ZedId} {Level}", UserId, ctx!.Party, id, ctx.ZedId, ctx.Level);
        return new MessageResponse("Deleted.");
    }

    /// <summary>Remarks of a ZED / handholding training of the current milestone (TrainingInfo.Remarks).</summary>
    [HttpPost("trainings/{id:long}/remarks")]
    [StaffRoles(UserRole.Agency, UserRole.DesktopAssessor)]
    public async Task<ActionResult<MessageResponse>> TrainingRemarks(string zedId, string certification, long id, RemarksRequest req, CancellationToken ct)
    {
        var (ctx, error) = await ForEdit(zedId, certification, ct);
        if (error is not null) return error;
        if (!TrainingEditor(ctx!)) return Forbidden("Training remarks are edited by the lead consultant or the Consultant Organisation.");
        var remarks = AssessmentInput.Text(req.Remarks);
        if (remarks is null) return this.Problem400("Please enter remarks.");
        if (remarks.Length > MilestoneFields.TrainingRemarksMaxLength) return this.Problem400($"Remarks must be at most {MilestoneFields.TrainingRemarksMaxLength} characters.");

        var row = await Item(MilestoneFields.TrainingSql, id, ctx!, ct);
        if (row is null || row.NcCount != ctx!.Milestone) return NotFound();
        await db.ExecuteSqlAsync(MilestoneFields.UpdateTrainingSql, Args(ctx, id, remarks), ct);
        log.LogInformation("{UserId} ({Party}) edited TrainingInfo {Id} remarks of {ZedId} {Level}", UserId, ctx.Party, id, ctx.ZedId, ctx.Level);
        return new MessageResponse("Remarks updated.");
    }

    // ================================================================== consultant final submit (Remote/ConfirmFinalSubmit, FinalSubmit)

    /// <summary>The completeness checks of SP_ASSESSMENT_RA_CONFIRM_FINAL_SUBMIT (bullets, estimated time, rationale, co-consultants).</summary>
    [HttpPost("consultant/check")]
    [StaffRoles(UserRole.DesktopAssessor)]
    public async Task<ActionResult<CheckResponse>> ConsultantCheck(string zedId, string certification, CancellationToken ct)
    {
        var (ctx, error) = await Context(zedId, certification, ct);
        if (error is not null) return error;
        if (!ctx!.CanConsultantFinalSubmit) return Forbidden("Final submit is not available for this milestone in its current status.");
        return await CheckAsync(ctx, ct);
    }

    [HttpPost("consultant/final-submit")]
    [StaffRoles(UserRole.DesktopAssessor)]
    public async Task<ActionResult<MessageResponse>> ConsultantFinalSubmit(string zedId, string certification, RemarksRequest req, CancellationToken ct)
    {
        var remarks = AssessmentInput.Text(req.Remarks);
        if (remarks is null) return this.Problem400("Please enter your final comments.");
        if (remarks.Length > MaxRemarks) return this.Problem400($"Comments must be at most {MaxRemarks} characters.");

        await Decisions.WaitAsync(ct);
        try
        {
            var (ctx, error) = await Context(zedId, certification, ct);
            if (error is not null) return error;
            if (!ctx!.CanConsultantFinalSubmit) return Forbidden("Final submit is not available for this milestone in its current status.");
            var check = await CheckAsync(ctx, ct);
            if (!check.Allowed) return this.Problem400(check.Message);

            await db.ExecuteProcAsync("SP_ASSESSMENT_RA_FINAL_SUBMIT", new
            {
                ZedId = AssessmentInput.Ansi(ctx.ZedId),
                CertificationType = AssessmentInput.Ansi(ctx.Level),
                AssessorRemarks = AssessmentInput.Ansi(remarks, 5000),
                UserId = AssessmentInput.Ansi(UserId),
            }, ct);
            log.LogInformation("{UserId} ({Party}) final-submitted milestone {Milestone} of {ZedId} {Level}", UserId, ctx.Party, ctx.Milestone, ctx.ZedId, ctx.Level);
            return new MessageResponse(ctx.Party == MilestoneParty.Lead
                ? "Milestone submitted to the Consultant Organisation."
                : "Your part of the milestone is submitted. The lead consultant submits the milestone.");
        }
        finally
        {
            Decisions.Release();
        }
    }

    // ================================================================== CO decisions (Monitoring/RaFinalSubmit, SendBackToAssessor, RejectFinalSubmit)

    /// <summary>Completes the milestone (15 → 16) and mails the milestone report to the MSME, who accepts it on main.</summary>
    [HttpPost("final-submit")]
    [StaffRoles(UserRole.Agency)]
    public async Task<ActionResult<MessageResponse>> FinalSubmit(string zedId, string certification, ConfirmRequest req, CancellationToken ct)
    {
        if (!req.Confirmed) return this.Problem400("Please confirm the review of the milestone before final submit.");
        MilestoneContext ctx;
        await Decisions.WaitAsync(ct);
        try
        {
            var (c, error) = await ForDecision(zedId, certification, ct);
            if (error is not null) return error;
            ctx = c!;
            await db.ExecuteProcAsync("SP_MONITORING_RA_FINAL_SUBMIT", new
            {
                UserId = AssessmentInput.Ansi(UserId),
                ZedId = AssessmentInput.Ansi(ctx.ZedId),
                CertificationType = AssessmentInput.Ansi(ctx.Level),
                QrCodeSeqNo = AssessmentInput.Ansi(RandomNumberGenerator.GetString(QrChars, 4)),
            }, ct);
            log.LogInformation("CO {UserId} completed milestone {Milestone} of {ZedId} {Level}", UserId, ctx.Milestone, ctx.ZedId, ctx.Level);
        }
        finally
        {
            Decisions.Release();
        }

        var outcome = await MilestoneCompletion.Create(HttpContext.RequestServices).CompletedAsync(ctx.ZedId, ctx.Level, ctx.Milestone, ct);
        return new MessageResponse(
            outcome.MailSent && outcome.ReportAttached ? $"Milestone {ctx.Milestone} completed. The milestone report has been mailed to the MSME."
            : outcome.MailSent ? $"Milestone {ctx.Milestone} completed. The MSME has been informed; the report could not be generated now."
            : $"Milestone {ctx.Milestone} completed. The mail to the MSME could not be sent.");
    }

    /// <summary>Back to the consultants (15 → 13).</summary>
    [HttpPost("send-back")]
    [StaffRoles(UserRole.Agency)]
    public async Task<ActionResult<MessageResponse>> SendBack(string zedId, string certification, RemarksRequest req, CancellationToken ct)
    {
        var remarks = AssessmentInput.Text(req.Remarks);
        if (remarks is null) return this.Problem400("Please enter the send back remarks.");
        if (remarks.Length > MaxRemarks) return this.Problem400($"Remarks must be at most {MaxRemarks} characters.");
        await Decisions.WaitAsync(ct);
        try
        {
            var (ctx, error) = await ForDecision(zedId, certification, ct);
            if (error is not null) return error;
            await db.ExecuteProcAsync("SP_MONITORING_SEND_BACK_TO_ASSESSOR", new
            {
                ZedId = AssessmentInput.Ansi(ctx!.ZedId, 100),
                UserId = AssessmentInput.Ansi(UserId),
                RoleId = AssessmentInput.Ansi(RoleId.ToString(CultureInfo.InvariantCulture)),
                CertificationType = AssessmentInput.Ansi(ctx.Level),
                SendBackRemarks = AssessmentInput.Ansi(remarks, 2000),
            }, ct);
            log.LogInformation("CO {UserId} sent milestone {Milestone} of {ZedId} {Level} back to the consultant", UserId, ctx.Milestone, ctx.ZedId, ctx.Level);
            return new MessageResponse("Sent back to the consultant.");
        }
        finally
        {
            Decisions.Release();
        }
    }

    /// <summary>
    /// Rejects the unit's handholding (status 99, the level's payment flag cleared: SP_MONITORING_REJECT_FINAL_SUBMIT),
    /// mails the MSME with the reject report, and archives the rows (SP_MONITORING_REJECT_CERTIFICATION, ZedId_D).
    /// </summary>
    [HttpPost("reject")]
    [StaffRoles(UserRole.Agency)]
    public async Task<ActionResult<MessageResponse>> Reject(string zedId, string certification, ConfirmRequest req, CancellationToken ct)
    {
        if (!req.Confirmed) return this.Problem400("Please confirm the rejection.");
        await Decisions.WaitAsync(ct);
        try
        {
            var (ctx, error) = await ForDecision(zedId, certification, ct);
            if (error is not null) return error;
            var completion = MilestoneCompletion.Create(HttpContext.RequestServices);
            var args = new
            {
                UserId = AssessmentInput.Ansi(UserId),
                ZedId = AssessmentInput.Ansi(ctx!.ZedId),
                CertificationType = AssessmentInput.Ansi(ctx.Level),
                RoleId = AssessmentInput.Ansi(RoleId.ToString(CultureInfo.InvariantCulture)),
            };
            await db.ExecuteProcAsync("SP_MONITORING_REJECT_FINAL_SUBMIT", args, ct);
            log.LogInformation("CO {UserId} rejected {ZedId} {Level} at milestone {Milestone}", UserId, ctx.ZedId, ctx.Level, ctx.Milestone);

            // The report and the mail details are read before the rows are renamed (as the old action did).
            var report = await completion.ReportAsync(ctx.ZedId, ctx.Level, ctx.Milestone, ct);
            var details = await completion.DetailsAsync(ctx.ZedId, ctx.Level, ct);
            var archived = true;
            try
            {
                await db.ExecuteProcAsync("SP_MONITORING_REJECT_CERTIFICATION", args, ct);
            }
            catch (Microsoft.Data.SqlClient.SqlException ex)
            {
                log.LogError(ex, "{ZedId} {Level} rejected but its records could not be archived", ctx.ZedId, ctx.Level);
                archived = false;
            }
            var mailed = await completion.RejectedAsync(ctx.ZedId, ctx.Level, ctx.Milestone, details, report, ct);
            if (!archived) return this.Problem400("The handholding was rejected, but its records could not be archived. Please contact the ZED team.");
            return new MessageResponse(mailed ? "Handholding rejected. The MSME has been informed." : "Handholding rejected. The mail to the MSME could not be sent.");
        }
        finally
        {
            Decisions.Release();
        }
    }

    // ================================================================== helpers

    private ObjectResult Forbidden(string message) => Problem(title: message, statusCode: StatusCodes.Status403Forbidden);

    private static string? Level(string? value) => Levels.FirstOrDefault(l => string.Equals(l, value?.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>400 for malformed input, 404 when the unit is unknown or the user has no part in its current milestone.</summary>
    private async Task<(MilestoneContext? Ctx, ActionResult? Error)> Context(string zedId, string certification, CancellationToken ct)
    {
        var level = Level(certification);
        if (!AssessmentInput.IsId(zedId) || level is null) return (null, this.Problem400("Invalid request."));
        var ctx = await MilestoneContext.LoadAsync(db, CurrentUser, zedId, level, ct);
        if (ctx is null || ctx.Party == MilestoneParty.None) return (null, NotFound());
        return (ctx, null);
    }

    private async Task<(MilestoneContext? Ctx, ActionResult? Error)> ForEdit(string zedId, string certification, CancellationToken ct)
    {
        var (ctx, error) = await Context(zedId, certification, ct);
        if (error is not null) return (null, error);
        return ctx!.CanEdit ? (ctx, null) : (null, Forbidden("The milestone cannot be edited in its current status."));
    }

    private async Task<(MilestoneContext? Ctx, ActionResult? Error)> ForDecision(string zedId, string certification, CancellationToken ct)
    {
        var (ctx, error) = await Context(zedId, certification, ct);
        if (error is not null) return (null, error);
        return ctx!.CoCanReview ? (ctx, null) : (null, Forbidden("This action is not available for the milestone in its current status."));
    }

    private async Task<(MilestoneContext? Ctx, MilestoneItem? Bullet, ActionResult? Error)> ForBullet(string zedId, string certification, long id, CancellationToken ct)
    {
        var (ctx, error) = await ForEdit(zedId, certification, ct);
        if (error is not null) return (null, null, error);
        if (ctx!.Milestone != MilestoneFields.BulletMilestone) return (null, null, Forbidden("These lists are edited in milestone 1 only."));
        if (id == PlaceholderBulletId) return (null, null, NotFound());
        var bullet = await Item(MilestoneFields.BulletSql, id, ctx, ct);
        if (bullet is null || bullet.NcCount != MilestoneFields.BulletMilestone || MilestoneFields.BulletType(bullet.ReqType) is null) return (null, null, NotFound());
        if (!long.TryParse(bullet.RequirementId?.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var reqId)) return (null, null, NotFound());
        var requirement = await Item(MilestoneFields.RequirementSql, reqId, ctx, ct);
        if (requirement is null || requirement.NcCount != 1) return (null, null, NotFound());
        if (!CanTouchSection(ctx, await OwnSectionsAsync(ctx, ct), requirement.SectionCode))
            return (null, null, Forbidden("This parameter is not allotted to you."));
        return (ctx, bullet, null);
    }

    /// <summary>Lead consultant (while editing is open) or the CO in its review; co-consultants did not edit trainings on the old page.</summary>
    private static bool TrainingEditor(MilestoneContext ctx) =>
        (ctx.ConsultantCanEdit && ctx.Party == MilestoneParty.Lead) || ctx.CoCanReview;

    /// <summary>A co-consultant edits the parameters of its own sections only; the lead and the CO edit all of them.</summary>
    private static bool CanTouchSection(MilestoneContext ctx, IReadOnlySet<string> own, string? sectionCode) =>
        ctx.Party != MilestoneParty.CoConsultant || (sectionCode is not null && own.Contains(sectionCode.Trim()));

    private async Task<IReadOnlySet<string>> OwnSectionsAsync(MilestoneContext ctx, CancellationToken ct)
    {
        if (ctx.Party != MilestoneParty.CoConsultant) return new HashSet<string>();
        var rows = await db.QuerySqlAsync<MilestoneItem>(MilestoneContext.OwnSectionsSql, new
        {
            ZedId = AssessmentInput.Ansi(ctx.ZedId),
            Certification = AssessmentInput.Ansi(ctx.Level),
            NcCount = ctx.Milestone,
            UserId = AssessmentInput.Ansi(ctx.User.UserId),
        }, ct);
        return rows.Where(r => !string.IsNullOrWhiteSpace(r.SectionCode)).Select(r => r.SectionCode!.Trim()).ToHashSet(StringComparer.Ordinal);
    }

    private async Task<MilestoneItem?> Item(string sql, long id, MilestoneContext ctx, CancellationToken ct) =>
        (await db.QuerySqlAsync<MilestoneItem>(sql, new { Id = id, ZedId = AssessmentInput.Ansi(ctx.ZedId), Certification = AssessmentInput.Ansi(ctx.Level) }, ct)).FirstOrDefault();

    private static object Args(MilestoneContext ctx, long id, string? value) => new
    {
        Value = AssessmentInput.Ansi(value, 5000),
        Id = id,
        ZedId = AssessmentInput.Ansi(ctx.ZedId),
        Certification = AssessmentInput.Ansi(ctx.Level),
    };

    private async Task<CheckResponse> CheckAsync(MilestoneContext ctx, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_ASSESSMENT_RA_CONFIRM_FINAL_SUBMIT", new
        {
            ZedId = AssessmentInput.Ansi(ctx.ZedId),
            CertificationType = AssessmentInput.Ansi(ctx.Level),
            UserId = AssessmentInput.Ansi(UserId),
        }, ct);
        var row = sets[0].FirstOrDefault();
        var allowed = row?.Text("AllowFinalSubmit") == "1";
        var message = row?.Text("ErrorMessage") is { Length: > 0 } m ? m : allowed ? "" : "Final submit is not possible yet. Please review the milestone.";
        return new CheckResponse(allowed, message);
    }

    private static string? BulletText(string? value, out string? problem)
    {
        problem = null;
        var text = AssessmentInput.Text(value);
        if (text is null) problem = "Please enter the text.";
        else if (text.Length > MilestoneFields.BulletMaxLength) problem = $"The text must be at most {MilestoneFields.BulletMaxLength} characters.";
        return problem is null ? text : null;
    }

    private static List<Meeting> Meetings(IEnumerable<IDictionary<string, object?>> meetings, IReadOnlyList<IDictionary<string, object?>> participants,
        IReadOnlyList<IDictionary<string, object?>> photos, string zedId, string level) =>
        meetings.Select(m => new Meeting(Long(m, "Id"), Int(m, "NcCount"), Str(m, "Comments"),
            Photos(photos.Where(p => SameText(p, "NcCount", m, "NcCount")), zedId, level, "src", "PhotoPath"),
            Pick(participants.Where(p => SameText(p, "NcCount", m, "NcCount")), ["Name", "Designation"]))).ToList();

    private static List<Photo> Photos(IEnumerable<IDictionary<string, object?>> rows, string zedId, string level, params string[] columns) =>
        rows.Select(r => new Photo(Long(r, "Id"), Str(r, "name") ?? Str(r, "Name"),
            columns.Select(c => MilestoneFiles.Url(zedId, level, r.Text(c))).FirstOrDefault(u => u is not null),
            Str(r, "CreatedDate"), Int(r, "NcCount"))).ToList();

    private static bool SameText(IDictionary<string, object?> a, string columnA, IDictionary<string, object?> b, string columnB)
    {
        var x = a.Text(columnA).Trim();
        return x.Length > 0 && string.Equals(x, b.Text(columnB).Trim(), StringComparison.Ordinal);
    }

    private static long? Long(IDictionary<string, object?> row, string column) =>
        long.TryParse(row.Text(column), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : null;

    private static int? Int(IDictionary<string, object?> row, string column) =>
        int.TryParse(row.Text(column), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : null;

    private static string? Str(IDictionary<string, object?> row, string column) =>
        row.TryGetValue(column, out var v) ? Display(v)?.ToString() : null;

    private static Dictionary<string, object?> Pick(IDictionary<string, object?> row, string[] fields) =>
        fields.ToDictionary(f => f, f => row.TryGetValue(f, out var v) ? Display(v) : null);

    private static List<Dictionary<string, object?>> Pick(IEnumerable<IDictionary<string, object?>> rows, string[] fields) =>
        rows.Select(r => Pick(r, fields)).ToList();

    private static object? Display(object? value) => value switch
    {
        null or DBNull => null,
        DateTime d => d.ToString("MMMM dd, yyyy hh:mm tt", CultureInfo.InvariantCulture),
        TimeSpan t => t.ToString(@"hh\:mm\:ss", CultureInfo.InvariantCulture),
        _ => value,
    };
}
