"""Document the deployed update without passing an unmet public-download gate.

The original strict collector/finalizer remain unexecuted and unchanged. This
version validates truthful partial publication; four complete public files are
still required, and their failed gate is carried into documentation and Git.
"""
from pathlib import Path
import ast,json
R=Path(__file__).resolve().parents[2];T=R/'docs/tools';L=R/'dev/copypaste-delivery'
load=lambda p:json.loads(p.read_text('utf-8-sig'))
assert load(L/'.data/deployment-204-v1/public-host-v2.sanitized.json')['status']=='partial'
assert load(L/'.data/deployment-204-v1/public-download-v5.sanitized.json')['status']=='partial'
plans={}
p=T/'document-integrated-round-204-v1.py';s=p.read_text('utf-8-sig')
start=s.index("inner=load(L/'.data/deployment-204-v1/inner-downloads-v2.sanitized.json')")
end=s.index("put('packaging.json'",start)
new="""inner=load(L/'.data/deployment-204-v1/inner-downloads-v2.sanitized.json');assert inner['status']=='passed'
catalog=load(D/'copypaste-web/contracts/product-downloads.json')
expected=load(L/'.data/deployment-204-v1/package-receipt.private.json')['public_files']
sources=['public-stream-v3.sanitized.json','public-stream-v4.sanitized.json','public-download-v5.sanitized.json','public-host-v2.sanitized.json']
attempts=[{'source':name,'sha256':sha(L/'.data/deployment-204-v1'/name),'receipt':load(L/'.data/deployment-204-v1'/name)} for name in sources]
qualified=[]
for item in expected:
 matches=[{'source':a['source'],'source_sha256':a['sha256'],**row} for a in attempts for row in a['receipt'].get('downloads',[]) if row['name']==item['name'] and row['status']=='complete_verified' and row['bytes']==item['bytes'] and row.get('sha256')==item['sha256'] and row['url']=='https://agent.copypaste.hk/downloads/releases/20401/'+item['name']]
 if matches:qualified.append(matches[-1])
public_full=len(qualified)==len(expected)==4
health=load(L/'.data/deployment-204-v1/public-stream-v4.sanitized.json')['health'];assert len(health)==3 and all(h['status']=='passed' for h in health)
missing=[row['name'] for row in expected if not any(q['name']==row['name'] for q in qualified)]
pub={'stage':204,'status':'passed' if public_full else 'partial','health':health,'downloads':qualified,'full_public_download_gate':public_full,'expected_files':4,'qualified_complete_files':len(qualified),'missing_complete_files':missing,'scope':'Per-file exact full public content evidence only. Original whole attempts retain their actual failed/partial state. Two observed public files do not qualify the two large installers. Server-initiated curl is distinct from the developer browser; explicitly ended browser observations are not called server failures.'}
put('inner-downloads.json',inner)
put('public-downloads.json',{'stage':204,'status':pub['status'],'catalog':catalog,'public':pub,'inner':inner,'full_public_download_gate':public_full,'attempts':attempts,'scope':'All four innerHTTP200 files have exact full size/SHA. Only actually complete matching public files qualify individually; the four-file public gate stays false while any installer is missing. Original verified TLS, QA-only HTTP/1.1/current-DNS address selection and all failed/partial observations remain explicit. No server network/protocol changes; normal egress, installation and full product acceptance remain open.'})
put('open-public-download-gate.json',{'stage':204,'status':'passed' if public_full else 'not_passed','required_complete_files':4,'qualified_complete_files':len(qualified),'missing_complete_files':missing,'full_public_download_gate':public_full,'full_original_goal_accepted':False,'browser_v5_operator_ended':True,'browser_v5_note':'The ordinary browser observer was deliberately ended while the portable file was still making progress; its final Target-closed errors do not prove a server failure. The checksum link was inside a closed release-details element that this QA driver did not expand. Actual checksum bytes were qualified separately; this mistaken hidden-link click is not reported as an application defect.','strict_v1_tools':'Original strict complete-public-download collector/finalizer not executed because the prerequisite is known false. This document-consistency version preserves that gate as not passed; Git synchronization does not close it.','required_next_evidence':'Actual complete bytes and matching whole-file SHA for each missing public installer. No server network configuration change is authorized.'})
public_note='完整内网200与各已完整公网文件有精确字节／SHA证据。'+('四份公网文件已分别取得完整证据；正常出口、安装和生产验收仍开放。' if public_full else '公网大安装包仅有部分传输证据，四文件完整下载检查未通过；不能声明完整公网下载验收。')
"""
s=s[:start]+new+s[end:]
s=s.replace("put('retained-online-path-attempts.json',", "put('retained-online-path-attempts.json',",1)
s=s.replace("'failed_public_download_path':load(L/'.data/deployment-204-v1/public-stream-v2.sanitized.json'),", "'failed_public_download_path':load(L/'.data/deployment-204-v1/public-stream-v2.sanitized.json'),'ordinary_browser_v5':load(L/'.data/deployment-204-v1/public-download-v5.sanitized.json'),'host_curl_v2':load(L/'.data/deployment-204-v1/public-host-v2.sanitized.json'),'host_curl_v1_compatibility_failure':'Python3.10 has no hashlib.file_digest; original failed probe remains preserved. v2 uses a compatible streamed hash; it still failed complete public-content qualification.',")
s=s.replace("'15':'新Setup／Portable0.7.17及原Extension0.5.7完整内网200／公网原TLS浏览器完整文件哈希验证；不是安装／升级矩阵。'", "'15':'新Setup／Portable0.7.17及原Extension0.5.7。'+public_note+'不是安装／升级矩阵。'")
s=s.replace('完整内网200与公网原TLS浏览器完整下载字节／SHA一致；安装升级／灾备演练仍开放。', '{public_note}安装升级／灾备演练仍开放。')
s=s.replace('[不可变20401下载](public-downloads.json)。', '[不可变20401下载与未通过项](public-downloads.json)、[完整公网下载检查](open-public-download-gate.json)。')
s=s.replace('actual deployed clients and complete download bytes have qualified evidence.', 'actual deployed clients and all complete inner download bytes have qualified evidence. Incomplete public installer transfer remains an explicit unmet gate; Git synchronization does not pass it.')
s=s.replace("'server_network_changes':False}))", "'server_network_changes':False,'full_public_download_gate':public_full}))")
plans[T/'document-integrated-round-204-v2.py']=s

s=(T/'finalize-integrated-round-204-v1.py').read_text('utf-8-sig')
s=s.replace("'controlled-tool-feedback-ui','public-downloads','inner-downloads'", "'controlled-tool-feedback-ui','inner-downloads'")
old="assert len(downloads['public']['downloads'])==len(downloads['inner']['downloads'])==4\nassert all(row['status']=='complete_verified' and '/releases/20401/' in row['url'] for row in downloads['public']['downloads'])"
new="""assert len(downloads['inner']['downloads'])==4
public_full=downloads['full_public_download_gate'];public=downloads['public'];gate=load(Q/'open-public-download-gate.json')
assert public_full==public['full_public_download_gate']==gate['full_public_download_gate']
assert downloads['status']==('passed' if public_full else 'partial')
assert gate['status']==('passed' if public_full else 'not_passed') and gate['required_complete_files']==4
assert len(public['downloads'])==public['qualified_complete_files']==gate['qualified_complete_files']
assert len(public['missing_complete_files'])==4-len(public['downloads']) and public['missing_complete_files']==gate['missing_complete_files']
assert public_full==(len(public['downloads'])==4) and gate['full_original_goal_accepted'] is False
assert all(row['status']=='complete_verified' and '/releases/20401/' in row['url'] for row in public['downloads'])
assert all(a['receipt']['status'] in ['partial','failed','passed'] for a in downloads['attempts'])"""
assert s.count(old)==1;s=s.replace(old,new)
needle="report={'stage':204,'status':'passed','scope':"
replacement="report={'stage':204,'status':'passed' if public_full else 'documented_with_open_checks','documentation_consistency_checks_passed':True,'full_public_download_gate':public_full,'full_original_goal_accepted':False,'current_round_open_checks':[] if public_full else ['PUBLIC_COMPLETE_FILES'],'scope':"
assert s.count(needle)==1;s=s.replace(needle,replacement)
s=s.replace('full download bytes, network/credential', 'complete inner download bytes and explicitly incomplete public installer evidence, network/credential')
s=s.replace("print(json.dumps({'status':'passed','readmes':12", "print(json.dumps({'status':report['status'],'full_public_download_gate':public_full,'readmes':12")
plans[T/'finalize-integrated-round-204-v2.py']=s

s=(T/'update-integrated-readmes-204-v1.py').read_text('utf-8-sig')
needle="total=load(Q/'test-summary.json')['total_qualified_cases']"
assert s.count(needle)==1;s=s.replace(needle,needle+"\npublic_full=load(Q/'public-downloads.json')['full_public_download_gate']")
needle="  text+=('Original102 requirements/32 groups,"
assert s.count(needle)==1
s=s.replace(needle,"  if not public_full:text+=('All four inner files passed full byte/SHA checks. Public installer transfers remain incomplete; the complete public-download gate has NOT passed. This release update and Git synchronization do not close that check. ' if english else '四份内网文件完整字节／SHA通过。公网大安装包仅有部分传输证据，完整公网下载检查未通过；本次应用更新与Git同步不代表关闭该项。')\n"+needle)
plans[T/'update-integrated-readmes-204-v2.py']=s

s=(T/'publish-integrated-round-204-v1.py').read_text('utf-8-sig')
s=s.replace("'verification.json','documentation-check.json','live-production-journey.json'", "'verification.json','live-production-journey.json'")
s=s.replace("'controlled-tool-feedback-ui.json','public-downloads.json','inner-downloads.json'", "'controlled-tool-feedback-ui.json','inner-downloads.json'")
needle="assert load(Q/'deployment.json')['status']=='deployed'"
assert s.count(needle)==1
s=s.replace(needle,needle+"\ndoc=load(Q/'documentation-check.json');pub=load(Q/'public-downloads.json');gate=load(Q/'open-public-download-gate.json')\nassert doc['documentation_consistency_checks_passed'] and doc['full_original_goal_accepted'] is False\nassert doc['full_public_download_gate']==pub['full_public_download_gate']==gate['full_public_download_gate']\nassert doc['status']==('passed' if pub['full_public_download_gate'] else 'documented_with_open_checks')\nassert pub['status']==('passed' if pub['full_public_download_gate'] else 'partial')\nassert gate['status']==('passed' if pub['full_public_download_gate'] else 'not_passed')")
needle="report={'stage':204,'status':'reviewing',"
assert s.count(needle)==1;s=s.replace(needle,"report={'stage':204,'status':'reviewing','publication_scope':'Deployed application update and truthful progress documents; not full product or public-download acceptance','full_public_download_gate':pub['full_public_download_gate'],'full_original_goal_accepted':False,")
plans[T/'publish-integrated-round-204-v2.py']=s

for p,s in plans.items():
 ast.parse(s);assert not p.exists(),p.name
for p,s in plans.items():
 with p.open('x',encoding='utf-8',newline='\n') as f:f.write(s)
print(json.dumps({'status':'prepared','tools':len(plans),'full_download_requirement_unchanged':4,'unmet_gate_will_stay_false':True,'original_strict_tools_preserved':True}))
