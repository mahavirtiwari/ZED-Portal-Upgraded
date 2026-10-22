<#
.SYNOPSIS
  Smoke tests for a V4 deployment. Exit code 0 when every check passes, 1 otherwise.

.DESCRIPTION
  For each portal (main, Consultancy, Surveillance):
    - /api/health (process up) and /api/health/ready (its database answers) say Healthy;
    - / serves the Angular app with the right <base href> (/, /Consultancy/, /surveillance/);
    - the login pages and old addresses from mails (e.g. /Msme/Login) reach the Angular app, which redirects;
      a 403 here usually means a ZED-* request rule of docs/LIVE-HARDENING.md is still in place;
    - /api/auth/me answers and sets the XSRF-TOKEN cookie on the portal's own path;
    - dangerous old actions are gone: the answer is the Angular app or a 4xx, never the old controller's data.
  For each mobile services deployment (/mobileapi, /Consultancymobileapi, /surveillancemobileapi):
    - / answers like the old services, /health and /health/ready say Healthy;
    - main only: Msme/Login with empty credentials answers in the old JSON contract (status "0", or "2" when the
      version gate is on). No real credentials are ever sent.

  Environment label (docs/STAGING.md):
    - with -ExpectEnvironmentLabel STAGING: each portal's /api/config says that label, responses carry
      X-Robots-Tag noindex and /robots.txt disallows everything;
    - without it (the live site): a portal that carries a label fails the run.
  -CheckHttpsRedirect: http://<host>/ answers 301/308 to the same address on https.

  Read-only: nothing is created or changed. Windows PowerShell 5.1 or later.

.EXAMPLE
  .\Test-ZedDeployment.ps1 -BaseUrl https://loginzed.msme.gov.in
.EXAMPLE
  .\Test-ZedDeployment.ps1 -BaseUrl https://zedv3.qci.org.in -ExpectEnvironmentLabel STAGING -CheckHttpsRedirect
.EXAMPLE
  # Hosts on separate ports (a local check of a package; see docs/CUTOVER.md)
  .\Test-ZedDeployment.ps1 -MainUrl http://localhost:5201 -ConsultancyUrl http://localhost:5202/Consultancy `
      -SurveillanceUrl http://localhost:5203/surveillance -MobileMainUrl http://localhost:5204 `
      -MobileConsultancyUrl http://localhost:5205 -MobileSurveillanceUrl http://localhost:5206
#>
[CmdletBinding()]
param(
    [string]$BaseUrl,
    [string]$MainUrl,
    [string]$ConsultancyUrl,
    [string]$SurveillanceUrl,
    [string]$MobileMainUrl,
    [string]$MobileConsultancyUrl,
    [string]$MobileSurveillanceUrl,
    [ValidateSet('Main', 'Consultancy', 'Surveillance', 'MobileMain', 'MobileConsultancy', 'MobileSurveillance')]
    [string[]]$Skip = @(),
    [string]$AppVersion = '0.0.0-smoketest',
    [string]$ExpectEnvironmentLabel,
    [switch]$CheckHttpsRedirect,
    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

if ($BaseUrl) {
    $b = $BaseUrl.TrimEnd('/')
    if (-not $MainUrl) { $MainUrl = $b }
    if (-not $ConsultancyUrl) { $ConsultancyUrl = "$b/Consultancy" }
    if (-not $SurveillanceUrl) { $SurveillanceUrl = "$b/surveillance" }
    if (-not $MobileMainUrl) { $MobileMainUrl = "$b/mobileapi" }
    if (-not $MobileConsultancyUrl) { $MobileConsultancyUrl = "$b/Consultancymobileapi" }
    if (-not $MobileSurveillanceUrl) { $MobileSurveillanceUrl = "$b/surveillancemobileapi" }
}

$handler = New-Object System.Net.Http.HttpClientHandler
$handler.AllowAutoRedirect = $false
$handler.UseCookies = $false
$client = New-Object System.Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
$client.DefaultRequestHeaders.UserAgent.ParseAdd('ZedSmokeTest/1.0')

$script:failures = 0
$script:passes = 0
$script:warnings = 0

function Send([string]$Method, [string]$Url, [hashtable]$Form) {
    $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::new($Method), $Url)
    if ($Form) {
        $pairs = New-Object 'System.Collections.Generic.List[System.Collections.Generic.KeyValuePair[string,string]]'
        foreach ($k in $Form.Keys) { $pairs.Add((New-Object 'System.Collections.Generic.KeyValuePair[string,string]' $k, $Form[$k])) }
        $request.Content = [System.Net.Http.FormUrlEncodedContent]::new($pairs)
    }
    try {
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $type = if ($response.Content.Headers.ContentType) { $response.Content.Headers.ContentType.MediaType } else { '' }
        $cookies = @()
        $values = $null
        if ($response.Headers.TryGetValues('Set-Cookie', [ref]$values)) { $cookies = @($values) }
        $server = @()
        if ($response.Headers.TryGetValues('Server', [ref]$values)) { $server += $values }
        if ($response.Headers.TryGetValues('X-Powered-By', [ref]$values)) { $server += $values }
        $robots = ''
        if ($response.Headers.TryGetValues('X-Robots-Tag', [ref]$values)) { $robots = ($values -join ', ') }
        $location = if ($response.Headers.Location) { [string]$response.Headers.Location } else { '' }
        [pscustomobject]@{ Status = [int]$response.StatusCode; Body = $body; Type = $type; Cookies = $cookies; Server = ($server -join ' '); Robots = $robots; Location = $location; Error = $null }
    }
    catch {
        $e = $_.Exception
        while ($e.InnerException) { $e = $e.InnerException }
        [pscustomobject]@{ Status = 0; Body = ''; Type = ''; Cookies = @(); Server = ''; Robots = ''; Location = ''; Error = $e.Message }
    }
}

function Report([bool]$Ok, [string]$Name, [string]$Detail) {
    if ($Ok) { $script:passes++; Write-Host "  PASS  $Name" -ForegroundColor Green }
    else { $script:failures++; Write-Host "  FAIL  $Name - $Detail" -ForegroundColor Red }
}

function Describe($r) {
    if ($r.Error) { return "no answer: $($r.Error)" }
    $snippet = ($r.Body -replace '\s+', ' ')
    if ($snippet.Length -gt 80) { $snippet = $snippet.Substring(0, 80) + '...' }
    "HTTP $($r.Status) $($r.Type) '$snippet'"
}

function Test-Healthy([string]$Name, [string]$Url) {
    $r = Send 'GET' $Url
    Report ($r.Status -eq 200 -and $r.Body.Trim() -eq 'Healthy') $Name (Describe $r)
}

function Get-BaseHref([string]$Url) {
    $path = ([Uri]$Url).AbsolutePath.TrimEnd('/')
    "$path/"
}

function Test-Spa($r, [string]$BaseHref) {
    $r.Status -eq 200 -and $r.Type -eq 'text/html' -and $r.Body -match ('<base href="' + [regex]::Escape($BaseHref) + '"')
}

function Test-Portal([string]$Name, [string]$Url, [string[]]$Pages, [string[]]$Gone) {
    $Url = $Url.TrimEnd('/')
    $base = Get-BaseHref $Url
    Write-Host "$Name portal ($Url)" -ForegroundColor Cyan
    Test-Healthy "$Name /api/health" "$Url/api/health"
    Test-Healthy "$Name /api/health/ready (database)" "$Url/api/health/ready"

    $r = Send 'GET' "$Url/"
    Report (Test-Spa $r $base) "$Name / serves the Angular app with base href $base" (Describe $r)
    Test-Label $Name $Url $r
    if ($r.Server -match 'IIS|ASP\.NET') { $script:warnings++; Write-Host "  WARN  $Name sends '$($r.Server)': web.config should remove it" -ForegroundColor Yellow }

    foreach ($page in $Pages) {
        $r = Send 'GET' "$Url$page"
        $hint = if ($r.Status -eq 403) { ' (a ZED-* request rule is probably still in place)' } else { '' }
        Report (Test-Spa $r $base) "$Name $page reaches the Angular app" ((Describe $r) + $hint)
    }

    $r = Send 'GET' "$Url/api/auth/me"
    $cookiePath = if ($base -eq '/') { '/' } else { $base.TrimEnd('/') }
    $xsrf = @($r.Cookies | Where-Object { $_ -match '^XSRF-TOKEN=' })
    $pathOk = $xsrf.Count -gt 0 -and ($xsrf[0] -match ('(?i);\s*path=' + [regex]::Escape($cookiePath) + '(;|$)'))
    # Signed out: 204. The cookie value is a token: show only its attributes.
    $attributes = @($xsrf | ForEach-Object { $_ -replace '^XSRF-TOKEN=[^;]*', 'XSRF-TOKEN=...' })
    Report (($r.Status -eq 200 -or $r.Status -eq 204) -and $pathOk) "$Name /api/auth/me sets XSRF-TOKEN on path $cookiePath" ((Describe $r) + " cookie: $($attributes -join ' | ')")

    foreach ($old in $Gone) {
        foreach ($method in 'GET', 'POST') {
            $r = Send $method "$Url$old"
            $ok = (Test-Spa $r $base) -or ($r.Status -ge 400 -and $r.Status -lt 500)
            Report $ok "$Name $method $old is not the old action" (Describe $r)
        }
    }
}

function Test-Label([string]$Name, [string]$Url, $Landing) {
    $config = Send 'GET' "$Url/api/config"
    $label = $null
    try { $label = ($config.Body | ConvertFrom-Json).environmentLabel } catch { }
    if ($ExpectEnvironmentLabel) {
        Report ($label -eq $ExpectEnvironmentLabel) "$Name /api/config says environment label $ExpectEnvironmentLabel" ("label '$label'; " + (Describe $config))
        Report ($Landing.Robots -match 'noindex') "$Name responses carry X-Robots-Tag noindex" ("X-Robots-Tag '$($Landing.Robots)'")
        $robots = Send 'GET' "$Url/robots.txt"
        Report ($robots.Status -eq 200 -and $robots.Body -match 'Disallow:\s*/\s*$') "$Name /robots.txt disallows everything" (Describe $robots)
    }
    else {
        Report ([string]::IsNullOrWhiteSpace($label) -and $Landing.Robots -notmatch 'noindex') "$Name carries no test-environment label (live site)" ("label '$label', X-Robots-Tag '$($Landing.Robots)'")
    }
}

function Test-HttpsRedirect([string]$Url) {
    $u = [Uri]$Url
    if ($u.Scheme -ne 'https') { Write-Host "  SKIP  -CheckHttpsRedirect: $Url is not https" -ForegroundColor DarkGray; return }
    $http = "http://$($u.Host)/"
    Write-Host "http -> https ($http)" -ForegroundColor Cyan
    $r = Send 'GET' $http
    $ok = ($r.Status -eq 301 -or $r.Status -eq 308) -and $r.Location -like "https://$($u.Host)/*"
    Report $ok "http://$($u.Host)/ redirects permanently to https" ("HTTP $($r.Status) Location '$($r.Location)'" + $(if ($r.Error) { " ($($r.Error))" } else { '' }))
}

function Test-Mobile([string]$Name, [string]$Url, [bool]$MsmeLogin) {
    $Url = $Url.TrimEnd('/')
    Write-Host "$Name mobile services ($Url)" -ForegroundColor Cyan
    $r = Send 'GET' "$Url/"
    Report ($r.Status -eq 200 -and $r.Body -match 'ZED services') "$Name / answers like the old services" (Describe $r)
    Test-Healthy "$Name /health" "$Url/health"
    Test-Healthy "$Name /health/ready (database)" "$Url/health/ready"
    if ($ExpectEnvironmentLabel) { Report ($r.Robots -match 'noindex') "$Name mobile responses carry X-Robots-Tag noindex" ("X-Robots-Tag '$($r.Robots)'") }
    if ($MsmeLogin) {
        $r = Send 'POST' "$Url/Msme/Login" @{ userName = ''; password = ''; version = $AppVersion }
        $status = $null
        try { $status = ($r.Body | ConvertFrom-Json).status } catch { }
        Report ($r.Status -eq 200 -and ($status -eq '0' -or $status -eq '2')) "$Name Msme/Login keeps the old contract (status $status)" (Describe $r)
        if ($status -eq '2') { Write-Host "        (status 2: the version gate is on and $AppVersion is not the current app version)" }
    }
}

$targets = @(
    @{ Key = 'Main'; Url = $MainUrl; Run = {
        Test-Portal 'Main' $MainUrl @('/msme/login', '/login', '/Msme/Login', '/Msme/ChangePassword?code=smoketest') `
            @('/User/ResetMobileNo', '/DynamicReports/ExportReportData', '/Webinar/GetRegistrations', '/Pay/success', '/Invoice/Index') } },
    @{ Key = 'Consultancy'; Url = $ConsultancyUrl; Run = {
        Test-Portal 'Consultancy' $ConsultancyUrl @('/login') `
            @('/Assessment/UpdateColumnData', '/Assessment/UpdateAmounts', '/Monitoring/RaFinalSubmit', '/FinancialAssistance/AllotCb', '/Pay/GetToken') } },
    @{ Key = 'Surveillance'; Url = $SurveillanceUrl; Run = {
        Test-Portal 'Surveillance' $SurveillanceUrl @('/login') `
            @('/Monitoring/FinalSubmit', '/User/GetAllAmc', '/MyDocuments/Upload', '/DynamicReports/ExportReportData', '/Msme/Download') } },
    @{ Key = 'MobileMain'; Url = $MobileMainUrl; Run = { Test-Mobile 'Main' $MobileMainUrl $true } },
    @{ Key = 'MobileConsultancy'; Url = $MobileConsultancyUrl; Run = { Test-Mobile 'Consultancy' $MobileConsultancyUrl $false } },
    @{ Key = 'MobileSurveillance'; Url = $MobileSurveillanceUrl; Run = { Test-Mobile 'Surveillance' $MobileSurveillanceUrl $false } }
)

$ran = 0
if ($CheckHttpsRedirect -and $MainUrl) { Test-HttpsRedirect $MainUrl }
foreach ($t in $targets) {
    if ($Skip -contains $t.Key) { continue }
    if (-not $t.Url) { Write-Host "$($t.Key): no address given, skipped" -ForegroundColor DarkGray; continue }
    $ran++
    & $t.Run
}
$client.Dispose()

if ($ran -eq 0) { Write-Host 'Nothing to test: give -BaseUrl or the per-host addresses.' -ForegroundColor Red; exit 1 }
Write-Host ''
$color = if ($script:failures -eq 0) { 'Green' } else { 'Red' }
Write-Host "$($script:passes) passed, $($script:failures) failed, $($script:warnings) warnings" -ForegroundColor $color
if ($script:failures -gt 0) { exit 1 }
exit 0
