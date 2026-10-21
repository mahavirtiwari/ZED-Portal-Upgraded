<#
.SYNOPSIS
    Turns the SQL Agent export of the old server (docs/JOBS.md, "Before go-live") into Zed.Jobs schedules.

.DESCRIPTION
    Input: the CSV files saved from SSMS for query A (jobs and schedules) and query B (job steps) of
    docs/JOBS.md. The older single query (jobs, steps and schedules in one result) is accepted too.

    Output: -OutFile, a JSON file { "Jobs": { "Schedules": [ ... ] } }, and a report on the console and in
    <OutFile>.report.txt of everything that could not be converted (steps that are not one EXEC of a procedure,
    CmdExec/SSIS/PowerShell steps, schedules Zed.Jobs cannot express, unknown databases) and of what changed
    on the way (merged schedules, renamed entries, disabled entries).

    Each converted job keeps the old server's on/off state. Parameter values whose name looks like a secret
    (password, pwd, secret, token, key) are not copied: the entry gets a placeholder and is disabled.

    With -UpdateSettings the Schedules array of that appsettings.json is replaced (a .bak copy is kept).
    Then run "Zed.Jobs --check" on the server before enabling anything (docs/JOBS.md).

.EXAMPLE
    .\tools\jobs\Convert-AgentJobs.ps1 -Path agent-schedules.csv, agent-steps.csv -CompareSettings backend\src\Zed.Jobs\appsettings.json

.EXAMPLE
    .\tools\jobs\Convert-AgentJobs.ps1 -Path agent-schedules.csv, agent-steps.csv -UpdateSettings C:\Services\ZedJobs\appsettings.json
#>
[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)][string[]]$Path,
    [string]$OutFile = 'agent-schedules.json',
    # appsettings.json whose Jobs:Schedules array is replaced with the result (a .bak copy is written first).
    [string]$UpdateSettings,
    # appsettings.json to compare with: lists procedures it schedules that no Agent job runs, and the reverse.
    [string]$CompareSettings,
    [hashtable]$DatabaseMap = @{ ZEDCS_V2_LIVE = 'Main'; ZED_CONSULTANT = 'Consultancy'; ZED_SURVEILLANCE = 'Surveillance' },
    # yyyyMMdd; schedules whose active_end_date is before it are converted disabled. For tests.
    [string]$Today = (Get-Date -Format 'yyyyMMdd')
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
# "powershell -File" passes "a.csv,b.csv" as one string.
$Path = @($Path | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })

# Procedures that must not be enabled by a conversion, with the reason.
$NeverEnable = @{
    'SP_JOB_TO_CREATE_RENAMING_BATCH_FILES' = 'uses xp_cmdshell (SECURITY-FINDINGS #12); decide before enabling'
}
$SecretName = '(?i)pass|pwd|secret|token|key'
$SecretPlaceholder = '<SET-ME: not exported, looks like a secret>'
$NullValue = '{NULL}'

$report = New-Object System.Collections.Generic.List[string]
$notConverted = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Col($row, [string]$name) {
    $p = $row.PSObject.Properties[$name]
    if ($null -eq $p) { return $null }
    $v = [string]$p.Value
    if ($v -eq '' -or $v -eq 'NULL') { return $null }
    return $v.Trim()
}

function HasCol($row, [string]$name) { return $null -ne $row.PSObject.Properties[$name] }

function IntOr($value, [int]$default) {
    if ($null -eq $value) { return $default }
    return [int]$value
}

# SQL text with string literals shown as '...', so a report line never carries a value.
function Masked([string]$sql) {
    $t = [regex]::Replace($sql, "N?'(?:[^']|'')*'", "'...'")
    $t = [regex]::Replace($t, '\s+', ' ').Trim()
    if ($t.Length -gt 100) { $t = $t.Substring(0, 100) + '...' }
    return $t
}

function HHmm([int]$hhmmss) {
    $h = [math]::Floor($hhmmss / 10000); $m = [math]::Floor($hhmmss / 100) % 100
    return ('{0:00}:{1:00}' -f $h, $m)
}

# Comments become spaces; literals are kept. Returns the statements (split on ';' and GO lines).
function Statements([string]$sql) {
    $sb = New-Object System.Text.StringBuilder
    $parts = New-Object System.Collections.Generic.List[string]
    $i = 0
    while ($i -lt $sql.Length) {
        $c = $sql[$i]
        $next = if ($i + 1 -lt $sql.Length) { $sql[$i + 1] } else { [char]0 }
        if ($c -eq '-' -and $next -eq '-') {
            while ($i -lt $sql.Length -and $sql[$i] -ne "`n") { $i++ }
            [void]$sb.Append("`n")
        }
        elseif ($c -eq '/' -and $next -eq '*') {
            $end = $sql.IndexOf('*/', $i + 2)
            if ($end -lt 0) { $i = $sql.Length } else { $i = $end + 2 }
            [void]$sb.Append(' ')
            continue
        }
        elseif ($c -eq "'") {
            [void]$sb.Append($c); $i++
            while ($i -lt $sql.Length) {
                [void]$sb.Append($sql[$i])
                if ($sql[$i] -eq "'") {
                    if ($i + 1 -lt $sql.Length -and $sql[$i + 1] -eq "'") { $i++; [void]$sb.Append("'") }
                    else { break }
                }
                $i++
            }
        }
        elseif ($c -eq ';') { $parts.Add($sb.ToString()); [void]$sb.Clear() }
        else { [void]$sb.Append($c) }
        $i++
    }
    $parts.Add($sb.ToString())
    $result = New-Object System.Collections.Generic.List[string]
    foreach ($p in $parts) {
        foreach ($q in [regex]::Split($p, '(?im)^\s*GO\s*$')) {
            $s = $q.Trim()
            if ($s -ne '' -and $s -notmatch '^(?i)SET\s+NOCOUNT\s+(ON|OFF)$') { $result.Add($s) }
        }
    }
    return , $result
}

# Splits on commas outside literals and parentheses.
function SplitArgs([string]$text) {
    $list = New-Object System.Collections.Generic.List[string]
    $sb = New-Object System.Text.StringBuilder
    $depth = 0; $inLit = $false
    for ($i = 0; $i -lt $text.Length; $i++) {
        $c = $text[$i]
        if ($inLit) {
            [void]$sb.Append($c)
            if ($c -eq "'") {
                if ($i + 1 -lt $text.Length -and $text[$i + 1] -eq "'") { [void]$sb.Append("'"); $i++ } else { $inLit = $false }
            }
            continue
        }
        if ($c -eq "'") { $inLit = $true }
        elseif ($c -eq '(') { $depth++ }
        elseif ($c -eq ')') { $depth-- }
        elseif ($c -eq ',' -and $depth -eq 0) { $list.Add($sb.ToString().Trim()); [void]$sb.Clear(); continue }
        [void]$sb.Append($c)
    }
    if ($sb.ToString().Trim() -ne '') { $list.Add($sb.ToString().Trim()) }
    return , $list
}

# One T-SQL step -> @{ Ok; Reason; Database; Procedure; Parameters; Secret }
function ConvertStep($step) {
    $r = @{ Ok = $false; Reason = $null; Database = $null; Procedure = $null; Parameters = [ordered]@{}; Secret = $false }
    if ($step.Subsystem -ne 'TSQL') { $r.Reason = "$($step.Subsystem) step (only T-SQL procedure calls convert)"; return $r }
    if ($null -eq $step.Command) { $r.Reason = 'empty command'; return $r }
    $statements = Statements ($step.Command.Replace('{LF}', "`n"))
    if ($statements.Count -ne 1) { $r.Reason = "$($statements.Count) statements, not one EXEC: $(Masked $step.Command)"; return $r }
    $s = $statements[0]
    $m = [regex]::Match($s, '^(?is)(?:EXEC(?:UTE)?\s+(?:@\w+\s*=\s*)?)?(?<name>(?:(?:\[[^\]]+\]|\w+)?\.){0,2}(?:\[[^\]]+\]|\w+))(?<args>(?:\s.*)?)$')
    if (-not $m.Success) { $r.Reason = "not a procedure call: $(Masked $s)"; return $r }
    $parts = @($m.Groups['name'].Value.Split('.') | ForEach-Object { $_.Trim('[', ']') })
    $proc = $parts[$parts.Count - 1]
    $schema = if ($parts.Count -ge 2) { $parts[$parts.Count - 2] } else { '' }
    $db = if ($parts.Count -ge 3) { $parts[$parts.Count - 3] } else { '' }
    if ($proc -notmatch '^[A-Za-z0-9_]{1,128}$' -or ($schema -ne '' -and $schema -ne 'dbo')) { $r.Reason = "not a dbo procedure: $(Masked $s)"; return $r }
    if ($proc -match '^(?i)(sp_start_job|xp_cmdshell|sp_send_dbmail|sp_executesql)$') { $r.Reason = "calls system procedure $proc"; return $r }
    if ($db -eq '') { $db = $step.Database }
    if ($null -eq $db -or -not $DatabaseMap.ContainsKey($db)) { $r.Reason = "database '$db' is not one of $(($DatabaseMap.Keys | Sort-Object) -join ', ')"; return $r }
    $r.Database = $DatabaseMap[$db]
    $r.Procedure = $proc

    foreach ($arg in (SplitArgs $m.Groups['args'].Value)) {
        $a = [regex]::Match($arg, '^(?is)@(?<n>\w+)\s*=\s*(?<v>.+)$')
        if (-not $a.Success) { $r.Reason = "positional or unnamed argument (name the parameters): $(Masked $s)"; return $r }
        $name = $a.Groups['n'].Value; $v = $a.Groups['v'].Value.Trim()
        if ($v -match '(?i)\s+OUT(PUT)?$') { $r.Reason = "OUTPUT parameter @$name"; return $r }
        $str = [regex]::Match($v, "^(?s)N?'(?<s>(?:[^']|'')*)'$")
        if ($str.Success) { $value = $str.Groups['s'].Value.Replace("''", "'") }
        elseif ($v -match '^[+-]?\d+$') { $value = [long]$v }
        elseif ($v -match '^[+-]?\d+\.\d+$') { $value = [decimal]::Parse($v, [Globalization.CultureInfo]::InvariantCulture) }
        elseif ($v -match '^(?i)NULL$') { $value = $NullValue }
        elseif ($v -match '^(?i)DEFAULT$') { continue }
        else { $r.Reason = "@$name is an expression or variable, not a constant: $(Masked $s)"; return $r }
        if ($name -match $SecretName) { $value = $SecretPlaceholder; $r.Secret = $true }
        $r.Parameters[$name] = $value
    }
    $r.Ok = $true
    return $r
}

# One Agent schedule -> @{ Ok; Reason; Kind (Times|Interval); Time; EveryMinutes; WindowStart; WindowEnd; DaysOfWeek; DaysOfMonth; Warning }
function ConvertSchedule($s) {
    $r = @{ Ok = $false; Reason = $null; Kind = $null; Time = $null; EveryMinutes = $null; WindowStart = $null; WindowEnd = $null; DaysOfWeek = @(); DaysOfMonth = @(); Warning = $null }
    $type = IntOr $s.FreqType 0; $interval = IntOr $s.FreqInterval 0; $recurrence = IntOr $s.Recurrence 1
    switch ($type) {
        4 { if ($interval -gt 1) { $r.Reason = "every $interval days"; return $r } }
        8 {
            if ($recurrence -gt 1) { $r.Reason = "every $recurrence weeks"; return $r }
            $names = 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
            $r.DaysOfWeek = @(for ($b = 0; $b -lt 7; $b++) { if ($interval -band (1 -shl $b)) { $names[$b] } })
            if ($r.DaysOfWeek.Count -eq 0) { $r.Reason = 'weekly with no day'; return $r }
        }
        16 {
            if ($recurrence -gt 1) { $r.Reason = "every $recurrence months"; return $r }
            if ($interval -lt 1 -or $interval -gt 31) { $r.Reason = "monthly on day $interval"; return $r }
            $r.DaysOfMonth = @($interval)
            if ($interval -gt 28) { $r.Warning = "day ${interval}: Zed.Jobs skips months without that day" }
        }
        32 { $r.Reason = 'monthly relative (e.g. first Monday)'; return $r }
        1 { $r.Reason = 'runs once'; return $r }
        64 { $r.Reason = 'runs when SQL Agent starts'; return $r }
        128 { $r.Reason = 'runs when the CPU is idle'; return $r }
        default { $r.Reason = "freq_type $type"; return $r }
    }
    $start = IntOr $s.StartTime 0; $end = IntOr $s.EndTime 235959
    $subType = IntOr $s.SubdayType 1; $subInterval = IntOr $s.SubdayInterval 0
    switch ($subType) {
        1 {
            $r.Kind = 'Times'; $r.Time = HHmm $start
            if ($start % 100 -ne 0) { $r.Warning = "start time $start has seconds; rounded down to $($r.Time)" }
        }
        { $_ -in 2, 4, 8 } {
            $minutes = switch ($subType) { 2 { $subInterval / 60 } 4 { $subInterval } 8 { $subInterval * 60 } }
            if ($minutes -ne [math]::Floor($minutes) -or $minutes -lt 1 -or $minutes -gt 1440) { $r.Reason = "every $subInterval (freq_subday_type $subType)"; return $r }
            $r.Kind = 'Interval'; $r.EveryMinutes = [int]$minutes
            if ($start -ne 0) { $r.WindowStart = HHmm $start }
            if ($end -lt 235900) { $r.WindowEnd = HHmm $end }
        }
        default { $r.Reason = "freq_subday_type $subType"; return $r }
    }
    $r.Ok = $true
    return $r
}

# --- Read the export -------------------------------------------------------------------------------------
$jobs = [ordered]@{}
function JobOf([string]$name) {
    if (-not $jobs.Contains($name)) {
        $jobs[$name] = @{ Name = $name; Enabled = $null; HasScheduleData = $false; Schedules = (New-Object System.Collections.Generic.List[object]); ScheduleKeys = @{}; Steps = @{} }
    }
    return $jobs[$name]
}

foreach ($file in $Path) {
    $rows = @(Import-Csv -LiteralPath $file)
    if ($rows.Count -eq 0) { continue }
    if (-not (HasCol $rows[0] 'job')) {
        throw "$file has no 'job' column. In SSMS: Tools > Options > Query Results > SQL Server > Results to Grid, tick 'Include column headers when copying or saving the results' and 'Quote strings containing list separators when saving .csv results', open a new query window, run the query again and save the results again."
    }
    foreach ($row in $rows) {
        $name = Col $row 'job'
        if ($null -eq $name) { continue }
        $job = JobOf $name
        $enabled = Col $row 'job_enabled'
        if ($null -eq $enabled -and -not (HasCol $row 'job_enabled')) { $enabled = Col $row 'enabled' }
        if ($null -ne $enabled) { $job.Enabled = ($enabled -eq '1') }

        if (HasCol $row 'freq_type') {
            $job.HasScheduleData = $true
            if ($null -ne (Col $row 'freq_type')) {
                $sch = @{
                    Name = Col $row 'schedule'; Enabled = ((Col $row 'schedule_enabled') -ne '0')
                    FreqType = Col $row 'freq_type'; FreqInterval = Col $row 'freq_interval'
                    SubdayType = Col $row 'freq_subday_type'; SubdayInterval = Col $row 'freq_subday_interval'
                    Recurrence = Col $row 'freq_recurrence_factor'
                    StartTime = Col $row 'active_start_time'; EndTime = Col $row 'active_end_time'
                    StartDate = Col $row 'active_start_date'; EndDate = Col $row 'active_end_date'
                }
                $key = ($sch.Name, $sch.FreqType, $sch.FreqInterval, $sch.SubdayType, $sch.SubdayInterval, $sch.Recurrence, $sch.StartTime, $sch.EndTime) -join '|'
                if (-not $job.ScheduleKeys.ContainsKey($key)) { $job.ScheduleKeys[$key] = $true; $job.Schedules.Add($sch) }
            }
        }
        if ((HasCol $row 'step_id') -and $null -ne (Col $row 'step_id')) {
            $id = [int](Col $row 'step_id')
            $subsystem = Col $row 'subsystem'
            if ($null -eq $subsystem) { $subsystem = 'TSQL' }
            $job.Steps[$id] = @{
                Id = $id; Subsystem = $subsystem; Database = Col $row 'database_name'; Command = Col $row 'command'
                OnSuccess = IntOr (Col $row 'on_success_action') 0; OnFail = IntOr (Col $row 'on_fail_action') 2
            }
        }
    }
}

# --- Convert ---------------------------------------------------------------------------------------------
$entries = New-Object System.Collections.Generic.List[object]
foreach ($job in $jobs.Values) {
    $label = "Agent job '$($job.Name)'"
    $ids = @($job.Steps.Keys | Sort-Object)
    if ($ids.Count -eq 0) { $notConverted.Add("${label}: no steps in the export (run query B too)"); continue }

    # Steps, in order, as Agent would run them on success.
    $calls = New-Object System.Collections.Generic.List[object]
    $failed = $null; $secret = $false
    for ($n = 0; $n -lt $ids.Count; $n++) {
        $step = $job.Steps[$ids[$n]]
        $c = ConvertStep $step
        if (-not $c.Ok) { $failed = "step $($step.Id): $($c.Reason)"; break }
        if ($c.Secret) { $secret = $true }
        $last = ($n -eq $ids.Count - 1)
        $onSuccess = if ($step.OnSuccess -eq 0) { if ($last) { 1 } else { 3 } } else { $step.OnSuccess }
        if ($step.OnFail -eq 4 -or $onSuccess -eq 4) { $failed = "step $($step.Id): 'go to step N' flow"; break }
        if ($step.OnFail -eq 1) { $warnings.Add("${label}, step $($step.Id): Agent reported success when this step failed; Zed.Jobs records the failure and stops") }
        $calls.Add(@{ Database = $c.Database; Procedure = $c.Procedure; Parameters = $c.Parameters; ContinueOnFailure = ($step.OnFail -eq 3) })
        if ($onSuccess -eq 1 -and -not $last) {
            $warnings.Add("${label}: step $($step.Id) ends the job on success, so the later steps never ran; they are left out")
            break
        }
    }
    if ($null -ne $failed) { $notConverted.Add("${label}: $failed"); continue }

    $enabled = ($job.Enabled -ne $false)
    $why = New-Object System.Collections.Generic.List[string]
    if ($job.Enabled -eq $false) { $why.Add('disabled on the old server') }
    if ($secret) { $enabled = $false; $why.Add('a parameter looked like a secret: set it, then enable'); $warnings.Add("${label}: secret-looking parameter replaced by a placeholder; entry disabled") }
    foreach ($call in $calls) {
        if ($NeverEnable.ContainsKey($call.Procedure)) {
            $enabled = $false; $why.Add("$($call.Procedure) $($NeverEnable[$call.Procedure])")
            $warnings.Add("${label}: $($call.Procedure) $($NeverEnable[$call.Procedure]); entry disabled")
        }
    }

    # Schedules -> one entry per distinct schedule shape; "once a day at T" schedules with the same days merge.
    $shapes = [ordered]@{}
    foreach ($sch in $job.Schedules) {
        $c = ConvertSchedule $sch
        $schLabel = if ($sch.Name) { "schedule '$($sch.Name)'" } else { 'a schedule' }
        if (-not $c.Ok) { $notConverted.Add("${label}, ${schLabel}: $($c.Reason)"); continue }
        if ($c.Warning) { $warnings.Add("${label}, ${schLabel}: $($c.Warning)") }
        $on = $enabled -and $sch.Enabled
        $shapeWhy = @()
        if (-not $sch.Enabled) { $shapeWhy += "$schLabel disabled on the old server" }
        if ($sch.EndDate -and [string]$sch.EndDate -lt $Today -and $sch.EndDate -ne '99991231') {
            $on = $false; $shapeWhy += "$schLabel ended on $($sch.EndDate)"
        }
        if ($sch.StartDate -and [string]$sch.StartDate -gt $Today) { $warnings.Add("${label}, ${schLabel}: starts on $($sch.StartDate); Zed.Jobs has no start date") }
        $key = if ($c.Kind -eq 'Times') { "T|$($c.DaysOfWeek -join ',')|$($c.DaysOfMonth -join ',')|$on" }
               else { "I|$($c.EveryMinutes)|$($c.WindowStart)|$($c.WindowEnd)|$($c.DaysOfWeek -join ',')|$($c.DaysOfMonth -join ',')|$on" }
        if ($shapes.Contains($key)) {
            if ($c.Kind -eq 'Times' -and $shapes[$key].DailyAt -notcontains $c.Time) { $shapes[$key].DailyAt += $c.Time }
            $shapes[$key].Names += $sch.Name
            $shapes[$key].Why += $shapeWhy
            continue
        }
        $shapes[$key] = @{ Schedule = $c; Enabled = $on; DailyAt = @(if ($c.Kind -eq 'Times') { $c.Time }); Names = @($sch.Name); Why = $shapeWhy }
    }
    if ($job.Schedules.Count -gt 0 -and $shapes.Count -eq 0) { continue }   # every schedule was reported above
    if ($shapes.Count -eq 0) {
        $why.Add('no schedule on the old server (run on demand?)')
        $shapes['none'] = @{ Schedule = $null; Enabled = $false; DailyAt = @(); Names = @(); Why = @() }
        $warnings.Add("${label}: no schedule; converted disabled without a time")
    }

    $i = 0
    foreach ($shape in $shapes.Values) {
        $i++
        $name = $job.Name
        if ($shapes.Count -gt 1) {
            $name = "$($job.Name) ($i)"
            if ($i -eq 1) { $warnings.Add("${label}: $($shapes.Count) schedules of different kinds; written as $($shapes.Count) entries '$($job.Name) (1..$($shapes.Count))'") }
        }
        if ($name.Length -gt 200) { $name = $name.Substring(0, 200) }
        $e = [ordered]@{ Name = $name }
        if ($calls.Count -eq 1) {
            $e.Database = $calls[0].Database; $e.Procedure = $calls[0].Procedure; $e.Parameters = $calls[0].Parameters; $e.Steps = @()
        }
        else {
            $e.Database = $calls[0].Database; $e.Procedure = ''; $e.Parameters = [ordered]@{}
            $e.Steps = @($calls | ForEach-Object { [ordered]@{ Database = $_.Database; Procedure = $_.Procedure; Parameters = $_.Parameters; ContinueOnFailure = $_.ContinueOnFailure } })
        }
        $c = $shape.Schedule
        $e.DailyAt = @($shape.DailyAt | Sort-Object)
        $e.EveryMinutes = if ($c -and $c.Kind -eq 'Interval') { $c.EveryMinutes } else { $null }
        $e.WindowStart = if ($c) { $c.WindowStart } else { $null }
        $e.WindowEnd = if ($c) { $c.WindowEnd } else { $null }
        # Assigned as statements: "$x = if ..." would turn an empty or one-item array into $null or a scalar.
        $e.DaysOfWeek = @(); $e.DaysOfMonth = @()
        if ($c) { $e.DaysOfWeek = @($c.DaysOfWeek); $e.DaysOfMonth = @($c.DaysOfMonth) }
        $e.Enabled = [bool]$shape.Enabled
        $named = @($shape.Names | Where-Object { $_ })
        $note = "From $label" + $(if ($named.Count -gt 0) { ', schedule ' + (($named | ForEach-Object { "'$_'" }) -join ', ') } else { '' })
        $reasons = @($why) + @($shape.Why)
        if ($reasons.Count -gt 0 -and -not $shape.Enabled) { $note += '. Disabled: ' + (($reasons | Select-Object -Unique) -join '; ') }
        $e.Note = $note + '.'
        $entries.Add($e)
    }
}

# --- Write -----------------------------------------------------------------------------------------------
# Windows PowerShell escapes ' < > & as backslash-u00XX; they need no escaping in JSON.
$lines = @($entries | ForEach-Object {
    $u = [string][char]92 + 'u00'
    '      ' + (ConvertTo-Json $_ -Depth 8 -Compress).Replace($u + '27', "'").Replace($u + '3c', '<').Replace($u + '3e', '>').Replace($u + '26', '&')
})
$array = "[`r`n" + ($lines -join ",`r`n") + "`r`n    ]"
$json = "{`r`n  `"Jobs`": {`r`n    `"Schedules`": $array`r`n  }`r`n}`r`n"
$utf8 = New-Object System.Text.UTF8Encoding($false)
if ([IO.Path]::IsPathRooted($OutFile)) { $outFull = $OutFile } else { $outFull = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $OutFile)) }
[IO.File]::WriteAllText($outFull, $json, $utf8)

$enabledCount = @($entries | Where-Object { $_.Enabled }).Count
$report.Add("Converted $($entries.Count) schedule entries from $($jobs.Count) Agent jobs ($enabledCount enabled) -> $outFull")
foreach ($e in $entries) {
    $what = if ($e.Steps.Count -gt 0) { ($e.Steps | ForEach-Object { "$($_.Database).$($_.Procedure)" }) -join ' > ' } else { "$($e.Database).$($e.Procedure)" }
    $when = if ($null -ne $e.EveryMinutes) { "every $($e.EveryMinutes) min" + $(if ($e.WindowStart -or $e.WindowEnd) { " $($e.WindowStart)-$($e.WindowEnd)" } else { '' }) }
            elseif ($e.DailyAt.Count -gt 0) { 'at ' + ($e.DailyAt -join ', ') } else { 'no time' }
    if ($e.DaysOfWeek.Count -gt 0) { $when += ' on ' + ($e.DaysOfWeek -join ', ') }
    if ($e.DaysOfMonth.Count -gt 0) { $when += ' on day ' + ($e.DaysOfMonth -join ', ') }
    $state = if ($e.Enabled) { 'enabled ' } else { 'disabled' }
    $report.Add("  $state  $($e.Name): $what, $when")
}
$report.Add('')
$report.Add("Not converted ($($notConverted.Count)): set these up by hand or ask the developers")
foreach ($n in $notConverted) { $report.Add("  - $n") }
$report.Add('')
$report.Add("Check ($($warnings.Count))")
foreach ($w in $warnings) { $report.Add("  - $w") }

if ($CompareSettings) {
    $settings = Get-Content -LiteralPath $CompareSettings -Raw | ConvertFrom-Json
    $listed = @($settings.Jobs.Schedules | ForEach-Object { if ($_.PSObject.Properties['Procedure'] -and $_.Procedure) { "$($_.Database).$($_.Procedure)" } })
    $exported = @($entries | ForEach-Object { if ($_.Steps.Count -gt 0) { $_.Steps | ForEach-Object { "$($_.Database).$($_.Procedure)" } } else { "$($_.Database).$($_.Procedure)" } })
    $report.Add('')
    $report.Add("Compared with $CompareSettings")
    foreach ($p in ($listed | Sort-Object -Unique)) { if ($exported -notcontains $p) { $report.Add("  - $p is listed there but no Agent job runs it (left out; check it is not needed)") } }
    foreach ($p in ($exported | Sort-Object -Unique)) { if ($listed -notcontains $p) { $report.Add("  - $p is run by an Agent job but was not in the list") } }
}

if ($UpdateSettings) {
    $text = [IO.File]::ReadAllText($UpdateSettings)
    $m = [regex]::Match($text, '"Schedules"\s*:\s*\[')
    if (-not $m.Success) { throw "No `"Schedules`": [ in $UpdateSettings" }
    # Find the matching ']' outside strings.
    $depth = 0; $inStr = $false; $end = -1
    for ($i = $m.Index + $m.Length - 1; $i -lt $text.Length; $i++) {
        $ch = $text[$i]
        if ($inStr) { if ($ch -eq '\') { $i++ } elseif ($ch -eq '"') { $inStr = $false }; continue }
        if ($ch -eq '"') { $inStr = $true } elseif ($ch -eq '[') { $depth++ } elseif ($ch -eq ']') { $depth--; if ($depth -eq 0) { $end = $i; break } }
    }
    if ($end -lt 0) { throw "Unbalanced Schedules array in $UpdateSettings" }
    [IO.File]::WriteAllText("$UpdateSettings.bak", $text, $utf8)
    $new = $text.Substring(0, $m.Index) + '"Schedules": ' + $array + $text.Substring($end + 1)
    [IO.File]::WriteAllText($UpdateSettings, $new, $utf8)
    $report.Add('')
    $report.Add("Replaced Jobs:Schedules in $UpdateSettings (previous file: $UpdateSettings.bak). Next: Zed.Jobs --check")
}

[IO.File]::WriteAllText("$outFull.report.txt", ($report -join "`r`n") + "`r`n", $utf8)
$report | ForEach-Object { Write-Output $_ }
if ($notConverted.Count -gt 0) { exit 2 }
exit 0
