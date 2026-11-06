# Production: https://zedv3.qci.org.in

Decided 2026-11-06: **https://zedv3.qci.org.in is the production portal**. The server (20.219.21.200) and its databases
(`ZEDV4_ZEDCS_V2_LIVE`, `ZEDV4_ZED_CONSULTANT`, `ZEDV4_ZED_SURVEILLANCE` and the `ZEDV4_` copies of the related
databases, on `.\SQLEXPRESS`) are the production server and databases. The system starts with its own data; the old
portal (loginzed.msme.gov.in) stays as it is, view-only, and nothing is ever deployed there.

docs/STAGING.md describes how this server was built; it is now the production server's history. docs/CUTOVER.md (the
move of the old portal's data) is not used.

## 0. Switching to production: the order (server team)

Do steps 1 to 4 in one session, in this order. The test data goes first: until step 4 the running portals still redirect
all mail to the test mailbox, so the test mails waiting in the queue never reach a real person.

1. **Test data, once:** `database\production\02_remove_test_data.sql` in SSMS. Run it as a PREVIEW first; it only counts
   what it would remove. Then run it with `@Mode = 'APPLY'`, `@Confirm = 'DELETE ALL UNITS'` and `@BackupFolder`.
   - **Removed:** every unit registered while this was the test server, with its certifications, assessments,
     payments, invoices, history and logins, plus the test logs (mail queue, OTPs, failed logins, sign-in history).
   - **Kept:** the Admin's setup (levels, fees, questionnaires, masters, texts, templates, forms, settings) and every
     staff account.
   - **All three databases or none:** it first counts, and refuses when a database has more than 1,000 units. Then it
     backs up all three databases; if one backup fails, nothing is removed anywhere. Then it cleans the three databases
     in one transaction: if anything fails, all three stay as they were. Use a folder SQL Server's service account can
     write to, for example its default backup folder (`SELECT SERVERPROPERTY('InstanceDefaultBackupPath')`).
   - **Staff accounts with dev.zed@qcin.org:** it lists them; give them their real e-mail in User Management.
   - **The units' files:** move them aside, don't delete them: under the portal's storage folder `Photos`, `PDFs\SA`,
     `Certificates` and `ReceiptInvoice`, and under the mobile storage folder `Photos` and `SaPhotos`.
2. **Settings:** `.\deploy\Set-ZedProductionSettings.ps1` (dry run), then with `-Apply`. It makes the settings file and the
   Zed.Jobs service's environment a Production one (section 1) and lists what is left by hand. It restarts nothing: the
   code installed now would not start as Production. It keeps a copy of the settings file and of the Zed.Jobs
   environment (administrators only) and prints how to put the Zed.Jobs environment back.
3. **Live CCAvenue account:** QCI's current live account in the Main section (`CcAvenue__MerchantId`, `AccessCode`,
   `WorkingKey`, `ReconciliationWorkingKey`, `MobileAccessCode`, `MobileWorkingKey`). The script already points the gateway
   at CCAvenue's live addresses.
4. **Update:** `.\deploy\Update-ZedFromGit.ps1 -IncludeMobile -IncludeJobs` (dry run), then with `-Apply`. It installs the
   new code with the Production settings and runs the migrations (0051, 0052).
5. **Addresses:** `database\production\01_portal_address.sql` in SSMS (PREVIEW, then `@Mode = 'APPLY'`). The QR codes,
   verification and mail links that the databases hand out then point at https://zedv3.qci.org.in instead of the old portal.
6. **Administration → Settings → Payment Gateway and Invoices:**
   - Online payments are On by default: switch them Off until the live account is in.
   - Enter the new merchant account there when it arrives. Before changing to another merchant account later: switch
     Online payments off, wait about 30 minutes so payments in progress can finish, save the account, switch them on.
   - Invoices stay Off.
7. **Check:** `Test-ZedDeployment.ps1` ran in step 4; then sign in to each portal.

If the update in step 4 fails, it puts back the previous files and the app pools' previous environment settings
(`environment.bin` in the backup folder, encrypted for this server), so the old code starts again as before. Zed.Jobs
gets back the environment it had at the start of the update, which step 2 had already made a Production one: put the
copy from step 2 back with the command that step printed, then restart Zed.Jobs. Then fix the cause and run the update
again.

## 1. Server settings file: what changes (server team, before the next update)

The settings file (`E:\ZedV4\settings.json`, names in `deploy/settings.example.json`). The sites check these at start
and refuse to start, listing what is wrong.

| Setting | Production value |
|---|---|
| `ASPNETCORE_ENVIRONMENT` (every site) | `Production`, or remove it (Install-ZedIis sets Production) |
| `DOTNET_ENVIRONMENT` (Zed.Jobs service) | `Production` |
| `Database__Prefix` | `ZEDV4_` (unchanged) |
| `Database__AllowPrefixInProduction` | `true` (new: production runs on the ZEDV4_ databases on purpose) |
| `Email__RedirectAllTo`, `Email__AllowedRecipientDomains`, `Email__DeliverToRecipients` | remove: mail reaches its recipients (the sites refuse to start with a redirect in Production) |
| `Portal__EnvironmentLabel` | remove |
| Mail server | real details (`Email__Profiles__…`, or Administration → Settings → Email Settings) |
| `Portal__PublicBaseUrl` | `https://zedv3.qci.org.in` (Consultancy `/Consultancy`, Surveillance `/surveillance`) |
| CCAvenue | QCI's current **live** account (decided 2026-11-06): the test gateway (`test.ccavenue.com`) is refused in Production. In the file (`CcAvenue__…`); the new merchant account, when it arrives, in Administration → Settings → Payment Gateway and Invoices. Payments can be switched off on that page meanwhile |
| `Recaptcha__…` | keys registered for zedv3.qci.org.in |
| `Udyam__AccessKey`, `ProteanGstin__…` | live keys |
| `Erp__Enabled` | `false` until invoices are wanted (then the ERP keys, and switch Invoices on in Administration) |
| `UdyamiBharat__Enabled` | `false` until Udyami Bharat uses this address |
| Zed.Jobs schedules | on (`appsettings.json` of the service: the mails, renewals and surveillance jobs) |
| Secrets | new values: never the keys written in the old portal's source (SECURITY-FINDINGS #3, #23, #29) |

## 2. Later updates (from the repository folder on the server)

`deploy/Update-ZedFromGit.ps1` now defaults to Production on this server (site ZEDV4, the ZEDV4_ databases, smoke test
against https://zedv3.qci.org.in without the test-site checks). Change the settings file first (section 1): with the
test settings still there the smoke test fails and the update is rolled back on its own.

```powershell
.\deploy\Update-ZedFromGit.ps1 -IncludeMobile
.\deploy\Update-ZedFromGit.ps1 -IncludeMobile -Apply
```

The first is the dry run; the second backs up the files and the databases, runs the migrations, installs and tests.

## 3. Mobile apps

The apps' production address is https://zedv3.qci.org.in (`mobile/packages/shared/src/config/environments.ts`).

- To install on phones directly: `mobile/tools/Build-ZedApk.ps1 -App zedmsme` (debug-signed).
- For the Play Store: `-Production`, with the upload keystore (the `ZED_UPLOAD_*` variables, see the script's help).

The apps already in the Play Store point at the old portal and never reach this server: each app needs a new store
release.

## 4. Running it

- **Backups:** SQL Server Express has no SQL Agent, so nothing backs the databases up on its own. Schedule a nightly
  backup of the ZEDV4_ databases (Windows Task Scheduler) and keep a copy off the server.
- **Limits of Express:** 50 GB per database and limited memory and CPU. Plan SQL Server Standard before the main
  database nears 50 GB.
- **Certificate:** `*.qci.org.in`, valid to 27 January 2027: renew before then.
- **Access:** the site is open to everyone. In Production the sites no longer ask search engines to keep away.

## 5. ZED IDs, certificate and invoice numbers (migrations 0051 and 0052)

- New units: ZEDM000001… (Manufacturing) and ZEDS000001… (Services), the sector from Masters → Sectors.
- Certificate numbers: date_M000123 / date_S000045.
- Invoices (when switched on): ZEDM/2627/n and ZEDS/2627/n.
