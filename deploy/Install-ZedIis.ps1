<#
.SYNOPSIS
  Installs a V4 package (Publish-Zed.ps1) into IIS at the old applications' addresses. Dry run unless -Apply.

.DESCRIPTION
  Applications of the existing site (-SiteName, the one serving loginzed.msme.gov.in):

    IIS path                  Package folder   App pool                    Fixed settings
    /                         main             ZedV4-Main
    /Consultancy              consultancy      ZedV4-Consultancy
    /surveillance             surveillance     ZedV4-Surveillance
    /mobileapi                mobile           ZedV4-Mobile-Main           Mobile__System=Main
    /Consultancymobileapi     mobile           ZedV4-Mobile-Consultancy    Mobile__System=Consultancy
    /surveillancemobileapi    mobile           ZedV4-Mobile-Surveillance   Mobile__System=Surveillance

  For each application it:
    - copies the package folder to <InstallRoot>\<app> (app_offline.htm while copying; logs\ is kept),
    - creates or updates the app pool (No Managed Code, integrated, always running, no idle timeout),
    - sets the app pool's environment variables from the settings file (sections "Common", then "Portals" or
      "Mobile", then the app's own section),
      plus ASPNETCORE_ENVIRONMENT=Production and DataProtection__KeysPath=<KeysRoot>\<app> unless given,
    - creates the key folder and grants the pool identity Modify on it and on every *StorageRoot folder,
    - points the IIS application at the new folder and pool.

  Before changing anything it writes <InstallRoot>\rollback-<time>.json with each application's previous
  physical path and app pool. -Rollback <that file> puts them back (the old pools and folders are not touched).

  The settings file holds the secrets: keep it outside source control, readable by administrators only.
  deploy\settings.example.json lists the names. Environment variables of app pools are stored in
  applicationHost.config (readable by administrators only).

  Requires: IIS 10 (Windows Server 2016 or later), the ASP.NET Core Hosting Bundle 10, run as administrator.
  Windows PowerShell 5.1 or later.

.EXAMPLE
  .\Install-ZedIis.ps1 -Package D:\Releases\zed-2026.11.02-0900 -Settings D:\ZedV4\settings.json            # dry run
.EXAMPLE
  .\Install-ZedIis.ps1 -Package D:\Releases\zed-2026.11.02-0900 -Settings D:\ZedV4\settings.json -Apply
.EXAMPLE
  .\Install-ZedIis.ps1 -Package D:\Releases\zed-2026.11.02-0900 -Settings D:\ZedV4\settings.json -Apps Consultancy -Apply
.EXAMPLE
  .\Install-ZedIis.ps1 -Rollback D:\ZedV4\rollback-20261102-0915.json -Apply
#>
[CmdletBinding(DefaultParameterSetName = 'Install')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Install')][string]$Package,
    [Parameter(Mandatory, ParameterSetName = 'Install')][string]$Settings,
    [Parameter(ParameterSetName = 'Install')][string]$InstallRoot = 'D:\ZedV4',
    [Parameter(ParameterSetName = 'Install')][string]$KeysRoot,
    [Parameter(ParameterSetName = 'Install')]
    [ValidateSet('Main', 'Consultancy', 'Surveillance', 'MobileMain', 'MobileConsultancy', 'MobileSurveillance')]
    [string[]]$Apps = @('Main', 'Consultancy', 'Surveillance', 'MobileMain', 'MobileConsultancy', 'MobileSurveillance'),
    [Parameter(Mandatory, ParameterSetName = 'Rollback')][string]$Rollback,
    [string]$SiteName = 'Default Web Site',
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$apphost = 'MACHINE/WEBROOT/APPHOST'

$catalog = [ordered]@{
    Main               = @{ Path = '/';                       Folder = 'main';         Pool = 'ZedV4-Main' }
    Consultancy        = @{ Path = '/Consultancy';            Folder = 'consultancy';  Pool = 'ZedV4-Consultancy' }
    Surveillance       = @{ Path = '/surveillance';           Folder = 'surveillance'; Pool = 'ZedV4-Surveillance' }
    MobileMain         = @{ Path = '/mobileapi';              Folder = 'mobile';       Pool = 'ZedV4-Mobile-Main';         System = 'Main' }
    MobileConsultancy  = @{ Path = '/Consultancymobileapi';   Folder = 'mobile';       Pool = 'ZedV4-Mobile-Consultancy';  System = 'Consultancy' }
    MobileSurveillance = @{ Path = '/surveillancemobileapi';  Folder = 'mobile';       Pool = 'ZedV4-Mobile-Surveillance'; System = 'Surveillance' }
}

$mode = if ($Apply) { 'APPLY' } else { 'DRY RUN (add -Apply to make these changes)' }
Write-Host "Install-ZedIis: $mode" -ForegroundColor Yellow

function Step([string]$Description, [scriptblock]$Action) {
    if ($Apply) {
        Write-Host "  - $Description"
        & $Action
    }
    else { Write-Host "  would: $Description" }
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ---- prerequisites ---------------------------------------------------------------------------------------------
$iis = $null -ne (Get-Module -ListAvailable WebAdministration)
if ($iis) { Import-Module WebAdministration } else { Write-Warning 'IIS (WebAdministration module) is not installed here.' }
if ($Apply) {
    if (-not $iis) { throw 'IIS is not installed.' }
    if (-not (Test-Admin)) { throw 'Run as administrator.' }
}
$ancm = Join-Path $env:ProgramFiles 'IIS\Asp.Net Core Module\V2\aspnetcorev2.dll'
if (-not (Test-Path $ancm)) { Write-Warning "ASP.NET Core Module V2 not found ($ancm): install the .NET 10 Hosting Bundle." }
$runtimes = (& dotnet --list-runtimes 2>$null) -join "`n"
if ($runtimes -notmatch 'Microsoft\.AspNetCore\.App 10\.') { Write-Warning 'ASP.NET Core runtime 10 not found (dotnet --list-runtimes).' }
if ($iis -and -not (Test-Path "IIS:\Sites\$SiteName")) {
    $msg = "IIS site '$SiteName' does not exist (Get-Website lists the sites)."
    if ($Apply) { throw $msg } else { Write-Warning $msg }
}

function Get-AppLocation([string]$Path) {
    if ($Path -eq '/') { return "IIS:\Sites\$SiteName" }
    "IIS:\Sites\$SiteName$($Path -replace '/', '\')"
}

function Get-CurrentApp([string]$Path) {
    if (-not $iis) { return $null }
    $filter = "system.applicationHost/sites/site[@name='$SiteName']/application[@path='$Path']"
    $app = Get-WebConfiguration -PSPath $apphost -Filter $filter
    if (-not $app) { return $null }
    $vdir = Get-WebConfiguration -PSPath $apphost -Filter "$filter/virtualDirectory[@path='/']"
    [pscustomobject]@{ Path = $Path; ApplicationPool = $app.applicationPool; PhysicalPath = $vdir.physicalPath }
}

function Set-App([string]$Path, [string]$PhysicalPath, [string]$Pool) {
    $current = Get-CurrentApp $Path
    if ($Path -eq '/') {
        if (-not $current) {
            if ($Apply) { throw "Site '$SiteName' has no root application." }
            Write-Warning "Site '$SiteName' not found here: the root application cannot be checked."
        }
        Step "point $Path at $PhysicalPath, pool $Pool" {
            Set-ItemProperty "IIS:\Sites\$SiteName" -Name physicalPath -Value $PhysicalPath
            Set-ItemProperty "IIS:\Sites\$SiteName" -Name applicationPool -Value $Pool
        }
    }
    elseif ($current) {
        Step "point $Path at $PhysicalPath, pool $Pool (was $($current.PhysicalPath), $($current.ApplicationPool))" {
            Set-ItemProperty (Get-AppLocation $Path) -Name physicalPath -Value $PhysicalPath
            Set-ItemProperty (Get-AppLocation $Path) -Name applicationPool -Value $Pool
        }
    }
    else {
        Step "create application $Path -> $PhysicalPath, pool $Pool" {
            New-WebApplication -Site $SiteName -Name $Path.TrimStart('/') -PhysicalPath $PhysicalPath -ApplicationPool $Pool | Out-Null
        }
    }
}

# ---- rollback -------------------------------------------------------------------------------------------------
if ($PSCmdlet.ParameterSetName -eq 'Rollback') {
    $saved = Get-Content $Rollback -Raw | ConvertFrom-Json
    foreach ($a in $saved.Applications) {
        if (-not $a.PhysicalPath) {
            Step "remove application $($a.Path) (it did not exist before)" { Remove-WebApplication -Site $SiteName -Name $a.Path.TrimStart('/') }
        }
        else { Set-App $a.Path $a.PhysicalPath $a.ApplicationPool }
    }
    Write-Host 'Rollback done. The V4 app pools are left in place (stopped apps cost nothing); remove them when no longer needed.'
    return
}

# ---- install --------------------------------------------------------------------------------------------------
$Package = (Resolve-Path $Package).Path
if (-not (Test-Path (Join-Path $Package 'VERSION.txt'))) { throw "$Package is not a Publish-Zed.ps1 package (no VERSION.txt)." }
if (-not $KeysRoot) { $KeysRoot = Join-Path $InstallRoot 'keys' }
$settingsData = Get-Content $Settings -Raw | ConvertFrom-Json

function Get-Section([string]$Name) {
    $result = [ordered]@{}
    $section = $settingsData.$Name
    if ($section) { foreach ($p in $section.PSObject.Properties) { if ($p.Name -notlike '_*') { $result[$p.Name] = [string]$p.Value } } }
    $result
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmm'
$rollbackFile = Join-Path $InstallRoot "rollback-$timestamp.json"
$before = foreach ($name in $Apps) {
    $c = Get-CurrentApp $catalog[$name].Path
    if ($c) { $c } else { [pscustomobject]@{ Path = $catalog[$name].Path; ApplicationPool = $null; PhysicalPath = $null } }
}
Step "save the current applications to $rollbackFile" {
    New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
    @{ Site = $SiteName; Saved = (Get-Date).ToString('o'); Applications = @($before) } | ConvertTo-Json -Depth 4 | Set-Content $rollbackFile -Encoding UTF8
}
foreach ($b in $before) { Write-Host "    now: $($b.Path) -> $($b.PhysicalPath) [$($b.ApplicationPool)]" }

foreach ($name in $Apps) {
    $app = $catalog[$name]
    Write-Host "$name ($($app.Path))" -ForegroundColor Cyan
    $source = Join-Path $Package $app.Folder
    if (-not (Test-Path $source)) { throw "Package folder $source is missing." }
    $folderName = if ($app.System) { "mobile-$($app.System.ToLowerInvariant())" } else { $app.Folder }
    $dest = Join-Path $InstallRoot $folderName
    $keys = Join-Path $KeysRoot $folderName
    $identity = "IIS AppPool\$($app.Pool)"

    # Settings: Common, then Portals or Mobile, then the app's own section; fixed values last.
    $vars = Get-Section 'Common'
    foreach ($group in @($(if ($app.System) { 'Mobile' } else { 'Portals' }), $name)) {
        foreach ($kv in (Get-Section $group).GetEnumerator()) { $vars[$kv.Key] = $kv.Value }
    }
    if (-not $vars.Contains('ASPNETCORE_ENVIRONMENT')) { $vars['ASPNETCORE_ENVIRONMENT'] = 'Production' }
    if (-not $vars.Contains('DataProtection__KeysPath')) { $vars['DataProtection__KeysPath'] = $keys }
    if ($app.System) { $vars['Mobile__System'] = $app.System }
    $empty = @($vars.Keys | Where-Object { [string]::IsNullOrWhiteSpace($vars[$_]) })
    if ($empty.Count -gt 0) { Write-Warning "$name settings with no value (the host stops at startup if it needs them): $($empty -join ', ')" }

    # App pool.
    $poolExists = $iis -and (Test-Path "IIS:\AppPools\$($app.Pool)")
    Step "$(if ($poolExists) { 'update' } else { 'create' }) app pool $($app.Pool) (No Managed Code, AlwaysRunning, no idle timeout)" {
        if (-not (Test-Path "IIS:\AppPools\$($app.Pool)")) { New-WebAppPool -Name $app.Pool | Out-Null }
        $pool = "IIS:\AppPools\$($app.Pool)"
        Set-ItemProperty $pool -Name managedRuntimeVersion -Value ''
        Set-ItemProperty $pool -Name managedPipelineMode -Value 'Integrated'
        Set-ItemProperty $pool -Name startMode -Value 'AlwaysRunning'
        Set-ItemProperty $pool -Name processModel.idleTimeout -Value ([TimeSpan]::Zero)
        Set-ItemProperty $pool -Name processModel.loadUserProfile -Value $true
    }
    Step "set $($vars.Count) environment variables on $($app.Pool): $(($vars.Keys | Sort-Object) -join ', ')" {
        $filter = "system.applicationHost/applicationPools/add[@name='$($app.Pool)']/environmentVariables"
        Clear-WebConfiguration -PSPath $apphost -Filter $filter -ErrorAction SilentlyContinue
        foreach ($kv in $vars.GetEnumerator()) {
            Add-WebConfigurationProperty -PSPath $apphost -Filter $filter -Name '.' -Value @{ name = $kv.Key; value = $kv.Value }
        }
    }

    # Files.
    Step "copy $source -> $dest (app_offline.htm while copying; logs\ kept)" {
        New-Item -ItemType Directory -Force -Path $dest | Out-Null
        $offline = Join-Path $dest 'app_offline.htm'
        Set-Content $offline '<!doctype html><title>ZED</title><p>The portal is being updated. Please try again in a few minutes.</p>' -Encoding UTF8
        Start-Sleep -Seconds 3
        & robocopy $source $dest /MIR /R:3 /W:5 /NFL /NDL /NJH /NP /XD logs /XF app_offline.htm | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE) for $dest" }
        $global:LASTEXITCODE = 0
    }

    # Folders the pool identity writes to.
    $writable = @($keys, (Join-Path $dest 'logs'))
    foreach ($kv in $vars.GetEnumerator()) { if ($kv.Key -like '*StorageRoot' -and $kv.Value) { $writable += $kv.Value } }
    foreach ($folder in $writable) {
        Step "grant $identity Modify on $folder" {
            New-Item -ItemType Directory -Force -Path $folder | Out-Null
            & icacls $folder /grant "$($identity):(OI)(CI)M" /T /C /Q | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "icacls failed on $folder" }
        }
    }
    Step "restrict $keys to Administrators, SYSTEM and $identity" {
        & icacls $keys /inheritance:r /grant:r 'Administrators:(OI)(CI)F' 'SYSTEM:(OI)(CI)F' "$($identity):(OI)(CI)M" /Q | Out-Null
    }

    Set-App $app.Path $dest $app.Pool
    Step "remove app_offline.htm and start $($app.Pool)" {
        Remove-Item (Join-Path $dest 'app_offline.htm') -Force -ErrorAction SilentlyContinue
        $state = (Get-WebAppPoolState -Name $app.Pool).Value
        if ($state -eq 'Started') { Restart-WebAppPool -Name $app.Pool } else { Start-WebAppPool -Name $app.Pool }
    }
}

if ($Apply) {
    Write-Host "Done. Run deploy\Test-ZedDeployment.ps1 now. To undo: .\Install-ZedIis.ps1 -Rollback $rollbackFile -Apply" -ForegroundColor Green
}
else { Write-Host 'Dry run finished: nothing was changed.' -ForegroundColor Yellow }
