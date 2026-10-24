using System.Reflection;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using IComponent = Microsoft.AspNetCore.Components.IComponent;
using ParameterAttribute = Microsoft.AspNetCore.Components.ParameterAttribute;
using Microsoft.Data.SqlClient;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Assessment;
using Zed.Portal.Features.Staff.SiteAssessment;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// Admin → Email Templates (new in V4): every e-mail of this portal (its Razor templates) and of its database procedures
/// (sent by Zed.Jobs): switch it off, or give it the Admin's own subject and HTML body with {{Placeholder}} fields
/// (<see cref="IEmailTemplateStore"/>, dbo.V4EmailTemplates, migration 0015). Reset goes back to the standard e-mail.
/// </summary>
[Route("api/staff/settings/email-templates")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed partial class EmailTemplatesController(IEmailTemplateStore store, IHtmlTemplateRenderer renderer, PortalHost host, ILogger<EmailTemplatesController> log)
    : StaffApiController
{
    public const string DbPrefix = "db:";

    /// <summary>The procedures that send mail (dbo.SP_V4_SEND_DBMAIL, migration 0003), per system's database.</summary>
    public static readonly IReadOnlyDictionary<PortalSystem, string[]> DbMailers = new Dictionary<PortalSystem, string[]>
    {
        [PortalSystem.Main] =
        [
            "SP_JOB_TO_SEND_APPLY_FOR_BRONZE_SURVEILLANCE_MAIL", "SP_JOB_TO_SEND_APPLY_FOR_BRONZE_SURVEILLANCE_MAIL_REM1",
            "SP_JOB_TO_SEND_APPLY_FOR_BRONZE_SURVEILLANCE_MAIL_REM2_BACKUP", "SP_JOB_TO_SEND_APPLY_FOR_SECOND_SURVEILLANCE_MAIL",
            "SP_JOB_TO_SEND_APPLY_FOR_SECOND_SURVEILLANCE_MAIL_REM1", "SP_JOB_TO_SEND_APPLY_FOR_SECOND_SURVEILLANCE_MAIL_REM2",
            "SP_JOB_TO_SEND_APPLY_FOR_SECOND_SURVEILLANCE_MAIL_manually", "SP_JOB_TO_SEND_APPLY_FOR_SURVEILLANCE_MAIL",
            "SP_JOB_TO_SEND_APPLY_FOR_SURVEILLANCE_MAIL_REM1", "SP_JOB_TO_SEND_APPLY_FOR_SURVEILLANCE_MAIL_REM2",
            "SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_RECERTIFICATION", "SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_SUSPENSION",
            "SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_WITHDRAW", "SP_SEND_MAIL_AUTO_ALLOT_AGENCY", "SP_SEND_MAIL_AUTO_ALLOT_AGENCY_ROUND_ROBIN",
            "SP_SEND_MAIL_AUTO_REJECT_NC_FROM_PARTIAL_REJECTION", "SP_SEND_MAIL_STATUS_COUNTS_AGENCY",
        ],
        [PortalSystem.Consultancy] =
        [
            "SP_SEND_AUTO_MAIL_TO_CONSULTANT_WHEN_CO_REJECT_QC", "SP_SEND_AUTO_MAIL_TO_MSME_FOR_CONSULTANT_REJECTION",
            "SP_SEND_AUTO_MAIL_TO_MSME_FOR_CO_ACCEPT_QC", "SP_SEND_AUTO_MAIL_TO_UNIT_FOR_TECHNOLOGY_UPGRADATIONS",
            "SP_SEND_MAIL_AUTO_ALLOT_CONSULTING_ORGANISATION_TU",
        ],
        [PortalSystem.Surveillance] =
        ["SP_SEND_AUTO_MAIL_FOR_AUTO_ALLOT_AGENCY", "SP_SEND_AUTO_MAIL_TO", "SP_SEND_MAIL_AUTO_REJECT_NC_FROM_PARTIAL_REJECTION"],
    };

    /// <summary>
    /// Mails whose text is built in code (inside EmailLayout), and the MSME app's own mails (sent by the mobile host from
    /// the same database, so the same choice applies).
    /// </summary>
    private static readonly (string Key, string Name, string Group, PortalSystem[] Systems, string[] Placeholders)[] OtherMails =
    [
        (DesktopAssessmentEmails.TemplateKey(DesktopAssessmentEmails.Kind.AllottedToAgency), "Assessment allotted to the agency", Staff, [PortalSystem.Main, PortalSystem.Surveillance], ["ZedId", "Certification"]),
        (DesktopAssessmentEmails.TemplateKey(DesktopAssessmentEmails.Kind.AllottedToAssessor), "Desktop verification allotted to the assessor", Staff, [PortalSystem.Main, PortalSystem.Surveillance], ["ZedId", "Certification"]),
        (DesktopAssessmentEmails.TemplateKey(DesktopAssessmentEmails.Kind.RejectedByAgency), "Allotment rejected by the agency", Staff, [PortalSystem.Main, PortalSystem.Surveillance], ["ZedId", "Certification"]),
        (DesktopAssessmentEmails.TemplateKey(DesktopAssessmentEmails.Kind.RejectedByAssessor), "Desktop verification rejected by the assessor", Staff, [PortalSystem.Main, PortalSystem.Surveillance], ["ZedId", "Certification"]),
        (DesktopAssessmentEmails.TemplateKey(DesktopAssessmentEmails.Kind.NcRaised), "Non-conformances raised", General, [PortalSystem.Main, PortalSystem.Surveillance], ["ZedId", "Certification"]),
        (SiteAllotmentEmails.OnsiteUnitKey, "Onsite assessment allotted (to the unit)", General, [PortalSystem.Main], ["ZedId"]),
        (SiteAllotmentEmails.OnsiteAssessorKey, "Onsite assessment allotted (to the assessors)", Staff, [PortalSystem.Main], ["ZedId"]),
        ("MsmeFinancialAssistanceEmail", "Financial assistance applied", App, [PortalSystem.Main], ["EnterpriseName", "ZedId", "PublicBaseUrl"]),
        ("MsmePasswordChangedEmail", "Password changed", App, [PortalSystem.Main], ["UserName", "UserId", "PublicBaseUrl"]),
        ("MsmeResetPasswordEmail", "Reset password", App, [PortalSystem.Main], ["EnterpriseName", "ZedId", "ResetUrl", "ValidMinutes", "PublicBaseUrl"]),
        ("MsmeSubmissionEmail", "Assessment submitted", App, [PortalSystem.Main, PortalSystem.Surveillance], ["EnterpriseName", "ZedId", "Certification", "NcCount", "PublicBaseUrl"]),
    ];

    private const string General = "MSME and general", Staff = "Staff and agencies", App = "MSME app";

    /// <summary>Razor components that are parts of other e-mails, not e-mails.</summary>
    private static readonly HashSet<string> NotEmails = ["EmailLayout", "StaffSchemeDetailTable", "ConsultancyCoAllotmentDates", "_Imports"];

    public sealed record TemplateItem(string Key, string Name, string Group, bool Database, bool Enabled, bool Customised, string? Subject,
        IReadOnlyList<string> Placeholders, string? UpdatedBy, DateTime? UpdatedOn);

    public sealed record TemplateDetails(TemplateItem Item, string BodyHtml, bool StandardBody);

    public sealed record TemplateRequest(bool Enabled, string? Subject, string? BodyHtml);

    [HttpGet]
    public async Task<IReadOnlyList<TemplateItem>> List(CancellationToken ct)
    {
        var saved = (await store.ListAsync(ct)).ToDictionary(o => o.TemplateKey, StringComparer.OrdinalIgnoreCase);
        return Catalogue().Select(c => Item(c, saved.GetValueOrDefault(c.Key))).ToList();
    }

    [HttpGet("{key}")]
    public async Task<ActionResult<TemplateDetails>> Get(string key, CancellationToken ct)
    {
        if (Catalogue().FirstOrDefault(c => c.Key == key) is not { } c) return NotFound();
        var saved = await store.GetAsync(key, ct);
        var custom = saved?.BodyHtml is { Length: > 0 };
        return new TemplateDetails(Item(c, saved), custom ? saved!.BodyHtml! : await DefaultBodyAsync(c), !custom);
    }

    [HttpPut("{key}")]
    public async Task<ActionResult<MessageResponse>> Save(string key, TemplateRequest req, CancellationToken ct)
    {
        if (Catalogue().FirstOrDefault(c => c.Key == key) is not { } c) return NotFound();
        if (req.Subject is { Length: > 400 }) return this.Problem400("The subject can have at most 400 characters.");
        if (req.BodyHtml is { Length: > 200_000 }) return this.Problem400("The e-mail text is too long.");
        var known = c.Placeholders.Concat([EmailPlaceholders.StandardBody, EmailPlaceholders.StandardSubject]).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var unknown = EmailPlaceholders.Used(req.Subject).Concat(EmailPlaceholders.Used(req.BodyHtml)).FirstOrDefault(p => !known.Contains(p));
        if (unknown is not null) return this.Problem400($"{{{{{unknown}}}}} is not a field of this e-mail.");
        if (req.BodyHtml is { } body && ScriptPattern().IsMatch(body)) return this.Problem400("Scripts are not allowed in e-mails.");

        // The standard body as it was offered is not stored: only a changed body is.
        var standard = c.Database ? null : await DefaultBodyAsync(c);
        var bodyToSave = string.IsNullOrWhiteSpace(req.BodyHtml) || req.BodyHtml.Trim() == standard?.Trim() ? null : req.BodyHtml;
        await store.SaveAsync(key, req.Enabled, req.Subject, bodyToSave, UserId, ct);
        log.LogInformation("E-mail template {Key} saved by {UserId}: enabled {Enabled}, own subject {Subject}, own body {Body}",
            key, UserId, req.Enabled, !string.IsNullOrWhiteSpace(req.Subject), bodyToSave is not null);
        return new MessageResponse(req.Enabled ? "E-mail template saved." : "E-mail template saved. This e-mail will not be sent.");
    }

    [HttpDelete("{key}")]
    public async Task<ActionResult<MessageResponse>> Reset(string key, CancellationToken ct)
    {
        if (Catalogue().All(c => c.Key != key)) return NotFound();
        try
        {
            await store.ResetAsync(key, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not reset the e-mail template {Key} (is migration 0015 applied?)", key);
            return this.Problem400("The template could not be reset. Please ask the administrator to apply database migration 0015.");
        }
        log.LogInformation("E-mail template {Key} reset to the standard e-mail by {UserId}", key, UserId);
        return new MessageResponse("The standard e-mail is used again.");
    }

    private sealed record Entry(string Key, string Name, string Group, bool Database, string[] Placeholders, Type? Component);

    private IReadOnlyList<Entry> Catalogue()
    {
        var portal = typeof(EmailTemplatesController).Assembly.GetTypes()
            .Where(t => t.Namespace == "Zed.Portal.Templates" && typeof(IComponent).IsAssignableFrom(t) && !t.IsAbstract && !NotEmails.Contains(t.Name))
            .Select(t => new Entry(t.Name, Words(t.Name.EndsWith("Email", StringComparison.Ordinal) ? t.Name[..^5] : t.Name), GroupOf(t.Name), false,
                Parameters(t).Select(p => p.Name).ToArray(), t))
            .Concat(OtherMails.Where(m => m.Systems.Contains(host.System)).Select(m => new Entry(m.Key, m.Name, m.Group, false, m.Placeholders, null)));
        var database = DbMailers.GetValueOrDefault(host.System, []).Select(p =>
            new Entry(DbPrefix + p, Words(p.Replace("SP_", "", StringComparison.Ordinal).Replace('_', ' ').ToLowerInvariant()), "Database mails", true, [], null));
        return portal.OrderBy(e => e.Group).ThenBy(e => e.Name).Concat(database).ToList();
    }

    private static TemplateItem Item(Entry c, EmailTemplateOverride? saved) =>
        new(c.Key, c.Name, c.Group, c.Database, saved?.Enabled ?? true, saved is not null, saved?.Subject,
            [.. c.Placeholders, EmailPlaceholders.StandardSubject, EmailPlaceholders.StandardBody],
            saved?.UpdatedBy, saved?.UpdatedOn);

    /// <summary>
    /// The text to start editing from: the standard e-mail rendered with {{Placeholder}} in place of each text field, or
    /// {{StandardBody}} where that is not possible (database mails, mails built in code, the app's mails, templates that
    /// need lists or tables).
    /// </summary>
    private async Task<string> DefaultBodyAsync(Entry c)
    {
        if (c.Component is null || renderer is not HtmlTemplateRenderer html) return "{{" + EmailPlaceholders.StandardBody + "}}";
        var values = new Dictionary<string, object?>();
        foreach (var p in Parameters(c.Component))
            values[p.Name] = p.PropertyType == typeof(string) ? "{{" + p.Name + "}}" : p.PropertyType.IsValueType ? Activator.CreateInstance(p.PropertyType) : null;
        try
        {
            var method = typeof(HtmlTemplateRenderer).GetMethod(nameof(HtmlTemplateRenderer.RenderStandardAsync))!.MakeGenericMethod(c.Component);
            return await (Task<string>)method.Invoke(html, [values])!;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogInformation(ex, "Template {Key} cannot be drawn with placeholders; the editor starts from {{{{StandardBody}}}}", c.Key);
            return "{{" + EmailPlaceholders.StandardBody + "}}";
        }
    }

    private static IEnumerable<PropertyInfo> Parameters(Type component) =>
        component.GetProperties(BindingFlags.Public | BindingFlags.Instance).Where(p => p.GetCustomAttribute<ParameterAttribute>() is not null);

    private static string GroupOf(string name) =>
        name.StartsWith("Consultancy", StringComparison.Ordinal) ? "Handholding (consultancy)"
        : name.StartsWith("Surveillance", StringComparison.Ordinal) ? "Surveillance"
        : name.StartsWith("Staff", StringComparison.Ordinal) ? Staff
        : General;

    private static string Words(string name)
    {
        var s = WordBreak().Replace(name, " $1").Trim();
        return s.Length == 0 ? name : char.ToUpperInvariant(s[0]) + s[1..];
    }

    [GeneratedRegex("(?<=[a-z0-9])([A-Z])")] private static partial Regex WordBreak();

    [GeneratedRegex(@"<\s*script|javascript:|\son[a-z]+\s*=", RegexOptions.IgnoreCase)] private static partial Regex ScriptPattern();
}
