"""Retain initial real evidence and add final renderer/release correction."""
from pathlib import Path
import json,hashlib,re,shutil
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DEL=DEV/'copypaste-delivery';OUT=ROOT/'docs/quality/integrated-round-198'
def load(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(n,v):(OUT/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
history=OUT/'initial-198-v1';assert history.is_dir()
assert load(history/'verification.json')['total_tests']==555
assert load(history/'real-desktop-journey.json')['desktop_version']=='0.7.9'
# The interruptedv2 report already retained this exact initial archive; never recopy final files over it.
delta=load(DEL/'.data/integrated-198-v4/verification.json');assert delta['state']=='passed'
counts=[]
for c in delta['checks']:
    p=DEL/c['log'];assert sha(p)==c['sha256']
    if c['phase']=='test':
        v={k:sum(map(int,re.findall(r'^# '+k+r' (\d+)\s*$',p.read_text(encoding='utf8'),re.M))) for k in ['tests','pass','fail','skipped','cancelled']}
        assert v['pass']==v['tests']>0 and not any(v[k] for k in ['fail','skipped','cancelled']);counts.append({'component':c['component'],**v})
assert sum(v['pass'] for v in counts)==343
put('post-visual-verification.json',{'stage':198,'scope':'All343 current Web/Desktop tests rerun after the neutral amount-label correction. Initial555 selected tests retain original scope; unaffected product components are not mislabeled as rerun.','result':delta,'counts':counts,'total_tests':343})
for prefix,name in [('desktop-delta','desktop-delta-journey'),('directory','web-directory-journey'),('final-smoke','final-smoke')]:
    records=[(p,load(p)) for p in (DEL/'.data/acceptance-198').glob(prefix+'-*/receipt.json')]
    p,v=max([(p,v) for p,v in records if v['status']=='passed'],key=lambda x:x[1]['finished_at'])
    if prefix=='directory':assert any('recorded usage' in c['name'] for c in v['checks'])
    if prefix=='desktop-delta':assert v['desktop_version']=='0.7.10' and v['unchanged_main_process']
    allowed=['stage','status','scope','at','finished_at','checks','screenshots','recording','recordings','javascript_errors','owned_browser_closed','owned_windows_closed','desktop_version','unchanged_main_process','runtime','runtime_files','app_asar_sha256','original_conversation']
    public={k:v[k] for k in allowed if k in v};public['source']={'receipt':p.relative_to(DEV).as_posix(),'sha256':sha(p)}
    for media in v.get('screenshots',[]):assert sha(DEV/media['path'])==media['sha256']
    for rec in [*v.get('recordings',[]),*([v['recording']] if v.get('recording') else [])]:
        for media in rec.get('files',[]):assert sha(DEV/media['path'])==media['sha256']
    put(name+'.json',public)
host=load(DEL/'.data/deployment-198-v2/host-final-v2.sanitized.json');assert host['deployment']['backend_root'].endswith('integrated-198-v2/backend');assert host['deployment']['credentials_unchanged'] and host['deployment']['database_and_proxy_processes_unchanged'];put('deployment.json',host)
downloads=load(DEL/'.data/deployment-198-v2/public-release-v1.sanitized.json');assert downloads['status']=='passed';assert downloads['catalog']['desktop']['version']=='0.7.10';assert all(r['full']==200 and r['range']==206 and '/19802/' in r['url'] for r in downloads['downloads']);put('public-downloads.json',downloads)
put('packaging.json',load(DEV/'copypaste-desktop/.data/deployment-198-v2/packaging-receipt.json'));put('release-metadata-validation.json',load(DEL/'.data/deployment-198-v2/release-metadata-validation.json'))
first=load(DEL/'.data/deployment-198-v1/package-receipt.private.json');final=load(DEL/'.data/deployment-198-v2/package-receipt.private.json');assert first['extension_entries']==final['extension_entries']
put('extension-payload-equivalence.json',{'stage':198,'scope':'Final ZIP container timestamps differ. All20 original extension entry names, bytes and SHA-256 values equal the actual0.5.7 native Side Panel journey payload.','unchanged_entries':final['extension_entries']})
transport=load(DEL/'.data/deployment-198-v2/browser-transport-diagnostic-v1.sanitized.json');transport['finding']='All four subsequent unauthenticated public GETs returned200, under default and HTTP1 diagnostic browser configurations. This does not establish the exact cause of earlier Chromium navigation failures or resolve long-term network stability.';put('browser-transport-diagnostic.json',transport)
manifest=load(OUT/'implementation-batch.json');manifest['post_visual_correction']={'script':'docs/tools/complete-usage-wording-batch-198-v1.py','scope':'Neutral recorded-usage wording in Web/Desktop and final package versions; backend/Admin/Extension product source unchanged.','verification':'post-visual-verification.json'}
for row in manifest['final_reviewed_source_manifest']:
    path=ROOT/row['path'];actual=sha(path)
    if actual!=row['sha256']:
        assert row['path'] in ['dev/copypaste-web/src/task-directory.tsx','dev/copypaste-desktop/renderer/src/task-directory.tsx','dev/copypaste-web/contracts/product-downloads.json'],row['path']
        row['sha256_before_visual_correction']=row['sha256'];row['sha256']=actual
put('implementation-batch.json',manifest)
retained=load(OUT/'retained-attempts.json');retained['initial_generated_report']='initial-198-v1/README.md';retained['qa_corrections'].append('v3 responsive checks raced concurrent Playwright screenshot viewport restoration and timed out. Final v5 stops recording before resize and explicitly asserts all requested widths. A final visual review corrected misleading Settled labels to Recorded usage without changing accounting. Initial0.7.9 binaries/catalog and all198 immutable downloads remain. Final0.7.10 uses new immutable19802 URLs.')
retained['qa_corrections'].append('The first final0.7.10 delta driver incorrectly expected Web workbench tabs on the Desktop cloud-detail route. The actual recorded page has its existing task summary and Back to tasks link. The corrected driver uses that actual layout. Final Web v5 encountered a Chromium navigation failure; original receipt remains. Subsequent diagnostic GETs pass but the exact earlier network cause remains unestablished.')
known={x['receipt'] for x in retained['journeys']}
for p in (DEL/'.data/acceptance-198').glob('*/receipt.json'):
    v=load(p);rel=p.relative_to(DEV).as_posix()
    if v['status']!='passed' and rel not in known:retained['journeys'].append({'receipt':rel,'sha256':sha(p),'status':v['status'],'error':v.get('error')})
put('retained-attempts.json',retained)
media=[]
for name,files in {'desktop':['198-v3-desktop-directory.png','workmate-198-v3-desktop-directory.gif','workmate-198-v3-desktop-directory.mp4','198-v1-native-execution.png'],'web':['198-v6-task-directory-light.png','198-v6-task-directory-dark.png','workmate-198-v6-work-directory.gif','workmate-198-v6-work-directory.mp4'],'admin':['198-v4-service-readiness.png','workmate-198-v4-service-review.gif','workmate-198-v4-service-review.mp4'],'extension':['198-v1-side-panel.png','workmate-198-v1-side-panel.gif','workmate-198-v1-side-panel.mp4']}.items():
    for namefile in files:
        p=DEV/('copypaste-'+name)/'assets/screenshots'/namefile;assert p.is_file();media.append({'path':p.relative_to(DEV).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)})
put('actual-media.json',{'stage':198,'scope':'Final0.7.10 directory and0.5.6 Web wording; actual0.7.9 native completed execution remains separately qualified. Actual final Admin and unchanged0.5.7 native Side Panel.','files':media,'visual_review':'Actual final screenshots inspected. The weak initial native loading capture and responsive attempts are retained. Full UI/a11y qualification remains open.'})
p=OUT/'README.md';s=p.read_text(encoding='utf8').replace('当前线上为 integrated-198-v1','当前线上为 integrated-198-v2').replace('| Web | 0.5.5 |','| Web | 0.5.6 |').replace('| Desktop | 0.7.9 |','| Desktop | 0.7.10 |').replace('| Delivery | 0.5.4 |','| Delivery | 0.5.5 |')
needle='实际Desktop0.7.9使用发布包';assert needle in s;s=s.replace(needle,'最终视觉复核发现核账中任务的金额也标为“已结算”，已统一改为“已记录用量”，不改写实际账务。修正后Web／Desktop全部343项相关测试再次通过；最终Desktop0.7.10完成真实PKCE与目录审阅，全部主进程JavaScript和原生运行时与下述0.7.9逐字节相同，没有声称再次执行付费任务。见[修正检查](post-visual-verification.json)及[最终桌面包](desktop-delta-journey.json)。\n\n'+needle)
s=s.replace('公开Setup、Portable、Extension ZIP','最终0.7.10公开Setup、Portable、Extension ZIP').replace('原导航超时、早期脚本错误','最终包使用新的不可变19802目录，初次198目录原字节保留。原导航超时、早期脚本错误')
s=s.replace('Actual0.7.9 native Codex execution bills','A final neutral amount-label correction passes343 repeated Web/Desktop checks. Final0.7.10 has byte-identical native code/runtime and fresh PKCE/directory evidence. Actual0.7.9 native Codex execution bills')
p.write_text(s,encoding='utf8')
overlay=load(OUT/'requirements-overlay.json')
for group in overlay['groups']:
    if group['id']=='14':group['round198_update']+=' 最终0.7.10通过全部主进程／原生运行时字节相同和真实PKCE／目录的差异复验，未声称再次付费任务。'
    if group['id']=='30':group['round198_update']+=' 金额统一标为已记录用量，不把核账中零值误称已结算。'
put('requirements-overlay.json',overlay)
p=ROOT/'docs/development/198-task-directory-and-context.md';s=p.read_text(encoding='utf8');s+='\n最终视觉修正：目录的charged_micros表示已记录用量，不可由其推断任务已结算。Web0.5.6／Desktop0.7.10统一采用中性措辞；两端343项相关测试集中复验通过，最终包以19802不可变目录发布，原198目录保留。0.7.10主进程和原生运行时逐字节等同已完成付费闭环的0.7.9，并另有真实PKCE／目录／返回复验。\n';p.write_text(s,encoding='utf8')
print(json.dumps({'status':'final_evidence_generated','initial_tests':555,'post_visual_tests':343,'desktop':'0.7.10','release':'19802'}))
