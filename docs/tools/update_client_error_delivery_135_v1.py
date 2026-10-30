"""Update bilingual delivery guides and retain all original requirement identities."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import copy
import json

ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / "docs/quality"
CP = QUALITY / "client-errors-checkpoint-135.json"
cp = json.loads(CP.read_bytes())
assert cp["status"] == "verified_four_client_transport_and_session_recovery"
assert cp["counts"]["actual_four_client_journey_checks"] == 30 and cp["qualified_attempts"] == ["ui-09"]
previous = QUALITY / "remaining-work-stage134.json"
old = json.loads(previous.read_bytes())
value = copy.deepcopy(old)
scopes = {
    "REQ-003": "阶段135实际四端邮箱OTP／PKCE或独立管理员TOTP及HTML格式401清除通过；三套请求库的旧401不能覆盖新登录有真实HTTP检查。正式企业身份部署、签名安装登录及所有会话竞争组合仍开放。",
    "REQ-035": "阶段135Web连接错误、未知提交结果、语言切换、同请求恢复及HTML401返回登录通过；自动缺口发现、全业务成果续做及完整交付路径仍开放。",
    "REQ-036": "阶段135实际Chrome工具栏打开右侧SIDE_PANEL、邮箱OTP／PKCE、语言切换、未知写入同消息重试及401清除通过；完整网页选择、站点授权和权限兼容矩阵仍开放。",
    "REQ-039": "当前未签名Windows包保留本机Codex及独立本机授权，实际未知结果提示／恢复、HTML401清除和既有窗口／放大检查通过；签名安装、OS／DPI及全部本机工具仍需完整验收。",
    "REQ-048": "阶段135后台连接提示随语言变化并可显式恢复，扩展后台轮询及语言切换不清除未确认提交提醒；HTML401即时清除管理外壳，列表网络错误不覆盖独立撤销提醒。完整资源运营及所有页面的运营矩阵仍开放。",
    "REQ-055": "当前支持页面键盘、Web／Admin CSS200%及Desktop原生200%通过，并验证原生右侧栏无横向溢出；全部关键路径浏览器缩放、读屏、对比及reduced-motion仍开放。",
    "REQ-060": "阶段135当前Delivery严格编译及构建、15项连接／身份、12项文件绑定、1项原生桥及30项实际四端流程有确切源码和截图录制；完整独立检出复现、正式安装与综合源码交付仍开放。",
    "REQ-095": "阶段134原始TC-095十二条逐条验收维持；本轮后台业务源码未改且核对相同，四端旅程含原客服流程回归。全平台无障碍、权限矩阵和正式安装仍归各自需求。",
    "REQ-098": "阶段135后台连接／未知结果文案、HTML401清除、迟到身份拒绝及列表恢复通过，表单错误／撤销提醒独立保留；其他全部运营页面及完整可用性仍待验收。",
}
for row in value["requirements"]:
    row["current_audit_remaining"] = scopes.get(row["id"], row["current_audit_remaining"].replace("本轮", "既有定向检查"))
    if row["id"] in scopes:
        row["current_review_note"] = "阶段135四端连接与登录异常定向验证；完整验收边界不缩减。"
assert len(value["requirements"]) == 102
assert [r["id"] for r in value["requirements"]] == [r["id"] for r in old["requirements"]]
assert value["summary"] == old["summary"] and value["required_priorities"] == old["required_priorities"]
assert [r["id"] for r in value["requirements"] if r["full_acceptance"] == "accepted"] == ["REQ-095"]
value["schema_version"] = 17
value["reviewed_at"] = datetime.now(timezone.utc).isoformat()
value["previous_review"] = {"path": previous.relative_to(ROOT).as_posix(), "sha256": sha256(previous.read_bytes()).hexdigest()}
value["checkpoint"] = {"path": CP.relative_to(ROOT).as_posix(), "sha256": sha256(CP.read_bytes()).hexdigest()}
value["new_full_acceptance_closures"] = 0
value["current_increment"] = {"stage": 135, "counts": cp["counts"], "required_open": 88, "unconfirmed_suggestions": 12,
    "optional_open": 1, "whole_platform_runtime_rerun": False, "full_acceptance_closures": 0,
    "accepted_requirements": [], "updated_scope_records": list(scopes)}
target = QUALITY / "remaining-work-stage135.json"
assert not target.exists() and not target.with_suffix(".md").exists()
target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
intro = """# 当前完整编号清单 · 阶段135

原始102条身份全部保留：已验收REQ-095，88条必需、12条未确认建议及1条可选记录仍开放。开放数量是完整验收记录数量，不等于未编码模块数；本轮没有把定向连接／登录检查当作其他需求的完整验收。

本轮15项连接／身份、12项交付文件绑定及1项原生桥检查通过，30项实际Web／Admin／打包Desktop／Chrome原生右侧栏流程通过。09重新编译／构建Extension及Delivery；后台、Web、Admin、Desktop源码及Windows包与02逐字节一致，重用其10条构建及相同来源的单元结果。20张截图、7组真实GIF／MP4及原失败均保留。假数据、未签名Windows包、无模型运行。

[检查点](client-errors-checkpoint-135.json) · [原始证据](client-errors-evidence-135/index.json) · [机器清单](remaining-work-stage135.json) · [本轮变更](../changes/135-client-connection-and-session-recovery.md)

| 编号 | 优先级 | 模块 | 当前状态 | 原始完整验收的结论及余项 |
| --- | --- | --- | --- | --- |
"""
lines = [f'| {r["id"]} | {r["priority"]} | {r["module"]} | {r["audit_status"]} | {r["current_audit_remaining"].replace("|", "／")} |' for r in value["requirements"]]
target.with_suffix(".md").write_text(intro + "\n".join(lines) + "\n", encoding="utf-8", newline="\n")

technical = "https://github.com/copypasteltd/workmate/blob/main/docs/technical/135-client-connection-and-session-recovery.md"
ledger = "https://github.com/copypasteltd/workmate/blob/main/docs/quality/remaining-work-stage135.md"
evidence = "https://github.com/copypasteltd/workmate/blob/main/docs/quality/client-errors-checkpoint-135.json"
zh = f"""<!-- client-errors-stage135 -->
## 四端连接与登录恢复 · 阶段135

Web、Admin、Desktop及Extension对读取失败显示当前语言的连接说明，保留有效登录。提交后响应丢失或无法解析时，提示先查收结果；应用层不会自动重发；浏览器可能在底层重传，服务端按原消息编号去重。客服授权继续使用原编号和期限，扩展委派继续使用原消息编号，显式重试不生成第二个任务。后台轮询不清除提交结果未确认的提醒，切换繁中／英文会更新同一错误提示，已知连接异常不显示Electron内部文字、地址或响应正文。

受保护请求收到401时，先核对所属登录并清除当前身份；HTML或空正文不能绕过清除。旧请求不能注销新登录或覆盖新防伪标记。Admin即时隐藏独立管理外壳，支持会话列表的连接错误与表单／撤销提醒分开，列表恢复后只清除本次连接提示。

15项连接／身份检查（含实际HTTP故障）、12项交付文件绑定、1项原生桥检查及30项实际四端流程通过。20张截图、7组实际GIF／MP4绑定源码；包含真实右侧SIDE_PANEL、客户OTP／PKCE及独立管理员TOTP、真实提交后响应丢失与同消息重试。09重新编译／构建Extension及Delivery，复用与02逐字节相同的后台、Web、Admin、Desktop源码及Windows包；没有伪称再次完整打包。旧失败与执行原件保留。Delivery当前`npm test`包含严格编译、文件绑定及连接检查；`npm run qa:client-errors -- <新的两位编号>`默认完整构建。

Desktop仍在客户本机运行Codex，完整本机权限单独授予，保持无边框、无Electron菜单及可见滚动条。Extension通过Chrome工具栏打开原生右侧栏，负责获准文件上传和云端执行。业务使用假数据，模型未运行，Windows包未签名。完整验收仍有88条必需、12条未确认建议、1条可选开放；REQ-095原始验收维持。

```mermaid
flowchart LR
  U[用户操作] --> R{{读取或提交}}
  R -->|读取失败| C[保留登录 主动刷新]
  R -->|提交结果未知| Q[查收结果 同编号明确重试]
  R -->|当前HTTP401| L[清除旧内容 返回登录]
  R -->|旧登录的迟到响应| S[拒绝旧响应 保留新登录]
```

[使用与实现]({technical}) · [全部102条编号]({ledger}) · [源码与验收绑定]({evidence})

"""
en = f"""<!-- client-errors-stage135 -->
## Connection and session recovery across four clients · Stage135

Web, Admin, Desktop and Extension show connection guidance in the current language while retaining valid sign-in. A write with a lost or unreadable reply is explicitly unconfirmed: check its result before retrying. The application does not retry the write automatically. Browser transport retransmissions retain the same message identity and are deduplicated by the server. Support grants retain their fixed request key and deadline; extension delegations retain their original message identity, so explicit retry creates no second task. Background polling preserves an unconfirmed-write notice. Switching English/Traditional Chinese updates the same notice without exposing Electron internals, URLs or response bodies.

A current protected HTTP401 clears the current identity even when the body is HTML or empty. An obsolete request cannot sign out a newer identity or replace its CSRF token. Admin immediately removes its independent shell. Support-list connection errors are separate from form and revoked-access notices; successful list recovery clears only its own connection notice.

15 transport/identity tests (including actual HTTP faults), 12 delivery-file binding tests, one native bridge test and 30 actual four-client journey checks passed. Twenty screenshots and seven actual GIF/MP4 pairs bind to exact sources, including a real right-docked Chrome SIDE_PANEL, customer OTP/PKCE, independent administrator TOTP and an actual committed extension write with a lost reply and identical-message retry. Attempt09 rebuilds current Extension and Delivery. Backend/Web/Admin/Desktop source and Windows package bytes exactly match full build02, whose ten corresponding build steps and unchanged-source unit results are explicitly reused. Original failed attempts remain. Delivery `npm test` includes strict compilation, binding and transport checks; `npm run qa:client-errors -- <new two-digit attempt>` performs a full build by default.

Desktop continues to run Codex locally with separate explicit local permission, a frameless window, no Electron menus or visible rails. Extension keeps the native Chrome toolbar/Side Panel, approved-file uploads and cloud execution. Business fixtures are synthetic, no models ran and the Windows package is unsigned. Full acceptance still has 88 required records, 12 unconfirmed suggestions and one optional record open; original REQ-095 remains accepted.

```mermaid
flowchart LR
  U[User action] --> R{{Read or write}}
  R -->|Read fails| C[Keep sign-in Explicit refresh]
  R -->|Write unconfirmed| Q[Check receipt Explicit same-key retry]
  R -->|Current HTTP401| L[Clear prior content Return to sign-in]
  R -->|Obsolete session| S[Reject old response Preserve new identity]
```

[Behavior and implementation]({technical}) · [All 102 requirement identities]({ledger}) · [Source-bound verification]({evidence})

"""
media = {}
for item in cp["media_files"]:
    name = item["path"].split("/")[-1]
    component = item["path"].split("/")[0].removeprefix("copypaste-")
    if name.endswith(("native-unconfirmed-en.png", "native-unconfirmed-zh.png", "web-unconfirmed-en.png", "read-connection-en.png", "expired-session-en.png", "connection-and-retry.gif", "connection-recovery.gif", "customer-grant.gif", "grant-result-recovery.gif")):
        media.setdefault(component, []).append((name, "https://github.com/copypasteltd/workmate/blob/" + {"platform": "backend"}.get(component, component) + "/assets/screenshots/" + name))
archive = QUALITY / "history/stage135-guides-before"
assert not archive.exists()
files = []
for component in ["platform", "web", "admin", "desktop", "extension", "delivery"]:
    for filename, text in [("README.md", zh), ("README.en.md", en)]:
        file = ROOT / ("dev/copypaste-" + component) / filename
        files.append((file, text, component))
for filename, text in [("README.md", zh), ("README.en.md", en)]:
    files.append((ROOT / "docs" / filename, text, "all"))
for file, text, component in files:
    original = file.read_bytes()
    saved = archive / file.relative_to(ROOT)
    saved.parent.mkdir(parents=True, exist_ok=True)
    saved.write_bytes(original)
    images = media.get(component, []) if component not in ["platform", "delivery", "all"] else [entry for entries in media.values() for entry in entries][:5]
    captures = "\n".join(f'![Actual {name}]({url})' for name, url in images)
    old_text = original.decode("utf-8")
    title, rest = old_text.split("\n", 1)
    file.write_text(title + "\n\n" + text + captures + "\n\n" + rest.lstrip("\n"), encoding="utf-8", newline="\n")
policy = ROOT / "docs/governance/04-git-branches-and-publication.md"
body = policy.read_text(encoding="utf-8")
title, rest = body.split("\n", 1)
note = """<!-- client-errors-stage135 -->
阶段135发布使用`docs/tools/prepare_client_errors_publication_135_v1.py`及`docs/tools/publish_client_errors_135_v1.py --push`。保留383134条既有证明身份及阶段134实际原子推送回执；只核查本轮新增对象、当前／新增提交路径和全部当前README链接。发布当前四端连接与身份恢复源码、30项实际旅程、20截图及7组实时GIF／MP4；原失败、旧验证码脚本及旧验收文字不改写。六个组件保持独立仓库，普通原子更新八引用并读取远端SHA。12份用户未跟踪文件及Desktop根属性保持原字节，不强推，不将定向检查当作全产品完成。

Stage135 preserves all 383134 historical proof identities and the actual Stage134 atomic publication receipt. It audits new objects/current paths/README destinations and ordinarily pushes eight refs with SHA readback. Current four-client recovery, source-bound captures, original failed attempts and historical verifiers retain their actual scope. User-owned files and Desktop root attributes stay byte-identical; full acceptance remains open.

"""
policy.write_text(title + "\n\n" + note + rest.lstrip("\n"), encoding="utf-8", newline="\n")
changes = ROOT / "docs/changes/135-client-connection-and-session-recovery.md"
assert not changes.exists()
change_text = """# 阶段135：四端连接与登录恢复

| 编号 | 本轮实现 | 验证结果 |
| --- | --- | --- |
| 135-01 | 读取失败与提交结果未知分别提示 | 读取保留有效登录；未知提交先查收结果，应用层不自动再次提交；浏览器底层重传由服务端同编号去重。 |
| 135-02 | 当前语言及技术文字控制 | Web／Admin／原生Desktop／右侧栏按当前语言显示已知错误，取消通用重试提示对未知提交的误导。 |
| 135-03 | HTML／空格式401的身份清除 | 实际四端401均隐藏旧内容并回到各自登录；三套请求库的旧401不能覆盖新登录／CSRF有真实HTTP检查。 |
| 135-04 | Admin恢复状态 | 列表连接错误独立管理，恢复只清除连接提示，保留独立撤销提醒和表单信息。 |
| 135-05 | Extension后台与语言切换 | 实际15秒后台通知刷新不清掉未确认写入提示；繁中／英文切换更新现有提示，均不追加写请求；高级面板留在工作区，繁中／英文及未知结果提示均实际可见且未被覆盖。 |
| 135-06 | 实际端与防重复 | 原生右侧SIDE_PANEL、真实OTP／PKCE、真实委派提交后响应丢失及同消息重试均通过，最终只有一个新任务。Desktop仍本机Codex及无边框。 |
| 135-07 | 严格编译与交付 | 当前Delivery构建通过；八份旧执行原件保留，当前第九版旅程及第二版连接检查参与严格编译。七组双语指南、20截图、7组真实GIF／MP4同步。 |

15项连接／身份、12项交付文件绑定、1项原生桥及30项实际四端流程通过。09重新编译／构建Extension和Delivery；后台、Web、Admin、Desktop源码及Windows包与完整构建02逐字节一致，复用其10条构建及相同来源单元结果。上一轮65项后台检查保留为明确历史引用，不宣称本轮重跑。

01实际发现Admin恢复后连接错误未清除；修复为独立列表提示。02仍失败，因为脚本错误要求所有提醒消失，实际正确保留了撤销提醒；03修正该断言，只要求连接提醒清除。03在原生侧栏未稳定确认连接提示，进一步补齐工作区就绪检查并修复后台轮询／语言切换隐藏提示。04因侧栏上下文就绪早于文档URL而失败；05等待完整文档就绪，但单次服务端断连没有在浏览器侧形成可见失败。06持续断开测试读取并确认实际提示及语言切换，随后因故障注入误用202而未触发真实200委派的响应丢失，仍失败。07按真实200修正故障设置，但Chrome底层重传后收到正常回复，因此尚未出现预期的未知结果提示。08持续丢弃同一提交的所有回复直至真实worker发生终态网络失败，并通过实际网络事件确认后台读取终态失败；真实15秒的成功／失败刷新及两次语言切换均保留提醒，底层重传与明确重试的请求体完全一致，08通过完整30项行为检查，但截图复核发现高级工具覆盖全局错误。09将高级面板约束在工作区内部，使错误提示占有独立空间，并核对三种实际提示的可见范围及命中层；最终30项流程、20截图及7组实际录制通过。08的原通过报告与当时媒体仍保留，不将其重新标成失败。原失败、媒体、源码及报告保留；没有修改已执行脚本或把旧失败改称通过。

所有本次创建的浏览器、侧栏、原生客户端、API和原生PostgreSQL均已关闭，模型调用为0。使用假数据与未签名Windows包，本轮不关闭其他需求的完整验收。

| 编号 | 仍待完成 | 当前范围 |
| --- | --- | --- |
| 待办-01 | 其余必需需求 | 88条完整验收仍开放；本轮未新增整条结案。 |
| 待办-02 | 企业身份与全会话矩阵 | 正式企业身份、签名安装登录及其他并发／撤销／离线组合。 |
| 待办-03 | 全业务与后台运营 | 全部角色专业交付、媒体／营销服务、各资源运营及权限矩阵继续按原编号完成。 |
| 待办-04 | 整体交付与正式安装 | 独立检出复现、正式签名安装及综合端到端交付。 |
| 待办-05 | 建议及可选 | 12条未确认建议、1条可选单列。 |

[全部102条编号](../quality/remaining-work-stage135.md) · [检查点](../quality/client-errors-checkpoint-135.json) · [原始证据](../quality/client-errors-evidence-135/index.json) · [实现与逻辑图](../technical/135-client-connection-and-session-recovery.md)

"""
for component, suffix in [("desktop", "native-unconfirmed-zh.png"), ("web", "grant-result-recovery.gif"), ("admin", "connection-recovery.gif"), ("extension", "connection-and-retry.gif")]:
    item = next(row for row in cp["media_files"] if row["path"].startswith("copypaste-" + component + "/") and row["path"].endswith(suffix))
    change_text += "![实际 " + component + "](../../dev/" + item["path"] + ")\n\n"
changes.write_text(change_text, encoding="utf-8", newline="\n")
print(json.dumps({"updated_bilingual_files": len(files), "original_identities": 102, "required_open": 88, "new_full_acceptance_closures": 0}))
