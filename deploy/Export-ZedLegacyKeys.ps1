<#
.SYNOPSIS
  Copies the keys V4 still needs from the legacy source code into a small JSON file for the staging settings,
  without showing them.
.DESCRIPTION
  Reads the legacy ZEDCS source (the folders "ZEDCS main", ZEDCS_CONSULTANCY, ZEDCS_SURVEILLANCE) and writes, under the
  settings file's section names:
    Main.Udyam__AccessKey              MsmeController, the Udyam service address (GetUdyam/...,<key>)
    Main.Recaptcha__AppSecretKey       MsmeController.ValidateCaptcha, the MSME app's Android reCAPTCHA secret
    Main.Twilio__AccountSid/ApiKey/ApiSecret and MobileMain.Mobile__Twilio__*   MsmeHelper.GenerateToken
  Each value must be the same in every legacy file that holds it, or the script stops.
  Not copied, on purpose: the CCAvenue merchant and keys (the live merchant would take real payments on staging; use
  CCAvenue's test merchant), the web reCAPTCHA keys (registered for the live domain; staging needs its own pair or
  Recaptcha__Enabled=false), the SMTP passwords and the ERP secret (ERP is off on staging).
  Only names, the file and line they came from, their length and a short hash are shown, never a value. The output
  file is readable by the current user only; it refuses to write inside a Git working tree. Copy it to the server and
  run deploy\Invoke-ZedStaging.ps1 -Step Keys -KeysFile <file> -Apply, then delete it.
.EXAMPLE
  .\Export-ZedLegacyKeys.ps1 -LegacyRoot 'D:\ZED Portal Code' -Output 'D:\ZED-keys\staging-keys.json'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$LegacyRoot,
    [Parameter(Mandatory)][string]$Output
)

$ErrorActionPreference = 'Stop'
$systems = 'ZEDCS main', 'ZEDCS_CONSULTANCY', 'ZEDCS_SURVEILLANCE'
foreach ($s in $systems) { if (-not (Test-Path (Join-Path $LegacyRoot $s))) { throw "Legacy folder not found: $(Join-Path $LegacyRoot $s)" } }

function Get-Hash([string]$Value) {
    $sha = [Security.Cryptography.SHA256]::Create()
    (-join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)) | ForEach-Object { $_.ToString('x2') })).Substring(0, 10)
}

$csFiles = foreach ($s in $systems) {
    Get-ChildItem (Join-Path $LegacyRoot $s) -Recurse -Filter '*.cs' -File |
        Where-Object { $_.FullName -notmatch '\\(bin|obj|packages)\\' }
}

# Every match of $Pattern (group 1 = the value) in the legacy .cs files, optionally only inside a method.
function Find-LegacyValue([string]$Name, [string]$Pattern, [string]$InMethod) {
    $found = @()
    foreach ($f in $csFiles) {
        $lines = [IO.File]::ReadAllLines($f.FullName)
        $method = ''
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $line = $lines[$i]
            if ($line -match '\b(public|private|protected|internal)\b[^=;]*\b(\w+)\s*\(') { $method = $Matches[2] }
            if ($line.TrimStart().StartsWith('//')) { continue }
            if ($InMethod -and $method -ne $InMethod) { continue }
            foreach ($m in [regex]::Matches($line, $Pattern)) {
                $found += [pscustomobject]@{ Value = $m.Groups[1].Value; Where = "$($f.FullName.Substring($LegacyRoot.TrimEnd('\').Length + 1)):$($i + 1)" }
            }
        }
    }
    if (-not $found) { throw "$Name not found in the legacy code." }
    $distinct = @($found | Select-Object -ExpandProperty Value -Unique)
    if ($distinct.Count -ne 1) {
        throw "$Name has $($distinct.Count) different values in the legacy code ($(@($found | ForEach-Object { "$($_.Where) #$(Get-Hash $_.Value)" }) -join '; ')). Choose by hand."
    }
    $v = $distinct[0]
    Write-Host ("    {0,-34} {1,2} place(s), e.g. {2}  (length {3}, #{4})" -f $Name, $found.Count, $found[0].Where, $v.Length, (Get-Hash $v))
    $v
}

Write-Host "==> Reading the legacy code in $LegacyRoot (values are not shown)" -ForegroundColor Cyan
$udyam = Find-LegacyValue 'Udyam access key' 'mobileNumber\s*\+\s*",([^"]+)"'
$appSecret = Find-LegacyValue 'MSME app reCAPTCHA secret' '\bsecret\s*=\s*"([^"]{20,})"' 'ValidateCaptcha'
$sid = Find-LegacyValue 'Twilio account SID' 'twilioAccountSid\s*=\s*"([^"]+)"'
$apiKey = Find-LegacyValue 'Twilio API key' 'twilioApiKey\s*=\s*"([^"]+)"'
$apiSecret = Find-LegacyValue 'Twilio API secret' 'twilioApiSecret\s*=\s*"([^"]+)"'

$data = [ordered]@{
    _comment   = "Keys copied from the legacy code by Export-ZedLegacyKeys.ps1 on $(Get-Date -Format 'yyyy-MM-dd HH:mm'). SECRET: never commit, mail or paste it; delete it after deploy\Invoke-ZedStaging.ps1 -Step Keys -Apply."
    Main       = [ordered]@{ Udyam__AccessKey = $udyam; Recaptcha__AppSecretKey = $appSecret; Twilio__AccountSid = $sid; Twilio__ApiKey = $apiKey; Twilio__ApiSecret = $apiSecret }
    MobileMain = [ordered]@{ Mobile__Twilio__AccountSid = $sid; Mobile__Twilio__ApiKey = $apiKey; Mobile__Twilio__ApiSecret = $apiSecret }
}

# Never inside a Git working tree: the file must not end up in a commit.
$outFull = [IO.Path]::GetFullPath($Output)
$dir = Split-Path -Parent $outFull
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$probe = $dir
while ($probe) {
    if (Test-Path (Join-Path $probe '.git')) { throw "$dir is inside the Git working tree $probe. Choose a folder outside any repository." }
    $probe = Split-Path -Parent $probe
}
[IO.File]::WriteAllText($outFull, ($data | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding $false))
& icacls $outFull /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):(F)" 'NT AUTHORITY\SYSTEM:(F)' | Out-Null

Write-Host ''
Write-Host "Written: $outFull (readable by $($env:USERNAME) only)" -ForegroundColor Green
Write-Host 'Not copied on purpose: CCAvenue (live merchant), web reCAPTCHA (live domain), SMTP passwords, ERP secret.'
Write-Host 'Copy the file to the staging server (for example E:\ZedStaging\staging-keys.json), then there:'
Write-Host '    .\deploy\Invoke-ZedStaging.ps1 -Step Keys -KeysFile E:\ZedStaging\staging-keys.json'
Write-Host '    .\deploy\Invoke-ZedStaging.ps1 -Step Keys -KeysFile E:\ZedStaging\staging-keys.json -Apply'
Write-Host 'and delete the file on both machines afterwards.'
