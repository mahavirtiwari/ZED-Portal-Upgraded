<#
.SYNOPSIS
  Seeds fake data into the LOCAL ZED_CONSULTANT database for running the consultant app against the V4 consultancy mobile host
  on this PC (launch profile "consultancy", http://localhost:5105).

.DESCRIPTION
  The password of the fake consultants is generated once and kept in mobile/apps/consultant/.env.local (ignored by Git),
  with ZED_TEST_ZEDID, ZED_TEST_CONSULTANT (lead), ZED_TEST_CO_CONSULTANT and ZED_TEST_PASSWORD. Nothing secret is printed.
#>
param(
    [string]$Server = 'localhost\SQLEXPRESS',
    [string]$Database = 'ZED_CONSULTANT',
    [string]$ZedId = 'ZEDRNCS0001',
    [string]$LeadId = 'ZEDRNCL01',
    [string]$CoId = 'ZEDRNCC01',
    [int]$Milestone = 1
)
$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot '..\..\apps\consultant\.env.local'
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
    "ZED_TEST_CONSULTANT=$LeadId",
    "ZED_TEST_CO_CONSULTANT=$CoId",
    "ZED_TEST_PASSWORD=$($values['ZED_TEST_PASSWORD'])"
) | Set-Content -Path $envFile -Encoding ascii

& sqlcmd -S $Server -E -C -d $Database -b -i (Join-Path $PSScriptRoot 'consultant-dev-seed.sql') `
    -v "LeadId=$LeadId" "CoId=$CoId" "ZedId=$ZedId" "Milestone=$Milestone" "Password=$($values['ZED_TEST_PASSWORD'])"
if ($LASTEXITCODE -ne 0) { throw "Seeding failed ($LASTEXITCODE)" }
Write-Host "Seeded $ZedId / $LeadId, $CoId; credentials in apps/consultant/.env.local"
