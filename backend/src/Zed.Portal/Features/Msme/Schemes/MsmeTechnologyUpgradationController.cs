using System.Data.Common;
using System.Globalization;
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
/// The MSME's application for financial support for Zero Effect Solutions (technology upgradation, up to
/// Rs. 3,00,000) after Handholding milestone 3: the technologies the consultant recommended, the purchase
/// details of each, then the reimbursement bank account. The data lives in ZED_CONSULTANT; the main
/// procedures write there and auto-allot an agency (verified on the consultancy portal).
/// Port of TechnologyUpgradationController.Index / GetTechnologyList / UploadDocs / SubmitTechnologyData /
/// SubmitFinancialData (Frontend/TechnologyUpgradation/Index.cshtml). Reached from the dashboard's
/// "Technology Upgradation" Avail button while ZED_CONSULTANT Msme.TechnologyUpgradation = 1.
/// <para>
/// Legacy problems fixed here: GetTechnologyList took the ZED ID from the request (any user could list
/// another unit's technologies, invoices and documents); the certification, CertId, technology code and
/// eligible amount of a submission came from the browser (SP_APP_MSME_INSERT_TECHNOLOGY_DETAILS inserts
/// whatever it is given); UploadDocs accepted any file; the date limits and the "already submitted" check
/// were only in the browser. Here they come from the procedures for the signed-in unit.
/// </para>
/// <para>
/// Details/GetDetails of the legacy controller are not ported: they read the main FinancialAssistance
/// tables (a copy of the FA page) and nothing links to them.
/// </para>
/// </summary>
[Route("api/msme/schemes/tu")]
public sealed class MsmeTechnologyUpgradationController(
    ISqlExecutor db,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    IOptions<EmailOptions> emailOptions,
    ILogger<MsmeTechnologyUpgradationController> log) : MsmeApiController
{
    public const string PurchasedTechnology = "Purchased Technology";
    public const string InvoiceCopy = "Copy of Invoice";
    public const string CaCertificate = "CA certificate of expenditure";
    public const string CancelledCheque = "Copy of Cancelled Cheque";
    public static readonly string[] TechnologyDocumentTypes = [PurchasedTechnology, InvoiceCopy, CaCertificate];
    public static readonly string[] DocumentTypes = [PurchasedTechnology, InvoiceCopy, CaCertificate, CancelledCheque];
    public const decimal SupportCap = 300_000m;

    public static readonly string[] SubmittedColumns =
    [
        "NameOfTheManufaturer", "MakeOrModelName", "DateOfPurchase", "AgencyOrSupplier", "InvoiceNo", "InvoiceBillDate",
        "AmountPaid", "EligibleAmount", "ModeOfPayment",
    ];

    public sealed record TechnologyDto(
        string Code, int? SNo, string Name, string? Description, decimal? EligibleSubsidyPer, bool Submitted,
        Dictionary<string, object?>? Details, IReadOnlyList<SchemeDocumentDto> Documents);

    public sealed record PageResponse(
        Dictionary<string, object?> Unit, bool CanApply, string? Message, string? Certification, string? MinDate,
        IReadOnlyList<TechnologyDto> Technologies, decimal TotalAmount, decimal EligibleTotal);

    /// <summary>GET api/msme/schemes/tu — the unit, the recommended technologies and what was submitted for each.</summary>
    [HttpGet]
    public async Task<ActionResult<PageResponse>> Get(CancellationToken ct)
    {
        var s = await StateAsync(ct);
        if (s is null) return NotFound();
        var techs = s.Technologies.Select(t => ToDto(s, t)).ToList();
        var (total, eligible) = Totals(s);
        return new PageResponse(s.Unit.Panel(), s.Refusal is null, s.Refusal, s.Certification,
            s.MinDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), s.Refusal is null ? techs : [], total, eligible);
    }

    /// <summary>POST api/msme/schemes/tu/documents (multipart: type, file) — PDF/JPEG/PNG up to 5 MB.</summary>
    [HttpPost("documents")]
    [RequestSizeLimit(SchemeUploads.MaxBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = SchemeUploads.MaxBytes + 64 * 1024)]
    public async Task<ActionResult<MsmeFinancialAssistanceController.UploadResponse>> Upload([FromForm] string? type, IFormFile? file, CancellationToken ct)
    {
        var docType = DocumentTypes.FirstOrDefault(t => t == type);
        if (docType is null) return this.Problem400("Invalid document type.");
        if (file is null || await SchemeUploads.KindAsync(file, ct) is not { } ext)
            return this.Problem400("Please upload valid document (PDF / JPG / PNG, less than 5 MB).");

        var s = await StateAsync(ct);
        if (s is null) return NotFound();
        if (s.Refusal is { } refusal) return this.Problem400(refusal);

        var root = SchemeUploads.StorageRoot(env, portal.Value);
        var name = await SchemeUploads.SaveAsync(root, ZedId, SchemeUploads.TuFolder, file, ext, ct);
        if (name is null) return this.Problem400("The document could not be saved. Please try again.");
        var full = SchemeUploads.Find(root, ZedId, SchemeUploads.TuFolder, name)!;
        log.LogInformation("TU document {Name} ({Type}) uploaded by {ZedId}", name, docType, ZedId);
        return new MsmeFinancialAssistanceController.UploadResponse(name, docType, SchemeUploads.TimeStamp(full), SchemeUploads.IsPdf(name), FileUrl(name));
    }

    /// <summary>GET api/msme/schemes/tu/files/{name} — one of the signed-in MSME's own TU documents.</summary>
    [HttpGet("files/{name}")]
    public IActionResult Document(string name)
    {
        var full = SchemeUploads.Find(SchemeUploads.StorageRoot(env, portal.Value), ZedId, SchemeUploads.TuFolder, name);
        return full is null ? NotFound() : SchemeUploads.Serve(this, full);
    }

    public sealed record TechnologyRequest(
        string? NameOfTheManufaturer, string? MakeOrModelName, string? DateOfPurchase, string? AgencyOrSupplier,
        string? InvoiceNo, string? InvoiceBillDate, decimal? AmountPaid, string? ModeOfPayment, IReadOnlyList<SchemeDocumentRef>? Documents);

    /// <summary>POST api/msme/schemes/tu/technologies/{code} — SP_APP_MSME_INSERT_TECHNOLOGY_DETAILS (saves or replaces one technology).</summary>
    [HttpPost("technologies/{code}")]
    public async Task<ActionResult<MessageResponse>> SubmitTechnology(string code, TechnologyRequest req, CancellationToken ct)
    {
        using (await SchemeLocks.EnterAsync(ct))
        {
            var s = await StateAsync(ct);
            if (s is null) return NotFound();
            if (s.Refusal is { } refusal) return this.Problem400(refusal);
            var tech = s.Technologies.FirstOrDefault(t => t.Text("TechnologyCode") == code);
            if (tech is null) return NotFound();

            // Documents already recorded for this technology may be sent back as they are (VIEW → SUBMIT again).
            var attached = s.Photos
                .Where(p => p.Text("TechnologyCode") == code && FaFilePaths.FileName(p.Text("photoPath")) is not null)
                .GroupBy(p => p.Text("photoPath"))
                .ToDictionary(g => g.Key, g => (string?)g.First().Text("timeStamp"));
            if (ValidateTechnology(req, s.MinDate, attached) is { } invalid) return this.Problem400(invalid);
            var photos = SchemePhotoList.Build(SchemeUploads.StorageRoot(env, portal.Value), ZedId, SchemeUploads.TuFolder, req.Documents!, attached);
            if (photos is null) return this.Problem400("Please upload the required documents.");

            var amount = SchemeInput.Amount(req.AmountPaid)!.Value;
            // As the legacy page: amount paid (whole rupees) × the subsidy percentage of the milestone payment.
            var percent = SchemeRows.Decimal(tech, "EligibleSubsidyPer") ?? 0m;
            var eligible = decimal.Round(decimal.Truncate(amount) * percent / 100m, 2);

            ResultSets result;
            try
            {
                result = await db.QueryProcMultipleAsync("SP_APP_MSME_INSERT_TECHNOLOGY_DETAILS", new
                {
                    RefId = DateTime.Now.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture),
                    ZedId,
                    CertificationType = s.Certification,
                    CertId = s.CertId,
                    TechnologyCode = code,
                    NameOfTheManufaturer = SchemeInput.Text(req.NameOfTheManufaturer, 500),
                    MakeOrModelName = SchemeInput.Text(req.MakeOrModelName, 500),
                    DateOfPurchase = SchemeInput.Date(req.DateOfPurchase, s.MinDate),
                    AgencyOrSupplier = SchemeInput.Text(req.AgencyOrSupplier, 200),
                    InvoiceNo = SchemeInput.Text(req.InvoiceNo, 50),
                    InvoiceBillDate = SchemeInput.Date(req.InvoiceBillDate, s.MinDate),
                    AmountPaid = SchemeInput.Money(amount),
                    EligibleAmount = SchemeInput.Money(eligible),
                    ModeOfPayment = MsmeFinancialAssistanceController.PaymentModes.First(m => m == req.ModeOfPayment),
                    SubmittedFrom = "Web",
                    PhotoListWeb = photos.AsTableValuedParameter("DynamicPhotoList"),
                }, ct);
            }
            catch (DbException ex)
            {
                log.LogError(ex, "SP_APP_MSME_INSERT_TECHNOLOGY_DETAILS failed for {ZedId}/{Code}", ZedId, code);
                return this.Problem400("The technology details could not be saved. Please try again.");
            }
            var row = result[0].FirstOrDefault();
            if (row?.Text("Status") != "1")
                return this.Problem400(row?.Text("ErrorMessage") is { Length: > 0 and <= 200 } m ? m : "The technology details could not be saved.");
            log.LogInformation("TU technology {Code} submitted by {ZedId} ({Certification}/{CertId}): amount {Amount}", code, ZedId, s.Certification, s.CertId, amount);
        }
        return new MessageResponse("Data submitted Successfully.");
    }

    public sealed record SubmitRequest(SchemeAccount? Account, IReadOnlyList<SchemeDocumentRef>? Documents, bool Declaration);

    /// <summary>
    /// POST api/msme/schemes/tu — SP_APP_MSME_INSERT_TECHNOLOGY_UPGRADATION: bank account and cancelled cheque,
    /// completes the application (the procedure computes the eligible amount and allots an agency).
    /// </summary>
    [HttpPost]
    public async Task<ActionResult<MessageResponse>> Submit(SubmitRequest req, CancellationToken ct)
    {
        if (!req.Declaration) return this.Problem400("Please accept the declaration.");
        if (MsmeFinancialAssistanceController.AccountProblem(req.Account) is { } bad) return this.Problem400(bad);
        if (MsmeFinancialAssistanceController.DocumentsProblem(req.Documents, [CancelledCheque], [CancelledCheque]) is { } docs)
            return this.Problem400(docs);
        var photos = SchemePhotoList.Build(SchemeUploads.StorageRoot(env, portal.Value), ZedId, SchemeUploads.TuFolder, req.Documents!);
        if (photos is null) return this.Problem400("Please upload the required documents.");
        var a = req.Account!;
        string certification;

        using (await SchemeLocks.EnterAsync(ct))
        {
            var s = await StateAsync(ct);
            if (s is null) return NotFound();
            if (s.Refusal is { } refusal) return this.Problem400(refusal);
            if (!s.Technologies.Any(Submitted)) return this.Problem400("Please submit the details of at least one technology.");
            certification = s.Certification!;

            try
            {
                await db.ExecuteProcAsync("SP_APP_MSME_INSERT_TECHNOLOGY_UPGRADATION", new
                {
                    RefId = DateTime.Now.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture),
                    ZedId,
                    CertificationType = s.Certification,
                    CertId = s.CertId,
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
                // The procedure forces a conversion error once the application was submitted; never show its text.
                log.LogWarning(ex, "SP_APP_MSME_INSERT_TECHNOLOGY_UPGRADATION refused for {ZedId}", ZedId);
                return this.Problem400("The application could not be submitted. It may already have been submitted.");
            }
        }
        log.LogInformation("TU application submitted by {ZedId} for {Certification}", ZedId, certification);

        var mailer = new SchemeMailer(db, email, templates, portal, emailOptions, log);
        await mailer.SendAsync<MsmeSchemeTuSubmittedEmail>(await RecipientAsync(certification, ct),
            $"Confirmation of Application for Financial Support for Zero Effect Solution - {ZedId}",
            new() { [nameof(MsmeSchemeTuSubmittedEmail.ZedId)] = ZedId }, ct);
        return new MessageResponse("Application for Financial Support for Zero Effect Solution submitted successfully!");
    }

    public static string? ValidateTechnology(TechnologyRequest r, DateOnly? min, IReadOnlyDictionary<string, string?>? attached = null)
    {
        if (SchemeInput.Text(r.NameOfTheManufaturer, 500) is null) return "Please enter the name of manufacturer (up to 500 characters).";
        if (SchemeInput.Text(r.MakeOrModelName, 500) is null) return "Please enter the make / model name (up to 500 characters).";
        var range = min is { } m ? $" (between {m:dd-MM-yyyy} and today)" : " (not in the future)";
        if (SchemeInput.Date(r.DateOfPurchase, min) is null) return "Please enter a valid date of purchase" + range + ".";
        if (SchemeInput.Text(r.AgencyOrSupplier, 200) is null) return "Please enter the name of agency/supplier (up to 200 characters).";
        if (SchemeInput.Text(r.InvoiceNo, 50) is null) return "Please enter the invoice/bill number (up to 50 characters).";
        if (SchemeInput.Date(r.InvoiceBillDate, min) is null) return "Please enter a valid invoice/bill date" + range + ".";
        if (SchemeInput.Amount(r.AmountPaid) is null) return "Please enter a valid amount paid.";
        if (!MsmeFinancialAssistanceController.PaymentModes.Contains(r.ModeOfPayment)) return "Please select the mode of payment.";
        return MsmeFinancialAssistanceController.DocumentsProblem(r.Documents, [PurchasedTechnology, InvoiceCopy], TechnologyDocumentTypes, attached);
    }

    private sealed record TuState(
        SchemeUnit Unit, string? Certification, string? CertId, DateOnly? MinDate, string? Refusal,
        IReadOnlyList<IDictionary<string, object?>> Technologies,
        IReadOnlyList<IDictionary<string, object?>> SubmittedRows,
        IReadOnlyList<IDictionary<string, object?>> Photos);

    /// <summary>
    /// The unit and, when it may apply, the recommended technologies (SP_TECHNOLOGY_UPGRADATION_GET_LIST for the
    /// certification and CertId that SP_MSME_GET_DETAILS 'Techupgrade' returns for the signed-in MSME).
    /// </summary>
    private async Task<TuState?> StateAsync(CancellationToken ct)
    {
        var unit = await SchemeUnit.LoadAsync(db, ZedId, ct);
        if (unit is null) return null;
        TuState Refuse(string message) => new(unit, null, null, null, message, [], [], []);

        if (!unit.EligibleForBenefits) return Refuse("You are not eligible for benefits. Please contact ZED team.");
        if (unit.TuFlag != "1") return Refuse(unit.TuFlag == "0"
            ? "Data already submitted."
            : "Technology upgradation can be applied for after the Handholding Support recommends technologies for your unit.");

        var tu = await db.QueryProcMultipleAsync("SP_MSME_GET_DETAILS", new { ZedId, CertificationType = "Techupgrade" }, ct);
        var pay = tu[4].FirstOrDefault();
        var certification = FaApplications.Canonical(pay?.Text("Certification"));
        var certId = pay?.Text("CertId");
        if (certification is null || !int.TryParse(certId, NumberStyles.None, CultureInfo.InvariantCulture, out _))
            return Refuse("No technologies have been recommended for your unit yet.");

        var list = await db.QueryProcMultipleAsync("SP_TECHNOLOGY_UPGRADATION_GET_LIST",
            new { ZedId, Certification = certification, CertId = certId, UserId = ZedId, RoleId }, ct);
        if (list[3].FirstOrDefault()?.Text("TechnologyUpgradation") != "1") return Refuse("Data already submitted.");
        if (list[0].Count == 0) return Refuse("No technologies have been recommended for your unit yet.");

        // The page limited both dates to the days since the certification (first technology's DaysLimit).
        DateOnly? min = SchemeRows.Int(list[0][0], "DaysLimit") is { } days and >= 0
            ? DateOnly.FromDateTime(DateTime.Today.AddDays(-days))
            : null;
        return new TuState(unit, certification, certId, min, null, list[0], list[1], list[2]);
    }

    private static bool Submitted(IDictionary<string, object?> tech) => tech.Text("Submitted") is "1" or "True" or "true";

    private static (decimal Total, decimal Eligible) Totals(TuState s)
    {
        decimal total = 0, eligible = 0;
        foreach (var row in s.SubmittedRows)
        {
            total += SchemeRows.Decimal(row, "AmountPaid") ?? 0;
            eligible += SchemeRows.Decimal(row, "EligibleAmount") ?? 0;
        }
        return (total, Math.Min(eligible, SupportCap));
    }

    private static TechnologyDto ToDto(TuState s, IDictionary<string, object?> t)
    {
        var code = t.Text("TechnologyCode");
        var submitted = s.SubmittedRows.FirstOrDefault(r => r.Text("TechnologyCode") == code);
        var docs = s.Photos
            .Where(p => p.Text("TechnologyCode") == code)
            .Select(p => (Photo: p, Name: FaFilePaths.FileName(p.Text("photoPath"))))
            .Where(p => p.Name is not null)
            .Select(p => new SchemeDocumentDto(p.Name!, p.Photo.Text("photoType") is { Length: > 0 } ty ? ty : null,
                p.Photo.Text("timeStamp") is { Length: > 0 } ts ? ts : null, SchemeUploads.IsPdf(p.Name), FileUrl(p.Name!)))
            .ToList();
        return new TechnologyDto(code, SchemeRows.Int(t, "SNo"), t.Text("TechnologyName"),
            t.Text("Description") is { Length: > 0 } d ? d : null, SchemeRows.Decimal(t, "EligibleSubsidyPer"),
            Submitted(t) && submitted is not null, submitted is null ? null : SchemeRows.Pick(submitted, SubmittedColumns), docs);
    }

    private async Task<string?> RecipientAsync(string certification, CancellationToken ct)
    {
        try
        {
            return (await db.QueryProcMultipleAsync("SP_EMAIL_GET_DETAILS_TECHNOLOGY_UPGRADATION", new { ZedId, Certification = certification }, ct))[0]
                .FirstOrDefault()?.Text("EmailId");
        }
        catch (DbException ex)
        {
            log.LogError(ex, "SP_EMAIL_GET_DETAILS_TECHNOLOGY_UPGRADATION failed for {ZedId}", ZedId);
            return null;
        }
    }

    private static string FileUrl(string name) => $"/api/msme/schemes/tu/files/{Uri.EscapeDataString(name)}";
}
