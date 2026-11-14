# Admin settings that reach every portal and app (2026-11-08)

What the single Admin (main portal) sets, and where it shows. See also `USER-MANAGEMENT.md` (logins) and `CUTOVER.md`
(migrations).

## Certification levels (Administration → Certification Levels)

- **Adding a level.** "+ Add level" stores it switched off. The portal adds the level's columns on the legacy tables
  (migration 0065 does the same on every update for a level whose columns are missing):
  - `ZEDCS_V2_LIVE.dbo.Msme.Is{Code}PaymentDone`, `IsSur{Code}PaymentDone`;
  - `ZEDCS_V2_LIVE.dbo.Users.Allow{Code}Assessments` (NULL = allowed), `ReasonForBlock{Code}`;
  - `ZED_SURVEILLANCE.dbo.Msme.Is{Code}PaymentDone` (0066);
  - `SectionTypes.QrDigit`: the certificate's QR digit (ZED-X 5; added levels 6–9, then A–Z).
  When the portal's database login may not alter tables, the checklist shows "Ready after the next update".
- **Checklist** on each added level: name/logo/validity/certificate number; questionnaire (parameters, Questionnaire menu);
  fees (Masters → Payments, `?level=CODE` opens its tab); certificate and report artwork (uploaded on the page, stored in
  `Uploads/Levels/Artwork/{Code}_{certificate|report}.jpg|png`; the certificate must have the built-in background's pixel
  size); agencies allowed (Agency level allocation); database columns. Enabling is refused until questionnaire, fees,
  artwork and columns are ready (agencies are not required: the Master Admin can allot by hand).
- **Once enabled** an added level works as ZED-X: dashboard card (web and app), apply and pay, basic information,
  documents and final submit on the web, automatic agency allotment (`SP_V4_AUTO_ALLOT_AGENCY`, the level's
  `Allow{Code}Assessments`), site assessment (or desktop for a desktop level), monitoring and final submit (certificate
  number format, first surveillance), certificates, reports, verification (`/Verify/{CODE}/…`), filters, menus, staff
  dashboard card (`otherLevels`), surveillance schedule. The legacy procedures patched by `database/fixes/main/14_zedx_levels.sql`
  and `surveillance/08_zedx_levels.sql` treat every added level as ZED-X (`FN_V4_LEVEL_MODE`, `FN_V4_LEVEL_QR_DIGIT`).
- **Limits.** A desktop-mode added level has no desktop NC rounds (the legacy desktop procedures are Bronze's). Handholding
  stays Silver / Gold. Incentive "applicable for" stays Bronze / Silver / Gold.
- **Fees.** The "Fee shown" box was removed: the level card lists the Micro / Small / Medium fees of Masters → Payments, and
  each MSME's dashboard card shows its own fee (after subsidy, with GST; `api/msme/dashboard/level-fees`).

## Certification levels: how a level is assessed, and which assessors may do it (2026-11-14)

- **Assessment** (Certificate tab): Desktop only · Remote only · Onsite only · Desktop + Remote · Desktop + Onsite
  (`dbo.SectionTypes.AssessmentFlow`, migration 0072; the old `AssessmentMode` stays in step: Desktop only = 'Desktop',
  the others 'Site'). Not set = as before (Bronze Desktop only, the others Desktop + Onsite).
- **Mode of assessment** (Surveillance tab): Remote (today's flow with a meeting link) or Onsite (as an onsite assessment
  on the parameters marked "In surveillance") (`dbo.SectionTypes.SurveillanceMode`; not set = Remote). Both are saved on main and on the same level's row of the ZED_SURVEILLANCE copy, which the surveillance portal reads.
- What each choice does (all built since 2026-11-14 step 2; Bronze stays Desktop only and Silver / Gold keep a site step):
  - **Desktop only**: desktop verification, then the certificate (as Bronze).
  - **Desktop + Onsite**: desktop verification, then the agency allots an onsite assessment (the assessor app).
  - **Desktop + Remote**: desktop verification, then the agency allots a **remote** assessment with a required meeting
    link (`MsmeCertifications.MeetingLink`, migration 0073); the unit, the lead and the co-assessor get the link by mail,
    the lead joins it from the Remote Assessments page and fills the assessment in on the web (the assessor app refuses
    remote units).
  - **Remote only / Onsite only**: no desktop step: once the agency is set (automatic, the applicant's facilitator
    agency or the Master Admin's), `SP_V4_SKIP_DESKTOP` (migration 0074) puts the unit at status 6, the agency's SA
    allotment, with the history row "DesktopSkipped"; every parameter is assessed at the site (no desktop exemptions).
    An agency without site verification is taken off for the Master Admin to allot one that has it ("AgencyNeeded").
  - **Surveillance Remote**: today's flow on a meeting link. **Surveillance Onsite**: the agency allots an onsite visit
    without a link (`SP_V4_SURVEILLANCE_ACCEPT_ONSITE`, `MsmeCertifications.AssessmentVisit = 'Onsite'`, migration 0075
    on ZED_SURVEILLANCE) to assessors ticked for the level onsite; the lead assesses in the assessor app (which signs in on
    both the ZED and the surveillance hosts and opens each unit on its own) and reviews / final-submits on the web after
    the closing meeting, as a main onsite assessment.
- **Assessors**: one kind ("Assessor"). On Add / Edit the agency ticks, for each enabled level, the modes the assessor may
  do; the level's flow decides which can be ticked (`dbo.Users.AssessmentModes`, e.g. `Bronze=D;Silver=D,O`; also on
  the ZED_SURVEILLANCE copy). Not set = from the old type (Bronze Assessor: Bronze desktop; Assessor: every other level).
  `Users.AssessorType` follows the ticks (only Bronze = BronzeAssessor) for the legacy procedures and the apps.
- **Allotment**: DA Allotment offers, for each unit, the assessors ticked for its level at the desktop; SA Allotment those
  ticked for it onsite. The server checks the same when allotting.

## Parameters: the code is a number (2026-11-13)

A parameter's code (Masters → Parameters of a level, and its Excel upload) must be a number: 1, 2, 3 … A code such as
"P1" is refused ("The parameter code must be a number, e.g. 1."). The legacy procedures that the apps, the assessments
and the reports run sort parameters by `CAST(SectionCode AS int)` in about 90 places, so one code with letters made the
ZED MSME app's `GetParametersByType` answer HTTP 500 for the unit. Codes are stored without leading zeros (02 → 2).
Existing parameters keep their codes; the Excel upload checks the rule for new rows only.

## Questionnaire → Requirements: requirement text

Since 2026-11-13 every requirement has its text (`dbo.Requirements.RequirementName`, up to 2000 characters), required in
the editor on every level of ZED Certification and Surveillance. It is the requirement's title in the list and the detail
(older requirements without it show their first checkpoint, and "Missing: requirement text"). The MSME, assessor and
review pages show it. The Excel sheet has a last column "Requirement text" (empty = unchanged; required for a new
requirement, and for a changed row of a requirement that has none yet); files exported before it still upload.

**All parameters at once (2026-11-13):** the Parameters page of a level (group "Requirements of all parameters") and each
Requirements page (group "All {level} parameters") export and upload the requirements of every parameter of the level in
one sheet: a Parameter column first (P1, P2 …), then the columns above. Each row is checked and saved by its parameter's
rules, exactly as on that parameter's own sheet; a parameter the level does not have is an error (add it first). API:
`api/staff/questionnaire/{level}/all-requirements/excel` (`/template`, `/check`, `/apply`).

**Actions needed (2026-11-13):** each action of a checkpoint can be up to 500 characters (was 100), at most 20 per
checkpoint, in the editor and in Excel. Migration 0071 makes `dbo.Options.ActionsNeeded` and the ticked
`dbo.MsmeOptions.DaActions / SaActions / HhActions` nvarchar(max) so twenty long actions fit.

## Questionnaire → Requirements: video

The requirement's video (`dbo.Requirements.VideoUrl`, 0056) shows as "Watch video" next to the requirement on the MSME
self-assessment and site assessment pages, the desktop, site, remote and surveillance review pages, the handholding
milestones (main's questionnaire), and in the ZED MSME, surveillance MSME, assessor and consultant apps (field `videoUrl`
on each requirement; the assessor and consultant apps refresh it at sign-in for work already on the phone).

## States (Masters → LG Directory)

Every state drop-down, filter and server check reads `dbo.States` (active rows; `api/public/states` for the pages), read
when the portal starts, every 10 minutes and straight after an LGD import. The two names older units carry ("DADAR AND
NAGAR HAVELI", "DAMAN AND DIU") stay in the home dashboard's filter.

## Documents/Videos

Each document has the ticks ZED Certification / Consultancy / **Surveillance**; Surveillance staff (Master Admin, agencies,
assessors, Ministry, Dashboard Admin) have a Documents menu (migration 0023 now also on ZED_SURVEILLANCE).

## Email Templates

- Separate entries for the cases one template sent: "Login details: new login", "…: new password or link sent again",
  "…: sub-user", "Password changed: staff" and "Password changed: MSME". Migration 0064 copied an existing edit once.
- Database mails offer `{{To}}` and `{{ZedId}}`; the editor previews `{{StandardBody}}` with the procedure's last mail.

## Main Dashboard Cards (incentives) in the ZED MSME app

The app's My Incentives shows the Admin's built-in cards (title, highlight, details, hidden when switched off) and the
dashboard incentives (`api/public/incentive-cards`), keeping the last answer offline.

## Surveillance questionnaire ids

Surveillance copies a unit's checkpoints and evidences from main with main's ids. The checkpoint actions and the evidence's
checkpoint are now looked up within the unit's requirement (id and text first). `database/verify_surveillance_questionnaire_ids.sql`
(read-only, on ZED_SURVEILLANCE) shows how many rows the old id-only lookup got wrong.

## Professional Verification (Administration → Settings, per portal)

- **Off** (the default): the agency types the certificate number, PAN, name, e-mail and mobile of the new assessor
  (consultant). **Training portal**: the old lookup. **API**: another portal's API checks the certificate number and PAN.
- The PAN is kept in `dbo.Users.PanNo` (0068) and shown on the assessor lists (under the ID), on the assessor's details
  (next to the certificate) and on the Surveillance assessors list. On the main portal it is also written on the assessor's
  copy in `ZED_SURVEILLANCE.dbo.Users` straight after the account is created; migration 0069 copies the PANs missing there.

## Subsidy categories: Disable / Enable (Masters → Payments)

- Each subsidy category (SC, ST, woman-owned, aspirational, LWE, Himalayan, island, NER; not General) has Disable next to
  Edit. Disable asks for a reason and switches the category off on the three portals at once (`dbo.AssessmentFee`
  `SubsidyOff`, `SubsidyOffReason`, `SubsidyOffBy`, `SubsidyOffOn` of ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE;
  migration 0070).
- `dbo.FN_V4_SUBSIDY_CATEGORY` then leaves the category out: from the next payment its units are charged their next
  eligible category, General when none. Payments already made do not change. The rows show "Off", who switched it off,
  when and why; Enable switches it on again.
- A portal whose database could not be changed (migration 0070 missing, or no rights from that host) is named in the
  answer; the others are switched.
