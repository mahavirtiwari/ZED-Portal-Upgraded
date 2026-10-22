using System.Data;
using System.Data.Common;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Portal.Features.Staff.Schemes;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Consultancy.TechnologyUpgradation;

/// <summary>Settings <c>Consultancy:TuApp:*</c> for the consultant app's technology upgradation calls.</summary>
public sealed class TuAppOptions
{
    public const string Section = "Consultancy:TuApp";

    /// <summary>
    /// The unit's allotted DFO must have signed in to the consultant app for that unit within this many hours. 0 switches
    /// the check off (anyone could then act for the DFO of a unit under verification, as on the old site: not advised).
    /// </summary>
    public int LoginHours { get; set; } = 12;

    /// <summary>Also require the call to come from the IP address of that sign-in (breaks when the phone changes network).</summary>
    public bool SameIp { get; set; }
}

/// <summary>JSON body of FinancialAssistance/GetDetails (the app's BaseServiceRequest; it sends <c>zedId</c> only).</summary>
public sealed class TuAppDetailsRequest
{
    public string? saId { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
}

/// <summary>
/// The consultant app's technology upgradation (TU) verification by the DFO, at its old addresses on the consultancy web
/// site (the consultancy API runs under <c>/Consultancy</c>): <c>FinancialAssistance/GetDetails</c>, <c>ValidateEvidence</c>,
/// <c>FinalSubmit</c> and <c>updatetechnology</c>, with the requests and answers of the old FinancialAssistanceController
/// (app source ZEDConsultant, 2026-10-22). The opening meeting is <see cref="TuOpenMeetingController"/>.
/// <para>
/// The app sends no user name, password, token or session with these four calls (GetDetails sends <c>saId</c> null), and
/// the old actions had no filter (finding #88): anyone could read a unit's application with its bank account, validate
/// documents, change the amounts that set the subsidy, or approve. The old FinalSubmit even ran as "DFO" because the
/// missing session role defaulted to it (#117). Here every call is for one unit whose allotted DFO (FinancialAssessorId)
/// signed in to the consultant app for that unit within <see cref="TuAppOptions.LoginHours"/> (dbo.V4AppSessions, written
/// by the consultancy mobile deployment's SA/Login, migration 0010); writes only while the application is with that DFO
/// (VerificationStatus 2), as that DFO; amounts at most what the unit declared; uploads content-checked and stored under
/// generated names. The rest of the residual risk (no proof that the caller is the DFO) needs an app release that sends
/// a token: see docs/mobile/CONSULTANT-SA-IMPACT-APPS.md.
/// </para>
/// </summary>
[PortalSystems(PortalSystem.Consultancy)]
public sealed class TuAppController(
    ISqlExecutor db,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    IOptions<EmailOptions> emailOptions,
    IConfiguration config,
    ILogger<TuAppController> log) : LegacyMobileController
{
    public const string NotAvailable = "Technology upgradation details are not available for this unit. Please login again in the app for this unit.";
    public const string NotWithDfo = "This application is not with the DFO for verification.";
    public const int MaxFiles = 10;
    public const long MaxFileBytes = 5 * 1024 * 1024;

    private TuAppOptions Options => config.GetSection(TuAppOptions.Section).Get<TuAppOptions>() ?? new();

    /// <summary>The unit's applications as SP_FINANCIAL_ASSISTANCE_GET_DETAILS returns them (Table, Table1, ...).</summary>
    [HttpPost("/FinancialAssistance/GetDetails")]
    public async Task<IActionResult> GetDetails(TuAppDetailsRequest request, CancellationToken ct)
    {
        var zedId = request.zedId?.Trim();
        if (!SchemeRows.IsZedId(zedId)) return Fail(NotAvailable);
        var sets = await db.QueryProcMultipleAsync("SP_FINANCIAL_ASSISTANCE_GET_DETAILS", new { ZedId = zedId }, ct);
        // An application with its allotted DFO or just decided by them (the app shows it read-only), and that DFO signed in.
        var apps = await TuApplications.LoadAsync(db, zedId!, ct);
        var open = apps.Where(a => a.Status is FaStatus.InProgress or FaStatus.Qc && !string.IsNullOrWhiteSpace(a.AssessorUserId)).ToList();
        foreach (var app in open)
            if (await SignedInAsync(app, ct))
                return LegacyContent(LegacyResults.DataSetJson(sets));
        log.LogWarning("TU app GetDetails for {ZedId} refused: no application with a signed-in allotted DFO", zedId);
        return Fail(NotAvailable);
    }

    /// <summary>The DFO's verdict on one document (multipart: Id, ZedId, CertificationType, IsVerified, SourceOfValidation, Remarks, files).</summary>
    [HttpPost("/FinancialAssistance/ValidateEvidence")]
    [RequestSizeLimit(MaxFiles * MaxFileBytes + 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxFiles * MaxFileBytes + 1024 * 1024)]
    public async Task<IActionResult> ValidateEvidence([FromForm] string? Id, [FromForm] string? ZedId, [FromForm] string? CertificationType,
        [FromForm] string? IsVerified, [FromForm] string? SourceOfValidation, [FromForm] string? Remarks, [FromForm] List<IFormFile>? files, CancellationToken ct)
    {
        if (!int.TryParse(Id, NumberStyles.None, CultureInfo.InvariantCulture, out var id) || IsVerified is not ("Yes" or "No")) return Fail("Invalid Data.");
        if (SourceOfValidation?.Length > 2000 || Remarks?.Length > 2000) return Fail("Invalid Data.");
        var uploads = (files ?? []).Where(f => f.Length > 0).ToList();
        if (uploads.Count > MaxFiles) return Fail("Invalid Data.");
        var kinds = new List<string>();
        foreach (var f in uploads)
        {
            if (f.Length > MaxFileBytes || await FileKindAsync(f, ct) is not { } kind) return Fail("Please upload valid document (PDF / JPG / PNG).");
            kinds.Add(kind);
        }

        using (await SchemeLocks.EnterAsync(ct))
        {
            var (app, refusal) = await WithDfoAsync(ZedId, CertificationType, ct);
            if (app is null) return refusal!;
            if (app.Fa.Photo(id) is null) return Fail("Invalid Data.");

            var storage = new TuStorage(env, portal, config);
            var saved = new List<(string Name, string Path)>();
            for (var i = 0; i < uploads.Count; i++)
            {
                var name = $"{DateTime.Now:yyyyMMddHHmmssfff}_{id}_{Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(4))}{kinds[i]}";
                var path = storage.Target($"{TuStorage.ScreenshotFolder(app.ZedId, app.Certification)}/{name}");
                if (path is null) return Fail("Invalid Data.");
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                await using (var stream = System.IO.File.Create(path)) await uploads[i].CopyToAsync(stream, ct);
                saved.Add((name, path));
            }
            // As the web review: the procedure replaces the document's screenshots with the ones passed; keep the existing
            // ones when the app sends none.
            var table = new DataTable();
            table.Columns.Add("FileName", typeof(string));
            var names = saved.Count > 0 ? saved.Select(s => s.Name)
                : app.Fa.ScreenshotsOf(id).Select(s => FaFilePaths.FileName(s.Text("FileName"))).OfType<string>();
            foreach (var n in names) table.Rows.Add(n);
            try
            {
                await db.ExecuteProcAsync("SP_FINANCIAL_ASSISTANCE_VALIDATE_EVIDENCES", new
                {
                    Id = id.ToString(CultureInfo.InvariantCulture),
                    ZedId = app.ZedId,
                    CertificationType = app.Certification,
                    IsVerified,
                    SourceOfValidation = SchemeRows.CleanText(SourceOfValidation, 2000),
                    Remark = SchemeRows.CleanText(Remarks, 2000),
                    Screenshots = table.AsTableValuedParameter("FileDetails"),
                }, ct);
            }
            catch (DbException ex)
            {
                log.LogError(ex, "SP_FINANCIAL_ASSISTANCE_VALIDATE_EVIDENCES failed for {ZedId}/{Id}", app.ZedId, id);
                foreach (var s in saved) TryDelete(s.Path);
                return Fail(ErrorText);
            }
            log.LogInformation("TU document {Id} of {ZedId}/{Certification} validated ({IsVerified}) from the app for DFO {Dfo}",
                id, app.ZedId, app.Certification, IsVerified, app.AssessorUserId);
        }
        return LegacyJson(new ServiceResponse { status = "1" });
    }

    /// <summary>The verified purchase amount of one technology (JSON: ZedID, Id, AmountPaid).</summary>
    [HttpPost("/FinancialAssistance/updatetechnology")]
    public async Task<IActionResult> UpdateTechnology([FromBody] JsonElement body, CancellationToken ct)
    {
        var zedId = Field(body, "ZedId");
        if (!int.TryParse(Field(body, "Id"), NumberStyles.None, CultureInfo.InvariantCulture, out var id) ||
            !decimal.TryParse(Field(body, "AmountPaid"), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var amount) ||
            amount < 0 || amount > TuVerificationController.MaxAmount || decimal.Round(amount, 2) != amount)
            return Fail("Please enter a valid amount.");
        if (!SchemeRows.IsZedId(zedId)) return Fail(NotAvailable);

        using (await SchemeLocks.EnterAsync(ct))
        {
            // The app sends no level: the technology row names the application.
            var app = (await TuApplications.LoadAsync(db, zedId!, ct)).FirstOrDefault(a => a.Technology(id) is not null);
            var (checkedApp, refusal) = app is null ? (null, Fail(NotAvailable)) : await WithDfoAsync(app.ZedId, app.Certification, ct);
            if (checkedApp is null) return refusal!;
            var tech = checkedApp.Technology(id)!;
            if (SchemeRows.Decimal(tech, "MsmeAmountPaid") is > 0 and var declared && amount > declared)
                return Fail($"The amount cannot be more than the amount paid entered by the unit (Rs. {declared.ToString("0.##", CultureInfo.InvariantCulture)}).");

            var before = tech.Text("AmountPaid");
            try
            {
                await db.ExecuteProcAsync("SP_FINANCIAL_ASSISTANCE_UPDATE_TECHNOLOGY_DATA", new
                {
                    Id = id.ToString(CultureInfo.InvariantCulture),
                    ZedId = checkedApp.ZedId,
                    AmountPaid = amount.ToString("0.00", CultureInfo.InvariantCulture),
                }, ct);
            }
            catch (DbException ex)
            {
                log.LogError(ex, "SP_FINANCIAL_ASSISTANCE_UPDATE_TECHNOLOGY_DATA failed for {ZedId}/{Id}", checkedApp.ZedId, id);
                return Fail(ErrorText);
            }
            await SchemeRows.AuditAsync(db, log, checkedApp.ZedId, checkedApp.Certification,
                $"Technology upgradation amount of technology {tech.Text("TechnologyCode")} changed from the app for DFO {checkedApp.AssessorUserId}: {before} -> {amount.ToString("0.00", CultureInfo.InvariantCulture)}", ct);
        }
        return LegacyJson(new ServiceResponse { status = "1" });
    }

    /// <summary>The DFO's decision (JSON: the application row of GetDetails with IsApproved 1 = approve, 2 = reject, and Comments).</summary>
    [HttpPost("/FinancialAssistance/FinalSubmit")]
    public async Task<IActionResult> FinalSubmit([FromBody] JsonElement body, CancellationToken ct)
    {
        var approve = Field(body, "IsApproved") switch { "1" => true, "2" => false, _ => (bool?)null };
        var comments = SchemeRows.CleanText(Field(body, "Comments"), 2000);
        if (approve is null || Field(body, "Comments")?.Length > 2000) return Fail("Invalid Data.");
        if (approve == false && comments is null) return Fail("Please enter the comments.");

        TuApplication? app;
        using (await SchemeLocks.EnterAsync(ct))
        {
            IActionResult? refusal;
            (app, refusal) = await WithDfoAsync(Field(body, "ZedId"), Field(body, "CertificationType"), ct);
            if (app is null) return refusal!;
            if (!SchemeRows.Same(Field(body, "Id"), app.Id.ToString(CultureInfo.InvariantCulture))) return Fail("Invalid Data.");
            try
            {
                // As the allotted DFO (RoleId 3): the old action passed the session's role, which the app never had.
                await db.ExecuteProcAsync("SP_FINANCIAL_ASSISTANCE_FINAL_AUBMIT", new
                {
                    ZedId = app.ZedId,
                    CertificationType = app.Certification,
                    Comments = comments,
                    IsApproved = approve.Value ? "1" : "2",
                    Id = app.Id.ToString(CultureInfo.InvariantCulture),
                    UserId = app.AssessorUserId,
                    RoleId = "3",
                }, ct);
            }
            catch (DbException ex)
            {
                log.LogError(ex, "SP_FINANCIAL_ASSISTANCE_FINAL_AUBMIT failed for {ZedId}/{Certification}", app.ZedId, app.Certification);
                return Fail(ErrorText);
            }
            log.LogInformation("TU application {ZedId}/{Certification} {Decision} from the app for DFO {Dfo}", app.ZedId, app.Certification,
                approve.Value ? "approved" : "rejected", app.AssessorUserId);
        }

        // As the web review: the MSME is told of the DFO's rejection.
        if (!approve.Value)
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
        return LegacyJson(new ServiceResponse { status = "1" });
    }

    // ------------------------------------------------------------------ helpers

    private const string ErrorText = "An error has occurred, please try again later.";

    /// <summary>The application of one level while it is with its allotted DFO, who signed in to the app for the unit; else the answer.</summary>
    private async Task<(TuApplication? App, IActionResult? Refusal)> WithDfoAsync(string? zedId, string? certification, CancellationToken ct)
    {
        zedId = zedId?.Trim();
        if (!SchemeRows.IsZedId(zedId) || FaApplications.Canonical(certification) is not { } cert) return (null, Fail("Invalid Data."));
        var app = await TuApplications.FindAsync(db, zedId!, cert, ct);
        if (app is null || string.IsNullOrWhiteSpace(app.AssessorUserId) || app.Status != FaStatus.InProgress)
        {
            log.LogWarning("TU app call for {ZedId}/{Certification} refused: the application is not with a DFO", zedId, cert);
            return (null, Fail(NotWithDfo));
        }
        if (!await SignedInAsync(app, ct))
        {
            log.LogWarning("TU app call for {ZedId}/{Certification} refused: DFO {Dfo} has not signed in to the app for the unit recently", zedId, cert, app.AssessorUserId);
            return (null, Fail(NotAvailable));
        }
        return (app, null);
    }

    private async Task<bool> SignedInAsync(TuApplication app, CancellationToken ct)
    {
        var o = Options;
        if (o.LoginHours <= 0) return true;
        var ip = o.SameIp ? HttpContext.Connection.RemoteIpAddress?.ToString() : null;
        return await AppSessions.LatestAsync(db, log, AppSessions.Consultant, app.AssessorUserId, app.ZedId, o.LoginHours, ip, ct) is not null;
    }

    /// <summary>A property of the JSON body, case-insensitively (as MVC 5 bound it), as text.</summary>
    private static string? Field(JsonElement body, string name)
    {
        if (body.ValueKind != JsonValueKind.Object) return null;
        foreach (var p in body.EnumerateObject())
            if (string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase))
                return p.Value.ValueKind switch
                {
                    JsonValueKind.String => p.Value.GetString()?.Trim(),
                    JsonValueKind.Number => p.Value.GetRawText(),
                    JsonValueKind.True => "true",
                    JsonValueKind.False => "false",
                    _ => null,
                };
        return null;
    }

    /// <summary>".pdf", ".jpg" or ".png" from the file's first bytes, else null.</summary>
    private static async Task<string?> FileKindAsync(IFormFile file, CancellationToken ct)
    {
        var head = new byte[8];
        await using var s = file.OpenReadStream();
        var n = await s.ReadAtLeastAsync(head, head.Length, throwOnEndOfStream: false, ct);
        if (n >= 4 && head[0] == 0x25 && head[1] == 0x50 && head[2] == 0x44 && head[3] == 0x46) return ".pdf";
        if (n >= 3 && head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF) return ".jpg";
        if (n >= 8 && head.AsSpan(0, 8).SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A })) return ".png";
        return null;
    }

    private void TryDelete(string path)
    {
        try { System.IO.File.Delete(path); }
        catch (IOException ex) { log.LogWarning(ex, "Could not delete {Path}", path); }
    }
}
