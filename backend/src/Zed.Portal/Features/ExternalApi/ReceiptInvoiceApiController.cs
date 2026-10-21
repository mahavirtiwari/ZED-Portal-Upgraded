using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal.Features.Msme;

namespace Zed.Portal.Features.ExternalApi;

/// <summary>
/// Msme/UploadReceiptInvoice (POST JSON): the finance system sends back the TADA invoice or receipt PDF of a
/// payment that the portal posted to the ERP (ErpFinanceService). The file is stored as
/// ReceiptInvoice/{tadaInvoiceNo}_{zedId}_{documentType}.pdf (invoice numbers such as ZED/2526/3461 make
/// sub-folders, as before) and recorded by SP_API_FINANCE_SAVE_INVOICE_RECEIPT_DETAILS in MsmeInvoiceData,
/// from where My Documents lists it to the MSME.
/// <para>
/// The old action wrote the file before checking anything else, with the path built from the three request
/// values unchecked (path traversal under the web root) and any content. Now: token from GenerateToken first,
/// then each value checked, the content must be a PDF within the size limit, and the file is kept only when
/// the procedure finds the invoice for that ZED ID.
/// </para>
/// </summary>
[ExternalApiErrors(ExternalApiErrorsAttribute.Plain500)]
public sealed partial class ReceiptInvoiceApiController(
    ISqlExecutor db,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<ReceiptInvoiceApiController> log) : ExternalApiController
{
    // Invoice numbers: segments of letters, digits and - separated by '/', e.g. ZED/2526/3461.
    [GeneratedRegex(@"^[A-Za-z0-9-]{1,40}(/[A-Za-z0-9-]{1,40}){0,4}$")] private static partial Regex InvoiceNoPattern();
    [GeneratedRegex(@"^[A-Za-z0-9 -]{1,50}$")] private static partial Regex DocumentTypePattern();

    [HttpPost("/Msme/UploadReceiptInvoice")]
    public async Task<IActionResult> UploadReceiptInvoice(UploadReceiptInvoiceRequest uploadReceiptInvoiceRequest, CancellationToken ct)
    {
        var r = uploadReceiptInvoiceRequest;
        if (await new ApiClients(db, Options).DynamicAsync(r.token, ct) is not { } caller)
        {
            log.LogWarning("Msme/UploadReceiptInvoice refused from {Ip}: invalid or expired token", ClientIp);
            return LegacyJson(ApiServiceResponse.Status("401", "Invalid Token."));
        }

        var invoiceNo = r.tadaInvoiceNo?.Trim() ?? "";
        var zedId = r.zedId?.Trim() ?? "";
        var documentType = r.documentType?.Trim() ?? "";
        if (invoiceNo.Length > 100 || !InvoiceNoPattern().IsMatch(invoiceNo) || !CertificationLookups.IsZedId(zedId) ||
            !DocumentTypePattern().IsMatch(documentType) || documentType.StartsWith(' '))
            return Refuse(caller, "invalid invoice number, ZED ID or document type");

        var pdf = Decode(r.base64InvoiceData);
        if (pdf is null) return Refuse(caller, "content is not a base64 PDF within the size limit");

        var fileName = $"{invoiceNo}_{zedId}_{documentType}.pdf";
        var relative = "ReceiptInvoice/" + fileName;
        var root = Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));
        var target = MsmeFilePaths.Normalise(relative) is { } normalised ? MsmeFilePaths.Resolve(root, normalised) : null;
        if (target is null) return Refuse(caller, "unsafe path");

        // Written next to the target first; kept only if the procedure records it.
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        var temp = target + "." + Guid.NewGuid().ToString("N") + ".tmp";
        await System.IO.File.WriteAllBytesAsync(temp, pdf, ct);
        try
        {
            var row = (await db.QueryProcMultipleAsync("SP_API_FINANCE_SAVE_INVOICE_RECEIPT_DETAILS", new
            {
                ZedId = zedId,
                TadaInvoiceNo = invoiceNo,
                // Stored exactly as the old code did (Path.Combine on Windows).
                InvoicePath = "ReceiptInvoice\\" + fileName,
                DocumentType = documentType,
            }, ct))[0].FirstOrDefault();

            if (row is null)
            {
                System.IO.File.Move(temp, target, overwrite: true);
                log.LogInformation("Msme/UploadReceiptInvoice by {Client}: {ZedId} {Invoice} {Type} saved", caller.Client, zedId, invoiceNo, documentType);
                return LegacyJson(ApiServiceResponse.Status("200", "SUCCESS"));
            }

            var status = row.Text("Status");
            if (status.Equals("SUCCESS", StringComparison.OrdinalIgnoreCase)) System.IO.File.Move(temp, target, overwrite: true);
            log.LogInformation("Msme/UploadReceiptInvoice by {Client}: {ZedId} {Invoice} {Type} → {Status}", caller.Client, zedId, invoiceNo, documentType, status);
            return LegacyJson(ApiServiceResponse.Status(status, row.Text("ErrorMessage")));
        }
        finally
        {
            if (System.IO.File.Exists(temp)) System.IO.File.Delete(temp);
        }
    }

    private byte[]? Decode(string? base64)
    {
        if (string.IsNullOrWhiteSpace(base64) || base64.Length > (Options.MaxInvoiceBytes / 3 + 1) * 4 + 16) return null;
        var data = base64.Trim();
        var comma = data.IndexOf(',');
        if (data.StartsWith("data:", StringComparison.OrdinalIgnoreCase) && comma > 0) data = data[(comma + 1)..];
        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(data);
        }
        catch (FormatException)
        {
            return null;
        }
        // %PDF- signature; the file is served to the MSME later, so nothing else is stored under .pdf.
        return bytes.Length is > 5 && bytes.Length <= Options.MaxInvoiceBytes && bytes.AsSpan(0, 5).SequenceEqual("%PDF-"u8) ? bytes : null;
    }

    private ContentResult Refuse(ApiCaller caller, string reason)
    {
        log.LogWarning("Msme/UploadReceiptInvoice by {Client} refused: {Reason}", caller.Client, reason);
        return LegacyJson(ApiServiceResponse.Status("400", "Bad Request"));
    }
}
