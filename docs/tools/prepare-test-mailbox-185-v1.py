"""Bind the small static inbox repair to regression, live delivery and redacted media."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,shutil

ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';D=DEV/'copypaste-delivery';P=D/'.data/deployment-185'
def digest(p):return sha256(p.read_bytes()).hexdigest()
native=json.loads((P/'native-mailbox-v1.sanitized.json').read_bytes())
assert native['status']=='passed' and len(native['checks'])==7 and native['browser_closed'] and native['server_closed']
runs=[json.loads(p.read_bytes()) for p in sorted(P.glob('live-*/receipt.json'))]
final=next(r for r in runs if r['status']=='passed')
assert len(final['checks'])==6 and final['browser_closed'] and final['fresh_delivery']['automatically_visible']
runtime=json.loads((P/'operator-mailbox-185-deployment.sanitized.json').read_bytes())
assert runtime['status']=='mailbox_ui_deployed' and runtime['prior_latest_rank']==31 and runtime['before_latest_hidden']
assert all(runtime[k] for k in ['credentials_and_auth_unchanged','nginx_configuration_unchanged','owned_service_pids_unchanged'])
source=D/'deploy/operator-mailbox/index.html'
assert digest(source)==runtime['source_sha256']==final['source_sha256']
media=json.loads((P/'media-v1.sanitized.json').read_bytes())['files']
for row in media:assert digest(ROOT/row['path'])==row['sha256']

proof=ROOT/'docs/quality/test-mailbox-185';proof.mkdir(exist_ok=False)
for name in ['native-mailbox-v1.sanitized.json','operator-mailbox-before-v1.sanitized.json','operator-mailbox-before-v2.sanitized.json','email-delivery-185-challenges-v2.sanitized.json']:
 shutil.copyfile(P/name,proof/name)
safe_runtime={k:v for k,v in runtime.items() if k!='protected_configuration_hashes'}
(proof/'deployment.json').write_text(json.dumps(safe_runtime,indent=2)+'\n',encoding='utf8',newline='\n')
for r in runs:
 name=('final-public-browser' if r['status']=='passed' else 'attempt-'+Path(r['run']).name)+'.json'
 safe={k:v for k,v in r.items() if k not in ['run','video']}
 (proof/name).write_text(json.dumps(safe,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')

marker='<!-- test-mailbox-185 -->'
guide='https://github.com/copypasteltd/workmate/blob/docs/docs/development/185-test-mailbox.md'
raw='https://raw.githubusercontent.com/copypasteltd/workmate/delivery/'
zh=f'''{marker}

## 测试收件箱验证码修复 · 阶段185

已修复跨星期日期排序与30封限制共同隐藏新验证码的问题。打开[测试收件箱](https://agent-dashboard.copypaste.hk/ops/mailbox/)，使用既有独立收件箱凭证；新邮件置顶，每5秒自动检查，也可手动刷新。过期验证码须重新申请，后台继续要求既有 TOTP。

7项相关回归和6项最终公网检查通过；新验证码约3秒自动出现，并实际完成后台登录。此轮更新静态收件箱页面，保留测试投递模式、既有凭证及服务配置。

```mermaid
flowchart LR
 A[要求验证码] --> B[本地邮件文件]
 B --> C[独立认证收件箱]
 C --> D[按时间排序后取最新30封]
 D --> E[自动显示新验证码]
 E --> F[验证码与TOTP登录]
```

[使用、实现、回滚与验证]({guide})

![实际收件箱，敏感内容已遮蔽]({raw}assets/screenshots/185-test-mailbox-fresh.png)

![实际刷新交互，敏感内容已遮蔽]({raw}assets/demos/185-test-mailbox.gif)

'''
en=f'''{marker}

## Test inbox OTP repair · stage185

New codes were hidden by lexical weekday ordering followed by a30-message cap. Open the [test inbox](https://agent-dashboard.copypaste.hk/ops/mailbox/) with its existing independent operator credentials. Mail now sorts newest first and checks automatically every5 seconds; manual refresh remains available. Request a fresh code if the old one expired. Administrator sign-in still requires the existing TOTP.

Seven focused regression checks and six final public checks passed. A fresh real OTP appeared automatically in about3 seconds and completed actual administrator sign-in. This static-page update retains test delivery, existing credentials and service configuration.

```mermaid
flowchart LR
 A[Request code] --> B[Local message file]
 B --> C[Protected test inbox]
 C --> D[Parse time, then select latest30]
 D --> E[Automatic newest-code display]
 E --> F[OTP and TOTP sign-in]
```

[Usage, implementation, rollback and evidence]({guide})

![Actual inbox with sensitive content hidden]({raw}assets/screenshots/185-test-mailbox-fresh.png)

![Actual refresh recording with sensitive content hidden]({raw}assets/demos/185-test-mailbox.gif)

'''
for component in ['delivery','admin']:
 for name,prefix in [('README.md',zh),('README.en.md',en)]:
  p=DEV/('copypaste-'+component)/name;old=p.read_bytes();assert marker.encode() not in old;p.write_bytes(prefix.encode()+old)
for name,text in [('README.md','测试收件箱已修复跨星期排序导致新验证码被隐藏的问题；支持自动刷新，已用新验证码和TOTP实际登录。'),('README.en.md','The test inbox now sorts real dates correctly and refreshes automatically. Fresh public OTP delivery and actual OTP/TOTP administrator sign-in are verified.')]:
 p=ROOT/'docs'/name;old=p.read_bytes();assert marker.encode() not in old
 prefix=f'{marker}\n\n{text}\n\n[需求 / Requirements](requirements/185-test-mailbox.md) · [开发与使用 / Implementation](development/185-test-mailbox.md) · [变更 / Changes](changes/185-test-mailbox.md) · [证据 / Evidence](quality/test-mailbox-185.json)\n\n'
 p.write_bytes(prefix.encode()+old)

names={b:[] for b in ['backend','web','admin','desktop','extension','delivery','docs']}
names['admin']=['README.md','README.en.md']
names['delivery']=sorted(['README.md','README.en.md','deploy/operator-mailbox/index.html',*(p.relative_to(D).as_posix() for p in (D/'scripts').glob('*185*')),*(row['path'].removeprefix('dev/copypaste-delivery/') for row in media if row['path'].startswith('dev/copypaste-delivery/'))])
names['docs']=sorted(['docs/README.md','docs/README.en.md','docs/requirements/185-test-mailbox.md','docs/development/185-test-mailbox.md','docs/changes/185-test-mailbox.md','docs/tools/prepare-test-mailbox-185-v1.py','docs/tools/publish-test-mailbox-185-v1.py','docs/quality/test-mailbox-185.json',*(p.relative_to(ROOT).as_posix() for p in proof.iterdir()),*(row['path'] for row in media if row['path'].startswith('docs/'))])
sources={}
for branch,component in [('admin','admin'),('delivery','delivery'),('docs',None)]:
 repo=ROOT if component is None else DEV/('copypaste-'+component)
 for name in names[branch]:
  if name=='docs/quality/test-mailbox-185.json':continue
  p=repo/name;sources[p.relative_to(ROOT).as_posix()]=digest(p)
report={'stage':185,'status':'deployed_and_qualified','at':datetime.now(timezone.utc).isoformat(),
 'scope':'Static protected test-inbox rendering and actual OTP/TOTP administrator sign-in; no claim of SMTP delivery or unrelated product acceptance.',
 'root_cause':'Lexical RFC weekday sorting placed both Monday OTP messages behind30 older Sunday messages before slicing.',
 'prior_message_count':32,'prior_new_code_ranks':[31,32],'native_checks':7,'actual_final_public_checks':6,
 'fresh_public_delivery_ms':final['fresh_delivery']['elapsed_ms'],'actual_administrator_sign_in':True,'qa_session_signed_out':True,
 'test_mailbox_retained':True,'schema_unchanged':161,'service_restart_required':False,
 'attempts_preserved':['Initial challenge-file regex was overescaped; corrected inspection confirms12 matching files.','Initial public route timed out; LAN and final pinned public HTTPS checks completed.','Initial cache assertion ignored an added no-cache token; initial source assertion ignored a known Cloudflare beacon.','Initial live scaffold omitted locale setup and its early redaction hook did not attach; original media stays private and is excluded from publication. Final media uses a verified pre-paint redaction hook and screenshot masks.'],
 'browser_closed':True,'ssh_closed':True,'local_virtualization_used':False,'sources':sources,'media':media}
with (ROOT/'docs/quality/test-mailbox-185.json').open('x',encoding='utf8',newline='\n') as f:f.write(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
with (P/'publication-paths.json').open('x',encoding='utf8',newline='\n') as f:f.write(json.dumps(names,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':report['status'],'sources':len(sources),'publication_files':{k:len(v) for k,v in names.items()}}))
