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
| Job worker | Runs each enabled job of `Jobs:Schedules` at its times (`DailyAt` "HH:mm" in `Jobs:TimeZone`, default Asia/Kolkata, or `EveryMinutes`). An application lock per job stops two instances running it at once. After a restart, a job whose time passed while the service was down runs once; a job that has never run waits for its next time. |

## Before go-live

1. **Export the Agent job schedules from the old server** (run there, in SSMS):
   ```sql
   SELECT j.name AS job, j.enabled, st.step_id, st.database_name, st.command,
          s.freq_type, s.freq_interval, s.freq_subday_type, s.freq_subday_interval,
          s.active_start_time, s.active_end_time
   FROM msdb.dbo.sysjobs j
   JOIN msdb.dbo.sysjobsteps st ON st.job_id = j.job_id
   LEFT JOIN msdb.dbo.sysjobschedules js ON js.job_id = j.job_id
   LEFT JOIN msdb.dbo.sysschedules s ON s.schedule_id = js.schedule_id
   ORDER BY j.name, st.step_id;
   ```
   `freq_type` 4 = daily, 8 = weekly, 16 = monthly; `freq_subday_type` 1 = once at `active_start_time`
   (HHMMSS), 4 = every `freq_subday_interval` minutes, 8 = every N hours. Copy each job into
   `Jobs:Schedules` (`DailyAt` or `EveryMinutes`) and set `Enabled: true`. Jobs with steps that are not a
   single procedure call, or weekly/monthly schedules, need a decision: tell the developers.
2. **Check the list against the export.** `appsettings.json` lists the job procedures found in the databases,
   all disabled. Left out on purpose: the `_backup`, `_old`, `_manually`, `_checking`, `_optimized`,
   `_manualmoving` copies, `SP_JOB_FOR_UPDATE_LASTEST_CERTIFICATION` (misspelt older copy of
   `..._LATEST_...`), and `SP_JOB_TO_CREATE_RENAMING_BATCH_FILES` (uses `xp_cmdshell`, SECURITY-FINDINGS #12).
   `SP_SEND_MAIL_STATUS_COUNTS_AGENCY` is listed as a job but may be called by the application instead.
   **Added after the phase 7/8 analysis** (all disabled; each carries a `Note` that the service ignores):
   | Entry | Database | Why it is listed | Before enabling |
   |---|---|---|---|
   | `SP_AUTO_FINAL_REJECT_EXPIRED_NC` | Main and Surveillance | No parameters, called by no other procedure, works on a date window (rejects NCs left open for more than 15 days on main, 40 days on surveillance). Almost certainly an Agent job. | Find it in the Agent export. |
   | `SP_AUTO_REJECT_BRONZE_SURVEILLANCE_BEFORE_EXPIRY` | Surveillance | Same signs: rejects Bronze surveillance cases whose main certificate expires within 4–7 days or has already expired. | Find it in the Agent export. |
   | `SP_APPLY_BRONZE_SURVEILLANCE_FROM_BACKEND_BY_STATE_DISTRICT`, `SP_BACKEND_APPLY_BRONZE_SURVEILLANCE_BY_STATE_PRIORITY` | Surveillance | SURVEILLANCE-ANALYSIS 1.3 counts the `SP_APPLY_BRONZE_SURVEILLANCE_FROM_BACKEND*` family as the way Bronze units arrive. | **Do not enable.** Both need `@StateName` (no default) and the job runner passes no parameters, so every run would fail. Their code (`TOP 2000` units per call, a hard-coded example state, the note "first disable auto allocation in zero payment details", a `Temp_Reset_Queue` table) suggests an operator runs them by hand, state by state. If the Agent export shows them as jobs (`EXEC ... 'STATE'` steps), `JobDefinition` needs a `Parameters` map first (Zed.Jobs code change). |

   Not listed, on purpose: `SP_APPLY_BRONZE_SURVEILLANCE_FROM_BACKEND` (one unit per call, `@ZedId`/`@Certification`; without them it would call the zero-payment procedure with NULLs). The `_old` and `_manualmoving` copies are left out too.
   **Consultancy (ZED_CONSULTANT):** it has no `SP_JOB_*` or `SP_DAILY_*` procedures and no parameterless batch procedures. The candidates are not jobs:
   - `SP_MOVING_CERTIFIED_MSME_TO_CONSULTANCY` lives in ZEDCS_V2_LIVE. `SP_MONITORING_DA_FINAL_SUBMIT` and `SP_MONITORING_RA_FINAL_SUBMIT` call it with `@ZedId, @CertificationType` when a unit is certified, so it runs inside the certification flow.
   - `SP_MOVING_MILESTONE_1_TO_PAYMENT_COMPLETION_STAGE` resets one unit's milestone 1 (`@ZedId`, `@Certification`, `@NcCount`), an admin action.
   - `SP_SEND_MAIL_AUTO_ALLOT_CONSULTING_ORGANISATION_TU` is called per unit with `@ZedId, @Agency`.

   Check the export for consultancy jobs anyway.
3. Run the migrations, then compare the printed "Procedures converted" with the list above. A procedure the
   script skips (no `CREATE` at the start) must be converted by hand.
4. **Turn the old jobs off** on the old server at the moment the new service starts, so nothing runs twice.

## Running it

- Settings: `ConnectionStrings:Main/Consultancy/Surveillance`, `Email:*` (as for the portal), `Jobs:*`. Secrets
  in user secrets or environment variables.
- Locally: `dotnet run --project backend/src/Zed.Jobs` (Development writes mail to `App_Data/mail-pickup`).
- Server: `dotnet publish backend/src/Zed.Jobs -c Release -o C:\Services\ZedJobs`, then
  `sc.exe create ZedJobs binPath= "C:\Services\ZedJobs\Zed.Jobs.exe" start= delayed-auto` and set the service
  account to one that can reach SQL Server.
- Watching it:
  ```sql
  SELECT TOP 50 * FROM dbo.V4JobRuns ORDER BY Id DESC;                              -- ZEDCS_V2_LIVE
  SELECT COUNT(*) pending FROM dbo.V4MailOutbox WHERE SentAt IS NULL;               -- each database
  SELECT TOP 20 Id, Subject, Attempts, LastError FROM dbo.V4MailOutbox WHERE SentAt IS NULL AND LastError IS NOT NULL ORDER BY Id DESC;
  ```
