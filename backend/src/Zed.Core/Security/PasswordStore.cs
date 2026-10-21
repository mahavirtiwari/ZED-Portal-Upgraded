using System.Security.Cryptography;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Core.Security;

/// <summary>How V4 treats the plain-text <c>Users.Password</c> column (setting <c>Security:Passwords</c>, docs/PASSWORDS.md).</summary>
public enum PasswordMode
{
    /// <summary>
    /// While the old sites are live (default): logins are checked as before, against the plain column, and V4 keeps a
    /// salted hash next to it (written at every login and every password V4 sets). The plain column stays authoritative,
    /// because the old sites still change it.
    /// </summary>
    Dual,
    /// <summary>
    /// After the old sites are switched off: an account with a hash is checked against the hash only; an account without
    /// one may sign in once against the plain column. Either way the plain column is then replaced by a random value.
    /// </summary>
    Migrate,
    /// <summary>Hash only: an account without a hash cannot sign in until its password is reset.</summary>
    HashOnly,
}

/// <summary>
/// Salted password hashes for the legacy Users tables (SECURITY-FINDINGS #2), in <c>dbo.V4UserPasswords</c> of each
/// database (migration 0005). The legacy login procedures still do the account checks (active, lock-out, role,
/// allotment); in <see cref="PasswordMode.Migrate"/> and <see cref="PasswordMode.HashOnly"/> V4 checks the typed
/// password against the hash first and then calls the procedure with the stored column value, which after the first
/// login is a random value nobody knows. A refused attempt calls the procedure with <see cref="RefusedValue"/>, so its
/// failed-login count still applies and the typed password is not written to FailedLogins.
/// <para>
/// Passwords are compared as the procedures compare them (case-insensitive collation, trailing spaces ignored), so the
/// hash is of the normalised password (scheme "u1"). Surveillance accounts copied from main (#111) are checked against
/// main's hash once main has one.
/// </para>
/// </summary>
public sealed class PasswordStore
{
    public const string Setting = "Security:Passwords";
    public const string GetProcedure = "SP_V4_GET_PASSWORD";
    public const string SetProcedure = "SP_V4_SET_PASSWORD_HASH";

    /// <summary>Start of the random values that replace plain passwords ("V4!" + 46 hex digits, within varchar(50)).</summary>
    public const string ReplacementPrefix = "V4!";

    /// <summary>Sent to a login procedure instead of a refused password: matches no stored value.</summary>
    public const string RefusedValue = "V4!REFUSED";

    private const string Scheme = "u1$";
    private static readonly PasswordHasher<object> Hasher = new();

    private readonly ISqlExecutor db;
    private readonly IServiceProvider services;
    private readonly IConfiguration config;
    private readonly ILogger log;
    private readonly PortalSystem system;

    private PasswordStore(ISqlExecutor db, IServiceProvider services)
    {
        this.db = db;
        this.services = services;
        config = services.GetRequiredService<IConfiguration>();
        log = services.GetService<ILoggerFactory>()?.CreateLogger<PasswordStore>() ?? NullLogger<PasswordStore>.Instance;
        system = services.GetService<PortalHost>()?.System ?? PortalSystem.Main;
        Mode = ReadMode(config);
    }

    /// <summary>The store for the host database <paramref name="db"/> (resolved from the request's services; no registration needed).</summary>
    public static PasswordStore For(ISqlExecutor db, IServiceProvider services) => new(db, services);

    public PasswordMode Mode { get; }

    public static PasswordMode ReadMode(IConfiguration config) =>
        config[Setting] is not { Length: > 0 } value ? PasswordMode.Dual
        : Enum.TryParse<PasswordMode>(value, ignoreCase: true, out var mode) && Enum.IsDefined(mode) ? mode
        : throw new InvalidOperationException($"{Setting} must be Dual, Migrate or HashOnly.");

    // ------------------------------------------------------------------ Login

    /// <summary>Before the login procedure: <see cref="PasswordLogin.ProcedurePassword"/> is the value to send as its @Password.</summary>
    public async Task<PasswordLogin> BeginLoginAsync(string userId, string typed, CancellationToken ct)
    {
        StoredAccount? own;
        if (Mode == PasswordMode.Dual)
        {
            own = await BestEffort(() => LookupAsync(db, userId, ct), userId);
            // An account whose plain value was already replaced (Migrate, then set back to Dual) can only use its hash.
            if (!IsReplacement(own?.StoredPassword)) return new PasswordLogin(userId, typed, typed, own, null, HashSource.None);
        }
        else own = await LookupAsync(db, userId, ct);

        var (hash, source) = await AuthoritativeHashAsync(userId, own, ct);
        if (hash is not null)
        {
            var result = Verify(hash, typed);
            if (result == PasswordVerificationResult.Failed)
                return PasswordLogin.Refused(userId, typed, own);
            var stored = own?.StoredPassword is { Length: > 0 } s ? s : RefusedValue;
            return new PasswordLogin(userId, typed, stored, own, result, source);
        }
        return Mode == PasswordMode.Migrate && !IsReplacement(own?.StoredPassword)
            ? new PasswordLogin(userId, typed, typed, own, null, HashSource.None)
            : PasswordLogin.Refused(userId, typed, own);
    }

    /// <summary>
    /// After the login procedure returned <paramref name="userRow"/> (its Users row): true when the login is accepted.
    /// Replaces <see cref="LegacyPasswords.MatchesStored"/> and records the hash / replaces the plain value.
    /// </summary>
    public async Task<bool> CompleteLoginAsync(PasswordLogin login, IDictionary<string, object?> userRow, CancellationToken ct)
    {
        if (login.IsRefused) return false;
        var userId = userRow.TryGetValue("UserId", out var id) && id?.ToString() is { Length: > 0 } rowId ? rowId : login.Own?.UserId ?? login.UserId;

        if (login.Source != HashSource.None)
        {
            // The procedure was called with the stored value; it returned this account's row.
            if (userRow.TryGetValue("Password", out var rowPassword) &&
                !LegacyPasswords.SameValue(rowPassword?.ToString(), login.ProcedurePassword)) return false;
            var rehash = login.Verification == PasswordVerificationResult.SuccessRehashNeeded && login.Source == HashSource.Own;
            var replace = IsReplacement(login.Own?.StoredPassword) ? null : NewReplacement();
            if (rehash || replace is not null)
                await WriteAsync(db, userId, rehash ? Hash(login.Typed) : null, replace, ct);
            return true;
        }

        if (Mode == PasswordMode.Dual)
        {
            if (!LegacyPasswords.MatchesStored(userRow, login.Typed)) return false;
            await BestEffort(() => RefreshDualAsync(login, userRow, userId, ct), userId);
            return true;
        }

        // Migrate, no hash yet: the plain column decides once (never a procedure master password: the stored value must match).
        var stored = userRow.TryGetValue("Password", out var p) ? p?.ToString() : login.Own?.StoredPassword;
        if (!LegacyPasswords.Matches(stored, login.Typed) || IsReplacement(stored)) return false;
        await WriteAsync(db, userId, Hash(login.Typed), NewReplacement(), ct);
        log.LogInformation("Password of {UserId} moved to a hash", userId);
        return true;
    }

    private async Task<bool> RefreshDualAsync(PasswordLogin login, IDictionary<string, object?> row, string userId, CancellationToken ct)
    {
        // Only a password confirmed against the stored column is hashed (a procedure master password never is).
        var stored = row.TryGetValue("Password", out var p) ? p?.ToString() : login.Own?.StoredPassword;
        if (!LegacyPasswords.Matches(stored, login.Typed) || IsReplacement(stored)) return false;
        if (login.Own?.PasswordHash is { } existing && Verify(existing, login.Typed) == PasswordVerificationResult.Success) return true;
        // No hash yet, or the old site changed the password since: the plain column is authoritative in Dual.
        await WriteAsync(db, userId, Hash(login.Typed), null, ct);
        return true;
    }

    // ------------------------------------------------------------------ Change, reset, creation

    /// <summary>
    /// For a "current password" check (change password): Dual keeps the caller's legacy comparison; otherwise the hash
    /// decides, and an account without one passes only in Migrate (with the legacy result).
    /// </summary>
    public async Task<bool> VerifyCurrentAsync(string userId, string typed, bool legacyMatch, CancellationToken ct)
    {
        if (Mode == PasswordMode.Dual) return legacyMatch;
        var own = await LookupAsync(db, userId, ct);
        var (hash, _) = await AuthoritativeHashAsync(userId, own, ct);
        if (hash is not null) return Verify(hash, typed) != PasswordVerificationResult.Failed;
        return Mode == PasswordMode.Migrate && legacyMatch && !IsReplacement(own?.StoredPassword);
    }

    /// <summary>
    /// True on the Surveillance host (Migrate / HashOnly) for an account whose password main holds (#111): it is changed
    /// on main, where the hash used by both systems lives.
    /// </summary>
    public async Task<bool> IsManagedByMainAsync(string userId, CancellationToken ct)
    {
        if (Mode == PasswordMode.Dual || system != PortalSystem.Surveillance) return false;
        var own = await LookupAsync(db, userId, ct);
        return (await AuthoritativeHashAsync(userId, own, ct)).Source == HashSource.Main;
    }

    /// <summary>The value to keep in Users.Password for a password V4 sets: the password while the old sites read it (Dual), else a random value.</summary>
    public string StoredValueFor(string password) => Mode == PasswordMode.Dual ? password : NewReplacement();

    /// <summary>
    /// Records the hash of a password V4 sets (change, reset, new account); Users.Password holds
    /// <see cref="StoredValueFor"/>. In Dual a failure is logged and the change goes ahead as before.
    /// </summary>
    public Task SetAsync(string userId, string password, CancellationToken ct) =>
        Mode == PasswordMode.Dual
            ? BestEffort(async () => { await WriteAsync(db, userId, Hash(password), null, ct); return true; }, userId)
            : WriteAsync(db, userId, Hash(password), null, ct);

    // ------------------------------------------------------------------ Helpers

    public static bool IsReplacement(string? stored) =>
        stored is { Length: 49 } && stored.StartsWith(ReplacementPrefix, StringComparison.Ordinal);

    public static string NewReplacement() => ReplacementPrefix + Convert.ToHexString(RandomNumberGenerator.GetBytes(23));

    public static string Hash(string password) => Scheme + Hasher.HashPassword(null!, Normalize(password));

    public static PasswordVerificationResult Verify(string hash, string typed) =>
        hash.StartsWith(Scheme, StringComparison.Ordinal)
            ? Hasher.VerifyHashedPassword(null!, hash[Scheme.Length..], Normalize(typed))
            : PasswordVerificationResult.Failed;

    private static string Normalize(string password) => password.TrimEnd().ToUpperInvariant();

    private async Task<(string? Hash, HashSource Source)> AuthoritativeHashAsync(string userId, StoredAccount? own, CancellationToken ct)
    {
        if (system == PortalSystem.Surveillance && MainDatabase() is { } main)
        {
            // Agencies and assessors are created on main and copied here; once main holds a hash for the same account it is the password.
            var master = await LookupAsync(main, userId, ct);
            if (master?.PasswordHash is { } mainHash && (own is null || own.RoleId == master.RoleId))
                return (mainHash, HashSource.Main);
        }
        return own?.PasswordHash is { } ownHash ? (ownHash, HashSource.Own) : (null, HashSource.None);
    }

    private ISqlExecutor? MainDatabase()
    {
        var name = new PortalHost(PortalSystem.Main).Database;
        if (services.GetKeyedService<ISqlExecutor>(name) is { } keyed) return keyed;
        if (config.GetConnectionString(name) is not { Length: > 0 } cs) return null;
        // Read intent: only SP_V4_GET_PASSWORD runs there; the login needs EXECUTE on it and nothing else.
        return new SqlExecutor(new SqlConnectionStringBuilder(cs) { ApplicationIntent = ApplicationIntent.ReadOnly }.ConnectionString);
    }

    private static async Task<StoredAccount?> LookupAsync(ISqlExecutor database, string userId, CancellationToken ct)
    {
        var sets = await database.QueryProcMultipleAsync(GetProcedure, new { UserId = userId.Trim() }, ct);
        var row = sets.Count > 0 ? sets[0].FirstOrDefault() : null;
        if (row is null) return null;
        string? Text(string name) => row.TryGetValue(name, out var v) && v is not null and not DBNull ? v.ToString() : null;
        return new StoredAccount(Text("UserId") ?? userId, Text("RoleId"), Text("StoredPassword"), Text("PasswordHash"));
    }

    private static Task WriteAsync(ISqlExecutor database, string userId, string? hash, string? replacePassword, CancellationToken ct) =>
        database.ExecuteProcAsync(SetProcedure, new { UserId = userId, PasswordHash = hash, ReplacePassword = replacePassword }, ct);

    private async Task<T?> BestEffort<T>(Func<Task<T>> action, string userId)
    {
        try { return await action(); }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Dual: the hash is a copy kept for later; a missing migration or a failure must not stop the login.
            log.LogWarning(ex, "Password hash not recorded for {UserId}", userId);
            return default;
        }
    }
}

public enum HashSource { None, Own, Main }

/// <summary>The Users row as SP_V4_GET_PASSWORD returns it.</summary>
public sealed record StoredAccount(string UserId, string? RoleId, string? StoredPassword, string? PasswordHash);

/// <summary>A login in progress (<see cref="PasswordStore.BeginLoginAsync"/>).</summary>
public sealed class PasswordLogin
{
    internal PasswordLogin(string userId, string typed, string procedurePassword, StoredAccount? own,
        PasswordVerificationResult? verification, HashSource source, bool refused = false)
    {
        UserId = userId;
        Typed = typed;
        ProcedurePassword = procedurePassword;
        Own = own;
        Verification = verification;
        Source = source;
        IsRefused = refused;
    }

    internal static PasswordLogin Refused(string userId, string typed, StoredAccount? own) =>
        new(userId, typed, PasswordStore.RefusedValue, own, PasswordVerificationResult.Failed, HashSource.None, refused: true);

    /// <summary>The value to pass as the login procedure's @Password.</summary>
    public string ProcedurePassword { get; }

    /// <summary>True when V4 has already refused the password (the procedure is still called, for its lock-out count).</summary>
    public bool IsRefused { get; }

    internal string UserId { get; }
    internal string Typed { get; }
    internal StoredAccount? Own { get; }
    internal PasswordVerificationResult? Verification { get; }
    internal HashSource Source { get; }
}
