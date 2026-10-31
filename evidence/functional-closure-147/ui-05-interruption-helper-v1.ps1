$ErrorActionPreference='Stop'
$taskRoot='D:\dev\copypasted\自有agent\dev\copypaste-delivery'
Set-Location -LiteralPath $taskRoot
$taskProcess=Get-CimInstance Win32_Process -Filter 'ProcessId=15812'
if(-not $taskProcess -or $taskProcess.ParentProcessId -ne 25224 -or $taskProcess.Name -ne 'node.exe' -or $taskProcess.CommandLine -notlike '*qa-functional-closure-147-v5.ts*'){throw 'Owned UI05 identity changed'}
$allProcesses=Get-CimInstance Win32_Process
$ids=[Collections.Generic.HashSet[int]]::new();[void]$ids.Add(15812)
do{$count=$ids.Count;foreach($p in $allProcesses){if($ids.Contains([int]$p.ParentProcessId)){[void]$ids.Add([int]$p.ProcessId)}}}while($count -ne $ids.Count)
$media=@()
foreach($client in @('web','desktop','extension')){
  foreach($file in Get-ChildItem -LiteralPath ('../copypaste-'+$client+'/assets/screenshots') -File | Where-Object Name -like '*functional-closure-147-05*'){
    $media+=@{path=('copypaste-'+$client+'/assets/screenshots/'+$file.Name);sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant();bytes=$file.Length}
  }
}
$record=@{at=[DateTime]::UtcNow.ToString('o');status='interrupted_failed_attempt';reason='Observed UI05 workflow running with no child after one SKIP LOCKED dispatcher tick; original assertion failure was followed by unbounded screenshot cleanup. Preserve source and raw output; new verifier waits for actual asynchronous child creation and bounds screenshot cleanup.';owned_qa_pid=15812;owned_qualifier_pid=25224;owned_descendant_pids=@($ids);orphan_media=$media;force_closed_qa_children=$true;postgres_qualifier_cleanup_expected=$true;product_source_mutations=$false}
$record | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath 'evidence/functional-closure-147/ui-05-interruption.json' -Encoding utf8NoBOM -NoNewline
& taskkill.exe /PID 15812 /T /F
if($LASTEXITCODE -ne 0){throw 'Owned QA tree interruption failed'}
