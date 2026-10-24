<#
.SYNOPSIS
  Removes "STAGING" from what the staging users see: the red strip, the "[STAGING]" title and mail subject prefix,
  and the "STAGING ..." names of the first staff accounts. Dry run unless -Apply.

.DESCRIPTION
  Decided 2026-10-24: staging shows no label (docs/STAGING.md section 4). Earlier installs set it, so:
    1. The settings file: Portal__EnvironmentLabel is removed from every section (a copy is kept as
       settings.json.bak-<time>). The app pools get their settings at install, so install again afterwards
       (Update-ZedFromGit.ps1 -Package <installed package> -SkipMigrations -Apply, see below).
    2. Zed.Jobs: the same setting is removed from the service's environment, and the service restarts.
    3. The first staff accounts (03_first_accounts.sql, user ids ZEDV4...) named "STAGING ..." in the three ZEDV4_
       databases lose the prefix ("STAGING MASTER ADMIN" -> "MASTER ADMIN"). Only those rows; nothing else changes.
  Search engines are still kept out in Staging (X-Robots-Tag, robots.txt) without the label.
  Windows PowerShell 5.1 or later, administrator.

.EXAMPLE
  .\deploy\Remove-ZedStagingLabel.ps1            # shows what it would change
  .\deploy\Remove-ZedStagingLabel.ps1 -Apply
#>
[CmdletBinding()]
param(
    [string]$Settings = 'E:\ZedV4\settings.json',
    [string]$SqlServer = '.\SQLEXPRESS',
    [string]$DatabasePrefix = 'ZEDV4_',
    [string]$JobsService = 'ZedJobs',
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$name = 'Portal__EnvironmentLabel'
if (-not $DatabasePrefix) { throw 'Give -DatabasePrefix: this script only changes the staging databases.' }

Write-Host "== Settings file $Settings" -ForegroundColor Cyan
$raw = Get-Content $Settings -Raw
$json = $raw | ConvertFrom-Json
$sections = @($json.PSObject.Properties | Where-Object { $_.Value -is [pscustomobject] -and $_.Value.PSObject.Properties[$name] })
if ($sections.Count) {
    foreach ($s in $sections) { Write-Host "   $($s.Name): $name = '$($s.Value.$name)' -> removed" }
    if ($Apply) {
        Copy-Item $Settings "$Settings.bak-$(Get-Date -Format 'yyyyMMdd-HHmm')"
        foreach ($s in $sections) { $s.Value.PSObject.Properties.Remove($name) }
        $json | ConvertTo-Json -Depth 20 | Set-Content $Settings -Encoding UTF8
        # The file must still read back as the same JSON, without the label.
        $check = Get-Content $Settings -Raw | ConvertFrom-Json
        if (@($check.PSObject.Properties | Where-Object { $_.Value -is [pscustomobject] -and $_.Value.PSObject.Properties[$name] }).Count) { throw 'The label is still in the settings file.' }
        Write-Host '   OK  saved (copy: settings.json.bak-<time>)' -ForegroundColor Green
    }
}
else { Write-Host '   no label set' }

Write-Host "== Service $JobsService" -ForegroundColor Cyan
$key = "HKLM:\SYSTEM\CurrentControlSet\Services\$JobsService"
if (Test-Path $key) {
    $vars = @((Get-ItemProperty $key -ErrorAction SilentlyContinue).Environment)
    $kept = @($vars | Where-Object { $_ -and $_ -notlike "$name=*" })
    if ($kept.Count -ne @($vars | Where-Object { $_ }).Count) {
        Write-Host "   $name removed from its environment; the service restarts"
        if ($Apply) {
            Set-ItemProperty $key -Name Environment -Value ([string[]]$kept) -Type MultiString
            Restart-Service $JobsService
            Write-Host '   OK  restarted' -ForegroundColor Green
        }
    }
    else { Write-Host '   no label set' }
}
else { Write-Host '   not installed' }

Write-Host "== Staff account names in $SqlServer ($DatabasePrefix databases)" -ForegroundColor Cyan
foreach ($db in 'ZEDCS_V2_LIVE', 'ZED_CONSULTANT', 'ZED_SURVEILLANCE') {
    $database = "$DatabasePrefix$db"
    $where = "UserId LIKE 'ZEDV4%' AND UserName LIKE 'STAGING %'"
    $sql = if ($Apply) { "SET NOCOUNT ON; UPDATE dbo.Users SET UserName = LTRIM(SUBSTRING(UserName, 9, 200)) WHERE $where; SELECT @@ROWCOUNT;" }
           else { "SET NOCOUNT ON; SELECT COUNT(*) FROM dbo.Users WHERE $where;" }
    $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = & sqlcmd -S $SqlServer -E -C -b -h -1 -W -d $database -Q $sql 2>&1 | ForEach-Object { "$_".Trim() } | Where-Object { $_ }
    $code = $LASTEXITCODE; $ErrorActionPreference = $previous
    if ($code -ne 0) { throw "sqlcmd on $database failed: $($out -join ' ')" }
    Write-Host "   $database : $($out -join ' ') account(s) $(if ($Apply) { 'renamed' } else { 'to rename' })"
}

Write-Host ''
if ($Apply) {
    Write-Host 'Done. Install again so the app pools drop the label (no rebuild, no migrations):' -ForegroundColor Green
    Write-Host "    .\deploy\Update-ZedFromGit.ps1 -Apply -IncludeMobile -SkipMigrations -Package <E:\Releases\zed-... of the installed version>"
}
else { Write-Host 'Dry run: nothing was changed. Add -Apply.' -ForegroundColor Yellow }
