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
        var rendered = custom is { Enabled: true, BodyHtml: { Length: > 0 } body }
            ? EmailPlaceholders.Fill(body, fields, html: true, new Dictionary<string, string> { [EmailPlaceholders.StandardBody] = html })
            : html;
        EmailTemplateContext.Note(rendered, new EmailTemplateContext.Current(key, fields, custom));
        return rendered;
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
