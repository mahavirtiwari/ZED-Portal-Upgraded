using System.Data;
using System.Data.Common;
using System.Globalization;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using SkiaSharp;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Main.MobileApi.Models;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>Helpers shared by the MSME app's actions (stage checks, uploads, table parameters, PDFs, mail).</summary>
public sealed partial class MsmeController
{
    private const string InvalidDetails = "Invalid Details.";
    private const string InvalidData = "Invalid Data.";
    private const string GenericError = "An error has occurred, please try again later.";
    private const string NoDataFound = "No data found.";
    private const string NoPhotosFound = "No photos found.";
    private const string EvidenceNotSynced = "Evidence Photos not synced.";

    /// <summary>
    /// Certification values that may appear as a folder name (Photos/{ZedId}/{Certification}/...).
    /// The old code joined any request value into the path.
    /// </summary>
    internal static readonly IReadOnlySet<string> PathCertifications = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "Bronze", "Silver", "Gold",
        "BronzeSurveillance", "SilverSurveillance", "GoldSurveillance",
        "SilverMilestone1", "SilverMilestone2", "SilverMilestone3",
        "GoldMilestone1", "GoldMilestone2", "GoldMilestone3",
    };

    private MobileStorage Storage => HttpContext.RequestServices.GetRequiredService<MobileStorage>();

    private PortalOptions Portal => HttpContext.RequestServices.GetRequiredService<IOptions<PortalOptions>>().Value;

    /// <summary>The old RefId: the request time to the second.</summary>
    private static string NewRefId() => DateTime.Now.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture);

    /// <summary>A certification type used in a path: must be one of the known levels.</summary>
    private static string CertificationSegment(string? value) =>
        value is not null && PathCertifications.Contains(value)
            ? value
            : throw new UnsafePathException($"'{value}' is not a known certification type.");

    // ---------- Stage (ownership) checks ----------

    /// <summary>
    /// Where a unit stands for one level, from SP_APP_MSME_STATUS (the procedure that drives the
    /// app's buttons): Status 0 = not paid, 1 = paid and not yet final-submitted, 2+ = submitted;
    /// NcCount and the current NC's status (1 = raised, 2 = response submitted).
    /// </summary>
    internal sealed record LevelStage(int Status, int NcCount, int CurrentNcStatus)
    {
        public bool Paid => Status > 0;
        public bool BeforeFinalSubmit => Status == 1;
        public bool NcOpen => NcCount > 0 && (NcCount > 5 || CurrentNcStatus == 1);
    }

    /// <summary>Null when the level is not Bronze/Silver/Gold or the ZED ID is unknown.</summary>
    private async Task<LevelStage?> StageAsync(string? zedId, string? certificationType, CancellationToken ct)
    {
        var level = certificationType?.Trim().ToLowerInvariant() switch
        {
            "bronze" => "Bronze",
            "silver" => "Silver",
            "gold" => "Gold",
            _ => null,
        };
        if (level is null || string.IsNullOrWhiteSpace(zedId)) return null;
        var row = (await db.QueryProcMultipleAsync("SP_APP_MSME_STATUS", new { ZedId = zedId }, ct)).FirstRow(0);
        // The status columns are NULL when there is no Msme row for the ZED ID.
        if (!row.TryGetValue(level + "Status", out var status) || status is null or DBNull) return null;
        var nc = row.Int(level + "StatusOfNc");
        return new LevelStage(row.Int(level + "Status"), nc, nc is >= 1 and <= 5 ? row.Int($"{level}StatusOfNc{nc}") : 0);
    }

    private ContentResult StageRefused(string action, string? zedId, string? certificationType, LevelStage? stage)
    {
        log.LogWarning("Msme/{Action} refused for {ZedId} {Certification}: stage {Stage}", action, zedId, certificationType, stage?.ToString() ?? "unknown");
        return Fail(InvalidDetails);
    }

    // ---------- Uploads ----------

    /// <summary>
    /// Files collected from one request. Every name is checked when it is added, so a bad name
    /// refuses the request before anything is written.
    /// </summary>
    private sealed class Uploads(MobileStorage storage)
    {
        private readonly List<(string[] Folder, string Name, string? Base64, IFormFile? File)> items = [];

        public int Count => items.Count;

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
    /// Port of the old SavePhotos: base64 photos become {photoId}.jpg / .pdf, a photo without
    /// base64 takes the uploaded file_data as {photoId}{allowed extension}; every photo becomes a
    /// row of the DynamicPhotoList2 parameter. Returns the stored file name of each photo.
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
                // Nothing to store in this call (sent earlier or later); only the row is recorded, as before.
                stored = (photo.photoId ?? "") + (photo.isPdf ? ".pdf" : ".jpg");
            names.Add(stored);
            AddPhotoRow(table, photo.photoId, name, photo.timeStamp, photo.latitude, photo.longitude, photo.isPdf ? "pdf" : "jpg");
        }
        return names;
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
    private static DataTable PhotoTable()
    {
        var t = new DataTable();
        foreach (var c in new[] { "PhotoId", "Name", "TimeStamp", "Latitude", "Longitude", "PhotoType" }) t.Columns.Add(c, typeof(string));
        return t;
    }

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

    /// <summary>
    /// The old ExecuteNonStoredProcedure returned the SQL error text, which the app showed. Several
    /// procedures raise their refusals on purpose by writing a marker string into a bit column of
    /// DummyUsersForError; the marker is mapped to a readable message here and nothing else of the
    /// SQL error leaves the server.
    /// </summary>
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
            return ProcedureMessage(ex.Message);
        }
    }

    internal static string ProcedureMessage(string sqlMessage)
    {
        if (sqlMessage.Contains("'OLD EVIDENCE'", StringComparison.Ordinal)) return "This evidence is not part of the current submission.";
        if (sqlMessage.Contains("'ABC_EVIDENCES'", StringComparison.Ordinal)) return "This requirement has no open non-conformance.";
        if (sqlMessage.Contains("'ABC_PRODUCTPHOTOS'", StringComparison.Ordinal)) return "This product has no open non-conformance.";
        if (sqlMessage.Contains("'ABC_SITE_EXTERIOR'", StringComparison.Ordinal)) return "Site exterior photos have no open non-conformance.";
        if (sqlMessage.Contains("'ABC'", StringComparison.Ordinal)) return "Financial assistance has already been applied for, or the unit is not eligible.";
        return GenericError;
    }

    // ---------- Evidence PDFs ----------

    /// <summary>
    /// The evidence PDF the portal opens (Photos/{ZedId}/{Cert}/Evidences/{EvidenceId}.pdf), built
    /// from photos in that folder, one A4 page each (old PdfHelper.GenerateReport). False when a
    /// photo is missing or is not an image.
    /// </summary>
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
        var pdf = ImagesToPdf(images);
        if (pdf is null)
        {
            log.LogWarning("Could not build {Pdf}: a photo is not an image", pdfName);
            return false;
        }
        await System.IO.File.WriteAllBytesAsync(Storage.Target(folder, pdfName), pdf, ct);
        return true;
    }

    /// <summary>One A4 page per image, scaled to fit inside 10 pt margins, centred at the top.</summary>
    internal static byte[]? ImagesToPdf(IReadOnlyList<byte[]> images)
    {
        const float pageW = 595f, pageH = 842f, margin = 10f;
        var decoded = new List<SKImage>();
        try
        {
            foreach (var bytes in images)
            {
                using var data = SKData.CreateCopy(bytes);
                var image = SKImage.FromEncodedData(data);
                if (image is null) return null;
                decoded.Add(image);
            }

            using var output = new MemoryStream();
            using (var doc = SKDocument.CreatePdf(output))
            {
                foreach (var image in decoded)
                {
                    var canvas = doc.BeginPage(pageW, pageH);
                    var scale = Math.Min((pageW - 2 * margin) / image.Width, (pageH - 3 * margin) / image.Height);
                    var w = image.Width * scale;
                    var h = image.Height * scale;
                    canvas.DrawImage(image, SKRect.Create((pageW - w) / 2, 2 * margin, w, h), new SKSamplingOptions(SKFilterMode.Linear));
                    doc.EndPage();
                }
                if (decoded.Count == 0)
                {
                    doc.BeginPage(pageW, pageH);
                    doc.EndPage();
                }
                doc.Close();
            }
            return output.ToArray();
        }
        finally
        {
            foreach (var i in decoded) i.Dispose();
        }
    }

    // ---------- Mail ----------

    /// <summary>
    /// Renders and sends a mail; failures are logged and never change the app's answer (as before).
    /// <paramref name="copyOffice"/>: blind copy to Email:RegistrationCc, as the old mails did with ccAddress.
    /// </summary>
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
            var office = copyOffice ? HttpContext.RequestServices.GetRequiredService<IOptions<EmailOptions>>().Value.RegistrationCc : null;
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

    /// <summary>
    /// Sections, requirements, options, sub-options and (optionally) evidences from consecutive
    /// result sets starting at <paramref name="first"/>, nested by their codes as the old
    /// DataTable.Select filters did.
    /// </summary>
    private static List<ParameterDetails> BuildParameters(ResultSets sets, int first, bool withEvidences, bool withAssessorRemarks)
    {
        var result = new List<ParameterDetails>();
        foreach (var row in sets[first])
        {
            var element = new ParameterDetails
            {
                id = row.Int("Id"),
                code = row.Text("SectionCode"),
                label = row.Text("SectionName"),
                requirements = [],
            };
            foreach (var rowReq in sets[first + 1].Where(r => SameCode(r, "SectionCode", element.code)))
            {
                var requirement = new RequirementDetails
                {
                    id = rowReq.Int("Id"),
                    code = rowReq.Text("RequirementCode"),
                    assessorRemarks = withAssessorRemarks ? rowReq.Text("AssessorRemarks") : null,
                    options = [],
                    evidences = [],
                };
                foreach (var rowOpt in sets[first + 2].Where(r => SameCode(r, "SectionCode", element.code) && SameCode(r, "RequirementCode", requirement.code)))
                {
                    var option = new OptionInfo
                    {
                        id = rowOpt.Int("Id"),
                        code = rowOpt.Text("OptionCode"),
                        label = rowOpt.Text("OptionName"),
                        subOptions = [],
                    };
                    foreach (var rowSub in sets[first + 3].Where(r => SameCode(r, "SectionCode", element.code) &&
                                                                      SameCode(r, "RequirementCode", requirement.code) && SameCode(r, "OptionCode", option.code)))
                    {
                        option.subOptions.Add(new SubOption
                        {
                            id = rowSub.Int("Id"),
                            code = rowSub.Text("SubOptionCode"),
                            label = rowSub.Text("SubOptionName"),
                        });
                    }
                    requirement.options.Add(option);
                }
                if (withEvidences)
                {
                    foreach (var rowEv in sets[first + 4].Where(r => SameCode(r, "SectionCode", element.code) && SameCode(r, "RequirementCode", requirement.code)))
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
