"""Publish bounded audio usage and actual media to seven bilingual READMEs."""
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
    receipt = ROOT / "docs/quality/audio-production-documentation-refresh.json"
    assert not receipt.exists()
    proof = read(ROOT / "docs/quality/audio-production-checkpoint.json")
    assert proof["status"] == "verified_internal_audio_subflow"
    baseline = read(ROOT / "docs/quality/history/stage84-before-audio/receipt.json")
    originals = {row["source"]: row for row in baseline["files"]}
    records, copies = [], []
    roles = {
        "root": ("三种客户入口、后台及内部音频服务的当前文档。", "Current documentation for the three customer clients, Admin and internal audio services."),
        "platform": ("后端新增持久音频作业、共享预算、来源门控及不可覆盖字幕版本。", "The backend adds durable audio operations, shared budgets, source gates and immutable subtitle revisions."),
        "web": ("在云端 Codex 任务中查看、播放及下载配音，直接修订字幕。", "Review, play and save speech and revise subtitles inside cloud Codex tasks."),
        "admin": ("后台分别控制音频作业元数据、费用与敏感原始正文。", "Admin independently controls audio-job metadata, costs and sensitive original bodies."),
        "desktop": ("Desktop 使用本机 Codex 执行音频工具，保持无边框和完整可撤销的本机权限。", "Desktop executes audio tools through local Codex, with a frameless window and explicit revocable full local permission."),
        "extension": ("原生 Chrome 右侧栏独立承载对话、获准文件上传及云端音频成果。", "The native Chrome right Side Panel independently hosts chat, authorized uploads and cloud audio results."),
        "delivery": ("交付脚本保存真实客户端交互、完整测试清单与自建资源清理回执。", "Delivery retains actual client journeys, the complete regression inventory and owned-resource cleanup receipts."),
    }
    for component, intro in roles.items():
        repo = ROOT if component == "root" else DEV / ("copypaste-" + component)
        surface = "desktop" if component in ["root", "delivery"] else "web" if component == "platform" else component
        shots = proof["layout_screenshots"] if surface == "desktop" else proof["screenshots"]
        suffixes = {"desktop": ["-audio-editor-800.png", "-audio-zh-dark.png"],
                    "web": ["-subtitle-edit-original-timing.png", "-audio-compact-zh-dark.png"],
                    "admin": ["-audio-scope-costs.png", "-audio-rights-body-compact.png"],
                    "extension": ["-native-caption-editor.png", "-native-audio-zh.png"]}[surface]
        items = [next(row for row in shots if row["path"].endswith(suffix)) for suffix in suffixes]
        recording = next(row for row in proof["recordings"] if row["component"] == surface)
        items += [next(row for row in recording["files"] if row["path"].endswith(ext)) for ext in [".gif", ".mp4"]]
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
                target = repo / "assets/screenshots" / ("stage84-" + surface + "-" + source.name)
                assert not target.exists()
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read_bytes())
                copies.append({"source": row["path"], "target": target.relative_to(ROOT).as_posix(), "sha256": row["sha256"]})
            links.append(target.relative_to(ROOT / "docs" if component == "root" else repo).as_posix())
        for english in [False, True]:
            file = (ROOT / "docs" if component == "root" else repo) / ("README.en.md" if english else "README.md")
            before = file.read_bytes()
            assert digest(file) == originals[file.relative_to(ROOT).as_posix()]["sha256"]
            title, old = before.decode("utf-8").split("\n", 1)
            assert "<!-- audio-production-stage84 -->" not in old
            prefix = "" if component == "root" else "https://github.com/copypasteltd/workmate/blob/docs/docs/"
            start = quickstart(component, english).replace("SQL097", "SQL101")
            if english:
                body = f'''{intro[1]}

{start}

1. Sign in with email/OTP and choose a company/project. Select the **Video & motion designer** preset (version 1.3.0, `speech-production` 1.1.0) and describe the approved script or attach an authorized WAV/MP3 asset. In Desktop, choose a local folder and explicitly set the local permission; full access requires native confirmation and can be revoked. Web/Extension run cloud Codex; Desktop orchestration stays local.
2. Ask for speech or file transcription in the task. The server checks the current role, optional verified audio capability, language/voice allowlists, exact source version, budget and published provider capacity. All AI requests use the company's OpenAI-compatible gateway. Reasoning, images and audio share one task budget. Unconfigured audio does not disable existing video editing.
3. Open **Speech and subtitles → Review audio and subtitles**. WAV playback and save use authenticated bytes with size/SHA-256 checks. Transcription retains the original raw JSON, text and actual service timing. Without returned timestamps, it shows text only; it does not invent caption times.
4. Select the current transcript version and **Revise subtitles**. Edit text/time or remove/add captions, supply a reason and save a new version. New manual time fields start blank. Earlier versions remain read only; the original remains available. A concurrent change rejects the stale version and retains your edits. Manual revisions make no AI call or new generation charge.
5. Admin uses its separate email/OTP/TOTP identity. In **Provider control → Speech & transcription jobs**, `admin.ai.requests.read` allows scoped metadata, `admin.ai.cost.read` independently permits costs, and `admin.content.body.read` plus recent MFA permits an audited original-body read. The original request cannot be overwritten. Source isolation, deletion or permission loss blocks current previews/downloads. Confirmed costs use the existing independent-review ledger; a dispatched operation with unknown outcome holds its reservation and is not automatically retried.

Before upgrading clients, apply additive **SQL101** with backend `npm run db:migrate`. Keep `AI_BASE_URL`, `AI_ALLOWED_HOSTS`, credentials, exact speech/transcription aliases, positive character/millisecond tariffs and verified voice/locale lists on the server. Set `AI_SPEECH_VERIFIED` / `AI_TRANSCRIPTION_VERIFIED` only after protocol verification; timestamp support is separately declared. Audio slots/RPM start at **0** and need the existing separately approved policy publication. Ordinary `npm run demo` does not automatically enable this audio fixture. The observed checks use isolated explicit synthetic services.

Desktop uses CopyPaste typography/blue/cream and light/dark themes, with **no Electron frame/menu and no visible vertical or horizontal scrollbar rails**. Content wraps; real wheel/Home/End, last-action focus and truthful progress remain. A focused subtitle control stays visible after a real OS resize at 1440×980, 1280×800 and 800×600. Extension stays in the actual right Chrome Side Panel with ChatGPT-style chat/attachments, authorized uploads and no Desktop dependency.

Validation: platform **{proof['platform_tests']['tests']}** (all previous **968** cases retained), audio/gateway **43**, compatibility **80**, client tests **{proof['client_counts']}**, actual Web/Admin/Side Panel **10**, packaged local Desktop **40**. All three desktop sizes, real WAV decoding/saves, manual revisions and owned-resource cleanup were checked. SQL001–100 and both original OpenAPI files keep their published bytes; the seven audio operations are additive. Current runtime and executed test sources match the selected receipts. The only unrelated snapshot difference is a reviewed catalog-count test update from 30 to 31 versions; its entire four-file batch and the remaining batches ran afresh. Earlier passing results and the failed count assertion retain their original scope and bytes.

The audio fixture is a decoded synthetic tone with fixed ASR text. Live voices/Cantonese quality, independent human rights confirmation, managed audio validation/publication/rollback, unknown-POST external-bill evidence and recovery delivery remain open. Stored rights fields are tool parameters linked to the actor/task, not independently authenticated human consent. This bounded repair does not establish complete professional-role quality, signed installation or full Codex Desktop parity. Original **102 REQ / 102 TC: 83 partial, 19 unproven, 0 fully accepted; G01–G10 open**.
'''
                labels = ["Design and limits", "Exact-source evidence", "Additive API contract", "Actual editor", "Actual second locale/state", "Recorded interaction", "Original MP4", "Previous delivery details and historical evidence"]
                note = "Actual packaged local Desktop" if surface == "desktop" else "Actual Chrome SIDE_PANEL" if surface == "extension" else "Actual authenticated UI"
                note += "; original unedited screenshots and observed-time recordings. Audio/model/business content and native dialog decisions are explicit fixtures."
            else:
                body = f'''{intro[0]}

{start}

1. 邮箱/验证码登录并选择企业/项目，选用「**影片与动效设计师**」预设（1.3.0，加载 `speech-production` 1.1.0），描述获准脚本或附加获准 WAV/MP3 素材。Desktop 先选本机目录并主动设置本机权限；完整权限由原生确认授予，可随时撤回。Web/Extension 使用云端 Codex，Desktop 编排保持在本机。
2. 在任务中要求配音或文件转写。服务端检查当前角色、可选已核验音频能力、语言/声音白名单、精确源文件版本、预算及已发布容量。全部 AI 经公司 OpenAI 兼容网关；推理、图片和音频共享任务预算。未配置音频不会阻断已有视频剪辑。
3. 打开「配音与字幕 → 查看音讯与字幕」，播放/保存实际 WAV；保护接口核对字节数与 SHA-256。转写保留原始 JSON、文字及服务实际返回的时间。没有时间戳时只显示文字，不编造字幕时间。
4. 选择当前版本后「修订字幕」，修改文字/时间、删除或新增字幕，填写原因并另存新版本。新增人工时间初始为空；旧版本只读，原文保留。发生并发修改时拒绝旧版本覆盖并保留编辑。人工修订不调用 AI，不新增生成收费。
5. Admin 使用独立邮箱/验证码/TOTP 身份。在「调用管理 → 配音与转写作业」中，`admin.ai.requests.read` 控制范围内元数据，`admin.ai.cost.read` 独立控制费用，`admin.content.body.read` 加近期 MFA 控制并审计原始正文读取。原始要求不可覆盖；来源隔离、删除或失权阻断当前预览/下载。确认费用沿用独立审批账本；已派发但结果未知时保留原预留，禁止自动重发。

升级前在后端执行 `npm run db:migrate` 应用新增 **SQL101**。公司 `AI_BASE_URL`、`AI_ALLOWED_HOSTS`、密钥、精确配音/转写别名、正数字符/毫秒费率及已核验声音/语言列表仅配置在服务端。协议核验后才能开启 `AI_SPEECH_VERIFIED` / `AI_TRANSCRIPTION_VERIFIED`；时间戳能力另行声明。音频 slots/RPM 初始为 **0**，需按已有独立审批发布容量策略。普通 `npm run demo` 不自动启用本音频夹具；本轮检查使用隔离、明确声明的假服务。

Desktop 沿用 CopyPaste 字体、蓝/米白色与浅深主题，**无 Electron 自带边框菜单，无可见纵向或横向滚动条**。内容换行，保留真实滚轮/Home/End、末项焦点及真实进度；字幕控件聚焦后缩放真实 OS 窗口，仍在 1440×980、1280×800、800×600 中可见。Extension 保持真实 Chrome 右侧栏、ChatGPT 式对话/附件及获准文件上传，无 Desktop 依赖。

实际核查：平台 **{proof['platform_tests']['tests']}** 项（保留原 **968** 项）、音频/网关 **43**、兼容 **80**、客户端测试 **{proof['client_counts']}**、真实 Web/Admin/侧栏 **10**、打包本机 Desktop **40**。已检查三种桌面尺寸、实际 WAV 解码/保存、人工修订和自建资源清理。SQL001–100 与两份原 OpenAPI 保持各自已发布字节，七项音频接口为增量；当前运行时及实际执行的测试源码与选定回执一致。唯一无关快照差异是版本目录总数 30→31 的已复核测试更新；其完整四文件批次与剩余批次重新运行。以前通过及失败回执保持原范围与字节。

音频假服务使用可解码合成音调与固定转写。真实声线/粤语质量、独立人工授权确认、音频能力后台核验/发布/回滚、未知 POST 外部账单证据与恢复交付仍待补齐。保存的权利字段来自工具参数并绑定用户/任务，不是独立核实的人工同意。全部专业角色质量、签名安装及完整 Codex Desktop 对齐尚未完整验收。原 **102 REQ/102 TC：83 部分、19 未证明、0 完整验收；G01–G10 保留**。
'''
                labels = ["方案与边界", "精确版本证据", "新增接口契约", "实际编辑器", "实际第二语言/状态", "真实交互录制", "原始 MP4", "以前交付细节与历史证据"]
                note = ("真实打包本机 Desktop" if surface == "desktop" else "Chrome 原生 SIDE_PANEL" if surface == "extension" else "实际已登录页面") + "；原始截图未经改图，交互按观察时间录制。音频、模型、业务内容及原生对话框决策均为明确夹具。"
            block = f'''<!-- audio-production-stage84 -->

{body}

[{labels[0]}]({prefix}technical/84-internal-audio-production.md) · [{labels[1]}]({prefix}quality/audio-production-checkpoint.json) · [{labels[2]}]({prefix}contracts/audio-production-openapi.json)

```mermaid
flowchart LR
    Login[Email / company / project] --> Role[Versioned role and speech skill]
    Role --> Cloud[Web / Side Panel cloud Codex]
    Role --> Local[Desktop local Codex]
    Cloud --> Gate[Current source / budget / audio capacity]
    Local --> Gate
    Gate --> Company[Company speech / transcription API]
    Company --> Assets[Retained private originals and actual timing]
    Assets --> Revision[Manual versioned subtitles / no AI call]
    Assets --> Preview[Authenticated playback and save]
    Admin[Scoped Admin / independent body and cost permissions] --> Gate
```

{note}

![{labels[3]}]({links[0]})

![{labels[4]}]({links[1]})

![{labels[5]}]({links[2]})

[{labels[6]}]({links[3]})

<details>
<summary>{labels[7]}</summary>

{old.strip()}

</details>
'''
            file.write_text(title.rstrip("\r") + "\n\n" + block, encoding="utf-8", newline="\n")
            records.append({"path": file.relative_to(ROOT).as_posix(), "before_sha256": sha256(before).hexdigest(), "after_sha256": digest(file)})
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "updated_bilingual_audio_usage", "readmes": records, "copied_actual_media": copies,
              "checkpoint_sha256": digest(ROOT / "docs/quality/audio-production-checkpoint.json"), "verifier_sha256": digest(Path(__file__))}
    receipt.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "bilingual_readmes": len(records), "actual_media_copies": len(copies)}))


if __name__ == "__main__":
    main()
