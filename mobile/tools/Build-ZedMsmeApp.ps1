<#
.SYNOPSIS
  Builds the ZED MSME app (com.qci.zed.msmeapp, the applicant app) in one command: for testers (an APK to install
  directly) or for the Play Store (the signed APK and the .aab bundle).
.DESCRIPTION
  A short front for Build-ZedApk.ps1 (same folder), for the ZED MSME app only:
    1. Tools        installs JDK 17, Node.js and the Android SDK under -ToolsRoot the first time (Install-ZedApkTools.ps1;
                    about 8 GB, nothing system-wide). Later runs skip this.
    2. Keystore     -PlayStore only: the Play Store upload keystore. Give it in the environment variables
                    ZED_UPLOAD_STORE_FILE, ZED_UPLOAD_STORE_PASSWORD, ZED_UPLOAD_KEY_ALIAS and ZED_UPLOAD_KEY_PASSWORD, or
                    type them when asked (the passwords are read hidden and kept only in this window's process; nothing is
                    saved or printed). The keystore file itself is never in the repository.
    3. Build        Build-ZedApk.ps1 -App zedmsme: gets the code from GitHub (main, or -Ref), installs the JavaScript
                    packages, builds with Gradle, reads back the server the app talks to (https://zedv3.qci.org.in) and,
                    for the Play Store, refuses an APK or bundle signed with the debug key.
    4. Output       the files in -Output (default E:\Releases\apk), each with a .sha256 checksum, and a log in
                    <Output>\logs.
  Every build talks to https://zedv3.qci.org.in. Run in Windows PowerShell 5.1 or later; Git must be on the PATH.
.PARAMETER PlayStore
  Builds for the Play Store: signed with the upload keystore, the APK and the .aab bundle. Without it: an APK signed with
  this machine's debug key, for testers to install directly (not for the Play Store).
.PARAMETER VersionCode
  The app's version code (a whole number that must grow with every Play Store release). Required with -PlayStore.
.PARAMETER VersionName
  The version shown to users (e.g. 2.1). Required with -PlayStore.
.PARAMETER Ref
  A branch, tag or commit to build instead of the latest main.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Build-ZedMsmeApp.ps1
  # A test APK of ZED MSME from the latest main (install with: adb install -r <file>).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Build-ZedMsmeApp.ps1 -PlayStore -VersionCode 2 -VersionName 2.1
  # The Play Store release 2.1 (code 2): asks for the keystore if the ZED_UPLOAD_* variables are not set.
#>
[CmdletBinding()]
param(
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

if ($PlayStore -and (-not $VersionCode -or -not $VersionName)) {
    throw 'A Play Store build needs -VersionCode (higher than the last one uploaded) and -VersionName, e.g. -VersionCode 2 -VersionName 2.1'
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
    if (-not $env:ZED_UPLOAD_STORE_FILE) { $env:ZED_UPLOAD_STORE_FILE = Read-Host 'Path of the upload keystore (.jks / .keystore)' }
    if (-not (Test-Path $env:ZED_UPLOAD_STORE_FILE)) { throw "The keystore file $env:ZED_UPLOAD_STORE_FILE does not exist." }
    if (-not $env:ZED_UPLOAD_KEY_ALIAS) { $env:ZED_UPLOAD_KEY_ALIAS = Read-Host 'Key alias' }
    if (-not $env:ZED_UPLOAD_STORE_PASSWORD) { $env:ZED_UPLOAD_STORE_PASSWORD = Read-Plain 'Keystore password (hidden)' }
    if (-not $env:ZED_UPLOAD_KEY_PASSWORD) { $env:ZED_UPLOAD_KEY_PASSWORD = Read-Plain 'Key password (hidden; Enter for the same as the keystore)' }
    if (-not $env:ZED_UPLOAD_KEY_PASSWORD) { $env:ZED_UPLOAD_KEY_PASSWORD = $env:ZED_UPLOAD_STORE_PASSWORD }
}

# ---------------------------------------------------------------- 3. Build
$buildArgs = @{ App = 'zedmsme'; ToolsRoot = $ToolsRoot; Source = $Source; Output = $Output }
if ($Ref) { $buildArgs.Ref = $Ref }
if ($VersionCode) { $buildArgs.VersionCode = $VersionCode }
if ($VersionName) { $buildArgs.VersionName = $VersionName }
if ($PlayStore) { $buildArgs.Production = $true; $buildArgs.Bundle = $true }

Write-Host ''
Write-Host ("==> ZED MSME: " + $(if ($PlayStore) { "Play Store release $VersionName (code $VersionCode), APK and .aab" } else { 'test APK (debug key, to install directly)' })) -ForegroundColor Cyan
try {
    & $build @buildArgs
} finally {
    if ($PlayStore) {
        # The passwords only lived in this process; clear them from the window too.
        Remove-Item Env:ZED_UPLOAD_STORE_PASSWORD, Env:ZED_UPLOAD_KEY_PASSWORD -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host "Files in $Output" -ForegroundColor Green
if ($PlayStore) {
    Write-Host 'Upload the .aab in the Play Console (ZED MSME, com.qci.zed.msmeapp). Keep the .sha256 files with the release.'
}
