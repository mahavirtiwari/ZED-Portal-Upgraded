<#
.SYNOPSIS
    The one map from ZED's logical database names to the names on an instance (dot-source this file).

.DESCRIPTION
    The ZED procedures reach the other databases with three-part names (ZED_CONSULTANT.dbo.X), so one SQL Server
    instance can hold only one set of those names. A second set (the V4 staging set next to an older one, for example)
    gets a prefix: ZEDV4_ZEDCS_V2_LIVE, ZEDV4_ZED_CONSULTANT, ... . Every tool that reads or runs the repository's
    scripts uses these functions, so the scripts themselves keep the logical names.

    Convert-ZedDatabaseNames rewrites, in the text of a script:
      * dotted names:       ZED_CONSULTANT.dbo.X, [ZED_CONSULTANT].dbo.X, EXEC [KAWACH].sys.sp_executesql,
                            OBJECT_ID(N'ZEDCS_V2_LIVE.dbo.X') (any database.schema.object or four-part name);
      * USE X, USE [X];  CREATE / ALTER / DROP / BACKUP DATABASE X;
      * a quoted literal that is exactly a name: DB_ID(N'X'), name IN (N'X', ...), ''X'' in dynamic SQL.
    It never rewrites a name that is part of a longer identifier (SP_..._KAWACH, ZED_SURVEILLANCE_SERVICES), a
    folder in a file path (E:\Publish\ZEDCS_LIVE\ZEDCS_V2_LIVE\Uploads, D:\Publish\KAWACH\...), or a name that
    already carries the prefix. With an empty prefix the text comes back unchanged.
#>

$script:ZedLogicalDatabases = @(
    'ZEDCS_V2_LIVE', 'ZED_CONSULTANT', 'ZED_SURVEILLANCE',
    'ZED_CENTER_AUDIT_PROFESSIONAL', 'ZED_CENTER_AUDIT_V2', 'ZED_IMPACT_ASSESSMENT', 'KAWACH'
)
# Longest first, so ZED_CENTER_AUDIT_PROFESSIONAL is not read as ZED_CENTER_AUDIT_... of another name.
$script:ZedNameAlternation = (($script:ZedLogicalDatabases | Sort-Object { $_.Length } -Descending) -join '|')
$script:ZedNameRules = @(
    # dotted: the name is followed by '.', with or without brackets; not preceded by a letter, digit, _ or a path separator
    [regex]::new("(?<![A-Za-z0-9_\\/@#$])(\[?)($script:ZedNameAlternation)(\]?)(?=\s*\.)", 'IgnoreCase'),
    [regex]::new("(\bUSE\s+)(\[?)($script:ZedNameAlternation)(\]?)(?![A-Za-z0-9_])", 'IgnoreCase'),
    [regex]::new("(\bDATABASE\s+)(\[?)($script:ZedNameAlternation)(\]?)(?![A-Za-z0-9_])", 'IgnoreCase'),
    [regex]::new("(?<![A-Za-z0-9_])(N?')($script:ZedNameAlternation)(')", 'IgnoreCase')
)

function Test-ZedDatabasePrefix([string]$Prefix) {
    if ($Prefix -and $Prefix -notmatch '^[A-Za-z][A-Za-z0-9_]{0,19}$') {
        throw "DatabasePrefix '$Prefix': use letters, digits and _ only (at most 20 characters, starting with a letter), e.g. ZEDV4_"
    }
}

function Get-ZedDatabaseName([string]$Name, [string]$Prefix = '') {
    # Logical name -> name on the instance. Names outside the map (master, msdb, ...) are returned as they are.
    $logical = $script:ZedLogicalDatabases | Where-Object { $_ -ieq $Name } | Select-Object -First 1
    if ($logical -and $Prefix) { return "$Prefix$logical" }
    return $Name
}

function Convert-ZedDatabaseNames([string]$Text, [string]$Prefix = '') {
    if (-not $Prefix -or -not $Text) { return $Text }
    $p = $Prefix
    $names = $script:ZedLogicalDatabases
    $evaluator = [System.Text.RegularExpressions.MatchEvaluator] {
        param($m)
        # Keep everything around the name (brackets, USE, N', quotes); only the name itself changes, to its canonical case.
        $g = $m.Groups
        $out = New-Object System.Text.StringBuilder
        for ($i = 1; $i -lt $g.Count; $i++) {
            $v = $g[$i].Value
            $hit = $names | Where-Object { $_ -ieq $v } | Select-Object -First 1
            if ($hit) { $v = $p + $hit }
            [void]$out.Append($v)
        }
        $out.ToString()
    }.GetNewClosure()
    foreach ($rule in $script:ZedNameRules) { $Text = $rule.Replace($Text, $evaluator) }
    return $Text
}

function Convert-ZedDatabaseFile([string]$Path, [string]$Prefix, [string]$OutDir) {
    # Writes the mapped copy of a script to $OutDir (same file name) and returns its path; without a prefix, $Path.
    if (-not $Prefix) { return $Path }
    if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
    $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    $out = Join-Path $OutDir ([System.IO.Path]::GetFileName($Path))
    [System.IO.File]::WriteAllText($out, (Convert-ZedDatabaseNames $text $Prefix), (New-Object System.Text.UTF8Encoding $true))
    return $out
}
