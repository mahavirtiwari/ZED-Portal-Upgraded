# Scheduled jobs and procedure mail

SQL Server Express has **no SQL Agent and no Database Mail**; on Standard edition both exist, but V4 runs the
jobs and the procedure mail itself either way (Zed.Jobs, below), so they are kept in source control and work on any
edition. The old instance used both:

- 25 procedures send mail with `EXEC msdb.dbo.sp_send_dbmail @profile_name = 'ZedAdmin', ...`. Some run inside
  normal flows (agency auto-allotment after payment, NC auto-rejection, consulting organisation allotment), the
  rest are the reminder jobs. 17 are in ZEDCS_V2_LIVE, 5 in ZED_CONSULTANT, 3 in ZED_SURVEILLANCE.
- The `SP_JOB_*` / `SP_DAILY_*` procedures are run by Agent jobs (certification expiry, re-certification,
  surveillance suspension and reminders, website counts, ERP reconciliation, surveillance data).

V4 replaces both with the **Zed.Jobs** service (`backend/src/Zed.Jobs`):

| Part | What it does |
|---|---|
| `database/migrations/0003_mail_outbox.sql` (run on **all three** databases) | Adds `dbo.V4MailOutbox` and `dbo.SP_V4_SEND_DBMAIL` (same parameters as `sp_send_dbmail`, queues the mail) and changes every procedure that calls `msdb.dbo.sp_send_dbmail` to call it instead (`CREATE OR ALTER`, permissions kept; safe to re-run; it prints what it converted). |
| `database/migrations/0004_job_runs.sql` (ZEDCS_V2_LIVE) | `dbo.V4JobRuns`: one row per job run, with errors. |
| `database/migrations/0007_folder_rename.sql` (ZEDCS_V2_LIVE) | `dbo.SP_V4_FOLDER_RENAME_PENDING`, `dbo.SP_V4_FOLDER_RENAME_RECORD` and `dbo.V4FolderRenameResults`, for the folder rename job below. Additive. |
| Mail worker | Every 30 s sends queued mail through the SMTP settings of `Email:Profiles` (`Jobs:MailProfiles` maps the Database Mail profile `ZedAdmin` to the service's `Email:Profiles:ZedAdmin`, which falls back to `Default` when it is not configured), marks it sent, or records the error and retries every 10 minutes up to 5 times. Several service instances can run; rows are claimed with `READPAST`. |
| Job worker | Runs each enabled job of `Jobs:Schedules` at its times (`DailyAt` "HH:mm" in `Jobs:TimeZone`, default Asia/Kolkata, or `EveryMinutes` within an optional `WindowStart`/`WindowEnd`), on every day or only on `DaysOfWeek` / `DaysOfMonth`. A job is one `Procedure` (with optional fixed `Parameters`) or several `Steps` run in order, stopping at the first failure unless the step has `ContinueOnFailure`; a step (or a single-procedure job) can be retried `RetryAttempts` times, `RetryIntervalMinutes` apart, as Agent's step retries. At start each enabled job is checked against its databases (procedure exists, every parameter without a default is set, values fit the declared types); a job that fails the check is logged and not scheduled, a job whose database is unreachable is checked again before it runs. An application lock per job stops two instances running it at once. After a restart, a job whose time passed while the service was down runs once; a job that has never run waits for its next time. |
| Folder rename worker | `Jobs:FolderRename`: renames the folders of rejected units to their archived ZED ID, without `xp_cmdshell` (replaces `SP_JOB_TO_CREATE_RENAMING_BATCH_FILES`, see [below](#renaming-the-folders-of-rejected-units-jobsfolderrename)). Same schedule fields, lock and `dbo.V4JobRuns` history as the other jobs. |

## Before go-live

The production export of **2026-10-21** is already converted into `appsettings.json` (all entries off; see
[The production jobs](#the-production-jobs-agent-export-of-2026-10-21)). What is left at go-live: steps 4 to 6, and
the time zone and mail checks in that section. In the cut-over week, export again (step 1) and convert with
`-CompareSettings backend\src\Zed.Jobs\appsettings.json` (step 2): the report lists anything changed since.

Moving the Agent jobs is: export from the old server → convert → paste → check → enable → switch the old jobs off.

1. **Export the jobs from the old server.** In SSMS on the old server, first set (once):
   Tools > Options > Query Results > SQL Server > Results to Grid: tick **Include column headers when copying or
   saving the results** and **Quote strings containing list separators when saving .csv results**. Open a **new**
   query window (the options apply to new windows), connect to `msdb`, run query A, right-click the results >
   **Save Results As…** > `agent-schedules.csv` (type CSV). Run query B and save it as `agent-steps.csv`.

   Query A, jobs and schedules (one row per job and schedule; a job without a schedule has NULLs):
   ```sql
   SELECT j.name AS job, j.enabled AS job_enabled, s.name AS schedule, s.enabled AS schedule_enabled,
          s.freq_type, s.freq_interval, s.freq_subday_type, s.freq_subday_interval,
          s.freq_relative_interval, s.freq_recurrence_factor,
          s.active_start_date, s.active_end_date, s.active_start_time, s.active_end_time
   FROM msdb.dbo.sysjobs j
   LEFT JOIN msdb.dbo.sysjobschedules js ON js.job_id = j.job_id
   LEFT JOIN msdb.dbo.sysschedules s ON s.schedule_id = js.schedule_id
   ORDER BY j.name, s.name;
   ```
   Query B, job steps (the command is put on one line; line breaks become `{LF}`):
   ```sql
   SELECT j.name AS job, st.step_id, st.step_name, st.subsystem, st.database_name,
          st.on_success_action, st.on_success_step_id, st.on_fail_action, st.on_fail_step_id,
          REPLACE(REPLACE(REPLACE(st.command, CHAR(13) + CHAR(10), '{LF}'), CHAR(10), '{LF}'), CHAR(13), '{LF}') AS command
   FROM msdb.dbo.sysjobs j
   JOIN msdb.dbo.sysjobsteps st ON st.job_id = j.job_id
   ORDER BY j.name, st.step_id;
   ```
   The files can hold parameter values of the job steps: keep them off shared drives and delete them afterwards.
   An export made with the single joined query of the earlier version of this page converts too.

2. **Convert.** On any machine with this repository (Windows PowerShell 5.1 or later):
   ```powershell
   .\tools\jobs\Convert-AgentJobs.ps1 -Path agent-schedules.csv, agent-steps.csv -CompareSettings backend\src\Zed.Jobs\appsettings.json
   ```
   It writes `agent-schedules.json` (`{ "Jobs": { "Schedules": [ ... ] } }`) and `agent-schedules.json.report.txt`,
   and prints the report. Exit code 0 = everything converted, 2 = some jobs are listed under "Not converted".
   What it does:
   - each T-SQL step that is one `EXEC [db.][dbo.]Procedure @Name = constant, ...` becomes a call (`SET NOCOUNT ON`
     and comments are ignored); several steps become `Steps`, with Agent's "go to the next step on failure" kept as
     `ContinueOnFailure`;
   - database names map ZEDCS_V2_LIVE → Main, ZED_CONSULTANT → Consultancy, ZED_SURVEILLANCE → Surveillance (other
     names: `-DatabaseMap @{ OTHER_NAME = 'Main'; ... }`); a three-part name in the command wins over the step's database;
   - schedules: daily, weekly (days), monthly (day of month), once at a time or every N seconds/minutes/hours within
     the start/end time; several "once at" schedules of a job with the same days merge into one `DailyAt` list,
     other combinations become entries `Job (1)`, `Job (2)`;
   - each entry keeps the old server's on/off state (job and schedule). Written **disabled**, with the reason in
     `Note`: a schedule whose end date has passed, a job without a schedule, `SP_JOB_TO_CREATE_RENAMING_BATCH_FILES`
     (#12: replaced by the built-in folder rename job; copy its time into `Jobs:FolderRename`, below), and a step parameter whose name looks like a secret (password, pwd, secret, token, key: the value is
     replaced by a placeholder and never copied into the output or the report);
   - **not converted, listed in the report** (set them up by hand or ask the developers): steps that are not one
     procedure call (several statements, inline SQL, variables or expressions as arguments, positional arguments,
     OUTPUT parameters, "go to step N"), CmdExec / PowerShell / SSIS steps, schedules every N days / weeks / months,
     "first Monday" style monthly schedules, run-once, at Agent start and when idle;
   - with `-CompareSettings` it also lists the procedures the current settings schedule that no Agent job runs (the
     candidates below), and Agent jobs that run procedures not in that list.

3. **Review the report and paste.** Read every "Not converted" and "Check" line. Then replace the `Jobs:Schedules`
   array of the service's `appsettings.json` with the converted one, by hand, or with
   `-UpdateSettings C:\Services\ZedJobs\appsettings.json` (keeps `appsettings.json.bak`). Replace the whole array;
   do not put it in `appsettings.Production.json`, because .NET merges arrays from two files item by item.
   The entries the settings listed before (the analysis below) drop out unless the export has them.

4. **Check** on the server, with the production connection strings:
   ```powershell
   C:\Services\ZedJobs\Zed.Jobs.exe --check
   ```
   It prints every entry (enabled or not) with its procedures and schedule, and checks that each procedure exists,
   every parameter without a default is set, and the values fit the declared types (int, date `yyyy-MM-dd`, `{NULL}`
   for NULL, text length). Exit code 1 when an **enabled** entry has a problem (the service would skip it); problems
   of disabled entries are shown but do not count. A database it cannot reach shows as UNREACHABLE.

5. **Enable.** Set `"Enabled": true` on the entries to run (after fixing what the report and the check found), run
   `--check` again, then start (or restart) the service. Its log lists the scheduled jobs and their schedules.

6. **Turn the old jobs off** on the old server (SSMS: SQL Server Agent > Jobs > Disable) at the moment the new
   service starts, so nothing runs twice. Compare the first runs (`dbo.V4JobRuns`) with the old job history.

Also before go-live: run the migrations, then compare the printed "Procedures converted" of 0003 with the list of
mailing procedures. A procedure the script skips (no `CREATE` at the start) must be converted by hand.

### The production jobs (Agent export of 2026-10-21)

The export (`sp_add_job` script of the production instance, 16 jobs) is converted into `Jobs:Schedules`, one entry
per Agent job with the same name, steps in the same order, the same "quit on failure" and the same retries. All
entries are **off** in the repository: enable each on the server copy at the moment its Agent job is switched off.
`Zed.Jobs --check` against the local copies: all 14 converted jobs OK.

| Agent job (entry) | Time | Steps (database.procedure) |
|---|---|---|
| AutoMail_Recertification | 23:20 | Main.SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_RECERTIFICATION |
| AutoReject | 00:00 | Main.SP_ASSESSMENT_DA_AUTO_REJECT (2 retries, 30 min) > Surveillance.SP_ASSESSMENT_DA_AUTO_REJECT |
| AutoSuspendingSilverGold | 01:30 | Main.SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_SUSPENSION > Main.SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_WITHDRAW |
| Bronze_Surveillance_Job | 02:00 | Surveillance.SP_JOB_FOR_INSERT_BRONZE_SURVEILLANCE_DATA > Main.SP_JOB_TO_SEND_APPLY_FOR_BRONZE_SURVEILLANCE_MAIL > \_REM1 > \_REM2 |
| Certificate_Expiry | 02:15 | Main.SP_JOB_TO_UPDATE_3YEARS_COMPLETED_TO_EXPIRED |
| DailyRunWebSiteCounts | every 15 min, 06:00–22:00 | Main.SP_DAILY_RUN_WEB_SITE_COUNTS |
| Deactivating Joining Reward | 00:00 | Main.SP_MSME_DEACTIVATE_JOINING_REWARD (2 retries, 30 min) |
| LatestCertificationUpdate | 23:00 | Main.SP_JOB_FOR_UPDATE_LATEST_CERTIFICATION |
| Silver_Gold_Second_Surveillance_Data_job | 03:30 | Main.SP_JOB_TO_SEND_APPLY_FOR_SECOND_SURVEILLANCE_MAIL > \_REM1 > \_REM2 |
| Silver_Gold_Surveillance_Data_job | 00:30 | Surveillance.SP_JOB_FOR_INSERT_SURVEILLANCE_DATA > Main.SP_JOB_TO_SEND_APPLY_FOR_SURVEILLANCE_MAIL > \_REM1 > \_REM2 |
| ZED_Auto_Reject_Expired_NC | 02:30 | Main.SP_AUTO_FINAL_REJECT_EXPIRED_NC |
| ZED_Daily_Maintenance_Job | every 12 h from 04:00 (04:00, 16:00) | Surveillance.SURVEILLANCE_REJECTION_UPGRADED_MAINSYSTEM > Surveillance.USP_REFRESH_ADMIN_DASHBOARD_STATS |
| ZED_Surveillance_Auto_Reject_Expiring_Bronze | 03:30 | Surveillance.SP_AUTO_REJECT_BRONZE_SURVEILLANCE_BEFORE_EXPIRY |
| RenamingFolder (**disabled** on production, hourly) | → `Jobs:FolderRename`, every 60 min | SP_JOB_TO_CREATE_RENAMING_BATCH_FILES is replaced by the folder rename job (below). Because the Agent job is off, nothing has been renamed for a while: the first Report runs show the backlog. |

New compared with the earlier analysis: AutoReject, Deactivating Joining Reward and ZED_Daily_Maintenance_Job (none
of their procedures sends mail or needs `xp_cmdshell`). Confirmed: SP_AUTO_FINAL_REJECT_EXPIRED_NC (main) and
SP_AUTO_REJECT_BRONZE_SURVEILLANCE_BEFORE_EXPIRY.

**Kept in the list but not scheduled on production** (no Agent job runs them; their `Note` says so; leave them off
unless someone knows they are run another way): SP_JOB_ENABLE_FOR_RE_CERTIFICATION (the recertification mail job's
description says it also "enables the recertification button"), SP_JOB_FOR_SUSPENDING_ZEDIDS_IN_SURVEILLANCE,
Sp_Daily_ERP_Auto_Reconciliation, SP_SEND_MAIL_STATUS_COUNTS_AGENCY, the surveillance copy of
SP_AUTO_FINAL_REJECT_EXPIRED_NC, and the two Bronze "from backend by state" procedures (need `@StateName`).

**Not ZED jobs, not converted:**
- `UpdateBatchDates` (enabled, daily 00:00) runs inline SQL in ZED_CENTER_AUDIT_PROFESSIONAL: it moves the start and
  end date of training batch `ZEDTP10003` one day forward every day, i.e. keeps that batch open indefinitely. It
  belongs to the Professional application: recreate it in the new server's SQL Agent when that database moves
  (Standard edition), or retire it.
- `Test Job - Migration Check` (a PRINT in master, run-once, schedule off): leave it behind.

**Time zone.** The old instance runs in IST (confirmed), the default of `Jobs:TimeZone` (Asia/Kolkata), so the times
above are the times the jobs run today. One mismatch stays as production has it: `ZED_Daily_Maintenance_Job`'s
schedule is named "TwiceDaily_8AM_8PM" but runs at 04:00 and 16:00 IST. If 08:00 and 20:00 were meant, change its
`WindowStart` to "08:00" when enabling it.

**Mail (Database Mail on the old instance).** Profiles: `ZedAdmin` (account QCI_ZED_Notifications, "ZED Administrator"
<zedadmin@zed.org.in>, smtp-mail.outlook.com:587, TLS), `ZedEmailOTPs` (support.zed@qcin.org) and
`ZED_Report_Profile` (account GeoStat_Outlook, "ZED Daily Reporting" <ks@geostat.in>, smtp.office365.com:587). An
unused account `OutlookMail` (zed.admin@qcin.org) exists too.
- All 25 mailing procedures of the three ZED databases use `ZedAdmin`; none attaches files. `appsettings.json` maps
  `ZedAdmin` to `Email:Profiles:ZedAdmin` with the same sender and server; set its password as
  `Email__Profiles__ZedAdmin__Password` (service environment or user secrets).
- `ZedEmailOTPs` is used by two procedures of **ZED_CENTER_AUDIT_PROFESSIONAL** (the Professional application), not by
  ZED. The new server is Standard edition: set the profile up in its Database Mail when that database moves.
- `ZED_Report_Profile` is used by no procedure in any of the six schema exports, so something outside them sends
  through it (a report tool, a manual script). It sent through a **vendor's mailbox** (SECURITY-FINDINGS #130) and moves
  to **dev.zed@qcin.org**: `database/fixes/msdb/01_report_profile_qci_mailbox.sql` (PREVIEW by default; APPLY with the
  mailbox password typed in the SSMS window; `@DeleteVendorAccount = 1` also removes the vendor account and its stored
  password; `@SendTestTo` sends a test mail). Whatever sends through the profile then sends as dev.zed@qcin.org.
- The old accounts sign in to Microsoft 365 SMTP with a user name and password. Microsoft has announced the end of
  basic authentication for SMTP AUTH in Exchange Online: if the old Database Mail still delivers, the tenant still
  allows it, but plan for an SMTP relay or a tenant exception before relying on it for V4 (MailKit supports both).

## Renaming the folders of rejected units (Jobs:FolderRename)

**What the old job did.** When a unit is rejected, its rows are archived under a new ZED ID (`ZEDMSME000123_D_45`;
the old auto-reject used `ZEDMSME000123_D`) and the unit can apply again under its own ZED ID.
`SP_JOB_TO_CREATE_RENAMING_BATCH_FILES` collected the rejections (MsmeHistory `StatusType LIKE '%unit rejected%'`,
Bronze, older than 2 hours, Id above the largest Id already done) into `dbo.FolderRenameHIstory`, used `xp_cmdshell`
and `bcp` to write a `.bat` of `REN` lines into a folder on the database server, and marked the rows done
(`RenameDone = 'Yes'`). Running the `.bat` was commented out: someone ran it by hand. It renamed two whole folders:
`PDFs\SA\{ZedId}` of the portal site and `Photos\{ZedId}` of the services site.

**The folders of a Bronze unit** (checked against the old site, the old services and V4):

| Folder | Holds | V4 setting | Renamed |
|---|---|---|---|
| `PDFs\SA\{ZedId}` (portal site) | payment receipts `{Level}_Milestone{n}_Payment_Receipt.pdf`, the report `{Level}_Report.pdf`; V4 writes the receipts here too | `Portal:StorageRoot` | yes (old job, default root "SA PDFs") |
| `Photos\{ZedId}\{Level}\…` (services site) | MSME app uploads: `Selfie`, `SiteExteriorPhotos`, `BasicInfo`, `Evidences` | `Mobile:StorageRoot` (main), = `Portal:AssessmentStorageRoot\mobileapi` | yes (old job, default root "App photos") |
| `Uploads\DA\{ZedId}\{Level}\…` (portal site) | the desktop assessor's evidence screenshots | `Portal:StorageRoot` | no. Optional third root, `PerLevel: true` |
| `CertifiedPhotos\{ZedId}` (services) | app uploads moved there at certification | | no (a rejected unit was not certified) |
| `Certificates\{ZedId}\Pledge.pdf`, `Certificates\DA\…` | the unit's pledge (not per application), certificates | | **never** |
| `SaPhotos`, `Attendance` (services) | site assessment (Silver and Gold) | | no (the old job was Bronze only) |

Why it matters for V4: the desktop review and the MSME's evidence files look for a rejected record's files under the
archived ZED ID first and then in the unit's own folder (`DaFiles.StorageCandidates`). So V4 shows a rejected record's
files before the rename too. But once the unit applies again, a folder that was not renamed holds both applications:
each record shows the other's files, and files with the same name (the receipt of a level, a photo id) are
overwritten. The rename has to happen before the new application writes files, which is what the race check below
is for. Surveillance (`_S_` archives) and consultancy were never renamed by the old job and are not covered.

**The new job.** Built into Zed.Jobs (`FolderRename.cs`), no `xp_cmdshell`, no batch file:

- It reads and writes the same `dbo.FolderRenameHIstory`, so it carries on where the old job stopped, and the old
  procedure still works if you switch back. `RenameDone = 'Yes'` still means done. What the job found is kept in
  `dbo.V4FolderRenameResults` (one row per row and run).
- **Report** mode (the default) collects nothing, moves nothing and marks nothing; it logs per unit and folder what
  Apply would do ("would move ZEDMSME000123 -> ZEDMSME000123_D_45"). **Apply** first adds the new rejections to the
  table (exactly as the old job selected them), then handles every waiting row:

| Case | What happens | Row |
|---|---|---|
| Unit folder exists, archived folder does not | moved (`Directory.Move`, same volume) | done |
| No unit folder | nothing to move | done |
| Archived folder already there, no unit folder | moved earlier (or by hand) | done |
| ZED ID without `_D` (the old job wrote a no-op `REN`) | nothing to rename | done |
| **Both** the unit folder and the archived folder exist | **Conflict**: not merged, nothing moved | waiting |
| The unit folder has files written after the rejection (+ `GraceMinutes`, default 10, for a report the rejection itself wrote) | **NewerFiles**: the unit has applied again; nothing moved. The detail also names the unit's ZED ID's new certification rows | waiting |
| ZED ID or level that is not `^[A-Za-z]{2,12}[0-9]{1,12}(_D(_n)?)?$` / a level name, or a path that would leave the folder | **InvalidId**: not touched | waiting |
| Disk error (a file in use, no permission) | **Error**: the run is marked failed in `dbo.V4JobRuns`; folders already moved are found as "already there" next time | waiting, retried each run |

  A unit is moved only when every folder of every root can be moved, so a conflict in one root leaves the other roots
  untouched. Several history rows of one rejection are handled once and all marked.
- `PerLevel: true` on a root moves only `{root}\{ZedId}\{Level}` to `{root}\{ArchivedId}\{Level}` (and removes the
  unit's folder if that leaves it empty), so the files of the unit's other levels stay. The old job moved whole folders
  (`PerLevel: false`, the default of both roots in `appsettings.json`).
- Settings (`Jobs:FolderRename`): `Enabled`, `Mode` (`Report`/`Apply`), the schedule fields of `Jobs:Schedules`
  (`DailyAt`, `EveryMinutes`, ...), `DelayHours` (2), `CertificationTypes` (`["Bronze"]`), `GraceMinutes` (10),
  `Roots` (`Name`, absolute `Path`, `PerLevel`), `StartAfterId` (only used while the table has no `'Yes'` row: the
  old job collected nothing at all then).
- `Zed.Jobs --check` checks it too: settings, every root exists and the service account can write in it (a temporary
  file is created and deleted), and the two 0007 procedures exist.

**Switching from the old job:**
1. Run `database/migrations/0007_folder_rename.sql` on ZEDCS_V2_LIVE; give the Zed.Jobs login `EXECUTE` on the two
   procedures. The service account needs modify rights on the root folders.
2. Set `Roots` to the server's real folders (the old procedure's `REN` lines name them: the old site's `PDFs\SA` and the
   services site's `Photos`), the time of the old Agent job (the Agent export; the converter writes it disabled with a
   note), `"Mode": "Report"`, `"Enabled": true`. Run `Zed.Jobs --check`.
3. **Disable the old Agent job** at the moment the service starts. Never run both: the old job marks every waiting
   row done, including the ones V4 left waiting on purpose.
4. Compare the first Report runs with what the old job would have renamed: the log lines "would move ..." against
   `EXEC dbo.SP_V4_FOLDER_RENAME_PENDING;` (Report mode, writes nothing) and the last `.bat` / `FolderRename_*.txt`
   the old job wrote.
5. Set `"Mode": "Apply"` and restart the service.

**Watching and fixing:**
```sql
SELECT TOP 50 * FROM dbo.V4FolderRenameResults ORDER BY Id DESC;
SELECT * FROM dbo.FolderRenameHIstory WHERE RenameDone IS NULL;                 -- waiting rows
-- After separating a Conflict / NewerFiles case by hand:
EXEC dbo.SP_V4_FOLDER_RENAME_RECORD @Id = 0, @ZedId = 'ZEDMSME000000_D_0', @Outcome = 'Manual', @Done = 1, @Detail = N'moved by hand';
```
Going back: disable the job, re-enable the Agent job; it reads the same table (its `.bat` then also lists the rows
V4 left waiting).

## Running it

- Settings: `ConnectionStrings:Main/Consultancy/Surveillance`, `Email:*` (as for the portal), `Jobs:*`. Secrets
  in user secrets or environment variables.
- Locally: `dotnet run --project backend/src/Zed.Jobs` (Development writes mail to `App_Data/mail-pickup`);
  `dotnet run --project backend/src/Zed.Jobs -- --check` checks the schedules against the local databases.
- Server: `dotnet publish backend/src/Zed.Jobs -c Release -o C:\Services\ZedJobs`, then
  `sc.exe create ZedJobs binPath= "C:\Services\ZedJobs\Zed.Jobs.exe" start= delayed-auto` and set the service
  account to one that can reach SQL Server.
- Watching it:
  ```sql
  SELECT TOP 50 * FROM dbo.V4JobRuns ORDER BY Id DESC;                              -- ZEDCS_V2_LIVE
  SELECT COUNT(*) pending FROM dbo.V4MailOutbox WHERE SentAt IS NULL;               -- each database
  SELECT TOP 20 Id, Subject, Attempts, LastError FROM dbo.V4MailOutbox WHERE SentAt IS NULL AND LastError IS NOT NULL ORDER BY Id DESC;
  ```
