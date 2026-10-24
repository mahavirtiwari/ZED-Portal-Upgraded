using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Zed.Core.Http;

namespace Zed.Core.Security;

/// <summary>
/// Success or refusal of an executed action, as the audit filters record it: the signed-in user (CurrentUserResponse,
/// also inside a response), a ProblemDetails refusal, the apps' legacy JSON (status "1" / "0", errorMessage) or the
/// status code.
/// </summary>
public static class ActionOutcome
{
    public static (bool Success, string? Reason, CurrentUserResponse? User, string? SignedInId) Read(ActionExecutedContext executed)
    {
        if (executed.Exception is not null && !executed.ExceptionHandled) return (false, null, null, null);
        switch (executed.Result)
        {
            case ObjectResult { Value: CurrentUserResponse u }:
                return (true, null, u, null);
            case ObjectResult { Value: ProblemDetails p }:
                return (false, p.Title, null, null);
            case ObjectResult { Value: { } value } o when o.StatusCode is null or (>= 200 and < 300):
                // A response that carries the user (Udyami Bharat) or the new ZED ID (registration).
                var inner = value.GetType().GetProperties().Select(p => p.GetValue(value)).OfType<CurrentUserResponse>().FirstOrDefault();
                return (true, null, inner, inner is null ? Property(value, "ZedId") as string ?? Property(value, "UserId") as string : null);
            case ContentResult { Content: { Length: > 0 } json }:
                try
                {
                    using var doc = JsonDocument.Parse(json);
                    var root = doc.RootElement;
                    var status = root.TryGetProperty("status", out var s) ? s.ToString() : null;
                    var message = root.TryGetProperty("errorMessage", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() : null;
                    return (status == "1", message, null, null);
                }
                catch (JsonException)
                {
                    return (false, "Unreadable response", null, null);
                }
            case IStatusCodeActionResult { StatusCode: { } code }:
                return (code is >= 200 and < 300, $"HTTP {code}", null, null);
            default:
                return (false, null, null, null);
        }
    }

    public static object? Property(object? obj, string property) =>
        obj?.GetType().GetProperty(property, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase)?.GetValue(obj);
}
