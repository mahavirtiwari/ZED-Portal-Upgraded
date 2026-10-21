using System.Data;
using System.Data.Common;
using System.Globalization;
using System.Security.Cryptography;
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
using Zed.Portal.Features.Staff.Schemes;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Consultancy.TechnologyUpgradation;

/// <summary>
/// Verification of one unit's technology upgradation (TU) application (Frontend/FinancialAssistance/Verification.cshtml):
/// the MSME's documents per purchased technology, the DFO's validation of each (with a screenshot), the verified
/// purchase amounts and the eligible subsidy (TotalPaidAfterQc, EligibleAmount, capped at Rs. 3,00,000 by the
/// procedures), the DFO's opening meeting, the decisions of the DFO, the CO and the master admin, the payout bank
/// account, and the TU verification report (legacy SA/TuReportSummary) as a PDF. Port of the consultancy
/// FinancialAssistanceController.Verification / GetDetails / SaveTimestamp / ValidateEvidence / UpdateTechnology /
/// FinalSubmit / UpdateAccountDetails.
/// <para>
/// The legacy actions had no class filter (finding #88) and SA/TuReportSummary none either (#92): anyone could read
/// any application with its bank details, change the amounts that set the subsidy or the payout account, approve,
/// or upload a file under its own name and extension into the web root. Here only the master admin, the allotted
/// CO, the assigned DFO and a state coordinator whose NEFT lists hold the application can open it; each action is
/// limited to its role and state; amounts are checked on the server; uploads are content-checked and stored under
/// generated names; files are served through this controller.
/// </para>
/// </summary>
[Route("api/staff/consultancy/tu")]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency, UserRole.DesktopAssessor, UserRole.StateCoordinator)]
[PortalSystems(PortalSystem.Consultancy)]
public sealed partial class TuVerificationController(
    ISqlExecutor db,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    IOptions<EmailOptions> emailOptions,
    IConfiguration config,
    ILogger<TuVerificationController> log) : StaffApiController
{
    public const long MaxScreenshotBytes = FaVerificationController.MaxScreenshotBytes;
    /// <summary>Highest purchase amount accepted for one technology (the subsidy itself is capped at Rs. 3,00,000).</summary>
    public const decimal MaxAmount = 100_000_000m;
    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    /// <summary>Document types for which a "Yes" needs a screenshot of the check (the legacy page exempted these two).</summary>
    private static readonly string[] NoScreenshotTypes = ["CA certificate of expenditure", "Copy of Invoice"];

    public static readonly string[] DetailColumns =
    [
        "Id", "ZedId", "CertificationType", "VerificationStatus", "TechUpgradeStatus", "IsApproved", "CreatedDate",
        "CertificationBodyUserId", "FinancialAssessorId", "ReasonForRejection", "ReasonForRejectionAgency",
        "EligibleSubsidyPer", "MaxEligibleSubsidy", "TotalPaidAfterQc", "EligibleAmount",
        "AccountNo", "IfscCode", "BranchAddress", "BankName",
        "TransactionStatus", "ApproverDateOfReceiptOfPayment", "ApproverReferenceNo", "ApproverAmount",
    ];

    public static readonly string[] TechnologyColumns =
    [
        "TechnologyCode", "TechnologyName", "NameOfTheManufaturer", "MakeOrModelName", "DateOfPurchase", "AgencyOrSupplier",
        "InvoiceNo", "InvoiceBillDate", "MsmeAmountPaid", "AmountPaid", "ModeOfPayment",
    ];

    public sealed record ScreenshotDto(int Id, string FileName, string Url);

    public sealed record DocumentDto(
        int Id, string? PhotoType, string? TechnologyCode, string? TimeStamp, bool IsPdf, string Url, bool Opened,
        string? IsVerified, string? SourceOfValidation, string? AssessorRemarks, bool NeedsScreenshot, IReadOnlyList<ScreenshotDto> Screenshots);

    public sealed record TechnologyDto(int Id, bool IsEligible, Dictionary<string, object?> Details);

    public sealed record MeetingPhotoDto(int Id, string? Name, string? TimeStamp, string Url);

    public sealed record ParticipantDto(string? Name, string? Designation);

    public sealed record MeetingDto(string? Comments, IReadOnlyList<ParticipantDto> Participants, IReadOnlyList<MeetingPhotoDto> Photos);

    public sealed record RecommendedDto(string? Code, string? Name);

    public sealed record ApplicationDto(
        string Certification, string Stage, Dictionary<string, object?> Details, IReadOnlyList<TechnologyDto> Technologies,
        IReadOnlyList<DocumentDto> Documents, MeetingDto? Meeting, IReadOnlyList<RecommendedDto> Recommended,
        bool CanValidate, bool CanDecide, bool CanApprove, bool CanEditAmounts, bool CanEditAccount, bool HasReport);

    /// <summary>GET api/staff/consultancy/tu/{zedId} — the applications of the unit this user may see.</summary>
    [HttpGet("{zedId}")]
    public async Task<ActionResult<IReadOnlyList<ApplicationDto>>> Details(string zedId, CancellationToken ct)
    {
        if (!SchemeRows.IsZedId(zedId)) return NotFound();
        var user = CurrentUser;
        var result = new List<ApplicationDto>();
        foreach (var app in await TuApplications.LoadAsync(db, zedId, ct))
        {
            var scope = await ScopeAsync(app, ct);
            if (app.CanView(user, scope)) result.Add(ToDto(app, user, scope));
        }
        return result.Count == 0 ? NotFound() : result;
    }

    /// <summary>
    /// GET api/staff/consultancy/tu/{zedId}/{certification}/documents/{id} — a document uploaded by the MSME. When the
    /// assigned DFO opens it, the time is recorded (SP_FINANCIAL_ASSISTANCE_UPDATE_TIMESTAMP), which validation requires.
    /// </summary>
    [HttpGet("{zedId}/{certification}/documents/{id:int}")]
    public async Task<IActionResult> Document(string zedId, string certification, int id, CancellationToken ct)
    {
        var (app, _) = await ViewableAsync(zedId, certification, ct);
        if (app?.Fa.Photo(id) is not { } photo || FaFilePaths.FileName(photo.Text("PhotoId")) is not { } file) return NotFound();
        var path = Storage.Find(TuStorage.DocumentCandidates(app.ZedId, file));
        if (path is null)
        {
            log.LogInformation("TU document {File} of {ZedId} is missing from storage", file, app.ZedId);
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

    /// <summary>GET api/staff/consultancy/tu/{zedId}/{certification}/screenshots/{id} — a DFO's validation screenshot.</summary>
    [HttpGet("{zedId}/{certification}/screenshots/{id:int}")]
    public async Task<IActionResult> Screenshot(string zedId, string certification, int id, CancellationToken ct)
    {
        var (app, _) = await ViewableAsync(zedId, certification, ct);
        var shot = app?.Fa.Screenshots.FirstOrDefault(s => SchemeRows.Int(s, "Id") == id);
        if (app is null || shot is null || FaFilePaths.FileName(shot.Text("FileName")) is not { } file) return NotFound();
        var path = Storage.Find([$"{TuStorage.ScreenshotFolder(app.ZedId, app.Certification)}/{file}"]);
        return path is null ? NotFound() : Serve(path);
    }

    /// <summary>GET api/staff/consultancy/tu/{zedId}/{certification}/meeting-photos/{id} — a photo of the DFO's opening meeting.</summary>
    [HttpGet("{zedId}/{certification}/meeting-photos/{id:int}")]
    public async Task<IActionResult> MeetingPhoto(string zedId, string certification, int id, CancellationToken ct)
    {
        var (app, _) = await ViewableAsync(zedId, certification, ct);
        if (app?.MeetingPhoto(id) is not { } p || TuStorage.MeetingFile(p.Text("Name"), p.Text("PhotoId")) is not { } file) return NotFound();
        var path = Storage.Find([$"{TuStorage.MeetingFolder(app.ZedId, app.Certification)}/{file}"]);
        return path is null ? NotFound() : Serve(path);
    }

    /// <summary>
    /// POST api/staff/consultancy/tu/{zedId}/{certification}/documents/{id}/validation (multipart: isVerified Yes/No,
    /// sourceOfValidation, remarks, file) — SP_FINANCIAL_ASSISTANCE_VALIDATE_EVIDENCES, by the assigned DFO. The procedure
    /// marks the technology of the document eligible or not and moves the application to TechUpgradeStatus 5.
    /// </summary>
    [HttpPost("{zedId}/{certification}/documents/{id:int}/validation")]
    [StaffRoles(UserRole.DesktopAssessor)]
    [RequestSizeLimit(MaxScreenshotBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxScreenshotBytes + 64 * 1024)]
    public async Task<ActionResult<MessageResponse>> Validate(string zedId, string certification, int id,
        [FromForm] string? isVerified, [FromForm] string? sourceOfValidation, [FromForm] string? remarks, IFormFile? file, CancellationToken ct)
    {
        if (isVerified is not ("Yes" or "No")) return this.Problem400("Please select whether the document is verified.");
        if (sourceOfValidation?.Trim().Length > 200) return this.Problem400("Source of validation can be up to 200 characters.");
        var source = SchemeRows.CleanText(sourceOfValidation, 200);
        if (remarks?.Trim().Length > 1000) return this.Problem400("Remarks can be up to 1000 characters.");
        var note = SchemeRows.CleanText(remarks, 1000);
        if (isVerified == "No" && note is null) return this.Problem400("Please enter the remarks.");

        string? upload = null;
        if (file is not null && (upload = await FaVerificationController.UploadKind(file, ct)) is null)
            return this.Problem400("Please upload valid document (PDF / JPG / PNG, less than 2 MB).");

        using (await SchemeLocks.EnterAsync(ct))
        {
            var (app, _) = await ViewableAsync(zedId, certification, ct);
            if (app?.Fa.Photo(id) is not { } photo) return NotFound();
            if (!app.CanValidate(CurrentUser)) return this.Problem400("This document cannot be validated at this stage.");
            if (string.IsNullOrEmpty(photo.Text("DocumentOpenedTime"))) return this.Problem400("Please view the document before validating it.");

            var existing = app.Fa.ScreenshotsOf(id).Select(s => FaFilePaths.FileName(s.Text("FileName"))).LastOrDefault(n => n is not null);
            if (isVerified == "Yes" && NeedsScreenshot(photo.Text("PhotoType")) && upload is null && existing is null)
                return this.Problem400("Please upload valid pdf document.");

            // Server-generated name in a folder built from validated values only (the legacy action kept the client's name).
            string? savedName = null, savedPath = null;
            if (upload is not null)
            {
                savedName = $"{DateTime.Now:yyyyMMddHHmmssfff}_{id}_{Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(4))}{upload}";
                savedPath = Storage.Target($"{TuStorage.ScreenshotFolder(app.ZedId, app.Certification)}/{savedName}");
                if (savedPath is null) return this.Problem400("Invalid application.");
                Directory.CreateDirectory(Path.GetDirectoryName(savedPath)!);
                await using var stream = System.IO.File.Create(savedPath);
                await file!.CopyToAsync(stream, ct);
            }

            // The procedure deletes the screenshot rows and inserts the ones passed: keep the existing one when no new file is sent.
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
                    SourceOfValidation = source,
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
            log.LogInformation("TU document {Id} of {ZedId}/{Certification} validated ({IsVerified}) by {UserId}", id, app.ZedId, app.Certification, isVerified, UserId);
        }
        return new MessageResponse("Saved.");
    }

    public sealed record AmountRequest(string? AmountPaid);

    /// <summary>
    /// POST api/staff/consultancy/tu/{zedId}/{certification}/technologies/{id}/amount — the verified purchase amount of one
    /// technology (SP_FINANCIAL_ASSISTANCE_UPDATE_TECHNOLOGY_DATA, which recomputes TotalPaidAfterQc and the eligible
    /// subsidy). State coordinator in scope, while the payout is pending; at most what the MSME declared.
    /// </summary>
    [HttpPost("{zedId}/{certification}/technologies/{id:int}/amount")]
    [StaffRoles(UserRole.StateCoordinator)]
    public async Task<ActionResult<MessageResponse>> UpdateTechnology(string zedId, string certification, int id, AmountRequest req, CancellationToken ct)
    {
        if (!decimal.TryParse(req.AmountPaid?.Trim(), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var amount) ||
            amount < 0 || amount > MaxAmount || decimal.Round(amount, 2) != amount)
            return this.Problem400("Please enter a valid amount (up to 2 decimals).");

        using (await SchemeLocks.EnterAsync(ct))
        {
            var (app, scope) = await ViewableAsync(zedId, certification, ct);
            if (app?.Technology(id) is not { } tech) return NotFound();
            if (!app.CanEditAmounts(CurrentUser, scope)) return this.Problem400("The amounts cannot be changed at this stage.");
            if (SchemeRows.Decimal(tech, "MsmeAmountPaid") is > 0 and var declared && amount > declared)
                return this.Problem400($"The amount cannot be more than the amount paid entered by the unit (Rs. {declared.ToString("0.##", CultureInfo.InvariantCulture)}).");

            var before = tech.Text("AmountPaid");
            try
            {
                await db.ExecuteProcAsync("SP_FINANCIAL_ASSISTANCE_UPDATE_TECHNOLOGY_DATA", new
                {
                    Id = id.ToString(CultureInfo.InvariantCulture),
                    ZedId = app.ZedId,
                    AmountPaid = amount.ToString("0.00", CultureInfo.InvariantCulture),
                }, ct);
            }
            catch (DbException ex)
            {
                log.LogError(ex, "SP_FINANCIAL_ASSISTANCE_UPDATE_TECHNOLOGY_DATA failed for {ZedId}/{Id}", app.ZedId, id);
                return this.Problem400("The amount could not be updated. Please try again.");
            }
            await SchemeRows.AuditAsync(db, log, app.ZedId, app.Certification,
                $"Technology upgradation amount of technology {tech.Text("TechnologyCode")} changed by {UserId}: {before} -> {amount.ToString("0.00", CultureInfo.InvariantCulture)}", ct);
        }
        return new MessageResponse("Amount updated.");
    }

    public sealed record DecisionRequest(string? Decision, string? Comments);

    /// <summary>
    /// POST api/staff/consultancy/tu/{zedId}/{certification}/decision — SP_FINANCIAL_ASSISTANCE_FINAL_AUBMIT.
    /// DFO: approve (2 → 3, TechUpgradeStatus 6) or reject (→ 5/7, MSME mailed). CO in QC: approve (3 → 4/8; the procedure
    /// mails the MSME) or send back to the DFO (→ 2/9; the procedure resets the meeting and validations and mails the DFO).
    /// Master admin: reject before the DFO's decision (→ 5/7).
    /// </summary>
    [HttpPost("{zedId}/{certification}/decision")]
    [StaffRoles(UserRole.MasterAdmin, UserRole.Agency, UserRole.DesktopAssessor)]
    public async Task<ActionResult<MessageResponse>> Decide(string zedId, string certification, DecisionRequest req, CancellationToken ct)
    {
        var approve = req.Decision?.Trim().ToLowerInvariant() switch { "approve" => true, "reject" => false, _ => (bool?)null };
        if (approve is null) return this.Problem400("Invalid decision.");
        if (req.Comments?.Trim().Length > 2000) return this.Problem400("Comments can be up to 2000 characters.");
        var comments = SchemeRows.CleanText(req.Comments, 2000);
        if (approve == false && comments is null) return this.Problem400("Please enter the comments.");

        var user = CurrentUser;
        TuApplication? app;
        using (await SchemeLocks.EnterAsync(ct))
        {
            (app, _) = await ViewableAsync(zedId, certification, ct);
            if (app is null) return NotFound();
            if (!app.CanDecide(user) || (approve.Value && !app.CanApprove(user)))
            {
                if (user.RoleId == (int)UserRole.DesktopAssessor && app.CanValidate(user))
                    return this.Problem400(!app.MeetingDone
                        ? "The opening meeting has not been submitted from the mobile application yet."
                        : "Please validate all the documents first.");
                return this.Problem400("This application is not pending your decision.");
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
            log.LogInformation("TU application {ZedId}/{Certification} {Decision} by {Role} {UserId}", app.ZedId, app.Certification,
                approve.Value ? "approved" : "rejected", user.RoleName, UserId);
        }

        // As the legacy action, the MSME is mailed of the DFO's rejection (the procedure mails the CO's decisions itself).
        if (!approve.Value && user.RoleId == (int)UserRole.DesktopAssessor)
        {
            var mailer = new SchemeMailer(db, email, templates, portal, emailOptions, log);
            var d = await mailer.DetailsAsync(app.ZedId, app.Certification, ct);
            await mailer.SendAsync<ConsultancyTuRejectedEmail>(d?.Text("EmailId"),
                $"Rejection of Application for Technology Upgradation – {app.ZedId}",
                new()
                {
                    [nameof(ConsultancyTuRejectedEmail.ZedId)] = app.ZedId,
                    [nameof(ConsultancyTuRejectedEmail.UnitName)] = d?.Text("PUnitName") is { Length: > 0 } p ? p : d?.Text("EnterpriseName") ?? "",
                    [nameof(ConsultancyTuRejectedEmail.Reason)] = comments ?? "",
                }, ct);
        }
        return new MessageResponse(approve.Value ? "Application approved."
            : user.RoleId == (int)UserRole.Agency ? "Application sent back to the MSME-DFO officer." : "Application rejected.");
    }

    public sealed record AccountRequest(string? AccountNo, string? IfscCode, string? BranchAddress, string? BankName);

    /// <summary>
    /// POST api/staff/consultancy/tu/{zedId}/{certification}/account — SP_FINANCIAL_ASSISTANCE_UPDATE_ACCOUNT_DETAILS, the
    /// payout account. State coordinator in scope or master admin, while the payout is pending. Recorded in MsmeHistory.
    /// </summary>
    [HttpPost("{zedId}/{certification}/account")]
    [StaffRoles(UserRole.MasterAdmin, UserRole.StateCoordinator)]
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
            var (app, scope) = await ViewableAsync(zedId, certification, ct);
            if (app is null) return NotFound();
            if (!app.CanEditAccount(CurrentUser, scope)) return this.Problem400("The account details cannot be changed at this stage.");
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
                $"TU payout bank account changed by {UserId}: {Last4(app.Row.Text("AccountNo"))} / {app.Row.Text("IfscCode")} -> {Last4(accountNo)} / {ifsc}", ct);
        }
        return new MessageResponse("Account Details Updated Successfully");
    }

    /// <summary>
    /// GET api/staff/consultancy/tu/{zedId}/{certification}/report — the TU verification report (legacy SA/TuReportSummary,
    /// SP_REPORT_GET_TECHNOLOGY_UPGRADATION_DETAILS) as a PDF, for those who may open the application, once the DFO approved.
    /// The bank account is not printed.
    /// </summary>
    [HttpGet("{zedId}/{certification}/report")]
    public async Task<IActionResult> Report(string zedId, string certification, CancellationToken ct)
    {
        var (app, _) = await ViewableAsync(zedId, certification, ct);
        if (app is null || !app.HasReport) return NotFound();
        var sets = await db.QueryProcMultipleAsync("SP_REPORT_GET_TECHNOLOGY_UPGRADATION_DETAILS",
            new { Certification = app.Certification, ZedId = app.ZedId, UserId, NcCount = 3 }, ct);
        if (sets[0].Count == 0) return NotFound();
        var pdf = TuReport.Build(sets, app.ZedId, app.Certification, Storage);
        log.LogInformation("TU report of {ZedId}/{Certification} downloaded by {UserId}", app.ZedId, app.Certification, UserId);
        Response.Headers.CacheControl = "private, no-store";
        return File(pdf, "application/pdf", $"{app.ZedId}_{app.Certification}_TU_Report.pdf");
    }

    // ------------------------------------------------------------------ helpers

    private TuStorage Storage => new(env, portal, config);

    private static bool NeedsScreenshot(string? photoType) =>
        !NoScreenshotTypes.Contains(photoType?.Trim() ?? "", StringComparer.OrdinalIgnoreCase);

    private Task<bool> ScopeAsync(TuApplication app, CancellationToken ct) =>
        RoleId == (int)UserRole.StateCoordinator ? TuCoordinatorScope.InScopeAsync(db, config, CurrentUser, app.Fa, ct) : Task.FromResult(false);

    private async Task<(TuApplication? App, bool Scope)> ViewableAsync(string zedId, string certification, CancellationToken ct)
    {
        if (!SchemeRows.IsZedId(zedId) || FaApplications.Canonical(certification) is not { } cert) return (null, false);
        var app = await TuApplications.FindAsync(db, zedId, cert, ct);
        if (app is null) return (null, false);
        var scope = await ScopeAsync(app, ct);
        return app.CanView(CurrentUser, scope) ? (app, scope) : (null, false);
    }

    private ApplicationDto ToDto(TuApplication a, ZedUser user, bool scope)
    {
        var baseUrl = $"/api/staff/consultancy/tu/{Uri.EscapeDataString(a.ZedId)}/{a.Certification}";
        var docs = a.Fa.Photos.Select(p =>
        {
            var id = SchemeRows.Int(p, "Id") ?? 0;
            return new DocumentDto(
                id, Nullable(p.Text("PhotoType")), Nullable(p.Text("TechnologyCode")), Nullable(p.Text("TimeStamp")),
                p.Text("PhotoId").EndsWith(".pdf", StringComparison.OrdinalIgnoreCase), $"{baseUrl}/documents/{id}",
                !string.IsNullOrEmpty(p.Text("DocumentOpenedTime")),
                Nullable(p.Text("IsVerified")), Nullable(p.Text("SourceOfValidation")), Nullable(p.Text("AssessorRemarks")),
                NeedsScreenshot(p.Text("PhotoType")),
                a.Fa.ScreenshotsOf(id)
                    .Select(s => (Id: SchemeRows.Int(s, "Id") ?? 0, Name: FaFilePaths.FileName(s.Text("FileName"))))
                    .Where(s => s.Name is not null)
                    .Select(s => new ScreenshotDto(s.Id, s.Name!, $"{baseUrl}/screenshots/{s.Id}"))
                    .ToList());
        }).ToList();
        var techs = a.Technologies.Select(t => new TechnologyDto(SchemeRows.Int(t, "Id") ?? 0,
            t.Text("IsEligible") is "1" or "True" or "true", SchemeRows.Pick(t, TechnologyColumns))).ToList();
        var meeting = a.Meetings.Count == 0 ? null : new MeetingDto(
            Nullable(a.Meetings[^1].Text("Comments")),
            a.Participants.Select(p => new ParticipantDto(Nullable(p.Text("Name")), Nullable(p.Text("Designation")))).ToList(),
            a.MeetingPhotos.Select(p => new MeetingPhotoDto(SchemeRows.Int(p, "Id") ?? 0, Nullable(p.Text("Name")), Nullable(p.Text("TimeStamp")),
                $"{baseUrl}/meeting-photos/{SchemeRows.Int(p, "Id") ?? 0}")).ToList());
        var recommended = a.Recommended.Select(r => new RecommendedDto(Nullable(r.Text("TechnologyCode")), Nullable(r.Text("TechnologyName")))).ToList();
        return new ApplicationDto(a.Certification, TuStatus.Text(a.Tu, a.Status), SchemeRows.Pick(a.Row, DetailColumns), techs, docs, meeting, recommended,
            a.CanValidate(user), a.CanDecide(user), a.CanApprove(user), a.CanEditAmounts(user, scope), a.CanEditAccount(user, scope), a.HasReport);
    }

    private static string? Nullable(string s) => s.Length == 0 ? null : s;

    private PhysicalFileResult Serve(string fullPath)
    {
        var name = Path.GetFileName(fullPath);
        var contentType = ContentTypes.TryGetContentType(name, out var t) ? t : "application/octet-stream";
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = name }.ToString();
        return PhysicalFile(fullPath, contentType, enableRangeProcessing: true);
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
