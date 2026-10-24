using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Core.Forms;

/// <summary>
/// A row of dbo.V4AppFormFields (migration 0017): the Admin's change of a standard field (<paramref name="Custom"/> false;
/// null columns keep the standard value, the type and section never change) or a field the Admin added (all columns set).
/// A column of a row field is stored as <c>rows/column</c>.
/// </summary>
public sealed record AppFormFieldRow(string FormKey, string FieldKey, bool Custom, string? Label, string? Help, string? Type, bool? Required,
    bool Enabled, int? SortOrder, string? Section, string? OptionsJson, string? UpdatedBy, DateTime? UpdatedOn);

/// <summary>An answer to an Admin's field (dbo.V4AppFormValues); several answers are a JSON array of strings.</summary>
public sealed record AppFormValueRow(string FormKey, string ZedId, string CertificationType, string FieldKey, string? Value,
    string? SubmittedBy, DateTime? UpdatedOn);

public interface IAppFormStore
{
    /// <summary>The Admin's rows of a form; none (the standard form) when the table cannot be read.</summary>
    Task<IReadOnlyList<AppFormFieldRow>> FieldsAsync(string formKey, CancellationToken ct = default);

    Task SaveFieldAsync(AppFormFieldRow row, string userId, CancellationToken ct = default);

    /// <summary>New positions of fields; a standard field without a row gets one that only holds its position.</summary>
    Task SaveOrderAsync(string formKey, IReadOnlyList<(string FieldKey, int SortOrder)> order, string userId, CancellationToken ct = default);

    /// <summary>A standard field back to the catalogue (its row is removed; rows of the Admin's own fields are never removed).</summary>
    Task ResetAsync(string formKey, string fieldKey, CancellationToken ct = default);

    /// <summary>Answers of one submit; a null value removes the stored answer.</summary>
    Task SaveValuesAsync(string formKey, string zedId, string certification, IReadOnlyDictionary<string, string?> values, string submittedBy,
        CancellationToken ct = default);

    Task<IReadOnlyList<AppFormValueRow>> ValuesAsync(string zedId, string certification, CancellationToken ct = default);
}

public sealed class SqlAppFormStore(ISqlExecutor db, ILogger<SqlAppFormStore> log) : IAppFormStore
{
    public const string FieldsSql =
        "SELECT FormKey, FieldKey, Custom, Label, Help, Type, Required, Enabled, SortOrder, Section, OptionsJson, UpdatedBy, UpdatedOn " +
        "FROM dbo.V4AppFormFields WHERE FormKey = @FormKey;";

    public const string ValuesSql =
        "SELECT FormKey, ZedId, CertificationType, FieldKey, Value, SubmittedBy, UpdatedOn FROM dbo.V4AppFormValues " +
        "WHERE ZedId = @ZedId AND CertificationType = @CertificationType;";

    private static DbString Ansi(string? value, int length) => new() { Value = value, IsAnsi = true, Length = length };

    private static string User(string userId) => userId.Length <= 50 ? userId : userId[..50];

    public async Task<IReadOnlyList<AppFormFieldRow>> FieldsAsync(string formKey, CancellationToken ct = default)
    {
        try
        {
            return await db.QuerySqlAsync<AppFormFieldRow>(FieldsSql, new { FormKey = Ansi(formKey, 50) }, ct);
        }
        catch (SqlException ex)
        {
            log.LogWarning(ex, "Could not read dbo.V4AppFormFields (is migration 0017 applied?); the standard form {Form} is used.", formKey);
            return [];
        }
    }

    public Task SaveFieldAsync(AppFormFieldRow row, string userId, CancellationToken ct = default) => db.ExecuteSqlAsync(
        "MERGE dbo.V4AppFormFields AS t USING (SELECT @FormKey AS FormKey, @FieldKey AS FieldKey) AS s " +
        "ON t.FormKey = s.FormKey AND t.FieldKey = s.FieldKey " +
        "WHEN MATCHED THEN UPDATE SET Custom = @Custom, Label = @Label, Help = @Help, Type = @Type, Required = @Required, Enabled = @Enabled, " +
        "SortOrder = @SortOrder, Section = @Section, OptionsJson = @OptionsJson, UpdatedBy = @UpdatedBy, UpdatedOn = SYSUTCDATETIME() " +
        "WHEN NOT MATCHED THEN INSERT (FormKey, FieldKey, Custom, Label, Help, Type, Required, Enabled, SortOrder, Section, OptionsJson, UpdatedBy) " +
        "VALUES (@FormKey, @FieldKey, @Custom, @Label, @Help, @Type, @Required, @Enabled, @SortOrder, @Section, @OptionsJson, @UpdatedBy);",
        new
        {
            FormKey = Ansi(row.FormKey, 50), FieldKey = Ansi(row.FieldKey, 100), row.Custom, row.Label, row.Help, Type = Ansi(row.Type, 20),
            row.Required, row.Enabled, row.SortOrder, Section = Ansi(row.Section, 50), row.OptionsJson, UpdatedBy = Ansi(User(userId), 50),
        }, ct);

    public async Task SaveOrderAsync(string formKey, IReadOnlyList<(string FieldKey, int SortOrder)> order, string userId, CancellationToken ct = default)
    {
        if (order.Count == 0) return;
        // One statement per field (Dapper runs it for each element).
        await db.ExecuteSqlAsync(
            "MERGE dbo.V4AppFormFields AS t USING (SELECT @FormKey AS FormKey, @FieldKey AS FieldKey) AS s " +
            "ON t.FormKey = s.FormKey AND t.FieldKey = s.FieldKey " +
            "WHEN MATCHED THEN UPDATE SET SortOrder = @SortOrder, UpdatedBy = @UpdatedBy, UpdatedOn = SYSUTCDATETIME() " +
            "WHEN NOT MATCHED THEN INSERT (FormKey, FieldKey, Custom, Enabled, SortOrder, UpdatedBy) VALUES (@FormKey, @FieldKey, 0, 1, @SortOrder, @UpdatedBy);",
            order.Select(o => new { FormKey = Ansi(formKey, 50), FieldKey = Ansi(o.FieldKey, 100), o.SortOrder, UpdatedBy = Ansi(User(userId), 50) }).ToList(), ct);
    }

    public Task ResetAsync(string formKey, string fieldKey, CancellationToken ct = default) => db.ExecuteSqlAsync(
        "DELETE FROM dbo.V4AppFormFields WHERE FormKey = @FormKey AND FieldKey = @FieldKey AND Custom = 0;",
        new { FormKey = Ansi(formKey, 50), FieldKey = Ansi(fieldKey, 100) }, ct);

    public async Task SaveValuesAsync(string formKey, string zedId, string certification, IReadOnlyDictionary<string, string?> values, string submittedBy,
        CancellationToken ct = default)
    {
        var rows = values.Select(v => new
        {
            FormKey = Ansi(formKey, 50), ZedId = Ansi(zedId, 50), CertificationType = Ansi(certification, 50), FieldKey = Ansi(v.Key, 100),
            v.Value, SubmittedBy = Ansi(User(submittedBy), 50),
        }).ToList();
        var saved = rows.Where(r => r.Value is not null).ToList();
        var cleared = rows.Where(r => r.Value is null).ToList();
        if (saved.Count > 0)
            await db.ExecuteSqlAsync(
                "MERGE dbo.V4AppFormValues AS t USING (SELECT @FormKey AS FormKey, @ZedId AS ZedId, @CertificationType AS CertificationType, @FieldKey AS FieldKey) AS s " +
                "ON t.FormKey = s.FormKey AND t.ZedId = s.ZedId AND t.CertificationType = s.CertificationType AND t.FieldKey = s.FieldKey " +
                "WHEN MATCHED THEN UPDATE SET Value = @Value, SubmittedBy = @SubmittedBy, UpdatedOn = SYSUTCDATETIME() " +
                "WHEN NOT MATCHED THEN INSERT (FormKey, ZedId, CertificationType, FieldKey, Value, SubmittedBy) " +
                "VALUES (@FormKey, @ZedId, @CertificationType, @FieldKey, @Value, @SubmittedBy);", saved, ct);
        if (cleared.Count > 0)
            await db.ExecuteSqlAsync(
                "DELETE FROM dbo.V4AppFormValues WHERE FormKey = @FormKey AND ZedId = @ZedId AND CertificationType = @CertificationType AND FieldKey = @FieldKey;",
                cleared, ct);
    }

    public async Task<IReadOnlyList<AppFormValueRow>> ValuesAsync(string zedId, string certification, CancellationToken ct = default)
    {
        try
        {
            return await db.QuerySqlAsync<AppFormValueRow>(ValuesSql, new { ZedId = Ansi(zedId, 50), CertificationType = Ansi(certification, 50) }, ct);
        }
        catch (SqlException ex)
        {
            log.LogWarning(ex, "Could not read dbo.V4AppFormValues (is migration 0017 applied?)");
            return [];
        }
    }
}

/// <summary>A field as the app shows it (with the Admin's changes), plus what the Admin page needs.</summary>
public sealed record AppField
{
    public required string Key { get; init; }
    public required string Label { get; init; }
    public string? Help { get; init; }
    public string? Heading { get; init; }
    public required string Type { get; init; }
    public bool Required { get; init; }
    public bool Enabled { get; init; } = true;
    /// <summary>Enabled, and the field it depends on (<see cref="When"/>) is shown: sent to the apps and checked.</summary>
    public bool Active { get; init; } = true;
    public bool Custom { get; init; }
    public required string Section { get; init; }
    public int Order { get; init; }
    public IReadOnlyList<string>? Options { get; init; }
    public string? OptionsSource { get; init; }
    public string? Separator { get; init; }
    public int? MaxItems { get; init; }
    public int? MaxLength { get; init; }
    public decimal? Min { get; init; }
    public decimal? Max { get; init; }
    public AppFieldCondition? When { get; init; }
    public IReadOnlyList<AppField>? Columns { get; init; }
    /// <summary>The catalogue field (null for the Admin's own fields).</summary>
    public AppFormFieldSpec? Standard { get; init; }
    /// <summary>The Admin saved something for this field.</summary>
    public bool Customised { get; init; }
    public string? UpdatedBy { get; init; }
    public DateTime? UpdatedOn { get; init; }
}

/// <summary>A form as it stands on one system: the catalogue merged with the Admin's rows.</summary>
public sealed class EffectiveAppForm
{
    private EffectiveAppForm(AppFormSpec spec, PortalSystem system, IReadOnlyList<AppField> fields, DateTime? updatedOn)
    {
        Spec = spec;
        System = system;
        Fields = fields;
        UpdatedOn = updatedOn;
        Version = ComputeVersion(AppJsonBody());
    }

    public AppFormSpec Spec { get; }
    public PortalSystem System { get; }
    /// <summary>Top-level fields in display order, disabled ones included.</summary>
    public IReadOnlyList<AppField> Fields { get; }
    public DateTime? UpdatedOn { get; }
    /// <summary>Changes whenever anything the apps see changes (hash of the definition).</summary>
    public string Version { get; }

    public IEnumerable<AppField> CustomFields => Fields.Where(f => f.Custom);

    /// <summary>A top-level field, or a column as <c>rows/column</c>.</summary>
    public AppField? Find(string? key)
    {
        if (string.IsNullOrWhiteSpace(key)) return null;
        var parts = key.Split(AppFormCatalogue.ColumnSeparator, 2);
        var field = Fields.FirstOrDefault(f => string.Equals(f.Key, parts[0], StringComparison.OrdinalIgnoreCase));
        return parts.Length == 1 ? field : field?.Columns?.FirstOrDefault(c => string.Equals(c.Key, parts[1], StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>The stored key of a field or column in its catalogue spelling (<c>rows/column</c> for a column), or null.</summary>
    public string? KeyOf(string? key)
    {
        if (Find(key) is not { } field) return null;
        var parts = key!.Split(AppFormCatalogue.ColumnSeparator, 2);
        return parts.Length == 1 ? field.Key : Find(parts[0])!.Key + AppFormCatalogue.ColumnSeparator + field.Key;
    }

    /// <summary>Shown and required (a missing field that is not shown, or optional, must be accepted).</summary>
    public bool IsRequired(string key) => Find(key) is { Active: true, Required: true };

    /// <summary>No shown field under this key prefix is required (a whole group of the request may then be left out).</summary>
    public bool NothingRequiredUnder(string prefix) =>
        !Fields.Any(f => f.Active && f.Required && f.Key.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));

    public static EffectiveAppForm Build(AppFormSpec spec, PortalSystem system, IEnumerable<AppFormFieldRow> rows)
    {
        var saved = new Dictionary<string, AppFormFieldRow>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in rows.Where(r => string.Equals(r.FormKey, spec.Key, StringComparison.OrdinalIgnoreCase))) saved[r.FieldKey] = r;
        var standard = AppFormCatalogue.FieldsOn(spec, system).ToList();
        var standardKeys = standard.Select(s => s.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var sections = spec.Sections.Select(s => s.Key).ToList();

        var fields = new List<AppField>();
        foreach (var s in standard)
        {
            var field = FromStandard(s, saved.GetValueOrDefault(s.Key));
            if (s.Columns is { } columns)
                field = field with
                {
                    Columns = columns.Select(c => FromStandard(c, saved.GetValueOrDefault(s.Key + AppFormCatalogue.ColumnSeparator + c.Key)))
                        .OrderBy(c => c.Order).ThenBy(c => c.Key, StringComparer.Ordinal).ToList(),
                };
            fields.Add(field);
        }
        foreach (var r in saved.Values.Where(r => r.Custom && !standardKeys.Contains(r.FieldKey) && !r.FieldKey.Contains(AppFormCatalogue.ColumnSeparator)
                                                  && AppFieldTypes.Custom.Contains(r.Type ?? "")))
            // A section that no longer exists puts the field in the first one.
            fields.Add(FromCustom(r, sections.FirstOrDefault(x => string.Equals(x, r.Section, StringComparison.OrdinalIgnoreCase)) ?? sections[0]));

        fields = fields.OrderBy(f => sections.IndexOf(f.Section)).ThenBy(f => f.Order).ThenBy(f => f.Custom).ThenBy(f => f.Key, StringComparer.Ordinal).ToList();

        // A field shown only for another field's answer is not shown when that field is not shown.
        var byKey = fields.ToDictionary(f => f.Key, StringComparer.OrdinalIgnoreCase);
        bool Shown(AppField f, int depth) => f.Enabled && (f.When is null || depth > 5 || Controls(f.When.Field, depth + 1));
        bool Controls(string key, int depth)
        {
            var parts = key.Split(AppFormCatalogue.ColumnSeparator, 2);
            if (!byKey.TryGetValue(parts[0], out var parent) || !Shown(parent, depth)) return false;
            return parts.Length == 1 || parent.Columns?.FirstOrDefault(c => string.Equals(c.Key, parts[1], StringComparison.OrdinalIgnoreCase)) is { Enabled: true };
        }
        fields = fields.Select(f =>
        {
            var active = Shown(f, 0);
            return f with { Active = active, Columns = f.Columns?.Select(c => c with { Active = active && c.Enabled }).ToList() };
        }).ToList();

        var updated = saved.Values.Select(r => r.UpdatedOn).Where(d => d is not null).DefaultIfEmpty(null).Max();
        return new EffectiveAppForm(spec, system, fields, updated);
    }

    private static AppField FromStandard(AppFormFieldSpec s, AppFormFieldRow? r) => new()
    {
        Key = s.Key,
        Label = r?.Label is { Length: > 0 } label ? label : s.Label,
        Help = r?.Help is { Length: > 0 } help ? help : s.Help,
        Heading = s.Heading,
        Type = s.Type,
        Required = r?.Required ?? s.Required,
        Enabled = r?.Enabled ?? true,
        Section = s.Section,
        Order = r?.SortOrder ?? s.Order,
        Options = s.Options,
        OptionsSource = s.OptionsSource,
        Separator = s.Separator,
        MaxItems = s.MaxItems,
        MaxLength = s.MaxLength,
        Min = s.Min,
        Max = s.Max,
        When = s.When,
        Standard = s,
        Customised = r is not null,
        UpdatedBy = r?.UpdatedBy,
        UpdatedOn = r?.UpdatedOn,
    };

    private static AppField FromCustom(AppFormFieldRow r, string section) => new()
    {
        Key = r.FieldKey,
        Label = r.Label is { Length: > 0 } label ? label : r.FieldKey,
        Help = r.Help is { Length: > 0 } help ? help : null,
        Type = r.Type!,
        Required = r.Required ?? false,
        Enabled = r.Enabled,
        Custom = true,
        Section = section,
        Order = r.SortOrder ?? 1000,
        Options = AppFieldTypes.IsChoice(r.Type) ? AppFormRules.ParseOptions(r.OptionsJson) : null,
        Customised = true,
        UpdatedBy = r.UpdatedBy,
        UpdatedOn = r.UpdatedOn,
    };

    // ---------- The definition the apps get (docs/mobile/APP-FORMS.md) ----------

    /// <summary><c>{ status, form, name, numbered, version, updatedOn, sections, fields }</c>: shown fields only, nulls left out.</summary>
    public JsonObject ToAppJson()
    {
        var body = AppJsonBody();
        var result = new JsonObject { ["status"] = "1" };
        foreach (var (k, v) in body) result[k] = v?.DeepClone();
        result["version"] = Version;
        result["updatedOn"] = UpdatedOn?.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
        return result;
    }

    private JsonObject AppJsonBody() => new()
    {
        ["form"] = Spec.Key,
        ["name"] = Spec.Name,
        ["numbered"] = Spec.Numbered,
        ["sections"] = new JsonArray([.. Spec.Sections.Select(s => (JsonNode)new JsonObject { ["key"] = s.Key, ["label"] = s.Label })]),
        ["fields"] = new JsonArray([.. Fields.Where(f => f.Active).Select(f => (JsonNode)FieldJson(f))]),
    };

    private static JsonObject FieldJson(AppField f)
    {
        var o = new JsonObject
        {
            ["key"] = f.Key,
            ["label"] = f.Label,
            ["type"] = f.Type,
            ["required"] = f.Required,
            ["custom"] = f.Custom,
            ["section"] = f.Section,
            ["order"] = f.Order,
        };
        void Add(string name, JsonNode? value) { if (value is not null) o[name] = value; }
        Add("help", f.Help);
        Add("heading", f.Heading);
        Add("options", f.Options is { } options ? new JsonArray([.. options.Select(x => (JsonNode)x)]) : null);
        Add("optionsSource", f.OptionsSource);
        Add("separator", f.Separator);
        Add("maxItems", f.MaxItems);
        Add("maxLength", f.MaxLength);
        Add("min", f.Min);
        Add("max", f.Max);
        Add("when", f.When is { } w ? new JsonObject { ["field"] = w.Field, ["equals"] = w.EqualsValue } : null);
        Add("columns", f.Columns is { } columns ? new JsonArray([.. columns.Where(c => c.Active).Select(c => (JsonNode)FieldJson(c))]) : null);
        return o;
    }

    private static string ComputeVersion(JsonObject body) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(body.ToJsonString())))[..16];
}

/// <summary>The forms of a system with the Admin's changes (read on each call: the table is small and keyed by form).</summary>
public sealed class AppForms(IAppFormStore store)
{
    public IAppFormStore Store => store;

    /// <summary>Null when the form is not one of this system's.</summary>
    public async Task<EffectiveAppForm?> GetAsync(PortalSystem system, string? formKey, CancellationToken ct = default) =>
        AppFormCatalogue.Find(system, formKey) is { } spec ? EffectiveAppForm.Build(spec, system, await store.FieldsAsync(spec.Key, ct)) : null;
}

/// <summary>
/// The standard answers of a submit, for the checks of a request that names its <c>formVersion</c>: per field key (and
/// <c>rows/column</c>), the values sent (one per photo, list item or row; blanks included). A key not given is not checked.
/// </summary>
public sealed class AppFormAnswers : Dictionary<string, IReadOnlyList<string?>>
{
    public AppFormAnswers() : base(StringComparer.OrdinalIgnoreCase) { }

    public static IReadOnlyList<string?> One(string? value) => [value];
}

/// <summary>Outcome of the checks: the refusal to answer with, or the Admin's fields' answers to store (null: remove).</summary>
public sealed record AppFormCheck(string? Error, IReadOnlyDictionary<string, string?> CustomValues)
{
    public bool Ok => Error is null;
}

public static partial class AppFormRules
{
    public const int MaxTextLength = 4000;
    public const int MaxOptions = 50;
    public const int MaxOptionLength = 100;

    public static IReadOnlyList<string> ParseOptions(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            return JsonSerializer.Deserialize<List<string>>(json)?.Where(o => !string.IsNullOrWhiteSpace(o)).ToList() ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>Several answers as stored: a JSON array of strings.</summary>
    public static string ToJsonArray(IEnumerable<string> values) => JsonSerializer.Serialize(values.ToList());

    /// <summary>A stored answer as text for staff (several answers joined with ", ").</summary>
    public static string Display(string type, string? value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        if (AppFieldTypes.Multiple.Contains(type) || value.StartsWith('['))
        {
            try
            {
                if (JsonSerializer.Deserialize<List<string>>(value) is { } list) return string.Join(", ", list);
            }
            catch (JsonException) { }
        }
        return value;
    }

    /// <summary>
    /// Checks a submit against the form. Answers to the Admin's fields are always checked against their type and options;
    /// answers for keys that are not shown fields of the Admin are ignored. <paramref name="strict"/> (the request named its
    /// formVersion): required fields, the Admin's and the standard ones in <paramref name="standard"/>, must be answered, and
    /// an Admin's field left out is stored as unanswered. Without it (builds that do not know the form) nothing is required
    /// and only the answers sent are stored.
    /// </summary>
    public static AppFormCheck Check(EffectiveAppForm form, IReadOnlyDictionary<string, JsonElement>? custom, AppFormAnswers? standard, bool strict)
    {
        var values = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        var sent = custom is null ? new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase)
            : new Dictionary<string, JsonElement>(custom, StringComparer.OrdinalIgnoreCase);

        foreach (var f in form.CustomFields.Where(f => f.Active))
        {
            if (!sent.TryGetValue(f.Key, out var raw))
            {
                if (!strict) continue;
                if (f.Required) return Refuse($"Please fill in: {f.Label}.");
                values[f.Key] = null;
                continue;
            }
            var (value, error) = Normalise(f, raw);
            if (error is not null) return Refuse($"{f.Label}: {error}");
            if (value is null && strict && f.Required) return Refuse($"Please fill in: {f.Label}.");
            values[f.Key] = value;
        }

        if (strict && standard is not null)
        {
            foreach (var f in form.Fields.Where(f => f.Active && !f.Custom))
            {
                if (!standard.TryGetValue(f.Key, out var answers)) continue;
                if (f.When is { } when && !(standard.TryGetValue(when.Field, out var c) && c.Any(v => Same(v, when.EqualsValue)))) continue;
                var given = answers.Count(v => !string.IsNullOrWhiteSpace(v));
                if (f.Required && given == 0) return Refuse($"Please fill in: {f.Label}.");
                if (f.Type != AppFieldTypes.Rows || f.Columns is null) continue;
                foreach (var col in f.Columns.Where(col => col.Active && col.Required))
                    if (standard.TryGetValue(f.Key + AppFormCatalogue.ColumnSeparator + col.Key, out var cells) && cells.Any(string.IsNullOrWhiteSpace))
                        return Refuse($"Please fill in {col.Label} for every entry of {f.Label}.");
            }
        }
        return new AppFormCheck(null, values);

        static AppFormCheck Refuse(string message) => new(message, new Dictionary<string, string?>());
    }

    private static bool Same(string? a, string b) => string.Equals(a?.Trim(), b, StringComparison.OrdinalIgnoreCase);

    /// <summary>An answer in its stored form (null: not answered), or what is wrong with it.</summary>
    internal static (string? Value, string? Error) Normalise(AppField f, JsonElement raw)
    {
        if (raw.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return (null, null);

        if (AppFieldTypes.Multiple.Contains(f.Type))
        {
            var items = new List<string>();
            JsonElement array = raw;
            if (raw.ValueKind == JsonValueKind.String)
            {
                var text = raw.GetString()?.Trim() ?? "";
                if (text.Length == 0) return (null, null);
                try
                {
                    array = JsonSerializer.Deserialize<JsonElement>(text);
                }
                catch (JsonException)
                {
                    return (null, "please choose from the list.");
                }
            }
            if (array.ValueKind != JsonValueKind.Array) return (null, "please choose from the list.");
            foreach (var item in array.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.String) return (null, "please choose from the list.");
                var option = Option(f, item.GetString());
                if (option is null) return (null, $"\"{item.GetString()}\" is not one of the choices.");
                if (!items.Contains(option)) items.Add(option);
            }
            return (items.Count == 0 ? null : ToJsonArray(items), null);
        }

        var s = raw.ValueKind switch
        {
            JsonValueKind.String => raw.GetString(),
            JsonValueKind.Number => raw.GetRawText(),
            JsonValueKind.True => f.Type == AppFieldTypes.YesNo ? "Yes" : "true",
            JsonValueKind.False => f.Type == AppFieldTypes.YesNo ? "No" : "false",
            _ => null,
        };
        if (s is null) return (null, "the answer is not valid.");
        s = s.Trim();
        if (s.Length == 0) return (null, null);

        switch (f.Type)
        {
            case AppFieldTypes.Number:
                return WholeNumber().IsMatch(s) ? (s, null) : (null, "please enter a whole number.");
            case AppFieldTypes.Decimal:
                return DecimalNumber().IsMatch(s) ? (s, null) : (null, "please enter a number.");
            case AppFieldTypes.Date:
                return DateOnly.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
                    ? (d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), null)
                    : (null, "please enter a date (yyyy-MM-dd).");
            case AppFieldTypes.YesNo:
                return Same(s, "Yes") ? ("Yes", null) : Same(s, "No") ? ("No", null) : (null, "please answer Yes or No.");
            case AppFieldTypes.Dropdown:
                return Option(f, s) is { } o ? (o, null) : (null, $"\"{s}\" is not one of the choices.");
            default:
                return s.Length <= MaxTextLength ? (s, null) : (null, $"the answer is too long ({MaxTextLength} characters at most).");
        }
    }

    private static string? Option(AppField f, string? value) =>
        f.Options?.FirstOrDefault(o => string.Equals(o.Trim(), value?.Trim(), StringComparison.OrdinalIgnoreCase));

    [GeneratedRegex(@"^-?\d{1,18}$")] private static partial Regex WholeNumber();
    [GeneratedRegex(@"^-?(\d{1,18}(\.\d{1,6})?|\.\d{1,6})$")] private static partial Regex DecimalNumber();
}
