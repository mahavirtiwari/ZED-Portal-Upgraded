using System.Data;
using System.Data.Common;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Forms;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Security;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Msme.Entry;

/// <summary>
/// The MSME's basic information, documents and final submit on the web, for the levels of <see cref="MsmeEntry.Levels"/>
/// (ZED-X). Bronze, Silver and Gold are entered in the MSME app, whose source is not in the repository, so ZED-X cannot be
/// added there. The same procedures and folders as the app's server (Zed.Main.MobileApi MsmeController), so the
/// desktop assessment, the staff pages and the MSME's own view read web entries as they read the app's:
/// <list type="bullet">
/// <item>basic information: SP_APP_MSME_INSERT_BASIC_INFO (creates the unit's MsmeCertifications row at status 1), the
///   answers to the Admin's fields (Admin → App Forms, filtered to the unit's level and NIC sector) in V4AppFormValues;
///   photos in <c>Photos/{ZedId}/{Level}/SiteExteriorPhotos</c> and <c>.../BasicInfo</c>;</item>
/// <item>documents: one PDF, or photos turned into one, per evidence of the unit's questionnaire
///   (<c>.../Evidences/{EvidenceId}.pdf</c>), SP_APP_MSME_INSERT_EVIDENCE;</item>
/// <item>final submit: SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT, the photo check of SP_ASSESSMENT_CHECK_NC_PHOTO_AVAILABILITY,
///   SP_APP_MSME_FINAL_SUBMIT, SP_V4_AUTO_ALLOT_AGENCY (migration 0031) and the confirmation mail.</item>
/// </list>
/// Everything is open only while the level is paid and not final-submitted; the ZED ID comes from the sign-in cookie.
/// </summary>
[Route("api/msme/entry")]
public sealed partial class MsmeEntryController(
    ISqlExecutor db,
    AppForms forms,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    IConfiguration config,
    ILogger<MsmeEntryController> log) : MsmeApiController
{
    public const string NotOpen = "This certification is not open for entering details: it is not paid for, or it has already been submitted.";
    public const string SaveBasicInfoFirst = "Please save the basic information first.";
    public const string GenericError = "An error has occurred, please try again later.";

    internal const string ProductsSql =
        "SELECT ProductName, Exported, ProductPhoto, ProductDescriptionPhoto FROM dbo.MsmeProducts " +
        "WHERE ZedId = @ZedId AND Certification = @Level AND ISNULL(NcCount, 0) = 0 ORDER BY Id;";

    internal const string RawMaterialsSql =
        "SELECT RawMaterialName, Percentage, CountryName FROM dbo.MsmeRawMaterials " +
        "WHERE ZedId = @ZedId AND Certification = @Level AND ISNULL(NcCount, 0) = 0 ORDER BY Id;";

    internal const string SitePhotosSql =
        "SELECT PhotoId, PhotoExtension FROM dbo.MsmePhotos WHERE ZedId = @ZedId AND Certification = @Level " +
        "AND PhotoType = 'SiteExteriorPhotos' AND ISNULL(NcCount, 0) = 0 ORDER BY Id;";

    internal const string AnswersSql =
        "SELECT AuditsConducted, DomesticCustomers, InternationalCustomers, RawMaterialImported, OutsourcedProcesses, EnergySources, " +
        "ManufacturingCapacityUnits, ManufacturingCapacityValue, MonthlyUtilizationUnits, MonthlyUtilizationValue " +
        "FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Level;";

    internal const string SyncedSql =
        "SELECT EvidenceId FROM dbo.MsmeEvidences WHERE ZedId = @ZedId AND SectionType = @Level AND ISNULL(NcCount, 0) = 0 AND SyncedDate IS NOT NULL;";

    internal const string EvidenceSql =
        "SELECT TOP 1 EvidenceId FROM dbo.MsmeEvidences WHERE ZedId = @ZedId AND SectionType = @Level AND EvidenceId = @EvidenceId AND ISNULL(NcCount, 0) = 0;";

    public sealed record ProductRow(string? ProductName, string? Exported, string? ProductPhoto, string? ProductDescriptionPhoto);
    public sealed record RawMaterialRow(string? RawMaterialName, string? Percentage, string? CountryName);
    public sealed record PhotoRow(string? PhotoId, string? PhotoExtension);
    public sealed record AnswersRow(string? AuditsConducted, string? DomesticCustomers, string? InternationalCustomers, string? RawMaterialImported,
        string? OutsourcedProcesses, string? EnergySources, string? ManufacturingCapacityUnits, string? ManufacturingCapacityValue,
        string? MonthlyUtilizationUnits, string? MonthlyUtilizationValue);
    public sealed record EvidenceIdRow(int EvidenceId);

    // ---------- Reading ----------

    /// <summary>GET api/msme/entry/{certification}: the form, what is saved, the questionnaire and where the unit stands.</summary>
    [HttpGet("{certification}")]
    public async Task<ActionResult<EntryState>> Get(string certification, CancellationToken ct)
    {
        if (!MsmeEntry.TryLevel(certification, out var level)) return NotFound();
        var stage = await StageAsync(level, ct);
        if (!stage.Paid) return Problem(title: "This certification has not been paid for.", statusCode: StatusCodes.Status404NotFound);

        var form = await FormAsync(level, ct);
        var key = new { ZedId, Level = level };
        var answers = (await db.QuerySqlAsync<AnswersRow>(AnswersSql, key, ct)).FirstOrDefault();
        var products = await db.QuerySqlAsync<ProductRow>(ProductsSql, key, ct);
        var raw = await db.QuerySqlAsync<RawMaterialRow>(RawMaterialsSql, key, ct);
        var site = await db.QuerySqlAsync<PhotoRow>(SitePhotosSql, key, ct);
        var custom = (await forms.Store.ValuesAsync(ZedId, level, ct))
            .Where(v => string.Equals(v.FormKey, AppFormCatalogue.MsmeBasicInfo, StringComparison.OrdinalIgnoreCase))
            .GroupBy(v => v.FieldKey, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Last().Value, StringComparer.OrdinalIgnoreCase);

        var saved = new EntrySaved(
            Answers(answers),
            products.Select(p => new EntryProduct(p.ProductName, p.Exported,
                File(level, MsmeEntry.BasicInfoFolder, p.ProductPhoto), File(level, MsmeEntry.BasicInfoFolder, p.ProductDescriptionPhoto))).ToList(),
            raw.Select(m => new EntryRawMaterial(m.RawMaterialName, m.Percentage, m.CountryName)).ToList(),
            site.Select(p => File(level, MsmeEntry.SiteExteriorFolder, $"{p.PhotoId}.{(p.PhotoExtension == "pdf" ? "pdf" : "jpg")}"))
                .OfType<EntryFile>().ToList(),
            custom);

        var synced = (await db.QuerySqlAsync<EvidenceIdRow>(SyncedSql, key, ct)).Select(r => r.EvidenceId).ToHashSet();
        var sections = await SectionsAsync(level, synced, ct);
        var nc = stage.NcOpen ? await NcAsync(level, stage.NcCount, ct) : null;
        return new EntryState(level, stage.Paid, stage.Editable, stage.Submitted, stage.CertificationStatus, answers is not null,
            form.ToAppJson(), saved, sections, nc);
    }

    /// <summary>GET api/msme/entry/{certification}/files/{folder}/{name}: one of the unit's own files of this level.</summary>
    [HttpGet("{certification}/files/{folder}/{name}")]
    public IActionResult Files(string certification, string folder, string name)
    {
        if (!MsmeEntry.TryLevel(certification, out var level) || !MsmeEntry.Folders.Contains(folder)) return NotFound();
        var full = FullPath(level, folder, name);
        if (full is null || !System.IO.File.Exists(full)) return NotFound();
        return Schemes.SchemeUploads.Serve(this, full);
    }

    // ---------- Basic information ----------

    /// <summary>
    /// POST api/msme/entry/{certification}/basic-info (multipart): <c>data</c> (JSON, <see cref="EntryBasicInfoRequest"/>) and
    /// the new photos, each under the form name its <see cref="EntryPhotoRef.Upload"/> gives. Saved photos are sent by id.
    /// </summary>
    [HttpPost("{certification}/basic-info")]
    [MsmeEditAudit("Web: basic information saved")]
    [RequestSizeLimit(60 * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = 60 * 1024 * 1024)]
    public async Task<ActionResult<EntryMessage>> SaveBasicInfo(string certification, [FromForm] string? data, CancellationToken ct)
    {
        if (!MsmeEntry.TryLevel(certification, out var level)) return NotFound();
        if (!(await StageAsync(level, ct)).Editable) return this.Problem400(NotOpen);

        EntryBasicInfoRequest? req;
        try
        {
            req = string.IsNullOrWhiteSpace(data) ? null : JsonSerializer.Deserialize<EntryBasicInfoRequest>(data, JsonSerializerOptions.Web);
        }
        catch (JsonException)
        {
            req = null;
        }
        if (req is null) return this.Problem400("The details could not be read. Please try again.");

        var form = await FormAsync(level, ct);
        var latitude = MsmeEntry.Coordinate(req.Latitude, 90);
        var longitude = MsmeEntry.Coordinate(req.Longitude, 180);
        var files = Request.HasFormContentType ? Request.Form.Files : null;
        var pending = new List<(string Folder, string Name, byte[] Bytes)>();
        var photoCount = 0;

        // Photos: a saved one by id (its file must be in the unit's folder), or a new upload.
        async Task<(string? Id, bool IsPdf, string? Error)> PhotoAsync(EntryPhotoRef? p, string folder, bool pdfAllowed, string label)
        {
            if (p is null || (string.IsNullOrWhiteSpace(p.Id) && string.IsNullOrWhiteSpace(p.Upload))) return (null, false, null);
            if (!string.IsNullOrWhiteSpace(p.Upload))
            {
                var file = files?.GetFile(p.Upload);
                if (file is null) return (null, false, $"{label}: the file was not received. Please choose it again.");
                var (bytes, isPdf, error) = await ReadUploadAsync(file, pdfAllowed, ct);
                if (error is not null) return (null, false, $"{label}: {error}");
                var id = MsmeEntry.NewPhotoId(ZedId, ++photoCount);
                pending.Add((folder, id + (isPdf ? ".pdf" : ".jpg"), bytes!));
                return (id, isPdf, null);
            }
            if (!MsmeEntry.IsPhotoId(p.Id, ZedId)) return (null, false, $"{label}: please choose the file again.");
            foreach (var ext in pdfAllowed ? new[] { ".jpg", ".pdf" } : [".jpg"])
                if (FullPath(level, folder, p.Id + ext) is { } full && System.IO.File.Exists(full)) return (p.Id, ext == ".pdf", null);
            return (null, false, $"{label}: the saved file was not found. Please choose it again.");
        }

        string? Shown(string key) => form.Find(key) is { Active: true } ? key : null;
        string? Answer(string key) =>
            Shown(key) is null || req.Answers is null || !req.Answers.TryGetValue(key, out var v) ? null
            : v.ValueKind switch { JsonValueKind.String => v.GetString()?.Trim(), JsonValueKind.Number => v.GetRawText(), _ => null } is { Length: > 0 } s ? s : null;

        // Site exterior photos.
        var sitePhotos = PhotoTable();
        var siteIds = new List<string?>();
        foreach (var p in (req.SiteExteriorPhotos ?? []).Take(MsmeEntry.MaxSitePhotos + 1))
        {
            if (siteIds.Count == MsmeEntry.MaxSitePhotos) return this.Problem400($"Please add at most {MsmeEntry.MaxSitePhotos} site exterior photos.");
            var (id, _, error) = await PhotoAsync(p, MsmeEntry.SiteExteriorFolder, false, "Site exterior photo");
            if (error is not null) return this.Problem400(error);
            if (id is null) continue;
            siteIds.Add(id);
            sitePhotos.Rows.Add(id, MsmeEntry.SiteExteriorFolder, MsmeEntry.TimeStamp(), latitude, longitude, "jpg");
        }

        // Products.
        var products = Table("ProductName", "Exported", "ProductPhoto", "ProductDescriptionPhoto");
        var productPhotos = PhotoTable();
        var descriptionPhotos = PhotoTable();
        var productAnswers = new List<(string? Name, string? Exported, string? Photo, string? Description)>();
        var productInputs = Shown("productDetailsList") is null ? [] : (req.Products ?? []).Where(p => p is not null).ToList();
        if (productInputs.Count > MsmeEntry.MaxProducts) return this.Problem400($"Please add at most {MsmeEntry.MaxProducts} products.");
        foreach (var p in productInputs)
        {
            var name = Text(p!.ProductName, 200);
            var exported = YesNo(p.Exported);
            var (photo, _, e1) = await PhotoAsync(p.ProductPhoto, MsmeEntry.BasicInfoFolder, false, $"Product photo of {name ?? "a product"}");
            if (e1 is not null) return this.Problem400(e1);
            var (description, descriptionPdf, e2) = await PhotoAsync(p.ProductDescriptionPhoto, MsmeEntry.BasicInfoFolder, true,
                $"Product label/description of {name ?? "a product"}");
            if (e2 is not null) return this.Problem400(e2);
            productAnswers.Add((name, exported, photo, description));
            if (photo is not null) productPhotos.Rows.Add(photo, "ProductPhoto", MsmeEntry.TimeStamp(), latitude, longitude, "jpg");
            if (description is not null)
                descriptionPhotos.Rows.Add(description, "ProductDescriptionPhoto", MsmeEntry.TimeStamp(), latitude, longitude, descriptionPdf ? "pdf" : "jpg");
            products.Rows.Add(name, exported, photo is null ? null : photo + ".jpg", description is null ? null : description + (descriptionPdf ? ".pdf" : ".jpg"));
        }

        // Raw materials (only when imported).
        var rawImported = YesNo(Answer("rawMaterialImported"));
        var rawMaterials = Table("Name", "Percentage", "CountryName");
        var rawAnswers = new List<(string? Name, string? Percentage, string? Country)>();
        if (rawImported == "Yes" && Shown("rawMaterialsList") is not null)
        {
            var inputs = (req.RawMaterials ?? []).Where(m => m is not null).ToList();
            if (inputs.Count > MsmeEntry.MaxRawMaterials) return this.Problem400($"Please add at most {MsmeEntry.MaxRawMaterials} raw materials.");
            foreach (var m in inputs)
            {
                var percentage = m!.RawMaterialPercentage?.Trim();
                if (!string.IsNullOrEmpty(percentage) && !(decimal.TryParse(percentage, System.Globalization.NumberStyles.Number,
                        System.Globalization.CultureInfo.InvariantCulture, out var pc) && pc is >= 0 and <= 100))
                    return this.Problem400("The % of raw material imported must be a number from 0 to 100.");
                var entry = (Text(m.RawMaterialName, 200), string.IsNullOrEmpty(percentage) ? null : percentage, Text(m.CountryName, 2000));
                rawAnswers.Add(entry);
                rawMaterials.Rows.Add(entry.Item1, entry.Item2, entry.Item3);
            }
        }

        // The single answers, checked against the field's own rules.
        var single = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (var k in new[] { "auditsConducted", "rawMaterialImported" }) single[k] = YesNo(Answer(k));
        foreach (var k in new[] { "domesticCustomers", "internationalCustomers", "outsourcedProcesses" }) single[k] = Text(Answer(k), 2000);
        foreach (var k in new[] { "monthlyManufacturingCapacityUnits", "monthlyUtilizationUnits" })
        {
            var v = Answer(k);
            if (v is not null && form.Find(k)?.Options is { Count: > 0 } options && !options.Contains(v)) return this.Problem400($"{form.Find(k)!.Label}: please choose from the list.");
            single[k] = v is null ? null : Text(v, 50);
        }
        foreach (var k in new[] { "monthlyManufacturingCapacityValue", "monthlyUtilizationValue" })
        {
            var v = Answer(k);
            if (v is not null && (v.Length > 20 || !decimal.TryParse(v, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out _)))
                return this.Problem400($"{form.Find(k)?.Label ?? "Value"}: please enter a number (20 characters at most).");
            single[k] = v;
        }
        if (!productAnswers.Any(p => p.Exported == "Yes")) single["internationalCustomers"] = null;
        var energy = new List<string>();
        if (Shown("energySources") is not null && req.Answers?.TryGetValue("energySources", out var en) == true && en.ValueKind == JsonValueKind.Array)
        {
            var allowed = form.Find("energySources")?.Options;
            foreach (var item in en.EnumerateArray())
            {
                var v = item.ValueKind == JsonValueKind.String ? item.GetString()?.Trim() : null;
                if (string.IsNullOrEmpty(v)) continue;
                if (allowed is { Count: > 0 } && !allowed.Contains(v)) return this.Problem400($"\"{v}\" is not one of the energy sources.");
                if (!energy.Contains(v)) energy.Add(v);
            }
        }

        // Required fields and the Admin's own fields (Admin → App Forms), as the app's server checks them.
        var standard = StandardAnswers(single, energy, productAnswers, rawAnswers, siteIds);
        var check = AppFormRules.Check(form, req.CustomFields, standard, strict: true);
        if (check.Error is { } formError)
            return this.Problem400(req.FormVersion is { } v && v != form.Version ? formError + " (The form was changed; please reload the page.)" : formError);

        // Files first: the procedure only records their names.
        foreach (var (folder, name, bytes) in pending)
        {
            var full = FullPath(level, folder, name);
            if (full is null) return this.Problem400(GenericError);
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            await System.IO.File.WriteAllBytesAsync(full, bytes, ct);
        }

        var args = new DynamicParameters();
        args.Add("RefId", DateTime.Now.ToString("yyyyMMddHHmmss", System.Globalization.CultureInfo.InvariantCulture));
        args.Add("ZedId", ZedId);
        args.Add("CertificationType", level);
        args.Add("AuditsConducted", single["auditsConducted"]);
        args.Add("DomesticCustomers", single["domesticCustomers"]);
        args.Add("InternationalCustomers", single["internationalCustomers"]);
        args.Add("RawMaterialImported", rawImported);
        args.Add("OutsourcedProcesses", single["outsourcedProcesses"]);
        args.Add("EnergySources", string.Join(",", energy));
        args.Add("ManufacturingCapacityUnits", single["monthlyManufacturingCapacityUnits"]);
        args.Add("ManufacturingCapacityValue", single["monthlyManufacturingCapacityValue"]);
        args.Add("MonthlyUtilizationUnits", single["monthlyUtilizationUnits"]);
        args.Add("MonthlyUtilizationValue", single["monthlyUtilizationValue"]);
        AddTable(args, "ProductPhotos", productPhotos, "DynamicPhotoList2");
        AddTable(args, "ProductDescriptionPhotos", descriptionPhotos, "DynamicPhotoList2");
        AddTable(args, "SiteExteriorPhotos", sitePhotos, "DynamicPhotoList2");
        AddTable(args, "ProductList", products, "ProductDetails2");
        AddTable(args, "RawMaterialList", rawMaterials, "RawMaterial");
        try
        {
            await db.ExecuteProcAsync("SP_APP_MSME_INSERT_BASIC_INFO", args, ct);
            if (check.CustomValues.Count > 0)
                await forms.Store.SaveValuesAsync(form.Spec.Key, ZedId, level, check.CustomValues, ZedId, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Web basic information of {ZedId} {Level} not saved", ZedId, level);
            return this.Problem400(GenericError);
        }
        log.LogInformation("Web basic information saved for {ZedId} {Level}: {Products} products, {Files} new files", ZedId, level, products.Rows.Count, pending.Count);
        return new EntryMessage("Basic information saved.");
    }

    // ---------- Documents ----------

    /// <summary>
    /// POST api/msme/entry/{certification}/evidences/{evidenceId} (multipart <c>files</c>): one PDF, or up to
    /// <see cref="MsmeEntry.MaxEvidencePhotos"/> photos made into one PDF. Replaces what was uploaded for the evidence.
    /// </summary>
    [HttpPost("{certification}/evidences/{evidenceId:int}")]
    [MsmeEditAudit("Web: document uploaded")]
    [RequestSizeLimit(55 * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = 55 * 1024 * 1024)]
    public async Task<ActionResult<EntryMessage>> UploadEvidence(string certification, int evidenceId, List<IFormFile>? files, CancellationToken ct)
    {
        if (!MsmeEntry.TryLevel(certification, out var level)) return NotFound();
        var stage = await StageAsync(level, ct);
        if (!stage.Editable) return this.Problem400(NotOpen);
        if (!stage.HasRow) return this.Problem400(SaveBasicInfoFirst);
        if ((await db.QuerySqlAsync<EvidenceIdRow>(EvidenceSql, new { ZedId, Level = level, EvidenceId = evidenceId }, ct)).Count == 0) return NotFound();

        var list = (files ?? []).Where(f => f is { Length: > 0 }).ToList();
        if (list.Count == 0) return this.Problem400("Please choose a PDF or photos.");
        if (list.Count > MsmeEntry.MaxEvidencePhotos) return this.Problem400($"Please choose at most {MsmeEntry.MaxEvidencePhotos} photos, or one PDF.");

        var read = new List<(byte[] Bytes, bool IsPdf)>();
        foreach (var f in list)
        {
            var (bytes, isPdf, error) = await ReadUploadAsync(f, pdfAllowed: true, ct);
            if (error is not null) return this.Problem400($"{f.FileName}: {error}");
            read.Add((bytes!, isPdf));
        }
        if (read.Any(r => r.IsPdf) && read.Count > 1) return this.Problem400("Please choose either one PDF, or photos.");

        var pdfName = $"{evidenceId}.pdf";
        var pdfPath = FullPath(level, MsmeEntry.EvidencesFolder, pdfName);
        if (pdfPath is null) return this.Problem400(GenericError);
        var table = PhotoTable();
        var written = new List<(string Path, byte[] Bytes)>();
        if (read[0].IsPdf)
        {
            var id = MsmeEntry.NewPhotoId(ZedId, 1);
            written.Add((FullPath(level, MsmeEntry.EvidencesFolder, id + ".pdf")!, read[0].Bytes));
            written.Add((pdfPath, read[0].Bytes));
            table.Rows.Add(id, MsmeEntry.EvidencesFolder, MsmeEntry.TimeStamp(), null, null, "pdf");
        }
        else
        {
            var n = 0;
            foreach (var (bytes, _) in read)
            {
                var id = MsmeEntry.NewPhotoId(ZedId, ++n);
                written.Add((FullPath(level, MsmeEntry.EvidencesFolder, id + ".jpg")!, bytes));
                table.Rows.Add(id, MsmeEntry.EvidencesFolder, MsmeEntry.TimeStamp(), null, null, "jpg");
            }
            var pdf = EvidenceImages.ImagesToPdf(read.Select(r => r.Bytes).ToList());
            if (pdf is null) return this.Problem400("The photos could not be read. Please choose JPG or PNG photos.");
            written.Add((pdfPath, pdf));
        }
        foreach (var (path, bytes) in written)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await System.IO.File.WriteAllBytesAsync(path, bytes, ct);
        }

        var args = new DynamicParameters();
        args.Add("EvidenceId", evidenceId.ToString(System.Globalization.CultureInfo.InvariantCulture));
        args.Add("ZedId", ZedId);
        args.Add("IsFirst", true);
        args.Add("IsLast", true);
        args.Add("RefId", DateTime.Now.ToString("yyyyMMddHHmmss", System.Globalization.CultureInfo.InvariantCulture));
        args.Add("CertificationType", level);
        AddTable(args, "PhotoList", table, "DynamicPhotoList2");
        try
        {
            await db.ExecuteProcAsync("SP_APP_MSME_INSERT_EVIDENCE", args, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Web evidence {EvidenceId} of {ZedId} {Level} not recorded", evidenceId, ZedId, level);
            return this.Problem400(GenericError);
        }
        log.LogInformation("Web evidence {EvidenceId} uploaded for {ZedId} {Level} ({Files} files)", evidenceId, ZedId, level, read.Count);
        return new EntryMessage("Document uploaded.");
    }

    // ---------- Final submit ----------

    /// <summary>
    /// POST api/msme/entry/{certification}/final-submit: the app's final submit, then ZED-X's auto-allotment and the mail.
    /// While an NC is open: the submit of the NC answers (the procedures' NC branch), without allotment.
    /// </summary>
    [HttpPost("{certification}/final-submit")]
    [MsmeEditAudit("Web: final submit")]
    public async Task<ActionResult<EntryMessage>> FinalSubmit(string certification, CancellationToken ct)
    {
        if (!MsmeEntry.TryLevel(certification, out var level)) return NotFound();
        var stage = await StageAsync(level, ct);
        if (!stage.Editable && !stage.NcOpen) return this.Problem400(NotOpen);
        if (!stage.HasRow) return this.Problem400(SaveBasicInfoFirst);
        var args = new { CertificationType = level, ZedId };

        try
        {
            var allow = (await db.QueryProcMultipleAsync("SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT", args, ct))[0].FirstOrDefault();
            if (allow is null) return this.Problem400(GenericError);
            if (allow.Text("AllowFinalSubmit") == "0")
                return this.Problem400(allow.Text("ErrorMessage") is { Length: > 0 } m ? m : GenericError);

            // The procedure lists the files the assessor will open; only the first non-empty list is checked, as in the app.
            var photos = await db.QueryProcMultipleAsync("SP_ASSESSMENT_CHECK_NC_PHOTO_AVAILABILITY", args, ct);
            foreach (var (index, message) in new[] { (0, "Site exterior photos are missing. Please add them again."),
                         (1, "A product photo is missing. Please add it again."), (2, "A document is missing. Please upload it again.") })
            {
                if (photos[index].Count == 0) continue;
                if (photos[index].Any(r => !LegacyFileExists(level, r.Values.FirstOrDefault()?.ToString()))) return this.Problem400(message);
                break;
            }

            await db.ExecuteProcAsync("SP_APP_MSME_FINAL_SUBMIT", args, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Web final submit of {ZedId} {Level} failed", ZedId, level);
            return this.Problem400(GenericError);
        }
        log.LogInformation("Web final submit for {ZedId} {Level} (NC {Nc})", ZedId, level, stage.NcCount);
        if (stage.NcOpen)
        {
            await SendSubmissionMailAsync(level, stage.NcCount, ct);
            return new EntryMessage($"Your answers to NC {stage.NcCount} are submitted. The assessor will review them.");
        }

        // SP_APP_MSME_FINAL_SUBMIT allots an agency for Bronze, Silver and Gold only; ZED-X's by the unit's kind (migration 0031).
        try
        {
            await db.ExecuteProcAsync("SP_V4_AUTO_ALLOT_AGENCY", new { ZedId, CertificationType = level }, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Auto-allotment of {ZedId} {Level} failed (is migration 0031 applied?); left for manual allotment", ZedId, level);
        }

        await SendSubmissionMailAsync(level, 0, ct);
        return new EntryMessage("Submitted. The assessment agency will review your details and documents.");
    }

    // ---------- Helpers ----------

    private async Task<MsmeEntry.Stage> StageAsync(string level, CancellationToken ct) =>
        MsmeEntry.ToStage((await db.QuerySqlAsync<MsmeEntry.StageRow>(MsmeEntry.StageSql(level), new { ZedId, Level = level }, ct)).FirstOrDefault());

    private async Task<EffectiveAppForm> FormAsync(string level, CancellationToken ct)
    {
        var unit = await AppFormUnit.ForAsync(db, ZedId, level, ct);
        return await forms.GetAsync(PortalSystem.Main, AppFormCatalogue.MsmeBasicInfo, ct, unit)
            ?? throw new InvalidOperationException("The MSME Basic Information form is not a form of the main system.");
    }

    private async Task<IReadOnlyList<EntrySection>> SectionsAsync(string level, HashSet<int> synced, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_APP_MSME_GET_QUESTIONS_BY_TYPE", new { ZedId, CertificationType = level }, ct);
        static bool Same(IDictionary<string, object?> r, string column, string value) =>
            string.Equals(r.Text(column).Trim(), value, StringComparison.OrdinalIgnoreCase);
        return sets[0].Select(s =>
        {
            var section = s.Text("SectionCode").Trim();
            return new EntrySection(section, s.Text("SectionName"), sets[1].Where(r => Same(r, "SectionCode", section)).Select(r =>
            {
                var requirement = r.Text("RequirementCode").Trim();
                return new EntryRequirement(requirement, r.Text("RequirementName"), sets[4]
                    .Where(e => Same(e, "SectionCode", section) && Same(e, "RequirementCode", requirement))
                    .Select(e =>
                    {
                        var id = int.TryParse(e.Text("Id"), out var i) ? i : 0;
                        var uploaded = synced.Contains(id);
                        // ValidationRequired = 0: the final submit needs the document (SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT).
                        var required = e.Text("ValidationRequired") is "0" or "False" or "false";
                        return new EntryEvidence(id, e.Text("EvidenceCode").Trim(), e.Text("EvidenceName"),
                            e.Text("EvidenceHelpText") is { Length: > 0 } h ? h : null, required, uploaded,
                            uploaded ? FileUrl(level, MsmeEntry.EvidencesFolder, $"{id}.pdf") : null);
                    }).ToList());
            }).ToList());
        }).ToList();
    }

    private static Dictionary<string, JsonNode?> Answers(AnswersRow? a)
    {
        var d = new Dictionary<string, JsonNode?>(StringComparer.OrdinalIgnoreCase);
        if (a is null) return d;
        d["auditsConducted"] = a.AuditsConducted;
        d["domesticCustomers"] = a.DomesticCustomers;
        d["internationalCustomers"] = a.InternationalCustomers;
        d["rawMaterialImported"] = a.RawMaterialImported;
        d["outsourcedProcesses"] = a.OutsourcedProcesses;
        d["energySources"] = new JsonArray([.. (a.EnergySources ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(x => (JsonNode)x)]);
        d["monthlyManufacturingCapacityUnits"] = a.ManufacturingCapacityUnits;
        d["monthlyManufacturingCapacityValue"] = a.ManufacturingCapacityValue;
        d["monthlyUtilizationUnits"] = a.MonthlyUtilizationUnits;
        d["monthlyUtilizationValue"] = a.MonthlyUtilizationValue;
        return d;
    }

    /// <summary>The standard answers as <see cref="AppFormRules.Check"/> reads them (same keys as the app's server).</summary>
    internal static AppFormAnswers StandardAnswers(IReadOnlyDictionary<string, string?> single, IReadOnlyList<string> energy,
        IReadOnlyList<(string? Name, string? Exported, string? Photo, string? Description)> products,
        IReadOnlyList<(string? Name, string? Percentage, string? Country)> rawMaterials, IReadOnlyList<string?> sitePhotos)
    {
        const char c = AppFormCatalogue.ColumnSeparator;
        var a = new AppFormAnswers();
        foreach (var (k, v) in single) a[k] = AppFormAnswers.One(v);
        a["energySources"] = energy.Cast<string?>().ToList();
        a["siteExteriorPhotos"] = sitePhotos;
        a["productDetailsList"] = products.Select(_ => (string?)"row").ToList();
        a[$"productDetailsList{c}productName"] = products.Select(p => p.Name).ToList();
        a[$"productDetailsList{c}exported"] = products.Select(p => p.Exported).ToList();
        a[$"productDetailsList{c}productPhoto"] = products.Select(p => p.Photo).ToList();
        a[$"productDetailsList{c}productDescriptionPhoto"] = products.Select(p => p.Description).ToList();
        a["rawMaterialsList"] = rawMaterials.Select(_ => (string?)"row").ToList();
        a[$"rawMaterialsList{c}rawMaterialName"] = rawMaterials.Select(m => m.Name).ToList();
        a[$"rawMaterialsList{c}rawMaterialPercentage"] = rawMaterials.Select(m => m.Percentage).ToList();
        a[$"rawMaterialsList{c}countryName"] = rawMaterials.Select(m => m.Country).ToList();
        return a;
    }

    /// <summary>An upload as it is stored: a PDF as sent, a JPEG/PNG photo as the app stores photos (JPEG, 1080 px).</summary>
    private static async Task<(byte[]? Bytes, bool IsPdf, string? Error)> ReadUploadAsync(IFormFile file, bool pdfAllowed, CancellationToken ct)
    {
        const string sizeText = "5 MB";
        if (file.Length > MsmeEntry.MaxFileBytes) return (null, false, $"the file is larger than {sizeText}.");
        var kind = await Schemes.SchemeUploads.KindAsync(file, ct);
        if (kind is null) return (null, false, pdfAllowed ? $"please choose a PDF, JPG or PNG file (up to {sizeText})." : $"please choose a JPG or PNG photo (up to {sizeText}).");
        if (kind == ".pdf" && !pdfAllowed) return (null, false, "please choose a JPG or PNG photo.");
        using var ms = new MemoryStream();
        await file.CopyToAsync(ms, ct);
        if (kind == ".pdf") return (ms.ToArray(), true, null);
        var jpeg = EvidenceImages.ToAppJpeg(ms.ToArray());
        return jpeg is null ? (null, false, "the photo could not be read.") : (jpeg, false, null);
    }

    private string? FullPath(string level, string folder, string? name)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Contains('/') || name.Contains('\\')) return null;
        return MsmeFilePaths.Normalise(MsmeEntry.Relative(ZedId, level, folder, name)) is { } relative
            ? MsmeFilePaths.ResolveAppFile(MsmeEntry.StorageRoot(env, portal, config), relative) : null;
    }

    private string FileUrl(string level, string folder, string name) =>
        $"/api/msme/entry/{Uri.EscapeDataString(level)}/files/{folder}/{Uri.EscapeDataString(name)}";

    /// <summary>A saved file of the form (null when the name is empty or the file is gone).</summary>
    private EntryFile? File(string level, string folder, string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        var full = FullPath(level, folder, name.Trim());
        if (full is null || !System.IO.File.Exists(full)) return null;
        var id = Path.GetFileNameWithoutExtension(name.Trim());
        return new EntryFile(id, FileUrl(level, folder, name.Trim()), name.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// SP_ASSESSMENT_CHECK_NC_PHOTO_AVAILABILITY returns the old server's absolute paths (E:\Publish\...\Photos/{ZedId}/...).
    /// The part from "Photos/" on is looked up in the unit's folders.
    /// </summary>
    private bool LegacyFileExists(string level, string? legacyPath)
    {
        if (string.IsNullOrWhiteSpace(legacyPath)) return false;
        var normalized = legacyPath.Replace('\\', '/');
        var at = normalized.IndexOf("Photos/", StringComparison.OrdinalIgnoreCase);
        if (at < 0) return false;
        var full = MsmeFilePaths.Normalise("mobileapi/" + normalized[at..]) is { } relative
            ? MsmeFilePaths.ResolveAppFile(MsmeEntry.StorageRoot(env, portal, config), relative) : null;
        if (full is null) return false;
        // The procedure names every file .jpg; a document sent as a PDF is {PhotoId}.pdf.
        return System.IO.File.Exists(full) ||
               (full.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase) && System.IO.File.Exists(full[..^4] + ".pdf"));
    }

    private async Task SendSubmissionMailAsync(string level, int ncCount, CancellationToken ct)
    {
        try
        {
            var row = (await db.QueryProcMultipleAsync("SP_EMAIL_GET_DETAILS", new { ZedId, Certification = level }, ct))[0].FirstOrDefault();
            if (row is null || string.IsNullOrWhiteSpace(row.Text("EmailId"))) return;
            var services = HttpContext.RequestServices;
            // Only these columns are read: the procedure also returns assessor and MSME passwords.
            var html = await services.GetRequiredService<IHtmlTemplateRenderer>().RenderAsync<MsmeWebSubmissionEmail>(new Dictionary<string, object?>
            {
                [nameof(MsmeWebSubmissionEmail.EnterpriseName)] = row.Text("EnterpriseName"),
                [nameof(MsmeWebSubmissionEmail.ZedId)] = ZedId,
                [nameof(MsmeWebSubmissionEmail.Certification)] = level == "ZEDX" ? "ZED-X" : level,
                [nameof(MsmeWebSubmissionEmail.NcCount)] = ncCount,
                [nameof(MsmeWebSubmissionEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
            });
            var office = await services.GetRequiredService<EmailAddresses>().GetAsync(EmailAddresses.RegistrationCc, ct);
            var subject = ncCount > 0
                ? "Submission of response to Non-conformance(s) raised under “MSME Sustainable (ZED) Certification” Scheme  - " + ZedId
                : "ZED Basic information and Document Upload Confirmation – " + ZedId;
            await services.GetRequiredService<IEmailSender>().SendAsync(new EmailMessage(row.Text("EmailId").Trim(), subject, html, EmailProfiles.DocumentUpload,
                Bcc: string.IsNullOrWhiteSpace(office) ? null : [office]), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Submission mail for {ZedId} {Level} not sent", ZedId, level);
        }
    }

    /// <summary>DynamicPhotoList2 (PhotoId, Name, TimeStamp, Latitude, Longitude, PhotoType).</summary>
    private static DataTable PhotoTable() => Table("PhotoId", "Name", "TimeStamp", "Latitude", "Longitude", "PhotoType");

    private static DataTable Table(params string[] columns)
    {
        var t = new DataTable();
        foreach (var c in columns) t.Columns.Add(c, typeof(string));
        return t;
    }

    /// <summary>Adds a table parameter only when it has rows, as the app's server does.</summary>
    private static void AddTable(DynamicParameters p, string name, DataTable table, string typeName)
    {
        if (table.Rows.Count > 0) p.Add(name, table.AsTableValuedParameter(typeName));
    }

    private static string? YesNo(string? v) =>
        string.Equals(v?.Trim(), "Yes", StringComparison.OrdinalIgnoreCase) ? "Yes" : string.Equals(v?.Trim(), "No", StringComparison.OrdinalIgnoreCase) ? "No" : null;

    private static string? Text(string? v, int max)
    {
        var s = v?.Trim();
        if (string.IsNullOrEmpty(s)) return null;
        s = new string(s.Where(ch => !char.IsControl(ch) || ch is '\n' or '\r').ToArray());
        return s.Length <= max ? s : s[..max];
    }
}
