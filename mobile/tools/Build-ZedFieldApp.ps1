<#
.SYNOPSIS
  Builds the ZED field apps in one command: ZED SA (the assessor app, com.qci.zed.siteassessment) and ZED Consultancy
  (the consultant app, com.qci.zed.consultancy). For testers (an APK to install directly) or for the Play Store (the
  signed APK and the .aab bundle).
.DESCRIPTION
  A short front for Build-ZedApk.ps1 (same folder), as Build-ZedMsmeApp.ps1 is for the applicant app:
    1. Tools        installs JDK 17, Node.js and the Android SDK under -ToolsRoot the first time (Install-ZedApkTools.ps1;
                    about 8 GB, nothing system-wide). Later runs skip this.
    2. Keystore     -PlayStore only: the Play Store upload keystore of the app (each app has its own). Give it in the
                    environment variables ZED_UPLOAD_STORE_FILE, ZED_UPLOAD_STORE_PASSWORD, ZED_UPLOAD_KEY_ALIAS and
                    ZED_UPLOAD_KEY_PASSWORD, or type them when asked (the passwords are read hidden, kept only in this
                    window's process and cleared at the end; nothing is saved or printed).
    3. Build        Build-ZedApk.ps1: gets the code from GitHub (main, or -Ref), installs the JavaScript packages, builds
                    with Gradle, reads back the server the app talks to (https://zedv3.qci.org.in) and, for the Play Store,
                    refuses an APK or bundle signed with the debug key.
    4. Output       the files in -Output (default E:\Releases\apk), each with a .sha256 checksum, and a log in
                    <Output>\logs.
  The apps' version names are compared with the server's Mobile:SaVersion when Mobile:CheckSaVersion is on (off by
  default): after a Play Store release with a new -VersionName, set Mobile:SaVersion to it on the mobile hosts (Main and
  Surveillance for ZED SA, Consultancy for ZED Consultancy), or the old and new apps are refused.
  Run in Windows PowerShell 5.1 or later; Git must be on the PATH.
.PARAMETER App
  assessor (ZED SA, default), consultant (ZED Consultancy), or both (test APKs only: each app has its own keystore and
  version, so Play Store releases are built one app at a time).
.PARAMETER PlayStore
  Builds for the Play Store: signed with the app's upload keystore, the APK and the .aab bundle.
.PARAMETER VersionCode
  The app's version code; must be higher than the last one uploaded (ZED SA is at 47, ZED Consultancy at 76 in the
  code). Required with -PlayStore.
.PARAMETER VersionName
  The version shown to users (e.g. 2.1). Required with -PlayStore.
.PARAMETER Ref
  A branch, tag or commit to build instead of the latest main.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Build-ZedFieldApp.ps1
  # A test APK of the assessor app (ZED SA) from the latest main.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Build-ZedFieldApp.ps1 -App both
  # Test APKs of both field apps.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Build-ZedFieldApp.ps1 -App assessor -PlayStore -VersionCode 48 -VersionName 2.1
  # The ZED SA Play Store release 2.1 (code 48).
#>
[CmdletBinding()]
param(
    [ValidateSet('assessor', 'consultant', 'both')][string]$App = 'assessor',
    [switch]$PlayStore,
    [ValidateRange(1, 2100000000)][int]$VersionCode,
    [ValidatePattern('^\d+(\.\d+){0,3}$')][string]$VersionName,
    [string]$Ref,
    [string]$ToolsRoot = 'E:\ZedApkTools',
    [string]$Source = 'E:\ZedApkBuild\src',
    [string]$Output = 'E:\Releases\apk'
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$build = Join-Path $here 'Build-ZedApk.ps1'
$install = Join-Path $here 'Install-ZedApkTools.ps1'
if (-not (Test-Path $build)) { throw "Build-ZedApk.ps1 not found next to this script ($here)." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is not installed or not on the PATH.' }

# The versions in the code (build.gradle defaults): a store release must go above them.
$current = @{ assessor = 47; consultant = 76 }
$names = @{ assessor = 'ZED SA (assessor app)'; consultant = 'ZED Consultancy (consultant app)' }

if ($PlayStore) {
    if ($App -eq 'both') { throw 'Play Store releases are built one app at a time (each has its own keystore and version): use -App assessor or -App consultant.' }
    if (-not $VersionCode -or -not $VersionName) {
        throw "A Play Store build needs -VersionCode (higher than the last one uploaded) and -VersionName, e.g. -VersionCode $($current[$App] + 1) -VersionName 2.1"
    }
    if ($VersionCode -le $current[$App]) {
        throw "$($names[$App]): -VersionCode $VersionCode is not above $($current[$App]), the version already in the code; the Play Store would refuse it."
    }
}

# ---------------------------------------------------------------- 1. Tools
$needed = @("$ToolsRoot\jdk-17\bin\java.exe", "$ToolsRoot\node\node.exe", "$ToolsRoot\android-sdk\build-tools\37.0.0\aapt2.exe")
if ($needed | Where-Object { -not (Test-Path $_) }) {
    Write-Host "==> Installing the build tools into $ToolsRoot (first run only; about 8 GB, 15-30 minutes)" -ForegroundColor Cyan
    & $install -ToolsRoot $ToolsRoot
    if ($needed | Where-Object { -not (Test-Path $_) }) { throw "The build tools are still missing under $ToolsRoot; see the installer's messages above." }
}

# ---------------------------------------------------------------- 2. Keystore (Play Store only)
function Read-Plain([string]$Prompt) {
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
if ($PlayStore) {
    Write-Host "The upload keystore of $($names[$App])." -ForegroundColor Yellow
    if (-not $env:ZED_UPLOAD_STORE_FILE) { $env:ZED_UPLOAD_STORE_FILE = Read-Host 'Path of the upload keystore (.jks / .keystore)' }
    if (-not (Test-Path $env:ZED_UPLOAD_STORE_FILE)) { throw "The keystore file $env:ZED_UPLOAD_STORE_FILE does not exist." }
    if (-not $env:ZED_UPLOAD_KEY_ALIAS) { $env:ZED_UPLOAD_KEY_ALIAS = Read-Host 'Key alias' }
    if (-not $env:ZED_UPLOAD_STORE_PASSWORD) { $env:ZED_UPLOAD_STORE_PASSWORD = Read-Plain 'Keystore password (hidden)' }
    if (-not $env:ZED_UPLOAD_KEY_PASSWORD) { $env:ZED_UPLOAD_KEY_PASSWORD = Read-Plain 'Key password (hidden; Enter for the same as the keystore)' }
    if (-not $env:ZED_UPLOAD_KEY_PASSWORD) { $env:ZED_UPLOAD_KEY_PASSWORD = $env:ZED_UPLOAD_STORE_PASSWORD }
}

# ---------------------------------------------------------------- 3. Build
$apps = if ($App -eq 'both') { @('assessor', 'consultant') } else { @($App) }
try {
    foreach ($a in $apps) {
        $buildArgs = @{ App = $a; ToolsRoot = $ToolsRoot; Source = $Source; Output = $Output }
        if ($Ref) { $buildArgs.Ref = $Ref }
        if ($VersionCode) { $buildArgs.VersionCode = $VersionCode }
        if ($VersionName) { $buildArgs.VersionName = $VersionName }
        if ($PlayStore) { $buildArgs.Production = $true; $buildArgs.Bundle = $true }
        # The second app reuses the checkout and the packages of the first (same commit).
        if ($a -ne $apps[0]) { $buildArgs.SkipUpdate = $true }

        Write-Host ''
        Write-Host ("==> $($names[$a]): " + $(if ($PlayStore) { "Play Store release $VersionName (code $VersionCode), APK and .aab" } else { 'test APK (debug key, to install directly)' })) -ForegroundColor Cyan
        & $build @buildArgs
    }
} finally {
    if ($PlayStore) {
        # The passwords only lived in this process; clear them from the window too.
        Remove-Item Env:ZED_UPLOAD_STORE_PASSWORD, Env:ZED_UPLOAD_KEY_PASSWORD -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host "Files in $Output" -ForegroundColor Green
if ($PlayStore) {
    Write-Host "Upload the .aab in the Play Console ($($names[$App])). Keep the .sha256 files with the release."
    Write-Host "If the mobile hosts check the app version (Mobile:CheckSaVersion), set Mobile:SaVersion to $VersionName there." -ForegroundColor Yellow
}
