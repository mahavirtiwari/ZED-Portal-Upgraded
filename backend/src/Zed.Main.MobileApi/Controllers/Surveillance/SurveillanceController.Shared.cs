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

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// Helpers of the Bronze surveillance app's actions: copies of <see cref="MsmeController"/>'s upload, table
/// parameter, procedure-error, evidence-PDF, mail and questionnaire helpers (kept separate so the MSME app's
/// controller stays untouched).
/// </summary>
public sealed partial class SurveillanceController
{
    private const string InvalidDetails = "Invalid Details.";
    private const string InvalidData = "Invalid Data.";
    private const string GenericError = "An error has occurred, please try again later.";
    private const string NoDataFound = "No data found.";
    private const string NoPhotosFound = "No photos found.";
    private const string EvidenceNotSynced = "Evidence Photos not synced.";

    private MobileStorage Storage => HttpContext.RequestServices.GetRequiredService<MobileStorage>();

    private PortalOptions Portal => HttpContext.RequestServices.GetRequiredService<IOptions<PortalOptions>>().Value;

    /// <summary>The old RefId: the request time to the second.</summary>
    private static string NewRefId() => DateTime.Now.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture);

    /// <summary>A certification type used in a path (Photos/{ZedId}/{Certification}/...): must be a known level.</summary>
    private static string CertificationSegment(string? value) =>
        value is not null && MsmeController.PathCertifications.Contains(value)
            ? value
            : throw new UnsafePathException($"'{value}' is not a known certification type.");

    // ---------- Uploads ----------

    /// <summary>Files collected from one request; every name is checked when added, so a bad name refuses the request before anything is written.</summary>
    private sealed class Uploads(MobileStorage storage)
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
    private static List<string> CollectPhotos(Uploads uploads, IEnumerable<PhotoInformation?>? photos, string zedId, string certification,
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
    private static void CollectPhotoFiles(Uploads uploads, List<PhotoInformationFile>? photos, List<IFormFile>? files, params string[] folder)
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
    private static T? ParseEmbedded<T>(string? json) where T : class
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
    private static DataTable PhotoTable() => Table("PhotoId", "Name", "TimeStamp", "Latitude", "Longitude", "PhotoType");

    private static void AddPhotoRow(DataTable t, string? photoId, string? name, string? timeStamp, string? latitude, string? longitude, string? photoType) =>
        t.Rows.Add(photoId, name ?? "", timeStamp, latitude, longitude, photoType ?? "");

    private static DataTable Table(params string[] columns)
    {
        var t = new DataTable();
        foreach (var c in columns) t.Columns.Add(c, typeof(string));
        return t;
    }

    /// <summary>Adds a table parameter only when it has rows, as the old code did.</summary>
    private static void AddTable(DynamicParameters p, string name, DataTable table, string typeName)
    {
        if (table.Rows.Count > 0) p.Add(name, table.AsTableValuedParameter(typeName));
    }

    // ---------- Procedure errors ----------

    /// <summary>The old ExecuteNonStoredProcedure returned the SQL error text; now only a fixed or mapped message (MsmeController.ProcedureMessage).</summary>
    private async Task<string?> TryExecuteAsync(string procedure, object parameters, CancellationToken ct)
    {
        try
        {
            await db.ExecuteProcAsync(procedure, parameters, ct);
            return null;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "{Procedure} failed", procedure);
            return MsmeController.ProcedureMessage(ex.Message);
        }
    }

    private ContentResult Answer(string? error) => LegacyJson(error is null ? new ServiceResponse { status = "1" } : ServiceResponse.Fail(error));

    // ---------- Evidence PDFs ----------

    /// <summary>The evidence PDF (Photos/{ZedId}/{Cert}/Evidences/{EvidenceId}.pdf) from photos in that folder, one A4 page each.</summary>
    private async Task<bool> WriteEvidencePdfAsync(string folder, IReadOnlyList<string> photoNames, string pdfName, CancellationToken ct)
    {
        var images = new List<byte[]>();
        foreach (var name in photoNames)
        {
            var path = Storage.Target(folder, name);
            if (!System.IO.File.Exists(path))
            {
                log.LogWarning("Evidence photo {Name} is missing in {Folder}", name, folder);
                return false;
            }
            images.Add(await System.IO.File.ReadAllBytesAsync(path, ct));
        }
        return await WritePdfAsync(folder, images, pdfName, ct);
    }

    private async Task<bool> WritePdfAsync(string folder, IReadOnlyList<byte[]> images, string pdfName, CancellationToken ct)
    {
        var pdf = MsmeController.ImagesToPdf(images);
        if (pdf is null)
        {
            log.LogWarning("Could not build {Pdf}: a photo is not an image", pdfName);
            return false;
        }
        await System.IO.File.WriteAllBytesAsync(Storage.Target(folder, pdfName), pdf, ct);
        return true;
    }

    /// <summary>
    /// SP_ASSESSMENT_CHECK_NC_PHOTO_AVAILABILITY returns the old server's absolute paths; the part from "Photos/"
    /// on is looked up under the storage root, anything else counts as missing.
    /// </summary>
    private bool LegacyPhotoExists(string? legacyPath)
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
    private async Task SendMailAsync<TComponent>(string? to, string subject, IDictionary<string, object?> parameters,
        IReadOnlyList<string>? cc, CancellationToken ct, bool copyOffice = false) where TComponent : IComponent
    {
        if (string.IsNullOrWhiteSpace(to))
        {
            log.LogWarning("No e-mail address for '{Subject}'", subject);
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
            await email.SendAsync(new EmailMessage(to.Trim(), subject, html,
                Cc: copies is { Count: > 0 } ? copies : null,
                Bcc: string.IsNullOrWhiteSpace(office) ? null : [office]), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Mail '{Subject}' failed", subject);
        }
    }

    // ---------- Questionnaire tree (GetParametersByType, GetNcDetailsByType) ----------

    private static bool SameCode(IDictionary<string, object?> row, string column, string? code) =>
        string.Equals(row.Text(column).TrimEnd(), (code ?? "").TrimEnd(), StringComparison.OrdinalIgnoreCase);

    /// <summary>Sections, requirements, options, sub-options and (optionally) evidences from consecutive result sets, nested by their codes.</summary>
    private static List<ParameterDetails> BuildParameters(ResultSets sets, int first, bool withEvidences, bool withAssessorRemarks)
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
