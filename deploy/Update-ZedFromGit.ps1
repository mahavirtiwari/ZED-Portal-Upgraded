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
                    <InstallRoot>\backups\<time>\ (logs\ left out) with backup.json.
    4. Migrations   Invoke-ZedDatabaseScripts.ps1 -Apply -SkipFixes (the migrations are additive and safe to re-run;
                    -IncludeMailOutbox runs 0003 again, which the Email Templates need once). -SkipMigrations skips it.
    5. Install      Install-ZedIis.ps1 -Apply for -Apps (default: the three web portals; -IncludeMobile adds the three
                    mobile hosts). App pool settings come from the settings file as before.
    6. Jobs         with -IncludeJobs: stops the Zed.Jobs service, replaces its files, starts it again.
    7. Test         Test-ZedDeployment.ps1 against -BaseUrl, for the applications installed. When it fails, the files
                    of step 3 are put back and the pools restarted (unless -NoAutoRollback). The database changes stay:
                    they are additive and the previous version runs on them.

  -Rollback <backup folder> -Apply puts a backup back by hand (for example the day after an update).
  -Environment Staging (default) or Production chooses the site, the database prefix, the address and the test
  options; every one of them can also be given on its own. Log: <InstallRoot>\logs\update-<time>.log.
  Windows PowerShell 5.1 or later, in an administrator PowerShell.

.EXAMPLE
  .\deploy\Update-ZedFromGit.ps1
  Dry run on staging: shows the installed version, the commit main points at and the database plan. Nothing changes.
.EXAMPLE
  .\deploy\Update-ZedFromGit.ps1 -Apply -IncludeMailOutbox
  Staging: builds main, backs up, runs the migrations (and 0003 again), installs the three portals, tests.
.EXAMPLE
  .\deploy\Update-ZedFromGit.ps1 -Ref 254cfd6 -IncludeMobile -IncludeJobs -Apply
  A chosen commit, with the mobile hosts and Zed.Jobs.
.EXAMPLE
  .\deploy\Update-ZedFromGit.ps1 -Package E:\Releases\zed-2026.10.24-1700-254cfd6.zip -Apply
  Installs a package built elsewhere (Build-ZedRelease.ps1 on a build PC), without building on the server.
.EXAMPLE
  .\deploy\Update-ZedFromGit.ps1 -Rollback E:\ZedV4\backups\20261024-1712 -Apply
.EXAMPLE
  .\deploy\Update-ZedFromGit.ps1 -Environment Production -SqlServer PRODSQL01 -Settings E:\ZedV4\settings.json -Apply
#>
[CmdletBinding(DefaultParameterSetName = 'Update')]
param(
    [ValidateSet('Staging', 'Production')][string]$Environment = 'Staging',
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
    [Parameter(ParameterSetName = 'Update')][switch]$SkipTests,
    [Parameter(ParameterSetName = 'Update')][switch]$NoAutoRollback,
    [Parameter(ParameterSetName = 'Update')][int]$KeepReleases = 5,
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

# Per environment; anything given on the command line wins.
$preset = @{
    Staging    = @{ SiteName = 'ZEDV4'; DatabasePrefix = 'ZEDV4_'; SqlServer = '.\SQLEXPRESS'; BaseUrl = 'https://zedv3.qci.org.in'; Trust = $true; NoIndex = $true }
    Production = @{ SiteName = 'Default Web Site'; DatabasePrefix = ''; SqlServer = $null; BaseUrl = 'https://loginzed.msme.gov.in'; Trust = $false; NoIndex = $false }
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

function Copy-Folder([string]$From, [string]$To) {
    New-Item -ItemType Directory -Force -Path $To | Out-Null
    & robocopy $From $To /MIR /R:3 /W:5 /NFL /NDL /NJH /NJS /NP /XD logs /XF app_offline.htm | Out-Null
    # robocopy: 0-7 is success (files copied, extra files removed, ...), 8 and above is a failure.
    if ($LASTEXITCODE -ge 8) { throw "robocopy $From -> $To failed (exit code $LASTEXITCODE)." }
    $global:LASTEXITCODE = 0
}

# Puts a backup folder back: app_offline.htm while copying, then the pools (and Zed.Jobs) restart.
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
    [pscustomobject]@{ Version = (Get-InstalledVersion); Taken = (Get-Date -Format s); Apps = $backedUp; Jobs = $jobsBackedUp; Replacing = $newVersion } |
        ConvertTo-Json | Set-Content (Join-Path $backup 'backup.json') -Encoding UTF8

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
            Copy-Folder (Join-Path $Package 'jobs') $JobsDir
            Start-Service $JobsService
            Write-Ok "started $JobsService"
        }

        Write-Step "Test $BaseUrl"
        $tested = @($Apps | ForEach-Object { $catalog[$_].Test })
        $skip = @($catalog.Keys | ForEach-Object { $catalog[$_].Test } | Where-Object { $tested -notcontains $_ })
        $test = @{ BaseUrl = $BaseUrl }
        if ($skip.Count) { $test.Skip = $skip }
        if ($preset.NoIndex) { $test.ExpectNoIndex = $true }
        Invoke-DeployScript 'Test-ZedDeployment.ps1' $test -ExitCode
        Write-Ok "$newVersion is installed and answers."
    }
    catch {
        Write-Host "   FAILED: $($_.Exception.Message)" -ForegroundColor Red
        if ($NoAutoRollback -or -not ($installed -or $IncludeJobs)) {
            Write-Host "   To put the previous files back: .\deploy\Update-ZedFromGit.ps1 -Rollback $backup -Apply" -ForegroundColor Yellow
        }
        else {
            Write-Host '   Putting the previous files back.' -ForegroundColor Yellow
            Restore-Backup $backup
        }
        throw
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
    Write-Step "Done: $newVersion. Backup of the previous files: $backup. Log: $log"
}
finally {
    Stop-Transcript | Out-Null
}
