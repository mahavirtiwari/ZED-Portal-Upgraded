using System.Data;
using System.Data.Common;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Schemes;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Msme.Schemes;

/// <summary>
/// The MSME's application for financial assistance (75% of the cost of one testing, system or product
/// certification, at most Rs. 50,000) and the view of its own applications. Port of
/// FinancialAssistanceController.Index / UploadDocs / SubmitFinancialData / Details / GetDetails
/// (Frontend/FinancialAssistance/Index.cshtml and Details.cshtml); the staff review is in
/// <see cref="FaVerificationController"/>.
/// <para>
/// Legacy problems fixed here: Details/GetDetails took the ZED ID from the request (any signed-in user
/// could read any unit's application with its bank account); UploadDocs saved any file type under a
/// public folder; the eligible amount came from the browser; the procedure stored an application even
/// when the unit held no ZED certificate (CertificationType NULL); the "already submitted" check ran only
/// in the browser; procedure and exception texts were shown to the user.
/// </para>
/// </summary>
[Route("api/msme/schemes/fa")]
public sealed class MsmeFinancialAssistanceController(
    ISqlExecutor db,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    IOptions<EmailOptions> emailOptions,
    ILogger<MsmeFinancialAssistanceController> log) : MsmeApiController
{
    public const string CertificateCopy = "Copy of Certificate";
    public const string CaCertificate = "CA certificate of expenditure";
    public const string InvoiceCopy = "Copy of Invoice";
    public const string CancelledCheque = "Copy of Cancelled Cheque";
    public static readonly string[] DocumentTypes = [CertificateCopy, CaCertificate, InvoiceCopy, CancelledCheque];
    public static readonly string[] Categories = ["Quality", "Product", "Testing"];
    public static readonly string[] PaymentModes = ["Offline", "Online"];
    public const int MaxDocumentsPerType = 3;
    public const decimal SubsidyShare = 0.75m;
    public const decimal SubsidyCap = 50_000m;

    /// <summary>What the MSME sees of its own application (no reviewer remarks, agency or assessor ids).</summary>
    public static readonly string[] ApplicationColumns =
    [
        "CertificationType", "VerificationStatus", "CategoryOfCertificate", "NameOfCertficate", "CertificationAgency", "CertficateNumber",
        "DateOfIssue", "ValidityOfCertificate", "AnyOtherInformation", "ExpenditureCertficate", "AgencyOrSupplier", "InvoiceNo",
        "InvoiceBillDate", "AmountPaid", "EligibleAmount", "ModeOfPayment", "AccountNo", "IfscCode", "BranchAddress", "BankName", "CreatedDate",
    ];

    public sealed record ApplicationDto(string Certification, Dictionary<string, object?> Details, IReadOnlyList<SchemeDocumentDto> Documents);

    public sealed record PageResponse(
        Dictionary<string, object?> Unit, bool CanApply, string? Message, string? Certification, IReadOnlyList<ApplicationDto> Applications);

    /// <summary>GET api/msme/schemes/fa — the unit panel, whether the MSME may apply now, and its applications.</summary>
    [HttpGet]
    public async Task<ActionResult<PageResponse>> Get(CancellationToken ct)
    {
        var state = await StateAsync(ct);
        if (state is null) return NotFound();
        var apps = await FaApplications.LoadAsync(db, ZedId, ct);
        return new PageResponse(state.Value.Unit.Panel(), state.Value.Refusal is null, state.Value.Refusal, state.Value.Certification,
            apps.Select(ToDto).ToList());
    }

    public sealed record UploadResponse(string FileName, string Type, string TimeStamp, bool IsPdf, string Url);

    /// <summary>POST api/msme/schemes/fa/documents (multipart: type, file) — one document, PDF/JPEG/PNG up to 5 MB.</summary>
    [HttpPost("documents")]
    [RequestSizeLimit(SchemeUploads.MaxBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = SchemeUploads.MaxBytes + 64 * 1024)]
    public async Task<ActionResult<UploadResponse>> Upload([FromForm] string? type, IFormFile? file, CancellationToken ct)
    {
        var docType = DocumentTypes.FirstOrDefault(t => t == type);
        if (docType is null) return this.Problem400("Invalid document type.");
        if (file is null || await SchemeUploads.KindAsync(file, ct) is not { } ext)
            return this.Problem400("Please upload valid document (PDF / JPG / PNG, less than 5 MB).");

        var state = await StateAsync(ct);
        if (state is null) return NotFound();
        if (state.Value.Refusal is { } refusal) return this.Problem400(refusal);

        var root = SchemeUploads.StorageRoot(env, portal.Value);
        var name = await SchemeUploads.SaveAsync(root, ZedId, SchemeUploads.FaFolder, file, ext, ct);
        if (name is null) return this.Problem400("The document could not be saved. Please try again.");
        var full = SchemeUploads.Find(root, ZedId, SchemeUploads.FaFolder, name)!;
        log.LogInformation("FA document {Name} ({Type}) uploaded by {ZedId}", name, docType, ZedId);
        return new UploadResponse(name, docType, SchemeUploads.TimeStamp(full), SchemeUploads.IsPdf(name), FileUrl(name));
    }

    /// <summary>GET api/msme/schemes/fa/files/{name} — one of the signed-in MSME's own FA documents.</summary>
    [HttpGet("files/{name}")]
    public IActionResult Document(string name)
    {
        var full = SchemeUploads.Find(SchemeUploads.StorageRoot(env, portal.Value), ZedId, SchemeUploads.FaFolder, name);
        return full is null ? NotFound() : SchemeUploads.Serve(this, full);
    }

    public sealed record SubmitRequest(
        string? CategoryOfCertificate, string? NameOfCertficate, string? CertificationAgency, string? CertficateNumber,
        string? DateOfIssue, int? ValidityOfCertificate, string? AnyOtherInformation,
        string? InvoiceNo, string? InvoiceBillDate, decimal? AmountPaid, string? ModeOfPayment,
        SchemeAccount? Account, IReadOnlyList<SchemeDocumentRef>? Documents, bool Declaration);

    public sealed record SubmitResponse(string Message, decimal AmountPaid, decimal EligibleAmount);

    /// <summary>POST api/msme/schemes/fa — SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE, then the confirmation mail.</summary>
    [HttpPost]
    public async Task<ActionResult<SubmitResponse>> Submit(SubmitRequest req, CancellationToken ct)
    {
        if (Validate(req) is { } invalid) return this.Problem400(invalid);
        var root = SchemeUploads.StorageRoot(env, portal.Value);
        var photos = Photos(root, req.Documents!);
        if (photos is null) return this.Problem400("Please upload the required documents.");

        var amount = SchemeInput.Amount(req.AmountPaid)!.Value;
        // As the legacy page: 75% of the amount paid (whole rupees), at most Rs. 50,000 — computed here, not taken from the browser.
        var eligible = Math.Min(decimal.Truncate(amount) * SubsidyShare, SubsidyCap);
        var a = req.Account!;
        string certification;

        using (await SchemeLocks.EnterAsync(ct))
        {
            var state = await StateAsync(ct);
            if (state is null) return NotFound();
            if (state.Value.Refusal is { } refusal) return this.Problem400(refusal);
            certification = state.Value.Certification!;

            try
            {
                await db.ExecuteProcAsync("SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE", new
                {
                    RefId = DateTime.Now.ToString("yyyyMMddHHmmss", System.Globalization.CultureInfo.InvariantCulture),
                    ZedId,
                    CategoryOfCertificate = Categories.First(c => c == req.CategoryOfCertificate),
                    NameOfCertficate = SchemeInput.Text(req.NameOfCertficate, 200),
                    CertificationAgency = SchemeInput.Text(req.CertificationAgency, 200),
                    CertficateNumber = SchemeInput.Text(req.CertficateNumber, 50),
                    DateOfIssue = SchemeInput.Date(req.DateOfIssue),
                    ValidityOfCertificate = req.ValidityOfCertificate!.Value.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    AnyOtherInformation = SchemeInput.Text(req.AnyOtherInformation, 2000),
                    // The page copied these two from the certificate details (read-only fields).
                    ExpenditureCertficate = SchemeInput.Text(req.NameOfCertficate, 200),
                    AgencyOrSupplier = SchemeInput.Text(req.CertificationAgency, 200),
                    InvoiceNo = SchemeInput.Text(req.InvoiceNo, 50),
                    InvoiceBillDate = SchemeInput.Date(req.InvoiceBillDate),
                    AmountPaid = SchemeInput.Money(amount),
                    ModeOfPayment = PaymentModes.First(m => m == req.ModeOfPayment),
                    EligibleAmount = SchemeInput.Money(eligible),
                    AccountNo = a.AccountNo!.Trim(),
                    IfscCode = a.IfscCode!.Trim().ToUpperInvariant(),
                    BranchAddress = SchemeInput.Text(a.BranchAddress, 500),
                    BankName = SchemeInput.Text(a.BankName, 200),
                    SubmittedFrom = "Web",
                    PhotoListWeb = photos.AsTableValuedParameter("DynamicPhotoList"),
                }, ct);
            }
            catch (DbException ex)
            {
                // The procedure forces a conversion error for a duplicate certificate/invoice, a unit without
                // benefits, or an application already submitted; never show its text.
                log.LogWarning(ex, "SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE refused for {ZedId}", ZedId);
                return this.Problem400("The application could not be submitted. It may already have been submitted, or the same certificate and invoice were used before.");
            }
        }
        log.LogInformation("FA application submitted by {ZedId} for {Certification}: amount {Amount}, eligible {Eligible}", ZedId, certification, amount, eligible);

        var mailer = new SchemeMailer(db, email, templates, portal, emailOptions, log);
        var d = await mailer.DetailsAsync(ZedId, certification, ct);
        var category = d?.Text("CategoryOfCertificate") is { Length: > 0 } c ? c : req.CategoryOfCertificate!;
        await mailer.SendAsync<MsmeSchemeFaSubmittedEmail>(d?.Text("EmailId"),
            $"Confirmation of Application for Financial Assistance on {category} - {ZedId}",
            new()
            {
                [nameof(MsmeSchemeFaSubmittedEmail.ZedId)] = ZedId,
                [nameof(MsmeSchemeFaSubmittedEmail.CategoryOfCertificate)] = category,
            }, ct);

        return new SubmitResponse("Application for Financial Assistance submitted successfully!", amount, eligible);
    }

    /// <summary>Field checks (the legacy page required every field but the "other information" and checked only in the browser).</summary>
    public static string? Validate(SubmitRequest r)
    {
        if (!r.Declaration) return "Please accept the declaration.";
        if (!Categories.Contains(r.CategoryOfCertificate)) return "Please select the category of certificate.";
        if (SchemeInput.Text(r.NameOfCertficate, 200) is null) return "Please enter the name of certificate (up to 200 characters).";
        if (SchemeInput.Text(r.CertificationAgency, 200) is null) return "Please enter the name of certification agency (up to 200 characters).";
        if (SchemeInput.Text(r.CertficateNumber, 50) is null) return "Please enter the certificate number (up to 50 characters).";
        if (SchemeInput.Date(r.DateOfIssue) is null) return "Please enter a valid date of issue of certificate (not in the future).";
        if (r.ValidityOfCertificate is not (>= 1 and <= 100)) return "Please enter the period of validity of certificate in years.";
        if (!string.IsNullOrWhiteSpace(r.AnyOtherInformation) && SchemeInput.Text(r.AnyOtherInformation, 2000) is null)
            return "Any other information can be up to 2000 characters.";
        if (SchemeInput.Text(r.InvoiceNo, 50) is null) return "Please enter the invoice/bill number (up to 50 characters).";
        if (SchemeInput.Date(r.InvoiceBillDate) is null) return "Please enter a valid invoice/bill date (not in the future).";
        if (SchemeInput.Amount(r.AmountPaid) is null) return "Please enter a valid amount paid.";
        if (!PaymentModes.Contains(r.ModeOfPayment)) return "Please select the mode of payment.";
        // As the live FA form: the CA certificate is "(Optional)", but the expenditure section needs two documents at least
        // (Photos.length <= 1 refused), e.g. the invoice and the CA certificate, or two invoices.
        return AccountProblem(r.Account) ?? DocumentsProblem(r.Documents, [CertificateCopy, InvoiceCopy, CancelledCheque], DocumentTypes)
            ?? (r.Documents!.Count(d => d.Type is CaCertificate or InvoiceCopy) < 2 ? "Please upload the required documents." : null);
    }

    public static string? AccountProblem(SchemeAccount? a)
    {
        if (a is null) return "Please enter the account details.";
        var accountNo = a.AccountNo?.Trim();
        if (!SchemeInput.AccountNo(accountNo)) return "Please enter a valid account number (9 to 18 digits).";
        if (accountNo != a.ConfirmAccountNo?.Trim()) return "Account Number and Re-Enter Account Number must match.";
        if (!SchemeInput.Ifsc(a.IfscCode?.Trim().ToUpperInvariant())) return "Invalid IFSC Code format. Please enter the correct 11-digit code.";
        if (SchemeInput.Text(a.BranchAddress, 500) is null) return "Please enter the branch address (up to 500 characters).";
        if (SchemeInput.Text(a.BankName, 200) is null) return "Please enter the name of the bank (up to 200 characters).";
        return null;
    }

    /// <summary>
    /// Every required type at least once, known types only, at most three files per type, no name twice. Names must be
    /// ones the upload generated, or (<paramref name="attached"/>) documents already recorded for the same item.
    /// </summary>
    public static string? DocumentsProblem(IReadOnlyList<SchemeDocumentRef>? docs, IEnumerable<string> required, IReadOnlyCollection<string> allowed,
        IReadOnlyDictionary<string, string?>? attached = null)
    {
        if (docs is null || docs.Count == 0) return "Please upload the required documents.";
        if (docs.Any(d => d.Type is null || !allowed.Contains(d.Type) ||
                          !(SchemeUploads.IsGenerated(d.FileName) || (d.FileName is not null && attached?.ContainsKey(d.FileName) == true))))
            return "Invalid document.";
        if (docs.GroupBy(d => d.Type).Any(g => g.Count() > MaxDocumentsPerType)) return $"Up to {MaxDocumentsPerType} files can be uploaded for each document.";
        if (docs.Select(d => d.FileName).Distinct().Count() != docs.Count) return "Invalid document.";
        if (required.Any(t => docs.All(d => d.Type != t))) return "Please upload the required documents.";
        return null;
    }

    /// <summary>The DynamicPhotoList rows (PhotoId, Name = document type, TimeStamp), or null when a file is not in the MSME's folder.</summary>
    private DataTable? Photos(string root, IReadOnlyList<SchemeDocumentRef> docs) => SchemePhotoList.Build(root, ZedId, SchemeUploads.FaFolder, docs);

    /// <summary>The unit, the level the application will be for, and why the MSME may not apply now (null = may apply).</summary>
    private async Task<(SchemeUnit Unit, string? Certification, string? Refusal)?> StateAsync(CancellationToken ct)
    {
        var unit = await SchemeUnit.LoadAsync(db, ZedId, ct);
        if (unit is null) return null;
        if (!unit.EligibleForFinancial || !unit.EligibleForBenefits)
            return (unit, null, "You are not eligible for benefits. Please contact ZED team.");
        if (unit.FaSubmitted) return (unit, null, "Data already submitted.");
        var certification = FaApplications.Canonical(
            (await db.QueryProcMultipleAsync("SP_FINANCIAL_ASSISTANCE_GET_CURRENT_CERTIFICATE", new { ZedId }, ct)).Scalar(0));
        return certification is null
            ? (unit, null, "Financial assistance can be applied for after the unit is ZED certified.")
            : (unit, certification, null);
    }

    private ApplicationDto ToDto(FaApplication a) => new(
        a.Certification,
        SchemeRows.Pick(a.Row, ApplicationColumns),
        a.Photos
            .Select(p => (Photo: p, Name: FaFilePaths.FileName(p.Text("PhotoId"))))
            .Where(p => p.Name is not null)
            .Select(p => new SchemeDocumentDto(p.Name!, NullIfEmpty(p.Photo.Text("PhotoType")) ?? NullIfEmpty(p.Photo.Text("Name")),
                NullIfEmpty(p.Photo.Text("TimeStamp")), SchemeUploads.IsPdf(p.Name), FileUrl(p.Name!)))
            .ToList());

    private static string? NullIfEmpty(string s) => s.Length == 0 ? null : s;

    private static string FileUrl(string name) => $"/api/msme/schemes/fa/files/{Uri.EscapeDataString(name)}";
}

/// <summary>Builds the DynamicPhotoList table-valued parameter from documents found in the MSME's own folder.</summary>
public static class SchemePhotoList
{
    /// <param name="attached">Documents already recorded for the item (name → stored time stamp), kept when sent back unchanged.</param>
    public static DataTable? Build(string root, string zedId, string folder, IEnumerable<SchemeDocumentRef> docs,
        IReadOnlyDictionary<string, string?>? attached = null)
    {
        var table = new DataTable();
        table.Columns.Add("PhotoId", typeof(string));
        table.Columns.Add("Name", typeof(string));
        table.Columns.Add("TimeStamp", typeof(string));
        table.Columns.Add("Latitude", typeof(string));
        table.Columns.Add("Longitude", typeof(string));
        foreach (var d in docs)
        {
            if (d.FileName is not null && attached is not null && attached.TryGetValue(d.FileName, out var stamp))
            {
                table.Rows.Add(d.FileName, d.Type, stamp ?? " ", " ", " ");
                continue;
            }
            if (!SchemeUploads.IsGenerated(d.FileName)) return null;
            var full = SchemeUploads.Find(root, zedId, folder, d.FileName);
            if (full is null) return null;
            // As the legacy action: Name carries the document type, no location for web uploads.
            table.Rows.Add(d.FileName, d.Type, SchemeUploads.TimeStamp(full), " ", " ");
        }
        return table;
    }
}
