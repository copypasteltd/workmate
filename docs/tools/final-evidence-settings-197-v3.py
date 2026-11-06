from pathlib import Path
root=Path(__file__).resolve().parents[2];tools=root/'docs/tools'
p=tools/'update-integrated-readmes-197-v2.py';text=p.read_text(encoding='utf8')
text=text.replace('197-v3-task-review','197-v5-task-review').replace('197-v3-desktop-review','197-v4-desktop-review').replace('197-v2-service-readiness','197-v4-service-readiness').replace('workmate-197-v2-service-review','workmate-197-v4-service-review');p.write_text(text,encoding='utf8',newline='\n')
p=tools/'build-integrated-round-197-v2.py';text=p.read_text(encoding='utf8')
text=text.replace('final197-v3 Web review','final197-v5 loaded-record Web review')
text=text.replace("put('packaging.json',", "assert any(v is not None and isinstance(v,int) and v>=0 for v in journeys['desktop-delta-journey']['actual_elapsed_ms'])\nput('release-metadata-failure.json',load(delivery/'.data/deployment-197-v2/release-metadata-failure-v2.json'))\nput('packaging.json',")
text=text.replace("'cause':'Linux host", "'qa_corrections':'Retain the timed-out public GET, the Desktop v1 Web-tab assumption and early Web loading-shell screenshots. Final drivers wait for actual execution rows before duration assertions and media capture.','cause':'Linux host")
text=text.replace("batch=load(delivery/'.data/integrated-197-v2/implementation-batch.json');put", "batch=load(delivery/'.data/integrated-197-v2/implementation-batch.json');assert all(sha(root/r['path'])==r['sha256'] for r in batch['source_files']);put")
p.write_text(text,encoding='utf8',newline='\n')
p=tools/'finalize-integrated-round-197-v1.py';text=p.read_text(encoding='utf8').replace('No TODO/FIXME/HACK/XXX hit in current first-party source.','No TODO/FIXME/HACK/not-implemented production-source marker hit.');p.write_text(text,encoding='utf8',newline='\n')
print('Final report/media gates aligned to actual completed journeys; final source hashes must still match.')
