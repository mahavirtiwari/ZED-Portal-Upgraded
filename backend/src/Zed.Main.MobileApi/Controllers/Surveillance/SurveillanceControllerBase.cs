using System.Data;
using System.Data.Common;
using System.Globalization;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Main.MobileApi.Models;
using Zed.Main.MobileApi.Templates;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// What the two controllers of the Surveillance deployment that write a unit's surveillance answers share:
/// <see cref="SurveillanceController"/> (the Bronze surveillance app, the unit's desktop assessor) and
/// <see cref="SurveillanceMsmeController"/> (the ZED MSME app, the unit's own replies to a surveillance NC). The helpers
/// are copies of <see cref="MsmeController"/>'s upload, table parameter, procedure-error, evidence-PDF, mail and
/// questionnaire helpers (kept separate so the MSME app's controller on Main stays untouched); the NC replies run after
/// each controller's own check of the caller and the unit's stage.
/// </summary>
public abstract class SurveillanceControllerBase : LegacyMobileController
{
    /// <summary>The deployment's database (ZED_SURVEILLANCE).</summary>
    private protected abstract ISqlExecutor Db { get; }

    private protected abstract ILogger Log { get; }

    /// <summary>The address prefix in the log ("Surveillance", "Msme").</summary>
    private protected abstract string LogArea { get; }

    private protected const string InvalidDetails = "Invalid Details.";
    private protected const string InvalidData = "Invalid Data.";
    private protected const string GenericError = "An error has occurred, please try again later.";
    private protected const string NoDataFound = "No data found.";
    private protected const string NoPhotosFound = "No photos found.";
    private protected const string EvidenceNotSynced = "Evidence Photos not synced.";

    private protected MobileStorage Storage => HttpContext.RequestServices.GetRequiredService<MobileStorage>();

    private protected PortalOptions Portal => HttpContext.RequestServices.GetRequiredService<IOptions<PortalOptions>>().Value;

    /// <summary>The old RefId: the request time to the second.</summary>
    private protected static string NewRefId() => DateTime.Now.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture);

    /// <summary>A certification type used in a path (Photos/{ZedId}/{Certification}/...): must be a known level.</summary>
    private protected static string CertificationSegment(string? value) =>
        value is not null && MsmeController.PathCertifications.Contains(value)
            ? value
            : throw new UnsafePathException($"'{value}' is not a known certification type.");

    // ---------- Uploads ----------

    /// <summary>Files collected from one request; every name is checked when added, so a bad name refuses the request before anything is written.</summary>
    private protected sealed class Uploads(MobileStorage storage)
    {
        private readonly List<(string[] Folder, string Name, string? Base64, IFormFile? File)> items = [];

        public string AddBase64(string base64, string fileName, params string[] folder) => Add(folder, fileName, base64, null);

        public string AddFile(IFormFile file, string fileName, params string[] folder) => Add(folder, fileName, null, file);

        private string Add(string[] folder, string fileName, string? base64, IFormFile? file)
        {
            foreach (var s in folder) MobileStorage.Segment(s);
            MobileStorage.Segment(fileName);
            items.Add((folder, fileName, base64, file));
            return fileName;
        }

        public async Task SaveAsync(CancellationToken ct)
        {
            foreach (var (folder, name, base64, file) in items)
            {
                var dir = storage.Folder(folder);
                if (base64 is not null) await storage.SaveBase64Async(base64, dir, name, ct);
                else await storage.SaveAsync(file!, dir, name, ct);
            }
        }
    }

    /// <summary>
    /// The old SavePhotos: base64 photos become {photoId}.jpg / .pdf under Photos/{zedId}/{cert}/{name}, a photo
    /// without base64 takes file_data as {photoId}{allowed extension}; every photo becomes a DynamicPhotoList2 row.
    /// </summary>
    private protected static List<string> CollectPhotos(Uploads uploads, IEnumerable<PhotoInformation?>? photos, string zedId, string certification,
        string name, DataTable table, IFormFile? fileData = null)
    {
        var names = new List<string>();
        if (photos is null) return names;
        foreach (var photo in photos)
        {
            if (photo is null) continue;
            string stored;
            if (!string.IsNullOrEmpty(photo.photo))
                stored = uploads.AddBase64(photo.photo, MobileStorage.FileName(photo.photoId, photo.isPdf ? ".pdf" : ".jpg"), "Photos", zedId, certification, name);
            else if (fileData is { Length: > 0 })
                stored = uploads.AddFile(fileData, MobileStorage.FileName(photo.photoId, MobileStorage.Extension(fileData.FileName, MobileStorage.DocumentExtensions)),
                    "Photos", zedId, certification, name);
            else
                stored = (photo.photoId ?? "") + (photo.isPdf ? ".pdf" : ".jpg");
            names.Add(stored);
            AddPhotoRow(table, photo.photoId, name, photo.timeStamp, photo.latitude, photo.longitude, photo.isPdf ? "pdf" : "jpg");
        }
        return names;
    }

    /// <summary>SubmitPhotos: base64 as {photoId}.jpg/.pdf, a photo's file_data as {photoId}{extension}, the files list under their own plain names.</summary>
    private protected static void CollectPhotoFiles(Uploads uploads, List<PhotoInformationFile>? photos, List<IFormFile>? files, params string[] folder)
    {
        foreach (var photo in photos ?? [])
        {
            if (photo is null) continue;
            if (!string.IsNullOrEmpty(photo.photo))
                uploads.AddBase64(photo.photo, MobileStorage.FileName(photo.photoId, photo.isPdf ? ".pdf" : ".jpg"), folder);
            else if (photo.file_data is { Length: > 0 } f)
                uploads.AddFile(f, MobileStorage.FileName(photo.photoId, MobileStorage.Extension(f.FileName, MobileStorage.DocumentExtensions)), folder);
        }
        foreach (var f in files ?? [])
            if (f is { Length: > 0 }) uploads.AddFile(f, MobileStorage.UploadedName(f, MobileStorage.DocumentExtensions), folder);
    }

    /// <summary>A PhotoInformation (or ProductDetails) sent as a JSON string inside the request.</summary>
    private protected static T? ParseEmbedded<T>(string? json) where T : class
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            return JsonSerializer.Deserialize<T>(json, Zed.Core.Mobile.LegacyJson.Read);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    // ---------- Table-valued parameters ----------

    /// <summary>DynamicPhotoList2 (PhotoId, Name, TimeStamp, Latitude, Longitude, PhotoType).</summary>
    private protected static DataTable PhotoTable() => Table("PhotoId", "Name", "TimeStamp", "Latitude", "Longitude", "PhotoType");

    private protected static void AddPhotoRow(DataTable t, string? photoId, string? name, string? timeStamp, string? latitude, string? longitude, string? photoType) =>
        t.Rows.Add(photoId, name ?? "", timeStamp, latitude, longitude, photoType ?? "");

    private protected static DataTable Table(params string[] columns)
    {
        var t = new DataTable();
        foreach (var c in columns) t.Columns.Add(c, typeof(string));
        return t;
    }

    /// <summary>Adds a table parameter only when it has rows, as the old code did.</summary>
    private protected static void AddTable(DynamicParameters p, string name, DataTable table, string typeName)
    {
        if (table.Rows.Count > 0) p.Add(name, table.AsTableValuedParameter(typeName));
    }

    // ---------- Procedure errors ----------

    /// <summary>The old ExecuteNonStoredProcedure returned the SQL error text; now only a fixed or mapped message (MsmeController.ProcedureMessage).</summary>
    private protected async Task<string?> TryExecuteAsync(string procedure, object parameters, CancellationToken ct)
    {
        try
        {
            await Db.ExecuteProcAsync(procedure, parameters, ct);
            return null;
        }
        catch (DbException ex)
        {
            Log.LogWarning(ex, "{Procedure} failed", procedure);
            return MsmeController.ProcedureMessage(ex.Message);
        }
    }

    private protected ContentResult Answer(string? error) => LegacyJson(error is null ? new ServiceResponse { status = "1" } : ServiceResponse.Fail(error));

    // ---------- Evidence PDFs ----------

    /// <summary>The evidence PDF (Photos/{ZedId}/{Cert}/Evidences/{EvidenceId}.pdf) from photos in that folder, one A4 page each.</summary>
    private protected async Task<bool> WriteEvidencePdfAsync(string folder, IReadOnlyList<string> photoNames, string pdfName, CancellationToken ct)
    {
        var images = new List<byte[]>();
        foreach (var name in photoNames)
        {
            var path = Storage.Target(folder, name);
            if (!System.IO.File.Exists(path))
            {
                Log.LogWarning("Evidence photo {Name} is missing in {Folder}", name, folder);
                return false;
            }
            images.Add(await System.IO.File.ReadAllBytesAsync(path, ct));
        }
        return await WritePdfAsync(folder, images, pdfName, ct);
    }

    private protected async Task<bool> WritePdfAsync(string folder, IReadOnlyList<byte[]> images, string pdfName, CancellationToken ct)
    {
        var pdf = MsmeController.ImagesToPdf(images);
        if (pdf is null)
        {
            Log.LogWarning("Could not build {Pdf}: a photo is not an image", pdfName);
            return false;
        }
        await System.IO.File.WriteAllBytesAsync(Storage.Target(folder, pdfName), pdf, ct);
        return true;
    }

    /// <summary>
    /// SP_ASSESSMENT_CHECK_NC_PHOTO_AVAILABILITY returns the old server's absolute paths; the part from "Photos/"
    /// on is looked up under the storage root, anything else counts as missing.
    /// </summary>
    private protected bool LegacyPhotoExists(string? legacyPath)
    {
        if (string.IsNullOrWhiteSpace(legacyPath)) return false;
        var normalized = legacyPath.Replace('\\', '/');
        var at = normalized.StartsWith("Photos/", StringComparison.OrdinalIgnoreCase) ? 0
            : normalized.IndexOf("/Photos/", StringComparison.OrdinalIgnoreCase) is var i and >= 0 ? i + 1 : -1;
        if (at < 0) return false;
        try
        {
            var segments = normalized[at..].Split('/', StringSplitOptions.RemoveEmptyEntries).Select(MobileStorage.Segment).ToArray();
            var full = Path.GetFullPath(Path.Combine([Storage.Root, .. segments]));
            var root = Storage.Root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            return full.StartsWith(root, StringComparison.OrdinalIgnoreCase) && System.IO.File.Exists(full);
        }
        catch (UnsafePathException)
        {
            return false;
        }
    }

    // ---------- Mail ----------

    /// <summary>Renders and sends a mail; failures are logged and never change the app's answer.</summary>
    private protected async Task SendMailAsync<TComponent>(string? to, string subject, IDictionary<string, object?> parameters,
        IReadOnlyList<string>? cc, CancellationToken ct, bool copyOffice = false, string profile = EmailProfiles.DocumentUpload) where TComponent : IComponent
    {
        if (string.IsNullOrWhiteSpace(to))
        {
            Log.LogWarning("No e-mail address for '{Subject}'", subject);
            return;
        }
        try
        {
            var templates = HttpContext.RequestServices.GetRequiredService<IHtmlTemplateRenderer>();
            var email = HttpContext.RequestServices.GetRequiredService<IEmailSender>();
            parameters["PublicBaseUrl"] = Portal.PublicBaseUrl;
            var html = await templates.RenderAsync<TComponent>(parameters);
            var copies = cc?.Where(a => !string.IsNullOrWhiteSpace(a)).ToList();
            var office = copyOffice ? await HttpContext.RequestServices.GetRequiredService<EmailAddresses>().GetAsync(EmailAddresses.RegistrationCc, ct) : null;
            await email.SendAsync(new EmailMessage(to.Trim(), subject, html, profile,
                Cc: copies is { Count: > 0 } ? copies : null,
                Bcc: string.IsNullOrWhiteSpace(office) ? null : [office]), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Log.LogWarning(ex, "Mail '{Subject}' failed", subject);
        }
    }

    private protected ContentResult Refuse(string action, string? zedId, string? certification, string reason, string message)
    {
        Log.LogWarning("{Area}/{Action} refused for {ZedId} {Certification}: {Reason}", LogArea, action, zedId, certification, reason);
        return Fail(message);
    }

    // ---------- NC replies (after the caller's own check: the unit's current NC is open) ----------

    /// <summary>SP_APP_MSME_GET_NC_DETAILS_BY_TYPE: the site exterior photos, products and requirements of NC <paramref name="ncCount"/>.</summary>
    private protected async Task<IActionResult> NcDetailsAsync(string? zedId, string? certificationType, string? ncCount, CancellationToken ct)
    {
        var sets = await Db.QueryProcMultipleAsync("SP_APP_MSME_GET_NC_DETAILS_BY_TYPE",
            new { ZedId = zedId, NcCount = ncCount, CertificationType = certificationType }, ct);
        var res = new NcResponse { status = "1", siteExteriorPhotos = [], products = [], parameters = [] };
        foreach (var row in sets.Count > 0 ? sets[0] : [])
        {
            res.assessorRemarksSite = row.Text("AssessorRemarks");
            res.siteExteriorPhotos.Add(row.Text("PhotoPath"));
        }
        foreach (var row in sets.Count > 1 ? sets[1] : [])
        {
            res.products.Add(new ProductDetails
            {
                productId = row.Int("Id"),
                exported = row.Text("Exported"),
                productName = row.Text("ProductName"),
                productPhotoPath = row.Text("ProductPhotoPath"),
                productDescriptionPhotoPath = row.Text("ProductDescriptionPhotoPath"),
                assessorRemarks = row.Text("AssessorRemarks"),
            });
        }
        if (sets.Count > 2 && sets[2].Count > 0) res.parameters = BuildParameters(sets, 2, withEvidences: false, withAssessorRemarks: true);
        await AppRequirementVideos.FillAsync(Db, "dbo", certificationType, res.parameters, null, ct);
        return LegacyJson(res);
    }

    /// <summary>
    /// One evidence photo for an NC requirement. The evidence PDF is named after the requirement's evidence in the
    /// current NC (SP_APP_MSME_GET_EVIDENCE_ID), which also proves the requirement belongs to this unit's open NC.
    /// </summary>
    private protected async Task<IActionResult> SaveNcRequirementAsync(string action, string zedId, NcRequirementSubmitRequest request, IFormFile? file_data,
        CancellationToken ct)
    {
        var cert = CertificationSegment(request.certificationType);
        request.photoObj = ParseEmbedded<PhotoInformation>(request.photo);
        if (request.photoObj is null || !int.TryParse(request.requirementId, NumberStyles.Integer, CultureInfo.InvariantCulture, out _))
            return Fail(InvalidData);

        var evidence = (await Db.QueryProcMultipleAsync("SP_APP_MSME_GET_EVIDENCE_ID",
            new { CertificationType = cert, ZedId = zedId, RequirementId = request.requirementId }, ct)).FirstRow(0);
        if (evidence.Text("EvidenceId") is not { Length: > 0 } evidenceId)
            return Refuse(action, zedId, cert, "requirement not in the open NC", InvalidDetails);

        var uploads = new Uploads(Storage);
        var table = PhotoTable();
        var stored = CollectPhotos(uploads, [request.photoObj], zedId, cert, "Evidences", table, file_data);
        var pdfName = MobileStorage.FileName(evidenceId, ".pdf");
        string[] folderSegments = ["Photos", zedId, cert, "Evidences"];
        if (request.photoObj.isPdf)
        {
            if (file_data is { Length: > 0 })
            {
                MobileStorage.Extension(file_data.FileName, MobileStorage.DocumentExtensions);
                uploads.AddFile(file_data, pdfName, folderSegments);
            }
            else if (!string.IsNullOrEmpty(request.photoObj.photo))
                uploads.AddBase64(request.photoObj.photo, pdfName, folderSegments);
        }
        await uploads.SaveAsync(ct);

        if (!request.photoObj.isPdf && request.isLast)
        {
            var names = new List<string>();
            if (!request.isFirst)
            {
                var earlier = await Db.QueryProcMultipleAsync("SP_APP_MSME_GET_REQUIREMENT_PHOTOS",
                    new { RequirementId = request.requirementId, ZedId = zedId, CertificationType = cert }, ct);
                if (earlier.Count > 0) names.AddRange(earlier[0].Select(r => r.Text("PhotoPath")));
            }
            names.Add(stored[^1]);
            if (!await WriteEvidencePdfAsync(Storage.Folder(folderSegments), names, pdfName, ct)) return Fail(EvidenceNotSynced);
        }

        var args = new DynamicParameters();
        args.Add("CertificationType", cert);
        args.Add("ZedId", zedId);
        args.Add("Id", request.requirementId);
        args.Add("IsFirst", request.isFirst);
        args.Add("IsLast", request.isLast);
        args.Add("Code", request.requirementCode);
        args.Add("MsmeRemarks", request.msmeRemarks);
        AddTable(args, "PhotoList", table, "DynamicPhotoList2");
        return Answer(await TryExecuteAsync("SP_APP_MSME_INSERT_REQUIREMENT", args, ct));
    }

    /// <summary>New product photos for an NC (<paramref name="product"/> parsed from productDetailsNc; files = the photo files for BasicInfo).</summary>
    private protected async Task<IActionResult> SaveNcProductAsync(string zedId, NcProductSubmitRequest request, ProductDetails product, List<IFormFile> files,
        CancellationToken ct)
    {
        var cert = CertificationSegment(request.certificationType);
        var uploads = new Uploads(Storage);
        var productPhotos = PhotoTable();
        var descriptionPhotos = PhotoTable();
        if (product.productPhoto is { } pp)
        {
            if (!string.IsNullOrEmpty(pp.photo)) CollectPhotos(uploads, [pp], zedId, cert, "BasicInfo", productPhotos);
        }
        else product.productPhoto = new PhotoInformation();
        if (product.productDescriptionPhoto is { } dp)
        {
            if (!string.IsNullOrEmpty(dp.photo)) CollectPhotos(uploads, [dp], zedId, cert, "BasicInfo", descriptionPhotos);
        }
        else product.productDescriptionPhoto = new PhotoInformation();
        foreach (var f in files)
            if (f is { Length: > 0 }) uploads.AddFile(f, MobileStorage.UploadedName(f, MobileStorage.DocumentExtensions), "Photos", zedId, cert, "BasicInfo");
        await uploads.SaveAsync(ct);

        var args = new DynamicParameters();
        args.Add("RefId", NewRefId());
        args.Add("ZedId", zedId);
        args.Add("CertificationType", cert);
        args.Add("ProductId", product.productId.ToString(CultureInfo.InvariantCulture));
        args.Add("MsmeRemarks", product.msmeRemarks);
        args.Add("ProductPhoto", product.productPhoto.photoId + (product.productPhoto.isPdf ? ".pdf" : ".jpg"));
        args.Add("ProductDescriptionPhoto", product.productDescriptionPhoto.photoId + (product.productDescriptionPhoto.isPdf ? ".pdf" : ".jpg"));
        AddTable(args, "ProductPhotos", productPhotos, "DynamicPhotoList2");
        AddTable(args, "ProductDescriptionPhotos", descriptionPhotos, "DynamicPhotoList2");
        return Answer(await TryExecuteAsync("SP_APP_MSME_INSERT_PRODUCT_INFO", args, ct));
    }

    /// <summary>New site exterior photos for an NC (SP_APP_MSME_INSERT_SITE_EXTERIOR).</summary>
    private protected async Task<IActionResult> SaveNcSiteExteriorAsync(string zedId, NcSiteSubmitRequest request, CancellationToken ct)
    {
        var cert = CertificationSegment(request.certificationType);
        var uploads = new Uploads(Storage);
        var photos = PhotoTable();
        CollectPhotos(uploads, request.photos, zedId, cert, "SiteExteriorPhotos", photos);
        await uploads.SaveAsync(ct);

        var args = new DynamicParameters();
        args.Add("RefId", NewRefId());
        args.Add("ZedId", zedId);
        args.Add("CertificationType", cert);
        args.Add("MsmeRemarks", request.msmeRemarks);
        AddTable(args, "SiteExteriorPhotos", photos, "DynamicPhotoList2");
        return Answer(await TryExecuteAsync("SP_APP_MSME_INSERT_SITE_EXTERIOR", args, ct));
    }

    // ---------- Final submit ----------

    /// <summary>
    /// The photo check before a final submit (SP_ASSESSMENT_CHECK_NC_PHOTO_AVAILABILITY, <paramref name="args"/> =
    /// CertificationType and ZedId): the old message of the first list that names a missing file, else null. Only the
    /// first non-empty list is checked, as before.
    /// </summary>
    private protected async Task<string?> PhotosNotSyncedAsync(object args, CancellationToken ct)
    {
        var photos = await Db.QueryProcMultipleAsync("SP_ASSESSMENT_CHECK_NC_PHOTO_AVAILABILITY", args, ct);
        foreach (var (index, message) in new[] { (0, "Site Exterior Photos not synced."), (1, "Product Photos not synced."), (2, "Evidence Photos not synced.") })
        {
            if (index >= photos.Count || photos[index].Count == 0) continue;
            return photos[index].Any(r => !LegacyPhotoExists(r.Values.FirstOrDefault()?.ToString())) ? message : null;
        }
        return null;
    }

    /// <summary>The confirmation mail of a final submit: the basic information's, or the NC reply's (to the assessor and the agency too).</summary>
    private protected async Task SendSubmissionMailAsync(string zedId, string certification, CancellationToken ct)
    {
        IDictionary<string, object?> row;
        try
        {
            row = (await Db.QueryProcMultipleAsync("SP_EMAIL_GET_DETAILS", new { ZedId = zedId, Certification = certification }, ct)).FirstRow(0);
        }
        catch (DbException ex)
        {
            Log.LogWarning(ex, "No mail details for {ZedId} {Certification}", zedId, certification);
            return;
        }
        if (row.Count == 0) return;
        // Only these columns are read: the procedure also returns passwords.
        var parameters = new Dictionary<string, object?>
        {
            [nameof(MsmeSubmissionEmail.EnterpriseName)] = row.Text("EnterpriseName"),
            [nameof(MsmeSubmissionEmail.ZedId)] = zedId,
            [nameof(MsmeSubmissionEmail.Certification)] = certification,
            [nameof(MsmeSubmissionEmail.NcCount)] = row.Int("NcCount"),
        };
        if (row.Text("NcCount") is "0" or "")
            await SendMailAsync<MsmeSubmissionEmail>(row.Text("EmailId"), "ZED Basic information and Document Upload Confirmation – " + zedId, parameters, null, ct, copyOffice: true);
        else
            await SendMailAsync<MsmeSubmissionEmail>(row.Text("EmailId"),
                "Submission of response to Non-conformance(s) raised under “MSME Sustainable (ZED) Certification” Scheme  - " + zedId,
                parameters, [row.Text("AssessorEmailId"), row.Text("AgencyEmailId")], ct, copyOffice: true);
    }

    // ---------- Questionnaire tree (GetParametersByType, GetNcDetailsByType) ----------

    private protected static bool SameCode(IDictionary<string, object?> row, string column, string? code) =>
        string.Equals(row.Text(column).TrimEnd(), (code ?? "").TrimEnd(), StringComparison.OrdinalIgnoreCase);

    /// <summary>Sections, requirements, options, sub-options and (optionally) evidences from consecutive result sets, nested by their codes.</summary>
    private protected static List<ParameterDetails> BuildParameters(ResultSets sets, int first, bool withEvidences, bool withAssessorRemarks)
    {
        IReadOnlyList<IDictionary<string, object?>> Set(int i) => i < sets.Count ? sets[i] : [];
        var result = new List<ParameterDetails>();
        foreach (var row in Set(first))
        {
            var element = new ParameterDetails { id = row.Int("Id"), code = row.Text("SectionCode"), label = row.Text("SectionName"), requirements = [] };
            foreach (var rowReq in Set(first + 1).Where(r => SameCode(r, "SectionCode", element.code)))
            {
                var requirement = new RequirementDetails
                {
                    id = rowReq.Int("Id"),
                    code = rowReq.Text("RequirementCode"),
                    assessorRemarks = withAssessorRemarks ? rowReq.Text("AssessorRemarks") : null,
                    options = [],
                    evidences = [],
                };
                foreach (var rowOpt in Set(first + 2).Where(r => SameCode(r, "SectionCode", element.code) && SameCode(r, "RequirementCode", requirement.code)))
                {
                    var option = new OptionInfo { id = rowOpt.Int("Id"), code = rowOpt.Text("OptionCode"), label = rowOpt.Text("OptionName"), subOptions = [] };
                    foreach (var rowSub in Set(first + 3).Where(r => SameCode(r, "SectionCode", element.code) &&
                                                                     SameCode(r, "RequirementCode", requirement.code) && SameCode(r, "OptionCode", option.code)))
                        option.subOptions.Add(new SubOption { id = rowSub.Int("Id"), code = rowSub.Text("SubOptionCode"), label = rowSub.Text("SubOptionName") });
                    requirement.options.Add(option);
                }
                if (withEvidences)
                {
                    foreach (var rowEv in Set(first + 4).Where(r => SameCode(r, "SectionCode", element.code) && SameCode(r, "RequirementCode", requirement.code)))
                    {
                        requirement.evidences.Add(new EvidenceInfo
                        {
                            id = rowEv.Int("Id"),
                            code = rowEv.Text("EvidenceCode"),
                            label = rowEv.Text("EvidenceName"),
                            iButton = rowEv.Text("EvidenceHelpText"),
                            validationRequired = rowEv.Bool("ValidationRequired"),
                        });
                    }
                }
                element.requirements.Add(requirement);
            }
            result.Add(element);
        }
        return result;
    }
}
