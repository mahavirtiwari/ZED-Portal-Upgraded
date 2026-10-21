# Legacy ZED databases: local schema setup

This folder rebuilds the three legacy databases (schema only, no data) on a local SQL Server
so the .NET 10 / Angular rewrite can run against the existing stored procedures.

| Database           | Source script (original, untouched)                          | Cleaned copy                       |
|--------------------|--------------------------------------------------------------|------------------------------------|
| `ZEDCS_V2_LIVE`    | `ZEDCS main\zed context.sql`                                  | `schema\01_ZEDCS_V2_LIVE.sql`      |
| `ZED_CONSULTANT`   | `ZEDCS_CONSULTANCY\consultancy context.sql`                   | `schema\02_ZED_CONSULTANT.sql`     |
| `ZED_SURVEILLANCE` | `ZEDCS_SURVEILLANCE\surveillance context.sql`                 | `schema\03_ZED_SURVEILLANCE.sql`   |
| (all three)        | none, added locally                                          | `schema\04_missing_sequences.sql`  |

The procedures use three-part names to reach each other's databases (for example
`ZED_CONSULTANT.dbo.MsmeCertifications` and `ZEDCS_V2_LIVE.dbo.Msme`). All three databases must
therefore be on the same instance, with exactly these names.

## Files

| File | Purpose |
|------|---------|
| `setup.ps1` | Builds everything again from the cleaned scripts (see below). |
| `verify_references.sql` | Read-only checks to run in each database: object counts, references to missing objects or databases, and modules that fail to bind. |
| `schema\0[1-3]_*.sql` | UTF-8 copies of the SSMS "Generate Scripts" output, with the minimal cleanups listed below. |
| `schema\04_missing_sequences.sql` | The SEQUENCE objects the export left out, as defined on production (see Findings, section 3). |
| `schema\05_ZED_IMPACT_ASSESSMENT.sql`, `06_ZED_CENTER_AUDIT_PROFESSIONAL.sql`, `07_ZED_CENTER_AUDIT_V2.sql` | Schema exports (2026-10-21) of the other applications' databases that ZED procedures read with three-part names, cleaned the same way and redacted (see "Referenced databases"). KAWACH has no export yet: `seed\dev-registration-data.sql` creates stand-ins for the tables ZED reads. |
| `logs\` | Output from the last run: `setup-*.log`, `failed-batches-*.json`, `warnings-*.txt`, and `verify-<db>.txt`. |

## How to run

Requirements: Windows PowerShell 5.1 or later, Windows authentication to the instance, and
permission to create databases. No modules are needed, because the script uses
`System.Data.SqlClient`.

```powershell
cd "D:\ZED Portal Code\ZEDCS_V4\database"

# dry run: parse the scripts, test the connection, report which target databases exist
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -ValidateOnly

# fresh instance
powershell -ExecutionPolicy Bypass -File .\setup.ps1                       # default: localhost\SQLEXPRESS
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -Server "HOST\INST"

# rebuild: drops and recreates ONLY ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -Force

# afterwards: verify (read-only)
sqlcmd -S "localhost\SQLEXPRESS" -E -C -d ZEDCS_V2_LIVE -i verify_references.sql -W -s "|" -f 65001
```

Other switches: `-SkipSequenceStubs`, `-Collation` (default `SQL_Latin1_General_CP1_CI_AS`),
`-MaxPasses` (default 10), `-CommandTimeout`.

What `setup.ps1` does:

1. It parses the three scripts into `GO`-separated batches and tracks the `SET ANSI_NULLS` and
   `SET QUOTED_IDENTIFIER` state for each object. Every object in the export uses ON/ON. The
   `USE` batch is dropped, because every batch runs on a connection to its own database.
2. It refuses to run if any of the three databases already exists, unless `-Force` is given.
   It never touches any other database, and it creates no logins.
3. It creates the databases with `CREATE DATABASE [x] COLLATE SQL_Latin1_General_CP1_CI_AS`,
   using the instance's default file paths, then sets `COMPATIBILITY_LEVEL = 160` and
   `RECOVERY SIMPLE`.
4. It applies `04_missing_sequences.sql`.
5. Pass 1 applies every batch of all three scripts in order. Each later pass retries only the
   batches that failed, and the loop stops when a pass makes no progress. A failing batch is
   logged and does not stop the run.
6. It prints the expected counts (from the `/****** Object: ... ******/` headers) next to the
   actual counts. It writes the logs and exits with code 2 if any batch still fails.

A full run takes about 20 seconds.

## Changes from the original scripts

* The encoding changed from UTF-16 LE to UTF-8 with a BOM. Non-ASCII content, such as Telugu text
  in N'' literals and typographic quotes, is preserved.
* The users were converted from `CREATE USER [x] FOR LOGIN [x]` to `CREATE USER [x] WITHOUT LOGIN`:
  * ZEDCS_V2_LIVE: `GeoReportUser`, `ro_qci`, `suraj_ro`
  * ZED_CONSULTANT: `suraj_ro` (`ro_qci`, `Ro_User1` and `swamy` were already `WITHOUT LOGIN` in the source)
  * ZED_SURVEILLANCE: `suraj_ro` (`ro_qci` was already `WITHOUT LOGIN`)

  The `ALTER ROLE ... ADD MEMBER` statements are kept, so `db_datareader` and `db_owner` are
  granted to these loginless users. No one can log in as them, and no server logins were created.
* The scripts contain no `CREATE DATABASE`, `FILENAME=` or file paths, so there was nothing to
  strip. Every `FILENAME` match is a column or variable name. All tables are on `[PRIMARY]`.
* Nothing else was changed. Each cleaned file starts with a 5-line comment header, so its line
  numbers are the original line numbers plus 5.
* `04_missing_sequences.sql` is new. It is not production DDL (see section 3).

## Results (local SQLEXPRESS, 16.0.1000.6)

All three databases were created (compat 160, SIMPLE, SQL_Latin1_General_CP1_CI_AS, default
paths). 1,899 of 1,917 batches were applied.

| DB | tables | procs | views | functions | table types | sequences (stub) |
|----|--------|-------|-------|-----------|-------------|------------------|
| ZEDCS_V2_LIVE    | 169/169 | **475/480** | 9/9 | 2/2 | 17/17 | 12 |
| ZED_CONSULTANT   | 109/109 | **293/299** | 3/3 | 0/0 | 16/16 | 9 |
| ZED_SURVEILLANCE | 118/118 | **323/330** | 8/8 | 0/0 | 16/16 | 9 |

Each cell is expected/actual. The expected numbers come from the script headers. The main script
contains 169 tables, not the ~173 mentioned when the job was requested. All constraints,
defaults, FKs and indexes were applied. One view resolved on pass 2:
`ZEDCS_V2_LIVE.dbo.DynamicListOfFinancialSupportZedIdsWithDates` needs `ZED_CONSULTANT.dbo.Msme`.

## Findings

### 1. Batches that cannot be created (18 procedures; already broken in production)

Every failure is a compile-time column error against a table that does exist. The procedure
refers to a column the current table does not have, or to an unqualified column that is now
ambiguous. These procedures could only have been created before the table changed, so they fail
in production too. Most of them are SA (hotel self-assessment) leftovers, `_test` or `_NOT_USING`
copies.

| DB | Procedure | Error |
|----|-----------|-------|
| all 3 | `SP_MONITORING_UPDATE_MEETING_COMMENTS` | 207 Invalid column `RegistrationNumber` (`Meetings` is keyed by `ZedId`) |
| all 3 | `SP_SA_APP_INSERT_CLOSE_MEETING` | 207 Invalid column `RegistrationNumber` (`Meetings`, `MeetingParticipants`) |
| all 3 | `SP_SA_GET_LIST`, `SP_SA_GET_LIST_test` | 209 Ambiguous `CertificateNo` / `ReasonForRejection` (`SelfAssessments` JOIN `Users`; SURVEILLANCE only `ReasonForRejection`) |
| all 3 | `SP_SA_GET_REG_DETAILS` | 209 Ambiguous `CertificateNo` / `ReasonForRejection` (same cause) |
| ZED_CONSULTANT | `SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE_NOT_USING` | 207 `FinancialAssistance` has no `NameOfCertficate`, `CertificationAgency`, `CertficateNumber`, `DateOfIssue`, `ValidityOfCertificate`, `AnyOtherInformation`, `ExpenditureCertficate`, `AgencyOrSupplier`, `InvoiceNo`, `InvoiceBillDate`, `AmountPaid`, `ModeOfPayment` |
| ZED_SURVEILLANCE | **`SP_APP_MSME_INSERT_TECHNOLOGY_UPGRADATION`** | 207, same missing `FinancialAssistance` columns. This is not an `_old` or `_NOT_USING` copy, so check whether the Surveillance app calls it. |
| ZED_SURVEILLANCE | `SP_INSERT_AVAILED_FINANCIAL_SUPPORT` | 207 `AvailedFinancialSupport` has no `SpecializationAvailbility`, `Specialization` |

Full messages with line numbers are in `logs\failed-batches-*.json`.

### 2. Broken references in procedures that do exist (`verify_references.sql`)

These compile but fail at runtime on the code path that reaches the missing object.

**Missing objects in the three databases:**

* ZEDCS_V2_LIVE and ZED_SURVEILLANCE:
  * `SP_TECHNOLOGY_UPGRADATION_GET_CURRENT_CERTIFICATE` calls `ZED_CONSULTANT.dbo.SP_FINANCIAL_ASSISTANCE_GET_CURRENT_CERTIFICATE`.
  * `SP_APP_MSME_INSERT_TECHNOLOGY_UPGRADATION_old` calls `ZED_CONSULTANT.dbo.SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE`.

  ZED_CONSULTANT has neither procedure; it has only `..._NOT_USING` versions.
* All 3 databases: `SP_SA_APP_INSERT_REQUIREMENT` and `SP_SA_GET_DASHBOARD_DETAILS` use
  `dbo.SaPhotoList`. Only `SaPhotoList_delete` exists.
* ZED_CONSULTANT uses the self-assessment master tables `dbo.Requirements`, `Sections`,
  `Options`, `SubOptions` and `Evidences`. These tables exist in ZEDCS_V2_LIVE and
  ZED_SURVEILLANCE, but not in ZED_CONSULTANT. The procedures that use them are:
  * `SP_MSME_PAYMENT_GATEWAY_DETAILS`
  * `SP_INSERT_SELF_ASSESSMENT_STEP_1`
  * `SP_GET_SELF_ASSESSMENT_SUMMARY`, `SP_GET_SELF_ASSESSMENT_QUESTIONS_OLD`
  * `SP_MASTER_GET_SECTIONS`, `SP_MASTER_INSERT_SECTION`, `SP_MASTER_UPDATE_SECTION`
  * `SP_MASTER_INSERT_REQUIREMENT`, `SP_MASTER_REMOVE_REQUIREMENT`, `SP_MASTER_GET_REQUIREMENTS_BY_QUESTION_ID`
  * `SP_MASTER_INSERT_EVIDENCES`, `SP_MASTER_REMOVE_OPTION`
  * `SP_SA_CHECK_LOGIN_saathi`
  * `SP_DYNAMIC_ANALYSIS_REPORT_HOTELS`, `SP_DYNAMIC_ANALYSIS_REPORT_HOTELS_AND_RESTAURANTS`, `SP_DYNAMIC_ANALYSIS_REPORT_BREAD_AND_BREAKFAST`
* ZED_SURVEILLANCE:
  * `SP_APP_SURVEILLANCE_INSERT_ESG_CHECKLIST` uses `dbo.CheckListReport`, which exists only in ZEDCS_V2_LIVE.
  * `USP_UPDATE_DASHBOARD_STATS` uses `dbo.DASHBOARD_STATS_SUMMARY`, which does not exist anywhere.
* ZEDCS_V2_LIVE: `SP_DAILY_RUN_WEB_SITE_COUNTS_backup_before_optimize` fails to bind (Msg 213:
  the INSERT column count does not match the table).
* False positives you can ignore: `dbo.B`, `dbo.M` (`SP_MSME_UPDATE_UDYAM_DETAILS`) and `dbo.U`
  (`SP_UPDATE_USER`) are UPDATE aliases.

**Databases that are not in these scripts** (they are on the production instance). There are
113 references, from the procedures below:

| Missing database | Referencing procedures |
|------------------|------------------------|
| `KAWACH` / `kawach` | 8 in each database: `SP_DYNAMIC_REPORT_LIST_OF_*_KAWACH`, `SP_WEB_SITE_LIST_OF_KAWACH_CERTIFIED_MSME`, `SP_MSME_GET_FILE_DETAILS`, `SP_MSME_GET_MY_DOCUMENTS` |
| `ZED_CENTER_AUDIT_PROFESSIONAL` | 12 in ZEDCS_V2_LIVE: `SP_INSERT_USER`, `SP_UPDATE_USER`, `SP_INSERT_FACILITATOR_DETAILS`, `SP_GET_PROFESSIONAL_DETAILS_BY_CERT_NO*`, `SP_GET_USERS_BY_ROLE`, `SP_GET_ORG_PARTNERS_LIST`, `SP_MASTER_GET_SECTORS`, `SP_API_MSME_INSERT_UDYAM_DETAILS`, `SP_MSME_VALIDATE_UDYAM_DETAILS` |
| `ZED_CENTER_AUDIT_V2` | 5 in ZEDCS_V2_LIVE (`SP_DYNAMIC_REPORT_LIST_OF_CERTIFIED_CANDIDATES_ZED_MONITORING`, `SP_GET_PROFESSIONAL_DETAILS_BY_CERT_NO*`, `SP_MSME_VALIDATE_UDYAM_DETAILS`, ...), 1 in each of the other two |
| `ZED_IMPACT_ASSESSMENT` | `ZEDCS_V2_LIVE.dbo.SP_MSME_UPDATE_UDYAM_DETAILS` |

Some of these are core flows (user insert/update, Udyam validation), so their schemas are needed
locally, at least as empty stubs. Ask for "Generate Scripts" of those databases.

Cross-database calls between the three databases otherwise resolve:

* ZEDCS_V2_LIVE uses ZED_CONSULTANT from 57 objects and ZED_SURVEILLANCE from 53.
* ZED_SURVEILLANCE uses ZEDCS_V2_LIVE from 43 objects and ZED_CONSULTANT from 16.
* ZED_CONSULTANT uses ZEDCS_V2_LIVE from 9 objects.

**Linked servers and four-part names: none.** No four-part names were found, no references with
a server part were found in `sys.sql_expression_dependencies`, and there are no OPENQUERY,
OPENROWSET or OPENDATASOURCE calls.

### 3. SEQUENCE objects (production definitions)

The export did not include sequences, but procedures call `NEXT VALUE FOR`. `04_missing_sequences.sql` now creates
them as defined on production (snapshot of `sys.sequences` of every database on the production instance, 2026-10-21):
data type, MIN/MAX and CACHE as there, `START WITH` the production value of that day + 1. It creates only sequences
that do not exist yet, in databases that exist on the instance.

* ZEDCS_V2_LIVE: 11 (`MsmeIdSequence`, `PaymentSequence`, `EvidenceIdSequence`, `FinancialIdSequence`, `RefIdSequence`,
  `AssessorsSequence`, `BodiesSequence`, `CertificateSequence`, `Seq_Zed_Invoice_Number`, `InvoiceNumberSeq`,
  `TechDetailsIdSequence`); ZED_CONSULTANT and ZED_SURVEILLANCE: 7 each; the referenced databases: 2 to 8 each.
* **Not on production**, kept as stand-ins: `SaCertificateSequence` (used by `SP_MONITORING_UPDATE_FINAL_SUBMIT` in all
  three databases) and `WebinarCertificateSequence` (`SP_WEBINAR_GET_CERTIFICATE_DETAILS`). Those procedures fail on
  production with Msg 208; V4 does not call them.

A backup/restore carries the sequences with their current values. If production data is ever moved another way,
re-create them from a fresh snapshot taken in the cut-over window, never from these numbers.

### 3a. Referenced databases

ZED procedures read four other applications' databases with three-part names (MIGRATION-PLAN "Database"). The
schema exports of three were provided on 2026-10-21 and are `schema\05`-`07`, cleaned like 01-03 (UTF-8, comment
values redacted) and with their own hard-coded credentials removed: 3 master passwords and the Twilio SID, key and
secret in ZED_IMPACT_ASSESSMENT, a hard-coded admin user/password check in ZED_CENTER_AUDIT_PROFESSIONAL
(SECURITY-FINDINGS #129). Local build (`setup.ps1 -Only ZED_IMPACT_ASSESSMENT,ZED_CENTER_AUDIT_PROFESSIONAL,ZED_CENTER_AUDIT_V2 -Force`
replaces the earlier stand-ins without touching the ZED databases):

| DB | tables | procs | functions | table types | sequences |
|----|--------|-------|-----------|-------------|-----------|
| ZED_IMPACT_ASSESSMENT | 124/124 | 290/290 | 0/0 | 19/19 | 2 |
| ZED_CENTER_AUDIT_PROFESSIONAL | 79/79 | **105/110** | 0/0 | 0/0 | 4 |
| ZED_CENTER_AUDIT_V2 | 70/70 | 81/81 | 1/1 | 1/1 | 4 |

The 5 Professional procedures (`SP_QUESTIONNAIRE_ADD_QUESTION_BY_CODE`, `SP_QUESTIONNAIRE_UPDATE_BY_CODE`,
`SP_QUESTIONNAIRE_UPDATE_ORDER_BY_CODE_NOT_USED`, `SP_ZEDTAC_INSERT_SELF_ASSESSMENT_QUESTIONS`,
`SP_ZEDTAC_UPDATE_PRACTICAL_SCORES`) need the table types `DynamicOption` and `DynamicQuestion`, which that export
(made on 2026-10-10 with other options) left out. ZED does not use them; a new export with "User-defined table types"
ticked fixes it. Checked against the real schemas, inside a rolled-back transaction: `SP_MSME_VALIDATE_UDYAM_DETAILS`,
`SP_MASTER_GET_SECTORS`, `SP_GET_USERS_BY_ROLE`, `SP_INSERT_USER`, `SP_MSME_UPDATE_UDYAM_DETAILS` and
`SP_DYNAMIC_REPORT_LIST_OF_CERTIFIED_CANDIDATES_ZED_MONITORING` run without errors.

### 4. SQL Server 2022 / Express compatibility scan

The counts below exclude commented-out code.

| Feature | Found | Notes / examples |
|---------|-------|------------------|
| `text` / `ntext` / `image` columns, params or variables | 0 | none |
| `TEXTPTR`, `READTEXT`, `WRITETEXT`, `UPDATETEXT`, `timestamp` type | 0 | (the `[TimeStamp]` columns are `varchar`) |
| Old-style `RAISERROR n 'msg'` | 0 | 5 procedures use the modern `RAISERROR(...)`, 6 use `THROW` |
| `*=` / `=*` outer joins | 0 | |
| `SET ROWCOUNT`, `GROUP BY ALL`, `COMPUTE`, `FASTFIRSTROW`, `sysobjects`-style compat views, `'alias' = expr` | 0 | |
| **Database Mail `msdb.dbo.sp_send_dbmail`** | **25 procs** (LIVE 17, CONSULTANT 5, SURVEILLANCE 3), all with profile `ZedAdmin` | **Express has no Database Mail.** Examples: `SP_JOB_TO_SEND_APPLY_FOR_BRONZE_SURVEILLANCE_MAIL*`, `SP_JOB_TO_SEND_APPLY_FOR_SECOND_SURVEILLANCE_MAIL*`, `SP_SEND_MAIL_STATUS_EXCEL_ATTACHMENT`, `SP_SEND_AUTO_MAIL_TO_MSME_FOR_CO_ACCEPT_QC`, `SP_SEND_MAIL_AUTO_ALLOT_CONSULTING_ORGANISATION_TU`, `SP_SEND_AUTO_MAIL_FOR_AUTO_ALLOT_AGENCY`, `SP_SEND_MAIL_AUTO_REJECT_NC_FROM_PARTIAL_REJECTION`. These procedures compile but fail at runtime. Move email sending into the .NET app. |
| **`xp_cmdshell`** | 1 proc (2 calls) | `ZEDCS_V2_LIVE.dbo.SP_JOB_TO_CREATE_RENAMING_BATCH_FILES`. It is disabled by default and needs `sysadmin`. Do not enable it; reimplement the file work in .NET. |
| **SQL Agent** | no `msdb` job API calls in the code | The `SP_JOB_*`, `Sp_Daily_*` and `SP_DAILY_RUN_*` procedures (for example `SP_DAILY_RUN_WEB_SITE_COUNTS`, `Sp_Daily_ERP_Auto_Reconciliation`, `SP_JOB_FOR_INSERT_SURVEILLANCE_DATA`, `SP_JOB_FOR_UPDATE_LASTEST_CERTIFICATION`) are clearly scheduled by Agent jobs in production. The job definitions are not in these scripts. **Express has no Agent**, so these need a .NET scheduler (Hangfire, Quartz or a hosted service). |
| CLR, full-text, Service Broker, `sp_OA*`, other `xp_*`, `BULK INSERT`, `OPENROWSET`, `OPENQUERY`, `OPENDATASOURCE`, linked servers | 0 | |
| Dynamic SQL (`EXEC(@sql)` / `sp_executesql`) | 3 procs | `SP_SEND_MAIL_STATUS_COUNTS_AGENCY`, `SP_SEND_MAIL_STATUS_EXCEL_ATTACHMENT`, `SP_CONSULTANCY_UPDATE_COLUMN_VALUE`. Dependency checks cannot see inside these; review the last one for injection. |
| Cursors | 18 procs | mostly the `SP_JOB_*` mail loops |
| `NOLOCK` hints | 11 procs | not a 2022 problem, noted for the rewrite |
| `STRING_SPLIT` / `STRING_AGG` | 22 procs | need compat level ≥ 130 / 140, which 160 satisfies |

Other notes:

* **Compatibility level 160.** Production's level is unknown. Behaviour can differ from older
  levels, for example the cardinality estimator, parameter-sensitive plans and some
  date/rounding conversions. Check `SELECT compatibility_level FROM sys.databases` on
  production.
* **Collation.** The scripts contain only `COLLATE DATABASE_DEFAULT` and three explicit
  `SQL_Latin1_General_CP1_CI_AS`. The databases are created with that collation, which is also
  the local server default. Confirm against production.
* **Express limits:** 10 GB of data per database, about 1.4 GB buffer pool, and the lesser of 1
  socket or 4 cores. These are fine for schema-only development but not for a production-size
  data load.
* **Warnings logged during setup.** `logs\warnings-*.txt` contains about 55 messages of the form
  "depends on the missing object". Most are pass-1 ordering artefacts that resolved once the
  other databases were built. `logs\verify-*.txt` is the authoritative list.

## Redacted credentials

The schema scripts are exports of the live procedures, which contain hard-coded credentials
(SECURITY-FINDINGS #1, #27, #48). Before the scripts were committed these were replaced:
master passwords in the login procedures by `#REMOVED-HARDCODED-PASSWORD#`, and the Twilio
account SID, API key and secret in `SP_APP_MSME_REMOTE_CHECK_LOGIN` by `REDACTED`.
The same applies to `05`-`07` (the referenced databases; section 3a). Every quoted value inside a comment was also replaced by `'<redacted>'`: the procedures' example calls
held user ids with passwords (#96) and real ZED IDs. Only comments changed; the code is identical.
A database built from these scripts therefore has no working master password, which is intended.
The live databases still contain the real values until those procedures are fixed.
