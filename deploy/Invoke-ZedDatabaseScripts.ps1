<#
.SYNOPSIS
    Runs the database steps of docs/CUTOVER.md 1.4 (V4 migrations and the reviewed fix scripts) in the right order,
    against the right databases, with a log per script.

.DESCRIPTION
    Dry run by default: checks the server and the databases, shows for every migration whether its objects already
    exist, and prints the plan. Nothing is executed. With -Apply:

      1. Migrations, in this order (each on its databases; "safe to re-run" scripts, so an applied one just repeats):
           0001 all three | 0002 ZEDCS_V2_LIVE | 0004 ZEDCS_V2_LIVE | 0005 all three |
           0006 all three (only with -IncludeDistributedCache) | 0007 ZEDCS_V2_LIVE | 0008 all three | 0009 ZEDCS_V2_LIVE | 0010 ZED_CONSULTANT
         The run stops at the first migration that fails.
      2. Fix scripts (database\fixes\<db>\*.sql), each in PREVIEW, which changes nothing. For every procedure a fix
         touches, the runner saves the live definition (live\<proc>.sql: the undo) and, where the script prints it,
         the new definition (new\<proc>.sql), so the DBA can diff them. Scripts without a full-definition printout
         (all but main 05-12, which have @PrintDefinitions) are reviewed by their pattern list (in the script)
         against the saved live definition.
         A fix runs in APPLY only when named in -ApplyFixes (exact names, no wildcards). Refused there:
           main/02_sp_get_user_details_master_passwords  unless -AtCutover (it breaks the old Udyami Bharat hand-over;
                                                           CUTOVER 2.1 step 0:50)
           msdb/01_report_profile_qci_mailbox            needs the mailbox password: run it in SSMS
           main/13_xp_cmdshell_report                    a report; to switch xp_cmdshell off, run it in SSMS
           consultancy/06a and 06b together              they are alternatives
         A failing fix (for example "live text differs from the reviewed copy") is marked and the run goes on.
      3. migrations\0003_mail_outbox.sql, only with -IncludeMailOutbox, last (CUTOVER 1.4 step 7). From then on the
         procedure mail of the old sites is queued for Zed.Jobs: run it only together with starting Zed.Jobs and
         switching the old SQL Agent jobs off (docs/JOBS.md "Before go-live").

    Logs go to -LogDir (default database\logs\cutover-<time>): one file per script and database, the fix review
    folders, and summary.txt / summary.json. The exit code is 0 only when every executed step succeeded.
    Passwords are never written: SQL authentication takes a PSCredential and hands the password to sqlcmd through
    the process environment.

.PARAMETER Server
    SQL Server instance. Default localhost\SQLEXPRESS.
.PARAMETER Credential
    SQL authentication (Get-Credential). Without it, Windows authentication.
.PARAMETER TrustServerCertificate
    Pass -C to sqlcmd (self-signed certificates, local and staging servers).
.PARAMETER Apply
    Execute the plan. Without it nothing runs.
.PARAMETER IncludeDistributedCache
    Include migration 0006 (only for Cache:SqlServerTable, more than one server per application).
.PARAMETER IncludeMailOutbox
    Include migration 0003 (with starting Zed.Jobs and switching the Agent jobs off).
.PARAMETER ApplyFixes
    Fix scripts to run in APPLY after their preview, e.g. 'main/05_mail_passwords','surveillance/04_photos_and_nc_history'.
.PARAMETER AtCutover
    Allows main/02_sp_get_user_details_master_passwords in -ApplyFixes.
.PARAMETER SkipMigrations
    Do not run migrations (for example to preview the fixes again).
.PARAMETER SkipFixes
    Do not run the fix scripts.
.PARAMETER LogDir
    Output folder.
.PARAMETER DatabasePrefix
    Run against a prefixed set (database\setup.ps1 -DatabasePrefix), e.g. ZEDV4_ for ZEDV4_ZEDCS_V2_LIVE, ... . Every
    script is run from a copy whose database names (USE, three-part names, DB_ID('X')) are mapped to the prefixed
    names (database\ZedDatabaseNames.ps1); the copies are kept under <LogDir>\scripts-as-run. The plan and the
    -ApplyFixes names stay logical (main/05_mail_passwords). Databases without the prefix are not touched.

.EXAMPLE
    .\deploy\Invoke-ZedDatabaseScripts.ps1 -Server PRODSQL01 -TrustServerCertificate
    Dry run: checks and plan.
.EXAMPLE
    .\deploy\Invoke-ZedDatabaseScripts.ps1 -Server PRODSQL01 -Apply
    Migrations, then every fix in PREVIEW with its review folders.
.EXAMPLE
    .\deploy\Invoke-ZedDatabaseScripts.ps1 -Server PRODSQL01 -Apply -SkipMigrations -ApplyFixes 'main/05_mail_passwords','main/06_payment_procedure_defects'
    Applies two reviewed fixes (each is previewed first and its live definitions saved).
#>
[CmdletBinding()]
param(
    [string]$Server = 'localhost\SQLEXPRESS',
    [System.Management.Automation.PSCredential]$Credential,
    [switch]$TrustServerCertificate,
    [switch]$Apply,
    [switch]$IncludeDistributedCache,
    [switch]$IncludeMailOutbox,
    [string[]]$ApplyFixes = @(),
    [switch]$AtCutover,
    [switch]$SkipMigrations,
    [switch]$SkipFixes,
    [string]$LogDir = '',
    [string]$DatabasePrefix = ''
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$repo = Split-Path -Parent $here
$dbDir = Join-Path $repo 'database'
if (-not $LogDir) { $LogDir = Join-Path $dbDir ('logs\cutover-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) }
. (Join-Path $dbDir 'ZedDatabaseNames.ps1')
Test-ZedDatabasePrefix $DatabasePrefix
# The plan uses the logical names; sqlcmd gets the name on the instance.
function Phys([string]$db) { Get-ZedDatabaseName $db $DatabasePrefix }

$Main = 'ZEDCS_V2_LIVE'; $Cons = 'ZED_CONSULTANT'; $Surv = 'ZED_SURVEILLANCE'
$Zed = @($Main, $Cons, $Surv)
$Related = @('ZED_CENTER_AUDIT_PROFESSIONAL', 'ZED_CENTER_AUDIT_V2', 'ZED_IMPACT_ASSESSMENT', 'KAWACH', 'ZED_QUALITY_PROFESSIONAL')

# Migrations of CUTOVER 1.4, in order, with the objects that show whether they are applied.
$Migrations = @(
    @{ File = '0001_mobile_devices.sql';        Dbs = $Zed;      Markers = @('U:dbo.MobileDeviceBindings', 'U:dbo.MobileDeviceEvents') }
    @{ File = '0002_api_incentives_index.sql';  Dbs = @($Main);  Markers = @('I:dbo.ApiIncentives.IX_ApiIncentives_UdyamNo') }
    @{ File = '0004_job_runs.sql';              Dbs = @($Main);  Markers = @('U:dbo.V4JobRuns') }
    @{ File = '0005_password_hashes.sql';       Dbs = $Zed;      Markers = @('U:dbo.V4UserPasswords', 'P:dbo.SP_V4_GET_PASSWORD', 'P:dbo.SP_V4_SET_PASSWORD_HASH', 'P:dbo.SP_V4_PURGE_PLAIN_PASSWORDS') }
    @{ File = '0006_distributed_cache.sql';     Dbs = $Zed;      Markers = @('U:dbo.V4Cache'); Optional = 'IncludeDistributedCache' }
    @{ File = '0007_folder_rename.sql';         Dbs = @($Main);  Markers = @('U:dbo.V4FolderRenameResults', 'P:dbo.SP_V4_FOLDER_RENAME_PENDING', 'P:dbo.SP_V4_FOLDER_RENAME_RECORD') }
    @{ File = '0008_staff_password_reset.sql';  Dbs = $Zed;      Markers = @('U:dbo.V4PasswordResets', 'P:dbo.SP_V4_STAFF_RESET_ACCOUNT', 'P:dbo.SP_V4_STAFF_RESET_CREATE', 'P:dbo.SP_V4_STAFF_RESET_FIND', 'P:dbo.SP_V4_STAFF_RESET_USE') }
    @{ File = '0009_msme_password_reset.sql';   Dbs = @($Main);  Markers = @('P:dbo.SP_V4_MSME_RESET_ACCOUNT', 'P:dbo.SP_V4_MSME_RESET_FIND', 'P:dbo.SP_V4_MSME_RESET_USE', 'P:dbo.SP_V4_PURGE_LEGACY_RESET_CODES') }
    @{ File = '0010_app_sessions.sql';          Dbs = @($Cons);  Markers = @('U:dbo.V4AppSessions') }
)
$MailOutbox = @{ File = '0003_mail_outbox.sql'; Dbs = $Zed; Markers = @('U:dbo.V4MailOutbox', 'P:dbo.SP_V4_SEND_DBMAIL') }
$NeverApply = @{
    'msdb/01_report_profile_qci_mailbox' = 'needs the mailbox password: run it in SSMS (docs/JOBS.md "Mail")'
    'main/13_xp_cmdshell_report'         = 'is a report; to switch xp_cmdshell off set @DisableXpCmdShell = 1 and run it in SSMS'
}
$ModeLine = "DECLARE @Mode varchar(10) = 'PREVIEW';"
$PrintLine = 'DECLARE @PrintDefinitions bit = 0;'

# ---------------------------------------------------------------- sqlcmd
$sqlcmd = (Get-Command sqlcmd -ErrorAction SilentlyContinue)
if (-not $sqlcmd) { throw 'sqlcmd was not found. Install the SQL Server command line tools (sqlcmd).' }
$sqlcmd = $sqlcmd.Source
function Get-SqlArgs([string]$db, [bool]$wide) {
    # -y 0: long text (definitions) is not cut; it cannot be combined with -W, which the short queries use.
    $a = @('-S', $Server, '-d', (Phys $db), '-b', '-f', 'i:65001,o:65001')
    if ($wide) { $a += @('-y', '0') }
    if ($Credential) { $a += @('-U', $Credential.UserName) } else { $a += '-E' }
    if ($TrustServerCertificate) { $a += '-C' }
    return $a
}
function Invoke-Sqlcmd2([string]$db, [string[]]$extra, [string]$outFile) {
    $a = (Get-SqlArgs $db (-not ($extra -contains '-W'))) + $extra + @('-o', $outFile)
    if ($Credential) { $env:SQLCMDPASSWORD = $Credential.GetNetworkCredential().Password }
    try { & $sqlcmd @a | Out-Null; return $LASTEXITCODE }
    finally { if ($Credential) { Remove-Item Env:\SQLCMDPASSWORD -ErrorAction SilentlyContinue } }
}
function Get-Rows([string]$db, [string]$query) {
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        $code = Invoke-Sqlcmd2 $db @('-h', '-1', '-W', '-s', '|', '-Q', "SET NOCOUNT ON; $query") $tmp
        $lines = @(Get-Content -LiteralPath $tmp -Encoding UTF8 | Where-Object { $_ -ne '' })
        if ($code -ne 0) { throw ("Query on $db failed: " + ($lines -join ' ')) }
        return ,$lines
    } finally { Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue }
}
function Write-Line([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color; Add-Content -LiteralPath $script:Transcript -Value $text -Encoding UTF8 }

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$script:Transcript = Join-Path $LogDir 'summary.txt'
Set-Content -LiteralPath $script:Transcript -Value ("ZED database scripts, {0}, server {1}, {2}{3}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $Server, $(if ($Apply) { 'APPLY' } else { 'DRY RUN' }), $(if ($DatabasePrefix) { ", database prefix $DatabasePrefix" } else { '' })) -Encoding UTF8
function Get-ScriptAsRun([string]$path, [string]$name) {
    # The script with its database names mapped to the prefixed set; without a prefix, the script itself.
    if (-not $DatabasePrefix) { return $path }
    $dir = Join-Path $LogDir 'scripts-as-run'; New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $out = Join-Path $dir $name
    [System.IO.File]::WriteAllText($out, (Convert-ZedDatabaseNames ([System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)) $DatabasePrefix), (New-Object System.Text.UTF8Encoding($true)))
    return $out
}
$results = New-Object System.Collections.Generic.List[object]
$failed = $false

# ---------------------------------------------------------------- -ApplyFixes validation
$fixFiles = @()
foreach ($folder in @('main', 'consultancy', 'surveillance', 'msdb')) {
    $p = Join-Path $dbDir "fixes\$folder"
    if (Test-Path $p) { $fixFiles += @(Get-ChildItem -LiteralPath $p -Filter '*.sql' | Sort-Object Name | ForEach-Object { [pscustomobject]@{ Name = "$folder/$($_.BaseName)"; Path = $_.FullName } }) }
}
$applySet = @{}
foreach ($raw in $ApplyFixes) {
    foreach ($item in ($raw -split ',')) {
        $n = $item.Trim().Replace('\', '/') -replace '\.sql$', '' -replace '^(database/)?fixes/', ''
        if (-not $n) { continue }
        if ($n -match '[\*\?\[\]]') { throw "-ApplyFixes: wildcards are not allowed ($item). Name each fix script." }
        if (-not ($fixFiles | Where-Object { $_.Name -eq $n })) { throw "-ApplyFixes: no fix script '$n' (names look like main/05_mail_passwords)." }
        if ($NeverApply.ContainsKey($n)) { throw "-ApplyFixes: $n $($NeverApply[$n])." }
        if ($n -eq 'main/02_sp_get_user_details_master_passwords' -and -not $AtCutover) {
            throw '-ApplyFixes: main/02_sp_get_user_details_master_passwords breaks the old Udyami Bharat hand-over. Run it only at the cut-over, after V4 serves /Msme/ZedDashboard (CUTOVER 2.1, 0:50), with -AtCutover.'
        }
        $applySet[$n] = $true
    }
}
if ($applySet.ContainsKey('consultancy/06a_update_column_value_fix') -and $applySet.ContainsKey('consultancy/06b_update_column_value_drop_ALTERNATIVE')) {
    throw '-ApplyFixes: consultancy/06a and 06b are alternatives (fix or drop SP_CONSULTANCY_UPDATE_COLUMN_VALUE). Choose one.'
}
if ($applySet.Count -gt 0 -and $SkipFixes) { throw '-ApplyFixes cannot be combined with -SkipFixes.' }

# ---------------------------------------------------------------- checks
Write-Line "Server checks ($Server)" 'Cyan'
$info = (Get-Rows 'master' "SELECT CAST(SERVERPROPERTY('ProductMajorVersion') AS varchar(10)) + '|' + CAST(SERVERPROPERTY('ProductVersion') AS varchar(30)) + '|' + CAST(SERVERPROPERTY('Edition') AS varchar(100)) + '|' + CAST(SERVERPROPERTY('EngineEdition') AS varchar(10))")[0].Split('|')
Write-Line ("  SQL Server {0} ({1}), {2}" -f $info[0], $info[1], $info[2])
if ($info[0] -ne '16') { Write-Line "  WARNING: not SQL Server 2022 (major version 16): the decided target is SQL Server 2022 Standard." 'Yellow' }
if ($info[2] -match 'Express') { Write-Line '  WARNING: Express edition: fine for development, not for production (ZEDCS_V2_LIVE is 76 GB; MIGRATION-PLAN "Database").' 'Yellow' }
elseif ($info[2] -notmatch 'Standard|Enterprise|Developer') { Write-Line "  WARNING: edition '$($info[2])': the decided target is SQL Server 2022 Standard." 'Yellow' }

$names = ($Zed + $Related + @('msdb') | ForEach-Object { "N'$(Phys $_)'" }) -join ','
$dbRows = @{}
foreach ($l in (Get-Rows 'master' "SELECT name COLLATE DATABASE_DEFAULT + N'|' + CAST(compatibility_level AS nvarchar(5)) + N'|' + ISNULL(collation_name COLLATE DATABASE_DEFAULT, N'') + N'|' + state_desc COLLATE DATABASE_DEFAULT + N'|' + CAST(is_auto_close_on AS nvarchar(1)) FROM sys.databases WHERE name IN ($names)")) {
    $c = $l.Split('|'); $dbRows[$c[0]] = $c
}
foreach ($db in ($Zed + $Related)) {
    if (-not $dbRows.ContainsKey((Phys $db))) {
        if ($Zed -contains $db) { Write-Line "  MISSING: $(Phys $db)" 'Red'; $failed = $true }
        else { Write-Line "  missing: $(Phys $db) (a related database used by three-part names; it must be on this instance in production: CUTOVER 1.1a)" 'Yellow' }
        continue
    }
    $c = $dbRows[(Phys $db)]
    # A closed database (AUTO_CLOSE) shows no collation in sys.databases: ask the database itself.
    if (-not $c[2]) { $c[2] = (Get-Rows $db "SELECT CONVERT(nvarchar(128), DATABASEPROPERTYEX(DB_NAME(), 'Collation'))")[0] }
    $note = @()
    if ($c[4] -eq '1') { $note += 'AUTO_CLOSE is on (turn it off on a production server: ALTER DATABASE ... SET AUTO_CLOSE OFF)' }
    if ($c[1] -ne '160') { $note += "compatibility level $($c[1]), expected 160" }
    if ($c[2] -ne 'SQL_Latin1_General_CP1_CI_AS') { $note += "collation $($c[2]), expected SQL_Latin1_General_CP1_CI_AS" }
    if ($c[3] -ne 'ONLINE') { $note += "state $($c[3])" }
    if ($note.Count) { Write-Line ("  {0,-30} {1}" -f (Phys $db), ($note -join '; ')) 'Yellow' } else { Write-Line ("  {0,-30} ok (160, {1})" -f (Phys $db), $c[2]) }
}
if ($failed) { Write-Line 'A ZED database is missing: nothing was run.' 'Red'; exit 1 }

# ---------------------------------------------------------------- migration status
function Get-MarkerState([string]$db, [string[]]$markers) {
    $tests = foreach ($m in $markers) {
        $kind, $name = $m.Split(':', 2)
        if ($kind -eq 'I') { $parts = $name.Split('.'); "CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'$($parts[2])' AND object_id = OBJECT_ID(N'$($parts[0]).$($parts[1])')) THEN 1 ELSE 0 END" }
        else { "CASE WHEN OBJECT_ID(N'$name', N'$kind') IS NULL THEN 0 ELSE 1 END" }
    }
    $found = [int](Get-Rows $db ("SELECT " + ($tests -join ' + ')))[0]
    if ($found -eq $markers.Count) { return 'applied' } elseif ($found -eq 0) { return 'not applied' } else { return "partial ($found of $($markers.Count) objects)" }
}
$plan = New-Object System.Collections.Generic.List[object]
if (-not $SkipMigrations) {
    foreach ($m in $Migrations) {
        if ($m.ContainsKey('Optional') -and -not $IncludeDistributedCache) {
            foreach ($db in $m.Dbs) { $plan.Add([pscustomobject]@{ Kind = 'migration'; Name = $m.File; Db = $db; Mode = 'skipped (needs -IncludeDistributedCache)'; State = (Get-MarkerState $db $m.Markers); Path = $null }) }
            continue
        }
        foreach ($db in $m.Dbs) { $plan.Add([pscustomobject]@{ Kind = 'migration'; Name = $m.File; Db = $db; Mode = 'run'; State = (Get-MarkerState $db $m.Markers); Path = (Join-Path $dbDir "migrations\$($m.File)") }) }
    }
}
if (-not $SkipFixes) {
    foreach ($f in $fixFiles) {
        $text = [System.IO.File]::ReadAllText($f.Path)
        $db = if ($text -match '(?im)^\s*USE\s+\[([^\]]+)\]') { $Matches[1] } else { $Main }
        $mode = if ($applySet.ContainsKey($f.Name)) { 'PREVIEW, then APPLY' } elseif ($text.Contains($ModeLine)) { 'PREVIEW' } else { 'report' }
        $plan.Add([pscustomobject]@{ Kind = 'fix'; Name = $f.Name; Db = $db; Mode = $mode; State = ''; Path = $f.Path })
    }
}
if (-not $SkipMigrations) {
    foreach ($db in $MailOutbox.Dbs) {
        $mode = if ($IncludeMailOutbox) { 'run (with starting Zed.Jobs and switching the Agent jobs off)' } else { 'skipped (needs -IncludeMailOutbox)' }
        $plan.Add([pscustomobject]@{ Kind = 'migration'; Name = $MailOutbox.File; Db = $db; Mode = $mode; State = (Get-MarkerState $db $MailOutbox.Markers); Path = $(if ($IncludeMailOutbox) { Join-Path $dbDir "migrations\$($MailOutbox.File)" } else { $null }) })
    }
}

Write-Line '' ; Write-Line 'Plan' 'Cyan'
foreach ($p in $plan) { Write-Line ("  {0,-9} {1,-52} {2,-17} {3,-28} {4}" -f $p.Kind, $p.Name, (Phys $p.Db), $p.Mode, $p.State) }
if ($IncludeMailOutbox) { Write-Line '  NOTE: 0003 changes every procedure that mails: from now on their mail waits in dbo.V4MailOutbox for Zed.Jobs. Start Zed.Jobs and switch the old Agent jobs off in the same step.' 'Yellow' }
if (-not $Apply) {
    Write-Line ''; Write-Line 'DRY RUN: nothing was executed. Add -Apply to run the plan.' 'Green'
    $plan | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $LogDir 'plan.json') -Encoding UTF8
    exit 0
}

# ---------------------------------------------------------------- run
function Save-Definition([string]$db, [string]$proc, [string]$file) {
    # -y 0 (no cut) cannot be combined with -h -1, so the column header is written and removed here.
    $code = Invoke-Sqlcmd2 $db @('-Q', "SET NOCOUNT ON; SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.$proc')) AS [definition];") $file
    if ($code -ne 0 -or -not (Test-Path -LiteralPath $file)) { return $false }
    $lines = @(Get-Content -LiteralPath $file -Encoding UTF8)
    $start = 0
    for ($i = 0; $i -lt [Math]::Min($lines.Count, 3); $i++) { if ($lines[$i] -match '^-+\s*$') { $start = $i + 1; break } }
    $body = (($lines | Select-Object -Skip $start) -join "`r`n").TrimEnd()
    if (-not $body -or $body -eq 'NULL') { Remove-Item -LiteralPath $file; return $false }
    [System.IO.File]::WriteAllText($file, $body + "`r`n", (New-Object System.Text.UTF8Encoding($true)))
    return $true
}
function Split-NewDefinitions([string[]]$lines, [string]$folder) {
    # Scripts that make one pass per edit print a definition per pass: the last one written is the final definition.
    $seen = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase); $buf = $null
    foreach ($l in ($lines + '---------- end ----------')) {
        if ($l -match '^-{10} ') {
            if ($null -ne $buf -and $buf.Count) {
                $body = ($buf -join "`r`n")
                if ($body -match '(?i)CREATE\s+(?:OR\s+ALTER\s+)?PROC(?:EDURE)?\s+(?:\[?dbo\]?\.)?\[?([A-Za-z0-9_]+)') {
                    New-Item -ItemType Directory -Force -Path $folder | Out-Null
                    [System.IO.File]::WriteAllText((Join-Path $folder "$($Matches[1]).sql"), $body, (New-Object System.Text.UTF8Encoding($true)))
                    [void]$seen.Add($Matches[1])
                }
            }
            $buf = if ($l -match '(?i)new definition') { New-Object System.Collections.Generic.List[string] } else { $null }
            continue
        }
        if ($null -ne $buf) { $buf.Add($l) }
    }
    return $seen.Count
}

Write-Line ''; Write-Line 'Running' 'Cyan'
$stopMigrations = $false
foreach ($p in $plan) {
    if ($p.Kind -eq 'migration' -and $p.Mode -like 'skipped*') { $results.Add([pscustomobject]@{ Step = $p.Name; Db = $p.Db; Mode = 'skipped'; Status = 'skipped'; Seconds = 0; Log = $null }); continue }
    if ($p.Kind -eq 'migration' -and $stopMigrations) { $results.Add([pscustomobject]@{ Step = $p.Name; Db = $p.Db; Mode = 'run'; Status = 'not run (an earlier migration failed)'; Seconds = 0; Log = $null }); continue }
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    if ($p.Kind -eq 'migration') {
        $dir = Join-Path $LogDir 'migrations'; New-Item -ItemType Directory -Force -Path $dir | Out-Null
        $log = Join-Path $dir ("{0}.{1}.log" -f [System.IO.Path]::GetFileNameWithoutExtension($p.Name), $p.Db)
        $code = Invoke-Sqlcmd2 $p.Db @('-i', (Get-ScriptAsRun $p.Path ("{0}.{1}.sql" -f [System.IO.Path]::GetFileNameWithoutExtension($p.Name), $p.Db))) $log
        $after = Get-MarkerState $p.Db $(if ($p.Name -eq $MailOutbox.File) { $MailOutbox.Markers } else { ($Migrations | Where-Object { $_.File -eq $p.Name }).Markers })
        $status = if ($code -eq 0 -and $after -eq 'applied') { "ok (was: $($p.State))" } elseif ($code -eq 0) { "ran, but objects: $after" } else { "FAILED (exit $code)" }
        if ($code -ne 0 -or $after -ne 'applied') { $failed = $true; $stopMigrations = $true }
        $results.Add([pscustomobject]@{ Step = $p.Name; Db = $p.Db; Mode = 'run'; Status = $status; Seconds = [int]$watch.Elapsed.TotalSeconds; Log = $log })
        Write-Line ("  {0,-34} {1,-17} {2}" -f $p.Name, (Phys $p.Db), $status) $(if ($status -like 'ok*') { 'Gray' } else { 'Red' })
        continue
    }

    # fix: PREVIEW (with full definitions where the script offers them), save live and new definitions, then APPLY if listed
    $dir = Join-Path $LogDir ("fixes\" + $p.Name.Replace('/', '_'))
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $text = Convert-ZedDatabaseNames ([System.IO.File]::ReadAllText($p.Path, [System.Text.Encoding]::UTF8)) $DatabasePrefix
    $preview = $text
    if ($preview.Contains($PrintLine)) { $preview = $preview.Replace($PrintLine, 'DECLARE @PrintDefinitions bit = 1;') }
    $previewFile = Join-Path $dir 'preview-script.sql'
    [System.IO.File]::WriteAllText($previewFile, $preview, (New-Object System.Text.UTF8Encoding($true)))
    $previewLog = Join-Path $dir 'preview.log'
    $code = Invoke-Sqlcmd2 $p.Db @('-i', $previewFile) $previewLog
    Remove-Item -LiteralPath $previewFile -ErrorAction SilentlyContinue
    $out = @(Get-Content -LiteralPath $previewLog -Encoding UTF8)
    $procs = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($l in $out) {
        if ($l -match '^(?:\[?[A-Za-z0-9_]+\]?\.)?(?:\[?dbo\]?\.)\[?([A-Za-z0-9_]+)\]?\s*:') { [void]$procs.Add($Matches[1]) }
        elseif ($l -match '(?i)^\s*CREATE\s+OR\s+ALTER\s+PROC(?:EDURE)?\s+\[?dbo\]?\.\[?([A-Za-z0-9_]+)') { [void]$procs.Add($Matches[1]) }
        elseif ($l -match '(?i)\bdbo\.([A-Za-z0-9_]+) would be (dropped|altered)') { [void]$procs.Add($Matches[1]) }
    }
    # Scripts that print no procedure name (consultancy/06a carries its new definition in the script itself): take
    # the names from the script's own CREATE OR ALTER statements (temporary #procedures excluded).
    if ($procs.Count -eq 0) {
        foreach ($m in [regex]::Matches($text, '(?im)^\s*CREATE\s+OR\s+ALTER\s+PROC(?:EDURE)?\s+(?:\[?dbo\]?\.)\[?([A-Za-z0-9_]+)')) { [void]$procs.Add($m.Groups[1].Value) }
    }
    $saved = 0
    foreach ($proc in $procs) {
        New-Item -ItemType Directory -Force -Path (Join-Path $dir 'live') | Out-Null
        if (Save-Definition $p.Db $proc (Join-Path $dir "live\$proc.sql")) { $saved++ }
    }
    $newDefs = Split-NewDefinitions $out (Join-Path $dir 'new')
    $joined = $out -join "`n"
    if ($code -ne 0 -and $joined -match 'does not exist on this instance') { $pstatus = 'not applicable here' }
    elseif ($code -ne 0) { $pstatus = "FAILED (exit $code)"; $failed = $true }
    elseif ($joined -match '(?i)nothing to change') { $pstatus = 'nothing to change' }
    elseif ($p.Mode -eq 'report') { $pstatus = 'report written' }
    else { $pstatus = 'previewed' }
    $detail = "$($procs.Count) procedure(s), live saved: $saved, new definitions: $newDefs"
    $results.Add([pscustomobject]@{ Step = $p.Name; Db = $p.Db; Mode = 'PREVIEW'; Status = "$pstatus; $detail"; Seconds = [int]$watch.Elapsed.TotalSeconds; Log = $previewLog })
    Write-Line ("  {0,-52} {1,-17} PREVIEW  {2}; {3}" -f $p.Name, (Phys $p.Db), $pstatus, $detail) $(if ($pstatus -like 'FAILED*') { 'Red' } else { 'Gray' })

    if ($p.Mode -eq 'PREVIEW, then APPLY') {
        if ($pstatus -like 'FAILED*') {
            $results.Add([pscustomobject]@{ Step = $p.Name; Db = $p.Db; Mode = 'APPLY'; Status = 'not run (preview failed)'; Seconds = 0; Log = $null })
            Write-Line ("  {0,-52} {1,-17} APPLY    not run (preview failed)" -f $p.Name, $p.Db) 'Red'
            continue
        }
        if (-not $text.Contains($ModeLine)) { throw "$($p.Name): no '$ModeLine' line; refusing to change its mode." }
        $watch.Restart()
        $applyFile = Join-Path $dir 'apply-script.sql'
        [System.IO.File]::WriteAllText($applyFile, $text.Replace($ModeLine, "DECLARE @Mode varchar(10) = 'APPLY';"), (New-Object System.Text.UTF8Encoding($true)))
        $applyLog = Join-Path $dir 'apply.log'
        $code = Invoke-Sqlcmd2 $p.Db @('-i', $applyFile) $applyLog
        Remove-Item -LiteralPath $applyFile -ErrorAction SilentlyContinue
        $astatus = if ($code -eq 0) { 'applied (undo: the live\*.sql saved before)' } else { "FAILED (exit $code; all or nothing: nothing changed)" }
        if ($code -ne 0) { $failed = $true }
        $results.Add([pscustomobject]@{ Step = $p.Name; Db = $p.Db; Mode = 'APPLY'; Status = $astatus; Seconds = [int]$watch.Elapsed.TotalSeconds; Log = $applyLog })
        Write-Line ("  {0,-52} {1,-17} APPLY    {2}" -f $p.Name, (Phys $p.Db), $astatus) $(if ($code -eq 0) { 'Green' } else { 'Red' })
    }
}

$results | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $LogDir 'summary.json') -Encoding UTF8
Write-Line ''
Write-Line ("Done: {0} step(s), {1}. Logs: {2}" -f $results.Count, $(if ($failed) { 'with FAILURES' } else { 'no failures' }), $LogDir) $(if ($failed) { 'Red' } else { 'Green' })
Write-Line 'Review: for each fix, compare fixes\<name>\live\<proc>.sql (the definition now, and the undo) with new\<proc>.sql where the script printed one, else with the pattern list in the script itself.'
if ($failed) { exit 1 } else { exit 0 }
