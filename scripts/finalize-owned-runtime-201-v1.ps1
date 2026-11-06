$ErrorActionPreference = 'Stop'
$base = '.data/acceptance-201'
if ((Get-Content -LiteralPath .data/integrated-201-v4/verification.json -Raw | ConvertFrom-Json).state -ne 'passed') { throw 'Unified validation is incomplete.' }
$live = @(Get-ChildItem -LiteralPath $base -Directory -Filter 'live-motion-*' | ForEach-Object {
  $p = Join-Path $_.FullName 'receipt.json'
  if (Test-Path -LiteralPath $p) { Get-Content -LiteralPath $p -Raw | ConvertFrom-Json }
})
if (@($live | Where-Object { $_.status -eq 'passed' -and $_.owned_windows_closed }).Count -ne 1) { throw 'Real packaged-client acceptance or closure incomplete.' }
if ((Get-Content -LiteralPath '.data/deployment-201-v1/public-stream-v2.sanitized.json' -Raw | ConvertFrom-Json).status -ne 'passed') { throw 'Full public content acceptance incomplete.' }
$processes = Get-CimInstance Win32_Process
$browsers = @($processes | Where-Object { $_.Name -eq 'chrome.exe' -and $_.ExecutablePath -like '*copypaste-delivery\.data\browsers\chromium-1248\chrome-win64\chrome.exe' })
$desktop = @($processes | Where-Object { $_.Name -eq 'CopyPaste.exe' -and $_.ExecutablePath -like '*copypaste-desktop\.data\deployment-201-v1\release\win-unpacked\CopyPaste.exe' })
$database = @($processes | Where-Object { $_.Name -eq 'node.exe' -and ($_.CommandLine -match 'scripts/native-db-launch.mjs' -or $_.CommandLine -match 'dist.scripts.db-local.js' -or $_.CommandLine -match 'owned-native-db-201-v1.mjs') })
$transports = @($processes | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -match 'company-qa-tunnel-201-v1.py' })
if ($browsers.Count -or $desktop.Count -or $database.Count -or $transports.Count) { throw 'A QA runtime remains; this read-only check does not terminate processes.' }
$dbClosed = Get-Content -LiteralPath "$base/native-db-owner-v1/closed.json" -Raw | ConvertFrom-Json
if ($dbClosed.exit_code -ne 0) { throw 'Owned native database shutdown did not complete.' }
$dbLog = Get-Content -LiteralPath "$base/native-db-owner-v1/output.log" -Raw
if ($dbLog -notmatch 'database system is shut down') { throw 'Checkpointed native shutdown not confirmed.' }
$data = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) '../copypaste-platform/.data/postgres'))
if (-not (Test-Path -LiteralPath (Join-Path $data 'PG_VERSION'))) { throw 'Preserved native database files missing.' }
if (Test-Path -LiteralPath (Join-Path $data 'postmaster.pid')) { throw 'Native database still has an owner file.' }
$closed = Get-Content -LiteralPath "$base/transport-v1/closed.json" -Raw | ConvertFrom-Json
if (-not $closed.listeners_closed) { throw 'Owned transport closure not confirmed.' }
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $closed.owner_pid })
if ($listeners.Count) { throw 'An owned transport listener remains.' }
$report = [ordered]@{
 stage=201; status='passed'; at=(Get-Date).ToUniversalTime().ToString('o');
 owned_browsers_remaining=$browsers.Count; owned_desktop_instances_remaining=$desktop.Count;
 owned_db_helpers_remaining=$database.Count; owned_qa_transports_remaining=$transports.Count;
 owned_transport_listeners_remaining=$listeners.Count; owned_transport_listeners_closed=$true;
 native_postgres_checkpointed=$true; native_database_files_preserved=$true; original_owner_file_absent=$true;
 local_virtualization_used=$false; unrelated_user_sessions_not_targeted=$true;
 scope='Read-only confirmation after every driver finally closes its owned windows, graceful IPC database shutdown and exact transport stop. No processes killed, recursive files removed or server services stopped.'
}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$base/runtime-cleanup-v1.json" -Encoding utf8
$report | ConvertTo-Json -Compress
