<#
.SYNOPSIS
  Seeds fake data into the LOCAL ZED_SURVEILLANCE database for running the Bronze surveillance app against the
  V4 MobileApi on this PC (launch profile "surveillance", http://localhost:5106).

.DESCRIPTION
  The password of the fake assessor is generated once and kept in mobile/apps/msme/.env.local (ignored by Git),
  with ZED_TEST_ZEDID, ZED_TEST_ASSESSOR and ZED_TEST_PASSWORD. Nothing secret is printed.
#>
param(
    [string]$Server = 'localhost\SQLEXPRESS',
    [string]$Database = 'ZED_SURVEILLANCE',
    [string]$ZedId = 'ZEDRNTEST0001',
    [string]$AssessorId = 'ZEDRNSA01'
)
$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot '..\..\apps\msme\.env.local'
$values = @{}
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2] } }
}
if (-not $values['ZED_TEST_PASSWORD']) {
    $bytes = New-Object byte[] 9
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    # Upper case: the app upper-cases the password it sends, as the legacy app did.
    $values['ZED_TEST_PASSWORD'] = 'RN' + (-join ($bytes | ForEach-Object { $_.ToString('X2') }))
}
$values['ZED_TEST_ZEDID'] = $ZedId
$values['ZED_TEST_ASSESSOR'] = $AssessorId
@(
    '# Local development only (mobile/tools/dev-seed). Never commit.',
    "ZED_TEST_ZEDID=$($values['ZED_TEST_ZEDID'])",
    "ZED_TEST_ASSESSOR=$($values['ZED_TEST_ASSESSOR'])",
    "ZED_TEST_PASSWORD=$($values['ZED_TEST_PASSWORD'])"
) | Set-Content -Path $envFile -Encoding ascii

& sqlcmd -S $Server -E -C -d $Database -b -f 65001 -i (Join-Path $PSScriptRoot 'local-db-gaps.sql')
if ($LASTEXITCODE -ne 0) { throw "Creating the local stand-ins failed ($LASTEXITCODE)" }
& sqlcmd -S $Server -E -C -d $Database -b -i (Join-Path $PSScriptRoot 'surveillance-dev-seed.sql') `
    -v "AssessorId=$AssessorId" "ZedId=$ZedId" "Password=$($values['ZED_TEST_PASSWORD'])"
if ($LASTEXITCODE -ne 0) { throw "Seeding failed ($LASTEXITCODE)" }
Write-Host "Seeded $ZedId / $AssessorId; credentials in apps/msme/.env.local"
