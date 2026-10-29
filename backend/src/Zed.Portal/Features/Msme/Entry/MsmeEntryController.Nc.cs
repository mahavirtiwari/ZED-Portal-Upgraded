using System.Data.Common;
using System.Globalization;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Security;

namespace Zed.Portal.Features.Msme.Entry;

/// <summary>
/// Answers to an open non-conformance (NC) on the web, as the app's Msme/GetNcDetailsByType, SubmitNcRequirement,
/// SubmitNcProduct and SubmitSiteExteriorInfo: the documents of each requirement the assessor did not accept, new product
/// photos, new site exterior photos, each with the unit's remarks. The NC is then submitted with the final submit
/// (<see cref="FinalSubmit"/>). ZED-X is a site level: its NC details come from Gold's branch of the procedures
/// (database fix main/14_zedx_levels).
/// </summary>
public sealed partial class MsmeEntryController
{
    public const string NcNotOpen = "There is no open non-conformance to answer.";
    public const int MaxRemarks = 2000;

    internal const string NcEvidencesSql =
        "SELECT RequirementId, EvidenceId, CAST(CASE WHEN SyncedDate IS NULL THEN 0 ELSE 1 END AS bit) AS Synced FROM dbo.MsmeEvidences " +
        "WHERE ZedId = @ZedId AND SectionType = @Level AND NcCount = @Nc;";

    internal const string NcProductsAnsweredSql =
        "SELECT Id FROM dbo.SaProducts WHERE ZedId = @ZedId AND Certification = @Level AND NcCount = @Nc AND MsmeUpdatedDate IS NOT NULL;";

    internal const string NcSiteAnsweredSql =
        "SELECT COUNT(*) AS Photos FROM dbo.SaPhotos WHERE ZedId = @ZedId AND Certification = @Level AND NcCount = @Nc AND PhotoType = 'SiteExteriorPhotos';";

    public sealed record NcEvidenceRow(int? RequirementId, int? EvidenceId, bool Synced);
    public sealed record IdRow(int Id);
    public sealed record CountRow(int Photos);

    private Task<ResultSets> NcDetailsAsync(string level, int nc, CancellationToken ct) =>
        db.QueryProcMultipleAsync("SP_APP_MSME_GET_NC_DETAILS_BY_TYPE", new { ZedId, NcCount = nc, CertificationType = level }, ct);

    /// <summary>The open NC as the page shows it.</summary>
    private async Task<EntryNc> NcAsync(string level, int nc, CancellationToken ct)
    {
        var sets = await NcDetailsAsync(level, nc, ct);
        var key = new { ZedId, Level = level, Nc = nc };
        var evidences = await db.QuerySqlAsync<NcEvidenceRow>(NcEvidencesSql, key, ct);
        var products = (await db.QuerySqlAsync<IdRow>(NcProductsAnsweredSql, key, ct)).Select(r => r.Id).ToHashSet();
        var sitePhotos = (await db.QuerySqlAsync<CountRow>(NcSiteAnsweredSql, key, ct)).FirstOrDefault()?.Photos ?? 0;

        EntryNcSite? site = sets[0].Count == 0 ? null
            : new EntryNcSite(sets[0].Select(r => r.Text("AssessorRemarks")).FirstOrDefault(t => t.Length > 0),
                sets[0].Select(r => r.Text("PhotoPath")).Where(p => p.Length > 0).ToList(), sitePhotos > 0);

        var productList = sets[1].Select(r =>
        {
            var id = int.TryParse(r.Text("Id"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var i) ? i : 0;
            return new EntryNcProduct(id, r.Text("ProductName"), r.Text("AssessorRemarks") is { Length: > 0 } a ? a : null, products.Contains(id));
        }).Where(p => p.Id > 0).ToList();

        static bool Same(IDictionary<string, object?> r, string column, string value) =>
            string.Equals(r.Text(column).Trim(), value, StringComparison.OrdinalIgnoreCase);
        var sections = sets[2].Select(s =>
        {
            var section = s.Text("SectionCode").Trim();
            return new EntryNcSection(section, s.Text("SectionName"), sets[3].Where(r => Same(r, "SectionCode", section)).Select(r =>
            {
                var id = int.TryParse(r.Text("Id"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var i) ? i : 0;
                var evidence = evidences.FirstOrDefault(e => e.RequirementId == id);
                var answered = evidence is { Synced: true };
                return new EntryNcRequirement(id, r.Text("RequirementCode").Trim(), r.Text("RequirementName"),
                    r.Text("AssessorRemarks") is { Length: > 0 } a ? a : null, answered,
                    answered && evidence!.EvidenceId is { } e ? FileUrl(level, MsmeEntry.EvidencesFolder, $"{e}.pdf") : null);
            }).Where(r => r.Id > 0).ToList());
        }).ToList();
        return new EntryNc(nc, site, productList, sections);
    }

    private async Task<(MsmeEntry.Stage Stage, ActionResult? Error)> NcStageAsync(string certification, CancellationToken ct)
    {
        if (!MsmeEntry.TryLevel(certification, out var level)) return (default!, NotFound());
        var stage = await StageAsync(level, ct);
        return stage.NcOpen ? (stage, null) : (stage, this.Problem400(NcNotOpen));
    }

    private static string? Remarks(string? value) => Text(value, MaxRemarks);

    // ---------- Requirement ----------

    /// <summary>
    /// POST api/msme/entry/{certification}/nc/requirements/{requirementId} (multipart: <c>files</c>, <c>remarks</c>): the
    /// document of a requirement of the open NC (one PDF, or photos made into one), SP_APP_MSME_INSERT_REQUIREMENT.
    /// </summary>
    [HttpPost("{certification}/nc/requirements/{requirementId:int}")]
    [MsmeEditAudit("Web: NC requirement answered")]
    [RequestSizeLimit(55 * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = 55 * 1024 * 1024)]
    public async Task<ActionResult<EntryMessage>> NcRequirement(string certification, int requirementId, [FromForm] string? remarks,
        List<IFormFile>? files, CancellationToken ct)
    {
        var (stage, error) = await NcStageAsync(certification, ct);
        if (error is not null) return error;
        MsmeEntry.TryLevel(certification, out var level);

        // The requirement must be one of this NC's (its evidence row of this NC round), as SP_APP_MSME_GET_EVIDENCE_ID finds it.
        var evidence = (await db.QuerySqlAsync<NcEvidenceRow>(NcEvidencesSql, new { ZedId, Level = level, Nc = stage.NcCount }, ct))
            .FirstOrDefault(e => e.RequirementId == requirementId);
        var sets = await NcDetailsAsync(level, stage.NcCount, ct);
        var requirement = sets[3].FirstOrDefault(r => r.Text("Id") == requirementId.ToString(CultureInfo.InvariantCulture));
        if (evidence?.EvidenceId is not { } evidenceId || requirement is null) return NotFound();

        var list = (files ?? []).Where(f => f is { Length: > 0 }).ToList();
        if (list.Count == 0) return this.Problem400("Please choose a PDF or photos.");
        if (list.Count > MsmeEntry.MaxEvidencePhotos) return this.Problem400($"Please choose at most {MsmeEntry.MaxEvidencePhotos} photos, or one PDF.");
        var (table, written, problem) = await EvidenceFilesAsync(level, $"{evidenceId}.pdf", list, ct);
        if (problem is not null) return this.Problem400(problem);
        await WriteAllAsync(written, ct);

        var args = new DynamicParameters();
        args.Add("CertificationType", level);
        args.Add("ZedId", ZedId);
        args.Add("Id", requirementId.ToString(CultureInfo.InvariantCulture));
        args.Add("IsFirst", true);
        args.Add("IsLast", true);
        args.Add("Code", requirement.Text("RequirementCode").Trim());
        args.Add("MsmeRemarks", Remarks(remarks));
        AddTable(args, "PhotoList", table, "DynamicPhotoList2");
        if (await TryRunAsync("SP_APP_MSME_INSERT_REQUIREMENT", args, ct) is { } failed) return failed;
        log.LogInformation("Web NC {Nc} requirement {RequirementId} answered for {ZedId} {Level}", stage.NcCount, requirementId, ZedId, level);
        return new EntryMessage("Answer saved.");
    }

    // ---------- Product ----------

    /// <summary>
    /// POST api/msme/entry/{certification}/nc/products/{productId} (multipart: <c>productPhoto</c>, <c>descriptionPhoto</c>,
    /// <c>remarks</c>): new photos of a product of the open NC, SP_APP_MSME_INSERT_PRODUCT_INFO.
    /// </summary>
    [HttpPost("{certification}/nc/products/{productId:int}")]
    [MsmeEditAudit("Web: NC product answered")]
    [RequestSizeLimit(12 * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = 12 * 1024 * 1024)]
    public async Task<ActionResult<EntryMessage>> NcProduct(string certification, int productId, [FromForm] string? remarks,
        IFormFile? productPhoto, IFormFile? descriptionPhoto, CancellationToken ct)
    {
        var (stage, error) = await NcStageAsync(certification, ct);
        if (error is not null) return error;
        MsmeEntry.TryLevel(certification, out var level);
        var sets = await NcDetailsAsync(level, stage.NcCount, ct);
        if (!sets[1].Any(r => r.Text("Id") == productId.ToString(CultureInfo.InvariantCulture))) return NotFound();
        if (productPhoto is not { Length: > 0 } || descriptionPhoto is not { Length: > 0 })
            return this.Problem400("Please choose the product photo and the product label/description.");

        var (photo, _, e1) = await ReadUploadAsync(productPhoto, pdfAllowed: false, ct);
        if (e1 is not null) return this.Problem400($"Product photo: {e1}");
        var (label, labelPdf, e2) = await ReadUploadAsync(descriptionPhoto, pdfAllowed: true, ct);
        if (e2 is not null) return this.Problem400($"Product label/description: {e2}");

        var photoId = MsmeEntry.NewPhotoId(ZedId, 1);
        var labelId = MsmeEntry.NewPhotoId(ZedId, 2);
        var labelName = labelId + (labelPdf ? ".pdf" : ".jpg");
        await WriteAllAsync([(FullPath(level, MsmeEntry.BasicInfoFolder, photoId + ".jpg")!, photo!), (FullPath(level, MsmeEntry.BasicInfoFolder, labelName)!, label!)], ct);

        var productPhotos = PhotoTable();
        productPhotos.Rows.Add(photoId, "ProductPhoto", MsmeEntry.TimeStamp(), null, null, "jpg");
        var labelPhotos = PhotoTable();
        labelPhotos.Rows.Add(labelId, "ProductDescriptionPhoto", MsmeEntry.TimeStamp(), null, null, labelPdf ? "pdf" : "jpg");
        var args = new DynamicParameters();
        args.Add("RefId", DateTime.Now.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture));
        args.Add("ZedId", ZedId);
        args.Add("CertificationType", level);
        args.Add("ProductId", productId.ToString(CultureInfo.InvariantCulture));
        args.Add("MsmeRemarks", Remarks(remarks));
        args.Add("ProductPhoto", photoId + ".jpg");
        args.Add("ProductDescriptionPhoto", labelName);
        AddTable(args, "ProductPhotos", productPhotos, "DynamicPhotoList2");
        AddTable(args, "ProductDescriptionPhotos", labelPhotos, "DynamicPhotoList2");
        if (await TryRunAsync("SP_APP_MSME_INSERT_PRODUCT_INFO", args, ct) is { } failed) return failed;
        log.LogInformation("Web NC {Nc} product {ProductId} answered for {ZedId} {Level}", stage.NcCount, productId, ZedId, level);
        return new EntryMessage("Answer saved.");
    }

    // ---------- Site exterior ----------

    /// <summary>
    /// POST api/msme/entry/{certification}/nc/site-exterior (multipart: <c>files</c>, up to 2 photos, <c>remarks</c>):
    /// new site exterior photos for the open NC, SP_APP_MSME_INSERT_SITE_EXTERIOR.
    /// </summary>
    [HttpPost("{certification}/nc/site-exterior")]
    [MsmeEditAudit("Web: NC site exterior answered")]
    [RequestSizeLimit(12 * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = 12 * 1024 * 1024)]
    public async Task<ActionResult<EntryMessage>> NcSiteExterior(string certification, [FromForm] string? remarks, List<IFormFile>? files,
        [FromForm] string? latitude, [FromForm] string? longitude, CancellationToken ct)
    {
        var (stage, error) = await NcStageAsync(certification, ct);
        if (error is not null) return error;
        MsmeEntry.TryLevel(certification, out var level);
        if ((await NcDetailsAsync(level, stage.NcCount, ct))[0].Count == 0) return this.Problem400("No NC was raised on the site exterior photos.");

        var list = (files ?? []).Where(f => f is { Length: > 0 }).ToList();
        if (list.Count is 0 or > MsmeEntry.MaxSitePhotos) return this.Problem400($"Please choose 1 or {MsmeEntry.MaxSitePhotos} site exterior photos.");
        var table = PhotoTable();
        var written = new List<(string Path, byte[] Bytes)>();
        var n = 0;
        foreach (var f in list)
        {
            var (bytes, _, problem) = await ReadUploadAsync(f, pdfAllowed: false, ct);
            if (problem is not null) return this.Problem400($"{f.FileName}: {problem}");
            var id = MsmeEntry.NewPhotoId(ZedId, ++n);
            written.Add((FullPath(level, MsmeEntry.SiteExteriorFolder, id + ".jpg")!, bytes!));
            table.Rows.Add(id, MsmeEntry.SiteExteriorFolder, MsmeEntry.TimeStamp(), MsmeEntry.Coordinate(latitude, 90), MsmeEntry.Coordinate(longitude, 180), "jpg");
        }
        await WriteAllAsync(written, ct);

        var args = new DynamicParameters();
        args.Add("RefId", DateTime.Now.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture));
        args.Add("ZedId", ZedId);
        args.Add("CertificationType", level);
        args.Add("MsmeRemarks", Remarks(remarks));
        AddTable(args, "SiteExteriorPhotos", table, "DynamicPhotoList2");
        if (await TryRunAsync("SP_APP_MSME_INSERT_SITE_EXTERIOR", args, ct) is { } failed) return failed;
        log.LogInformation("Web NC {Nc} site exterior answered for {ZedId} {Level}", stage.NcCount, ZedId, level);
        return new EntryMessage("Answer saved.");
    }

    // ---------- Helpers ----------

    /// <summary>One PDF as sent, or photos (stored as the app stores them) joined into the evidence PDF.</summary>
    private async Task<(System.Data.DataTable Table, List<(string Path, byte[] Bytes)> Written, string? Problem)> EvidenceFilesAsync(
        string level, string pdfName, List<IFormFile> files, CancellationToken ct)
    {
        var table = PhotoTable();
        var written = new List<(string Path, byte[] Bytes)>();
        var read = new List<(byte[] Bytes, bool IsPdf)>();
        foreach (var f in files)
        {
            var (bytes, isPdf, problem) = await ReadUploadAsync(f, pdfAllowed: true, ct);
            if (problem is not null) return (table, written, $"{f.FileName}: {problem}");
            read.Add((bytes!, isPdf));
        }
        if (read.Any(r => r.IsPdf) && read.Count > 1) return (table, written, "Please choose either one PDF, or photos.");
        var pdfPath = FullPath(level, MsmeEntry.EvidencesFolder, pdfName);
        if (pdfPath is null) return (table, written, GenericError);
        if (read[0].IsPdf)
        {
            var id = MsmeEntry.NewPhotoId(ZedId, 1);
            written.Add((FullPath(level, MsmeEntry.EvidencesFolder, id + ".pdf")!, read[0].Bytes));
            written.Add((pdfPath, read[0].Bytes));
            table.Rows.Add(id, MsmeEntry.EvidencesFolder, MsmeEntry.TimeStamp(), null, null, "pdf");
            return (table, written, null);
        }
        var n = 0;
        foreach (var (bytes, _) in read)
        {
            var id = MsmeEntry.NewPhotoId(ZedId, ++n);
            written.Add((FullPath(level, MsmeEntry.EvidencesFolder, id + ".jpg")!, bytes));
            table.Rows.Add(id, MsmeEntry.EvidencesFolder, MsmeEntry.TimeStamp(), null, null, "jpg");
        }
        var pdf = EvidenceImages.ImagesToPdf(read.Select(r => r.Bytes).ToList());
        if (pdf is null) return (table, written, "The photos could not be read. Please choose JPG or PNG photos.");
        written.Add((pdfPath, pdf));
        return (table, written, null);
    }

    private static async Task WriteAllAsync(IEnumerable<(string Path, byte[] Bytes)> files, CancellationToken ct)
    {
        foreach (var (path, bytes) in files)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await System.IO.File.WriteAllBytesAsync(path, bytes, ct);
        }
    }

    /// <summary>The procedure's refusal markers (DummyUsersForError) and errors as a 400 with a plain message, else null.</summary>
    private async Task<ActionResult?> TryRunAsync(string procedure, object args, CancellationToken ct)
    {
        try
        {
            await db.ExecuteProcAsync(procedure, args, ct);
            return null;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "{Procedure} refused for {ZedId}", procedure, ZedId);
            return this.Problem400(ex.Message.Contains("'ABC_", StringComparison.Ordinal)
                ? "This item has no open non-conformance."
                : GenericError);
        }
    }
}
