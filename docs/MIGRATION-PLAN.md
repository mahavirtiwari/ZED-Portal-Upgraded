# Migration plan

## Decisions (agreed)

1. **One platform.** One .NET solution with a shared core and one API per system; one Angular workspace
   with a shared library and one app per system. The three databases stay separate (their procedures
   reference each other by name, so they must live on one SQL Server instance).
2. **Keep the stored procedures.** The API calls them as the MVC code did; logic is not rewritten into C#.
3. **The `Frontend` folders are the current screens** (they are newer than the `Views` folders in the repos).
   Use the repo `Views` only for screens missing from `Frontend`.
4. **Mobile API compatibility.** The mobile app in the stores calls `SwachhSurvekshanServices` / `SurveillanceServices`
   (`SA/Login`, `SA/SubmitSelfie`, `SA/SubmitSiteTour`, …). Its source is not in this folder, so the new
   endpoints must keep the **same URLs, form/JSON field names and the `{status, errorMessage}` response shape**.
   Ask the vendor for the app source before changing that contract.

## Phases

| Phase | Scope | State |
|---|---|---|
| 1 | Foundation (solution, shared core, auth, e-mail, certificates, DB setup) + pilot: MSME login, password reset, Udyam registration | **Done** |
| 2a | Main, MSME area: layout and menu, dashboard (all but payment), certification details/status, profile, my documents, history, secure file downloads, change password, Contact ZED | **Done** |
| 2b | Main, MSME assessment reports (the "Available soon" boxes on Certification details): `BasicInfo`, `NonConformances(Sa)` (`/msme/assessment/...`), `SiteAssessmentInfo` incl. milestones (`/msme/site-assessment/...`), photo and evidence files served only to the owning MSME. Handholding Support (`/msme/handholding`, milestone acceptance) and the consultancy payment (web, callback, app actions, ERP CONSULTANCY module). **Done.** | **Done** |
| 3a | Main: ZED certification payment from the dashboard (fee options, GSTIN/PAN check, CCAvenue checkout and callback, zero-amount payment, reconciliation webhook, receipt PDF, confirmation mail, ERP postings) | **Done** |
| 3b | Main: Surveillance payment (`SurveillancePay`): eligibility gate, fee options, GSTIN/PAN, checkout, verified callback shared with ZED, reconciliation route, receipt, mail, ERP (SURVEILLANCE module) | **Done** |
| — | Consultancy (handholding) payment (`ConsultancyPay`) moves with Handholding Support in 2b; NEFT approvals (`Neft`) and agency invoices (`Invoice`, `InvoiceManagement`) are staff screens and move in phase 4; the mobile payment actions (`GetToken`, `GetTokenRSA`, `successtransmobile`, …) move in phase 6. PayU is not ported (unused, and unsafe). | |
| 4 | Main, staff side. **4a done:** staff login (`/login`), roles and sub-roles (DesktopVerification, SiteVerification, FinancialVerification) carried in the cookie, `[StaffRoles]`/`[SubRole]` authorisation, role-based menu (`staff/staff-menu.ts`; entries open the old portal until migrated), staff home, change password. **4b mostly done:** desktop assessment (allot, DA allotment/verification, non-conformances, completed/rejected, DA review page), monitoring, SA allotment, remote-assessment list, dashboards, registered MSMEs, payments lists, reports, ZED ID history, agencies/assessors, admin masters. **4b also done:** NEFT (new/approved/rejected, state-scoped), financial assistance review, incentive submissions/upload/catalogue. **4b also done:** agency and MasterAdmin review actions (remarks, OFI, final submit with certificate and mail, send back, reject), SA details, SA verification list, questionnaire requirements, assessment fee master, remote (video) assessment screen, certificates/reports. **4b remaining:** site-assessor web actions on SA details for onsite units (old `Remote/*` calls from `Assessment/SaDetails`; onsite assessors normally use the SA app), technology-upgradation staff review (duplicate of FA, unlinked), agency invoices (unreleased), questionnaire Questions page and image upload (unreachable on the old site). Original groups: desktop assessment workflow (Allot, DA allotment/verification, review page, NCs, completed/rejected); site/remote assessment and monitoring; dashboards, reports and ZED ID history; users/agencies/assessors and admin masters; schemes (FA, technology upgradation, incentives), NEFT approvals and agency invoices. | **Done** (remaining items listed) |
| 5 | Main: schemes (`FinancialAssistance`, `TechnologyUpgradation`, `Incentive`, `Webinar`, `Helpdesk`, `DynamicReports`, `ApiSecure`, `Token`). **Done:** `DynamicReports` (phase 4), external APIs (`ApiSecure`, `Token`, the `Msme/*` partner APIs for RAMP, AP, Udyami Bharat, incentive portals, ERP invoices), certificates/reports/verification. Saathi leftovers retired (`Unit`, `SelfAssessment`, `Login`, `Otp`, `SC`, `WB`, `SelfCertification`, `CitizenFeedback`, `Email`, `Error`, `Qc`, most of `Home`). MSME financial assistance and technology upgradation, public incentive pages, incentive template, Udyami Bharat sign-in hand-over. Retired (Saathi/Swachh leftovers): `Webinar`, `Helpdesk`, `QueryForm`. | **Done** |
| 6 | Mobile services (`SwachhSurvekshanServices`: Home, Msme, RA, SA) with the contract kept, in `Zed.Main.MobileApi` (see MOBILE-API.md). **Done:** compatibility layer (MVC 5 binding and JSON formats, legacy errors, safe upload storage), device binding (monitor/enforce), login throttle, master-password refusal, MSME app login. **Done:** all MSME app actions (stage-checked), site assessor and remote-assessment apps (allotment-checked), mobile payment actions on the portal (`Pay/`, `SurveillancePay/`). **Before go-live:** the live checks in MOBILE-API.md, CCAvenue mobile settings, Twilio key rotation, then device binding Monitor → Enforce. **Next:** v2 token API for the next app release. | Done (v1) |
| 7 | Consultancy (handholding; analysis in systems/CONSULTANCY-ANALYSIS.md). Staff-only portal on the shared `Zed.Portal` features (`[PortalSystems]`), with consultancy code for the milestone workflow (CO allotment, milestone review and decisions, milestone reports), the Technology Upgradation review and recommendation, and the consultant app (mobile host, `Mobile:System=Consultancy`). MSME handholding is already on main. 17 leftover controllers retired. **Done:** `Zed.Consultancy.Api` (ZED_CONSULTANT), per-system menu and routes in the one Angular app (`ng build consultancy`, base `/Consultancy/`), assessment and monitoring lists, CO allotment, milestone review (`/staff/consultancy/milestones/{zedId}/{level}`) and milestone reports, TU review and recommendation, consultancy users, reports catalogue, the consultant app (`Controllers/Consultancy`). **Before go-live:** LIVE-HARDENING.md and `database/fixes/consultancy`, `Consultancy:SharedStorageRoot`, the procedure findings (SECURITY-FINDINGS 85–99, 116–117, 120–122). | **Done** |
| 8 | Surveillance (analysis in systems/SURVEILLANCE-ANALYSIS.md). Staff portal on the shared features: Bronze desktop flow, Silver/Gold site flow with meeting links, monitoring and certification (main certificate re-used), surveillance certificates and report (served to MSMEs from main), the Bronze surveillance app and the site-assessor app (mobile host, `Mobile:System=Surveillance`). MSME surveillance payment is already on main; SurveillancePay/ConsultancyPay here are duplicates, not ported. **Done:** `Zed.Surveillance.Api` (ZED_SURVEILLANCE), `ng build surveillance` (base `/surveillance/`), Bronze desktop and Silver/Gold site/remote flows with http/https-only meeting links, monitoring review, surveillance certificates and reports (served to MSMEs and staff from main over a read-only connection), surveillance users, the Bronze surveillance and site-assessor apps (`Controllers/Surveillance`, `SurveillancePhotoController`). **Before go-live:** LIVE-HARDENING.md and `database/fixes/surveillance`, findings 100–114, 118–119, 123. | **Done** |
| 9 | Scheduled jobs and DB mail (see "SQL Server Express" below), cut-over, decommission. **Done:** Zed.Jobs service with the procedure mail outbox (25 procedures converted, 0003) and the job runner (0004), see JOBS.md. **Done:** schedule kinds for any Agent job (weekly, monthly, windows, parameters, steps), `Zed.Jobs --check`, the Agent export converter (`tools/jobs`); production hosting (Data Protection keys, optional SQL cache 0006, startup configuration check, readiness endpoints, web.config); `deploy/` publish, IIS install (dry run by default, rollback file) and smoke-test scripts; hashed passwords (0005, `Security:Passwords`, PASSWORDS.md); fix scripts for every open procedure finding (`database/fixes`); the runbook `docs/CUTOVER.md`; the folder-rename job without xp_cmdshell (`Jobs:FolderRename`, 0007); staff forgot-password and admin reset links (0008). **Open (needs production):** the Agent export, applying the fix scripts and rotations, the cut-over itself, then `Migrate`/`HashOnly` and decommission. | Ready for cut-over |

Main's controllers by size (lines : actions): Msme 3189:71, Dashboard 2540:67, Payment 1578, Assessment 1566:71,
SurveillancePay 1494, ConsultancyPay 1461, Monitoring 1127:21, SA 892:29, SelfAssessment 831:28,
ApiSecure 730:10, User 669:27, TechnologyUpgradation 668:17, Remote 593:20, FinancialAssistance 575:16,
Webinar 540:16, Incentive 476:12, then 26 smaller ones. Consultancy and Surveillance mirror most of these.

## How to migrate one module (the pilot is the template)

1. Read the controller actions, the matching `Frontend/<Module>/*.cshtml` (markup + inline AngularJS) and
   the procedures they call (`database/schema/*.sql`).
2. API: `backend/src/Zed.<System>.Api/Features/<Module>/<Module>Controller.cs`
   - `[ApiController]`, route `api/<module>/…`, JSON in/out, `ProblemDetails` for errors (`this.Problem400(msg)`).
   - Call procedures through `ISqlExecutor` (`QueryProcMultipleAsync` for multi-table results).
   - Keep the procedure's own messages; never return `ex.Message`.
   - Authorisation from the cookie (`ZedUser.FromPrincipal(User)`), never from ids sent by the browser.
   - E-mail templates: `Templates/*.razor`, rendered with `IHtmlTemplateRenderer`.
3. Tests: add to `tests/…` using `TestHost` (real pipeline, fake `ISqlExecutor`/e-mail).
4. Angular: `projects/<system>/src/app/<module>/…`, lazy route in `app.routes.ts`, styles from the old
   `Content/*.css` scoped to the page, HTTP via `HttpClient` (XSRF is automatic), errors via `apiErrorMessage`.
5. Keep old URLs that appear in e-mails or bookmarks as redirects in `app.routes.ts`.
6. Run it locally against the restored database before calling the module done.

## Links that still open the old portal (`Portal:LegacyBaseUrl`)

Until their modules move, these MSME links go to the old site: certification payment (dashboard apply flow,
phase 3), Surveillance payment (`SurveillancePay`), Financial Assistance and Technology Upgradation (phase 5),
Handholding Support (2b), incentive pages (`Incentive/Details`, phase 5), certificate PDFs and assessment
reports on the Certification details page (2b/4). WASH and webinar certificates link to msmekawach.org.in.

## Database

Local copies are built from the schema scripts by `database/setup.ps1` (details in `database/README.md`).

**Production sizes** (2026-10-21):

| Database | Data used (allocated), GB | Log allocated (used), GB | Express 2022 (10 GB) | Express 2025 (50 GB) |
|---|---|---|---|---|
| ZEDCS_V2_LIVE | 76.2 (78.3) | 359.5 (0.2) | no | **no** |
| ZED_SURVEILLANCE | 15.3 (20.3) | 43.0 (0.1) | no | yes |
| ZED_CONSULTANT | 9.9 (10.8) | 100.6 (0.1) | no (file over 10 GB) | yes |
| ZED_CENTER_AUDIT_PROFESSIONAL (referenced) | 19.4 (19.4) | 0.1 | no | yes |
| ZED_IMPACT_ASSESSMENT (referenced) | 5.0 (5.7) | 6.8 (0.1) | yes | yes |
| ZED_CENTER_AUDIT_V2 (referenced) | 2.1 (2.1) | 0.1 | yes | yes |
| ZED_QUALITY_PROFESSIONAL (referenced by V2) | 0.4 | 0.0 | yes | yes |
| KAWACH (referenced) | 0.2 | 0.5 | yes | yes |

- **SQL Server Express cannot host ZED.** ZEDCS_V2_LIVE uses 76 GB, over the 10 GB of 2022 Express and the 50 GB of
  2025 Express; ZED_SURVEILLANCE, ZED_CONSULTANT (its data file is 10.8 GB) and ZED_CENTER_AUDIT_PROFESSIONAL are over
  10 GB too. **Decision needed:** SQL Server 2022 (or 2025) **Standard** edition (recommended: no size limit that
  matters here, up to 24 cores / 128 GB buffer pool, and Agent and Database Mail are available, although V4 does not
  need them), or keep the managed instance. 2025 Express would need ZEDCS_V2_LIVE cut below 50 GB first (archiving;
  see what takes the space with the query in `docs/CUTOVER.md` 1.4). V4 runs the same on any of these.
- **One instance for the related databases.** ZED procedures use three-part names into four other applications'
  databases, and V4 reaches them: ZED_CENTER_AUDIT_PROFESSIONAL (user creation, Udyam validation, sectors),
  ZED_CENTER_AUDIT_V2 (Udyam registration, a monitoring report), KAWACH (My Documents, the Kawach reports) and
  ZED_IMPACT_ASSESSMENT (Udyam update). Those reference ZEDCS_V2_LIVE, ZED_CONSULTANT, KAWACH and
  ZED_QUALITY_PROFESSIONAL in turn. So every database of the current instance except LEAN_IMPACT moves to the same
  new instance (about 128 GB of data), and the other applications (Impact Assessment, Professional, Training,
  Quality, Kawach) are re-pointed with it, or the cross-database calls are rewritten (synonyms to a linked server),
  which is a project of its own. Checked: V4's procedures that cross over run against the provided schemas.
- **Logs:** allocated 360 / 101 / 43 GB with almost nothing used. A restore re-creates them at that size: shrink the
  log files on the old instance before the final backup, or provide the disk.
- **Sequences: done.** `database/schema/04_missing_sequences.sql` holds the production definitions (snapshot of
  2026-10-21; a backup/restore carries the current values). Two sequences the procedures use do not exist on
  production: `SaCertificateSequence` (in `SP_MONITORING_UPDATE_FINAL_SUBMIT` of all three databases) and
  `WebinarCertificateSequence` (`SP_WEBINAR_GET_CERTIFICATE_DETAILS`), so those procedures fail there today. V4 calls
  neither.
- **Referenced databases: three of four provided.** ZED_IMPACT_ASSESSMENT, ZED_CENTER_AUDIT_PROFESSIONAL and
  ZED_CENTER_AUDIT_V2 are `database/schema/05`–`07` (setup builds them). **Still needed:** the KAWACH schema export
  (locally a stand-in with the tables ZED reads), and the Professional export again **with its user-defined table
  types** (`DynamicOption`, `DynamicQuestion`: without them 5 of its own procedures do not compile; ZED does not use them).
- **18 procedures do not compile against the current tables** (they reference dropped/renamed columns), so they
  are already broken in production; list in `database/README.md`. Check whether any screen still uses them.
- **Agent jobs and Database Mail: done** (the production export is in Zed.Jobs, docs/JOBS.md). Open: the old
  instance's time zone, and the mail checks listed there.
- Confirm production compatibility level and collation (local: 160, `SQL_Latin1_General_CP1_CI_AS`).

## Behaviour changes made on purpose (pilot)

- Security fixes listed in `SECURITY-FINDINGS.md` (master passwords refused, server-side OTP, stronger random values, …).
- Forgot-password gives the same answer for unknown ZED IDs.
- Reset-password requires 8–50 characters with upper, lower, digit and symbol (old: no rule).
- The "password changed" e-mail no longer contains the password.
- The old UAM (pre-Udyam) registration path is not ported; the old page only offered Udyam.
- Web registrations are still stored with `RegistrationFrom = 'App'`, exactly as the old page did.
