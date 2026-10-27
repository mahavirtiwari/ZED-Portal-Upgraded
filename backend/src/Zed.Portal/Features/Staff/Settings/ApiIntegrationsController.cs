using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.ExternalApi;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// Administration → API Integrations (new in V4): the organisations that call ZED's partner APIs (banks and financial
/// institutions, state governments, the Udyami and RAMP dashboards, ...: the rows of dbo.ApiClientTokens, registered by
/// SP_API_KEY_MAKER in the old system), what each may call, when it last took a token, and an Enable / Disable switch
/// (dbo.V4Settings "ApiClient.{Id}.Enabled"; <see cref="ApiClients"/> refuses a disabled client within half a minute).
/// Secrets (tokens, AES keys) are never sent to the page. Main only: the partner APIs and their clients live there.
/// </summary>
[Route("api/staff/settings/integrations")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main)]
public sealed class ApiIntegrationsController(ISqlExecutor db, IPortalSettings settings, ILogger<ApiIntegrationsController> log) : StaffApiController
{
    internal const string ClientsSql =
        "SELECT c.Id, c.Client, c.ClientId, c.CreatedDate, c.BaseUrl, c.ReverseToken, CAST(CASE WHEN c.AesKey IS NULL OR c.AesKey = '' THEN 0 ELSE 1 END AS bit) AS HasAes, " +
        "(SELECT MAX(d.CreatedDate) FROM dbo.ApiClientDynamicTokens d WHERE d.OriginalToken = c.Token) AS LastTokenOn FROM dbo.ApiClientTokens c ORDER BY c.Id;";

    public sealed record ClientRow(long Id, string? Client, string? ClientId, DateTime? CreatedDate, string? BaseUrl, bool? ReverseToken, bool HasAes, DateTime? LastTokenOn);

    /// <param name="Access">What the client may call, from its token type (<see cref="AccessOf"/>).</param>
    public sealed record ApiClientItem(long Id, string Name, string? ClientId, DateTime? CreatedDate, string? BaseUrl, IReadOnlyList<string> Access,
        DateTime? LastTokenOn, bool Enabled);

    [HttpGet("clients")]
    public async Task<IReadOnlyList<ApiClientItem>> Clients(CancellationToken ct)
    {
        var rows = await db.QuerySqlAsync<ClientRow>(ClientsSql, null, ct);
        var items = new List<ApiClientItem>();
        foreach (var r in rows)
        {
            var enabled = !string.Equals(await settings.GetAsync(ApiClients.EnabledKey(r.Id), ct), "false", StringComparison.OrdinalIgnoreCase);
            items.Add(new ApiClientItem(r.Id, string.IsNullOrWhiteSpace(r.Client) ? $"Client #{r.Id}" : r.Client.Trim(), r.ClientId, r.CreatedDate, r.BaseUrl,
                AccessOf(r), r.LastTokenOn, enabled));
        }
        return items;
    }

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
        new("CCAvenue payment gateway", "Certification, handholding and surveillance fee payments", "Server configuration (CcAvenue)", true),
        new("QCI ERP (Business Central)", "Customer, invoice and receipt posting after a payment", "Server configuration (Erp)", true),
        new("Udyam registration (MoMSME)", "Udyam number check at MSME registration", "Server configuration (Udyam)", true),
        new("GSTIN verification (Protean)", "GSTIN check on the payment page", "Server configuration (Protean)", true),
        new("Udyami Bharat portal", "Verifies the sign-in token of units coming from UBP", "Server configuration (UdyamiBharat); switch: Udyami Bharat sign-in", true),
        new("Google reCAPTCHA", "Captcha of the login and registration forms", "Administration → Settings → Captcha Settings", true),
        new("Twilio Video", "Video calls of the remote assessments in the apps", "Server configuration (Twilio)", true),
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

    /// <summary>Enables or disables a client: disabled, its secret and the tokens it holds are refused.</summary>
    [HttpPut("clients/{id:long}")]
    public async Task<ActionResult<MessageResponse>> SetClient(long id, SwitchRequest req, CancellationToken ct)
    {
        var row = (await db.QuerySqlAsync<ClientRow>(ClientsSql, null, ct)).FirstOrDefault(r => r.Id == id);
        if (row is null) return NotFound();
        // Enabled is the default: no row.
        await settings.SetAsync(ApiClients.EnabledKey(id), req.Enabled ? null : "false", UserId, ct);
        log.LogWarning("API client {Id} ({Client}) {State} by {Actor}", id, row.Client, req.Enabled ? "enabled" : "disabled", UserId);
        var name = string.IsNullOrWhiteSpace(row.Client) ? $"Client #{id}" : row.Client.Trim();
        return new MessageResponse(req.Enabled
            ? $"{name} is enabled: its calls are accepted again within half a minute."
            : $"{name} is disabled: its calls are refused within half a minute.");
    }
}
