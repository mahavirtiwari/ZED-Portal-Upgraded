using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal;

// Surveillance system API. Shares sign-in, data access, e-mail and hosting with the other two systems
// through Zed.Core, and the portal features with Main through Zed.Portal: a feature is served here once it is
// marked [PortalSystems(..., PortalSystem.Surveillance)] after checking it against this system's procedures.
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddZedPlatform(builder.Configuration, ZedDatabases.Surveillance, authCookieName: "zed.surveillance");
builder.AddPortal(PortalSystem.Surveillance);

var app = builder.Build();
// The old portal ran as the IIS application under Portal:PathBase (/Consultancy, /surveillance); links in
// mails already sent and bookmarks use it. Under IIS the module sets the path base itself and this is a no-op;
// behind a reverse proxy or on plain Kestrel it strips the prefix. Routing must run after it.
if (app.Configuration["Portal:PathBase"] is { Length: > 1 } pathBase)
{
    app.UsePathBase(pathBase.TrimEnd('/'));
    app.UseRouting();
}
app.UseZedPlatform();
app.Run();

public partial class Program;
