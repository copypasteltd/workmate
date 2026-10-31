# Record the bounded reviewed specialist-copy increment; preserve the first frozen release.
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json, re, sys

ROOT=Path(r"D:\dev\copypasted\自有agent"); DEV=ROOT/"dev"
D=DEV/"copypaste-delivery"; E=D/"evidence/specialist-copy-155"
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

baseline=read(D/".data/specialist-copy-155/baseline.json")
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
cover=next(m for m in media if m["path"].endswith("-review-original-brand.png"))
gif=next(m for m in media if m["path"].endswith(".gif"))
mp4=next(m for m in media if m["path"].endswith(".mp4"))
copies=[]
for m in media:
 a=DEV/m["path"]; assert digest(a)==m["sha256"]
 copies.append(copy(a,ROOT/"docs/assets/specialist-copy-155"/a.name))
for repo in ["platform","admin","desktop","extension","delivery"]:
 for m in [cover,gif,mp4]:
  copies.append(copy(DEV/m["path"],DEV/("copypaste-"+repo)/"assets/screenshots"/Path(m["path"]).name))
scope="Reviewed same-project specialist copy retains original fixed brand, template provenance, Codex/model/rate/skill versions and narrower tools; current session/source checks, single creation and private-data exclusions. No whole-product acceptance or new frozen binary."
cp={"at":datetime.now(timezone.utc).isoformat(),"status":"verified_specialist_copy_increment",
 "stage":155,"schema_version":154,"release":"unreleased_after_v0.1.0-rc.1","frozen_release_unchanged":True,
 "baseline":baseline,"backend_cases":7,"actual_journey_groups":5,"screenshots":7,"recordings":2,
 "broad_regression":"deliberately_omitted_by_user","model_mode":"synthetic_no_model_request",
 "new_full_acceptance_closures":0,"source_files":sources,"reports":reports,"media":media,
 "shared_media_copies":copies,"scope":scope,"recorder_sha256":digest(Path(__file__))}
put(ROOT/"docs/quality/specialist-copy-checkpoint-155.json",json.dumps(cp,ensure_ascii=False,indent=2)+"\n")

ledger=read(ROOT/"docs/quality/remaining-work-stage154.json")
ledger.update(schema_version=ledger["schema_version"]+1,current_stage=155,reviewed_at=cp["at"],checkpoint="docs/quality/specialist-copy-checkpoint-155.json",previous_review=ref(ROOT/"docs/quality/remaining-work-stage154.json"),new_full_acceptance_closures=0)
ledger["current_increment"]={"stage":155,"scope":scope,"backend_cases":7,"actual_client_journey_groups":5,"broad_regression":"deliberately_omitted_by_user","full_acceptance_closed":False,"release":cp["release"]}
for row in ledger["requirements"]:
 if row["id"]=="REQ-079":
  row["implemented_scope"]+="；155增加显式预览确认复制，固定原品牌、Codex、模型费率、skill及模板来源；可以改名、调整职责和缩小工具，不复制私有内容与授权。"
  row["current_audit_remaining"]="固定配置复制及现行来源/会话守卫已完成7项后端与5组真实Web旅程；全部企业模板覆盖项、升级组合、真实模型执行及安装版Desktop的完整矩阵仍待验收。更换品牌/新版方法走既有比较采用，不在复制时暗中升级。"
 if row["id"] in ["REQ-079","REQ-003","REQ-098"]:
  row["current_review_note"]=row.get("current_review_note","")+" 155：复制事务内重验并锁定exact session；浏览器异步摘要返回后、发送前复查范围和会话。独立只读反证后修正，7项后端/5组实际Web旅程/7张PNG/2组GIF与MP4。完整验收不缩减。"
assert len(ledger["requirements"])==102 and ledger["summary"]["required_open"]==88
put(ROOT/"docs/quality/remaining-work-stage155.json",json.dumps(ledger,ensure_ascii=False,indent=2)+"\n")
lines=["# 当前编号待项 / Remaining acceptance —155","","88项表示必需完整验收范围，不等于88个未实现模块。按快速发版要求仅进行本次主闭环的定向验证。","","| 编号 | 模块 | 完整验收 | 仍待完成 |","|---|---|---|---|"]
for row in ledger["requirements"]:
 lines.append("| "+" | ".join(str(v).replace("|","\\|").replace("\n"," ") for v in [row["id"],row["module"],row["full_acceptance"],row.get("current_audit_remaining",row["remaining"])])+" |")
put(ROOT/"docs/quality/remaining-work-stage155.md","\n".join(lines)+"\n")
fence=chr(96)*3
diagram=fence+"""mermaid
flowchart TD
 A[Choose saved specialist / Copy] --> B[Name, instructions, narrower approved tools]
 B --> C[Review original source and fixed versions]
 C --> D[Explicit confirmation]
 D --> E[Lock and recheck current session and project]
 E --> F{Original source, brand, skills and prices still usable?}
 F -->|No| G[Clear review / reload source]
 F -->|Yes| H[One signed preview creates one independent copy]
 H --> I[Retry recovers the same receipt]
 H --> J[New tasks use retained definition]
 J --> K[Use existing compare/adopt for later changes]
"""+fence
put(ROOT/"docs/requirements/21-specialist-copy.md","""# 固定版本专家复制 / Reviewed specialist copying

本项细化原REQ-079，不增加原始需求数量。适用于Web和Desktop共享的云端专家设置；Extension从Web打开设置。本次修改在首个冻结版之后，未加入冻结ZIP。

| 编号 | 约束 / Requirement |
|---|---|
| 1 | 复制指定当前项目中可用的精确专家版本；仅改名、工作说明及缩小获准工具。 |
| 2 | 保留原Codex运行时、角色摘要、模型及费率版本、skill安装和版本、固定品牌版本及模板来源。后来发布品牌v2不得令v1副本暗中升级。 |
| 3 | 提交前显示原版本和复制范围，并要求主动勾选确认；预览有效10分钟。 |
| 4 | 确认必须绑定原用户、exact session、身份版本、企业、项目、来源版本、提案及当前守卫。事务内先验会话和权限，再处理来源与幂等。 |
| 5 | 来源改变、品牌隔离、skill停用、权限或会话撤销时拒绝新复制，清空旧预览。不得自行安装或启用skill。 |
| 6 | 一个签名预览仅产生一个副本，即使重试更换HTTP幂等键。受理后丢失响应可恢复原回执；删除副本后不能重建。 |
| 7 | 不复制对话、私人记忆、文件、连接凭据、连接授权或本机完整权限。复制配置本身不请求模型或产生模型费用。 |
| 8 | 退出、换账号、切换项目或关闭预览后，未发送的异步操作不得继续提交；已受理操作按同一回执恢复。 |
| 9 | 不修改原专家和旧任务的固定绑定；更换品牌或升级方法使用既有比较与明确采用流程。 |

A copy retains the source definition instead of resolving the latest defaults. It is independent configuration inside the same authorized project. Private content and permissions are excluded. Brand/method upgrades require the existing compare-and-adopt flow.

[实现 / Implementation](../development/155-specialist-copy.md) · [接口 / API](../contracts/specialist-copy-openapi.json)
""")
put(ROOT/"docs/development/155-specialist-copy.md","""# 专家复制闭环 / Reviewed fixed specialist copies

用户路径：我的专家 → 复制 → 调整名称、职责、获准工具子集 → 查看原品牌/模型/费率/方法版本 → 勾选确认 → 创建独立副本。网络响应丢失时保持同一提案重试；来源被修改时清空比较并重新载入，不生成未经确认的配置。

Customer journey: Your specialists → Copy → edit name/instructions or narrow tools → review original brand/models/rates/methods → explicitly confirm. A lost accepted response recovers the same copy. A changed source invalidates the review.

"""+diagram+"""

后端新增agent-copy.ts。prepare锁住active来源并核对精确版本，复用当前能力、skill安装与品牌绑定守卫；固定定义按白名单复制，保留模板来源，不调用重新解析当前默认值的agentDefinition。共享persistSpecialist保留现有200个专家上限，并串行化创建/复制计数。角色和品牌在复制表单只读，工具仅可取原批准子集。

两路接口在所有来源/replay锁前复用agent-adoption的authority：按原锁顺序复查用户、exact session、联邦身份、成员及项目。预览即使命中缓存，也先重新验证来源。10分钟HMAC签名绑定用户/会话/身份版本/企业/项目/来源/提案/当前安装版本。确认的HTTP幂等回执之外，再以签名预览摘要作逻辑幂等键；不同重试键仍只创建一次。回执恢复仅返回已存在且当前可访问副本的id/version，不重新生成已删除副本。

Web和Desktop共享CopyReview。WebCrypto摘要返回后、请求发送前检查组件生命周期、当前范围及会话代次；退出同步撤销未发送操作，清理完成后再次检查才回调。展示只使用明确允许的模型与费率字段，整数micro-HKD通过原有精确格式器显示，不暴露gateway指纹或凭据。

No new SQL migration: required database schema remains154. This increment changes backend creation/copy logic and Web/Desktop cloud configuration renderers. Desktop customer-local Codex ownership/full-permission design and Extension native right Side Panel remain as specified. Admin/Extension product source is unchanged; their readmes reference the shared behavior.

验证限于7项实际SQL/HTTP用例及5组实际Web操作，7张PNG、2组GIF/MP4；后端、Web及Desktop主进程/renderer类型与构建通过。配置复制不调用模型；业务夹具为明确假数据。未运行新安装版Desktop/SidePanel或全平台历史、生产提供方、跨OS与压力矩阵。原REQ-079完整验收仍开放。

保留ui01编译失败原证据：费率是整数数字，复用的精确micro-HKD显示器要求字符串，已在UI边界显式转换。独立只读反证发现的会话撤权和异步提交竞态均已修正；后端认证读取后撤销exact session的实际SQL/HTTP用例拒绝提交。既有backend01的6项成功证据保留，最终backend02增加上述用例并通过。此前冻结包及标签不变。

[需求 / Requirements](../requirements/21-specialist-copy.md) · [证据 / Evidence](../quality/specialist-copy-checkpoint-155.md) · [当前完整待项 / Remaining acceptance](../quality/remaining-work-stage155.md)
""")
put(ROOT/"docs/quality/specialist-copy-checkpoint-155.md","""# 专家复制定向核查 / Focused copy qualification —155

7项实际SQL/HTTP用例通过：发布新品牌后保留原配置；并发/响应丢失重试只产生一个副本及删除后不重建；改提案/伪造/来源更新拒绝；skill停用不重装；来源权限/品牌隔离/严格字段范围；不改变旧任务或克隆私有数据；认证读取后撤销exact session拒绝提交。

5组实际Web旅程通过：邮件OTP进入正确项目；原品牌v1与原模型费率方法的确认；服务端真实受理后故意丢失一次响应再重试恢复同一副本；繁中390px无横向溢出；确认前修改来源导致拒绝、清空及重新载入。7张实际PNG和2组实际GIF/MP4，Desktop renderer仅构建，无新安装版本运行声明。

所有检查绑定保存的精确源码，执行期间未改写。ui01编译失败、backend01成功及最终backend02/ui成功均保留；费率类型在客户端边界修复。独立只读检查与反证分别执行，发现的两处竞态已修正并复核。未增加SQL155，数据库仍154。

自建浏览器/API/预览/原生数据库均关闭，夹具清理通过；禁止Docker/WSL。复制不请求模型。全历史、安装/跨OS、真实提供方及完整企业矩阵按快速发版要求省略，原始完整验收范围不缩减。首个冻结版五个ZIP及七个标签不改写；GitHub Release网页附件仍受既有HTTPS凭据403限制，本轮不重复相同失败调用。

All7 focused backend cases and5 actual Web groups passed with source receipts. Private business fixtures are synthetic; copying configuration makes no model request. The first frozen artifacts remain unchanged; the source increment is unreleased.
""")
put(ROOT/"docs/changes/155-specialist-copy.md","""# 更新155 / Change155

修正复制专家时悄悄切换当前品牌、模型和skill并丢失模板来源的问题。副本先预览确认，再保留原固定版本，只允许调整职责和缩小工具；不带入私人内容、凭据或本机授权。响应丢失重试恢复原副本，来源更新或撤权拒绝继续提交。

Reviewed copies preserve the original Codex/model/rate/method/brand and template bindings. A signed confirmation creates one independent copy; retries recover its receipt. Current authority and source availability are rechecked. No new migration or rewritten frozen package.

[方案 / Implementation](../development/155-specialist-copy.md) · [证据 / Evidence](../quality/specialist-copy-checkpoint-155.md) · [编号待项 / Ledger](../quality/remaining-work-stage155.md)
""")
proposal={"type":"object","additionalProperties":False,"required":["source_version","name"],"properties":{"source_version":{"type":"integer","minimum":1},"name":{"type":"string","minLength":1,"maxLength":160},"instructions":{"type":"string","maxLength":8000},"tool_ids":{"type":"array","maxItems":40,"items":{"type":"string","minLength":1,"maxLength":120}}}}
contract={"openapi":"3.1.0","info":{"title":"Workmate reviewed specialist copy","version":"155"},"paths":{},"components":{"schemas":{"CopyProposal":proposal}}}
for suffix,summary,body in [("copy-previews","Review a copy using the exact original definition",{"$ref":"#/components/schemas/CopyProposal"}),("copies","Confirm one logical copy; retry recovers the same receipt",{"type":"object","additionalProperties":False,"required":["proposal","preview_token","acknowledged"],"properties":{"proposal":{"$ref":"#/components/schemas/CopyProposal"},"preview_token":{"type":"string","minLength":20,"maxLength":4096},"acknowledged":{"const":True}}})]:
 contract["paths"]["/v1/tenants/{tenant}/projects/{project}/agents/{id}/"+suffix]={"post":{"summary":summary,"parameters":[{"name":n,"in":"path","required":True,"schema":{"type":"string","format":"uuid"}} for n in ["tenant","project","id"]]+[{"name":"Idempotency-Key","in":"header","required":True,"schema":{"type":"string"}},{"name":"X-CSRF-Token","in":"header","schema":{"type":"string"},"description":"Required for browser cookie sessions; native bearer sessions use existing authentication rules"}],"requestBody":{"required":True,"content":{"application/json":{"schema":body}}},"responses":{str(c):{"description":d} for c,d in [(200,"No-store preview token/expiry/summary, or id/version confirmation receipt"),(400,"Strict request validation failure"),(401,"Current user/exact session unavailable"),(403,"Current write or tool scope denied"),(404,"Source, target or authorized scope unavailable"),(409,"Stale/expired preview, changed configuration or unavailable methods"),(410,"Content no longer available")]}}}
contract.update({"x-authority":"Current user/exact session/federation/project locks before replay and source locks; HMAC binds actor/session/auth/tenant/project/source/proposal/guards for10 minutes.","x-idempotency":"One signed preview creates one copy across different HTTP retry keys. Recovery returns an existing accessible copy, never resurrects deletion.","x-exclusions":["conversations","private memories","files","credentials","connection grants","local permissions"],"x-schema-version":154,"x-upgrades":"Copy retains source role, brand and methods. Use existing compare/adopt for changes. Copying configuration does not invoke a model."})
put(ROOT/"docs/contracts/specialist-copy-openapi.json",json.dumps(contract,ensure_ascii=False,indent=2)+"\n")
for repo in ["platform","web","admin","desktop","extension","delivery"]:
 for filename,english in [("README.md",False),("README.en.md",True)]:
  p=DEV/("copypaste-"+repo)/filename;old=p.read_text("utf-8");assert "<!-- specialist-copy-155 -->" not in old
  intro=("Your specialists → Copy → edit name/instructions or narrow approved tools → review original brand, model prices and methods → explicitly confirm. The copy retains original fixed versions and template provenance. Lost-response retries recover the same specialist; changed sources and withdrawn authority are rejected. Private content, credentials and local permissions are excluded." if english else "我的专家 → 复制 → 调整名称、职责或缩小工具 → 核对原品牌、模型费率与方法 → 勾选确认。副本保留原固定版本和模板来源；受理后丢失响应重试恢复同一副本，来源更新及撤权拒绝提交。对话、私人记忆、文件、凭据与本机权限不复制。")
  note="Media below show the actual Web flow; configuration copying makes no model request."
  if repo=="desktop":note+=" Customer-local Codex/full permissions and frameless UI remain. This round builds shared cloud configuration, without new installed-client acceptance."
  if repo=="extension":note+=" Specialist settings open Web; native right Side Panel/file consent is unchanged. No new panel run."
  if repo=="admin":note+=" Shared backend behavior; no new Admin UI acceptance claim."
  text="<!-- specialist-copy-155 -->\n\n"+intro+"\n\n"+diagram+"\n\n"+note+"\n\n"
  text+="7 focused SQL/HTTP cases and5 actual Web groups;7 PNGs and2 GIF/MP4 pairs. Backend/Web/Desktop checks and builds passed. Synthetic fixtures; no model call. No new SQL migration: schema154. Broad historical, installed-client/cross-OS and production-provider matrices omitted. Unreleased after v0.1.0-rc.1; all frozen artifacts and tags preserved.\n\n"
  text+="[方案 / Implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/development/155-specialist-copy.md) · [API](https://github.com/copypasteltd/workmate/blob/docs/docs/contracts/specialist-copy-openapi.json) · [完整待项 / Ledger](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage155.md)\n\n"
  text+="![Actual Web review](assets/screenshots/"+Path(cover["path"]).name+")\n\n![Actual Web interaction](assets/screenshots/"+Path(gif["path"]).name+")\n\n[Actual MP4](assets/screenshots/"+Path(mp4["path"]).name+")\n\n---\n\n"
  p.write_bytes((text+old).encode("utf-8"))
for filename in ["README.md","README.en.md"]:
 p=ROOT/"docs"/filename;old=p.read_text("utf-8");assert "<!-- specialist-copy-155 -->" not in old
 p.write_bytes(("<!-- specialist-copy-155 -->\n\n[专家复制 / Reviewed specialist copies](development/155-specialist-copy.md) · [API](contracts/specialist-copy-openapi.json) · [限定证据 / Evidence](quality/specialist-copy-checkpoint-155.md) · [当前编号 / Ledger](quality/remaining-work-stage155.md) · [更新 / Changes](changes/155-specialist-copy.md)\n\nUnreleased155; first frozen v0.1.0-rc.1 preserved.7 focused backend cases /5 actual Web groups. No new SQL migration; schema154.\n\n---\n\n"+old).encode("utf-8"))
print(json.dumps({"status":"recorded","backend_cases":7,"actual_ui_groups":5,"screenshots":7,"recordings":2,"whole_acceptance_closed":0}))
