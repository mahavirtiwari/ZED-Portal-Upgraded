namespace Zed.Jobs;

/// <summary>
/// Where the service's environment name (Production, Staging, Development) came from. A service created without
/// DOTNET_ENVIRONMENT (sc.exe create, as docs/JOBS.md once said) runs as Production by .NET's default: on a test server
/// with a copy of production data the mail outbox would then mail real people. So the mail outbox sends only when the
/// environment was given on purpose (<see cref="IsExplicit"/>); the other jobs run either way.
/// </summary>
/// <param name="Name">The name given, or null when none was given.</param>
/// <param name="Source">Where it was given: <see cref="DotnetVariable"/>, <see cref="AspNetCoreVariable"/> or <see cref="CommandLine"/>.</param>
public sealed record JobsEnvironment(string? Name, string? Source)
{
    public const string DotnetVariable = "DOTNET_ENVIRONMENT";
    public const string AspNetCoreVariable = "ASPNETCORE_ENVIRONMENT";
    public const string CommandLine = "--environment";

    public bool IsExplicit => !string.IsNullOrWhiteSpace(Name);

    /// <summary>
    /// The name to give the host builder: only when ASPNETCORE_ENVIRONMENT alone names it (the generic host reads
    /// DOTNET_ENVIRONMENT and --environment itself, but not ASPNETCORE_ENVIRONMENT, which the app pools use). Null: the
    /// host's own reading.
    /// </summary>
    public string? HostOverride => Source == AspNetCoreVariable ? Name : null;

    /// <summary>The command line first (as the host reads it), then DOTNET_ENVIRONMENT, then ASPNETCORE_ENVIRONMENT.</summary>
    public static JobsEnvironment From(IReadOnlyList<string> args, Func<string, string?> variable)
    {
        for (var i = 0; i < args.Count; i++)
        {
            var a = args[i];
            foreach (var prefix in new[] { "--environment", "/environment" })
            {
                if (a.Equals(prefix, StringComparison.OrdinalIgnoreCase) && i + 1 < args.Count && args[i + 1] is { Length: > 0 } next)
                    return new(next.Trim(), CommandLine);
                if (a.StartsWith(prefix + "=", StringComparison.OrdinalIgnoreCase) && a[(prefix.Length + 1)..] is { Length: > 0 } value)
                    return new(value.Trim(), CommandLine);
            }
        }
        foreach (var name in new[] { DotnetVariable, AspNetCoreVariable })
            if (variable(name) is { } v && !string.IsNullOrWhiteSpace(v))
                return new(v.Trim(), name);
        return new(null, null);
    }
}
