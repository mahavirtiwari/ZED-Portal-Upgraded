using System.Collections;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.ApplicationModels;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.Extensions.Logging;

namespace Zed.Core.Mobile;

/// <summary>
/// Everything a request carries (query string, route values, JSON body, form fields), merged into
/// one case-insensitive JSON tree with the MVC 5 precedence: form, then JSON body, then route
/// values, then query string. Form keys such as <c>deviceInfo.deviceId</c> and
/// <c>photos[0].photoId</c> become nested objects and arrays, as the MVC binder read them.
/// </summary>
public sealed class LegacyRequestValues
{
    private static readonly object ItemKey = new();
    private static readonly JsonNodeOptions NodeOptions = new() { PropertyNameCaseInsensitive = true };

    private LegacyRequestValues(JsonNode root, IFormFileCollection files)
    {
        Root = root;
        Files = files;
    }

    /// <summary>A JSON object, or a JSON array when the body was a top-level array.</summary>
    public JsonNode Root { get; }

    public IFormFileCollection Files { get; }

    /// <summary>Value of a top-level field, case-insensitively.</summary>
    public JsonNode? Get(string name) => Root is JsonObject o && o.TryGetPropertyValue(name, out var v) ? v : null;

    public static async Task<LegacyRequestValues> GetAsync(HttpContext http)
    {
        if (http.Items.TryGetValue(ItemKey, out var cached)) return (LegacyRequestValues)cached!;

        var root = new JsonObject(NodeOptions);
        JsonNode result = root;
        IFormFileCollection files = new FormFileCollection();

        // Lowest precedence first; later sources overwrite.
        foreach (var (key, values) in http.Request.Query) Set(root, key, values);
        foreach (var (key, value) in http.Request.RouteValues)
        {
            if (key is "controller" or "action" || value is null) continue;
            Set(root, key, [value.ToString()]);
        }

        var request = http.Request;
        if (request.ContentType?.StartsWith("application/json", StringComparison.OrdinalIgnoreCase) == true)
        {
            JsonNode? body;
            try
            {
                body = await JsonNode.ParseAsync(request.Body, NodeOptions,
                    new JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip, MaxDepth = 64 },
                    http.RequestAborted);
            }
            catch (JsonException)
            {
                // MVC 5 failed the same way: no values from the body.
                body = null;
            }
            if (body is JsonObject bodyObject) Merge(root, bodyObject);
            else if (body is JsonArray bodyArray) result = root.Count == 0 ? bodyArray : root;
        }
        else if (request.HasFormContentType)
        {
            var form = await request.ReadFormAsync(http.RequestAborted);
            foreach (var (key, values) in form) Set(root, key, values);
            files = form.Files;
        }

        var parsed = new LegacyRequestValues(Normalize(result), files);
        http.Items[ItemKey] = parsed;
        return parsed;
    }

    private static void Set(JsonObject root, string key, IEnumerable<string?> values)
    {
        var list = values.Where(v => v is not null).ToList();
        if (list.Count == 0) return;
        JsonNode leaf = list.Count == 1 ? JsonValue.Create(list[0])! : new JsonArray(list.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());

        var path = ParsePath(key);
        if (path.Count == 0) return;
        var node = root;
        for (var i = 0; i < path.Count - 1; i++)
        {
            if (node[path[i]] is not JsonObject child)
            {
                child = new JsonObject(NodeOptions);
                node[path[i]] = child;
            }
            node = child;
        }
        node[path[^1]] = leaf;
    }

    /// <summary>"photos[0].file_data" and "photos[0][file_data]" both become photos / 0 / file_data.</summary>
    internal static List<string> ParsePath(string key)
    {
        var parts = new List<string>();
        var current = new System.Text.StringBuilder();
        foreach (var ch in key)
        {
            if (ch is '.' or '[' or ']')
            {
                if (current.Length > 0) parts.Add(current.ToString());
                current.Clear();
            }
            else current.Append(ch);
        }
        if (current.Length > 0) parts.Add(current.ToString());
        return parts;
    }

    private static void Merge(JsonObject target, JsonObject source)
    {
        foreach (var (key, value) in source.ToList())
        {
            if (value is JsonObject so && target[key] is JsonObject to) Merge(to, so);
            else target[key] = value?.DeepClone();
        }
    }

    /// <summary>Objects whose keys are all indexes (from form keys like photos[0]) become arrays.</summary>
    private static JsonNode Normalize(JsonNode node)
    {
        switch (node)
        {
            case JsonObject o:
                foreach (var (key, value) in o.ToList())
                    if (value is not null) o[key] = Normalize(value.DeepClone());
                if (o.Count > 0 && o.All(kv => int.TryParse(kv.Key, out var i) && i >= 0))
                {
                    var items = o.OrderBy(kv => int.Parse(kv.Key)).Select(kv => kv.Value?.DeepClone()).ToArray();
                    return new JsonArray(items);
                }
                return o;
            case JsonArray a:
                for (var i = 0; i < a.Count; i++)
                    if (a[i] is { } item) a[i] = Normalize(item.DeepClone());
                return a;
            default:
                return node;
        }
    }
}

/// <summary>
/// Binds action parameters the way MVC 5 did: a complex parameter reads the whole request (or
/// the object under its own name), a simple parameter reads the field of the same name, and
/// <see cref="IFormFile"/> values (including ones nested in the model, e.g. photos[0].file_data)
/// come from the uploaded files. A complex model is never null, as in MVC 5.
/// </summary>
public sealed class LegacyModelBinder(ILogger<LegacyModelBinder> logger) : IModelBinder
{
    public async Task BindModelAsync(ModelBindingContext ctx)
    {
        var values = await LegacyRequestValues.GetAsync(ctx.HttpContext);
        var name = ctx.FieldName;
        var type = ctx.ModelType;

        if (IsFileType(type))
        {
            ctx.Result = ModelBindingResult.Success(FilesFor(values.Files, name, type));
            return;
        }

        JsonNode? node;
        var simple = IsSimple(type);
        if (simple) node = values.Get(name);
        else node = values.Get(name) is JsonObject or JsonArray ? values.Get(name) : values.Root;

        object? model = null;
        try
        {
            if (node is not null) model = node.Deserialize(type, LegacyJson.Read);
        }
        catch (Exception ex) when (ex is JsonException or NotSupportedException or InvalidOperationException)
        {
            logger.LogInformation("Could not bind parameter {Name} as {Type}: {Error}", name, type.Name, ex.Message);
        }

        if (model is null && !simple && type.GetConstructor(Type.EmptyTypes) is not null && !type.IsAbstract)
            model = Activator.CreateInstance(type);

        if (model is not null && !simple && values.Files.Count > 0)
        {
            var prefix = values.Get(name) is JsonObject ? name : null;
            AssignNestedFiles(model, values.Files, prefix);
        }

        ctx.Result = ModelBindingResult.Success(model);
    }

    private static bool IsSimple(Type t)
    {
        t = Nullable.GetUnderlyingType(t) ?? t;
        return t.IsPrimitive || t.IsEnum || t == typeof(string) || t == typeof(decimal) || t == typeof(DateTime) || t == typeof(Guid);
    }

    private static bool IsFileType(Type t) =>
        t == typeof(IFormFile) || typeof(IEnumerable<IFormFile>).IsAssignableFrom(t);

    private static object? FilesFor(IFormFileCollection files, string name, Type type)
    {
        var matching = files.Where(f => string.Equals(f.Name, name, StringComparison.OrdinalIgnoreCase)
                                        || f.Name.StartsWith(name + "[", StringComparison.OrdinalIgnoreCase)).ToList();
        if (type == typeof(IFormFile)) return matching.FirstOrDefault();
        // MVC 5 gave an empty list's worth of nothing as null for List<HttpPostedFileBase> when no file was posted.
        if (matching.Count == 0) return null;
        if (type.IsArray) return matching.ToArray();
        return matching;
    }

    /// <summary>Files posted as e.g. "photos[0].file_data" or "request.file_data" land on the model's IFormFile properties.</summary>
    private static void AssignNestedFiles(object model, IFormFileCollection files, string? prefix)
    {
        foreach (var file in files)
        {
            var path = LegacyRequestValues.ParsePath(file.Name);
            if (prefix is not null)
            {
                if (path.Count < 2 || !string.Equals(path[0], prefix, StringComparison.OrdinalIgnoreCase)) continue;
                path.RemoveAt(0);
            }
            if (path.Count == 0) continue;
            TryAssign(model, path, 0, file);
        }
    }

    private static void TryAssign(object target, List<string> path, int index, IFormFile file)
    {
        if (target is IList list)
        {
            if (!int.TryParse(path[index], out var i) || i < 0 || i >= list.Count || list[i] is not { } item) return;
            if (index + 1 < path.Count) TryAssign(item, path, index + 1, file);
            return;
        }

        var prop = target.GetType().GetProperty(path[index],
            BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
        if (prop is null) return;

        if (index == path.Count - 1)
        {
            if (prop.PropertyType == typeof(IFormFile) && prop.CanWrite) prop.SetValue(target, file);
            else if (prop.PropertyType == typeof(List<IFormFile>) && prop.CanWrite)
            {
                var existing = prop.GetValue(target) as List<IFormFile> ?? [];
                existing.Add(file);
                prop.SetValue(target, existing);
            }
            return;
        }
        if (prop.GetValue(target) is { } child) TryAssign(child, path, index + 1, file);
    }
}

/// <summary>Applies <see cref="LegacyModelBinder"/> to every parameter of the controller it marks (inherited).</summary>
[AttributeUsage(AttributeTargets.Class, Inherited = true)]
public sealed class LegacyBindingAttribute : Attribute, IControllerModelConvention
{
    public void Apply(ControllerModel controller)
    {
        foreach (var action in controller.Actions)
        foreach (var p in action.Parameters)
        {
            // [FromServices], [FromBody] and the like keep their own binding.
            if (p.ParameterType == typeof(CancellationToken) || p.BindingInfo?.BindingSource is not null) continue;
            p.BindingInfo ??= new BindingInfo();
            p.BindingInfo.BinderType = typeof(LegacyModelBinder);
            p.BindingInfo.BindingSource = BindingSource.Custom;
        }
    }
}
