<#
.SYNOPSIS
  Checks that the portals and the mobile hosts hold the same app sign-in token key (Mobile:AppTokenKey), without
  showing it. 2026-11-14.

.DESCRIPTION
  The mobile hosts issue the apps' sign-in token; the portals read it (the ZED MSME app's certification status, My
  Documents, pledge and level certificates). With different keys, or none, the portal refuses every app token and the
  app cannot open those (after the 2026-11-14 update it keeps asking to sign in again).
  Read-only. Reports, per settings section and per IIS app pool (ZedV4-*), whether Mobile__AppTokenKey is set, whether it
  is valid (base64 of at least 32 bytes) and whether it is the same as the Common section's. Values are never printed.
  To set one shared key: .\deploy\Set-ZedProductionSettings.ps1 -Apply (adds one to Common when missing), remove any
  other section's own Mobile__AppTokenKey, then run the update so the app pools get it.

.EXAMPLE
  .\deploy\Test-ZedAppTokenKey.ps1
#>
param([string]$Settings = 'E:\ZedV4\settings.json')

$ErrorActionPreference = 'Stop'
function Fingerprint([string]$v) {
    if ([string]::IsNullOrWhiteSpace($v)) { return $null }
    $sha = [Security.Cryptography.SHA256]::Create()
    [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($v.Trim()))).Replace('-', '')
}
function Valid([string]$v) {
    try { return ([Convert]::FromBase64String($v.Trim())).Length -ge 32 } catch { return $false }
}

Write-Host "Settings file: $Settings"
if (-not (Test-Path $Settings)) { throw "$Settings not found." }
$json = Get-Content $Settings -Raw | ConvertFrom-Json
$common = [string]$json.Common.Mobile__AppTokenKey
$commonPrint = Fingerprint $common
if (-not $common) { Write-Host '  Common: NOT SET  <- the portals and mobile hosts cannot share app tokens' -ForegroundColor Red }
elseif (-not (Valid $common)) { Write-Host '  Common: set, but NOT base64 of 32+ bytes' -ForegroundColor Red }
else { Write-Host '  Common: set and valid' -ForegroundColor Green }
foreach ($p in $json.PSObject.Properties) {
    if ($p.Name -eq 'Common') { continue }
    $v = [string]$p.Value.Mobile__AppTokenKey
    if ($v) {
        $same = (Fingerprint $v) -eq $commonPrint
        Write-Host ("  {0}: has its own key ({1})" -f $p.Name, $(if ($same) { 'same as Common' } else { 'DIFFERENT from Common: remove it' })) -ForegroundColor $(if ($same) { 'Yellow' } else { 'Red' })
    }
}

$appcmd = Join-Path $env:windir 'system32\inetsrv\appcmd.exe'
if (Test-Path $appcmd) {
    Write-Host 'IIS app pools (ZedV4-*):'
    $pools = & $appcmd list apppool /text:name | Where-Object { $_ -like 'ZedV4-*' }
    foreach ($pool in $pools) {
        [xml]$cfg = & $appcmd list apppool $pool /config:*
        $var = $cfg.SelectNodes('//environmentVariables/add') | Where-Object { $_.name -eq 'Mobile__AppTokenKey' } | Select-Object -First 1
        if (-not $var) { Write-Host "  ${pool}: NOT SET" -ForegroundColor Red; continue }
        $same = (Fingerprint $var.value) -eq $commonPrint
        Write-Host ("  {0}: set, {1}" -f $pool, $(if ($same) { 'same as Common' } else { 'DIFFERENT from Common (run the update to put the settings on the pools)' })) -ForegroundColor $(if ($same) { 'Green' } else { 'Red' })
    }
} else {
    Write-Host 'IIS appcmd not found: app pools not checked.'
}
