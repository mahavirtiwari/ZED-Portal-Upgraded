# Incentive schemes (phase 1)

Approved by the user on 2026-11-20. Admin defines incentive schemes like Financial Assistance (FA) and Technology
Upgradation (TU); applicants apply through one generic form with "Add more" items; agencies verify like the assessment.
Phase 1 = Admin, applicant, desktop verification (web). Phase 2 = onsite verification in the assessor mobile app.

## Decisions (the user's)

- **Activation** per card/scheme: multi-select levels (Bronze, Silver, Gold, ZED-X, added levels), or Registration, or
  Handholding (completed: milestone 3 accepted). The built-in FA card offers Bronze / Silver / Gold only.
- **TU card toggle** "Needs the consultant's recommendation": On (default) = today's Handholding flow, untouched. Off = the
  direct scheme (`TU_DIRECT`, a framework scheme; grading by enterprise size, cap Rs 3,00,000).
- **Grading** per level (share % and maximum per level; the claim's level decides) or per enterprise size.
- **Claim window**: one claim per covered level and certificate; opens at certification; open until availed (paid), an
  upgrade (a higher level certified), or suspension / withdrawal; a re-certification opens it again (new certificate).
  Rejected → the applicant may apply again while the window is open. An application in progress continues after an
  upgrade. Suspension / withdrawal → the application goes **on hold**; the Master Admin resumes or rejects it.
- **Verification like the assessment**: round robin to a desktop agency (agencies ticked for the scheme, by the unit's
  states and sectors; reject with a reason → automatic re-allotment by reason, as `AgencyRejections`) → the agency names an
  assessor ticked for the scheme → the assessor accepts (or returns it) → desktop checks: each field/document Valid / Not
  valid with a remark → **Correction** (round n of the scheme's rounds, answered within its days; days over or last round
  still not valid → automatic rejection) / **Reject** (reason) / **Recommend** (eligible amount on the verified claim) →
  **agency QC**: approve (amount) or back to the assessor → Approved (VerificationStatus 4: the existing NEFT pages list
  it) → the MSME DFO pays by NEFT (VerificationStatus 6) → availed.
- **Users**: agencies and assessors get per-scheme ticks "Desktop verification" / "Onsite verification" (`Users.SchemeVerification`,
  "CODE:D,CODE:O"). Master Admin, Operation Admins and agency sub-users see it through screen permissions.
- **Storage** (the user's rule: columns on legacy tables): definitions in `dbo.Incentives` (`SchemeCode`, `SchemeJson`,
  `DashboardCard = 'SCHEME'`); applications in `dbo.FinancialAssistance` (`SchemeCode`, `CertificationType = SchemeCode`,
  answers in `FormAnswers`, checks in `FormChecks`); documents also as `dbo.FinancialAssistancePhotos` rows (Name =
  "{section}/{item}/{field}", PhotoId = stored file name) written at submit. Migration `0105_incentive_schemes.sql`.
- All wording uses the Texts mechanism (`| t:` / `t()`); dark buttons on applicant and Admin pages come from the skins.

## Core (backend/src/Zed.Portal/Features/Incentives) — do not restructure

| File | What |
|---|---|
| `SchemeDefinition.cs` | `SchemeDefinition` and parts (card, activation, grading, form: blocks, sections, fields, pick source, document rules, verification), `SchemeRules` (vocabulary, JSON options, `Problem()` validation) |
| `SchemeTemplates.cs` | `FinancialAssistance()` and `TechnologyUpgradation()` (= `TU_DIRECT`), today's two forms field for field |
| `SchemeStore.cs` | load / save schemes (`dbo.Incentives`), built-in card settings (`ActivatesAfter`, `RecommendationRequired`, `DirectSchemeCode`) |
| `SchemeEligibility.cs` | unit facts, `Window()` (claim window), `Grade()`, `Eligible()` |
| `SchemeApplications.cs` | statuses, `Row`, SQL, `FormAnswers` / `FormItem`, `FieldCheck`, `PathOf()` |
| `ISchemeWorkflow.cs` | applicant → staff hand-off: `AfterSubmitAsync`, `AfterCorrectionAsync` |

Field types: text, longtext, number, amount, date, choice, multichoice, yesno, copy, document, photo. Date bounds:
`today`, `certified` (the claim window's `OpenedOn`), `days:N`, `date:yyyy-MM-dd`. A document field's value is a JSON list of
stored file names (PDF/JPEG/PNG by content, ≤ 5 MB, `SchemeUploads` rules, folder `Schemes`).

## Parts and ownership

| Part | Backend folder | Frontend folder |
|---|---|---|
| A. Admin | `Features/Incentives/Admin` (+ the BuiltIn query of `Staff/Schemes/IncentiveMasterController.cs`) | `staff/incentives-admin/` (+ `staff/schemes/dashboard-cards.ts`, `staff/settings/settings.routes.ts` if used) |
| B. Applicant | `Features/Incentives/Applicant` (+ `Msme/Schemes/MsmeFinancialAssistanceController.cs` for FA activation) | `msme/incentive-schemes/` (+ `msme/dashboard/*`) |
| C. Staff verification | `Features/Incentives/Staff` (+ `Staff/Schemes/FinancialAssistanceController.cs` list filter, `Staff/Neft/NeftController.cs` wording) | `staff/scheme-verification/` (+ scheme ticks on `staff/users/*` agency/assessor pages) |

Shared files (`app.routes.ts`, `staff-menu.ts`, `SubUserPermissions.cs`, `PortalSetup.cs`, `PageTexts.json`) are wired by
the integrator: each part exports its routes from its own folder and lists the menu / permission / service registrations
it needs.
