using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Zed.Core.Data;

namespace Zed.Portal.Features.ExternalApi;

/// <summary>A group of partner APIs the Admin switches on or off as one (Administration → API Integrations).</summary>
public sealed record PartnerApiGroup(string Key, string Name, string UsedBy, string Description, IReadOnlyList<string> Endpoints);

/// <summary>
/// The partner APIs of the old portal that V4 serves, grouped by who calls them (MsmeController, TokenController and
/// ApiSecureController of the legacy code). Switched off: dbo.V4Settings "PartnerApi.{Key}.Enabled" = "false"; the calls
/// are then answered 503 (see <see cref="PartnerApiAttribute"/>). Not carried into V4: the Saathi Unit/* API and the
/// unauthenticated ApiSecure helper actions (they handed out AES keys).
/// </summary>
public static class PartnerApiGroups
{
    public const string Tokens = "tokens";
    public const string Lookups = "lookups";
    public const string StateCertifications = "state-certifications";
    public const string Incentives = "incentives";
    public const string Udyami = "udyami";
    public const string UdyamiSignIn = "udyami-signin";
    public const string Finance = "finance";
    public const string Secure = "secure";

    public static readonly IReadOnlyList<PartnerApiGroup> All =
    [
        new(Tokens, "Token issuing", "Every partner with a client id",
            "Issues the short-lived tokens the other partner APIs take. Off: no partner can get a new token.",
            ["Token/GenerateToken"]),
        new(Lookups, "Certificate lookups", "Banks, financial institutions and portals checking ZED certificates (e.g. the Saathi portal)",
            "ZED certificate and unit details by ZED ID, Udyam or certificate number, and the list of certified units.",
            ["Msme/DownloadCertificate", "Msme/GetZedDetails", "Msme/GetZedDetailsByUdyam", "Msme/GetDetailsByUdyam", "Msme/GetCertifiedUnits",
             "Msme/GetDetailsByCertification", "Msme/GetDetailsByCertifications"]),
        new(StateCertifications, "State certification lists", "State governments (Andhra Pradesh)",
            "Certified and handholding units of a state with the state subsidy, page by page.",
            ["Msme/GetStateCertificationsByPage"]),
        new(Incentives, "Incentive submission", "State and central incentive portals",
            "Partners send the incentives and disbursements they gave to ZED units.",
            ["Msme/SubmitIncentive", "Msme/SubmitIncentiveV2"]),
        new(Udyami, "Udyami Bharat registration", "Udyami Bharat portal (UBP)",
            "Registers units coming from the Udyami portal and returns their certificates.",
            ["Msme/RegisterPlant", "Msme/GetCertificatesByUdyam", "Msme/GetCertificateDetails"]),
        new(UdyamiSignIn, "Udyami Bharat sign-in", "Udyami Bharat portal (UBP)",
            "Signs a unit in to ZED from the Udyami portal (the token is verified with UBP).",
            ["api/msme/auth/udyami-bharat"]),
        new(Finance, "Receipts and invoices", "QCI ERP (finance)",
            "The finance system uploads TA/DA invoices and payment receipts.",
            ["Msme/UploadReceiptInvoice"]),
        new(Secure, "Encrypted API and RAMP dashboard", "RAMP dashboard and AES partners",
            "AES-encrypted certification details and the ZED / handholding lists of the RAMP dashboard.",
            ["ApiSecure/GenerateToken", "ApiSecure/GetDetailsByCertification", "ApiSecure/GetMsmeList", "ApiSecure/GetMsmeHandholdingList"]),
    ];

    public static string EnabledKey(string group) => $"PartnerApi.{group}.Enabled";

    public static async Task<bool> IsEnabledAsync(IPortalSettings settings, string group, CancellationToken ct) =>
        !string.Equals(await settings.GetAsync(EnabledKey(group), ct), "false", StringComparison.OrdinalIgnoreCase);
}

/// <summary>Answers 503 when the Admin has switched the action's partner API group off.</summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class PartnerApiAttribute(string group) : Attribute, IAsyncActionFilter
{
    public string Group { get; } = group;

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var settings = context.HttpContext.RequestServices.GetService<IPortalSettings>();
        if (settings is not null && !await PartnerApiGroups.IsEnabledAsync(settings, Group, context.HttpContext.RequestAborted))
        {
            context.HttpContext.RequestServices.GetService<ILoggerFactory>()?.CreateLogger("Zed.ExternalApi")
                .LogInformation("Partner API {Group} is switched off: {Path} refused", Group, context.HttpContext.Request.Path);
            context.Result = new ObjectResult(new { StatusCode = "503", Message = "This service is switched off. Please contact the ZED team." }) { StatusCode = 503 };
            return;
        }
        await next();
    }
}
