using Zed.Core.Security;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Staff.Monitoring;

/// <summary>Which review page an action comes from: the desktop assessment (DaDetails) or the site assessment (SaDetails).</summary>
public enum ReviewStage { Desktop, Site }

/// <summary>Agency / master-admin actions available on a review page right now.</summary>
public sealed record ReviewActions(
    bool EditRemarks,   // agency remarks on the assessor's findings (and OFI comments / meeting remarks on the SA page)
    bool FinalSubmit,   // agency final submit: completes the desktop verification (and certifies Bronze) or certifies Silver/Gold
    bool SendBack,      // back to the assessor (quality check) or, from a rejection, back into the last NC round
    bool Reject)        // agency confirms the rejection of a unit that failed its NCs
{
    public static readonly ReviewActions None = new(false, false, false, false);

    public bool Any => EditRemarks || FinalSubmit || SendBack || Reject;
}

/// <summary>
/// The review rules of the old DaDetails / SaDetails pages, enforced on the server. The old
/// MonitoringController actions only required a sign-in (any role, MSMEs included, any ZED ID); the
/// pages merely hid the buttons. Here an action is allowed only to the role, sub-role and record state
/// for which the page showed its button:
/// <list type="bullet">
/// <item>Desktop (DaDetails): the allotted agency (DesktopVerification) at status 5 (quality check):
/// edit remarks, final submit, send back. At status 7 (failed NCs, NcCount 6, Bronze): reject, and send
/// back when the rejection was not automatic. The master admin: send back at status 7 when the NC closure
/// job rejected the unit (IsAutoReject).</item>
/// <item>Site (SaDetails, Silver/Gold): the allotted agency (SiteVerification) at status 15: edit remarks
/// and OFI comments, final submit, send back. At status 17 (NcCount 6): send back and reject. The master
/// admin: send back at status 17 when the rejection was automatic.</item>
/// </list>
/// ZED_SURVEILLANCE uses the same status numbers (its send-back procedure accepts 5/15 and 7/17 with NcCount 6, the
/// final submits set 6/16, the rejection 99), so these rules serve the Surveillance host unchanged. Handholding
/// milestones (ZED_CONSULTANT) follow their own rules in Consultancy/Milestones.
/// </summary>
public static class ReviewRules
{
    public const int DesktopQualityCheck = 5;
    public const int DesktopRejected = 7;
    public const int SiteQualityCheck = 15;
    public const int SiteRejected = 17;

    /// <summary>NcCount of a unit the NC procedures or the closure job moved to rejection.</summary>
    public const int RejectedNcCount = 6;

    public static ReviewActions For(ZedUser user, CertificationRecord r, ReviewStage stage)
    {
        var bronze = string.Equals(r.Certification, "Bronze", StringComparison.OrdinalIgnoreCase);
        var auto = r.IsAutoReject == true;
        var agency = IsAllottedAgency(user, r) &&
                     user.HasSubRole(stage == ReviewStage.Desktop ? SubRoles.DesktopVerification : SubRoles.SiteVerification);
        var master = user.RoleId == (int)UserRole.MasterAdmin;

        if (stage == ReviewStage.Desktop)
        {
            if (r.Status == DesktopQualityCheck)
                return agency ? new ReviewActions(true, true, true, false) : ReviewActions.None;
            if (r.Status == DesktopRejected && bronze && r.Nc == RejectedNcCount)
                return new ReviewActions(false, false, (agency && !auto) || (master && auto), agency);
            return ReviewActions.None;
        }

        if (bronze) return ReviewActions.None;
        if (r.Status == SiteQualityCheck)
            return agency ? new ReviewActions(true, true, true, false) : ReviewActions.None;
        if (r.Status == SiteRejected && r.Nc == RejectedNcCount)
            return new ReviewActions(false, false, agency || (master && auto), agency);
        return ReviewActions.None;
    }

    /// <summary>The stage whose rules apply to a record in its current status (null when no review is pending).</summary>
    public static ReviewStage? StageOf(CertificationRecord r) => r.Status switch
    {
        DesktopQualityCheck or DesktopRejected => ReviewStage.Desktop,
        SiteQualityCheck or SiteRejected => ReviewStage.Site,
        _ => null,
    };

    public static bool IsAllottedAgency(ZedUser user, CertificationRecord r) =>
        user.RoleId == (int)UserRole.Agency && !string.IsNullOrEmpty(r.CertificationBodyUserId) &&
        string.Equals(r.CertificationBodyUserId.Trim(), user.UserId, StringComparison.OrdinalIgnoreCase);
}
