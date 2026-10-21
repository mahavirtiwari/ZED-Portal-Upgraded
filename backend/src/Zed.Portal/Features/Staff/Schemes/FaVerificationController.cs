using System.Data;
using System.Data.Common;
using System.Globalization;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Staff.Schemes;

/// <summary>
/// Verification of one MSME's financial assistance application (Views/FinancialAssistance/Verification.cshtml):
/// the documents, the assessor's validation of each document (with a screenshot of the online check),
/// the final decisions of the assessor and of the agency, and the bank account of the reimbursement.
/// Port of FinancialAssistanceController.GetDetails / SaveTimestamp / ValidateEvidence / FinalSubmit /
/// UpdateAccountDetails.
/// <para>
/// Legacy problems fixed here: those actions only required a sign-in (any user, an MSME included, could
/// read any application with its bank details, change the bank account the reimbursement is paid to,
/// validate documents or approve an application); the browser chose the row, the status and the role
/// effect; uploaded file names were used as is (path traversal, any file type, only the first file's
/// content was saved under every name); documents were public files on the old site.
/// Now: only the master admin, the allotted agency and the assigned assessor can open an application,
/// each action is allowed only to the role and at the status it belongs to, and files are served
/// through this controller.
/// </para>
/// </summary>
[Route("api/staff/schemes/fa")]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency, UserRole.DesktopAssessor)]
[SubRole(SubRoles.FinancialVerification)]
public sealed partial class FaVerificationController(
    ISqlExecutor db,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    IOptions<EmailOptions> emailOptions,
    ILogger<FaVerificationController> log) : StaffApiController
{
    public const long MaxScreenshotBytes = 2 * 1024 * 1024;
    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    public static readonly string[] DetailColumns =
    [
        "Id", "ZedId", "CertificationType", "VerificationStatus", "IsApproved",
        "CategoryOfCertificate", "NameOfCertficate", "CertificationAgency", "CertficateNumber", "DateOfIssue", "ValidityOfCertificate",
        "AnyOtherInformation", "ExpenditureCertficate", "AgencyOrSupplier", "InvoiceNo", "InvoiceBillDate", "AmountPaid", "EligibleAmount",
        "ModeOfPayment", "AccountNo", "IfscCode", "BranchAddress", "BankName", "CertificationBodyUserId", "FinancialAssessorId",
        "ReasonForRejection", "ReasonForRejectionAgency", "CreatedDate",
    ];

    public sealed record ScreenshotDto(int Id, string FileName, string Url);

    public sealed record DocumentDto(
        int Id, string? PhotoType, string? Name, string? TimeStamp, bool IsPdf, string Url, bool Opened,
        string? IsVerified, string? SourceOfValidation, string? AssessorRemarks, IReadOnlyList<ScreenshotDto> Screenshots);

    public sealed record ApplicationDto(
        string Certification, Dictionary<string, object?> Details, IReadOnlyList<DocumentDto> Documents,
        bool CanValidate, bool CanDecide, bool CanEditAccount);

    /// <summary>GET api/staff/schemes/fa/{zedId} — the applications of the unit this user may see.</summary>
    [HttpGet("{zedId}")]
    public async Task<ActionResult<IReadOnlyList<ApplicationDto>>> Details(string zedId, CancellationToken ct)
    {
        if (!SchemeRows.IsZedId(zedId)) return NotFound();
        var user = CurrentUser;
        var apps = (await FaApplications.LoadAsync(db, zedId, ct)).Where(a => a.CanView(user)).ToList();
        if (apps.Count == 0) return NotFound();
        return apps.Select(a => ToDto(a, user)).ToList();
    }

    /// <summary>
    /// GET api/staff/schemes/fa/{zedId}/{certification}/documents/{id} — a document uploaded by the MSME.
    /// When the assigned assessor opens it, the time is recorded (SP_FINANCIAL_ASSISTANCE_UPDATE_TIMESTAMP),
    /// which the legacy page required before a document could be validated.
    /// </summary>
    [HttpGet("{zedId}/{certification}/documents/{id:int}")]
    public async Task<IActionResult> Document(string zedId, string certification, int id, CancellationToken ct)
    {
        var app = await Viewable(zedId, certification, ct);
        if (app?.Photo(id) is not { } photo || FaFilePaths.FileName(photo.Text("PhotoId")) is not { } file) return NotFound();

        var path = Resolve(FaFilePaths.DocumentCandidates(app.ZedId, file));
        if (path is null)
        {
            log.LogInformation("FA document {File} of {ZedId} is missing from storage", file, app.ZedId);
            return NotFound();
        }

        if (app.CanValidate(CurrentUser) && string.IsNullOrEmpty(photo.Text("DocumentOpenedTime")))
        {
            try
            {
                await db.ExecuteProcAsync("SP_FINANCIAL_ASSISTANCE_UPDATE_TIMESTAMP",
                    new { CertificationType = app.Certification, ZedId = app.ZedId, Id = id.ToString(CultureInfo.InvariantCulture) }, ct);
            }
            catch (DbException ex) { log.LogError(ex, "SP_FINANCIAL_ASSISTANCE_UPDATE_TIMESTAMP failed for {ZedId}/{Id}", app.ZedId, id); }
        }
        return Serve(path);
    }

    /// <summary>GET api/staff/schemes/fa/{zedId}/{certification}/screenshots/{id} — an assessor's validation screenshot.</summary>
    [HttpGet("{zedId}/{certification}/screenshots/{id:int}")]
    public async Task<IActionResult> Screenshot(string zedId, string certification, int id, CancellationToken ct)
    {
        var app = await Viewable(zedId, certification, ct);
        var shot = app?.Screenshots.FirstOrDefault(s => SchemeRows.Int(s, "Id") == id);
        if (app is null || shot is null || FaFilePaths.FileName(shot.Text("FileName")) is not { } file) return NotFound();
        var path = Resolve([$"{FaFilePaths.ScreenshotFolder(app.ZedId, app.Certification)}/{file}"]);
        return path is null ? NotFound() : Serve(path);
    }

    /// <summary>
    /// POST api/staff/schemes/fa/{zedId}/{certification}/documents/{id}/validation (multipart: isVerified Yes/No,
    /// sourceOfValidation, remarks, file) — SP_FINANCIAL_ASSISTANCE_VALIDATE_EVIDENCES, by the assigned assessor.
    /// </summary>
    [HttpPost("{zedId}/{certification}/documents/{id:int}/validation")]
    [RequestSizeLimit(MaxScreenshotBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxScreenshotBytes + 64 * 1024)]
    public async Task<ActionResult<MessageResponse>> Validate(string zedId, string certification, int id,
        [FromForm] string? isVerified, [FromForm] string? sourceOfValidation, [FromForm] string? remarks, IFormFile? file, CancellationToken ct)
    {
        if (isVerified is not ("Yes" or "No")) return this.Problem400("Please select whether the document is verified.");
        var source = SchemeRows.CleanText(sourceOfValidation, 200);
        if (sourceOfValidation?.Trim().Length > 200) return this.Problem400("Source of validation can be up to 200 characters.");
        var note = SchemeRows.CleanText(remarks, 1000);
        if (remarks?.Trim().Length > 1000) return this.Problem400("Remarks can be up to 1000 characters.");
        if (isVerified == "No" && note is null) return this.Problem400("Please enter the remarks.");

        string? upload = null;
        if (file is not null)
        {
            if (await UploadKind(file, ct) is not { } ext) return this.Problem400("Please upload valid document (PDF / JPG / PNG, less than 2 MB).");
            upload = ext;
        }

        using (await SchemeLocks.EnterAsync(ct))
        {
            var app = await Viewable(zedId, certification, ct);
            if (app is null) return NotFound();
            var photo = app.Photo(id);
            if (photo is null) return NotFound();
            if (!app.CanValidate(CurrentUser)) return Forbid();
            if (string.IsNullOrEmpty(photo.Text("DocumentOpenedTime"))) return this.Problem400("Please view the document before validating it.");

            var isCertificate = string.Equals(photo.Text("PhotoType"), "Copy of Certificate", StringComparison.OrdinalIgnoreCase);
            var existing = app.ScreenshotsOf(id).Select(s => FaFilePaths.FileName(s.Text("FileName"))).LastOrDefault(n => n is not null);
            if (isVerified == "Yes" && isCertificate)
            {
                if (source is null) return this.Problem400("Please enter the source of validation.");
                if (upload is null && existing is null) return this.Problem400("Please upload valid pdf document.");
            }

            // Server-generated name; the folder is built from validated values only.
            string? savedName = null, savedPath = null;
            if (upload is not null)
            {
                savedName = $"{DateTime.Now:yyyyMMddHHmmssfff}_{id}{upload}";
                var folder = MsmeFilePaths.Resolve(StorageRoot, FaFilePaths.ScreenshotFolder(app.ZedId, app.Certification) + "/" + savedName);
                if (folder is null) return this.Problem400("Invalid application.");
                Directory.CreateDirectory(Path.GetDirectoryName(folder)!);
                savedPath = folder;
                await using var stream = System.IO.File.Create(savedPath);
                await file!.CopyToAsync(stream, ct);
            }

            // The procedure overwrites the screenshot name with the one passed (NULL when none): keep the
            // existing one when no new file is sent, which the legacy page did not.
            var table = new DataTable();
            table.Columns.Add("FileName", typeof(string));
            if ((savedName ?? existing) is { } name) table.Rows.Add(name);

            try
            {
                await db.ExecuteProcAsync("SP_FINANCIAL_ASSISTANCE_VALIDATE_EVIDENCES", new
                {
                    Id = id.ToString(CultureInfo.InvariantCulture),
                    ZedId = app.ZedId,
                    CertificationType = app.Certification,
                    IsVerified = isVerified,
                    SourceOfValidation = isVerified == "Yes" && isCertificate ? source : null,
                    Remark = note,
                    Screenshots = table.AsTableValuedParameter("FileDetails"),
                }, ct);
            }
            catch (DbException ex)
            {
                log.LogError(ex, "SP_FINANCIAL_ASSISTANCE_VALIDATE_EVIDENCES failed for {ZedId}/{Id}", app.ZedId, id);
                if (savedPath is not null) TryDelete(savedPath);
                return this.Problem400("The validation could not be saved. Please try again.");
            }
            log.LogInformation("FA document {Id} of {ZedId}/{Certification} validated ({IsVerified}) by {UserId}", id, app.ZedId, app.Certification, isVerified, UserId);
        }
        return new MessageResponse("Saved.");
    }

    public sealed record DecisionRequest(string? Decision, string? Comments);

    /// <summary>
    /// POST api/staff/schemes/fa/{zedId}/{certification}/decision — SP_FINANCIAL_ASSISTANCE_FINAL_AUBMIT.
    /// Assessor: approve (2 → 3, to the agency's QC) or reject (→ 5, MSME mailed). Agency: approve (3 → 4,
    /// ready for NEFT reimbursement, MSME mailed) or send back to the assessor (→ 2).
    /// </summary>
    [HttpPost("{zedId}/{certification}/decision")]
    [StaffRoles(UserRole.Agency, UserRole.DesktopAssessor)]
    public async Task<ActionResult<MessageResponse>> Decide(string zedId, string certification, DecisionRequest req, CancellationToken ct)
    {
        var approve = req.Decision?.Trim().ToLowerInvariant() switch { "approve" => true, "reject" => false, _ => (bool?)null };
        if (approve is null) return this.Problem400("Invalid decision.");
        var comments = SchemeRows.CleanText(req.Comments, 2000);
        if (req.Comments?.Trim().Length > 2000) return this.Problem400("Comments can be up to 2000 characters.");
        if (approve == false && comments is null) return this.Problem400("Please enter the comments.");

        var user = CurrentUser;
        FaApplication? app;
        using (await SchemeLocks.EnterAsync(ct))
        {
            app = await Viewable(zedId, certification, ct);
            if (app is null) return NotFound();
            if (!app.CanDecide(user))
            {
                return user.RoleId == (int)UserRole.DesktopAssessor && app.CanValidate(user)
                    ? this.Problem400("Please validate all the documents first.")
                    : this.Problem400("This application is not pending your decision.");
            }

            try
            {
                await db.ExecuteProcAsync("SP_FINANCIAL_ASSISTANCE_FINAL_AUBMIT", new
                {
                    IsApproved = approve.Value ? "1" : "2",
                    Comments = comments,
                    CertificationType = app.Certification,
                    ZedId = app.ZedId,
                    Id = app.Id.ToString(CultureInfo.InvariantCulture),
                    UserId,
                    RoleId = RoleId.ToString(CultureInfo.InvariantCulture),
                }, ct);
            }
            catch (DbException ex)
            {
                log.LogError(ex, "SP_FINANCIAL_ASSISTANCE_FINAL_AUBMIT failed for {ZedId}/{Certification}", app.ZedId, app.Certification);
                return this.Problem400("The decision could not be saved. Please try again.");
            }
            var who = user.RoleId == (int)UserRole.Agency ? "agency" : "assessor";
            await SchemeRows.AuditAsync(db, log, app.ZedId, app.Certification,
                $"Financial assistance {(approve.Value ? "approved" : "rejected")} by {who} {UserId}" + (comments is null ? "" : ": " + comments), ct);
        }

        // Mails as the legacy action: the MSME hears of the agency's approval and of the assessor's rejection.
        var mailer = new SchemeMailer(db, email, templates, portal, emailOptions, log);
        if (approve.Value && user.RoleId == (int)UserRole.Agency)
        {
            var d = await mailer.DetailsAsync(app.ZedId, app.Certification, ct);
            await mailer.SendAsync<StaffSchemeFaApprovedEmail>(d?.Text("EmailId"),
                $"Approval of Application for Financial Assistance on {d?.Text("CategoryOfCertificate")} - {app.ZedId}",
                new()
                {
                    [nameof(StaffSchemeFaApprovedEmail.ZedId)] = app.ZedId,
                    [nameof(StaffSchemeFaApprovedEmail.CategoryOfCertificate)] = d?.Text("CategoryOfCertificate") ?? "",
                }, ct);
        }
        else if (!approve.Value && user.RoleId == (int)UserRole.DesktopAssessor)
        {
            var d = await mailer.DetailsAsync(app.ZedId, app.Certification, ct);
            await mailer.SendAsync<StaffSchemeFaRejectedEmail>(d?.Text("EmailId"),
                $"Rejection of Application for Financial Assistance on {d?.Text("CategoryOfCertificate")} – {app.ZedId}",
                new()
                {
                    [nameof(StaffSchemeFaRejectedEmail.ZedId)] = app.ZedId,
                    [nameof(StaffSchemeFaRejectedEmail.UnitName)] = d?.Text("EnterpriseName") ?? "",
                    [nameof(StaffSchemeFaRejectedEmail.CategoryOfCertificate)] = d?.Text("CategoryOfCertificate") ?? "",
                    [nameof(StaffSchemeFaRejectedEmail.Reason)] = comments ?? "",
                }, ct);
        }
        return new MessageResponse(approve.Value ? "Application approved." : "Application rejected.");
    }

    public sealed record AccountRequest(string? AccountNo, string? IfscCode, string? BranchAddress, string? BankName);

    /// <summary>
    /// POST api/staff/schemes/fa/{zedId}/{certification}/account — SP_FINANCIAL_ASSISTANCE_UPDATE_ACCOUNT_DETAILS.
    /// Master admin (application approved or reimbursed) or the assigned assessor (while verifying). Recorded in MsmeHistory.
    /// </summary>
    [HttpPost("{zedId}/{certification}/account")]
    [StaffRoles(UserRole.MasterAdmin, UserRole.DesktopAssessor)]
    public async Task<ActionResult<MessageResponse>> UpdateAccount(string zedId, string certification, AccountRequest req, CancellationToken ct)
    {
        var accountNo = req.AccountNo?.Trim() ?? "";
        var ifsc = req.IfscCode?.Trim().ToUpperInvariant() ?? "";
        var branch = SchemeRows.CleanText(req.BranchAddress, 500);
        var bank = SchemeRows.CleanText(req.BankName, 200);
        if (!AccountNumber().IsMatch(accountNo)) return this.Problem400("Please enter a valid account number (9 to 18 digits).");
        if (!Ifsc().IsMatch(ifsc)) return this.Problem400("Please enter a valid IFSC code.");
        if (branch is null || bank is null) return this.Problem400("All fields are mandatory");

        using (await SchemeLocks.EnterAsync(ct))
        {
            var app = await Viewable(zedId, certification, ct);
            if (app is null) return NotFound();
            if (!app.CanEditAccount(CurrentUser)) return this.Problem400("The account details cannot be changed at this stage.");

            try
            {
                await db.ExecuteProcAsync("SP_FINANCIAL_ASSISTANCE_UPDATE_ACCOUNT_DETAILS", new
                {
                    Id = app.Id,
                    ZedId = app.ZedId,
                    AccountNo = accountNo,
                    IfscCode = ifsc,
                    BranchAddress = branch,
                    BankName = bank,
                    CertificationType = app.Certification,
                    UserId,
                    RoleId = RoleId.ToString(CultureInfo.InvariantCulture),
                }, ct);
            }
            catch (DbException ex)
            {
                log.LogError(ex, "SP_FINANCIAL_ASSISTANCE_UPDATE_ACCOUNT_DETAILS failed for {ZedId}/{Certification}", app.ZedId, app.Certification);
                return this.Problem400("The account details could not be updated. Please try again.");
            }
            static string Last4(string s) => s.Length <= 4 ? s : "…" + s[^4..];
            await SchemeRows.AuditAsync(db, log, app.ZedId, app.Certification,
                $"Reimbursement bank account changed by {UserId}: {Last4(app.Row.Text("AccountNo"))} / {app.Row.Text("IfscCode")} -> {Last4(accountNo)} / {ifsc}", ct);
        }
        return new MessageResponse("Account Details Updated Successfully");
    }

    private async Task<FaApplication?> Viewable(string zedId, string certification, CancellationToken ct)
    {
        if (!SchemeRows.IsZedId(zedId) || FaApplications.Canonical(certification) is not { } cert) return null;
        var app = await FaApplications.FindAsync(db, zedId, cert, ct);
        return app is not null && app.CanView(CurrentUser) ? app : null;
    }

    private ApplicationDto ToDto(FaApplication a, ZedUser user)
    {
        var baseUrl = $"/api/staff/schemes/fa/{Uri.EscapeDataString(a.ZedId)}/{a.Certification}";
        var docs = a.Photos.Select(p =>
        {
            var id = SchemeRows.Int(p, "Id") ?? 0;
            return new DocumentDto(
                id, Nullable(p.Text("PhotoType")), Nullable(p.Text("Name")), Nullable(p.Text("TimeStamp")),
                p.Text("PhotoId").EndsWith(".pdf", StringComparison.OrdinalIgnoreCase), $"{baseUrl}/documents/{id}",
                !string.IsNullOrEmpty(p.Text("DocumentOpenedTime")),
                Nullable(p.Text("IsVerified")), Nullable(p.Text("SourceOfValidation")), Nullable(p.Text("AssessorRemarks")),
                a.ScreenshotsOf(id)
                    .Select(s => (Id: SchemeRows.Int(s, "Id") ?? 0, Name: FaFilePaths.FileName(s.Text("FileName"))))
                    .Where(s => s.Name is not null)
                    .Select(s => new ScreenshotDto(s.Id, s.Name!, $"{baseUrl}/screenshots/{s.Id}"))
                    .ToList());
        }).ToList();
        return new ApplicationDto(a.Certification, SchemeRows.Pick(a.Row, DetailColumns), docs,
            a.CanValidate(user), a.CanDecide(user), a.CanEditAccount(user));
    }

    private static string? Nullable(string s) => s.Length == 0 ? null : s;

    private string StorageRoot => Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));

    private string? Resolve(IEnumerable<string> candidates) =>
        candidates.Select(c => MsmeFilePaths.Resolve(StorageRoot, c)).FirstOrDefault(p => p is not null && System.IO.File.Exists(p));

    private PhysicalFileResult Serve(string fullPath)
    {
        var name = Path.GetFileName(fullPath);
        var contentType = ContentTypes.TryGetContentType(name, out var t) ? t : "application/octet-stream";
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = name }.ToString();
        return PhysicalFile(fullPath, contentType, enableRangeProcessing: true);
    }

    /// <summary>The extension to save an upload with, judged from its content (PDF, JPEG or PNG), or null.</summary>
    public static async Task<string?> UploadKind(IFormFile file, CancellationToken ct)
    {
        if (file.Length is <= 0 or > MaxScreenshotBytes) return null;
        var head = new byte[8];
        await using var s = file.OpenReadStream();
        var read = await s.ReadAtLeastAsync(head, head.Length, throwOnEndOfStream: false, ct);
        if (read >= 5 && head.AsSpan(0, 5).SequenceEqual("%PDF-"u8)) return ".pdf";
        if (read >= 3 && head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF) return ".jpg";
        if (read >= 8 && head.AsSpan(0, 8).SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A })) return ".png";
        return null;
    }

    private void TryDelete(string path)
    {
        try { System.IO.File.Delete(path); }
        catch (IOException ex) { log.LogWarning(ex, "Could not delete {Path}", path); }
    }

    [GeneratedRegex(@"^[0-9]{9,18}$")]
    private static partial Regex AccountNumber();

    [GeneratedRegex(@"^[A-Z]{4}0[A-Z0-9]{6}$")]
    private static partial Regex Ifsc();
}
