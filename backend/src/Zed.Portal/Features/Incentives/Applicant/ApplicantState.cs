using static Zed.Portal.Features.Incentives.SchemeEligibility;

namespace Zed.Portal.Features.Incentives.Applicant;

/// <summary>
/// Where a unit stands with a scheme (the dashboard tile and the page), 2026-11-20 approved design: an application in progress
/// (not Draft, not final) → "progress" ("onhold" while on hold); no claim window → "availed" when one was paid, else "locked"
/// with the reason; the window's level and certificate paid → "availed"; otherwise "open" (a draft is continued).
/// </summary>
public static class ApplicantState
{
    public const string Locked = "locked";
    public const string Open = "open";
    public const string Progress = "progress";
    public const string Availed = "availed";
    public const string OnHold = "onhold";

    /// <param name="State">locked, open, progress, onhold or availed.</param>
    /// <param name="Note">Why it is locked (notEligible, notCertified, levelNotCovered, handholding), else null.</param>
    /// <param name="Application">The application the state is about: in progress, the draft, or the paid one.</param>
    public sealed record Standing(string State, string? Note, SchemeApplications.Row? Application, ClaimWindow? Window, SchemeApplications.Row? Draft);

    public static Standing Of(SchemeDefinition d, UnitFacts unit, IReadOnlyList<SchemeApplications.Row> apps)
    {
        var window = Window(d.Activation, d.Grading, unit, out var locked);
        var draft = apps.FirstOrDefault(a => a.Status == SchemeApplications.Draft);
        var running = apps.FirstOrDefault(a => a.Status != SchemeApplications.Draft && !SchemeApplications.Final.Contains(a.Status));
        if (running is not null)
            return new(running.Status == SchemeApplications.OnHold ? OnHold : Progress, null, running, window, draft);

        var paid = apps.Where(a => a.Status == SchemeApplications.Paid).ToList();
        if (window is null)
            return paid.Count > 0 ? new(Availed, null, paid[0], null, draft) : new(Locked, locked, draft, null, draft);

        var availed = paid.FirstOrDefault(a => Same(a.SchemeLevel, window.Level) && Same(a.SchemeCertNo, window.CertRef));
        if (availed is not null) return new(Availed, null, availed, window, draft);
        return new(Open, null, draft, window, draft);
    }

    private static bool Same(string? a, string? b) => string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);

    /// <summary>The applicant's message for a locked scheme (the page shows the Texts wording of the reason key when there is one).</summary>
    public static string LockedMessage(string? note, SchemeActivation activation) => note switch
    {
        "notEligible" => "You are not eligible for benefits. Please contact ZED team.",
        "handholding" => "This scheme opens once your Handholding support is completed.",
        "levelNotCovered" => $"This scheme is for units certified at {Levels(activation)}.",
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
}
