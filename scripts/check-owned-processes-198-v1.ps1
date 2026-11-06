$ErrorActionPreference='Stop'
$taskDelivery='D:\dev\copypasted\自有agent\dev\copypaste-delivery'
$taskProcesses=@(Get-CimInstance Win32_Process)
$taskBrowsers=@($taskProcesses | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like ('*'+$taskDelivery+'\.data\browsers*') })
$taskDesktop=@($taskProcesses | Where-Object { $_.Name -eq 'CopyPaste.exe' -and $_.CommandLine -like '*deployment-198*' })
$taskDatabase=@($taskProcesses | Where-Object { ($_.ProcessId -in @(33040,31092,5836)) -and ($_.CommandLine -match 'native-db-launch\.mjs|postgres-Aj3Gvs') })
if($taskBrowsers.Count -or $taskDesktop.Count -or $taskDatabase.Count){throw 'Owned test processes still active; inspect these only'}
$taskReport=[ordered]@{stage=198;status='closed';at=(Get-Date).ToUniversalTime().ToString('o');owned_browsers_remaining=$taskBrowsers.Count;owned_desktop_instances_remaining=$taskDesktop.Count;owned_db_helpers_remaining=$taskDatabase.Count;other_user_processes='preserved';virtualization='not used'}
$taskReport | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskDelivery '.data\deployment-198-v2\final-owned-process-check.sanitized.json') -Encoding utf8
$taskReport | ConvertTo-Json
