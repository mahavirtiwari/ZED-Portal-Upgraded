using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.Extensions.Logging;

namespace Zed.Core.Email;

/// <summary>
/// Renders Razor components (.razor) to HTML for e-mail bodies. Replaces the legacy
/// RenderPartialViewToString over MVC partial views.
/// </summary>
public interface IHtmlTemplateRenderer
{
    Task<string> RenderAsync<TComponent>(IDictionary<string, object?> parameters) where TComponent : IComponent;
}

public sealed class HtmlTemplateRenderer(IServiceProvider services, ILoggerFactory loggerFactory) : IHtmlTemplateRenderer
{
    public async Task<string> RenderAsync<TComponent>(IDictionary<string, object?> parameters) where TComponent : IComponent
    {
        await using var renderer = new HtmlRenderer(services, loggerFactory);
        return await renderer.Dispatcher.InvokeAsync(async () =>
        {
            var output = await renderer.RenderComponentAsync<TComponent>(ParameterView.FromDictionary(parameters));
            return output.ToHtmlString();
        });
    }
}
