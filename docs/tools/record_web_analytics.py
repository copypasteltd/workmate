"""Record website analytics from immutable backend/native, actual UI and client receipts."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse,json,re,shutil,subprocess
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DELIVERY=DEV/'copypaste-delivery';QUALITY=ROOT/'docs/quality'
CP=QUALITY/'web-analytics-checkpoint.json';BASE=QUALITY/'desktop-geo-checkpoint.json'
COMPONENTS=['platform','web','admin','desktop','extension','delivery']
def read(p):return json.loads(p.read_text('utf-8-sig'))
def digest(p):return sha256(p.read_bytes()).hexdigest()
def ref(p):return {'path':p.relative_to(ROOT).as_posix(),'sha256':digest(p)}
def write(p,v):
 assert not p.exists(),str(p)
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,indent=2,ensure_ascii=False)+'\n',encoding='utf-8',newline='\n')
def checked(p):
 v=read(p);assert v['source_unchanged'],p
 for c in v.get('checks',[]):
  if not isinstance(c,dict) or 'raw_report' not in c:continue
  raw=DELIVERY/c['raw_report']['path'];assert digest(raw)==c['raw_report']['sha256']
  if 'counts' in c:
   actual={k:int(re.findall(r'^# '+k+r' (\d+)\r?$',raw.read_text('utf-8'),re.M)[0]) for k in ['tests','pass','fail','cancelled','skipped','todo']};assert actual==c['counts']
 return v

def record(core,ui,clients):
 paths=[DELIVERY/f'evidence/web-analytics-core-{core}.json',DELIVERY/f'evidence/web-analytics-ui-{ui}.json',DELIVERY/f'evidence/web-analytics-clients-{clients}.json']
 backend,browser,builds=[checked(p) for p in paths]
 for v in [backend,browser,builds]:assert v['status']=='passed' and v['owned_database_shutdown']
 for v in [backend,builds]:assert all(c['exit_code']==0 for c in v['checks'])
 counted={c['name']:c['counts'] for c in backend['checks'] if 'counts' in c};assert set(counted)=={'backend','desktop-unit','native-codex'}
 for c in counted.values():assert c['tests']==c['pass'] and all(c[k]==0 for k in ['fail','cancelled','skipped','todo'])
 assert browser['packaged_unchanged'] and browser['owned_preview_closed']
 jp=DELIVERY/browser['journey']['path'];assert digest(jp)==browser['journey']['sha256'];journey=read(jp)
 assert journey['status']=='passed' and len(journey['checks'])==11 and len(journey['screenshots'])==7
 assert all(journey[k] for k in ['electron_closed','browser_closed','api_closed','fixture_closed'])
 assert journey['model_calls']==0 and len(journey['exports'])==7
 assert len({r['calculation_sha256'] for r in journey['exports'][:6]})==1 and journey['exports'][6]['profile']=='search_performance' and journey['exports'][6]['calculation_sha256']!=journey['exports'][0]['calculation_sha256']
 assert len(journey['recordings'])==2 and all(m['distinct_frames']>1 and m['skipped_capture_errors']==0 for m in journey['recordings'])
 sources={}
 for v in [backend,browser,builds]:
  for n,h in v['source_files'].items():
   assert digest(DEV/n)==h,n
   if 'dev/'+n in sources:assert sources['dev/'+n]==h,n
   sources['dev/'+n]=h
 contract=ROOT/'docs/contracts/web-analytics.openapi.json';mirror=DEV/'copypaste-platform/contracts/web-analytics-schemas.json'
 assert read(mirror)['normative_source_sha256']==digest(contract) and read(mirror)['schemas']==read(contract)['components']['schemas']
 sources[contract.relative_to(ROOT).as_posix()]=digest(contract)
 baseline=read(BASE)
 for n,h in baseline['source_files'].items():
  if n.startswith('dev/copypaste-platform/migrations/'):assert sources[n]==h,n
 for row in journey['screenshots']+[f for m in journey['recordings'] for f in m['files']]:assert digest(DEV/row['path'])==row['sha256']
 progress=read(QUALITY/'requirements-alignment-progress.json');original=read(QUALITY/'history/stage96-before-solution-packages/receipt.json')
 assert progress['requirements']==original['requirements'] and progress['gates']==original['gates']
 assert progress['fully_accepted_requirements']==progress['qualified_live_roles']==0
 attempts=[]
 for pattern in ['web-analytics-core-??.json','web-analytics-focused-??.json','web-analytics-native-??.json','web-analytics-ui-??.json','web-analytics-clients-??.json']:
  for p in sorted((DELIVERY/'evidence').glob(pattern)):
   v=checked(p);attempts.append({**ref(p),'status':v['status'],'error':v.get('error')})
 write(CP,{'at':datetime.now(timezone.utc).isoformat(),'stage':111,'status':'verified_web_analytics',
  'scope':'GA4 traffic/events and Search Console captured-row reports; exact signed revenue, non-additive users, aggregate CTR, weighted positions, scoped authorization/revocation, full downloads and versioned marketing specialist. Actual Web and unsigned packaged Desktop; synthetic accounts and model responses. Affected functionality only.',
  'source_files':dict(sorted(sources.items())),'selected_core':ref(paths[0]),'selected_ui':ref(paths[1]),'client_builds':ref(paths[2]),'counts':counted,'journey':ref(jp),'actual_ui_checks':11,'screenshots':journey['screenshots'],'recordings':journey['recordings'],'exports':journey['exports'],
  'attempts':attempts,'new_migrations':[],'new_routes':['GET /v1/connector-snapshots/:id/web-analysis','GET /v1/tenants/:tenant/projects/:project/connector-snapshots/:id/web-analysis'],
  'retained_stage110':ref(BASE),'retained_stage106':baseline['retained_stage106'],'original_requirements_modified':False,'fully_accepted_requirements':0,'qualified_live_roles':0,'verifier_sha256':digest(Path(__file__))})
 print(json.dumps({'status':'verified_web_analytics','sources':len(sources),'counts':counted}))

def sync():
 cp=read(CP);assert cp['verifier_sha256']==digest(Path(__file__))
 changes=[];copies=[]
 for row in cp['screenshots']+[f for m in cp['recordings'] for f in m['files']]:
  src=DEV/row['path'];client=Path(row['path']).parts[0];dst=ROOT/'docs/design/implementation'/(client+'__'+src.name)
  assert not dst.exists();shutil.copyfile(src,dst);assert digest(dst)==row['sha256'];copies.append({'source':src.relative_to(ROOT).as_posix(),'target':dst.relative_to(ROOT).as_posix(),'sha256':digest(dst)})
 diagram='```mermaid\nflowchart LR\n  Login[Login and project scope] --> Capture[Immutable GA4 or GSC snapshot]\n  Capture --> Verify[Source hash and current authority]\n  Verify --> Metrics[Exact captured-row calculation]\n  Metrics --> Clients[Web and native Desktop report]\n  Metrics --> Skill[Versioned marketing specialist]\n  Metrics --> Files[Complete HTML CSV JSON]\n  Admin[Admin source controls] --> Verify\n```\n'
 details={
 'platform':('The read-only API and marketing-analyst 1.2.0 share source verification and deterministic metrics. Historical 1.1.0 roles retain their original tools. No SQL migration is needed.','唯讀 API 與 marketing-analyst 1.2.0 共用來源核對及確定性指標；舊 1.1.0 工具合約保留，無新增 SQL 遷移。'),
 'web':('Sign in, open Connections, authorize an account, confirm project scope, capture dates, inspect facts and open Website analysis & report. Submit filters before downloading.','登入 → 連接應用 → 授權帳戶並確認項目 → 同步日期 → 檢查數據 → 網站分析與報告。下載依已提交並顯示的範圍。'),
 'desktop':('The same report uses native sign-in and authenticated native save dialogs. The unsigned packaged app remains frameless with no native menu or visible scrollbar rails; the Agent remains local Codex.','報告使用原生登入及授權下載／另存對話框。實際未簽名打包版維持無邊框、無原生菜單與隱藏滾動條；Agent 保持本機 Codex。'),
 'admin':('Existing member, project, quarantine and retention controls also govern derived website reports. Withdrawing a source blocks subsequent reads/downloads and clears open reports at their next recheck.','既有成員、項目、隔離及保留期限控制同樣管理網站報告；撤回來源會封鎖後續讀取／下載，並在重查時清除已開啟結果。'),
 'extension':('The native Chrome right Side Panel keeps cloud conversations and authorized file uploads. The versioned marketing specialist can read permitted website evidence; use the existing company Web entry for the complete report view.','原生 Chrome 右側欄維持雲端對話與獲准檔案上傳。新版營銷角色可讀允許的網站依據，完整報告經既有公司 Web 入口查看。'),
 'delivery':('Frozen qualification scripts preserve failed attempts, hash exact sources, run native PostgreSQL without virtualization, package Desktop and close owned browser/service fixtures.','固定驗證腳本保留失敗記錄、核對確切來源、使用原生 PostgreSQL、打包 Desktop，並清理本次瀏覽器及服務。')}
 for folder in [ROOT/'docs']+[DEV/('copypaste-'+c) for c in COMPONENTS]:
  component=folder.name.removeprefix('copypaste-');client='desktop' if component=='desktop' else 'web'
  first=next(r for r in cp['screenshots'] if r['path'].startswith('copypaste-'+client+'/'))
  movie=next(f for m in cp['recordings'] if m['component']==client for f in m['files'] if f['path'].endswith('.gif'))
  for name in ['README.md','README.en.md']:
   p=folder/name;old=p.read_bytes();title,body=old.split(b'\n',1);en=name.endswith('.en.md')
   text='<!-- website-analytics-stage111 -->\n'
   text+=('Website reports now connect captured GA4 traffic/events and Search Console data to exact metrics and complete HTML/CSV/JSON. Distinct users are never summed across rows, refund revenue can be negative, and missing dates remain unknown. Report calculation adds no AI call or fee.\n\n' if en else '網站報告已接通 GA4 流量／事件及 Search Console：可核對指標、完整 HTML／CSV／JSON。跨行用戶不相加、退款可為負收入、缺少日期保留未知；報告計算不新增 AI 呼叫或費用。\n\n')
   if component in details:text+=details[component][0 if en else 1]+'\n\n'
   text+=f'{cp["counts"]["backend"]["tests"]} backend checks · {cp["counts"]["desktop-unit"]["tests"]} Desktop unit checks · {cp["counts"]["native-codex"]["tests"]} actual native Codex checks · 11 actual client flows. '
   text+=('Synthetic accounts/models; live provider quality, production signing and full-product acceptance remain unproven.\n\n' if en else '使用假帳戶／模型；真實供應商效果、正式簽名與全產品驗收尚未證明。\n\n')
   if folder==ROOT/'docs':
    text+='[方案 / Design](technical/111-web-analytics.md) · [證據 / Evidence](quality/web-analytics-checkpoint.json)\n\n';image='design/implementation/copypaste-'+client+'__'+Path(first['path']).name;gif='design/implementation/copypaste-'+client+'__'+Path(movie['path']).name
   else:
    text+='[方案 / Design](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/111-web-analytics.md) · [證據 / Evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/web-analytics-checkpoint.json)\n\n'
    def media_link(row):
     local=Path(row['path']).relative_to('copypaste-'+client).as_posix();return local if component==client else 'https://raw.githubusercontent.com/copypasteltd/workmate/'+client+'/'+local
    image=media_link(first);gif=media_link(movie)
   text+=diagram+f'\n![Actual website report / 實際網站報告]({image})\n\n![Actual report interaction / 實際報告交互]({gif})\n\n'
   p.write_bytes(title+b'\n\n'+text.encode()+body);changes.append({'path':p.relative_to(ROOT).as_posix(),'before_sha256':sha256(old).hexdigest(),'after_sha256':digest(p)})
 p=QUALITY/'requirements-alignment-progress.json';old=p.read_bytes();progress=read(p)
 progress['website_analytics']={'checkpoint':ref(CP),'counts':cp['counts'],'actual_client_flows':11,'original_requirements_modified':False,'full_acceptance':'not_proven'}
 p.write_text(json.dumps(progress,indent=2,ensure_ascii=False)+'\n',encoding='utf-8',newline='\n');changes.append({'path':p.relative_to(ROOT).as_posix(),'before_sha256':sha256(old).hexdigest(),'after_sha256':digest(p)})
 for en in [False,True]:
  p=ROOT/('docs/changes/2026-10-27-web-analytics'+('.en' if en else '')+'.md');assert not p.exists()
  p.write_text(('# Website and search reports\n\n' if en else '# 網站與搜尋報告\n\n')+('Captured GA4/GSC reports, exact decimal metrics, authenticated complete downloads, source withdrawal and marketing-analyst 1.2.0. Actual Web and unsigned packaged Desktop evidence uses synthetic provider accounts.\n\n' if en else '接通 GA4／GSC 報告、精確十進位指標、授權完整下載、來源撤回及 marketing-analyst 1.2.0。實際 Web 與未簽名打包 Desktop 使用合成供應商帳戶。\n\n')+f'{cp["counts"]["backend"]["tests"]} backend, {cp["counts"]["desktop-unit"]["tests"]} Desktop unit, {cp["counts"]["native-codex"]["tests"]} actual native Codex checks; 11 actual client flows.\n\n'+'Failed attempts and original full acceptance gates remain unchanged. / 保留失敗記錄及原始完整驗收門檻。\n\n[Design / 方案](../technical/111-web-analytics.md) · [Evidence / 證據](../quality/web-analytics-checkpoint.json)\n',encoding='utf-8',newline='\n')
 write(QUALITY/'web-analytics-documentation-refresh.json',{'checkpoint':ref(CP),'changes':changes,'media_copies':copies,'verifier_sha256':digest(Path(__file__))})

def audit():
 from markdown_it import MarkdownIt
 from urllib.parse import urlsplit,unquote
 cp=read(CP);refresh=read(QUALITY/'web-analytics-documentation-refresh.json');assert cp['verifier_sha256']==refresh['verifier_sha256']==digest(Path(__file__))
 for n,h in cp['source_files'].items():assert digest(ROOT/n)==h,n
 for r in refresh['changes']:assert digest(ROOT/r['path'])==r['after_sha256']
 for r in refresh['media_copies']:assert digest(ROOT/r['source'])==digest(ROOT/r['target'])==r['sha256']
 parser=MarkdownIt();links=0
 for folder in [ROOT/'docs']+[DEV/('copypaste-'+c) for c in COMPONENTS]:
  for name in ['README.md','README.en.md']:
   p=folder/name;body=p.read_text('utf-8');assert '<!-- website-analytics-stage111 -->' in body
   for token in parser.parse(body):
    for child in token.children or []:
     value=child.attrGet('src') if child.type=='image' else child.attrGet('href') if child.type=='link_open' else None
     if value and not urlsplit(value).scheme and not value.startswith('#'):assert (p.parent/unquote(urlsplit(value).path)).exists(),(p,value);links+=1
 decoded=[]
 for movie in cp['recordings']:
  for row in movie['files']:
   p=DEV/row['path'];probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames:format=duration','-of','json',str(p)]))
   assert int(probe['streams'][0]['nb_read_frames'])>1 and abs(float(probe['format']['duration'])-movie['seconds'])<=.25
   run=subprocess.run(['ffmpeg','-v','error','-xerror','-err_detect','explode','-i',str(p),'-map','0:v:0','-f','null','-'],capture_output=True,check=True);assert not run.stderr.strip();decoded.append(row)
 original=read(QUALITY/'history/stage96-before-solution-packages/receipt.json');current=read(QUALITY/'requirements-alignment-progress.json');assert current['requirements']==original['requirements'] and current['gates']==original['gates']
 write(QUALITY/'web-analytics-docs-audit-01.json',{'status':'passed','checkpoint':ref(CP),'bilingual_readmes':14,'local_readme_links':links,'decoded_recordings':decoded,'original_matrix_unchanged':True,'verifier_sha256':digest(Path(__file__))})
 print(json.dumps({'status':'passed','readmes':14,'links':links,'decoded':len(decoded)}))
p=argparse.ArgumentParser();p.add_argument('action',choices=['record','sync','audit']);p.add_argument('--core',default='06');p.add_argument('--ui',default='01');p.add_argument('--clients',default='01');a=p.parse_args()
if a.action=='record':record(a.core,a.ui,a.clients)
elif a.action=='sync':sync()
else:audit()
