using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Incentives.Admin;

/// <summary>
/// Admin → Incentives → Incentive Schemes (2026-11-20, approved design, docs/INCENTIVE-SCHEMES.md): the schemes the Admin defines
/// (card, activation, grading, the applicant form, verification) and the settings this work added to two built-in cards: when the
/// Financial Assistance card opens (Bronze / Silver / Gold) and whether the Technology Upgradation card needs the consultant's
/// recommendation (else it opens the chosen direct scheme). Main portal only (the Admin of the three portals works there). No
/// delete: a scheme is switched off. Before migration 0105 the list is empty and saving asks for the migration.
/// </summary>
[Route("api/staff/settings/schemes")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main)]
public sealed class SchemesAdminController(SchemeStore store, ILogger<SchemesAdminController> log) : StaffApiController
{
    public const string FaCard = "FINANCIAL_ASSISTANCE";
    public const string TuCard = "TECHNOLOGY_UPGRADATION";

    /// <summary>The levels the Financial Assistance card can open after (the user: Bronze / Silver / Gold only).</summary>
    public static readonly IReadOnlyList<string> FaLevels = ["Bronze", "Silver", "Gold"];

    private const string MigrationMessage = "The schemes could not be saved. Please ask the administrator to apply database migration 0105.";

    /// <summary>A row of the list; the page words the activation and grading itself (Admin → Texts).</summary>
    public sealed record SchemeSummary(string Code, string Name, bool Active, int OrderNo, string CardTitle,
        SchemeActivation Activation, SchemeGrading Grading, string Flow);

    public sealed record LevelOption(string Code, string Name);

    public sealed record SchemesResponse(IReadOnlyList<SchemeSummary> Schemes, IReadOnlyList<string> Templates,
        IReadOnlyList<LevelOption> Levels, IReadOnlyList<string> Sizes);

    public sealed record CreateRequest(string? Template, string? Code, string? Name);

    public sealed record ActiveRequest(bool Active);

    public sealed record FaCardSettings(IReadOnlyList<string>? ActivatesAfter);

    public sealed record SchemeOption(string Code, string Name, bool Active);

    public sealed record TuCardSettings(bool RecommendationRequired, string? DirectSchemeCode, IReadOnlyList<SchemeOption>? Schemes = null);

    public sealed record CardSettingsDto(FaCardSettings? FinancialAssistance, TuCardSettings? TechnologyUpgradation);

    /// <summary>GET api/staff/settings/schemes — every scheme; the first call adds the direct Technology Upgradation scheme (off).</summary>
    [HttpGet]
    public async Task<SchemesResponse> List(CancellationToken ct)
    {
        var all = await EnsureDirectTuAsync(await store.AllAsync(ct), ct);
        return new SchemesResponse(
            all.OrderBy(d => d.OrderNo).ThenBy(d => d.Name).Select(d => new SchemeSummary(d.Code, d.Name, d.Active, d.OrderNo, d.Card.Title,
                d.Activation, d.Grading, d.Verification.Flow)).ToList(),
            [.. SchemeTemplates.All.Keys],
            LevelRegistry.All.Select(l => new LevelOption(l.Code, l.Name)).ToList(),
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
        if (all.Any(s => string.Equals(s.Code, code, StringComparison.OrdinalIgnoreCase))) return this.Problem400($"The code {code} is already used.");
        d = d with { Active = false, OrderNo = all.Count == 0 ? 1 : all.Max(s => s.OrderNo) + 1 };
        if (SchemeRules.Problem(d, LevelRegistry.Codes) is { } problem) return this.Problem400(problem);

        try
        {
            await store.SaveAsync(d, isNew: true, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Could not add scheme {Code} (is migration 0105 applied, or the code used?)", code);
            return this.Problem400($"The scheme could not be added. The code {code} may be in use, or database migration 0105 is not applied.");
        }
        log.LogInformation("Scheme {Code} added from {Template} by {UserId}", code, string.IsNullOrWhiteSpace(req.Template) ? "blank" : req.Template.Trim(), UserId);
        return new MessageResponse("Scheme added. It is off until you switch it on.");
    }

    /// <summary>PUT api/staff/settings/schemes/{code} — the whole definition, checked by <see cref="SchemeRules.Problem"/>.</summary>
    [HttpPut("{code}")]
    public async Task<ActionResult<MessageResponse>> Save(string code, SchemeDefinition? d, CancellationToken ct)
    {
        if (d is null) return this.Problem400("Please fill in the scheme.");
        if (!string.Equals(d.Code?.Trim(), code.Trim(), StringComparison.OrdinalIgnoreCase)) return this.Problem400("The code cannot be changed.");
        if (await store.FindAsync(code, ct) is not { } existing) return NotFound();
        d = d with { Code = existing.Code, Name = d.Name?.Trim() ?? "" };
        if (SchemeRules.Problem(d, LevelRegistry.Codes) is { } problem) return this.Problem400(problem);
        if (d.Active && NoBenefit(d)) return this.Problem400("Set the share and maximum of the grading before switching the scheme on.");
        if (await SaveAsync(d, ct) is { } failed) return failed;
        log.LogInformation("Scheme {Code} saved ({State}) by {UserId}", d.Code, d.Active ? "on" : "off", UserId);
        return new MessageResponse("Scheme saved.");
    }

    /// <summary>POST api/staff/settings/schemes/{code}/active — switch a scheme on or off.</summary>
    [HttpPost("{code}/active")]
    public async Task<ActionResult<MessageResponse>> SetActive(string code, ActiveRequest req, CancellationToken ct)
    {
        if (await store.FindAsync(code, ct) is not { } d) return NotFound();
        if (req.Active)
        {
            if (SchemeRules.Problem(d, LevelRegistry.Codes) is { } problem) return this.Problem400(problem);
            if (NoBenefit(d)) return this.Problem400("Set the share and maximum of the grading before switching the scheme on.");
        }
        if (await SaveAsync(d with { Active = req.Active }, ct) is { } failed) return failed;
        log.LogInformation("Scheme {Code} switched {State} by {UserId}", d.Code, req.Active ? "on" : "off", UserId);
        return new MessageResponse(req.Active ? "Scheme switched on. Eligible units see its card." : "Scheme switched off. Applications already made continue.");
    }

    /// <summary>GET api/staff/settings/schemes/cards — the Financial Assistance and Technology Upgradation cards' settings.</summary>
    [HttpGet("cards")]
    public async Task<CardSettingsDto> Cards(CancellationToken ct)
    {
        var settings = await store.CardSettingsAsync(ct);
        var schemes = await store.AllAsync(ct);
        var fa = settings.TryGetValue(FaCard, out var f) ? FaList(f.ActivationList) : null;
        settings.TryGetValue(TuCard, out var tu);
        return new CardSettingsDto(
            new FaCardSettings(fa is { Count: > 0 } ? fa : FaLevels),
            new TuCardSettings(tu?.RecommendationRequired != false, string.IsNullOrWhiteSpace(tu?.DirectSchemeCode) ? null : tu.DirectSchemeCode.Trim(),
                schemes.Select(s => new SchemeOption(s.Code, s.Name, s.Active)).ToList()));
    }

    /// <summary>PUT api/staff/settings/schemes/cards — saves both cards' settings.</summary>
    [HttpPut("cards")]
    public async Task<ActionResult<MessageResponse>> SaveCards(CardSettingsDto req, CancellationToken ct)
    {
        var faValues = req.FinancialAssistance?.ActivatesAfter ?? [];
        var fa = FaList(faValues);
        if (fa is null) return this.Problem400("Financial Assistance opens after Bronze, Silver or Gold only.");
        if (fa.Count == 0) fa = [.. FaLevels];

        var tuReq = req.TechnologyUpgradation ?? new TuCardSettings(true, null);
        var schemes = await store.AllAsync(ct);
        var direct = string.IsNullOrWhiteSpace(tuReq.DirectSchemeCode) ? null
            : schemes.FirstOrDefault(s => string.Equals(s.Code, tuReq.DirectSchemeCode.Trim(), StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrWhiteSpace(tuReq.DirectSchemeCode) && direct is null) return this.Problem400("The direct scheme was not found.");
        if (!tuReq.RecommendationRequired && direct is null) return this.Problem400("Choose the scheme Technology Upgradation opens without the recommendation.");

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
        log.LogInformation("Card settings saved by {UserId}: Financial Assistance after {Levels}; Technology Upgradation {Mode}",
            UserId, string.Join(',', fa), tuReq.RecommendationRequired ? "after the recommendation" : $"direct ({direct!.Code})");
        if (!tuReq.RecommendationRequired && !direct!.Active)
            return new MessageResponse($"Card settings saved. {direct.Name} is off: switch it on so units can apply.");
        return new MessageResponse("Card settings saved.");
    }

    /// <summary>The Financial Assistance levels in canonical spelling, or null when one is not Bronze / Silver / Gold.</summary>
    private static List<string>? FaList(IEnumerable<string> values)
    {
        var list = new List<string>();
        foreach (var v in values.Where(v => !string.IsNullOrWhiteSpace(v)))
        {
            if (FaLevels.FirstOrDefault(l => string.Equals(l, v.Trim(), StringComparison.OrdinalIgnoreCase)) is not { } l) return null;
            if (!list.Contains(l)) list.Add(l);
        }
        return [.. FaLevels.Where(list.Contains)];
    }

    private static bool NoBenefit(SchemeDefinition d) => d.Grading.Rows.All(r => r.SharePercent <= 0 || r.MaxAmount <= 0);

    /// <summary>The first list adds the direct Technology Upgradation scheme (off) when it is missing; before migration 0105 nothing.</summary>
    private async Task<IReadOnlyList<SchemeDefinition>> EnsureDirectTuAsync(IReadOnlyList<SchemeDefinition> all, CancellationToken ct)
    {
        if (all.Any(d => string.Equals(d.Code, SchemeTemplates.DirectTuCode, StringComparison.OrdinalIgnoreCase))) return all;
        var tu = SchemeTemplates.TechnologyUpgradation() with { Active = false, OrderNo = all.Count == 0 ? 1 : all.Max(d => d.OrderNo) + 1 };
        try
        {
            await store.SaveAsync(tu, isNew: true, ct);
        }
        catch (DbException ex)
        {
            log.LogDebug(ex, "The direct Technology Upgradation scheme was not added (is migration 0105 applied?)");
            return all;
        }
        log.LogInformation("Scheme {Code} added (off) from the Technology Upgradation template on the first list by {UserId}", tu.Code, UserId);
        return [.. all, tu];
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
        Activation = new() { Mode = SchemeRules.Levels, Levels = [.. FaLevels] },
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
