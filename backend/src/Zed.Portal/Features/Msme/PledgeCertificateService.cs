using Microsoft.Extensions.Options;
using QRCoder;
using Zed.Core.Certificates;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Portal.Features.Msme;

public sealed record PledgeCertificateData(
    string ZedId, string UnitOrEnterpriseName, string CertificateNo, string DateOfPledge,
    string Address, string UdyamNo, string QrCodeNo);

/// <summary>
/// The pledge certificate as the portal page draws it (V4): the template picture and each text placed by the share of the
/// page's width and height it starts at, as the PDF places it (Pledge.jpg is 2482 x 3508 at 300 dpi), and the QR code.
/// </summary>
public sealed record PledgeCertificateView(
    string ZedId, string Name, string CertificateNo, string DateOfPledge, string Address, string UdyamNo,
    string? QrImage, IReadOnlyList<PledgeCertificateView.Field> Fields, string FileName)
{
    /// <summary>
    /// Left (the centre of a centred text, else the left edge) and top of the text or box, width and height, as % of the page;
    /// font size as % of the page width; Align "center" (centred on Left), "box-bottom" (centred in the box, bottom
    /// aligned) or "image" (the QR code).
    /// </summary>
    public sealed record Field(string Name, double Left, double Top, double? Width, double? Height, double FontSize, string Color, bool Bold, string Align,
        IReadOnlyList<string>? Lines = null);
}

/// <summary>
/// The pledge certificate (port of MsmeController.SaveCertificate / GenerateCertificate: Pledge.jpg + PledgeCertification.json).
/// V4: it is never stored on the server. The portal shows it as a page (<see cref="View"/>) and draws the PDF when it is
/// downloaded (<see cref="Render"/>), always from the MSME's registration record (<see cref="LoadAsync"/>).
/// </summary>
public sealed class PledgeCertificateService(IOptions<PortalOptions> portal)
{
    private const double PageWidth = 2482, PageHeight = 3508, TemplateDpi = 300;

    private readonly Lazy<IReadOnlyDictionary<string, CertificateField>> _layout = new(() =>
        CertificateComposer.LoadLayout(Path.Combine(AppContext.BaseDirectory, "Assets", "Certificates", "PledgeCertification.json")));

    /// <summary>The PDF, drawn now (nothing is written to disk).</summary>
    public byte[] Render(PledgeCertificateData d) => CertificateComposer.RenderPdf(new CertificateRequest(
        TemplateImagePath: Path.Combine(AppContext.BaseDirectory, "Assets", "Certificates", "Pledge.jpg"),
        Layout: _layout.Value,
        Texts:
        [
            // A long name takes two lines above the rule, in a smaller font if need be (PledgeCertification.json maxLines).
            new("Name", d.UnitOrEnterpriseName, Bold: true, Anchor: TextAnchor.BoxBottomCenter),
            new("CertificateNo", d.CertificateNo),
            new("DateOfPledge", d.DateOfPledge),
            new("Address", d.Address, Anchor: TextAnchor.BoxBottomCenter),
            new("RegistrationNumber", d.UdyamNo),
        ],
        QrField: "QrCode",
        QrContent: d.QrCodeNo,
        SubsetFonts: true));

    public static string FileName(string zedId) => $"Pledge_Certificate_{string.Concat(zedId.Where(char.IsLetterOrDigit))}.pdf";

    /// <summary>
    /// The certificate of a ZED ID from its registration record, as SP_MSME_INSERT_UDYAM_DETAILS returned it when the
    /// MSME registered (and SP_VERIFY_QR_CODE shows it): the unit's name, the plant address, the Udyam number, the date of
    /// registration, the pledge certificate number and the verification link. Null for an unknown ZED ID.
    /// </summary>
    public async Task<PledgeCertificateData?> LoadAsync(ISqlExecutor db, string zedId, CancellationToken ct)
    {
        var rows = await db.QuerySqlAsync<PledgeRow>(LoadSql, new { ZedId = new Dapper.DbString { Value = zedId, IsAnsi = true, Length = 50 } }, ct);
        if (rows.FirstOrDefault() is not { } r) return null;
        var qr = string.IsNullOrWhiteSpace(r.QrCodeNo) ? "" : $"{portal.Value.PublicBaseUrl.TrimEnd('/')}/Verify/PC/{r.QrCodeNo.Trim()}";
        return new PledgeCertificateData(r.ZedId, r.UnitName ?? "", r.CertificateNo ?? r.ZedId, r.DateOfPledge ?? "", r.Address ?? "",
            r.UdyogAadharNo ?? "", qr);
    }

    internal const string LoadSql = """
        SELECT TOP (1) M.ZedId,
               COALESCE(NULLIF(LTRIM(RTRIM(M.PUnitName)), ''), M.EnterpriseName) AS UnitName,
               COALESCE(NULLIF(M.PledgeCertificateNo, ''), M.ZedId) AS CertificateNo,
               FORMAT(M.CreatedDate, 'MMMM d, yyyy') AS DateOfPledge,
               CONCAT(M.PAddress, ', ', M.PDistrictName, ', ', M.PStateName, '-', M.PPin) AS Address,
               B.UdyogAadharNo, M.QrCodeNo
        FROM dbo.Msme M LEFT JOIN dbo.MsmeBasicInformation B ON B.ZedId = M.ZedId
        WHERE M.ZedId = @ZedId
        """;

    private sealed record PledgeRow(string ZedId, string? UnitName, string? CertificateNo, string? DateOfPledge, string? Address,
        string? UdyogAadharNo, string? QrCodeNo);

    /// <summary>The page version: the same texts at the same places, and the QR code as a PNG data URI.</summary>
    public PledgeCertificateView View(PledgeCertificateData d)
    {
        var layout = _layout.Value;
        var fields = new List<PledgeCertificateView.Field>();
        void Add(string name, bool bold = false, string? boxed = null)
        {
            if (!layout.TryGetValue(name, out var f)) return;
            // A boxed text is broken into lines (and its font made smaller) exactly as the PDF does it.
            var fit = boxed is not null && f.Width is > 0 ? CertificateComposer.Fit(boxed, f, bold) : null;
            fields.Add(new(name, f.X / PageWidth * 100, f.Y / PageHeight * 100,
                fit is not null ? f.Width / PageWidth * 100 : null, fit is not null && f.Height is > 0 ? f.Height / PageHeight * 100 : null,
                // Points at 300 dpi in template pixels, as a share of the page width.
                (fit?.FontPoints ?? f.Font) * TemplateDpi / 72 / PageWidth * 100, f.Color, bold, fit is not null ? "box-bottom" : "center",
                fit?.Lines));
        }
        Add("Name", bold: true, boxed: d.UnitOrEnterpriseName);
        Add("Address", boxed: d.Address);
        Add("RegistrationNumber");
        Add("DateOfPledge");
        Add("CertificateNo");
        if (layout.TryGetValue("QrCode", out var qr) && !string.IsNullOrEmpty(d.QrCodeNo))
        {
            // Version 4: 33 modules at the layout's module size, as the PDF draws it.
            var size = 33 * (qr.Module ?? 3);
            fields.Add(new("QrCode", qr.X / PageWidth * 100, qr.Y / PageHeight * 100, size / PageWidth * 100, size / PageHeight * 100, 0, "#000000", false, "image"));
        }
        return new PledgeCertificateView(d.ZedId, d.UnitOrEnterpriseName, d.CertificateNo, d.DateOfPledge, d.Address, d.UdyamNo,
            string.IsNullOrEmpty(d.QrCodeNo) ? null : QrDataUri(d.QrCodeNo), fields, FileName(d.ZedId));
    }

    private static string QrDataUri(string content)
    {
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(content, QRCodeGenerator.ECCLevel.M, requestedVersion: 4);
        var png = new PngByteQRCode(data).GetGraphic(6, drawQuietZones: false);
        return "data:image/png;base64," + Convert.ToBase64String(png);
    }
}
