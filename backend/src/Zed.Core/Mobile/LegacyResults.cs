using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;

namespace Zed.Core.Mobile;

/// <summary>The legacy services' base response (DataModels.ServiceResponse).</summary>
public class ServiceResponse
{
    public string? status { get; set; }
    public string? errorMessage { get; set; }
    public string? refId { get; set; }
    public string? token { get; set; }

    public static ServiceResponse Fail(string message) => new() { status = "0", errorMessage = message };
    public static ServiceResponse Ok(string? message = null) => new() { status = "1", errorMessage = message };
}

public static class LegacyResults
{
    /// <summary>MVC 5 <c>Json(value)</c>: application/json, JavaScriptSerializer layout.</summary>
    public static ContentResult Json(object? value) => new()
    {
        Content = JsonSerializer.Serialize(value, value?.GetType() ?? typeof(object), LegacyJson.Write),
        ContentType = "application/json; charset=utf-8",
        StatusCode = 200,
    };

    /// <summary>
    /// MVC 5 <c>Content(text)</c>, which the old services used for Newtonsoft output; with no
    /// content type MVC sent text/html.
    /// </summary>
    public static ContentResult Content(string text, string? contentType = null) => new()
    {
        Content = text,
        ContentType = (contentType ?? "text/html") + "; charset=utf-8",
        StatusCode = 200,
    };

    /// <summary>
    /// <c>JsonConvert.SerializeObject(dataSet)</c> after naming the tables: an object with one
    /// array of rows per result set. Unnamed sets are "Table", "Table1", ... as in a DataSet.
    /// Password, OTP and token columns are left out unless <paramref name="keepSensitive"/> is set.
    /// </summary>
    public static string DataSetJson(ResultSets sets, IReadOnlyList<string>? names = null, bool keepSensitive = false)
    {
        using var stream = new MemoryStream();
        using (var w = new Utf8JsonWriter(stream, new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
        {
            w.WriteStartObject();
            for (var i = 0; i < sets.Count; i++)
            {
                var name = names is not null && i < names.Count ? names[i] : i == 0 ? "Table" : "Table" + i;
                w.WritePropertyName(name);
                WriteRows(w, sets[i], keepSensitive);
            }
            w.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    /// <summary><c>JsonConvert.SerializeObject(dataTable)</c>: an array of row objects.</summary>
    public static string DataTableJson(IReadOnlyList<IDictionary<string, object?>> rows, bool keepSensitive = false)
    {
        using var stream = new MemoryStream();
        using (var w = new Utf8JsonWriter(stream, new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
            WriteRows(w, rows, keepSensitive);
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static void WriteRows(Utf8JsonWriter w, IReadOnlyList<IDictionary<string, object?>> rows, bool keepSensitive)
    {
        w.WriteStartArray();
        foreach (var row in rows)
        {
            w.WriteStartObject();
            foreach (var (key, value) in row)
            {
                if (!keepSensitive && ResultSets.SensitiveColumns.Contains(key)) continue;
                w.WritePropertyName(key);
                WriteNewtonsoftValue(w, value);
            }
            w.WriteEndObject();
        }
        w.WriteEndArray();
    }

    /// <summary>Newtonsoft's default formats: ISO dates without zone, decimals always with a decimal point.</summary>
    internal static void WriteNewtonsoftValue(Utf8JsonWriter w, object? value)
    {
        switch (value)
        {
            case null or DBNull: w.WriteNullValue(); break;
            case string s: w.WriteStringValue(s); break;
            case bool b: w.WriteBooleanValue(b); break;
            case DateTime d: w.WriteStringValue(NewtonsoftDate(d)); break;
            case DateTimeOffset o: w.WriteStringValue(o.ToString("yyyy'-'MM'-'dd'T'HH':'mm':'ss.FFFFFFFzzz", CultureInfo.InvariantCulture)); break;
            case decimal m: w.WriteRawValue(EnsureDecimalPlace(m.ToString(CultureInfo.InvariantCulture))); break;
            case double db: w.WriteRawValue(EnsureDecimalPlace(db.ToString("R", CultureInfo.InvariantCulture))); break;
            case float f: w.WriteRawValue(EnsureDecimalPlace(f.ToString("R", CultureInfo.InvariantCulture))); break;
            case byte[] bytes: w.WriteBase64StringValue(bytes); break;
            case Guid g: w.WriteStringValue(g.ToString()); break;
            case TimeSpan t: w.WriteStringValue(t.ToString()); break;
            case IConvertible c when value.GetType().IsPrimitive:
                w.WriteRawValue(c.ToString(CultureInfo.InvariantCulture)); break;
            default: w.WriteStringValue(Convert.ToString(value, CultureInfo.InvariantCulture)); break;
        }
    }

    internal static string NewtonsoftDate(DateTime d)
    {
        var text = d.ToString("yyyy'-'MM'-'dd'T'HH':'mm':'ss.FFFFFFF", CultureInfo.InvariantCulture);
        return d.Kind switch
        {
            DateTimeKind.Utc => text + "Z",
            DateTimeKind.Local => text + d.ToString("zzz", CultureInfo.InvariantCulture),
            _ => text,
        };
    }

    private static string EnsureDecimalPlace(string text) =>
        text.Contains('.') || text.Contains('E') || text.Contains("Infinity") || text == "NaN" ? text : text + ".0";
}
