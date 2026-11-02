<#
.SYNOPSIS
  Builds a ZED React Native app as a release APK on a Windows server: gets the code from Git, installs the JavaScript
  packages, builds with Gradle, checks which server the APK talks to, and copies it to -Output.
.DESCRIPTION
  Apps (-App): zedmsme = ZED MSME, the applicant app (com.qci.zed.msmeapp: registration, certifications, documents;
  installs next to the Play Store ZED MSME app); msme = ZED Surveillance, the Bronze surveillance app
  (com.qci.zed.bronzesurveillance; the workspace is called "msme" but it is not the applicant app); assessor = ZED SA
  (site assessment); consultant = ZED Consultancy (handholding); all = the four.

  By default the APK talks to the TEST server (https://zedv3.qci.org.in) and is signed with the Android debug key of
  this machine: for testers, not for the Play Store. A phone that has a test APK signed on another machine must
  uninstall it first.

  -Production builds for the live server, signed with the Play Store upload keystore. The keystore is never in the
  repository: give it in the environment variables ZED_UPLOAD_STORE_FILE, ZED_UPLOAD_STORE_PASSWORD,
  ZED_UPLOAD_KEY_ALIAS and ZED_UPLOAD_KEY_PASSWORD (set them in the window before running; they are not printed). The
  script refuses a production APK that would be signed with the debug key.

  Every APK's server setting is read back with aapt2 and must match what was asked; otherwise the APK is not copied.
  The tools come from Install-ZedApkTools.ps1 (-ToolsRoot); caches and temporary files stay under -ToolsRoot, off the
  system drive. A log is written to <Output>\logs.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Build-ZedApk.ps1 -App zedmsme
  # ZED MSME (the applicant app) for the test server, from the latest main.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Build-ZedApk.ps1 -App msme
  # ZED Surveillance (Bronze) for the test server.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Build-ZedApk.ps1 -App all -Ref 520e94d
.EXAMPLE
  $env:ZED_UPLOAD_STORE_FILE = 'F:\secure\zed-bronze-upload.jks'   # and the three other ZED_UPLOAD_* variables
  powershell -ExecutionPolicy Bypass -File .\Build-ZedApk.ps1 -App msme -Production
#>
[CmdletBinding()]
param(
    [ValidateSet('zedmsme', 'msme', 'assessor', 'consultant', 'all')]
    [string]$App = 'zedmsme',
    [string]$ToolsRoot = 'E:\ZedApkTools',
    [string]$Source = 'E:\ZedApkBuild\src',
    [string]$Repository = 'https://github.com/mahavirtiwari/ZED-Portal-Upgraded.git',
    [string]$Branch = 'main',
    [string]$Ref,
    [switch]$SkipUpdate,
    [string]$Output = 'E:\Releases\apk',
    [switch]$Production,
    [switch]$KeepBuildFolders
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }

# Runs a program and shows its output. Its stderr (warnings, progress) is text, not an error: Windows PowerShell would
# otherwise stop the script on the first such line when the output is redirected. The exit code decides.
function Invoke-Tool {
    param([Parameter(Mandatory)][string]$Exe, [string[]]$Arguments = @())
    $ErrorActionPreference = 'Continue'
    & $Exe @Arguments 2>&1 | ForEach-Object { Write-Host "$_" }
    $LASTEXITCODE
}

# The apps: workspace folder, file label, Gradle's output file prefix.
$apps = [ordered]@{
    zedmsme    = @{ Label = 'ZED-MSME'; Id = 'com.qci.zed.msmeapp' }
    msme       = @{ Label = 'ZED-Surveillance-Bronze'; Id = 'com.qci.zed.bronzesurveillance' }
    assessor   = @{ Label = 'ZED-SA'; Id = 'com.qci.zed.siteassessment' }
    consultant = @{ Label = 'ZED-Consultancy'; Id = 'com.qci.zed.consultancy' }
}
$selected = if ($App -eq 'all') { @($apps.Keys) } else { @($App) }
$environment = if ($Production) { 'production' } else { 'staging' }   # Gradle's internal name of the test server setting
$kind = if ($Production) { 'live' } else { 'test' }

# --- Tools (Install-ZedApkTools.ps1) and caches, for this run only
$ToolsRoot = [IO.Path]::GetFullPath($ToolsRoot)
$jdk = Join-Path $ToolsRoot 'jdk-17'
$node = Join-Path $ToolsRoot 'node'
$sdk = Join-Path $ToolsRoot 'android-sdk'
foreach ($p in @("$jdk\bin\java.exe", "$node\node.exe", "$sdk\build-tools\37.0.0\aapt2.exe")) {
    if (-not (Test-Path $p)) { throw "$p not found. Run Install-ZedApkTools.ps1 -ToolsRoot '$ToolsRoot' first." }
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is not on the PATH.' }
$tmp = Join-Path $ToolsRoot 'tmp'
New-Item -ItemType Directory -Force -Path $tmp, $Output, (Join-Path $Output 'logs') | Out-Null
$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:PATH = "$jdk\bin;$node;$sdk\platform-tools;$env:PATH"
$env:GRADLE_USER_HOME = Join-Path $ToolsRoot 'gradle-home'
$env:npm_config_cache = Join-Path $ToolsRoot 'npm-cache'
$env:TEMP = $tmp
$env:TMP = $tmp
$env:GRADLE_OPTS = "-Djava.io.tmpdir=$tmp"

$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$log = Join-Path $Output "logs\build-$App-$kind-$stamp.log"
Start-Transcript -Path $log | Out-Null
try {
    # --- Production: the upload keystore must be given (never the debug key on the Play Store)
    if ($Production) {
        $missing = @('ZED_UPLOAD_STORE_FILE', 'ZED_UPLOAD_STORE_PASSWORD', 'ZED_UPLOAD_KEY_ALIAS', 'ZED_UPLOAD_KEY_PASSWORD') |
            Where-Object { -not [Environment]::GetEnvironmentVariable($_) }
        if ($missing) { throw "Production build: set $($missing -join ', ') in this window first (the Play Store upload keystore)." }
        if (-not (Test-Path $env:ZED_UPLOAD_STORE_FILE)) { throw "Production build: the keystore file $env:ZED_UPLOAD_STORE_FILE does not exist." }
        Write-Host 'Building for the LIVE server, signed with the upload keystore.' -ForegroundColor Yellow
    } else {
        Write-Host 'Building for the TEST server (https://zedv3.qci.org.in), signed with the debug key of this machine.'
    }

    # --- Code: a checkout of its own, updated to the branch or -Ref
    if (-not (Test-Path (Join-Path $Source '.git'))) {
        if ($SkipUpdate) { throw "$Source is not a Git checkout (drop -SkipUpdate to clone it)." }
        Write-Step "Cloning $Repository into $Source"
        New-Item -ItemType Directory -Force (Split-Path -Parent $Source) | Out-Null
        if ((Invoke-Tool git @('clone', '--quiet', $Repository, $Source)) -ne 0) { throw 'git clone failed.' }
    }
    Push-Location $Source
    try {
        if (-not $SkipUpdate) {
            if (git status --porcelain) { throw "$Source has local changes. Use a clean checkout for builds (or -SkipUpdate to build it as it is)." }
            Write-Step 'Getting the latest code'
            if ((Invoke-Tool git @('fetch', '--quiet', '--tags', 'origin')) -ne 0) { throw 'git fetch failed.' }
            $target = if ($Ref) { $Ref } else { "origin/$Branch" }
            if ((Invoke-Tool git @('checkout', '--quiet', '--force', '--detach', $target)) -ne 0) { throw "git checkout $target failed." }
        }
        $commit = (git rev-parse --short HEAD).Trim()
        Write-Host "    Commit $commit"
    } finally { Pop-Location }

    $mobile = Join-Path $Source 'mobile'
    Write-Step 'Installing the JavaScript packages (npm ci)'
    Push-Location $mobile
    try {
        if ((Invoke-Tool "$node\npm.cmd" @('ci', '--no-audit', '--no-fund')) -ne 0) { throw 'npm ci failed.' }
    } finally { Pop-Location }

    $aapt2 = Join-Path $sdk 'build-tools\37.0.0\aapt2.exe'
    $apksigner = Join-Path $sdk 'build-tools\37.0.0\apksigner.bat'
    $results = @()
    foreach ($a in $selected) {
        $info = $apps[$a]
        $android = Join-Path $mobile "apps\$a\android"
        $outDir = Join-Path $android 'app\build\outputs\apk\release'
        Remove-Item -Recurse -Force $outDir -ErrorAction SilentlyContinue

        Write-Step "Building $($info.Label) ($($info.Id)) for the $kind server (6-12 minutes the first time)"
        Push-Location $android
        try {
            $code = Invoke-Tool (Join-Path $android 'gradlew.bat') @('assembleRelease', "-PzedEnvironment=$environment", '--no-daemon')
            if ($code -ne 0) { throw "Gradle failed for $a (exit code $code)." }
        } finally { Pop-Location }

        $apk = Get-ChildItem $outDir -Filter *.apk | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $apk) { throw "No APK in $outDir." }

        # The server the APK talks to, as built: it must be the one asked for.
        $dump = & $aapt2 dump resources $apk.FullName | Select-String -Context 0, 1 'string/zed_environment'
        $value = if ($dump) { ($dump.Context.PostContext -join ' ') } else { '' }
        if ($value -notmatch "`"$environment`"") {
            throw "$($apk.Name): its server setting is '$value', expected '$environment'. The APK is not copied; do not install it."
        }

        # A production APK must not carry the debug key.
        if ($Production) {
            # Through cmd: apksigner's stderr would be an error in Windows PowerShell.
            $certs = cmd /c "`"$apksigner`" verify --print-certs `"$($apk.FullName)`" 2>&1" | Out-String
            if ($LASTEXITCODE -ne 0 -or $certs -match 'CN=Android Debug') { throw "$($apk.Name) is not signed with the upload keystore." }
        }

        $name = "$($info.Label)_$($kind)_$($apk.BaseName -replace '^.*?(\d+(\.\d+)*-\d+)$', '$1')_$stamp.apk"
        $dest = Join-Path $Output $name
        Copy-Item $apk.FullName $dest -Force
        $hash = (Get-FileHash $dest -Algorithm SHA256).Hash
        Set-Content -Path "$dest.sha256" -Value "$hash  $name" -Encoding ascii
        $results += [pscustomobject]@{ App = $info.Label; Server = $kind; File = $dest; SizeMB = [math]::Round((Get-Item $dest).Length / 1MB, 1); Commit = $commit }

        if (-not $KeepBuildFolders) {
            Remove-Item -Recurse -Force (Join-Path $android 'app\build') -ErrorAction SilentlyContinue
        }
    }
    if (-not $KeepBuildFolders) {
        Remove-Item -Recurse -Force (Join-Path $mobile 'packages\shared\android\build') -ErrorAction SilentlyContinue
    }

    Write-Host ''
    Write-Host 'Done.' -ForegroundColor Green
    $results | Format-Table -AutoSize | Out-String | Write-Host
    if (-not $Production) {
        Write-Host 'Install on a phone connected with USB debugging (uninstall a test build signed elsewhere first):'
        foreach ($r in $results) { Write-Host "  adb install -r `"$($r.File)`"" }
    }
    Write-Host "Log: $log"
} finally {
    Stop-Transcript | Out-Null
}
