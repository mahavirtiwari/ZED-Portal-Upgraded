<#
.SYNOPSIS
  Runs the staging install of V4 on zedv3.qci.org.in (docs/STAGING.md) one step at a time, from the release package.
.DESCRIPTION
  Every step previews unless -Apply is given. Run them in this order, in an administrator PowerShell in the package
  folder (E:\Releases\zed-<version>):

    Check            read-only checks of the server and the package
    Databases        the seven ZEDV4_ databases from the schema scripts (database\setup.ps1)
    Migrations       migrations 0001-0010 and the mail outbox 0003
    Fixes            the procedure fixes (all but main/02, main/13, consultancy/06b, msdb/01)
    ReferenceData    reference tables from a read-only source (-SourceServer)
    ProcedureLinks   procedures re-created with https://zedv3.qci.org.in (-ExpectedServerName)
    Settings         creates E:\ZedV4\settings.json from the template, then checks it (names only, never values)
    Keys             merges a keys file (deploy\Export-ZedLegacyKeys.ps1) into the settings file and, once the site
                     is installed, into the app pools it concerns (-KeysFile); also later, without a reinstall
    Site             storage folders and the IIS site ZEDV4 (Install-ZedIis.ps1)
    Jobs             the Zed.Jobs Windows service (not started)
    Logins           Windows logins for the app pools and Zed.Jobs; then restarts the pools and starts Zed.Jobs
    Accounts         first staff accounts; MasterAdmin one-time links on screen (-ExpectedServerName)
    CutoverFix       main/02, as on the cut-over night
    Test             Test-ZedDeployment.ps1 against https://zedv3.qci.org.in

  Also: Rollback (undo the IIS install, -RollbackFile) and TearDown (remove everything V4 staging created).

  The database steps also run from a plain Git checkout (they need only database\ and deploy\); Site and Jobs need
  the built package. The old ZED databases on the instance are never named: every database this script touches
  starts with ZEDV4_. A log of each step (except Accounts, which shows one-time links) is written to
  E:\ZedStaging\logs.
  Windows PowerShell 5.1 or later.
.EXAMPLE
  .\deploy\Invoke-ZedStaging.ps1 -Step Check
.EXAMPLE
  .\deploy\Invoke-ZedStaging.ps1 -Step Databases -Apply
.EXAMPLE
  .\deploy\Invoke-ZedStaging.ps1 -Step ReferenceData -SourceServer prod-mi.example.database.windows.net -Apply
.EXAMPLE
  .\deploy\Invoke-ZedStaging.ps1 -Step Accounts -ExpectedServerName ZEDSTAGING01\SQLEXPRESS -Apply
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Check', 'Databases', 'Migrations', 'Fixes', 'ReferenceData', 'ProcedureLinks', 'Settings', 'Site', 'Jobs',
        'Logins', 'Accounts', 'CutoverFix', 'Test', 'Rollback', 'TearDown', 'Keys')]
    [string]$Step,
    [switch]$Apply,
    # The folder holding database\ and deploy\ (and, for Site and Jobs, the built applications). Default: the parent
    # of this script's folder.
    [string]$Package,
    [string]$SqlServer = '.\SQLEXPRESS',
    # SELECT @@SERVERNAME on the staging instance, as shown by -Step Check. The SQL scripts refuse any other server.
    [string]$ExpectedServerName,
    [string]$SourceServer,
    [System.Management.Automation.PSCredential]$SourceCredential,
    [string]$Settings = 'E:\ZedV4\settings.json',
    [string]$InstallRoot = 'E:\ZedV4',
    [string]$StagingRoot = 'E:\ZedStaging',
    [string]$HostName = 'zedv3.qci.org.in',
    [string]$CertificateThumbprint = '787885A2C39981E31205F66DB5C91FB45315CE86',
    [string[]]$AllowedIpRanges = @(),
    [string]$RollbackFile,
    # Keys step: a JSON file with settings sections, e.g. { "Main": { "Udyam__AccessKey": "..." } }.
    [string]$KeysFile
)

# No Set-StrictMode here: it would carry into the scripts this one calls.
$ErrorActionPreference = 'Stop'

$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $Package) { $Package = Split-Path -Parent $here }
$Package = (Resolve-Path $Package).Path
$deployDir = Join-Path $Package 'deploy'
$dbDir = Join-Path $Package 'database'
$Prefix = 'ZEDV4_'
$BaseUrl = "https://$HostName"
$Databases = 'ZEDCS_V2_LIVE', 'ZED_CONSULTANT', 'ZED_SURVEILLANCE', 'ZED_IMPACT_ASSESSMENT', 'ZED_CENTER_AUDIT_PROFESSIONAL',
    'ZED_CENTER_AUDIT_V2', 'KAWACH' | ForEach-Object { $Prefix + $_ }
$AppPools = 'ZedV4-Main', 'ZedV4-Consultancy', 'ZedV4-Surveillance', 'ZedV4-Mobile-Main', 'ZedV4-Mobile-Consultancy', 'ZedV4-Mobile-Surveillance'
$JobsService = 'ZedJobs'
$JobsDir = Join-Path $InstallRoot 'ZedJobs'
$RunDir = Join-Path $StagingRoot 'run'
# Not applied by the Fixes step: main/02 waits for CutoverFix, main/13 and msdb/01 are run by hand in SSMS (Express has
# no Database Mail), and consultancy/06b is the alternative to 06a.
$FixesNotApplied = 'main/02_sp_get_user_details_master_passwords', 'main/13_xp_cmdshell_report',
    'consultancy/06b_update_column_value_drop_ALTERNATIVE'

# ---------------------------------------------------------------- helpers
function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    OK  $Text" -ForegroundColor Green }
function Write-Bad([string]$Text) { Write-Host "    !!  $Text" -ForegroundColor Red; $script:problems++ }
$script:problems = 0

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run this in an administrator PowerShell.'
    }
}

function Assert-Path([string]$Path, [string]$What) { if (-not (Test-Path $Path)) { throw "$What not found: $Path" } }

# Runs a native tool; returns its output lines and leaves $LASTEXITCODE as the tool set it.
function Invoke-Native([scriptblock]$Command) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Command 2>&1 | ForEach-Object { "$_" } }
    finally { $ErrorActionPreference = $previous }
}

function Invoke-Sql([string]$Query) {
    $out = Invoke-Native { sqlcmd -S $SqlServer -E -C -b -h -1 -W -Q "SET NOCOUNT ON; $Query" }
    if ($LASTEXITCODE -ne 0) { throw "sqlcmd failed: $($out -join ' ')" }
    @($out | Where-Object { $_ -and $_.Trim() })
}

function Get-DatabaseNames { Invoke-Sql 'SELECT name FROM sys.databases ORDER BY name' }

function Assert-ExpectedServer {
    if (-not $ExpectedServerName) { throw "Give -ExpectedServerName (SELECT @@SERVERNAME on the staging instance, shown by -Step Check)." }
    $actual = @(Invoke-Sql 'SELECT @@SERVERNAME')[0].Trim()
    if ($actual -ne $ExpectedServerName) { throw "Connected to $actual, not $ExpectedServerName. Stopping." }
}

# Copies a SQL script to the run folder with DECLARE values replaced; every replacement must match exactly once.
function New-SqlRunCopy([string]$Source, [string]$Name, [hashtable]$Declares, [string]$LoginsBlock) {
    Assert-Path $Source 'SQL script'
    $text = [IO.File]::ReadAllText($Source)
    foreach ($var in $Declares.Keys) {
        $pattern = '(?m)^(DECLARE @' + $var + ' [^=\r\n]+= ).*?;'
        $found = [regex]::Matches($text, $pattern).Count
        if ($found -ne 1) { throw "$Source`: expected one 'DECLARE @$var ... ;' line, found $found." }
        $value = $Declares[$var]
        $text = [regex]::Replace($text, $pattern, { param($m) $m.Groups[1].Value + $value + ';' })
    }
    if ($LoginsBlock) {
        $pattern = '(?s)(INSERT @Logins \(Family, LoginName, Password, DefaultDatabase\) VALUES\r?\n).*?;[ \t]*(\r?\n)'
        if ([regex]::Matches($text, $pattern).Count -lt 1) { throw "$Source`: the INSERT @Logins block was not found." }
        $text = ([regex]$pattern).Replace($text, { param($m) $m.Groups[1].Value + $LoginsBlock + $m.Groups[2].Value }, 1)
    }
    New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
    $target = Join-Path $RunDir $Name
    [IO.File]::WriteAllText($target, $text, (New-Object Text.UTF8Encoding $true))
    $target
}

function Invoke-SqlFile([string]$File) {
    Write-Host "    sqlcmd -i $File"
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & sqlcmd -S $SqlServer -E -C -b -i $File 2>&1 | ForEach-Object { "$_" } | Out-Host }
    finally { $ErrorActionPreference = $previous }
    if ($LASTEXITCODE -ne 0) { throw "The script failed (sqlcmd exit code $LASTEXITCODE). Nothing after the error ran." }
}

function Sql-Literal([string]$Value) { "N'" + $Value.Replace("'", "''") + "'" }

# Runs a script in its own powershell.exe and returns its exit code. Its stderr is shown, not turned into an error here.
function Invoke-ScriptProcess([string]$File, [string[]]$ArgList, [switch]$Capture) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($Capture) {
            $script:captured = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $File @ArgList 2>&1 | ForEach-Object { "$_" })
            $script:captured | Out-Host
        }
        else { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $File @ArgList | Out-Host }
    }
    finally { $ErrorActionPreference = $previous }
    $LASTEXITCODE
}

function Invoke-DatabaseScripts([string[]]$Extra) {
    $script = Join-Path $deployDir 'Invoke-ZedDatabaseScripts.ps1'
    Assert-Path $script 'deploy\Invoke-ZedDatabaseScripts.ps1'
    $common = @('-Server', $SqlServer, '-TrustServerCertificate', '-DatabasePrefix', $Prefix)
    $code = Invoke-ScriptProcess $script ($common + $Extra)
    if ($code -ne 0) { throw "Invoke-ZedDatabaseScripts.ps1 ended with exit code $code (log: database\logs\cutover-*)." }
}

function Read-SettingsFile {
    Assert-Path $Settings 'Settings file'
    Get-Content $Settings -Raw | ConvertFrom-Json
}

function Get-Section($json, [string]$Name) {
    $s = $json.PSObject.Properties[$Name]
    if (-not $s) { return @() }
    @($s.Value.PSObject.Properties | Where-Object { $_.Name -notlike '_*' })
}

function Get-RollbackFile {
    if ($RollbackFile) { Assert-Path $RollbackFile 'Rollback file'; return $RollbackFile }
    $f = Get-ChildItem $InstallRoot -Filter 'rollback-*.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $f) { throw "No rollback file in $InstallRoot. Give -RollbackFile." }
    $f.FullName
}

# ---------------------------------------------------------------- start
Assert-Admin
foreach ($root in $InstallRoot, $StagingRoot, $Settings) {
    if ($root -match '^[Dd]:') { throw "$root is on D:, the Azure temporary disk (wiped on redeploy). Use E:." }
}
if (-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) { throw 'sqlcmd is not on the PATH.' }
Assert-Path $dbDir 'database folder'
Assert-Path $deployDir 'deploy folder'

$transcript = $null
if ($Step -ne 'Accounts') {
    $logDir = Join-Path $StagingRoot 'logs'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $transcript = Join-Path $logDir ("{0}-{1}{2}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $Step, $(if ($Apply) { '-apply' } else { '' }))
    Start-Transcript -Path $transcript | Out-Null
}
$started = Get-Date
$mode = if ($Apply) { 'APPLY' } else { 'PREVIEW (add -Apply to run it)' }
Write-Host "ZED V4 staging - step $Step - $mode" -ForegroundColor White
Write-Host "Package: $Package"
if (Test-Path (Join-Path $Package 'VERSION.txt')) { Get-Content (Join-Path $Package 'VERSION.txt') | Select-Object -First 2 | ForEach-Object { Write-Host "         $_" } }

try {
    switch ($Step) {

        'Check' {
            Write-Step 'Server'
            $tz = (Get-TimeZone).Id
            if ($tz -eq 'India Standard Time') { Write-Ok "time zone $tz" } else { Write-Bad "time zone is $tz, not India Standard Time (the procedures use the server clock)" }
            if (Test-Path "$env:SystemRoot\System32\inetsrv\rewrite.dll") { Write-Ok 'URL Rewrite installed: http is redirected to https' }
            else { Write-Host '    --  URL Rewrite not installed: http stays at 404, testers use https://' -ForegroundColor Yellow }
            $ancm = "$env:ProgramFiles\IIS\Asp.Net Core Module\V2\aspnetcorev2.dll", "$env:SystemRoot\System32\inetsrv\aspnetcorev2.dll"
            if ($ancm | Where-Object { Test-Path $_ }) { Write-Ok 'ASP.NET Core Module V2' } else { Write-Bad 'ASP.NET Core Module V2 (Hosting Bundle) is not installed' }
            $dotnet = Join-Path $env:ProgramFiles 'dotnet\dotnet.exe'
            if ((Test-Path $dotnet) -and (& $dotnet --list-runtimes | Where-Object { $_ -match '^Microsoft\.AspNetCore\.App 10\.' })) { Write-Ok 'ASP.NET Core 10 runtime' }
            else { Write-Bad 'ASP.NET Core 10 runtime not found' }
            $cert = Get-ChildItem "Cert:\LocalMachine\My\$CertificateThumbprint" -ErrorAction SilentlyContinue
            if (-not $cert) { Write-Bad "certificate $CertificateThumbprint not in Local Computer > Personal" }
            elseif ($cert.NotAfter -lt (Get-Date).AddDays(14)) { Write-Bad "certificate expires $($cert.NotAfter)" }
            else { Write-Ok "certificate $($cert.Subject), valid to $($cert.NotAfter.ToString('yyyy-MM-dd'))" }
            $e = Get-PSDrive E -ErrorAction SilentlyContinue
            if (-not $e) { Write-Bad 'no drive E:' } elseif ($e.Free -lt 30GB) { Write-Bad ("E: has only {0:N0} GB free" -f ($e.Free / 1GB)) } else { Write-Ok ("E: {0:N0} GB free" -f ($e.Free / 1GB)) }

            Write-Step "SQL Server $SqlServer"
            $name = @(Invoke-Sql 'SELECT @@SERVERNAME')[0].Trim()
            $version = @(Invoke-Sql "SELECT CAST(SERVERPROPERTY('ProductVersion') AS varchar(20)) + ' ' + CAST(SERVERPROPERTY('Edition') AS varchar(60))")[0].Trim()
            Write-Ok "$version"
            Write-Host "    Server name (give it as -ExpectedServerName): $name" -ForegroundColor Yellow
            $existing = @(Get-DatabaseNames | Where-Object { $_ -like "$Prefix*" })
            if ($existing.Count -eq 0) { Write-Ok 'no ZEDV4_ database yet' }
            else { Write-Host "    --  ZEDV4_ databases already there: $($existing -join ', ')" -ForegroundColor Yellow }

            Write-Step 'Package'
            foreach ($f in 'main', 'consultancy', 'surveillance', 'mobile', 'jobs') {
                if (Test-Path (Join-Path $Package $f)) { Write-Ok "$f\" } else { Write-Host "    --  $f\ missing: fine for the database steps; Site and Jobs need the built package" -ForegroundColor Yellow }
            }
            if (Test-Path $Settings) { Write-Ok "settings file $Settings (check it with -Step Settings)" } else { Write-Host "    --  no $Settings yet (-Step Settings -Apply creates it)" -ForegroundColor Yellow }
            if ($script:problems) { throw "$($script:problems) problem(s) above. Fix them before going on." }
        }

        'Databases' {
            $setup = Join-Path $dbDir 'setup.ps1'
            $dataPath = Join-Path $StagingRoot 'SqlData'
            $before = Get-DatabaseNames
            $existing = @($before | Where-Object { $_ -like "$Prefix*" })
            if ($existing.Count) { throw "ZEDV4_ databases exist already: $($existing -join ', '). setup.ps1 never overwrites them; to start again use -Step TearDown -Apply first." }
            Write-Step "setup.ps1 -DatabasePrefix $Prefix -WithKawachStandIn -DataPath $dataPath"
            Write-Host "    Creates: $($Databases -join ', ')"
            if (-not $Apply) {
                $code = Invoke-ScriptProcess $setup @('-Server', $SqlServer, '-DatabasePrefix', $Prefix, '-ValidateOnly')
                if ($code -ne 0) { throw "setup.ps1 -ValidateOnly failed (exit code $code)." }
                break
            }
            $code = Invoke-ScriptProcess $setup @('-Server', $SqlServer, '-DatabasePrefix', $Prefix, '-WithKawachStandIn', '-DataPath', $dataPath) -Capture
            $done = @($script:captured | Where-Object { $_ -match 'Done\. \d+ of \d+ batches applied, (\d+) failed' }) | Select-Object -Last 1
            $failed = if ($done -match 'applied, (\d+) failed') { [int]$Matches[1] } else { -1 }
            $new = @(Compare-Object $before (Get-DatabaseNames) | Where-Object SideIndicator -eq '=>' | ForEach-Object InputObject)
            $unexpected = @($new | Where-Object { $Databases -notcontains $_ })
            $missing = @($Databases | Where-Object { $new -notcontains $_ })
            if ($unexpected.Count -or $missing.Count) { throw "Databases: unexpected new $($unexpected -join ', '); missing $($missing -join ', ')." }
            Write-Ok "the seven ZEDV4_ databases were created, nothing else"
            if ($code -eq 0 -or ($code -eq 2 -and $failed -eq 23)) { Write-Ok "setup.ps1: $failed failed batches (23 expected: broken in production too)" }
            else { throw "setup.ps1 exit code $code with $failed failed batches; 23 are expected. Read database\logs\failed-batches-*.json." }
        }

        'Migrations' {
            Write-Step 'Migrations 0001-0010 and 0003 (mail outbox)'
            if ($Apply) { Invoke-DatabaseScripts @('-Apply', '-IncludeMailOutbox') } else { Invoke-DatabaseScripts @() }
        }

        'Fixes' {
            $all = foreach ($group in 'main', 'consultancy', 'surveillance') {
                Get-ChildItem (Join-Path $dbDir "fixes\$group") -Filter '*.sql' | Sort-Object Name | ForEach-Object { "$group/$($_.BaseName)" }
            }
            $fixes = @($all | Where-Object { $FixesNotApplied -notcontains $_ })
            Write-Step "$($fixes.Count) fixes"
            $fixes | ForEach-Object { Write-Host "    $_" }
            # One comma-separated value: through powershell.exe -File an array parameter takes only the first of
            # several values; Invoke-ZedDatabaseScripts.ps1 splits on commas.
            if ($Apply) { Invoke-DatabaseScripts @('-Apply', '-SkipMigrations', '-ApplyFixes', ($fixes -join ',')) }
            else {
                Write-Host '    Previewing each fix (live and new definitions saved under database\logs\cutover-<time>\fixes; nothing applied):'
                Invoke-DatabaseScripts @('-Apply', '-SkipMigrations')
            }
        }

        'ReferenceData' {
            if (-not $SourceServer) { throw 'Give -SourceServer: production through a read-only login, or a copy of it. Never the old ZED databases on this server.' }
            if (-not $SourceCredential) { $SourceCredential = Get-Credential -Message "Read-only SQL login on $SourceServer" }
            $copy = Join-Path $dbDir 'staging\Copy-ZedReferenceData.ps1'
            $args2 = @{ SourceServer = $SourceServer; SourceCredential = $SourceCredential; TargetServer = $SqlServer; TargetDatabasePrefix = $Prefix; StagingBaseUrl = $BaseUrl; TrustServerCertificate = $true }
            if ($Apply) { $args2.Apply = $true }
            Write-Step "Reference data from $SourceServer"
            & $copy @args2
            if ($LASTEXITCODE -ne 0) { throw "Copy-ZedReferenceData.ps1 ended with exit code $LASTEXITCODE." }
        }

        'ProcedureLinks' {
            Assert-ExpectedServer
            $file = New-SqlRunCopy (Join-Path $dbDir 'staging\01_prepare_restored_copy.sql') '01_prepare.sql' @{
                Mode               = $(if ($Apply) { "'APPLY'" } else { "'PREVIEW'" })
                ThisIsStaging      = "'YES'"
                ExpectedServerName = (Sql-Literal $ExpectedServerName)
                StagingBaseUrl     = "'$BaseUrl'"
                RewriteModuleHosts = '1'
                DatabasePrefix     = (Sql-Literal $Prefix)
            }
            Write-Step "Procedure links to $BaseUrl"
            Invoke-SqlFile $file
        }

        'Settings' {
            $template = Join-Path $deployDir 'settings.staging.example.json'
            if (-not (Test-Path $Settings)) {
                if (-not $Apply) { Write-Host "    $Settings does not exist. -Apply copies the template there (administrators only)."; break }
                Assert-Path $template 'deploy\settings.staging.example.json'
                New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Settings) | Out-Null
                Copy-Item $template $Settings
                & icacls $Settings /inheritance:r /grant:r 'BUILTIN\Administrators:(F)' 'NT AUTHORITY\SYSTEM:(F)' | Out-Null
                Write-Ok "created $Settings (administrators only). Fill in the empty values in Notepad, then run -Step Settings again."
                Start-Process notepad.exe $Settings
                break
            }
            Write-Step "Checking $Settings (names only; values are never shown)"
            try { $json = Read-SettingsFile } catch { throw "Not valid JSON: $($_.Exception.Message). A missing quote or comma, or a single backslash (write \\)." }
            $sections = 'Common', 'Portals', 'Mobile', 'Main', 'Consultancy', 'Surveillance', 'MobileMain', 'MobileConsultancy', 'MobileSurveillance', 'ZedJobs'
            foreach ($s in $sections) { if (-not $json.PSObject.Properties[$s]) { Write-Bad "section $s missing" } }
            $value = { param($section, $name) $p = (Get-Section $json $section) | Where-Object Name -eq $name; if ($p) { [string]$p.Value } else { $null } }
            foreach ($check in @(
                    @('Common', 'ASPNETCORE_ENVIRONMENT', 'Staging'), @('Common', 'Database__Prefix', $Prefix), @('Common', 'Portal__EnvironmentLabel', 'STAGING'),
                    @('Common', 'Email__RedirectAllTo', 'dev.zed@qcin.org'), @('ZedJobs', 'Email__RedirectAllTo', 'dev.zed@qcin.org'),
                    @('ZedJobs', 'Database__Prefix', $Prefix), @('ZedJobs', 'DOTNET_ENVIRONMENT', 'Staging'), @('ZedJobs', 'Jobs__FolderRename__Enabled', 'false'),
                    @('Mobile', 'Portal__PublicBaseUrl', $BaseUrl))) {
                $v = & $value $check[0] $check[1]
                if ($v -eq $check[2]) { Write-Ok "$($check[0]).$($check[1])" } else { Write-Bad "$($check[0]).$($check[1]) must be '$($check[2])'" }
            }
            foreach ($s in $sections) {
                foreach ($p in (Get-Section $json $s)) {
                    $v = [string]$p.Value
                    if ($p.Name -like '*AllowedRecipientDomains*') { Write-Bad "$s.$($p.Name): remove it (mail to those domains would reach real people)" }
                    if ($p.Name -in 'Erp__Enabled', 'UdyamiBharat__Enabled' -and $v -ne 'false') { Write-Bad "$s.$($p.Name) must be false on staging" }
                    if ($p.Name -like 'ConnectionStrings__*' -and $v -notmatch "Database=$Prefix") { Write-Bad "$s.$($p.Name) does not name a $Prefix database" }
                    if ($p.Name -match '(StorageRoot|KeysPath)$' -and $v -and $v -notlike "$StagingRoot*" -and $v -notlike "$InstallRoot*") { Write-Bad "$s.$($p.Name) is outside $StagingRoot" }
                    if ($v -match '^[Dd]:\\') { Write-Bad "$s.$($p.Name) is on D:" }
                    if ($v -match 'loginzed\.msme\.gov\.in') { Write-Bad "$s.$($p.Name) names the production host" }
                }
            }
            # What the portals check at startup outside Development (Zed.Core ZedConfigurationCheck): a missing one
            # stops that portal with HTTP 500.30. Values merge as the installer does: Common, Portals, then the portal.
            Write-Step 'Settings the portals need at startup'
            foreach ($portal in 'Main', 'Consultancy', 'Surveillance') {
                $merged = @{}
                foreach ($s in 'Common', 'Portals', $portal) { foreach ($p in (Get-Section $json $s)) { $merged[$p.Name] = [string]$p.Value } }
                $required = @('Email__Profiles__Default__Host', 'Email__Profiles__Default__From')
                $captcha = -not ($merged['Recaptcha__Enabled'] -eq 'false')
                if ($captcha) { $required += 'Recaptcha__SiteKey', 'Recaptcha__SecretKey' }
                if ($portal -eq 'Main') {
                    $required += 'CcAvenue__MerchantId', 'CcAvenue__AccessCode', 'CcAvenue__WorkingKey', 'CcAvenue__ReconciliationWorkingKey',
                        'Udyam__AccessKey', 'ProteanGstin__Url', 'ProteanGstin__UserId', 'ProteanGstin__Password'
                    if ($captcha) { $required += 'Recaptcha__AppSecretKey' }
                }
                $missing = @($required | Where-Object { [string]::IsNullOrWhiteSpace($merged[$_]) })
                if ($missing.Count) { Write-Bad "$portal portal will not start without: $($missing -join ', ')" } else { Write-Ok "$portal portal: all set" }
            }
            Write-Step 'Empty values (fill in, or leave empty where docs/STAGING.md 4 allows it)'
            $empty = foreach ($s in $sections) { Get-Section $json $s | Where-Object { [string]::IsNullOrWhiteSpace([string]$_.Value) } | ForEach-Object { "$s.$($_.Name)" } }
            if ($empty) { $empty | ForEach-Object { Write-Host "    --  $_" -ForegroundColor Yellow } } else { Write-Ok 'none' }
            if ($script:problems) { throw "$($script:problems) problem(s) in the settings file." }
        }

        'Keys' {
            if (-not $KeysFile) { throw 'Give -KeysFile (made by deploy\Export-ZedLegacyKeys.ps1 and copied to this server).' }
            Assert-Path $KeysFile 'Keys file'
            try { $keys = Get-Content $KeysFile -Raw | ConvertFrom-Json } catch { throw "The keys file is not valid JSON: $($_.Exception.Message)" }
            $json = Read-SettingsFile
            # The sections each app pool reads, in the installer's order (later wins).
            $poolSections = [ordered]@{
                'ZedV4-Main' = 'Common', 'Portals', 'Main'; 'ZedV4-Consultancy' = 'Common', 'Portals', 'Consultancy'
                'ZedV4-Surveillance' = 'Common', 'Portals', 'Surveillance'; 'ZedV4-Mobile-Main' = 'Common', 'Mobile', 'MobileMain'
                'ZedV4-Mobile-Consultancy' = 'Common', 'Mobile', 'MobileConsultancy'; 'ZedV4-Mobile-Surveillance' = 'Common', 'Mobile', 'MobileSurveillance'
            }
            Write-Step "Keys from $KeysFile (names only; values are never shown)"
            $changes = @()
            foreach ($sec in $keys.PSObject.Properties) {
                if ($sec.Name -like '_*') { continue }
                $target = $json.PSObject.Properties[$sec.Name]
                if (-not $target -or $target.Value -isnot [System.Management.Automation.PSCustomObject]) { throw "Section $($sec.Name) of the keys file is not a section of $Settings." }
                foreach ($p in $sec.Value.PSObject.Properties) {
                    $new = [string]$p.Value
                    if ([string]::IsNullOrWhiteSpace($new)) { continue }
                    if ($p.Name -match '^(ConnectionStrings__|Database__Prefix|Email__RedirectAllTo|ASPNETCORE_ENVIRONMENT|DOTNET_ENVIRONMENT)') { throw "$($sec.Name).$($p.Name) is not changed by a keys file." }
                    $cur = $target.Value.PSObject.Properties[$p.Name]
                    $state = if (-not $cur) { 'added' } elseif ([string]::IsNullOrWhiteSpace([string]$cur.Value)) { 'filled in' } elseif ([string]$cur.Value -ceq $new) { 'unchanged' } else { 'REPLACED (it had another value)' }
                    Write-Host ("    {0,-45} {1}" -f "$($sec.Name).$($p.Name)", $state)
                    if ($state -ne 'unchanged') { $changes += [pscustomobject]@{ Section = $sec.Name; Name = $p.Name; Value = $new } }
                }
            }
            if (-not $changes) { Write-Ok 'nothing to change'; break }
            if (-not $Apply) { Write-Host "    -Apply writes them to $Settings and to the app pools concerned, and restarts those pools."; break }

            foreach ($c in $changes) {
                $section = $json.PSObject.Properties[$c.Section].Value
                if ($section.PSObject.Properties[$c.Name]) { $section.$($c.Name) = $c.Value } else { $section | Add-Member -NotePropertyName $c.Name -NotePropertyValue $c.Value }
            }
            # Overwriting the file keeps its administrators-only ACL; the backup gets the same.
            $backup = "$Settings.bak"
            Copy-Item $Settings $backup -Force
            & icacls $backup /inheritance:r /grant:r 'BUILTIN\Administrators:(F)' 'NT AUTHORITY\SYSTEM:(F)' | Out-Null
            [IO.File]::WriteAllText($Settings, ($json | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
            Write-Ok "$Settings updated ($($changes.Count) value(s); previous version in $backup)"

            Import-Module WebAdministration -ErrorAction SilentlyContinue
            $apphost = 'MACHINE/WEBROOT/APPHOST'
            foreach ($pool in $poolSections.Keys) {
                $sections = $poolSections[$pool]
                $names = @($changes | Where-Object { $sections -contains $_.Section } | ForEach-Object Name | Sort-Object -Unique)
                if (-not $names) { continue }
                if (-not (Get-Module WebAdministration) -or -not (Test-Path "IIS:\AppPools\$pool")) { Write-Host "    --  $pool not installed yet: the install (-Step Site) takes the values from the settings file" -ForegroundColor Yellow; continue }
                $filter = "system.applicationHost/applicationPools/add[@name='$pool']/environmentVariables"
                foreach ($n in $names) {
                    $value = $null
                    foreach ($s in $sections) { $p = (Get-Section $json $s) | Where-Object Name -eq $n; if ($p -and -not [string]::IsNullOrWhiteSpace([string]$p.Value)) { $value = [string]$p.Value } }
                    if (-not $value) { continue }
                    Remove-WebConfigurationProperty -PSPath $apphost -Filter $filter -Name '.' -AtElement @{ name = $n } -ErrorAction SilentlyContinue
                    Add-WebConfigurationProperty -PSPath $apphost -Filter $filter -Name '.' -Value @{ name = $n; value = $value }
                }
                Restart-WebAppPool -Name $pool
                Write-Ok "$pool`: $($names -join ', ') set; pool restarted"
            }
            if (($changes | Where-Object Section -eq 'ZedJobs') -and (Get-Service $JobsService -ErrorAction SilentlyContinue)) {
                $vars = @(Get-Section $json 'ZedJobs' | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.Value) } | ForEach-Object { "$($_.Name)=$($_.Value)" })
                New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$JobsService" -Name Environment -PropertyType MultiString -Value $vars -Force | Out-Null
                if ((Get-Service $JobsService).Status -eq 'Running') { Restart-Service $JobsService }
                Write-Ok "$JobsService environment updated"
            }
            Write-Host "    Delete the keys file now: Remove-Item '$KeysFile'" -ForegroundColor Yellow
        }

        'Site' {
            Assert-Path (Join-Path $Package 'main') 'Built package (main\); build it with deploy\Build-ZedRelease.ps1'
            $json = Read-SettingsFile
            $roots = @(foreach ($s in $json.PSObject.Properties) {
                    if ($s.Name -like '_*' -or $s.Value -isnot [System.Management.Automation.PSCustomObject]) { continue }
                    $s.Value.PSObject.Properties | Where-Object { $_.Name -like '*StorageRoot' -and $_.Value } | ForEach-Object { [string]$_.Value }
                }) | Sort-Object -Unique
            Write-Step 'Storage folders'
            foreach ($r in $roots) {
                if ($r -notlike "$StagingRoot*") { throw "Storage root $r is outside $StagingRoot. Never the production share or E:\Publish." }
                if ($Apply) { New-Item -ItemType Directory -Force -Path $r | Out-Null }
                Write-Host "    $r"
            }
            Write-Step "IIS site ZEDV4 on $HostName"
            $install = @{
                Package = $Package; Settings = $Settings; InstallRoot = $InstallRoot; EnvironmentName = 'Staging'; SiteName = 'ZEDV4'
                CreateSite = $true; HostName = $HostName; CertificateThumbprint = $CertificateThumbprint; HttpRedirect = $true
            }
            if ($AllowedIpRanges.Count) { $install.AllowedIpRanges = $AllowedIpRanges }
            if ($Apply) { $install.Apply = $true }
            & (Join-Path $deployDir 'Install-ZedIis.ps1') @install
            if ($Apply) { Write-Ok "Keep the rollback file: $(Get-RollbackFile)" }
        }

        'Jobs' {
            $source = Join-Path $Package 'jobs'
            Assert-Path (Join-Path $source 'Zed.Jobs.exe') 'Built package (jobs\Zed.Jobs.exe)'
            $json = Read-SettingsFile
            # Empty values are left out: they would override appsettings.json with "".
            $vars = @(Get-Section $json 'ZedJobs' | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.Value) } | ForEach-Object { "$($_.Name)=$($_.Value)" })
            $svc = Get-Service $JobsService -ErrorAction SilentlyContinue
            Write-Step "Zed.Jobs service in $JobsDir (account NT SERVICE\$JobsService, not started)"
            Write-Host "    Environment: $(($vars | ForEach-Object { $_.Split('=')[0] }) -join ', ')"
            if (-not $Apply) { Write-Host "    Service $(if ($svc) { 'exists: its files and environment are replaced' } else { 'is created' })."; break }
            if ($svc -and $svc.Status -ne 'Stopped') { Stop-Service $JobsService; (Get-Service $JobsService).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60)) }
            New-Item -ItemType Directory -Force -Path $JobsDir | Out-Null
            Copy-Item (Join-Path $source '*') $JobsDir -Recurse -Force
            if (-not $svc) {
                $out = Invoke-Native { sc.exe create $JobsService binPath= "$JobsDir\Zed.Jobs.exe" start= delayed-auto obj= "NT SERVICE\$JobsService" DisplayName= 'ZED V4 Jobs (staging)' }
                if ($LASTEXITCODE -ne 0) { throw "sc.exe create failed: $($out -join ' ')" }
            }
            & icacls $JobsDir /grant "NT SERVICE\$($JobsService):(OI)(CI)M" | Out-Null
            New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$JobsService" -Name Environment -PropertyType MultiString -Value $vars -Force | Out-Null
            Write-Ok 'installed. It starts after its login exists (-Step Logins -Apply).'
        }

        'Logins' {
            $rows = @(
                "    ('app',  N'IIS APPPOOL\ZedV4-Main',                NULL, N'ZEDCS_V2_LIVE'),",
                "    ('app',  N'IIS APPPOOL\ZedV4-Consultancy',         NULL, N'ZED_CONSULTANT'),",
                "    ('app',  N'IIS APPPOOL\ZedV4-Surveillance',        NULL, N'ZED_SURVEILLANCE'),",
                "    ('app',  N'IIS APPPOOL\ZedV4-Mobile-Main',         NULL, N'ZEDCS_V2_LIVE'),",
                "    ('app',  N'IIS APPPOOL\ZedV4-Mobile-Consultancy',  NULL, N'ZED_CONSULTANT'),",
                "    ('app',  N'IIS APPPOOL\ZedV4-Mobile-Surveillance', NULL, N'ZED_SURVEILLANCE'),",
                "    ('jobs', N'NT SERVICE\$JobsService',                    NULL, N'ZEDCS_V2_LIVE');") -join "`r`n"
            Import-Module WebAdministration
            $missingPools = @($AppPools | Where-Object { -not (Test-Path "IIS:\AppPools\$_") })
            if ($missingPools.Count) { throw "App pools missing: $($missingPools -join ', '). Run -Step Site -Apply first." }
            if (-not (Get-Service $JobsService -ErrorAction SilentlyContinue)) { throw 'The ZedJobs service is missing. Run -Step Jobs -Apply first (its login needs the service).' }
            $file = New-SqlRunCopy (Join-Path $dbDir 'security\01_v4_logins_and_roles.sql') '01_logins.sql' @{
                Mode           = $(if ($Apply) { "'APPLY'" } else { "'PREVIEW'" })
                AuthMode       = "'WINDOWS'"
                DatabasePrefix = (Sql-Literal $Prefix)
            } $rows
            Write-Step 'Windows logins for the six app pools and Zed.Jobs (ZEDV4_ databases only)'
            Invoke-SqlFile $file
            if ($Apply) {
                Write-Step 'Restarting the app pools and starting Zed.Jobs'
                foreach ($p in $AppPools) {
                    if ((Get-WebAppPoolState -Name $p).Value -eq 'Started') { Restart-WebAppPool -Name $p } else { Start-WebAppPool -Name $p }
                    Write-Ok $p
                }
                Start-Service $JobsService
                (Get-Service $JobsService).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
                Write-Ok "$JobsService running"
            }
        }

        'Accounts' {
            Assert-ExpectedServer
            $file = New-SqlRunCopy (Join-Path $dbDir 'staging\03_first_accounts.sql') '03_accounts.sql' @{
                Mode               = $(if ($Apply) { "'APPLY'" } else { "'PREVIEW'" })
                ThisIsStaging      = "'YES'"
                ExpectedServerName = (Sql-Literal $ExpectedServerName)
                DatabasePrefix     = (Sql-Literal $Prefix)
                StagingBaseUrl     = "'$BaseUrl'"
            }
            Write-Step 'First accounts (no log file: the one-time links are shown on screen only)'
            Invoke-SqlFile $file
            if ($Apply) { Write-Host '    Each link is valid for 24 hours: open it, set the MasterAdmin password, then clear this window (cls).' -ForegroundColor Yellow }
        }

        'CutoverFix' {
            Write-Step 'main/02_sp_get_user_details_master_passwords (as at the cut-over, CUTOVER 2.1 0:50)'
            if ($Apply) { Invoke-DatabaseScripts @('-Apply', '-SkipMigrations', '-AtCutover', '-ApplyFixes', 'main/02_sp_get_user_details_master_passwords') }
            else { Write-Host '    Applies main/02 once the site serves /Msme/ZedDashboard. Its preview is in the Fixes step.' }
        }

        'Test' {
            $test = @('-BaseUrl', $BaseUrl, '-ExpectEnvironmentLabel', 'STAGING')
            if (Test-Path "$env:SystemRoot\System32\inetsrv\rewrite.dll") { $test += '-CheckHttpsRedirect' }
            Write-Step "Test-ZedDeployment.ps1 $BaseUrl"
            $code = Invoke-ScriptProcess (Join-Path $deployDir 'Test-ZedDeployment.ps1') $test
            if ($code -ne 0) { throw 'Test-ZedDeployment.ps1 reported failures (0 required).' }
            Write-Ok '0 failures. By hand: the STAGING banner shows; a password reset mail arrives at dev.zed@qcin.org.'
        }

        'Rollback' {
            $file = Get-RollbackFile
            Write-Step "Rollback with $file"
            if ($Apply -and (Get-Service $JobsService -ErrorAction SilentlyContinue)) { Stop-Service $JobsService }
            $rb = @{ Rollback = $file; SiteName = 'ZEDV4' }
            if ($Apply) { $rb.Apply = $true }
            & (Join-Path $deployDir 'Install-ZedIis.ps1') @rb
            if ($Apply) { Write-Host '    To install again: -Step Site -Apply, then Start-Service ZedJobs.' }
        }

        'TearDown' {
            $present = @(Get-DatabaseNames | Where-Object { $Databases -contains $_ })
            Write-Step 'Tear-down of V4 staging'
            Write-Host "    Service:   $JobsService (stopped and deleted)"
            Write-Host "    IIS:       site ZEDV4, its app pools and bindings (rollback file)"
            Write-Host "    Databases: $(if ($present) { $present -join ', ' } else { 'none present' })"
            Write-Host "    Folders:   $StagingRoot, $InstallRoot (with the settings file)"
            if (-not $Apply) { break }
            $answer = Read-Host 'Type TEAR DOWN to remove all of the above'
            if ($answer -ne 'TEAR DOWN') { throw 'Not confirmed; nothing removed.' }
            if (Get-Service $JobsService -ErrorAction SilentlyContinue) {
                Stop-Service $JobsService -ErrorAction SilentlyContinue
                Invoke-Native { sc.exe delete $JobsService } | Out-Null
                Write-Ok "$JobsService removed"
            }
            # Each install's rollback file undoes that install (newest first); whatever is left of the site goes after.
            foreach ($rb in @(Get-ChildItem $InstallRoot -Filter 'rollback-*.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
                try { & (Join-Path $deployDir 'Install-ZedIis.ps1') -Rollback $rb.FullName -SiteName ZEDV4 -Apply }
                catch { Write-Host "    --  $($rb.Name): $($_.Exception.Message)" -ForegroundColor Yellow }
            }
            Import-Module WebAdministration
            if (Get-Website -Name ZEDV4) {
                Clear-WebConfiguration -PSPath 'MACHINE/WEBROOT/APPHOST' -Location ZEDV4 -Filter "system.webServer/rewrite/rules/rule[@name='ZED-HTTPS']" -ErrorAction SilentlyContinue
                Remove-Website -Name ZEDV4
            }
            Write-Ok 'site ZEDV4 removed'
            foreach ($p in $AppPools) { if (Test-Path "IIS:\AppPools\$p") { Remove-WebAppPool -Name $p; Write-Ok "app pool $p removed" } }
            $ssl = Invoke-Native { netsh http show sslcert "hostnameport=$($HostName):443" }
            if ($LASTEXITCODE -eq 0 -and ($ssl -match 'Certificate Hash')) {
                Invoke-Native { netsh http delete sslcert "hostnameport=$($HostName):443" } | Out-Null
                Write-Ok "certificate binding $($HostName):443 removed"
            }
            foreach ($d in $present) {
                if ($d -notlike "$Prefix*") { throw "Refusing to drop $d." }
                Invoke-Sql "ALTER DATABASE [$d] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$d];" | Out-Null
                Write-Ok "dropped $d"
            }
            if ($transcript) { Stop-Transcript | Out-Null; $transcript = $null }
            foreach ($f in $StagingRoot, $InstallRoot) { if (Test-Path $f) { Remove-Item $f -Recurse -Force; Write-Ok "removed $f" } }
        }
    }
    Write-Host ("Step {0} finished in {1:mm\:ss}." -f $Step, ((Get-Date) - $started)) -ForegroundColor Green
}
finally {
    if ($transcript) { Stop-Transcript | Out-Null; Write-Host "Log: $transcript" }
}
