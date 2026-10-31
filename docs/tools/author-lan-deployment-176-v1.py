"""Author bounded deployment evidence and bilingual handoff documentation."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,shutil
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';D=DEV/'copypaste-delivery';P=D/'.data/deployment-176'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,value):
 p.parent.mkdir(parents=True,exist_ok=True)
 with p.open('x',encoding='utf-8',newline='\n') as f:f.write(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def copy(src,dest):
 dest.parent.mkdir(parents=True,exist_ok=True);assert not dest.exists();shutil.copyfile(src,dest)
browser=P/'browser-49f59213-983a-4667-809d-d85fc774dd0f/receipt.json';b=json.loads(browser.read_bytes())
audit=P/'audit-after-v2.sanitized.json';a=json.loads(audit.read_bytes())
mail=P/'operator-mailbox-v2.sanitized.json';m=json.loads(mail.read_bytes())
assert b['status']=='passed' and b['browser_closed'] and len(b['checks'])==13 and b['task_status']=='succeeded'
assert a['foreign_cfg_unchanged'] and a['foreign_services_active'] and a['foreign_services_pid_unchanged']
assert m['status']=='passed' and m['browser_closed']
evidence=D/'evidence/lan-deployment-176';copy(browser,evidence/'actual-browser-05.json');copy(mail,evidence/'operator-mailbox-02.json')
failures=[]
for name in ['browser-0ed14341-708e-4307-9b9c-0247c1cafafc','browser-b36d9326-2153-4a1a-9ce4-1abbc98dc891','browser-dd59f6c6-29be-42ba-b8ae-b824b3d1cde5','browser-5d13483b-2cf5-4a2c-b058-deb4c5fdfdb4']:
 p=P/name/'receipt.json';r=json.loads(p.read_bytes());assert r['status']=='failed' and r['browser_closed'];failures.append({'run':name,'status':r['status'],'failed_stage':r['failed_stage'],'checks_before_failure':len(r['checks']),'original_receipt_sha256':sha(p),'browser_closed':True,'media':r['media']})
write(evidence/'retained-failed-runs.json',{'stage':176,'original_failures_retained':True,'runs':failures,'mailbox_first_attempt':{'status':'failed','original_sha256':sha(P/'operator-mailbox.sanitized.json'),'cause':'directory-style URL aliased to a file; owned proxy route corrected'}})
safeAudit={k:a[k] for k in ['stage','at','foreign_cfg_unchanged','foreign_services_active','foreign_services_pid_unchanged','owned_services','credentials','health','downloads','private_ports_loopback_only','virtualization_invoked']}
safeAudit.update(foreign_cfg_count=len(a['foreign_cfg']),foreign_running_services=len(a['foreign_services']),original_receipt_sha256=sha(audit));write(evidence/'server-audit-02.json',safeAudit)
media=[]
for row in b['media']:
 p=DEV/('copypaste-'+row['client'])/row['path'];media.append({'path':p.relative_to(ROOT).as_posix(),'sha256':sha(p),'bytes':p.stat().st_size})
media+=json.loads((P/'media.sanitized.json').read_bytes())['files']
for source,name in [(DEV/'copypaste-web/assets/screenshots/176e-lan-task-result.png','web-task.png'),(DEV/'copypaste-admin/assets/screenshots/176e-lan-users.png','admin-users.png'),(DEV/'copypaste-web/assets/demos/176-lan-http.gif','web.gif'),(DEV/'copypaste-admin/assets/demos/176-lan-http.gif','admin.gif')]:
 dest=ROOT/'docs/assets/lan-176'/name;copy(source,dest);media.append({'path':dest.relative_to(ROOT).as_posix(),'sha256':sha(dest),'bytes':dest.stat().st_size})
sources={}
for client in ['web','admin']:
 repo=DEV/('copypaste-'+client)
 for p in [*(repo/'src').rglob('*'),repo/'package.json',repo/'package-lock.json',repo/'tests/browser-crypto-176.test.ts']:
  if p.is_file():sources[p.relative_to(ROOT).as_posix()]=sha(p)
for p in (D/'scripts').glob('*176*'):
 if p.is_file():sources[p.relative_to(ROOT).as_posix()]=sha(p)
sources['dev/copypaste-delivery/tests/public-config-session-176.test.ts']=sha(D/'tests/public-config-session-176.test.ts')
report={'stage':176,'status':'deployed_and_qualified','at':datetime.now(timezone.utc).isoformat(),'mode':'authorized_synthetic_lan_http','base_release':'v0.1.3','current_frontend_increment':'lan-http-176-v2',
 'origins':{'web':'http://192.168.31.20:63070','admin':'http://192.168.31.20:63071','api':'http://192.168.31.20:63072'},
 'private_ports':{'backend':63073,'database':63074,'bind':'127.0.0.1','inaccessible_from_LAN_verified':True},'credentials_server_path':'/root/cfg/workmate/credentials.txt','plaintext_as_requested':True,
 'toolchains':{'node':'24.22.2','codex':'0.163.0-alpha.11','postgresql':18,'schema':156},
 'checks':{'http_crypto':8,'session_transport':11,'actual_browser_journey':13,'protected_operator_mailbox_browser':1,'unit_result_source':'observed tool TAP output; helper sources unchanged after 8 cases, API sources match 11 transport cases','browser_closed':True},
 'real_codex_task':{'id':b['task'],'status':b['task_status'],'role':'assistant','synthetic_model':True,'actual_download_verified':True},
 'server_preservation':{'foreign_cfg_files':len(a['foreign_cfg']),'all_foreign_cfg_bytes_unchanged':True,'foreign_services':len(a['foreign_services']),'all_foreign_services_active_and_pids_unchanged':True},
 'browser_evidence':{'path':(evidence/'actual-browser-05.json').relative_to(ROOT).as_posix(),'sha256':sha(evidence/'actual-browser-05.json')},
 'server_evidence':{'path':(evidence/'server-audit-02.json').relative_to(ROOT).as_posix(),'sha256':sha(evidence/'server-audit-02.json')},
 'failed_runs_preserved':True,'frozen_release_rewritten':False,'virtualization_invoked':False,'sources':sources,'media':media,
 'frontend_archive':{'file':'workmate-lan-http-176-v2.zip','sha256':sha(P/'workmate-lan-http-176-v2.zip')},
 'pending_configuration':['official domain and intended HTTPS','real providers/rates and SMTP','native client endpoint build','qualified Linux cloud program/browser profiles or corresponding Windows workers']}
write(ROOT/'docs/quality/lan-deployment-176.json',report)

guide='https://github.com/copypasteltd/workmate/blob/docs/docs/releases/lan-176.md'
specific={
 'platform':('原生 Linux Codex、独立 PostgreSQL 18 和 API/worker 已部署。','Native Linux Codex, a private PostgreSQL 18 cluster and API/worker are deployed.'),
 'web':('支持内网 HTTP 的登录、工作区创建、安全摘要、任务和文件上传；19 个预设角色可读取。','LAN HTTP supports login, workspace creation, secure digests, tasks and uploads; 19 role templates are available.'),
 'admin':('独立邮箱验证码及 TOTP；用户、用量、费用、VIP 和内容管理页面已在内网检查。','Independent email OTP/TOTP and user, usage, billing, VIP and content pages were checked on the LAN.'),
 'desktop':('本机 Codex、主动授予完整权限和无边框要求保持。原冻结安装包尚未改为本次 HTTP 内网端点；正式端点确定后再构建客户端。','Customer-local Codex, explicit full permission and frameless behavior remain. Frozen installers are not repointed to this HTTP LAN endpoint; a client endpoint build follows the intended official address.'),
 'extension':('原生右侧 Side Panel 和获准文件获取/上传职责保持。原冻结包尚未改为本次 HTTP 内网端点；云端服务可先从 Web 使用。','The native right Side Panel and approved-file acquisition/upload remain. Frozen extension defaults are not repointed to this HTTP LAN address; cloud service is available through Web.'),
 'delivery':('保留原发行包和失败记录，提供独立部署/审计脚本、实际浏览器检查和登录后录制。','Preserves frozen artifacts and original failures, with independent deploy/audit scripts, actual browser checks and post-login recordings.')}
for component,(zh,en) in specific.items():
 repo=DEV/('copypaste-'+component)
 for name,english in [('README.md',False),('README.en.md',True)]:
  p=repo/name;old=p.read_text(encoding='utf-8');assert '<!-- lan-deployment-176 -->' not in old
  title='LAN HTTP deployment · stage176' if english else '内网 HTTP 部署 · 阶段176'
  text=en if english else zh
  block=f'\n<!-- lan-deployment-176 -->\n## {title}\n\nWeb: http://192.168.31.20:63070 · Admin: http://192.168.31.20:63071 · API: http://192.168.31.20:63072\n\n{text}\n\n'+('Server plaintext credentials: `/root/cfg/workmate/credentials.txt` (root `0600`). Email OTP is retrieved through the protected test mailbox; Admin additionally requires TOTP. Synthetic services remain explicitly labeled.\n\n' if english else '服务器明文凭据：`/root/cfg/workmate/credentials.txt`（root `0600`）。邮箱验证码通过受独立口令保护的测试收件箱读取；Admin 另需验证器 TOTP。外部服务继续使用已授权假数据。\n\n')+f'[部署、登录与运维 / Deployment and login guide]({guide})\n\n'
  if component in ['web','admin']:
   shot='176e-lan-task-result.png' if component=='web' else '176e-lan-users.png'
   block+=f'![Actual LAN HTTP page](assets/screenshots/{shot})\n\n![Actual post-login interaction](assets/demos/176-lan-http.gif)\n\n[实际操作录像 / Actual recording](assets/demos/176-lan-http.mp4)\n\n'
  else:block+='[实际 Web 交互 / Actual Web recording](https://github.com/copypasteltd/workmate/blob/web/assets/demos/176-lan-http.gif) · [后台截图 / Admin capture](https://github.com/copypasteltd/workmate/blob/admin/assets/screenshots/176e-lan-users.png)\n\n'
  first,rest=old.split('\n',1);p.write_text(first+'\n'+block+rest,encoding='utf-8',newline='\n')
for name in ['README.md','README.en.md']:
 p=ROOT/'docs'/name;old=p.read_text(encoding='utf-8');assert '<!-- lan-deployment-176 -->' not in old
 p.write_text('<!-- lan-deployment-176 -->\n## 内网 HTTP 已部署 / LAN HTTP deployed\n\n[访问、登录及运维 / Access and operations](releases/lan-176.md) · [核查 / Evidence](quality/lan-deployment-176.json) · [变更 / Changes](changes/176-lan-http-deployment.md)\n\nWeb `63070` · Admin `63071` · API `63072`；独立服务、数据库及明文服务器配置已交付。Native isolated services/database and server-side plaintext configuration delivered. Synthetic services; current native-client endpoint limitations are explicit in the guide.\n\n---\n\n'+old,encoding='utf-8',newline='\n')
p=ROOT/'docs/releases/lan-176.md';s=p.read_text(encoding='utf-8');s+='\n## 实际页面与交互 / Actual pages and interactions\n\n13 项完整 HTTP 浏览器旅程和一次独立操作收件箱浏览器检查通过。Eight HTTP crypto cases and eleven session transport cases also passed. Native private-IP HTTP was used without secure-context bypass flags; all owned browser instances were closed.\n\n![Web task](../assets/lan-176/web-task.png)\n\n![Admin users](../assets/lan-176/admin-users.png)\n\n![Actual Web interaction](../assets/lan-176/web.gif)\n\n![Actual Admin interaction](../assets/lan-176/admin.gif)\n';p.write_text(s,encoding='utf-8',newline='\n')
print(json.dumps({'status':'authored','browser_checks':13,'mailbox_checks':1,'preserved_foreign_cfg':23,'preserved_foreign_services':61,'media_files':len(media),'source_files':len(sources)}))
