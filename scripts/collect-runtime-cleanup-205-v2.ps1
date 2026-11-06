$ErrorActionPreference = 'Stop'
$delivery = (Get-Location).Path
$out = Join-Path $delivery '.data/acceptance-205'
$dbOwnerFile = Get-Item (Join-Path $out 'native-db-owner-v1/owner.private.json')
$dbOwner = Get-Content -LiteralPath $dbOwnerFile.FullName -Raw | ConvertFrom-Json
$dbClosedFile = Get-Item (Join-Path $out 'native-db-owner-v1/closed.json')
$dbClosed = Get-Content -LiteralPath $dbClosedFile.FullName -Raw | ConvertFrom-Json
if ($dbClosed.exit_code -ne 0 -or $dbOwner.owner_pid -ne $dbClosed.owner_pid -or $dbOwner.child_pid -ne $dbClosed.child_pid) { throw 'Owned database shutdown was not confirmed' }
$transports = @()
foreach ($version in @('v1','v2')) {
  $ownerFile = Get-Item (Join-Path $out "transport-$version/receipt.private.json")
  $owner = Get-Content -LiteralPath $ownerFile.FullName -Raw | ConvertFrom-Json
  $closedFile = Get-Item (Join-Path $out "transport-$version/closed.json")
  $closed = Get-Content -LiteralPath $closedFile.FullName -Raw | ConvertFrom-Json
  if (-not $closed.listeners_closed -or $owner.owner_pid -ne $closed.owner_pid) { throw "Owned QA transport $version shutdown was not confirmed" }
  $transports += @{ version=$version; owner=$owner; ownerFile=$ownerFile; closedFile=$closedFile }
}
$processes = @(Get-CimInstance Win32_Process)
function Test-OwnerLifetime($process, $opened, $closed) {
  return $process.CreationDate.ToUniversalTime() -le $closed.LastWriteTimeUtc -and $process.CreationDate.ToUniversalTime() -ge $opened.CreationTimeUtc.AddSeconds(-10)
}
$dbHelpers = @($processes | Where-Object {
  ($_.CommandLine -match '(?:^|[\s"/\\])owned-native-db-205-v1\.mjs(?:[\s"]|$)') -or
  ($_.ProcessId -in @($dbOwner.owner_pid,$dbOwner.child_pid) -and (Test-OwnerLifetime $_ $dbOwnerFile $dbClosedFile))
})
$qaHelpers = @($processes | Where-Object {
  $p = $_
  $byCommand = $p.CommandLine -match '(?:^|[\s"/\\])company-qa-tunnel-205-v[12]\.py(?:[\s"]|$)'
  $byLifetime = @($transports | Where-Object { $p.ProcessId -eq $_.owner.owner_pid -and (Test-OwnerLifetime $p $_.ownerFile $_.closedFile) }).Count -gt 0
  $byCommand -or $byLifetime
})
$browsers = @($processes | Where-Object { $_.ExecutablePath -match 'copypaste-delivery[\\/]\.data[\\/]browsers[\\/]chromium-1248[\\/]' })
$desktops = @($processes | Where-Object { $_.ExecutablePath -match 'copypaste-desktop[\\/]\.data[\\/]deployment-205-v1[\\/]release[\\/]win-unpacked[\\/]CopyPaste\.exe$' })
$ports = @(55432)
foreach ($row in $transports) {
  $ports += ([uri]$row.owner.proxy).Port
  if ($row.owner.tls_sni_port) { $ports += [int]$row.owner.tls_sni_port }
}
$candidates = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in $ports -and $_.LocalAddress -in @('127.0.0.1','0.0.0.0','::','::1') })
$ownedIds = @($dbHelpers.ProcessId) + @($qaHelpers.ProcessId)
$listeners = @($candidates | Where-Object { $_.OwningProcess -in $ownedIds })
$unrelated = @($candidates | Where-Object { $_.OwningProcess -notin $ownedIds } | Select-Object LocalAddress,LocalPort,OwningProcess)
$database = Join-Path (Split-Path $delivery) 'copypaste-platform/.data/postgres'
$preserved = (Test-Path -LiteralPath (Join-Path $database 'PG_VERSION')) -and (Test-Path -LiteralPath (Join-Path $database 'base'))
$ownerAbsent = -not (Test-Path -LiteralPath (Join-Path $database 'postmaster.pid'))
if ($dbHelpers.Count -or $qaHelpers.Count -or $browsers.Count -or $desktops.Count -or $listeners.Count -or -not $preserved -or -not $ownerAbsent) { throw 'Owned runtime cleanup is incomplete; preserve unrelated programs and inspect exact owners' }
$receipt = [ordered]@{
  stage=205; status='passed'; at=[DateTime]::UtcNow.ToString('o');
  owned_browsers_remaining=$browsers.Count; owned_desktop_instances_remaining=$desktops.Count;
  owned_db_helpers_remaining=$dbHelpers.Count; owned_qa_transports_remaining=$qaHelpers.Count;
  owned_transport_listeners_remaining=$listeners.Count; owned_transport_listeners_closed=$true;
  native_postgres_checkpointed=$true; native_database_files_preserved=$preserved; original_owner_file_absent=$ownerAbsent;
  retained_closed_transport_versions=@('v1','v2'); unrelated_current_listeners_preserved=$unrelated;
  process_id_reuse_checked_by_creation_time=$true; local_virtualization_used=$false; unrelated_user_sessions_not_targeted=$true;
  scope='Read-only collection of both original and resumed owned QA transports after driver finally blocks. Process creation times distinguish recycled IDs after the pause. No process kills, recursive deletion or server/network changes.'
}
$destination = Join-Path $out 'runtime-cleanup-v2.json'
if (Test-Path -LiteralPath $destination) { throw 'Immutable cleanup receipt already exists' }
[IO.File]::WriteAllText($destination, ($receipt | ConvertTo-Json -Depth 8) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
$receipt | ConvertTo-Json -Compress -Depth 8
