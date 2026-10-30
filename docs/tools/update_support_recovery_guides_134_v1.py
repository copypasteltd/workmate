"""Publish bilingual current recovery instructions and preserve prior guide bytes."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[2]
cp = json.loads((ROOT / "docs/quality/support-recovery-checkpoint-134.json").read_bytes())
assert cp["status"] == "verified_support_recovery_and_original_tc095"
ARCHIVE = ROOT / "docs/quality/history/stage134-guides-before"
assert not ARCHIVE.exists()
BASE = "https://github.com/copypasteltd/workmate/blob/"
MARKER = "<!-- support-recovery-stage134 -->"
attempt = cp["qualified_attempts"][1].removeprefix("ui-")
STEM = f"workmate-support-recovery-134-{attempt}-"


def media(component, target, name):
    return ("assets/screenshots/" if component == target else BASE + target + "/assets/screenshots/") + STEM + name


def block(english, component):
    if english:
        text = """## Safe support-grant recovery and accepted support scope · Stage134

In **Web or Desktop → Account settings → Time-limited support**, choose explicit projects, the reason and duration. An empty project selection means metadata only. The first submission now fixes its request key and deadline. If its response is lost, use **Check previous request** or retry the same details; refreshing retrieves the existing result without automatically submitting again. Different details cannot replace an unresolved request. A recovered grant shows its current active, revoked or expired state and never gains extra time. You can revoke it from the list at any time.

Recovery stores only an opaque key, an intent digest and the fixed deadline in the current browser session. It does not persist the reason, project IDs, content or credentials. With storage disabled, recovery is limited to the running renderer; committed grants remain visible in the server list. Switching accounts or workspaces prevents late results from filling the new form. The native Desktop bridge permits only the customer receipt GET, alongside existing customer grant operations; it exposes no administrator impersonation route.

**Original REQ-095 / TC-095 is now accepted** against twelve individually mapped conditions and current source-bound evidence: real administrator identity and a read-only banner, explicit scope, independent body permission, write/payment/VIP/credential refusal, no hidden customer login, real-clock expiry, revocation and audit failure rollback. This closes one original requirement. REQ-055 whole-platform accessibility and REQ-094 whole-platform permission/concurrency matrices remain separate open work.

65 related backend checks, one native bridge boundary check and 18 actual Admin/Web/packaged Desktop journey checks passed. Ten build commands passed. The evidence includes real HTTP response loss before/after commit, reload, an actual workspace switch, identical retries, current-receipt recovery, real expiry and native customer revocation; user/native sessions, refresh-token and native-code row counts remain unchanged during support activity. Nine screenshots and five actual GIF/MP4 pairs are bound to the exact sources. Support controls work with keyboard input and enlarged text; Web/Admin use CSS zoom=2 and Desktop uses actual native webContents zoom=2. This does not constitute full browser/screen-reader accessibility acceptance.

Desktop continues to run Codex on the customer's computer, with separate explicit full local permission and a frameless window without Electron menus or visible scroll rails. Extension retains the native Chrome Side Panel for approved file uploads and cloud execution. Models did not run; business fixtures and retained output are synthetic. The Windows package is unsigned. All owned test browsers, native clients and databases closed.
"""
        tail = "One requirement is accepted; 88 required records, 12 unconfirmed suggestions and one optional record remain open. These are acceptance records, not 101 uncoded modules. Complete source-delivery reproduction, signed installation, production integration and the remaining business acceptance continue in the numbered ledger. Earlier sections retain their original historical scope."
        diagram = """```mermaid
flowchart LR
  C[Customer consent] --> F[Fixed attempt and deadline]
  F --> P[Company server]
  P --> L[Response lost]
  L --> R[Read own current receipt]
  R --> E[Existing grant current state]
  R --> S[Same details and key retry]
  S --> P
  E --> V[Customer can revoke]
```
"""
    else:
        text = """## 客户授权恢复与客服原始验收 · 阶段134

客户从 **Web／Desktop → 账户设置 → 客服限时协助** 选择项目、原因及期限，空项目选择只表示元资料。首次提交固定申请编号和截止时间。响应丢失后可点击**查收先前申请**，或使用相同资料重试；刷新先查询既有结果，不自动再次提交。不同资料不能替换尚未确认的申请。查收展示目前有效／撤销／到期状态，不会续期；客户随时可在列表撤销。

恢复记录只在当前浏览器会话保存随机编号、申请摘要和固定截止时间，不保存原因、项目ID、正文或凭证。禁用存储时仅当前renderer内可恢复；服务器已经提交的授权仍显示在列表中。切换账户或企业后，迟到的结果不能回填新表单。原生Desktop桥仅新增客户查收GET，不开放管理员支持接口。

**原始REQ-095／TC-095已通过验收**，十二条条件逐项对应当前源码与真实执行证据：真实管理员和只读提示、明确范围、独立正文权限、写入／付款／VIP／凭证拒绝、无隐身登录、真实到期、撤销及审计失败回滚。本轮关闭这一条原始需求；全平台无障碍REQ-055、完整权限与竞争矩阵REQ-094继续各自跟踪。

65项相关后端检查、1项原生桥边界检查、18项实际Admin／Web／打包Desktop旅程及10条构建命令通过。覆盖提交前／后真实HTTP响应丢失、刷新、实际切换企业、同内容重试、当前回执查收、真实到期和原生客户撤销；客服操作期间user／native会话、刷新令牌和本机授权码行数不增加。确切源码绑定9截图和5组实时GIF／MP4。支持页面验证键盘及文字放大，Web／Admin采用CSS 200%，Desktop采用实际原生webContents 200%缩放；不据此关闭全平台浏览器／读屏验收。

Desktop继续在客户本机运行Codex，客户独立主动授予完整本机权限；保持无边框、无Electron默认菜单和无可见滚动条。Extension继续使用Chrome原生Side Panel承载获准文件上传与云端执行。本轮模型没有运行，业务及保留结果为合成夹具，Windows包未签名。自建浏览器、原生客户端与数据库均已关闭。
"""
        tail = "本轮1条需求验收完成；仍有88条必需、12条未确认建议和1条可选记录开放。这是完整验收记录数量，不代表101个未编码模块。完整源码交付复现、签名安装、生产接入及其余业务验收继续按编号推进；下方历史章节保留原运行范围。"
        diagram = """```mermaid
flowchart LR
  C[客户明确授权] --> F[固定申请与截止时间]
  F --> P[公司服务器]
  P --> L[响应丢失]
  L --> R[查收本人当前回执]
  R --> E[既有授权目前状态]
  R --> S[相同资料同键重试]
  S --> P
  E --> V[客户可随时撤销]
```
"""
    links = f"[方案 / Behavior]({BASE}main/docs/technical/134-support-grant-recovery-and-acceptance.md) · [TC-095 acceptance]({BASE}main/docs/quality/tc095-acceptance-134.json) · [Checkpoint]({BASE}main/docs/quality/support-recovery-checkpoint-134.json) · [完整编号清单 / Remaining work]({BASE}main/docs/quality/remaining-work-stage134.md)"
    captures = f"""![Actual native unconfirmed request]({media(component, 'desktop', 'native-unconfirmed-en.png')})

![Actual customer result recovery and workspace switch]({media(component, 'web', 'grant-result-recovery.gif')})

![Actual fixed-intent keyboard retry]({media(component, 'web', 'fixed-intent-retry.gif')})

[Recovery recording]({media(component, 'web', 'grant-result-recovery.mp4')}) · [Retry recording]({media(component, 'web', 'fixed-intent-retry.mp4')}) · [Native grant]({media(component, 'desktop', 'customer-grant.mp4')}) · [Native revocation]({media(component, 'desktop', 'customer-revocation.gif')}) · [200% Admin]({media(component, 'admin', 'support-en-200.png')}) · [Chinese dark Admin]({media(component, 'admin', 'support-zh-dark.png')})
"""
    return MARKER + "\n" + text + "\n" + diagram + "\n" + links + "\n\n" + captures + "\n" + tail + "\n\n---\n\n"


for component in ["docs", "platform", "web", "admin", "desktop", "extension", "delivery"]:
    directory = ROOT / "docs" if component == "docs" else ROOT / ("dev/copypaste-" + component)
    for name in ["README.md", "README.en.md"]:
        target = directory / name
        before = target.read_bytes()
        assert MARKER.encode() not in before
        archive = ARCHIVE / component / name
        archive.parent.mkdir(parents=True, exist_ok=True)
        with archive.open("xb") as stream:
            stream.write(before)
        heading, rest = before.decode().split("\n", 1)
        target.write_text(heading + "\n\n" + block(name == "README.en.md", component) + rest.lstrip("\r\n"), encoding="utf-8", newline="\n")
print("Updated seven bilingual guide pairs; original bytes retained")
