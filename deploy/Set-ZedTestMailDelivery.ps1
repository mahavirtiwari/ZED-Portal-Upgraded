<#
.SYNOPSIS
  Test server only: where the portals', mobile API's and Zed.Jobs' mails go. "Recipients" sends every mail to its real
  recipient, as the live portal does; "Redirect" sends every mail to one test mailbox instead (the shipped setting).

.DESCRIPTION
  Recipients: Email__RedirectAllTo (and Email__AllowedRecipientDomains) are removed and Email__DeliverToRecipients=true is
  set. Only for a test database that holds no real people's contact details: MSMEs, agencies and assessors in it would
  get the mails.
  Redirect: Email__RedirectAllTo=<-RedirectTo> is set and Email__DeliverToRecipients removed; each mail names its original
  recipients at the top.

  It changes the settings file (a copy of the previous one is kept next to it, administrators only), so the next deploy
  (Update-ZedFromGit.ps1) keeps the choice; the environment of the app pools now (they are restarted); and the
  environment of the Zed.Jobs service (restarted when running). Without -Apply it only shows what it would do.
  It refuses to run on the live server. It reads the environment of every ZED app pool installed here
  (ASPNETCORE_ENVIRONMENT; a pool without it runs as Production) and of the Zed.Jobs service, and refuses when any of
  them is Production. It then needs the settings file's Common.ASPNETCORE_ENVIRONMENT to name a test environment
  (Staging, Test, Testing or Development), or, when the settings file names none (production settings files do not:
  Install-ZedIis.ps1 adds it to the pools), installed app pools that all name one that is not Production.

.EXAMPLE
  .\deploy\Set-ZedTestMailDelivery.ps1 -Mode Recipients
  .\deploy\Set-ZedTestMailDelivery.ps1 -Mode Recipients -Apply
  .\deploy\Set-ZedTestMailDelivery.ps1 -Mode Redirect -RedirectTo dev.zed@qcin.org -Apply
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Recipients', 'Redirect')][string]$Mode,
    [string]$RedirectTo = 'dev.zed@qcin.org',
    [string]$Settings = 'E:\ZedV4\settings.json',
    [string]$JobsService = 'ZedJobs',
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
if ($Mode -eq 'Redirect' -and $RedirectTo -notmatch '^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$') { throw "-RedirectTo '$RedirectTo' is not an e-mail address." }

$json = Get-Content $Settings -Raw | ConvertFrom-Json
$envName = [string]$json.Common.ASPNETCORE_ENVIRONMENT
if ($envName -eq 'Production') { throw "$Settings is a Production settings file: the live portal always mails its recipients." }

# The app pools and the sections each one reads (as Install-ZedIis.ps1 merges them; later wins).
$poolSections = [ordered]@{
    'ZedV4-Main' = 'Common', 'Portals', 'Main'; 'ZedV4-Consultancy' = 'Common', 'Portals', 'Consultancy'
    'ZedV4-Surveillance' = 'Common', 'Portals', 'Surveillance'; 'ZedV4-Mobile-Main' = 'Common', 'Mobile', 'MobileMain'
    'ZedV4-Mobile-Consultancy' = 'Common', 'Mobile', 'MobileConsultancy'; 'ZedV4-Mobile-Surveillance' = 'Common', 'Mobile', 'MobileSurveillance'
}

# Is this the live server? A production settings file has no ASPNETCORE_ENVIRONMENT (Install-ZedIis.ps1 puts it on the
# pools), so the settings file alone cannot tell: the environment the pools and Zed.Jobs run with now is read too.
$testEnvironments = @('Staging', 'Test', 'Testing', 'Development')
$apphost = 'MACHINE/WEBROOT/APPHOST'
$running = [ordered]@{}
if (Get-Module -ListAvailable -Name WebAdministration) {
    Import-Module WebAdministration
    foreach ($pool in $poolSections.Keys) {
        if (-not (Test-Path "IIS:\AppPools\$pool")) { continue }
        $value = Get-WebConfigurationProperty -PSPath $apphost -Name value -ErrorAction SilentlyContinue `
            -Filter "system.applicationHost/applicationPools/add[@name='$pool']/environmentVariables/add[@name='ASPNETCORE_ENVIRONMENT']"
        if ($value -and $value.PSObject.Properties['Value']) { $value = $value.Value }
        # ASP.NET Core runs as Production when the variable is not set.
        $running["app pool $pool"] = if ([string]$value) { [string]$value } else { 'Production' }
    }
}
if (Get-Service $JobsService -ErrorAction SilentlyContinue) {
    $serviceVars = @((Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$JobsService" -Name Environment -ErrorAction SilentlyContinue).Environment)
    $jobsEnv = @($serviceVars | Where-Object { $_ -match '^(DOTNET|ASPNETCORE)_ENVIRONMENT=' } | ForEach-Object { ($_ -split '=', 2)[1] }) | Select-Object -First 1
    # Without a variable Zed.Jobs does not mail at all (its mail outbox refuses to send), so only a stated Production counts.
    if ($jobsEnv) { $running["service $JobsService"] = [string]$jobsEnv }
}
foreach ($kv in $running.GetEnumerator()) { Write-Host "    $($kv.Key): $($kv.Value)" }
$live = @($running.Keys | Where-Object { $running[$_] -eq 'Production' })
if ($live.Count -gt 0) {
    throw "This is the live server ($($live -join ', ') run as Production): the live portal always mails its recipients. Nothing was changed."
}
if ($testEnvironments -notcontains $envName) {
    $pools = @($running.Keys | Where-Object { $_ -like 'app pool *' })
    if ($pools.Count -eq 0) {
        throw "$Settings names no test environment (Common.ASPNETCORE_ENVIRONMENT is '$envName'; expected one of $($testEnvironments -join ', ')) and no ZED app pool is installed here to read it from. Nothing was changed."
    }
    Write-Note "$Settings names no test environment; the installed app pools run as $(@($pools | ForEach-Object { $running[$_] } | Select-Object -Unique) -join ', ')."
    if (-not $envName) { $envName = ($pools | ForEach-Object { $running[$_] } | Select-Object -First 1) }
}
$remove = if ($Mode -eq 'Recipients') { 'Email__RedirectAllTo', 'Email__AllowedRecipientDomains' } else { 'Email__DeliverToRecipients', 'Email__AllowedRecipientDomains' }
$set = if ($Mode -eq 'Recipients') { @{ Email__DeliverToRecipients = 'true' } } else { @{ Email__RedirectAllTo = $RedirectTo } }

Write-Step "$Settings ($envName): mails go to $(if ($Mode -eq 'Recipients') { 'their real recipients' } else { $RedirectTo })"
foreach ($sec in $json.PSObject.Properties) {
    if ($sec.Name -like '_*' -or $sec.Value -isnot [System.Management.Automation.PSCustomObject]) { continue }
    foreach ($n in $remove) {
        if ($sec.Value.PSObject.Properties[$n]) { $sec.Value.PSObject.Properties.Remove($n); Write-Host "    remove $($sec.Name).$n" }
    }
    # The new value goes where every pool (Common) and Zed.Jobs (ZedJobs) read it; other sections lose any copy.
    foreach ($kv in $set.GetEnumerator()) {
        if ($sec.Name -in 'Common', 'ZedJobs') {
            if ($sec.Value.PSObject.Properties[$kv.Key]) { $sec.Value.$($kv.Key) = $kv.Value } else { $sec.Value | Add-Member -NotePropertyName $kv.Key -NotePropertyValue $kv.Value }
            Write-Host "    set    $($sec.Name).$($kv.Key) = $($kv.Value)"
        }
        elseif ($sec.Value.PSObject.Properties[$kv.Key]) { $sec.Value.PSObject.Properties.Remove($kv.Key); Write-Host "    remove $($sec.Name).$($kv.Key)" }
    }
}
if ($Mode -eq 'Recipients') {
    Write-Note 'Every MSME, agency and assessor e-mail address in the test databases can now receive mails from this server.'
}
if (-not $Apply) { Write-Host ''; Write-Host '    Dry run. Add -Apply to change the settings file, the app pools and the jobs service.'; return }

$backup = "$Settings.$(Get-Date -Format 'yyyyMMdd-HHmmss').bak"
Copy-Item $Settings $backup
& icacls $backup /inheritance:r /grant:r 'BUILTIN\Administrators:(F)' 'NT AUTHORITY\SYSTEM:(F)' | Out-Null
[IO.File]::WriteAllText($Settings, ($json | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
Write-Ok "$Settings updated (previous version: $backup)"

Write-Step 'App pools'
Import-Module WebAdministration
$apphost = 'MACHINE/WEBROOT/APPHOST'
foreach ($pool in $poolSections.Keys) {
    if (-not (Test-Path "IIS:\AppPools\$pool")) { Write-Note "$pool not installed"; continue }
    $filter = "system.applicationHost/applicationPools/add[@name='$pool']/environmentVariables"
    foreach ($n in @($remove) + @($set.Keys)) {
        Remove-WebConfigurationProperty -PSPath $apphost -Filter $filter -Name '.' -AtElement @{ name = $n } -ErrorAction SilentlyContinue
    }
    foreach ($kv in $set.GetEnumerator()) { Add-WebConfigurationProperty -PSPath $apphost -Filter $filter -Name '.' -Value @{ name = $kv.Key; value = $kv.Value } }
    Restart-WebAppPool -Name $pool
    Write-Ok "$pool updated and restarted"
}

Write-Step "$JobsService service"
if (-not (Get-Service $JobsService -ErrorAction SilentlyContinue)) { Write-Note "$JobsService not installed" }
else {
    $key = "HKLM:\SYSTEM\CurrentControlSet\Services\$JobsService"
    $current = @((Get-ItemProperty $key -Name Environment -ErrorAction SilentlyContinue).Environment)
    $names = @($remove) + @($set.Keys)
    $kept = @($current | Where-Object { $_ -and ($names -notcontains ($_ -split '=', 2)[0]) })
    $kept += @($set.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" })
    New-ItemProperty -Path $key -Name Environment -PropertyType MultiString -Value ([string[]]$kept) -Force | Out-Null
    if ((Get-Service $JobsService).Status -eq 'Running') { Restart-Service $JobsService; Write-Ok "$JobsService updated and restarted" } else { Write-Ok "$JobsService updated (not running)" }
}

Write-Step 'Check'
Write-Host "    Admin -> Settings -> Email Settings -> Send test mail: it now goes $(if ($Mode -eq 'Recipients') { 'to the address you type' } else { "to $RedirectTo" })."
