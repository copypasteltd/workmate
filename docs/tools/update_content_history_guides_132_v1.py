"""Prepend the qualified bilingual increment; retain earlier guides verbatim."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[2]
CP = ROOT / "docs/quality/content-history-checkpoint-132.json"
assert json.loads(CP.read_bytes())["status"] == "verified_bounded_admin_content_history"
ARCHIVE = ROOT / "docs/quality/history/stage132-guides-before"
assert not ARCHIVE.exists()
BASE = "https://github.com/copypasteltd/workmate/blob/"
marker = "<!-- content-history-stage132 -->"


def block(english, admin):
    media = "assets/screenshots/" if admin else BASE + "admin/assets/screenshots/"
    stem = "workmate-content-history-132-02-"
    links = f"[{'Behavior' if english else '实现方案'}]({BASE}main/docs/technical/132-admin-content-history.md) · [Checkpoint]({BASE}main/docs/quality/content-history-checkpoint-132.json) · [{'Numbered open work' if english else '完整编号待办'}]({BASE}main/docs/quality/remaining-work-stage132.md) · [API supplement]({BASE}backend/contracts/admin-content-history-route-additions.json)"
    if english:
        prose = """## Complete administrator content history · Stage132

Open **User content → Read content** on a conversation, specialist or memory. Read up to 50 original records per page, move in either direction or jump to the first/last page. Specialist and memory versions start with the newest and distinguish **Customer version** from **Administrator revision**. Expand a version to inspect its complete record.

The server rechecks the current MFA session, both content-reading permissions, tenant/project scope and explicit denials on every request. Signed cursors reject stale content. The visible reader rechecks every 15 seconds and on focus; failed authorization or changed readable sources clears its private state. Closing or changing resources aborts old requests and rejects late bodies. Bodies and cursors are not saved to browser storage. Unavailable assistant sources are masked.

The new GET `/v1/admin/content/:kind/:id/history` accepts `edge=first|last` or a returned `cursor`, with a fixed page size of 50. SQL134 maintains the message-history revision. Legacy body responses retain their limit and add `truncated` plus `history_url`. Ordinary customer conversations still have their existing 80-input limit.

54 related backend tests and 9 actual browser journey checks passed. Real API fixtures contain 205 specialist versions, 205 memory versions and 66 customer messages. Native PostgreSQL, email/MFA, actual administrator revision, source withdrawal, permission denial, late responses and 375/768/1440 layouts were exercised. Business data and retained assistant output are explicitly synthetic; no model ran. Original failed attempts and their exact sources remain available. Current captures contain 5 screenshots and 2 real-time GIF/MP4 pairs. All owned test resources closed.
"""
        diagram = """```mermaid
flowchart LR
  A[Email and MFA] --> B[Select user content]
  B --> C[Current scope and body permission]
  C --> D[Read 50 original records]
  D --> E[Previous / next / first / last]
  E --> C
  D --> F[Focus or periodic recheck]
  F --> C
  C --> G[Clear body when denied or changed]
```
"""
        tail = "89 required, 12 unconfirmed suggested and 1 optional full-acceptance records remain open. This is bounded history-reader qualification; full operations, all roles, production models/connectors and signed desktop installation remain in the numbered ledger. Historical sections below keep their original scope."
    else:
        prose = """## 后台完整内容历史 · 阶段132

从「用户端内容 → 阅读正文」进入会话、专家或记忆，每页最多50条，可前后翻页或直达首尾。专家和记忆从最新版本开始，区分「客户版本」与「管理员修订」，展开后可查看完整版本记录。

每次请求复核当前MFA会话、两项正文读取权限、企业／项目范围及显式拒绝。签名游标拒绝旧版本继续翻页。阅读器在可见时每15秒及重新聚焦时复查；权限失效或可读来源变化后清空正文。关闭或切换内容会取消旧请求，迟到响应不能覆盖新内容。正文和游标不写入浏览器存储；助手来源不可用时隐藏正文。

新增GET `/v1/admin/content/:kind/:id/history`，使用`edge=first|last`或服务器返回的`cursor`，固定每页50条。SQL134维护消息历史修订号。旧正文接口保留原限制并增加`truncated`与`history_url`。普通客户会话仍保留既有80条输入限制。

54项后端相关测试及9项实际后台旅程通过。真实API创建205版专家、205版记忆及66条客户消息，实际运行原生PostgreSQL、邮箱/MFA、管理员修订、来源撤回、权限拒绝、迟到响应及375/768/1440布局。业务数据和保留的助手结果明确为合成数据，模型没有运行。原始失败及对应源码保留；本轮通过旅程留有5张截图和2组实时GIF/MP4。所有所属测试资源已关闭。
"""
        diagram = """```mermaid
flowchart LR
  A[邮箱及MFA登录] --> B[选择用户端内容]
  B --> C[核对当前范围及正文权限]
  C --> D[每页阅读50条原记录]
  D --> E[前后翻页或直达首尾]
  E --> C
  D --> F[聚焦或定期复查]
  F --> C
  C --> G[拒绝或变化后清空正文]
```
"""
        tail = "仍有89条必需、12条未确认建议及1条可选完整验收记录开放；它们不是102个未编码模块。本轮仅验收限定历史阅读范围，完整后台运营、全部角色、生产模型/连接器及签名安装继续按编号推进。下方历史章节保留其原始范围。"
    captures = f"""![Actual message history]({media}{stem}messages-en.png)

![Actual full version navigation]({media}{stem}complete-version-navigation.gif)

![Actual permission withdrawal]({media}{stem}permission-withdrawal.gif)

[Oldest memory version]({media}{stem}oldest-memory-en.png) · [Administrator provenance]({media}{stem}administrator-provenance-en.png) · [中文页面]({media}{stem}memory-history-zh.png) · [Permission denied]({media}{stem}permission-withdrawn-en.png) · [Navigation MP4]({media}{stem}complete-version-navigation.mp4) · [Withdrawal MP4]({media}{stem}permission-withdrawal.mp4)
"""
    return marker + "\n" + prose + "\n" + diagram + "\n" + links + "\n\n" + captures + "\n" + tail + "\n\n---\n\n"


for component in ["docs", "platform", "admin", "delivery"]:
    directory = ROOT / "docs" if component == "docs" else ROOT / ("dev/copypaste-" + component)
    for name in ["README.md", "README.en.md"]:
        target = directory / name
        before = target.read_bytes()
        assert marker.encode() not in before
        archive = ARCHIVE / component / name
        archive.parent.mkdir(parents=True, exist_ok=True)
        with archive.open("xb") as stream:
            stream.write(before)
        text = before.decode()
        heading, rest = text.split("\n", 1)
        target.write_text(heading + "\n\n" + block(name == "README.en.md", component == "admin") + rest.lstrip("\r\n"),
                          encoding="utf-8", newline="\n")

policy = ROOT / "docs/governance/04-git-branches-and-publication.md"
previous = policy.read_bytes()
archive = ARCHIVE / "docs/04-git-branches-and-publication.md"
with archive.open("xb") as stream:
    stream.write(previous)
heading, rest = previous.decode().split("\n", 1)
policy.write_text(heading + "\n\n" + marker + """
阶段132以`docs/tools/prepare_content_history_publication_132_v1.py`绑定当前后台历史源码、54项相关后端检查、9项实际界面旅程、双语指南及真实截图/实时GIF。使用`docs/tools/publish_content_history_132_v1.py --push`按既有授权普通原子更新八个映射引用，并读取远端SHA。阶段131的已发布完整历史检查作为明确的历史基线；本轮独立检查新增历史对象、全部当前文件路径和双语README链接，不宣称重新扫描旧历史。阶段128、130、131所有证明分片、失败和原始字节保留。用户未跟踪文件排除于提交并核对原字节；不强推。所有完整验收记录继续开放。

Stage132 binds the exact administrator history sources, 54 related backend checks, 9 actual UI journey checks, bilingual guides and real captures. Its publisher ordinarily updates eight refs atomically and verifies remote SHAs. The published Stage131 complete-history scan remains an explicitly historical baseline; this increment scans new history objects, every current path and current README links. All original proof layers, failed runs and user-owned untracked bytes are preserved. Earlier publication sections below describe their own historical scope.

""" + rest.lstrip("\r\n"), encoding="utf-8", newline="\n")
print(json.dumps({"updated_bilingual_guides": 8, "publication_policy": 1, "prior_bytes_archived": True}))
