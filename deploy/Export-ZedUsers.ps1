<#
.SYNOPSIS
  Read-only: exports the users of the three ZED portals with their roles to CSV files (open them in Excel).

.DESCRIPTION
  For each portal database (ZED Certification = ZEDCS_V2_LIVE, Handholding = ZED_CONSULTANT, Surveillance =
  ZED_SURVEILLANCE; with -DatabasePrefix their prefixed names) it writes:
    users-<portal>.csv       every staff login of dbo.Users: user ID, name, role, e-mail, mobile, state, active,
                             verification types (desktop / site / financial), the agency that created it (CreatedBy),
                             created date and, where set, the login scope (category, levels, states; migration 0057)
    sub-users-<portal>.csv   the Operation Admins of Master Admins and the sub-users of agencies (dbo.V4SubUsers)
    summary.csv              the number of active and blocked logins per portal and role (MSMEs included)
  MSME logins (role 5) are counted in summary.csv; with -IncludeMsme they are also listed (one row per ZED ID).
  No password, password hash or token is read. Nothing is changed.

.EXAMPLE
  .\deploy\Export-ZedUsers.ps1
  .\deploy\Export-ZedUsers.ps1 -OutDir E:\ZedV4\exports\users -IncludeMsme
#>
param(
    [string]$Server = '.\SQLEXPRESS',
    [string]$DatabasePrefix = 'ZEDV4_',
    [string]$OutDir = '',
    [switch]$IncludeMsme,
    [System.Management.Automation.PSCredential]$Credential
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
if (-not $OutDir) { $OutDir = Join-Path (Get-Location) ('zed-users-' + (Get-Date -Format 'yyyyMMdd-HHmm')) }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$Portals = [ordered]@{
    'ZED Certification' = @{ Db = 'ZEDCS_V2_LIVE';    File = 'zed-certification' }
    'Handholding'       = @{ Db = 'ZED_CONSULTANT';   File = 'handholding' }
    'Surveillance'      = @{ Db = 'ZED_SURVEILLANCE'; File = 'surveillance' }
}

# Users.RoleId as the portals name them (the agency and assessor names differ per portal).
function Get-RoleName([int]$RoleId, [string]$Portal) {
    switch ($RoleId) {
        1  { 'Admin' }
        2  { if ($Portal -eq 'Handholding') { 'Consultant Organisation' } elseif ($Portal -eq 'Surveillance') { 'Surveillance Agency' } else { 'Assessment Agency' } }
        3  { if ($Portal -eq 'Handholding') { 'Consultant / Expert' } else { 'Assessor' } }
        4  { 'Site Assessor (old)' }
        5  { 'MSME' }
        6  { 'MSME DFO (State Coordinator)' }
        7  { 'Master Admin' }
        8  { 'Ministry' }
        10 { 'Dashboard - Super Admin' }
        11 { 'Dashboard - Citizen Feedback' }
        17 { 'Dashboard - QC' }
        default { "Other (role $RoleId)" }
    }
}

function Invoke-Query([string]$Database, [string]$Sql) {
    $builder = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
    $builder['Data Source'] = $Server
    $builder['Initial Catalog'] = $Database
    $builder['Application Name'] = 'Export-ZedUsers'
    $builder['TrustServerCertificate'] = $true
    if ($Credential) { $builder['User ID'] = $Credential.UserName; $builder['Password'] = $Credential.GetNetworkCredential().Password }
    else { $builder['Integrated Security'] = $true }
    $conn = New-Object System.Data.SqlClient.SqlConnection $builder.ConnectionString
    try {
        $conn.Open()
        $cmd = $conn.CreateCommand(); $cmd.CommandText = $Sql; $cmd.CommandTimeout = 300
        $table = New-Object System.Data.DataTable
        (New-Object System.Data.SqlClient.SqlDataAdapter $cmd).Fill($table) | Out-Null
        return ,$table
    } finally { $conn.Dispose() }
}

function Get-Column([System.Data.DataRow]$Row, [string]$Name) {
    if ($Row.Table.Columns.Contains($Name) -and $Row[$Name] -isnot [DBNull]) { return $Row[$Name] }
    return $null
}

$summary = New-Object System.Collections.Generic.List[object]
foreach ($portal in $Portals.Keys) {
    $db = $DatabasePrefix + $Portals[$portal].Db
    $file = $Portals[$portal].File
    Write-Host "== $portal ($db)"

    # Only the columns this database has (verification types, scope and agency columns came with later migrations).
    $cols = (Invoke-Query $db "SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Users');").Rows | ForEach-Object { $_.name }
    $optional = @('StateCode', 'DistrictCode', 'DesktopVerification', 'SiteVerification', 'FinancialVerification', 'AssessorType',
                  'SectorActivity', 'ScopeLevels', 'ScopeStates', 'SpocName') | Where-Object { $cols -contains $_ }
    $select = (@('UserId', 'UserName', 'RoleId', 'IsActive', 'Email', 'MobileNo', 'CreatedBy', 'CreatedDate') + $optional | ForEach-Object { "[$_]" }) -join ', '
    $where = if ($IncludeMsme) { '' } else { 'WHERE ISNULL(RoleId, 0) <> 5' }
    $users = Invoke-Query $db "SELECT $select FROM dbo.Users $where ORDER BY RoleId, UserId;"

    $rows = foreach ($r in $users.Rows) {
        $role = [int](Get-Column $r 'RoleId')
        $types = @(); foreach ($t in 'DesktopVerification', 'SiteVerification', 'FinancialVerification') { if ((Get-Column $r $t) -eq $true) { $types += $t -replace 'Verification', '' } }
        [pscustomobject][ordered]@{
            Portal                = $portal
            UserId                = Get-Column $r 'UserId'
            Name                  = Get-Column $r 'UserName'
            # A coordinator without a state is the national NEFT desk (it sees every state when its ID is in Neft:AllStatesUserIds).
            Role                  = if ($role -eq 6 -and -not (Get-Column $r 'StateCode')) { 'NEFT Admin (national desk, needs Neft:AllStatesUserIds)' } else { Get-RoleName $role $portal }
            RoleId                = $role
            Status                = if ((Get-Column $r 'IsActive') -eq $true) { 'Active' } else { 'Blocked' }
            Email                 = Get-Column $r 'Email'
            Mobile                = Get-Column $r 'MobileNo'
            SpocName              = Get-Column $r 'SpocName'
            StateCode             = Get-Column $r 'StateCode'
            VerificationTypes     = $types -join ', '
            AssessorType          = Get-Column $r 'AssessorType'
            CreatedBy             = Get-Column $r 'CreatedBy'
            CreatedDate           = Get-Column $r 'CreatedDate'
            ScopeCategory         = Get-Column $r 'SectorActivity'
            ScopeLevels           = Get-Column $r 'ScopeLevels'
            ScopeStates           = Get-Column $r 'ScopeStates'
        }
    }
    $usersFile = Join-Path $OutDir "users-$file.csv"
    @($rows) | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $usersFile
    Write-Host ("   {0} logins -> {1}" -f @($rows).Count, $usersFile)

    # Sub-users (migration 0012); a database without the table has none.
    $hasSub = (Invoke-Query $db "SELECT CASE WHEN OBJECT_ID('dbo.V4SubUsers', 'U') IS NULL THEN 0 ELSE 1 END AS Has;").Rows[0].Has
    $subs = @()
    if ($hasSub -eq 1) {
        $t = Invoke-Query $db "SELECT UserId, OwnerUserId, OwnerRoleId, UserName, Email, MobileNo, Permissions, IsActive, LastLoginAt, CreatedBy, CreatedAt FROM dbo.V4SubUsers ORDER BY OwnerUserId, UserId;"
        $subs = foreach ($r in $t.Rows) {
            $ownerRole = [int](Get-Column $r 'OwnerRoleId')
            [pscustomobject][ordered]@{
                Portal      = $portal
                UserId      = Get-Column $r 'UserId'
                Name        = Get-Column $r 'UserName'
                Role        = if ($ownerRole -eq 7) { 'Operation Admin (of a Master Admin)' } else { 'Sub-User (of an agency)' }
                WorksFor    = Get-Column $r 'OwnerUserId'
                OwnerRole   = Get-RoleName $ownerRole $portal
                Status      = if ((Get-Column $r 'IsActive') -eq $true) { 'Active' } else { 'Blocked' }
                Email       = Get-Column $r 'Email'
                Mobile      = Get-Column $r 'MobileNo'
                Screens     = Get-Column $r 'Permissions'
                LastLoginUtc = Get-Column $r 'LastLoginAt'
                CreatedBy   = Get-Column $r 'CreatedBy'
                CreatedUtc  = Get-Column $r 'CreatedAt'
            }
        }
    }
    $subFile = Join-Path $OutDir "sub-users-$file.csv"
    @($subs) | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $subFile
    Write-Host ("   {0} sub-users -> {1}" -f @($subs).Count, $subFile)

    # Counts per role (MSMEs included).
    $counts = Invoke-Query $db "SELECT ISNULL(RoleId, 0) AS RoleId, SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) AS Active, SUM(CASE WHEN ISNULL(IsActive, 0) = 0 THEN 1 ELSE 0 END) AS Blocked FROM dbo.Users GROUP BY ISNULL(RoleId, 0) ORDER BY RoleId;"
    foreach ($c in $counts.Rows) {
        $summary.Add([pscustomobject][ordered]@{ Portal = $portal; Role = Get-RoleName ([int]$c.RoleId) $portal; RoleId = [int]$c.RoleId; Active = [int]$c.Active; Blocked = [int]$c.Blocked })
    }
    $subActive = @($subs | Where-Object { $_.Status -eq 'Active' }).Count
    if (@($subs).Count -gt 0) {
        $summary.Add([pscustomobject][ordered]@{ Portal = $portal; Role = 'Operation Admins and Sub-Users'; RoleId = ''; Active = $subActive; Blocked = @($subs).Count - $subActive })
    }
}

$summaryFile = Join-Path $OutDir 'summary.csv'
$summary | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $summaryFile
$summary | Format-Table -AutoSize
Write-Host "Done. Files in $OutDir"
