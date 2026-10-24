"""Update bilingual customer workflows with independently recorded evidence."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

from sync_generated_video_docs import quickstart

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"


def read(file):
    return json.loads(file.read_text(encoding="utf-8"))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    output = ROOT / "docs/quality/audio-authorizations-documentation-refresh.json"
    assert not output.exists()
    proof = read(ROOT / "docs/quality/audio-authorizations-checkpoint.json")
    assert proof["status"] == "verified_independent_customer_audio_confirmation"
    baseline = read(ROOT / "docs/quality/history/stage85-before-audio-controls/receipt.json")
    originals = {row["source"]: row for row in baseline["files"]}
    records, copies = [], []
    intro = {
        "root": ("完整产品文档、当前交付范围和三端使用入口。", "Product documentation, current delivery scope and three customer clients."),
        "platform": ("后端将客户会话确认、音频作业、费用和审计独立记录。", "The backend separately records customer-session confirmation, audio operations, fees and audits."),
        "web": ("在云端 Codex 原任务中核对提案、确认使用并查看成果。", "Review proposals, approve use and inspect results inside the original cloud Codex task."),
        "admin": ("后台按独立范围和权限查看用户操作、费用与确认原文。", "Admin independently scopes operations, fees and sensitive customer-confirmation content."),
        "desktop": ("无边框 Desktop 在客户本机运行固定 Codex，保持可撤销完整本机权限。", "Frameless Desktop runs pinned Codex locally on the customer's machine with explicit revocable full local permission."),
        "extension": ("ChatGPT 式对话与附件位于 Chrome 原生右侧栏，获准文件上传云端。", "ChatGPT-style conversation and attachments live in the native Chrome right Side Panel, uploading authorized files to the cloud."),
        "delivery": ("独立交付工具保留实际窗口、完整回归、精确源码与资源关闭回执。", "Delivery retains actual-window journeys, complete regression, exact sources and owned-resource shutdown receipts."),
    }
    for component, descriptions in intro.items():
        repo = ROOT if component == "root" else DEV / ("copypaste-" + component)
        surface = "desktop" if component in ["root", "delivery"] else "web" if component == "platform" else component
        shots = proof["layout_screenshots"] if surface == "desktop" else proof["screenshots"]
        suffixes = {
            "desktop": ["-audio-consent-800.png", "-audio-zh-dark.png"],
            "web": ["-customer-confirmation-ready.png", "-audio-compact-zh-dark.png"],
            "admin": ["-independent-customer-confirmation-audit.png", "-audio-scope-costs.png"],
            "extension": ["-native-customer-consent-unchecked.png", "-native-customer-consent-withdrawn.png"],
        }[surface]
        items = [next(row for row in shots if row["path"].endswith(suffix)) for suffix in suffixes]
        media = next(row for row in proof["recordings"] if row["component"] == surface)
        items += [next(row for row in media["files"] if row["path"].endswith(ext)) for ext in [".gif", ".mp4"]]
        links = []
        for row in items:
            source = DEV / row["path"]
            assert digest(source) == row["sha256"]
            if component == "root":
                target = ROOT / "docs/design/implementation" / (Path(row["path"]).parts[0] + "__" + source.name)
                assert digest(target) == row["sha256"]
            elif source.is_relative_to(repo):
                target = source
            else:
                target = repo / "assets/workmate-current" / (Path(row["path"]).parts[0] + "__" + source.name)
                target.parent.mkdir(parents=True, exist_ok=True)
                if target.exists():
                    assert digest(target) == row["sha256"]
                else:
                    target.write_bytes(source.read_bytes())
                copies.append({"source": row["path"], "target": target.relative_to(ROOT).as_posix(), "sha256": digest(target)})
            links.append(target.relative_to(ROOT / "docs" if component == "root" else repo).as_posix())
        for english in [False, True]:
            file = (ROOT / "docs" if component == "root" else repo) / ("README.en.md" if english else "README.md")
            before = file.read_bytes()
            assert digest(file) == originals[file.relative_to(ROOT).as_posix()]["sha256"]
            title, old = before.decode("utf-8").split("\n", 1)
            assert "<!-- audio-authorizations-stage85 -->" not in old
            prefix = "" if component == "root" else "https://github.com/copypasteltd/workmate/blob/docs/docs/"
            start = quickstart(component, english).replace("SQL097", "SQL102")
            if english:
                body = f"""{descriptions[1]}

{start}

1. Sign in with email/OTP, select a workspace/project and the **Video & motion designer** preset (1.4.0 with speech-production 1.2.0). Describe the requested script or attach an authorized immutable WAV/MP3 source. Web and Extension run cloud Codex. In Desktop, select a local folder and explicitly grant the desired native permission; full access requires native confirmation and can be revoked.
2. The original Codex task proposes exact copy or source version/hash/duration, language/verified voice/speed, intended use and a frozen company quote. The **Confirm speech or transcription** card starts unchecked, with blank rights-reference and use fields. Review the exact proposal and price, enter your own authorization reference and use, check the box and choose **Confirm and continue**, or decline. Neither model-supplied rights fields nor full local permission signs this operation for you.
3. The original tool waits for at most five minutes without an audio POST, an audio-job reserve, extra provider capacity or a second AI turn. Original task reasoning already used remains chargeable. After customer confirmation, current session, source, role/skill, task lease, permission, capability, shared budget and capacity are rechecked before the one audio operation. Stop, expiry, decline and lost authority block dispatch. Withdrawal blocks later delivery/downloads; a submitted unknown or actual fee remains recorded. An unknown POST is never automatically replayed.
4. Open **Speech and subtitles → Review audio and subtitles** to play/save the retained authenticated WAV or the original transcript/timing. Byte size and SHA-256 are checked. Manual subtitle edits create immutable versions, require explicit replacement times and preserve old versions without an AI call. Missing service timestamps remain missing. A stale version conflicts while keeping the edit.
5. In separately authenticated Admin with MFA, **Provider control** shows audio operations and customer-authorization records. The request-read permission controls scoped metadata, cost-read separately controls fees, and content-body-read plus recent MFA permits audited sensitive confirmation/original-body access. Admin has no action to confirm for a customer. Body erasure on original-task deletion preserves minimal hashes/status/fee facts.

Before upgrading clients, apply **SQL102** with backend npm run db:migrate. SQL001–101 and all four published original/audio OpenAPI files remain unchanged; audio-authorizations-openapi.json is an additive current contract. Upgrade cancels old unsubmitted audio at zero and retains dispatched unknown cost holds. Completed legacy files keep their exact bytes and are labelled as legacy model declarations; migration never invents a human confirmation.

Keep company gateway origins, credentials, exact speech/transcription aliases, verified voice/locale lists, positive character/millisecond tariffs and timestamp support on the backend. Audio capacity begins at zero and needs the existing independently approved policy. Normal demo does not automatically enable this explicit synthetic audio fixture. All AI requests use the company OpenAI-compatible server; text, image, video and audio share the task budget.

Desktop preserves CopyPaste blue/cream, typography and both themes. It has **no Electron frame/menu and no visible vertical or horizontal scrollbar rails**. Long content wraps; real wheel/Home/End/Tab, last-action focus and truthful task/upload/media progress remain. The actual packaged OS window was checked at 1440×980, 1280×800 and 800×600, including the new customer form. Extension remains an actual native right SIDE_PANEL with chat, attachments and authorized uploads, without requiring Desktop.

Observed checks: platform **{proof['platform_tests']['tests']}**, preserving all **988** prior cases across 78 files/20 isolated native database batches; audio/gateway/upgrade **56**; compatibility **80**; client tests **124**; actual Web/Admin/Side Panel **13**; packaged local Desktop **41**. All selected source hashes match exactly; actual media and owned-process cleanup are retained. The current catalog has 32 package versions/29 Skill kinds; all 31 published packages and the previous role 1.3.0 remain intact. Failed attempts keep their original outcomes.

Synthetic tone, fixed ASR/reasoning and native-dialog decisions prove this bounded flow only. Independent logged-in attestation is not proof of copyright ownership. Live voice/Cantonese quality, managed audio verification/publication/rollback, unknown-POST external evidence/independent settlement/recovery, signed installers, all professional roles and complete Codex Desktop parity remain open. Original **102 REQ / 102 TC: 83 partial, 19 unproven, 0 fully accepted; G01–G10 open**.
"""
                labels = ["Design and boundaries", "Exact-source evidence", "Current additive API", "Actual customer control", "Actual retained state", "Recorded interaction", "Original MP4", "Previous delivery details and historical evidence"]
                note = "Actual native right Chrome Side Panel" if surface == "extension" else "Actual packaged frameless local-Codex Desktop" if surface == "desktop" else "Actual authenticated UI"
                note += "; unedited screenshots and observed-time recordings. Company models/media and native dialog decisions are explicit fixtures."
            else:
                body = f"""{descriptions[0]}

{start}

1. 邮箱/验证码登录，选择企业/项目和「**影片与动效设计师**」预设（1.4.0，加载 speech-production 1.2.0），描述脚本或附加获准的固定版本 WAV/MP3。Web/Extension 使用云端 Codex；Desktop 先选本机目录并主动授予所需本机权限，完整权限经原生确认，可随时撤回。
2. 原 Codex 任务提出精确文案或音源版本/摘要/时长、语言/已核验声音/速度、用途及固定公司报价。「**确认配音或转写**」卡片初始不勾选，权利依据和用途初始为空。客户核对内容及费用，亲自填写依据与用途、勾选并「确认并继续」，也可以拒绝。模型参数的权利声明及完整本机权限不能代替具体客户确认。
3. 原工具最多等待五分钟；等待不提交音频 POST、不增加音频作业预留、服务容量或第二轮 AI。原任务已有推理用量仍真实计费。客户确认后再次检查当前会话、来源、角色/Skill、任务租约、权限、能力、共享预算和容量，再派发唯一音频操作。停止、过期、拒绝及失权阻断派发；撤回阻断后续交付/下载，但已提交的未知或真实费用保留，未知 POST 不自动重发。
4. 在「配音与字幕 → 查看音讯与字幕」播放/保存受保护 WAV，检查原始转写和实际时间；接口核对字节数与 SHA-256。人工字幕修订另存不可覆盖版本，替换时间需客户明确提供，保留旧版本且无 AI 调用。服务未返回时间时不造时间；并发冲突保留编辑。
5. Admin 独立登录并通过 MFA，在「调用管理」查看音频作业及客户授权记录。请求读取控制范围元数据，费用读取独立控制金额，正文读取加近期 MFA 才能审计读取敏感确认/原始正文；后台没有替客户确认操作。原任务删除会擦除正文，仅保留最小摘要、状态与费用事实。

升级客户端前，后端执行 npm run db:migrate 应用 **SQL102**。SQL001–101 及四份已发布原始/音频 OpenAPI 字节保留，audio-authorizations-openapi.json 为增量当前契约。升级取消尚未派发的旧音频并确认零音频费；已派发未知结果保留费用预留。历史完成文件保留原始字节，明确标记旧模型声明，不补造客户确认。

公司网关地址、密钥、精确配音/转写别名、已核验声音/语言、正数字符/毫秒费率和时间戳能力仅配置在后端。音频容量初始为零，按已有独立审批策略发布。普通 demo 不自动启用本轮明确音频夹具。全部 AI 经公司 OpenAI 兼容服务器，文本/图片/影片/音频共享任务预算。

Desktop 保留 CopyPaste 蓝/米白色、字体与明暗主题，**无 Electron 自带边框菜单，无任何可见纵向或横向滚动条**。长内容换行，真实滚轮/Home/End/Tab、末项焦点和任务/上传/媒体真实进度保留。已在实际打包 OS 窗口 1440×980、1280×800、800×600 检查，包括新客户确认表单。Extension 保持真实原生右侧 SIDE_PANEL、ChatGPT 式对话/附件及获准文件上传，无 Desktop 依赖。

实际核查：平台 **{proof['platform_tests']['tests']}**（保留原 **988** 用例，78 文件/20 独立原生数据库批次）、音频/网关/升级 **56**、兼容 **80**、客户端 **124**、真实 Web/Admin/侧栏 **13**、打包本机 Desktop **41**。选定回执与全部当前记录源码摘要精确相符，实际媒体与自建资源关闭均保留。目录为 32 个包版本/29 类 Skill，已发布 31 个包及旧角色 1.3.0 完整保留；失败回执不覆盖。

本轮使用合成音调、固定转写/推理及明确原生对话框决策，只证明该局部流程。独立登录声明不等于法律权属审核。真实声音/粤语质量、后台音频能力核验/发布/回滚、未知 POST 外部证据/独立结算/恢复交付、签名安装、全部专业角色及完整 Codex Desktop 对齐仍保留。原 **102 REQ/102 TC：83 部分、19 未证明、0 完整验收；G01–G10 保留**。
"""
                labels = ["方案与边界", "精确版本证据", "当前增量接口", "实际客户控制", "实际保留状态", "真实交互录制", "原始 MP4", "以前交付细节与历史证据"]
                note = ("Chrome 真实原生右侧栏" if surface == "extension" else "真实打包无边框本机 Codex Desktop" if surface == "desktop" else "实际已登录页面") + "；截图未经改图，交互按观察时间录制。公司模型/媒体及原生对话框决策为明确夹具。"
            block = f"""<!-- audio-authorizations-stage85 -->

{body}

[{labels[0]}]({prefix}technical/85-audio-rights-and-administration.md) · [{labels[1]}]({prefix}quality/audio-authorizations-checkpoint.json) · [{labels[2]}]({prefix}contracts/audio-authorizations-openapi.json)

~~~mermaid
flowchart LR
    Login[Email / company / project] --> Role[Versioned role and Skill]
    Role --> Cloud[Web / Side Panel cloud Codex]
    Role --> Local[Desktop local Codex]
    Cloud --> Proposal[Immutable proposal / exact quote]
    Local --> Proposal
    Proposal --> Customer[Current customer session / explicit confirmation]
    Customer --> Gate[Current source / permission / budget / capacity]
    Gate --> Company[Company audio API / one submission]
    Company --> Assets[Private original / actual timing / versions]
    Customer --> Withdraw[Decline / Stop / withdraw]
    Withdraw --> Block[Block dispatch or delivery / retain real fees]
    Admin[Scoped Admin / audited content / separate costs] --> Proposal
~~~

{note}

![{labels[3]}]({links[0]})

![{labels[4]}]({links[1]})

![{labels[5]}]({links[2]})

[{labels[6]}]({links[3]})

<details>
<summary>{labels[7]}</summary>

{old.strip()}

</details>
"""
            file.write_text(title.rstrip("\r") + "\n\n" + block, encoding="utf-8", newline="\n")
            records.append({"path": file.relative_to(ROOT).as_posix(), "before_sha256": sha256(before).hexdigest(), "after_sha256": digest(file)})
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "updated_bilingual_customer_audio_confirmation",
        "readmes": records, "copied_actual_media": copies, "checkpoint_sha256": digest(ROOT / "docs/quality/audio-authorizations-checkpoint.json"),
        "verifier_sha256": digest(Path(__file__))}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "bilingual_readmes": len(records), "actual_media_copies": len(copies)}))


if __name__ == "__main__":
    main()
