using Zed.Portal.Features.Incentives;
using static Zed.Portal.Features.Incentives.SchemeEligibility;

namespace Zed.Main.Api.Tests;

/// <summary>2026-11-20 (approved design): the incentive schemes' core rules (definitions, claim window, grading, amounts).</summary>
public sealed class SchemeCoreTests
{
    private static readonly string[] Levels = ["Bronze", "Silver", "Gold", "ZEDX"];

    [Fact]
    public void The_two_templates_are_valid_definitions()
    {
        Assert.Null(SchemeRules.Problem(SchemeTemplates.FinancialAssistance(), Levels));
        Assert.Null(SchemeRules.Problem(SchemeTemplates.TechnologyUpgradation(), Levels));
        // Round trip through the stored JSON.
        var tu = SchemeRules.Parse(SchemeRules.Serialize(SchemeTemplates.TechnologyUpgradation()))!;
        Assert.Equal(SchemeTemplates.DirectTuCode, tu.Code);
        Assert.True(tu.Form.Sections[0].Repeating);
        Assert.Equal(SchemeRules.PickTechnologies, tu.Form.Sections[0].Pick!.Kind);
    }

    [Fact]
    public void Bad_definitions_are_refused_with_the_reason()
    {
        var tu = SchemeTemplates.TechnologyUpgradation();
        Assert.Contains("code", SchemeRules.Problem(tu with { Code = "tu direct" }, Levels));
        Assert.Contains("level", SchemeRules.Problem(tu with { Activation = new() { Mode = SchemeRules.Levels, Levels = [] } }, Levels));
        Assert.Contains("Unknown level", SchemeRules.Problem(tu with { Activation = new() { Mode = SchemeRules.Levels, Levels = ["Platinum"] } }, Levels));
        Assert.Contains("0–100", SchemeRules.Problem(tu with { Grading = new() { Mode = SchemeRules.BySize, Rows = [new("Micro", 120, 1000)] } }, Levels));
        var noClaim = tu with { Form = tu.Form with { Sections = [tu.Form.Sections[0] with { Fields = tu.Form.Sections[0].Fields.Select(f => f with { IsClaim = false }).ToList() }] } };
        Assert.Equal("Mark one amount field as the claim.", SchemeRules.Problem(noClaim, Levels));
        var badDate = tu with { Form = tu.Form with { Sections = [tu.Form.Sections[0] with { Fields = [.. tu.Form.Sections[0].Fields, new FormField { Key = "x", Label = "X", Type = "date", DateMin = "yesterday" }] }] } };
        Assert.Contains("earliest date", SchemeRules.Problem(badDate, Levels));
    }

    private static UnitFacts Unit(params Certificate[] certs) =>
        new("ZEDM000005", "Micro", "24", true, new DateTime(2026, 1, 1), certs, [], null);

    private static Certificate Cert(string level, string no, int rank, DateTime? on = null) => new(level, no, on ?? new DateTime(2026, 11, 14), null, rank);

    [Fact]
    public void The_window_is_the_highest_active_level_the_scheme_covers()
    {
        var activation = new SchemeActivation { Mode = SchemeRules.Levels, Levels = ["Bronze", "Silver"] };
        var grading = new SchemeGrading { Mode = SchemeRules.ByLevel, Rows = [new("Bronze", 75, 50000), new("Silver", 60, 50000)] };

        var w = Window(activation, grading, Unit(Cert("Bronze", "B-1", 1)), out var locked);
        Assert.Equal(("Bronze", "B-1", 75m), (w!.Level, w.CertRef, w.Grade!.SharePercent));
        Assert.Null(locked);

        // An upgrade closes the lower level's window and opens the higher one.
        w = Window(activation, grading, Unit(Cert("Bronze", "B-1", 1), Cert("Silver", "S-1", 2)), out _);
        Assert.Equal(("Silver", "S-1"), (w!.Level, w.CertRef));

        // A level the scheme does not cover (here Gold) closes it.
        Assert.Null(Window(activation, grading, Unit(Cert("Bronze", "B-1", 1), Cert("Gold", "G-1", 3)), out locked));
        Assert.Equal("levelNotCovered", locked);

        Assert.Null(Window(activation, grading, Unit(), out locked));
        Assert.Equal("notCertified", locked);
        Assert.Null(Window(activation, grading, Unit(Cert("Bronze", "B-1", 1)) with { Benefits = false }, out locked));
        Assert.Equal("notEligible", locked);
    }

    [Fact]
    public void Registration_and_handholding_windows_and_size_grading()
    {
        var bySize = new SchemeGrading { Mode = SchemeRules.BySize, Rows = [new("Micro", 80, 300000), new("Small", 60, 300000)] };
        var w = Window(new SchemeActivation { Mode = SchemeRules.Registration }, bySize, Unit(), out _);
        Assert.Equal((SchemeRules.Registration, "ZEDM000005", 80m), (w!.Level, w.CertRef, w.Grade!.SharePercent));

        Assert.Null(Window(new SchemeActivation { Mode = SchemeRules.Handholding }, bySize, Unit(), out var locked));
        Assert.Equal("handholding", locked);
        var withHh = Unit() with { Handholding = new HandholdingRow("77", new DateTime(2026, 10, 1)) };
        w = Window(new SchemeActivation { Mode = SchemeRules.Handholding }, bySize, withHh, out _);
        Assert.Equal((SchemeRules.Handholding, "77"), (w!.Level, w.CertRef));
    }

    [Theory]
    [InlineData(300000.75, 80, 300000, 240000)]   // whole rupees, then the share
    [InlineData(500000, 80, 300000, 300000)]      // capped
    [InlineData(0, 80, 300000, 0)]
    public void The_eligible_amount_is_the_share_of_the_claim_up_to_the_cap(decimal claim, decimal share, decimal cap, decimal expected) =>
        Assert.Equal(expected, Eligible(claim, new SchemeGrade("Micro", share, cap)));

    [Fact]
    public void The_claim_adds_the_claim_amounts_of_the_saved_items()
    {
        var form = SchemeTemplates.TechnologyUpgradation().Form;
        var answers = new FormAnswers
        {
            Sections = new()
            {
                ["technologies"] =
                [
                    new FormItem { Pick = "T1", Saved = true, Values = new() { ["amount_paid"] = "240000" } },
                    new FormItem { Pick = "T2", Saved = true, Values = new() { ["amount_paid"] = "60000.50" } },
                    new FormItem { Pick = "T3", Saved = false, Values = new() { ["amount_paid"] = "99999" } },
                ],
            },
        };
        Assert.Equal(300000.50m, answers.Claim(form));
        // Through the stored JSON.
        Assert.Equal(300000.50m, FormAnswers.Parse(answers.Serialize()).Claim(form));
    }

    [Fact]
    public void Card_settings_become_an_activation()
    {
        Assert.Equal(SchemeRules.Registration, FromCardSetting(["Registration"], ["Bronze"]).Mode);
        var a = FromCardSetting([], ["Bronze", "Silver", "Gold"]);
        Assert.Equal(["Bronze", "Silver", "Gold"], a.Levels);
    }

    [Fact]
    public void The_status_maps_to_the_legacy_verification_status()
    {
        Assert.Equal(1, SchemeApplications.VerificationStatus(SchemeApplications.Submitted));
        Assert.Equal(3, SchemeApplications.VerificationStatus(SchemeApplications.Qc));
        Assert.Equal(4, SchemeApplications.VerificationStatus(SchemeApplications.Approved));
        Assert.Equal(5, SchemeApplications.VerificationStatus(SchemeApplications.Rejected));
        Assert.Equal(SchemeApplications.Paid, SchemeApplications.StatusOf(new SchemeApplications.Row { SchemeStatus = SchemeApplications.Approved, VerificationStatus = 6 }));
    }

    [Fact]
    public void Onsite_statuses_and_check_stages()
    {
        // Phase 2 (2026-11-20): the onsite stage is "under verification" for the legacy pages.
        foreach (var s in new[] { SchemeApplications.OnsiteAllot, SchemeApplications.OnsiteWithAgency, SchemeApplications.OnsiteWithAssessor, SchemeApplications.OnsiteVisit })
            Assert.Equal(2, SchemeApplications.VerificationStatus(s));

        var desk = new FormField { Key = "a", Label = "A", Type = "text", AssessorChecks = true };
        var onsite = desk with { CheckStage = SchemeRules.StageOnsite };
        var both = desk with { CheckStage = SchemeRules.StageBoth };
        Assert.Equal(SchemeRules.StageDesktop, SchemeRules.StageOf(desk));
        // Desktop + Onsite: each stage checks its own fields; "both" is checked twice.
        Assert.True(SchemeRules.DesktopChecks(desk, SchemeRules.DesktopOnsite));
        Assert.False(SchemeRules.OnsiteChecks(desk, SchemeRules.DesktopOnsite));
        Assert.False(SchemeRules.DesktopChecks(onsite, SchemeRules.DesktopOnsite));
        Assert.True(SchemeRules.OnsiteChecks(onsite, SchemeRules.DesktopOnsite));
        Assert.True(SchemeRules.DesktopChecks(both, SchemeRules.DesktopOnsite) && SchemeRules.OnsiteChecks(both, SchemeRules.DesktopOnsite));
        // A Desktop-only scheme checks everything at the desktop, nothing onsite.
        Assert.True(SchemeRules.DesktopChecks(onsite, SchemeRules.Desktop));
        Assert.False(SchemeRules.OnsiteChecks(both, SchemeRules.Desktop));
        Assert.False(SchemeRules.OnsiteChecks(onsite with { AssessorChecks = false }, SchemeRules.DesktopOnsite));
    }

    [Fact]
    public void Onsite_places_and_photo_items_follow_the_saved_items()
    {
        var tu = SchemeTemplates.TechnologyUpgradation();
        var section = tu.Form.Sections[0];
        var first = section.Fields.First(f => f.Type is "text" or "amount");
        var def = tu with
        {
            Verification = tu.Verification with { Flow = SchemeRules.DesktopOnsite },
            Form = tu.Form with { Sections = [section with { Fields = section.Fields.Select(f => f.Key == first.Key ? f with { AssessorChecks = true, CheckStage = SchemeRules.StageOnsite } : f).ToList() }] },
        };
        Assert.Null(SchemeRules.Problem(def, Levels));
        var answers = new FormAnswers
        {
            Sections = new()
            {
                [section.Key] =
                [
                    new FormItem { Pick = "T1", PickName = "Solar", Saved = true, Values = new() { [first.Key] = "x" } },
                    new FormItem { Pick = "T2", Saved = false, Values = new() { [first.Key] = "y" } },
                ],
            },
        };
        var places = SchemeApplications.OnsitePlacesOf(def, answers);
        Assert.Equal([SchemeApplications.PathOf(section.Key, 0, first.Key)], places.Select(p => p.Path));
        Assert.Equal("onsite:" + places[0].Path, SchemeApplications.OnsiteKey(places[0].Path));
        var items = SchemeApplications.OnsiteItemsOf(def, answers);
        Assert.Single(items);
        Assert.EndsWith("1 – Solar", items[0].Title);
        Assert.Equal($"onsite/{section.Key}/0", SchemeApplications.OnsitePhotoName(section.Key, 0));
        // A Desktop-only scheme has nothing to check onsite.
        Assert.Empty(SchemeApplications.OnsitePlacesOf(def with { Verification = def.Verification with { Flow = SchemeRules.Desktop } }, answers));
    }

    [Fact]
    public void Onsite_settings_are_validated()
    {
        var tu = SchemeTemplates.TechnologyUpgradation();
        Assert.Contains("Onsite photos", SchemeRules.Problem(tu with { Verification = tu.Verification with { OnsitePhotosMin = 4, OnsitePhotosMax = 2 } }, Levels));
        Assert.Contains("Onsite photos", SchemeRules.Problem(tu with { Verification = tu.Verification with { OnsitePhotosMax = 9 } }, Levels));
        var s = tu.Form.Sections[0];
        var bad = tu with { Form = tu.Form with { Sections = [s with { Fields = [.. s.Fields, new FormField { Key = "z", Label = "Z", Type = "text", CheckStage = "site" }] }] } };
        Assert.Contains("desktop, onsite or both", SchemeRules.Problem(bad, Levels));
    }
}
