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
