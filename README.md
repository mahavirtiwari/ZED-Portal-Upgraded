# ZEDCS V4

New platform for the three linked ZED systems (Main, Consultancy, Surveillance), replacing the
ASP.NET MVC 5 / .NET Framework / AngularJS code in `../ZEDCS main`, `../ZEDCS_CONSULTANCY` and
`../ZEDCS_SURVEILLANCE`. The original folders are untouched.

| Layer    | Old                                    | New                                              |
|----------|----------------------------------------|--------------------------------------------------|
| Database | SQL Server (3 databases)               | SQL Server 2022 Express, same 3 databases, compatibility level 160 |
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
docs/       MIGRATION-PLAN.md, SECURITY-FINDINGS.md, MOBILE-API.md, JOBS.md
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

Phase 4 (staff, in progress): staff login and role menu; dashboards, registered MSMEs, failed and received
payments, financial support, reports (allow-listed), ZED ID history; monitoring, SA allotment, remote
assessments; agencies, assessors and admin masters. Menu entries not migrated yet still open the old portal.

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

## Prerequisites

- SQL Server 2022 Express (instance `localhost\SQLEXPRESS`), `sqlcmd`
- .NET SDK 10.0.x
- Node.js 24 LTS, npm 11

## Run locally

```powershell
# 1. Databases (once). Refuses to touch existing DBs unless -Force; -Force drops only these three.
.\database\setup.ps1
sqlcmd -S localhost\SQLEXPRESS -E -C -d ZEDCS_V2_LIVE -i database\migrations\0001_mobile_devices.sql   # new V4 tables (servers too)
sqlcmd -S localhost\SQLEXPRESS -E -C -d ZED_CONSULTANT -i database\migrations\0001_mobile_devices.sql   # mobile device tables for the consultancy app deployment
sqlcmd -S localhost\SQLEXPRESS -E -C -d ZED_SURVEILLANCE -i database\migrations\0001_mobile_devices.sql   # mobile device tables for the surveillance app deployment
sqlcmd -S localhost\SQLEXPRESS -E -C -d ZEDCS_V2_LIVE -i database\migrations\0002_api_incentives_index.sql
sqlcmd -S localhost\SQLEXPRESS -E -C -d ZEDCS_V2_LIVE -i database\migrations\0003_mail_outbox.sql   # all three DBs (docs/JOBS.md)
sqlcmd -S localhost\SQLEXPRESS -E -C -d ZED_CONSULTANT -i database\migrations\0003_mail_outbox.sql
sqlcmd -S localhost\SQLEXPRESS -E -C -d ZED_SURVEILLANCE -i database\migrations\0003_mail_outbox.sql
sqlcmd -S localhost\SQLEXPRESS -E -C -d ZEDCS_V2_LIVE -i database\migrations\0004_job_runs.sql
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
| `Portal:PublicBaseUrl` | `BaseUrl`; used in e-mail links and logo |
| `Portal:PathBase` (Consultancy, Surveillance) | The old IIS application path (`/Consultancy`, `/surveillance`); must match the build's base href. The XSRF cookie is scoped to it |
| `ConnectionStrings:Consultancy/Surveillance` on the main API | Read-only connection (`ApplicationIntent=ReadOnly`, writes refused in code) for milestone and surveillance reports and certificates served from main. Use a login with only `EXECUTE` on the report procedures |
| `Consultancy:SharedStorageRoot` (Consultancy) | Extra folder searched for technology-upgradation files uploaded through main (normally main's `Portal:StorageRoot`) |
| `Portal:AssessmentStorageRoot` | Folder of the old services' photos and evidence (`mobileapi/Photos/…`) served to MSMEs; empty = `Portal:StorageRoot` |
| `Portal:StorageRoot` | Folder with `Certificates/…`, `Certifications/…`, `PDFs/…`, `ReceiptInvoice/…`, `Uploads/Documents/…`. In production point it at the old site root (e.g. `E:\Publish\ZEDCS_LIVE\ZEDCS_V2_LIVE`) so existing certificates and receipts are found |
| `Portal:LegacyBaseUrl` | Old portal address; links to modules not migrated yet (payments, incentives, financial assistance) open there |
| `Recaptcha:Enabled/SiteKey/SecretKey` | `isEnabledCaptcha` + keys that were hard-coded in controllers/views |
| `Udyam:AccessKey` | key that was hard-coded in `MsmeController` |
| `Email:Profiles:{Default,Registration,Otp,Allocation}` | `fromAddress/Host/password` and the `Second`, `Otp`, `Third` variants |
| `Email:RegistrationCc` | `ccAddress` |
| `CcAvenue:MerchantId/AccessCode/WorkingKey/GatewayUrl` | `CcAvenueMerchantId`, `CcAvenueAccessCode`, `CcAvenueWorkingKey`, `CcAvenueLiveUrl`/`TestUrl` (web integration). Callbacks: `{PublicBaseUrl}/api/payments/ccavenue/response` (ZED), `.../surveillance-response`, `.../consultancy-response` (handholding; replaces `CcAvenueConsultancySuccessUrl/FailUrl`) |
| `Twilio:AccountSid/ApiKey/ApiSecret/TokenMinutes` (portal API) | Video tokens for the remote assessment screen (were hard-coded; rotate, #29/#48). Without them the screen works without video |
| `UdyamiBharat:Enabled/TokenUrl/VerifyUrl/ClientId/ClientSecret/ReturnHosts` | Sign-in hand-over from the Udyami Bharat portal (`/Msme/ZedDashboard`). The old code used UBP's UAT gateway and had the secret in source: get production URLs and a new secret from UBP |
| `CcAvenue:ReconciliationWorkingKey` | `CcAvenueWorkingKeyReconciliation`; CCAvenue keeps posting to `/Pay/UpdatePaymentReconciliationStatus` |
| `ProteanGstin:Url/UserId/Password` | `ProteanApiUrl`, `ProteanUserId`, `ProteanPassword` (GSTIN verification) |
| `ExternalApi:TokenLifetimeMinutes/TokenRequestsPerMinute/RequestsPerMinute/MaxInvoiceBytes` | APIs for other systems (RAMP, AP state, Udyami Bharat, incentive portals, ERP invoices); partner secrets and AES keys stay in `ApiClientTokens`. Lower `TokenLifetimeMinutes` (e.g. 60) once callers' token caching is known |
| `Mobile:*` (mobile API) | See `docs/MOBILE-API.md`: `PathBase`, `StorageRoot` (old services folder), `Culture`, `DeviceBinding`, version check, Twilio keys (were hard-coded; rotate) |
| `Erp:Enabled/TenantId/ClientId/ClientSecret/CompanyBaseUrl` | the values hard-coded in `ErpIntegrationService.cs` (rotate the secret). Off unless `Enabled` is true |

## Tests

```powershell
dotnet test backend\Zed.slnx          # API tests: real pipeline, fake DB/SMTP/Udyam
cd frontend; npx ng test main --watch=false
```

## Deployment outline

1. `npx ng build main` → copy `frontend/dist/main/browser/*` into the API's `wwwroot/`
   (the API serves the Angular app and falls back to `index.html` for client routes).
2. `dotnet publish backend/src/Zed.Main.Api -c Release` → host on IIS (ASP.NET Core Hosting Bundle 10) or as a Windows service.
   Consultancy and Surveillance: `ng build consultancy` / `ng build surveillance` into the `wwwroot/` of
   `Zed.Consultancy.Api` / `Zed.Surveillance.Api`, hosted as the IIS applications `/Consultancy` and `/surveillance`
   with `Portal:PathBase` set to match.
3. `dotnet publish backend/src/Zed.Main.MobileApi -c Release` → host at the old services address (same virtual folder,
   `Mobile:PathBase`), with `Mobile:DeviceBinding` = `Monitor` first. Apply `database/migrations/*.sql` before go-live.
4. `dotnet publish backend/src/Zed.Jobs -c Release` → Windows service; fill `Jobs:Schedules` from the old Agent jobs
   and switch those jobs off when it starts (docs/JOBS.md).
3. Same origin for app and API is required (cookies are `SameSite=Strict`).
4. Run several instances only after switching `AddDistributedMemoryCache` to the SQL Server
   distributed cache and sharing Data Protection keys.
