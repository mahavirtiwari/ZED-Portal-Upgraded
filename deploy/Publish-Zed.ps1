<#
.SYNOPSIS
  Builds a V4 release package: the three portals (API + Angular build), the mobile services host and Zed.Jobs.

.DESCRIPTION
  Output: <Output>\zed-<Version>\
    main\            Zed.Main.Api          + Angular "main"         (IIS application /)
    consultancy\     Zed.Consultancy.Api   + Angular "consultancy"  (IIS application /Consultancy)
    surveillance\    Zed.Surveillance.Api  + Angular "surveillance" (IIS application /surveillance)
    mobile\          Zed.Main.MobileApi    (deployed three times by Install-ZedIis.ps1, Mobile:System per copy)
    jobs\            Zed.Jobs              (Windows service, docs/JOBS.md)
    database\        migrations and fixes, for the DBA
    VERSION.txt

  No settings or secrets go into the package: appsettings.Development.json is removed, and the servers get their
  settings as app pool environment variables (Install-ZedIis.ps1) or service environment (Zed.Jobs).
  Windows PowerShell 5.1 or later.

.EXAMPLE
  .\deploy\Publish-Zed.ps1 -Output D:\Releases
.EXAMPLE
  .\deploy\Publish-Zed.ps1 -Output D:\Releases -SkipTests -SkipNpmCi   # quick rebuild on a dev machine
#>
[CmdletBinding()]
param(
    [string]$Output = (Join-Path $PSScriptRoot '..\publish'),
    [string]$Version = (Get-Date -Format 'yyyy.MM.dd-HHmm'),
    [switch]$SkipTests,
    # npm ci deletes and reinstalls node_modules; skip it on a machine where it is already installed.
    [switch]$SkipNpmCi
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backend = Join-Path $repo 'backend'
$frontend = Join-Path $repo 'frontend'
$target = Join-Path $Output "zed-$Version"

function Invoke-Native([string]$Title, [scriptblock]$Command, [string]$WorkingDirectory = $repo) {
    Write-Host "==> $Title" -ForegroundColor Cyan
    Push-Location $WorkingDirectory
    # Windows PowerShell turns a native tool's stderr (warnings too) into errors; judge by the exit code instead.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Command 2>&1 | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { Write-Host $_.Exception.Message } else { $_ } }
        if ($LASTEXITCODE -ne 0) { throw "$Title failed (exit code $LASTEXITCODE)." }
    }
    finally {
        $ErrorActionPreference = $previous
        Pop-Location
    }
}

if (Test-Path $target) { throw "$target already exists. Choose another -Version or remove it." }
foreach ($tool in 'dotnet', 'npm', 'npx') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not on the PATH." }
}

if (-not $SkipNpmCi) { Invoke-Native 'npm ci' { npm ci --no-audit --no-fund } $frontend }

if (-not $SkipTests) {
    Invoke-Native 'Backend tests' { dotnet test (Join-Path $backend 'Zed.slnx') -c Release }
    Invoke-Native 'Frontend tests' { npx ng test main --watch=false } $frontend
}

New-Item -ItemType Directory -Force -Path $target | Out-Null
$angularOut = Join-Path $target '_angular'

$portals = @(
    @{ Folder = 'main';         Project = 'Zed.Main.Api';         Angular = 'main' },
    @{ Folder = 'consultancy';  Project = 'Zed.Consultancy.Api';  Angular = 'consultancy' },
    @{ Folder = 'surveillance'; Project = 'Zed.Surveillance.Api'; Angular = 'surveillance' }
)
$hosts = $portals + @(
    @{ Folder = 'mobile'; Project = 'Zed.Main.MobileApi' },
    @{ Folder = 'jobs';   Project = 'Zed.Jobs' }
)

foreach ($p in $portals) {
    $out = Join-Path $angularOut $p.Angular
    Invoke-Native "ng build $($p.Angular)" { npx ng build $p.Angular --configuration production --output-path $out } $frontend
}

foreach ($h in $hosts) {
    $out = Join-Path $target $h.Folder
    $proj = Join-Path $backend "src\$($h.Project)"
    Invoke-Native "dotnet publish $($h.Project)" { dotnet publish $proj -c Release -o $out --nologo -p:SourceRevisionId=$Version }
    # Development settings hold local connection strings and dummy keys; a server must never load them.
    Get-ChildItem $out -Filter 'appsettings.Development*.json' | Remove-Item -Force
}

foreach ($p in $portals) {
    $browser = Join-Path (Join-Path $angularOut $p.Angular) 'browser'
    if (-not (Test-Path (Join-Path $browser 'index.html'))) { throw "Angular build $($p.Angular) produced no index.html." }
    $wwwroot = Join-Path (Join-Path $target $p.Folder) 'wwwroot'
    New-Item -ItemType Directory -Force -Path $wwwroot | Out-Null
    Copy-Item (Join-Path $browser '*') $wwwroot -Recurse -Force
}
Remove-Item $angularOut -Recurse -Force

Copy-Item (Join-Path $repo 'database') (Join-Path $target 'database') -Recurse
Get-ChildItem (Join-Path $target 'database') -Recurse -Directory -Filter 'logs' | Remove-Item -Recurse -Force

$commit = ''
if (Get-Command git -ErrorAction SilentlyContinue) {
    $commit = (& git -C $repo rev-parse --short HEAD 2>$null)
    if ((& git -C $repo status --porcelain 2>$null)) { $commit += ' (uncommitted changes)' }
}
@(
    "ZED portal V4 $Version",
    "Commit: $commit",
    "Built: $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')) on $env:COMPUTERNAME",
    "Tests: $(if ($SkipTests) { 'skipped' } else { 'passed' })"
) | Set-Content -Path (Join-Path $target 'VERSION.txt') -Encoding UTF8

Write-Host "Package ready: $target" -ForegroundColor Green
