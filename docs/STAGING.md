# Staging: https://zedv3.qci.org.in

The rehearsal of the cut-over (CUTOVER.md 1.5) runs here: V4 in **its own databases, built from scratch** on the
server's SQL Server 2025 Express (`ZEDV4_…`, section 3), Environment `Staging`. Everything below is done by the server team; the developers have no access to
the server. Run each step in order and fill in the timing sheet (section 9): the timings decide the cut-over window.

**From Git, scripted.** `deploy\Build-ZedRelease.ps1 -Output <folder> [-Ref <branch, tag or commit>]` clones the
repository at that commit, runs `Publish-Zed.ps1` (tests included) and zips the package; it runs wherever Git, the
.NET 10 SDK and Node 24 are installed (the server has none of them, so normally a build PC). On the server,
`deploy\Invoke-ZedStaging.ps1 -Step <step> [-Apply]` runs sections 3.0 to 6 from the package folder, one step at a
time, each a preview until `-Apply`: Check, Databases, Migrations, Fixes, ReferenceData, ProcedureLinks, Settings,
Site, Jobs, Logins, Accounts, CutoverFix, Test (also Rollback and TearDown). It fills in the SQL scripts' variables
itself (in copies under `E:\ZedStaging\run`), checks the settings file by name without showing values, and logs each
step to `E:\ZedStaging\logs` (except Accounts, which shows the one-time links on screen only). The database steps also
run from a plain Git checkout of the repository.

## 1. What the server looks like from outside (2026-10-22)

| Check | Result | Meaning |
|---|---|---|
| DNS `zedv3.qci.org.in` | 20.219.21.200 | the name points at the staging VM |
| `http://zedv3.qci.org.in/` | 404 from `Microsoft-HTTPAPI/2.0` | Windows' http.sys answers: **no IIS site is bound to this host name yet** |
| `https://zedv3.qci.org.in/` | connection reset during the TLS handshake | **no certificate is bound on 443** for this name |

Both are expected before the install: section 4 creates the site, the https binding and the http redirect.

### 1a. What is on the server (checked on the server, 2026-10-23)

**Staging runs on the server as it is** (decided 2026-10-23): the existing SQL Server 2025 Express instance
`SQLEXPRESS`, everything on drive **E:**, nothing new installed. The production server gets the full requisites
(SQL Server 2022 Standard etc., CUTOVER 1.1a). What that means for staging is in each row.

| Item | Found | Needed for V4 staging |
|---|---|---|
| Windows | Server 2022 Datacenter | OK |
| IIS | 10.0 | OK |
| ASP.NET Core | runtime 10.0.11 and the IIS module V2 (also 6, 8, 9 for other sites) | OK |
| **SQL Server** | SQL Server 2025 Express (17.0) `SQLEXPRESS`, Agent disabled | Used for staging. Limits: **50 GB per database**, 4 cores, a small buffer pool (slower, fine for testing), no SQL Agent (Zed.Jobs runs the jobs; they are off on staging anyway) and no Database Mail (good: nothing mails from the database). ZEDCS_V2_LIVE (76 GB in production) cannot be restored whole. The procedures call each other by fixed database names, so V4 gets its own set under the prefix `ZEDV4_` next to the old staging site's (section 3). |
| Disk | C: 60 GB free; D: 29 GB (**Azure temporary disk**); **E: 142 GB free** | Everything on **E:**: install `E:\ZedV4`, keys `E:\ZedV4\keys`, database files `E:\ZedStaging\SqlData`, storage `E:\ZedStaging\storage`, releases `E:\Releases`. Nothing on D: (wiped on redeploy; the installer refuses it). |
| Certificate | `CN=*.qci.org.in`, valid to 2027-01-27, thumbprint `787885A2C39981E31205F66DB5C91FB45315CE86` | OK, covers zedv3.qci.org.in; renew before 27 January 2027 |
| IIS IP and Domain Restrictions | available, not installed | Optional. Without it the site is open to anyone who knows the address, so do not load personal data you cannot expose (section 3: masked or test data). If it is installed later, `-AllowedIpRanges` limits only this site. |
| Firewall for 443 | Windows: allowed from any address | Shared server (zedtraining, nidhi, leanimpact, samar, LeanPortal, CBMS, MCLS, lean, the old `zedstaging.qcin.org`): leave the Azure rule as it is. |
| Other sites | 13 sites, Default Web Site stopped (it holds the catch-all `*:80:` binding) | The install adds a new site `ZEDV4` with host-name bindings only and touches no other site. Leave the old `zedstaging.qcin.org` site (old portal staging on `E:\Publish\ZEDCS_LIVE\ZEDCS_V2_LIVE`) alone. |

Still to check on the server (read-only):
```powershell
Get-TimeZone | Select-Object Id
Test-Path "$env:SystemRoot\System32\inetsrv\rewrite.dll"
sqlcmd -S .\SQLEXPRESS -E -C -h -1 -Q "SET NOCOUNT ON; SELECT name FROM sys.databases WHERE database_id > 4"
```
They answer: the time zone should be `India Standard Time` (procedures use `GETDATE()`); `True` means URL Rewrite is
installed (then `-HttpRedirect` sends http to https; without it http keeps answering 404 and testers use https); and
the database list with sizes shows what else is on the instance (V4 never uses the ZED databases listed there, section 3):
```powershell
sqlcmd -S .\SQLEXPRESS -E -C -W -s "|" -Q "SET NOCOUNT ON; SELECT d.name, CAST(SUM(f.size) * 8 / 1024 AS int) AS size_mb FROM sys.databases d JOIN sys.master_files f ON f.database_id = d.database_id WHERE d.database_id > 4 GROUP BY d.name ORDER BY d.name"
Select-String -Path 'E:\Publish\ZEDCS_LIVE\ZEDCS_V2_LIVE\Web.config' -Pattern 'Initial Catalog=[^;"]+|Data Source=[^;"]+' -AllMatches | ForEach-Object { $_.Matches.Value } | Sort-Object -Unique
```
(The second line shows only which server and databases the old staging site uses, no passwords.)

## 2. Prerequisites on the server

All present on 20.219.21.200 (1a); nothing to install for staging:
- IIS 10, the ASP.NET Core 10 runtime and IIS module, PowerShell 5.1, `sqlcmd`, the QCI wildcard certificate in
  *Local Computer > Personal*.
- SQL Server 2025 Express `.\SQLEXPRESS` (shared with the other sites: V4 adds its own databases and logins only).
- Folders on E: (the installer and setup.ps1 create them): `E:\ZedV4`, `E:\ZedStaging\SqlData`,
  `E:\ZedStaging\storage`, `E:\Releases`.
- Optional, only if already there or allowed later: URL Rewrite 2.1 (http to https), IIS IP and Domain Restrictions
  (limit the site to QCI addresses).

**No SQL Agent jobs and no Database Mail** (Express has neither): nothing on staging mails from the database. V4's own
mail goes through Zed.Jobs' outbox worker and the portals, all redirected to dev.zed@qcin.org.

## 3. Databases

### 3.0 On 20.219.21.200: build from scratch with the prefix ZEDV4_ (decided 2026-10-23)

V4 staging gets **its own databases, built from the repository's schema scripts under new names**:

| V4 staging database | Built from | Holds |
|---|---|---|
| ZEDV4_ZEDCS_V2_LIVE | `schema\01_ZEDCS_V2_LIVE.sql` | main |
| ZEDV4_ZED_CONSULTANT | `schema\02_ZED_CONSULTANT.sql` | consultancy |
| ZEDV4_ZED_SURVEILLANCE | `schema\03_ZED_SURVEILLANCE.sql` | surveillance |
| ZEDV4_ZED_IMPACT_ASSESSMENT, ZEDV4_ZED_CENTER_AUDIT_PROFESSIONAL, ZEDV4_ZED_CENTER_AUDIT_V2 | `schema\05`–`07` | the other applications' tables ZED reads and writes |
| ZEDV4_KAWACH | `-WithKawachStandIn` | empty stand-ins of the 10 KAWACH tables ZED reads (no KAWACH export exists) |

**The ZED databases already on `.\SQLEXPRESS`** (ZEDCS_V2_LIVE, ZED_CONSULTANT, ZED_SURVEILLANCE,
ZED_CENTER_AUDIT_PROFESSIONAL, KAWACH, the `*_UPGRADE_V1` set, `ZEDCS_V2_LIVE_security_testing`; the old
`zedstaging.qcin.org` site's) **are never used, read or changed by V4**: no backup, no check, no copy from them. The
other applications' databases (FCI_KMS_*, CapacityBuilding, CbmsDb, LeanPortal, MCLS, monitoring, SamarScheme,
SmrStagingScheme, zedtraining) are not touched either.

**Why a prefix.** The procedures name each other's databases with three-part names (`ZED_CONSULTANT.dbo.Users`), so
one instance holds one set of those names. Every tool maps the names with the same map
(`database\ZedDatabaseNames.ps1`): `setup.ps1 -DatabasePrefix ZEDV4_` creates the procedures with
`ZEDV4_ZED_CONSULTANT.dbo.Users`, `Invoke-ZedDatabaseScripts.ps1 -DatabasePrefix` runs the migrations and fixes against
mapped copies, the SQL scripts take `@DatabasePrefix = N'ZEDV4_'`, and the hosts' `Database__Prefix=ZEDV4_` maps the
few inline queries that name another database. The map changes `USE`, `X.dbo.Y` / `[X].dbo.Y`, `DATABASE X` and quoted
literals that are exactly a name (`DB_ID(N'X')`); never folder names in file paths (`E:\Publish\ZEDCS_LIVE\ZEDCS_V2_LIVE\…`)
or names inside longer identifiers. The hosts refuse `Database__Prefix` in Production.

Steps, in this order: an administrator PowerShell on the server, in the release package's folder
(`E:\Releases\zed-<version>`, section 4: it holds `database\` and `deploy\`). Each script previews first; nothing below asks for a password.

1. **Build the databases** (about 10 minutes; data and log files in `E:\ZedStaging\SqlData`; the script gives the SQL
   Server service account Modify on the folder; it refuses to touch a database that exists, and even with `-Force` it
   drops only `ZEDV4_` databases):
   ```powershell
   sqlcmd -S .\SQLEXPRESS -E -C -h -1 -Q "SET NOCOUNT ON; SELECT name FROM sys.databases ORDER BY name" > E:\ZedStaging\databases-before.txt
   powershell -ExecutionPolicy Bypass -File database\setup.ps1 -Server ".\SQLEXPRESS" -DatabasePrefix ZEDV4_ -WithKawachStandIn -DataPath E:\ZedStaging\SqlData
   sqlcmd -S .\SQLEXPRESS -E -C -h -1 -Q "SET NOCOUNT ON; SELECT name FROM sys.databases ORDER BY name" > E:\ZedStaging\databases-after.txt
   Compare-Object (Get-Content E:\ZedStaging\databases-before.txt) (Get-Content E:\ZedStaging\databases-after.txt)
   ```
   The last line must list exactly the seven `ZEDV4_` databases as new (`=>`) and nothing else. setup.ps1 ends with
   the object counts per database (expected / actual) and `Done. 2883 of 2906 batches applied, 23 failed` (exit code
   2): those 23 procedures are broken in production too (database\README.md "Findings" 1, and the five
   ZED_CENTER_AUDIT_PROFESSIONAL procedures whose table types the export lacks), as in an unprefixed build. Any other
   failure: stop and read `database\logs\failed-batches-*.json`.
2. **V4 scripts** (migrations 0001–0017 and 0003, then the fix previews):
   ```powershell
   .\deploy\Invoke-ZedDatabaseScripts.ps1 -Server .\SQLEXPRESS -TrustServerCertificate -DatabasePrefix ZEDV4_
   .\deploy\Invoke-ZedDatabaseScripts.ps1 -Server .\SQLEXPRESS -TrustServerCertificate -DatabasePrefix ZEDV4_ -Apply -IncludeMailOutbox
   ```
   The first is the dry run (plan and server checks; the Express warning is expected). `-IncludeMailOutbox`: the
   procedures' mail is queued for Zed.Jobs, whose mail worker sends it to dev.zed@qcin.org only. Review the fix
   previews (`database\logs\cutover-<time>\fixes\…`; the scripts as run, with the mapped names, are in `scripts-as-run`),
   then apply the list planned for production:
   `… -DatabasePrefix ZEDV4_ -Apply -SkipMigrations -ApplyFixes 'main/05_mail_passwords','…'` (and `main/02` with
   `-AtCutover`, as on the night).
3. **Reference data**: states, districts, sectors, fees, status codes and the assessment framework, copied from a
   source set into the empty tables (`database\staging\Copy-ZedReferenceData.ps1`; the list of tables with a note each
   is at the top of the script). Only SELECTs on the source; table names and row counts are printed, never data;
   users, units, applications, payments and partner credentials are not in the list. The source is production (a
   read-only login on the managed instance) or any copy of it, **never the old ZED databases on this server** (the
   script refuses a source on the target server):
   ```powershell
   powershell -ExecutionPolicy Bypass -File database\staging\Copy-ZedReferenceData.ps1 -SourceServer <source instance> -SourceCredential (Get-Credential)
   powershell -ExecutionPolicy Bypass -File database\staging\Copy-ZedReferenceData.ps1 -SourceServer <source instance> -SourceCredential (Get-Credential) -Apply
   ```
   The first run is the preview (source and target counts, what would be copied). `-Apply` copies each table in its own
   transaction (identity values kept) and skips a table that already has rows, so a second run copies nothing
   (`-EmptyTargets` replaces them); then `UrlsMasterData` is set to `https://zedv3.qci.org.in` in the three ZED
   databases. Leave a table out with `-Exclude 'ZEDCS_V2_LIVE.Incentives'`. If the server cannot reach the source,
   run the script on a machine that reaches both (`-TargetServer` the staging instance).
4. **Procedure links**: `database\staging\01_prepare_restored_copy.sql` in SSMS (or sqlcmd) with
   `@DatabasePrefix = N'ZEDV4_'`, `@RewriteModuleHosts = 1` and the guards (`@Mode = 'APPLY'`, `@ThisIsStaging = 'YES'`,
   `@ExpectedServerName` = `SELECT @@SERVERNAME`). It re-creates every procedure, function, view and trigger whose code
   names `http(s)://loginzed.msme.gov.in` with the staging address (QR / verify links of the certificates, mail
   links). The other steps of that script find nothing to change in new databases. Only **after** step 2: the fix
   scripts compare the procedures' text with production's.
5. **Install** the site (section 4): the app pools must exist before their logins.
6. **Logins**: `database\security\01_v4_logins_and_roles.sql` in SSMS with `@AuthMode = 'WINDOWS'`,
   `@DatabasePrefix = N'ZEDV4_'`, `@Mode = 'APPLY'` (after a PREVIEW) and the `@Logins` rows replaced by the app pool
   identities and the Zed.Jobs service account:
   ```sql
   INSERT @Logins (Family, LoginName, Password, DefaultDatabase) VALUES
       ('app',  N'IIS APPPOOL\ZedV4-Main',                NULL, N'ZEDCS_V2_LIVE'),
       ('app',  N'IIS APPPOOL\ZedV4-Consultancy',         NULL, N'ZED_CONSULTANT'),
       ('app',  N'IIS APPPOOL\ZedV4-Surveillance',        NULL, N'ZED_SURVEILLANCE'),
       ('app',  N'IIS APPPOOL\ZedV4-Mobile-Main',         NULL, N'ZEDCS_V2_LIVE'),
       ('app',  N'IIS APPPOOL\ZedV4-Mobile-Consultancy',  NULL, N'ZED_CONSULTANT'),
       ('app',  N'IIS APPPOOL\ZedV4-Mobile-Surveillance', NULL, N'ZED_SURVEILLANCE'),
       ('jobs', N'NT SERVICE\ZedJobs',                    NULL, N'ZEDCS_V2_LIVE');
   ```
   (DefaultDatabase stays logical: the script adds the prefix. `NT SERVICE\ZedJobs` is the service's own virtual
   account: `sc.exe config ZedJobs obj= "NT SERVICE\ZedJobs"`, no password.) SQL Server and IIS are on the same
   machine, so no passwords and no change to the instance's authentication mode. The main portal's read-only
   connections to consultancy and surveillance use its own login (`zed_v4_app` there; the host opens them with read
   intent). It creates users and roles in the seven `ZEDV4_` databases only. Connection strings:
   `Server=.\SQLEXPRESS;Database=ZEDV4_…;Integrated Security=true;TrustServerCertificate=true` (already in
   `deploy\settings.staging.example.json`).
7. **First accounts**: `database\staging\03_first_accounts.sql` in SSMS (PREVIEW, then `@Mode = 'APPLY'`,
   `@ThisIsStaging = 'YES'`, `@ExpectedServerName`). It creates a MasterAdmin, an Admin, an agency, a desktop and a
   site assessor on main; a MasterAdmin, an Admin, a consultant organisation (CO), a consultant and a DFO on
   consultancy; a MasterAdmin, an Admin, an agency and a site assessor on surveillance (ids `ZEDV4MA01`, `ZEDV4AD01`,
   `ZEDV4AG01`, …; e-mail dev.zed@qcin.org), each with a random value that is never accepted as a password. The Admin
   (role 1, as in the old portal; no screen creates one) is the only role with the master data screens: sectors,
   categories, technologies, the questionnaire parameters, fees and incentives (main), sectors and parameters
   (consultancy), Payments (the surveillance fee master), sectors and parameters (surveillance; Documents and the home
   page stay off there: it has no MSME pages or public home page). For the MasterAdmins and Admins it shows a **one-time link** each
   (valid 24 hours; treat it like a password): open it, set the password. MasterAdmin cannot use "Forgot password?"
   (`StaffPasswordReset:ExcludedRoles`, unchanged); the link is an administrator's link, issued by the script. The
   other accounts use "Forgot password?" on their portal's staff login (the mail arrives at dev.zed@qcin.org), or the
   MasterAdmin sends them a link (*Password Reset Link*). Nobody types a password into a file. Further agencies,
   assessors and their allotments are created in the portals as usual.
8. **MSMEs** register through the portal or the app. The Udyam lookup calls the Ministry's service with
   `Udyam__AccessKey` (the sample data of development, `Udyam:UseSampleData`, is refused outside Development), so
   testers register real Udyam numbers they are allowed to use; the MSME's mail goes to dev.zed@qcin.org.

Tear-down: `ALTER DATABASE … SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE …` for the seven `ZEDV4_`
databases only, then delete `E:\ZedStaging\SqlData`.

### 3.1 Notes: other ways, not used on this server

- **B. Trimmed production copy** (a realistic rehearsal once the site is limited to QCI addresses): BACPACs exported
  with SqlPackage, every table except the largest so each database stays under Express's 50 GB, imported under the
  `ZEDV4_` names. The procedures inside a BACPAC keep production's names: after the import they still name
  `ZED_CONSULTANT.dbo…` and would reach the old staging databases. Re-create them from the mapped schema
  (`setup.ps1 -DatabasePrefix` builds them that way) before any host points at the copy, then run
  `01_prepare_restored_copy.sql` with `@DatabasePrefix = N'ZEDV4_'` and `@ScramblePasswords` / `@MaskContacts`.
  Compare the copy with `deploy\Compare-ZedDatabases.ps1 -Snapshot -DatabasePrefix ZEDV4_` against a snapshot of the
  source (module checksums differ by design where code names another database).
- **C. A server with no other ZED set**: the same steps as 3.0 without the prefix (`setup.ps1` without
  `-DatabasePrefix`, no `Database__Prefix`).

## 4. Settings, package and IIS

1. Copy `deploy\settings.staging.example.json` to `E:\ZedV4\settings.json` (administrators only) and fill the empty
   values. **Every staging mail goes to `dev.zed@qcin.org`** (`Email__RedirectAllTo`, already set for the portals, the
   mobile API and Zed.Jobs; do not add `Email__AllowedRecipientDomains`). The connection strings are filled in already:
   `Server=.\SQLEXPRESS;Database=ZEDV4_…;Integrated Security=true;TrustServerCertificate=true` for every host and
   Zed.Jobs (the prefixed databases of section 3.0, the app pool's own Windows login, no passwords), with
   `Database__Prefix=ZEDV4_`; change them only if the databases get other names. Also: an SMTP account for `Email__Profiles__Default__*` (mail still only reaches dev.zed@qcin.org); a **separate
   reCAPTCHA key pair registered for zedv3.qci.org.in** (or `Recaptcha__Enabled=false`, which leaves the captcha
   untested); **CCAvenue test** merchant and keys only (ask CCAvenue to allow the staging return URLs); the
   **Udyam access key** (`Udyam__AccessKey`); Protean test credentials; Twilio test credentials or none.
   No visible label (decided 2026-10-24: no STAGING banner, title prefix or mail subject prefix); the Staging
   environment still tells search engines not to index the site (X-Robots-Tag, robots.txt), with or without
   `Portal__EnvironmentLabel`. The hosts refuse to start in Staging without a mail redirect.
   **Required at startup** (otherwise HTTP 500.30, the reason in the Application event log): every portal needs
   `Email__Profiles__Default__Host` and `__From`, and with the captcha on `Recaptcha__SiteKey` and `__SecretKey`; the
   main portal also needs the four `CcAvenue__MerchantId/AccessCode/WorkingKey/ReconciliationWorkingKey`,
   `Udyam__AccessKey`, `ProteanGstin__Url/UserId/Password` and, with the captcha on, `Recaptcha__AppSecretKey`.
   `Invoke-ZedStaging.ps1 -Step Settings` checks them. Empty values are not set on the app pools (IIS refuses them).
   **Captcha on the web forms:** once migration 0011 is in, the Admin of each portal chooses it under **Captcha
   Settings** (menu, new in V4): *Enable captcha* (the portal's own picture of 6 letters and digits, no Google keys
   needed), *Disable captcha*, or Google reCAPTCHA when its keys are set. Until the Admin saves a choice,
   `Recaptcha__Enabled` decides (false: off; true: Google with keys, else the 6-character captcha). The MSME app's
   captcha still follows `Recaptcha__Enabled` and `Recaptcha__AppSecretKey`.
   **Office mailboxes:** the Admin sets them under **Settings → Email Settings** (per portal): Contact ZED queries, the
   copy of registration/payment/allotment mails, the ZED team inbox for allotment rejections, the FA/TU rejection
   inbox, and for the database procedures' mail (sent by Zed.Jobs) a blind copy of every mail and the daily status
   report's recipients. An empty box uses the configuration (`Email__ContactInbox`, `Email__RegistrationCc`, ...). On
   staging every mail still goes to `Email__RedirectAllTo`. The SMTP accounts and passwords stay in the settings files.
   **Logins:** the Admin creates Master Admin, Ministry, MSME DFO and dashboard logins under **User Management**; Master
   Admins add operation admins and agencies add sub-users under **Operation Admins / Sub-Users** (migration 0012;
   docs/USER-MANAGEMENT.md).
   **Sign-in records:** every web and app sign-in, successful or not, is stored in `dbo.V4LoginEvents` of the portal's
   database (migration 0013; the mobile API host writes to main): user, sub-user, role, result and reason, IP address,
   for the web the browser, OS, device type and a persistent browser ID, for the apps the device registration ID,
   model, manufacturer, OS version, API level and app version. Never the password. Example:
   `SELECT TOP 50 * FROM dbo.V4LoginEvents ORDER BY Id DESC`.
   **Applicant change history:** every change an MSME makes on the web (profile activity, payment GSTIN/PAN and payment
   start, financial assistance and technology upgradation documents and submissions, handholding milestone acceptance,
   password) or in the MSME app (basic information, photos, ESG checklist, financial assistance, NC replies, final
   submit, password) is kept in `ZEDCS_V2_LIVE.dbo.V4MsmeEditHistory` (migration 0014) with the submitted values
   (passwords, OTPs and tokens masked; files as name and size), IP address and device. The MSME sees it under its name →
   Edit History; MasterAdmin, SuperAdmin, Ministry, CitizenFeedback and QC see it in the MSME profile on all three portals.
2. Build the package on the build machine: `deploy\Publish-Zed.ps1` (tests run first). Copy it to the server
   (`E:\Releases\zed-<version>`); it includes the `deploy\` scripts and the settings templates.
3. Install from the package folder, dry run first, then the same with `-Apply`:
   ```powershell
   .\deploy\Install-ZedIis.ps1 -Package E:\Releases\zed-<version> -Settings E:\ZedV4\settings.json -InstallRoot E:\ZedV4 `
       -EnvironmentName Staging -SiteName ZEDV4 -CreateSite -HostName zedv3.qci.org.in `
       -CertificateThumbprint 787885A2C39981E31205F66DB5C91FB45315CE86 -HttpRedirect
   ```
   Optional: add `-AllowedIpRanges <QCI office address>,<tester ranges>` once IIS IP and Domain Restrictions is
   installed (then only those addresses reach the site). `-HttpRedirect` needs URL Rewrite; without it the script
   warns and http stays at 404.
   It creates the site `ZEDV4` (https `zedv3.qci.org.in:443` with SNI and the wildcard certificate; http :80
   redirected to https by the URL Rewrite rule `ZED-HTTPS`), the six applications and their app pools, with
   `ASPNETCORE_ENVIRONMENT=Staging`, and limits the site to the given addresses (others get 404; the other sites of
   the server are not affected). With IP restrictions, phones on mobile data have changing addresses: test the apps
   from the office Wi-Fi.
   The install root, the key folders and every storage folder must not be on D: (the Azure temporary disk); the
   script refuses it. Keep the rollback file it writes (section 8).
4. **Zed.Jobs**: install the service as in JOBS.md "Running it", with the `ZedJobs` section of the settings file as its
   environment. Leave every `Jobs:Schedules` entry and `Jobs:FolderRename` disabled (the shipped settings have them
   off); only the mail worker runs, and it sends to dev.zed@qcin.org.

### 4a. Later updates from Git

Once V4 is installed, every later update runs with one script, `deploy\Update-ZedFromGit.ps1`, in an administrator
PowerShell on the server (Git, the .NET 10 SDK and Node.js 24 installed; or build elsewhere and pass `-Package`):

```powershell
cd E:\Releases\_src                    # any checkout or package folder that has deploy\
.\deploy\Update-ZedFromGit.ps1                     # dry run: installed version, commit of main, database plan
.\deploy\Update-ZedFromGit.ps1 -Apply              # build main, back up, migrate, install the three portals, test
.\deploy\Update-ZedFromGit.ps1 -Apply -IncludeMobile -IncludeJobs -IncludeMailOutbox   # everything, 0003 again
.\deploy\Update-ZedFromGit.ps1 -Ref <tag or commit> -Apply
.\deploy\Update-ZedFromGit.ps1 -Package E:\Releases\zed-<version>.zip -Apply         # built elsewhere
.\deploy\Update-ZedFromGit.ps1 -Rollback E:\ZedV4\backups\<time> -Apply             # previous files back
```

It builds the commit into `E:\Releases` (tests included), copies the application folders it replaces to
`E:\ZedV4\backups\<time>`, runs the migrations (`-SkipFixes`: the fixes stay a reviewed, separate step), installs with
`Install-ZedIis.ps1` (settings from `E:\ZedV4\settings.json` as before) and runs `Test-ZedDeployment.ps1`. If the test
fails, the previous files go back and the pools restart (`-NoAutoRollback` leaves them). Database changes stay: the
migrations are additive and the previous version runs on them. The five newest packages and backups are kept. Log:
`E:\ZedV4\logs\update-<time>.log`. The first update after the Email Templates (migration 0015) needs
`-IncludeMailOutbox` once, so that 0003 tags the procedures' mail. Never point `-ReleasesRoot` or `-InstallRoot` at D:.
`-Environment Production -SqlServer <instance>` uses the production site ("Default Web Site"), no database prefix and
https://loginzed.msme.gov.in for the test (docs/CUTOVER.md).

## 5. Storage folders

Create the folders `E:\ZedStaging\storage\…` of the settings file (empty: the databases of 3.0 hold no units, so
there are no stored files to copy) and give the app pools Modify on them. **Never point staging at the production
share or at the old staging site's folders** (`E:\Publish\…`): V4 writes to these folders (uploads, the folder rename
job).

## 6. Check

```powershell
.\deploy\Test-ZedDeployment.ps1 -BaseUrl https://zedv3.qci.org.in -ExpectNoIndex -CheckHttpsRedirect
```
0 failures required: health and database readiness of all six applications, the Angular apps and their base
addresses, the old mail links, the XSRF cookie paths, the old dangerous actions gone, the mobile contract, no
environment label, noindex and robots.txt, and http redirected to https. Then by hand: a password reset mail arrives
at dev.zed@qcin.org.

## 7. Rehearsal journeys

Testers go through CUTOVER 1.5 and the functional checks of CUTOVER 2.1 with the accounts of 3.0 step 7 (and the
agencies, assessors and MSMEs they create), plus:
- **App registration** with the store MSME app, and the consultant app's **technology upgradation** screens (DFO
  login, GetDetails, evidence, amount correction, final submit) — MOBILE-API "Checked against the app source".
- **Payments** with CCAvenue test cards only; the zero-amount path for an eligible test unit.
- **Mobile apps**: they have the production host built in. On an emulator or test phone, point
  `loginzed.msme.gov.in` at 20.219.21.200 (hosts file, or a DNS override on a test Wi-Fi), and give the staging site a
  second https binding for that name (`-AdditionalHostNames loginzed.msme.gov.in` with a certificate for it, e.g. a
  self-signed one). The released apps accept any certificate (SECURITY-FINDINGS #131), so this works — but that is a
  flaw, not something to rely on. Remove the binding after the tests.
- The rollback (section 8), timed.

## 8. Never on staging

- **Real mail**: everything goes to dev.zed@qcin.org; no Database Mail profiles on the server; masking as a second line.
- **Real payments**: CCAvenue test gateway and test keys only.
- **Partner traffic**: no partner tokens are copied (3.0 step 3); do not give partners the staging address unless a
  test is agreed (then give them test rows of their own).
- **Zed.Jobs schedules, ERP, Udyami Bharat**: off (`Erp__Enabled=false`, `UdyamiBharat__Enabled=false`).
- **Search engines**: noindex and robots.txt come with the Staging environment; keep the IP restriction anyway.
- **Production passwords or keys** in the settings file: use new ones (LIVE-HARDENING §7 lists what is rotated anyway).

**Rollback rehearsal**: `.\deploy\Install-ZedIis.ps1 -Rollback E:\ZedV4\rollback-<time>.json -Apply` removes what the install
created (the site, its bindings and the redirect rule when the install created them); time it, then install again.

**Tear-down** when the rehearsals are over: stop the app pools and Zed.Jobs, drop the seven `ZEDV4_` databases (and
only those, 3.0), delete `E:\ZedStaging`, the settings file and the logs, and remove the IP allow-list entries.

## 9. Timing sheet

| Step | Started | Finished | Duration | Notes |
|---|---|---|---|---|
| `setup.ps1 -DatabasePrefix ZEDV4_ -WithKawachStandIn` | | | | |
| `Invoke-ZedDatabaseScripts.ps1` (migrations, fixes) | | | | |
| `Copy-ZedReferenceData.ps1` (preview, apply) | | | | |
| `database/staging/01` (procedure links) | | | | |
| Logins (`security/01`, Windows) | | | | |
| `database/staging/03` (first accounts, MasterAdmin passwords) | | | | |
| `Publish-Zed.ps1` | | | | |
| `Install-ZedIis.ps1 -Apply` | | | | |
| `Test-ZedDeployment.ps1` | | | | |
| Functional checks (testers) | | | | |
| Rollback and re-install | | | | |
