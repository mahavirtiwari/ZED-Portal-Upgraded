using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal;

// ZEDCS main. The features live in Zed.Portal, shared with the Consultancy and Surveillance hosts.
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddZedPlatform(builder.Configuration, ZedDatabases.Main, authCookieName: "zed.main");
builder.AddPortal(PortalSystem.Main);
builder.EnsureZedConfiguration(PortalSystem.Main, ZedHostKind.Portal);

var app = builder.Build();
app.UseZedPlatform();
app.Run();

/// <summary>Entry point marker for WebApplicationFactory in tests.</summary>
public partial class Program;
