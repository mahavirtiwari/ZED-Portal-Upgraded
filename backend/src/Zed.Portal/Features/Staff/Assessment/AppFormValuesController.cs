using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Zed.Core.Data;
using Zed.Core.Forms;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;

namespace Zed.Portal.Features.Staff.Assessment;

/// <summary>
/// New in V4: the answers to the Admin's own fields of the apps' Basic Information forms (Admin → App Forms,
/// dbo.V4AppFormValues) for one unit and level, shown on the desktop-assessment page as "Additional information". Same
/// roles and visibility as that page (<see cref="CertificationRecord.CanView"/>); answers to fields disabled since are
/// still shown. Not served on Consultancy (no desktop assessment there).
/// </summary>
[PortalSystems(PortalSystem.Main, PortalSystem.Surveillance)]
[Route("api/staff/app-form-values/{zedId}/{certification}")]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency, UserRole.DesktopAssessor, UserRole.SuperAdmin, UserRole.Ministry, UserRole.CitizenFeedback, UserRole.QC)]
public sealed class AppFormValuesController(ISqlExecutor db, AppForms forms, PortalHost host, IWebHostEnvironment env, IOptions<PortalOptions> portal,
    ILogger<AppFormValuesController> log) : StaffApiController
{
    public sealed record ValueItem(string Key, string Label, string Type, string Value, bool Enabled, string? SubmittedBy, DateTime? UpdatedOn)
    {
        /// <summary>2026-11-16: repeating entries of the Admin's own: each entry's columns (photos as addresses of this controller).</summary>
        public IReadOnlyList<IReadOnlyList<EntryItem>>? Entries { get; init; }
    }

    public sealed record EntryItem(string Label, string Type, string Text, IReadOnlyList<string> PhotoUrls);

    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    /// <summary>One form's answers (forms without answers are left out).</summary>
    public sealed record FormValues(string Form, string Name, string App, IReadOnlyList<ValueItem> Values);

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<FormValues>>> Get(string zedId, string certification, CancellationToken ct)
    {
        var level = AssessmentInput.Level(certification);
        if (!AssessmentInput.IsId(zedId) || level is null) return this.Problem400("Invalid request.");
        var record = await AssessmentRecords.CertificationAsync(db, zedId, level, ct);
        if (record is null || !record.CanView(CurrentUser)) return NotFound();

        var rows = await forms.Store.ValuesAsync(zedId, level, ct);
        var result = new List<FormValues>();
        foreach (var spec in AppFormCatalogue.For(host.System))
        {
            // 2026-11-16: not the copies of standard answers made for the check (the page shows those with the basic information).
            var answers = rows.Where(r => string.Equals(r.FormKey, spec.Key, StringComparison.OrdinalIgnoreCase) && !string.IsNullOrEmpty(r.Value)
                                          && !AppFormStandardAnswers.CanValidate(r.FormKey, r.FieldKey)).ToList();
            if (answers.Count == 0) continue;
            var form = (await forms.GetAsync(host.System, spec.Key, ct))!;
            var values = answers
                .Select(r => (Row: r, Field: form.Find(r.FieldKey)))
                .OrderBy(x => x.Field is null ? int.MaxValue : form.Fields.ToList().IndexOf(x.Field))
                .ThenBy(x => x.Row.FieldKey, StringComparer.Ordinal)
                .Select(x => new ValueItem(x.Row.FieldKey, x.Field?.Label ?? x.Row.FieldKey, x.Field?.Type ?? AppFieldTypes.Text,
                    AppFormRules.Display(x.Field?.Type ?? AppFieldTypes.Text, x.Row.Value), x.Field?.Enabled ?? false, x.Row.SubmittedBy, x.Row.UpdatedOn)
                {
                    Entries = x.Field is { Type: AppFieldTypes.Rows } rows
                        ? AppFormRules.Entries(rows, x.Row.Value).Select(e => (IReadOnlyList<EntryItem>)e.Select(c => new EntryItem(c.Label, c.Type, c.Text,
                            c.Photos.Select(id => PhotoUrl(zedId, level, spec.Key, id)).ToList())).ToList()).ToList()
                        : null,
                })
                .ToList();
            result.Add(new FormValues(spec.Key, spec.Name, spec.App, values));
        }
        return result;
    }

    private static string PhotoUrl(string zedId, string level, string form, string photoId) =>
        $"/api/staff/app-form-values/{Uri.EscapeDataString(zedId)}/{Uri.EscapeDataString(level)}/photos/{Uri.EscapeDataString(form)}/{Uri.EscapeDataString(photoId)}";

    /// <summary>
    /// 2026-11-16: a photo of the Admin's repeating entries: uploaded with the app's Basic Information photos (the ZED MSME
    /// app: Photos/{ZedId}/{level}/BasicInfo; the site assessment app: SaPhotos/{ZedId}/{level}/BasicInfo).
    /// </summary>
    [HttpGet("photos/{form}/{photoId}")]
    public async Task<IActionResult> Photo(string zedId, string certification, string form, string photoId, CancellationToken ct)
    {
        var level = AssessmentInput.Level(certification);
        if (!AssessmentInput.IsId(zedId) || level is null || !AppFormRules.PhotoId().IsMatch(photoId) || AppFormCatalogue.Find(host.System, form) is not { } spec)
            return NotFound();
        var record = await AssessmentRecords.CertificationAsync(db, zedId, level, ct);
        if (record is null || !record.CanView(CurrentUser)) return NotFound();
        var app = host.System == PortalSystem.Surveillance ? "surveillancemobileapi" : "mobileapi";
        IEnumerable<string> candidates = spec.Key == AppFormCatalogue.AssessorBasicInfo
            ? [$"{app}/SaPhotos/{zedId}/{level}/BasicInfo/{photoId}.jpg"]
            : DaFiles.StorageCandidates($"{app}/Photos/{zedId}/{level}/BasicInfo/{photoId}.jpg", zedId, host.System);
        var fullPath = MsmeFilePaths.AppFileRoots(HttpContext.RequestServices, env, portal.Value)
            .SelectMany(root => candidates.SelectMany(MsmeFilePaths.AppLayoutCandidates).Select(c => MsmeFilePaths.Resolve(root, c)))
            .FirstOrDefault(p => p is not null && System.IO.File.Exists(p));
        if (fullPath is null)
        {
            log.LogInformation("App form photo {Form}/{PhotoId} of {ZedId} is missing from storage", spec.Key, photoId, zedId);
            return NotFound();
        }
        var fileName = Path.GetFileName(fullPath);
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = fileName }.ToString();
        return PhysicalFile(fullPath, ContentTypes.TryGetContentType(fileName, out var t) ? t : "image/jpeg");
    }
}
