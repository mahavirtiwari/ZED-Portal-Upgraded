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

# Phase 2: onsite verification (Desktop + Onsite flow)

The user's answers (2026-11-20). **Scope: incentive (FA-type scheme) verification only.** Normal assessments keep their own
agencies and their states + sectors allotment; nothing here touches them.

- **Separate onsite agencies.** The Master Admin adds them on their own page ("Onsite Verification Agencies"): an agency login
  (`dbo.Users`, RoleId 2, `AgencyKind = 'SchemeOnsite'`) with several states and, per state, its districts
  (`dbo.AgencyUserStates` rows, `Districts` = comma list of LGD district codes from `dbo.Districts`, matched with the plant's `PLgDistrictCode` or name;
  NULL / empty = the whole state; no row for the unit's state = not eligible) and the schemes it
  serves (`Users.SchemeVerification` "CODE:O"). Its Desktop / Site / Financial / Bronze flags and OrgPartnerId are always
  cleared (migration 0106 enforces it on each deploy), so no normal allotment ever picks it; the normal Assessment Agencies
  page leaves them out and refuses to edit them. The onsite agency creates its own assessors and sub-users as other agencies.
  Desktop and onsite are always different agencies and assessors.
- **Flow.** Desktop assessor **Recommend** (Desktop + Onsite scheme) → `OnsiteAllot` (no desktop-agency QC) → round robin to
  an active onsite agency serving the scheme whose states/districts cover the unit's plant state and district (not in
  `OnsiteRejectedAgencies`; history in `AgencyAllotmentHistory`) → `OnsiteWithAgency` (agency accepts, or rejects with a reason
  from `RejectionReasons`: Auto → re-allot, MasterAdmin → back to `OnsiteAllot` for the Master Admin) → the agency names one of
  its assessors ticked "CODE:O" (no date) → `OnsiteWithAssessor` → the assessor starts the visit in the assessor app →
  `OnsiteVisit` (`VisitStartedOn` = the date of verification; any number of visits a day) → **Recommend** (verified claim →
  `OnsiteVerifiedClaim`, eligible amount recomputed) → `Qc` by the **onsite agency** (the final QC: approve with amount →
  `Approved`, or back to its assessor → `OnsiteWithAssessor`) / **Reject** (reason) → `Rejected` (the applicant may apply again).
  No correction round at the visit.
- **At the visit** (assessor app, scheme visits): selfie + site photo with GPS and time (`onsite/selfie`, `onsite/site` in
  `FinancialAssistancePhotos`; first GPS → `VisitLatitude/Longitude`), the unit representative's name and mobile, per item
  `SchemeApplications.OnsiteItemsOf` photos (`OnsitePhotoName`, `Verification.OnsitePhotosMin`–`Max`, geo-tagged), per answer
  `SchemeApplications.OnsitePlacesOf` Valid / Not valid with remark (FormChecks key `OnsiteKey(path)`), overall remarks
  (`OnsiteRemarks`), then Recommend or Reject. `VisitSubmittedOn` when submitted.
- **Admin editor:** a field's "Checked at" (`FormField.CheckStage`: desktop / onsite / both; Desktop-only schemes ignore it);
  per scheme onsite photos per item (min / max).
- Statuses `OnsiteAllot`, `OnsiteWithAgency`, `OnsiteWithAssessor`, `OnsiteVisit` map to VerificationStatus 2. Migration
  `0106_incentive_onsite.sql`.

| Part | Owns |
|---|---|
| D. Web / backend | `Features/Incentives/Staff`, new `Features/Incentives/Onsite`, `staff/scheme-verification/`, new `staff/scheme-onsite/`, `staff/incentives-admin/`, the normal agency list/save exclusion, the shared wiring files |
| E. Mobile | `Zed.Main.MobileApi` (scheme visits controller; links `SchemeDefinition.cs` + `SchemeApplications.cs`), `mobile/apps/assessor` (+ `mobile/packages/shared` if needed) |

Built (2026-11-20): backend `Features/Incentives/Onsite/` (OnsiteAgencies, OnsiteAllotment, OnsiteReports, OnsiteAgencyController
`api/staff/scheme-onsite/agency`, OnsiteAgenciesController `api/staff/scheme-onsite/agencies`), frontend `staff/scheme-onsite/`
(routes `staff/scheme-onsite/agencies|allotment|qc`). The onsite agency kind reaches the session as the sub-role `SchemeOnsite`
(at sign-in); its menu is Assessors, Scheme Onsite Allotment, Scheme Onsite QC, Sub-Users. The scheme's AutoAllot switch also
governs the onsite round robin; the sweep retries `OnsiteAllot` (not after a Master Admin reason). Assessment agencies are
ticked Desktop only, onsite agencies Onsite only. Onsite photos are served from `FinancialAssistancePhotos` rows of the
application with `Name LIKE 'onsite/%'`, file in the mobile API's `Photos/{ZedId}/SchemeOnsite`, `PhotoId` = file name.

# Mails (2026-11-20)

Every step mails the person who acts next, each with **its own template** (Razor, `backend/src/Zed.Portal/Templates`), so the
Admin can switch it off or change its subject and body (placeholders) in **Admin → Email Templates → Incentive mails**. The
incentive mails are kept apart from the certification, consultancy and surveillance mails: `EmailTemplatesController.IsIncentive`
(names with "Scheme", the consultancy portal's `ConsultancyTu*`, `StaffNeftReimbursementEmail`) → group `Incentives`. Since
2026-11-21 the page has a separate **Incentives** section beside the portals (ZED Certification / Consultancy / Surveillance):
it gathers every portal's incentive mails (each read and saved on its own portal); the portals' sections leave them out. A new
scheme mail template named `…Scheme…Email` is listed there automatically. Framework templates are listed on the main portal only. Sent by `Features/Incentives/Staff/SchemeNotifier.cs`.

| Step | Template | To |
|---|---|---|
| Submitted | MsmeSchemeSubmittedEmail | Unit |
| Allotted to the desktop agency | StaffSchemeAllotAgencyEmail | Desktop agency |
| Waiting for the Master Admin (agency rejected with a "Master Admin" reason, no eligible agency, AutoAllot off) | StaffSchemeManualAllotEmail | ZED team inbox (Admin → Settings → E-mail addresses) |
| Desktop assessor named | StaffSchemeAllotAssessorEmail | Desktop assessor |
| Returned by the assessor | StaffSchemeReturnedByAssessorEmail | Desktop agency |
| Correction asked / answered | MsmeSchemeCorrectionEmail / StaffSchemeCorrectionReceivedEmail | Unit / desktop assessor |
| Recommended (Desktop flow) | StaffSchemeQcDueEmail | Desktop agency |
| Sent back from QC | StaffSchemeQcSentBackEmail | Desktop assessor |
| Allotted to the onsite agency | StaffSchemeOnsiteAllotAgencyEmail | Onsite agency |
| Onsite assessor named | StaffSchemeOnsiteAllotAssessorEmail + MsmeSchemeVisitDueEmail | Onsite assessor + unit (assessor's name and mobile) |
| Onsite recommended (app; sent by the sweep) | StaffSchemeOnsiteSubmittedEmail | Onsite agency |
| Sent back from onsite QC | StaffSchemeOnsiteQcSentBackEmail | Onsite assessor |
| Rejected (desktop, onsite, late correction, Master Admin) | MsmeSchemeRejectedEmail | Unit |
| Approved | MsmeSchemeApprovedEmail | Unit |
| Paid by NEFT | StaffNeftReimbursementEmail | Unit |
| On hold / resumed | MsmeSchemeOnHoldEmail + StaffSchemeOnHoldEmail / MsmeSchemeResumedEmail | Unit + ZED team inbox / unit |

**Rule for future incentives (the user):** any new incentive flow, or a step added to one, gets a mail at each step with its own
template in the `Incentives` group (and its row in this table). Schemes defined by the Admin in the framework get these mails
automatically; a separately coded incentive must replicate them.

# Changes after the owner's review (2026-11-20)

The owner found the flow "not as per instructions"; an audit against their words led to these changes (their answers: desktop
agencies separate too, FA moves to the framework, FA card offers all levels).

**Agencies (incentive verification only; normal assessments untouched)**
- Master Admin → **Incentive Verification Agencies** (`/staff/scheme-agencies`, API `api/staff/scheme-agencies`; the old onsite
  routes redirect / still answer): an agency is created as **Desktop** (`Users.AgencyKind = 'SchemeDesktop'`, ticks "CODE:D") or
  **Onsite** (`'SchemeOnsite'`, ticks "CODE:O"; Desktop + Onsite schemes only), with states and districts. One kind per agency, so
  desktop and onsite are always different agencies. Code: `Features/Incentives/Agencies/`.
- Desktop round robin and the Master Admin's manual list: active `SchemeDesktop` agencies ticked for the scheme whose states /
  districts cover the unit's plant state and district (no NIC-sector rule), rejecters excluded. Normal assessment agencies can no
  longer be ticked for schemes (applications already with one finish there).
- Sub-roles at sign-in `SchemeDesktop` / `SchemeOnsite`; a desktop agency's menu: Assessors, Scheme Allotment, Scheme QC, Sub-Users
  (its assessors: Scheme Verification, web only; they never get the assessor app). Migration `0107_incentive_desktop_agencies.sql`
  keeps desktop agencies' assessment flags cleared, their surveillance copy inactive, their assessors without SiteVerification.

**Verification**
- Sending for correction with no round left **rejects automatically** ("Not valid after the last correction round" + the remarks);
  the unit may apply again. The button says so first.
- An "Auto" rejection reason re-allots only while the scheme's AutoAllot is on (else: Master Admin + waiting mail).
- The bank account details are checkable (Valid / Not valid → the applicant corrects them).
- Hold on suspension / withdrawal also covers **Approved, not paid** applications (resume returns to Approved) and Registration /
  Handholding schemes (the unit's highest certificate decides). A Master Admin resume keeps `HoldReason = "Resumed: …"`, so the
  sweep does not hold it again for the same certificate in the same phase (`SchemeSweep.ResumedFor`).

**Financial Assistance card → framework scheme `FA`**
- The FA card opens scheme `FA` (created and kept up to date by `SchemeStore.EnsureBuiltInAsync`); its "Activates after" offers all
  levels (`LevelRegistry`), synced both ways with the scheme's activation and grading (levels only).
- New legacy FA applications are refused on the web and in the ZED MSME app; a legacy FA application in progress (SchemeCode NULL,
  status not 5/6) is finished on the old page and locks scheme FA until paid or rejected. A paid legacy FA counts as the claim of
  its level when made on or after that certificate's date (or for the level's first certificate); after a re-certification
  (`SP_RESET_FOR_RE_CERTIFICATION` archives rows as `{ZedId}_R_{Id}`) the new certificate opens a fresh claim.
- **Setup:** FA applications are allotted to desktop incentive agencies ticked "FA:D"; until such agencies exist they wait for the
  Master Admin's allotment (mail to the ZED team inbox).

**TU toggle**
- Off: the legacy TU page refuses new applications (a legacy TU in progress continues). On: a non-final TU_DIRECT application stays
  on the card and can be continued; no new draft. No double claim either way; a paid legacy TU for the same certificate counts as
  the TU claim. The direct scheme is created when Main Dashboard Cards opens; turning the toggle off switches it on (with a note).

**Applicant form and validations ("the current validations")**
- Units blocked for financial assistance (`IsEligibleForFinancial = 0`) cannot apply to any scheme (`financialBlocked`).
- `FormField.Unique`: a value may not repeat across the unit's other non-rejected applications of the scheme (FA `invoice_no`,
  also against legacy FA invoices).
- 3 files per document (`MaxFilesPerField`); FA categories Quality / Product / Testing as legacy; the CA certificate stays optional.
- Per-scheme **Disclaimer / Instructions / Declaration** (scheme editor; empty = the global Texts).
- Grading must cover every activation level (or "All"), by size Micro / Small / Medium; no grade = no submission.
- A suspended / withdrawn certificate above the highest active one locks the window (`suspended`).
- Stored built-in schemes (FA, TU_DIRECT) are upgraded once per `SchemeTemplates.Version` (only template fields; the Admin's other
  changes stay).
- Number fields can take whole numbers only (`FormField.WholeNumber`, Admin tick "Whole numbers only"); FA "Validity (years)" is whole numbers 1–100 (template version 3 adds the mark to the stored FA scheme).
