"""Finish the central docs README pair after the preserved missing-root-README failure."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,subprocess
ROOT=Path(__file__).resolve().parents[2]
marker='<!-- business-history-stage144 -->\n'
copies=json.loads((ROOT/'docs/quality/business-history-media-copies-144.json').read_bytes())
failure={'at':datetime.now(timezone.utc).isoformat(),'status':'failed','tool':'docs/tools/write_business_history_docs_144_v1.py',
 'source_sha256':sha256((ROOT/'docs/tools/write_business_history_docs_144_v1.py').read_bytes()).hexdigest(),
 'diagnostic':'FileNotFoundError: root README.md does not exist; the authoritative README pair is in docs/.',
 'scope':'Observed writer failure diagnostic; source and already-created guides, media copies and six component README pairs retained. This is not a claim of an original captured stderr file.'}
with (ROOT/'docs/quality/business-history-docs-attempt-144-01.json').open('x',encoding='utf-8',newline='\n') as f:json.dump(failure,f,ensure_ascii=False,indent=2);f.write('\n')
for filename in ['README.md','README.en.md']:
 repo=ROOT/'dev/copypaste-platform'
 before=subprocess.check_output(['git','-c','core.fsmonitor=false','-C',str(repo),'show','HEAD:'+filename]).decode('utf-8').replace('\r\n','\n')
 current=(repo/filename).read_text(encoding='utf-8');assert current.endswith(before)
 block=current[:-len(before)].replace('assets/screenshots/','assets/business-history-144/').replace('https://github.com/copypasteltd/workmate/blob/docs/docs/development/','development/')
 target=ROOT/'docs'/filename;prior=target.read_text(encoding='utf-8');assert marker not in prior
 target.write_text(block+prior,encoding='utf-8',newline='\n')
req=ROOT/'docs/requirements/09-admin-content-history.md';prior=req.read_text(encoding='utf-8');assert marker not in prior
req.write_text(prior+'\n'+marker+'''## 业务资源历史补充 / Business history supplement

| 编号 | 要求 / Requirement |
|---|---|
| HIST-R11 | 统一阅读品牌、团队、项目简报、自动化计划，以及普通画布／视频／矢量／演示稿／批量设计的实际已保存历史；保留原三类入口。Read retained business and all five creative histories alongside the original readers. |
| HIST-R12 | 普通画布后续保存形成不可变历史；已有数据只保留迁移时当前版，未知历史与操作者不得编造。Retain future canvas saves; preserve only existing migration snapshots and never invent missing history or actors. |
| HIST-R13 | 批量设计按作品及版号区分；新客户品牌保存记录真实操作者；来源撤回、权限和删除同样约束正文。Keep distinct work/version identities, actual actors for new brand saves and current withdrawal/permission/erasure constraints. |

[实现与验证 / Implementation and validation](../development/144-admin-business-content-history.md)。这是既有完整内容治理要求的补充，原完整验收不缩减。This elaborates existing full content governance without narrowing its acceptance scope.
''',encoding='utf-8',newline='\n')
gov=ROOT/'docs/governance/04-git-branches-and-publication.md';prior=gov.read_text(encoding='utf-8');assert marker not in prior
gov.write_text(marker+'阶段144通过 `prepare_business_history_publication_144_v1.py`、`audit_business_history_publication_144_v1.py` 与 `publish_business_history_publication_144_v1.py --push` 绑定后台业务历史的确切来源、52项相关后端、9项实际页面、原失败及真实媒体，再普通原子更新八引用并读取远端SHA。保留全部401159条历史证明身份；本轮只核查新增历史对象和当前路径／README链接，不改称重跑旧完整历史。用户文件、Desktop根属性与原完整验收保持。\n\nStage144 binds exact business-history sources,52 related backend cases,9 actual Admin journeys and original failures/media before an ordinary atomic eight-ref push and SHA readback. All401159 historical proof identities retain their original scope. User-owned files, Desktop attributes and whole acceptance scopes stay preserved.\n\n'+prior,encoding='utf-8',newline='\n')
print(json.dumps({'status':'written','bilingual_readme_pairs':7,'media_copies':len(copies),'preserved_requirement_identities':102}))
