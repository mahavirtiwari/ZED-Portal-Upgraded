using Zed.Core.Data;
using Zed.Portal.Features.Staff.Schemes;

namespace Zed.Portal.Features.Msme.Schemes;

/// <summary>
/// The signed-in MSME's unit as shown in the left-hand panel of the scheme pages, and the flags that decide
/// whether it may apply (SP_MSME_GET_DETAILS without a certification type, as Msme/GetDetails on the legacy pages).
/// </summary>
public sealed class SchemeUnit(IDictionary<string, object?> msme, IDictionary<string, object?>? basic, IDictionary<string, object?>? status)
{
    /// <summary>Only what the panel shows (the legacy action returned whole Msme/MsmeBasicInformation rows, password included).</summary>
    public static readonly string[] PanelColumns =
    [
        "ZedId", "EnterpriseName", "EnterpriseType", "EnterpriseTypee", "RegistrationType", "PledgeEmailId",
        "PUnitName", "PAddress", "PDistrictName", "PStateName", "PPin",
        "Activity", "TwoDigitActivity", "FourDigitActivity", "FiveDigitActivity",
    ];

    public Dictionary<string, object?> Panel()
    {
        var panel = SchemeRows.Pick(msme, PanelColumns);
        panel["UdyogAadharNo"] = basic is null ? null : SchemeRows.Pick(basic, ["UdyogAadharNo"])["UdyogAadharNo"];
        return panel;
    }

    /// <summary>MsmeBasicInformation.IsEligibleForFinancial (0 = blocked by the ZED team).</summary>
    public bool EligibleForFinancial => basic?.Text("IsEligibleForFinancial") is not ("0" or "False" or "false");

    /// <summary>MsmeBasicInformation.IsEligibleForBenefits (0 = all benefits withdrawn; the FA procedure refuses then).</summary>
    public bool EligibleForBenefits => basic?.Text("IsEligibleForBenefits") is "1" or "True" or "true";

    /// <summary>Msme.FinancialAssistanceStatus: 0 once an application was submitted (the dashboard then shows "View").</summary>
    public bool FaSubmitted => status?.Text("FinancialAssistanceStatus") == "0";

    /// <summary>ZED_CONSULTANT Msme.TechnologyUpgradation: 1 = may apply, 0 = submitted.</summary>
    public string TuFlag => status?.Text("TechnologyUpgradationStatus") ?? "";

    public static async Task<SchemeUnit?> LoadAsync(ISqlExecutor db, string zedId, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_MSME_GET_DETAILS", new { ZedId = zedId, CertificationType = (string?)null }, ct);
        return sets[0].FirstOrDefault() is { } msme ? new SchemeUnit(msme, sets[1].FirstOrDefault(), sets[2].FirstOrDefault()) : null;
    }
}
