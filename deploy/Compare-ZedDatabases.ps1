<#
.SYNOPSIS
  Read-only before/after check for moving the ZED databases from the old managed instance to the new SQL Server 2022
  Standard server (docs/CUTOVER.md 1.1a "Moving the data"). It changes nothing: only SELECTs on catalog views and
  COUNT_BIG(*).

.DESCRIPTION
  Three ways to run it:
    -Snapshot -Server X -Out old.json      one server -> a JSON snapshot (run on the old instance right before the copy,
                                           and on the new server right after it)
    -Compare old.json, new.json            compares two snapshots (with powershell -File: -Compare "old.json,new.json")
    -Source X -Target Y                    both servers live (takes both snapshots, then compares)

  Per database (default: the eight related databases): compatibility level, collation, recovery model, state, size,
  READ_COMMITTED_SNAPSHOT / TRUSTWORTHY / DB_CHAINING, object counts by type, a SHA-256 of every module definition
  (procedures, functions, views, triggers), every table's row count (exact COUNT_BIG(*); -Fast reads sys.partitions
  instead), identity last values, sequence current values, users (type, whether they have a login on this server)
  and role memberships. Server: name, version, edition, collation, time zone, SQL Agent job names, Database Mail
  profile names. No passwords, SIDs or connection strings are read or printed.

  Differences are classified:
    MUST MATCH   row counts, tables, object counts, module checksums, compatibility level, collation, the three
                 database settings, sequences / identities not behind the source, users and role memberships,
                 server collation and time zone, a database missing on the target
    EXPECTED     server name, version, edition, sizes, recovery model
    INFO         sequences / identities ahead of the source, users without a login on the target (map them),
                 Agent jobs and Database Mail profiles (ZED's jobs and mail run in Zed.Jobs), databases only on the target
  Exit code 1 when there is a MUST MATCH difference, else 0. -Report and -JsonOut write the report and the
  differences to files.

.EXAMPLE
  .\Compare-ZedDatabases.ps1 -Snapshot -Server old-instance.example -Credential (Get-Credential) -Out D:\ZedV4\move\old.json
.EXAMPLE
  .\Compare-ZedDatabases.ps1 -Snapshot -Server NEWSQL01 -Out D:\ZedV4\move\new.json
  .\Compare-ZedDatabases.ps1 -Compare D:\ZedV4\move\old.json, D:\ZedV4\move\new.json -Report D:\ZedV4\move\compare.txt
  A prefixed set (database\setup.ps1 -DatabasePrefix ZEDV4_): -DatabasePrefix ZEDV4_ (Snapshot) or
  -SourceDatabasePrefix / -TargetDatabasePrefix (Live) read ZEDV4_ZEDCS_V2_LIVE, ... and store them under the logical
  names, so a prefixed set compares with an unprefixed one; -Databases always takes the logical names. Names outside the
  ZED map (ZED_QUALITY_PROFESSIONAL) are read as given. Module checksums of code that names another database then
  differ by design (the names are mapped).

.EXAMPLE
  .\Compare-ZedDatabases.ps1 -Source old-instance.example -SourceCredential (Get-Credential) -Target NEWSQL01 -Fast
.EXAMPLE
  .\Compare-ZedDatabases.ps1 -Snapshot -Server .\SQLEXPRESS -DatabasePrefix ZEDV4_ -Out E:\ZedStaging\v4.json
#>
[CmdletBinding(DefaultParameterSetName = 'Compare')]
param(
    [Parameter(ParameterSetName = 'Snapshot', Mandatory)][switch]$Snapshot,
    [Parameter(ParameterSetName = 'Snapshot', Mandatory)][string]$Server,
    [Parameter(ParameterSetName = 'Snapshot')][System.Management.Automation.PSCredential]$Credential,
    [Parameter(ParameterSetName = 'Snapshot', Mandatory)][string]$Out,
    [Parameter(ParameterSetName = 'Snapshot')][string]$DatabasePrefix = '',

    [Parameter(ParameterSetName = 'Compare', Mandatory)][string[]]$Compare,

    [Parameter(ParameterSetName = 'Live', Mandatory)][string]$Source,
    [Parameter(ParameterSetName = 'Live', Mandatory)][string]$Target,
    [Parameter(ParameterSetName = 'Live')][System.Management.Automation.PSCredential]$SourceCredential,
    [Parameter(ParameterSetName = 'Live')][System.Management.Automation.PSCredential]$TargetCredential,
    # Live mode: also keep both snapshots in this folder.
    [Parameter(ParameterSetName = 'Live')][string]$SnapshotFolder,
    [Parameter(ParameterSetName = 'Live')][string]$SourceDatabasePrefix = '',
    [Parameter(ParameterSetName = 'Live')][string]$TargetDatabasePrefix = '',

    [string[]]$Databases = @('ZEDCS_V2_LIVE', 'ZED_CONSULTANT', 'ZED_SURVEILLANCE', 'ZED_CENTER_AUDIT_PROFESSIONAL',
        'ZED_CENTER_AUDIT_V2', 'ZED_IMPACT_ASSESSMENT', 'KAWACH', 'ZED_QUALITY_PROFESSIONAL'),
    # Row counts from sys.partitions instead of COUNT_BIG(*): much faster on 76 GB, exact enough when nothing writes.
    [switch]$Fast,
    [string]$Report,
    [string]$JsonOut,
    [int]$CommandTimeout = 1800
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Data
. (Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) 'database\ZedDatabaseNames.ps1')
foreach ($px in @($DatabasePrefix, $SourceDatabasePrefix, $TargetDatabasePrefix)) { Test-ZedDatabasePrefix $px }

# -File passes "a,b" as one string.
$Databases = @($Databases | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($Compare) { $Compare = @($Compare | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }

# ---------------------------------------------------------------- reading one server
function New-ZedConnection([string]$srv, [string]$db, $cred) {
    $b = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
    $b['Data Source'] = $srv
    $b['Initial Catalog'] = $db
    $b['Application Name'] = 'Compare-ZedDatabases'
    $b['Connect Timeout'] = 30
    if ($cred) {
        $b['User ID'] = $cred.UserName
        $b['Password'] = $cred.GetNetworkCredential().Password
        $b['Encrypt'] = $true
    }
    else { $b['Integrated Security'] = $true }
    $c = New-Object System.Data.SqlClient.SqlConnection $b.ConnectionString
    $c.Open()
    return $c
}

function Invoke-ZedQuery($conn, [string]$sql) {
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    $cmd.CommandTimeout = $CommandTimeout
    $t = New-Object System.Data.DataTable
    $t.Load($cmd.ExecuteReader())
    return , $t
}

function Get-Text($v) { if ($null -eq $v -or $v -is [DBNull]) { return $null } return [string]$v }

function Get-ZedSnapshot([string]$srv, $cred, [string[]]$dbs, [bool]$fastCounts, [string]$prefix = '') {
    Write-Host "Snapshot of $srv ($(if ($fastCounts) { 'row counts from sys.partitions' } else { 'exact row counts' }))"
    $master = New-ZedConnection $srv 'master' $cred
    try {
        $s = (Invoke-ZedQuery $master @"
SELECT CAST(SERVERPROPERTY('ServerName') AS nvarchar(256)) AS server_name,
       CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(64)) AS version,
       CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition,
       CAST(SERVERPROPERTY('EngineEdition') AS int) AS engine_edition,
       CAST(SERVERPROPERTY('Collation') AS nvarchar(128)) AS collation,
       CURRENT_TIMEZONE() AS time_zone
"@).Rows[0]
        $server = [ordered]@{
            server_name = Get-Text $s.server_name; version = Get-Text $s.version; edition = Get-Text $s.edition
            engine_edition = [int]$s.engine_edition; collation = Get-Text $s.collation; time_zone = Get-Text $s.time_zone
            agent_jobs = @(); mail_profiles = @(); notes = @()
        }
        try { $server.agent_jobs = @((Invoke-ZedQuery $master 'SELECT name FROM msdb.dbo.sysjobs ORDER BY name').Rows | ForEach-Object { [string]$_.name }) }
        catch { $server.notes += 'Agent jobs not readable: ' + $_.Exception.Message }
        try { $server.mail_profiles = @((Invoke-ZedQuery $master 'SELECT name FROM msdb.dbo.sysmail_profile ORDER BY name').Rows | ForEach-Object { [string]$_.name }) }
        catch { $server.notes += 'Database Mail profiles not readable: ' + $_.Exception.Message }
        $present = @{}
        foreach ($r in (Invoke-ZedQuery $master 'SELECT name, state_desc FROM sys.databases').Rows) { $present[[string]$r.name] = [string]$r.state_desc }
    }
    finally { $master.Close() }

    $result = [ordered]@{
        tool = 'Compare-ZedDatabases'; taken_at = (Get-Date).ToString('o'); row_counts = $(if ($fastCounts) { 'sys.partitions' } else { 'COUNT_BIG' })
        server = $server; database_prefix = $prefix; databases = [ordered]@{}
    }
    foreach ($db in $dbs) {
        # Stored under the logical name; read from the name on this server.
        $pdb = Get-ZedDatabaseName $db $prefix
        if (-not $present.ContainsKey($pdb)) { Write-Host "  $pdb : not on this server"; $result.databases[$db] = [ordered]@{ missing = $true }; continue }
        if ($present[$pdb] -ne 'ONLINE') { Write-Host "  $pdb : $($present[$pdb])"; $result.databases[$db] = [ordered]@{ missing = $false; state = $present[$pdb]; unreadable = $true }; continue }
        $watch = [Diagnostics.Stopwatch]::StartNew()
        $c = New-ZedConnection $srv $pdb $cred
        try { $result.databases[$db] = Get-ZedDatabaseSnapshot $c $db $fastCounts }
        finally { $c.Close() }
        Write-Host ("  {0} : {1} tables, {2} modules ({3:0}s)" -f $pdb, $result.databases[$db].tables.Count, $result.databases[$db].modules.Count, $watch.Elapsed.TotalSeconds)
    }
    return $result
}

function Get-ZedDatabaseSnapshot($c, [string]$db, [bool]$fastCounts) {
    $d = (Invoke-ZedQuery $c @"
SELECT compatibility_level, collation_name, recovery_model_desc, state_desc,
       CAST(is_read_committed_snapshot_on AS int) AS rcsi, CAST(is_trustworthy_on AS int) AS trustworthy, CAST(is_db_chaining_on AS int) AS db_chaining,
       (SELECT CAST(SUM(CASE WHEN type = 0 THEN CAST(size AS bigint) ELSE 0 END) * 8 / 1024 AS bigint) FROM sys.database_files) AS data_mb,
       (SELECT CAST(SUM(CASE WHEN type = 1 THEN CAST(size AS bigint) ELSE 0 END) * 8 / 1024 AS bigint) FROM sys.database_files) AS log_mb
FROM sys.databases WHERE name = DB_NAME()
"@).Rows[0]
    $snap = [ordered]@{
        missing = $false; state = [string]$d.state_desc
        compatibility_level = [int]$d.compatibility_level; collation = Get-Text $d.collation_name; recovery_model = [string]$d.recovery_model_desc
        settings = [ordered]@{ read_committed_snapshot = [int]$d.rcsi; trustworthy = [int]$d.trustworthy; db_chaining = [int]$d.db_chaining }
        data_mb = [long]$d.data_mb; log_mb = [long]$d.log_mb
        object_counts = [ordered]@{}; modules = [ordered]@{}; tables = [ordered]@{}; identities = [ordered]@{}; sequences = [ordered]@{}
        users = [ordered]@{}; role_members = @()
    }
    foreach ($r in (Invoke-ZedQuery $c 'SELECT type_desc, COUNT(*) AS n FROM sys.objects WHERE is_ms_shipped = 0 GROUP BY type_desc ORDER BY type_desc').Rows) {
        $snap.object_counts[[string]$r.type_desc] = [int]$r.n
    }
    foreach ($r in (Invoke-ZedQuery $c @"
SELECT s.name + '.' + o.name AS name, o.type_desc,
       CASE WHEN m.definition IS NULL THEN 'encrypted' ELSE CONVERT(varchar(66), HASHBYTES('SHA2_256', m.definition), 1) END AS sha256
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE o.is_ms_shipped = 0 ORDER BY 1
"@).Rows) { $snap.modules[[string]$r.name] = ('{0} {1}' -f $r.type_desc, $r.sha256) }

    $tables = Invoke-ZedQuery $c @"
SELECT s.name AS schema_name, t.name AS table_name,
       (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0, 1)) AS partition_rows
FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE t.is_ms_shipped = 0 ORDER BY s.name, t.name
"@
    foreach ($r in $tables.Rows) {
        $name = '{0}.{1}' -f $r.schema_name, $r.table_name
        if ($fastCounts) { $rows = [long]$(if ($r.partition_rows -is [DBNull]) { 0 } else { $r.partition_rows }) }
        else {
            $q = 'SELECT COUNT_BIG(*) AS n FROM [{0}].[{1}]' -f ([string]$r.schema_name).Replace(']', ']]'), ([string]$r.table_name).Replace(']', ']]')
            $rows = [long](Invoke-ZedQuery $c $q).Rows[0].n
        }
        $snap.tables[$name] = $rows
    }
    foreach ($r in (Invoke-ZedQuery $c @"
SELECT s.name + '.' + t.name AS name, CONVERT(varchar(40), ic.last_value) AS last_value
FROM sys.identity_columns ic JOIN sys.tables t ON t.object_id = ic.object_id JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE t.is_ms_shipped = 0 ORDER BY 1
"@).Rows) { $snap.identities[[string]$r.name] = Get-Text $r.last_value }
    foreach ($r in (Invoke-ZedQuery $c @"
SELECT s.name + '.' + q.name AS name, CONVERT(varchar(40), q.current_value) AS current_value
FROM sys.sequences q JOIN sys.schemas s ON s.schema_id = q.schema_id ORDER BY 1
"@).Rows) { $snap.sequences[[string]$r.name] = Get-Text $r.current_value }
    foreach ($r in (Invoke-ZedQuery $c @"
SELECT dp.name, dp.type_desc, dp.authentication_type_desc,
       CASE WHEN dp.type IN ('S', 'U', 'G', 'E', 'X') AND dp.authentication_type IN (1, 3, 4)
            THEN CASE WHEN EXISTS (SELECT 1 FROM sys.server_principals sp WHERE sp.sid = dp.sid) THEN 1 ELSE 0 END END AS has_login
FROM sys.database_principals dp
WHERE dp.type IN ('S', 'U', 'G', 'E', 'X', 'R') AND dp.is_fixed_role = 0 AND dp.principal_id > 4 AND dp.name <> 'public'
ORDER BY dp.name
"@).Rows) {
        $snap.users[[string]$r.name] = [ordered]@{ type = [string]$r.type_desc; authentication = Get-Text $r.authentication_type_desc
            has_login = $(if ($r.has_login -is [DBNull]) { $null } else { [int]$r.has_login }) }
    }
    $snap.role_members = @((Invoke-ZedQuery $c @"
SELECT r.name AS role_name, m.name AS member_name
FROM sys.database_role_members rm JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id
JOIN sys.database_principals m ON m.principal_id = rm.member_principal_id
WHERE m.name <> 'dbo' ORDER BY r.name, m.name
"@).Rows | ForEach-Object { '{0} <- {1}' -f $_.role_name, $_.member_name })
    return $snap
}

# ---------------------------------------------------------------- comparing
$diffs = New-Object System.Collections.Generic.List[object]
function Add-Diff([string]$class, [string]$db, [string]$item, $old, $new, [string]$why = '') {
    $diffs.Add([pscustomobject]@{ Class = $class; Database = $db; Item = $item; Old = $(if ($null -eq $old) { '' } else { [string]$old }); New = $(if ($null -eq $new) { '' } else { [string]$new }); Note = $why })
}
function Get-Prop($o, [string]$name) { if ($null -eq $o) { return $null } $p = $o.PSObject.Properties[$name]; if ($p) { return $p.Value } return $null }
function Get-Map($o) {
    $h = [ordered]@{}
    if ($null -ne $o) { foreach ($p in $o.PSObject.Properties) { $h[$p.Name] = $p.Value } }
    return $h
}
function ConvertTo-Number($v) { $n = [decimal]0; if ([decimal]::TryParse([string]$v, [Globalization.NumberStyles]::Any, [Globalization.CultureInfo]::InvariantCulture, [ref]$n)) { return $n } return $null }

function Compare-ZedSnapshots($old, $new) {
    $so = $old.server; $sn = $new.server
    foreach ($k in 'server_name', 'version', 'edition') { if ((Get-Prop $so $k) -ne (Get-Prop $sn $k)) { Add-Diff 'EXPECTED' '(server)' $k (Get-Prop $so $k) (Get-Prop $sn $k) } }
    if ($so.collation -ne $sn.collation) { Add-Diff 'MUST MATCH' '(server)' 'server collation' $so.collation $sn.collation 'tempdb uses it: #temp tables compared with database columns can fail' }
    if ($so.time_zone -ne $sn.time_zone) { Add-Diff 'MUST MATCH' '(server)' 'time zone' $so.time_zone $sn.time_zone 'procedures use GETDATE(); Jobs:TimeZone assumes the old time zone' }
    $jo = @($so.agent_jobs); $jn = @($sn.agent_jobs)
    foreach ($j in $jo) { if ($jn -notcontains $j) { Add-Diff 'INFO' '(server)' "Agent job '$j'" 'present' 'absent' 'ZED jobs run in Zed.Jobs; other applications'' jobs must be recreated' } }
    foreach ($j in @($so.mail_profiles)) { if (@($sn.mail_profiles) -notcontains $j) { Add-Diff 'INFO' '(server)' "Database Mail profile '$j'" 'present' 'absent' 'needed only by other applications (docs/JOBS.md "Mail")' } }
    if ($old.row_counts -ne $new.row_counts) { Add-Diff 'INFO' '(snapshots)' 'row count method' $old.row_counts $new.row_counts 'compare like with like when a count differs' }

    $dbo = Get-Map $old.databases; $dbn = Get-Map $new.databases
    foreach ($db in $dbn.Keys) { if (-not $dbo.Contains($db)) { Add-Diff 'INFO' $db 'database' 'not in the source snapshot' 'present' } }
    foreach ($db in $dbo.Keys) {
        $a = $dbo[$db]; $b = $(if ($dbn.Contains($db)) { $dbn[$db] } else { $null })
        if ($a.missing) {
            if ($b -and -not $b.missing) { Add-Diff 'INFO' $db 'database' 'absent' 'present' }
            continue
        }
        if ($null -eq $b -or $b.missing) { Add-Diff 'MUST MATCH' $db 'database' 'present' 'absent' 'not copied'; continue }
        if ((Get-Prop $a 'unreadable') -or (Get-Prop $b 'unreadable')) { Add-Diff 'MUST MATCH' $db 'state' $a.state $b.state 'not ONLINE: nothing compared'; continue }

        foreach ($k in 'compatibility_level', 'collation') { if ([string](Get-Prop $a $k) -ne [string](Get-Prop $b $k)) { Add-Diff 'MUST MATCH' $db $k (Get-Prop $a $k) (Get-Prop $b $k) } }
        foreach ($k in 'read_committed_snapshot', 'trustworthy', 'db_chaining') {
            if ((Get-Prop $a.settings $k) -ne (Get-Prop $b.settings $k)) { Add-Diff 'MUST MATCH' $db $k (Get-Prop $a.settings $k) (Get-Prop $b.settings $k) 'changes locking or cross-database behaviour: set it as on the source' }
        }
        if ($a.recovery_model -ne $b.recovery_model) { Add-Diff 'EXPECTED' $db 'recovery model' $a.recovery_model $b.recovery_model }
        foreach ($k in 'data_mb', 'log_mb') { if ((Get-Prop $a $k) -ne (Get-Prop $b $k)) { Add-Diff 'EXPECTED' $db $k (Get-Prop $a $k) (Get-Prop $b $k) } }

        $oa = Get-Map $a.object_counts; $ob = Get-Map $b.object_counts
        foreach ($k in @($oa.Keys) + @($ob.Keys | Where-Object { -not $oa.Contains($_) })) {
            $x = $(if ($oa.Contains($k)) { $oa[$k] } else { 0 }); $y = $(if ($ob.Contains($k)) { $ob[$k] } else { 0 })
            if ($x -ne $y) { Add-Diff 'MUST MATCH' $db "objects: $k" $x $y }
        }
        $ma = Get-Map $a.modules; $mb = Get-Map $b.modules
        foreach ($k in $ma.Keys) {
            if (-not $mb.Contains($k)) { Add-Diff 'MUST MATCH' $db "module $k" ($ma[$k] -split ' ')[0] 'absent' }
            elseif ($ma[$k] -ne $mb[$k]) { Add-Diff 'MUST MATCH' $db "module $k" 'definition A' 'definition B' 'the code differs (SHA-256 of the definition)' }
        }
        foreach ($k in $mb.Keys) { if (-not $ma.Contains($k)) { Add-Diff 'MUST MATCH' $db "module $k" 'absent' ($mb[$k] -split ' ')[0] } }

        $ta = Get-Map $a.tables; $tb = Get-Map $b.tables
        foreach ($k in $ta.Keys) {
            if (-not $tb.Contains($k)) { Add-Diff 'MUST MATCH' $db "table $k" "$($ta[$k]) rows" 'absent' }
            elseif ([long]$ta[$k] -ne [long]$tb[$k]) { Add-Diff 'MUST MATCH' $db "rows $k" $ta[$k] $tb[$k] ('{0:+#;-#} rows' -f ([long]$tb[$k] - [long]$ta[$k])) }
        }
        foreach ($k in $tb.Keys) { if (-not $ta.Contains($k)) { Add-Diff 'MUST MATCH' $db "table $k" 'absent' "$($tb[$k]) rows" } }

        foreach ($pair in @(@('identity', (Get-Map $a.identities), (Get-Map $b.identities)), @('sequence', (Get-Map $a.sequences), (Get-Map $b.sequences)))) {
            $kind = $pair[0]; $va = $pair[1]; $vb = $pair[2]
            foreach ($k in $va.Keys) {
                if (-not $vb.Contains($k)) { Add-Diff 'MUST MATCH' $db "$kind $k" $va[$k] 'absent'; continue }
                $x = ConvertTo-Number $va[$k]; $y = ConvertTo-Number $vb[$k]
                if ($null -eq $x -and $null -eq $y) { continue }
                if ($null -eq $y -or ($null -ne $x -and $y -lt $x)) { Add-Diff 'MUST MATCH' $db "$kind $k" $va[$k] $vb[$k] 'behind the source: new numbers would repeat existing ones' }
                elseif ($null -eq $x -or $y -gt $x) { Add-Diff 'INFO' $db "$kind $k" $va[$k] $vb[$k] 'ahead of the source' }
            }
            foreach ($k in $vb.Keys) { if (-not $va.Contains($k)) { Add-Diff 'MUST MATCH' $db "$kind $k" 'absent' $vb[$k] } }
        }

        $ua = Get-Map $a.users; $ub = Get-Map $b.users
        foreach ($k in $ua.Keys) {
            if (-not $ub.Contains($k)) { Add-Diff 'MUST MATCH' $db "user $k" $ua[$k].type 'absent' }
            elseif ($ub[$k].has_login -eq 0) { Add-Diff 'INFO' $db "user $k" 'mapped' 'no login on this server' 'map it (ALTER USER ... WITH LOGIN) or drop it' }
        }
        foreach ($k in $ub.Keys) { if (-not $ua.Contains($k)) { Add-Diff 'MUST MATCH' $db "user $k" 'absent' $ub[$k].type } }
        $ra = @($a.role_members); $rb = @($b.role_members)
        foreach ($m in $ra) { if ($rb -notcontains $m) { Add-Diff 'MUST MATCH' $db "role member $m" 'present' 'absent' } }
        foreach ($m in $rb) { if ($ra -notcontains $m) { Add-Diff 'MUST MATCH' $db "role member $m" 'absent' 'present' } }
    }
}

# ---------------------------------------------------------------- run
function Read-Snapshot([string]$path) {
    $o = Get-Content -Raw -Encoding UTF8 $path | ConvertFrom-Json
    if ((Get-Prop $o 'tool') -ne 'Compare-ZedDatabases') { throw "$path is not a snapshot of Compare-ZedDatabases.ps1" }
    return $o
}
function Save-Snapshot($snap, [string]$path) {
    $dir = Split-Path -Parent $path
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    $snap | ConvertTo-Json -Depth 8 | Set-Content -Path $path -Encoding UTF8
    Write-Host "Snapshot written: $path"
}

if ($PSCmdlet.ParameterSetName -eq 'Snapshot') {
    Save-Snapshot (Get-ZedSnapshot $Server $Credential $Databases $Fast.IsPresent $DatabasePrefix) $Out
    exit 0
}
if ($PSCmdlet.ParameterSetName -eq 'Compare') {
    if ($Compare.Count -ne 2) { throw '-Compare takes two snapshot files: old.json, new.json' }
    $old = Read-Snapshot $Compare[0]; $new = Read-Snapshot $Compare[1]
    $label = '{0} ({1}) -> {2} ({3})' -f $old.server.server_name, $old.taken_at, $new.server.server_name, $new.taken_at
}
else {
    $snapA = Get-ZedSnapshot $Source $SourceCredential $Databases $Fast.IsPresent $SourceDatabasePrefix
    $snapB = Get-ZedSnapshot $Target $TargetCredential $Databases $Fast.IsPresent $TargetDatabasePrefix
    if ($SnapshotFolder) { Save-Snapshot $snapA (Join-Path $SnapshotFolder 'source.json'); Save-Snapshot $snapB (Join-Path $SnapshotFolder 'target.json') }
    # Round-trip through JSON so live and file comparisons see the same shapes.
    $old = ($snapA | ConvertTo-Json -Depth 8 | ConvertFrom-Json); $new = ($snapB | ConvertTo-Json -Depth 8 | ConvertFrom-Json)
    $label = '{0} -> {1}' -f $Source, $Target
}

Compare-ZedSnapshots $old $new
$must = @($diffs | Where-Object Class -eq 'MUST MATCH')
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("Compare-ZedDatabases: $label")
$lines.Add(("{0} MUST MATCH, {1} EXPECTED, {2} INFO" -f $must.Count, @($diffs | Where-Object Class -eq 'EXPECTED').Count, @($diffs | Where-Object Class -eq 'INFO').Count))
foreach ($class in 'MUST MATCH', 'EXPECTED', 'INFO') {
    $group = @($diffs | Where-Object Class -eq $class)
    if ($group.Count -eq 0) { continue }
    $lines.Add(''); $lines.Add("== $class")
    foreach ($d in $group) {
        $lines.Add(('  [{0}] {1}: {2} -> {3}{4}' -f $d.Database, $d.Item, $d.Old, $d.New, $(if ($d.Note) { "  ($($d.Note))" } else { '' })))
    }
}
if ($must.Count -eq 0) { $lines.Add(''); $lines.Add('No MUST MATCH differences.') }
$lines | ForEach-Object { Write-Host $_ }
if ($Report) { $lines | Set-Content -Path $Report -Encoding UTF8 }
if ($JsonOut) { [ordered]@{ compared = $label; must_match = $must.Count; differences = $diffs.ToArray() } | ConvertTo-Json -Depth 5 | Set-Content -Path $JsonOut -Encoding UTF8 }
if ($must.Count -gt 0) { exit 1 } else { exit 0 }
