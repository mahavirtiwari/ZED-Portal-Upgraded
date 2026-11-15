<#
.SYNOPSIS
  Builds the ZED Consultancy app (the consultant app, com.qci.zed.consultancy) in one command: a test APK for testers, or the
  Play Store files (signed APK and .aab bundle).
.DESCRIPTION
  A short front for Build-ZedFieldApp.ps1 -App consultant (same folder); it changes nothing that script does:
    1. Tools      installs JDK 17, Node.js and the Android SDK under -ToolsRoot the first time (about 8 GB).
    2. Keystore   -PlayStore only: the ZED Consultancy upload keystore, from the ZED_UPLOAD_* environment variables or typed when
                  asked (passwords hidden, never saved or printed).
    3. Build      gets the code from GitHub (main, or -Ref), builds with Gradle, checks the server the app talks to
                  (https://zedv3.qci.org.in) and refuses a Play Store file signed with the debug key.
    4. Output     the files in -Output (default E:\Releases\apk) with .sha256 checksums, and a log in <Output>\logs.
  After a Play Store release, if Mobile:CheckSaVersion is on, set Mobile:SaVersion to the new -VersionName on the
  Consultancy mobile host.
  Run in Windows PowerShell 5.1 or later; Git must be on the PATH. Deploy the server first (deploy\Deploy-Zed.ps1).
.PARAMETER PlayStore
  Builds for the Play Store (signed APK and .aab).
.PARAMETER VersionCode
  Must be above 76 (the version in the code) and above the last one uploaded. Required with -PlayStore.
.PARAMETER VersionName
  The version shown to users, e.g. 2.1. Required with -PlayStore.
.PARAMETER Ref
  A branch, tag or commit to build instead of the latest main (e.g. b0accfc).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\mobile\tools\Build-ZedConsultancyApp.ps1
  # A test APK of ZED Consultancy from the latest main.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\mobile\tools\Build-ZedConsultancyApp.ps1 -PlayStore -VersionCode 77 -VersionName 2.1
  # The ZED Consultancy Play Store release 2.1 (code 77).
#>
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
$field = Join-Path $PSScriptRoot 'Build-ZedFieldApp.ps1'
if (-not (Test-Path $field)) { throw "Build-ZedFieldApp.ps1 not found next to this script ($PSScriptRoot)." }
$buildArgs = @{ App = 'consultant'; ToolsRoot = $ToolsRoot; Source = $Source; Output = $Output }
if ($PlayStore) { $buildArgs.PlayStore = $true }
if ($VersionCode) { $buildArgs.VersionCode = $VersionCode }
if ($VersionName) { $buildArgs.VersionName = $VersionName }
if ($Ref) { $buildArgs.Ref = $Ref }
& $field @buildArgs
