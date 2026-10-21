namespace Zed.Portal.Features.Documents;

/// <summary>
/// Certificates and assessment reports of a completed certification. The old portal produced them by
/// converting its own pages to PDF (SelectPdf: Monitoring.SaveDaCertificate/SaveSaCertificate and the
/// SA/ReportSummary pages); V4 draws them directly. Used by the monitoring final submit / regenerate
/// actions and by the download endpoints.
/// </summary>
public interface IAssessmentDocuments
{
    /// <summary>
    /// Creates, or re-creates, the certificate PDF at the legacy location under Portal:StorageRoot
    /// (Certificates/DA/{ZedId}/{Level}.pdf for desktop-assessed levels, Certificates/SA/... for site-assessed
    /// ones, surveillance under Surveillance/...) and returns it.
    /// </summary>
    Task<DocumentFile> IssueCertificateAsync(string zedId, string certification, CancellationToken ct);

    /// <summary>The assessment report PDF (old SA/ReportSummary + Summary pages), saved at its legacy location and returned.</summary>
    Task<DocumentFile> RenderReportAsync(string zedId, string certification, CancellationToken ct);
}

/// <summary>A generated document: its path relative to Portal:StorageRoot (forward slashes) and its bytes.</summary>
public sealed record DocumentFile(string RelativePath, byte[] Content);
