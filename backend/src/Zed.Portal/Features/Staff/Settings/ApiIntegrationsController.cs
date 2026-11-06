using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.ExternalApi;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// Administration → API Integrations (new in V4): the organisations that call ZED's partner APIs (banks and financial
/// institutions, state governments, the Udyami and RAMP dashboards, ...: the rows of dbo.ApiClientTokens, registered by
/// SP_API_KEY_MAKER in the old system), what each may call, when it last took a token, Edit (name, address, incentive
/// submission) and Enable / Disable (dbo.ApiClientTokens.IsEnabled, migration 0027; <see cref="ApiClients"/> refuses a
/// disabled client at once), and Add partner (V4: a new key, shown once). Secrets (tokens, AES keys) are never sent to
/// the page otherwise; a key the old SP_API_KEY_MAKER put into BaseUrl (?token=...) is masked. Main only: the partner
/// APIs and their clients live there.
/// </summary>
[Route("api/staff/settings/integrations")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main)]
public sealed class ApiIntegrationsController(ISqlExecutor db, IPortalSettings settings, ILogger<ApiIntegrationsController> log) : StaffApiController
{
    internal const string ClientsSql =
        "SELECT c.Id, c.Client, c.ClientId, c.CreatedDate, c.BaseUrl, c.ReverseToken, CAST(CASE WHEN c.AesKey IS NULL OR c.AesKey = '' THEN 0 ELSE 1 END AS bit) AS HasAes, " +
        "(SELECT MAX(d.CreatedDate) FROM dbo.ApiClientDynamicTokens d WHERE d.OriginalToken = c.Token) AS LastTokenOn, " +
        "c.IsEnabled, c.UpdatedBy, c.UpdatedOn FROM dbo.ApiClientTokens c ORDER BY c.Id;";

    public sealed record ClientRow(long Id, string? Client, string? ClientId, DateTime? CreatedDate, string? BaseUrl, bool? ReverseToken, bool HasAes,
        DateTime? LastTokenOn, bool? IsEnabled = null, string? UpdatedBy = null, DateTime? UpdatedOn = null);

    /// <param name="Access">What the client may call, from its token type (<see cref="AccessOf"/>).</param>
    /// <param name="MaySubmitIncentives">Whether its key may submit incentive disbursements (ApiClientTokens.ReverseToken).</param>
    public sealed record ApiClientItem(long Id, string Name, string? ClientId, DateTime? CreatedDate, string? BaseUrl, IReadOnlyList<string> Access,
        DateTime? LastTokenOn, bool Enabled, bool MaySubmitIncentives = false, string? UpdatedBy = null, DateTime? UpdatedOn = null);

    [HttpGet("clients")]
    public async Task<IReadOnlyList<ApiClientItem>> Clients(CancellationToken ct)
    {
        var rows = await db.QuerySqlAsync<ClientRow>(ClientsSql, null, ct);
        return rows.Select(r => new ApiClientItem(r.Id, NameOf(r), r.ClientId, r.CreatedDate, MaskUrl(r.BaseUrl), AccessOf(r), r.LastTokenOn,
            r.IsEnabled != false, r.ReverseToken == true, r.UpdatedBy, r.UpdatedOn)).ToList();
    }

    private static readonly Regex SecretParam = new(@"([?&](?:token|key|secret|apikey|clientsecret)=)[^&#]*", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    /// <summary>The address without keys in its query (SP_API_KEY_MAKER stored a sample URL with the partner's key in it).</summary>
    public static string? MaskUrl(string? url) => url is null ? null : SecretParam.Replace(url, "$1***");

    /// <summary>The partner APIs a client's token type lets it call (the checks of <see cref="ApiClients"/>).</summary>
    public static IReadOnlyList<string> AccessOf(ClientRow r)
    {
        var access = new List<string>();
        if (r.ClientId is null) access.Add("Certificate lookups (static token)");
        access.Add("Udyami registration & certificates");
        if (r.ClientId is not null) access.Add("Certification details, state lists, receipts & incentives (token on request)");
        if (r.ReverseToken == true) access.Add("Incentive submission");
        if (r.HasAes) access.Add("Encrypted lists (RAMP dashboard)");
        return access;
    }

    public sealed record ApiGroupItem(string Key, string Name, string UsedBy, string Description, IReadOnlyList<string> Endpoints, bool Enabled);

    /// <summary>The partner APIs by group (<see cref="PartnerApiGroups"/>), each switched on or off as one.</summary>
    [HttpGet("groups")]
    public async Task<IReadOnlyList<ApiGroupItem>> Groups(CancellationToken ct)
    {
        var items = new List<ApiGroupItem>();
        foreach (var g in PartnerApiGroups.All)
            items.Add(new ApiGroupItem(g.Key, g.Name, g.UsedBy, g.Description, g.Endpoints, await PartnerApiGroups.IsEnabledAsync(settings, g.Key, ct)));
        return items;
    }

    [HttpPut("groups/{key}")]
    public async Task<ActionResult<MessageResponse>> SetGroup(string key, SwitchRequest req, CancellationToken ct)
    {
        if (PartnerApiGroups.All.FirstOrDefault(g => g.Key == key) is not { } group) return NotFound();
        await settings.SetAsync(PartnerApiGroups.EnabledKey(group.Key), req.Enabled ? null : "false", UserId, ct);
        log.LogWarning("Partner API group {Group} {State} by {Actor}", group.Key, req.Enabled ? "enabled" : "disabled", UserId);
        return new MessageResponse(req.Enabled
            ? $"{group.Name} is on again within half a minute."
            : $"{group.Name} is off: its calls are answered \"switched off\" within half a minute.");
    }

    /// <param name="InV4">Whether V4 still calls it (the others were left with the old portal).</param>
    public sealed record OutboundItem(string Name, string Purpose, string ManagedAt, bool InV4);

    /// <summary>The services ZED calls (from the legacy code; for information: they are configured on the server).</summary>
    public static readonly IReadOnlyList<OutboundItem> Outbound =
    [
        new("CCAvenue payment gateway", "Certification, handholding and surveillance fee payments", "Administration → Settings → Payment Gateway and Invoices (or the server configuration, CcAvenue)", true),
        new("QCI ERP (Business Central)", "Customer, invoice and receipt posting after a payment", "Server configuration (Erp); switch: Payment Gateway and Invoices → Invoices", true),
        new("Udyam registration (MoMSME)", "Udyam number check at MSME registration", "Server configuration (Udyam)", true),
        new("GSTIN verification (Protean)", "GSTIN check on the payment page", "Server configuration (Protean)", true),
        new("Udyami Bharat portal", "Verifies the sign-in token of units coming from UBP", "Server configuration (UdyamiBharat); switch: Udyami Bharat sign-in", true),
        new("Google reCAPTCHA", "Captcha of the login and registration forms", "Administration → Settings → Captcha Settings", true),
        new("E-mail (SMTP)", "All mails, OTPs included", "Administration → Settings → Email Settings", true),
        new("PayU payment gateway", "Alternative gateway of the old portal", "Not used in V4", false),
        new("SelectPDF", "HTML to PDF for certificates and summaries", "Not used in V4 (PDFs are made on the server)", false),
        new("Google Static Maps", "Map image in the assessment report", "Not used in V4", false),
        new("DigiReady GSTIN check", "Older GSTIN check", "Not used in V4 (Protean)", false),
        new("NIC NIDHI / HotelCloud", "Left over from the Swachh Survekshan code", "Not used in V4", false),
        new("SMS gateways (Gupshup, ValueFirst, TextLocal)", "Were commented out in the old code", "Not used", false),
    ];

    [HttpGet("outbound")]
    public IReadOnlyList<OutboundItem> OutboundList() => Outbound;

    public sealed record SwitchRequest(bool Enabled);

    private static string NameOf(ClientRow r) => string.IsNullOrWhiteSpace(r.Client) ? $"Client #{r.Id}" : r.Client.Trim();

    internal const string SwitchSql =
        "UPDATE dbo.ApiClientTokens SET IsEnabled = @Enabled, UpdatedBy = @UpdatedBy, UpdatedOn = SYSUTCDATETIME() WHERE Id = @Id;";

    /// <summary>Enables or disables a client: disabled, its secret and the tokens it holds are refused at once.</summary>
    [HttpPut("clients/{id:long}")]
    public async Task<ActionResult<MessageResponse>> SetClient(long id, SwitchRequest req, CancellationToken ct)
    {
        var row = (await db.QuerySqlAsync<ClientRow>(ClientsSql, null, ct)).FirstOrDefault(r => r.Id == id);
        if (row is null) return NotFound();
        await db.ExecuteSqlAsync(SwitchSql, new { Id = id, req.Enabled, UpdatedBy = Actor() }, ct);
        log.LogWarning("API client {Id} ({Client}) {State} by {Actor}", id, row.Client, req.Enabled ? "enabled" : "disabled", UserId);
        return new MessageResponse(req.Enabled
            ? $"{NameOf(row)} is enabled: its calls are accepted again."
            : $"{NameOf(row)} is disabled: its calls are refused.");
    }

    /// <param name="BaseUrl">Its own address (for information; ZED does not call it). Empty for none.</param>
    /// <param name="MaySubmitIncentives">Its key may submit incentive disbursements.</param>
    public sealed record ClientEditRequest(string? Name, string? BaseUrl, bool MaySubmitIncentives);

    internal const string EditSql =
        "UPDATE dbo.ApiClientTokens SET Client = @Name, BaseUrl = @BaseUrl, ReverseToken = @ReverseToken, UpdatedBy = @UpdatedBy, " +
        "UpdatedOn = SYSUTCDATETIME() WHERE Id = @Id;";

    /// <summary>Edits a partner: its name, address and whether it may submit incentives. Its client ID and key stay as they are.</summary>
    [HttpPut("clients/{id:long}/details")]
    public async Task<ActionResult<MessageResponse>> EditClient(long id, ClientEditRequest req, CancellationToken ct)
    {
        var row = (await db.QuerySqlAsync<ClientRow>(ClientsSql, null, ct)).FirstOrDefault(r => r.Id == id);
        if (row is null) return NotFound();
        var name = req.Name?.Trim() ?? "";
        var baseUrl = req.BaseUrl?.Trim() ?? "";
        if (name.Length == 0) return this.Problem400("Please enter the partner's name.");
        if (name.Length > 200) return this.Problem400("The name can be up to 200 characters.");
        if (name.Any(char.IsControl) || baseUrl.Any(char.IsControl)) return this.Problem400("The name or address contains invalid characters.");
        // The page shows the stored address masked; sent back unchanged, it keeps the stored one.
        if (baseUrl == MaskUrl(row.BaseUrl)) baseUrl = row.BaseUrl ?? "";
        else if (CheckAddress(baseUrl) is { } addressProblem) return this.Problem400(addressProblem);
        await db.ExecuteSqlAsync(EditSql, new
        {
            Id = id, Name = name, BaseUrl = baseUrl.Length == 0 ? null : baseUrl, ReverseToken = req.MaySubmitIncentives, UpdatedBy = Actor(),
        }, ct);
        log.LogWarning("API client {Id} edited by {Actor}: incentive submission {Submit}", id, UserId, req.MaySubmitIncentives);
        return new MessageResponse($"{name} saved.");
    }

    private static string? CheckAddress(string baseUrl)
    {
        if (baseUrl.Length > 500) return "The address can be up to 500 characters.";
        if (baseUrl.Length > 0 && !(Uri.TryCreate(baseUrl, UriKind.Absolute, out var u) && (u.Scheme == Uri.UriSchemeHttps || u.Scheme == Uri.UriSchemeHttp)))
            return "The address must be a full http(s):// address, or empty.";
        return null;
    }

    /// <param name="Kind">"token": a client ID and a key, with which it takes tokens (the usual partner); "static": a key
    /// alone, sent with each certificate lookup (as the oldest partners).</param>
    /// <param name="Encrypted">Its lists are answered encrypted (AES key and IV, as for the RAMP dashboard).</param>
    public sealed record ClientCreateRequest(string? Name, string? BaseUrl, string? Kind, bool MaySubmitIncentives, bool Encrypted);

    /// <summary>The new partner and its secrets, shown to the Admin once (they are not sent to the page again).</summary>
    public sealed record ClientCreated(string Message, long Id, string? ClientId, string Secret, string? AesKey, string? AesIv);

    public sealed record NewClient(long Id, string? ClientId);

    // The next client ID follows the old numbering (SP_API_KEY_MAKER: MAX(ClientId) + 1), in the same statement.
    internal const string CreateSql =
        "INSERT INTO dbo.ApiClientTokens (Client, Token, CreatedDate, BaseUrl, ReverseToken, ClientId, AesKey, AesIV, IsEnabled, UpdatedBy, UpdatedOn) " +
        "OUTPUT INSERTED.Id, INSERTED.ClientId " +
        "SELECT @Name, @Token, GETDATE(), @BaseUrl, @ReverseToken, " +
        "CASE WHEN @WithClientId = 1 THEN CAST(ISNULL(MAX(TRY_CAST(ClientId AS bigint)), 1000000) + 1 AS varchar(50)) END, " +
        "@AesKey, @AesIV, 1, @UpdatedBy, SYSUTCDATETIME() FROM dbo.ApiClientTokens WITH (UPDLOCK, HOLDLOCK);";

    /// <summary>Adds a partner with a new random key (and AES key and IV when its lists are encrypted).</summary>
    [HttpPost("clients")]
    public async Task<ActionResult<ClientCreated>> AddClient(ClientCreateRequest req, CancellationToken ct)
    {
        var name = req.Name?.Trim() ?? "";
        var baseUrl = req.BaseUrl?.Trim() ?? "";
        if (name.Length == 0) return this.Problem400("Please enter the partner's name.");
        if (name.Length > 200) return this.Problem400("The name can be up to 200 characters.");
        if (name.Any(char.IsControl) || baseUrl.Any(char.IsControl)) return this.Problem400("The name or address contains invalid characters.");
        if (CheckAddress(baseUrl) is { } addressProblem) return this.Problem400(addressProblem);
        if (req.Kind is not ("token" or "static")) return this.Problem400("Please choose how the partner calls ZED.");
        if ((await db.QuerySqlAsync<ClientRow>(ClientsSql, null, ct)).Any(r => string.Equals(r.Client?.Trim(), name, StringComparison.OrdinalIgnoreCase)))
            return this.Problem400($"A partner named {name} is already registered.");

        var secret = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var aesKey = req.Encrypted ? Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)) : null;
        var aesIv = req.Encrypted ? Convert.ToBase64String(RandomNumberGenerator.GetBytes(16)) : null;
        var created = (await db.QuerySqlAsync<NewClient>(CreateSql, new
        {
            Name = name, Token = secret, BaseUrl = baseUrl.Length == 0 ? null : baseUrl, ReverseToken = req.MaySubmitIncentives,
            WithClientId = req.Kind == "token", AesKey = aesKey, AesIV = aesIv, UpdatedBy = Actor(),
        }, ct)).Single();
        // Never the key: only who added which partner.
        log.LogWarning("API client {Id} ({Client}) added by {Actor}", created.Id, name, UserId);
        return new ClientCreated($"{name} added. Give the partner its key now: it is not shown again.", created.Id, created.ClientId, secret, aesKey, aesIv);
    }

    private string Actor() => UserId.Length <= 50 ? UserId : UserId[..50];
}
