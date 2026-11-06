$ErrorActionPreference = 'Stop'
$root = Join-Path (Get-Location).Path '.data/acceptance-204'
$original = Get-Content -LiteralPath (Join-Path $root 'transport-v1/receipt.private.json') -Raw | ConvertFrom-Json
$current = Get-Content -LiteralPath (Join-Path $root 'transport-v2/receipt.private.json') -Raw | ConvertFrom-Json
if (Test-Path -LiteralPath (Join-Path $root 'transport-v1/closed.json')) { throw 'Use the original driver receipt when present' }
if (Get-CimInstance Win32_Process -Filter "ProcessId=$($original.owner_pid)") { throw 'Original owner is still alive' }
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)
if ($listeners | Where-Object { $_.OwningProcess -eq $original.owner_pid -or $_.LocalPort -eq ([uri]$original.proxy).Port }) { throw 'Original owned listener is still present' }
if (-not ($listeners | Where-Object { $_.LocalPort -eq 443 -and $_.OwningProcess -eq $current.owner_pid })) { throw 'New isolated QA listener ownership differs' }
$receipt = [ordered]@{
  stage=204; status='closed_observed'; owner_pid=$original.owner_pid; at=[DateTime]::UtcNow.ToString('o');
  listeners_closed=$true; original_owner_absent=$true; driver_finally_receipt_missing=$true;
  original_proxy_listener_absent=$true; tls_port_current_owner=$current.owner_pid;
  scope='Read-only post-shutdown process and listener observation. Original driver did not leave its finally receipt; no graceful-checkpoint claim is made. Its exact owner is absent, its proxy port is closed and TLS443 belongs to the separate new owned QA process. No process or network configuration modification.'
}
$path = Join-Path $root 'transport-v1/closed-observed-v1.json'
if (Test-Path -LiteralPath $path) { throw 'Immutable close observation exists' }
[IO.File]::WriteAllText($path, ($receipt | ConvertTo-Json -Depth 5) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
$receipt | ConvertTo-Json -Compress
