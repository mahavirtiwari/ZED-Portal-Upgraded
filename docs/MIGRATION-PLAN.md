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
| 7 | Consultancy (32 controllers; same shapes as Main, reuse Main features) | |
| 8 | Surveillance (34 controllers + `SurveillanceServices` incl. `Surveillance` controller) | |
| 9 | Scheduled jobs and DB mail (see "SQL Server Express" below), cut-over, decommission. **Done:** Zed.Jobs service with the procedure mail outbox (25 procedures converted, 0003) and the job runner (0004), see JOBS.md. **Open:** the production Agent job schedules, cut-over, decommission. | In progress |

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

## Database (SQL Server 2022 Express)

Restored from the three schema scripts by `database/setup.ps1` (details in `database/README.md`). Open items:

- **12 SEQUENCE objects were missing from the export** (`MsmeIdSequence`, `PaymentSequence`, `CertificateSequence`, …).
  Local stand-ins start at 1. Before cut-over, script the real ones (with current values) from production.
- **Databases referenced but not provided:** `ZED_CENTER_AUDIT_PROFESSIONAL`, `ZED_CENTER_AUDIT_V2`, `KAWACH`,
  `ZED_IMPACT_ASSESSMENT`. Core procedures use them (e.g. the registration e-mail check). Locally, empty stubs
  with a `candidates` table are created by `database/seed/dev-registration-data.sql`. Please provide their schemas.
- **18 procedures do not compile against the current tables** (they reference dropped/renamed columns), so they
  are already broken in production; list in `database/README.md`. Check whether any screen still uses them.
- **SQL Server Express limits:** 10 GB per database, 1 socket / 4 cores, ~1.4 GB buffer pool, **no SQL Agent and
  no Database Mail.** Check production database sizes first; if any is near 10 GB, Express is not suitable
  (Standard edition, or SQL Server 2025 Express whose limit is 50 GB).
  - 25 procedures call `msdb.dbo.sp_send_dbmail` and the `SP_JOB_*` / `SP_DAILY_RUN_*` procedures are run by
    Agent jobs today. Plan: a .NET background worker (Hangfire or Quartz.NET) that runs those procedures on the
    same schedules and sends their mail through `IEmailSender`. Need the production Agent job list and schedules.
- Confirm production compatibility level and collation (local: 160, `SQL_Latin1_General_CP1_CI_AS`).

## Behaviour changes made on purpose (pilot)

- Security fixes listed in `SECURITY-FINDINGS.md` (master passwords refused, server-side OTP, stronger random values, …).
- Forgot-password gives the same answer for unknown ZED IDs.
- Reset-password requires 8–50 characters with upper, lower, digit and symbol (old: no rule).
- The "password changed" e-mail no longer contains the password.
- The old UAM (pre-Udyam) registration path is not ported; the old page only offered Udyam.
- Web registrations are still stored with `RegistrationFrom = 'App'`, exactly as the old page did.
