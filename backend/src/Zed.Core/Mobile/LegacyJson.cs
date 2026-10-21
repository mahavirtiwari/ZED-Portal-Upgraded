using System.Buffers;
using System.Globalization;
using System.Numerics;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Unicode;

namespace Zed.Core.Mobile;

/// <summary>
/// JSON settings that reproduce what the old ASP.NET MVC 5 services sent and accepted, so the
/// installed mobile apps keep working without an update.
/// </summary>
public static class LegacyJson
{
    /// <summary>
    /// Output of MVC <c>Json(...)</c> (JavaScriptSerializer): property names exactly as declared,
    /// nulls included, enums as numbers, public fields included, dates as <c>"\/Date(ms)\/"</c>.
    /// </summary>
    public static readonly JsonSerializerOptions Write = new()
    {
        PropertyNamingPolicy = null,
        DictionaryKeyPolicy = null,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        IncludeFields = true,
        MaxDepth = 100,
        // JavaScriptSerializer escapes < > & ' but leaves non-ASCII text (Hindi names) as is.
        Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
        Converters = { new MsDateConverter(), new MsNullableDateConverter() },
    };

    /// <summary>
    /// Input as the MVC model binder accepted it: names in any case, numbers and booleans sent as
    /// strings (and the other way round), empty strings as "not given", a single value where a list
    /// is expected.
    /// </summary>
    public static readonly JsonSerializerOptions Read = CreateReadOptions();

    private static JsonSerializerOptions CreateReadOptions()
    {
        var o = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            IncludeFields = true,
            AllowTrailingCommas = true,
            ReadCommentHandling = JsonCommentHandling.Skip,
            UnmappedMemberHandling = JsonUnmappedMemberHandling.Skip,
            MaxDepth = 64,
        };
        o.Converters.Add(new LenientStringConverter());
        o.Converters.Add(new LenientBooleanConverter());
        o.Converters.Add(new LenientNumberConverterFactory());
        o.Converters.Add(new LenientDateConverter());
        o.Converters.Add(new LenientEnumConverterFactory());
        o.Converters.Add(new SingleOrListConverterFactory());
        return o;
    }

    /// <summary>Text of a JSON scalar the way the MVC binder saw it (numbers and booleans as text).</summary>
    internal static string? ScalarText(ref Utf8JsonReader reader) => reader.TokenType switch
    {
        JsonTokenType.String => reader.GetString(),
        JsonTokenType.Number => reader.HasValueSequence
            ? Encoding.UTF8.GetString(reader.ValueSequence.ToArray())
            : Encoding.UTF8.GetString(reader.ValueSpan),
        JsonTokenType.True => "True",
        JsonTokenType.False => "False",
        _ => null,
    };

    /// <summary>
    /// Reads one value; for an array the first element counts (MVC took the first of several
    /// values for a single field); objects bind to nothing.
    /// </summary>
    internal static string? ReadScalarOrFirst(ref Utf8JsonReader reader)
    {
        switch (reader.TokenType)
        {
            case JsonTokenType.StartArray:
                string? first = null;
                var seen = false;
                while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
                {
                    if (!seen && reader.TokenType is not (JsonTokenType.StartArray or JsonTokenType.StartObject))
                    {
                        first = ScalarText(ref reader);
                        seen = true;
                    }
                    else reader.Skip();
                }
                return first;
            case JsonTokenType.StartObject:
                reader.Skip();
                return null;
            default:
                return ScalarText(ref reader);
        }
    }
}

/// <summary>JavaScriptSerializer date format: milliseconds since 1970 UTC, local times converted first.</summary>
public sealed class MsDateConverter : JsonConverter<DateTime>
{
    private static readonly long EpochTicks = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).Ticks;

    public static string Format(DateTime value)
    {
        var utc = value.Kind == DateTimeKind.Utc ? value : value.ToUniversalTime();
        return "\\/Date(" + ((utc.Ticks - EpochTicks) / TimeSpan.TicksPerMillisecond).ToString(CultureInfo.InvariantCulture) + ")\\/";
    }

    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        LenientDateConverter.Parse(LegacyJson.ScalarText(ref reader)) ?? default;

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options) =>
        writer.WriteRawValue("\"" + Format(value) + "\"", skipInputValidation: true);
}

public sealed class MsNullableDateConverter : JsonConverter<DateTime?>
{
    public override bool HandleNull => true;

    public override DateTime? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        LenientDateConverter.Parse(LegacyJson.ScalarText(ref reader));

    public override void Write(Utf8JsonWriter writer, DateTime? value, JsonSerializerOptions options)
    {
        if (value is null) writer.WriteNullValue();
        else writer.WriteRawValue("\"" + MsDateConverter.Format(value.Value) + "\"", skipInputValidation: true);
    }
}

internal sealed class LenientStringConverter : JsonConverter<string>
{
    public override bool HandleNull => true;

    public override string? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.TokenType == JsonTokenType.Null ? null : LegacyJson.ReadScalarOrFirst(ref reader);

    public override void Write(Utf8JsonWriter writer, string value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value);
}

internal sealed class LenientBooleanConverter : JsonConverter<bool>
{
    public override bool Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        Parse(LegacyJson.ReadScalarOrFirst(ref reader)) ?? false;

    // A checkbox posts "true,false"; the first value counts.
    internal static bool? Parse(string? s) => s?.Split(',')[0].Trim().ToLowerInvariant() switch
    {
        "true" or "1" or "on" => true,
        "false" or "0" or "off" => false,
        _ => null,
    };

    public override void Write(Utf8JsonWriter writer, bool value, JsonSerializerOptions options) =>
        writer.WriteBooleanValue(value);
}

internal sealed class LenientDateConverter : JsonConverter<DateTime>
{
    private static readonly string[] Formats =
        ["dd/MM/yyyy", "dd-MM-yyyy", "dd/MM/yyyy HH:mm:ss", "dd-MM-yyyy HH:mm:ss", "dd/MM/yyyy hh:mm:ss tt", "dd-MMM-yyyy"];

    internal static DateTime? Parse(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = s.Trim();
        if (s.StartsWith("/Date(", StringComparison.Ordinal) || s.StartsWith("\\/Date(", StringComparison.Ordinal))
        {
            var start = s.IndexOf('(') + 1;
            var end = s.IndexOfAny(['+', '-', ')'], start + 1);
            if (end > start && long.TryParse(s[start..end], NumberStyles.Integer, CultureInfo.InvariantCulture, out var ms))
                return DateTime.UnixEpoch.AddMilliseconds(ms).ToLocalTime();
            return null;
        }
        if (DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var d)) return d;
        if (DateTime.TryParseExact(s, Formats, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out d)) return d;
        return null;
    }

    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        Parse(LegacyJson.ReadScalarOrFirst(ref reader)) ?? default;

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value);
}

/// <summary>int, long, decimal, double, ... and their nullable forms; "" and unparsable text mean "not given".</summary>
internal sealed class LenientNumberConverterFactory : JsonConverterFactory
{
    public override bool CanConvert(Type t)
    {
        var u = Nullable.GetUnderlyingType(t) ?? t;
        return u == typeof(int) || u == typeof(long) || u == typeof(short) || u == typeof(byte) ||
               u == typeof(decimal) || u == typeof(double) || u == typeof(float);
    }

    public override JsonConverter CreateConverter(Type t, JsonSerializerOptions options)
    {
        var u = Nullable.GetUnderlyingType(t);
        return (JsonConverter)Activator.CreateInstance(u is null
            ? typeof(LenientNumberConverter<>).MakeGenericType(t)
            : typeof(LenientNullableNumberConverter<>).MakeGenericType(u))!;
    }

    internal static bool TryParse<T>(string? s, out T value) where T : struct, INumber<T>
    {
        value = default;
        if (string.IsNullOrWhiteSpace(s)) return false;
        var style = typeof(T) == typeof(decimal) || typeof(T) == typeof(double) || typeof(T) == typeof(float)
            ? NumberStyles.Float | NumberStyles.AllowThousands
            : NumberStyles.Integer;
        return T.TryParse(s.Trim(), style, CultureInfo.InvariantCulture, out value);
    }
}

internal sealed class LenientNumberConverter<T> : JsonConverter<T> where T : struct, INumber<T>
{
    public override T Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        LenientNumberConverterFactory.TryParse<T>(LegacyJson.ReadScalarOrFirst(ref reader), out var v) ? v : default;

    public override void Write(Utf8JsonWriter writer, T value, JsonSerializerOptions options) =>
        writer.WriteRawValue(value.ToString(null, CultureInfo.InvariantCulture), skipInputValidation: true);
}

internal sealed class LenientNullableNumberConverter<T> : JsonConverter<T?> where T : struct, INumber<T>
{
    public override bool HandleNull => true;

    public override T? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.TokenType == JsonTokenType.Null ? null
        : LenientNumberConverterFactory.TryParse<T>(LegacyJson.ReadScalarOrFirst(ref reader), out var v) ? v : null;

    public override void Write(Utf8JsonWriter writer, T? value, JsonSerializerOptions options)
    {
        if (value is null) writer.WriteNullValue();
        else writer.WriteRawValue(value.Value.ToString(null, CultureInfo.InvariantCulture), skipInputValidation: true);
    }
}

/// <summary>Enums by number or by name; anything else is the default value.</summary>
internal sealed class LenientEnumConverterFactory : JsonConverterFactory
{
    public override bool CanConvert(Type t) => (Nullable.GetUnderlyingType(t) ?? t).IsEnum;

    public override JsonConverter CreateConverter(Type t, JsonSerializerOptions options) =>
        (JsonConverter)Activator.CreateInstance(typeof(Converter<>).MakeGenericType(t))!;

    private sealed class Converter<T> : JsonConverter<T>
    {
        public override bool HandleNull => true;

        public override T? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var enumType = Nullable.GetUnderlyingType(typeof(T)) ?? typeof(T);
            var s = reader.TokenType == JsonTokenType.Null ? null : LegacyJson.ReadScalarOrFirst(ref reader);
            if (!string.IsNullOrWhiteSpace(s) && Enum.TryParse(enumType, s.Trim(), ignoreCase: true, out var e))
                return (T)e!;
            return default;
        }

        public override void Write(Utf8JsonWriter writer, T value, JsonSerializerOptions options)
        {
            if (value is null) writer.WriteNullValue();
            else writer.WriteNumberValue(Convert.ToInt64(value, CultureInfo.InvariantCulture));
        }
    }
}

/// <summary>Lists and arrays also accept a single value (one form field, one query value).</summary>
internal sealed class SingleOrListConverterFactory : JsonConverterFactory
{
    public override bool CanConvert(Type t) => ElementType(t) is not null;

    internal static Type? ElementType(Type t)
    {
        if (t == typeof(string)) return null;
        if (t.IsArray) return t.GetElementType();
        if (!t.IsGenericType) return null;
        var def = t.GetGenericTypeDefinition();
        return def == typeof(List<>) || def == typeof(IList<>) || def == typeof(IEnumerable<>) ||
               def == typeof(ICollection<>) || def == typeof(IReadOnlyList<>) || def == typeof(IReadOnlyCollection<>)
            ? t.GetGenericArguments()[0]
            : null;
    }

    public override JsonConverter CreateConverter(Type t, JsonSerializerOptions options) =>
        (JsonConverter)Activator.CreateInstance(typeof(Converter<,>).MakeGenericType(t, ElementType(t)!))!;

    private sealed class Converter<TList, TItem> : JsonConverter<TList>
    {
        public override TList? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var items = new List<TItem>();
            if (reader.TokenType == JsonTokenType.StartArray)
            {
                while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
                    items.Add(JsonSerializer.Deserialize<TItem>(ref reader, options)!);
            }
            else if (reader.TokenType == JsonTokenType.String && reader.GetString() is "")
            {
                return default;
            }
            else
            {
                items.Add(JsonSerializer.Deserialize<TItem>(ref reader, options)!);
            }
            return typeof(TList).IsArray ? (TList)(object)items.ToArray() : (TList)(object)items;
        }

        public override void Write(Utf8JsonWriter writer, TList value, JsonSerializerOptions options)
        {
            writer.WriteStartArray();
            foreach (var item in (IEnumerable<TItem>)value!) JsonSerializer.Serialize(writer, item, options);
            writer.WriteEndArray();
        }
    }
}
