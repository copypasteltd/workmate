"""Prepare one collected local-QA path correction, preserving failed attempts."""
from pathlib import Path
import ast,json
R=Path(__file__).resolve().parents[2];L=R/'dev/copypaste-delivery';S=L/'scripts'
load=lambda p:json.loads(p.read_text('utf-8-sig'))
assert load(L/'.data/deployment-204-v1/public-stream-v2.sanitized.json')['status']=='failed'
assert len(list((L/'.data/acceptance-204').glob('live-review-*/receipt.json')))==1
assert load(L/'.data/acceptance-204/marketing-correction-v2/receipt.json')['status']=='passed_controlled_functional_samples'
source=(S/'company-qa-tunnel-204-v1.py').read_text('utf-8-sig')
source=source.replace("transport-v1';OUT.mkdir", "transport-v2';OUT.mkdir")
needle='for h,ips in addresses.items():assert h in allowed and ips'
assert source.count(needle)==1
source=source.replace(needle,needle+"\n# QA process only: the ascending first public address stalled in retained\n# read-only probes. Try the other current DNS address first. Original TLS\n# is still passed through and authenticated by the actual company client.\naddresses={h:list(reversed(ips)) for h,ips in addresses.items()}")
needle='  while t.is_active() and not (OUT/\'stop\').exists():\n   readable'
assert source.count(needle)==1
source=source.replace(needle,"  last_activity=time.monotonic()\n  while t.is_active() and not (OUT/'stop').exists():\n   if time.monotonic()-last_activity>35:raise TimeoutError('Idle original-TLS QA channel')\n   readable")
source=source.replace('    channel.sendall(data)\n','    channel.sendall(data);last_activity=time.monotonic()\n').replace('    client.sendall(data)\n','    client.sendall(data);last_activity=time.monotonic()\n')
needle="'server_services_changed':False}"
assert source.count(needle)==1
source=source.replace(needle,"'server_services_changed':False,'request_only_ipv4_order':addresses,'path_scope':'Owned local QA chooses descending current public-DNS IPv4 order after a retained first-address stall; no server DNS, routing, proxy or network modification.'}")
ast.parse(source)
with (S/'company-qa-tunnel-204-v2.py').open('x',encoding='utf-8',newline='\n') as f:f.write(source)
source=(S/'qualify-public-stream-204-v1.mjs').read_text('utf-8-sig').replace("./live-read-only-owner-198-v1.mjs","./live-owner-204-v1.mjs").replace('public-stream-v2','public-stream-v3').replace('public-chunks-v2','public-chunks-v3')
source=source.replace('Original TLS over QA HTTP/1.1;', 'Original TLS over QA HTTP/1.1 and a QA-only current-DNS address order; the failed ascending first-address observation is retained. Normal public DNS failover is not certified;')
with (S/'qualify-public-stream-204-v3.mjs').open('x',encoding='utf-8',newline='\n') as f:f.write(source)
source=(S/'qualify-live-marketing-review-204-v2.mjs').read_text('utf-8-sig').replace("./live-read-only-owner-198-v1.mjs","./live-owner-204-v1.mjs")
source=source.replace('Server protocol/configuration is unchanged.', 'QA-only descending current-DNS address order is used after a retained first-address stall; normal public DNS failover remains unverified. Server protocol/configuration is unchanged.')
with (S/'qualify-live-marketing-review-204-v3.mjs').open('x',encoding='utf-8',newline='\n') as f:f.write(source)
collector=R/'docs/tools/document-integrated-round-204-v1.py';source=collector.read_text('utf-8-sig')
old="live_paths=sorted((L/'.data/acceptance-204').glob('live-review-*/receipt.json'));assert len(live_paths)==1\nlive=load(live_paths[0]);"
new="live_attempts=sorted((L/'.data/acceptance-204').glob('live-review-*/receipt.json'));live_paths=[p for p in live_attempts if load(p)['status']=='passed'];assert len(live_paths)==1\nput('retained-online-path-attempts.json',{'stage':204,'failed_live_journeys':[{'path':p.relative_to(R).as_posix(),'sha256':sha(p),'receipt':load(p)} for p in live_attempts if load(p)['status']!='passed'],'failed_public_download_path':load(L/'.data/deployment-204-v1/public-stream-v2.sanitized.json'),'scope':'Original failed paths remain failed. Subsequent QA uses only a local current-DNS address order plus bounded read-only session fetch; server networking is unchanged. Direct/default public paths and DNS failover remain open.'})\nlive=load(live_paths[0]);"
assert source.count(old)==1;source=source.replace(old,new).replace('public-stream-v2.sanitized.json\');assert inner', 'public-stream-v3.sanitized.json\');assert inner')
old="transport=load(L/'.data/acceptance-204/transport-v1/receipt.private.json');closed=load(L/'.data/acceptance-204/transport-v1/closed.json');assert closed['listeners_closed']"
new="transport=load(L/'.data/acceptance-204/transport-v2/receipt.private.json');closed=load(L/'.data/acceptance-204/transport-v2/closed.json');assert closed['listeners_closed'] and load(L/'.data/acceptance-204/transport-v1/closed.json')['listeners_closed']"
assert source.count(old)==1;source=source.replace(old,new)
source=source.replace("'owned_listeners_closed':True,'server_network_changes'", "'owned_listeners_closed':True,'retained_original_transport_closed':True,'request_only_ipv4_order':transport['request_only_ipv4_order'],'server_network_changes'")
source=source.replace('only owned QA processes select HTTP/1.1.', 'only owned QA processes select HTTP/1.1 and descending current-DNS IPv4 order after the retained first-address stall. Normal public DNS failover is not certified.')
source=source.replace('QA selects HTTP/1.1 only in owned clients;', 'QA selects HTTP/1.1 and current-DNS IPv4 order only in owned clients; original failed public paths remain failed, and normal DNS failover remains unverified;')
collector.write_text(source,encoding='utf-8',newline='\n')
cleanup=S/'collect-runtime-cleanup-204-v1.ps1';source=cleanup.read_text('utf-8-sig')
source=source.replace("$transport = Get-Content (Join-Path $out 'transport-v1/receipt.private.json')", "$transport = Get-Content (Join-Path $out 'transport-v2/receipt.private.json')").replace("$transportClosed = Get-Content (Join-Path $out 'transport-v1/closed.json')", "$transportClosed = Get-Content (Join-Path $out 'transport-v2/closed.json')")
needle="$processes = @(Get-CimInstance Win32_Process)"
extra="$originalTransport = Get-Content (Join-Path $out 'transport-v1/receipt.private.json') -Raw | ConvertFrom-Json\n$originalClosed = Get-Content (Join-Path $out 'transport-v1/closed.json') -Raw | ConvertFrom-Json\nif (-not $originalClosed.listeners_closed -or $originalTransport.owner_pid -ne $originalClosed.owner_pid) { throw 'Original owned transport shutdown is unconfirmed' }\n"
assert source.count(needle)==1;source=source.replace(needle,extra+needle)
source=source.replace("$_.ProcessId -eq $transport.owner_pid -or", "$_.ProcessId -in @($transport.owner_pid,$originalTransport.owner_pid) -or").replace('company-qa-tunnel-204-v1','company-qa-tunnel-204-v[12]')
source=source.replace('$ports = @(([uri]$transport.proxy).Port,55432)', '$ports = @(([uri]$transport.proxy).Port,([uri]$originalTransport.proxy).Port,55432)')
cleanup.write_text(source,encoding='utf-8',newline='\n')
print(json.dumps({'status':'prepared','application_source_changes':False,'server_network_writes':False,'new_paid_tasks':0}))
