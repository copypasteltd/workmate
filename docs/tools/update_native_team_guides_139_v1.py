"""Update bilingual guides from a passed native-team source-bound checkpoint."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import copy
import json

ROOT = Path(__file__).resolve().parents[2]
CP = ROOT / "docs/quality/native-teams-checkpoint-139.json"
cp = json.loads(CP.read_bytes())
assert cp["status"] == "verified_native_specialist_teams"
oldfile = ROOT / "docs/quality/remaining-work-stage138.json"
old = json.loads(oldfile.read_bytes())
value = copy.deepcopy(old)
notes = {
 "REQ-002": "阶段139增加本机团队发起人私有运行、原生登录族、固定设备／目录／Codex版本、精确角色与预算审批及整组撤权。全业务／异步权限矩阵保持原范围开放。",
 "REQ-039": "阶段139实际未签名Windows包以独立本机Codex会话并行执行代码和营销分工，依赖审阅读取前序实际文件，最后本机协调员汇总；保留完整授权、整组撤权、无边框／菜单及三档无可见滚动轨。全部工具、OS／DPI和签名安装矩阵仍开放。",
 "REQ-044": "阶段139新增真实本机Codex团队成员及协调员，固定版本、Skill和公司网关，原生任务不进入云端队列；全角色／计划／多节点故障及完整Worker恢复保留原验收范围。",
 "REQ-046": "阶段139团队审阅免费，固定每步／协调员及总预算；原键审批和结果核对，取消释放未执行预留，未知操作不重跑。全部生产费率、媒体和未知费用矩阵继续开放。",
 "REQ-060": "阶段139同步六端与文档中英README、团队逻辑图、真实Windows包截图／GIF／MP4、固定源码和原始失败；完整独立检出复现、签名安装和生产综合交付仍开放。",
 "REQ-066": "阶段139已补齐Desktop本机持久团队、角色分工、受控并行、实际依赖结果、本机协调汇总、整组停止／撤权和统一成果ZIP；受控模型内容下完成实际本机Codex及文件链路。全角色、全部失败重试、跨环境完整恢复及综合质量仍按原完整范围验收。此条保留未确认扩展建议的来源身份。",
 "REQ-075": "阶段139固定Codex／Skill执行实际本机成员、前序文件审阅及协调员，保留各自线程与输出。全角色／计划、所有恢复分支、未知费用及跨节点完整覆盖仍开放。",
 "REQ-089": "阶段139团队各步受当前套餐、并行槽位、预算和余额约束，协调员先预留等待，取消未执行预留；完整媒体／团队／调度与用户及企业额度、存储运营组合继续开放。",
 "REQ-102": "阶段139增加固定图、原生族、角色、预算、目录及设备的真实执行校验，当前权限撤回阻断后续派工；全媒体／团队／计划／席位／存储／额度及并发矩阵继续开放。",
}
for row in value["requirements"]:
 if row["id"] in notes:
  row["current_audit_remaining"] = notes[row["id"]]
  row["current_review_note"] = "阶段139补齐本机团队可用子流程，保留原始身份、完整验收范围及未完成状态。"
value["reviewed_at"] = datetime.now(timezone.utc).isoformat()
value["previous_review"] = {"path": oldfile.relative_to(ROOT).as_posix(), "sha256": sha256(oldfile.read_bytes()).hexdigest()}
value["checkpoint"] = {"path": CP.relative_to(ROOT).as_posix(), "sha256": sha256(CP.read_bytes()).hexdigest()}
value["new_full_acceptance_closures"] = 0
value["current_increment"] = {"stage":139,"scope":"实际Desktop本机团队：审批、并行分工、依赖审阅、协调汇总、撤权、费用核对及完整团队交付。","counts":cp["counts"],"required_full_acceptance_unchanged":True,"source_files":len(cp["source_files"])}
assert [r["id"] for r in value["requirements"]] == [r["id"] for r in old["requirements"]]
for before,after in zip(old["requirements"],value["requirements"]):
 for key in ["id","priority","module","recorded_assessment","remaining","full_acceptance","requirement_origin"]:
  assert before.get(key)==after.get(key), (before["id"],key)
ledger = ROOT / "docs/quality/remaining-work-stage139.json"
assert not ledger.exists()
ledger.write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
c=cp["counts"]
zh=f"{c['backend_integration_tests']}项后端、{c['extension_state_tests']}项扩展、{c['desktop_state_tests']}项本机控制／下载回归及6项实际Windows旅程通过；4张截图、1组GIF／MP4、3档布局及1个独立解压的完整团队包绑定{len(cp['source_files'])}份确切源码。"
en=f"{c['backend_integration_tests']} backend, {c['extension_state_tests']} extension and {c['desktop_state_tests']} native controller/download checks, plus six actual Windows journey checks passed. Four screenshots, one GIF/MP4 pair, three layouts and an independently extracted complete team archive bind {len(cp['source_files'])} exact source files."
intro="# 当前完整编号清单 · 阶段139\n\n保留102条原始需求身份与验收范围。REQ-095维持原验收；88条必需、12条未确认建议和1条可选记录继续完整验收，不能将101条开放验收记录理解为101个未编码模块。\n\n"+zh+" 模型／业务内容及本机选择窗口决定为受控假数据；登录、本机Codex、文件写入、撤权及成果包实际执行。\n\n[检查点](native-teams-checkpoint-139.json) · [原始证据](native-teams-evidence-139/index.json) · [变更](../changes/139-native-specialist-teams.md)\n\n| 编号 | 优先级 | 模块 | 当前状态 | 原完整验收的结论及余项 |\n| --- | --- | --- | --- | --- |\n"
rows=[f"| {r['id']} | {r['priority']} | {r['module']} | {r['audit_status']} | {r['current_audit_remaining'].replace('|','／')} |" for r in value["requirements"]]
ledger.with_suffix(".md").write_text(intro+"\n".join(rows)+"\n",encoding="utf-8",newline="\n")
base="https://github.com/copypasteltd/workmate/blob/main/docs/"
links=f"[需求]({base}requirements/16-desktop-native-teams.md) · [接口／权限／恢复／交付方案]({base}technical/139-desktop-native-teams.md) · [源码与证据]({base}quality/native-teams-checkpoint-139.json) · [全部编号]({base}quality/remaining-work-stage139.md)"
links_en=f"[Requirements]({base}requirements/16-desktop-native-teams.md) · [API, permissions, recovery and delivery]({base}technical/139-desktop-native-teams.md) · [Source and evidence]({base}quality/native-teams-checkpoint-139.json) · [All original identities]({base}quality/remaining-work-stage139.md)"
specific={
 "platform":("升级前备份数据库并停止旧API／Worker，执行`npm run db:migrate`至SQL137，再用匹配代码构建启动。新增原生团队API及精确权限约束；数据库只为已审批协调员开放暂停登记，成员按自己的固定角色核验，受限函数仅返回发起人团队的音频终态，不开放原始音频表。云端队列只处理云端工作。","Back up the database and stop older API/Worker processes; run `npm run db:migrate` through SQL137, then build and start matching code. Native team APIs enforce exact authority. Only reviewed coordinators may register while paused; members use their own frozen roles. A restricted function returns only the owning team's audio status, without exposing raw audio tables. The cloud queue accepts cloud work only."),
 "web":("Web团队继续在云端执行；本轮新增Desktop本机团队不改变网页的团队定义／版本模型。原生与云端运行历史分开。以下真实桌面截图用于解释跨端产品流程，Web既有截图与说明保留在后文。","Web teams continue cloud execution and share versioned team definitions with Desktop. Native and cloud histories stay separate. The actual Desktop screenshots below explain the cross-client workflow; existing Web captures and usage remain below."),
 "admin":("本机团队每步进入原有任务、用户消耗、钱包及审计管理，保留本机执行位置和角色版本；套餐、Skill／角色停用及账号权限变更继续生效。管理员不能替客户授予本机完整权限，私有内容仍走原受控协助流程。以下为真实客户Desktop流程，后台面板截图及用户／费用／VIP说明保留在后文。","Each native member enters the existing task, customer-usage, wallet and audit system with local execution placement and exact role versions. Plan changes, disabled roles/Skills and account restrictions remain effective. Admins cannot grant OS access for customers, and private content retains the controlled support flow. Actual customer Desktop captures follow; dashboard, users, fees and VIP guidance remains below."),
 "desktop":("打开「本机团队」，创建协调员及成员，填写整体简报、各步要求、依赖和预算。审阅时在本机选择目录及权限，确认后由客户电脑运行独立Codex成员；只有全部实际成果完成后协调员才开始。打开成员会话可回答问题；新增分工需重新审阅。可整组停止、从任一成员撤权，完成后下载团队交付。","Open Local teams, choose a coordinator and members, then enter the brief, step dependencies and budgets. Review selects a native folder and permission. After approval, separate Codex members execute on the customer computer; the coordinator starts only after actual member deliveries finish. Open member sessions to answer questions. New assignments require a new review. Stop or revoke the whole team, then download the completed team delivery."),
 "extension":("Extension继续使用Chrome原生右侧栏、对话及附件结构，承担获准文件读取和上传，Agent在云端运行。本轮的本机执行不通过扩展转交。以下为Desktop新增流程；本端实际侧栏截图和既有交付说明继续保留。","Extension retains Chrome's native right side panel, conversation and attachment structure, approved file reads/uploads and cloud Agent execution. Native team execution is handled by Desktop. The following captures show the added Desktop workflow; this client's actual panel captures and existing delivery instructions remain below."),
 "delivery":("执行`npm run qa:native-teams-backend -- <新两位编号>`检查真实原生PostgreSQL与费用／权限回归，执行`npm run qa:native-teams -- <新两位编号>`构建并操作真实Windows包。依赖原生Node、PostgreSQL运行库、Chrome、FFmpeg和锁定Codex；不用Docker／WSL。保留每次原始通过及失败。","Run `npm run qa:native-teams-backend -- <new two-digit attempt>` for actual native PostgreSQL, metering and permission regressions. Run `npm run qa:native-teams -- <new two-digit attempt>` to build and operate the actual Windows package. Native Node/PostgreSQL runtimes, Chrome, FFmpeg and pinned Codex are required; Docker/WSL are not used. Original successful and failed attempts remain separate."),
 "docs":("权威需求及方案在本目录；实际代码统一位于dev，各端独立Git仓库，唯一开发根目录仍为D盘指定路径。本轮收口本机团队子流程，原始完整验收状态详见编号清单。","Authoritative requirements and implementation documents live here; code remains under dev in independent repositories within the required D-drive workspace. This increment closes the native team workflow; the numbered ledger preserves original full-acceptance scopes."),
}
diagram="""```mermaid
flowchart LR
 A[Versioned team and fixed Skills] --> B[Free review: local folder, permission and budgets]
 B --> C[Customer approval and durable admission]
 C --> D[Parallel local Codex members]
 D --> E[Dependent local review]
 E --> F[Local coordinator]
 F --> G[Exact results and complete team ZIP]
 D --> H[Stop or revoke the whole team]
 H --> I[Recover original receipts, never replay unknown work]
```

"""
guides=[(ROOT/"dev"/("copypaste-"+component)/name,component) for component in ["platform","web","admin","desktop","extension","delivery"] for name in ["README.md","README.en.md"]]
guides += [(ROOT/"docs"/name,"docs") for name in ["README.md","README.en.md"]]
archive=ROOT/"docs/quality/history/stage139-guides-before"
assert not archive.exists()
for file,component in guides:
 raw=file.read_bytes();saved=archive/component/file.name;saved.parent.mkdir(parents=True,exist_ok=True);saved.write_bytes(raw)
 text=raw.decode("utf-8");assert "<!-- native-teams-stage139 -->" not in text
 english=file.name=="README.en.md"
 section="<!-- native-teams-stage139 -->\n## "+("Native specialist teams · Stage139" if english else "本机专家团队 · 阶段139")+"\n\n"+specific[component][int(english)]+"\n\n"
 section += ("Up to 16 steps, seven members plus one assistant coordinator and three concurrent members share one explicitly approved folder. Keep concurrent edits in separate files. Review is free; exact budgets are immutable, holds and actual charges remain separate, and unknown accepted operations are never rerun. Revocation stops native tools first and leaves unsynchronized receipts visible. Only submitted outputs enter the team ZIP; local-only files remain local.\n\n" if english else "最多16步、7位成员加1位通用协调员、3步并行，共用一个明确授权目录；并行编辑应分配到不同文件。审阅免费，批准预算固定，预留与实际费用分开；已接受但未知的操作不重跑。撤权先停止本机工具，未同步回执继续可见。团队ZIP仅包含主动提交的成果，本机未提交文件留在本机。\n\n")
 section += (en if english else zh)+"\n\n"
 section += ("Business/model responses and native folder/consent/save decisions are controlled fixtures. Actual OTP/PKCE, native Codex processes, Windows file operations, company metering, revocation and ZIP extraction execute for real. The package is unsigned. Full professional-role quality, signed installation coverage, real company models/ad accounts and portable project recovery remain separately open.\n\n" if english else "业务／模型答复及本机目录／授权／保存窗口的选择决定为受控假数据；实际OTP／PKCE、本机Codex、Windows文件操作、公司计量、撤权和ZIP解压确实执行。Windows包未签名；全部专业角色质量、签名安装、真实公司模型／广告账户及跨机器工程恢复继续独立验收。\n\n")
 section += diagram+(links_en if english else links)+"\n\n"
 section += ("Actual Desktop workflow, synthetic business content:\n\n" if english else "真实Desktop操作，业务内容为假数据：\n\n")
 chosen=[m for m in cp["media_files"] if m["path"].endswith("completed-local-team-"+("en" if english else "zh")+".png") or m["path"].endswith(".gif")]
 for item in chosen:
  rel=item["path"].split("/",1)[1];section += f"![Actual local team delivery](https://github.com/copypasteltd/workmate/blob/desktop/{rel})\n\n"
 for item in cp["media_files"]:
  if item in chosen:continue
  rel=item["path"].split("/",1)[1];section += f"- [{Path(rel).name}](https://github.com/copypasteltd/workmate/blob/desktop/{rel})\n"
 section += "\n";first,_,rest=text.partition("\n");file.write_text(first+"\n\n"+section+rest.lstrip("\n"),encoding="utf-8",newline="\n")
change=ROOT/"docs/changes/139-native-specialist-teams.md"
change.write_text("# 阶段139：本机专家团队闭环\n\n"+zh+"\n\n新增本机团队定义管理、固定角色／Skill图、免费审阅、明确目录及完整权限、预算审批、独立Codex并行、依赖审阅和协调汇总。整组停止／撤权、未知回执核对和完整团队ZIP保持费用与来源约束。\n\n迁移137只给已审批协调员开放暂停登记；成员按自己的角色核验能力，媒体状态通过当前发起人及项目校验。修复以协调员角色解释不同成员、原生媒体状态查询权限两处实际兼容问题。原生和云端运行历史分开，原生任务不进入云端队列。\n\n原始失败保留：首版测试类型、创建201断言、暂停协调员登记、不同角色能力、输入计数响应格式、音频状态读取权限、UUID顺序假设、UI脚本类型及包含选项的精确标签选择器。旧原生用例复制为新夹具，仅补实际客户端的续期心跳及隔离夹具容量，修复服务器已受理的长工具调用阻塞及时心跳时的续期，使用实际完成时钟并保留45秒租约；丢失、迟到、撤权或换登录族不能取得该续期，未知费用占用规则保留。另修正本机团队审批文案和批准后自动显示执行区，历史分页使用数据库微秒时序避免游标失准。最后只改一个Renderer文件，因此177项结果以完全相同的后端／控制器／扩展／测试来源重用，Renderer重新编译并重建实际Windows包及旅程。各次实际结论见证据索引。\n\n模型内容及窗口决定为受控假数据，真实本机操作不以模拟运行时替代。未签名安装、全部专业质量、真实外部账户及完整工程恢复保持原验收范围；本轮没有宣称102项需求整体完成。\n\n"+en+"\n\n"+diagram+links+"\n",encoding="utf-8",newline="\n")
print(json.dumps({"stage":139,"guides_updated":len(guides),"original_identities":102,"counts":c,"required_open":88}))
