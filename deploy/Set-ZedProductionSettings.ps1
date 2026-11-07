<#
.SYNOPSIS
  Makes the server's settings file a Production one for https://zedv3.qci.org.in (docs/PRODUCTION.md section 1). Run it
  BEFORE the next Update-ZedFromGit.ps1: the update then installs the new code with these settings.

.DESCRIPTION
  Changes in the settings file (a copy of the previous one is kept next to it, administrators only):
    - ASPNETCORE_ENVIRONMENT = Production in Common (other sections lose their copy); DOTNET_ENVIRONMENT = Production in
      ZedJobs.
    - Database__Prefix kept (ZEDV4_ when missing) and Database__AllowPrefixInProduction = true, in Common and ZedJobs.
    - Removed everywhere: Email__RedirectAllTo, Email__AllowedRecipientDomains, Email__DeliverToRecipients,
      Portal__EnvironmentLabel (mail reaches its recipients; no test label).
    - Main: CcAvenue__GatewayUrl and CcAvenue__MobileServiceUrl set to CCAvenue's live addresses (the sites refuse the test
      gateway in Production). The live account's codes and keys are NOT written by this script: enter QCI's current live
      account in the CcAvenue__ settings of the Main section, or after the update in Administration -> Settings -> Payment
      Gateway and Invoices.
  And the Zed.Jobs service's environment (registry): the same environment, prefix and mail settings.

  It does NOT restart the app pools or Zed.Jobs: the code installed now does not know Database__AllowPrefixInProduction
  and would not start as Production. Update-ZedFromGit.ps1 (with -IncludeMobile -IncludeJobs) installs the new code and
  puts these settings on the app pools; it restarts them and Zed.Jobs.

  It lists what still has to be done by hand (live CCAvenue keys, mail server, reCAPTCHA keys for the domain, ...) and
  ends with exit code 2 while a setting the sites need at start is missing. Without -Apply it only shows what it would do.

.EXAMPLE
  .\deploy\Set-ZedProductionSettings.ps1
  .\deploy\Set-ZedProductionSettings.ps1 -Apply
  .\deploy\Update-ZedFromGit.ps1 -IncludeMobile -IncludeJobs -Apply
#>
[CmdletBinding()]
param(
    [string]$Settings = 'E:\ZedV4\settings.json',
    [string]$JobsService = 'ZedJobs',
    [string]$DatabasePrefix = 'ZEDV4_',
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
function Write-Step([string]$Text) { Write-Host ''; Write-Host "== $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    OK  $Text" -ForegroundColor Green }
function Write-Note([string]$Text) { Write-Host "    --  $Text" -ForegroundColor Yellow }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run PowerShell as Administrator.'
}
if (-not (Test-Path $Settings)) { throw "Settings file $Settings is missing." }
if ($DatabasePrefix -notmatch '^[A-Za-z][A-Za-z0-9_]{0,19}$') { throw "-DatabasePrefix '$DatabasePrefix': letters, digits and _ only (e.g. ZEDV4_)." }

$json = Get-Content $Settings -Raw | ConvertFrom-Json
$liveGateway = 'https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction'
$liveService = 'https://secure.ccavenue.com'
$removeEverywhere = 'Email__RedirectAllTo', 'Email__AllowedRecipientDomains', 'Email__DeliverToRecipients', 'Portal__EnvironmentLabel'
$changes = 0

function Section([string]$Name) {
    $s = $json.PSObject.Properties[$Name]
    if ($s -and $s.Value -is [System.Management.Automation.PSCustomObject]) { return $s.Value }
    $null
}
function Set-Value($Sec, [string]$SecName, [string]$Key, [string]$Value) {
    if ($Sec.PSObject.Properties[$Key]) {
        if ([string]$Sec.$Key -eq $Value) { return }
        $Sec.$Key = $Value
    }
    else { $Sec | Add-Member -NotePropertyName $Key -NotePropertyValue $Value }
    $script:changes++
    Write-Host "    set    $SecName.$Key = $Value"
}
function Remove-Value($Sec, [string]$SecName, [string]$Key) {
    if (-not $Sec.PSObject.Properties[$Key]) { return }
    $Sec.PSObject.Properties.Remove($Key)
    $script:changes++
    Write-Host "    remove $SecName.$Key"
}

Write-Step "$Settings -> Production (https://zedv3.qci.org.in)"
$common = Section 'Common'
if (-not $common) { throw "$Settings has no Common section." }
$jobs = Section 'ZedJobs'
$prefix = if ([string]$common.Database__Prefix) { [string]$common.Database__Prefix } else { $DatabasePrefix }

foreach ($sec in $json.PSObject.Properties) {
    if ($sec.Name -like '_*' -or $sec.Value -isnot [System.Management.Automation.PSCustomObject]) { continue }
    foreach ($k in $removeEverywhere) { Remove-Value $sec.Value $sec.Name $k }
    if ($sec.Name -notin 'Common', 'ZedJobs') {
        foreach ($k in 'ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT', 'Database__Prefix', 'Database__AllowPrefixInProduction') { Remove-Value $sec.Value $sec.Name $k }
    }
}
Set-Value $common 'Common' 'ASPNETCORE_ENVIRONMENT' 'Production'
Set-Value $common 'Common' 'Database__Prefix' $prefix
Set-Value $common 'Common' 'Database__AllowPrefixInProduction' 'true'
if ($jobs) {
    Remove-Value $jobs 'ZedJobs' 'ASPNETCORE_ENVIRONMENT'
    Set-Value $jobs 'ZedJobs' 'DOTNET_ENVIRONMENT' 'Production'
    Set-Value $jobs 'ZedJobs' 'Database__Prefix' $prefix
    Set-Value $jobs 'ZedJobs' 'Database__AllowPrefixInProduction' 'true'
}
else { Write-Note 'No ZedJobs section: set DOTNET_ENVIRONMENT=Production and the database settings of the Zed.Jobs service by hand (docs/JOBS.md).' }

$main = Section 'Main'
if ($main) {
    Set-Value $main 'Main' 'CcAvenue__GatewayUrl' $liveGateway
    Set-Value $main 'Main' 'CcAvenue__MobileServiceUrl' $liveService
}
# The apps' reset and document links (the mobile hosts refuse to start without an https address) and Contact ZED (until the
# Admin sets it under Links): never the old portal or a test site.
$mobile = Section 'Mobile'
if ($mobile -and (-not [string]$mobile.Portal__PublicBaseUrl -or [string]$mobile.Portal__PublicBaseUrl -match 'loginzed\.msme\.gov\.in')) {
    Set-Value $mobile 'Mobile' 'Portal__PublicBaseUrl' 'https://zedv3.qci.org.in'
}
$portals = Section 'Portals'
if ($portals -and (-not [string]$portals.Portal__ContactUrl -or [string]$portals.Portal__ContactUrl -match 'staging')) {
    Set-Value $portals 'Portals' 'Portal__ContactUrl' 'https://zed.msme.gov.in/contact-us'
}

# The apps' sign-in token: the mobile hosts issue it, the portals read it (documents, reports, certification status of the
# ZED MSME app). Without a shared key each host can read only its own tokens, and the portal answers the app's document
# downloads with 401, which signs the app out ("Your sign-in has expired"). A new random key when there is none; never shown.
if (-not [string]$common.Mobile__AppTokenKey) {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $common | Add-Member -NotePropertyName 'Mobile__AppTokenKey' -NotePropertyValue ([Convert]::ToBase64String($bytes)) -Force
    $script:changes++
    Write-Host '    set    Common.Mobile__AppTokenKey = (a new random key, not shown; the apps sign in again once)'
}

# ---------------------------------------------------------------- what is left by hand
Write-Step 'Still to do by hand'
$blocking = 0
function Merged([string[]]$Names) {
    $m = @{}
    foreach ($n in $Names) { $s = Section $n; if ($s) { foreach ($p in $s.PSObject.Properties) { $m[$p.Name] = [string]$p.Value } } }
    $m
}
$mainVars = Merged 'Common', 'Portals', 'Main'
foreach ($k in 'CcAvenue__MerchantId', 'CcAvenue__AccessCode', 'CcAvenue__WorkingKey', 'CcAvenue__ReconciliationWorkingKey') {
    if (-not $mainVars[$k]) { Write-Note "Main: $k is empty (the main portal does not start without it)"; $blocking++ }
}
Write-Note 'CCAvenue: put QCI''s current LIVE account in Main (CcAvenue__MerchantId, AccessCode, WorkingKey, ReconciliationWorkingKey, MobileAccessCode, MobileWorkingKey) instead of the test account, or enter it after the update in Administration -> Settings -> Payment Gateway and Invoices. Until then switch Payments off on that page.'
foreach ($portal in 'Main', 'Consultancy', 'Surveillance') {
    $v = Merged 'Common', 'Portals', $portal
    if (-not (Section $portal)) { continue }
    foreach ($k in 'Email__Profiles__Default__Host', 'Email__Profiles__Default__From') {
        if (-not $v[$k]) { Write-Note "${portal}: $k is empty (the portal does not start without it)"; $blocking++ }
    }
}
Write-Note 'Mail server: real SMTP details (Email__Profiles__...), or Administration -> Settings -> Email Settings.'
Write-Note 'reCAPTCHA: keys registered for zedv3.qci.org.in (Recaptcha__SiteKey, SecretKey, AppSecretKey).'
Write-Note 'Udyam__AccessKey and ProteanGstin__...: the live values.'
Write-Note 'Erp__Enabled stays false until invoices are wanted; UdyamiBharat__Enabled stays false until Udyami Bharat uses this address.'
Write-Note 'Zed.Jobs: switch on the schedules in its appsettings.json (mails, renewals, surveillance).'
Write-Note 'Secrets: new values, never the keys written in the old portal''s source.'

if (-not $Apply) {
    Write-Host ''
    Write-Host "    Dry run: $changes change(s). Add -Apply to change the settings file and the Zed.Jobs service's environment."
    if ($blocking -gt 0) { exit 2 }
    return
}

# ---------------------------------------------------------------- apply
if ($changes -gt 0) {
    $backup = "$Settings.$(Get-Date -Format 'yyyyMMdd-HHmmss').bak"
    Copy-Item $Settings $backup
    & icacls $backup /inheritance:r /grant:r 'BUILTIN\Administrators:(F)' 'NT AUTHORITY\SYSTEM:(F)' | Out-Null
    [IO.File]::WriteAllText($Settings, ($json | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
    Write-Ok "$Settings updated (previous version: $backup)"
}
else { Write-Ok "$Settings is already set for Production" }

Write-Step "$JobsService service environment (not restarted)"
if (-not (Get-Service $JobsService -ErrorAction SilentlyContinue)) { Write-Note "$JobsService not installed" }
else {
    $key = "HKLM:\SYSTEM\CurrentControlSet\Services\$JobsService"
    $current = @((Get-ItemProperty $key -Name Environment -ErrorAction SilentlyContinue).Environment)
    # The previous environment (it holds the same secrets as the settings file: administrators only), to put it back by
    # hand if the update is rolled back: the code before 2026-11-06 does not start with these Production settings.
    $jobsBackup = "$Settings.$(Get-Date -Format 'yyyyMMdd-HHmmss').$JobsService-environment.bak"
    [IO.File]::WriteAllLines($jobsBackup, [string[]]@($current | Where-Object { $_ }), (New-Object Text.UTF8Encoding $false))
    & icacls $jobsBackup /inheritance:r /grant:r 'BUILTIN\Administrators:(F)' 'NT AUTHORITY\SYSTEM:(F)' | Out-Null
    Write-Ok "previous $JobsService environment saved in $jobsBackup"
    Write-Note "To put it back: New-ItemProperty -Path '$key' -Name Environment -PropertyType MultiString -Value (Get-Content '$jobsBackup') -Force"
    $set =[ordered]@{ DOTNET_ENVIRONMENT = 'Production'; Database__Prefix = $prefix; Database__AllowPrefixInProduction = 'true' }
    $names = @($removeEverywhere) + @('ASPNETCORE_ENVIRONMENT') + @($set.Keys)
    $kept = @($current | Where-Object { $_ -and ($names -notcontains ($_ -split '=', 2)[0]) })
    $kept += @($set.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" })
    New-ItemProperty -Path $key -Name Environment -PropertyType MultiString -Value ([string[]]$kept) -Force | Out-Null
    Write-Ok "$JobsService environment set for Production (it takes effect when the update restarts the service)"
}

Write-Step 'Next'
Write-Host '    .\deploy\Update-ZedFromGit.ps1 -IncludeMobile -IncludeJobs            (dry run)'
Write-Host '    .\deploy\Update-ZedFromGit.ps1 -IncludeMobile -IncludeJobs -Apply'
Write-Host '    Do not restart the app pools before the update: the code installed now would not start as Production.'
if ($blocking -gt 0) { Write-Note "$blocking setting(s) the sites need at start are still empty (above): fill them before the update."; exit 2 }
