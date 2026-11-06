$ErrorActionPreference = 'Stop'
$processes = Get-CimInstance Win32_Process
$browsers = @($processes | Where-Object { $_.Name -eq 'chrome.exe' -and $_.ExecutablePath -like '*copypaste-delivery\.data\browsers\chromium-1248\chrome-win64\chrome.exe' })
$desktop = @($processes | Where-Object { $_.Name -eq 'CopyPaste.exe' -and $_.ExecutablePath -like '*copypaste-desktop\.data\deployment-199-v1\release\win-unpacked\CopyPaste.exe' })
$database = @($processes | Where-Object { $_.Name -eq 'node.exe' -and ($_.CommandLine -match 'scripts/native-db-launch.mjs' -or $_.CommandLine -match 'dist.scripts.db-local.js') })
$transports = @($processes | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -match 'company-qa-tunnel-199-v[1-5].py' })
if ($browsers.Count -or $desktop.Count -or $database.Count -or $transports.Count) { throw 'An owned runtime remains; preserve unrelated processes and inspect the exact owner.' }
$closed = Get-Content -LiteralPath .data/acceptance-199/transport-v5/closed.json -Raw | ConvertFrom-Json
if (-not $closed.listeners_closed) { throw 'Owned transport listener closure not confirmed' }
$report = [ordered]@{
 stage=199; status='cleaned'; at=(Get-Date).ToUniversalTime().ToString('o');
 owned_browsers_remaining=$browsers.Count; owned_desktop_instances_remaining=$desktop.Count;
 owned_db_helpers_remaining=$database.Count; owned_qa_transports_remaining=$transports.Count;
 owned_transport_listeners_closed=$true; local_virtualization_used=$false;
 unrelated_user_sessions_not_targeted=$true;
 scope='Only round-owned Chromium, packaged Desktop, native database helpers and exact QA transport are checked. The zero-byte public Portable check was bounded by closing its exact owned browser; its failure remains.'
}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath .data/deployment-199-v1/final-owned-process-check.sanitized.json -Encoding utf8
$report | ConvertTo-Json -Compress
