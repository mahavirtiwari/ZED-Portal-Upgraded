using System.Data.Common;
using System.Globalization;
using Microsoft.Extensions.Options;
using SkiaSharp;
using Zed.Core.Certificates;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal.Features.CertLevels;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Documents;

/// <summary>
/// <see cref="IAssessmentDocuments"/> of the running host, on the host's own database (<see cref="PortalHost"/>):
/// <list type="bullet">
/// <item>Main: Bronze/Silver/Gold certificates and assessment reports.</item>
/// <item>Surveillance: surveillance certificates (<c>IssueCertificateAsync(zedId, level)</c>, also "{Level}Surveillance")
/// and surveillance reports.</item>
/// <item>Consultancy: handholding milestone reports, <c>RenderReportAsync(zedId, "{Level}Milestone{n}")</c> (a plain level
/// takes the unit's current milestone). Milestones have no certificate (<see cref="DocumentNotAvailableException"/>).</item>
/// </list>
/// The drawing is in <see cref="DocumentRenderer"/>, which main also uses with the other systems' read-only connections.
/// </summary>
public sealed class AssessmentDocuments(
    ISqlExecutor db,
    PortalHost host,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<AssessmentDocuments> log) : IAssessmentDocuments
{
    private readonly DocumentRenderer _renderer = new(env, portal, log);

    public Task<DocumentFile> IssueCertificateAsync(string zedId, string certification, CancellationToken ct)
    {
        switch (host.System)
        {
            case PortalSystem.Surveillance:
                return _renderer.IssueSurveillanceCertificateAsync(db, zedId, DocumentLevels.SurveillanceLevel(certification) ?? certification, ct);
            case PortalSystem.Consultancy:
                ValidMilestone(zedId, certification);
                throw new DocumentNotAvailableException("Handholding milestones have no certificate.");
            default:
                return _renderer.IssueCertificateAsync(db, zedId, certification, ct);
        }
    }

    public Task<DocumentFile> RenderReportAsync(string zedId, string certification, CancellationToken ct)
    {
        switch (host.System)
        {
            case PortalSystem.Surveillance:
                return _renderer.RenderSurveillanceReportAsync(db, zedId, DocumentLevels.SurveillanceLevel(certification) ?? certification, ct);
            case PortalSystem.Consultancy:
                var (level, milestone) = ValidMilestone(zedId, certification);
                return _renderer.RenderMilestoneReportAsync(db, zedId, level, milestone, save: true, ct);
            default:
                return _renderer.RenderReportAsync(db, zedId, certification, ct);
        }
    }

    private static (string Level, int? Milestone) ValidMilestone(string zedId, string certification)
    {
        if (!AssessmentInput.IsId(zedId)) throw new ArgumentException("Invalid ZED ID.", nameof(zedId));
        if (DocumentLevels.TryMilestone(certification, out var level, out var milestone)) return (level, milestone);
        return DocumentLevels.Level(certification) is "Silver" or "Gold"
            ? (DocumentLevels.Level(certification)!, null)
            : throw new ArgumentException("Invalid certification.", nameof(certification));
    }
}

/// <summary>
/// Certificates and reports, drawn with SkiaSharp instead of the old System.Drawing/iTextSharp (certificates) and
/// SelectPdf (reports) code, on the database it is given. Files are written where the old sites kept them under
/// Portal:StorageRoot (shared by the three hosts), so existing links, My Documents and the regenerate list find them.
/// <list type="bullet">
/// <item>Bronze: SP_DA_GET_CERTIFICATE_DETAILS, DaBronze.jpg + DaCertification.json → Certificates/DA/{ZedId}/Bronze.pdf
/// (MonitoringController.SaveDaCertificate).</item>
/// <item>Silver/Gold: SP_RA_GET_CERTIFICATE_DETAILS, Sa{Level}.jpg + SaCertification.json → Certificates/SA/{ZedId}/{Level}.pdf
/// (SaveSaCertificate).</item>
/// <item>QR code: this site's /Verify/BC|SC|GC|XC/{code} (the procedure's QrCodeSeqNo column names the live portal whatever the
/// server); version 4, error correction M, as before.</item>
/// <item>Each main generation is recorded with SP_INSERT_CERTIFICATE_GENERATION_STATUS (SUCCESS/FAILED), as
/// GenerateCertificate did; SP_GET_RE_GENERATE_CERTIFICATE_LIST relies on it. ZED_SURVEILLANCE has no such procedure.</item>
/// <item>Report: SP_REPORT_GET_DETAILS → PDFs/SA/{ZedId}/{Level}_Report.pdf (GenerateSaRepory's file name).</item>
/// <item>Surveillance (ZED_SURVEILLANCE, ZEDCS_SURVEILLANCE MonitoringController.SaveDaCertificate/SaveSaCertificate): the
/// same procedures with DateOfSurveillance and SurveillanceNo, the surveillance artwork (Assets/Documents/Surveillance:
/// its own Bronze and Gold backgrounds; Silver is main's) → Surveillance/Certificates/{DA|SA}/{ZedId}/{Level}.pdf. Report:
/// the surveillance variant of <see cref="AssessmentReport"/> → Surveillance/PDFs/SA/{ZedId}/{Level}_Report.pdf.</item>
/// <item>Handholding milestone (ZED_CONSULTANT, SP_REPORT_GET_DETAILS @NcCount): <see cref="MilestoneReport"/> →
/// Consultancy/PDFs/SA/{ZedId}/{Level}_Report[_PR1|_PR2].pdf or _Reject_Report.pdf.</item>
/// </list>
/// </summary>
public sealed class DocumentRenderer(IWebHostEnvironment env, IOptions<PortalOptions> portal, ILogger log)
{
    private readonly DocumentStorage _storage = new(env, portal);

    public DocumentStorage Storage => _storage;

    private string SurveillanceAssets => Path.Combine(_storage.AssetsFolder, "Surveillance");
    private string ConsultancyAssets => Path.Combine(_storage.AssetsFolder, "Consultancy");

    // ------------------------------------------------------------------ certificates

    public async Task<DocumentFile> IssueCertificateAsync(ISqlExecutor db, string zedId, string certification, CancellationToken ct)
    {
        var level = Validate(zedId, certification);
        var row = await CertificateRowAsync(db, zedId, level, ct);
        var relative = DocumentLevels.CertificatePath(zedId, level);
        var settings = DocumentLevels.IsBuiltIn(level) ? null : await CertificationLevels.FindAsync(db, level, log, ct);
        try
        {
            var pdf = RenderCertificate(level, row, surveillance: false, settings);
            await _storage.WriteAsync(relative, pdf, ct);
            await RecordStatusAsync(db, zedId, level, "SUCCESS", "SUCCESS", ct);
            log.LogInformation("Certificate {Path} generated", relative);
            return new DocumentFile(relative, pdf);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Certificate generation failed for {ZedId} {Level}", zedId, level);
            await RecordStatusAsync(db, zedId, level, "FAILED", ex.GetType().Name + ": " + ex.Message, CancellationToken.None);
            throw;
        }
    }

    /// <summary>Surveillance certificate from ZED_SURVEILLANCE (the surveillance host's own database or main's read-only connection).</summary>
    public async Task<DocumentFile> IssueSurveillanceCertificateAsync(ISqlExecutor surveillanceDb, string zedId, string certification, CancellationToken ct)
    {
        var level = Validate(zedId, certification);
        var row = await CertificateRowAsync(surveillanceDb, zedId, level, ct);
        var relative = DocumentLevels.SurveillanceCertificatePath(zedId, level);
        // V4 levels: the Admin's settings are main's (dbo.SectionTypes), read by name from ZED_SURVEILLANCE's connection.
        var settings = DocumentLevels.IsBuiltIn(level) ? null : await CertificationLevels.FindAsync(surveillanceDb, level, log, ct, fromOtherDatabase: true);
        var round = DocumentLevels.IsBuiltIn(level) ? null : await SurveillanceRoundAsync(surveillanceDb, zedId, level, ct);
        try
        {
            var pdf = RenderCertificate(level, row, surveillance: true, settings, round);
            await _storage.WriteAsync(relative, pdf, ct);
            log.LogInformation("Surveillance certificate {Path} generated", relative);
            return new DocumentFile(relative, pdf);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Surveillance certificate generation failed for {ZedId} {Level}", zedId, level);
            throw;
        }
    }

    private static async Task<IDictionary<string, object?>> CertificateRowAsync(ISqlExecutor db, string zedId, string level, CancellationToken ct)
    {
        var desktop = DocumentLevels.IsDesktop(level);
        var sets = await db.QueryProcMultipleAsync(desktop ? "SP_DA_GET_CERTIFICATE_DETAILS" : "SP_RA_GET_CERTIFICATE_DETAILS",
            new { ZedId = AssessmentInput.Ansi(zedId, 100), CertificationType = AssessmentInput.Ansi(level, 100) }, ct);
        var row = sets[0].FirstOrDefault() ?? throw new DocumentNotAvailableException("No certification record.");
        if (row.Text(desktop ? "DaCertificateNo" : "SaCertificateNo").Length == 0)
            throw new DocumentNotAvailableException("The certification has not been issued.");
        return row;
    }

    /// <summary>
    /// The surveillance round of a V4 level: main's EnableSurveillance1, which SP_V4_LEVEL_SURVEILLANCE_SCHEDULE sets when it
    /// opens a round (ZED_SURVEILLANCE's SurveillanceNo stops at 2). Null when it cannot be read.
    /// </summary>
    internal const string SurveillanceRoundSql =
        "SELECT TOP 1 EnableSurveillance1 FROM ZEDCS_V2_LIVE.dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Level ORDER BY Id DESC;";

    private async Task<int?> SurveillanceRoundAsync(ISqlExecutor surveillanceDb, string zedId, string level, CancellationToken ct)
    {
        try
        {
            return (await surveillanceDb.QuerySqlAsync<int?>(SurveillanceRoundSql, new { ZedId = zedId, Level = level }, ct)).FirstOrDefault() is >= 1 and var r ? r : null;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Surveillance round of {ZedId} {Level} not read; the certificate shows the surveillance's own number", zedId, level);
            return null;
        }
    }

    private byte[] RenderCertificate(string level, IDictionary<string, object?> row, bool surveillance, CertificationLevel? settings = null, int? surveillanceRound = null)
    {
        var desktop = DocumentLevels.IsDesktop(level);
        var folder = surveillance ? SurveillanceAssets : _storage.AssetsFolder;
        var layout = CertificateComposer.LoadLayout(Path.Combine(folder, desktop ? "DaCertification.json" : "SaCertification.json"));
        var template = (desktop ? "Da" : "Sa") + level + ".jpg";
        // Surveillance keeps its own Bronze and Gold backgrounds ("Surveillance ... Completed on :"); its Silver is main's.
        var templatePath = Path.Combine(folder, template);
        if (!File.Exists(templatePath)) templatePath = Path.Combine(_storage.AssetsFolder, template);

        // Same fonts and alignment as the GDI+ code: DrawString at a point without a format is left aligned;
        // the address box is centred and top aligned, the NIC box centred and bottom aligned.
        List<CertificateText> texts =
        [
            new("Name", row.Text("EnterpriseName"), Bold: true),
            new("CertificateNo", row.Text(desktop ? "DaCertificateNo" : "SaCertificateNo"), Anchor: TextAnchor.TopLeft),
            new("DateOfPledge", row.Text("DateOfCertification"), Anchor: TextAnchor.TopLeft),
            new("Address", row.Text("Address"), Bold: true, Anchor: TextAnchor.BoxTopCenter),
            new("RegistrationNumber", row.Text("UdyogAadharNo"), Bold: !desktop),
            new("NicCode", row.Text("NicCode"), Bold: true, Anchor: TextAnchor.BoxBottomCenter),
            new("AgencyName", row.Text("AssessmentAgency"), Bold: !desktop),
        ];
        if (surveillance)
        {
            // The old code drew DateOfSurveillance under the "Surveillance Completed on :" label. SurveillanceNo went to
            // (0,0) in 2 pt on Bronze (invisible) and over the date on Silver/Gold (the Gold artwork prints "Surveillance 1");
            // V4 puts it in the gap of the Bronze label and leaves it out of the site layout.
            texts.Add(new("DateOfSurveillance", row.Text("DateOfSurveillance"), Anchor: TextAnchor.TopLeft));
            texts.Add(new("SurveillanceNo", row.Text("SurveillanceNo")));
        }
        // V4 levels (ZED-X): the Admin's validity under "Certificate Validity :" (the Silver/Gold artwork prints three
        // years), and the logo uploaded in Administration → Certification Levels over the artwork's badge. Their
        // surveillance artwork leaves out the "1" of "Surveillance 1 Completed on :": the round goes there.
        List<CertificateImage> images = [];
        if (!DocumentLevels.IsBuiltIn(level))
        {
            texts.Add(new("Validity", DocumentLevels.ValidityText(settings?.ValidityMonths ?? DocumentLevels.DefaultValidityMonths)));
            if (surveillance) texts.Add(new("SurveillanceRound", surveillanceRound?.ToString(CultureInfo.InvariantCulture) ?? SurveillanceRound(row.Text("SurveillanceNo"))));
            if (settings?.LogoPath is { Length: > 0 } logo && _storage.Find(logo) is { } logoPath)
                images.Add(new CertificateImage(File.ReadAllBytes(logoPath), BadgeCenterX, BadgeCenterY, BadgeSize, BadgeClearRadius));
        }
        return CertificateComposer.RenderPdf(new CertificateRequest(
            TemplateImagePath: templatePath,
            Layout: layout,
            Texts: texts,
            QrField: "QrCode",
            QrContent: VerifyUrl(portal.Value.PublicBaseUrl, level, row.Text("QrCodeSeqNo")),
            SubsetFonts: true,
            Images: images));
    }

    /// <summary>
    /// The QR address of a certificate: this site's /Verify/{BC|SC|GC|XC}/{code}. The procedures (SP_DA/RA_GET_CERTIFICATE_DETAILS,
    /// main's and ZED_SURVEILLANCE's) write the live portal's address whatever server runs them, and /Verify/GC/ for ZED-X. The
    /// Verify page is on the main portal at the root of the site, so a /surveillance or /Consultancy base is cut to the site.
    /// The code is the last part of the procedure's address.
    /// </summary>
    internal static string VerifyUrl(string publicBaseUrl, string level, string procedureUrl)
    {
        var code = procedureUrl.Split('/', StringSplitOptions.RemoveEmptyEntries).LastOrDefault() ?? "";
        if (code.Length == 0) return "";
        var site = Uri.TryCreate(publicBaseUrl, UriKind.Absolute, out var uri) ? uri.GetLeftPart(UriPartial.Authority) : publicBaseUrl.TrimEnd('/');
        return $"{site}/Verify/{VerifyController.CodeOf(level)}/{code}";
    }

    /// <summary>"1" for the first surveillance: the procedures give SurveillanceNo as a number or as "Surveillance 2".</summary>
    internal static string SurveillanceRound(string surveillanceNo)
    {
        var digits = new string(surveillanceNo.Where(char.IsAsciiDigit).ToArray());
        return digits.Length is > 0 and <= 2 ? digits.TrimStart('0') is { Length: > 0 } n ? n : "1" : "1";
    }

    /// <summary>The badge of the site artwork (Sa*.jpg, 2482 x 3508 px): its centre, the logo size and the white ring.</summary>
    private const float BadgeCenterX = 1900, BadgeCenterY = 645, BadgeSize = 610, BadgeClearRadius = 336;

    private async Task RecordStatusAsync(ISqlExecutor db, string zedId, string level, string status, string message, CancellationToken ct)
    {
        try
        {
            await db.ExecuteProcAsync("SP_INSERT_CERTIFICATE_GENERATION_STATUS", new
            {
                ZedId = AssessmentInput.Ansi(zedId),
                Certification = AssessmentInput.Ansi(level),
                GenerateStatus = AssessmentInput.Ansi(status, 100),
                ErrorMessage = AssessmentInput.Ansi(message.Length > 1000 ? message[..1000] : message, 5000),
            }, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Could not record the certificate generation status of {ZedId} {Level}", zedId, level);
        }
    }

    // ------------------------------------------------------------------ reports

    public async Task<DocumentFile> RenderReportAsync(ISqlExecutor db, string zedId, string certification, CancellationToken ct)
    {
        var level = Validate(zedId, certification);
        var pdf = await AssessmentReportPdfAsync(db, zedId, level, surveillance: false, ct);
        var relative = DocumentLevels.ReportPath(zedId, level);
        await _storage.WriteAsync(relative, pdf, ct);
        return new DocumentFile(relative, pdf);
    }

    /// <summary>The surveillance report (ZEDCS_SURVEILLANCE SA/ReportSummary) from ZED_SURVEILLANCE.</summary>
    public async Task<DocumentFile> RenderSurveillanceReportAsync(ISqlExecutor surveillanceDb, string zedId, string certification, CancellationToken ct)
    {
        var level = Validate(zedId, certification);
        var pdf = await AssessmentReportPdfAsync(surveillanceDb, zedId, level, surveillance: true, ct);
        var relative = DocumentLevels.SurveillanceReportPath(zedId, level);
        await _storage.WriteAsync(relative, pdf, ct);
        return new DocumentFile(relative, pdf);
    }

    private async Task<byte[]> AssessmentReportPdfAsync(ISqlExecutor db, string zedId, string level, bool surveillance, CancellationToken ct)
    {
        // ZED_SURVEILLANCE's procedure also takes @UserId (unused for the report); main's is called as before.
        var sets = await db.QueryProcMultipleAsync("SP_REPORT_GET_DETAILS",
            new { Certification = AssessmentInput.Ansi(level), ZedId = AssessmentInput.Ansi(zedId, 100) }, ct);
        if (sets[0].Count == 0) throw new DocumentNotAvailableException("No report data.");

        var assets = _storage.AssetsFolder;
        using var cover = Image(assets, "ReportCover.jpg");
        using var header = Image(assets, "ReportHeader.jpg");
        using var about = Image(assets, "AboutZedAssessment.jpg");
        using var badge = await BadgeAsync(db, level, ct);
        using var lastPage = Image(assets, "ReportLastPage.jpg");
        // The old page showed ~/GoogleMaps/{ZedId}_{Level}.jpg when a static map had been downloaded earlier.
        using var map = Map(surveillance ? "Surveillance/" : "", zedId, level);
        using var photos = new ReportPhotos(_storage.Root, zedId);

        return AssessmentReport.Render(sets, new AssessmentReport.Assets(cover, header, about, badge, lastPage, map), photos, surveillance);
    }

    /// <summary>
    /// Handholding milestone report from ZED_CONSULTANT (SA/ReportSummary?milestone=n). A null milestone lets the
    /// procedure take the unit's current one. <paramref name="save"/>: keep the file at its legacy name.
    /// </summary>
    public async Task<DocumentFile> RenderMilestoneReportAsync(ISqlExecutor consultancyDb, string zedId, string level, int? milestone, bool save,
        CancellationToken ct)
    {
        if (!AssessmentInput.IsId(zedId)) throw new ArgumentException("Invalid ZED ID.", nameof(zedId));
        if (DocumentLevels.Level(level) is not ("Silver" or "Gold") || milestone is < 1 or > DocumentLevels.Milestones)
            throw new ArgumentException("Invalid milestone.", nameof(milestone));
        level = DocumentLevels.Level(level)!;

        var sets = await consultancyDb.QueryProcMultipleAsync("SP_REPORT_GET_DETAILS", new
        {
            Certification = AssessmentInput.Ansi(level),
            ZedId = AssessmentInput.Ansi(zedId, 100),
            NcCount = milestone,
        }, ct);
        var unit = sets[0].FirstOrDefault() ?? throw new DocumentNotAvailableException("No report data.");
        var number = milestone ?? (int.TryParse(unit.Text("NcCount"), out var n) && n is >= 1 and <= DocumentLevels.Milestones
            ? n
            : throw new DocumentNotAvailableException("No milestone."));
        var rejected = unit.Text("CertificationStatus") == DocumentLevels.Rejected.ToString(System.Globalization.CultureInfo.InvariantCulture);

        var assets = _storage.AssetsFolder;
        using var cover = Image(ConsultancyAssets, $"ReportCover{number}.jpg");
        using var header = Image(ConsultancyAssets, "ReportHeader.jpg");
        using var existing = DocumentLevels.Level(unit.Text("LastestCertification")) is { } latest ? Image(assets, $"Level{latest}.png") : null;
        using var desired = Image(assets, $"Level{level}.png");
        using var lastPage = Image(assets, "ReportLastPage.jpg");
        using var map = Map("Consultancy/", zedId, level);
        using var photos = new ReportPhotos(_storage.Root, zedId);

        var pdf = MilestoneReport.Render(sets, new MilestoneReport.Assets(cover, header, existing, desired, lastPage, map), photos);
        var relative = DocumentLevels.MilestoneReportPath(zedId, level, number, rejected);
        if (save) await _storage.WriteAsync(relative, pdf, ct);
        return new DocumentFile(relative, pdf);
    }

    /// <summary>A static map the old application downloaded (its own GoogleMaps folder first, then main's).</summary>
    private SKImage? Map(string systemFolder, string zedId, string level)
    {
        var path = _storage.Find($"{systemFolder}GoogleMaps/{zedId}_{level}.jpg") ?? _storage.Find($"GoogleMaps/{zedId}_{level}.jpg");
        return path is null ? null : ReportPhotos.Downscale(path, 1000);
    }

    /// <summary>The report's level badge: Level{Level}.png, or for a V4 level (ZED-X) the logo the Admin uploaded.</summary>
    private async Task<SKImage> BadgeAsync(ISqlExecutor db, string level, CancellationToken ct)
    {
        if (!DocumentLevels.IsBuiltIn(level) &&
            await CertificationLevels.FindAsync(db, level, log, ct) is { LogoPath: { Length: > 0 } logo } && _storage.Find(logo) is { } path &&
            SKImage.FromEncodedData(path) is { } uploaded)
            return uploaded;
        return Image(_storage.AssetsFolder, $"Level{level}.png");
    }

    private static string Validate(string zedId, string certification)
    {
        if (!AssessmentInput.IsId(zedId)) throw new ArgumentException("Invalid ZED ID.", nameof(zedId));
        return DocumentLevels.Level(certification) ?? throw new ArgumentException("Invalid certification.", nameof(certification));
    }

    private static SKImage Image(string folder, string name) =>
        SKImage.FromEncodedData(Path.Combine(folder, name)) ?? throw new FileNotFoundException("Document template missing.", name);
}
