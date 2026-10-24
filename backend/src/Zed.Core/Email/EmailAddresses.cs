using MimeKit;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Core.Email;

/// <param name="Key">dbo.V4Settings key.</param>
/// <param name="Database">Used by the database procedures' mail (sent by Zed.Jobs) rather than by the portal.</param>
/// <param name="Systems">The systems whose mails use it.</param>
public sealed record EmailAddressSetting(string Key, string Label, string Help, bool Database, PortalSystem[] Systems);

/// <summary>
/// The office mailboxes the mails go to, as the Admin set them (Email Settings, dbo.V4Settings of each system, migration
/// 0011). An address not set there comes from the configuration as before (<see cref="Default"/>). Values are one address
/// or a list separated by commas or semicolons.
/// </summary>
public sealed class EmailAddresses(IPortalSettings settings, IOptions<EmailOptions> options, IConfiguration config)
{
    public const string ContactInbox = "Email.ContactInbox";
    public const string RegistrationCc = "Email.RegistrationCc";
    public const string ZedTeamInbox = "Email.ZedTeamInbox";
    public const string SchemeRejectionInbox = "Email.SchemeRejectionInbox";
    public const string DbMailBcc = "Email.DbMailBcc";
    public const string DbReportRecipients = "Email.DbReportRecipients";

    /// <summary>Old team mailbox, hard-coded in the legacy code for agency rejections.</summary>
    public const string LegacyTeamInbox = "zed@qcin.org";

    public const int MaxAddresses = 10;

    private static readonly PortalSystem[] AllSystems = [PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance];

    public static readonly IReadOnlyList<EmailAddressSetting> All =
    [
        new(ContactInbox, "Contact ZED queries", "Receives the queries sent from the Contact ZED page.", false, [PortalSystem.Main]),
        new(RegistrationCc, "Copy of registration, payment and allotment mails",
            "Copied on the registration, payment, milestone, allotment and app registration mails (legacy ccAddress).", false, AllSystems),
        new(ZedTeamInbox, "ZED team: allotment rejections",
            "Told when an agency or consultant organisation rejects an allotted assessment or consultancy.", false, AllSystems),
        new(SchemeRejectionInbox, "Financial assistance / technology upgradation rejections",
            "Told when an agency rejects a financial assistance or technology upgradation verification.", false,
            [PortalSystem.Main, PortalSystem.Consultancy]),
        new(DbMailBcc, "Copy of every database mail",
            "Blind copy of each mail the database procedures send (allotments, reminders, surveillance, rejections).", true, AllSystems),
        new(DbReportRecipients, "Daily status report",
            "Recipients of the database's daily MSME status report, instead of the addresses fixed in the procedure.", true,
            [PortalSystem.Main]),
    ];

    /// <summary>The configured address of <paramref name="key"/> (no Admin value saved).</summary>
    public string? Default(string key) => key switch
    {
        ContactInbox => options.Value.ContactInbox,
        RegistrationCc => options.Value.RegistrationCc,
        ZedTeamInbox => config["Email:ZedTeamInbox"] ?? LegacyTeamInbox,
        SchemeRejectionInbox => config["Schemes:FaRejectionInbox"] ?? LegacyTeamInbox,
        _ => null,
    } is { Length: > 0 } v ? v.Trim() : null;

    /// <summary>The Admin's value, else the configured one; null when neither is set.</summary>
    public async Task<string?> GetAsync(string key, CancellationToken ct = default) =>
        await settings.GetAsync(key, ct) is { Length: > 0 } v ? v : Default(key);

    /// <summary>As <see cref="GetAsync"/>, for the Cc/Bcc of a message: null when none.</summary>
    public async Task<IReadOnlyList<string>?> CopyAsync(string key, CancellationToken ct = default) =>
        await GetAsync(key, ct) is { } v ? [v] : null;

    /// <summary>Checks and tidies an Admin value: null/blank is allowed (back to the configuration).</summary>
    public static (string? Value, string? Error) Normalise(string? value)
    {
        var parts = Split(value);
        if (parts.Count == 0) return (null, null);
        if (parts.Count > MaxAddresses) return (null, $"Please enter at most {MaxAddresses} addresses.");
        foreach (var p in parts)
            if (!IsAddress(p)) return (null, $"'{p}' is not a valid e-mail address.");
        var joined = string.Join("; ", parts);
        return joined.Length > 400 ? (null, "The addresses are too long.") : (joined, null);
    }

    public static List<string> Split(string? value) =>
        (value ?? "").Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

    private static bool IsAddress(string s) =>
        s.Length <= 254 && MailboxAddress.TryParse(s, out var m) && m.Name.Length == 0 && m.Address == s
        && System.Text.RegularExpressions.Regex.IsMatch(s, @"^[^@\s<>()]+@[^@\s<>()]+\.[A-Za-z]{2,}$");
}
