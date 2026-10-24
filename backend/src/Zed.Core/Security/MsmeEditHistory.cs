using System.Collections;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;

namespace Zed.Core.Security;

/// <summary>
/// One change an applicant (MSME) made, on the web or in the MSME app (ZEDCS_V2_LIVE.dbo.V4MsmeEditHistory, migration 0014,
/// written and read by three-part name from every host).
/// </summary>
public sealed record MsmeEdit
{
    public string Channel { get; init; } = LoginChannels.Web;
    public required string ZedId { get; init; }
    public required string Action { get; init; }
    public string? Path { get; init; }
    public bool Success { get; init; }
    public string? Message { get; init; }
    /// <summary>The submitted values (JSON), secrets masked and files listed by name and size.</summary>
    public string? Data { get; init; }
    public string? IpAddress { get; init; }
    public string? DeviceId { get; init; }
    public string? UserAgent { get; init; }
}

public sealed record MsmeEditRow(
    long Id, DateTime At, string Channel, string ZedId, string Action, string? Path, string Result, string? Message, string? Data,
    string? IpAddress, string? DeviceId);

public interface IMsmeEditHistory
{
    /// <summary>Records the change; never fails it (a missing table, 0014 not run, is logged).</summary>
    Task RecordAsync(MsmeEdit e, CancellationToken ct = default);

    /// <summary>The changes of a ZED ID (and of its _DEL / _D_ copies), newest first.</summary>
    Task<(IReadOnlyList<MsmeEditRow> Rows, int Total)> ListAsync(string zedId, int pageNo, int pageSize, CancellationToken ct = default);
}

public sealed class SqlMsmeEditHistory(ISqlExecutor db, IServiceProvider services, ILogger<SqlMsmeEditHistory> log) : IMsmeEditHistory
{
    internal const string InsertSql =
        "INSERT INTO ZEDCS_V2_LIVE.dbo.V4MsmeEditHistory (System, Channel, ZedId, Action, Path, Result, Message, Data, IpAddress, DeviceId, UserAgent) " +
        "VALUES (@System, @Channel, @ZedId, @Action, @Path, @Result, @Message, @Data, @IpAddress, @DeviceId, @UserAgent);";

    internal const string ListSql =
        "SELECT Id, At, Channel, ZedId, Action, Path, Result, Message, Data, IpAddress, DeviceId FROM ZEDCS_V2_LIVE.dbo.V4MsmeEditHistory " +
        "WHERE ZedId = @ZedId ORDER BY Id DESC OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;";

    internal const string CountSql = "SELECT COUNT(*) FROM ZEDCS_V2_LIVE.dbo.V4MsmeEditHistory WHERE ZedId = @ZedId;";

    public async Task RecordAsync(MsmeEdit e, CancellationToken ct = default)
    {
        try
        {
            await db.ExecuteSqlAsync(InsertSql, new
            {
                System = services.GetService<PortalHost>()?.System.ToString() ?? "Mobile API",
                Channel = Cut(e.Channel, 10), ZedId = Cut(e.ZedId, 100), Action = Cut(e.Action, 100), Path = Cut(e.Path, 200),
                Result = e.Success ? "Success" : "Failed", Message = Cut(e.Message, 400), e.Data, IpAddress = Cut(e.IpAddress, 50),
                DeviceId = Cut(e.DeviceId, 200), UserAgent = Cut(e.UserAgent, 400),
            }, ct);
        }
        catch (Exception ex) when (ex is SqlException or InvalidOperationException)
        {
            log.LogWarning(ex, "Could not record the change {Action} of {ZedId} (is migration 0014 applied?)", e.Action, e.ZedId);
        }
    }

    public async Task<(IReadOnlyList<MsmeEditRow> Rows, int Total)> ListAsync(string zedId, int pageNo, int pageSize, CancellationToken ct = default)
    {
        try
        {
            var rows = await db.QuerySqlAsync<MsmeEditRow>(ListSql, new { ZedId = zedId, Skip = (Math.Max(pageNo, 1) - 1) * pageSize, Take = pageSize }, ct);
            var total = await db.QuerySqlAsync<int>(CountSql, new { ZedId = zedId }, ct);
            return (rows, total.Count > 0 ? total[0] : rows.Count);
        }
        catch (SqlException ex)
        {
            log.LogWarning(ex, "Could not read the change history of {ZedId} (is migration 0014 applied?)", zedId);
            return ([], 0);
        }
    }

    private static string? Cut(string? s, int max) => string.IsNullOrWhiteSpace(s) ? null : s.Length <= max ? s.Trim() : s.Trim()[..max];
}

/// <summary>
/// Records the change an applicant's action makes (<see cref="IMsmeEditHistory"/>), with what was submitted. On the web the
/// MSME is the signed-in user (role MSME; other roles are not recorded here); in the MSME app the ZED ID comes from the
/// request (zedId / userName), as the app sends it.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class MsmeEditAuditAttribute(string action) : Attribute, IAsyncActionFilter
{
    public const int MaxData = 8000;

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var http = context.HttpContext;
        var mobile = !http.Request.Path.StartsWithSegments("/api");
        string? zedId;
        if (mobile)
        {
            var body = context.ActionArguments.Values.FirstOrDefault(v => v is not null and not CancellationToken);
            zedId = new[] { "zedId", "userName" }.Select(p => ActionOutcome.Property(body, p) as string).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v))?.Trim();
        }
        else
        {
            var user = ZedUser.FromPrincipal(http.User);
            zedId = user is { RoleId: (int)UserRole.Msme } ? user.UserId : null;
        }
        var data = Snapshot(context.ActionArguments);
        var device = context.ActionArguments.Values.Select(v => ActionOutcome.Property(v, "deviceInfo")).OfType<DeviceInfo>().FirstOrDefault();

        var executed = await next();
        if (string.IsNullOrEmpty(zedId)) return;

        var (success, reason, _, _) = ActionOutcome.Read(executed);
        await http.RequestServices.GetRequiredService<IMsmeEditHistory>().RecordAsync(new MsmeEdit
        {
            Channel = mobile ? LoginChannels.Mobile : LoginChannels.Web,
            ZedId = zedId, Action = action, Path = http.Request.Path.Value, Success = success, Message = reason, Data = data,
            IpAddress = http.Connection.RemoteIpAddress?.ToString(),
            DeviceId = device?.deviceId ?? (http.Request.Cookies.TryGetValue(LoginAuditAttribute.WebDeviceCookie, out var web) ? web : null),
            UserAgent = http.Request.Headers.UserAgent.ToString() is { Length: > 0 } ua ? ua : null,
        }, http.RequestAborted);
    }

    /// <summary>
    /// The action's arguments as JSON: passwords, OTPs, tokens and captcha answers masked, files as name and size, long
    /// texts (photos sent as base64) shortened, the whole at most 8000 characters.
    /// </summary>
    public static string? Snapshot(IDictionary<string, object?> arguments)
    {
        var root = new JsonObject();
        foreach (var (name, value) in arguments)
            if (value is not CancellationToken) root[name] = Node(value, name, 0);
        if (root.Count == 0) return null;
        var json = root.ToJsonString();
        return json.Length <= MaxData ? json : json[..MaxData];
    }

    private static readonly string[] Secret = ["password", "otp", "token", "captcha", "secret", "pin"];

    private static JsonNode? Node(object? value, string name, int depth)
    {
        if (value is null) return null;
        if (Secret.Any(s => name.Contains(s, StringComparison.OrdinalIgnoreCase))) return "***";
        switch (value)
        {
            case string s:
                return s.Length <= 500 ? s : $"[{s.Length} characters]";
            case bool or int or long or decimal or double or float or DateTime or DateTimeOffset or Guid or Enum:
                return JsonValue.Create(value.ToString());
            case IFormFile f:
                return new JsonObject { ["file"] = f.FileName, ["bytes"] = f.Length };
            case IFormFileCollection files:
                return new JsonArray(files.Select(f => (JsonNode?)new JsonObject { ["file"] = f.FileName, ["bytes"] = f.Length }).ToArray());
            case JsonElement je:
                return je.ValueKind == JsonValueKind.String && je.GetString() is { Length: > 500 } ls ? $"[{ls.Length} characters]" : JsonNode.Parse(je.GetRawText());
            case JsonNode jn:
                return JsonNode.Parse(jn.ToJsonString());
        }
        if (depth >= 4) return "…";
        if (value is IDictionary dict)
        {
            var o = new JsonObject();
            foreach (DictionaryEntry e in dict) o[e.Key.ToString()!] = Node(e.Value, e.Key.ToString()!, depth + 1);
            return o;
        }
        if (value is IEnumerable list)
        {
            var a = new JsonArray();
            foreach (var item in list.Cast<object?>().Take(50)) a.Add(Node(item, name, depth + 1));
            return a;
        }
        var obj = new JsonObject();
        foreach (var p in value.GetType().GetProperties().Where(p => p.CanRead && p.GetIndexParameters().Length == 0))
        {
            if (p.Name == "deviceInfo") continue;
            object? v;
            try { v = p.GetValue(value); }
            catch { continue; }
            obj[p.Name] = Node(v, p.Name, depth + 1);
        }
        return obj;
    }
}
