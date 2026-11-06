$ErrorActionPreference = 'Stop'
$delivery = (Get-Location).Path
$out = Join-Path $delivery '.data/acceptance-202'
$dbOwner = Get-Content (Join-Path $out 'native-db-owner-v1/owner.private.json') -Raw | ConvertFrom-Json
$dbClosed = Get-Content (Join-Path $out 'native-db-owner-v1/closed.json') -Raw | ConvertFrom-Json
$transport = Get-Content (Join-Path $out 'transport-v1/receipt.private.json') -Raw | ConvertFrom-Json
$transportClosed = Get-Content (Join-Path $out 'transport-v1/closed.json') -Raw | ConvertFrom-Json
if ($dbClosed.exit_code -ne 0 -or $dbOwner.owner_pid -ne $dbClosed.owner_pid -or $dbOwner.child_pid -ne $dbClosed.child_pid) { throw 'Owned database shutdown was not confirmed' }
if (-not $transportClosed.listeners_closed -or $transport.owner_pid -ne $transportClosed.owner_pid) { throw 'Owned QA transport shutdown was not confirmed' }
$processes = @(Get-CimInstance Win32_Process)
$dbHelpers = @($processes | Where-Object { $_.ProcessId -in @($dbOwner.owner_pid,$dbOwner.child_pid) -or $_.CommandLine -match 'scripts[\\/]owned-native-db-202-v1\.mjs' })
$qaHelpers = @($processes | Where-Object { $_.ProcessId -eq $transport.owner_pid -or $_.CommandLine -match 'scripts[\\/]company-qa-tunnel-202-v1\.py' })
$browsers = @($processes | Where-Object { $_.ExecutablePath -match 'copypaste-delivery[\\/]\.data[\\/]browsers[\\/]chromium-1248[\\/]' })
$desktops = @($processes | Where-Object { $_.ExecutablePath -match 'copypaste-desktop[\\/]\.data[\\/]deployment-202-v2[\\/]release[\\/]win-unpacked[\\/]CopyPaste\.exe$' })
$ports = @(([uri]$transport.proxy).Port,55432)
if ($transport.tls_sni_port) { $ports += [int]$transport.tls_sni_port }
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in $ports -and $_.LocalAddress -in @('127.0.0.1','0.0.0.0','::','::1') })
$database = Join-Path (Split-Path $delivery) 'copypaste-platform/.data/postgres'
$preserved = (Test-Path -LiteralPath (Join-Path $database 'PG_VERSION')) -and (Test-Path -LiteralPath (Join-Path $database 'base'))
$ownerAbsent = -not (Test-Path -LiteralPath (Join-Path $database 'postmaster.pid'))
if ($dbHelpers.Count -or $qaHelpers.Count -or $browsers.Count -or $desktops.Count -or $listeners.Count -or -not $preserved -or -not $ownerAbsent) { throw 'Owned runtime cleanup is incomplete; preserve unrelated programs and inspect exact owners' }
$receipt = [ordered]@{
  stage=202; status='passed'; at=[DateTime]::UtcNow.ToString('o');
  owned_browsers_remaining=$browsers.Count; owned_desktop_instances_remaining=$desktops.Count;
  owned_db_helpers_remaining=$dbHelpers.Count; owned_qa_transports_remaining=$qaHelpers.Count;
  owned_transport_listeners_remaining=$listeners.Count; owned_transport_listeners_closed=$true;
  native_postgres_checkpointed=$true; native_database_files_preserved=$preserved; original_owner_file_absent=$ownerAbsent;
  local_virtualization_used=$false; unrelated_user_sessions_not_targeted=$true;
  scope='Read-only collection after driver finally blocks close their owned browsers/native clients, exact-owner IPC PostgreSQL checkpointing shutdown and owned company-only QA transport stop. No process kills, recursive deletion or server/network changes.'
}
$destination = Join-Path $out 'runtime-cleanup-v1.json'
if (Test-Path -LiteralPath $destination) { throw 'Immutable cleanup receipt already exists' }
[IO.File]::WriteAllText($destination, ($receipt | ConvertTo-Json -Depth 8) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
$receipt | ConvertTo-Json -Compress
