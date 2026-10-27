<#
.SYNOPSIS
  Why mails are not arriving: the mail settings in effect, whether the mail server answers, the jobs service, the mail
  queue of the databases and the recent mail errors. Read-only: it changes nothing and sends nothing.

.DESCRIPTION
  1. Mail settings of each portal (the IIS app pools' environment) and of the ZedJobs service: server, port, From,
     sign-in name, and only whether a password is set (never its value).
  2. The ZedJobs service (it sends the database procedures' mails from dbo.V4MailOutbox).
  3. dbo.V4MailOutbox of each database: waiting, failed, last errors.
  4. The mail servers set per module on Admin -> Settings -> Email Settings (dbo.V4SmtpServers, migration 0018). They come
     before the server file: a module's own, else the page's Default, else the settings above.
  5. Whether this server reaches each mail server (TCP connect to host:port).
  6. Mail errors in the Windows Application event log (the portals send in the background, so a failure shows there).

  To send a real test mail of a module, use Admin -> Settings -> Email Settings -> "Send test mail" in the portal.

.EXAMPLE
  .\deploy\Test-ZedEmail.ps1
#>
[CmdletBinding()]
param(
    [string]$SqlServer = '.\SQLEXPRESS',
    [string]$Prefix = 'ZEDV4_',
    [string]$JobsService = 'ZedJobs',
    [string[]]$Pools = @('ZedV4-Main', 'ZedV4-Consultancy', 'ZedV4-Surveillance', 'ZedV4-Mobile-Main'),
    [int]$Hours = 48
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Text) { Write-Host ''; Write-Host "== $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    OK  $Text" -ForegroundColor Green }
function Write-Bad([string]$Text) { Write-Host "    !!  $Text" -ForegroundColor Red }
function Write-Note([string]$Text) { Write-Host "    --  $Text" -ForegroundColor Yellow }

# Settings shown: everything under Email__ except passwords (only "set" / "EMPTY").
function Show-EmailSettings([hashtable]$Vars) {
    $names = @($Vars.Keys | Where-Object { $_ -like 'Email__*' } | Sort-Object)
    if (-not $names) { Write-Bad 'no Email__ settings at all: the shipped appsettings.json applies (no mail server)'; return }
    foreach ($n in $names) {
        $v = [string]$Vars[$n]
        $shown = if ($n -like '*Password*') { if ($v) { '(set)' } else { 'EMPTY' } } elseif ($v) { $v } else { 'EMPTY' }
        $colour = if (-not $v -and $n -notlike '*AllowedRecipientDomains*' -and $n -notlike '*PickupDirectory*') { 'Yellow' } else { 'Gray' }
        Write-Host ("    {0,-45} {1}" -f $n, $shown) -ForegroundColor $colour
    }
}

$servers = @{}
function Add-MailServer([hashtable]$Vars, [string]$Where) {
    foreach ($n in $Vars.Keys) {
        if ($n -notmatch '^Email__Profiles__([^_]+)__Host$') { continue }
        $hostName = [string]$Vars[$n]
        if (-not $hostName) { continue }
        $port = [string]$Vars["Email__Profiles__$($Matches[1])__Port"]
        if (-not $port) { $port = '587' }
        $servers["$hostName`:$port"] = $Where
    }
}

Write-Step "Mail settings of the portals (IIS app pool environment)"
try {
    Import-Module WebAdministration
    foreach ($pool in $Pools) {
        if (-not (Test-Path "IIS:\AppPools\$pool")) { Write-Note "$pool not installed"; continue }
        $vars = @{}
        Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter "system.applicationHost/applicationPools/add[@name='$pool']/environmentVariables" -Name '.' |
            ForEach-Object { $_.Collection } | ForEach-Object { $vars[[string]$_.name] = [string]$_.value }
        Write-Host "  $pool" -ForegroundColor White
        Show-EmailSettings $vars
        if (-not $vars['Email__Profiles__Default__Host']) { Write-Bad "$pool has no mail server (Email__Profiles__Default__Host)" }
        if ($vars['Email__Profiles__Default__UserName'] -and -not $vars['Email__Profiles__Default__Password']) { Write-Bad "$pool has a sign-in name but no password" }
        if ($vars['Email__PickupDirectory']) { Write-Bad "$pool writes mails to files ($($vars['Email__PickupDirectory'])) instead of sending them" }
        if ($vars['Email__RedirectAllTo']) { Write-Note "$pool sends every mail to $($vars['Email__RedirectAllTo']) instead of its recipients" }
        elseif ($vars['Email__DeliverToRecipients'] -eq 'true') { Write-Note "$pool sends mails to their real recipients (Email__DeliverToRecipients)" }
        Add-MailServer $vars $pool
    }
}
catch { Write-Bad "could not read IIS: $($_.Exception.Message) (run as administrator)" }

Write-Step "ZedJobs service (database mails)"
$svc = Get-Service $JobsService -ErrorAction SilentlyContinue
if (-not $svc) { Write-Bad "$JobsService is not installed: the database procedures' mails wait in dbo.V4MailOutbox" }
else {
    if ($svc.Status -eq 'Running') { Write-Ok "$JobsService is running" } else { Write-Bad "$JobsService is $($svc.Status): the database procedures' mails are not sent" }
    $vars = @{}
    $envList = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$JobsService" -Name Environment -ErrorAction SilentlyContinue).Environment
    foreach ($line in @($envList)) { if ($line -match '^([^=]+)=(.*)$') { $vars[$Matches[1]] = $Matches[2] } }
    # The jobs service ships with the ZedAdmin profile in its appsettings.json (smtp-mail.outlook.com:587); only the
    # password comes from the environment unless the server is overridden there.
    if (-not $vars.ContainsKey('Email__Profiles__ZedAdmin__Host')) { $servers['smtp-mail.outlook.com:587'] = "$JobsService (appsettings.json)" }
    Show-EmailSettings $vars
    if (-not $vars['Email__Profiles__ZedAdmin__Password'] -and -not $vars['Email__Profiles__Default__Host']) { Write-Bad "$JobsService has no password for the ZedAdmin mail account (Email__Profiles__ZedAdmin__Password)" }
    Add-MailServer $vars $JobsService
}

Write-Step "Mail queue of the databases (dbo.V4MailOutbox)"
foreach ($db in "$($Prefix)ZEDCS_V2_LIVE", "$($Prefix)ZED_CONSULTANT", "$($Prefix)ZED_SURVEILLANCE") {
    $conn = New-Object Data.SqlClient.SqlConnection "Server=$SqlServer;Database=$db;Integrated Security=true;TrustServerCertificate=true;Application Name=Test-ZedEmail"
    try {
        $conn.Open()
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = @"
IF OBJECT_ID('dbo.V4MailOutbox') IS NULL BEGIN SELECT CAST(-1 AS int) AS Waiting, 0 AS Failed, 0 AS SentDay, CAST(NULL AS nvarchar(1000)) AS LastError; RETURN; END
SELECT (SELECT COUNT(*) FROM dbo.V4MailOutbox WHERE SentAt IS NULL) AS Waiting,
       (SELECT COUNT(*) FROM dbo.V4MailOutbox WHERE SentAt IS NULL AND Attempts > 0) AS Failed,
       (SELECT COUNT(*) FROM dbo.V4MailOutbox WHERE SentAt >= DATEADD(DAY, -1, SYSDATETIME())) AS SentDay,
       (SELECT TOP (1) LastError FROM dbo.V4MailOutbox WHERE LastError IS NOT NULL ORDER BY Id DESC) AS LastError;
"@
        $r = $cmd.ExecuteReader()
        [void]$r.Read()
        if ($r['Waiting'] -eq -1) { Write-Note "$db`: no dbo.V4MailOutbox (migration 0003 not applied: the procedures still use Database Mail)" }
        else {
            $line = "$db`: $($r['Waiting']) waiting, $($r['Failed']) failed, $($r['SentDay']) sent in the last 24 hours"
            if ($r['Failed'] -gt 0) { Write-Bad $line } else { Write-Ok $line }
            if ($r['LastError'] -isnot [DBNull]) { Write-Host "        last error: $($r['LastError'])" -ForegroundColor Yellow }
        }
        $r.Close()
    }
    catch { Write-Note "$db`: $($_.Exception.Message)" }
    finally { $conn.Dispose() }
}

Write-Step "Mail servers set on Admin -> Settings -> Email Settings (dbo.V4SmtpServers)"
foreach ($db in "$($Prefix)ZEDCS_V2_LIVE", "$($Prefix)ZED_CONSULTANT", "$($Prefix)ZED_SURVEILLANCE") {
    $conn = New-Object Data.SqlClient.SqlConnection "Server=$SqlServer;Database=$db;Integrated Security=true;TrustServerCertificate=true;Application Name=Test-ZedEmail"
    try {
        $conn.Open()
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = "IF OBJECT_ID('dbo.V4SmtpServers') IS NULL SELECT CAST(NULL AS varchar(50)) AS Module WHERE 1 = 0 ELSE " +
            "SELECT Module, Host, Port, UseStartTls, FromAddress, UserName, CASE WHEN PasswordProtected IS NULL THEN 0 ELSE 1 END AS HasPassword, UpdatedBy, UpdatedOn FROM dbo.V4SmtpServers ORDER BY Module"
        $r = $cmd.ExecuteReader()
        $any = $false
        while ($r.Read()) {
            $any = $true
            $pw = if ($r['HasPassword'] -eq 1) { 'password set' } elseif ($r['UserName'] -isnot [DBNull]) { 'NO PASSWORD' } else { 'no sign-in' }
            Write-Host ("    {0,-28} {1,-16} {2}:{3}  From {4}  ({5}; by {6} {7:dd MMM yyyy})" -f $db, $r['Module'], $r['Host'], $r['Port'], $r['FromAddress'], $pw, $r['UpdatedBy'], $r['UpdatedOn'])
            $servers["$($r['Host']):$($r['Port'])"] = "$db page, $($r['Module'])"
        }
        if (-not $any) { Write-Note "$db`: none (the server file's settings above are used)" }
        $r.Close()
    }
    catch { Write-Note "$db`: $($_.Exception.Message)" }
    finally { $conn.Dispose() }
}

Write-Step "Does this server reach the mail servers?"
if (-not $servers.Count) { Write-Bad 'no mail server is configured anywhere' }
foreach ($s in $servers.Keys) {
    $h, $p = $s -split ':'
    $client = New-Object Net.Sockets.TcpClient
    try {
        $wait = $client.BeginConnect($h, [int]$p, $null, $null)
        if ($wait.AsyncWaitHandle.WaitOne(10000) -and $client.Connected) { Write-Ok "$s answers ($($servers[$s]))" }
        else { Write-Bad "$s does not answer within 10 seconds ($($servers[$s])): a firewall or the Azure network rules block port $p, or the name is wrong" }
    }
    catch {
        $why = if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { $_.Exception.Message }
        Write-Bad "$s`: $why ($($servers[$s]))"
    }
    finally { $client.Close() }
}

Write-Step "Mail errors in the Application event log (last $Hours hours)"
try {
    $events = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Level = 2, 3; StartTime = (Get-Date).AddHours(-$Hours) } -ErrorAction SilentlyContinue |
        Where-Object { $_.Message -match 'smtp|e-?mail|MailKit|Authentication unsuccessful|mail server' } | Select-Object -First 10)
    if (-not $events) { Write-Ok 'none' }
    foreach ($e in $events) {
        # The .NET event log entries start with "Category: ... EventId: ... RequestPath: ..." lines; the message follows a blank line.
        $parts = $e.Message -split '\r?\n\s*\r?\n', 2
        $text = if ($parts.Count -eq 2 -and $parts[0] -match '^Category:') { $parts[1] } else { $e.Message }
        $text = ($text -replace '\s+', ' ').Trim()
        if ($text.Length -gt 400) { $text = $text.Substring(0, 400) + '...' }
        Write-Host ("    {0:dd MMM HH:mm}  {1}" -f $e.TimeCreated, $e.ProviderName) -ForegroundColor Yellow
        Write-Host "        $text"
    }
}
catch { Write-Note "could not read the event log: $($_.Exception.Message)" }

Write-Host ''
Write-Host 'Next: Admin -> Settings -> Email Settings -> "Send test mail" shows the mail server''s own error.'
