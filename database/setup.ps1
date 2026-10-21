<#
.SYNOPSIS
    Creates the three ZED legacy databases (schema only) on a SQL Server instance.

.DESCRIPTION
    Creates ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE (compat level 160,
    recovery SIMPLE, default file locations) and applies the cleaned schema scripts in
    .\schema batch-by-batch (split on GO lines).

    The three databases reference each other with three-part names, so batches are
    applied in multiple passes: pass 1 runs every batch of all three scripts in order,
    later passes retry only the failed batches until a pass makes no further progress.

    Safety:
      * Only the three databases above are ever created or dropped. Nothing else on the
        instance is touched; no logins are created.
      * If any of the three already exists the script stops, unless -Force is given, in
        which case those three (and only those three) are dropped and recreated.

    Logs are written to .\logs\ (setup-<timestamp>.log, failed-batches-<timestamp>.json,
    warnings-<timestamp>.txt).

.PARAMETER Server
    SQL Server instance. Default: localhost\SQLEXPRESS (Windows authentication).

.PARAMETER Force
    Drop and recreate the three ZED databases if they already exist.

.PARAMETER ValidateOnly
    Parse the scripts and check connectivity / existing databases; make no changes.

.PARAMETER SkipSequenceStubs
    Do not apply schema\04_missing_sequences.sql (local stand-ins for the SEQUENCE objects
    that the SSMS export omitted; see README).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\setup.ps1
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\setup.ps1 -Server "MYPC\SQLEXPRESS" -Force
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\setup.ps1 -ValidateOnly
#>
[CmdletBinding()]
param(
    [string]$Server = 'localhost\SQLEXPRESS',
    [switch]$Force,
    [switch]$ValidateOnly,
    [switch]$SkipSequenceStubs,
    [string]$SchemaDir = '',
    [string]$LogDir = '',
    [string]$Collation = 'SQL_Latin1_General_CP1_CI_AS',
    [int]$MaxPasses = 10,
    [int]$CommandTimeout = 600
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $SchemaDir) { $SchemaDir = Join-Path $here 'schema' }
if (-not $LogDir)    { $LogDir    = Join-Path $here 'logs' }

# Order matters only for pass 1; cross-database dependencies are resolved by later passes.
$Databases = [ordered]@{
    'ZEDCS_V2_LIVE'    = '01_ZEDCS_V2_LIVE.sql'
    'ZED_CONSULTANT'   = '02_ZED_CONSULTANT.sql'
    'ZED_SURVEILLANCE' = '03_ZED_SURVEILLANCE.sql'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile      = Join-Path $LogDir "setup-$stamp.log"
$FailFile     = Join-Path $LogDir "failed-batches-$stamp.json"
$WarnFile     = Join-Path $LogDir "warnings-$stamp.txt"

function Write-Log([string]$msg, [string]$color = 'Gray') {
    $line = '{0:HH:mm:ss} {1}' -f (Get-Date), $msg
    Write-Host $line -ForegroundColor $color
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function New-Conn([string]$db) {
    $cs = "Server=$Server;Database=$db;Integrated Security=True;TrustServerCertificate=True;Application Name=ZED-setup;Pooling=False"
    $c = New-Object System.Data.SqlClient.SqlConnection $cs
    $c.Open()
    return $c
}

function Invoke-Sql($conn, [string]$sql) {
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    $cmd.CommandTimeout = $CommandTimeout
    [void]$cmd.ExecuteNonQuery()
}

function Get-Scalar($conn, [string]$sql) {
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    $cmd.CommandTimeout = $CommandTimeout
    return $cmd.ExecuteScalar()
}

# ---------------------------------------------------------------- parse scripts
function Get-Batches([string]$db, [string]$path) {
    $text  = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
    $lines = $text -split "\r?\n"
    $list  = New-Object System.Collections.Generic.List[object]
    $buf   = New-Object System.Text.StringBuilder
    $start = 1
    $ansiNulls = $true; $quotedId = $true; $pendingName = $null; $hdr = $null
    for ($i = 0; $i -le $lines.Count; $i++) {
        $isEnd = ($i -eq $lines.Count)
        if (-not $isEnd -and $lines[$i] -notmatch '^\s*GO\s*$') {
            if ($buf.Length -eq 0) { $start = $i + 1 }
            [void]$buf.Append($lines[$i]).Append("`r`n")
            continue
        }
        $sql = $buf.ToString(); [void]$buf.Clear()
        # strip comments only to classify the batch
        $code = [regex]::Replace($sql, '(?s)/\*.*?\*/', '')
        $code = [regex]::Replace($code, '(?m)--.*$', '').Trim()
        if ($sql -match '/\*{6}\s*Object:\s+(\w+)\s+(\[[^\]]+\]\.\[[^\]]+\])') { $hdr = "$($Matches[1]) $($Matches[2])" } else { $hdr = $null }
        if ($code -eq '') { if ($hdr) { $pendingName = $hdr }; continue }
        if ($code -match '^(?i)SET\s+ANSI_NULLS\s+(ON|OFF)\s*;?$') { $ansiNulls = ($Matches[1] -eq 'ON'); if ($hdr) { $pendingName = $hdr }; continue }
        if ($code -match '^(?i)SET\s+QUOTED_IDENTIFIER\s+(ON|OFF)\s*;?$') { $quotedId = ($Matches[1] -eq 'ON'); continue }
        if ($code -match '^(?i)USE\s+\[?([^\]\s;]+)\]?\s*;?$') {
            if ($Matches[1] -ne $db) { throw "$path line $start switches to database $($Matches[1]); expected $db" }
            continue
        }
        $name = $null
        if ($hdr) { $name = $hdr }
        elseif ($pendingName -and $code -match '^(?i)CREATE\s') { $name = $pendingName }
        else { $name = (($code -replace '\s+', ' ')); if ($name.Length -gt 140) { $name = $name.Substring(0, 140) + '...' } }
        $pendingName = $null
        $list.Add([pscustomobject]@{
            Db = $db; Seq = $list.Count + 1; Line = $start; Name = $name; Sql = $sql
            AnsiNulls = $ansiNulls; QuotedId = $quotedId
            Done = $false; Error = $null; Warnings = @()
        })
    }
    return ,$list
}

Write-Log "ZED schema setup -> $Server  (schema dir: $SchemaDir)" 'Cyan'
$all = New-Object System.Collections.Generic.List[object]
foreach ($db in $Databases.Keys) {
    $p = Join-Path $SchemaDir $Databases[$db]
    if (-not (Test-Path $p)) { throw "Missing schema script: $p" }
    $b = Get-Batches $db $p
    Write-Log ("  {0,-18} {1,5} batches  ({2})" -f $db, $b.Count, $Databases[$db])
    $all.AddRange($b)
}

# ---------------------------------------------------------------- pre-checks
$master = New-Conn 'master'
$ver = Get-Scalar $master "SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(50)) + ' ' + CAST(SERVERPROPERTY('Edition') AS nvarchar(100))"
Write-Log "  Connected: $ver"
$existing = @()
foreach ($db in $Databases.Keys) {
    if ([int](Get-Scalar $master "SELECT COUNT(*) FROM sys.databases WHERE name = N'$db'") -gt 0) { $existing += $db }
}
if ($ValidateOnly) {
    Write-Log ("  Existing target databases: {0}" -f ($(if ($existing) { $existing -join ', ' } else { '(none)' })))
    Write-Log 'ValidateOnly: scripts parsed and connection OK; no changes made.' 'Green'
    $master.Close(); return
}
if ($existing.Count -gt 0) {
    if (-not $Force) {
        $master.Close()
        throw ("Database(s) already exist: {0}. Re-run with -Force to drop and recreate them." -f ($existing -join ', '))
    }
    foreach ($db in $existing) {
        if (-not $Databases.Contains($db)) { throw "Refusing to drop unexpected database $db" }
        Write-Log "  -Force: dropping [$db]" 'Yellow'
        Invoke-Sql $master "ALTER DATABASE [$db] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$db];"
    }
}

# ---------------------------------------------------------------- create databases
foreach ($db in $Databases.Keys) {
    Write-Log "  Creating [$db] (default file paths, COLLATE $Collation)"
    Invoke-Sql $master "CREATE DATABASE [$db] COLLATE $Collation;"
    Invoke-Sql $master "ALTER DATABASE [$db] SET COMPATIBILITY_LEVEL = 160; ALTER DATABASE [$db] SET RECOVERY SIMPLE;"
}

# ---------------------------------------------------------------- sequence stand-ins
$seqFile = Join-Path $SchemaDir '04_missing_sequences.sql'
if (-not $SkipSequenceStubs -and (Test-Path $seqFile)) {
    Write-Log "  Applying local SEQUENCE stand-ins ($([System.IO.Path]::GetFileName($seqFile)))"
    $seqSql = [System.IO.File]::ReadAllText($seqFile, [System.Text.Encoding]::UTF8)
    foreach ($chunk in ([regex]::Split($seqSql, '(?im)^\s*GO\s*$'))) {
        if ($chunk.Trim()) { Invoke-Sql $master $chunk }
    }
}
$master.Close()

# ---------------------------------------------------------------- apply batches
$conns = @{}
$state = @{}
$script:pending = New-Object System.Collections.Generic.List[string]
foreach ($db in $Databases.Keys) { $conns[$db] = $null }

function Get-DbConn([string]$db) {
    $c = $conns[$db]
    if ($null -eq $c -or $c.State -ne 'Open') {
        $c = New-Conn $db
        $c.add_InfoMessage({ param($s, $e) foreach ($er in $e.Errors) { $script:pending.Add($er.Message) } })
        $conns[$db] = $c
        $state[$db] = $null
    }
    return $c
}

function Invoke-Batch($b) {
    $c = Get-DbConn $b.Db
    $want = "$($b.AnsiNulls)|$($b.QuotedId)"
    if ($state[$b.Db] -ne $want) {
        Invoke-Sql $c ("SET ANSI_NULLS {0}; SET QUOTED_IDENTIFIER {1};" -f $(if ($b.AnsiNulls) { 'ON' } else { 'OFF' }), $(if ($b.QuotedId) { 'ON' } else { 'OFF' }))
        $state[$b.Db] = $want
    }
    $script:pending.Clear()
    try {
        Invoke-Sql $c $b.Sql
        $b.Done = $true; $b.Error = $null
        $b.Warnings = @($script:pending)
    } catch {
        $ex = $_.Exception
        while ($null -ne $ex.InnerException -and -not ($ex -is [System.Data.SqlClient.SqlException])) { $ex = $ex.InnerException }
        if ($ex -is [System.Data.SqlClient.SqlException]) {
            $b.Error = (@($ex.Errors | ForEach-Object { "Msg $($_.Number), Line $($_.LineNumber): $($_.Message)" }) -join ' | ')
        } else { $b.Error = $ex.Message }
    }
}

$pass = 0
$todo = $all.ToArray()
while ($todo.Count -gt 0 -and $pass -lt $MaxPasses) {
    $pass++
    $before = $todo.Count
    Write-Log ("Pass {0}: applying {1} batch(es)" -f $pass, $before) 'Cyan'
    foreach ($b in $todo) {
        $prevError = $b.Error
        Invoke-Batch $b
        if ($pass -gt 1 -and $b.Done) { Write-Log ("  resolved on pass {0}: [{1}] {2} (pass-1 error: {3})" -f $pass, $b.Db, $b.Name, $prevError) }
    }
    $todo = @($all | Where-Object { -not $_.Done })
    Write-Log ("Pass {0}: {1} succeeded, {2} still failing" -f $pass, ($before - $todo.Count), $todo.Count)
    if ($todo.Count -eq $before) { break }   # no progress
}
foreach ($c in $conns.Values) { if ($null -ne $c) { $c.Close() } }

# ---------------------------------------------------------------- report
$warn = @($all | Where-Object { $_.Warnings.Count -gt 0 } | ForEach-Object { "[$($_.Db)] $($_.Name): $($_.Warnings -join ' | ')" })
Set-Content -Path $WarnFile -Value $warn -Encoding UTF8
$fails = @($all | Where-Object { -not $_.Done } | Select-Object Db, Seq, Line, Name, Error)
ConvertTo-Json -InputObject $fails -Depth 3 | Set-Content -Path $FailFile -Encoding UTF8

$verify = New-Conn 'master'
Write-Log 'Object counts, expected (from script headers) / actual:' 'Cyan'
foreach ($db in $Databases.Keys) {
    $exp = @{}
    foreach ($k in 'Table', 'StoredProcedure', 'View', 'UserDefinedFunction', 'UserDefinedTableType') {
        $exp[$k] = @($all | Where-Object { $_.Db -eq $db -and $_.Name -like "$k *" }).Count
    }
    $q = "SELECT CONCAT('tables=$($exp.Table)/', (SELECT COUNT(*) FROM [$db].sys.tables WHERE is_ms_shipped=0),
        ' procs=$($exp.StoredProcedure)/', (SELECT COUNT(*) FROM [$db].sys.procedures WHERE is_ms_shipped=0),
        ' views=$($exp.View)/', (SELECT COUNT(*) FROM [$db].sys.views WHERE is_ms_shipped=0),
        ' functions=$($exp.UserDefinedFunction)/', (SELECT COUNT(*) FROM [$db].sys.objects WHERE type IN ('FN','IF','TF','FS','FT') AND is_ms_shipped=0),
        ' tabletypes=$($exp.UserDefinedTableType)/', (SELECT COUNT(*) FROM [$db].sys.types WHERE is_table_type=1),
        ' sequences=', (SELECT COUNT(*) FROM [$db].sys.sequences))"
    Write-Log ("  {0,-18} {1}" -f $db, (Get-Scalar $verify $q))
}
$verify.Close()

foreach ($f in $fails) { Write-Log ("  FAILED [{0}] line {1}: {2}`n      {3}" -f $f.Db, $f.Line, $f.Name, $f.Error) 'Red' }
Write-Log ("Done. {0} of {1} batches applied, {2} failed, {3} batches with warnings." -f ($all.Count - $fails.Count), $all.Count, $fails.Count, $warn.Count) $(if ($fails.Count) { 'Yellow' } else { 'Green' })
Write-Log "Logs: $LogFile ; $FailFile ; $WarnFile"
if ($fails.Count -gt 0) { exit 2 }
