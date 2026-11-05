# Cut-over to V4 and decommission of the old sites

Runbook for the server team, the DBA and the business owner. It moves the six IIS applications of
loginzed.msme.gov.in from the old ASP.NET MVC code to V4, keeps a quick way back, and then retires the old code.
**Nothing here has been run on production yet.** The scripts were tested on a local copy (section 7).

| IIS application | Old code | V4 package folder (host) | Database |
|---|---|---|---|
| `/` | `ZEDCS main/SwatchSarvekshan` | `main` (Zed.Main.Api + Angular `main`) | ZEDCS_V2_LIVE |
| `/Consultancy` | `ZEDCS_CONSULTANCY/SwatchSarvekshan` | `consultancy` (Zed.Consultancy.Api + Angular `consultancy`) | ZED_CONSULTANT |
| `/surveillance` | `ZEDCS_SURVEILLANCE/SurveillanceWeb` | `surveillance` (Zed.Surveillance.Api + Angular `surveillance`) | ZED_SURVEILLANCE |
| `/mobileapi` | `SwachhSurvekshanServices` | `mobile`, `Mobile:System=Main` | ZEDCS_V2_LIVE |
| `/Consultancymobileapi` | consultancy services | `mobile`, `Mobile:System=Consultancy` | ZED_CONSULTANT |
| `/surveillancemobileapi` | `SurveillanceServices` | `mobile`, `Mobile:System=Surveillance` | ZED_SURVEILLANCE |
| SQL Agent jobs, Database Mail | | `jobs` (Zed.Jobs, Windows service) | all three |

The host name, the certificate and every address stay the same: mails already sent, bookmarks, CCAvenue and
Udyami Bharat keep working. Nothing moves in DNS.

**Tools** (`deploy/`):

| Script | Does |
|---|---|
| `Publish-Zed.ps1` | Tests, builds and packages everything into `zed-<version>\` (no settings, no secrets) |
| `settings.example.json` | Names of every setting per application; the filled copy stays on the server |
| `Install-ZedIis.ps1` | Installs a package into IIS at the old addresses. Dry run unless `-Apply`; writes a rollback file; `-Rollback` restores |
| `Update-ZedFromGit.ps1` | Later updates (docs/STAGING.md 4a; `-Environment Production -SqlServer <instance>`): file backup, a `COPY_ONLY` backup of the three ZED databases before the migrations (on by default; SQL Server on another machine needs `-DatabaseBackupDir <folder on that machine>`; `-SkipDatabaseBackup` leaves it out), migrations, install, test; puts the files back and removes `app_offline.htm` when the install or the test fails |
| `Test-ZedDeployment.ps1` | Smoke tests against the live address; exit code 1 on any failure |
| `Get-ZedUnusedObjects.ps1` | Lists the procedures and tables V4 does not use (for decommission); read-only |

## 1. Preparation (weeks before)

### 1.1 Server

- Windows Server 2016 or later with IIS 10, run as the same site that serves loginzed.msme.gov.in today.
- **ASP.NET Core Hosting Bundle 10** (installs the runtime and the ASP.NET Core Module V2). Restart IIS after it.
  `Install-ZedIis.ps1` warns when either is missing.
- Node is not needed on the server: the package contains the built Angular apps.
- Each V4 application gets its own app pool (`ZedV4-*`, No Managed Code). The old pools stay untouched until
  decommission, which is what makes the rollback a two-minute job.

### 1.1a Database server

- **Edition: SQL Server 2022 Standard, on a server** (decided). Express cannot hold the data: ZEDCS_V2_LIVE has 76 GB
  (MIGRATION-PLAN "Database", sizes table there). Install it with SQL Agent and Database Mail available for the other
  applications (their jobs and mail, below); ZED's jobs and procedure mail run in Zed.Jobs.
- **Same instance** for ZEDCS_V2_LIVE, ZED_CONSULTANT, ZED_SURVEILLANCE and the databases their procedures use by
  three-part name: ZED_CENTER_AUDIT_PROFESSIONAL, ZED_CENTER_AUDIT_V2, ZED_IMPACT_ASSESSMENT, KAWACH, and
  ZED_QUALITY_PROFESSIONAL (used by V2). Their applications move to the new instance in the same window.
- **Disk:** about 128 GB of data, plus the logs. Shrink the logs on the old instance first (allocated: ZEDCS_V2_LIVE
  360 GB, ZED_CONSULTANT 101 GB, ZED_SURVEILLANCE 43 GB, almost all unused), e.g.
  `DBCC SHRINKFILE (N'<log file name>', 8192);` after a log backup, or the restore needs that space.
- **Moving the data from the managed instance to the server.** Look up the managed instance's update policy in the
  Azure portal (Settings > Maintenance and updates). "SQL Server 2022": take copy-only backups to a storage account
  (`BACKUP DATABASE … TO URL … WITH COPY_ONLY`) and restore them on the server; this keeps everything, sequences
  included. "Always-up-to-date" (or "SQL Server 2025"): its backups do not restore to SQL Server 2022, so export
  BACPACs (SqlPackage; slow at 76 GB, needs its own downtime window) or copy the data another way. Rehearse the chosen
  method on staging (1.5) and time it: it sets the cut-over window.
- **Logins after the restore:** the restored databases' users keep the managed instance's SIDs. Run
  `database/security/02_orphaned_users.sql` (PREVIEW lists them), create the logins (V4: `01_v4_logins_and_roles.sql`,
  1.3 step 3; the other applications their own), then map or drop each listed user with `02` (APPLY). Azure AD users
  cannot exist on SQL Server: drop them or re-create them as Windows users. Then test each V4 host with its own login
  on staging (1.5): the local tests covered the permissions, not a real connection.
- **Check the copy** with `deploy\Compare-ZedDatabases.ps1` (read-only):
  1. After the old sites are frozen (app_offline, old app pools and Agent jobs stopped) and right before the copy-only
     backups or BACPAC exports: `-Snapshot -Server <old instance> -Credential … -Out D:\ZedV4\move\old.json`. Use
     exact counts; `-Fast` only if the window is too short, and then for both snapshots.
  2. After the restore or import, the logins and user mapping, and the settings below, before anything points at the
     new server: `-Snapshot -Server <new server> -Out D:\ZedV4\move\new.json`, then
     `-Compare "D:\ZedV4\move\old.json,D:\ZedV4\move\new.json" -Report D:\ZedV4\move\compare.txt`.
  3. Exit code 0 is required to go on. On a MUST MATCH difference do not switch the connection strings; fix it and
     compare again:
     - **missing rows or tables:** something wrote after the snapshot, or the copy is incomplete; copy that database again;
     - **a sequence or identity behind the source:** `ALTER SEQUENCE … RESTART WITH` or `DBCC CHECKIDENT … RESEED` to the source value;
     - **compatibility level, collation or a setting:** `ALTER DATABASE` to the source value (READ_COMMITTED_SNAPSHOT,
       TRUSTWORTHY, DB_CHAINING as on the old instance);
     - **a changed or missing procedure:** script it from the old instance;
     - **a missing user or role member:** re-create it;
     - **the server time zone:** set the server to IST.

     If it cannot be fixed in the window, stay on the old instance: nothing has been switched yet.
  4. EXPECTED differences (server name, version, edition, sizes, recovery model) need no action; set the recovery
     model on purpose. Act on these INFO lines: users without a login (map them to the new logins), and Agent jobs or
     Database Mail profiles of the other applications (recreate them).
  5. Keep `old.json`, `new.json` and `compare.txt` with the move's records.
- **Time zone:** the old instance runs in IST (confirmed), which is the default of `Jobs:TimeZone` (Asia/Kolkata), so
  the Zed.Jobs times are the Agent times. Give the new server the same time zone: some procedures use `GETDATE()`.
- **The other applications' jobs and mail** move with their databases to the new server's SQL Agent and Database
  Mail: the Agent job `UpdateBatchDates` (ZED_CENTER_AUDIT_PROFESSIONAL), and the Database Mail profiles
  `ZedEmailOTPs` (used by the Professional database) and `ZED_Report_Profile` (now dev.zed@qcin.org: run
  `database/fixes/msdb/01_report_profile_qci_mailbox.sql` on the old instance now, and on the new server after
  creating the profile there). ZED's own Agent jobs are not recreated on the server: Zed.Jobs runs them.
- **What takes the space** (run on the old instance, per database, before deciding on archiving):
  ```sql
  SELECT TOP 20 t.name, SUM(a.used_pages) * 8 / 1024 AS used_mb, MAX(p.rows) AS rows
  FROM sys.tables t JOIN sys.partitions p ON p.object_id = t.object_id
  JOIN sys.allocation_units a ON a.container_id = p.partition_id
  GROUP BY t.name ORDER BY used_mb DESC;
  ```

### 1.2 Files: V4 uses the old folders in place

Nothing is copied or converted. V4 reads and writes the existing folders with the old layout, so the old code finds
everything V4 wrote if you roll back.

| Setting | Point it at |
|---|---|
| `Portal:StorageRoot` (main) | the old main site root (e.g. `E:\Publish\ZEDCS_LIVE\ZEDCS_V2_LIVE`): `Certificates\`, `PDFs\`, `ReceiptInvoice\`, `Uploads\` |
| `Portal:StorageRoot` (Consultancy, Surveillance) | **the same folder as main's**: certificates and reports are shared |
| `Consultancy:SharedStorageRoot` | main's `Portal:StorageRoot` (technology-upgradation files uploaded through main) |
| `Portal:AssessmentStorageRoot` (main) | the old services site folder that holds `mobileapi\Photos\…` (photos and evidence served to MSMEs) |
| `Mobile:StorageRoot` (each mobile deployment) | that deployment's old services site folder (`Photos\`, `SaPhotos\`, `Videos\`, `Attendance\`) |
| `DataProtection:KeysPath` | set by `Install-ZedIis.ps1` to `<InstallRoot>\keys\<app>`; back this folder up (losing it signs everyone out) |

Once the IIS applications point at V4, these folders are no longer served as static files: photos, certificates
and evidence are reachable only through V4's checked endpoints (closes #9, #34).

`Install-ZedIis.ps1` grants each app pool identity Modify on its `*StorageRoot` folders and its key folder.

### 1.3 Settings and secrets

1. Copy `deploy\settings.example.json` to the server (e.g. `D:\ZedV4\settings.json`), readable by administrators only.
2. Fill it in with **new** values: every key listed in LIVE-HARDENING §7 was exposed and must be rotated anyway.
   Rotating before the cut-over means the old sites get the new values in their `Web.config`, and V4 starts with them.
3. New SQL logins for V4, not the leaked application login (#110): `database/security/01_v4_logins_and_roles.sql`
   (PREVIEW, then APPLY; passwords typed in SSMS, or `@AuthMode = 'WINDOWS'` for gMSA / app pool identities). It
   creates `zed_v4_main`, `zed_v4_consultancy`, `zed_v4_surveillance`, `zed_v4_mobile` (app), `zed_v4_jobs` and
   `zed_v4_readonly` (main's `ConnectionStrings:Consultancy/Surveillance`, the Consultancy/Surveillance hosts'
   `ConnectionStrings:Main`), with data-only roles: no db_owner, no DDL, no server roles (`database/security/README.md`).
   Point each host's connection strings at its login. Revoke the old login after the rollback window (section 4).
4. Every host checks its settings at startup outside Development and **refuses to start**, listing every missing or
   wrong one in the Windows event log (Application, source "IIS AspNetCore Module V2"). It checks: connection strings
   (main also needs Consultancy and Surveillance; the others need Main), `Portal:PublicBaseUrl` (https),
   the storage folders exist, `DataProtection:KeysPath`, SMTP (`Email:Profiles:Default`; a mail pickup folder is
   refused in Production), reCAPTCHA keys when enabled, ERP and Udyami Bharat keys when enabled, and on main the
   CCAvenue web keys (not the test gateway), the Udyam key and the Protean GSTIN account.
5. `Mobile:Culture`, `Mobile:PathBase`, version gates: see MOBILE-API.md ("Open before go-live" lists the live
   checks to do on the old services first). Keep `Mobile:DeviceBinding = Monitor`.
6. `Security:Passwords` stays `Dual` (the default) until the rollback window is over (section 4).
   **Mail rule:** in Production `Email:RedirectAllTo`, `Email:AllowedRecipientDomains` and `Portal:EnvironmentLabel`
   must be empty (every host and Zed.Jobs refuse to start otherwise). On staging the reverse: one of the two mail
   settings is required, so a copy of production data never mails real MSMEs or agencies.
   **Zed.Jobs environment:** set `DOTNET_ENVIRONMENT=Production` on the Zed.Jobs service (docs/JOBS.md "Running it").
   Without an environment variable its mail outbox sends nothing (it logs why); the other jobs run.
   **Daily status report:** set its recipients in Admin → Settings → Email Settings ("Daily status report") if it is
   wanted; without them Zed.Jobs does not send it (the old procedure's fixed recipients are outside addresses).
7. Decide `StaffPasswordReset:ExcludedRoles` (default MasterAdmin 7 and SuperAdmin 10, who get their reset link from
   another MasterAdmin; add 1 for Admin if wanted).
8. Consultant app TU calls: set `Consultancy:TuApp:LoginHours` (default 12) and `Consultancy:TuApp:SameIp` (default
   false) to the same values on the consultancy portal and on the **main** mobile host, which also needs
   `ConnectionStrings:Consultancy` (read-only login) for the TU documents.
9. Optional, only for more than one server per application: `Cache:SqlServerTable = dbo.V4Cache` (migration 0006).
   One server per application needs nothing.

### 1.4 Database

Do these **before** the cut-over; all are additive, idempotent and harmless to the old sites.

| Order | Script | Databases | Note |
|---|---|---|---|
| 1 | `migrations/0001_mobile_devices.sql` | all three | device binding tables |
| 2 | `migrations/0002_api_incentives_index.sql` | ZEDCS_V2_LIVE | |
| 3 | `migrations/0004_job_runs.sql` | ZEDCS_V2_LIVE | |
| 4 | `migrations/0005_password_hashes.sql` | all three | hashes next to the plain column (#2), docs/PASSWORDS.md |
| 5 | `migrations/0006_distributed_cache.sql` | only with `Cache:SqlServerTable` | |
| 5a | `migrations/0007_folder_rename.sql` | ZEDCS_V2_LIVE | folder rename job (docs/JOBS.md); EXECUTE for the Zed.Jobs login, modify rights on the two folders |
| 5b | `migrations/0008_staff_password_reset.sql` | all three | staff password reset (docs/PASSWORDS.md); EXECUTE on the four `SP_V4_STAFF_RESET_*` procedures; needs a working SMTP profile on each portal |
| 5d | `migrations/0010_app_sessions.sql` | ZED_CONSULTANT | consultant app sign-ins for the TU calls (#88; MOBILE-API "Checked against the app source"). **Before the consultancy mobile host goes live:** without it every TU app call is refused |
| 5c | `migrations/0009_msme_password_reset.sql` | ZEDCS_V2_LIVE, after 0008 | MSME reset on hashed tokens (#128); EXECUTE for the portal and MSME app logins on `SP_V4_STAFF_RESET_CREATE` and the three `SP_V4_MSME_RESET_*` procedures |
| 5e | `migrations/0011_settings.sql` | all three | Admin settings (Captcha Settings, Email Settings). Without it the captcha and the mailboxes follow the configuration and the Admin pages cannot save |
| 5f | `migrations/0012_sub_users.sql` | all three | sub-users of MasterAdmins (operation admins) and agencies (User Management). Without it no sub-user can be created or sign in |
| 5g | `migrations/0013_login_events.sql` | all three | every web and app sign-in with IP address, browser or device (registration ID, model, OS, app version). Without it sign-ins work but are not recorded |
| 5h | `migrations/0014_msme_edit_history.sql` | ZEDCS_V2_LIVE | the applicant's change history (web and MSME app). Without it changes work but are not recorded |
| 5i | `migrations/0015_email_templates.sql` | all three | Admin → Email Templates (switch an e-mail off, own subject and text). Without it the standard e-mails are sent and the page cannot save |
| 5j | `migrations/0016_content_blocks.sql` | all three | Admin → Texts (disclaimers, instructions, undertakings and pledges of the web pages and the apps). Without it the standard texts are shown and the page cannot save |
| 5k | `migrations/0017_app_forms.sql` | all three | Admin → App Forms (fields of the apps' Basic Information forms: labels, order, required, disabled, the Admin's own fields and their answers). Without it the apps get the standard forms and the page cannot save |
| 5l | `migrations/0018_smtp_servers.sql` | all three | Admin → Email Settings → mail servers per module (Registration, OTP, payment, …). Without it the page cannot save them and the portals use the server configuration (Email:Profiles). The passwords are encrypted for the server machine: after a move to another server, enter them again |
| 5m | `migrations/0019_dashboard_analytics.sql` | ZEDCS_V2_LIVE | Staff dashboard "ZED Dashboard" / "ZED Certification" figures (SP_V4_DASHBOARD_ANALYTICS, read-only). Without it the main portal's dashboard shows an error in that section |
| 5n | `migrations/0020_dashboard_analytics_consultancy.sql` | ZED_CONSULTANT | the same figures for Consultancy (handholding: completed = milestone 3 done; applications per level; milestone and Technology Intervention cards). Without it the Consultancy dashboard shows an error |
| 5o | `migrations/0021_dashboard_analytics_surveillance.sql` | ZED_SURVEILLANCE | the same figures for Surveillance (surveillance completed; its status cards). Without it the Surveillance dashboard shows an error |
| 5p | `migrations/0022_esg_checklist.sql` | ZEDCS_V2_LIVE, ZED_SURVEILLANCE | Admin → Questionnaire → ESG Checklist (the ESG and Social / OHS questions the MSME and surveillance apps ask). Without it the apps get the standard checklist and the page cannot save |
| 5q | `migrations/0023_document_access.sql` | ZEDCS_V2_LIVE, ZED_CONSULTANT | Admin → Masters → Documents/Videos: new columns of `dbo.MyDocuments` (Description, VideoUrl, AccessRoles, AccessUpdatedBy/On). Moves the values of an earlier V4 build's `dbo.V4DocumentAccess` into them and drops that table. Without it every document goes to the MSMEs only, as before, and the page cannot save the roles |
| 5r | `migrations/0024_special_regions.sql` | ZEDCS_V2_LIVE | Admin → Masters → Subsidy Regions: new columns of `dbo.Districts` and `dbo.States` (SubsidyAspirational, SubsidyLwe, SubsidyHimalayan, SubsidyIsland, SubsidyNer: NULL not listed, 0 off, 1 on; SubsidyUpdatedBy/On). Moves the entries of an earlier V4 build's `dbo.V4SpecialRegions` into them and drops that table; on a new installation seeds today's aspirational districts enabled and the new regions off. Without it the page cannot open and the aspirational flags stay as they are |
| 5s | `migrations/0025_sector_activity.sql` | all three | Admin → Masters → Sectors: Manufacturing or Services per NIC sector, in the new column `dbo.Sectors.SectorType` (nullable; the old sites' procedures are unchanged and unaffected). Seeded by NIC 2008: divisions 10–33 Manufacturing, the rest Services. Without it the Sectors page cannot save |
| 5t | `migrations/0026_incentive_dashboard.sql` | ZEDCS_V2_LIVE | Admin → Incentives: "Where it appears" (own card on the MSME dashboard, or inside the stakeholder card) and the card's highlight, in the new columns `dbo.Incentives.DisplayOn`, `CardHighlight`, `DashboardCard`. Adds the five built-in cards of "My Incentives" (MSME KAWACH, Joining Reward, Financial Assistance, Handholding, Technology Upgradation) once, as IncentiveType `Dashboard`, which the legacy procedures never read. No index on the table (the legacy procedures may run with QUOTED_IDENTIFIER OFF). Without it the dashboard shows the built-in cards as before and the choice is not saved |
| 5u | `migrations/0027_api_client_enabled.sql` | ZEDCS_V2_LIVE | Administration → API Integrations: Enable / Disable of a partner in the new column `dbo.ApiClientTokens.IsEnabled` (NULL = enabled), with `UpdatedBy` / `UpdatedOn` for the switch and Edit. Moves the switches earlier V4 builds kept in `dbo.V4Settings` (`ApiClient.{Id}.Enabled`) into the column and removes those rows. The partner APIs read the table with `SELECT *`, so before it every partner is enabled, as before V4 |
| 5v | `migrations/0028_certification_levels.sql` | ZEDCS_V2_LIVE, ZED_SURVEILLANCE | Administration → Certification Levels: the levels as settings in new columns of the legacy `dbo.SectionTypes` (name, description, comment, logo, enabled, desktop or site assessment, validity, surveillance, certificate number formats in general / Manufacturing / Services, fee shown), with the rows Bronze, Silver, Gold and **ZED-X** (code `ZEDX`, added **disabled**). `dbo.Sections.NicSectors` (a parameter's NIC sectors; NULL = all). Main only: `dbo.Users.SectorActivity` (agency / assessor: Manufacturing, Services or Both) and the ZED-X rows of `dbo.AssessmentFee` (Rs. 75,000, Gold's subsidy and joining-reward rules). The legacy procedures still number certificates and compute validity as before; using these settings in the certification flow follows with the ZED-X application |
| 5w | `migrations/0029_zedx_payment.sql` | ZEDCS_V2_LIVE | ZED-X applying and paying: `dbo.Msme.IsZEDXPaymentDone` / `IsSurZEDXPaymentDone`, and the new procedure `SP_V4_CERTIFICATION_PAID`, which V4 runs after every recorded certification payment (gateway, mobile, zero amount, staff "mark successful"): it sets ZED-X's flag and removes from the unit's copy of the questionnaire the parameters that do not apply to its NIC sector (`Sections.NicSectors`), before the unit has started the level. The legacy payment procedures are not changed. ZED-X is offered to MSMEs only once enabled in Administration → Certification Levels |
| 5x | `migrations/0030_app_form_applicability.sql` | all three | Admin → App Forms: a field can be limited to certification levels and NIC sectors (new columns `Levels`, `NicSectors` of `dbo.V4AppFormFields`; NULL = all). A field that does not apply to a unit is neither shown (`Forms/Definition?form=..&zedId=..&certificationType=..`) nor required of it on submit. Before it, every field applies |
| 5y | `migrations/0031_zedx_auto_allotment.sql` | ZEDCS_V2_LIVE | New `SP_V4_AUTO_ALLOT_AGENCY`: the agency of a ZED-X final submit (the legacy final submit allots Bronze/Silver/Gold only), as the Silver/Gold round robin but only among agencies that assess the unit's kind (`Users.SectorActivity` vs the unit's NIC sector type, else its Udyam activity). The MasterAdmin's Allot page and the agencies' DA / SA allotment offer, for every level, only agencies and assessors whose Manufacturing / Services type covers the unit (not set = any) |
| 5z | none (no database change) | ZEDCS_V2_LIVE | ZED-X basic information, documents and final submit on the web (`/msme/entry/ZEDX`, `api/msme/entry`), because the store MSME app has no ZED-X (docs/mobile/ZEDX-MSME-APP.md). It uses the app's procedures (`SP_APP_MSME_INSERT_BASIC_INFO`, `SP_APP_MSME_INSERT_EVIDENCE`, `SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT`, `SP_APP_MSME_FINAL_SUBMIT`, then 0031's `SP_V4_AUTO_ALLOT_AGENCY`) and the app's folders. **The main portal now writes** to `Portal:AssessmentStorageRoot\mobileapi\Photos\{ZedId}\ZEDX\...` (until now it only read there): the app pool needs Modify on that folder, which `Install-ZedIis.ps1` grants to every `*StorageRoot` setting |
| 5z2 | `fixes/main/14_zedx_levels.sql` (PREVIEW, diff, APPLY: `-ApplyFixes 'main/14_zedx_levels'`) | ZEDCS_V2_LIVE | ZED-X assessment and certificate (stage 3). Six legacy procedures that name the levels take ZEDX as Gold where it is assessed like Gold (NC products and their answers in SaProducts, the site products' addresses, send back to the assessor at status 13 / 14, payment flag cleared on an NC5 rejection), and `SP_MONITORING_RA_FINAL_SUBMIT` gives ZEDX its own QR number (plant ID, "5", code) without marking the unit's Bronze / Silver certificate UPGRADED. The nightly AutoReject job's `SP_ASSESSMENT_DA_AUTO_REJECT` rejects a ZED-X site NC past its NC closure date (14 → 17) as Gold's (the same edit is in `surveillance/08_zedx_levels` for the surveillance copy; added later: on a server where both scripts were applied before, run them again with `-ApplyFixes 'main/14_zedx_levels','surveillance/08_zedx_levels'`; the earlier edits report "already in place"). Bronze / Silver / Gold unchanged. **Without it ZED-X NC pages miss a result set and a ZED-X certificate would end the unit's Bronze / Silver.** Then the portal numbers the ZED-X certificate in the Admin's format, sets its first surveillance date from the level's settings, and draws it on `Assets/Documents/SaZEDX.jpg` (made by `backend/tools/make_zedx_artwork.py`) with the Admin's validity and, when uploaded, the level's logo; its QR opens this portal's `/Verify/XC/{code}`. NC answers for ZED-X are given on the web (`/msme/entry/ZEDX`, NC tab) |
| 5z3 | none (no database change) | all | (1) **Certificate QR codes** of every level (pledge already did) now open the Verify page of the site that issues them (`Portal:PublicBaseUrl`, cut to the site for /surveillance), instead of the live portal's address the procedures write: on the test server they open the test server, on production still `https://loginzed.msme.gov.in/Verify/...`. Certificates issued before keep their QR. (2) **Onsite site assessments on main:** after the SA app's closing meeting (status 13) the lead assessor reviews and final-submits on the remote assessment page (REVIEW & SUBMIT on the Remote/Onsite list), as the old SaDetails page did; checked end to end for ZED-X with `backend/tools/zedx_e2e.py` on throwaway databases (`database/seed/dev-zedx-e2e.sql`) |
| 5z4 | `migrations/0032_level_surveillance_schedule.sql`, `migrations/0033_level_surveillance.sql`, `fixes/surveillance/08_zedx_levels.sql` and the new edit of `fixes/main/14_zedx_levels.sql` (PREVIEW, diff, APPLY: `-ApplyFixes 'main/14_zedx_levels','surveillance/08_zedx_levels'`) | ZEDCS_V2_LIVE, ZED_SURVEILLANCE | **ZED-X surveillance** (stage 4), as Silver / Gold: two surveillances, fee Rs. 25,000 (0033 copies Gold's surveillance fee rows to ZEDX; change them in Masters → Payments on the surveillance portal), the same assessment and a surveillance certificate on `Assets/Documents/Surveillance/SaZEDX.jpg` with the round written in ("Surveillance 2 Completed on :"). Its schedule is the Admin's (Administration → Certification Levels: number of surveillances, months between them, first due date, notice, reminders, suspension, withdrawal; Silver / Gold values to start) and is run daily by the new Zed.Jobs entry "Level surveillance schedule" (`SP_V4_LEVEL_SURVEILLANCE_SCHEDULE`; **set `"Enabled": true` on the server copy** of Zed.Jobs settings, as for the other jobs; it also expires ZED-X certificates after the Admin's validity, which the legacy Certificate_Expiry job does not). After a surveillance payment the portal runs `ZED_SURVEILLANCE.dbo.SP_V4_SURVEILLANCE_PAID` (payment flags, NIC sector-wise questionnaire, minimum parameters). The fix scripts let the surveillance procedures that name Silver / Gold treat ZEDX as Gold, and main's `SP_MSME_GET_DETAILS` open the ZED-X surveillance details. Bronze / Silver / Gold and their jobs unchanged. **Parameters assessed in surveillance:** as for Gold, the surveillance payment copies only the parameters marked for it (`Sections.SurveMandatories`); the Admin marks them in the Questionnaire ("Assessed again in surveillance"), and 0032 marks every ZED-X parameter once, on its first run when none is marked (running it again never marks them again). End to end through both portals with `backend/tools/zedx_surveillance_e2e.py` (schedule opens the round, dashboard, gateway payment, agency allotment with meeting link, remote assessment, certification, surveillance certificate downloaded on main). Checked day by day on throwaway databases with `backend/tools/zedx_surveillance_check.py` (notice, reminders, suspension, withdrawal, paid round with the NIC filter, round 2, a third round set by the Admin, expiry) |
| 5z5 | `migrations/0034_requirement_checkpoints.sql` | ZEDCS_V2_LIVE, ZED_SURVEILLANCE | **Requirements as Yes / No checkpoints** (Administration → Questionnaire → Requirements): a requirement's purpose and benefits (`Requirements.Purpose`, `.Benefits`), each point as a checkpoint with the actions needed for No / Partial (`Options.ActionsNeeded`, one per line) and the evidence for Yes linked to its checkpoint with an optional sample copy (`Evidences.OptionCode`, `.SampleFile`; files in `Uploads/EvidenceSamples/` under `Portal:StorageRoot`). New columns of the existing tables only; the legacy procedures, the old sites and the MSMEs' copies (MsmeRequirements, MsmeEvidences) are unchanged. Requirements can now be edited, and exported / uploaded as Excel (a row per checkpoint). Without the migration the page still lists the requirements and says that 0034 is needed to save. |
| 5z6 | `migrations/0035_consultancy_parameters.sql` | ZEDCS_V2_LIVE | **One Admin** (stages 1 and 2; no other database change): the main portal's Admin works on the Consultancy and Surveillance portals' screens from the main Admin (one-time sign-in pass in the legacy `dbo.OTP`, read by those portals through their read-only `ConnectionStrings:Main`). 0035 adds `Sections.InConsultancy` (NULL / 'Yes' = used in consultancy, 'No' = not): Questionnaire → Parameters gets a "Used in consultancy" tick, and right after a handholding milestone payment V4 removes the unticked parameters from that milestone's copy in ZED_CONSULTANT (the legacy payment procedures are not changed; nothing changes until a parameter is unticked). The ESG checklist (main and surveillance) and Documents/Videos (main and consultancy) get "Used in" / "Shown on" ticks, saved through each portal's own API. |
| 5z7 | `migrations/0036_surveillance_level_schedule.sql` | ZED_SURVEILLANCE | **One Admin** (stage 3): the surveillance schedule columns of 0032 on ZED_SURVEILLANCE.dbo.SectionTypes too, so that Certification Levels saved on the main portal are saved on the surveillance portal's copy (it failed there with "apply migrations 0028, 0032"). The portal switch (ZED Certification / Consultancy / Surveillance) is on Payments, Upload Image (main and consultancy), User Management, Email Settings, Email Templates, Texts, App Forms and Captcha. An Admin password sign-in on the Consultancy or Surveillance portal is refused with a link to the main portal's Admin (that portal chosen in its switch); every other login there is unchanged. |
| 5z8 | `migrations/0037_level_surveillance_all_levels.sql`, `migrations/0038_surveillance_copy_bronze.sql` | ZEDCS_V2_LIVE, ZED_SURVEILLANCE | **Bronze / Silver / Gold surveillance editable like ZED-X.** The V4 surveillance schedule (`SP_V4_LEVEL_SURVEILLANCE_SCHEDULE`, Zed.Jobs "Level surveillance schedule") takes over the three levels from the Agent jobs Bronze_Surveillance_Job, Silver_Gold_Surveillance_Data_job, Silver_Gold_Second_Surveillance_Data_job and AutoSuspendingSilverGold. 0037 adds `SectionTypes.SurveillanceAutoApply`, `SurveillanceSuspendRounds` and `SurveillanceScheduleFrom` and fills in the old jobs' timings where none is set (Bronze: due at 18 months, notice at 14, reminder at 15, applied for by the portal at 16, never suspended; Silver / Gold: due at 15 and 27, notices at 11 and 23, reminders a month apart, suspended at 16 in the first round only, withdrawn 64 days later with re-certification enabled), so nothing changes until the Admin edits them. Units the old jobs skip are skipped (no-mail units, units upgraded to a higher level), and round 2 opens only after round 1 is certified. 0038 copies Bronze units to ZED_SURVEILLANCE as the old Bronze job did, and adds the three columns there too (the mirrored level save). Deploying it changes nothing for the three levels: the daily run leaves them to the Agent jobs until the switch-over (and later deploys keep the Admin's settings, surveillance switched off included). **Switch-over on one day:** run `EXEC dbo.SP_V4_LEVEL_SURVEILLANCE_SCHEDULE @DryRun = 1` on main and check the list; switch the four Agent jobs off; run `EXEC dbo.SP_V4_LEVEL_SURVEILLANCE_SCHEDULE @Start = 1` once; set `"Enabled": true` on "Level surveillance schedule" if it is not on yet. That run records the day: a step that fell due earlier is not done (the dry run lists them). The portal applies a unit for its surveillance on the last reminder for Bronze only (the legacy apply records it as a zero payment). The surveillance mails are the V4 ones (no password), worded in the procedure. Checked day by day on throwaway databases with `backend/tools/level_surveillance_bsg_check.py` and `zedx_surveillance_check.py` |
| 5z9 | `migrations/0039_checkpoint_answers.sql` | all three | **Yes / Partial / No for each checkpoint** of a requirement (the checkpoints, actions needed and evidence links of 0034). The desktop assessor (desktop assessment page, also in NC rounds), the lead site assessor (remote assessment page, also in NC rounds: its NC tab, where the round is final-submitted) and the handholding consultant (milestone page, Parameters tab: baseline in milestone 1, Progress Reviews 1 and 2 in milestones 2 and 3) answer each checkpoint; for No / Partial they tick the Admin's actions needed. Yes needs every mandatory evidence of the checkpoint uploaded and not refused (handholding, which has no per-evidence uploads: a photo on the parameter). The requirement's existing conformance is then set through the legacy procedures (`SP_ASSESSMENT_DA_UPDATE_REQUIREMENT`, `SP_ASSESSMENT_RA_UPDATE_REQUIREMENT`): Yes only when every checkpoint is Yes; a Partial counts as not conforming. When the assessor writes no remarks, the No / Partial checkpoints and their actions become the remarks the unit sees on its NC page. The baseline's ticked actions are added once to the Handholding Action Plan, where they stay editable. New columns of the existing `dbo.MsmeOptions` only (DaAnswer / SaAnswer / HhAnswer with their actions and remarks, HhReview1, HhReview2, AnsweredBy, AnsweredOn); the site assessor app answers the site checkpoints the same way (an older SA app is asked to update for a requirement with checkpoints) and the consultant app's action-plan sync keeps the web's changes (docs/MOBILE-API.md); the MSME screens, the other mobile apps and the legacy procedures are not changed. A requirement without checkpoint rows, or a database before 0039, keeps the old Yes / No pop-up |
| 5z10 | `migrations/0040_users_session_stamp.sql` | all three | **Sessions end on the server (M12).** A new column of the legacy `dbo.Users`, `SessionStamp uniqueidentifier NULL`, copied into the sign-in cookie and compared on every request (at most a minute old). V4 sets a new value on a password change or reset, block / unblock, an account locked by wrong passwords, an edit of a staff login or agency (the agency's assessors too: their sub-roles follow it), and an MSME deactivation; main also sets it on the account's ZED_SURVEILLANCE copy. The open sessions of that user then end (401) in every browser. The Admin's Consultancy / Surveillance sessions (the hand-over) compare main's value through the read-only `ConnectionStrings:Main`. NULL until the first change, so deploying it ends no session; before it is deployed the portals read "" and change nothing, without an error. The V4 logins already have SELECT / UPDATE on `dbo.Users` (main's portal login also on ZED_SURVEILLANCE.dbo.Users, as zed_v4_app there); the read-only login reads main's column. The old sites and procedures never use it. docs/PASSWORDS.md "Sessions" |
| 5z11 | `migrations/0041_subsidy_categories.sql` | all three (ZED_CONSULTANT first) | **Separate subsidy categories, the same numbers in the three databases:** 0 General, 1 SC-owned, 2 woman-owned, 3 ST-owned, 4 aspirational district, 5 LWE district, 6 Himalayan region, 7 island territory, 8 North Eastern Region (`AssessmentFee.SpecialCategory`, also main's and ZED_CONSULTANT's `StateAssessmentFee`). ZED_CONSULTANT: the column becomes int (was bit) on both fee tables, and its general row NULL becomes 0 (Rejected rows are left as they are). **No price change at deploy:** each group of fee rows gets copies of its category-1 rows, same amounts and share, for the categories it lacks (main 3-8, its woman row 2 exists; ZED_CONSULTANT and ZED_SURVEILLANCE 2-8); done once per table (extended property `V4_0041_SubsidyCategories`), so later deploys keep the Admin's shares and removals. New `dbo.FN_V4_SUBSIDY_CATEGORY` (each database): of the categories a unit fits (SC / ST / woman from MsmeBasicInformation; 4-8 from main's Subsidy Regions for the plant district or its state), the one with the highest share for the type and level (and milestone); ties to the lower number. The payment procedures use it and choose `SpecialCategory = @SpecialCategory` (main `SP_MSME_GET_PAYMENT_DETAILS`, `SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS`; ZED_CONSULTANT `SP_MSME_GET_PAYMENT_DETAILS`; ZED_SURVEILLANCE `SP_MSME_GET_PAYMENT_DETAILS`, `SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS`, `SP_APPLY_BRONZE_SURVEILLANCE_FROM_BACKEND`); result sets unchanged (ZED_CONSULTANT's `SpecialCategory` column is now a number, not true / false). Each database's part is one transaction; for the few seconds between the ZED_CONSULTANT part and the other two, main's and ZED_SURVEILLANCE's old handholding procedure finds no general row: deploy it with the portals stopped. Checked on throwaway databases: every test unit pays the same before and after; a raised share moves an overlapping unit to it; a second run changes nothing |
| 5z12 | `migrations/0042_level_surveillance_paid_and_skipped_steps.sql` | ZEDCS_V2_LIVE | **Two corrections of the V4 surveillance schedule** (`SP_V4_LEVEL_SURVEILLANCE_SCHEDULE` of 0032 / 0037, replaced with `CREATE OR ALTER`; no table change). (1) A unit whose surveillance was paid stays on the schedule: the ZED_SURVEILLANCE payment procedures set main's `MsmeCertifications.RestrictMail = 'Payment Completed'` ('S2 Payment Completed' for round 2), which 0037 treated as "no mail", so Silver / Gold surveillance 2 (and a later ZED-X round) never opened after a real payment; as the legacy second-round job, those two values no longer leave a unit out (the upgrade values still do). (2) A step whose day came before the level's start no longer stops the unit: its mail is still not sent and a suspension or withdrawal is still not done, but a notice opens the round, a reminder is counted and Bronze's apply by the portal is counted (the unit not applied), so the unit's later steps (reminders, suspension, Bronze's apply) come in their time; each such step is written to MsmeHistory ("no mail: its day ... was before the V4 schedule started") and listed by the dry run with its note. Run it before the switch-over of 5z8 (it changes nothing until then for Bronze / Silver / Gold; ZED-X units with a paid round move on at the next daily run). The migration's marker is the new definition (`DEF:` in `deploy/Invoke-ZedDatabaseScripts.ps1`). Checked day by day on throwaway databases with `backend/tools/level_surveillance_bsg_check.py` (a payment now leaves RestrictMail as the real procedures do) and `zedx_surveillance_check.py` |
| 5z13 | `migrations/0043_site_evidence_checks.sql` | ZEDCS_V2_LIVE, ZED_SURVEILLANCE | **Listed evidences checked at the site** (redesigned site assessor app). New columns of the existing `dbo.MsmeEvidences` only (`SaAvailable`, `SaPhotoIds`, `SaAnsweredBy`, `SaAnsweredOn`): for each evidence the Admin lists for a requirement the site assessor answers whether it is available (Yes with 1 to 3 photos, taken or picked from the site tour, or No); a No keeps the requirement from conforming. Before it is deployed the mobile API lists no evidences and the app keeps its free evidence photos. The desktop assessor's `IsVerified`, the MSME screens, the legacy procedures and the installed apps are not changed. docs/MOBILE-API.md "Evidences listed by the Admin" |
| 5z14 | `migrations/0044_consultancy_fee_schedule.sql`, `migrations/0045_consultancy_fee_levels.sql` | 0044 ZED_CONSULTANT, then 0045 ZEDCS_V2_LIVE and ZED_SURVEILLANCE | **Handholding fees per level, and "pay all at milestone 1".** New columns of the legacy `ZED_CONSULTANT.dbo.AssessmentFee` (`PayAllAtMilestone1`, `PayAllFrom`) and two functions (`FN_V4_PAY_ALL_AT_MILESTONE1`, `FN_V4_STATE_HANDHOLDING_FEE`); the handholding payment procedures are edited in place by exact replacement (a live text that differs stops the script and changes nothing; the fix scripts may run before or after). `SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS` now charges the rows of the unit's level (it did not filter the level, so Silver and Gold had to have one fee) and, once Admin switches the schedule on (Masters -> Payments, Consultancy), milestone 1 of units starting from the chosen date charges the three milestones added up and milestones 2 and 3 open at Rs. 0 (`SP_MSME_ZERO_PAYMENT_DETAILS`, PaymentType `PaidAtMilestone1`); units already started keep paying milestone by milestone. Where a type's Silver and Gold rows of a milestone have the same amounts (as the old fee page always wrote them) units pay what they paid before; where they differ, each level is now charged its own rows. The schedule changes nothing until Admin switches it on. Also fixed: an Andhra Pradesh unit with a state-subsidy fee row and something left to pay could not pay (the gateway procedures read the fee in `AssessmentFee` by a `StateAssessmentFee` Id), and the Rs. 0 state payment wrote the milestone-1 state date for one hard-coded unit only |
| 5z15 | `migrations/0046_recertification_fee_and_validity.sql` | ZEDCS_V2_LIVE | **Recertification: its own fee, the level's validity, a second cycle.** The Rejected rows are copied once to `AssessmentFee` EnterpriseTypee `RECERTIFICATION` (same amounts: no price change at deploy), shown on Masters -> Payments as the type "Recertification"; `SP_MSME_GET_PAYMENT_DETAILS` charges a recertification those rows (the Rejected rows when a level has none). The expiry job (`SP_JOB_TO_UPDATE_3YEARS_COMPLETED_TO_EXPIRED`) and the renewal mail (`SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_RECERTIFICATION`) follow each level's validity (Certification Levels, 36 months by default) instead of 3 years / 30 months; the mail also covers the V4 site levels (ZED-X) and counts only the mails and enables of the current certificate, so a re-certified unit gets it again. The financial-support reports show the unit's own enterprise type for a recertification payment. Edited in place like 0045 (`main/05_mail_passwords` edits other parts of the mail procedure, in either order) |
| 5z16 | `migrations/0047_certificate_validity.sql` | all three | **A certificate's expiry from its level's validity** (Certification Levels, 36 months by default) instead of a fixed 3 years: `dbo.FN_V4_VALIDITY_MONTHS` (ZED_CONSULTANT and ZED_SURVEILLANCE read main's levels), used by the QR verification page (`SP_VERIFY_QR_CODE`) and the certified-unit APIs for other systems (`SP_API_GET_CERTIFIED_UNIT_DETAILS_BY_UDYAM`, `..._BY_MULTIPLE_UDYAMS`, `SP_API_GET_STATE_CERTIFIED_UNIT_DETAILS`, `SP_API_MSME_GET_CERTIFICATIONS_BY_UDYAM_NO_AND_ZEDID`). Edited in place like 0045 (`main/12_api_token_logging` edits other parts of the API procedures, in either order). With every level at 36 months nothing changes. The certificates themselves (Bronze, Silver, Gold artwork's blank validity line) and the assessment report's disclaimer take the validity in the application, not here |
| 5z17 | `migrations/0048_first_surveillance_due_date.sql` | ZEDCS_V2_LIVE | **The first surveillance due date of a new certificate from its level** (Certification Levels, `FirstSurveillanceMonths`: Bronze 18, Silver / Gold 15) instead of the fixed 450 days (`SP_MONITORING_DA_FINAL_SUBMIT`) and 365 days (`SP_MONITORING_RA_FINAL_SUBMIT`): `dbo.FN_V4_FIRST_SURVEILLANCE_MONTHS` (NULL when the level's surveillance is off). The V4 schedule already counts from the setting; the date shown (`FirstSurveDueDate`) now agrees. Certificates issued before keep their date. Edited in place like 0045 (`main/14_zedx_levels` edits other parts, in either order) |
| 6 | `fixes/*` per LIVE-HARDENING §4 (PREVIEW, diff, APPLY) | as named | protect the old sites now; all are compatible with V4. `main/05_mail_passwords` **must** be in before the reminder jobs run in Zed.Jobs (they mail passwords otherwise); `main/11` needs SELECT on `ZED_SURVEILLANCE.dbo.MsmeCertifications` for the executing login; `main/13` is a report (switch xp_cmdshell off once `Jobs:FolderRename` has replaced the old rename job) |
| 7 | `migrations/0003_mail_outbox.sql` | all three | **only together with starting Zed.Jobs and switching the Agent jobs off** (JOBS.md "Before go-live"): from then on procedure mail of the old sites is sent by Zed.Jobs too |

Exception: `fixes/main/02_sp_get_user_details_master_passwords.sql` breaks the **old** Udyami Bharat hand-over;
run it at the cut-over, right after V4 serves `/Msme/ZedDashboard` (section 2, step 6).

**Runner.** `deploy\Invoke-ZedDatabaseScripts.ps1 -Server <server>` checks the server and the databases and shows,
per migration, whether it is applied; it runs nothing. With `-Apply` it runs the migrations of this table in order, on
their databases, stopping at the first failure. 0006 runs only with `-IncludeDistributedCache`, and 0003 only with
`-IncludeMailOutbox`, last. It then previews every fix script and saves, per procedure, the live definition
(`fixes\<name>\live\`, which is the undo) and the new one where the script prints it (`new\`, with full definitions
for main 05–12). Diff the two before deciding; for scripts without a `new\` file, review the script's own pattern list
against `live\`. Apply reviewed fixes with `-SkipMigrations -ApplyFixes 'main/05_mail_passwords','…'`, using exact
names; each is previewed again and its live definitions saved first. `main/02` is refused without `-AtCutover`;
`msdb/01` (mailbox password) and `main/13` (a report) are run by hand in SSMS. Logs and summary:
`database\logs\cutover-<time>`. Exit code 0 only when every step succeeded.

`fixes/consultancy/10_tu_state_checks.sql` changed on 2026-10-22 (the consultant app corrects amounts at
VerificationStatus 2): amounts can change at 2, or 4 with no transfer in progress. If the earlier version was applied
anywhere, restore that procedure's saved definition first, then run 10 again.

The 18 procedures that do not compile (MIGRATION-PLAN "Database") are broken on production already and no V4 path
depends on them; nothing to do. (Sequences and the referenced databases are settled: section 1.1a.)

**Where the databases live.** The application cut-over keeps the databases where they are. Moving them to the new
SQL Server 2022 **Standard** server (1.1a) is a **separate change in its own window**, before or after, never the
same night:
- every related database goes together (1.1a "Same instance"), with its applications re-pointed;
- move them as 1.1a "Moving the data" says (backup/restore if the managed instance's update policy allows it, else
  BACPAC), with logins, compatibility level 160 and the collation; a restore keeps the SEQUENCE current values;
- then change only the connection strings and restart the app pools and Zed.Jobs.

### 1.5 Rehearsal on staging (required)

The staging server is https://zedv3.qci.org.in (20.219.21.200): its step-by-step runbook, settings file, data script
and timing sheet are in **docs/STAGING.md**.

1. Restore last night's production backups of all related databases on the staging server (STAGING.md section 3),
   prepare the copy with `database/staging/01_prepare_restored_copy.sql`, and copy the storage folders.
2. A staging site with a name that marks it as staging (e.g. `staging.loginzed.…`), its own certificate, and the
   same six applications. Install with the real procedure: `Publish-Zed.ps1`, `Install-ZedIis.ps1` (dry run, then
   `-Apply`), `Test-ZedDeployment.ps1 -BaseUrl https://staging…`. CCAvenue in test mode with test keys.
3. Testers go through the journeys in 2.1 step 9 with real accounts of the restored copy. Test app registration
   with the store MSME app: V4 serves its `Msme/FinalSubmit`, `ValidateCaptcha`, `ValidatePlantAndActivity` and
   `Send/VerifyPledgeEmailOtp` calls (MOBILE-API "MSME app registration"), built from the code base in the Bronze copy
   because the store app's source was not delivered; needs `Recaptcha:AppSecretKey`.
   Also run the consultant app's TU screens (DFO login, then GetDetails, evidence, amount correction, final submit).
4. Mobile apps: their addresses are built in. Use the vendor's staging build, or an emulator / test phone whose
   hosts file points loginzed.msme.gov.in at the staging server.
5. Rehearse the rollback too (`Install-ZedIis.ps1 -Rollback … -Apply`) and time both directions.
6. Rehearse the database move with the comparison too (1.1a "Check the copy"), and time both snapshots: exact counts
   on 76 GB can take a while; that decides between exact and `-Fast` on the night.
7. Run every V4 host with its own least-privilege login (1.3 step 3) through the journeys of 2.1: the permissions were
   tested locally with impersonation only.

## 2. Cut-over day

### 2.1 Sequence (evening window, about 2½ hours to go/no-go)

| Time | Step | Who |
|---|---|---|
| T−7 d | Release package built from the tagged commit (`Publish-Zed.ps1`, tests run); staging rehearsal passed; settings file filled; CCAvenue, Udyami Bharat, the app vendor and the agencies told the date | dev lead, owner |
| T−1 d | Notice on the portal and to the agencies; DBA confirms backup space; testers named | owner |
| 0:00 | **Freeze**: put `app_offline.htm` (a "being updated" page) into each of the six old application folders. The old sites stop writing. Stop the old services' app pools too (the apps get errors for the window) | server team |
| 0:05 | Copy-only backups of the three databases. `appcmd add backup "before-v4"`. Copy each old application's `web.config`, and the site-level ZED-* request rules (LIVE-HARDENING §1) to a safe folder | DBA, server team |
| 0:20 | `Invoke-ZedDatabaseScripts.ps1 -Server … -Apply` (migrations, all "ok"; the fix previews should show "nothing to change" for the fixes applied earlier). Keep the log folder with the cut-over records | DBA |
| 0:30 | **Remove the ZED-* request rules** (LIVE-HARDENING) from the site level. They target the old code and some match V4 addresses: ZED-A03 blocks `/Login…` (V4's staff sign-in), ZED-C01 blocks `/Pay/SubmitZeroPaymentDetails` (served by V4 to the app). V4 has none of the old actions they protect. Keep the copy for a rollback | server team |
| 0:35 | `Install-ZedIis.ps1 -Package … -Settings … ` (dry run; read it), then the same with `-Apply`. Note the rollback file it writes. Remove the `app_offline.htm` files of the old folders (they are no longer served) | server team |
| 0:50 | `Invoke-ZedDatabaseScripts.ps1 -Server … -Apply -SkipMigrations -AtCutover -ApplyFixes 'main/02_sp_get_user_details_master_passwords'` (V4 now serves the Udyami Bharat hand-over) | DBA |
| 0:55 | `Test-ZedDeployment.ps1 -BaseUrl https://loginzed.msme.gov.in`: **0 failures** required | server team |
| 1:00 | Zed.Jobs running (`dbo.V4JobRuns`, `dbo.V4MailOutbox` drain) and Agent jobs off, if not done earlier; in the same step `Invoke-ZedDatabaseScripts.ps1 -Server … -Apply -SkipFixes -IncludeMailOutbox` (0003) | DBA |
| 1:05 | Disable the Agent job that runs SP_JOB_TO_CREATE_RENAMING_BATCH_FILES; enable `Jobs:FolderRename` in Report mode; compare its log with what the old .bat would contain, then switch it to Apply (can be done in the following days) | DBA |
| 1:05 | Functional checks (below) | testers |
| 2:30 | **Go / no-go** (2.2). Go: announce. No-go: rollback (section 3) | owner |

Functional checks (9), each by a named tester, on production with real accounts:
- MSME: sign in, dashboard, certification details, a download from My Documents, the assessment report of a
  certified unit; an old mail link (`/Msme/Login`, `/Msme/ChangePassword?code=…`) lands on the new page.
- Payment: one real low-value payment if the owner agrees (or the zero-amount path for an eligible unit); the
  receipt mail arrives; CCAvenue's reconciliation post is answered (IIS log of `/Pay/UpdatePaymentReconciliationStatus`).
- Udyami Bharat: a hand-over sign-in from the UBP portal.
- Staff: MasterAdmin, an agency, an assessor and a desktop assessor sign in and see their lists; one desktop
  assessment action on a test unit if one exists.
- Consultancy: CO and consultant sign in, the milestone page of a unit, a milestone report PDF.
- Surveillance: staff sign in, the Bronze desktop list, a surveillance certificate.
- Mobile: MSME app login, site assessor app login and allotment list, the consultant app, the surveillance app
  (device events appear in `dbo.MobileDeviceEvents`).
- Mail: the outbox empties (`SELECT COUNT(*) FROM dbo.V4MailOutbox WHERE SentAt IS NULL` on each database).
- Health: `/api/health/ready` and `/mobileapi/health/ready` stay Healthy for 30 minutes.

### 2.2 Go / no-go

Go only if all are true:
- [ ] `Test-ZedDeployment.ps1`: 0 failures.
- [ ] Every functional check passed, or the owner accepted the exception in writing.
- [ ] No host restarts in the event log; no 5xx bursts in the IIS log (`sc-status` 500–599).
- [ ] Mail is being sent; Zed.Jobs shows no errors.
- [ ] Payments: the test payment and its reconciliation went through (or the owner waived it).
- [ ] The rollback file exists and the old folders, pools and request-rule copy are in place.
- [ ] The other applications on the site still answer (`/impactmobileapi`, `/liamobileapi`): the installer leaves them alone.

## 3. Rollback

Possible at any time while `Security:Passwords` is still `Dual` and the old app pools and folders exist.

1. `app_offline.htm` into the V4 folders under `<InstallRoot>` (stops writes).
2. `Install-ZedIis.ps1 -Rollback <InstallRoot>\rollback-<time>.json -Apply`: each application points at its old
   folder and pool again. Start the old services' pools.
3. Put back the ZED-* request rules from the copy.
4. `Test-ZedDeployment.ps1` is expected to fail now; check the old login pages by hand.

What the old sites find after a rollback:
- **All data V4 wrote**: V4 writes through the same procedures into the same tables and files in the old layout.
- V4-only tables (`V4MailOutbox`, `V4JobRuns`, `V4UserPasswords`, `MobileDeviceBindings`, `MobileDeviceEvents`,
  `V4Cache`, `V4FolderRenameResults`, `V4PasswordResets`, `V4AppSessions`, `V4Settings`, `V4SubUsers`, `V4LoginEvents`, `V4MsmeEditHistory`, `V4EmailTemplates`, `V4ContentBlocks`, `V4AppFormFields`, `V4AppFormValues`) are ignored by the old code. Leave them.
- **Mail**: the converted procedures (0003) keep queuing; **keep Zed.Jobs running**. To go fully back, re-enable the
  Agent jobs, stop Zed.Jobs, and undo 0003 per procedure (its header says how), which needs Database Mail.
- **Folder renaming**: re-enable the old Agent job; it reads the same `FolderRenameHIstory` and continues.
- **Password reset links** (`V4PasswordResets`) are V4-only; links sent before the rollback stop working. The old
  MSME reset works again as before (its codes are untouched until the purge at decommission).
- **Passwords**: in `Dual` mode the plain column stays authoritative, so every account still signs in on the old
  sites. After `Migrate` the plain column holds random values, and a rollback would lock users out. That is why
  `Migrate` waits until the rollback window is closed.
- **Payments started on V4 and not finished**: their callback now reaches the old site. CCAvenue's reconciliation
  post (old `/Pay/UpdatePaymentReconciliationStatus`, unchanged contract) settles them; check the day's orders.
- `fixes/main/02` broke the old Udyami Bharat hand-over: restore the saved definition of `SP_GET_USER_DETAILS`
  (the undo of every fix script is the definition saved before APPLY).

## 4. After the cut-over

| When | Step |
|---|---|
| Day 1–3 | Watch the event log, IIS 5xx, `/api/health/ready`, `V4JobRuns` errors, the mail outbox, `MobileDeviceEvents`. Keep the testers' accounts on hand |
| Day 1 | Old SQL Agent jobs are off (JOBS.md step 4); the old mail profile is unused |
| Week 1 | Device binding: when `MobileDeviceEvents` shows every app version sending `deviceInfo`, set `Mobile:DeviceBinding = Enforce` (MOBILE-API.md). Keep `Mobile:RefuseMissingDevice = false` on every deployment: no released app sends `deviceInfo` (app source, 2026-10-22) |
| End of the rollback window (e.g. 2 weeks) | `Security:Passwords = Migrate` on all hosts (docs/PASSWORDS.md): every sign-in moves the account to its hash and randomises the plain column. **No rollback after this.** |
| A few months later | `Security:Passwords = HashOnly` once almost every active account has a hash; the rest reset their password |
| Same time | Remove the old app pools and the old code folders (keep the data folders: they are V4's storage). Revoke the old SQL login and the old mail profile |

## 5. Decommission

1. **Archive** (keep with the final backups, access restricted): the old code folders and their `web.config`
   files, the IIS configuration backup, the ZED-* rule copy, the last Agent job export, a copy-only backup of each
   database taken on the decommission day.
2. **Purge** the request and data dumps the old code left (#51, #57, #99, #113): `App_Data\Json\…` of the old
   services and portals, the captured photos and logs in the legacy repositories. Purge the typed passwords in
   `FailedLogins` (#2, LIVE-HARDENING §7). Clear the legacy MSME reset codes: `EXEC dbo.SP_V4_PURGE_LEGACY_RESET_CODES
   @Mode = 'APPLY'` on ZEDCS_V2_LIVE (#128).
3. **Unused database objects.** `Get-ZedUnusedObjects.ps1 -Server … -Database …` for each database, run on
   production a few weeks after the cut-over. It lists the procedures nothing in V4 calls (directly or through
   another procedure) and the tables nothing used names, with the last time SQL Server ran each procedure. On the
   local copy: ZEDCS_V2_LIVE 178 of 479 procedures and 66 of 175 tables, ZED_CONSULTANT 96 of 297 and 34 of 114,
   ZED_SURVEILLANCE 117 of 327 and 39 of 123. A listed procedure that still runs has an unknown caller: find it
   first. Script the rest out, keep the script with the archive, then drop them; that also removes most of the
   procedure-level findings below from the attack surface. Tables hold history: archive them, do not drop.
   (The scan treats any V4 mention, comments included, as use, so it errs on the side of keeping.)
4. **SECURITY-FINDINGS.md**: update each finding as below.

### 5.1 Findings when the old sites are gone

**Closed by decommission** (the vulnerable code or static folder no longer runs; V4 has the checked version):
9, 15, 18, 19, 20, 21, 24, 26, 30, 31, 32, 33, 34, 35, 36, 39, 40, 41, 44, 45, 50, 56, 60, 61, 62, 63, 64, 65, 67,
69, 70, 74, 75, 76, 79, 80, 85, 87, 88, 89, 90, 91, 92, 95, 97, 98, 100, 101, 102, 103, 104, 105, 106, 107, 108,
109, 112, 115, 118, 124.

**Contained, but the database object still needs its fix or removal** (only V4 calls it now, and V4 checks first;
fix with the `database/fixes` scripts or drop it in step 3): 1 and 27 (master passwords: V4 refuses them), 12, 22,
38, 48 (after the Twilio rotation), 59, 68, 72, 77, 81 (procedure part), 84, 86 (procedure), 93, 94 (₹1 list),
116, 117, 119, 120, 121, 123.

**Still open after decommission** (need their own action):
- 2 and 111: plain-text passwords. `Security:Passwords` Migrate, then HashOnly; after that the plain column and the
  surveillance copy hold only random values.
- 3, 23, 29, 54, 55, 73, 82, 96, 110: rotate the keys and passwords (LIVE-HARDENING §7). Decommission does not
  make an exposed key safe.
- 51, 57, 99, 113: purge the captured data (step 2).
- 53: token columns and per-client scopes of the partner APIs (V4 serves them).
- 78: review the incentive test accounts.

## 6. Settings added for production (summary)

| Setting | Meaning |
|---|---|
| `DataProtection:KeysPath` | Folder for the keys that protect sign-in cookies and anti-forgery tokens. Required outside Development. One folder per application; back it up. Each system uses its own application name (`zed.main`, `zed.consultancy`, `zed.surveillance`, `zed.mobile.<system>`), so a cookie of one cannot be used on another |
| `DataProtection:ProtectWithDpapi` | Default true on Windows: keys are encrypted at rest for the machine |
| `Cache:SqlServerTable` | e.g. `dbo.V4Cache` (migration 0006): shares registration sessions and payment order state between servers. Empty: in memory (one server) |
| `Jobs:FolderRename` | Zed.Jobs: renames the folders of rejected units (migration 0007, docs/JOBS.md). Report mode first |
| `StaffPasswordReset:*` | Staff forgot-password and admin reset links (migration 0008, docs/PASSWORDS.md) |
| `/api/health`, `/health` | Liveness: the process answers. No database call |
| `/api/health/ready`, `/health/ready` | Readiness: the host's database answers within 5 s. Replies only `Healthy` / `Unhealthy` (503); the reason goes to the log |

Each host's `web.config` (in the package): in-process ASP.NET Core Module V2, stdout logs off (switch on only to
diagnose a host that will not start), the `Server` and `X-Powered-By` headers removed, request size limit
150 MiB for the portals (endpoints set their own smaller limits) and 30 MiB for the mobile services (keep equal to
`Mobile:MaxRequestBytes`), and `inheritInChildApplications="false"` so the root application's handler does not
leak into `/Consultancy` and the others.

## 7. How the scripts were tested

On a development machine without IIS, against the local databases:
- `Publish-Zed.ps1 -SkipTests -SkipNpmCi` built a package; the Consultancy and Surveillance apps carry the base
  href `/Consultancy/` and `/surveillance/`; no `appsettings.Development.json` in it.
- The six hosts from that package ran on Kestrel in the Staging environment. With no settings, main refused to
  start and listed the 17 missing settings. With settings, `Test-ZedDeployment.ps1` passed 58 of 58 checks (with
  one host stopped, it failed as expected). Each host wrote its own DPAPI-protected key file.
- `Install-ZedIis.ps1` was run as a dry run only (no IIS on that machine). **Run it as a dry run on the staging
  server first, then `-Apply` there, before production.**
- `Get-ZedUnusedObjects.ps1` ran against the three local databases (numbers in section 5).
- Automated tests: the configuration check, key storage and application isolation, readiness with a failing
  database (`ProductionHostingTests`, `HealthTests`).
