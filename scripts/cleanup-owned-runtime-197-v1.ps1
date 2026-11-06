$ErrorActionPreference = 'Stop'
$taskRoot = 'D:\dev\copypasted\自有agent'
$taskPlatform = Join-Path $taskRoot 'dev\copypaste-platform'
$taskDelivery = Join-Path $taskRoot 'dev\copypaste-delivery'
$taskAlias = 'C:\Users\carzy\AppData\Local\CopyPaste\native-runtime-aliases\postgres-alMKmM\runtime'
$taskData = Join-Path $taskAlias '.data\postgres'
$taskExpectedTarget = (Get-Item -LiteralPath $taskAlias).Target
if ($taskExpectedTarget -ne $taskPlatform) { throw 'Owned native alias changed; existing processes preserved' }
$taskPostgres = Get-CimInstance Win32_Process -Filter 'ProcessId = 24568'
if ($taskPostgres) {
 if ($taskPostgres.ParentProcessId -ne 24456 -or $taskPostgres.CommandLine -notlike ('* -D '+$taskData+' -p 55432')) { throw 'Database ownership changed' }
 $taskStamp = (Get-Content -LiteralPath (Join-Path $taskPlatform '.data\postgres\postmaster.pid') -TotalCount 1)
 if ($taskStamp -ne '24568') { throw 'Database stamp changed' }
 & (Join-Path $taskPlatform 'node_modules\@embedded-postgres\windows-x64\native\bin\pg_ctl.exe') stop -D $taskData -m fast -w -t 30
 if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL graceful stop failed' }
}
if (Get-CimInstance Win32_Process -Filter 'ProcessId = 24568') { throw 'Owned database still running' }
$taskChild = Get-CimInstance Win32_Process -Filter 'ProcessId = 24456'
if ($taskChild) {
 if ($taskChild.ParentProcessId -ne 23644 -or $taskChild.CommandLine -notlike ('*'+$taskAlias+'\dist\scripts\db-local.js')) { throw 'Owned database helper changed' }
 Stop-Process -Id $taskChild.ProcessId
}
$taskLauncher = Get-CimInstance Win32_Process -Filter 'ProcessId = 23644'
if ($taskLauncher) {
 if ($taskLauncher.CommandLine -ne '"D:\Program Files\nodejs\node.exe" scripts/native-db-launch.mjs') { throw 'Owned launcher changed' }
 Stop-Process -Id $taskLauncher.ProcessId
}
$taskBrowsers = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like ('*'+$taskDelivery+'\.data\browsers*') })
$taskDesktop = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'CopyPaste.exe' -and $_.CommandLine -like '*deployment-197*' })
if ($taskBrowsers.Count -or $taskDesktop.Count) { throw 'Owned browser/application still running; inspect individually' }
$taskReceipt = [ordered]@{stage=197;status='cleaned';at=(Get-Date).ToUniversalTime().ToString('o');database='owned PostgreSQL stopped with pg_ctl fast/checkpoint';owned_node_helpers_stopped=$true;owned_browsers_remaining=0;owned_desktop_instances_remaining=0;other_user_processes='preserved';virtualization='not used'}
$taskReceipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskDelivery '.data\deployment-197\runtime-cleanup-v1.sanitized.json') -Encoding utf8
$taskReceipt | ConvertTo-Json
