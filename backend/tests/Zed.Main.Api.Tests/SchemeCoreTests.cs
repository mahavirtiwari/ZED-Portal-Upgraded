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

    [Fact]
    public void The_built_in_financial_assistance_scheme_is_valid() =>
        Assert.Null(SchemeRules.Problem(SchemeTemplates.FinancialAssistance(SchemeTemplates.FaCode), Levels));

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

    // ----- 2026-11-20: the legacy validations carried over, the grading coverage, the claim window's edge cases -----

    [Fact]
    public void The_templates_carry_the_legacy_validations()
    {
        var fa = SchemeTemplates.FinancialAssistance(SchemeTemplates.FaCode);
        Assert.Null(SchemeRules.Problem(fa, Levels));
        var category = fa.Form.Sections[0].Fields.Single(f => f.Key == "category");
        Assert.Equal(["Quality", "Product", "Testing"], category.Options);
        // 3 files per document (MsmeFinancialAssistanceController.MaxDocumentsPerType), in both templates.
        var docs = fa.Form.Sections.Concat(SchemeTemplates.TechnologyUpgradation().Form.Sections).SelectMany(s => s.Fields).Where(f => f.Type == "document").ToList();
        Assert.NotEmpty(docs);
        Assert.All(docs, d => Assert.Equal(3, d.MaxFiles));
        Assert.Equal(Zed.Portal.Features.Msme.Schemes.MsmeFinancialAssistanceController.MaxDocumentsPerType, SchemeRules.MaxFilesPerField);
        // The CA certificate stays optional: two invoice copies satisfy the "at least 2" rule.
        Assert.False(fa.Form.Sections[1].Fields.Single(f => f.Key == "ca_certificate").Required);
        Assert.Equal(["ca_certificate", "invoice_copy"], fa.Form.Rules.Single().Fields);
        // The invoice number cannot be claimed twice; amounts start above 0.
        Assert.True(fa.Form.Sections[1].Fields.Single(f => f.Key == "invoice_no").Unique);
        Assert.Equal(0.01m, fa.Form.Sections[1].Fields.Single(f => f.Key == "amount_paid").Min);
        // Each template has its own applicant texts.
        Assert.Contains("Financial Assistance", fa.Disclaimer);
        Assert.Contains("technolog", SchemeTemplates.TechnologyUpgradation().Disclaimer);
        Assert.NotNull(fa.Declaration);
        Assert.Equal(SchemeTemplates.Version, fa.TemplateVersion);
    }

    [Fact]
    public void Grading_must_cover_every_activation_level_or_size()
    {
        var fa = SchemeTemplates.FinancialAssistance();
        var withZedX = fa with { Activation = new() { Mode = SchemeRules.Levels, Levels = ["Bronze", "Silver", "Gold", "ZEDX"] } };
        Assert.Contains("ZED-X", SchemeRules.Problem(withZedX, Levels));
        Assert.Null(SchemeRules.Problem(withZedX with { Grading = withZedX.Grading with { Rows = [.. withZedX.Grading.Rows, new("All", 50, 10000)] } }, Levels));

        var tu = SchemeTemplates.TechnologyUpgradation();
        Assert.Contains("Medium", SchemeRules.Problem(tu with { Grading = tu.Grading with { Rows = [new("Micro", 80, 300000), new("Small", 60, 300000)] } }, Levels));
        var registration = fa with { Activation = new() { Mode = SchemeRules.Registration } };
        Assert.Contains("Registration", SchemeRules.Problem(registration, Levels));
        Assert.Null(SchemeRules.Problem(registration with { Grading = new() { Mode = SchemeRules.ByLevel, Rows = [new("Registration", 50, 1000)] } }, Levels));

        // The Financial Assistance card's levels: a level without a row gets a copy of the first row.
        var (grading, added) = SchemeTemplates.GradingFor(fa.Grading, ["Bronze", "ZEDX"]);
        Assert.Equal(["ZEDX"], added);
        Assert.Equal(new SchemeGrade("ZEDX", 75, 50000), grading.Rows[^1]);
    }

    [Fact]
    public void A_unique_field_is_a_text_number_amount_or_date_and_its_values_cannot_repeat()
    {
        var fa = SchemeTemplates.FinancialAssistance();
        var s = fa.Form.Sections[1];
        var badUnique = fa with { Form = fa.Form with { Sections = [fa.Form.Sections[0], s with { Fields = s.Fields.Select(f => f.Key == "payment_mode" ? f with { Unique = true } : f).ToList() }] } };
        Assert.Contains("can be unique", SchemeRules.Problem(badUnique, Levels));

        var answers = new FormAnswers { Sections = new() { ["expenditure"] = [new FormItem { Values = new() { ["invoice_no"] = " INV-7 " } }] } };
        var mine = Zed.Portal.Features.Incentives.Applicant.ApplicantForm.UniqueValues(fa.Form, answers).ToList();
        Assert.Equal("INV-7", Assert.Single(mine).Value);
        var problem = Zed.Portal.Features.Incentives.Applicant.ApplicantForm.UniqueProblem(mine,
            [new("invoice_no", "inv-7", "your application no. 12")]);
        Assert.Contains("application no. 12", problem);
        Assert.Null(Zed.Portal.Features.Incentives.Applicant.ApplicantForm.UniqueProblem(mine, [new("certificate_no", "INV-7", "x")]));
    }

    [Fact]
    public void The_scheme_texts_are_limited_and_stored()
    {
        var tu = SchemeTemplates.TechnologyUpgradation();
        Assert.Contains("disclaimer", SchemeRules.Problem(tu with { Disclaimer = new string('x', SchemeRules.MaxSchemeTextLength + 1) }, Levels));
        var back = SchemeRules.Parse(SchemeRules.Serialize(tu with { Instructions = "Line 1\nLine 2" }))!;
        Assert.Equal("Line 1\nLine 2", back.Instructions);
    }

    [Fact]
    public void A_unit_blocked_for_financial_assistance_has_no_window()
    {
        var activation = new SchemeActivation { Mode = SchemeRules.Levels, Levels = ["Bronze"] };
        Assert.Null(Window(activation, null, Unit(Cert("Bronze", "B-1", 1)) with { Financial = false }, out var locked));
        Assert.Equal("financialBlocked", locked);
        Assert.Null(Window(new SchemeActivation { Mode = SchemeRules.Registration }, null, Unit() with { Financial = false }, out locked));
        Assert.Equal("financialBlocked", locked);
    }

    [Fact]
    public void A_suspended_highest_certificate_closes_the_window_even_with_a_lower_one_active()
    {
        var activation = new SchemeActivation { Mode = SchemeRules.Levels, Levels = ["Bronze", "Silver"] };
        var unit = Unit(Cert("Bronze", "B-1", 1)) with
        {
            AllCertified = [new("Bronze", "B-1", new DateTime(2026, 1, 1), "ACTIVE"), new("Silver", "S-1", new DateTime(2026, 6, 1), "SUSPENDED")],
        };
        Assert.Null(Window(activation, null, unit, out var locked));
        Assert.Equal("suspended", locked);
        // Withdrawn alike; a suspended lower certificate does not close the higher one's window.
        Assert.Null(Window(activation, null, unit with { AllCertified = [unit.AllCertified[0], unit.AllCertified[1] with { Phase = "WITHDRAWN" }] }, out _));
        var silver = Unit(Cert("Silver", "S-1", 2)) with { AllCertified = [new("Bronze", "B-1", null, "SUSPENDED"), new("Silver", "S-1", null, "ACTIVE")] };
        Assert.Equal("Silver", Window(activation, null, silver, out _)!.Level);
    }

    [Fact]
    public void A_legacy_claim_counts_for_the_certificate_it_was_made_for()
    {
        var window = new ClaimWindow("Bronze", "B-2", new DateTime(2026, 6, 1), null);
        var unit = Unit(Cert("Bronze", "B-2", 1, new DateTime(2026, 6, 1)));
        // Made after the certificate: its claim. Another level: not.
        Assert.True(LegacyCounts(new LegacyClaim(1, "Bronze", new DateTime(2026, 7, 1), Paid: true), window, unit));
        Assert.False(LegacyCounts(new LegacyClaim(1, "Silver", new DateTime(2026, 7, 1), Paid: true), window, unit));
        // Made before it: the claim of the first certificate (e.g. TU after the handholding) ...
        var before = new LegacyClaim(1, "Bronze", new DateTime(2026, 3, 1), Paid: true);
        Assert.True(LegacyCounts(before, window, unit));
        // ... but after a re-certification it belonged to the earlier certificate: the new one opens a new claim.
        var recertified = unit with { Archived = [new("Bronze", "B-1", new DateTime(2023, 1, 1), "EXPIRED")] };
        Assert.False(LegacyCounts(before, window, recertified));
        Assert.True(LegacyCounts(new LegacyClaim(1, "Bronze", new DateTime(2026, 7, 1), Paid: true), window, recertified));
        Assert.False(LegacyCounts(before, new ClaimWindow(SchemeRules.Registration, "Z", null, null), unit));
        Assert.Equal("ZEDMSME000001[_]R[_]%", ArchivedPattern("ZEDMSME000001"));
    }

    [Fact]
    public void A_stored_built_in_scheme_is_upgraded_keeping_the_admins_changes()
    {
        // Version 1 as stored before: System/Quality, one file per document, no unique mark, amounts from 1, no texts.
        var v2 = SchemeTemplates.FinancialAssistance(SchemeTemplates.FaCode);
        FormField V1(FormField f) => f with
        {
            Options = f.Key == "category" ? ["System/Quality", "Product", "Testing", "Calibration"] : f.Options,
            MaxFiles = f.Type == "document" ? 1 : f.MaxFiles, Unique = false, Min = f.Type == "amount" ? 1 : f.Min,
            Label = f.Key == "agency" ? "Certifying body" : f.Label,
        };
        var v1 = v2 with
        {
            TemplateVersion = 0, Name = "FA (Admin)", Disclaimer = null, Instructions = "Our own instructions", Declaration = null,
            Grading = new() { Mode = SchemeRules.ByLevel, Rows = [new("All", 60, 40000)] },
            Form = v2.Form with
            {
                Sections = v2.Form.Sections.Select(s => s with { Fields = s.Fields.Select(V1).ToList() }).ToList(),
                Rules = [new("AtLeast", 2, ["ca_certificate", "invoice_copy"], "Please upload the invoice copy and the CA certificate of expenditure (at least 2 files).")],
            },
        };
        var up = SchemeTemplates.Upgrade(v1);
        Assert.Equal(SchemeTemplates.Version, up.TemplateVersion);
        var fields = up.Form.Sections.SelectMany(s => s.Fields).ToList();
        Assert.Equal(["Quality", "Product", "Testing", "Calibration"], fields.Single(f => f.Key == "category").Options);
        Assert.All(fields.Where(f => f.Type == "document"), f => Assert.Equal(3, f.MaxFiles));
        Assert.True(fields.Single(f => f.Key == "invoice_no").Unique);
        Assert.Equal(0.01m, fields.Single(f => f.Key == "amount_paid").Min);
        Assert.DoesNotContain("(at least 2 files).", up.Form.Rules[0].Message);
        // Kept: the Admin's name, label, grading and instructions; filled: the missing texts.
        Assert.Equal(("FA (Admin)", "Certifying body", 60m, "Our own instructions"),
            (up.Name, fields.Single(f => f.Key == "agency").Label, up.Grading.Rows[0].SharePercent, up.Instructions));
        Assert.Equal(SchemeTemplates.FaDisclaimer, up.Disclaimer);
        // Already up to date, or not a built-in scheme: unchanged.
        Assert.Same(up, SchemeTemplates.Upgrade(up));
        var other = v1 with { Code = "STATE_FA" };
        Assert.Same(other, SchemeTemplates.Upgrade(other));
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
