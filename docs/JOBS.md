# Scheduled jobs and procedure mail (SQL Server Express)

SQL Server Express has **no SQL Agent and no Database Mail**. The old servers used both:

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
| Mail worker | Every 30 s sends queued mail through the portal's SMTP settings (`Email:Profiles`, profile `ZedAdmin` → `Default`), marks it sent, or records the error and retries every 10 minutes up to 5 times. Several service instances can run; rows are claimed with `READPAST`. |
| Job worker | Runs each enabled job of `Jobs:Schedules` at its times (`DailyAt` "HH:mm" in `Jobs:TimeZone`, default Asia/Kolkata, or `EveryMinutes` within an optional `WindowStart`/`WindowEnd`), on every day or only on `DaysOfWeek` / `DaysOfMonth`. A job is one `Procedure` (with optional fixed `Parameters`) or several `Steps` run in order, stopping at the first failure unless the step has `ContinueOnFailure`. At start each enabled job is checked against its databases (procedure exists, every parameter without a default is set, values fit the declared types); a job that fails the check is logged and not scheduled, a job whose database is unreachable is checked again before it runs. An application lock per job stops two instances running it at once. After a restart, a job whose time passed while the service was down runs once; a job that has never run waits for its next time. |

## Before go-live

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
     (#12), and a step parameter whose name looks like a secret (password, pwd, secret, token, key: the value is
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

### What the settings list until the export arrives (the analysis)

`appsettings.json` lists the job procedures found in the databases, all disabled. Left out on purpose: the
`_backup`, `_old`, `_manually`, `_checking`, `_optimized`, `_manualmoving` copies, `SP_JOB_FOR_UPDATE_LASTEST_CERTIFICATION`
(misspelt older copy of `..._LATEST_...`), and `SP_JOB_TO_CREATE_RENAMING_BATCH_FILES` (uses `xp_cmdshell`,
SECURITY-FINDINGS #12). `SP_SEND_MAIL_STATUS_COUNTS_AGENCY` is listed as a job but may be called by the application
instead. If the export shows that an Agent job runs one of the left-out copies, that copy is what production runs:
keep the converted entry and tell the developers.

**Added after the phase 7/8 analysis** (all disabled; each carries a `Note` for the people editing the settings):

| Entry | Database | Why it is listed | Before enabling |
|---|---|---|---|
| `SP_AUTO_FINAL_REJECT_EXPIRED_NC` | Main and Surveillance | No parameters, called by no other procedure, works on a date window (rejects NCs left open for more than 15 days on main, 40 days on surveillance). Almost certainly an Agent job. | Find it in the Agent export. |
| `SP_AUTO_REJECT_BRONZE_SURVEILLANCE_BEFORE_EXPIRY` | Surveillance | Same signs: rejects Bronze surveillance cases whose main certificate expires within 4–7 days or has already expired. | Find it in the Agent export. |
| `SP_APPLY_BRONZE_SURVEILLANCE_FROM_BACKEND_BY_STATE_DISTRICT`, `SP_BACKEND_APPLY_BRONZE_SURVEILLANCE_BY_STATE_PRIORITY` | Surveillance | SURVEILLANCE-ANALYSIS 1.3 counts the `SP_APPLY_BRONZE_SURVEILLANCE_FROM_BACKEND*` family as the way Bronze units arrive. | **Do not enable.** Both need `@StateName` (no default): as listed, `--check` reports them and the service would not schedule them. Their code (`TOP 2000` units per call, a hard-coded example state, the note "first disable auto allocation in zero payment details", a `Temp_Reset_Queue` table) suggests an operator runs them by hand, state by state. If the Agent export shows them as jobs (`EXEC ... @StateName = 'STATE'` steps), the converter writes the state into `Parameters`, one entry per Agent job. |

Not listed, on purpose: `SP_APPLY_BRONZE_SURVEILLANCE_FROM_BACKEND` (one unit per call, `@ZedId`/`@Certification`; without them it would call the zero-payment procedure with NULLs). The `_old` and `_manualmoving` copies are left out too.

**Consultancy (ZED_CONSULTANT):** it has no `SP_JOB_*` or `SP_DAILY_*` procedures and no parameterless batch procedures. The candidates are not jobs:
- `SP_MOVING_CERTIFIED_MSME_TO_CONSULTANCY` lives in ZEDCS_V2_LIVE. `SP_MONITORING_DA_FINAL_SUBMIT` and `SP_MONITORING_RA_FINAL_SUBMIT` call it with `@ZedId, @CertificationType` when a unit is certified, so it runs inside the certification flow.
- `SP_MOVING_MILESTONE_1_TO_PAYMENT_COMPLETION_STAGE` resets one unit's milestone 1 (`@ZedId`, `@Certification`, `@NcCount`), an admin action.
- `SP_SEND_MAIL_AUTO_ALLOT_CONSULTING_ORGANISATION_TU` is called per unit with `@ZedId, @Agency`.

Check the export for consultancy jobs anyway.

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
