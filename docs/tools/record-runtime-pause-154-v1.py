# Record the bounded workflow-reader increment; preserve the first frozen release.
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json, re, sys

ROOT=Path(r"D:\dev\copypasted\自有agent"); DEV=ROOT/"dev"
D=DEV/"copypaste-delivery"; E=D/"evidence/runtime-pause-154"
backend_attempt,ui_attempt=sys.argv[1:]
assert all(re.fullmatch(r"\d{2}",a) for a in [backend_attempt,ui_attempt])
def digest(p):
 h=sha256()
 with p.open("rb") as f:
  for b in iter(lambda:f.read(4*1024*1024),b""): h.update(b)
 return h.hexdigest()
def read(p): return json.loads(p.read_bytes())
def put(p,s):
 p.parent.mkdir(parents=True,exist_ok=True)
 with p.open("x",encoding="utf-8",newline="\n") as f: f.write(s)
def ref(p): return {"path":p.relative_to(ROOT).as_posix(),"sha256":digest(p)}
def copy(a,b):
 b.parent.mkdir(parents=True,exist_ok=True)
 with b.open("xb") as f: f.write(a.read_bytes())
 assert digest(a)==digest(b)
 return ref(b)

baseline=read(D/".data/runtime-pause-154/baseline.json")
for name,expected in {**baseline["frozen_files"],**baseline["preserved_user_files"]}.items():
 assert digest(ROOT/name)==expected,name
assert digest(DEV/"copypaste-desktop/.gitattributes")==baseline["desktop_attributes_sha256"]
release=D/"release/workmate-v0.1.0-rc.1"
for item in read(release/"release-manifest.json")["artifacts"]:
 assert digest(release/item["file"])==item["sha256"]
sources={}; reports={}; verified=set()
for name in ["backend-"+backend_attempt,"ui-"+ui_attempt]:
 r=read(E/(name+".json"))
 assert r["status"]=="passed" and r["source_unchanged"] and r["result_exit_code"]==0,name
 assert r["owned_database_shutdown"] and r["owned_database_port_closed"] and r["fixture_cleanup"]["status"]=="passed"
 assert all(c["exit_code"]==0 for c in r["checks"])
 for key in ["source_manifest","raw_report","verifier"]:
  assert digest(D/r[key]["path"])==r[key]["sha256"]
 for file,item in read(D/r["source_manifest"]["path"]).items():
  assert sources.setdefault(file,item["sha256"])==item["sha256"],file
  if file not in verified:
   assert digest(DEV/file)==item["sha256"] and digest(D/item["path"])==item["sha256"],file
   verified.add(file)
 reports[name]=ref(E/(name+".json"))
raw=(E/("backend-"+backend_attempt+".tap")).read_text("utf-8")
for label,n in [("tests",6),("pass",6),("fail",0),("skipped",0)]:
 assert re.search(r"^# "+label+" "+str(n)+r"\s*$",raw,re.M)
j=read(E/("ui-"+ui_attempt+"-journey.json"))
assert j["status"]=="passed" and len(j["checks"])==5 and not j["errors"]
assert all(j[k] for k in ["browser_closed","api_closed","fixture_closed"])
assert len(j["screenshots"])==7 and len(j["recordings"])==2
media=list(j["screenshots"])
for recording in j["recordings"]:
 assert recording["distinct_frames"]>=2 and recording["skipped_capture_errors"]==0
 media.extend(recording["files"])
cover=next(m for m in media if m["path"].endswith("-paused.png"))
gif=next(m for m in media if m["path"].endswith(".gif"))
mp4=next(m for m in media if m["path"].endswith(".mp4"))
copies=[]
for m in media:
 a=DEV/m["path"]; assert digest(a)==m["sha256"]
 copies.append(copy(a,ROOT/"docs/assets/runtime-pause-154"/a.name))
for repo in ["platform","admin","desktop","extension","delivery"]:
 for m in [cover,gif,mp4]:
  copies.append(copy(DEV/m["path"],DEV/("copypaste-"+repo)/"assets/screenshots"/Path(m["path"]).name))
scope="Running cloud pause at measured native completion; exact same task, thread and original budget continuation, result reuse, current original authority, input ordering, settlement and erasure. No whole-product acceptance or new frozen binary."
cp={"at":datetime.now(timezone.utc).isoformat(),"status":"verified_runtime_pause_increment",
 "stage":154,"schema_version":154,"release":"unreleased_after_v0.1.0-rc.1","frozen_release_unchanged":True,
 "baseline":baseline,"backend_cases":6,"actual_journey_groups":5,"screenshots":7,"recordings":2,
 "broad_regression":"deliberately_omitted_by_user","model_mode":"synthetic_no_model_request",
 "new_full_acceptance_closures":0,"source_files":sources,"reports":reports,"media":media,
 "shared_media_copies":copies,"scope":scope,"recorder_sha256":digest(Path(__file__))}
put(ROOT/"docs/quality/runtime-pause-checkpoint-154.json",json.dumps(cp,ensure_ascii=False,indent=2)+"\n")

ledger=read(ROOT/"docs/quality/remaining-work-stage153.json")
ledger.update(schema_version=ledger["schema_version"]+1,current_stage=154,reviewed_at=cp["at"],
 checkpoint="docs/quality/runtime-pause-checkpoint-154.json",previous_review=ref(ROOT/"docs/quality/remaining-work-stage153.json"),new_full_acceptance_closures=0)
ledger["current_increment"]={"stage":154,"scope":scope,"backend_cases":6,"actual_client_journey_groups":5,
 "broad_regression":"deliberately_omitted_by_user","full_acceptance_closed":False,"release":cp["release"]}
for row in ledger["requirements"]:
 if row["id"]=="REQ-009":
  row["implemented_scope"]+="；154运行中安全暂停意图、已计量完成轮次、同任务/线程/预算恢复和补充资料后保持暂停。"
  row["current_audit_remaining"]="运行中暂停的已计量完成轮次边界已实现并有6项定向检查；全部崩溃/断电/旧进程回收、跨登录族/节点及真实Codex进程恢复矩阵仍待完整验收。未知用量与未完成副作用不自动重放。"
 if row["id"]=="REQ-092":
  row["implemented_scope"]+="；154精确管理员权限支持运行中安全暂停和付费检查点恢复，修正后台控制事务的来源范围绑定。"
  row["current_audit_remaining"]="真实MFA后台请求运行中安全暂停已通过；所有工作流/Routine及未知外部动作人工处置的完整运营矩阵仍待验收。"
 if row["id"] in ["REQ-009","REQ-092","REQ-098"]:
  row["current_review_note"]=row.get("current_review_note","")+" 154：6项定向后端、5组真实Web/Admin操作、7张截图、2组GIF/MP4；模型明确为假数据适配器，原完整验收范围继续开放。"
assert len(ledger["requirements"])==102 and ledger["summary"]["required_open"]==88
put(ROOT/"docs/quality/remaining-work-stage154.json",json.dumps(ledger,ensure_ascii=False,indent=2)+"\n")
lines=["# 当前编号待项 / Remaining acceptance —154","","88项表示必需完整验收范围，不能解释为88个未实现模块。按快速发版要求仅运行主闭环定向验证。","","| 编号 | 模块 | 完整验收 | 仍待完成 |","|---|---|---|---|"]
for row in ledger["requirements"]:
 lines.append("| "+" | ".join(str(v).replace("|","\\|").replace("\n"," ") for v in [row["id"],row["module"],row["full_acceptance"],row.get("current_audit_remaining",row["remaining"])])+" |")
put(ROOT/"docs/quality/remaining-work-stage154.md","\n".join(lines)+"\n")
fence=chr(96)*3
diagram=fence+"""mermaid
flowchart TD
 A[Running cloud task] --> B[Customer or scoped admin requests pause]
 B --> C[Block new tools / finish accepted operations]
 C --> D{Completed native turn and all costs known?}
 D -->|No| E[Reconciliation / no automatic replay]
 D -->|Yes| F{Outstanding requested input?}
 F -->|Yes| G[Answer / remain paused]
 F -->|No| H[Immutable measured checkpoint]
 G --> H
 H --> I[Explicit resume / current original identity and sources]
 I --> J[Same task + thread + reservation + fixed versions]
 J --> K[Claim capacity / consume checkpoint once]
 K --> L[Reuse completed results / settle cumulative usage]
"""+fence
requirement="""# 云端任务安全暂停与继续 / Safe cloud pause and resume

这是原REQ-009及后台REQ-092的细化，不增加原始需求数量。本增量在首个冻结版之后，未加入冻结安装包。

| 编号 | 需求约束 / Requirement |
|---|---|
| 1 | 客户或具有精确项目范围的管理员可以对运行中云任务请求暂停；暂停要求不等于即时中断当前轮次。 |
| 2 | 已确认要求后禁止开始新的业务工具；已接受的操作继续完成、落账和登记结果。 |
| 3 | 仅原生模型完成轮次、用量明确且无未知工具/提供方/设备副作用时保存不可变检查点。 |
| 4 | 保留同一任务、线程、固定角色/skill/来源版本和原预算预留，不释放已发生费用。 |
| 5 | 继续时重新核对原用户身份版本、权限、套餐、skill、来源及预算，再领取名额；检查点只消费一次。 |
| 6 | 暂停前已请求补充资料的轮次，回答完成后仍保持暂停，必须明确选择继续。 |
| 7 | 取消按累计明确用量只结算一次；未知费用进入核对，不自动重放。 |
| 8 | 单任务补充输入与暂停检查点合计最多8轮；原预算耗尽不得再执行。 |
| 9 | 永久擦除清除新增执行事实；元数据接口不暴露原生线程、内部路径和其他客户资料。 |
| 10 | Desktop本机Codex控制独立保留；本次桌面修改仅涉及云任务详情。Extension保留原生右侧Side Panel。 |

A running pause records intent. The accepted current turn can continue consuming the original budget until a trustworthy completed boundary. Resume uses the original task/thread and hold after checking the original user's current authority. Outstanding answers do not silently resume a paused task.

[实现 / Implementation](../development/154-runtime-pause.md) · [接口 / API](../contracts/runtime-pause-openapi.json)
"""
put(ROOT/"docs/requirements/20-runtime-pause.md",requirement)
devtext="""# 运行中云任务暂停 / Running cloud-task pause

客户：工作详情 → 暂停工作 → 等待当前轮次计量完成 → 继续工作。Admin：执行列表 → 管理工作 → 安全暂停 → 填写原因。原有精确权限、版本及费用守卫继续生效；管理员不能继承客户已撤销的执行权限。

Users choose Pause task, wait for a measured current turn, then choose Resume task. Scoped admins use Execution → Manage task with a reason. This source increment follows the first frozen release.

"""+diagram+"""

SQL153增加暂停意图和不可变task_pause_checkpoints，兼容既有付费补充资料检查点。SQL154将两类精确字段接入claim_execution_capacity_v89同一资格条件，保留容量、身份、原预算、来源、设备和未知副作用限制；本机执行所有权外层函数不改变。requiredSchemaVersion推进154，升级前按后端既有迁移步骤应用全部前向迁移。已执行的SQL153不改写。

业务工具在开始新操作时检查暂停标记，已接受操作的完成与费用登记不受新增拦截。工具锁之后的任务共享锁使用NOWAIT，与控制路径任务锁冲突时拒绝本次新操作，避免反向锁顺序等待。工具名称、参数与说明保持原指纹，允许原线程继续。

Worker只在completed且usageKnown回执下保存检查点，保存前核对原身份、角色、skill、套餐和固定来源，累计模型/工具费用，拒绝待办设备及未知副作用。原有补充资料检查点优先：如果带暂停要求，最后答案仅置为paused，不派发续跑。显式恢复先验证，再领取执行名额并一次消费检查点，已完成工具结果继续复用，最终累计费用只结算一次。

管理员控制事务原本没有租户范围，控制函数现在临时绑定此任务的精确企业/任务，按原客户进行来源及执行校验，成功后恢复原事务范围。真实管理员仍由请求主体验权和审计记录，不创建客户会话。新GET control-state仅提供状态提示，不能作为执行授权。

The sole new pause boundary is a completed, usage-known native turn. Accepted-operation finalizers retain settlement authority. Original identity/source checks, exact reservation, capacity admission and one-time checkpoint consumption precede continuation. Unknown effects are never automatically replayed.

本轮：6项后端SQL/HTTP/Worker检查、5组真实Web/Admin操作、7张截图、2组GIF/MP4；构建后端、Web、Admin、Desktop主进程类型/云详情渲染及Extension。明确使用假数据模型适配器，未启动真实Codex/模型提供方，未重打包或安装新桌面版本。按快速发版要求省略全平台历史回归、安装包/跨OS、正式广告/媒体提供方和生产负载矩阵。

原始失败保留：backend01夹具发送不支持的conversation_id；backend02发现暂停检查点未接入容量守卫，且撤权返回404与预期断言不符；backend03发现Admin恢复缺少来源事务范围。新版夹具/断言、前向SQL154和精确范围绑定分别修正。独立只读反证未另外发现阻断；静态结论不替代实测修复。

[需求 / Requirements](../requirements/20-runtime-pause.md) · [限定证据 / Evidence](../quality/runtime-pause-checkpoint-154.md) · [完整待项 / Remaining acceptance](../quality/remaining-work-stage154.md)
"""
put(ROOT/"docs/development/154-runtime-pause.md",devtext)
quality="""# 暂停恢复定向验收 / Focused pause qualification —154

6项后端检查、5组实际Web/Admin流程通过，变更端均构建成功。覆盖同任务/线程/预算恢复、完成工具结果复用、取消只结算一次、补充资料后保持暂停、未知用量禁止恢复、原身份撤销后的管理员恢复拒绝、排队暂停及永久擦除。

浏览器覆盖客户邮件OTP、运行中暂停等待、同任务继续、繁中390宽度无横向溢出、精确项目范围Admin的OTP/TOTP和安全暂停。7张截图与2组GIF/MP4来自实际页面，模型输出和完成时机来自假数据适配器，不声称真实模型或本机Codex验收。

所有检查绑定精确保存的源码摘要，检查期间源文件不变。结束后自建浏览器、上下文、API、预览和原生数据库均关闭，夹具回收通过，无Docker/WSL。全平台历史回归、安装包/跨OS和正式提供方矩阵按快速发版要求省略。

首个冻结v0.1.0-rc.1五个ZIP与七个标签原样保留；本增量未加入冻结包。此前GitHub Release附件上传受HTTPS凭据账户403限制，本轮不重复相同失败调用，SSH分支同步单独执行。

All6 focused backend cases and5 actual UI groups passed with exact source receipts. Synthetic model data only. First frozen artifacts remain unchanged; whole-product and cross-OS acceptance stay open.
"""
put(ROOT/"docs/quality/runtime-pause-checkpoint-154.md",quality)
put(ROOT/"docs/changes/154-runtime-pause.md","""# 更新154 / Change154

运行中云任务可以请求安全暂停，并在明确计量的完成轮次后沿用原线程、任务和预算继续。补充资料后仍保持暂停，已完成结果复用，未知费用继续核对。Web、Desktop云任务详情与Extension增加清楚的操作状态，Admin沿用精确权限、MFA与操作原因。

Running cloud work supports safe pause intent and continuation from a measured completed turn. Current original identity, budget, effects and source checks apply. The first frozen release is preserved.

[方案 / Implementation](../development/154-runtime-pause.md) · [证据 / Evidence](../quality/runtime-pause-checkpoint-154.md) · [编号待项 / Ledger](../quality/remaining-work-stage154.md)
""")
contract={"openapi":"3.1.0","info":{"title":"Workmate cloud control-state supplement","version":"154"},"paths":{
 "/v1/tasks/{task_id}/control-state":{"get":{"summary":"Read current pause metadata without native identifiers","parameters":[
 {"name":"task_id","in":"path","required":True,"schema":{"type":"string","format":"uuid"}},
 {"name":"X-Tenant-ID","in":"header","required":True,"schema":{"type":"string","format":"uuid"}}],
 "responses":{str(c):{"description":d} for c,d in [(200,"No-store current task/version/phase/intent/action hints and decimal budget/accrued values"),(401,"Current user session required"),(403,"Current scope denied"),(404,"Task or scope unavailable")]}}}},
 "x-control":"Original canonical/legacy control schemas, idempotency and version rules are unchanged. Metadata hints grant no execution authority.",
 "x-boundary":"completed_measured_model_turn; known native completion, original hold, no pending or unknown effects",
 "x-authority":"Submit rechecks the original user's current identity, permissions, fixed sources, role/skill/plan and remaining budget. Existing scoped admin.execution.pause/resume and audited reason.",
 "x-limits":"Input and pause checkpoints combined <=8. Unknown usage requires reconciliation. Desktop local controls remain independent."}
put(ROOT/"docs/contracts/runtime-pause-openapi.json",json.dumps(contract,ensure_ascii=False,indent=2)+"\n")
for repo in ["platform","web","admin","desktop","extension","delivery"]:
 for filename,english in [("README.md",False),("README.en.md",True)]:
  p=DEV/("copypaste-"+repo)/filename;old=p.read_text("utf-8");assert "<!-- runtime-pause-154 -->" not in old
  intro=("Running cloud work supports safe pause and same-task/thread/budget resume. Task details → Pause task → wait for the measured current turn → Resume task. Answers keep a paused task paused. Unknown effects require reconciliation; cancellation settles known cumulative usage once." if english else
   "运行中云任务支持安全暂停和同任务、线程、预算继续。工作详情 → 暂停工作 → 等待当前轮次计量完成 → 继续工作。补充资料后仍保持暂停；未知副作用继续核对，取消按累计明确用量只结算一次。")
  qualifier="Actual Web capture." if repo=="web" else "Media below show actual Web controls; this is not native UI acceptance for this component."
  if repo=="admin":qualifier+=" Actual scoped Admin OTP/TOTP and safe pause captures are retained in assets/screenshots."
  if repo=="desktop":qualifier+=" Desktop Codex still runs on the customer's computer with explicit full permissions and no Electron frame/menu; this round rebuilds the cloud-task detail renderer, without new installed-binary acceptance."
  if repo=="extension":qualifier+=" Native right Side Panel and authorized local-file upload remain; panel compile/build only in154."
  text="<!-- runtime-pause-154 -->\n\n"+intro+"\n\n"+diagram+"\n\n"+qualifier+"\n\n"
  text+="6 focused backend cases /5 actual Web/Admin groups;7 PNGs and2 GIF/MP4 pairs. All changed clients built. Explicit synthetic model adapter; no real provider request. Broad/installed-client/cross-OS regression omitted. Apply forward SQL153/154 using the backend migration procedure before updating. Unreleased after v0.1.0-rc.1; all five frozen ZIPs unchanged.\n\n"
  text+="[方案 / Implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/development/154-runtime-pause.md) · [API](https://github.com/copypasteltd/workmate/blob/docs/docs/contracts/runtime-pause-openapi.json) · [完整待项 / Ledger](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage154.md)\n\n"
  text+="![Actual control](assets/screenshots/"+Path(cover["path"]).name+")\n\n![Actual interaction](assets/screenshots/"+Path(gif["path"]).name+")\n\n[Actual MP4](assets/screenshots/"+Path(mp4["path"]).name+")\n\n---\n\n"
  p.write_bytes((text+old).encode("utf-8"))
for filename in ["README.md","README.en.md"]:
 p=ROOT/"docs"/filename;old=p.read_text("utf-8");assert "<!-- runtime-pause-154 -->" not in old
 p.write_bytes(("<!-- runtime-pause-154 -->\n\n[运行中暂停 / Running pause](development/154-runtime-pause.md) · [API](contracts/runtime-pause-openapi.json) · [限定证据 / Evidence](quality/runtime-pause-checkpoint-154.md) · [当前编号 / Ledger](quality/remaining-work-stage154.md) · [更新 / Changes](changes/154-runtime-pause.md)\n\nUnreleased154; first frozen v0.1.0-rc.1 preserved.6 focused backend cases /5 actual Web/Admin groups.\n\n---\n\n"+old).encode("utf-8"))
print(json.dumps({"status":"recorded","backend_cases":6,"actual_ui_groups":5,"screenshots":7,"recordings":2,"whole_acceptance_closed":0}))
