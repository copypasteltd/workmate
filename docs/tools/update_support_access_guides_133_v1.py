"""Add bounded bilingual support instructions while retaining all earlier guide bytes."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[2]
CP = ROOT / "docs/quality/support-access-checkpoint-133.json"
assert json.loads(CP.read_bytes())["status"] == "verified_bounded_controlled_support"
ARCHIVE = ROOT / "docs/quality/history/stage133-guides-before"
assert not ARCHIVE.exists()
BASE = "https://github.com/copypasteltd/workmate/blob/"
MARKER = "<!-- support-access-stage133 -->"
STEM = "workmate-support-access-133-02-"

def media(component, target, name):
    return ("assets/screenshots/" if component == target else BASE + target + "/assets/screenshots/") + STEM + name

def block(english, component):
    links = f"[{'Behavior' if english else '实现方案'}]({BASE}main/docs/technical/133-controlled-support-source-and-native-access.md) · [Checkpoint]({BASE}main/docs/quality/support-access-checkpoint-133.json) · [{'Numbered remaining work' if english else '完整编号待办'}]({BASE}main/docs/quality/remaining-work-stage133.md)"
    if english:
        text = """## Controlled support and native customer authorization · Stage133

In **Web or Desktop → Account settings → Time-limited support**, choose the actual projects, a reason and a 15/30/60-minute deadline. An empty selection grants workspace/customer metadata only. Share the grant ID with support and revoke it from the same customer form at any time.

In **Admin → Support**, the administrator signs in with their own email and TOTP, chooses the customer, workspace, explicit projects, deadline and optional customer grant. The read-only banner keeps the real identities and deadline visible. Shared task bodies also require independent current body permission; private conversations stay private. The view provides no editing, billing, VIP or customer-login authority.

Support now checks original task sources before returning retained text. A quarantined/expired source or erased version blocks the body and masks its diagnostic title. Selected bodies use a current revision condition; changes during the audit are rejected. The page cancels old requests, rejects late task/session replies and clears bodies on changed revisions, source withdrawal, hidden views, failure, revocation or expiry. The server decides access on every read; visible Admin polling is approximately two seconds.

59 related backend tests and 13 actual Admin/Web/packaged native Desktop journey checks passed. The current source bytes bind 6 screenshots and 3 real-time GIF/MP4 pairs. Actual OTP/PKCE, email/TOTP, customer grants/revocation, delayed authorized responses, source withdrawal, real expiry, Chinese dark theme, four Admin widths and three frameless native widths were exercised. All owned browsers, the native client and test databases closed. Models did not run; business data, retained results and fixture file reads are explicitly synthetic. The Windows package remains unsigned.

Desktop continues to run Codex locally with the customer's separate explicit local-permission flow. Its support form uses customer-only routes; the administrator view stays in Admin. Extension continues to use the native Chrome Side Panel for approved file uploads and cloud execution. This increment changes no Extension execution code.
"""
        tail = "89 required full-acceptance records, 12 unconfirmed suggestions and 1 optional record remain open. They are not 102 uncoded modules. Full permission/concurrency matrices, all-page accessibility, signed installation and production integration remain in the numbered ledger. Earlier sections retain their original historical scope."
        diagram = """```mermaid
flowchart LR
  C[Customer Web or native Desktop] --> G[Explicit scope and deadline]
  G --> A[Administrator uses own identity]
  A --> P[Current permissions and original sources]
  P --> R[Selected body revision]
  R --> V[Read-only shared content]
  X[Revoke / expire / source withdrawn] --> K[Refuse read and clear body]
```
"""
    else:
        text = """## 受控客服与原生客户授权 · 阶段133

客户从 **Web／Desktop → 账户设置 → 客服限时协助** 选择实际项目、原因及15／30／60分钟期限；空选择只包含企业／用户元资料。把授权ID提供给客服，并可随时在同一客户表单撤销。

管理员以自己的邮箱与TOTP登录 **Admin → 支援工作台**，明确选择客户、企业、项目、期限及可选客户授权。只读横幅持续显示真实身份和截止时间。共享正文还需要当前独立正文权限，私人会话保持私有；该视图不提供写入、费用、VIP或客户登录权限。

客服接口现会核对任务原始来源。来源隔离／到期或版本擦除后，保留正文不可继续返回，诊断标题也会隐藏。所选正文绑定当前版本，审计期间变化会被拒绝。页面取消旧请求，拒绝迟到任务／会话响应；版本变化、来源撤回、隐藏、失败、撤销或到期后清空正文。服务端逐次判断权限；可见Admin约每两秒复查。

59项后台相关测试及13项实际Admin／Web／打包原生Desktop旅程通过，确切源码绑定6截图和3组实时GIF／MP4。实际验证OTP／PKCE、邮箱／TOTP、客户授权／撤销、迟到响应、来源撤回、真实到期、繁中深色、四档Admin宽度和三档原生无边框窗口。所属浏览器、客户端与测试数据库均已关闭。模型没有运行，业务数据、保留结果和夹具文件读取明确为合成数据；Windows包仍未签名。

Desktop继续在本机运行Codex，本机权限由客户独立主动授权；客服表单只调用客户接口，管理员视图留在Admin。Extension继续使用Chrome原生Side Panel，承载获准文件上传及云端执行；本轮没有修改Extension执行代码。
"""
        tail = "仍有89条必需完整验收、12条未确认建议及1条可选记录开放，不代表102个未编码模块。完整权限竞争矩阵、各页面无障碍、签名安装和生产接入继续按编号推进；下方历史章节保留原范围。"
        diagram = """```mermaid
flowchart LR
  C[客户Web或原生Desktop] --> G[明确范围及截止时间]
  G --> A[管理员使用自己的身份]
  A --> P[当前权限及原始来源]
  P --> R[所选正文版本]
  R --> V[只读共享内容]
  X[撤销／到期／来源撤回] --> K[拒绝读取并清空正文]
```
"""
    captures = f"""![Actual native customer grant]({media(component, 'desktop', 'native-grant-en.png')})

![Actual delayed task selection]({media(component, 'admin', 'task-selection.gif')})

![Actual native customer revocation]({media(component, 'desktop', 'customer-revocation.gif')})

[Native grant recording]({media(component, 'desktop', 'customer-grant.mp4')}) · [Selection recording]({media(component, 'admin', 'task-selection.mp4')}) · [Revocation recording]({media(component, 'desktop', 'customer-revocation.mp4')}) · [Web metadata-only grant]({media(component, 'web', 'metadata-grant-en.png')}) · [Chinese dark Admin]({media(component, 'admin', 'support-zh-dark.png')}) · [Source withdrawn]({media(component, 'admin', 'source-withdrawn-en.png')})
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
