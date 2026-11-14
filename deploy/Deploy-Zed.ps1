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
    5. Verify       reads the databases: every migration of this release is there (0073-0076 by their objects), and
                    the three portals answer over HTTPS.
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
