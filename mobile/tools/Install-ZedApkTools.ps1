<#
.SYNOPSIS
  One-time setup of a Windows server (or PC) to build the ZED React Native APKs: JDK 17, Node.js and the Android SDK
  (with the platform, build-tools, NDK and CMake the apps need), all in one folder off the system drive.
.DESCRIPTION
  Downloads into <ToolsRoot>\downloads and installs:
    <ToolsRoot>\jdk-17         Temurin JDK 17 (JAVA_HOME)
    <ToolsRoot>\node           Node.js (npm)
    <ToolsRoot>\android-sdk    Android command-line tools, platform-tools, platforms;android-37.0, build-tools;37.0.0,
                               ndk;27.1.12297006, cmake;3.22.1 (ANDROID_HOME); the SDK licences are accepted
  Nothing is installed system-wide and no environment variable is changed for the machine: Build-ZedApk.ps1 sets them
  for its own run from the same -ToolsRoot. Safe to run again: a part already installed is skipped (-Force reinstalls).
  Needs Git on the PATH (the build script clones or updates the code) and about 8 GB free on the tools drive.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Install-ZedApkTools.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Install-ZedApkTools.ps1 -ToolsRoot F:\ZedApkTools
#>
[CmdletBinding()]
param(
    [string]$ToolsRoot = 'E:\ZedApkTools',
    [string]$JdkUrl = 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.13%2B11/OpenJDK17U-jdk_x64_windows_hotspot_17.0.13_11.zip',
    [string]$NodeUrl = 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip',
    [string]$CmdlineToolsUrl = 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is many times slower with the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }

# Runs a program and shows its output. Its stderr (warnings, progress) is text, not an error: Windows PowerShell would
# otherwise stop the script on the first such line when the output is redirected. The exit code decides.
function Invoke-Tool {
    param([Parameter(Mandatory)][string]$Exe, [string[]]$Arguments = @())
    $ErrorActionPreference = 'Continue'
    & $Exe @Arguments 2>&1 | ForEach-Object { Write-Host "$_" }
    $LASTEXITCODE
}

$ToolsRoot = [IO.Path]::GetFullPath($ToolsRoot)
if ($ToolsRoot.Substring(0, 2) -ieq $env:SystemDrive) {
    throw "$ToolsRoot is on the system drive ($env:SystemDrive). Choose another drive with -ToolsRoot (the SDK and caches grow to several GB)."
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is not on the PATH. Install Git for Windows first.' }

$downloads = Join-Path $ToolsRoot 'downloads'
New-Item -ItemType Directory -Force -Path $ToolsRoot, $downloads | Out-Null

function Get-Download([string]$Url) {
    $file = Join-Path $downloads ([Uri]::UnescapeDataString(($Url -split '/')[-1]))
    if ($Force -or -not (Test-Path $file)) {
        Write-Step "Downloading $Url"
        Invoke-WebRequest -Uri $Url -OutFile "$file.part" -UseBasicParsing
        Move-Item -Force "$file.part" $file
    }
    $file
}

# Extracts a zip whose content is one top folder (JDK, Node) into $Target.
function Expand-Single([string]$Zip, [string]$Target) {
    $tmp = Join-Path $downloads ('x-' + [IO.Path]::GetFileNameWithoutExtension($Zip))
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    Expand-Archive -Path $Zip -DestinationPath $tmp
    $top = @(Get-ChildItem $tmp -Directory)
    $source = if ($top.Count -eq 1) { $top[0].FullName } else { $tmp }
    Remove-Item -Recurse -Force $Target -ErrorAction SilentlyContinue
    Move-Item $source $Target
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# --- JDK 17
$jdk = Join-Path $ToolsRoot 'jdk-17'
if ($Force -or -not (Test-Path (Join-Path $jdk 'bin\java.exe'))) {
    Write-Step 'Installing JDK 17'
    Expand-Single (Get-Download $JdkUrl) $jdk
}
# java -version writes to stderr: through cmd, so Windows PowerShell does not turn it into an error.
cmd /c "`"$(Join-Path $jdk 'bin\java.exe')`" -version 2>&1" | Select-Object -First 1 | ForEach-Object { Write-Host "    $_" }

# --- Node.js
$node = Join-Path $ToolsRoot 'node'
if ($Force -or -not (Test-Path (Join-Path $node 'node.exe'))) {
    Write-Step 'Installing Node.js'
    Expand-Single (Get-Download $NodeUrl) $node
}
Write-Host ("    node " + (& (Join-Path $node 'node.exe') --version))

# --- Android SDK: command-line tools in cmdline-tools\latest, then the packages through sdkmanager
$sdk = Join-Path $ToolsRoot 'android-sdk'
$latest = Join-Path $sdk 'cmdline-tools\latest'
if ($Force -or -not (Test-Path (Join-Path $latest 'bin\sdkmanager.bat'))) {
    Write-Step 'Installing the Android command-line tools'
    New-Item -ItemType Directory -Force (Join-Path $sdk 'cmdline-tools') | Out-Null
    Expand-Single (Get-Download $CmdlineToolsUrl) $latest
}

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$sdkmanager = Join-Path $latest 'bin\sdkmanager.bat'

Write-Step 'Accepting the Android SDK licences'
# sdkmanager asks y/N once per licence; answer yes to all of them.
$yes = (1..30 | ForEach-Object { 'y' }) -join "`n"
& { $ErrorActionPreference = 'Continue'; $yes | & $sdkmanager --sdk_root=$sdk --licenses 2>&1 | Out-Null }

$packages = @('platform-tools', 'platforms;android-37.0', 'build-tools;37.0.0', 'ndk;27.1.12297006', 'cmake;3.22.1')
Write-Step ('Installing Android SDK packages: ' + ($packages -join ', ') + ' (several GB, takes a while the first time)')
$code = Invoke-Tool $sdkmanager (@("--sdk_root=$sdk") + $packages)
if ($code -ne 0) { throw "sdkmanager failed (exit code $code)." }

foreach ($check in @('platform-tools\adb.exe', 'platforms\android-37.0', 'build-tools\37.0.0\aapt2.exe', 'ndk\27.1.12297006', 'cmake\3.22.1')) {
    if (-not (Test-Path (Join-Path $sdk $check))) { throw "Missing after the install: $sdk\$check" }
}

Write-Host ''
Write-Host "Done. Tools are in $ToolsRoot." -ForegroundColor Green
Write-Host 'Build an APK with Build-ZedApk.ps1 (same folder), for example:'
Write-Host "  powershell -ExecutionPolicy Bypass -File .\Build-ZedApk.ps1 -App msme -ToolsRoot '$ToolsRoot'"
