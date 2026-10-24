using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Forms;
using Zed.Core.Http;
using Zed.Core.Security;

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
public sealed class AppFormValuesController(ISqlExecutor db, AppForms forms, PortalHost host) : StaffApiController
{
    public sealed record ValueItem(string Key, string Label, string Type, string Value, bool Enabled, string? SubmittedBy, DateTime? UpdatedOn);

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
            var answers = rows.Where(r => string.Equals(r.FormKey, spec.Key, StringComparison.OrdinalIgnoreCase) && !string.IsNullOrEmpty(r.Value)).ToList();
            if (answers.Count == 0) continue;
            var form = (await forms.GetAsync(host.System, spec.Key, ct))!;
            var values = answers
                .Select(r => (Row: r, Field: form.Find(r.FieldKey)))
                .OrderBy(x => x.Field is null ? int.MaxValue : form.Fields.ToList().IndexOf(x.Field))
                .ThenBy(x => x.Row.FieldKey, StringComparer.Ordinal)
                .Select(x => new ValueItem(x.Row.FieldKey, x.Field?.Label ?? x.Row.FieldKey, x.Field?.Type ?? AppFieldTypes.Text,
                    AppFormRules.Display(x.Field?.Type ?? AppFieldTypes.Text, x.Row.Value), x.Field?.Enabled ?? false, x.Row.SubmittedBy, x.Row.UpdatedOn))
                .ToList();
            result.Add(new FormValues(spec.Key, spec.Name, spec.App, values));
        }
        return result;
    }
}
