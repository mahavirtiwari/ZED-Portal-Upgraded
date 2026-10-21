using System.Globalization;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Staff.Monitoring;

/// <summary>
/// The agency and master-admin review actions of the desktop (DaDetails) and site (SaDetails)
/// assessment pages. Port of MonitoringController UpdateRemarks (SP_MONITORING_UPDATE_AGENCY_REMARKS),
/// FinalSubmit (SP_MONITORING_DA_FINAL_SUBMIT), RaFinalSubmit (SP_MONITORING_RA_FINAL_SUBMIT),
/// SendBackToAssessor (SP_MONITORING_SEND_BACK_TO_ASSESSOR), RejectFinalSubmit
/// (SP_MONITORING_REJECT_FINAL_SUBMIT + SP_MONITORING_REJECT_CERTIFICATION) and of the
/// two agency actions SaDetails called on RemoteController: UpdateRemarks
/// (SP_MONITORING_RA_UPDATE_AGENCY_REMARKS) and UpdateComments for OFI comments (SP_ASSESSMENT_RA_UPDATE_COMMENTS).
/// <para>
/// The old actions required only a sign-in (any role, MSMEs included: SECURITY-FINDINGS #32) and took the
/// ZED ID, table name and row id from the browser. Here the role, sub-role, allotment and record state
/// are checked with <see cref="ReviewRules"/>; the page (desktop or site) follows from the record's status;
/// the table is chosen on the server from the kind of item, and the row must belong to the ZED ID and
/// certification.
/// </para>
/// </summary>
[Route("api/staff/monitoring/review/{zedId}/{certification}")]
public sealed class MonitoringReviewController(ISqlExecutor db, ILogger<MonitoringReviewController> log) : StaffApiController
{
    private const int MaxText = 2000;
    private const string QrChars = "123456789abcdefghijklmnopqrstuvwxyz";

    // Look-ups of the rows the SA page edits that AssessmentRecords does not cover.
    public const string MeetingSql =
        "SELECT TOP 1 CAST(Id AS bigint) AS Id FROM Meetings WHERE Id = @Id AND ZedId = @ZedId AND CertificationType = @Certification";
    public const string SaPhotoSql =
        "SELECT TOP 1 CAST(Id AS bigint) AS Id, NcCount FROM SaPhotos WHERE Id = @Id AND ZedId = @ZedId AND Certification = @Certification";
    public const string AssessorCommentSql =
        "SELECT TOP 1 CAST(Id AS bigint) AS Id, NcCount FROM AssessorComments WHERE Id = @Id AND ZedId = @ZedId AND Certification = @Certification";
    public const string AnyPhotoSql =
        "SELECT TOP 1 CAST(Id AS bigint) AS Id, NcCount FROM MsmePhotos WHERE Id = @Id AND ZedId = @ZedId AND Certification = @Certification";

    public sealed record RemarksRequest(string? Kind, long Id, string? Remarks);

    public sealed record OfiRequest(long SectionId, string? Comments);

    public sealed record FinalSubmitRequest(bool ExemptionsReviewed, bool QualityChecked);

    public sealed record SendBackRequest(string? Remarks);

    public sealed record RejectRequest(bool Confirmed);

    // ------------------------------------------------------------------ remarks

    /// <summary>
    /// Agency remarks on an assessor finding. Desktop page kinds: product, requirement, photo (site
    /// exterior). Site page kinds: product, requirement, photo (SA site exterior of an NC round), meeting,
    /// summary (assessor final remarks) and nc-comments (assessor comments of an NC round).
    /// </summary>
    [HttpPost("remarks")]
    [StaffRoles(UserRole.Agency)]
    public async Task<ActionResult<MessageResponse>> Remarks(string zedId, string certification, RemarksRequest req, CancellationToken ct)
    {
        var (level, record, stage, error) = await ForAction(zedId, certification, a => a.EditRemarks, ct);
        if (error is not null) return error;
        var remarks = AssessmentInput.Text(req.Remarks);
        if (remarks is null) return this.Problem400("Please enter remarks.");
        if (remarks.Length > MaxText) return this.Problem400($"Remarks must be at most {MaxText} characters.");

        var desktop = stage == ReviewStage.Desktop;
        var (table, sql) = (req.Kind?.Trim().ToLowerInvariant(), desktop) switch
        {
            ("product", _) => ("MsmeProducts", AssessmentRecords.ProductSql),
            ("requirement", _) => ("MsmeRequirements", AssessmentRecords.RequirementSql),
            ("photo", true) => ("MsmePhotos", AnyPhotoSql),
            ("photo", false) => ("SaPhotos", SaPhotoSql),
            ("meeting", false) => ("Meetings", MeetingSql),
            ("nc-comments", false) => ("AssessorComments", AssessorCommentSql),
            ("summary", false) => ("MsmeCertifications", (string?)null),
            _ => ((string?)null, (string?)null),
        };
        if (table is null) return this.Problem400("Invalid request.");
        if (sql is not null && await AssessmentRecords.ItemAsync(db, sql, req.Id, zedId, level!, ct) is null) return NotFound();

        await db.ExecuteProcAsync(desktop ? "SP_MONITORING_UPDATE_AGENCY_REMARKS" : "SP_MONITORING_RA_UPDATE_AGENCY_REMARKS", new
        {
            UserId,
            ZedId = zedId,
            CertificationType = level,
            TableName = table,
            Id = sql is null ? null : req.Id.ToString(CultureInfo.InvariantCulture),
            Remarks = remarks,
        }, ct);
        log.LogInformation("Agency {UserId} edited {Table} {Id} remarks of {ZedId} {Certification}", UserId, table, req.Id, zedId, level);
        return new MessageResponse("Remarks updated.");
    }

    /// <summary>OFI comments of a parameter on the site assessment page (RemoteController.UpdateComments, MsmeSections).</summary>
    [HttpPost("ofi-comments")]
    [StaffRoles(UserRole.Agency)]
    public async Task<ActionResult<MessageResponse>> OfiComments(string zedId, string certification, OfiRequest req, CancellationToken ct)
    {
        var (level, _, stage, error) = await ForAction(zedId, certification, a => a.EditRemarks, ct);
        if (error is not null) return error;
        if (stage != ReviewStage.Site) return Forbidden("OFI comments are edited on the site assessment only.");
        var comments = AssessmentInput.Text(req.Comments);
        if (comments is null) return this.Problem400("Please enter OFI comments.");
        if (comments.Length > MaxText) return this.Problem400($"OFI comments must be at most {MaxText} characters.");
        var section = await AssessmentRecords.ItemAsync(db, AssessmentRecords.SectionSql, req.SectionId, zedId, level!, ct);
        if (section is null || (section.NcCount ?? 0) != 0) return NotFound();

        await db.ExecuteProcAsync("SP_ASSESSMENT_RA_UPDATE_COMMENTS", new
        {
            ZedId = zedId,
            Certification = level,
            Id = req.SectionId.ToString(CultureInfo.InvariantCulture),
            Comments = comments,
            TableName = "MsmeSections",
        }, ct);
        return new MessageResponse("OFI comments updated.");
    }

    // ------------------------------------------------------------------ final submit / send back / reject

    /// <summary>
    /// Agency final submit. Desktop (status 5): completes the desktop verification; Bronze is certified
    /// (certificate and mail). Site (status 15): certifies Silver/Gold (certificate and mail).
    /// </summary>
    [HttpPost("final-submit")]
    [StaffRoles(UserRole.Agency)]
    public async Task<ActionResult<MessageResponse>> FinalSubmit(string zedId, string certification, FinalSubmitRequest req, CancellationToken ct)
    {
        var (level, _, stage, error) = await ForAction(zedId, certification, a => a.FinalSubmit, ct);
        if (error is not null) return error;
        var desktop = stage == ReviewStage.Desktop;
        if (!req.QualityChecked || (desktop && !req.ExemptionsReviewed))
            return this.Problem400("Please confirm the review of the assessment before final submit.");

        var qr = RandomNumberGenerator.GetString(QrChars, 4);
        await db.ExecuteProcAsync(desktop ? "SP_MONITORING_DA_FINAL_SUBMIT" : "SP_MONITORING_RA_FINAL_SUBMIT",
            new { UserId, ZedId = zedId, CertificationType = level, QrCodeSeqNo = qr }, ct);
        log.LogInformation("Agency {UserId} final-submitted the {Stage} review of {ZedId} {Certification}", UserId, stage, zedId, level);

        // Silver/Gold desktop verification only moves on to the site assessment (the old code mailed Bronze only).
        if (desktop && level != "Bronze") return new MessageResponse("Desktop verification completed.");

        var outcome = await CertificationCompletion.Create(HttpContext.RequestServices).CertifyAsync(zedId, level!, ct);
        return new MessageResponse(
            !outcome.CertificateIssued ? "Certification completed. The certificate could not be generated now; please ask the ZED team to regenerate it."
            : outcome.MailSent ? "Certification completed. The certificate has been mailed to the MSME."
            : "Certification completed. The certificate is generated but could not be mailed.");
    }

    /// <summary>
    /// Send back to the assessor: from the quality check (status 5 / 15) to the assessor, or from a rejection
    /// (status 7 / 17) into the last NC round (SP_MONITORING_SEND_BACK_TO_ASSESSOR decides which).
    /// </summary>
    [HttpPost("send-back")]
    [StaffRoles(UserRole.Agency, UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> SendBack(string zedId, string certification, SendBackRequest req, CancellationToken ct)
    {
        var (level, _, _, error) = await ForAction(zedId, certification, a => a.SendBack, ct);
        if (error is not null) return error;
        var remarks = AssessmentInput.Text(req.Remarks);
        if (remarks is null) return this.Problem400("Please enter the send back remarks.");
        if (remarks.Length > MaxText) return this.Problem400($"Remarks must be at most {MaxText} characters.");

        await db.ExecuteProcAsync("SP_MONITORING_SEND_BACK_TO_ASSESSOR", new
        {
            ZedId = zedId,
            UserId,
            RoleId = RoleId.ToString(CultureInfo.InvariantCulture),
            CertificationType = level,
            SendBackRemarks = remarks,
        }, ct);
        log.LogInformation("{UserId} sent {ZedId} {Certification} back to the assessor", UserId, zedId, level);
        return new MessageResponse("Sent back to the assessor.");
    }

    /// <summary>
    /// Agency confirms the rejection of a unit that failed its NCs (status 7 / 17): the level becomes unpaid,
    /// the MSME is told, and the records are archived under the rejected ZED ID (ZedId_D_{Id}).
    /// </summary>
    [HttpPost("reject")]
    [StaffRoles(UserRole.Agency)]
    public async Task<ActionResult<MessageResponse>> Reject(string zedId, string certification, RejectRequest req, CancellationToken ct)
    {
        var (level, _, _, error) = await ForAction(zedId, certification, a => a.Reject, ct);
        if (error is not null) return error;
        if (!req.Confirmed) return this.Problem400("Please confirm the rejection.");

        await db.ExecuteProcAsync("SP_MONITORING_REJECT_FINAL_SUBMIT", new { UserId, ZedId = zedId, CertificationType = level }, ct);
        log.LogInformation("Agency {UserId} rejected {ZedId} {Certification}", UserId, zedId, level);

        var completion = CertificationCompletion.Create(HttpContext.RequestServices);
        var details = await completion.RejectionDetailsAsync(zedId, level!, ct);
        var archived = true;
        try
        {
            await db.ExecuteProcAsync("SP_MONITORING_REJECT_CERTIFICATION", new { UserId, ZedId = zedId, CertificationType = level }, ct);
        }
        catch (Microsoft.Data.SqlClient.SqlException ex)
        {
            // The procedure forces an error when its renaming transaction fails; the rejection itself is saved.
            log.LogError(ex, "{ZedId} {Certification} rejected but its records could not be archived", zedId, level);
            archived = false;
        }
        var mailed = await completion.SendRejectionAsync(zedId, level!, details, ct);

        if (!archived) return this.Problem400("The certification was rejected, but its records could not be archived. Please contact the ZED team.");
        return new MessageResponse(mailed ? "Certification rejected. The MSME has been informed." : "Certification rejected. The mail to the MSME could not be sent.");
    }

    // ------------------------------------------------------------------ helpers

    private ObjectResult Forbidden(string message) => Problem(title: message, statusCode: StatusCodes.Status403Forbidden);

    /// <summary>
    /// The record and its review page for an action: 400 for malformed input, 404 when the user may not see
    /// the record (another agency's), 403 when the action is not available to the user in the record's state.
    /// </summary>
    private async Task<(string? Level, CertificationRecord? Record, ReviewStage Stage, ActionResult? Error)> ForAction(
        string zedId, string certification, Func<ReviewActions, bool> action, CancellationToken ct)
    {
        var level = AssessmentInput.Level(certification);
        if (!AssessmentInput.IsId(zedId) || level is null) return (null, null, default, this.Problem400("Invalid request."));
        var record = await AssessmentRecords.CertificationAsync(db, zedId, level, ct);
        var user = CurrentUser;
        if (record is null || !record.CanView(user)) return (level, null, default, NotFound());
        if (ReviewRules.StageOf(record) is not { } stage || !action(ReviewRules.For(user, record, stage)))
            return (level, record, default, Forbidden("This action is not available for the assessment in its current status."));
        return (level, record, stage, null);
    }
}
