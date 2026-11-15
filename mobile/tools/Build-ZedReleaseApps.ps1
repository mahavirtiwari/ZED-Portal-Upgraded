<#
.SYNOPSIS
  Builds the three ZED apps changed in this release in one command: ZED MSME (the applicant app), ZED SA (the assessor
  app) and ZED Consultancy (the consultant app). Test APKs for testers, or the Play Store files (APK and .aab).
.DESCRIPTION
  2026-11-15 release: Bronze with a remote or onsite visit in the ZED MSME app, the "View report" pages in all three apps,
  the App Forms "Validation required" step, and the site tour photo count after "Sync Assessment" in ZED SA.
  ZED Surveillance (the Bronze surveillance app, workspace "msme") did not change and is not built.

  A short front for the scripts already in this folder; it changes nothing they do:
    Build-ZedMsmeApp.ps1   ZED MSME (com.qci.zed.msmeapp)
    Build-ZedFieldApp.ps1  ZED SA (com.qci.zed.siteassessment) and ZED Consultancy (com.qci.zed.consultancy)
  They install the build tools the first time (under -ToolsRoot), get the code from GitHub (main, or -Ref), build with
  Gradle, check the server each APK talks to (https://zedv3.qci.org.in), and put the files with .sha256 checksums in
  -Output (logs in <Output>\logs).

  Test build (default): one APK per app, signed with this machine's debug key, to install directly (adb install -r).
  Play Store (-PlayStore): each app is signed with its own upload keystore, so the script asks for each app's keystore in
  turn (path, alias and hidden passwords; nothing is saved or printed, and the ZED_UPLOAD_* variables are cleared before
  each app and at the end). Each app needs its own version code, higher than the last one uploaded.

  Run in Windows PowerShell 5.1 or later; Git must be on the PATH. Deploy the server first (deploy\Deploy-Zed.ps1):
  the new apps need migrations 0078-0084 and the new mobile hosts.
.PARAMETER Apps
  Which apps to build: any of zedmsme, assessor, consultant (default all three).
.PARAMETER PlayStore
  Builds for the Play Store (signed APK and .aab bundle).
.PARAMETER MsmeVersionCode
  ZED MSME version code (Play Store only; above the last one uploaded).
.PARAMETER MsmeVersionName
  ZED MSME version name shown to users, e.g. 2.1 (Play Store only).
.PARAMETER SaVersionCode
  ZED SA version code (Play Store only; above 47, the version in the code).
.PARAMETER SaVersionName
  ZED SA version name, e.g. 2.1 (Play Store only).
.PARAMETER ConsultantVersionCode
  ZED Consultancy version code (Play Store only; above 76, the version in the code).
.PARAMETER ConsultantVersionName
  ZED Consultancy version name, e.g. 2.1 (Play Store only).
.PARAMETER Ref
  A branch, tag or commit to build instead of the latest main.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\mobile\tools\Build-ZedReleaseApps.ps1
  # Test APKs of ZED MSME, ZED SA and ZED Consultancy from the latest main.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\mobile\tools\Build-ZedReleaseApps.ps1 -Apps assessor
  # Only the ZED SA test APK.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\mobile\tools\Build-ZedReleaseApps.ps1 -PlayStore `
      -MsmeVersionCode 2 -MsmeVersionName 2.1 -SaVersionCode 48 -SaVersionName 2.1 -ConsultantVersionCode 77 -ConsultantVersionName 2.1
  # The Play Store release of all three apps: asks for each app's keystore in turn.
#>
param(
    [ValidateSet('zedmsme', 'assessor', 'consultant')]
    [string[]]$Apps = @('zedmsme', 'assessor', 'consultant'),
    [switch]$PlayStore,
    [ValidateRange(1, 2100000000)][int]$MsmeVersionCode,
    [ValidatePattern('^\d+(\.\d+){0,3}$')][string]$MsmeVersionName,
    [ValidateRange(1, 2100000000)][int]$SaVersionCode,
    [ValidatePattern('^\d+(\.\d+){0,3}$')][string]$SaVersionName,
    [ValidateRange(1, 2100000000)][int]$ConsultantVersionCode,
    [ValidatePattern('^\d+(\.\d+){0,3}$')][string]$ConsultantVersionName,
    [string]$Ref,
    [string]$ToolsRoot = 'E:\ZedApkTools',
    [string]$Source = 'E:\ZedApkBuild\src',
    [string]$Output = 'E:\Releases\apk'
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$msmeScript = Join-Path $here 'Build-ZedMsmeApp.ps1'
$fieldScript = Join-Path $here 'Build-ZedFieldApp.ps1'
foreach ($f in @($msmeScript, $fieldScript)) { if (-not (Test-Path $f)) { throw "$(Split-Path -Leaf $f) not found next to this script ($here)." } }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is not installed or not on the PATH.' }

$names = @{ zedmsme = 'ZED MSME (applicant app)'; assessor = 'ZED SA (assessor app)'; consultant = 'ZED Consultancy (consultant app)' }
$versions = @{
    zedmsme    = @{ Code = $MsmeVersionCode; Name = $MsmeVersionName; Param = 'Msme' }
    assessor   = @{ Code = $SaVersionCode; Name = $SaVersionName; Param = 'Sa' }
    consultant = @{ Code = $ConsultantVersionCode; Name = $ConsultantVersionName; Param = 'Consultant' }
}
# Build in a fixed order whatever order -Apps was given in.
$order = @('zedmsme', 'assessor', 'consultant') | Where-Object { $Apps -contains $_ }

# Check every version before building anything (a Play Store build stops otherwise half-way).
if ($PlayStore) {
    foreach ($a in $order) {
        $v = $versions[$a]
        if (-not $v.Code -or -not $v.Name) {
            throw "$($names[$a]): a Play Store build needs -$($v.Param)VersionCode and -$($v.Param)VersionName."
        }
    }
}

function Clear-UploadKey {
    Remove-Item Env:ZED_UPLOAD_STORE_FILE, Env:ZED_UPLOAD_STORE_PASSWORD, Env:ZED_UPLOAD_KEY_ALIAS, Env:ZED_UPLOAD_KEY_PASSWORD -ErrorAction SilentlyContinue
}

$done = @()
$started = Get-Date
try {
    foreach ($a in $order) {
        $common = @{ ToolsRoot = $ToolsRoot; Source = $Source; Output = $Output }
        if ($Ref) { $common.Ref = $Ref }
        if ($PlayStore) {
            # Each app has its own upload keystore: never reuse the previous app's.
            Clear-UploadKey
            $common.PlayStore = $true
            $common.VersionCode = $versions[$a].Code
            $common.VersionName = $versions[$a].Name
        }
        Write-Host ''
        Write-Host ("######## $($names[$a]): " + $(if ($PlayStore) { "Play Store $($versions[$a].Name) (code $($versions[$a].Code))" } else { 'test APK' })) -ForegroundColor Cyan
        if ($a -eq 'zedmsme') { & $msmeScript @common }
        else { & $fieldScript -App $a @common }
        $done += $names[$a]
    }
} finally {
    if ($PlayStore) { Clear-UploadKey }
}

Write-Host ''
Write-Host "Built: $($done -join ', ')" -ForegroundColor Green
Write-Host "Files in $Output (built since $($started.ToString('HH:mm'))):"
Get-ChildItem -Path $Output -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $started -and $_.Extension -in '.apk', '.aab' } |
    ForEach-Object { Write-Host "  $($_.Name)" }
if ($PlayStore) {
    Write-Host ''
    Write-Host 'Next:' -ForegroundColor Yellow
    Write-Host '  1. Upload each .aab in the Play Console under its own app.'
    Write-Host '  2. When the new versions are live, and only if the version check is on, set on the mobile hosts:'
    Write-Host '       Mobile:MsmeVersion = the ZED MSME version name (Main host, with Mobile:CheckMsmeVersion; the Surveillance'
    Write-Host '                            host uses its own MsmeVersion for the ZED Surveillance app: leave it)'
    Write-Host '       Mobile:SaVersion   = the ZED SA version name (Main and Surveillance hosts, with Mobile:CheckSaVersion)'
    Write-Host '                            and the ZED Consultancy version name (Consultancy host)'
    Write-Host '     The check compares the exact version, so the old app is then asked to update.'
}
