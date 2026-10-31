# Record the bounded reviewed specialist-copy increment; preserve the first frozen release.
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json, re, sys

ROOT=Path(r"D:\dev\copypasted\自有agent"); DEV=ROOT/"dev"
D=DEV/"copypaste-delivery"; E=D/"evidence/conversation-directory-156"
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

baseline=read(D/".data/conversation-directory-156/baseline.json")
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
for label,n in [("tests",7),("pass",7),("fail",0),("skipped",0)]:
 assert re.search(r"^# "+label+" "+str(n)+r"\s*$",raw,re.M)
j=read(E/("ui-"+ui_attempt+"-journey.json"))
assert j["status"]=="passed" and len(j["checks"])==5 and not j["errors"]
assert all(j[k] for k in ["browser_closed","api_closed","fixture_closed"])
assert len(j["screenshots"])==7 and len(j["recordings"])==2
media=list(j["screenshots"])
for recording in j["recordings"]:
 assert recording["distinct_frames"]>=2 and recording["skipped_capture_errors"]==0
 media.extend(recording["files"])
cover=next(m for m in media if m["path"].endswith("-first-page.png"))
gif=next(m for m in media if m["path"].endswith(".gif"))
mp4=next(m for m in media if m["path"].endswith(".mp4"))
copies=[]
for m in media:
 a=DEV/m["path"]; assert digest(a)==m["sha256"]
 copies.append(copy(a,ROOT/"docs/assets/conversation-directory-156"/a.name))
for repo in ["platform","admin","desktop","extension","delivery"]:
 for m in [cover,gif,mp4]:
  copies.append(copy(DEV/m["path"],DEV/("copypaste-"+repo)/"assets/screenshots"/Path(m["path"]).name))
scope="Private conversation directory beyond200 records across Web/Desktop/Extension, signed current-scope keyset pages, search/archive and original chat continuation; canonical contract list and live session checks. No frozen full-list snapshot, whole-product acceptance or new frozen binary."
cp={"at":datetime.now(timezone.utc).isoformat(),"status":"verified_conversation_directory_increment",
 "stage":156,"schema_version":154,"release":"unreleased_after_v0.1.0-rc.1","frozen_release_unchanged":True,
 "baseline":baseline,"backend_cases":7,"actual_journey_groups":5,"screenshots":7,"recordings":2,
 "broad_regression":"deliberately_omitted_by_user","model_mode":"synthetic_no_model_request",
 "new_full_acceptance_closures":0,"source_files":sources,"reports":reports,"media":media,
 "shared_media_copies":copies,"scope":scope,"recorder_sha256":digest(Path(__file__))}
put(ROOT/"docs/quality/conversation-directory-checkpoint-156.json",json.dumps(cp,ensure_ascii=False,indent=2)+"\n")

ledger=read(ROOT/"docs/quality/remaining-work-stage155.json")
ledger.update(schema_version=ledger["schema_version"]+1,current_stage=156,reviewed_at=cp["at"],checkpoint="docs/quality/conversation-directory-checkpoint-156.json",previous_review=ref(ROOT/"docs/quality/remaining-work-stage155.json"),new_full_acceptance_closures=0)
ledger["current_increment"]={"stage":156,"scope":scope,"backend_cases":7,"actual_client_journey_groups":5,"broad_regression":"deliberately_omitted_by_user","full_acceptance_closed":False,"release":cp["release"]}
for row in ledger["requirements"]:
 if row["id"]=="REQ-061":
  row["implemented_scope"]+="；156会话目录取消首200条截断，三端增加分页/搜索/封存；标准GET /v1/conversations支持项目可选范围，精确时间与ID排序和当前会话权限守卫。"
  row["current_audit_remaining"]="三端目录分页、同名/封存超过200条、旧空会话重开及当前会话撤销已补齐；原全部多任务消息定位/补充、删除和长期记忆组合、安装版/浏览器矩阵及生产规模完整验收仍开放。目录是实时keyset分页，内容变化后可刷新，不声明冻结全目录快照。"
 if row["id"] in ["REQ-003","REQ-035","REQ-036","REQ-039","REQ-061"]:
  row["current_review_note"]=row.get("current_review_note","")+" 156：7项实际SQL/HTTP检查含Extension控制器；5组实际Web旅程、7张PNG和2组GIF/MP4。更换/重置范围抛弃迟到目录响应，新建会话不使历史加载卡住。共享会话权限守卫原样提取，完整验收不缩减。"
assert len(ledger["requirements"])==102 and ledger["summary"]["required_open"]==88
put(ROOT/"docs/quality/remaining-work-stage156.json",json.dumps(ledger,ensure_ascii=False,indent=2)+"\n")
lines=["# 当前编号待项 / Remaining acceptance —156","","88项表示必需完整验收范围，不等于88个未实现模块。本轮按快速发版要求只验证受影响的主使用流程。","","| 编号 | 模块 | 完整验收 | 仍待完成 |","|---|---|---|---|"]
for row in ledger["requirements"]:
 lines.append("| "+" | ".join(str(v).replace("|","\\|").replace("\n"," ") for v in [row["id"],row["module"],row["full_acceptance"],row.get("current_audit_remaining",row["remaining"])])+" |")
put(ROOT/"docs/quality/remaining-work-stage156.md","\n".join(lines)+"\n")
fence=chr(96)*3
diagram=fence+"""mermaid
flowchart TD
 A[Open private conversation directory] --> B[Current user, exact session and authorized projects]
 B --> C[Search and archived filter]
 C --> D[Page by pinned, exact activity time and ID]
 D --> E{More rows?}
 E -->|Yes| F[Signed cursor / next page]
 F --> B
 E -->|No| G[End of current directory]
 D --> H[Open original conversation]
 H --> I[Continue original context and task links]
 C --> J[Changed filter / refresh returns to first page]
 B --> K[Withdrawn session / clear private results]
"""+fence
put(ROOT/"docs/requirements/22-conversation-directory.md","""# 完整会话目录 / Complete private conversation directory

细化原REQ-061，不新增原始需求数量。首200条上限曾使同名或名称不详的旧空会话没有继续浏览入口；知道独特名称或ID仍能找回，不将旧情况描述为所有旧会话均不可访问。

| 编号 | 需求约束 / Requirement |
|---|---|
| 1 | 当前用户可在当前有权项目中完整浏览自己的正常或已封存会话，不因超过200条而被截断。 |
| 2 | 按置顶、活动时间和ID降序稳定排序，时间游标保留数据库微秒，下一页不重复或跳过静态目录中的同时间行。 |
| 3 | 搜索使用名称的大小写不敏感字面匹配，先筛选再分页；同名结果和封存结果同样支持继续浏览。 |
| 4 | 游标签名绑定当前用户、exact session、身份版本、企业、项目或全企业范围、筛选、页量及30分钟有效期；每页重新查权限与可见状态。 |
| 5 | Web/Desktop显示上一页、下一页、当前页和刷新；换用户、项目、搜索或封存筛选回到第一页。 |
| 6 | Extension在原生右侧Side Panel增加搜索、封存和前后页；浏览目录不切换当前对话或清空草稿、附件、待确认回执。 |
| 7 | 新建会话与目录请求使用独立的状态校验；换范围/reset丢弃迟到响应；读取失败不保留旧目录结果。 |
| 8 | 标准GET /v1/conversations按既有接口定义支持可选project_id，缺省只跨当前有权项目；返回规范title等字段，旧端点保持兼容。 |
| 9 | 当前列表使用实时keyset分页，不是冻结的导出快照；修改/置顶/删除等变化后可刷新查看当前目录。 |

Users can browse every private conversation beyond the former200-row cap, including archived and same-name records. Every page requires current authority. Directory navigation preserves the open Extension chat and its pending receipt; scope changes discard late replies.

[方案 / Implementation](../development/156-conversation-directory.md) · [接口 / API](../contracts/conversation-directory-openapi.json)
""")
put(ROOT/"docs/development/156-conversation-directory.md","""# 会话目录闭环 / Private conversation directory

用户路径：我的会话 → 搜索或切换已封存 → 下一页/上一页 → 打开原会话继续。Web和Desktop每页40条；扩展保留原生右侧栏及原来的首批200条，增加继续浏览、搜索、封存和刷新。扩展翻页不改变当前对话、未发送文字、附件和受理待确认消息。

Journey: Your conversations → search or Archived → next/previous page → open the original conversation. Web/Desktop use40 rows. The native Side Panel preserves its200-row initial compatibility and adds browsing/search/archive. Browsing does not replace its open chat, draft, attachments or pending receipt.

"""+diagram+"""

新增conversation-directory.ts，legacy GET /v1/tenants/:tenant/projects/:project/conversations与规范GET /v1/conversations共用目录查询。规范接口遵循既有ConversationList/Conversation字段：items、next_cursor、title和last_activity_at等；project_id缺省时按企业成员角色和当前项目绑定筛选本人会话。规范页量1–100、默认40，legacy1–200、默认200，旧客户端可忽略新增next_cursor。

游标包含置顶位、SQL UTC六位微秒时间和UUID，三列均降序并用元组小于号继续，查询limit+1识别后续页。HMAC绑定当前身份/会话、企业、项目可空范围、过滤摘要、页量和30分钟期限；不接受伪造、换筛选、换页量、换会话或超期游标。每页复查exact session、企业/项目当前权限，并只返回本人active会话。

原agent-adoption的authority按原锁顺序提取为project-authority.ts，保留写入/管理检查，增加只读项目及企业范围读取。agent-copy复用同一实现。用户、exact session、联邦身份及成员在短事务内检查；跨项目读取在SQL中再次限制非归档项目及当前项目成员关系，不能因持有游标扩大范围。仅目录元数据，不缓存消息正文。

Web/Desktop用独立游标栈和身份/项目/搜索/封存组合，筛选改变即用第一页；失败清空数据并提供刷新。Extension新增browseHistory，独立historyRevision与scope引用决定回执有效性，选择/新建对话不再使历史加载永久卡住；reset使旧响应失效。该目录按当前数据翻页，不声明并发修改时固定旧排序；刷新回到当前第一页，批量导出快照是另一独立能力。

7项实际SQL/HTTP检查通过，包含235条同名正常会话及207条同名封存会话、精确微秒排序、规范字段/跨项目/他人数据拒绝、撤会话竞争，以及Extension实际HTTP控制器在响应延迟时新建/reset。5组实际Web旅程验证邮件OTP、6页浏览重开旧空会话、封存及搜索重置、繁中390px、撤销后清空并登录。7张PNG、2组GIF/MP4；后端/Web/Desktop/Extension受影响构建通过。没有新SQL迁移，数据库仍154。

保留ui01失败：浏览器夹具在每次载入时强制改回英文，导致繁中按钮无法定位；新版通过真实语言按钮切换并断言zh-Hant-HK和繁中标题。也确认155的compact截图实际为英文，其390px布局证据有效，不能作为繁中验收；原图/报告不改写，本轮实际繁中证据独立补齐。

保留backend01失败：夹具将项目只读角色误写为reader，实际值为viewer；延迟夹具同时拦住新建会话需要的项目配置请求，造成夹具等待环。确认在运行的精确测试子进程后仅结束该子进程，父验证器正常回收夹具和原生数据库；新v2仅延迟目录响应并加限定超时。产品代码不为夹具改角色或放宽守卫。独立只读反证发现的目录/新会话状态竞态已修复后复核。

Actual Web and native SQL/HTTP evidence only. The Extension controller calls the real API during backend checks; no new installed Side Panel or Desktop window run is claimed. No model call. Broad historical, production-provider, cross-OS and full lifecycle acceptance are intentionally omitted under the fast-release instruction. This source increment follows the first frozen candidate; frozen artifacts/tags are unchanged.

[需求 / Requirements](../requirements/22-conversation-directory.md) · [限定证据 / Evidence](../quality/conversation-directory-checkpoint-156.md) · [完整待项 / Remaining acceptance](../quality/remaining-work-stage156.md)
""")
put(ROOT/"docs/quality/conversation-directory-checkpoint-156.md","""# 会话目录定向核查 / Focused directory qualification —156

7项后端实际SQL/HTTP检查通过：超过200条的置顶/微秒/ID完整遍历；封存与同名/字面搜索；伪造/范围/页量/会话/期限游标拒绝；置顶、封存及隔离反映到当前目录；规范接口的可选项目范围与字段及其他用户/无权项目拒绝；认证后撤销exact session拒绝；Extension真实API翻页保留会话草稿回执，延迟期间新建会话不锁死、reset丢弃旧响应。

5组实际Web旅程通过：邮件OTP进入授权项目；6页浏览到旧上限外并打开原空会话；207个同名封存记录及搜索筛选重置；繁中390px无横向溢出；撤会话后下一页拒绝并清除目录返回登录。7张PNG、2组GIF/MP4记录真实页面。数据夹具明确为模拟业务资料，复制和目录均不请求模型。

绑定精确源码及原始报告，执行期间不改写。backend01/ui01失败及最终成功回执分别保留；ui01夹具重载时强制英文，新版通过实际语言按钮并断言繁中lang和标题。155的compact截图也只能证明英文390px布局，原证据不改写，本轮新增真正繁中证据；首轮夹具错误和人工结束精确子进程的原因见开发说明。所有自建浏览器、API、预览及原生数据库关闭，夹具回收通过；无Docker/WSL。

后端/Web/Desktop/Extension受影响编译与构建通过，Admin本轮没有产品代码修改。Desktop renderer及Extension控制器检查不等同于新安装版、原生窗口或正式模型验收。全历史/跨OS、专业场景和完整权限组合按快速发版要求省略，原102条需求与88条必需完整验收范围保留。

The live directory uses scoped keyset pagination, not a frozen full-list snapshot. All7 focused backend checks and5 actual Web groups passed. First frozen v0.1.0-rc.1 artifacts/tags remain unchanged; this increment is source only.
""")
put(ROOT/"docs/changes/156-conversation-directory.md","""# 更新156 / Change156

补齐会话目录超过200条的浏览断层。Web/Desktop增加上一页、下一页和刷新；扩展在原生右侧栏增加目录搜索、封存和翻页，保留正在打开的聊天及待确认消息。标准会话列表接口按既有契约落地，当前会话和项目权限每页复查。

Private conversation directories are paged beyond200 same-name or archived records. Web/Desktop add page controls; the native Side Panel adds search/archive navigation while retaining the open chat and pending receipt. The documented canonical list is implemented with current authority. Schema154 and the first frozen artifacts remain unchanged.

[方案 / Implementation](../development/156-conversation-directory.md) · [证据 / Evidence](../quality/conversation-directory-checkpoint-156.md) · [完整待项 / Ledger](../quality/remaining-work-stage156.md)
""")
review={"requirement":"REQ-061","verdict":"partial","baseline_heads":baseline["heads"],"confirmed_old_gap":"Legacy LIMIT200 with no next_cursor or client paging hides same-name/unknown-name older empty conversations. Unique-name search and known-ID access remain valid alternative paths.","source_check":{"agent":"req032_check","mode":"read_only","searched":["GET legacy conversations query/response","Web/Desktop Conversations rendering and controls","Extension ConversationState/ChatPanel and storage receipt","canonical /v1/conversations implementation versus existing catalog contract"]},"independent_refutation":{"agent":"archive_149_refutation","mode":"read_only","confirmed_gap":True,"new_issue":"Extension historyLoading stuck after new-chat generation changes","fix":"History requests use scope reference plus independent historyRevision; reset invalidates replies","post_fix_result":"No further definite blocker found within reviewed scope"},"limits":"Static reviews do not prove runtime behavior or complete REQ061. Focused runtime source receipts are separate; full lifecycle acceptance remains open."}
put(ROOT/"docs/quality/conversation-directory-review-156.json",json.dumps(review,ensure_ascii=False,indent=2)+"\n")
contract={"openapi":"3.1.0","info":{"title":"Workmate private conversation directory supplement","version":"156"},"paths":{},"x-existing-canonical-contract":"catalog/openapi.json listConversations / ConversationList / Conversation remain unchanged","x-order":["pinned DESC","updated_at DESC with SQL UTC microseconds","id DESC"],"x-authority":"Every page rechecks current user/exact session/federation and tenant/project access; own active conversations only. Optional canonical project scope never grants another user's private conversations.","x-cursor":"HMAC, current actor/session/auth/tenant/project-or-null/filter/page size,30 minute lifetime. Invalid400; expired409. No model call or credentials.","x-live-pagination":"Live keyset directory; refresh after mutations for current order. This is not a frozen export snapshot.","x-schema-version":154}
for endpoint,canonicalRoute in [("/v1/conversations",True),("/v1/tenants/{tenant}/projects/{project}/conversations",False)]:
 params=[{"name":n,"in":"path","required":True,"schema":{"type":"string","format":"uuid"}} for n in ([] if canonicalRoute else ["tenant","project"])]
 if canonicalRoute:params += [{"name":"X-Tenant-ID","in":"header","required":True,"schema":{"type":"string","format":"uuid"}},{"name":"project_id","in":"query","schema":{"type":"string","format":"uuid"}}]
 params += [{"name":"q","in":"query","schema":{"type":"string","maxLength":160}},{"name":"archived","in":"query","schema":{"type":"boolean","default":False}},{"name":"limit","in":"query","schema":{"type":"integer","minimum":1,"maximum":100 if canonicalRoute else 200,"default":40 if canonicalRoute else 200}},{"name":"cursor","in":"query","schema":{"type":"string","minLength":1,"maxLength":2048}}]
 contract["paths"][endpoint]={"get":{"summary":"Browse currently authorized private conversations","parameters":params,"responses":{str(c):{"description":d} for c,d in [(200,"No-store items and next_cursor; canonical fields conform to frozen Conversation schema"),(400,"Invalid cursor/query or mismatched actor, session, scope or filters"),(401,"Current session unavailable"),(403,"Current authority denied"),(404,"Project or authorized scope unavailable"),(409,"Cursor expired; refresh directory")]}}}
put(ROOT/"docs/contracts/conversation-directory-openapi.json",json.dumps(contract,ensure_ascii=False,indent=2)+"\n")
for repo in ["platform","web","admin","desktop","extension","delivery"]:
 for filename,english in [("README.md",False),("README.en.md",True)]:
  p=DEV/("copypaste-"+repo)/filename;old=p.read_text("utf-8");assert "<!-- conversation-directory-156 -->" not in old
  intro=("Your conversations → search or Archived → next/previous page → open the original conversation. Same-name and archived records beyond200 are now browsable. Web/Desktop use40-row pages. The native Side Panel preserves its200-row initial compatibility and adds search/archive/page controls without replacing the open chat, draft, attachments or pending receipt. Every page rechecks current authority." if english else "我的会话 → 搜索或已封存 → 下一页/上一页 → 打开原会话继续。同名及封存记录超过200条也可完整浏览。Web/Desktop每页40条；扩展保留原生右侧栏及原首批200条，增加搜索、封存与翻页，浏览不切换当前聊天或清空草稿、附件和待确认消息。每页重新检查当前权限。")
  note="Media below show actual Web controls with synthetic business fixtures; directory reads make no model request."
  if repo=="desktop":note+=" Customer-local Codex/full permissions and frameless UI remain. Shared renderer build only; no new installed-client run."
  if repo=="extension":note+=" The controller is checked against the actual SQL/HTTP API, including delayed new-chat/reset responses; full extension build only, no new native panel run."
  if repo=="admin":note+=" Shared API behavior; no product-source or Admin UI change in156."
  text="<!-- conversation-directory-156 -->\n\n"+intro+"\n\n"+diagram+"\n\n"+note+"\n\n"
  text+="Evidence correction: stage155 compact capture was English because its fixture reset locale on reload; it proves390px layout only. Stage156 switches the actual language control and asserts Chinese lang/title. Historical evidence remains unchanged.\n\n"
  text+="7 focused SQL/HTTP checks and5 actual Web groups;7 PNGs and2 GIF/MP4 pairs. Backend/Web/Desktop/Extension checks and builds passed. Canonical GET /v1/conversations supports an optional project filter; legacy listing remains compatible. Live keyset pagination, not a frozen snapshot. Schema154; no new migration. Broad/installed-client/cross-OS/production matrices omitted. Unreleased after v0.1.0-rc.1; frozen artifacts and tags preserved.\n\n"
  text+="[方案 / Implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/development/156-conversation-directory.md) · [API](https://github.com/copypasteltd/workmate/blob/docs/docs/contracts/conversation-directory-openapi.json) · [完整待项 / Ledger](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage156.md)\n\n"
  text+="![Actual Web directory](assets/screenshots/"+Path(cover["path"]).name+")\n\n![Actual Web paging](assets/screenshots/"+Path(gif["path"]).name+")\n\n[Actual MP4](assets/screenshots/"+Path(mp4["path"]).name+")\n\n---\n\n"
  p.write_bytes((text+old).encode("utf-8"))
for filename in ["README.md","README.en.md"]:
 p=ROOT/"docs"/filename;old=p.read_text("utf-8");assert "<!-- conversation-directory-156 -->" not in old
 p.write_bytes(("<!-- conversation-directory-156 -->\n\n[完整会话目录 / Private conversation directory](development/156-conversation-directory.md) · [API](contracts/conversation-directory-openapi.json) · [限定证据 / Evidence](quality/conversation-directory-checkpoint-156.md) · [当前编号 / Ledger](quality/remaining-work-stage156.md) · [更新 / Changes](changes/156-conversation-directory.md)\n\nUnreleased156; first frozen v0.1.0-rc.1 preserved.7 focused backend checks /5 actual Web groups. No new migration; schema154.\n\n---\n\n"+old).encode("utf-8"))
print(json.dumps({"status":"recorded","backend_cases":7,"actual_ui_groups":5,"screenshots":7,"recordings":2,"whole_acceptance_closed":0}))
