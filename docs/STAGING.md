# Staging: https://zedv3.qci.org.in

The rehearsal of the cut-over (CUTOVER.md 1.5) runs here: V4 on a **restored copy of production**, Environment
`Staging`, SQL Server 2022 Standard. Everything below is done by the server team; the developers have no access to
the server. Run each step in order and fill in the timing sheet (section 9): the timings decide the cut-over window.

## 1. What the server looks like from outside (2026-10-22)

| Check | Result | Meaning |
|---|---|---|
| DNS `zedv3.qci.org.in` | 20.219.21.200 | the name points at the staging VM |
| `http://zedv3.qci.org.in/` | 404 from `Microsoft-HTTPAPI/2.0` | Windows' http.sys answers: **no IIS site is bound to this host name yet** |
| `https://zedv3.qci.org.in/` | connection reset during the TLS handshake | **no certificate is bound on 443** for this name |

Both are expected before the install: section 4 creates the site, the https binding and the http redirect.

**Open questions for the server team** (answer before section 3):
1. Are IIS 10, the ASP.NET Core Hosting Bundle 10 and SQL Server 2022 Standard all on 20.219.21.200, or is the
   database on another server? (If elsewhere: the connection strings name that server, and the database server needs
   the same IST time zone, see CUTOVER 1.1a.)
2. **Restrict 443 to QCI and tester addresses** (Azure network security group on the VM, or IIS IP and Domain
   Restrictions on the site): staging holds a copy of production data, including personal data. Port 80 may stay open
   only for the redirect.
3. Is the IIS **URL Rewrite 2.1** module installed? (Needed for the http to https redirect.)
4. Disk: about 128 GB for the databases (CUTOVER 1.1a; shrink the production logs before the backup) plus the storage
   folder copy (section 5).

## 2. Prerequisites on the server

- Windows Server 2016 or later, IIS 10 with URL Rewrite 2.1, the **ASP.NET Core Hosting Bundle 10** (restart IIS
  after it), SQL Server 2022 Standard (or access to it), PowerShell 5.1, `sqlcmd`.
- Time zone **India Standard Time** (procedures use `GETDATE()`; Zed.Jobs times are IST).
- **Certificate: the QCI wildcard `*.qci.org.in`** (it covers `zedv3.qci.org.in`). Import the `.pfx` into
  *Local Computer > Personal* (`Import-PfxCertificate -FilePath … -CertStoreLocation Cert:\LocalMachine\My`) and note
  its thumbprint (`Get-ChildItem Cert:\LocalMachine\My`). Fallback only if the wildcard is not available in time: a
  Let's Encrypt certificate with win-acme (port 80 is reachable; renewals use `/.well-known/acme-challenge/`, which the
  redirect rule leaves alone).
- No SQL Agent jobs and **no Database Mail profiles** on this server: the other applications' procedures that send
  Database Mail (the Professional database's `ZedEmailOTPs`, CUTOVER 1.1a) must not reach real people from staging.

## 3. Databases

1. **Restore** last night's production backups of all related databases (they call each other by three-part name,
   CUTOVER 1.1a): ZEDCS_V2_LIVE, ZED_CONSULTANT, ZED_SURVEILLANCE, ZED_CENTER_AUDIT_PROFESSIONAL, ZED_CENTER_AUDIT_V2,
   ZED_IMPACT_ASSESSMENT, KAWACH, ZED_QUALITY_PROFESSIONAL. Use the method planned for the cut-over (backup/restore or
   BACPAC, CUTOVER 1.1a "Moving the data") so this is also its rehearsal. Compatibility level 160.
2. **Compare** with `deploy\Compare-ZedDatabases.ps1` (snapshot of production before the copy, of staging after;
   CUTOVER 1.1a "Check the copy"). Exit code 0 is the goal; time both snapshots.
3. **Prepare the copy** with `database\staging\01_prepare_restored_copy.sql` in SSMS on the staging server. Run it
   as it is (PREVIEW, counts only), then set `@Mode = 'APPLY'`, `@ThisIsStaging = 'YES'`, `@ExpectedServerName` =
   `SELECT @@SERVERNAME`. Recommended: `@ScramblePasswords = 1` and `@MaskContacts = 1`, with the testers' user ids and
   ZED IDs in `@Testers` (they keep their passwords and contacts). It refuses to run on the managed instance. What it
   changes, in the three ZED databases:
   - `UrlsMasterData.UrlName`, `PageSettings.FilePath` (home-page banner) and `ApiClientTokens.BaseUrl`: the
     production host becomes `https://zedv3.qci.org.in` (path kept);
   - unsent `V4MailOutbox` rows deleted;
   - partner credentials disabled: `ApiClientTokens.Token`/`AesKey`/`AesIV` random, `ApiClientDynamicTokens.IsValid = 0`;
   - reset and login secrets: `Users.PwdCode`, `ForgotPwdLinks`, open `V4PasswordResets`, `OTP`, `OTP_old`,
     `FailedLogins.Password`;
   - optional: non-tester `Users.Password` replaced by a random V4 value (their `V4UserPasswords` rows deleted), and
     every e-mail / mobile / phone column masked except testers' rows.

   Run it again: every count must be 0. Links hard-coded inside procedures still name production at this point
   (certificate QR / verify links in main and surveillance, mail links): step 6 below changes them.
4. **Logins**: `database\security\02_orphaned_users.sql` (PREVIEW lists the restored users without a login; map or drop
   them), then `database\security\01_v4_logins_and_roles.sql` with **new** passwords (never the production ones) or
   Windows logins for the app pool identities.
5. **V4 scripts**: `deploy\Invoke-ZedDatabaseScripts.ps1 -Server <server>` (dry run: what is applied), then `-Apply`
   (migrations 0001–0010; add `-IncludeMailOutbox`, since Zed.Jobs' mail worker runs here with the redirect). Review the
   fix previews it saves (`database\logs\cutover-<time>\fixes\…\live` against `new`), then apply the same list you plan
   for production with `-SkipMigrations -ApplyFixes '…'` (and `main/02` with `-AtCutover`, as on the night).
6. **Procedure links**: run `database\staging\01_prepare_restored_copy.sql` once more with `@RewriteModuleHosts = 1`
   (and the same guards). It re-creates every procedure, function, view and trigger whose code names
   `http(s)://loginzed.msme.gov.in` with the staging address instead (44 modules in the schema exports; permissions and
   SET options kept), so certificate QR codes and mail links on staging do not open the live site. Only **after**
   step 5: the fix scripts check the procedures' text, and this makes the staging code differ from production.

## 4. Settings, package and IIS

1. Copy `deploy\settings.staging.example.json` to `D:\ZedV4\settings.json` (administrators only) and fill the empty
   values. **Every staging mail goes to `dev.zed@qcin.org`** (`Email__RedirectAllTo`, already set for the portals, the
   mobile API and Zed.Jobs; do not add `Email__AllowedRecipientDomains`). Also: the new SQL logins' connection
   strings; an SMTP account for `Email__Profiles__Default__*` (mail still only reaches dev.zed@qcin.org); a **separate
   reCAPTCHA key pair registered for zedv3.qci.org.in** (or `Recaptcha__Enabled=false`, which leaves the captcha
   untested); **CCAvenue test** merchant and keys only (ask CCAvenue to allow the staging return URLs); Protean and
   Twilio test credentials or none. `Portal__EnvironmentLabel=STAGING` shows a STAGING banner and title prefix and
   tells search engines not to index the site. The hosts refuse to start in Staging without a mail redirect.
2. Build the package on the build machine: `deploy\Publish-Zed.ps1` (tests run first). Copy it to the server.
3. Install, dry run first, then the same with `-Apply`:
   ```powershell
   .\Install-ZedIis.ps1 -Package D:\Releases\zed-<version> -Settings D:\ZedV4\settings.json `
       -EnvironmentName Staging -SiteName ZED -CreateSite -HostName zedv3.qci.org.in `
       -CertificateThumbprint <wildcard thumbprint> -HttpRedirect
   ```
   It creates the site `ZED` (https `zedv3.qci.org.in:443` with SNI and the wildcard certificate; http :80 redirected
   to https by the URL Rewrite rule `ZED-HTTPS`), the six applications and their app pools, with
   `ASPNETCORE_ENVIRONMENT=Staging`. Keep the rollback file it writes (section 8).
4. **Zed.Jobs**: install the service as in JOBS.md "Running it", with the `ZedJobs` section of the settings file as its
   environment. Leave every `Jobs:Schedules` entry and `Jobs:FolderRename` disabled (the shipped settings have them
   off); only the mail worker runs, and it sends to dev.zed@qcin.org.

## 5. Storage folders

Copy the production folders (certificates, receipts, PDFs, uploads, the services' Photos / SaPhotos / Videos /
Attendance) to `D:\ZedStaging\storage\…` and point every `*StorageRoot` setting there. **Never point staging at the
production share**: V4 writes to these folders (uploads, the folder rename job).

## 6. Check

```powershell
.\Test-ZedDeployment.ps1 -BaseUrl https://zedv3.qci.org.in -ExpectEnvironmentLabel STAGING -CheckHttpsRedirect
```
0 failures required: health and database readiness of all six applications, the Angular apps and their base
addresses, the old mail links, the XSRF cookie paths, the old dangerous actions gone, the mobile contract, the STAGING
label, noindex and robots.txt, and http redirected to https. Then by hand: the STAGING banner shows; a password reset
mail arrives at dev.zed@qcin.org.

## 7. Rehearsal journeys

Testers go through CUTOVER 1.5 and the functional checks of CUTOVER 2.1 with the `@Testers` accounts, plus:
- **App registration** with the store MSME app, and the consultant app's **technology upgradation** screens (DFO
  login, GetDetails, evidence, amount correction, final submit) — MOBILE-API "Checked against the app source".
- **Payments** with CCAvenue test cards only; the zero-amount path for an eligible test unit.
- **Mobile apps**: they have the production host built in. On an emulator or test phone, point
  `loginzed.msme.gov.in` at 20.219.21.200 (hosts file, or a DNS override on a test Wi-Fi), and give the staging site a
  second https binding for that name (`-AdditionalHostNames loginzed.msme.gov.in` with a certificate for it, e.g. a
  self-signed one). The released apps accept any certificate (SECURITY-FINDINGS #131), so this works — but that is a
  flaw, not something to rely on. Remove the binding after the tests.
- The rollback (section 8) and the database comparison, both timed.

## 8. Never on staging

- **Real mail**: everything goes to dev.zed@qcin.org; no Database Mail profiles on the server; masking as a second line.
- **Real payments**: CCAvenue test gateway and test keys only.
- **Partner traffic**: partner tokens are disabled by the data script; do not give partners the staging address
  unless a test is agreed (then give them test rows of their own).
- **Zed.Jobs schedules, ERP, Udyami Bharat**: off (`Erp__Enabled=false`, `UdyamiBharat__Enabled=false`).
- **Search engines**: noindex and robots.txt come with the STAGING label; keep the IP restriction anyway.
- **Production passwords or keys** in the settings file: use new ones (LIVE-HARDENING §7 lists what is rotated anyway).

**Rollback rehearsal**: `.\Install-ZedIis.ps1 -Rollback D:\ZedV4\rollback-<time>.json -Apply` removes what the install
created (the site, its bindings and the redirect rule when the install created them); time it, then install again.

**Tear-down** when the rehearsals are over: stop the app pools and Zed.Jobs, drop the restored databases (they hold
production data), delete the storage copy, the settings file and the logs, and remove the IP allow-list entries.

## 9. Timing sheet

| Step | Started | Finished | Duration | Notes |
|---|---|---|---|---|
| Production snapshot (Compare-ZedDatabases) | | | | |
| Backup / export of the related databases | | | | |
| Copy to staging and restore / import | | | | |
| Staging snapshot and compare | | | | |
| `database/staging/01` (PREVIEW, APPLY, re-run) | | | | |
| Logins (`security/02`, `security/01`) | | | | |
| `Invoke-ZedDatabaseScripts.ps1` (migrations, fixes) | | | | |
| Storage folder copy | | | | |
| `Publish-Zed.ps1` | | | | |
| `Install-ZedIis.ps1 -Apply` | | | | |
| `Test-ZedDeployment.ps1` | | | | |
| Functional checks (testers) | | | | |
| Rollback and re-install | | | | |
