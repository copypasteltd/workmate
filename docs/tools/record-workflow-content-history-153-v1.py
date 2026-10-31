# Record the bounded workflow-reader increment; preserve the first frozen release.
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json, re, sys

ROOT=Path(r"D:\dev\copypasted\自有agent"); DEV=ROOT/"dev"
D=DEV/"copypaste-delivery"; E=D/"evidence/workflow-content-history-153"
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

baseline=read(D/".data/automation-history-153/baseline.json")
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
for label,n in [("tests",9),("pass",9),("fail",0),("skipped",0)]:
 assert re.search(r"^# "+label+" "+str(n)+r"\s*$",raw,re.M)
j=read(E/("ui-"+ui_attempt+"-journey.json"))
assert j["status"]=="passed" and len(j["checks"])==7 and not j["errors"]
assert all(j[k] for k in ["browser_closed","api_closed","fixture_closed"])
assert len(j["screenshots"])==10 and len(j["recordings"])==2
media=list(j["screenshots"])
for recording in j["recordings"]:
 assert recording["distinct_frames"]>=2 and recording["skipped_capture_errors"]==0
 media.extend(recording["files"])
cover=next(m for m in media if m["path"].endswith("shared-newest-en.png"))
gif=next(m for m in media if m["path"].endswith(".gif"))
mp4=next(m for m in media if m["path"].endswith(".mp4"))
copies=[]
for m in media:
 a=DEV/m["path"]; assert digest(a)==m["sha256"]
 copies.append(copy(a,ROOT/"docs/assets/workflow-content-history-153"/a.name))
for repo in ["platform","web","desktop","extension","delivery"]:
 for m in [cover,gif,mp4]:
  copies.append(copy(DEV/m["path"],DEV/("copypaste-"+repo)/"assets/screenshots"/Path(m["path"]).name))
scope="Complete retained Admin workflow definitions, source-controlled current execution snapshots, exact quarantine investigation, source locks, erasure and authorized shared-history export. No whole-product acceptance or new frozen binary."
cp={"at":datetime.now(timezone.utc).isoformat(),"status":"verified_workflow_content_history_increment",
 "stage":153,"schema_version":152,"release":"unreleased_after_v0.1.0-rc.1","frozen_release_unchanged":True,
 "baseline":baseline,"backend_cases":9,"actual_journey_groups":7,"screenshots":10,"recordings":2,
 "broad_regression":"deliberately_omitted_by_user","model_mode":"synthetic_no_model_request",
 "new_full_acceptance_closures":0,"source_files":sources,"reports":reports,"media":media,
 "shared_media_copies":copies,"scope":scope,"recorder_sha256":digest(Path(__file__))}
put(ROOT/"docs/quality/workflow-content-history-checkpoint-153.json",json.dumps(cp,ensure_ascii=False,indent=2)+"\n")
ledger=read(ROOT/"docs/quality/remaining-work-stage152.json")
ledger.update(schema_version=ledger["schema_version"]+1,current_stage=153,reviewed_at=cp["at"],
 checkpoint="docs/quality/workflow-content-history-checkpoint-153.json",
 previous_review=ref(ROOT/"docs/quality/remaining-work-stage152.json"),new_full_acceptance_closures=0)
ledger["current_increment"]={"stage":153,"scope":scope,"backend_cases":9,"actual_client_journey_groups":7,
 "broad_regression":"deliberately_omitted_by_user","full_acceptance_closed":False,"release":cp["release"]}
for row in ledger["requirements"]:
 if row["id"]=="REQ-090":
  row["implemented_scope"]+="；153补齐共享/私有云端/Desktop全部已保存工作流定义分页、受控当前执行快照、隔离调查、来源持锁、旧入口撤回封锁、共享快照擦除与导出。"
  row["current_audit_remaining"]="工作流完整定义及当前执行快照已补齐；完整用户内容治理仍需跨全部资源、正式规模及当前权限/撤回/删除矩阵验收。未保存的旧共享定义、执行状态历史不凭空重建。私有云计划/事件仍按原文仅元数据和暂停。"
  row["current_review_note"]=row.get("current_review_note","")+" 153：9项定向SQL/HTTP、7组实际Admin操作、10张截图/2组GIF与MP4；独立复核后修正来源锁和隔离调查遗漏，未宣称完整生产验收。"
assert len(ledger["requirements"])==102 and ledger["summary"]["required_open"]==88
put(ROOT/"docs/quality/remaining-work-stage153.json",json.dumps(ledger,ensure_ascii=False,indent=2)+"\n")
lines=["# 当前完整待项 / Remaining whole acceptance — Stage153","",
 "工作流定义历史和受控执行快照已补齐。88项表示必需完整验收范围，不能解释为88个未实现模块。","",
 "| 编号 | 模块 | 完整验收 | 仍待完成 |","|---|---|---|---|"]
for r in ledger["requirements"]:
 lines.append("| "+" | ".join(str(v).replace("|","\\|").replace("\n"," ") for v in
  [r["id"],r["module"],r["full_acceptance"],r.get("current_audit_remaining",r["remaining"])])+" |")
put(ROOT/"docs/quality/remaining-work-stage153.md","\n".join(lines)+"\n")
contract={"openapi":"3.1.0","info":{"title":"Workmate scoped workflow content readers","version":"153"},"paths":{},
 "x-authorization":"Independent active admin session; current admin.content.read + admin.content.body.read in exact tenant/project; explicit deny wins; MFA within10min. No customer identity/lease/read record.",
 "x-protocol":"Definitions: <=50 retained versions; signed reversible identity/session/object/current revision cursor; 30min expiry. Run: one current_snapshot only, no invented execution-state history.",
 "x-source-fence":"Exact saved lineage and confirmed feedback; current source locks and recheck. Only precise quarantined investigated roots are excepted. Withdrawn body=null; sensitive version details removed. No paid execution."}
for kind in ["workflows","workflow_runs"]:
 parameters=[{"name":"id","in":"path","required":True,"schema":{"type":"string","format":"uuid"}},
  {"name":"edge","in":"query","schema":{"type":"string","enum":["first","last"]}}]
 if kind=="workflows": parameters.append({"name":"cursor","in":"query","schema":{"type":"string"}})
 contract["paths"]["/v1/admin/content/"+kind+"/{id}/history"]={"get":{
  "summary":"Retained saved definitions" if kind=="workflows" else "Current readable execution snapshot",
  "parameters":parameters,"responses":{str(c):{"description":d} for c,d in [
   (200,"No-store page; withdrawn bodies explicitly null"),(400,"Invalid/expired/foreign cursor or unknown query"),
   (401,"Current admin session required"),(403,"Current scope/permissions or recent MFA required"),
   (404,"Object not found"),(409,"History changed or source is changing; refresh"),(410,"Deleted or permanently erased scope")]}}}
put(ROOT/"docs/contracts/workflow-content-history-openapi.json",json.dumps(contract,ensure_ascii=False,indent=2)+"\n")
diagram="```mermaid\nflowchart LR\n A[Admin + scopes + MFA] --> B[Saved definitions / current run]\n B --> C[Exact sources + locks + recheck]\n C --> D[Full retained pages / explicit snapshot]\n D --> E[Focus or15s recheck]\n E --> F[Access or source changes clear body]\n```"
for repo in ["platform","web","admin","desktop","extension","delivery"]:
 for name in ["README.md","README.en.md"]:
  p=DEV/("copypaste-"+repo)/name; old=p.read_text("utf-8")
  assert "<!-- workflow-content-history-153 -->" not in old
  intro=("后台工作流支持全部已保存定义与受控执行快照。进入内容目录 → 读取内容 → 展开精确版本并翻页。近期MFA、双内容权限、当前范围与来源复查同时生效，来源或权限变化清除正文。精确调查根隔离后仍可审阅；真实依赖撤回继续隐藏。共享历史连接永久擦除与完整授权导出。"
   if name=="README.md" else
   "Admin reads every retained workflow definition and source-controlled current execution snapshots. Open Content → Read content → expand the exact version and navigate pages. Current scopes, both content permissions, recent MFA and source rechecks apply together; access/source changes clear bodies. Only precise quarantined investigation roots are excepted. Shared history joins erasure and authorized exports.")
  qualifier="This is the actual Admin journey." if repo=="admin" else "Media show the actual Admin journey; this component has no new client UI acceptance in153."
  if repo=="desktop": qualifier+=" Desktop executes Codex locally with customer-granted permissions and no Electron frame/menu."
  if repo=="extension": qualifier+=" Extension remains the native right Side Panel with authorized local file uploads to the cloud agent."
  text="<!-- workflow-content-history-153 -->\n\n"+intro+"\n\n"+diagram+"\n\n"+qualifier+"\n\n"
  text+="9 focused backend cases /7 actual browser groups passed with synthetic business/model data; no real provider request. Broad regression and unchanged client builds omitted. SQL150v2/151/152 are forward migrations. Unreleased increment; frozen v0.1.0-rc.1 and its five ZIPs unchanged.\n\n"
  text+="[方案 / Implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/development/153-workflow-content-history.md) · [API](https://github.com/copypasteltd/workmate/blob/docs/docs/contracts/workflow-content-history-openapi.json) · [完整待项 / Ledger](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage153.md)\n\n"
  text+="![Actual Admin history](assets/screenshots/"+Path(cover["path"]).name+")\n\n![Actual interaction](assets/screenshots/"+Path(gif["path"]).name+")\n\n[Actual MP4](assets/screenshots/"+Path(mp4["path"]).name+")\n\n---\n\n"
  p.write_bytes((text+old).encode())
for name in ["README.md","README.en.md"]:
 p=ROOT/"docs"/name;old=p.read_text("utf-8")
 assert "<!-- workflow-content-history-153 -->" not in old
 p.write_bytes(("<!-- workflow-content-history-153 -->\n\n[工作流完整阅读 / Workflow readers](development/153-workflow-content-history.md) · [API](contracts/workflow-content-history-openapi.json) · [完整待项 / Ledger](quality/remaining-work-stage153.md) · [更新 / Changes](changes/153-workflow-content-history.md)\n\nUnreleased153; first frozen v0.1.0-rc.1 preserved. 9 focused backend cases /7 actual Admin groups.\n\n---\n\n"+old).encode())
print(json.dumps({"status":"recorded","backend_cases":9,"actual_admin_groups":7,"screenshots":10,"recordings":2,"whole_acceptance_closed":0}))
