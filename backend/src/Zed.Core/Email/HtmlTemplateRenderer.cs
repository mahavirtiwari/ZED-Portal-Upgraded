using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Zed.Core.Email;

/// <summary>
/// Renders Razor components (.razor) to HTML for e-mail bodies. Replaces the legacy
/// RenderPartialViewToString over MVC partial views.
/// </summary>
public interface IHtmlTemplateRenderer
{
    Task<string> RenderAsync<TComponent>(IDictionary<string, object?> parameters) where TComponent : IComponent;

    /// <summary>
    /// A mail whose text is built in code (inside <c>EmailLayout</c>) under its own Email Templates key, with
    /// <paramref name="values"/> as further {{Placeholder}} fields.
    /// </summary>
    Task<string> RenderAsync<TComponent>(string key, IDictionary<string, object?> parameters, IReadOnlyDictionary<string, object?>? values = null)
        where TComponent : IComponent => RenderAsync<TComponent>(parameters);
}

public sealed class HtmlTemplateRenderer(IServiceProvider services, ILoggerFactory loggerFactory) : IHtmlTemplateRenderer
{
    /// <summary>
    /// The standard e-mail, or the Admin's own body for this template (Email Templates, <see cref="IEmailTemplateStore"/>)
    /// with its {{Placeholder}} fields filled. Notes the template for <see cref="TemplatedEmailSender"/>.
    /// </summary>
    public Task<string> RenderAsync<TComponent>(IDictionary<string, object?> parameters) where TComponent : IComponent =>
        RenderAsync<TComponent>(typeof(TComponent).Name, parameters);

    public async Task<string> RenderAsync<TComponent>(string key, IDictionary<string, object?> parameters, IReadOnlyDictionary<string, object?>? values = null)
        where TComponent : IComponent
    {
        var html = await RenderStandardAsync<TComponent>(parameters);
        var custom = services.GetService<IEmailTemplateStore>() is { } store ? await store.GetAsync(key) : null;
        var fields = new Dictionary<string, object?>(parameters, StringComparer.OrdinalIgnoreCase);
        foreach (var (name, value) in values ?? new Dictionary<string, object?>()) fields[name] = value;
        var useCustom = custom is { Enabled: true, BodyHtml: { Length: > 0 } } && !DropsEssential(custom.BodyHtml!, fields);
        if (custom is { Enabled: true, BodyHtml: { Length: > 0 } } && !useCustom)
            loggerFactory.CreateLogger<HtmlTemplateRenderer>().LogWarning(
                "E-mail template {Key}: the Admin's text leaves out the password or set-password link this e-mail carries; the standard text is sent", key);
        var rendered = useCustom
            ? EmailPlaceholders.Fill(custom!.BodyHtml!, fields, html: true, new Dictionary<string, string> { [EmailPlaceholders.StandardBody] = html })
            : html;
        EmailTemplateContext.Note(rendered, new EmailTemplateContext.Current(key, fields, custom));
        return rendered;
    }

    /// <summary>Fields a mail cannot go without when it carries them (the recipient could not sign in).</summary>
    private static readonly string[] Essential = ["SetPasswordUrl", "Password", "ResetUrl"];

    /// <summary>The Admin's body neither keeps the standard text nor uses a non-empty essential field (2026-11-08).</summary>
    private static bool DropsEssential(string body, IReadOnlyDictionary<string, object?> fields)
    {
        var used = EmailPlaceholders.Used(body).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (used.Contains(EmailPlaceholders.StandardBody)) return false;
        return Essential.Any(e => fields.TryGetValue(e, out var v) && v is string { Length: > 0 } && !used.Contains(e));
    }

    /// <summary>The template as written, without the Admin's changes.</summary>
    public async Task<string> RenderStandardAsync<TComponent>(IDictionary<string, object?> parameters) where TComponent : IComponent
    {
        await using var renderer = new HtmlRenderer(services, loggerFactory);
        return await renderer.Dispatcher.InvokeAsync(async () =>
        {
            var output = await renderer.RenderComponentAsync<TComponent>(ParameterView.FromDictionary(parameters));
            return output.ToHtmlString();
        });
    }
}
