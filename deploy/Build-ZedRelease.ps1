<#
.SYNOPSIS
  Builds a V4 release package from Git: clones (or updates) a checkout at the given branch, tag or commit and runs
  Publish-Zed.ps1 on it, then zips the package and writes its SHA-256.
.DESCRIPTION
  Runs on any Windows machine with Git, the .NET 10 SDK and Node.js 24 (a build PC, or a server where those are
  installed). The checkout is a separate folder used only for builds: the script refuses one with local changes, so
  the package is exactly the commit it names.
  Output: <Output>\zed-<Version>\ (the package, with deploy\ and database\), <Output>\zed-<Version>.zip and
  <Output>\zed-<Version>.zip.sha256. On the staging server, run deploy\Invoke-ZedStaging.ps1 from the package folder.
  Windows PowerShell 5.1 or later.
.EXAMPLE
  .\Build-ZedRelease.ps1 -Output D:\Releases
  Builds the tip of main into D:\Releases (checkout in D:\Releases\_src).
.EXAMPLE
  .\Build-ZedRelease.ps1 -Output E:\Releases -Ref v4.0.0-rc1 -Version 2026.10.30-stg2
  Builds a tag, with a chosen version name.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Output,
    [string]$Ref = 'main',
    [string]$RepoUrl = 'https://github.com/mahavirtiwari/ZED-Portal-Upgraded.git',
    # Default: <Output>\_src
    [string]$WorkDir,
    # Default: yyyy.MM.dd-HHmm-<short commit>
    [string]$Version,
    # Tests are part of a release build; skip them only for a trial package that is not installed anywhere.
    [switch]$SkipTests,
    [switch]$NoZip
)

$ErrorActionPreference = 'Stop'
if (-not $WorkDir) { $WorkDir = Join-Path $Output '_src' }

function Invoke-Git {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'   # git writes progress to stderr
    try {
        $out = & git @args 2>&1 | ForEach-Object { "$_" }
        if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed (exit code $LASTEXITCODE): $($out -join ' ')" }
        $out
    }
    finally { $ErrorActionPreference = $previous }
}

# ---------------------------------------------------------------- tools
foreach ($tool in 'git', 'dotnet', 'node', 'npm') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not on the PATH. Install it and open a new PowerShell window." }
}
if (-not (& dotnet --list-sdks | Where-Object { $_ -match '^10\.' })) { throw 'The .NET 10 SDK is not installed (dotnet --list-sdks shows no 10.x).' }
$nodeMajor = [int](((& node --version) -replace '^v', '').Split('.')[0])
if ($nodeMajor -lt 24) { Write-Warning "Node.js $(& node --version) found; the build is tested with Node 24." }

# ---------------------------------------------------------------- checkout
New-Item -ItemType Directory -Force -Path $Output | Out-Null
if (Test-Path (Join-Path $WorkDir '.git')) {
    Write-Host "==> Updating $WorkDir" -ForegroundColor Cyan
    if (Invoke-Git -C $WorkDir status --porcelain) { throw "$WorkDir has local changes. It is a build folder: delete it and run again." }
    Invoke-Git -C $WorkDir remote set-url origin $RepoUrl | Out-Null
    Invoke-Git -C $WorkDir fetch --prune --tags --force origin | Out-Null
}
else {
    if ((Test-Path $WorkDir) -and (Get-ChildItem $WorkDir -Force | Select-Object -First 1)) { throw "$WorkDir exists and is not a Git checkout." }
    Write-Host "==> Cloning $RepoUrl into $WorkDir" -ForegroundColor Cyan
    Invoke-Git clone --no-checkout $RepoUrl $WorkDir | Out-Null
}

# A branch name means the remote branch; a tag or commit is taken as it is.
$commit = $null
foreach ($candidate in @("refs/remotes/origin/$Ref", "refs/tags/$Ref", $Ref)) {
    $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $c = & git -C $WorkDir rev-parse --verify --quiet "$candidate^{commit}" 2>$null
    $ErrorActionPreference = $previous
    if ($LASTEXITCODE -eq 0 -and $c) { $commit = "$c".Trim(); break }
}
if (-not $commit) { throw "No branch, tag or commit '$Ref' in $RepoUrl." }
Invoke-Git -C $WorkDir checkout --force --detach $commit | Out-Null
Invoke-Git -C $WorkDir clean -fdx -e frontend/node_modules | Out-Null
$short = ("$(Invoke-Git -C $WorkDir rev-parse --short $commit)").Trim()
$subject = ("$(Invoke-Git -C $WorkDir log -1 --format=%s $commit)").Trim()
Write-Host "    $Ref = $short  $subject"

if (-not $Version) { $Version = (Get-Date -Format 'yyyy.MM.dd-HHmm') + "-$short" }
$package = Join-Path $Output "zed-$Version"
if (Test-Path $package) { throw "$package already exists. Choose another -Version." }

# ---------------------------------------------------------------- build
$publishArgs = @{ Output = $Output; Version = $Version }
if ($SkipTests) { $publishArgs.SkipTests = $true; Write-Warning 'Tests skipped: do not install this package on staging or production.' }
& (Join-Path $WorkDir 'deploy\Publish-Zed.ps1') @publishArgs
if (-not (Test-Path (Join-Path $package 'VERSION.txt'))) { throw "Publish-Zed.ps1 produced no package at $package." }
foreach ($folder in 'main', 'consultancy', 'surveillance', 'mobile', 'jobs', 'database', 'deploy') {
    if (-not (Test-Path (Join-Path $package $folder))) { throw "The package has no $folder folder." }
}
Get-Content (Join-Path $package 'VERSION.txt')

if (-not $NoZip) {
    $zip = "$package.zip"
    Write-Host "==> Zipping $zip" -ForegroundColor Cyan
    Compress-Archive -Path $package -DestinationPath $zip
    $hash = (Get-FileHash $zip -Algorithm SHA256).Hash
    "$hash  zed-$Version.zip" | Set-Content -Path "$zip.sha256" -Encoding ASCII
    Write-Host "    SHA-256 $hash"
}

Write-Host ''
Write-Host "Release zed-$Version built from $short." -ForegroundColor Green
Write-Host "On the server: copy the zip to E:\Releases, then in an administrator PowerShell:"
Write-Host "    Expand-Archive E:\Releases\zed-$Version.zip -DestinationPath E:\Releases"
Write-Host "    Get-ChildItem E:\Releases\zed-$Version -Recurse -File | Unblock-File"
Write-Host "    cd E:\Releases\zed-$Version"
Write-Host "    .\deploy\Invoke-ZedStaging.ps1 -Step Check"
