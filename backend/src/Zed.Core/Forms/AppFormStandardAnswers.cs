using System.Text.Json;

namespace Zed.Core.Forms;

/// <summary>
/// 2026-11-16 (the user): "Validation required" on the standard fields of the MSME Basic Information form with one answer
/// each. Their answers live in the unit's certification record (dbo.MsmeCertifications, written by
/// SP_APP_MSME_INSERT_BASIC_INFO). When an assessor checks the answers, they are copied into dbo.V4AppFormValues (as the
/// Admin's own fields are stored), so the same check, NC and report path applies; the unit's answer to an NC on one of
/// them is written back to the certification record, so the reports show the corrected answer. Products, raw materials
/// (repeating entries) and photos are not among them: the assessor already checks products and site photos on the
/// desktop assessment, with their own NCs.
/// </summary>
public static class AppFormStandardAnswers
{
    /// <summary>The field key → its column of dbo.MsmeCertifications (a fixed list: column names are not taken from requests).</summary>
    public static readonly IReadOnlyDictionary<string, string> Columns = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["auditsConducted"] = "AuditsConducted",
        ["domesticCustomers"] = "DomesticCustomers",
        ["internationalCustomers"] = "InternationalCustomers",
        ["rawMaterialImported"] = "RawMaterialImported",
        ["outsourcedProcesses"] = "OutsourcedProcesses",
        ["energySources"] = "EnergySources",
        ["monthlyManufacturingCapacityUnits"] = "ManufacturingCapacityUnits",
        ["monthlyManufacturingCapacityValue"] = "ManufacturingCapacityValue",
        ["monthlyUtilizationUnits"] = "MonthlyUtilizationUnits",
        ["monthlyUtilizationValue"] = "MonthlyUtilizationValue",
    };

    /// <summary>A standard field whose answer an assessor can check through App Forms.</summary>
    public static bool CanValidate(string? formKey, string? fieldKey) =>
        string.Equals(formKey, AppFormCatalogue.MsmeBasicInfo, StringComparison.OrdinalIgnoreCase) && fieldKey is not null && Columns.ContainsKey(fieldKey);

    /// <summary>Why a standard field of a validated form has no "Validation required" switch, or null when it has one.</summary>
    public static string? WhyNot(string formKey, AppField field) =>
        CanValidate(formKey, field.Key) ? null
        : string.Equals(formKey, AppFormCatalogue.AssessorBasicInfo, StringComparison.OrdinalIgnoreCase)
            ? "The agency reviews the site assessor's standard answers on the site assessment page; only the fields you added can be \"Validation required\"."
        : string.Equals(field.Key, "productDetailsList", StringComparison.OrdinalIgnoreCase) || field.Type == AppFieldTypes.Photo
            ? "The assessor already checks this answer on the desktop assessment (Valid / Not valid, with its own NC)."
            : field.Type == AppFieldTypes.Rows
                ? "Repeating entries cannot be \"Validation required\"."
                : "This answer cannot be \"Validation required\".";

    /// <summary>The unit's latest record of the level.</summary>
    public const string ReadSql =
        "SELECT TOP (1) AuditsConducted, DomesticCustomers, InternationalCustomers, RawMaterialImported, OutsourcedProcesses, EnergySources, " +
        "ManufacturingCapacityUnits, ManufacturingCapacityValue, MonthlyUtilizationUnits, MonthlyUtilizationValue " +
        "FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @CertificationType ORDER BY Id DESC;";

    /// <summary>The corrected answer into the unit's latest record of the level (<paramref name="column"/> from <see cref="Columns"/> only).</summary>
    public static string WriteSql(string column) =>
        Columns.Values.Contains(column, StringComparer.Ordinal)
            ? $"UPDATE dbo.MsmeCertifications SET {column} = @Value WHERE Id = (SELECT TOP (1) Id FROM dbo.MsmeCertifications " +
              "WHERE ZedId = @ZedId AND Certification = @CertificationType ORDER BY Id DESC);"
            : throw new ArgumentException("Not a Basic Information column.", nameof(column));

    /// <summary>
    /// The answer copied for the check: a new row, or the current answer into a row not yet checked in this round and with no
    /// NC (the unit may have changed its basic information since). A row already checked, or with an NC, is left as it is.
    /// </summary>
    public const string CopySql =
        "MERGE dbo.V4AppFormValues AS t " +
        "USING (SELECT @FormKey AS FormKey, @ZedId AS ZedId, @CertificationType AS CertificationType, @FieldKey AS FieldKey) AS s " +
        "ON t.FormKey = s.FormKey AND t.ZedId = s.ZedId AND t.CertificationType = s.CertificationType AND t.FieldKey = s.FieldKey " +
        "WHEN MATCHED AND t.NcRound IS NULL AND NOT (ISNULL(t.ValidStage, '') = @Stage AND ISNULL(t.ValidRound, -1) = @Round) " +
        "AND ISNULL(t.Value, N'') <> ISNULL(@Value, N'') THEN UPDATE SET Value = @Value, UpdatedOn = SYSUTCDATETIME() " +
        "WHEN NOT MATCHED AND @Value IS NOT NULL THEN INSERT (FormKey, ZedId, CertificationType, FieldKey, Value, SubmittedBy, UpdatedOn) " +
        "VALUES (@FormKey, @ZedId, @CertificationType, @FieldKey, @Value, 'standard', SYSUTCDATETIME());";

    /// <summary>The stored form of a record's answer (as App Forms stores it): energy sources as a JSON array, the rest as text.</summary>
    public static string? ToStored(string key, string? recorded)
    {
        var v = recorded?.Trim();
        if (string.IsNullOrEmpty(v)) return null;
        if (!string.Equals(key, "energySources", StringComparison.OrdinalIgnoreCase)) return v;
        var items = v.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return items.Length == 0 ? null : JsonSerializer.Serialize(items);
    }

    /// <summary>The record's form of a stored answer: energy sources comma-separated (as the app's procedure writes them).</summary>
    public static string? ToRecorded(string key, string? stored)
    {
        if (string.IsNullOrWhiteSpace(stored)) return null;
        if (!string.Equals(key, "energySources", StringComparison.OrdinalIgnoreCase) || !stored.TrimStart().StartsWith('[')) return stored.Trim();
        try
        {
            return string.Join(",", JsonSerializer.Deserialize<string[]>(stored) ?? []);
        }
        catch (JsonException)
        {
            return stored.Trim();
        }
    }
}
