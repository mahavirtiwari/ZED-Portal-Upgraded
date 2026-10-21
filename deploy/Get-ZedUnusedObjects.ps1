<#
.SYNOPSIS
  Lists the stored procedures and tables of a ZED database that nothing in V4 uses. Read-only: it drops nothing.

.DESCRIPTION
  "Used" means: named in the V4 source (backend\src\**\*.cs, the Zed.Jobs schedules, database\migrations), or
  called from a used procedure, transitively. Everything else was used only by the old sites and services, by
  old SQL Agent jobs, or by nobody. A table is used when a used procedure or the V4 source names it.

  For each unused procedure the report also shows when SQL Server last ran it since the last restart
  (sys.dm_exec_procedure_stats; needs VIEW SERVER STATE). Run it on production some weeks after the cut-over:
  an "unused" procedure that still runs has a caller nobody listed (a report tool, an old job, another system).
  Find it before archiving anything.

  Decommission (docs/CUTOVER.md): script out the listed objects, keep the script with the final backup, and only
  then consider dropping them. Tables hold history: archive, do not drop.

.EXAMPLE
  .\Get-ZedUnusedObjects.ps1 -Server localhost\SQLEXPRESS -Database ZED_CONSULTANT -Output D:\ZedV4\unused-consultancy.csv
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Server,
    [Parameter(Mandatory)][string]$Database,
    [string]$Output,
    # SQL login instead of Windows authentication: pass a PSCredential (Get-Credential).
    [System.Management.Automation.PSCredential]$Credential
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

# ---- names that V4 mentions -----------------------------------------------------------------------------------
$sourceFiles = @(Get-ChildItem (Join-Path $repo 'backend\src') -Recurse -Include *.cs, appsettings.json |
        Where-Object { $_.FullName -notmatch '\\(bin|obj)(-[^\\]*)?\\' }) +
    @(Get-ChildItem (Join-Path $repo 'database\migrations') -Filter *.sql)
$words = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
foreach ($f in $sourceFiles) {
    foreach ($m in [regex]::Matches([IO.File]::ReadAllText($f.FullName), '[A-Za-z_][A-Za-z0-9_]*')) { [void]$words.Add($m.Value) }
}

# ---- database objects -----------------------------------------------------------------------------------------
Add-Type -AssemblyName System.Data
$builder = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
$builder['Data Source'] = $Server
$builder['Initial Catalog'] = $Database
$builder['Application Name'] = 'Get-ZedUnusedObjects'
if ($Credential) {
    $builder['User ID'] = $Credential.UserName
    $builder['Password'] = $Credential.GetNetworkCredential().Password
}
else { $builder['Integrated Security'] = $true }
$connection = New-Object System.Data.SqlClient.SqlConnection $builder.ConnectionString
$connection.Open()

function Query([string]$Sql) {
    $cmd = $connection.CreateCommand()
    $cmd.CommandText = $Sql
    $cmd.CommandTimeout = 300
    $table = New-Object System.Data.DataTable
    $table.Load($cmd.ExecuteReader())
    , $table
}

$procedures = Query @'
SELECT p.name, s.name AS schema_name, m.definition, p.modify_date,
       (SELECT MAX(ps.last_execution_time) FROM sys.dm_exec_procedure_stats ps WHERE ps.database_id = DB_ID() AND ps.object_id = p.object_id) AS last_run
FROM sys.procedures p
JOIN sys.schemas s ON s.schema_id = p.schema_id
LEFT JOIN sys.sql_modules m ON m.object_id = p.object_id
WHERE p.is_ms_shipped = 0
'@
$tables = Query @'
SELECT t.name, s.name AS schema_name, SUM(CASE WHEN ps.index_id IN (0, 1) THEN ps.row_count ELSE 0 END) AS row_count
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
LEFT JOIN sys.dm_db_partition_stats ps ON ps.object_id = t.object_id
WHERE t.is_ms_shipped = 0
GROUP BY t.name, s.name
'@
$connection.Close()

# ---- used procedures: named by V4, then everything they call ------------------------------------------------------
$byName = @{}
foreach ($p in $procedures.Rows) { $byName[$p.name.ToLowerInvariant()] = $p }
$tokens = @{}
foreach ($p in $procedures.Rows) {
    $set = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    if ($p.definition -isnot [DBNull]) {
        foreach ($m in [regex]::Matches([string]$p.definition, '[A-Za-z_][A-Za-z0-9_]*')) { [void]$set.Add($m.Value) }
    }
    $tokens[$p.name.ToLowerInvariant()] = $set
}
$used = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$queue = New-Object System.Collections.Generic.Queue[string]
foreach ($name in $byName.Keys) { if ($words.Contains($name)) { [void]$used.Add($name); $queue.Enqueue($name) } }
while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    foreach ($t in $tokens[$current]) {
        $key = $t.ToLowerInvariant()
        if ($byName.ContainsKey($key) -and $used.Add($key)) { $queue.Enqueue($key) }
    }
}

$usedTokens = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
foreach ($u in $used) { $usedTokens.UnionWith($tokens[$u]) }
$usedTokens.UnionWith($words)

$report = @()
foreach ($p in ($procedures.Rows | Sort-Object name)) {
    if ($used.Contains($p.name)) { continue }
    $report += [pscustomobject]@{
        Database = $Database; Type = 'Procedure'; Name = "$($p.schema_name).$($p.name)"
        LastRunSinceRestart = if ($p.last_run -is [DBNull]) { '' } else { ([datetime]$p.last_run).ToString('yyyy-MM-dd HH:mm') }
        Rows = ''; Modified = ([datetime]$p.modify_date).ToString('yyyy-MM-dd')
    }
}
foreach ($t in ($tables.Rows | Sort-Object name)) {
    if ($usedTokens.Contains($t.name)) { continue }
    $report += [pscustomobject]@{
        Database = $Database; Type = 'Table'; Name = "$($t.schema_name).$($t.name)"; LastRunSinceRestart = ''
        Rows = $t.row_count; Modified = ''
    }
}

$running = @($report | Where-Object { $_.LastRunSinceRestart })
Write-Host ("{0}: {1} procedures, {2} used by V4; unused: {3} procedures ({4} ran since the last restart), {5} tables of {6}" -f
    $Database, $procedures.Rows.Count, $used.Count, @($report | Where-Object Type -eq 'Procedure').Count, $running.Count,
    @($report | Where-Object Type -eq 'Table').Count, $tables.Rows.Count)
if ($running.Count -gt 0) { Write-Warning "Still being run, so something calls them: $(($running | ForEach-Object Name) -join ', ')" }
if ($Output) { $report | Export-Csv -Path $Output -NoTypeInformation -Encoding UTF8; Write-Host "Written: $Output" }
else { $report }
