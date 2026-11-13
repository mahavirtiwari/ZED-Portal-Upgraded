# ZEDCS V4

New platform for the three linked ZED systems (Main, Consultancy, Surveillance), replacing the
ASP.NET MVC 5 / .NET Framework / AngularJS code in `../ZEDCS main`, `../ZEDCS_CONSULTANCY` and
`../ZEDCS_SURVEILLANCE`. The original folders are untouched.

## Production

Since 2026-11-06 **https://zedv3.qci.org.in is the production portal**:
- **Server:** 20.219.21.200, IIS site `ZEDV4`.
- **Databases:** the `ZEDV4_` set (`ZEDV4_ZEDCS_V2_LIVE`, `ZEDV4_ZED_CONSULTANT`, `ZEDV4_ZED_SURVEILLANCE` and the related
  ones) on SQL Server 2025 Express `.\SQLEXPRESS`.
- **Data:** the system starts with its own data. The old portal (loginzed.msme.gov.in) stays as it is, view-only;
  nothing is deployed there.

The switch-over steps, the settings and the update commands are in **`docs/PRODUCTION.md`** (summary under
"Deployment" below).

| Layer    | Old                                    | New                                              |
|----------|----------------------------------------|--------------------------------------------------|
| Database | SQL Server (3 databases)               | Same 3 databases (compatibility level 160). Production: SQL Server 2025 Express on zedv3 (`ZEDV4_` names); Express for development |
| Backend  | ASP.NET MVC 5, .NET Framework 4.8/4.5.2 | ASP.NET Core, .NET 10 (LTS)                      |
| Frontend | Razor views + AngularJS 1.x + jQuery   | Angular 22 (standalone components, signals)     |

The ~1,100 stored procedures are kept and called as before (Dapper). Business rules stay in SQL.

## Layout

```
database/   setup.ps1 + cleaned schema scripts for the 3 databases, migrations/ (new V4 tables), dev seed scripts
backend/    Zed.slnx
  src/Zed.Core               shared: data access, cookie auth + XSRF, captcha, e-mail, templates, certificates, hosting
  src/Zed.Portal             portal features (controllers, mail templates, document assets) shared by the three APIs;
                             a controller is served by Main only unless marked [PortalSystems(...)]
  src/Zed.Main.Api           ZEDCS main      (DB ZEDCS_V2_LIVE)    http://localhost:5101   (host: Program.cs + settings)
  src/Zed.Consultancy.Api    ZEDCS_CONSULTANCY (DB ZED_CONSULTANT)  http://localhost:5102
  src/Zed.Surveillance.Api   ZEDCS_SURVEILLANCE (DB ZED_SURVEILLANCE) http://localhost:5103
  src/Zed.Main.MobileApi     mobile apps, old SwachhSurvekshanServices contract (DB ZEDCS_V2_LIVE) http://localhost:5104
  src/Zed.Jobs               service replacing SQL Agent + Database Mail (docs/JOBS.md)
  tests/Zed.Main.Api.Tests, tests/Zed.Main.MobileApi.Tests, tests/Zed.Jobs.Tests
frontend/   Angular workspace
  projects/shared            @zed/shared: HTTP/XSRF setup, AuthService + guard, reCAPTCHA widget
  projects/main              http://localhost:4200 (proxies /api to 5101)
  projects/consultancy       http://localhost:4201 (proxies /api to 5102)
  projects/surveillance      http://localhost:4202 (proxies /api to 5103)
docs/       PRODUCTION.md, MIGRATION-PLAN.md, SECURITY-FINDINGS.md, MOBILE-API.md, JOBS.md, CUTOVER.md (migration list)
deploy/     Update-ZedFromGit.ps1 (updates), Set-ZedProductionSettings.ps1, Install-ZedIis.ps1, Invoke-ZedDatabaseScripts.ps1, ...
mobile/     React Native apps and tools/Build-ZedApk.ps1:
  apps/zedmsme               ZED MSME, the applicant app
  apps/assessor              ZED SA, the site assessment app
  apps/consultant            ZED Consultancy, the handholding app
  apps/msme                  ZED Surveillance, the Bronze surveillance app (not the applicant app)
  packages/shared            @zed/shared: API client, local database, sync queue, shared screens
```

## What is migrated so far

Phase 1 (foundation + pilot), ZEDCS main:

- MSME login, logout, forgot password, reset password (`/msme/login`, `/msme/reset-password`)
- New MSME registration through Udyam: lookup → plant/activity → e-mail OTP → summary → ZED pledge → ZED ID,
  pledge certificate PDF and e-mail (`/msme/register`)

Phase 2a, signed-in MSME area of ZEDCS main (`/msme/...` inside the old header and menu):

- Dashboard: unit summary, certification cards and steppers, incentives, certification steps, information pop-ups,
  apply flow up to payment (payment itself continues on the old portal until phase 3)
- Certification details (Bronze/Silver/Gold, surveillance and milestone variants) and status
- View profile with "Edit Activity" (re-checked against the MSME's own Udyam record)
- My Documents with authorised downloads (`/api/msme/files/...`; only files listed for the signed-in ZED ID)
- Change password, Contact ZED

Phase 3a: paying for Bronze/Silver/Gold from the dashboard through CCAvenue (or with nothing to pay after
subsidy/reward), receipt PDF, confirmation mail and ERP postings. In Development the CCAvenue settings are dummy
values, so checkout produces a request but nothing is sent to CCAvenue.
- Old addresses that appear in e-mails already sent (`/Msme/Login`, `/Msme/ChangePassword?code=…`) redirect to the new pages

Phase 2b: MSME assessment reports (basic information, non-conformances, site assessment and milestones)
with photos and evidence served only to the owning MSME. Phase 3b: surveillance payment.

Phase 4 (staff): staff login and role menu; dashboards, registered MSMEs, failed and received
payments, financial support, reports (allow-listed), ZED ID history; desktop and site assessment workflows,
monitoring and certification, remote (video) assessments; NEFT, financial assistance and incentive reviews;
agencies, assessors and admin masters. The few items not ported are listed in `docs/MIGRATION-PLAN.md`.

Phase 5 (schemes and external APIs): MSME financial assistance and technology upgradation, public incentive
pages and template, the APIs for other systems (`ApiSecure`, `Token`, the RAMP / AP / Udyami Bharat /
incentive-portal / ERP-invoice partner APIs), certificate verification, and the Udyami Bharat sign-in
hand-over. Saathi and Swachh leftovers (`Webinar`, `Helpdesk`, `QueryForm`, `SelfAssessment`, …) are retired.

Phase 6 (mobile): `Zed.Main.MobileApi` serves the installed apps at the old addresses and
formats; see `docs/MOBILE-API.md`. `Mobile:System` (Main, Consultancy, Surveillance) picks the database and
the app controllers, so one build is deployed three times.

Phases 7 and 8: the Consultancy (`Zed.Consultancy.Api`, ZED_CONSULTANT) and Surveillance
(`Zed.Surveillance.Api`, ZED_SURVEILLANCE) staff portals. All three APIs host the shared features in
`backend/src/Zed.Portal`; `[PortalSystems(...)]` on a controller says which systems serve it (none = main only).
The Angular app is one source built three times (`ng build main|consultancy|surveillance`); `portal-system.ts`
is swapped per build and picks the routes, menu and labels.

Fixes for the live (old) sites, to apply before or independently of the cut-over: `docs/LIVE-HARDENING.md`
and `database/fixes/{main,consultancy,surveillance}` (preview by default; review each script).

Everything else is listed in `docs/MIGRATION-PLAN.md`.

## Numbering and payments (since migrations 0051 and 0052)

- **ZED IDs:** new units get `ZEDM000001`… (Manufacturing) or `ZEDS000001`… (Services). Each sector has its own counter,
  and after 999999 the number grows to 7 digits. The sector comes only from Masters → Sectors (`Sectors.SectorType`);
  registration refuses a sector without a type. Units registered before keep their `ZEDMSME…` IDs.
- **Certificate numbers:** date_serial, for example `06112026_M000123` / `06112026_S000045` (old IDs:
  `06112026_000123`).
- **Invoices:** `ZEDM/2627/n` and `ZEDS/2627/n`, each with its own counter that restarts every financial year. Off by
  default: no invoice number and no ERP posting until the Admin switches invoices on.
- **Administration → Settings → Payment Gateway and Invoices** (main portal):
  - Online payments On / Off: Off stops every new CCAvenue checkout.
  - The CCAvenue account: keys stored encrypted and never shown again; it replaces the settings file's.
  - Invoices On / Off.
- **MSME KAWACH removed** (2026-11-06): the dashboard and app incentive card, its Admin link and card, its reports,
  and the WASH / webinar certificates in My Documents.

## Production safeguards (audit of 2026-11-06)

- **Payments:** in Production a saved CCAvenue *test* account is ignored (the settings file's account is used, and the
  Payment Gateway page says why), and the hosts refuse to start with the CCAvenue test gateway or test service.
- **Addresses:** `Portal:PublicBaseUrl` may never be the old portal; the mobile hosts refuse to start without their
  own https address (the apps' mail and document links). Contact ZED defaults to https://zed.msme.gov.in/contact-us.
- **Sign-in limit:** 10 attempts a minute per address, counted across all login endpoints together; signed-in users
  have their own limit per endpoint, so people behind one office address do not block each other.
- **Mobile API:** the old anonymous hotel self-assessment actions are gone (404).
- **Web texts:** when the Admin texts cannot be loaded, the pledge and the payment disclaimer / instructions show
  "This text could not be loaded. Try again", and their buttons stay off until the text shows.
- **Apps:** "The app could not start" with RETRY when the phone's local database does not open, and the same page
  (instead of a crash) when a screen fails. ZED MSME shows BACK / RETRY when the fee cannot be loaded, and a missing
  amount is never paid as zero (also in ZED Surveillance). ZED SA and ZED Consultancy Help link to zedv3.
- **Staff:** resetting a sub-user's password asks for confirmation.
- **Database scripts:** `02_remove_test_data.sql` cleans all three databases in one transaction after backing all
  three up (or changes none); migration 0041 no longer re-creates procedures that later migrations edited.
- **Rollback:** a failed update puts back the files **and** the app pools' and Zed.Jobs' environment settings.

## Prerequisites

- SQL Server Express for development (instance `localhost\SQLEXPRESS`), `sqlcmd`. Production runs on SQL Server 2025
  Express (50 GB per database). Bringing in the old portal's data later needs SQL Server **Standard**, because
  ZEDCS_V2_LIVE is 76 GB (docs/MIGRATION-PLAN.md, "Database").
- .NET SDK 10.0.x
- Node.js 24 LTS, npm 11

## Run locally

```powershell
# 1. Databases (once). Refuses to touch existing DBs unless -Force; -Force drops only these three.
.\database\setup.ps1          # the three ZED databases and the three referenced ones (05-07); KAWACH comes from the seed below
# Every migration (0001-0071), in order, on the right databases (safe to re-run):
.\deploy\Invoke-ZedDatabaseScripts.ps1 -Server localhost\SQLEXPRESS -TrustServerCertificate -Apply -SkipFixes
# Optional local test data (never on production):
sqlcmd -S localhost\SQLEXPRESS -E -C -i database\seed\dev-test-user.sql
sqlcmd -S localhost\SQLEXPRESS -E -C -i database\seed\dev-registration-data.sql   # eligibility data, site URL, stand-ins for missing DBs

# 2. API (and, for the mobile apps, the mobile API on 5104)
dotnet run --project backend\src\Zed.Main.Api --launch-profile http
dotnet run --project backend\src\Zed.Main.MobileApi --launch-profile http

# 3. Web (second terminal)
cd frontend; npm install; npm start -- main
```

Open http://localhost:4200. In Development:

- reCAPTCHA is off, and the Udyam lookup returns a fixed sample record (`Udyam:UseSampleData`; refused outside Development).
- E-mails are written as `.eml` files to `backend/src/Zed.Main.Api/App_Data/mail-pickup/` instead of being sent.
- Generated certificates go to `backend/src/Zed.Main.Api/App_Data/storage/Certificates/{ZedId}/Pledge.pdf`.

## Configuration and secrets

Nothing secret is in `appsettings.json`. Set secrets per machine with user secrets (development)
or environment variables (servers, e.g. `Recaptcha__SecretKey`):

```powershell
cd backend\src\Zed.Main.Api
dotnet user-secrets set "ConnectionStrings:Main" "Server=...;Database=ZEDCS_V2_LIVE;..."
dotnet user-secrets set "Recaptcha:SiteKey" "..."
dotnet user-secrets set "Recaptcha:SecretKey" "..."
dotnet user-secrets set "Udyam:AccessKey" "..."
dotnet user-secrets set "Email:Profiles:Default:Host" "..."   # also From, UserName, Password; profiles Registration, Otp, Allocation
```

| Setting | Meaning (legacy equivalent) |
|---|---|
| `ConnectionStrings:Main/Consultancy/Surveillance` | `connString` app setting |
| `Database:Prefix` / `Database:AllowPrefixInProduction` | The databases carry a prefix (`ZEDV4_` on zedv3); in Production the prefix is allowed only with `AllowPrefixInProduction=true` |
| `Portal:PublicBaseUrl` | `BaseUrl`; used in e-mail links and logo. Never the old portal; on the mobile hosts the https address of this system (https://zedv3.qci.org.in), or they refuse to start |
| `Portal:ContactUrl` (portals) | Contact ZED link until the Admin sets it under Links; default https://zed.msme.gov.in/contact-us |
| `Portal:PathBase` (Consultancy, Surveillance) | The old IIS application path (`/Consultancy`, `/surveillance`); must match the build's base href. The XSRF cookie is scoped to it |
| `ConnectionStrings:Consultancy/Surveillance` on the main API | Read-only connection (`ApplicationIntent=ReadOnly`, writes refused in code) for milestone and surveillance reports and certificates served from main. Use a login with only `EXECUTE` on the report procedures |
| `Consultancy:SharedStorageRoot` (Consultancy) | Extra folder searched for technology-upgradation files uploaded through main (normally main's `Portal:StorageRoot`) |
| `Portal:AssessmentStorageRoot` | Folder of the old services' photos and evidence (`mobileapi/Photos/…`) served to MSMEs; empty = `Portal:StorageRoot` |
| `Portal:StorageRoot` | Folder with `Certificates/…`, `Certifications/…`, `PDFs/…`, `ReceiptInvoice/…`, `Uploads/Documents/…`. In production point it at the old site root (e.g. `E:\Publish\ZEDCS_LIVE\ZEDCS_V2_LIVE`) so existing certificates and receipts are found |
| `Portal:LegacyBaseUrl` | Old portal address; links to modules not migrated yet (payments, incentives, financial assistance) open there |
| `Recaptcha:Enabled/SiteKey/SecretKey` | `isEnabledCaptcha` + keys that were hard-coded in controllers/views |
| `Recaptcha:AppSecretKey` (main portal) | Secret of the MSME app's Android reCAPTCHA key (hard-coded in the old MsmeController.ValidateCaptcha; rotate), for the app's registration; required when Recaptcha is enabled |
| `MsmeAppRegistration:RequireCaptchaFromSameIp` (main portal) | Default true: the app's plant check and OTP mail need a captcha pass from the same address (docs/MOBILE-API.md, "MSME app registration") |
| `Udyam:AccessKey` | key that was hard-coded in `MsmeController` |
| `Email:Profiles:{Default,Registration,Otp,Allocation}` | `fromAddress/Host/password` and the `Second`, `Otp`, `Third` variants |
| `Email:RegistrationCc` | `ccAddress` |
| `CcAvenue:MerchantId/AccessCode/WorkingKey/GatewayUrl` | A complete account saved in Administration → Settings → Payment Gateway and Invoices replaces these. The test gateway is refused in Production, and so is a saved test account. `CcAvenue:MobileServiceUrl` (the apps' payments) may not be the test service in Production either. Legacy: `CcAvenueMerchantId`, `CcAvenueAccessCode`, `CcAvenueWorkingKey`, `CcAvenueLiveUrl`/`TestUrl` (web integration). Callbacks: `{PublicBaseUrl}/api/payments/ccavenue/response` (ZED), `.../surveillance-response`, `.../consultancy-response` (handholding; replaces `CcAvenueConsultancySuccessUrl/FailUrl`) |
| `UdyamiBharat:Enabled/TokenUrl/VerifyUrl/ClientId/ClientSecret/ReturnHosts` | Sign-in hand-over from the Udyami Bharat portal (`/Msme/ZedDashboard`). The old code used UBP's UAT gateway and had the secret in source: get production URLs and a new secret from UBP |
| `CcAvenue:ReconciliationWorkingKey` | `CcAvenueWorkingKeyReconciliation`; CCAvenue keeps posting to `/Pay/UpdatePaymentReconciliationStatus` |
| `ProteanGstin:Url/UserId/Password` | `ProteanApiUrl`, `ProteanUserId`, `ProteanPassword` (GSTIN verification) |
| `ExternalApi:TokenLifetimeMinutes/TokenRequestsPerMinute/RequestsPerMinute/MaxInvoiceBytes` | APIs for other systems (RAMP, AP state, Udyami Bharat, incentive portals, ERP invoices); partner secrets and AES keys stay in `ApiClientTokens`. Lower `TokenLifetimeMinutes` (e.g. 60) once callers' token caching is known |
| `Mobile:*` (mobile API) | See `docs/MOBILE-API.md`: `PathBase`, `StorageRoot` (old services folder), `Culture`, `DeviceBinding`, version check. There are no video calls (Twilio was removed); the old hard-coded Twilio keys must still be revoked (#29/#48) |
| `Security:Passwords` (all V4 hosts, each mobile deployment too) | `Dual` (default) while any old site is live; `Migrate` from the switch-off; `HashOnly` later. Migration 0005 first; steps in `docs/PASSWORDS.md` |
| `DataProtection:KeysPath` | Folder for the sign-in and anti-forgery keys; required outside Development; one per application; back it up (docs/CUTOVER.md) |
| `Cache:SqlServerTable` | Optional, e.g. `dbo.V4Cache` (migration 0006): shared cache for more than one server |
| `Jobs:Schedules` (Zed.Jobs) | The former SQL Agent jobs, filled from the Agent export with `tools/jobs/Convert-AgentJobs.ps1` and checked with `Zed.Jobs --check` (docs/JOBS.md) |
| `Jobs:FolderRename` (Zed.Jobs) | Renames the folders of rejected units to their archived ZED ID (replaces SP_JOB_TO_CREATE_RENAMING_BATCH_FILES, no xp_cmdshell). Migration 0007; Report mode first; docs/JOBS.md |
| `StaffPasswordReset:Enabled/ValidMinutes/MaxRequestsPerHour/ExcludedRoles/MainPortalUrl` | Staff "Forgot password?" and administrator reset links (migration 0008, docs/PASSWORDS.md). ExcludedRoles (default 7) get their link from another MasterAdmin |
| `MsmePasswordReset:ValidMinutes/MaxRequestsPerHour` (main portal and MSME app) | MSME reset links (migration 0009, docs/PASSWORDS.md): 60 minutes, 3 per ZED ID and hour |
| `Consultancy:TuApp:LoginHours` (consultancy portal, main mobile host) | Default 12: how recently the allotted DFO must have signed in to the consultant app for the unit, for the TU calls and documents; 0 turns the check off |
| `Consultancy:TuApp:SameIp` (consultancy portal) | Default false: also require the IP address of that sign-in |
| `ConnectionStrings:Consultancy` (main mobile host) | ZED_CONSULTANT, opened read-only, for the TU document downloads |
| `Email:RedirectAllTo` / `Email:AllowedRecipientDomains` (every host and Zed.Jobs) | **Test environments only, never on production (zedv3)**: all mail goes to the redirect address(es), or only to recipients in the allowed domains (comma separated), with the original recipients named at the top and in `X-Zed-Original-To/Cc/Bcc`. Outside Production and Development one of them (or a mail pickup folder) is required; in Production both must be empty, or the host refuses to start |
| `Portal:EnvironmentLabel` (every host) | **Test environments only**: no visible label (no ribbon, title or subject prefix), only `X-Robots-Tag: noindex, nofollow` and a disallow-all `robots.txt`. Must be empty in Production. Outside Production `Portal:PublicBaseUrl` / `Portal:LegacyBaseUrl` may not point at the live site |
| `Erp:Enabled/TenantId/ClientId/ClientSecret/CompanyBaseUrl` | the values hard-coded in `ErpIntegrationService.cs` (rotate the secret). Posting needs `Enabled` true **and** Invoices switched on in Administration → Settings → Payment Gateway and Invoices |

## Tests

```powershell
dotnet test backend\Zed.slnx          # API tests: real pipeline, fake DB/SMTP/Udyam
cd frontend; npx ng test main --watch=false
# Mobile, in each of mobile\apps\zedmsme, apps\msme, apps\assessor, apps\consultant and packages\shared:
npx tsc --noEmit -p .; npx jest
```

## Deployment

Production is https://zedv3.qci.org.in (docs/PRODUCTION.md). Run on the server from the repository folder, in an
Administrator PowerShell.

**Switching to production (once), in this order and in one session:**
1. **Test data, in SSMS:** `database\production\02_remove_test_data.sql`, a preview first, then with `@Mode = 'APPLY'`.
   It removes the test units and keeps the Admin setup. It backs up all three databases first and cleans all three or
   none. It goes first: until the update, mail still goes only to the test mailbox.
2. **Settings:** run the dry run, then the same with `-Apply`:
   ```powershell
   .\deploy\Set-ZedProductionSettings.ps1
   ```
   It makes the settings file and Zed.Jobs' environment Production ones and lists what is left by hand (above all
   QCI's live CCAvenue account in the `Main` section).
3. **Update:** see below.
4. **Addresses, in SSMS:** `database\production\01_portal_address.sql`, a preview first, then with `@Mode = 'APPLY'`:
   QR codes and links point at zedv3.
5. **Administration → Settings → Payment Gateway and Invoices:** switch Online payments off until the live account
   works.

**Every update:** the dry run first, then the same with `-Apply`. It takes file and database backups, runs the
migrations, installs, smoke-tests, and rolls back on its own when the test fails (the files and the app pools'
environment settings):
```powershell
.\deploy\Update-ZedFromGit.ps1 -Ref <commit> -IncludeMobile -IncludeJobs
```

The web update covers the three portals (Main, Consultancy, Surveillance); `-IncludeMobile` adds the server side the
apps talk to, `-IncludeJobs` Zed.Jobs.

**The apps (APKs),** from the same folder. Without `-Production` the APK is signed with this machine's debug key, for
installing on phones directly:
```powershell
powershell -ExecutionPolicy Bypass -File .\mobile\tools\Build-ZedApk.ps1 -App zedmsme -Ref <commit>      # ZED MSME (applicant)
powershell -ExecutionPolicy Bypass -File .\mobile\tools\Build-ZedApk.ps1 -App assessor -Ref <commit>     # ZED SA (assessment)
powershell -ExecutionPolicy Bypass -File .\mobile\tools\Build-ZedApk.ps1 -App consultant -Ref <commit>   # ZED Consultancy
powershell -ExecutionPolicy Bypass -File .\mobile\tools\Build-ZedApk.ps1 -App msme -Ref <commit>         # ZED Surveillance (Bronze)
powershell -ExecutionPolicy Bypass -File .\mobile\tools\Build-ZedApk.ps1 -App all -Ref <commit>          # all four
```
The APKs go to `E:\Releases\apk`. For the Play Store add `-Production` and set `ZED_UPLOAD_STORE_FILE`,
`ZED_UPLOAD_STORE_PASSWORD`, `ZED_UPLOAD_KEY_ALIAS` and `ZED_UPLOAD_KEY_PASSWORD` in the same window first (the script
refuses a Play Store APK without them). The apps' production address is https://zedv3.qci.org.in. The apps already in
the store point at the old portal, so each app needs a new store release.

**Building blocks:**
- `deploy\Publish-Zed.ps1` builds a release package.
- `deploy\Install-ZedIis.ps1` installs it, with a dry run first and a rollback file.
- `deploy\Test-ZedDeployment.ps1 -BaseUrl …` checks the installed sites.
- `deploy\Invoke-ZedDatabaseScripts.ps1` runs `database/migrations` 0001–0063 in order (safe to re-run) and the
  reviewed `database/fixes`.

The hosts refuse to start when a setting is missing outside Development. `/api/health/ready` and `/health/ready` report
database readiness.

**More:**
- passwords: `docs/PASSWORDS.md`
- jobs: `docs/JOBS.md`
- mobile: `docs/MOBILE-API.md`
- how the server was built: `docs/STAGING.md`
- the planned move of the old portal's data: `docs/CUTOVER.md`
