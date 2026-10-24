using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Zed.Core.Forms;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// Admin → App Forms (new in V4): the mobile apps' Basic Information forms of this system (<see cref="AppFormCatalogue"/>).
/// A standard field can get another label, help text and position, be made required or optional, or be disabled; its key
/// and type stay. The Admin can add fields of their own (text, numbers, date, yes/no, choices), edit and disable them; they
/// are never deleted, so their answers stay. Saved per system's database (dbo.V4AppFormFields, migration 0017); the apps get
/// the result from the mobile host (Forms/Definition) and the submit endpoints check against it (docs/mobile/APP-FORMS.md).
/// </summary>
[Route("api/staff/settings/app-forms")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class AppFormsController(AppForms forms, PortalHost host, ILogger<AppFormsController> log) : StaffApiController
{
    public const int MaxCustomFields = 50;
    public const int MaxLabel = 200;
    public const int MaxHelp = 500;
    private const string MigrationHint = " Please ask the administrator to apply database migration 0017.";

    public sealed record FormItem(string Key, string Name, string App, int Fields, int CustomFields, int Disabled, DateTime? UpdatedOn);

    public sealed record FieldItem(string Key, string Label, string? Help, string? Heading, string Type, bool Required, bool Enabled,
        bool Active, bool Custom, string Section, int Order, IReadOnlyList<string>? Options, string? OptionsSource, int? MaxItems,
        string? ShownWhen, string? StandardLabel, string? StandardHelp, bool? StandardRequired, bool Customised, string? UpdatedBy,
        DateTime? UpdatedOn, IReadOnlyList<FieldItem>? Columns);

    public sealed record FormDetails(FormItem Form, string Version, bool Numbered, IReadOnlyList<AppFormSection> Sections,
        IReadOnlyList<string> CustomTypes, IReadOnlyList<FieldItem> Fields);

    /// <summary>Add (no key) or save a field. A standard field takes only the label, help, required and enabled.</summary>
    public sealed record FieldRequest(string? Key, string? Label, string? Help, string? Type, bool Required, bool Enabled = true,
        string? Section = null, IReadOnlyList<string>? Options = null);

    public sealed record EnabledRequest(string? Key, bool Enabled);

    /// <summary>Every top-level field of the section, in the new order.</summary>
    public sealed record OrderRequest(string? Section, IReadOnlyList<string>? Keys);

    public sealed record KeyRequest(string? Key);

    public sealed record AddedResponse(string Message, string Key);

    [HttpGet]
    public async Task<IReadOnlyList<FormItem>> List(CancellationToken ct)
    {
        var result = new List<FormItem>();
        foreach (var spec in AppFormCatalogue.For(host.System))
            result.Add(Item((await forms.GetAsync(host.System, spec.Key, ct))!));
        return result;
    }

    [HttpGet("{form}")]
    public async Task<ActionResult<FormDetails>> Get(string form, CancellationToken ct)
    {
        if (await forms.GetAsync(host.System, form, ct) is not { } f) return NotFound();
        return new FormDetails(Item(f), f.Version, f.Spec.Numbered, f.Spec.Sections, AppFieldTypes.Custom, f.Fields.Select(x => Field(f, x)).ToList());
    }

    [HttpPost("{form}/fields")]
    public async Task<ActionResult<AddedResponse>> Add(string form, FieldRequest req, CancellationToken ct)
    {
        if (await forms.GetAsync(host.System, form, ct) is not { } f) return NotFound();
        if (f.CustomFields.Count() >= MaxCustomFields) return this.Problem400($"A form can have at most {MaxCustomFields} fields of your own.");
        if (CustomError(f, req, out var section, out var options) is { } error) return this.Problem400(error);

        var key = NewKey(f, req.Label!);
        var order = f.Fields.Where(x => x.Section == section).Select(x => x.Order).DefaultIfEmpty(0).Max() + 10;
        var row = new AppFormFieldRow(f.Spec.Key, key, true, req.Label!.Trim(), Clean(req.Help), req.Type!.Trim().ToLowerInvariant(), req.Required,
            req.Enabled, order, section, options is null ? null : AppFormRules.ToJsonArray(options), null, null);
        if (await WriteAsync(() => forms.Store.SaveFieldAsync(row, UserId, ct), "add a field to", f) is { } failed) return failed;
        log.LogInformation("App form {Form}: field {Key} ({Type}) added by {UserId}", f.Spec.Key, key, row.Type, UserId);
        return new AddedResponse("Field added. The apps show it the next time they load the form.", key);
    }

    [HttpPut("{form}/fields")]
    public async Task<ActionResult<MessageResponse>> Save(string form, FieldRequest req, CancellationToken ct)
    {
        if (await forms.GetAsync(host.System, form, ct) is not { } f) return NotFound();
        if (f.Find(req.Key) is not { } field) return NotFound();

        if (field.Custom)
        {
            if (CustomError(f, req, out var section, out var options) is { } error) return this.Problem400(error);
            var row = new AppFormFieldRow(f.Spec.Key, field.Key, true, req.Label!.Trim(), Clean(req.Help), req.Type!.Trim().ToLowerInvariant(),
                req.Required, req.Enabled, section == field.Section ? field.Order : f.Fields.Where(x => x.Section == section).Select(x => x.Order).DefaultIfEmpty(0).Max() + 10,
                section, options is null ? null : AppFormRules.ToJsonArray(options), null, null);
            if (await WriteAsync(() => forms.Store.SaveFieldAsync(row, UserId, ct), "save a field of", f) is { } failed) return failed;
        }
        else
        {
            if (req.Type is { Length: > 0 } type && !string.Equals(type.Trim(), field.Type, StringComparison.OrdinalIgnoreCase))
                return this.Problem400("The type of a standard field cannot be changed.");
            if (LabelError(req.Label, req.Help) is { } error) return this.Problem400(error);
            var row = StandardRow(f, f.KeyOf(req.Key)!, field, req.Label!.Trim(), Clean(req.Help), req.Required, req.Enabled);
            if (await WriteAsync(() => SaveStandardAsync(row, ct), "save a field of", f) is { } failed) return failed;
        }
        log.LogInformation("App form {Form}: field {Key} saved by {UserId} (required {Required}, enabled {Enabled})",
            f.Spec.Key, field.Key, UserId, req.Required, req.Enabled);
        return new MessageResponse(req.Enabled ? "Field saved." : "Field saved. It is not shown in the apps.");
    }

    [HttpPut("{form}/enabled")]
    public async Task<ActionResult<MessageResponse>> SetEnabled(string form, EnabledRequest req, CancellationToken ct)
    {
        if (await forms.GetAsync(host.System, form, ct) is not { } f) return NotFound();
        if (f.Find(req.Key) is not { } field) return NotFound();
        var row = field.Custom
            ? new AppFormFieldRow(f.Spec.Key, field.Key, true, field.Label, field.Help, field.Type, field.Required, req.Enabled, field.Order, field.Section,
                field.Options is null ? null : AppFormRules.ToJsonArray(field.Options), null, null)
            : StandardRow(f, f.KeyOf(req.Key)!, field, field.Label, field.Help, field.Required, req.Enabled);
        if (await WriteAsync(() => field.Custom ? forms.Store.SaveFieldAsync(row, UserId, ct) : SaveStandardAsync(row, ct), "change", f) is { } failed)
            return failed;
        log.LogInformation("App form {Form}: field {Key} {State} by {UserId}", f.Spec.Key, field.Key, req.Enabled ? "enabled" : "disabled", UserId);
        return new MessageResponse(req.Enabled ? $"\"{field.Label}\" is shown in the apps." : $"\"{field.Label}\" is no longer shown in the apps.");
    }

    [HttpPut("{form}/order")]
    public async Task<ActionResult<MessageResponse>> Order(string form, OrderRequest req, CancellationToken ct)
    {
        if (await forms.GetAsync(host.System, form, ct) is not { } f) return NotFound();
        if (f.Spec.Sections.FirstOrDefault(s => string.Equals(s.Key, req.Section, StringComparison.OrdinalIgnoreCase)) is not { } section)
            return this.Problem400("Unknown section.");
        var current = f.Fields.Where(x => x.Section == section.Key).Select(x => x.Key).ToList();
        var keys = req.Keys ?? [];
        if (keys.Count != current.Count || keys.Distinct(StringComparer.OrdinalIgnoreCase).Count() != keys.Count ||
            !keys.All(k => current.Contains(k, StringComparer.OrdinalIgnoreCase)))
            return this.Problem400("The list of fields does not match the form. Please reload the page.");

        var order = keys.Select((k, i) => (current.First(c => string.Equals(c, k, StringComparison.OrdinalIgnoreCase)), (i + 1) * 10)).ToList();
        if (await WriteAsync(() => forms.Store.SaveOrderAsync(f.Spec.Key, order, UserId, ct), "reorder", f) is { } failed) return failed;
        log.LogInformation("App form {Form}: section {Section} reordered by {UserId}", f.Spec.Key, section.Key, UserId);
        return new MessageResponse("Order saved.");
    }

    [HttpPost("{form}/reset")]
    public async Task<ActionResult<MessageResponse>> Reset(string form, KeyRequest req, CancellationToken ct)
    {
        if (await forms.GetAsync(host.System, form, ct) is not { } f) return NotFound();
        if (f.Find(req.Key) is not { } field) return NotFound();
        if (field.Custom) return this.Problem400("A field you added cannot be reset. Disable it instead; its answers are kept.");
        if (await WriteAsync(() => forms.Store.ResetAsync(f.Spec.Key, f.KeyOf(req.Key)!, ct), "reset a field of", f) is { } failed) return failed;
        log.LogInformation("App form {Form}: field {Key} reset to the standard by {UserId}", f.Spec.Key, field.Key, UserId);
        return new MessageResponse("The standard field is shown again.");
    }

    // ---------- helpers ----------

    private static FormItem Item(EffectiveAppForm f) =>
        new(f.Spec.Key, f.Spec.Name, f.Spec.App, f.Fields.Count, f.CustomFields.Count(), f.Fields.Count(x => !x.Enabled), f.UpdatedOn);

    private static FieldItem Field(EffectiveAppForm f, AppField x) =>
        new(x.Key, x.Label, x.Help, x.Heading, x.Type, x.Required, x.Enabled, x.Active, x.Custom, x.Section, x.Order, x.Options, x.OptionsSource,
            x.MaxItems, x.When is { } w ? $"{(f.Find(w.Field)?.Label ?? w.Field)} is {w.EqualsValue}" : null,
            x.Standard?.Label, x.Standard?.Help, x.Standard?.Required, x.Customised, x.UpdatedBy, x.UpdatedOn,
            x.Columns?.Select(c => Field(f, c with { Key = x.Key + AppFormCatalogue.ColumnSeparator + c.Key })).ToList());

    /// <summary>The row of a standard field: only what differs from the catalogue is stored.</summary>
    private static AppFormFieldRow StandardRow(EffectiveAppForm f, string key, AppField field, string label, string? help, bool required, bool enabled)
    {
        var s = field.Standard!;
        return new AppFormFieldRow(f.Spec.Key, key, false,
            label == s.Label ? null : label,
            help is null || help == s.Help ? null : help,
            null,
            required == s.Required ? null : required,
            enabled,
            field.Order == s.Order ? null : field.Order,
            null, null, null, null);
    }

    /// <summary>A standard field with nothing changed has no row (the same as Reset).</summary>
    private Task SaveStandardAsync(AppFormFieldRow row, CancellationToken ct) =>
        row is { Label: null, Help: null, Required: null, Enabled: true, SortOrder: null }
            ? forms.Store.ResetAsync(row.FormKey, row.FieldKey, ct)
            : forms.Store.SaveFieldAsync(row, UserId, ct);

    private static string? LabelError(string? label, string? help)
    {
        if (string.IsNullOrWhiteSpace(label)) return "Please enter the label.";
        if (label.Trim().Length > MaxLabel) return $"The label is too long ({MaxLabel} characters at most).";
        if (help is { } h && h.Trim().Length > MaxHelp) return $"The help text is too long ({MaxHelp} characters at most).";
        return null;
    }

    private static string? CustomError(EffectiveAppForm f, FieldRequest req, out string section, out List<string>? options)
    {
        section = f.Spec.Sections[0].Key;
        options = null;
        if (LabelError(req.Label, req.Help) is { } error) return error;
        var type = req.Type?.Trim().ToLowerInvariant();
        if (type is null || !AppFieldTypes.Custom.Contains(type)) return "Please choose the type of the field.";
        if (!string.IsNullOrWhiteSpace(req.Section))
        {
            var match = f.Spec.Sections.FirstOrDefault(s => string.Equals(s.Key, req.Section.Trim(), StringComparison.OrdinalIgnoreCase));
            if (match is null) return "Unknown section.";
            section = match.Key;
        }
        if (!AppFieldTypes.IsChoice(type)) return null;

        options = [];
        foreach (var o in (req.Options ?? []).Select(o => o?.Trim() ?? "").Where(o => o.Length > 0))
        {
            if (o.Length > AppFormRules.MaxOptionLength) return $"The choice \"{o[..20]}...\" is too long ({AppFormRules.MaxOptionLength} characters at most).";
            if (options.Contains(o, StringComparer.OrdinalIgnoreCase)) return $"The choice \"{o}\" is listed twice.";
            options.Add(o);
        }
        if (options.Count == 0) return "Please add at least one choice.";
        if (options.Count > AppFormRules.MaxOptions) return $"A field can have at most {AppFormRules.MaxOptions} choices.";
        return null;
    }

    private static string? Clean(string? help) => string.IsNullOrWhiteSpace(help) ? null : help.Trim();

    /// <summary>cf_ and the label in lower case (letters and digits), unique in the form; it never changes afterwards.</summary>
    private static string NewKey(EffectiveAppForm f, string label)
    {
        var slug = new StringBuilder();
        foreach (var ch in label.Trim().ToLowerInvariant())
        {
            if (ch is >= 'a' and <= 'z' or >= '0' and <= '9') slug.Append(ch);
            else if (slug.Length > 0 && slug[^1] != '_') slug.Append('_');
            if (slug.Length >= 30) break;
        }
        var core = slug.ToString().Trim('_');
        var key = "cf_" + (core.Length > 0 ? core : "field");
        var candidate = key;
        for (var n = 2; f.Find(candidate) is not null || f.CustomFields.Any(c => string.Equals(c.Key, candidate, StringComparison.OrdinalIgnoreCase)); n++)
            candidate = $"{key}_{n}";
        return candidate;
    }

    private async Task<ActionResult?> WriteAsync(Func<Task> write, string what, EffectiveAppForm f)
    {
        try
        {
            await write();
            return null;
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not {What} the app form {Form} (is migration 0017 applied?)", what, f.Spec.Key);
            return this.Problem400("The form could not be saved." + MigrationHint);
        }
    }
}
