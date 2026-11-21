using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Incentives.Admin;

/// <summary>
/// Admin → Incentives → Incentive Schemes (2026-11-20, approved design, docs/INCENTIVE-SCHEMES.md): the schemes the Admin defines
/// (card, activation, grading, the applicant form, verification) and the settings this work added to two built-in cards: when the
/// Financial Assistance card opens (any certification level; since 2026-11-20 it is the activation of the built-in Financial
/// Assistance scheme, <see cref="SchemeTemplates.FaCode"/>, which the card opens) and whether the Technology Upgradation card
/// needs the consultant's recommendation (else it opens the chosen direct scheme). Main portal only (the Admin of the three
/// portals works there). No delete: a scheme is switched off. Before migration 0105 the list is empty and saving asks for the
/// migration.
/// </summary>
[Route("api/staff/settings/schemes")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main)]
public sealed class SchemesAdminController(SchemeStore store, ILogger<SchemesAdminController> log) : StaffApiController
{
    public const string FaCard = SchemeStore.FaCard;
    public const string TuCard = SchemeStore.TuCard;

    /// <summary>The levels a blank scheme opens after.</summary>
    public static readonly IReadOnlyList<string> DefaultLevels = ["Bronze", "Silver", "Gold"];

    private const string MigrationMessage = "The schemes could not be saved. Please ask the administrator to apply database migration 0105.";

    /// <summary>A row of the list; the page words the activation and grading itself (Admin → Texts).</summary>
    public sealed record SchemeSummary(string Code, string Name, bool Active, int OrderNo, string CardTitle,
        SchemeActivation Activation, SchemeGrading Grading, string Flow);

    public sealed record LevelOption(string Code, string Name);

    public sealed record SchemesResponse(IReadOnlyList<SchemeSummary> Schemes, IReadOnlyList<string> Templates,
        IReadOnlyList<LevelOption> Levels, IReadOnlyList<string> Sizes);

    public sealed record CreateRequest(string? Template, string? Code, string? Name);

    public sealed record ActiveRequest(bool Active);

    /// <param name="ActivatesAfter">The level codes the card (and the Financial Assistance scheme) opens after.</param>
    /// <param name="Levels">Every certification level (Admin → Certification Levels), offered as ticks (in the GET only).</param>
    public sealed record FaCardSettings(IReadOnlyList<string>? ActivatesAfter, IReadOnlyList<LevelOption>? Levels = null);

    public sealed record SchemeOption(string Code, string Name, bool Active);

    public sealed record TuCardSettings(bool RecommendationRequired, string? DirectSchemeCode, IReadOnlyList<SchemeOption>? Schemes = null);

    public sealed record CardSettingsDto(FaCardSettings? FinancialAssistance, TuCardSettings? TechnologyUpgradation);

    /// <summary>GET api/staff/settings/schemes — every scheme; the first call adds the built-in schemes (FA on, direct TU off).</summary>
    [HttpGet]
    public async Task<SchemesResponse> List(CancellationToken ct)
    {
        var all = await store.EnsureBuiltInAsync(ct);
        return new SchemesResponse(
            all.OrderBy(d => d.OrderNo).ThenBy(d => d.Name).Select(d => new SchemeSummary(d.Code, d.Name, d.Active, d.OrderNo, d.Card.Title,
                d.Activation, d.Grading, d.Verification.Flow)).ToList(),
            [.. SchemeTemplates.All.Keys],
            Levels(),
            SchemeRules.Sizes);
    }

    /// <summary>GET api/staff/settings/schemes/{code} — the full definition.</summary>
    [HttpGet("{code}")]
    public async Task<ActionResult<SchemeDefinition>> Get(string code, CancellationToken ct) =>
        await store.FindAsync(code, ct) is { } d ? d : NotFound();

    /// <summary>POST api/staff/settings/schemes — a new scheme (off) from a template ("FA" / "TU") or a blank one.</summary>
    [HttpPost]
    public async Task<ActionResult<MessageResponse>> Create(CreateRequest req, CancellationToken ct)
    {
        var code = req.Code?.Trim().ToUpperInvariant() ?? "";
        var name = req.Name?.Trim() ?? "";
        if (!SchemeRules.CodePattern().IsMatch(code)) return this.Problem400("The code: 2–40 capital letters, digits or _ , starting with a letter.");
        if (name.Length is 0 or > 200) return this.Problem400("The name is required (up to 200 characters).");

        SchemeDefinition d;
        if (string.IsNullOrWhiteSpace(req.Template)) d = Blank(code, name);
        else if (SchemeTemplates.All.FirstOrDefault(t => string.Equals(t.Key, req.Template.Trim(), StringComparison.OrdinalIgnoreCase)) is { Value: { } make })
            d = make(code) with { Name = name };
        else return this.Problem400("Choose a template: Financial Assistance, Technology Upgradation or blank.");

        var all = await store.AllAsync(ct);
        // The built-in codes are kept for the built-in schemes (added on the first list).
        if (all.Any(s => string.Equals(s.Code, code, StringComparison.OrdinalIgnoreCase)) || SchemeTemplates.BuiltInTemplate(code) is not null)
            return this.Problem400($"The code {code} is already used.");
        d = d with { Active = false, OrderNo = all.Count == 0 ? 1 : all.Max(s => s.OrderNo) + 1 };
        if (SchemeRules.Problem(d, LevelRegistry.Codes) is { } problem) return this.Problem400(problem);

        try
        {
            await store.SaveAsync(d, isNew: true, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Could not add scheme {Code}", code);
            return this.Problem400($"The scheme could not be added (database error). The code {code} may be in use; otherwise please report it with the time.");
        }
        log.LogInformation("Scheme {Code} added from {Template} by {UserId}", code, string.IsNullOrWhiteSpace(req.Template) ? "blank" : req.Template.Trim(), UserId);
        return new MessageResponse("Scheme added. It is off until you switch it on.");
    }

    /// <summary>
    /// PUT api/staff/settings/schemes/{code} — the whole definition, checked by <see cref="SchemeRules.Problem"/>. The Financial
    /// Assistance scheme opens after levels only; its levels are also saved as the card's "Activates after".
    /// </summary>
    [HttpPut("{code}")]
    public async Task<ActionResult<MessageResponse>> Save(string code, SchemeDefinition? d, CancellationToken ct)
    {
        if (d is null) return this.Problem400("Please fill in the scheme.");
        if (!string.Equals(d.Code?.Trim(), code.Trim(), StringComparison.OrdinalIgnoreCase)) return this.Problem400("The code cannot be changed.");
        if (await store.FindAsync(code, ct) is not { } existing) return NotFound();
        d = d with
        {
            Code = existing.Code, Name = d.Name?.Trim() ?? "", TemplateVersion = existing.TemplateVersion,
            Disclaimer = Clean(d.Disclaimer), Instructions = Clean(d.Instructions), Declaration = Clean(d.Declaration),
        };
        var fa = IsFa(d.Code);
        if (fa && d.Activation.Mode != SchemeRules.Levels) return this.Problem400("Financial Assistance opens after certification levels only.");
        if (SchemeRules.Problem(d, LevelRegistry.Codes) is { } problem) return this.Problem400(problem);
        if (d.Active && NoBenefit(d)) return this.Problem400("Set the share and maximum of the grading before switching the scheme on.");
        if (await SaveAsync(d, ct) is { } failed) return failed;
        if (fa) await SyncFaCardAsync(d.Activation.Levels, ct);
        log.LogInformation("Scheme {Code} saved ({State}) by {UserId}", d.Code, d.Active ? "on" : "off", UserId);
        return new MessageResponse("Scheme saved.");
    }

    /// <summary>POST api/staff/settings/schemes/{code}/active — switch a scheme on or off.</summary>
    [HttpPost("{code}/active")]
    public async Task<ActionResult<MessageResponse>> SetActive(string code, ActiveRequest req, CancellationToken ct)
    {
        if (await store.FindAsync(code, ct) is not { } d) return NotFound();
        if (req.Active && ActivationProblem(d) is { } problem) return this.Problem400(problem);
        if (await SaveAsync(d with { Active = req.Active }, ct) is { } failed) return failed;
        log.LogInformation("Scheme {Code} switched {State} by {UserId}", d.Code, req.Active ? "on" : "off", UserId);
        return new MessageResponse(req.Active ? "Scheme switched on. Eligible units see its card." : "Scheme switched off. Applications already made continue.");
    }

    /// <summary>
    /// GET api/staff/settings/schemes/cards — the Financial Assistance and Technology Upgradation cards' settings. Adds the
    /// built-in schemes when missing (2026-11-20: the Main Dashboard Cards page also sets the card up).
    /// </summary>
    [HttpGet("cards")]
    public async Task<CardSettingsDto> Cards(CancellationToken ct)
    {
        var schemes = await store.EnsureBuiltInAsync(ct);
        var settings = await store.CardSettingsAsync(ct);
        settings.TryGetValue(TuCard, out var tu);
        var faScheme = schemes.FirstOrDefault(s => IsFa(s.Code));
        // The Financial Assistance scheme's levels are the card's; before the scheme exists, the card's own setting.
        var fa = faScheme?.Activation.Mode == SchemeRules.Levels && faScheme.Activation.Levels.Count > 0
            ? LevelList(faScheme.Activation.Levels)
            : settings.TryGetValue(FaCard, out var f) ? LevelList(f.ActivationList) : null;
        return new CardSettingsDto(
            new FaCardSettings(fa is { Count: > 0 } ? fa : DefaultLevels, Levels()),
            new TuCardSettings(tu?.RecommendationRequired != false, string.IsNullOrWhiteSpace(tu?.DirectSchemeCode) ? null : tu.DirectSchemeCode.Trim(),
                schemes.Where(s => !IsFa(s.Code)).Select(s => new SchemeOption(s.Code, s.Name, s.Active)).ToList()));
    }

    /// <summary>
    /// PUT api/staff/settings/schemes/cards — saves both cards' settings. Financial Assistance: the levels become the Financial
    /// Assistance scheme's activation too (a level without a grading row gets a copy of the first row, said in the message).
    /// Technology Upgradation without the recommendation: the chosen scheme is switched on when it is off (refused, with the
    /// reason, when it cannot be), so the card never ends up at "Not yet available".
    /// </summary>
    [HttpPut("cards")]
    public async Task<ActionResult<MessageResponse>> SaveCards(CardSettingsDto req, CancellationToken ct)
    {
        var fa = LevelList(req.FinancialAssistance?.ActivatesAfter ?? []);
        if (fa is null) return this.Problem400("Financial Assistance: choose among the certification levels.");
        if (fa.Count == 0) return this.Problem400("Financial Assistance: tick at least one level it opens after.");

        var tuReq = req.TechnologyUpgradation ?? new TuCardSettings(true, null);
        var schemes = await store.AllAsync(ct);
        var direct = string.IsNullOrWhiteSpace(tuReq.DirectSchemeCode) ? null
            : schemes.FirstOrDefault(s => string.Equals(s.Code, tuReq.DirectSchemeCode.Trim(), StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrWhiteSpace(tuReq.DirectSchemeCode) && (direct is null || IsFa(direct.Code))) return this.Problem400("The direct scheme was not found.");
        if (!tuReq.RecommendationRequired && direct is null) return this.Problem400("Choose the scheme Technology Upgradation opens without the recommendation.");
        var activate = !tuReq.RecommendationRequired && !direct!.Active;
        if (activate && ActivationProblem(direct!) is { } cannot)
            return this.Problem400($"{direct!.Name} is off and cannot be switched on: {cannot} Fix it in Incentive Schemes, then save again.");

        var settings = await store.CardSettingsAsync(ct);
        settings.TryGetValue(FaCard, out var faOld);
        settings.TryGetValue(TuCard, out var tuOld);
        try
        {
            await store.SaveCardSettingsAsync(new SchemeStore.CardSettings(FaCard, string.Join(',', fa), faOld?.RecommendationRequired, faOld?.DirectSchemeCode), ct);
            await store.SaveCardSettingsAsync(new SchemeStore.CardSettings(TuCard, tuOld?.ActivatesAfter, tuReq.RecommendationRequired, direct?.Code), ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Could not save the card settings (is migration 0105 applied?)");
            return this.Problem400("The card settings could not be saved. Please ask the administrator to apply database migration 0105.");
        }

        var notes = new List<string>();
        if (schemes.FirstOrDefault(s => IsFa(s.Code)) is { } faScheme)
        {
            var (grading, added) = SchemeTemplates.GradingFor(faScheme.Grading, fa);
            var updated = faScheme with { Activation = new() { Mode = SchemeRules.Levels, Levels = fa }, Grading = grading };
            if (await SaveAsync(updated, ct) is not null) return this.Problem400("The card settings were saved, but the Financial Assistance scheme could not be updated. Please save again.");
            if (added.Count > 0)
                notes.Add($"Financial Assistance grading added for {string.Join(", ", added.Select(LevelName))} ({grading.Rows[0].SharePercent:0.##} %, up to Rs. {grading.Rows[0].MaxAmount:0.##}): change it in Incentive Schemes if needed.");
        }
        if (activate)
        {
            if (await SaveAsync(direct! with { Active = true }, ct) is { } failed) return failed;
            log.LogInformation("Scheme {Code} switched on with the Technology Upgradation card by {UserId}", direct!.Code, UserId);
            notes.Add($"{direct!.Name} was off and is now switched on, so units can apply.");
        }
        log.LogInformation("Card settings saved by {UserId}: Financial Assistance after {Levels}; Technology Upgradation {Mode}",
            UserId, string.Join(',', fa), tuReq.RecommendationRequired ? "after the recommendation" : $"direct ({direct!.Code})");
        return new MessageResponse(string.Join(" ", ["Card settings saved.", .. notes]));
    }

    private static bool IsFa(string? code) => SchemeStore.Same(code, SchemeTemplates.FaCode);

    private static IReadOnlyList<LevelOption> Levels() => LevelRegistry.All.Select(l => new LevelOption(l.Code, l.Name)).ToList();

    private static string LevelName(string code) => LevelRegistry.Find(code)?.Name ?? code;

    /// <summary>Level codes in canonical spelling and the registry's order, or null when one is not a level.</summary>
    private static List<string>? LevelList(IEnumerable<string> values)
    {
        var list = new List<string>();
        foreach (var v in values.Where(v => !string.IsNullOrWhiteSpace(v)))
        {
            if (LevelRegistry.Canonical(v) is not { } l) return null;
            if (!list.Contains(l)) list.Add(l);
        }
        return [.. LevelRegistry.Codes.Where(list.Contains)];
    }

    /// <summary>Why a scheme cannot be switched on, or null.</summary>
    private static string? ActivationProblem(SchemeDefinition d) =>
        SchemeRules.Problem(d, LevelRegistry.Codes)
        ?? (NoBenefit(d) ? "Set the share and maximum of the grading before switching the scheme on." : null);

    private static bool NoBenefit(SchemeDefinition d) => d.Grading.Rows.All(r => r.SharePercent <= 0 || r.MaxAmount <= 0);

    private static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Replace("\r\n", "\n").Trim();

    /// <summary>The Financial Assistance scheme's levels saved as the card's "Activates after" (logged when it fails).</summary>
    private async Task SyncFaCardAsync(IReadOnlyList<string> levels, CancellationToken ct)
    {
        try
        {
            var old = (await store.CardSettingsAsync(ct)).GetValueOrDefault(FaCard);
            await store.SaveCardSettingsAsync(new SchemeStore.CardSettings(FaCard, string.Join(',', levels), old?.RecommendationRequired, old?.DirectSchemeCode), ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "The Financial Assistance card's levels were not updated");
        }
    }

    private async Task<ActionResult?> SaveAsync(SchemeDefinition d, CancellationToken ct)
    {
        try
        {
            await store.SaveAsync(d, isNew: false, ct);
            return null;
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Could not save scheme {Code}", d.Code);
            return this.Problem400(MigrationMessage);
        }
    }

    /// <summary>"Start blank": one section with a claim amount, open after Bronze / Silver / Gold, no benefit until graded.</summary>
    public static SchemeDefinition Blank(string code, string name) => new()
    {
        Code = code,
        Name = name,
        Card = new() { Title = name, Icon = "star" },
        Activation = new() { Mode = SchemeRules.Levels, Levels = [.. DefaultLevels] },
        Grading = new() { Mode = SchemeRules.ByLevel, Rows = [new("All", 0, 0)] },
        Form = new()
        {
            Sections =
            [
                new()
                {
                    Key = "details", Title = "Details",
                    Fields = [new() { Key = "amount_paid", Label = "Amount Paid", Type = "amount", Min = 1, Max = SchemeRules.AmountCeiling, IsClaim = true, AssessorChecks = true }],
                },
            ],
        },
    };
}
