<#
.SYNOPSIS
  Seeds fake data into a throwaway ZEDV4CHK_ main database for running the ZED MSME applicant app (apps/zedmsme) end to
  end against the V4 portal and MobileApi on this PC (msme-app-dev-seed.sql: a unit at the document upload, a certified
  unit with Financial Assistance open).

.DESCRIPTION
  The password of the fake units is generated once and kept in mobile/apps/zedmsme/.env.local (ignored by Git), with
  ZED_TEST_ZEDID_UPLOAD, ZED_TEST_ZEDID_CERTIFIED and ZED_TEST_PASSWORD. Nothing secret is printed.
#>
param(
    [string]$Server = 'localhost\SQLEXPRESS',
    [string]$Database = 'ZEDV4CHK_ZEDCS_V2_LIVE',
    [string]$ZedIdPrefix = 'ZEDRNAPP000'
)
$ErrorActionPreference = 'Stop'
if ($Database -notlike 'ZEDV4CHK_*') { throw 'Only a throwaway ZEDV4CHK_ database.' }
$envFile = Join-Path $PSScriptRoot '..\..\apps\zedmsme\.env.local'
$values = @{}
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2] } }
}
if (-not $values['ZED_TEST_PASSWORD']) {
    $bytes = New-Object byte[] 9
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    # Mixed case: the applicant app sends the password as typed.
    $values['ZED_TEST_PASSWORD'] = 'Rn#' + (-join ($bytes | ForEach-Object { $_.ToString('x2') }))
}
$values['ZED_TEST_ZEDID_UPLOAD'] = $ZedIdPrefix + '1'
$values['ZED_TEST_ZEDID_CERTIFIED'] = $ZedIdPrefix + '2'
@(
    '# Local development only (mobile/tools/dev-seed). Never commit.',
    "ZED_TEST_ZEDID_UPLOAD=$($values['ZED_TEST_ZEDID_UPLOAD'])",
    "ZED_TEST_ZEDID_CERTIFIED=$($values['ZED_TEST_ZEDID_CERTIFIED'])",
    "ZED_TEST_PASSWORD=$($values['ZED_TEST_PASSWORD'])"
) | Set-Content -Path $envFile -Encoding ascii

& sqlcmd -S $Server -E -C -d $Database -b -i (Join-Path $PSScriptRoot 'msme-app-dev-seed.sql') `
    -v "ZedId=$ZedIdPrefix" "Password=$($values['ZED_TEST_PASSWORD'])"
if ($LASTEXITCODE -ne 0) { throw "Seeding failed ($LASTEXITCODE)" }
Write-Host "Seeded ${ZedIdPrefix}1 and ${ZedIdPrefix}2; credentials in apps/zedmsme/.env.local"
