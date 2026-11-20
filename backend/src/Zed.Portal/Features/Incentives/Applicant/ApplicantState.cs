using static Zed.Portal.Features.Incentives.SchemeEligibility;

namespace Zed.Portal.Features.Incentives.Applicant;

/// <summary>
/// Where a unit stands with a scheme (the dashboard tile and the page), 2026-11-20 approved design: an application in progress
/// (not Draft, not final) → "progress" ("onhold" while on hold); a legacy application in progress of the flow the scheme replaces
/// → "locked" (legacyInProgress: the card opens the old page for it); no claim window → "availed" when one was paid, else
/// "locked" with the reason; the window without a grade → "locked" (notGraded); the window's level and certificate paid (or a
/// legacy application paid for it, <see cref="LegacyCounts"/>) → "availed"; a scheme not offered now (switched off, or the
/// direct Technology Upgradation scheme while the card needs the recommendation) → "locked" (closed) unless a draft is
/// continued; otherwise "open" (a draft is continued).
/// </summary>
public static class ApplicantState
{
    public const string Locked = "locked";
    public const string Open = "open";
    public const string Progress = "progress";
    public const string Availed = "availed";
    public const string OnHold = "onhold";

    /// <param name="State">locked, open, progress, onhold or availed.</param>
    /// <param name="Note">Why it is locked (notEligible, financialBlocked, notCertified, suspended, levelNotCovered, handholding,
    /// notGraded, legacyInProgress, closed), else null.</param>
    /// <param name="Application">The application the state is about: in progress, the draft, or the paid one.</param>
    public sealed record Standing(string State, string? Note, SchemeApplications.Row? Application, ClaimWindow? Window, SchemeApplications.Row? Draft);

    /// <param name="legacy">The legacy flow the scheme replaces (its applications count: Financial Assistance, Technology Upgradation).</param>
    /// <param name="offered">The scheme takes new applications now (switched on; for the direct Technology Upgradation scheme, the card is direct).</param>
    public static Standing Of(SchemeDefinition d, UnitFacts unit, IReadOnlyList<SchemeApplications.Row> apps,
        LegacyKind legacy = LegacyKind.None, bool offered = true)
    {
        var window = Window(d.Activation, d.Grading, unit, out var locked);
        var draft = apps.FirstOrDefault(a => a.Status == SchemeApplications.Draft);
        var running = apps.FirstOrDefault(a => a.Status != SchemeApplications.Draft && !SchemeApplications.Final.Contains(a.Status));
        if (running is not null)
            return new(running.Status == SchemeApplications.OnHold ? OnHold : Progress, null, running, window, draft);

        // A legacy application in progress (any level) finishes on the old flow first: no second claim beside it.
        var legacyClaims = unit.Legacy(legacy);
        if (legacyClaims.Any(c => c.InProgress)) return new(Locked, "legacyInProgress", draft, window, draft);

        var paid = apps.Where(a => a.Status == SchemeApplications.Paid).ToList();
        if (window is null)
            return paid.Count > 0 ? new(Availed, null, paid[0], null, draft) : new(Locked, locked, draft, null, draft);

        var availed = paid.FirstOrDefault(a => Same(a.SchemeLevel, window.Level) && Same(a.SchemeCertNo, window.CertRef));
        if (availed is not null) return new(Availed, null, availed, window, draft);
        if (legacyClaims.Any(c => c.Paid && LegacyCounts(c, window, unit))) return new(Availed, "legacyAvailed", null, window, draft);

        if (!offered && draft is null) return new(Locked, "closed", null, window, null);
        // 2026-11-20: a claim must find its grade (the Admin's grading covers every level; refused rather than Rs. 0).
        if (window.Grade is null) return new(Locked, "notGraded", draft, window, draft);
        return new(Open, null, draft, window, draft);
    }

    private static bool Same(string? a, string? b) => string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);

    /// <summary>The applicant's message for a locked scheme (the page shows the Texts wording of the reason key when there is one).</summary>
    public static string LockedMessage(string? note, SchemeActivation activation) => note switch
    {
        "notEligible" => "You are not eligible for benefits. Please contact ZED team.",
        "financialBlocked" => "Financial assistance is not available for your unit. Please contact ZED team.",
        "suspended" => "Your highest certificate is suspended or withdrawn. The scheme opens again once it is active.",
        "handholding" => "This scheme opens once your Handholding support is completed.",
        "levelNotCovered" => $"This scheme is for units certified at {Levels(activation)}.",
        "notGraded" => "This scheme is not yet set up for your unit's certification or size. Please contact ZED team.",
        "legacyInProgress" => "Your earlier application for this benefit is still in progress. It continues on its own page.",
        "closed" => "This scheme is not taking new applications now.",
        "notCertified" when activation.Mode == SchemeRules.Levels && activation.Levels.Count > 0 => $"This scheme opens after {Levels(activation)} certification.",
        _ => "This scheme opens after your unit is ZED certified.",
    };

    public static string Levels(SchemeActivation activation) =>
        string.Join(", ", activation.Levels.Select(l => Zed.Core.Data.LevelRegistry.Find(l)?.Name ?? l));

    /// <summary>The date the claim of an application opened: its certificate's date, the registration or the handholding.</summary>
    public static DateTime? OpenedOn(SchemeApplications.Row app, UnitFacts unit) => app.SchemeLevel switch
    {
        SchemeRules.Registration => unit.RegisteredOn,
        SchemeRules.Handholding => unit.Handholding?.CompletedOn,
        _ => unit.Certificates.FirstOrDefault(c => Same(c.CertNo, app.SchemeCertNo))?.CertifiedOn
             ?? unit.AllCertified.FirstOrDefault(c => Same(c.CertNo, app.SchemeCertNo))?.CertifiedOn,
    };

    /// <summary>The kind of a hold for the applicant (the stored HoldReason is the staff's): "suspended", "withdrawn" or "other".</summary>
    public static string? HoldKind(string? holdReason, string status)
    {
        if (status != SchemeApplications.OnHold) return null;
        if (holdReason?.Contains("WITHDRAWN", StringComparison.OrdinalIgnoreCase) == true) return "withdrawn";
        if (holdReason?.Contains("SUSPENDED", StringComparison.OrdinalIgnoreCase) == true) return "suspended";
        return "other";
    }

    /// <summary>The applicant's sentence for a hold (2026-11-20: never the staff's "Certificate X SUSPENDED (was Verifying)").</summary>
    public static string? HoldMessage(string? kind) => kind switch
    {
        "suspended" => "Your certificate is suspended; the ZED team will resume or close the application.",
        "withdrawn" => "Your certificate is withdrawn; the ZED team will resume or close the application.",
        "other" => "The ZED team will resume or close the application.",
        _ => null,
    };
}
