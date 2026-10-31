"""Record current handover implementation, narrow real qualification and honest remaining scope."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json, re, sys
ROOT=Path(r"D:\dev\copypasted\自有agent");DEV=ROOT/"dev";D=DEV/"copypaste-delivery";E=D/"evidence/ownership-transfer-151"
backend_attempt,build_attempt,ui_attempt=sys.argv[1:]
assert all(re.fullmatch(r"\d{2}",v) for v in [backend_attempt,build_attempt,ui_attempt])
def digest(p):
 h=sha256()
 with p.open("rb") as f:
  for b in iter(lambda:f.read(4*1024*1024),b""):h.update(b)
 return h.hexdigest()
def read(p):return json.loads(p.read_bytes())
def put(p,text):
 p.parent.mkdir(parents=True,exist_ok=True)
 with p.open("x",encoding="utf-8",newline="\n") as f:f.write(text)
def ref(p):return{"path":p.relative_to(ROOT).as_posix(),"sha256":digest(p)}
def copy(a,b):
 b.parent.mkdir(parents=True,exist_ok=True)
 with b.open("xb") as f:f.write(a.read_bytes())
 assert digest(a)==digest(b)
 return ref(b)
baseline=read(D/".data/ownership-transfer-151/baseline.json")
for f,value in {**baseline["frozen_files"],**baseline["preserved_user_files"]}.items():assert digest(ROOT/f)==value,f
assert digest(DEV/"copypaste-desktop/.gitattributes")==baseline["desktop_attributes_sha256"]
release=D/"release/workmate-v0.1.0-rc.1"
for a in read(release/"release-manifest.json")["artifacts"]:assert digest(release/a["file"])==a["sha256"]
sources={};reports={}
for name in ["backend-"+backend_attempt,"build-"+build_attempt,"ui-"+ui_attempt]:
 r=read(E/(name+".json"));assert r["status"]=="passed" and r["source_unchanged"],name
 for k in ["source_manifest","raw_report","verifier"]:assert digest(D/r[k]["path"])==r[k]["sha256"]
 for file,item in read(D/r["source_manifest"]["path"]).items():
  assert digest(DEV/file)==item["sha256"],file
  assert digest(D/item["path"])==item["sha256"]
  assert sources.setdefault(file,item["sha256"])==item["sha256"]
 if not name.startswith("build-"):
  assert r["owned_database_shutdown"] and r["result_exit_code"]==0
  assert r["fixture_cleanup"]["status"]=="passed" and r["fixture_cleanup"]["exit_code"]==0
 reports[name]=ref(E/(name+".json"))
raw=(E/("backend-"+backend_attempt+".tap")).read_text(encoding="utf-8")
for label,n in [("tests",9),("pass",9),("fail",0),("skipped",0)]:assert re.search(r"^# "+label+" "+str(n)+r"\s*$",raw,re.M)
build=read(E/("build-"+build_attempt+".json"));assert len(build["commands"])==8 and all(c["exit_code"]==0 for c in build["commands"])
for file,value in build["package_files"].items():assert digest(Path(build["package_root"])/file)==value
j=read(E/("ui-"+ui_attempt+"-journey.json"));assert j["status"]=="passed" and len(j["checks"])==6 and not j["errors"]
assert all(j[k] for k in ["browser_closed","desktop_closed","api_closed","fixture_closed"])
assert len(j["screenshots"])==6 and len(j["recordings"])==3
media=list(j["screenshots"])
for recording in j["recordings"]:
 assert recording["distinct_frames"]>=2 and recording["skipped_capture_errors"]==0
 media.extend(recording["files"])
copies=[]
for item in media:
 source=DEV/item["path"];assert digest(source)==item["sha256"]
 copies.append(copy(source,ROOT/"docs/assets/ownership-transfer-151"/(source.parent.parent.parent.name+"__"+source.name)))
illustrations=[x for x in media if x["path"].startswith("copypaste-web/") and x["path"].endswith(("recipient-accepted-en.png.png",".gif",".mp4"))]
for repo in ["platform","extension","delivery"]:
 for item in illustrations:copies.append(copy(DEV/item["path"],DEV/("copypaste-"+repo)/"assets/screenshots"/Path(item["path"]).name))
cp={"at":datetime.now(timezone.utc).isoformat(),"status":"verified_ownership_transfer_increment","stage":151,"schema_version":149,"release":"unreleased_after_v0.1.0-rc.1","frozen_release_unchanged":True,"baseline":baseline,"backend_cases":9,"actual_journey_groups":6,"native_surface_boundary_cases":12,"broad_regression":"deliberately_omitted_by_user","model_mode":"synthetic_no_model_request","new_full_acceptance_closures":0,"source_files":sources,"reports":reports,"media":media,"shared_media_copies":copies,"package_root":build["package_root"],"package_files":build["package_files"],"recorder_sha256":digest(Path(__file__)),"previous_goal_turn":"progress: permanent scope erasure implemented and eight branch heads pushed/verified in stage150","scope":"Complete explicit two-party ownership handover, current authority, physical account-row withdrawal serialization, atomic role change, decline/cancel/expiry, scoped admin inspection/cancellation and three-client discovery. Does not transfer private authorship, billing identity, tasks or OS permissions; does not claim whole-product or full account/inflight acceptance."}
put(ROOT/"docs/quality/ownership-transfer-checkpoint-151.json",json.dumps(cp,ensure_ascii=False,indent=2)+"\n")
ledger=read(ROOT/"docs/quality/remaining-work-stage150.json");ledger["schema_version"]+=1;ledger["current_stage"]=151;ledger["reviewed_at"]=cp["at"];ledger["checkpoint"]="docs/quality/ownership-transfer-checkpoint-151.json";ledger["previous_review"]=ref(ROOT/"docs/quality/remaining-work-stage150.json");ledger["new_full_acceptance_closures"]=0
ledger["current_increment"]={"stage":151,"scope":cp["scope"],"backend_cases":9,"actual_client_journey_groups":6,"broad_regression":"deliberately_omitted_by_user","full_acceptance_closed":False,"release":cp["release"]}
for row in ledger["requirements"]:
 if row["id"]=="REQ-085":
  row["implemented_scope"]+="；151新增雙方確認的統一企業所有權交接、收件提示、撤銷/拒絕/過期、原子角色變更與後台按範圍取消。"
  row["current_audit_remaining"]="統一所有權交接與歸檔恢復均已實現，不能再列為未實現。全部帳戶/成員狀態、在途任務策略、平台營運及完整跨端競爭矩陣仍需驗收。"
  row["current_review_note"]+=" 151：9項真實SQL/HTTP定向檢查、6組實際Web/Desktop/Admin操作與8步三端構建通過。先前將歸檔恢復仍列為缺失的描述已過時，以149實現與當前碼為準。"
assert len(ledger["requirements"])==102 and ledger["summary"]["required_open"]==88
put(ROOT/"docs/quality/remaining-work-stage151.json",json.dumps(ledger,ensure_ascii=False,indent=2)+"\n")
lines=["# 当前完整待项 / Remaining whole acceptance — Stage151","","151已补齐企业所有权交接；完整导出等实际功能与原始完整验收范围继续保留。88项是必需完整验收范围，并非88个未实现模块。","","| 编号 | 模块 | 完整验收 | 仍待完成 |","|---|---|---|---|"]
for row in ledger["requirements"]:lines.append("| "+" | ".join(str(v).replace("|","\\|").replace("\n"," ") for v in [row["id"],row["module"],row["full_acceptance"],row.get("current_audit_remaining",row["remaining"])])+" |")
put(ROOT/"docs/quality/remaining-work-stage151.md","\n".join(lines)+"\n")
diagram="""```mermaid
flowchart LR
 A[Current workspace owner] --> B[Exact recipient and workspace confirmation]
 B --> C[Pending for 24 hours]
 C --> D[Recipient personally accepts]
 D --> E[Lock current users and memberships]
 E --> F[Promote recipient and demote former owner atomically]
 C --> G[Decline / cancel / expire / invalidate]
 F --> H[Minimal auditable history]
 G --> H
```"""
guide="""# 企業所有權交接 / Workspace ownership handover

本輪為首個凍結版之後的開發增量151；v0.1.0-rc.1原標籤和五個ZIP保留。

**客戶流程 / Customer workflow**：owner在「成員與權限」找到接收方，點「交接所有權」，輸入目前企業全名及確認責任。接收方必須是同企業啟用且未被暫停的非owner成員；不能自行交給另一郵箱而跳過成員加入。每企業最多一筆待確認，有效期24小時。原權限維持到接收方親自登入確認；接收方可拒絕，來源方/其他現有owner可撤銷。

Owners choose an existing active non-owner member from Members & access, review the exact recipient, type the current workspace name and acknowledge responsibility. Only one pending intent exists per workspace for24 hours. The signed-in named recipient sees a workspace notice and can accept or decline in Members & access even without member-management rights. Before acceptance, roles stay unchanged. Acceptance makes the recipient an owner and the former owner an admin in one transaction; other owners keep their roles.

**權限與業務 / Authority and business behavior**：雙方帳戶授權及成員版本、有效登入、當前owner/接收方狀態、企業狀態、永久刪除標記與有效期皆在提交時核對。排序取得帳戶鎖及實體users行共享鎖，覆蓋SSO直接撤權；再取得成員、企業及交接鎖。會員或帳戶授權版本變更使舊意向失效。重試終態不重新提升角色或回退後續權限變更。先提升再降級，避免無owner視窗；審計與兩筆角色變更原子提交。

Current user/account and membership versions, exact session, workspace state, deadline and permanent-erasure fences are rechecked. Sorted physical account locks serialize SSO withdrawal before role writes. Both membership updates and the terminal audit commit together; terminal retries do not regrant access. Decline, cancellation and expiry do not change member roles. Existing personal conversations/files, task actors, billing identity, incurred costs and local OS permission are separate; handover does not rewrite them. Running work continues under its original actor and current authorization/accounting rules.

**管理後台 / Admin**：使用原有用戶詳情→管理企業成員入口查看交接和取消。要求當前企業成員寫入權限admin.tenants.members.write與近期MFA，重疊project deny阻止整企業動作。管理員不能代接收方接受。既有特權會員變更仍走原獨立審批流程。沒有新增共用密碼、交接令牌或外部連結。最小治理ID、版本、固定狀態理由及審計保留；不保存企業名稱快照、自由文字理由或登入憑證。

Admin uses the existing user membership manager to inspect and cancel. Tenant membership-write permission, recent MFA and overlapping project-deny rules apply. Operators cannot impersonate recipient acceptance or bypass existing independent privileged membership review. Only minimal governance IDs, versions, controlled state reasons and audit survive; current access still controls reads.

**必要驗證 / Focused qualification**：9項實際SQL/HTTP檢查、6組Web/真實Windows目錄包/Admin操作、6張PNG和3組GIF/MP4。8步三端構建及12項本機/雲端邊界檢查通過；Desktop仍無原生菜單、無可見側欄滾動軌及橫向溢出。本輪無模型請求或新增AI費用，省略廣泛歷史、跨OS及生產完整矩陣。backend01是夾具引用不存在的會話欄位，原失敗及執行器保留；backend02修正查詢後全部通過。

Nine targeted real backend cases and six actual three-client journey groups passed. Eight build steps include the unsigned Windows candidate and12 native-surface boundaries. All task-owned browsers, native windows, API and disposable native database are closed. Broad historical, production and cross-OS regression was deliberately omitted. This handover increment is implemented; original full account/inflight and whole-product acceptance remain open. Current Desktop candidate: release/ownership-transfer-151-01/win-unpacked.

[八項需求 / Requirements](../requirements/17-ownership-transfer.md) · [API](../contracts/ownership-transfer-openapi.json) · [完整待項 / Full ledger](../quality/remaining-work-stage151.md) · [凍結版 / Frozen release](../releases/v0.1.0-rc.1.md)

"""+diagram+"\n"
for item in j["screenshots"]:
 if item["path"].endswith(("recipient-accepted-en.png.png","ownership-accepted-en.png.png","handover-cancelled-en.png.png")):
  source=DEV/item["path"];guide+="\n![Actual recorded UI](../assets/ownership-transfer-151/"+source.parent.parent.parent.name+"__"+source.name+")\n"
put(ROOT/"docs/development/151-ownership-transfer.md",guide)
put(ROOT/"docs/changes/151-ownership-transfer.md","# Stage151 更新 / Changes\n\n| 编号 | 本轮事项 | 状态 |\n|---|---|---|\n| 1 | 企业owner发起、指定成员亲自接受 | 已实现 |\n| 2 | 原子角色交接、拒绝/撤销/过期及撤权失效 | 已实现 |\n| 3 | Web/Desktop收件提示与交接历史 | 实际操作通过 |\n| 4 | 后台按范围及MFA查看/取消 | 实际操作通过 |\n| 5 | 双语README、流程图、PNG/GIF/MP4与Windows候选 | 已交付 |\n| 6 | 完整导出、真实服务、签名及原全量验收 | 待完成 |\n\n[使用与实现 / Guide](../development/151-ownership-transfer.md) · [完整编号 / Ledger](../quality/remaining-work-stage151.md)\n")
for repo in ["platform","web","admin","desktop","extension","delivery"]:
 folder=DEV/("copypaste-"+repo)
 for english in [False,True]:
  p=folder/("README.en.md" if english else "README.md");old=p.read_text(encoding="utf-8");assert "<!-- ownership-transfer-151 -->" not in old
  intro=("**Unreleased increment151 — explicit workspace ownership handover**\n\nAn owner selects an active existing non-owner member in Members & access, confirms the exact workspace name and requests a24-hour handover. Only the named recipient accepts; their workspace notice leads to the inbox. Acceptance atomically makes the recipient an owner and the source an admin. Decline/cancel/expiry or changed authorization cannot grant roles. Existing private authorship, task actors, billing identity and OS permission stay separate. Admin inspects/cancels through its existing membership manager with current tenant permission and recent MFA; independent privilege approvals remain required.\n\n9 targeted backend cases,6 actual Web/Desktop/Admin groups,8 build steps and12 native-surface boundaries passed;6 real screenshots and3 GIF/MP4 pairs are retained. Broad production/history/OS regression was deliberately omitted; no AI model was called. Full exports, real providers/advertising accounts, signing and whole-product acceptance remain open. Frozen v0.1.0-rc.1 tags and five archives remain intact.\n\n" if english else "**未凍結增量151：企業所有權交接**\n\nowner從「成員與權限」選擇同企業啟用的非owner成員，核對企業全名及責任，發起24小時交接。指定接收方由工作區提示進入收件區親自確認；完成時接收方成為owner、來源方成為admin，原子提交。拒絕/撤銷/過期或授權變更不會提升角色。私人資料、在途任務、付款主體與本機權限不移轉。後台在原成員管理中依當前範圍、MFA及明確拒絕查看/取消，不能代客戶接受；原特權審批繼續適用。\n\n9項定向後端、6組實際三端流程、8步構建及12項本機邊界檢查通過，保留6張真實截圖與3組GIF/MP4；按要求省略廣泛歷史/生產/OS回歸，沒有呼叫AI。完整導出、真實供應方/廣告帳戶、簽名及完整驗收仍待完成。首個凍結v0.1.0-rc.1標籤與五個ZIP保留。\n\n")
  same=repo if repo in ["web","desktop","admin"] else "web"
  cover=next(m for m in media if m["path"].startswith("copypaste-"+same+"/") and m["path"].endswith(("recipient-accepted-en.png.png","ownership-accepted-en.png.png","handover-cancelled-en.png.png")))
  gif=next(m for m in media if m["path"].startswith("copypaste-"+same+"/") and m["path"].endswith(".gif"));mp4=next(m for m in media if m["path"].startswith("copypaste-"+same+"/") and m["path"].endswith(".mp4"))
  text="<!-- ownership-transfer-151 -->\n\n"+intro+diagram+"\n\n"+("Actual component journey." if repo in ["web","desktop","admin"] else "Shared actual Web illustration; no new UI acceptance for this component.")+"\n\n![Actual screen](assets/screenshots/"+Path(cover["path"]).name+")\n\n![Actual interaction](assets/screenshots/"+Path(gif["path"]).name+")\n\n[Actual MP4](assets/screenshots/"+Path(mp4["path"]).name+")\n\n---\n\n"
  p.write_bytes((text+old).encode("utf-8"))
for name in ["README.md","README.en.md"]:
 p=ROOT/"docs"/name;old=p.read_text(encoding="utf-8");p.write_bytes(("<!-- ownership-transfer-151 -->\n\n[企業所有權交接 / Ownership handover](development/151-ownership-transfer.md) · [完整待項 / Ledger](quality/remaining-work-stage151.md) · [更新 / Changes](changes/151-ownership-transfer.md)\n\nUnreleased increment151; frozen v0.1.0-rc.1 preserved. Focused checks only; original full acceptance stays open.\n\n---\n\n"+old).encode("utf-8"))
print(json.dumps({"status":"recorded","backend_cases":9,"actual_client_groups":6,"whole_acceptance_closed":0,"required_whole_scopes_open":88},ensure_ascii=False))
