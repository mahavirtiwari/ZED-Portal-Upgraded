using Microsoft.Extensions.Options;
using Zed.Core.Certificates;
using Zed.Core.Http;

namespace Zed.Portal.Features.Msme;

public sealed record PledgeCertificateData(
    string ZedId, string UnitOrEnterpriseName, string CertificateNo, string DateOfPledge,
    string Address, string UdyamNo, string QrCodeNo);

/// <summary>Port of MsmeController.SaveCertificate / GenerateCertificate (Pledge.jpg + PledgeCertification.json).</summary>
public sealed class PledgeCertificateService(IWebHostEnvironment env, IOptions<PortalOptions> portal)
{
    private readonly Lazy<IReadOnlyDictionary<string, CertificateField>> _layout = new(() =>
        CertificateComposer.LoadLayout(Path.Combine(AppContext.BaseDirectory, "Assets", "Certificates", "PledgeCertification.json")));

    public byte[] Render(PledgeCertificateData d) => CertificateComposer.RenderPdf(new CertificateRequest(
        TemplateImagePath: Path.Combine(AppContext.BaseDirectory, "Assets", "Certificates", "Pledge.jpg"),
        Layout: _layout.Value,
        Texts:
        [
            new("Name", d.UnitOrEnterpriseName, Bold: true),
            new("CertificateNo", d.CertificateNo),
            new("DateOfPledge", d.DateOfPledge),
            new("Address", d.Address, Anchor: TextAnchor.BoxBottomCenter),
            new("RegistrationNumber", d.UdyamNo),
        ],
        QrField: "QrCode",
        QrContent: d.QrCodeNo,
        SubsetFonts: true));

    /// <summary>Saves to {StorageRoot}/Certificates/{ZedId}/Pledge.pdf, the same layout the old site served.</summary>
    public async Task<string> SaveAsync(PledgeCertificateData d, byte[] pdf, CancellationToken ct)
    {
        var root = Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));
        var safeId = string.Concat(d.ZedId.Where(char.IsLetterOrDigit));
        var dir = Path.Combine(root, "Certificates", safeId);
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, "Pledge.pdf");
        await File.WriteAllBytesAsync(path, pdf, ct);
        return path;
    }
}
