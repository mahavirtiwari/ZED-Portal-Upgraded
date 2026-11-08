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
