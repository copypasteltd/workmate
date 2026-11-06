$ErrorActionPreference = 'Stop'
$round = Get-Content -LiteralPath .data/integrated-200-v4/verification.json -Raw | ConvertFrom-Json
if ($round.state -ne 'passed') { throw 'Finish the unified validation before stopping its native database.' }
$processes = Get-CimInstance Win32_Process
$db = @($processes | Where-Object { $_.ProcessId -eq 12144 -and $_.Name -eq 'postgres.exe' -and $_.ParentProcessId -eq 5152 })
if ($db.Count -eq 1) {
  $runtime = 'C:\Users\carzy\AppData\Local\CopyPaste\native-runtime-aliases\postgres-DEXR7G\runtime'
  $target = Get-Item -LiteralPath $runtime
  if ($target.LinkType -ne 'Junction' -or $target.Target -ne 'D:\dev\copypasted\自有agent\dev\copypaste-platform') { throw 'Native database ownership link changed; preserve it.' }
  $pidFile = Join-Path $runtime '.data\postgres\postmaster.pid'
  if ((Get-Content -LiteralPath $pidFile -TotalCount 1) -ne '12144') { throw 'Native database owner changed; preserve it.' }
  if ($db[0].ExecutablePath -ne (Join-Path $runtime 'node_modules\@embedded-postgres\windows-x64\native\bin\postgres.exe')) { throw 'Native executable ownership changed; preserve it.' }
  & (Join-Path $runtime 'node_modules\@embedded-postgres\windows-x64\native\bin\pg_ctl.exe') stop -D (Join-Path $runtime '.data\postgres') -m fast -w -t 50
  if ($LASTEXITCODE -ne 0) { throw 'Native PostgreSQL did not finish its checkpointing shutdown.' }
  if (Get-Process -Id 12144 -ErrorAction SilentlyContinue) { throw 'Native PostgreSQL owner is still alive.' }
  # PostgreSQL is checkpointed and closed before reclaiming only its known launchers.
  foreach ($owned in @(@{ Id=5152; Parent=3376; Pattern='dist.scripts.db-local.js' },@{ Id=3376; Parent=14576; Pattern='scripts/native-db-launch.mjs' })) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($owned.Id)"
    if ($p) {
      if ($p.Name -ne 'node.exe' -or $p.ParentProcessId -ne $owned.Parent -or $p.CommandLine -notmatch $owned.Pattern) { throw 'Launcher ownership changed; preserved.' }
      Stop-Process -Id $owned.Id
    }
  }
  # Removing this checked junction never removes its target or database files.
  if (Test-Path -LiteralPath $runtime) { [System.IO.Directory]::Delete($runtime) }
  [System.IO.Directory]::Delete((Split-Path -Parent $runtime))
}
$processes = Get-CimInstance Win32_Process
$browsers = @($processes | Where-Object { $_.Name -eq 'chrome.exe' -and $_.ExecutablePath -like '*copypaste-delivery\.data\browsers\chromium-1248\chrome-win64\chrome.exe' })
$desktop = @($processes | Where-Object { $_.Name -eq 'CopyPaste.exe' -and $_.ExecutablePath -like '*copypaste-desktop\.data\deployment-200-v2\release\win-unpacked\CopyPaste.exe' })
$database = @($processes | Where-Object { $_.Name -eq 'node.exe' -and ($_.CommandLine -match 'scripts/native-db-launch.mjs' -or $_.CommandLine -match 'dist.scripts.db-local.js') })
$transports = @($processes | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -match 'company-qa-tunnel-200-v1.py' })
if ($browsers.Count -or $desktop.Count -or $database.Count -or $transports.Count) { throw 'An owned runtime remains; inspect exact ownership and preserve unrelated sessions.' }
$closed = Get-Content -LiteralPath .data/acceptance-200/transport-v1/closed.json -Raw | ConvertFrom-Json
if (-not $closed.listeners_closed) { throw 'Owned transport listener closure is not confirmed.' }
$report = [ordered]@{
 stage=200; status='cleaned'; at=(Get-Date).ToUniversalTime().ToString('o');
 owned_browsers_remaining=$browsers.Count; owned_desktop_instances_remaining=$desktop.Count;
 owned_db_helpers_remaining=$database.Count; owned_qa_transports_remaining=$transports.Count;
 owned_transport_listeners_closed=$true; native_postgres_checkpointed=$true;
 local_virtualization_used=$false; unrelated_user_sessions_not_targeted=$true;
 scope='Round-owned Chromium, final packaged Desktop, exact native PostgreSQL/launchers and owned original-TLS transport are closed. Existing user sessions and server services are preserved.'
}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath .data/deployment-200-v2/final-owned-process-check.sanitized.json -Encoding utf8
$report | ConvertTo-Json -Compress
