using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal;

// Consultancy system API. Shares sign-in, data access, e-mail and hosting with the other two systems
// through Zed.Core, and the portal features with Main through Zed.Portal: a feature is served here once it is
// marked [PortalSystems(..., PortalSystem.Consultancy)] after checking it against this system's procedures.
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddZedPlatform(builder.Configuration, ZedDatabases.Consultancy, authCookieName: "zed.consultancy");
builder.AddPortal(PortalSystem.Consultancy);

var app = builder.Build();
app.UseZedPlatform();
app.Run();

public partial class Program;
