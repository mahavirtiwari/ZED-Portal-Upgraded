<#
.SYNOPSIS
  Seeds fake data into the LOCAL ZEDCS_V2_LIVE database for running the site assessment app against the V4 MobileApi
  on this PC (launch profile "http", http://localhost:5104).

.DESCRIPTION
  The password of the fake assessors is generated once and kept in mobile/apps/assessor/.env.local (ignored by Git),
  with ZED_TEST_ZEDID, ZED_TEST_ASSESSOR (lead), ZED_TEST_CO_ASSESSOR and ZED_TEST_PASSWORD. Nothing secret is printed.
#>
param(
    [string]$Server = 'localhost\SQLEXPRESS',
    [string]$Database = 'ZEDCS_V2_LIVE',
    [string]$ZedId = 'ZEDRNSA0001',
    [string]$LeadId = 'ZEDRNLA01',
    [string]$CoId = 'ZEDRNCA01'
)
$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot '..\..\apps\assessor\.env.local'
$values = @{}
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2] } }
}
if (-not $values['ZED_TEST_PASSWORD']) {
    $bytes = New-Object byte[] 9
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $values['ZED_TEST_PASSWORD'] = 'Rn' + (-join ($bytes | ForEach-Object { $_.ToString('x2') }))
}
@(
    '# Local development only (mobile/tools/dev-seed). Never commit.',
    "ZED_TEST_ZEDID=$ZedId",
    "ZED_TEST_ASSESSOR=$LeadId",
    "ZED_TEST_CO_ASSESSOR=$CoId",
    "ZED_TEST_PASSWORD=$($values['ZED_TEST_PASSWORD'])"
) | Set-Content -Path $envFile -Encoding ascii

& sqlcmd -S $Server -E -C -d $Database -b -i (Join-Path $PSScriptRoot 'sa-dev-seed.sql') `
    -v "LeadId=$LeadId" "CoId=$CoId" "ZedId=$ZedId" "Password=$($values['ZED_TEST_PASSWORD'])"
if ($LASTEXITCODE -ne 0) { throw "Seeding failed ($LASTEXITCODE)" }
Write-Host "Seeded $ZedId / $LeadId, $CoId; credentials in apps/assessor/.env.local"
