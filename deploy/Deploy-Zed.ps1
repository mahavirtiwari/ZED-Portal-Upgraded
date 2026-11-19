<#
.SYNOPSIS
  Guided production deployment of ZED V4 on the zedv3 server: dry run, your confirmation, the update with the
  migrations, then a check that the migrations are in the databases and the portals answer.
.DESCRIPTION
  A wrapper around the deploy scripts that are already in this folder; it changes nothing they do:
    1. Checks       administrator PowerShell, the repository folder, Git; brings this folder's scripts up to date
                    (git pull of the branch) so that the newest deploy scripts are used.
    2. Dry run      Update-ZedFromGit.ps1 without -Apply: the installed version, the commit to install and the database
                    plan (migrations not yet applied). Nothing changes.
    3. Confirm      you type DEPLOY to go on (or run with -Yes to skip the question, e.g. in a scheduled run).
    4. Update       Update-ZedFromGit.ps1 -Apply: builds the commit, backs up the application folders and the three
                    databases (COPY_ONLY), runs the migrations (Invoke-ZedDatabaseScripts -Apply -SkipFixes), installs the
                    three portals (and, with -IncludeMobile, the mobile app hosts), runs the smoke test, and puts the
                    files back by itself when the install or the test fails.
    5. Verify       reads the databases: every migration of this release is there (0073-0102 by their objects and
                    procedure texts), and the three portals answer over HTTPS.
  2026-11-19: migration 0102 (surveillance rounds go by round robin to another agency, never the certifying one; one
  agency login serves Bronze, Silver and Gold surveillance; blocked agencies are not offered on Allot Surveillance).
  2026-11-18 release: migrations 0095-0101 (zero-amount payment record, submission checklists, MSME notifications seen,
  expenditure monitoring: rates / purchase orders / invoices, one phone per staff app user, the agencies' one-time GSTIN / PAN,
  TAT rules and man-days per level). The mobile app hosts changed
  (one-phone rule): keep -IncludeMobile (default). Zed.Jobs did not change.
  2026-11-15 release: migrations 0077-0094 (invoice setup, level flows, certified-by-record rule, App Forms validation,
  reports / surveillance certificate / partner API by record, PENDING phase fix, AP state handholding fee by level, NC rounds and days by level, sub-user states and agencies, quality observations, handholding ZED-X dashboard, sector disable, incentive ZED-X and activity, parameter disable, App Forms repeating entries).
  They go together: never 0078-0083 without 0084. Zed.Jobs did not change (no -IncludeJobs needed).
  Everything is written to a transcript in <InstallRoot>\logs\deploy-<time>.log.

  Run on the server, in an administrator Windows PowerShell 5.1 (or later), from the repository folder.
  The migrations cannot be undone by the file rollback; the database backups taken in step 4 can be restored
  (RESTORE DATABASE ... WITH REPLACE, with the portals stopped). See docs/PRODUCTION.md.
.PARAMETER Ref
  Branch, tag or commit to install (default main).
.PARAMETER IncludeMobile
  Also installs the three mobile app hosts (needed when the apps' server code changed; on by default for this
  release: use -IncludeMobile:$false to leave them).
.PARAMETER IncludeJobs
  Also replaces Zed.Jobs (the background service).
.PARAMETER Yes
  Skips the DEPLOY question.
.PARAMETER DryRunOnly
  Stops after the dry run (step 2).
.EXAMPLE
  .\deploy\Deploy-Zed.ps1
  Dry run, then asks you to type DEPLOY, then the update and the checks.
.EXAMPLE
  .\deploy\Deploy-Zed.ps1 -DryRunOnly
  Only shows what would be installed and which migrations would run.
#>
[CmdletBinding()]
param(
    [string]$Ref = 'main',
    [switch]$IncludeMobile = $true,
    [switch]$IncludeJobs,
    [switch]$Yes,
    [switch]$DryRunOnly,
    [string]$InstallRoot = 'E:\ZedV4',
    [string]$Settings = 'E:\ZedV4\settings.json',
    [string]$SqlServer = '.\SQLEXPRESS',
    [string]$DatabasePrefix = 'ZEDV4_',
    [string]$BaseUrl = 'https://zedv3.qci.org.in'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$update = Join-Path $PSScriptRoot 'Update-ZedFromGit.ps1'

function Step([string]$text) { Write-Host ''; Write-Host "==== $text" -ForegroundColor Cyan }
function Ok([string]$text) { Write-Host "  OK    $text" -ForegroundColor Green }
function Bad([string]$text) { Write-Host "  FAIL  $text" -ForegroundColor Red }

# ---------------------------------------------------------------- 1. Checks
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this in an administrator PowerShell (right-click PowerShell > Run as administrator).'
}
if (-not (Test-Path $update)) { throw "Update-ZedFromGit.ps1 not found next to this script ($PSScriptRoot)." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is not installed or not on the PATH.' }
if (-not (Test-Path $Settings)) { throw "The server settings file is missing: $Settings (docs/PRODUCTION.md)." }

$logDir = Join-Path $InstallRoot 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ('deploy-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
Start-Transcript -Path $log | Out-Null

try {
    Step '1. Checks'
    Push-Location $repo
    try {
        $branch = (git rev-parse --abbrev-ref HEAD).Trim()
        git pull --ff-only 2>&1 | ForEach-Object { "  $_" }
        if ($LASTEXITCODE -ne 0) { throw "git pull failed in $repo (local changes?). Resolve it, then run again." }
        $head = (git log -1 --format='%h %s').Trim()
        Ok "Repository $repo on $branch, now at $head"
    } finally { Pop-Location }
    Ok "Installing $Ref to $BaseUrl (databases $DatabasePrefix* on $SqlServer)"

    $common = @{ Environment = 'Production'; Ref = $Ref; Settings = $Settings; InstallRoot = $InstallRoot }
    if ($IncludeMobile) { $common.IncludeMobile = $true }
    if ($IncludeJobs) { $common.IncludeJobs = $true }

    # ---------------------------------------------------------------- 2. Dry run
    Step '2. Dry run (nothing changes)'
    & $update @common
    if ($DryRunOnly) { Write-Host ''; Write-Host 'Dry run only: stopped here.' -ForegroundColor Yellow; return }

    # ---------------------------------------------------------------- 3. Confirm
    Step '3. Confirm'
    Write-Host '  The update takes the portals offline for a few minutes, backs up the databases, runs the migrations and'
    Write-Host '  installs the new version. The migrations cannot be undone by the file rollback (the backups can).'
    if (-not $Yes) {
        $answer = Read-Host '  Type DEPLOY to go on (anything else stops)'
        if ($answer -cne 'DEPLOY') { Write-Host '  Stopped: nothing was changed.' -ForegroundColor Yellow; return }
    }

    # ---------------------------------------------------------------- 4. Update
    Step '4. Update (build, backup, migrations, install, smoke test)'
    $updateOk = $true
    try {
        $global:LASTEXITCODE = 0
        & $update @common -Apply
        if (-not $? -or $LASTEXITCODE -ne 0) { $updateOk = $false }
    } catch {
        $updateOk = $false
        Bad "Update-ZedFromGit stopped: $($_.Exception.Message)"
    }
    if (-not $updateOk) { Bad "Update-ZedFromGit reported a failure: see its log in $logDir (the checks below still run)" }

    # ---------------------------------------------------------------- 5. Verify
    Step '5. Verify'
    $checks = @(
        @{ Db = 'ZEDCS_V2_LIVE';    Name = '0073 remote meeting link';           Sql = "SELECT CASE WHEN COL_LENGTH('dbo.MsmeCertifications','MeetingLink') IS NULL THEN 0 ELSE 1 END" },
        @{ Db = 'ZEDCS_V2_LIVE';    Name = '0074 skip desktop (Remote / Onsite only)'; Sql = "SELECT CASE WHEN OBJECT_ID('dbo.SP_V4_SKIP_DESKTOP','P') IS NULL THEN 0 ELSE 1 END" },
        @{ Db = 'ZED_SURVEILLANCE'; Name = '0075 onsite surveillance visit';      Sql = "SELECT CASE WHEN COL_LENGTH('dbo.MsmeCertifications','AssessmentVisit') IS NOT NULL AND OBJECT_ID('dbo.SP_V4_SURVEILLANCE_ACCEPT_ONSITE','P') IS NOT NULL THEN 1 ELSE 0 END" },
        @{ Db = 'ZED_SURVEILLANCE'; Name = '0076 attendance and ESG checklist report'; Sql = "SELECT CASE WHEN OBJECT_ID('dbo.ZedDailyAttendance','U') IS NOT NULL AND OBJECT_ID('dbo.SP_APP_SA_INSERT_DAILY_ATTENDANCE','P') IS NOT NULL AND OBJECT_ID('dbo.CheckListReport','U') IS NOT NULL THEN 1 ELSE 0 END" }
    )
    # 2026-11-15 release (0077-0094): the same markers Invoke-ZedDatabaseScripts.ps1 checks after applying each one.
    function Has-Text([string]$proc, [string]$text) {
        "CHARINDEX('" + $text.Replace("'", "''") + "', ISNULL(OBJECT_DEFINITION(OBJECT_ID('$proc')), '')) > 0"
    }
    function Has-Col([string]$table, [string]$col) { "COL_LENGTH('$table', '$col') IS NOT NULL" }
    $release = @(
        @{ Dbs = @('ZEDCS_V2_LIVE', 'ZED_CONSULTANT', 'ZED_SURVEILLANCE'); Name = '0077 invoice setup'; Test = (Has-Text 'dbo.SP_API_FINANCE_GET_INVOICE_DETAILS' 'V4_0077_TEST_UNITS_IN_PORTAL') },
        @{ Dbs = @('ZEDCS_V2_LIVE', 'ZED_SURVEILLANCE'); Name = '0078 level flows routing'; Test = "OBJECT_ID('dbo.FN_V4_LEVEL_DESKTOP') IS NOT NULL" },
        @{ Dbs = @('ZEDCS_V2_LIVE'); Name = '0079 certified by record'; Test = (Has-Text 'dbo.SP_VERIFY_QR_CODE' 'CASE WHEN C.CertificationStatus = 16 THEN C.SaCertificateNo ELSE C.DaCertificateNo END') },
        @{ Dbs = @('ZED_SURVEILLANCE'); Name = '0079 certified by record'; Test = (Has-Text 'dbo.SP_AUTO_REJECT_BRONZE_SURVEILLANCE_BEFORE_EXPIRY' 'AND (S.CertificationStatus = 16 OR') },
        @{ Dbs = @('ZEDCS_V2_LIVE', 'ZED_CONSULTANT', 'ZED_SURVEILLANCE'); Name = '0080 App Forms validation'; Test = (Has-Col 'dbo.V4AppFormFields' 'NeedsVerification') + ' AND ' + (Has-Col 'dbo.V4AppFormValues' 'NcRound') },
        @{ Dbs = @('ZEDCS_V2_LIVE'); Name = '0081 reports certified by record'; Test = (Has-Text 'dbo.SP_DASHBOARD_GET_DETAILS' 'AS V4Cert, CAST(CASE WHEN') },
        @{ Dbs = @('ZED_SURVEILLANCE'); Name = '0082 surveillance certificate by record'; Test = (Has-Text 'dbo.SP_DA_GET_CERTIFICATE_DETAILS' 'CertificationStatus IN (6, 16)') },
        @{ Dbs = @('ZEDCS_V2_LIVE'); Name = '0083 partner API certified by record'; Test = (Has-Text 'dbo.SP_API_GET_STATE_CERTIFIED_UNIT_DETAILS' 'THEN C.DaCertificateNo ELSE C.SaCertificateNo END AS CertificateNumber') },
        @{ Dbs = @('ZEDCS_V2_LIVE'); Name = '0084 PENDING phase, skipped desktop step'; Test = (Has-Text 'dbo.SP_ASSESSMENT_ALLOT_LIST' 'AND ISNULL(P.CertificationPhase, ') + ' AND ' + (Has-Text 'dbo.SP_V4_SKIP_DESKTOP' 'DesktopAccepted = 1') + ' AND ' + (Has-Text 'dbo.SP_REPORT_GET_DETAILS' 'LEFT JOIN Users U ON (C.DesktopAssessorId = U.UserId)') },
        @{ Dbs = @('ZED_SURVEILLANCE'); Name = '0084 PENDING phase'; Test = (Has-Text 'dbo.SP_AUTO_REJECT_BRONZE_SURVEILLANCE_BEFORE_EXPIRY' 'OR ISNULL(S.CertificationPhase, ') + ' AND ' + (Has-Text 'dbo.SP_REPORT_GET_DETAILS' 'LEFT JOIN Users U ON (C.DesktopAssessorId = U.UserId)') },
        @{ Dbs = @('ZEDCS_V2_LIVE'); Name = '0085 AP state handholding fee by level'; Test = (Has-Text 'dbo.SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS' 'L.Certification = @Certification), Certification)') },
        @{ Dbs = @('ZEDCS_V2_LIVE'); Name = '0086 NC rounds and days by level'; Test = (Has-Col 'dbo.SectionTypes' 'NcDays') + ' AND ' + (Has-Text 'dbo.SP_ASSESSMENT_RA_FINAL_SUBMIT' 'FN_V4_NC_DAYS') + ' AND ' + (Has-Text 'dbo.SP_ASSESSMENT_DA_AUTO_REJECT' 'V4 0086') },
        @{ Dbs = @('ZED_SURVEILLANCE'); Name = '0086 NC rounds and days by level'; Test = (Has-Col 'dbo.SectionTypes' 'NcDays') + ' AND ' + (Has-Text 'dbo.SP_ASSESSMENT_RA_FINAL_SUBMIT' 'FN_V4_NC_DAYS') },
        @{ Dbs = @('ZEDCS_V2_LIVE', 'ZED_CONSULTANT', 'ZED_SURVEILLANCE'); Name = '0087 sub-user states and agencies'; Test = (Has-Col 'dbo.V4SubUsers' 'ScopeStates') + ' AND ' + (Has-Col 'dbo.V4SubUsers' 'ScopeAgencies') },
        @{ Dbs = @('ZEDCS_V2_LIVE', 'ZED_CONSULTANT', 'ZED_SURVEILLANCE'); Name = '0088 quality observations'; Test = (Has-Col 'dbo.AssessorComments' 'QoStatus') + ' AND ' + (Has-Col 'dbo.AssessorComments' 'QoParentId') }
        @{ Dbs = @('ZED_CONSULTANT'); Name = '0089 handholding ZED-X'; Test = (Has-Text 'dbo.SP_V4_DASHBOARD_ANALYTICS' 'V4_0089_ZEDX') },
        @{ Dbs = @('ZEDCS_V2_LIVE', 'ZED_CONSULTANT', 'ZED_SURVEILLANCE'); Name = '0090 sector disable'; Test = (Has-Col 'dbo.Sectors' 'IsDisabled') }
        @{ Dbs = @('ZEDCS_V2_LIVE'); Name = '0091 incentive ZED-X and activity'; Test = (Has-Col 'dbo.Incentives' 'ApplicableForZEDX') + ' AND ' + (Has-Col 'dbo.Incentives' 'ApplicableActivity') }
        @{ Dbs = @('ZEDCS_V2_LIVE'); Name = '0092 parameter disable'; Test = (Has-Col 'dbo.Sections' 'IsDisabled') + ' AND ' + (Has-Text 'dbo.SP_V4_CERTIFICATION_PAID' 'V4_0092') }
        @{ Dbs = @('ZED_SURVEILLANCE'); Name = '0093 parameter disable'; Test = (Has-Col 'dbo.Sections' 'IsDisabled') + ' AND ' + (Has-Text 'dbo.SP_V4_SURVEILLANCE_PAID' 'V4_0093') }
        @{ Dbs = @('ZEDCS_V2_LIVE', 'ZED_CONSULTANT', 'ZED_SURVEILLANCE'); Name = '0094 App Forms repeating entries'; Test = (Has-Col 'dbo.V4AppFormFields' 'MaxItems') }
        @{ Dbs = @('ZEDCS_V2_LIVE', 'ZED_CONSULTANT'); Name = '0095 zero-amount payment record'; Test = (Has-Text 'dbo.SP_MSME_ZERO_PAYMENT_DETAILS' 'PaymentType = ''ZeroAmount''') }
        @{ Dbs = @('ZEDCS_V2_LIVE', 'ZED_CONSULTANT', 'ZED_SURVEILLANCE'); Name = '0096 submission checklists'; Test = "COL_LENGTH('dbo.AssessorComments', 'QoCategory') >= 300" }
        @{ Dbs = @('ZEDCS_V2_LIVE'); Name = '0097 notification bell'; Test = (Has-Col 'dbo.Msme' 'NotificationsSeenOn') }
        @{ Dbs = @('ZEDCS_V2_LIVE', 'ZED_SURVEILLANCE'); Name = '0098 expenditure monitoring'; Test = (Has-Col 'dbo.MsmeCertifications' 'ExpCountedOn') }
        @{ Dbs = @('ZEDCS_V2_LIVE'); Name = '0098 expenditure tables'; Test = "OBJECT_ID('dbo.ExpenditureRates', 'U') IS NOT NULL AND OBJECT_ID('dbo.ExpenditureInvoices', 'U') IS NOT NULL" }
        @{ Dbs = @('ZED_CONSULTANT'); Name = '0098 expenditure monitoring'; Test = (Has-Col 'dbo.MsmeCertifications' 'ExpM1CountedOn') + " AND OBJECT_ID('dbo.ExpenditureInvoices', 'U') IS NOT NULL" }
        @{ Dbs = @('ZEDCS_V2_LIVE', 'ZED_CONSULTANT', 'ZED_SURVEILLANCE'); Name = '0099 one phone per staff user'; Test = (Has-Col 'dbo.MobileDeviceBindings' 'Make') + ' AND ' + (Has-Col 'dbo.MobileDeviceBindings' 'AppVersion') + ' AND ' + (Has-Col 'dbo.MobileDeviceEvents' 'Reason') }
        @{ Dbs = @('ZEDCS_V2_LIVE', 'ZED_CONSULTANT'); Name = '0100 agency GSTIN / PAN'; Test = (Has-Col 'dbo.Users' 'TaxGstin') + ' AND ' + (Has-Col 'dbo.Users' 'TaxSubmittedOn') }
        @{ Dbs = @('ZEDCS_V2_LIVE', 'ZED_CONSULTANT', 'ZED_SURVEILLANCE'); Name = '0101 TAT rules'; Test = "OBJECT_ID('dbo.TatStatusDays', 'U') IS NOT NULL AND OBJECT_ID('dbo.TatRelations', 'U') IS NOT NULL" }
        @{ Dbs = @('ZEDCS_V2_LIVE', 'ZED_SURVEILLANCE'); Name = '0101 man-days per level'; Test = (Has-Col 'dbo.SectionTypes' 'ManDays') + ' AND ' + (Has-Col 'dbo.SectionTypes' 'SurveillanceManDays') }
        @{ Dbs = @('ZED_SURVEILLANCE'); Name = '0102 surveillance to another agency'; Test = (Has-Text 'dbo.SP_V4_SURVEILLANCE_NEXT_AGENCY' 'V4_0102') + ' AND ' + (Has-Text 'dbo.SP_MSME_PAYMENT_GATEWAY_DETAILS' 'SP_V4_SURVEILLANCE_NEXT_AGENCY') + ' AND ' + (Has-Text 'dbo.SP_ASSESSMENT_AGENCIES_TO_ALLOT' 'ISNULL(AllowBronzeSurveillance, 0) IN (0, 1)') }
    )
    foreach ($r in $release) {
        foreach ($d in $r.Dbs) { $checks += @{ Db = $d; Name = $r.Name; Sql = "SELECT CASE WHEN $($r.Test) THEN 1 ELSE 0 END" } }
    }
    $failed = 0
    foreach ($c in $checks) {
        $db = $DatabasePrefix + $c.Db
        try {
            $conn = New-Object System.Data.SqlClient.SqlConnection("Server=$SqlServer;Database=$db;Integrated Security=True;TrustServerCertificate=True;Application Name=ZED-deploy-check")
            $conn.Open()
            $cmd = $conn.CreateCommand(); $cmd.CommandText = $c.Sql
            $found = [int]$cmd.ExecuteScalar()
            $conn.Close()
            if ($found -eq 1) { Ok "$($c.Name) ($db)" } else { Bad "$($c.Name) ($db): not applied"; $failed++ }
        } catch { Bad "$($c.Name) ($db): $($_.Exception.Message)"; $failed++ }
    }
    foreach ($url in @("$BaseUrl/", "$BaseUrl/Consultancy/", "$BaseUrl/surveillance/")) {
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 60
            if ($r.StatusCode -eq 200) { Ok "$url answers (200)" } else { Bad "$url answered $($r.StatusCode)"; $failed++ }
        } catch { Bad "$url : $($_.Exception.Message)"; $failed++ }
    }

    Write-Host ''
    if ($updateOk -and $failed -eq 0) {
        Write-Host 'Deployment finished: migrations in place and the portals answer.' -ForegroundColor Green
    } else {
        Write-Host "Deployment finished with $failed failed check(s). Read the log: $log" -ForegroundColor Red
        Write-Host 'Files are rolled back automatically when the install or smoke test fails; the database backups are in' -ForegroundColor Red
        Write-Host "$InstallRoot\backups\<time>\database (RESTORE DATABASE ... WITH REPLACE, portals stopped)." -ForegroundColor Red
        exit 1
    }
} finally {
    Stop-Transcript | Out-Null
    Write-Host "Log: $log"
}
