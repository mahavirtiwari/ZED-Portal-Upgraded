<#
.SYNOPSIS
    STAGING ONLY. Copies the reference tables (masters, codes, fees, the assessment framework) from a source set of ZED
    databases into a prefixed set built from scratch (database\setup.ps1 -DatabasePrefix ZEDV4_; docs/STAGING.md 3.0).

.DESCRIPTION
    Preview by default: per table, the rows on the source, the rows on the target and what -Apply would do. Nothing is
    written. With -Apply each listed table is copied in its own transaction:
      * a target table that already has rows is skipped (so a second run copies nothing), unless -EmptyTargets, which
        first deletes that table's rows on the target (the target only, never the source);
      * identity values are kept (SqlBulkCopy KeepIdentity: the same as SET IDENTITY_INSERT ON), NULLs stay NULL;
      * only the columns both sides have are copied; computed and rowversion columns are left out.
    Then UrlsMasterData (the site address the procedures put into mail links and file paths) is pointed at
    -StagingBaseUrl in the three ZED databases of the target: the host of every stored address is replaced (its path is
    kept), and an empty table gets one active row.

    The source is only read: one SELECT per table (COUNT_BIG(*) for the preview, the column list for the copy), over a
    read-intent connection. Nothing is printed but table names and row counts, never data. Partner credentials
    (ApiClientTokens, ApiClientDynamicTokens), users, units, applications, payments, logs and the old backup tables
    (*_bkp*, *_old, *_DELETE, ...) are never copied: they are not in the list.

    The list ($ReferenceTables below) names each table with a note; leave one out with -Exclude
    'ZEDCS_V2_LIVE.Incentives','ZED_SURVEILLANCE.PageSettings' or by commenting its line.

.PARAMETER SourceServer
    The instance to read from (e.g. the production server through a read-only login, or a developer's copy). Not the
    target server, unless -AllowSameServerSource: on the staging server the other ZED databases there (the old staging
    site's) are never a source.
.PARAMETER SourceCredential
    SQL authentication for the source (Get-Credential). Without it, Windows authentication.
.PARAMETER SourceMainDatabase
    The source's ZEDCS_V2_LIVE (default that name). Likewise -SourceConsultancyDatabase and -SourceSurveillanceDatabase.
.PARAMETER TargetServer
    The staging instance (default .\SQLEXPRESS, Windows authentication).
.PARAMETER TargetDatabasePrefix
    The prefix of the target set (default ZEDV4_). Required: this script only writes into a prefixed set.
.PARAMETER Apply
    Copy. Without it nothing is written.
.PARAMETER EmptyTargets
    With -Apply: delete the target's rows of each listed table first (else a table with rows is skipped).
.PARAMETER Exclude
    Tables to leave out, as <logical database>.<table>.
.PARAMETER StagingBaseUrl
    The staging address for UrlsMasterData (default https://zedv3.qci.org.in).
.PARAMETER TrustServerCertificate
    Trust the servers' certificates (self-signed certificates of local and staging instances).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File database\staging\Copy-ZedReferenceData.ps1 -SourceServer PRODSQL01 -SourceCredential (Get-Credential)
    Preview against the target .\SQLEXPRESS, prefix ZEDV4_.
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File database\staging\Copy-ZedReferenceData.ps1 -SourceServer PRODSQL01 -SourceCredential (Get-Credential) -Apply
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SourceServer,
    [System.Management.Automation.PSCredential]$SourceCredential,
    [string]$SourceMainDatabase = 'ZEDCS_V2_LIVE',
    [string]$SourceConsultancyDatabase = 'ZED_CONSULTANT',
    [string]$SourceSurveillanceDatabase = 'ZED_SURVEILLANCE',
    [string]$TargetServer = '.\SQLEXPRESS',
    [string]$TargetDatabasePrefix = 'ZEDV4_',
    [switch]$Apply,
    [switch]$EmptyTargets,
    [string[]]$Exclude = @(),
    [string]$StagingBaseUrl = 'https://zedv3.qci.org.in',
    [switch]$TrustServerCertificate,
    [switch]$AllowSameServerSource,
    [int]$CommandTimeout = 600
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
. (Join-Path (Split-Path -Parent $here) 'ZedDatabaseNames.ps1')
Test-ZedDatabasePrefix $TargetDatabasePrefix
if (-not $TargetDatabasePrefix) { throw '-TargetDatabasePrefix is required (e.g. ZEDV4_): this script only writes into a prefixed set.' }
$StagingBaseUrl = $StagingBaseUrl.TrimEnd('/')
if ($StagingBaseUrl -notmatch '^https://' -or $StagingBaseUrl -match 'loginzed\.msme\.gov\.in') { throw '-StagingBaseUrl must be an https address that is not the live site.' }

# ---------------------------------------------------------------- the reference tables
# Per database: table = why it is reference data. Everything here is the same for every unit and holds no person's data
# except where noted. Comment a line (or use -Exclude) to leave a table out.
$ReferenceTables = [ordered]@{
    'ZEDCS_V2_LIVE' = [ordered]@{
        'States'                      = 'states (registration, allotment, reports)'
        'Districts'                   = 'districts per state, with the aspirational-district flag'
        'GstStateNames'               = 'GST state codes (invoices, GSTIN check)'
        'Sectors'                     = 'NIC 2-digit sectors that may register (SP_MSME_VALIDATE_UDYAM_DETAILS)'
        'Categories'                  = 'enterprise categories'
        'Technologies'                = 'technology list for upgradation recommendations'
        'AreaOfKnowledgeAndExpertise' = 'assessor expertise list'
        'AcommodationTypes'           = 'accommodation types (assessment questionnaire)'
        'Roles'                       = 'Users.RoleId names'
        'CertificationStatuses'       = 'application status codes the procedures compare against'
        'SectionTypes'                = 'assessment section types'
        'Sections'                    = 'assessment framework: sections'
        'Questions'                   = 'assessment framework: questions'
        'Options'                     = 'assessment framework: options'
        'SubOptions'                  = 'assessment framework: sub-options'
        'Requirements'                = 'assessment framework: requirements'
        'Evidences'                   = 'assessment framework: evidence list'
        'Questionaire'                = 'self-certification questionnaire'
        'AssessmentFee'               = 'certification fees per enterprise type and level (payment step)'
        'StateAssessmentFee'          = 'state subsidies on the fees'
        'SaPaymentCases'              = 'site assessment fee cases'
        'ImMasterInvoiceStatuses'     = 'impact assessment invoices: status codes'
        'ImMasterPaymentStatuses'     = 'impact assessment invoices: payment status codes'
        'ImMasterUnitPrices'          = 'impact assessment invoices: price per unit'
        'Incentives'                  = 'public incentive schemes list (holds the ministries'' published contact e-mail / phone)'
        'MyDocuments'                 = 'public documents list of the home page'
        'PageSettings'                = 'home page banners (file paths)'
        'UrlsMasterData'              = 'site address (set to -StagingBaseUrl afterwards)'
    }
    'ZED_CONSULTANT' = [ordered]@{
        'States'                      = 'states'
        'Districts'                   = 'districts per state'
        'Sectors'                     = 'sectors'
        'AreaOfKnowledgeAndExpertise' = 'consultant expertise list'
        'AcommodationTypes'           = 'accommodation types'
        'Roles'                       = 'Users.RoleId names'
        'CertificationStatuses'       = 'handholding status codes'
        'TechUpgradationStatuses'     = 'technology upgradation status codes'
        'SectionTypes'                = 'section types'
        'Questions'                   = 'questions'
        'Questionaire'                = 'questionnaire'
        'AssessmentFee'               = 'handholding fees'
        'StateAssessmentFee'          = 'state subsidies on the fees'
        'SaPaymentCases'              = 'fee cases'
        'Incentives'                  = 'public incentive schemes list'
        'MyDocuments'                 = 'public documents list'
        'PageSettings'                = 'home page banners'
        'UrlsMasterData'              = 'site address (set to -StagingBaseUrl afterwards)'
    }
    'ZED_SURVEILLANCE' = [ordered]@{
        'States'                      = 'states'
        'Districts'                   = 'districts per state'
        'Sectors'                     = 'sectors'
        'AreaOfKnowledgeAndExpertise' = 'assessor expertise list'
        'AcommodationTypes'           = 'accommodation types'
        'Roles'                       = 'Users.RoleId names'
        'CertificationStatuses'       = 'surveillance status codes'
        'SectionTypes'                = 'section types'
        'Sections'                    = 'surveillance framework: sections'
        'Questions'                   = 'surveillance framework: questions'
        'Options'                     = 'surveillance framework: options'
        'SubOptions'                  = 'surveillance framework: sub-options'
        'Requirements'                = 'surveillance framework: requirements'
        'Evidences'                   = 'surveillance framework: evidence list'
        'Questionaire'                = 'questionnaire'
        'AssessmentFee'               = 'surveillance fees'
        'SaPaymentCases'              = 'fee cases'
        'Incentives'                  = 'public incentive schemes list (published contact e-mail / phone)'
        'MyDocuments'                 = 'public documents list'
        'PageSettings'                = 'home page banners'
        'UrlsMasterData'              = 'site address (set to -StagingBaseUrl afterwards)'
    }
}
$SourceDb = @{ 'ZEDCS_V2_LIVE' = $SourceMainDatabase; 'ZED_CONSULTANT' = $SourceConsultancyDatabase; 'ZED_SURVEILLANCE' = $SourceSurveillanceDatabase }
$Exclude = @($Exclude | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
foreach ($x in $Exclude) {
    $db, $t = $x.Split('.', 2)
    if (-not $t -or -not $ReferenceTables.Contains($db) -or -not $ReferenceTables[$db].Contains($t)) { throw "-Exclude: '$x' is not a listed table (write <database>.<table>, e.g. ZEDCS_V2_LIVE.Incentives)." }
}

# ---------------------------------------------------------------- connections
function New-Conn([string]$srv, [string]$db, $cred, [bool]$readOnly) {
    $b = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
    $b['Data Source'] = $srv; $b['Initial Catalog'] = $db; $b['Application Name'] = 'Copy-ZedReferenceData'; $b['Connect Timeout'] = 30
    if ($readOnly) { $b['ApplicationIntent'] = 'ReadOnly' }
    if ($cred) { $b['User ID'] = $cred.UserName; $b['Password'] = $cred.GetNetworkCredential().Password; $b['Encrypt'] = $true }
    else { $b['Integrated Security'] = $true }
    if ($TrustServerCertificate) { $b['TrustServerCertificate'] = $true }
    $c = New-Object System.Data.SqlClient.SqlConnection $b.ConnectionString
    $c.Open()
    return $c
}
function Get-Scalar($conn, [string]$sql, $tx = $null) {
    $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = $CommandTimeout
    if ($tx) { $cmd.Transaction = $tx }
    return $cmd.ExecuteScalar()
}
function Get-Columns($conn, [string]$table) {
    # Writable columns of dbo.<table>, in order.
    $cmd = $conn.CreateCommand(); $cmd.CommandTimeout = $CommandTimeout
    $cmd.CommandText = "SELECT c.name FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id WHERE c.object_id = OBJECT_ID(N'dbo.' + QUOTENAME(@t), N'U') AND c.is_computed = 0 AND t.name NOT IN (N'timestamp', N'rowversion') ORDER BY c.column_id"
    [void]$cmd.Parameters.AddWithValue('@t', $table)
    $r = $cmd.ExecuteReader(); $cols = @()
    while ($r.Read()) { $cols += [string]$r[0] }
    $r.Close()
    return ,$cols
}
function Get-ServerName($conn) { return [string](Get-Scalar $conn "SELECT CAST(SERVERPROPERTY('ServerName') AS nvarchar(256))") }

$targetMaster = New-Conn $TargetServer 'master' $null $false
$sourceMaster = New-Conn $SourceServer 'master' $SourceCredential $true
$targetName = Get-ServerName $targetMaster; $sourceName = Get-ServerName $sourceMaster
if ($targetName -ieq $sourceName -and -not $AllowSameServerSource) {
    throw "The source ($sourceName) is the target server. On staging the other ZED databases there are never a source; copy from another server (or, on a developer machine, add -AllowSameServerSource)."
}
foreach ($db in $ReferenceTables.Keys) {
    $t = Get-ZedDatabaseName $db $TargetDatabasePrefix
    if ($null -eq (Get-Scalar $targetMaster "SELECT DB_ID(N'$t')")) { throw "Target database $t is not on $targetName (build it first: database\setup.ps1 -DatabasePrefix $TargetDatabasePrefix)." }
    $s = $SourceDb[$db]
    if ($null -eq (Get-Scalar $sourceMaster "SELECT DB_ID(N'$($s.Replace("'", "''"))')")) { throw "Source database $s is not on $sourceName." }
    if ($s -ieq $t -and $targetName -ieq $sourceName) { throw "Source and target are the same database ($t)." }
}
$sourceMaster.Close(); $targetMaster.Close()

Write-Host ("Reference data {0} -> {1}, prefix {2}: {3}" -f $sourceName, $targetName, $TargetDatabasePrefix, $(if ($Apply) { if ($EmptyTargets) { 'APPLY (emptying listed target tables first)' } else { 'APPLY (tables with rows are skipped)' } } else { 'PREVIEW' })) -ForegroundColor Cyan
$results = New-Object System.Collections.Generic.List[object]
$failed = $false
foreach ($db in $ReferenceTables.Keys) {
    $tdb = Get-ZedDatabaseName $db $TargetDatabasePrefix
    $src = New-Conn $SourceServer $SourceDb[$db] $SourceCredential $true
    $dst = New-Conn $TargetServer $tdb $null $false
    try {
        foreach ($table in $ReferenceTables[$db].Keys) {
            $row = [pscustomobject]@{ Database = $tdb; Table = $table; Source = ''; Target = ''; Action = ''; Note = $ReferenceTables[$db][$table] }
            $results.Add($row)
            if ($Exclude -contains "$db.$table") { $row.Action = 'excluded'; continue }
            $sc = Get-Columns $src $table; $tc = Get-Columns $dst $table
            if ($sc.Count -eq 0) { $row.Action = 'not on the source'; continue }
            if ($tc.Count -eq 0) { $row.Action = 'not on the target'; $failed = $true; continue }
            $cols = @($tc | Where-Object { $sc -contains $_ })
            $row.Source = [long](Get-Scalar $src "SELECT COUNT_BIG(*) FROM dbo.[$table]")
            $row.Target = [long](Get-Scalar $dst "SELECT COUNT_BIG(*) FROM dbo.[$table]")
            $missing = @($tc | Where-Object { $sc -notcontains $_ })
            if ($missing.Count) { $row.Note += " | target-only columns left to their defaults: $($missing -join ', ')" }
            if ($row.Target -gt 0 -and -not $EmptyTargets) { $row.Action = 'skip (target has rows)'; continue }
            if (-not $Apply) { $row.Action = $(if ($row.Target -gt 0) { "would empty, then copy $($row.Source)" } else { "would copy $($row.Source)" }); continue }

            $tx = $dst.BeginTransaction()
            try {
                if ($row.Target -gt 0) { [void](Get-Scalar $dst "DELETE FROM dbo.[$table]; SELECT @@ROWCOUNT" $tx) }
                $list = ($cols | ForEach-Object { "[$_]" }) -join ', '
                $cmd = $src.CreateCommand(); $cmd.CommandTimeout = $CommandTimeout
                $cmd.CommandText = "SELECT $list FROM dbo.[$table]"
                $reader = $cmd.ExecuteReader()
                try {
                    $opt = [System.Data.SqlClient.SqlBulkCopyOptions]::KeepIdentity -bor [System.Data.SqlClient.SqlBulkCopyOptions]::KeepNulls
                    $bulk = New-Object System.Data.SqlClient.SqlBulkCopy($dst, $opt, $tx)
                    $bulk.DestinationTableName = "dbo.[$table]"; $bulk.BulkCopyTimeout = $CommandTimeout
                    foreach ($c in $cols) { [void]$bulk.ColumnMappings.Add($c, $c) }
                    $bulk.WriteToServer($reader)
                    $bulk.Close()
                } finally { $reader.Close() }
                $after = [long](Get-Scalar $dst "SELECT COUNT_BIG(*) FROM dbo.[$table]" $tx)
                $tx.Commit()
                $row.Action = $(if ($row.Target -gt 0) { "emptied, copied $after" } else { "copied $after" })
                $row.Target = $after
            } catch {
                $tx.Rollback()
                $row.Action = 'FAILED (nothing changed): ' + $_.Exception.GetBaseException().Message
                $failed = $true
            }
        }

        # UrlsMasterData -> the staging address (host replaced, path kept), in the three ZED databases.
        if ($Apply -and $Exclude -notcontains "$db.UrlsMasterData") {
            $n = Get-Scalar $dst @"
DECLARE @base varchar(200) = '$StagingBaseUrl', @n int;
UPDATE dbo.UrlsMasterData
SET UrlName = @base + CASE WHEN CHARINDEX('/', UrlName, CHARINDEX('://', UrlName) + 3) > 0
                           THEN SUBSTRING(UrlName, CHARINDEX('/', UrlName, CHARINDEX('://', UrlName) + 3), 4000) ELSE '' END
WHERE UrlName LIKE '%://%' AND UrlName NOT LIKE @base + '%';
SET @n = @@ROWCOUNT;
IF NOT EXISTS (SELECT 1 FROM dbo.UrlsMasterData) BEGIN INSERT dbo.UrlsMasterData (UrlName, IsActive) VALUES (@base, 1); SET @n += 1; END
SELECT @n;
"@
            $results.Add([pscustomobject]@{ Database = $tdb; Table = 'UrlsMasterData'; Source = ''; Target = ''; Action = "address -> $StagingBaseUrl ($n row(s) changed)"; Note = '' })
        }
    } finally { $src.Close(); $dst.Close() }
}

$results | Format-Table Database, Table, Source, Target, Action -AutoSize | Out-String -Width 220 | Write-Host
if (-not $Apply) { Write-Host 'PREVIEW: nothing was written. Add -Apply to copy (and -EmptyTargets to replace tables that have rows).' -ForegroundColor Green }
elseif ($failed) { Write-Host 'Done, with failures (see above).' -ForegroundColor Red }
else { Write-Host 'Done. A second run with -Apply skips every table (they have rows now).' -ForegroundColor Green }
if ($failed) { exit 1 } else { exit 0 }
