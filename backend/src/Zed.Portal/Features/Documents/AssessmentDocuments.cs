using Microsoft.Extensions.Options;
using SkiaSharp;
using Zed.Core.Certificates;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Documents;

/// <summary>
/// Certificates and assessment reports, drawn with SkiaSharp instead of the old System.Drawing/iTextSharp
/// (certificates) and SelectPdf (reports) code. Files are written where the old site kept them under
/// Portal:StorageRoot, so existing links, My Documents (SP_MSME_GET_MY_DOCUMENTS) and the regenerate
/// list keep finding them.
/// <list type="bullet">
/// <item>Bronze: SP_DA_GET_CERTIFICATE_DETAILS, template DaCertificates/Bronze.jpg + DaCertification.json →
/// Certificates/DA/{ZedId}/Bronze.pdf (MonitoringController.SaveDaCertificate).</item>
/// <item>Silver/Gold: SP_RA_GET_CERTIFICATE_DETAILS, SaCertificates/{Level}.jpg + SaCertification.json →
/// Certificates/SA/{ZedId}/{Level}.pdf (SaveSaCertificate).</item>
/// <item>QR code: the procedure's QrCodeSeqNo column, which is already the verification URL
/// (https://loginzed.msme.gov.in/Verify/BC|SC|GC/{code}); version 4, error correction M, as before.</item>
/// <item>Each generation is recorded with SP_INSERT_CERTIFICATE_GENERATION_STATUS (SUCCESS/FAILED), as
/// GenerateCertificate did; SP_GET_RE_GENERATE_CERTIFICATE_LIST relies on it.</item>
/// <item>Report: SP_REPORT_GET_DETAILS → PDFs/SA/{ZedId}/{Level}_Report.pdf (GenerateSaRepory's file name).</item>
/// </list>
/// Surveillance certificates and reports are produced by the ZEDCS_SURVEILLANCE application and handholding
/// milestone reports by ZEDCS_CONSULTANCY; this class does not draw them.
/// </summary>
public sealed class AssessmentDocuments(
    ISqlExecutor db,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<AssessmentDocuments> log) : IAssessmentDocuments
{
    private readonly DocumentStorage _storage = new(env, portal);

    public async Task<DocumentFile> IssueCertificateAsync(string zedId, string certification, CancellationToken ct)
    {
        var level = Validate(zedId, certification);
        var desktop = DocumentLevels.IsDesktop(level);
        var sets = await db.QueryProcMultipleAsync(desktop ? "SP_DA_GET_CERTIFICATE_DETAILS" : "SP_RA_GET_CERTIFICATE_DETAILS",
            new { ZedId = AssessmentInput.Ansi(zedId, 100), CertificationType = AssessmentInput.Ansi(level, 100) }, ct);
        var row = sets[0].FirstOrDefault() ?? throw new DocumentNotAvailableException("No certification record.");
        var certificateNo = row.Text(desktop ? "DaCertificateNo" : "SaCertificateNo");
        if (certificateNo.Length == 0) throw new DocumentNotAvailableException("The certification has not been issued.");

        var relative = DocumentLevels.CertificatePath(zedId, level);
        try
        {
            var pdf = RenderCertificate(level, row);
            await _storage.WriteAsync(relative, pdf, ct);
            await RecordStatusAsync(zedId, level, "SUCCESS", "SUCCESS", ct);
            log.LogInformation("Certificate {Path} generated", relative);
            return new DocumentFile(relative, pdf);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Certificate generation failed for {ZedId} {Level}", zedId, level);
            await RecordStatusAsync(zedId, level, "FAILED", ex.GetType().Name + ": " + ex.Message, CancellationToken.None);
            throw;
        }
    }

    public async Task<DocumentFile> RenderReportAsync(string zedId, string certification, CancellationToken ct)
    {
        var level = Validate(zedId, certification);
        var sets = await db.QueryProcMultipleAsync("SP_REPORT_GET_DETAILS",
            new { Certification = AssessmentInput.Ansi(level), ZedId = AssessmentInput.Ansi(zedId, 100) }, ct);
        if (sets[0].Count == 0) throw new DocumentNotAvailableException("No report data.");

        var assets = _storage.AssetsFolder;
        using var cover = Image(assets, "ReportCover.jpg");
        using var header = Image(assets, "ReportHeader.jpg");
        using var about = Image(assets, "AboutZedAssessment.jpg");
        using var badge = Image(assets, $"Level{level}.png");
        using var lastPage = Image(assets, "ReportLastPage.jpg");
        // The old page showed ~/GoogleMaps/{ZedId}_{Level}.jpg when a static map had been downloaded earlier.
        using var map = _storage.Find($"GoogleMaps/{zedId}_{level}.jpg") is { } mapPath ? ReportPhotos.Downscale(mapPath, 1000) : null;
        using var photos = new ReportPhotos(_storage.Root, zedId);

        var pdf = AssessmentReport.Render(sets, new AssessmentReport.Assets(cover, header, about, badge, lastPage, map), photos);
        var relative = DocumentLevels.ReportPath(zedId, level);
        await _storage.WriteAsync(relative, pdf, ct);
        return new DocumentFile(relative, pdf);
    }

    private byte[] RenderCertificate(string level, IDictionary<string, object?> row)
    {
        var desktop = DocumentLevels.IsDesktop(level);
        var layout = CertificateComposer.LoadLayout(Path.Combine(_storage.AssetsFolder, desktop ? "DaCertification.json" : "SaCertification.json"));
        // Same fonts and alignment as the GDI+ code: DrawString at a point without a format is left aligned;
        // the address box is centred and top aligned, the NIC box centred and bottom aligned.
        return CertificateComposer.RenderPdf(new CertificateRequest(
            TemplateImagePath: Path.Combine(_storage.AssetsFolder, (desktop ? "Da" : "Sa") + level + ".jpg"),
            Layout: layout,
            Texts:
            [
                new("Name", row.Text("EnterpriseName"), Bold: true),
                new("CertificateNo", row.Text(desktop ? "DaCertificateNo" : "SaCertificateNo"), Anchor: TextAnchor.TopLeft),
                new("DateOfPledge", row.Text("DateOfCertification"), Anchor: TextAnchor.TopLeft),
                new("Address", row.Text("Address"), Bold: true, Anchor: TextAnchor.BoxTopCenter),
                new("RegistrationNumber", row.Text("UdyogAadharNo"), Bold: !desktop),
                new("NicCode", row.Text("NicCode"), Bold: true, Anchor: TextAnchor.BoxBottomCenter),
                new("AgencyName", row.Text("AssessmentAgency"), Bold: !desktop),
            ],
            QrField: "QrCode",
            QrContent: row.Text("QrCodeSeqNo"),
            SubsetFonts: true));
    }

    private async Task RecordStatusAsync(string zedId, string level, string status, string message, CancellationToken ct)
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

    private static string Validate(string zedId, string certification)
    {
        if (!AssessmentInput.IsId(zedId)) throw new ArgumentException("Invalid ZED ID.", nameof(zedId));
        return DocumentLevels.Level(certification) ?? throw new ArgumentException("Invalid certification.", nameof(certification));
    }

    private static SKImage Image(string folder, string name) =>
        SKImage.FromEncodedData(Path.Combine(folder, name)) ?? throw new FileNotFoundException("Document template missing.", name);
}
