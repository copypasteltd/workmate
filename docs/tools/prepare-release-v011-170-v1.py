"""Freeze the current bounded scope; reuse verified unchanged clients without broad retesting."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import importlib.util
import json
import subprocess

ROOT=Path(__file__).resolve().parents[2]; DEV=ROOT/'dev'; DELIVERY=DEV/'copypaste-delivery'; BASE=DELIVERY/'.data/release-freeze-170'; VERSION='v0.1.1'
COMPONENTS={'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}
spec=importlib.util.spec_from_file_location('prior_freeze',ROOT/'docs/tools/prepare-final-freeze-167-v1.py'); common=importlib.util.module_from_spec(spec); spec.loader.exec_module(common)
digest=common.digest; snapshot=common.snapshot; git=common.git
def create(p,v):
 p.parent.mkdir(parents=True,exist_ok=True)
 with p.open('x',encoding='utf-8',newline='\n') as f:f.write(v if isinstance(v,str) else json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def check_old(b):
 for n,h in b['preserved_user_files'].items():assert digest(ROOT/n)==h
 assert digest(DEV/'copypaste-desktop/.gitattributes')==b['desktop_attributes_sha256']
 for version,v in b['frozen_releases'].items():
  d=DELIVERY/'release'/('workmate-'+version); assert digest(d/'release-manifest.json')==v['manifest_sha256']; assert digest(d/'SHA256SUMS')==v['sums_sha256']; assert Path(v['complete_archive']['path']).stat().st_size==v['complete_archive']['bytes']

BASE.mkdir(parents=True,exist_ok=True)
old=json.loads((DELIVERY/'.data/admin-usage-report-169/baseline.json').read_bytes()); check_old(old)
published=[(p,json.loads(p.read_bytes())) for p in (DELIVERY/'.data/admin-usage-report-169').glob('publication-*/receipt.json')]; published=[(p,v) for p,v in published if v['status']=='published']; assert len(published)==1
branches=[*COMPONENTS,'docs','main']; refs={s.split()[1]:s.split()[0] for s in git(ROOT,'ls-remote','origin',*['refs/heads/'+b for b in branches],'refs/tags/v0.1.*').splitlines()}; assert len(refs)==92
heads={}
for b,c in {**COMPONENTS,'docs':'docs'}.items():
 repo=ROOT if b=='docs' else DEV/('copypaste-'+c); head=git(repo,'rev-parse','HEAD'); assert refs['refs/heads/'+b]==head; assert not git(repo,'diff','HEAD','--name-only'); assert not git(repo,'diff','--cached','--name-only'); heads[c]=head
baseline={'at':datetime.now(timezone.utc).isoformat(),'heads':heads,'remote_refs':refs,'preserved_user_files':old['preserved_user_files'],'desktop_attributes_sha256':old['desktop_attributes_sha256'],'frozen_releases':old['frozen_releases'],'frozen_rc5':old['frozen_releases']['v0.1.0-rc.5']}
create(BASE/'baseline.json',baseline)
prior=json.loads((ROOT/'docs/quality/release-freeze-checkpoint-167.json').read_bytes()); report=json.loads((ROOT/'docs/quality/admin-usage-report-169.json').read_bytes()); q=json.loads((ROOT/report['qualification']['path']).read_bytes())
assert report['status']=='qualified' and report['owned_browser_and_services_closed'] and q['database_tests']==6
for n,h in report['sources'].items():assert digest(DEV/n)==h,n
before=common.sources()
for n,h in prior['qualified_sources'].items():
 if n.startswith(('copypaste-web/','copypaste-extension/','copypaste-desktop/')):assert before[n]==h,'Unchanged client source required: '+n
builds={c:snapshot(DEV/('copypaste-'+c)/'dist') for c in ['platform','web','admin','extension','delivery']}
for c in ['web','extension','delivery']:assert builds[c]==prior['builds'][c],c+' output changed'
desktop_main=snapshot(DEV/'copypaste-desktop/dist'); desktop_renderer=snapshot(DEV/'copypaste-desktop/renderer-dist')
assert desktop_main==prior['desktop_main'] and desktop_renderer==prior['desktop_renderer']
package=Path(prior['package_root'])
for n,h in prior['package_files'].items():assert digest(package/n)==h,n
for n,v in prior['installers'].items():assert digest(Path(v['path']))==v['sha256'],n
assert common.sources()==before
scope='Backend/Admin production builds and six native SQL/API cases inherited from exact unchanged stage169 qualification; six actual Admin UI/CSV journeys passed. Web, Extension, Desktop and Delivery runtime outputs and unchanged client sources match stage167. Verify and reuse the same Windows unpacked/Portable/Setup bytes. No broad historical repeat or production/signing/professional/other-OS acceptance claim.'
checkpoint={'stage':170,'release':VERSION,'schema_version':156,'status':'qualified','at':datetime.now(timezone.utc).isoformat(),'baseline':baseline,'qualified_sources':before,'source_unchanged':True,'build_commands':q['build_commands'],'builds':builds,'desktop_main':desktop_main,'desktop_renderer':desktop_renderer,'package_root':str(package),'package_files':prior['package_files'],'installers':prior['installers'],'windows_distribution':{'mode':'reuse_byte_identical_qualified_unsigned_windows','source_and_outputs_identical_to167':True,'package_files_verified':len(prior['package_files']),'installer_count':2,'prior_checkpoint_sha256':digest(ROOT/'docs/quality/release-freeze-checkpoint-167.json')},'focused_qualification':{'mode':'inherit_exact_current_stage169_results_not_rerun','path':report['qualification']['path'],'sha256':digest(ROOT/report['qualification']['path']),'database_cases':6,'actual_ui_checks':6,'owned_services_closed':True},'scope':scope,'new_full_acceptance_closures':0,'mandatory_full_acceptance_open':88,'virtualization_used':False,'browser_created':False,'verifier_sha256':digest(Path(__file__))}
create(ROOT/'docs/quality/release-freeze-checkpoint-170.json',checkpoint)
guide=(ROOT/'docs/releases/v0.1.0.md').read_text(encoding='utf-8').replace('v0.1.0','v0.1.1').replace('stage167','stage170').replace('checkpoint-167','checkpoint-170').replace('remaining-work-stage167','remaining-work-stage169').replace('001–155','001–156').replace('001-155','001-156').replace('schema155','schema156').replace('release-v010','release-v011').replace('首个冻结交付版 / Initial frozen release','完整冻结更新 / Complete frozen update')
extra='''
本版是在v0.1.0基础上冻结的完整更新包，加入用户运营筛选及多维消耗报表。数据库迁移至156；服务端与Admin使用最新构建。用量页面支持固定快照、付款方／企业／项目／创建期间／能力／来源筛选、原账本与退款明细及同选择CSV。内部供应商实际成本明确未知，不用客户售价代替。

This complete update adds operational user filters and immutable consumption reports to v0.1.0. Use schema156 and matching backend/Admin builds. Reports distinguish confirmed charges, consumption refunds, holds and reconciliation, with payer/project/capability/source filters, original ledger detail and same-snapshot CSV. Actual supplier cost is explicitly unknown.

**冻结检查范围 / Freeze checks**：沿用源码完全一致的阶段169 Backend/Admin构建、6项原生SQL/API和6组实际浏览器／CSV旅程；未改Web/Extension/Desktop/Delivery运行构建逐文件对照阶段167，Windows目录及两种安装包逐文件一致并复用。No broad historical rerun; unchanged clients are verified and reused. The earlier eight-case/eight-journey descriptions below are prior inherited evidence, not fresh checks for this update.

**已知限制 / Known limits**：已授权假数据；Windows未签名；正式提供方／真实供应商成本／按入账期间报表／完整专业业务和跨OS矩阵仍开放。完整源码及全部端交付不等于上述生产资格已验收。Existing frozen v0.1.0 assets/tags remain unchanged.

管理后台报表的时间条件是工作建立期间，显示该批工作截至快照的累计费用，不是费用入账期间；五分钟后需重新建立快照。A report is a work-creation cohort with cumulative accounting, not a posting-date report; refresh after the five-minute expiry.

'''
guide=guide.replace('\n','\n'+extra,1)
create(ROOT/'docs/releases/v0.1.1.md',guide)
create(ROOT/'docs/development/170-release-v011-freeze.md','# v0.1.1 冻结 / Freeze\n\n'+extra+'\n'+scope+'\n\n[冻结记录](../quality/release-freeze-checkpoint-170.json) · [完整原编号台账](../quality/remaining-work-stage169.md)\n')
create(ROOT/'docs/changes/170-release-v011-freeze.md','# v0.1.1 发版 / Release\n\n'+extra+'\n[安装使用](../releases/v0.1.1.md)\n')
for c in COMPONENTS.values():
 for name in ['README.md','README.en.md']:
  p=DEV/('copypaste-'+c)/name; text=p.read_text(encoding='utf-8'); index=text.find('\n')
  block=('## 冻结交付 v0.1.1\n\n完整包统一包含Windows Desktop（本机Codex、无边框）、Web、独立Admin、Chrome右侧Side Panel、Backend、六仓源码和固定runtime。假数据模式，Windows未签名；当前数据库156。\n\n' if name=='README.md' else '## Frozen delivery v0.1.1\n\nThe complete bundle includes local-Codex frameless Windows Desktop, Web, independent Admin, native Chrome Side Panel, backend, six buildable source trees and pinned runtime. Authorized synthetic services, unsigned Windows and schema156.\n\n')
  block+='[完整发行包 / Complete release](https://github.com/copypasteltd/workmate/releases/tag/v0.1.1) · [安装及流程 / Setup and flows](https://github.com/copypasteltd/workmate/blob/v0.1.1/docs/releases/v0.1.1.md)\n\n'
  p.write_text(text[:index+1]+block+text[index+1:],encoding='utf-8',newline='\n')
for path in ['README.md','README.en.md','docs/README.md','docs/README.en.md']:
 p=ROOT/path; text=p.read_text(encoding='utf-8'); block='# 当前冻结交付 / Current frozen delivery · v0.1.1\n\n最新完整包纳入用户运营筛选和消耗报表。Latest complete bundle includes operational filters and consumption reports.\n\n[发行下载 / Download](https://github.com/copypasteltd/workmate/releases/tag/v0.1.1) · [安装 / Setup]('+('releases/v0.1.1.md' if path.startswith('docs/') else 'docs/releases/v0.1.1.md')+')\n\n假数据模式；Windows未签名；数据库156。Authorized synthetic services; unsigned Windows; schema156.\n\n---\n\n'; p.write_text(block+text,encoding='utf-8',newline='\n')
print(json.dumps({'status':'qualified','release':VERSION,'schema':156,'source_files':len(before),'reused_windows_files':len(prior['package_files'])}))
