<#
.SYNOPSIS
  Updates an installed V4 server from Git in one run: build, back up, migrate, install, test, and roll back the files
  if the test fails. Dry run unless -Apply.

.DESCRIPTION
  For a server where V4 is already installed (staging: docs/STAGING.md section 4; production: docs/CUTOVER.md). It uses
  the other deploy scripts and adds the backup and the rollback of the files:

    1. Checks       administrator, Git / .NET 10 SDK / Node.js (when it builds), the settings file, free disk space,
                    no folder on a temporary disk; shows the installed version and the commit to install.
    2. Build        Build-ZedRelease.ps1 -Ref <branch, tag or commit> into <ReleasesRoot> (tests included unless
                    -SkipTests). Or -Package: an existing package folder or .zip (its .sha256 is checked when present).
    3. Backup       copies each application folder to be replaced (and Zed.Jobs with -IncludeJobs) to
                    <InstallRoot>\backups\<time>\ (logs\ left out) with backup.json. Then, before the migrations, a
                    database backup (BACKUP DATABASE ... WITH COPY_ONLY, and COMPRESSION where the edition has it; the
                    log chain and the DBA's own backups are not disturbed) of each database the migrations change:
                    ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE, with -DatabasePrefix their prefixed names. The
                    files go to -DatabaseBackupDir: by default <InstallRoot>\backups\<time>\database when SQL Server runs
                    on this machine (its service account gets Modify there); for SQL Server on another machine
                    -DatabaseBackupDir is required (a folder on that machine or a share its service account can write).
                    The file rollback cannot undo migrations; these backups can (RESTORE DATABASE ... WITH REPLACE, with
                    the portals stopped). -SkipDatabaseBackup leaves them out (not advised); -SkipMigrations needs none.
                    Those in the backup folders stay for the newest -KeepDatabaseBackups updates (default 2).
    4. Migrations   Invoke-ZedDatabaseScripts.ps1 -Apply -SkipFixes (the migrations are additive and safe to re-run;
                    -IncludeMailOutbox runs 0003 again, which the Email Templates need once). -SkipMigrations skips it.
    5. Install      Install-ZedIis.ps1 -Apply for -Apps (default: the three web portals; -IncludeMobile adds the three
                    mobile hosts). App pool settings come from the settings file as before.
    6. Jobs         with -IncludeJobs: stops the Zed.Jobs service, replaces its files, starts it again. The server's
                    appsettings*.json (the jobs switched on there) are kept; the repository's appsettings.json is put
                    beside them as appsettings.package.json, to compare for new entries.
    7. Test         Test-ZedDeployment.ps1 against -BaseUrl, for the applications installed. When step 5, 6 or 7 fails
                    (also an install that stops half way), the files of step 3 are put back, app_offline.htm is removed
                    and the pools restarted (unless -NoAutoRollback). The database changes stay: they are additive and
                    the previous version runs on them.

  -Rollback <backup folder> -Apply puts a backup back by hand (for example the day after an update).
  -Environment Production (default: https://zedv3.qci.org.in, site ZEDV4, the ZEDV4_ databases on .\SQLEXPRESS) or
  Staging (the same, with the test checks) chooses the site, the database prefix, the address and the test options;
  every one of them can also be given on its own. Production needs the server's settings file set for Production
  first (docs/PRODUCTION.md): with the test settings still there, the smoke test fails and the update is rolled back. Log: <InstallRoot>\logs\update-<time>.log.
  Windows PowerShell 5.1 or later, in an administrator PowerShell.

.EXAMPLE
  .\deploy\Update-ZedFromGit.ps1
  Dry run on production: shows the installed version, the commit main points at and the database plan. Nothing changes.
.EXAMPLE
  .\deploy\Update-ZedFromGit.ps1 -Apply -IncludeMailOutbox
  Production: builds main, backs up, runs the migrations (and 0003 again), installs the three portals, tests.
.EXAMPLE
  .\deploy\Update-ZedFromGit.ps1 -Ref 254cfd6 -IncludeMobile -IncludeJobs -Apply
  A chosen commit, with the mobile hosts and Zed.Jobs.
.EXAMPLE
  .\deploy\Update-ZedFromGit.ps1 -Package E:\Releases\zed-2026.10.24-1700-254cfd6.zip -Apply
  Installs a package built elsewhere (Build-ZedRelease.ps1 on a build PC), without building on the server.
.EXAMPLE
  .\deploy\Update-ZedFromGit.ps1 -Rollback E:\ZedV4\backups\20261024-1712 -Apply
.EXAMPLE
  .\deploy\Update-ZedFromGit.ps1 -Environment Production -SqlServer PRODSQL01 -DatabaseBackupDir F:\SqlBackups\ZedUpdate -Settings E:\ZedV4\settings.json -Apply
  SQL Server on another machine: the database backups go to F:\SqlBackups\ZedUpdate on PRODSQL01.
#>
[CmdletBinding(DefaultParameterSetName = 'Update')]
param(
    [ValidateSet('Production', 'Staging')][string]$Environment = 'Production',
    [Parameter(ParameterSetName = 'Update')][string]$Ref = 'main',
    [Parameter(ParameterSetName = 'Update')][string]$RepoUrl = 'https://github.com/mahavirtiwari/ZED-Portal-Upgraded.git',
    # A package folder or .zip to install instead of building one.
    [Parameter(ParameterSetName = 'Update')][string]$Package,
    [Parameter(ParameterSetName = 'Update')][string]$ReleasesRoot = 'E:\Releases',
    [Parameter(ParameterSetName = 'Update')]
    [ValidateSet('Main', 'Consultancy', 'Surveillance', 'MobileMain', 'MobileConsultancy', 'MobileSurveillance')]
    [string[]]$Apps = @('Main', 'Consultancy', 'Surveillance'),
    [Parameter(ParameterSetName = 'Update')][switch]$IncludeMobile,
    [Parameter(ParameterSetName = 'Update')][switch]$IncludeJobs,
    [Parameter(ParameterSetName = 'Update')][switch]$IncludeMailOutbox,
    [Parameter(ParameterSetName = 'Update')][switch]$SkipMigrations,
    # Folder for the database backups taken before the migrations, as SQL Server sees it (on the SQL Server machine).
    [Parameter(ParameterSetName = 'Update')][string]$DatabaseBackupDir,
    [Parameter(ParameterSetName = 'Update')][switch]$SkipDatabaseBackup,
    [Parameter(ParameterSetName = 'Update')][switch]$SkipTests,
    [Parameter(ParameterSetName = 'Update')][switch]$NoAutoRollback,
    [Parameter(ParameterSetName = 'Update')][int]$KeepReleases = 5,
    [Parameter(ParameterSetName = 'Update')][int]$KeepDatabaseBackups = 2,
    [Parameter(Mandatory, ParameterSetName = 'Rollback')][string]$Rollback,
    [string]$Settings = 'E:\ZedV4\settings.json',
    [string]$InstallRoot = 'E:\ZedV4',
    [string]$SiteName,
    [string]$SqlServer,
    [System.Management.Automation.PSCredential]$SqlCredential,
    [string]$DatabasePrefix,
    [string]$BaseUrl,
    [string]$JobsService = 'ZedJobs',
    [string]$JobsDir,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
# No Set-StrictMode here: it would carry over into Install-ZedIis.ps1 and the other scripts this one runs, which are
# not written for it (Install-ZedIis reads $app.System, absent on the web portals).
$deployDir = $PSScriptRoot
$timestamp = Get-Date -Format 'yyyyMMdd-HHmm'
$started = Get-Date

# Per environment; anything given on the command line wins.
$preset = @{
    # Production is https://zedv3.qci.org.in on this server (2026-11-06, docs/PRODUCTION.md): site ZEDV4, the ZEDV4_ databases
    # on .\SQLEXPRESS. Staging keeps the same site with the test checks (noindex), for a test copy set up like before.
    Production = @{ SiteName = 'ZEDV4'; DatabasePrefix = 'ZEDV4_'; SqlServer = '.\SQLEXPRESS'; BaseUrl = 'https://zedv3.qci.org.in'; Trust = $true; NoIndex = $false }
    Staging    = @{ SiteName = 'ZEDV4'; DatabasePrefix = 'ZEDV4_'; SqlServer = '.\SQLEXPRESS'; BaseUrl = 'https://zedv3.qci.org.in'; Trust = $true; NoIndex = $true }
}[$Environment]
if (-not $PSBoundParameters.ContainsKey('SiteName')) { $SiteName = $preset.SiteName }
if (-not $PSBoundParameters.ContainsKey('DatabasePrefix')) { $DatabasePrefix = $preset.DatabasePrefix }
if (-not $SqlServer) { $SqlServer = $preset.SqlServer }
if (-not $BaseUrl) { $BaseUrl = $preset.BaseUrl }
if (-not $JobsDir) { $JobsDir = Join-Path $InstallRoot 'ZedJobs' }
if ($IncludeMobile) { $Apps = @($Apps + 'MobileMain', 'MobileConsultancy', 'MobileSurveillance' | Select-Object -Unique) }

# Install-ZedIis.ps1's folder and pool per application.
$catalog = [ordered]@{
    Main               = @{ Folder = 'main';                Pool = 'ZedV4-Main';                Test = 'Main' }
    Consultancy        = @{ Folder = 'consultancy';         Pool = 'ZedV4-Consultancy';         Test = 'Consultancy' }
    Surveillance       = @{ Folder = 'surveillance';        Pool = 'ZedV4-Surveillance';        Test = 'Surveillance' }
    MobileMain         = @{ Folder = 'mobile-main';         Pool = 'ZedV4-Mobile-Main';         Test = 'MobileMain' }
    MobileConsultancy  = @{ Folder = 'mobile-consultancy';  Pool = 'ZedV4-Mobile-Consultancy';  Test = 'MobileConsultancy' }
    MobileSurveillance = @{ Folder = 'mobile-surveillance'; Pool = 'ZedV4-Mobile-Surveillance'; Test = 'MobileSurveillance' }
}

function Write-Step([string]$Text) { Write-Host ''; Write-Host "== $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "   OK  $Text" -ForegroundColor Green }
function Write-Note([string]$Text) { Write-Host "   $Text" }

function Assert-NotTemporaryDisk([string]$Path) {
    $root = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($Path))
    if (Test-Path (Join-Path $root 'DATALOSS_WARNING_README.txt')) { throw "$Path is on a temporary disk ($root): choose a folder on a data disk." }
}

# Runs one of the deploy scripts in this process (credentials pass through). Errors stop the update; -ExitCode also
# for a script that reports failures by its exit code (the others can leave robocopy's 1, which means "copied").
function Invoke-DeployScript([string]$Name, [hashtable]$Arguments, [switch]$ExitCode) {
    $file = Join-Path $deployDir $Name
    if (-not (Test-Path $file)) { throw "$file is missing." }
    $global:LASTEXITCODE = 0
    & $file @Arguments
    if ($ExitCode -and $LASTEXITCODE -ne 0) { throw "$Name ended with exit code $LASTEXITCODE." }
    $global:LASTEXITCODE = 0
}

function Get-InstalledVersion {
    $file = Join-Path $InstallRoot 'main\VERSION.txt'
    if (Test-Path $file) { return (Get-Content $file -TotalCount 1) }
    return '(no VERSION.txt under main)'
}

# Stops each pool, waits until it has stopped (IIS refuses a start while it is still stopping), starts it. A pool that
# does not start is reported and the others are still started; the caller gets an error at the end.
function Restart-Pools([string[]]$Names) {
    Import-Module WebAdministration
    $failed = @()
    foreach ($n in $Names) {
        $pool = $catalog[$n].Pool
        if (-not (Test-Path "IIS:\AppPools\$pool")) { continue }
        try {
            if ((Get-WebAppPoolState $pool).Value -eq 'Started') { Stop-WebAppPool $pool }
            for ($i = 0; $i -lt 60 -and (Get-WebAppPoolState $pool).Value -ne 'Stopped'; $i++) { Start-Sleep -Seconds 1 }
            Start-WebAppPool $pool
            for ($i = 0; $i -lt 30 -and (Get-WebAppPoolState $pool).Value -ne 'Started'; $i++) { Start-Sleep -Seconds 1 }
            Write-Ok "restarted $pool ($((Get-WebAppPoolState $pool).Value))"
        }
        catch {
            Write-Host "   $pool did not start: $($_.Exception.Message)" -ForegroundColor Red
            $failed += $pool
        }
    }
    if ($failed.Count) { throw "App pools not started: $($failed -join ', '). Start them in IIS Manager." }
}

function Copy-Folder([string]$From, [string]$To, [string[]]$KeepFiles = @()) {
    New-Item -ItemType Directory -Force -Path $To | Out-Null
    # Files named in KeepFiles (and app_offline.htm) are neither copied nor removed: the server's copy stays.
    & robocopy $From $To /MIR /R:3 /W:5 /NFL /NDL /NJH /NJS /NP /XD logs /XF app_offline.htm @KeepFiles | Out-Null
    # robocopy: 0-7 is success (files copied, extra files removed, ...), 8 and above is a failure.
    if ($LASTEXITCODE -ge 8) { throw "robocopy $From -> $To failed (exit code $LASTEXITCODE)." }
    $global:LASTEXITCODE = 0
}

# The app pools' environment variables and Zed.Jobs' service environment as they were before the install: a rollback puts
# them back with the files, so the previous code never starts with settings it does not know (for example Production with
# a database prefix, which the code before 2026-11-06 refuses). They hold connection strings and keys: the file is
# encrypted for this machine (DPAPI) and readable by administrators only.
$EnvironmentFile = 'environment.bin'
function Save-Environment([string[]]$Names, [string]$File) {
    Import-Module WebAdministration
    $pools = [ordered]@{}
    foreach ($n in $Names) {
        $pool = $catalog[$n].Pool
        if (-not (Test-Path "IIS:\AppPools\$pool")) { continue }
        $pools[$pool] = @(Get-WebConfiguration -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter "system.applicationHost/applicationPools/add[@name='$pool']/environmentVariables/add" |
            ForEach-Object { [ordered]@{ name = [string]$_.name; value = [string]$_.value } })
    }
    $jobsKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$JobsService"
    $jobs = if (Test-Path $jobsKey) { [ordered]@{ saved = $true; values = @((Get-ItemProperty $jobsKey -Name Environment -ErrorAction SilentlyContinue).Environment | Where-Object { $_ }) } } else { [ordered]@{ saved = $false } }
    Add-Type -AssemblyName System.Security
    $bytes = [Text.Encoding]::UTF8.GetBytes(([ordered]@{ pools = $pools; jobs = $jobs } | ConvertTo-Json -Depth 6))
    [IO.File]::WriteAllBytes($File, [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine))
    & icacls $File /inheritance:r /grant:r 'BUILTIN\Administrators:(F)' 'NT AUTHORITY\SYSTEM:(F)' | Out-Null
    return @($pools.Keys)
}
function Restore-Environment([string]$File, [bool]$Jobs) {
    Import-Module WebAdministration
    Add-Type -AssemblyName System.Security
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($File), $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
    $saved = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
    foreach ($p in $saved.pools.PSObject.Properties) {
        if (-not (Test-Path "IIS:\AppPools\$($p.Name)")) { continue }
        $filter = "system.applicationHost/applicationPools/add[@name='$($p.Name)']/environmentVariables"
        Clear-WebConfiguration -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter $filter -ErrorAction SilentlyContinue
        foreach ($v in @($p.Value)) { if ($v) { Add-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter $filter -Name '.' -Value @{ name = $v.name; value = $v.value } } }
        Write-Ok "environment of $($p.Name) put back"
    }
    if ($Jobs -and $saved.jobs.saved) {
        $jobsKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$JobsService"
        $values = [string[]]@($saved.jobs.values | Where-Object { $_ })
        if ($values.Count) { New-ItemProperty -Path $jobsKey -Name Environment -PropertyType MultiString -Value $values -Force | Out-Null }
        else { Remove-ItemProperty -Path $jobsKey -Name Environment -ErrorAction SilentlyContinue }
        Write-Ok "environment of $JobsService put back"
    }
}

# Puts a backup folder back: app_offline.htm while copying, the previous environment settings, then the pools (and
# Zed.Jobs) restart.
function Restore-Backup([string]$Folder) {
    $manifestFile = Join-Path $Folder 'backup.json'
    if (-not (Test-Path $manifestFile)) { throw "$Folder has no backup.json: not a backup of this script." }
    $manifest = Get-Content $manifestFile -Raw | ConvertFrom-Json
    Write-Step "Restore $Folder (version $($manifest.Version), taken $($manifest.Taken))"
    $restoreApps = @($manifest.Apps)
    foreach ($name in $restoreApps) {
        $folderName = $catalog[$name].Folder
        $dest = Join-Path $InstallRoot $folderName
        Write-Note "$name <- $(Join-Path $Folder $folderName)"
        if (-not $Apply) { continue }
        Set-Content (Join-Path $dest 'app_offline.htm') '<html><body>Updating, back in a minute.</body></html>' -Encoding UTF8
        Copy-Folder (Join-Path $Folder $folderName) $dest
        Remove-Item (Join-Path $dest 'app_offline.htm') -Force -ErrorAction SilentlyContinue
    }
    $environment = Join-Path $Folder $EnvironmentFile
    if (Test-Path $environment) {
        Write-Note "app pool$(if ($manifest.Jobs) { ' and Zed.Jobs' }) environment <- $environment"
        if ($Apply) { Restore-Environment $environment ([bool]$manifest.Jobs) }
    }
    if ($manifest.Jobs) {
        Write-Note "Zed.Jobs <- $(Join-Path $Folder 'ZedJobs')"
        if ($Apply) {
            Stop-Service $JobsService -ErrorAction SilentlyContinue
            Copy-Folder (Join-Path $Folder 'ZedJobs') $JobsDir
            Start-Service $JobsService
            Write-Ok "started $JobsService"
        }
    }
    if ($Apply) { Restart-Pools $restoreApps; Write-Ok 'restored.' } else { Write-Note 'Dry run: add -Apply to restore.' }
}

# An install that stopped half way leaves app_offline.htm ("being updated") in the folders it reached.
function Remove-OfflinePages([string[]]$Names) {
    foreach ($name in $Names) {
        $page = Join-Path (Join-Path $InstallRoot $catalog[$name].Folder) 'app_offline.htm'
        if (Test-Path $page) { Remove-Item $page -Force -ErrorAction SilentlyContinue; Write-Ok "removed $page" }
    }
}

# The databases the migrations change (Invoke-ZedDatabaseScripts.ps1 runs them on these three only), as named on the instance.
function Get-MigratedDatabases { @('ZEDCS_V2_LIVE', 'ZED_CONSULTANT', 'ZED_SURVEILLANCE' | ForEach-Object { "$DatabasePrefix$_" }) }

# SQL Server on this machine: its backups can go to a folder here, which this script creates and opens to its service.
function Test-LocalSqlServer {
    $hostName = (($SqlServer -replace '^(tcp|np|lpc):', '') -split '[\\,]')[0].Trim()
    return @('.', 'localhost', '(local)', '127.0.0.1', '::1', $env:COMPUTERNAME) -contains $hostName
}

# One query against master with sqlcmd (as Invoke-ZedDatabaseScripts.ps1: the password through the environment only).
function Invoke-MasterQuery([string]$Query) {
    $tool = Get-Command sqlcmd -ErrorAction SilentlyContinue
    if (-not $tool) { throw 'sqlcmd was not found: install the SQL Server command line tools, or give -SkipDatabaseBackup.' }
    $a = @('-S', $SqlServer, '-d', 'master', '-b', '-h', '-1', '-W', '-Q', "SET NOCOUNT ON; $Query")
    if ($SqlCredential) { $a += @('-U', $SqlCredential.UserName); $env:SQLCMDPASSWORD = $SqlCredential.GetNetworkCredential().Password } else { $a += '-E' }
    if ($preset.Trust) { $a += '-C' }
    $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $out = @(& $tool.Source @a 2>&1 | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
        if ($SqlCredential) { Remove-Item Env:\SQLCMDPASSWORD -ErrorAction SilentlyContinue }
    }
    $global:LASTEXITCODE = 0
    if ($code -ne 0) { throw "sqlcmd on $SqlServer failed (exit code $code): $($out -join ' ')" }
    return ,$out
}

# COPY_ONLY backups of the migrated databases into $Folder (as SQL Server sees it); returns the files written.
function Backup-Databases([string]$Folder) {
    $edition = (Invoke-MasterQuery "SELECT CAST(SERVERPROPERTY('Edition') AS nvarchar(128));")[0]
    # Backup compression: Standard, Enterprise and Developer; not Express or Web.
    $compress = $edition -notmatch 'Express|Web'
    $names = (Get-MigratedDatabases | ForEach-Object { "N'$_'" }) -join ', '
    $sizes = @{}
    foreach ($line in (Invoke-MasterQuery "SELECT d.name + N'|' + CAST(SUM(CAST(f.size AS bigint)) * 8 / 1024 AS nvarchar(20)) FROM sys.databases d JOIN sys.master_files f ON f.database_id = d.database_id AND f.type = 0 WHERE d.name IN ($names) GROUP BY d.name;")) {
        $c = $line.Split('|'); if ($c.Count -eq 2) { $sizes[$c[0]] = [int64]$c[1] }
    }
    if (Test-LocalSqlServer) {
        New-Item -ItemType Directory -Force -Path $Folder | Out-Null
        $account = $null
        try { $account = (Invoke-MasterQuery "SELECT service_account FROM sys.dm_server_services WHERE servicename LIKE N'SQL Server (%';")[0] } catch { }
        if (-not $account) {
            $instance = if ($SqlServer -match '\\(.+)$') { $Matches[1] } else { 'MSSQLSERVER' }
            $account = if ($instance -ieq 'MSSQLSERVER') { 'NT SERVICE\MSSQLSERVER' } else { "NT SERVICE\MSSQL`$$instance" }
        }
        if ($account -notmatch '^(LocalSystem|NT AUTHORITY\\SYSTEM)$') {
            & icacls $Folder /grant "$($account):(OI)(CI)M" /Q | Out-Null
            if ($LASTEXITCODE -ne 0) { Write-Host "   Could not give $account Modify on $Folder (icacls exit code $LASTEXITCODE); the backup may be refused." -ForegroundColor Yellow }
            $global:LASTEXITCODE = 0
        }
        $total = ($sizes.Values | Measure-Object -Sum).Sum
        $drive = Get-PSDrive -Name ([System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($Folder)).Substring(0, 1))
        if ($total -and $drive.Free / 1MB -lt $total) {
            Write-Host "   Only $([math]::Round($drive.Free / 1GB, 1)) GB free on $($drive.Name): for databases of $([math]::Round($total / 1024, 1)) GB (a compressed backup is usually smaller)." -ForegroundColor Yellow
        }
    }
    $files = @()
    foreach ($db in (Get-MigratedDatabases)) {
        if (-not $sizes.ContainsKey($db)) { Write-Note "$db is not on $SqlServer`: nothing to back up (the migrations will report it)."; continue }
        $file = "$($Folder.TrimEnd('\'))\$db-$timestamp.bak"
        Write-Note "$db ($($sizes[$db]) MB of data files) -> $file$(if ($compress) { ' (compressed)' })"
        $with = 'COPY_ONLY, INIT' + $(if ($compress) { ', COMPRESSION' } else { '' })
        Invoke-MasterQuery "BACKUP DATABASE [$($db.Replace(']', ']]'))] TO DISK = N'$($file.Replace("'", "''"))' WITH $with;" | Out-Null
        Write-Ok "$db backed up"
        $files += $file
    }
    return ,$files
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this in an administrator PowerShell.' }
New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot 'logs') | Out-Null
$log = Join-Path $InstallRoot "logs\update-$timestamp.log"
Start-Transcript -Path $log | Out-Null
try {
    if ($PSCmdlet.ParameterSetName -eq 'Rollback') {
        Restore-Backup $Rollback
        return
    }

    # 1. Checks
    Write-Step "Checks ($Environment, site '$SiteName', $(if ($Apply) { 'APPLY' } else { 'dry run' }))"
    foreach ($p in @($InstallRoot, $ReleasesRoot)) { Assert-NotTemporaryDisk $p }
    if (-not (Test-Path $Settings)) { throw "Settings file $Settings is missing (deploy\settings.example.json lists the names)." }
    if (-not $SkipMigrations -and -not $SqlServer) { throw 'Give -SqlServer (the instance with the ZED databases), or -SkipMigrations.' }
    if ($DatabasePrefix -and $DatabasePrefix -notmatch '^[A-Za-z][A-Za-z0-9_]{0,19}$') { throw "-DatabasePrefix '$DatabasePrefix': letters, digits and _ only (e.g. ZEDV4_)." }
    # The database backup before the migrations (step 3): on by default.
    $backupDatabases = -not $SkipMigrations -and -not $SkipDatabaseBackup
    if ($backupDatabases) {
        if (-not $DatabaseBackupDir) {
            if (-not (Test-LocalSqlServer)) {
                throw "SQL Server $SqlServer is on another machine: give -DatabaseBackupDir, a folder on that machine (or a share its service account can write) for the database backups taken before the migrations. -SkipDatabaseBackup leaves them out (not advised)."
            }
            $DatabaseBackupDir = Join-Path $InstallRoot "backups\$timestamp\database"
        }
        elseif (Test-LocalSqlServer) { Assert-NotTemporaryDisk $DatabaseBackupDir }
        Write-Ok "database backup before the migrations: $((Get-MigratedDatabases) -join ', ') -> $DatabaseBackupDir$(if (-not (Test-LocalSqlServer)) { " (on $SqlServer)" })"
    }
    elseif ($SkipDatabaseBackup -and -not $SkipMigrations) {
        Write-Host '   No database backup (-SkipDatabaseBackup): the file rollback cannot undo the migrations.' -ForegroundColor Yellow
    }
    if (-not $Package) {
        foreach ($tool in 'git', 'dotnet', 'node', 'npm') {
            if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not installed: install it, or build elsewhere and use -Package." }
        }
    }
    $drive = Get-PSDrive -Name ([System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($InstallRoot)).Substring(0, 1))
    $freeGb = [math]::Round($drive.Free / 1GB, 1)
    if ($freeGb -lt 5) { throw "Only $freeGb GB free on $($drive.Name):. A build, a backup and a package need about 5 GB." }
    Write-Ok "$freeGb GB free on $($drive.Name):"
    Write-Ok "installed now: $(Get-InstalledVersion)"
    Write-Ok "applications: $($Apps -join ', ')$(if ($IncludeJobs) { ', Zed.Jobs' })"
    if (-not $Package) {
        $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $remote = @(& git ls-remote $RepoUrl $Ref "refs/heads/$Ref" "refs/tags/$Ref" 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -match '^[0-9a-f]{40}\s' })
        $ErrorActionPreference = $previous
        if ($remote.Count) { Write-Ok "$Ref is $($remote[0].Substring(0, 12)) on $RepoUrl" }
        else { Write-Note "$Ref is not a branch or tag on $RepoUrl; it is taken as a commit." }
    }

    if (-not $Apply) {
        if (-not $SkipMigrations) {
            Write-Step 'Database plan (dry run of Invoke-ZedDatabaseScripts.ps1)'
            $db = @{ Server = $SqlServer; SkipFixes = $true }
            if ($SqlCredential) { $db.Credential = $SqlCredential }
            if ($preset.Trust) { $db.TrustServerCertificate = $true }
            if ($DatabasePrefix) { $db.DatabasePrefix = $DatabasePrefix }
            if ($IncludeMailOutbox) { $db.IncludeMailOutbox = $true }
            Invoke-DeployScript 'Invoke-ZedDatabaseScripts.ps1' $db -ExitCode
        }
        Write-Step 'Dry run: nothing was built, copied or changed. Add -Apply to update.'
        return
    }

    # 2. Build, or take the given package
    if ($Package) {
        if ($Package -like '*.zip') {
            $hashFile = "$Package.sha256"
            if (Test-Path $hashFile) {
                $expected = ((Get-Content $hashFile -TotalCount 1) -split '\s+')[0]
                $actual = (Get-FileHash $Package -Algorithm SHA256).Hash
                if ($expected -ne $actual) { throw "$Package does not match $hashFile." }
                Write-Ok 'package checksum matches'
            }
            $unzipped = Join-Path $ReleasesRoot ([System.IO.Path]::GetFileNameWithoutExtension($Package))
            if (-not (Test-Path (Join-Path $unzipped 'VERSION.txt'))) {
                Expand-Archive $Package -DestinationPath $ReleasesRoot -Force
                # A downloaded zip marks its files as from the internet; the scripts in it would not run.
                Get-ChildItem $unzipped -Recurse -File | Unblock-File
            }
            $Package = $unzipped
        }
    }
    else {
        Write-Step "Build $Ref"
        $build = @{ Output = $ReleasesRoot; Ref = $Ref; RepoUrl = $RepoUrl; NoZip = $true }
        if ($SkipTests) { $build.SkipTests = $true }
        Invoke-DeployScript 'Build-ZedRelease.ps1' $build
        $Package = Get-ChildItem $ReleasesRoot -Directory -Filter 'zed-*' | Where-Object { Test-Path (Join-Path $_.FullName 'VERSION.txt') } |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $Package -or -not (Test-Path (Join-Path $Package 'VERSION.txt'))) { throw "No package with VERSION.txt at '$Package'." }
    $newVersion = Get-Content (Join-Path $Package 'VERSION.txt') -TotalCount 1
    Write-Ok "package $Package ($newVersion)"
    # The package's own deploy scripts install it (they match its applications and migrations).
    $deployDir = Join-Path $Package 'deploy'

    # 3. Backup
    $backup = Join-Path $InstallRoot "backups\$timestamp"
    Write-Step "Backup to $backup"
    $backedUp = @()
    foreach ($name in $Apps) {
        $source = Join-Path $InstallRoot $catalog[$name].Folder
        if (Test-Path $source) { Copy-Folder $source (Join-Path $backup $catalog[$name].Folder); $backedUp += $name; Write-Ok $name }
        else { Write-Note "$name is not installed yet: nothing to back up." }
    }
    $jobsBackedUp = $false
    if ($IncludeJobs -and (Test-Path $JobsDir)) { Copy-Folder $JobsDir (Join-Path $backup 'ZedJobs'); $jobsBackedUp = $true; Write-Ok 'Zed.Jobs' }
    $savedPools = @(Save-Environment $Apps (Join-Path $backup $EnvironmentFile))
    Write-Ok "environment settings of $(if ($savedPools.Count) { $savedPools -join ', ' } else { 'no app pool yet' })$(if ($jobsBackedUp) { " and $JobsService" }) (encrypted, administrators only)"
    $manifest = [pscustomobject]@{ Version = (Get-InstalledVersion); Taken = (Get-Date -Format s); Apps = $backedUp; Jobs = $jobsBackedUp; Replacing = $newVersion; Databases = @() }
    $manifest | ConvertTo-Json | Set-Content (Join-Path $backup 'backup.json') -Encoding UTF8

    # 3b. Database backup: the file rollback cannot undo the migrations.
    $databaseBackups = @()
    if ($backupDatabases) {
        Write-Step "Database backup to $DatabaseBackupDir$(if (-not (Test-LocalSqlServer)) { " on $SqlServer" }) (COPY_ONLY)"
        $databaseBackups = @(Backup-Databases $DatabaseBackupDir)
        $manifest.Databases = $databaseBackups
        $manifest | ConvertTo-Json | Set-Content (Join-Path $backup 'backup.json') -Encoding UTF8
        Write-Ok "database backups: $($databaseBackups -join ', ')"
        Write-Note 'To undo the migrations: stop the portals, then RESTORE DATABASE [<name>] FROM DISK = N''<file>'' WITH REPLACE for each.'
    }
    elseif (-not $SkipMigrations) { Write-Step 'Database backup skipped (-SkipDatabaseBackup)' }

    # 4. Migrations
    if ($SkipMigrations) { Write-Step 'Migrations skipped (-SkipMigrations)' }
    else {
        Write-Step "Migrations on $SqlServer$(if ($DatabasePrefix) { " (prefix $DatabasePrefix)" })"
        $db = @{ Server = $SqlServer; Apply = $true; SkipFixes = $true }
        if ($SqlCredential) { $db.Credential = $SqlCredential }
        if ($preset.Trust) { $db.TrustServerCertificate = $true }
        if ($DatabasePrefix) { $db.DatabasePrefix = $DatabasePrefix }
        if ($IncludeMailOutbox) { $db.IncludeMailOutbox = $true }
        Invoke-DeployScript 'Invoke-ZedDatabaseScripts.ps1' $db -ExitCode
    }

    # 5. Install, 6. Jobs, 7. Test; the files go back when one of them fails.
    $installed = $false
    try {
        Write-Step "Install $($Apps -join ', ') into site '$SiteName'"
        Invoke-DeployScript 'Install-ZedIis.ps1' @{
            Package = $Package; Settings = $Settings; InstallRoot = $InstallRoot; Apps = $Apps
            EnvironmentName = $Environment; SiteName = $SiteName; Apply = $true
        }
        $installed = $true

        if ($IncludeJobs) {
            Write-Step "Zed.Jobs in $JobsDir"
            if (-not (Get-Service $JobsService -ErrorAction SilentlyContinue)) { throw "Service $JobsService is missing: install it first (docs/JOBS.md)." }
            Stop-Service $JobsService
            (Get-Service $JobsService).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
            # The server's settings say which jobs run (all are off in the repository): keep them on every update.
            $jobsPackage = Join-Path $Package 'jobs'
            $keep = if (Test-Path (Join-Path $JobsDir 'appsettings.json')) { @('appsettings.json', 'appsettings.*.json') } else { @() }
            Copy-Folder $jobsPackage $JobsDir -KeepFiles $keep
            if ($keep.Count -gt 0) {
                Copy-Item (Join-Path $jobsPackage 'appsettings.json') (Join-Path $JobsDir 'appsettings.package.json') -Force
                Write-Ok "kept the server's Zed.Jobs settings; the repository's are in appsettings.package.json (compare for new jobs)"
            }
            Start-Service $JobsService
            Write-Ok "started $JobsService"
        }

        Write-Step "Test $BaseUrl"
        $tested = @($Apps | ForEach-Object { $catalog[$_].Test })
        $skip = @($catalog.Keys | ForEach-Object { $catalog[$_].Test } | Where-Object { $tested -notcontains $_ })
        $test = @{ BaseUrl = $BaseUrl }
        if ($skip.Count) { $test.Skip = $skip }
        # No visible label on staging (docs/STAGING.md section 4; the Checks refuse a settings file that sets one).
        if ($preset.NoIndex) { $test.ExpectNoIndex = $true }
        Invoke-DeployScript 'Test-ZedDeployment.ps1' $test -ExitCode
        Write-Ok "$newVersion is installed and answers."
    }
    catch {
        $failure = $_
        Write-Host "   FAILED: $($failure.Exception.Message)" -ForegroundColor Red
        if ($NoAutoRollback) {
            Write-Host "   To put the previous files back: .\deploy\Update-ZedFromGit.ps1 -Rollback $backup -Apply" -ForegroundColor Yellow
            if (-not $installed) { Write-Host '   The install stopped half way: a portal may still show "being updated" (app_offline.htm) until then.' -ForegroundColor Yellow }
        }
        else {
            # Also when Install-ZedIis.ps1 stopped half way: a portal it reached is offline or half copied.
            Write-Host '   Putting the previous files back.' -ForegroundColor Yellow
            try { Restore-Backup $backup }
            catch { Write-Host "   The restore failed too: $($_.Exception.Message). Run .\deploy\Update-ZedFromGit.ps1 -Rollback $backup -Apply" -ForegroundColor Red }
            # A portal with nothing to restore (new on this server) must not stay on "being updated" either.
            Remove-OfflinePages $Apps
        }
        if (-not $installed) {
            $iisRollback = Get-ChildItem $InstallRoot -Filter 'rollback-*.json' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $started } |
                Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($iisRollback) { Write-Host "   IIS settings the install changed (app pools, applications): .\deploy\Install-ZedIis.ps1 -Rollback $($iisRollback.FullName) -Apply" -ForegroundColor Yellow }
        }
        throw $failure
    }

    # Old packages (zed-* with VERSION.txt) and backups (with backup.json): the newest -KeepReleases of each stay.
    # Nothing else in those folders is touched (the build checkout _src, a checkout of these scripts, zips).
    foreach ($set in @(@{ Dir = (Join-Path $InstallRoot 'backups'); Mark = 'backup.json' }, @{ Dir = $ReleasesRoot; Mark = 'VERSION.txt' })) {
        if (-not (Test-Path $set.Dir)) { continue }
        Get-ChildItem $set.Dir -Directory |
            Where-Object { ($set.Mark -eq 'backup.json' -or $_.Name -like 'zed-*') -and (Test-Path (Join-Path $_.FullName $set.Mark)) } |
            Where-Object { $_.FullName -ne $Package -and -not $PSScriptRoot.StartsWith($_.FullName, [StringComparison]::OrdinalIgnoreCase) } |
            Sort-Object LastWriteTime -Descending | Select-Object -Skip $KeepReleases |
            ForEach-Object { Remove-Item $_.FullName -Recurse -Force; Write-Note "removed old $($_.FullName)" }
    }
    # Database backups are large: those in the backup folders (the default place) stay for the newest -KeepDatabaseBackups
    # updates only. A -DatabaseBackupDir elsewhere is the DBA's to tidy.
    $backupsDir = Join-Path $InstallRoot 'backups'
    if (Test-Path $backupsDir) {
        Get-ChildItem $backupsDir -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'database') } |
            Sort-Object Name -Descending | Select-Object -Skip $KeepDatabaseBackups |
            ForEach-Object { Remove-Item (Join-Path $_.FullName 'database') -Recurse -Force; Write-Note "removed old database backups in $($_.FullName)" }
    }
    Write-Step "Done: $newVersion. Backup of the previous files: $backup. Log: $log"
    if ($databaseBackups.Count) { Write-Note "Database backups taken before the migrations: $($databaseBackups -join ', ')" }
}
finally {
    Stop-Transcript | Out-Null
}
