"""Bind a focused, unreleased scope-erasure increment; preserve the first frozen release."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json, re
ROOT=Path(r"D:\dev\copypasted\自有agent")
DEV=ROOT/"dev"; DELIVERY=DEV/"copypaste-delivery"; E=DELIVERY/"evidence/scope-erasure-150"
def digest(p):
 h=sha256()
 with p.open("rb") as f:
  for b in iter(lambda:f.read(4*1024*1024),b""):h.update(b)
 return h.hexdigest()
def read(p):return json.loads(p.read_bytes())
def put(p,s):
 p.parent.mkdir(parents=True,exist_ok=True)
 with p.open("x",encoding="utf-8",newline="\n") as f:f.write(s)
def ref(p):return {"path":p.relative_to(ROOT).as_posix(),"sha256":digest(p)}
def copy(a,b):
 b.parent.mkdir(parents=True,exist_ok=True)
 with b.open("xb") as f:f.write(a.read_bytes())
 assert digest(a)==digest(b)
 return ref(b)
baseline=read(DELIVERY/".data/scope-erasure-150/baseline.json")
for f,v in {**baseline["frozen_files"],**baseline["preserved_user_files"]}.items():assert digest(ROOT/f)==v,f
assert digest(DEV/"copypaste-desktop/.gitattributes")==baseline["desktop_attributes_sha256"]
release=DELIVERY/"release/workmate-v0.1.0-rc.1"
for item in read(release/"release-manifest.json")["artifacts"]:assert digest(release/item["file"])==item["sha256"]
sources={};reports={}
for name in ["backend-11","build-02","ui-04"]:
 r=read(E/(name+".json"));assert r["status"]=="passed" and r["source_unchanged"],name
 for k in ["source_manifest","raw_report","verifier"]:assert digest(DELIVERY/r[k]["path"])==r[k]["sha256"]
 for file,item in read(DELIVERY/r["source_manifest"]["path"]).items():
  assert digest(DEV/file)==item["sha256"],file
  assert digest(DELIVERY/item["path"])==item["sha256"],item["path"]
  assert sources.setdefault(file,item["sha256"])==item["sha256"]
 if name!="build-02":
  assert r["owned_database_shutdown"] and r["result_exit_code"]==0
  assert r["fixture_cleanup"]["status"]=="passed" and r["fixture_cleanup"]["exit_code"]==0
 reports[name]=ref(E/(name+".json"))
raw=(E/"backend-11.tap").read_text(encoding="utf-8")
for label,n in [("tests",12),("pass",11),("fail",0),("skipped",1)]:assert re.search(r"^# "+label+" "+str(n)+r"\s*$",raw,re.M)
old=(E/"backend-05.tap").read_text(encoding="utf-8");assert re.search(r"^ok 9 - old migration145 backup",old,re.M)
for name in ["native-recovery.ts","native-recovery-archive.ts"]:
 item=read(E/"backend-05-sources.json")["copypaste-platform/src/"+name];assert digest(DEV/"copypaste-platform/src"/name)==item["sha256"]
build=read(E/"build-02.json");assert len(build["commands"])==3 and all(c["exit_code"]==0 for c in build["commands"])
for file,v in build["package_files"].items():assert digest(Path(build["package_root"])/file)==v
j=read(E/"ui-04-journey.json");assert j["status"]=="passed" and len(j["checks"])==6 and not j["errors"]
assert all(j[k] for k in ["browser_closed","desktop_closed","api_closed","fixture_closed"])
media=list(j["screenshots"])
for r in j["recordings"]:
 assert r["distinct_frames"]>=2 and r["skipped_capture_errors"]==0
 media.extend(r["files"])
assert len(j["screenshots"])==6 and len(j["recordings"])==3
copies=[]
for item in media:
 source=DEV/item["path"];assert digest(source)==item["sha256"]
 copies.append(copy(source,ROOT/"docs/assets/scope-erasure-150"/(source.parent.parent.parent.name+"__"+source.name)))
webmedia=[m for m in media if m["path"].startswith("copypaste-web/") and m["path"].endswith((".gif",".mp4","scope-cleanup-completed-en.png.png"))]
for repo in ["platform","extension","delivery"]:
 for item in webmedia:copies.append(copy(DEV/item["path"],DEV/("copypaste-"+repo)/"assets/screenshots"/Path(item["path"]).name))
# Preserve already-executed CRLF bytes in Git without rewriting the protected
# Desktop root attributes. Nested attributes affect only the qualified paths.
attributes={
 "copypaste-platform/.gitattributes":["src/"+f for f in ["access.ts","admin-access.ts","admin-accounts.ts","assets.ts","business.ts","db.ts","deletions.ts","desktop-executions.ts","desktop-workflows.ts","erasure.ts","native-agent-groups.ts","native-recovery-archive.ts","native-recovery.ts","project-management.ts","schema-compatibility.ts","server.ts","worker.ts","scope-closure-authority.ts","scope-erasure-cleanup.ts","scope-erasure.ts"]]+["tests/*150*","scripts/*150*"],
 "copypaste-web/.gitattributes":["src/main.tsx","src/project-management.tsx","src/scope-*.tsx","src/scope-erasure.css"],
 "copypaste-admin/.gitattributes":["src/main.tsx","src/api.ts","src/deletions.tsx","src/scope-erasure-dialog.tsx"],
 "copypaste-desktop/src/.gitattributes":["config.ts"],
 "copypaste-desktop/renderer/src/.gitattributes":["main.tsx","project-management.tsx","scope-*.tsx","scope-erasure.css"],
}
for file,patterns in attributes.items():
 path=DEV/file;path.parent.mkdir(parents=True,exist_ok=True)
 with path.open("a",encoding="utf-8",newline="\n") as f:f.write("\n# Stage150 exact qualified bytes.\n"+"\n".join(pattern+" -text whitespace=cr-at-eol" for pattern in patterns)+"\n")

# A new contract documents current APIs; it does not alter historical release schemas.
paths={}
for base in ["/v1/tenants/{tenant}/erasure","/v1/tenants/{tenant}/projects/{project}/erasure","/v1/admin/scopes/{kind}/{id}/erasure"]:
 paths[base+"-preview"]={"get":{"summary":"Review current authorized deletion scope and retention limits","responses":{"200":{"description":"No-store preview"},"401":{"description":"Exact session invalid"},"403":{"description":"Current role/scope or recent administrator MFA required"}}}}
 paths[base]={"post":{"summary":"Accept an irreversible durable scope fence","description":"Exact current name, reason_code customer_request/workspace_closure/privacy_request, acknowledge_irreversible=true and acknowledge_retention=true are required. Requires Idempotency-Key; replays reauthorize and return current state. Owner deletes tenants; owner/admin deletes projects. Admin needs admin.content.delete, exact scope and recent MFA, including every child scope for tenant deletion.","responses":{"202":{"description":"Durable job accepted; no immediate financial hold release"},"401":{"description":"Session no longer valid"},"403":{"description":"Current authority insufficient"},"409":{"description":"Exact name changed or idempotency conflict"}}}}
paths["/v1/scope-deletions"]={"get":{"summary":"Current owner's/admin's account-level paginated scope cleanup records","description":"Available after the last tenant is deleted. Current active, non-suspended membership is required. page<=10000, page_size<=100. Safe IDs, states, counts and retention categories; no private bodies, locators or credentials.","responses":{"200":{"description":"No-store current cleanup history"}}}}
contract={"openapi":"3.1.0","info":{"title":"Workmate scope erasure","version":"unreleased-stage150"},"paths":paths}
p=DEV/"copypaste-platform/contracts/scope-erasure-openapi.json";put(p,json.dumps(contract,ensure_ascii=False,indent=2)+"\n");contractref=copy(p,ROOT/"docs/contracts/scope-erasure-openapi.json")
attr=DELIVERY/".gitattributes"
with attr.open("a",encoding="utf-8",newline="\n") as f:f.write("\n# Stage150 original verifiers, failures and exact source objects.\nscripts/*150* -text whitespace=cr-at-eol\nevidence/scope-erasure-150/objects/** -diff -text -whitespace\nevidence/scope-erasure-150/*.tap -text -whitespace\n")
cp={"created_at":datetime.now(timezone.utc).isoformat(),"status":"verified_scope_erasure_increment","stage":150,"release":"unreleased_after_v0.1.0-rc.1","frozen_release_unchanged":True,"baseline":baseline,"schema_version":148,"backend_cases":11,"skipped_repeated_backend_cases":1,"actual_journey_groups":6,"native_surface_boundary_cases":12,"broad_regression":"deliberately_omitted_by_user","model_mode":"explicit_synthetic_no_paid_provider_request","new_full_acceptance_closures":0,"source_files":sources,"reports":reports,"media":media,"shared_media_copies":copies,"api_contract":contractref,"package_root":build["package_root"],"package_files":build["package_files"],"ui_scope_note":"The wrapper retains a historical project-lifecycle summary. Actual scope is permanent project/workspace erasure, as recorded in ui-04-journey.json and the immutable qa-scope-erasure-150-v2.ts source, not archive/restore acceptance.","recorder_sha256":digest(Path(__file__)),"historical_old_backup_pass":ref(E/"backend-05.tap"),"scope":"Aggregate project/tenant permanent fences and asynchronous cleanup, current authority, native/cloud closure with honest financial reconciliation, source ingress fences, account-level history and mandatory old-backup ledger replay. Full export, every derivative and real production acceptance remain open."}
put(ROOT/"docs/quality/scope-erasure-checkpoint-150.json",json.dumps(cp,ensure_ascii=False,indent=2)+"\n")
ledger=read(ROOT/"docs/quality/remaining-work-stage149.json");ledger["schema_version"]+=1;ledger["current_stage"]=150;ledger["reviewed_at"]=cp["created_at"];ledger["checkpoint"]="docs/quality/scope-erasure-checkpoint-150.json";ledger["previous_review"]=ref(ROOT/"docs/quality/remaining-work-stage149.json");ledger["new_full_acceptance_closures"]=0
ledger["current_increment"]={"stage":150,"scope":cp["scope"],"backend_cases":11,"skipped_repeated_backend_cases":1,"actual_client_journey_groups":6,"broad_regression":"deliberately_omitted_by_user","full_acceptance_closed":False,"release":cp["release"]}
for row in ledger["requirements"]:
 if row["id"]=="REQ-049":
  row["implemented_scope"]+="；150补齐项目/企业聚合永久删除、写入栅栏、21类资源扩展清理、原生停止结算、备份根记录重放及三端确认/进度。"
  row["current_audit_remaining"]="完整导出、全部衍生数据/外部供应方副本、生产备份恢复和保留期限实证验收仍开放；本轮已实现聚合删除，不能再列为未实现。客户本机副本和共用全局身份不在该云端删除范围。"
  row["current_review_note"]+=" 150：11项当前检查、6组实际三端操作、初次8步构建及3步定向重构建；旧145备份/ledger2真实恢复先前同轮通过，省略重复。148补丁后没有重跑该旧备份场景，不扩大验收声明。"
assert len(ledger["requirements"])==102 and ledger["summary"]["required_open"]==88
put(ROOT/"docs/quality/remaining-work-stage150.json",json.dumps(ledger,ensure_ascii=False,indent=2)+"\n")
lines=["# 当前完整待项 / Remaining whole acceptance — Stage150","","首个冻结版已保留。本轮补齐聚合永久删除，不关闭整项REQ049；102项原始记录、88项必需完整验收范围继续保留，并非88个缺失模块。","","| 编号 | 模块 | 完整验收 | 仍待完成 |","|---|---|---|---|"]
for r in ledger["requirements"]:lines.append("| "+" | ".join(str(v).replace("|","\\|").replace("\n"," ") for v in [r["id"],r["module"],r["full_acceptance"],r.get("current_audit_remaining",r["remaining"])])+" |")
put(ROOT/"docs/quality/remaining-work-stage150.md","\n".join(lines)+"\n")
diagram="""```mermaid
flowchart LR
 A[Current owner or scoped admin] --> B[Preview and exact-name confirmation]
 B --> C[Permanent scope fence]
 C --> D[Cancel new work and close inflight execution]
 D --> E[21 resource roots and derived cleanup]
 E --> F[Safe progress and retained financial facts]
 C --> G[Erasure ledger]
 G --> H[Replay before restoring old backup objects]
```"""
guide="""# 聚合永久删除 / Aggregate permanent scope erasure

本轮为首个冻结版 v0.1.0-rc.1 后的未冻结开发增量，不替换原标签和五个ZIP。All current changes are an unreleased increment; original frozen tags and archives remain intact.

企业 owner/admin 从 Web/Desktop「项目」进入永久删除预览；整企业仅 owner 可操作。输入精确名称，选择原因，分别确认不可恢复和保留范围。Admin从内容管理选择项目/企业ID，预览并确认；服务端要求当前范围的 admin.content.delete 与近期MFA，企业删除逐一检查子项目的明确拒绝。

Web/Desktop owners/admins preview a project scope; only owners delete a whole workspace. Exact-name confirmation, a controlled reason and two acknowledgements are mandatory. Administrators use Content management with current scoped deletion permission and recent MFA. Previewing never deletes content. A successful request returns202 and a durable job. Current exact user/session locks serialize acceptance with logout and session withdrawal; membership is rechecked before acceptance. Replays return current state after reauthorization.

接受后立即永久封闭新任务、文件读取和新内容写入，后台扩展21类资源根、历史版本、连接与自动化、上传、发布预览/凭据等清理。数据库写入规则阻止持有旧请求快照的写入复活。仍被其他项目使用的物件与连接受到保护；不会删除共享账户或其他企业资料。

A permanent database marker fences new private writes even from stale request snapshots. Background jobs rescan all resource roots, histories and scoped ingress. Shared live object references and connections remain protected. Native Desktop stays local and only its original active login family can submit minimal cancellation/finish receipts after erasure; model, tools, source reads and heartbeats remain blocked. Closing uses server-observed cost, null output and original report hashes. Expired or unknown charges stay reconciling; deletion never fabricates success or releases unknown holds.

清理记录是独立账户页面 /cleanup，删除最后企业后仍可查看。后台可查看状态、重试及保留类别。必要帐务/审计事实保留；共用全球用户身份不属于企业删除；既有目录导出依原有短有效期到期；客户已下载或本机文件由客户管理。备份需在隔离、升级后、还原物件前重播根级ledger2，兼容既有单资源ledger1。35天轮换不等同于保证所有备份字节在第35天消失。

Cleanup history remains accessible outside the workspace shell, including after deleting the last workspace. Billing/audit facts, shared account identities and short-lived directory export metadata follow explicit retention boundaries. Customer-local copies cannot be recalled. Backup restoration applies current migrations in isolation and replays root-level erasure before materializing objects. Legacy ledger1 remains compatible. Backup rotation does not promise destruction of every byte on day35.

DIAGRAM

本轮只做必要检查：11项当前SQL/HTTP检查通过，1项耗时旧备份重复检查明确省略；该旧145快照加ledger2的真实恢复在backend05单项通过，原始报告整体仍因另一夹具失败而保持失败，不改为通过。三端6组实际界面流程、6张PNG及3组真实GIF/MP4，初次8步构建及3步定向重构建含12项本机边界检查和独立未签名Windows目录包。关闭所有本轮浏览器、原生窗口、API及原生数据库。

Focused qualification passed11 current SQL/HTTP cases,6 actual Web/Desktop/Admin groups and3 targeted rebuild steps after8 all-client build steps. No broad regression or paid model request was run. Original failed attempts are retained. The repeated expensive backup scenario was skipped; its earlier individual pass is historical within this increment, before forward repairs147/148, and is not represented as current full recovery acceptance. Database schema advances to148 using forward-only repairs; executed146/147 are not edited. The native closure exception is limited to permanently erased roots; moderator-quarantined/deleted tasks in an otherwise active project still return404 on finish/cancel replays, even while private output remains stored pending cleanup.

仍待完整导出、所有衍生和供应方副本覆盖、真实内部API/广告平台联调、生产恢复、签名与安装更新完整验收。本轮不宣布整产品完成；REQ049保持开放。Desktop候选在 release/scope-erasure-150-02/win-unpacked，首个冻结包另行保留。

[完整待项 / Full ledger](../quality/remaining-work-stage150.md) · [API contract](../contracts/scope-erasure-openapi.json) · [First frozen release](../releases/v0.1.0-rc.1.md)
""".replace("DIAGRAM",diagram)
for item in media:
 if item["path"].endswith((".png",".gif")):
  source=DEV/item["path"];guide+="\n![Actual recorded UI](../assets/scope-erasure-150/"+source.parent.parent.parent.name+"__"+source.name+")\n"
put(ROOT/"docs/development/150-scope-erasure.md",guide)
put(ROOT/"docs/changes/150-scope-erasure.md","# Stage150 更新 / Changes\n\n| 编号 | 本轮事项 | 状态 |\n|---|---|---|\n| 1 | 项目/企业永久删除及写入隔离 | 已实现 |\n| 2 | 21类根、历史与连接/上传/发布清理 | 已实现；完整覆盖验收仍开放 |\n| 3 | 本机/云端停止与真实费用保留 | 定向验证通过 |\n| 4 | Web/Desktop/Admin确认与独立记录 | 实际界面验证通过 |\n| 5 | 原生Windows候选与双语文档/PNG/GIF/MP4 | 已构建 |\n| 6 | 首个冻结版 | 保持不变 |\n| 7 | 完整导出、生产服务与签名更新 | 待完成 |\n\n[实现与使用 / Implementation](../development/150-scope-erasure.md) · [完整编号 / Full ledger](../quality/remaining-work-stage150.md)\n")
for repo in ["platform","web","admin","desktop","extension","delivery"]:
 folder=DEV/("copypaste-"+repo);component=repo if repo in ["web","desktop","admin"] else "web"
 chosen=[m for m in media if m["path"].startswith("copypaste-"+component+"/")]
 image=next(m for m in chosen if m["path"].endswith(".png"));gif=next(m for m in chosen if m["path"].endswith(".gif"));video=next(m for m in chosen if m["path"].endswith(".mp4"))
 if repo not in ["web","desktop","admin"]:image=next(m for m in webmedia if m["path"].endswith(".png"))
 for en in [False,True]:
  p=folder/("README.en.md" if en else "README.md");old=p.read_text(encoding="utf-8");assert "<!-- scope-erasure-150 -->" not in old
  text=("**Unreleased increment150 — permanent project/workspace cleanup**\n\nOwners/admins open Projects, preview permanent deletion, type the exact name and acknowledge irreversibility and retention. Only owners delete a whole workspace. Admin Content management requires scoped deletion permission and recent MFA. Cleanup history remains accessible at /cleanup after the last workspace is removed. New work/source access is blocked immediately. In-flight executions close using real company usage; unknown charges remain held. Native Desktop runs Codex locally; Extension keeps its cloud agent and right Side Panel.\n\n11 focused backend cases,6 actual client groups and3 targeted rebuild steps after8 all-client build steps passed. One unchanged expensive backup scenario was deliberately not repeated; its earlier individual pass and all original failures are retained. No broad regressions or paid models. Required billing/audit facts, shared identities, live references and customer-local copies follow explicit retention boundaries. Full export, all derivative/production recovery acceptance, real provider/advertising accounts and signing remain open. The first frozen v0.1.0-rc.1 tags and five archives are unchanged.\n\n" if en else "**未冻结增量150：项目/企业永久清理闭环**\n\nowner/admin从「项目」预览永久删除，输入完整名称并确认不可恢复及保留范围；整企业仅owner可删。后台内容管理要求对应范围删除权限与近期MFA。/cleanup为独立账户页面，最后企业删除后仍可查看。立即阻止新工作与原文访问；本机/云端执行按公司实际用量收尾，未知费用保留核对。Desktop仍本机运行Codex；Extension仍为云端Agent与原生右侧栏。\n\n11项当前后端检查、6组真实三端流程、初次8步构建及3步定向重构建通过。明确省略一项耗时旧备份重复检查，保留其先前单项通过及所有失败原件；未扩跑广泛回归或真实付费模型。必要帐务/审计、共用身份、其他范围引用与客户本机副本适用明确保留规则。完整导出、全部衍生/生产恢复验收、真实供应方/广告账号和签名仍待完成。首个冻结v0.1.0-rc.1标签及五个ZIP保持原样。\n\n")
  text="<!-- scope-erasure-150 -->\n\n"+text+diagram+"\n\n"+("Actual component journey." if repo in ["web","desktop","admin"] else "Shared actual Web illustration; no new UI acceptance for this component.")+"\n\n"
  text+="![Actual screen](assets/screenshots/"+Path(image["path"]).name+")\n\n![Actual interaction](assets/screenshots/"+Path(gif["path"]).name+")\n\n[Actual MP4](assets/screenshots/"+Path(video["path"]).name+")\n\n---\n\n"
  p.write_text(text+old,encoding="utf-8",newline="\n")
for name in ["README.md","README.en.md"]:
 p=ROOT/"docs"/name;old=p.read_text(encoding="utf-8");p.write_text("<!-- scope-erasure-150 -->\n\n[聚合永久清理 / Permanent scope cleanup](development/150-scope-erasure.md) · [完整待项 / Full ledger](quality/remaining-work-stage150.md) · [更新 / Changes](changes/150-scope-erasure.md)\n\nFirst frozen release retained. Increment150 is unreleased; focused checks only. 102 original records and88 required whole acceptance scopes remain.\n\n---\n\n"+old,encoding="utf-8",newline="\n")
print(json.dumps({"status":"recorded","backend_cases":11,"actual_client_groups":6,"whole_acceptance_closed":0,"required_whole_scopes_open":88},ensure_ascii=False))
