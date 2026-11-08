using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;

namespace Zed.Portal.Features.Staff.Masters;

/// <summary>
/// The states of the LG Directory masters (dbo.States, kept up to date by Masters → LG Directory and copied to the other
/// portals' databases), for every state drop-down, filter and server check (2026-11-08; before, several fixed copies).
/// Read when the portal starts and every few minutes, and at once after an LG Directory import. Until the first read, or
/// when the table cannot be read or is empty, the states as of 2026 are used.
/// </summary>
public static class StateMaster
{
    public sealed record State(string Code, string Name);

    /// <summary>The 36 states and union territories (LGD codes, as Msme.StateId) before the masters are read.</summary>
    public static readonly IReadOnlyList<State> BuiltIn =
    [
        new("35", "ANDAMAN AND NICOBAR ISLANDS"), new("28", "ANDHRA PRADESH"), new("12", "ARUNACHAL PRADESH"), new("18", "ASSAM"),
        new("10", "BIHAR"), new("4", "CHANDIGARH"), new("22", "CHHATTISGARH"), new("7", "DELHI"), new("30", "GOA"), new("24", "GUJARAT"),
        new("6", "HARYANA"), new("2", "HIMACHAL PRADESH"), new("1", "JAMMU AND KASHMIR"), new("20", "JHARKHAND"), new("29", "KARNATAKA"),
        new("32", "KERALA"), new("37", "LADAKH"), new("31", "LAKSHADWEEP"), new("23", "MADHYA PRADESH"), new("27", "MAHARASHTRA"),
        new("14", "MANIPUR"), new("17", "MEGHALAYA"), new("15", "MIZORAM"), new("13", "NAGALAND"), new("21", "ODISHA"),
        new("34", "PUDUCHERRY"), new("3", "PUNJAB"), new("8", "RAJASTHAN"), new("11", "SIKKIM"), new("33", "TAMIL NADU"),
        new("36", "TELANGANA"), new("38", "THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU"), new("16", "TRIPURA"),
        new("9", "UTTAR PRADESH"), new("5", "UTTARAKHAND"), new("19", "WEST BENGAL"),
    ];

    /// <summary>Names units registered before the merger of 2020 still carry (Msme.PStateName); offered by the home dashboard.</summary>
    public static readonly IReadOnlyList<string> FormerNames = ["DADAR AND NAGAR HAVELI", "DAMAN AND DIU"];

    internal const string Sql =
        "SELECT LTRIM(RTRIM(CAST(StateCode AS varchar(10)))) AS Code, UPPER(LTRIM(RTRIM(StateName))) AS Name FROM dbo.States " +
        "WHERE ISNULL(IsActive, 1) = 1 AND NULLIF(LTRIM(RTRIM(StateName)), '') IS NOT NULL;";

    private static Snapshot current = new(BuiltIn);

    /// <summary>The active states, by name.</summary>
    public static IReadOnlyList<State> All => current.List;

    /// <summary>LGD code (as Msme.StateId, without leading zeros) → name.</summary>
    public static IReadOnlyDictionary<string, string> ByCode => current.ByCode;

    /// <summary>The names, case-insensitive.</summary>
    public static IReadOnlySet<string> Names => current.Names;

    public static string? NameOf(string? code) =>
        code is not null && current.ByCode.TryGetValue(Code(code), out var name) ? name : null;

    /// <summary>"09" and "9" are the same state.</summary>
    public static string Code(string code) => code.Trim().TrimStart('0') is { Length: > 0 } c ? c : code.Trim();

    /// <summary>Reads dbo.States; keeps the last list when it cannot be read or is empty.</summary>
    public static async Task RefreshAsync(ISqlExecutor db, CancellationToken ct)
    {
        var rows = await db.QuerySqlAsync<State>(Sql, null, ct);
        Apply(rows);
    }

    /// <summary>Uses <paramref name="rows"/> when they hold at least one state (duplicates by code: the first).</summary>
    internal static bool Apply(IEnumerable<State> rows)
    {
        var list = Normalise(rows);
        if (list.Count == 0) return false;
        current = new Snapshot(list);
        return true;
    }

    /// <summary>Codes without leading zeros, names in capitals, one row per code (the first), blank rows left out.</summary>
    internal static List<State> Normalise(IEnumerable<State> rows) =>
        rows.Where(r => !string.IsNullOrWhiteSpace(r.Code) && !string.IsNullOrWhiteSpace(r.Name))
            .Select(r => new State(Code(r.Code), r.Name.Trim().ToUpperInvariant()))
            .DistinctBy(r => r.Code).ToList();

    private sealed class Snapshot
    {
        public Snapshot(IEnumerable<State> states)
        {
            List = states.OrderBy(s => s.Name, StringComparer.OrdinalIgnoreCase).ToList();
            ByCode = List.ToDictionary(s => s.Code, s => s.Name);
            Names = new HashSet<string>(List.Select(s => s.Name), StringComparer.OrdinalIgnoreCase);
        }

        public IReadOnlyList<State> List { get; }
        public IReadOnlyDictionary<string, string> ByCode { get; }
        public IReadOnlySet<string> Names { get; }
    }
}

/// <summary>Reads the states when the portal starts, then every 10 minutes (Masters:StatesRefreshMinutes).</summary>
public sealed class StateMasterRefresher(IServiceScopeFactory scopes, IConfiguration config, ILogger<StateMasterRefresher> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var minutes = config.GetValue("Masters:StatesRefreshMinutes", 10);
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    using var scope = scopes.CreateScope();
                    await StateMaster.RefreshAsync(scope.ServiceProvider.GetRequiredService<ISqlExecutor>(), stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    log.LogWarning(ex, "States could not be read from dbo.States; the last list stays in use");
                }
                if (minutes <= 0) return;
                await Task.Delay(TimeSpan.FromMinutes(minutes), stoppingToken);
            }
        }
        catch (OperationCanceledException) { /* stopping */ }
    }
}

/// <summary>GET api/public/states: the active states (LGD code and name) for the pages' state drop-downs.</summary>
[ApiController]
[AllowAnonymous]
[Route("api/public/states")]
public sealed class PublicStatesController : ControllerBase
{
    public sealed record StateDto(string Code, string Name);

    [HttpGet]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Any)]
    public IReadOnlyList<StateDto> Get() => StateMaster.All.Select(s => new StateDto(s.Code, s.Name)).ToList();
}
