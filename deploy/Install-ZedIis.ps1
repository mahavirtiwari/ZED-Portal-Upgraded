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
      plus ASPNETCORE_ENVIRONMENT=<EnvironmentName> (default Production) and DataProtection__KeysPath=<KeysRoot>\<app>
      unless given,
    - creates the key folder and grants the pool identity Modify on it and on every *StorageRoot folder,
    - points the IIS application at the new folder and pool.

  Before changing anything it writes <InstallRoot>\rollback-<time>.json with each application's previous
  physical path and app pool. -Rollback <that file> puts them back (the old pools and folders are not touched).

  A new server (staging, docs/STAGING.md) has no site yet. With -HostName and -CertificateThumbprint it also:
    - creates the site -SiteName if it does not exist (-CreateSite must be given; root folder <InstallRoot>\main),
    - adds an https binding <HostName>:443 with SNI and the certificate (LocalMachine\My; it must exist, have its
      private key, be valid now and cover the host name, wildcards included),
    - adds the same for every -AdditionalHostNames entry (e.g. the production host name on staging, for the phone
      tests of docs/STAGING.md),
    - with -HttpRedirect: an http binding <HostName>:80 and a site-level IIS URL Rewrite rule "ZED-HTTPS" that
      redirects http to https (301), except /.well-known/acme-challenge/ (win-acme renewals). Needs the IIS URL
      Rewrite module; without it the http binding is not added.
  The rollback file records what was created; -Rollback removes those bindings, the rule and a created site.

  -AllowedIpRanges (e.g. 203.0.113.10, 198.51.100.0/24) limits the site to those addresses with IIS IP and Domain
  Restrictions (feature Web-IP-Security), configured for this site only: other sites of a shared server keep their
  access. Everything else gets 404. The rollback file keeps the site's previous IP restrictions; -Rollback restores them.

  The install folder, the key folder and every *StorageRoot / KeysPath setting are refused on an Azure temporary disk
  (it holds DATALOSS_WARNING_README.txt and is wiped when the VM is redeployed).

  The settings file holds the secrets: keep it outside source control, readable by administrators only.
  deploy\settings.example.json lists the names. Environment variables of app pools are stored in
  applicationHost.config (readable by administrators only).

  Requires: IIS 10 (Windows Server 2016 or later), the ASP.NET Core Hosting Bundle 10, run as administrator.
  Windows PowerShell 5.1 or later.

.EXAMPLE
  .\Install-ZedIis.ps1 -Package E:\Releases\zed-2026.11.02-0900 -Settings E:\ZedV4\settings.json            # dry run
.EXAMPLE
  .\Install-ZedIis.ps1 -Package E:\Releases\zed-2026.11.02-0900 -Settings E:\ZedV4\settings.json -Apply
.EXAMPLE
  .\Install-ZedIis.ps1 -Package E:\Releases\zed-2026.11.02-0900 -Settings E:\ZedV4\settings.json -Apps Consultancy -Apply
.EXAMPLE
  .\Install-ZedIis.ps1 -Rollback E:\ZedV4\rollback-20261102-0915.json -Apply
.EXAMPLE
  # Staging (docs/STAGING.md): new site, certificate by thumbprint, http -> https
  .\Install-ZedIis.ps1 -Package E:\Releases\zed-2026.11.02-0900 -Settings E:\ZedV4\settings.json `
      -EnvironmentName Staging -SiteName ZED -CreateSite -HostName zedv3.qci.org.in -CertificateThumbprint <thumbprint> -HttpRedirect `
      -AllowedIpRanges 203.0.113.10,198.51.100.0/24
#>
[CmdletBinding(DefaultParameterSetName = 'Install')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Install')][string]$Package,
    [Parameter(Mandatory, ParameterSetName = 'Install')][string]$Settings,
    [Parameter(ParameterSetName = 'Install')][string]$InstallRoot = 'E:\ZedV4',
    [Parameter(ParameterSetName = 'Install')][string]$KeysRoot,
    [Parameter(ParameterSetName = 'Install')]
    [string[]]$Apps = @('Main', 'Consultancy', 'Surveillance', 'MobileMain', 'MobileConsultancy', 'MobileSurveillance'),
    [Parameter(ParameterSetName = 'Install')][ValidateSet('Production', 'Staging')][string]$EnvironmentName = 'Production',
    [Parameter(ParameterSetName = 'Install')][string]$HostName,
    [Parameter(ParameterSetName = 'Install')][string]$CertificateThumbprint,
    [Parameter(ParameterSetName = 'Install')][string[]]$AdditionalHostNames = @(),
    [Parameter(ParameterSetName = 'Install')][switch]$CreateSite,
    [Parameter(ParameterSetName = 'Install')][switch]$HttpRedirect,
    [Parameter(ParameterSetName = 'Install')][string[]]$AllowedIpRanges = @(),
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

# powershell -File passes "a,b" as one string: split the lists.
$Apps = @($Apps | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$AdditionalHostNames = @($AdditionalHostNames | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$AllowedIpRanges = @($AllowedIpRanges | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })

# "1.2.3.4" or "1.2.3.0/24" -> @{ ipAddress; subnetMask }
function ConvertTo-IpEntry([string]$Range) {
    $parts = $Range -split '/'
    $ip = $null
    if (-not [System.Net.IPAddress]::TryParse($parts[0], [ref]$ip) -or $ip.AddressFamily -ne 'InterNetwork') { throw "-AllowedIpRanges: '$Range' is not an IPv4 address or range." }
    $bits = 32
    if ($parts.Count -eq 2) { if (-not [int]::TryParse($parts[1], [ref]$bits) -or $bits -lt 8 -or $bits -gt 32) { throw "-AllowedIpRanges: '$Range' needs a prefix /8 to /32." } }
    elseif ($parts.Count -gt 2) { throw "-AllowedIpRanges: '$Range' is not a range." }
    $mask = [uint32]0
    if ($bits -gt 0) { $mask = [uint32]([math]::Pow(2, 32) - [math]::Pow(2, 32 - $bits)) }
    $maskText = (3..0 | ForEach-Object { ($mask -shr ($_ * 8)) -band 255 }) -join '.'
    @{ ipAddress = $ip.ToString(); subnetMask = $maskText }
}
$ipEntries = @($AllowedIpRanges | ForEach-Object { ConvertTo-IpEntry $_ })

# Azure's temporary disk is wiped on redeploy: nothing of V4 may live there.
function Assert-NotTemporaryDisk([string]$Path, [string]$What) {
    if (-not $Path) { return }
    $root = [System.IO.Path]::GetPathRoot($Path)
    if ($root -and (Test-Path (Join-Path $root 'DATALOSS_WARNING_README.txt'))) {
        throw "$What ($Path) is on $root, an Azure temporary disk (DATALOSS_WARNING_README.txt): it is wiped when the VM is redeployed. Use a data disk."
    }
}
foreach ($a in $Apps) { if (-not $catalog.Contains($a)) { throw "-Apps: unknown application $a (expected: $($catalog.Keys -join ', '))." } }

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
$siteExists = $iis -and (Test-Path "IIS:\Sites\$SiteName")
if ($iis -and -not $siteExists -and -not ($PSCmdlet.ParameterSetName -eq 'Install' -and $CreateSite)) {
    $msg = "IIS site '$SiteName' does not exist (Get-Website lists the sites; -CreateSite with -HostName creates it)."
    if ($Apply) { throw $msg } else { Write-Warning $msg }
}
if ($PSCmdlet.ParameterSetName -eq 'Install') {
    if (($CreateSite -or $HttpRedirect -or $AdditionalHostNames.Count -gt 0 -or $CertificateThumbprint) -and -not $HostName) {
        throw '-CreateSite, -HttpRedirect, -AdditionalHostNames and -CertificateThumbprint need -HostName.'
    }
    if ($HostName -and -not $CertificateThumbprint) { throw '-HostName needs -CertificateThumbprint (the https binding).' }
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
    # Plain strings: the IIS configuration objects behind these values make ConvertTo-Json (rollback file) fail in
    # Windows PowerShell 5.1 with "Argument types do not match".
    [pscustomobject]@{ Path = $Path; ApplicationPool = [string]$app.applicationPool; PhysicalPath = [string]$vdir.physicalPath }
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
    if ($saved.PSObject.Properties['CreatedSite'] -and $saved.CreatedSite) {
        Step "remove site $SiteName (created by the install; its applications go with it)" { Remove-Website -Name $SiteName }
        Write-Host 'Rollback done.'
        return
    }
    if ($saved.PSObject.Properties['AddedBindings']) {
        foreach ($b in @($saved.AddedBindings)) {
            Step "remove binding $($b.Protocol) $($b.BindingInformation)" {
                $parts = $b.BindingInformation -split ':'
                Get-WebBinding -Name $SiteName -Protocol $b.Protocol -Port $parts[1] -HostHeader $parts[2] | Remove-WebBinding
            }
        }
    }
    if ($saved.PSObject.Properties['AddedRedirectRule'] -and $saved.AddedRedirectRule) {
        Step "remove the URL Rewrite rule ZED-HTTPS of $SiteName" {
            Clear-WebConfiguration -PSPath $apphost -Location $SiteName -Filter "system.webServer/rewrite/rules/rule[@name='ZED-HTTPS']"
        }
    }
    if ($saved.PSObject.Properties['IpSecurityChanged'] -and $saved.IpSecurityChanged) {
        Step "restore the IP restrictions of $SiteName (allowUnlisted=$($saved.IpSecurityBefore.AllowUnlisted), $(@($saved.IpSecurityBefore.Entries).Count) entries)" {
            $f = 'system.webServer/security/ipSecurity'
            Clear-WebConfiguration -PSPath $apphost -Location $SiteName -Filter "$f/add" -ErrorAction SilentlyContinue
            Set-WebConfigurationProperty -PSPath $apphost -Location $SiteName -Filter $f -Name allowUnlisted -Value ([bool]$saved.IpSecurityBefore.AllowUnlisted)
            foreach ($e in @($saved.IpSecurityBefore.Entries)) {
                Add-WebConfigurationProperty -PSPath $apphost -Location $SiteName -Filter $f -Name '.' -Value @{ ipAddress = $e.ipAddress; subnetMask = $e.subnetMask; allowed = [bool]$e.allowed }
            }
        }
    }
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
Assert-NotTemporaryDisk $InstallRoot '-InstallRoot'
Assert-NotTemporaryDisk $KeysRoot '-KeysRoot'
foreach ($section in $settingsData.PSObject.Properties) {
    if ($section.Value -isnot [pscustomobject]) { continue }
    foreach ($p in $section.Value.PSObject.Properties) {
        if ($p.Name -match '(StorageRoot|KeysPath)$') { Assert-NotTemporaryDisk ([string]$p.Value) "$($section.Name).$($p.Name)" }
    }
}

function Get-Section([string]$Name) {
    $result = [ordered]@{}
    $section = $settingsData.$Name
    if ($section) { foreach ($p in $section.PSObject.Properties) { if ($p.Name -notlike '_*') { $result[$p.Name] = [string]$p.Value } } }
    $result
}

# ---- site and bindings (new servers: -HostName) ----------------------------------------------------------------
$createdSite = $false
$addedBindings = New-Object System.Collections.Generic.List[object]
$addedRule = $false
function Test-HostCovered([string]$Name, [string[]]$DnsNames) {
    foreach ($d in $DnsNames) {
        if ($d -ieq $Name) { return $true }
        if ($d.StartsWith('*.') -and $Name -like "*.$($d.Substring(2))" -and ($Name.Split('.').Count -eq $d.Split('.').Count)) { return $true }
    }
    return $false
}
if ($HostName) {
    $hosts = @($HostName) + @($AdditionalHostNames | Where-Object { $_ -and $_ -ne $HostName })
    $thumb = ($CertificateThumbprint -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
    $cert = Get-Item "Cert:\LocalMachine\My\$thumb" -ErrorAction SilentlyContinue
    if (-not $cert) {
        $msg = "Certificate $thumb is not in LocalMachine\My (import the .pfx there first; docs/STAGING.md)."
        if ($Apply) { throw $msg } else { Write-Warning $msg }
    }
    else {
        $dns = @($cert.DnsNameList | ForEach-Object { $_.Unicode })
        if (-not $cert.HasPrivateKey) { throw "Certificate $thumb has no private key." }
        if ($cert.NotAfter -lt (Get-Date) -or $cert.NotBefore -gt (Get-Date)) { throw "Certificate $thumb is not valid now ($($cert.NotBefore) - $($cert.NotAfter))." }
        foreach ($h in $hosts) { if (-not (Test-HostCovered $h $dns)) { Write-Warning "Certificate $thumb does not cover $h (it covers: $($dns -join ', '))." } }
        Write-Host "    certificate: $($cert.Subject), valid to $($cert.NotAfter.ToString('yyyy-MM-dd'))"
    }
    if ($iis -and -not $siteExists) {
        $rootFolder = Join-Path $InstallRoot 'main'
        Step "create site $SiteName (root $rootFolder, https ${HostName}:443)" {
            New-Item -ItemType Directory -Force -Path $rootFolder | Out-Null
            New-Website -Name $SiteName -PhysicalPath $rootFolder -HostHeader $HostName -Port 443 -Ssl -SslFlags 1 | Out-Null
        }
        $createdSite = $true
        $addedBindings.Add([pscustomobject]@{ Protocol = 'https'; BindingInformation = "*:443:$HostName" })
    }
    elseif (-not $iis) { Write-Warning 'IIS is not installed here: the site and bindings cannot be checked.' }
    foreach ($h in $hosts) {
        $existing = if ($iis -and ($siteExists -or -not $Apply)) { Get-WebBinding -Name $SiteName -Protocol https -Port 443 -HostHeader $h -ErrorAction SilentlyContinue } else { $null }
        if (-not $existing -and -not ($createdSite -and $h -eq $HostName)) {
            Step "add binding https *:443:$h (SNI) to $SiteName" { New-WebBinding -Name $SiteName -Protocol https -Port 443 -HostHeader $h -SslFlags 1 }
            $addedBindings.Add([pscustomobject]@{ Protocol = 'https'; BindingInformation = "*:443:$h" })
        }
        Step "attach certificate $thumb to ${h}:443 (SNI)" {
            $binding = Get-WebBinding -Name $SiteName -Protocol https -Port 443 -HostHeader $h
            $binding.AddSslCertificate($thumb, 'My')
        }
    }
    if ($HttpRedirect) {
        $rewrite = $iis -and (Get-WebGlobalModule -Name RewriteModule -ErrorAction SilentlyContinue)
        if (-not $rewrite) {
            Write-Warning 'IIS URL Rewrite is not installed: no http binding is added (http keeps answering 404). Install URL Rewrite 2.1 and run again for the redirect.'
        }
        else {
            foreach ($h in $hosts) {
                $existingHttp = Get-WebBinding -Name $SiteName -Protocol http -Port 80 -HostHeader $h -ErrorAction SilentlyContinue
                if (-not $existingHttp) {
                    Step "add binding http *:80:$h to $SiteName (redirected to https)" { New-WebBinding -Name $SiteName -Protocol http -Port 80 -HostHeader $h }
                    $addedBindings.Add([pscustomobject]@{ Protocol = 'http'; BindingInformation = "*:80:$h" })
                }
            }
            # A site that does not exist yet (dry run with -CreateSite) has no configuration path: reading it throws even
            # with -ErrorAction SilentlyContinue, and it has no rule.
            $ruleExists = $null
            if (Test-Path "IIS:\Sites\$SiteName") {
                try { $ruleExists = Get-WebConfigurationProperty -PSPath $apphost -Location $SiteName -Filter "system.webServer/rewrite/rules/rule[@name='ZED-HTTPS']" -Name name -ErrorAction SilentlyContinue }
                catch { $ruleExists = $null }
            }
            if (-not $ruleExists) {
                Step "add URL Rewrite rule ZED-HTTPS on $SiteName (http -> https 301, except /.well-known/acme-challenge/)" {
                    $filter = 'system.webServer/rewrite/rules'
                    Add-WebConfigurationProperty -PSPath $apphost -Location $SiteName -Filter $filter -Name '.' -Value @{ name = 'ZED-HTTPS'; stopProcessing = 'True' }
                    $rule = "$filter/rule[@name='ZED-HTTPS']"
                    Set-WebConfigurationProperty -PSPath $apphost -Location $SiteName -Filter "$rule/match" -Name url -Value '(.*)'
                    Add-WebConfigurationProperty -PSPath $apphost -Location $SiteName -Filter "$rule/conditions" -Name '.' -Value @{ input = '{HTTPS}'; pattern = '^OFF$' }
                    Add-WebConfigurationProperty -PSPath $apphost -Location $SiteName -Filter "$rule/conditions" -Name '.' -Value @{ input = '{REQUEST_URI}'; pattern = '^/\.well-known/acme-challenge/'; negate = 'True' }
                    Set-WebConfigurationProperty -PSPath $apphost -Location $SiteName -Filter "$rule/action" -Name type -Value 'Redirect'
                    Set-WebConfigurationProperty -PSPath $apphost -Location $SiteName -Filter "$rule/action" -Name url -Value 'https://{HTTP_HOST}/{R:1}'
                    Set-WebConfigurationProperty -PSPath $apphost -Location $SiteName -Filter "$rule/action" -Name redirectType -Value 'Permanent'
                }
                $addedRule = $true
            }
        }
    }
}

# ---- IP restrictions (-AllowedIpRanges, this site only) ---------------------------------------------------------
$ipChanged = $false
$ipBefore = $null
if ($ipEntries.Count -gt 0) {
    $f = 'system.webServer/security/ipSecurity'
    $ipModule = $iis -and (Get-WebGlobalModule -Name IpRestrictionModule -ErrorAction SilentlyContinue)
    if (-not $ipModule) {
        $msg = 'IIS IP and Domain Restrictions is not installed: Install-WindowsFeature Web-IP-Security, then run again.'
        if ($Apply) { throw $msg } else { Write-Warning $msg }
    }
    if ($iis -and $siteExists) {
        $ipBefore = [pscustomobject]@{
            AllowUnlisted = [bool](Get-WebConfigurationProperty -PSPath $apphost -Location $SiteName -Filter $f -Name allowUnlisted).Value
            Entries = @(Get-WebConfiguration -PSPath $apphost -Location $SiteName -Filter "$f/add" | ForEach-Object { [pscustomobject]@{ ipAddress = [string]$_.ipAddress; subnetMask = [string]$_.subnetMask; allowed = [bool]$_.allowed } })
        }
    }
    else { $ipBefore = [pscustomobject]@{ AllowUnlisted = $true; Entries = @() } }
    $list = ($ipEntries | ForEach-Object { "$($_.ipAddress)/$($_.subnetMask)" }) -join ', '
    Step "limit site $SiteName to $list (IIS IP restrictions, other addresses get 404; other sites unchanged)" {
        Clear-WebConfiguration -PSPath $apphost -Location $SiteName -Filter "$f/add" -ErrorAction SilentlyContinue
        foreach ($e in $ipEntries) {
            Add-WebConfigurationProperty -PSPath $apphost -Location $SiteName -Filter $f -Name '.' -Value @{ ipAddress = $e.ipAddress; subnetMask = $e.subnetMask; allowed = $true }
        }
        Set-WebConfigurationProperty -PSPath $apphost -Location $SiteName -Filter $f -Name allowUnlisted -Value $false
        Set-WebConfigurationProperty -PSPath $apphost -Location $SiteName -Filter $f -Name denyAction -Value 'NotFound'
    }
    $ipChanged = $true
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmm'
$rollbackFile = Join-Path $InstallRoot "rollback-$timestamp.json"
$before = foreach ($name in $Apps) {
    $c = Get-CurrentApp $catalog[$name].Path
    if ($c) { $c } else { [pscustomobject]@{ Path = $catalog[$name].Path; ApplicationPool = $null; PhysicalPath = $null } }
}
Step "save the current applications to $rollbackFile" {
    New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
    @{ Site = $SiteName; Saved = (Get-Date).ToString('o'); Applications = @($before); CreatedSite = [bool]$createdSite
       AddedBindings = @($addedBindings | ForEach-Object { [pscustomobject]@{ Protocol = [string]$_.Protocol; BindingInformation = [string]$_.BindingInformation } })
       AddedRedirectRule = [bool]$addedRule; IpSecurityChanged = [bool]$ipChanged; IpSecurityBefore = $ipBefore } |
            ConvertTo-Json -Depth 5 | Set-Content $rollbackFile -Encoding UTF8
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
    if (-not $vars.Contains('ASPNETCORE_ENVIRONMENT')) { $vars['ASPNETCORE_ENVIRONMENT'] = $EnvironmentName }
    if ($vars['ASPNETCORE_ENVIRONMENT'] -ne $EnvironmentName) {
        Write-Warning "$name`: the settings say ASPNETCORE_ENVIRONMENT=$($vars['ASPNETCORE_ENVIRONMENT']) but -EnvironmentName is $EnvironmentName; the settings win."
    }
    if (-not $vars.Contains('DataProtection__KeysPath')) { $vars['DataProtection__KeysPath'] = $keys }
    if ($app.System) { $vars['Mobile__System'] = $app.System }
    $empty = @($vars.Keys | Where-Object { [string]::IsNullOrWhiteSpace($vars[$_]) })
    if ($empty.Count -gt 0) { Write-Warning "$name settings with no value, left unset (the host stops at startup if it needs them): $($empty -join ', ')" }
    # IIS refuses an environment variable with an empty value ("String must not be empty"); unset means the same to the hosts.
    foreach ($k in $empty) { $vars.Remove($k) }

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
