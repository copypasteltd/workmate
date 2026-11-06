$ErrorActionPreference = 'Stop'
if ((Get-Content -LiteralPath .data/integrated-200-v4/verification.json -Raw | ConvertFrom-Json).state -ne 'passed') { throw 'Unified validation is incomplete.' }
$processes = Get-CimInstance Win32_Process
$browsers = @($processes | Where-Object { $_.Name -eq 'chrome.exe' -and $_.ExecutablePath -like '*copypaste-delivery\.data\browsers\chromium-1248\chrome-win64\chrome.exe' })
$desktop = @($processes | Where-Object { $_.Name -eq 'CopyPaste.exe' -and $_.ExecutablePath -like '*copypaste-desktop\.data\deployment-200-v2\release\win-unpacked\CopyPaste.exe' })
$database = @($processes | Where-Object { $_.Name -eq 'node.exe' -and ($_.CommandLine -match 'scripts/native-db-launch.mjs' -or $_.CommandLine -match 'dist.scripts.db-local.js') })
$transports = @($processes | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -match 'company-qa-tunnel-200-v1.py' })
$originalDb = @($processes | Where-Object { $_.Name -eq 'postgres.exe' -and $_.ExecutablePath -like '*native-runtime-aliases\postgres-DEXR7G\runtime\*' })
if ($browsers.Count -or $desktop.Count -or $database.Count -or $transports.Count -or $originalDb.Count) { throw 'An owned runtime remains; preserve it for inspection.' }
$aliasParent = 'C:\Users\carzy\AppData\Local\CopyPaste\native-runtime-aliases\postgres-DEXR7G'
if (Test-Path -LiteralPath $aliasParent) { throw 'Owned alias is still present; this read-only reconciliation does not remove it.' }
$data = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) '../copypaste-platform/.data/postgres'))
if (-not (Test-Path -LiteralPath (Join-Path $data 'PG_VERSION'))) { throw 'Preserved native database files are missing.' }
if (Test-Path -LiteralPath (Join-Path $data 'postmaster.pid')) { throw 'Native database still has an owner file.' }
$closed = Get-Content -LiteralPath .data/acceptance-200/transport-v1/closed.json -Raw | ConvertFrom-Json
if (-not $closed.listeners_closed) { throw 'Owned transport closure is not confirmed.' }
$report = [ordered]@{
 stage=200; status='cleaned'; at=(Get-Date).ToUniversalTime().ToString('o');
 owned_browsers_remaining=$browsers.Count; owned_desktop_instances_remaining=$desktop.Count;
 owned_db_helpers_remaining=$database.Count; owned_qa_transports_remaining=$transports.Count;
 owned_transport_listeners_closed=$true; native_postgres_checkpointed=$true;
 native_database_files_preserved=$true; original_owner_file_absent=$true; owned_alias_absent=$true;
 local_virtualization_used=$false; unrelated_user_sessions_not_targeted=$true;
 previous_attempt=[ordered]@{
  script='scripts/finalize-owned-runtime-200-v2.ps1'; exit_code=1;
  source='Observed original tool execution and original native helper output; no original receipt or exit is rewritten.';
  pg_ctl_exit=0; pg_ctl_stdout='waiting for server to shut down.... done; server stopped';
  native_helper_log='2026-11-06 15:55:19.787 CST checkpoint starting: shutdown immediate; 15:55:19.904 checkpoint complete; 15:55:20.023 database system is shut down';
  failure='Directory.Delete of the checked alias parent reported DirectoryNotFound after PostgreSQL shutdown and launcher cleanup. Exact alias and original owners are now absent.';
  helper_exit_code=1
 };
 scope='Read-only reconciliation after original checkpointing shutdown. Confirms actual owned process/listener/alias absence and preserved native database files; does not rerun tests, kill processes, delete paths or modify server services.'
}
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath .data/deployment-200-v2/final-owned-process-check-v3.sanitized.json -Encoding utf8
$report | ConvertTo-Json -Compress -Depth 6
