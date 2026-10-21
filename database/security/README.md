# Database logins and roles for V4

Production today uses one over-privileged SQL login for every application (SECURITY-FINDINGS #110). On the new
SQL Server 2022 Standard server, V4 uses its own least-privilege logins:

| Script | What |
|---|---|
| `01_v4_logins_and_roles.sql` | Roles in each database, one login per process family, their users and memberships. PREVIEW by default; APPLY all or nothing; a second run says "Nothing to change". |
| `02_orphaned_users.sql` | After restoring the managed instance's backups: lists the users of the 8 related databases that have no login on the new server; APPLY maps (`ALTER USER … WITH LOGIN`) or drops only the users you list. |

Run order on the new server: restore the databases → `02` (PREVIEW: see what came along) → create the other
applications' logins → `01` → `02` again with `@Map`/`@Drop` filled in → point the V4 connection strings at the new
logins.

## Logins

| Login (default name) | Used by | Databases and role |
|---|---|---|
| `zed_v4_main` | Main portal API | `zed_v4_app` in the three ZED databases, `zed_v4_crossdb` in the four referenced ones |
| `zed_v4_consultancy` | Consultancy portal API | same |
| `zed_v4_surveillance` | Surveillance portal API | same |
| `zed_v4_mobile` | the three mobile deployments (`Mobile:System`) | same |
| `zed_v4_jobs` | Zed.Jobs | `zed_v4_jobs` in the ZED databases, `zed_v4_crossdb` in the referenced ones |
| `zed_v4_readonly` | main's `ConnectionStrings:Consultancy/Surveillance`; the Consultancy/Surveillance hosts' `ConnectionStrings:Main` | `zed_v4_readonly` in the ZED databases |

SQL logins (`@AuthMode = 'SQL'`, CHECK_POLICY ON; type the passwords in the SSMS window, never in the file) or
Windows logins (`'WINDOWS'`: a gMSA such as `DOMAIN\ZedV4Main$`, or `IIS APPPOOL\ZedV4-Main` when SQL Server runs on
the IIS machine). With Windows logins the connection strings use `Integrated Security=true` and no password exists.

## Roles and why

- **`zed_v4_app`** = `db_datareader` + `db_datawriter` + `EXECUTE` on schema `dbo`.
  - V4 calls about 650 procedures (310 names across the three databases). Ownership chaining lets a procedure read
    and write its own database's tables with EXECUTE alone, but not:
    - **cross-database access:** the ZED procedures read and write each other's databases by three-part name
      (e.g. main writes ZED_CONSULTANT.dbo.Msme, FinancialAssistance, PaymentGateWayTransactions …), and
      cross-database ownership chaining is off (it should stay off);
    - **dynamic SQL:** a few procedures (`SP_SEND_MAIL_STATUS_COUNTS_AGENCY` and two others);
    - **V4's own inline SQL:** about 60 statements on about 25 tables (`Users`, `OTP`, `MsmeHistory`, the
      device-binding and outbox tables, the remote-assessment photo tables …), some with table names chosen at run
      time (the payment order tables).
  - A table-by-table list would break with every procedure change; the two fixed roles give data access only:
    no schema changes, no permission changes, no server rights.
- **`zed_v4_jobs`** = `zed_v4_app` + `VIEW DEFINITION` on schema `dbo` (`Zed.Jobs --check` and the startup check read
  procedure definitions to find parameter defaults) + `ALTER` on `dbo.WebSiteCounts` only
  (`SP_DAILY_RUN_WEB_SITE_COUNTS` truncates it; TRUNCATE needs ALTER even inside a procedure). `sp_getapplock` needs
  nothing more.
- **`zed_v4_readonly`** = `db_datareader` + `EXECUTE` on the 7 procedures the read-only connections call:
  ZEDCS_V2_LIVE `SP_ASSESSMENT_DA_DETAILS`, `SP_ASSESSMENT_SA_DETAILS`, `SP_V4_GET_PASSWORD`; ZED_CONSULTANT
  `SP_REPORT_GET_DETAILS`; ZED_SURVEILLANCE `SP_REPORT_GET_DETAILS`, `SP_DA_GET_CERTIFICATE_DETAILS`,
  `SP_RA_GET_CERTIFICATE_DETAILS`. If a new read-only path calls another procedure, add it to `@ReadOnlyProcs`.
  Note: a granted procedure can still write through ownership chaining; the application refuses writes on these
  connections (`ReadOnlySqlExecutor`), the database refuses direct writes.
- **`zed_v4_crossdb`** (other applications' databases) = `SELECT` on exactly the tables ZED procedures read there,
  and `UPDATE` on `ZED_IMPACT_ASSESSMENT.dbo.Msme` (`SP_MSME_UPDATE_UDYAM_DETAILS`). Found by scanning every ZED
  procedure for three-part names (comments ignored): PROFESSIONAL Candidates, Registrations, SelfiePhotos, Users;
  V2 Batches, Candidates, JobRoles, Registrations; KAWACH AgencyUserStates, Msme, MsmeBasicInformation,
  MsmeCertifications, MsmePaymentInfo, PaymentGateWayTransactions, UserAreaOfKnowledge, UserNicSectors, Users,
  WebinarRegistrations.

Never needed by V4: `db_owner`, `db_ddladmin`, server roles, `xp_cmdshell` (its only user, the folder rename job,
is replaced by Zed.Jobs), `TRUSTWORTHY` or cross-database ownership chaining.

## How it was tested (local SQLEXPRESS, 2026-10-22)

`01` APPLY with test logins, then a second run: "Nothing to change". Under `EXECUTE AS LOGIN` (the same permission
checks as a real connection, across databases), each call in its own rolled-back transaction:
- `zed_v4_app`: every procedure V4 names, called in each of the three ZED databases with NULL parameters and empty
  table-valued parameters (653 calls): **no permission error** (the 45 other errors are NULL-parameter and
  local-schema errors, e.g. the KAWACH stand-in lacks most tables). Plus the cross-database paths
  (`SP_MSME_VALIDATE_UDYAM_DETAILS`, `SP_INSERT_USER`, `SP_MSME_UPDATE_UDYAM_DETAILS`, `SP_GET_USERS_BY_ROLE`,
  `SP_MASTER_GET_SECTORS`, the ZED-monitoring report, `SP_MSME_GET_MY_DOCUMENTS`) and V4's inline statements.
  DDL is refused.
- `zed_v4_jobs`: every job procedure of `Jobs:Schedules` in each ZED database: no permission error; procedure
  definitions and parameters are visible; `sp_getapplock`, the outbox and `V4JobRuns` work.
- `zed_v4_readonly`: its 7 procedures run; every other procedure and every direct write is refused.
- `02`: an orphaned user was mapped (its role kept) and another dropped; a re-run says "Nothing to change".

Not tested here: a V4 process actually connecting with these logins (the local instance accepts Windows
authentication only), and Windows/gMSA logins. Do both on staging (CUTOVER.md 1.5) before the cut-over.
