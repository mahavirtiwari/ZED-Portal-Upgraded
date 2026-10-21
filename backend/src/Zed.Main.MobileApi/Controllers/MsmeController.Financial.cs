using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Mobile;
using Zed.Main.MobileApi.Models;
using Zed.Main.MobileApi.Templates;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// Financial assistance claims. Both actions require a completed certification
/// (SP_FINANCIAL_ASSISTANCE_GET_CURRENT_CERTIFICATE returns a level); the old code inserted the
/// claim without one and then failed while picking the mail's level.
/// </summary>
public sealed partial class MsmeController
{
    private async Task<string?> CurrentCertificateAsync(string? zedId, CancellationToken ct) =>
        string.IsNullOrWhiteSpace(zedId)
            ? null
            : (await db.QueryProcMultipleAsync("SP_FINANCIAL_ASSISTANCE_GET_CURRENT_CERTIFICATE", new { ZedId = zedId }, ct))
                .FirstRow(0).Text("CertificationType") is { Length: > 0 } c ? c : null;

    /// <summary>SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE; answered as Newtonsoft text (text/html), as before.</summary>
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "ZedId")]
    public async Task<IActionResult> SubmitFinancialData(FinancialViewModel model, CancellationToken ct)
    {
        static ContentResult Answer(ServiceResponse r) => LegacyContent(JsonSerializer.Serialize(r, Zed.Core.Mobile.LegacyJson.Write));

        if (model.CertificationDetails is not { } cert || model.ExpenditureDetails is not { } exp || model.AccountDetails is not { } acc)
            return Answer(ServiceResponse.Fail(NoDataFound));

        var level = await CurrentCertificateAsync(model.ZedId, ct);
        if (level is null)
        {
            log.LogWarning("Msme/SubmitFinancialData refused for {ZedId}: no completed certification", model.ZedId);
            return Answer(ServiceResponse.Fail(InvalidDetails));
        }

        var points = PhotoTable();
        void Add(IEnumerable<PhotoInformation?>? photos, string name)
        {
            foreach (var p in photos ?? [])
                if (p is not null) AddPhotoRow(points, p.photoId + "." + (p.isPdf ? "pdf" : "jpg"), name, p.timeStamp, p.latitude, p.longitude, name);
        }
        Add(cert.Photos, "Copy of Certificate");
        Add(exp.Photos, "CA certificate of expenditure");
        Add(exp.InvoicePhotos, "Copy of Invoice");
        Add(acc.Photos, "Copy of Cancelled Cheque");

        var args = new DynamicParameters();
        args.Add("RefId", NewRefId());
        args.Add("ZedId", model.ZedId);
        args.Add("CategoryOfCertificate", cert.CategoryOfCertificate);
        args.Add("NameOfCertficate", cert.NameOfCertficate);
        args.Add("CertificationAgency", cert.CertificationAgency);
        args.Add("CertficateNumber", cert.CertficateNumber);
        args.Add("DateOfIssue", cert.DateOfIssue);
        args.Add("ValidityOfCertificate", cert.ValidityOfCertificate);
        args.Add("AnyOtherInformation", cert.AnyOtherInformation);
        args.Add("ExpenditureCertficate", exp.ExpenditureCertficate);
        args.Add("AgencyOrSupplier", exp.AgencyOrSupplier);
        args.Add("InvoiceNo", exp.InvoiceNo);
        args.Add("InvoiceBillDate", exp.InvoiceBillDate);
        args.Add("AmountPaid", exp.AmountPaid);
        args.Add("ModeOfPayment", exp.ModeOfPayment);
        args.Add("EligibleAmount", exp.EligibleAmount);
        args.Add("AccountNo", acc.AccountNo);
        args.Add("IfscCode", acc.IfscCode);
        args.Add("BranchAddress", acc.BranchAddress);
        args.Add("BankName", acc.BankName);
        args.Add("SubmittedFrom", "App");
        AddTable(args, "PhotoListApp", points, "DynamicPhotoList2");

        var error = await TryExecuteAsync("SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE", args, ct);
        if (error is not null) return Answer(ServiceResponse.Fail(error));
        log.LogInformation("App financial assistance claim for {ZedId} ({Level})", model.ZedId, level);

        try
        {
            var row = (await db.QueryProcMultipleAsync("SP_EMAIL_GET_DETAILS", new { ZedId = model.ZedId, Certification = level }, ct)).FirstRow(0);
            await SendMailAsync<MsmeFinancialAssistanceEmail>(row.Text("EmailId"),
                "ZED Financial Assistance Documents Upload Confirmation - " + model.ZedId, new Dictionary<string, object?>
                {
                    [nameof(MsmeFinancialAssistanceEmail.EnterpriseName)] = row.Text("EnterpriseName"),
                    [nameof(MsmeFinancialAssistanceEmail.ZedId)] = model.ZedId ?? "",
                }, null, ct, copyOffice: true);
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "No mail details for the financial assistance claim of {ZedId}", model.ZedId);
        }

        return Answer(new ServiceResponse { status = "1" });
    }

    /// <summary>Claim documents (Photos/{zedId or userName}/FinancialAssistance). Files only, as before.</summary>
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "zedId", "userName")]
    public async Task<IActionResult> SubmitFinancialPhotos(SubmitPhotosRequestFile request, List<IFormFile>? files, CancellationToken ct)
    {
        if (!string.IsNullOrEmpty(request.zedId)) request.userName = request.zedId;
        if (request.photos is null && files is not { Count: > 0 }) return Fail(NoPhotosFound);

        var zedId = request.userName ?? "";
        if (await CurrentCertificateAsync(zedId, ct) is null)
        {
            log.LogWarning("Msme/SubmitFinancialPhotos refused for {ZedId}: no completed certification", zedId);
            return Fail(InvalidDetails);
        }

        var uploads = new Uploads(Storage);
        CollectPhotoFiles(uploads, request.photos, files, "Photos", zedId, "FinancialAssistance");
        await uploads.SaveAsync(ct);
        return LegacyJson(new ServiceResponse { status = "1" });
    }
}
