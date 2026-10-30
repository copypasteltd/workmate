"""Publish bilingual business-brief guidance with original acceptance identities."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import copy
import json

ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / "docs/quality"
CP = QUALITY / "business-inputs-checkpoint-136.json"
cp = json.loads(CP.read_bytes())
assert cp["status"] == "verified_business_clarification_and_continuation"
assert cp["counts"]["actual_client_journey_checks"] == 14
previous = QUALITY / "remaining-work-stage135.json"
old = json.loads(previous.read_bytes())
value = copy.deepcopy(old)
scopes = {
    "REQ-007": "阶段136补齐业务问题、可选建议和自由回答；实际固定Codex二进制在已计量轮次提问，回答后继续同一线程、任务及预算。所有业务真正阻塞字段的自然发现与专业理解质量仍需完整验收。",
    "REQ-035": "阶段136Web原对话可回答业务问题，建议不自动确认，繁中／英文切换保留自由回答，同任务续跑及历史备注通过；全部业务成果续做、输入发现质量和完整交付路径继续开放。",
    "REQ-036": "阶段136真实Chrome工具栏右侧SIDE_PANEL在原聊天内展示并提交业务问题，无需高级工具；真实OTP／PKCE、语言切换和原任务续跑通过。完整网页选择、站点授权和权限兼容矩阵继续开放。",
    "REQ-039": "阶段136未签名Windows包的云端任务问答通过；真实原生窗口三种宽度无边框、无Electron菜单、可见纵轨或横向溢出。本机Codex与独立本机授权沿用原实现，本阶段不据云任务验证宣称新增本机能力。签名安装、OS／DPI及全部本机工具完整验收仍开放。",
    "REQ-072": "阶段136原首项工作可在实际对话或任务详情补充尺寸／受众，建议不默认提交，回答后原任务继续；不据此覆盖全部首次使用和通知场景。无图形化配置的全部业务首单、完整通知及原会话恢复场景仍待验收。",
    "REQ-073": "阶段136增加专业角色可用的严格业务提问工具及上下文继承，实际原生Codex的定向用例验证提问与同线程续跑；不据此认定十八个角色专业合格。十八个候选的完整专业输出、修改与异常资格仍待完成，正式合格数沿用零。",
    "REQ-074": "阶段136问题绑定和业务上下文可沿用原角色／Skill配置继续任务，问题不改变技能或工具权限；原生定向用例不替代各角色的完整流程资格。各角色技能完整流程、真实文件和异常验收继续开放。",
    "REQ-076": "阶段136问题工具对执行角色提供严格业务问题结构，问题不授予资源、工具、预算或本机权限；旧二十项任务定义与主OpenAPI保持原字节，新增版本化补充结构。全部预设角色的完整业务交付和技能质量仍待验收。",
    "REQ-078": "阶段136补充业务问题与已有文件／连接共用原任务补交机制，混合批次全部验证后才写入；跨企业、只读成员、撤回来源和迟到身份拒绝有定向检查。全部来源／业务／跨端授权矩阵仍开放。",
    "REQ-060": "阶段136后端回归、实际Codex合成提供方检查、三端实际界面与七组中英指南绑定当前源码，保留失败原件及原SQL／接口定义。完整独立检出复现、正式安装与综合源码交付仍开放。",
}
for row in value["requirements"]:
    row["current_audit_remaining"] = scopes.get(row["id"], row["current_audit_remaining"].replace("本轮", "既有定向检查"))
    if row["id"] in scopes:
        row["current_review_note"] = "阶段136业务资料补充与原任务续跑增量；不缩减原始完整验收范围。"
assert len(value["requirements"]) == 102
assert [r["id"] for r in value["requirements"]] == [r["id"] for r in old["requirements"]]
assert value["summary"] == old["summary"] and value["required_priorities"] == old["required_priorities"]
assert [r["id"] for r in value["requirements"] if r["full_acceptance"] == "accepted"] == ["REQ-095"]
value["schema_version"] = 18
value["reviewed_at"] = datetime.now(timezone.utc).isoformat()
value["previous_review"] = {"path": previous.relative_to(ROOT).as_posix(), "sha256": sha256(previous.read_bytes()).hexdigest()}
value["checkpoint"] = {"path": CP.relative_to(ROOT).as_posix(), "sha256": sha256(CP.read_bytes()).hexdigest()}
value["new_full_acceptance_closures"] = 0
value["current_increment"] = {"stage": 136, "counts": cp["counts"], "required_open": 88,
    "unconfirmed_suggestions": 12, "optional_open": 1, "whole_platform_runtime_rerun": False,
    "full_acceptance_closures": 0, "accepted_requirements": [], "updated_scope_records": list(scopes)}
c = cp["counts"]
validation = (f'{c["backend_integration_tests"]}项后端集成检查（含11项新增问题测试）、'
    f'{c["extension_state_tests"]}项扩展状态检查、12项交付绑定及14项实际三端流程通过；'
    '9张实际截图、3组GIF／MP4及7个尺寸检查绑定确切来源。')
validation_en = (f'{c["backend_integration_tests"]} backend integration checks (including eleven new question cases), '
    f'{c["extension_state_tests"]} extension state checks, twelve delivery binding tests and fourteen actual three-client checks passed. '
    'Nine actual screenshots, three GIF/MP4 pairs and seven layout checks bind to exact sources.')
target = QUALITY / "remaining-work-stage136.json"
assert not target.exists() and not target.with_suffix(".md").exists()
target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
intro = f"""# 当前完整编号清单 · 阶段136

保留全部102条原始身份：REQ-095原始验收维持，88条必需、12条未确认建议和1条可选记录仍开放。开放数量是完整验收记录数，不等于尚未编码模块数。本轮补齐明确业务问题及原任务续跑；全部角色的信息发现和专业交付质量仍按原范围验收。

{validation} 后端使用真实固定Codex二进制及合成Responses服务；三端页面采用受控工具和假业务回复。完整构建与原Windows包字节对应，修正的页面旅程复用相同构建。未签名Windows包，未验证真实模型、广告账户或生产媒体。

[检查点](business-inputs-checkpoint-136.json) · [原始证据](business-inputs-evidence-136/index.json) · [机器清单](remaining-work-stage136.json) · [本轮变更](../changes/136-business-brief-clarification.md)

| 编号 | 优先级 | 模块 | 当前状态 | 原始完整验收的结论及余项 |
| --- | --- | --- | --- | --- |
"""
lines = [f'| {r["id"]} | {r["priority"]} | {r["module"]} | {r["audit_status"]} | {r["current_audit_remaining"].replace("|", "／")} |' for r in value["requirements"]]
target.with_suffix(".md").write_text(intro + "\n".join(lines) + "\n", encoding="utf-8", newline="\n")
base = "https://github.com/copypasteltd/workmate/blob/main/docs/"
technical = base + "technical/136-business-brief-clarification.md"
ledger = base + "quality/remaining-work-stage136.md"
evidence = base + "quality/business-inputs-checkpoint-136.json"
requirements = base + "requirements/13-business-brief-inputs.md"
zh = f"""<!-- business-inputs-stage136 -->
## 业务问题与原任务续跑 · 阶段136

Agent遇到确实缺少的尺寸、目标受众或业务口径，可在原对话提出问题。客户可点击建议再修改，也可直接自由回答，最后明确确认；没有预选或自动提交。多项问题逐项保存，全部补齐后继续同一任务、同一会话和原预算预留，已计量用量统一结算。确认的问题和答案保留为原对话备注，相同请求重试不重复写入。

Web和Chrome原生右侧栏直接在原聊天展示问题，Desktop既有云任务详情也支持补答。繁中／英文切换保留未提交的回答，失败保留文字；扩展切换身份或会话清除草稿，来源不可读时清除受保护问题。建议仅供选择，答案不授予文件、广告账户、工具、本机或额外费用权限。

服务端严格区分`question`／`file`／`connection`，最多8项建议、4,000字符回答，校验版本、当前权限、来源及整批合法性后才写入。已确认答案不可改写。付费提问必须处于已完成且计量明确的Codex回合边界，继续原线程；取消只结算已知用量。删除私有会话清除问题、答案、检查点及正文，保留必要费用事实。

SQL135须在启动API／Worker前迁移：Backend执行`npm run db:migrate`。原SQL001–134、原二十项任务定义及主OpenAPI保持原字节；新增结构在`contracts/business-inputs-v1.schema.json`，扩展原创建／补交接口。原依赖文件与连接结构继续有效，问题使用`answer`而非`resource_ids`。

{validation} 原生Codex检查使用实际固定二进制和合成Responses服务，页面旅程使用受控工具和假业务回复。客户端初次完整构建成功；修正页面夹具后复用逐字节一致的源码和Windows包，原失败记录保留。可在Delivery执行`npm run qa:business-inputs-backend -- <新两位编号>`或`npm run qa:business-inputs -- <新两位编号>`；后者默认完整构建并创建独立原生测试数据库。

Desktop本机Codex及客户主动授予的本机完整权限沿用独立流程，本轮新增的是其云端任务视图问答。实际Windows窗口保持无边框、无Electron菜单、无可见纵向滚动轨和横向溢出；扩展保持实际Chrome原生右侧SIDE_PANEL。使用假数据，Windows包未签名；真实生产模型及全部角色专业交付仍待验收。完整编号仍开放88条必需、12条未确认建议、1条可选，REQ-095原始验收维持。

```mermaid
flowchart LR
  A[原任务缺少业务资料] --> B[已计量Codex回合提出问题]
  B --> C[客户选择建议或自由回答]
  C --> D[明确确认 校验版本与当前权限]
  D --> E{{是否已补齐}}
  E -->|尚未补齐| C
  E -->|已补齐| F[原线程 原任务 原预算继续]
  F --> G[原对话结果 一次累计结算]
```

[需求]({requirements}) · [实现与使用逻辑]({technical}) · [全部102条编号]({ledger}) · [源码与原始验收]({evidence})

"""
en = f"""<!-- business-inputs-stage136 -->
## Business questions and original-task continuation · Stage136

When an essential canvas size, audience or business definition is missing, the Agent can ask in the original conversation. Customers may choose and edit a suggestion or write a different answer, then explicitly confirm it. Nothing is preselected or automatically submitted. Partial answers remain saved; completing all inputs continues the same task, conversation and original budget hold. Measured usage is settled cumulatively. Each confirmed question becomes one original-conversation note; identical retry adds no duplicate.

Web and the actual native Chrome right Side Panel show these questions inside the existing chat; Desktop supports answers in its existing cloud-task detail view. English/Traditional Chinese switching preserves drafts and a failed submission retains its text. Extension clears drafts on identity/conversation changes and removes protected questions when sources become unreadable. An answer grants no files, advertising accounts, tools, local access or additional spending permission.

The server strictly distinguishes `question`, `file` and `connection`: up to eight suggestions and 4,000 answer characters, with version, current authority, source and complete-batch validation before any update. Confirmed answers are immutable. Paid questions wait at a completed, measured Codex boundary and resume the original thread; cancellation settles known usage only. Private-conversation erasure removes questions, answers, checkpoints and text while retaining necessary accounting facts.

Apply SQL135 before API/Worker startup with Backend `npm run db:migrate`. Original SQL001–134, twenty baseline task definitions and the primary OpenAPI remain byte-identical. `contracts/business-inputs-v1.schema.json` adds strict versioned definitions to the existing create/input endpoints. File/connection requests retain their shape; questions use `answer` rather than `resource_ids`.

{validation_en} Native integration uses the actual pinned Codex executable with synthetic Responses; UI journeys use scripted tools and synthetic business replies. Initial full client builds passed. Corrected journeys explicitly reuse byte-identical product source and the same unsigned Windows package; original failures remain. From Delivery, run `npm run qa:business-inputs-backend -- <new two-digit attempt>` or `npm run qa:business-inputs -- <new two-digit attempt>`; the latter performs full builds and creates an isolated native test database.

Desktop retains its separate local Codex and explicitly granted full-local-permission flow; this increment extends its cloud-task view. Actual native windows remain frameless with no Electron menu, visible vertical rails or horizontal overflow. Extension retains the genuine native right SIDE_PANEL. Data are synthetic and the Windows package is unsigned. Production models and complete specialist delivery remain open. Full acceptance retains 88 required records, twelve unconfirmed suggestions and one optional record; original REQ-095 remains accepted.

```mermaid
flowchart LR
  A[Original task lacks business details] --> B[Completed measured Codex turn asks]
  B --> C[Customer chooses or writes an answer]
  C --> D[Explicit confirmation Version and authority checks]
  D --> E{{All inputs ready}}
  E -->|Pending| C
  E -->|Ready| F[Original thread Task Budget continue]
  F --> G[Original chat result One cumulative charge]
```

[Requirements]({requirements}) · [Implementation and usage]({technical}) · [All 102 identities]({ledger}) · [Exact source and evidence]({evidence})

"""
media = {}
for row in cp["media_files"]:
    component, rest = row["path"].split("/", 1)
    component = component.removeprefix("copypaste-")
    if rest.endswith(("question-en.png", "question-zh.png", "completed.png", ".gif")):
        media.setdefault(component, []).append((rest.rsplit("/", 1)[-1], "https://github.com/copypasteltd/workmate/blob/" + component + "/" + rest))
archive = QUALITY / "history/stage136-guides-before"
assert not archive.exists()
files = []
for component in ["platform", "web", "admin", "desktop", "extension", "delivery"]:
    for filename, text in [("README.md", zh), ("README.en.md", en)]:
        files.append((ROOT / ("dev/copypaste-" + component) / filename, text, component))
for filename, text in [("README.md", zh), ("README.en.md", en)]:
    files.append((ROOT / "docs" / filename, text, "all"))
for file, text, component in files:
    original = file.read_bytes()
    saved = archive / file.relative_to(ROOT)
    saved.parent.mkdir(parents=True, exist_ok=True)
    saved.write_bytes(original)
    captures = media.get(component, [])
    if component in ["platform", "admin", "delivery", "all"]:
        captures = [next(x for x in media[k] if x[0].endswith(".gif")) for k in ["web", "desktop", "extension"]]
    image_text = "\n\n".join(f'![Actual {name}]({url})' for name, url in captures)
    title, rest = original.decode("utf-8").split("\n", 1)
    file.write_text((title + "\n\n" + text + image_text + "\n\n" + rest.lstrip("\n")).rstrip() + "\n", encoding="utf-8", newline="\n")
policy = ROOT / "docs/governance/04-git-branches-and-publication.md"
body = policy.read_text(encoding="utf-8")
title, rest = body.split("\n", 1)
note = """<!-- business-inputs-stage136 -->
阶段136使用`docs/tools/prepare_business_inputs_publication_136_v1.py`及`docs/tools/publish_business_inputs_136_v1.py --push`发布。保留387317条历史证明身份和阶段135实际原子发布回执；只检查新增对象、当前／新增提交路径和当前七组双语README链接。问题问答、实际原生Codex的合成提供方检查及三端实际页面各自登记范围。原失败与原执行脚本保持原字节，六个独立组件普通原子更新八引用并读取远端SHA。12份用户未跟踪文件及Desktop根属性保持不变，不强推，不将增量检查当作全产品完成。

Stage136 retains all 387317 historical proof identities and the actual Stage135 publication receipt. Ordinary atomic publication updates eight refs after new-object/current-path/README audits and verifies remote SHAs. Native synthetic-provider integration and actual UI fixtures retain distinct scopes. Original failed attempts, user files and Desktop root attributes remain unchanged; complete product acceptance stays open.

"""
policy.write_text((title + "\n\n" + note + rest.lstrip("\n")).rstrip() + "\n", encoding="utf-8", newline="\n")
changes = ROOT / "docs/changes/136-business-brief-clarification.md"
assert not changes.exists()
change_text = f"""# 阶段136：业务问题与原任务续跑

| 编号 | 本轮实现 | 已验证范围 |
| --- | --- | --- |
| 136-01 | 必要业务问题、可选建议与自由回答 | 尺寸／受众问题无默认答案，最多八建议和4,000字符；模型侧不能填入答案、资源或额外权限。 |
| 136-02 | 原任务、原会话与费用 | 实际固定Codex在完整计量回合暂停，原预算预留和线程继续，多个问题逐项确认后一次累计结算；确认备注不重复。 |
| 136-03 | 权限与事务 | 旧版本／错误类型／混合非法批次原子拒绝，跨企业和只读用户拒绝，回答不扩大工具、来源和支出权限；私有对话擦除保留费用事实。 |
| 136-04 | 三端原对话交互 | Web和真实Chrome右侧SIDE_PANEL的原聊天，未签名原生Desktop的既有云任务详情；实际OTP／PKCE、繁中／英文草稿保留及原任务续跑，原会话备注通过Web核查。 |
| 136-05 | SQL及接口兼容 | 新SQL135的升级、约束和不可改写答案通过，原SQL001–134及二十项任务定义／主OpenAPI不改，新增严格补充定义。 |
| 136-06 | 文档与交付 | 七组中英README、逻辑图、九张实际截图及三组GIF／MP4，保留完整102条原需求身份和所有原失败。 |

{validation}

后端使用真实固定Codex及合成Responses服务，界面使用受控工具与假业务回复。初次11条完整构建／原生绑定命令全部成功；最终旅程仅修正验收夹具，复用绑定的构建源码及Windows包，另行严格编译当前交付脚本。没有将页面夹具称为真实生产模型，也没有把Desktop云任务问答称为本机Agent新增能力。

原失败分别保留：首次后端运行发现当前SQL版本常量未随迁移更新；下一次发现测试夹具缺少授权上下文、跨企业拒绝状态假设及升级夹具遗漏账务记录，旧规范不可变测试同时揭示直接修改原接口定义的问题。实现改为独立版本补充、恢复旧定义字节，并以新的测试版本重新运行。首次界面旅程向严格任务接口多传了一个字段，接口正确拒绝；复用预检又把11条构建误写成12条，启动任何原生资源前即停止。修正使用新脚本版本，所有原执行文件和报告保持原字节。随后Desktop脚本误把云会话链接视为原生云聊天；产品按既有方向正确引导前往Web。新脚本改用既有云任务详情，并在已登录Web核查原会话备注，Desktop本机Agent入口不变。第四次界面旅程的扩展中文标记断言误写为zh-HK；实际文档正确使用zh-Hant-HK，第五次按真实标记完成。其他实际尝试以[原始证据索引](../quality/business-inputs-evidence-136/index.json)为准。

本次创建的浏览器、原生侧栏、Desktop、API和原生PostgreSQL均已关闭。假数据与未签名Windows包范围继续适用。

| 编号 | 仍待完成 | 当前范围 |
| --- | --- | --- |
| 待办-01 | 必需需求完整验收 | 88条仍开放，其中76条部分验证、12条未证完整；本轮不新增整条结案。 |
| 待办-02 | 自然发现与专业交付 | 所有角色识别真正阻塞字段、设计／媒体／开发完整交付及其权限交集。 |
| 待办-03 | 生产接入与后台全矩阵 | 真实模型／媒体、广告与分析账户、全部管理动作及当前权限组合。 |
| 待办-04 | 正式安装与综合交付 | 签名安装、OS／DPI／本机工具完整矩阵，独立检出复现及全链路验收。 |
| 待办-05 | 未确认建议与可选 | 12条未确认建议及1条可选单列，不计成用户已确认的必需项。 |

[全部102条编号](../quality/remaining-work-stage136.md) · [检查点](../quality/business-inputs-checkpoint-136.json) · [需求](../requirements/13-business-brief-inputs.md) · [实现与使用逻辑](../technical/136-business-brief-clarification.md)

"""
for component in ["web", "desktop", "extension"]:
    row = next(r for r in cp["media_files"] if r["path"].startswith("copypaste-" + component + "/") and r["path"].endswith(".gif"))
    change_text += "![实际 " + component + "](../../dev/" + row["path"] + ")\n\n"
changes.write_text(change_text.rstrip() + "\n", encoding="utf-8", newline="\n")
print(json.dumps({"updated_bilingual_files": len(files), "original_identities": 102, "required_open": 88, "new_full_acceptance_closures": 0}))
