$ErrorActionPreference = 'Stop'
$desktopControlDirectory = 'D:\dev\copypasted\自有agent\dev\copypaste-delivery'
Set-Location -LiteralPath $desktopControlDirectory
$desktopControlPrefix = Join-Path $desktopControlDirectory 'evidence\desktop-execution-control-13'
foreach ($desktopControlSuffix in @('.json', '.tap', '-verifier.mjs', '-background-launcher.ps1')) {
    if (Test-Path -LiteralPath ($desktopControlPrefix + $desktopControlSuffix)) { throw 'Attempt 13 already exists' }
}
if (Get-NetTCPConnection -LocalPort 55432 -State Listen -ErrorAction SilentlyContinue) { throw 'Never adopt an occupied database port' }
$desktopControlNode = 'D:\Program Files\nodejs\node.exe'
$desktopControlOwner = Join-Path $desktopControlDirectory '.data\desktop-control-13-owner.json'
if (Test-Path -LiteralPath $desktopControlOwner) { throw 'Owner record already exists' }
$env:COPYPASTE_LOCAL_CODEX_TEST_BIN = 'C:\Users\carzy\AppData\Local\OpenAI\Codex\bin\6257d9e8f63c0f2b\codex.exe'
Copy-Item -LiteralPath $PSCommandPath -Destination ($desktopControlPrefix + '-background-launcher.ps1')
$desktopControlJob = Start-Process -FilePath $desktopControlNode -ArgumentList @('scripts/run-desktop-execution-checks.mjs', '13', '--full-platform') -WorkingDirectory $desktopControlDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $desktopControlDirectory '.data\desktop-control-13.stdout.log') -RedirectStandardError (Join-Path $desktopControlDirectory '.data\desktop-control-13.stderr.log') -PassThru
[ordered]@{
    pid = $desktopControlJob.Id
    started_utc = $desktopControlJob.StartTime.ToUniversalTime().ToString('o')
    script = 'scripts/run-desktop-execution-checks.mjs'
    attempt = '13'
    arguments = @('13', '--full-platform')
    launcher_sha256 = (Get-FileHash -LiteralPath ($desktopControlPrefix + '-background-launcher.ps1') -Algorithm SHA256).Hash.ToLowerInvariant()
    qualification = 'Only the final source-bound runner receipt can establish pass and cleanup; a live PID is only a verified wait'
} | ConvertTo-Json | Set-Content -LiteralPath $desktopControlOwner -Encoding utf8
Get-Content -LiteralPath $desktopControlOwner
