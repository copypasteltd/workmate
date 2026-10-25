"""Refresh bilingual component READMEs from the qualified stage-86 checkpoint."""
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
    output = ROOT / "docs/quality/shared-project-documentation-refresh.json"
    assert not output.exists()
    checkpoint_file = ROOT / "docs/quality/shared-project-checkpoint.json"
    proof = read(checkpoint_file)
    assert proof["status"] == "verified_shared_project_guidance_and_private_chat"
    baseline = read(ROOT / "docs/quality/history/stage86-before-shared-configuration/receipt.json")
    originals = {row["source"]: row for row in baseline["files"]}
    descriptions = {
        "root": ("面向香港企业的 Codex Agent：云端 Web、独立 Chrome 右侧栏和客户本机 Desktop，配套分级权限与审计的 Admin 和后端。", "Codex Agents for Hong Kong businesses: cloud Web, an independent Chrome right Side Panel and customer-local Desktop, backed by scoped Admin and backend services."),
        "platform": ("身份、项目、Codex 编排、业务工具、来源权限、用量和审计的服务端。", "Server-side identity, projects, Codex orchestration, business tools, source permissions, usage and audits."),
        "web": ("在浏览器中使用云端 Codex、选择专业角色，并管理项目、工作及交付。", "Use cloud Codex and professional presets in a browser, with projects, work and deliverables."),
        "admin": ("独立 MFA 后台，按企业、项目、字段和操作权限管理用户、用量、费用、VIP 与内容。", "A separate MFA-protected console scopes user, usage, fee, VIP and content administration by company, project, field and operation."),
        "desktop": ("无边框桌面客户端在客户本机运行固定 Codex，客户可主动授予并随时撤销完整本机权限。", "Frameless Desktop runs pinned Codex on the customer device with explicitly granted, revocable full local permission."),
        "extension": ("Chrome 原生右侧栏内的 ChatGPT 式对话与附件，读取用户明确选取的文件并上传给云端 Codex。", "ChatGPT-style conversation and attachments in Chrome's native right Side Panel read explicitly selected files and upload them for cloud Codex."),
        "delivery": ("并列独立仓库的原生启动、完整回归、真实交互录制与非强制分支发布工具。", "Native startup, complete regression, actual interaction recordings and non-force branch publication for the independent component repositories."),
    }
    records, copies = [], []
    for component, intro in descriptions.items():
        repo = ROOT if component == "root" else DEV / ("copypaste-" + component)
        surface = "desktop" if component in ["root", "delivery"] else "web" if component == "platform" else component
        suffixes = {
            "web": ["-publication-preview-en.png", "-unavailable-reference-en.png"],
            "admin": ["-admin-metadata-only.png", "-admin-exact-version-body.png"],
            "desktop": ["-native-v3-reference-file.png", "-native-retained-v3-after-v4.png"],
            "extension": ["-native-accepted-v3-attachment-en.png", "-native-compact-settings-zh.png"],
        }[surface]
        shots = [row for row in proof["screenshots"] if row["path"].startswith("copypaste-" + surface + "/")]
        items = [next(row for row in shots if row["path"].endswith(suffix)) for suffix in suffixes]
        media = next(row for row in proof["recordings"] if row["component"] == surface and (surface != "desktop" or row["name"] == "native-project-guidance"))
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
            title, historical = before.decode("utf-8").split("\n", 1)
            assert "<!-- shared-project-stage86 -->" not in historical
            prefix = "" if component == "root" else "https://github.com/copypasteltd/workmate/blob/docs/docs/"
            start = quickstart(component, english).replace("SQL097", "SQL103")
            if english:
                body = f"""{intro[1]}

The product serves existing marketing teams first, with image/design/video, advertising analysis, SEO/GEO and repeated business workflows, plus software-development presets. The catalog contains 18 candidates; at least 12 professionally qualified presets remain a product acceptance requirement. All AI requests use the company's OpenAI-compatible server. Synthetic providers are authorized for development; configured demos do not prove live model quality.

{start}

1. Sign in using email/OTP or an explicitly configured company identity. Select a workspace/project; a new user creates a company or accepts an invitation. Native clients use the existing browser PKCE sign-in. Admin uses separately enrolled MFA credentials and assigned permissions.
2. A project owner/admin opens **Projects → Shared project guidance**, saves instructions, delivery requirements, an exact specialist/Skill version, brand version, shared-file versions, authorized accounts and an optional maximum task budget. Search/paginate file choices, save a draft, inspect the dependency preview and explicitly publish. Publication starts no AI, grants no access and changes no balance.
3. New work displays and pins the accepted guidance version/hash. Continuing tasks and local Codex threads retain their original version, including an explicitly absent configuration for work created before publication. Publishing a newer version never silently upgrades running work. Old versions can be copied into a new draft; immutable history is preserved.
4. The **Refresh guidance** action, focus/visibility refresh and 15-second polling recheck current source availability. Quarantine, expiry, deletion or lost permission hides unavailable bodies, including open history. The editor and history have distinct component identities; copying/publishing leaves exactly one history. Server tools independently recheck authorization before use.
5. Side Panel attachment selection creates the current actor's private conversation first, then uses resumable upload with exact original bytes/SHA-256 and scope-specific recovery receipts. A lost response resumes the original operation. It never falls back to a shared file. The actual uploader can download the exact bytes; an independently logged-in editor in the same project cannot list, read versions, download or open the private conversation. Publishing a file to the project needs a separate explicit action.
6. In Desktop choose a local folder and permission level; full local permission requires the customer's native confirmation and can be revoked. Codex and terminal/file operations run locally. Authorized company references use company tools. Current source, role, budget and cloud-data restrictions still apply. Web/Extension run cloud Codex; Extension requires no Desktop installation.
7. Admin controls scoped metadata, sensitive bodies, quarantine, restore and irreversible body erasure separately. User/tenant state, consumption, gift credits, recorded charges, VIP and approval-ledger controls retain their existing independent permissions. Previewing a financial operation changes no balance; idempotent replay does not grant twice. Admin cannot sign a customer's media consent.

Apply additive **SQL103** with backend `npm run db:migrate` before upgrading clients. SQL001–102 and four historical OpenAPI contracts keep their published bytes. The new eight-operation guidance contract and current route inventory describe **487 configured + one explicitly conditional demo route**. Keep gateway origins/keys, model aliases, verified media capability and tariffs on the backend; never in a renderer or Extension. Ordinary demo does not enable every specialized media fixture.

CopyPaste blue/cream, Manrope/Fraunces and light/dark themes remain. Desktop has no Electron frame/menu or visible vertical/horizontal scrollbar rails; actual scrolling, keyboard/last-action access and truthful progress remain. The native Side Panel keeps input, Send and Current page reachable at actual compact Chrome sizes with guidance/settings expanded in both languages. Full accessibility/DPI/site matrices remain open.

Current separate verification scopes: platform **{proof['platform_tests']['tests']}** (all **1001** prior cases retained; 79 files/20 native-database batches), focused **25**, compatibility **36**, client unit tests **139**, actual Web/Admin/Side Panel **14**, packaged local Desktop **50**. Native guidance executes real customer-device Codex across **v3/v3/v4**, with exact reference-tool/file bytes, three separately settled **90-micro-HKD** tasks and no cloud replacement. Model replies and selected native-dialog decisions remain explicit fixtures. Each receipt binds its own unchanged source; previous failures remain failed.

Current limits: guidance has up to 20 shared-file versions/12 connectors; Agent/brand/account option lists are bounded at 200. Side Panel accepts at most 20 nonempty attachments of 5 MiB each. Stored recovery receipts contain no file bytes or credentials; unfinished attachment selection is not an automatic cross-panel-close restoration promise. Full sleep/large-file/site matrices, twelve-role business qualification, complete Admin breadth, audio release/recovery, signed installation and full Codex Desktop parity remain open. All 102 original requirements and 26 gap groups remain in scope; no complete-product acceptance is implied.
"""
                labels = ["Design and boundaries", "Exact-source checkpoint", "Additive API", "Current gaps", "Actual guidance / task", "Actual controlled state", "Recorded interaction", "Original MP4", "Previous delivery details and historical evidence"]
                note = "Unedited actual UI and observed-time recordings. Provider content and native-dialog decisions are explicit fixtures; all owned browser/DB processes close."
            else:
                body = f"""{intro[0]}

产品先服务现有客户的 marketing 团队，覆盖图片/设计/视频、广告分析、SEO/GEO、重复业务流程和软件开发预设。当前目录为 18 个候选角色，至少 12 个专业角色完成业务资格仍是验收要求。全部 AI 走公司内部 OpenAI 兼容服务；开发可用已授权假数据，演示通过不代表真实模型质量。

{start}

1. 用户通过邮箱/验证码或明确配置的企业身份登录，创建企业或接受邀请后选择企业/项目；原生端使用既有浏览器 PKCE 登录。Admin 使用独立登记、具备 MFA 及对应权限的账号。
2. 项目 owner/admin 打开「项目 → 共享设置」，填写共同说明、交付要求、精确 Agent/Skill、品牌、共享文件版本、获准账号及可选单次预算上限。搜索/翻页选择文件，保存草稿，预览精确依赖后确认发布。发布不启动 AI、不授予权限、不改变余额。
3. 新工作展示并固定接收时的配置版本/摘要。旧任务及本机 Codex 线程续做保持原配置；在首次发布前开始的任务仍保留原先「无配置」状态。发布新版本不静默升级旧工作。历史只能复制成新草稿，原始版本不可覆盖。
4. 「重新核对设置」、窗口/页面恢复及 15 秒轮询重新检查来源。隔离、到期、删除或失权后隐藏不可用正文，包括打开的历史记录。历史与编辑弹窗使用独立组件标识，复制并发布不会遗留第二份旧历史；工具执行仍独立检查当前权限。
5. 侧栏选文件先创建当前用户的私有会话，再按原始字节/SHA-256 与精确范围回执分片上传；丢回包恢复原操作，不回退到共享文件。实际上传者可以下载原字节，同项目另一位独立登录编辑者不能列出、读版本、下载或访问该私有会话。共享到项目仍需独立明确操作。
6. Desktop 先选本机目录与权限，完整权限需客户原生确认且可撤销；Codex、终端与文件操作在客户本机运行，获准云端参考资料走公司工具。当前资料、角色、预算与云数据权限继续生效。Web/Extension 在云端运行 Codex，Extension 无须安装 Desktop。
7. Admin 的范围内元数据、敏感正文、隔离、恢复及永久正文删除分别授权；用户/企业状态、消耗、赠额、费用登记、VIP 与审批账本继续执行各自权限。财务预览不改余额，幂等重放不重复赠额；后台不能替客户签署具体媒体授权。

升级客户端前在后端执行 `npm run db:migrate` 应用增量 **SQL103**。SQL001–102 与四份历史 OpenAPI 保持已发布字节。新增共享配置八项接口，当前路由为 **487 项配置接口 + 一项明确条件化的 demo 接口**。公司网关、密钥、模型别名、已核验媒体能力及费率仅配置于后端，不进入渲染器/扩展。普通示范不自动启用全部专项媒体夹具。

保留 CopyPaste 蓝/米白、Manrope/Fraunces、浅深主题。Desktop 无 Electron 原生边框菜单、无可见纵横滚动条，保留真实滚动、键盘/末项访问及实际进度。原生侧栏在实际紧凑 Chrome 窗口和两种语言展开说明/设置时，输入框、发送与当前页面仍可触达；完整可访问性/DPI/站点矩阵仍待补齐。

当前独立核查范围：平台 **{proof['platform_tests']['tests']}**（保留原 **1001** 用例，79 文件/20 原生数据库批次）、核心 **25**、兼容 **36**、客户端 **139**、真实 Web/Admin/侧栏 **14**、打包本机 Desktop **50**。本机共享配置实际执行 Codex **v3/v3/v4**，核对资料工具和本地文件原字节、三项各 **90 港币微额** 的独立结算，未建立云端替代任务。推理回复及部分原生对话框决策为明确夹具；各回执分别绑定未变化源码，历史失败不改写为通过。

当前限制：共享配置最多 20 个文件版本/12 个连接器，Agent/品牌/账号选项各限 200；侧栏每条消息最多 20 个非空附件，每个不超过 5 MiB。恢复回执不存文件正文/凭据，未发送附件不承诺关闭侧栏后自动恢复。完整休眠/大文件/站点矩阵、十二角色业务资格、全部后台内容、音频发行/未知结果恢复、签名安装和完整 Codex Desktop 对齐仍开放。原 102 项需求与 26 个差异组全部保留，不将本增量写成全产品验收完成。
"""
                labels = ["方案与边界", "精确源码检查点", "增量接口", "当前差异", "实际配置与任务", "实际受控状态", "真实交互录制", "原始 MP4", "以前交付细节与历史证据"]
                note = "未经改图的实际界面与按观察时间录制的交互；提供方内容及原生对话框决策为明确夹具，自建浏览器/数据库均关闭。"
            block = f"""<!-- shared-project-stage86 -->

{body}

[{labels[0]}]({prefix}technical/86-shared-project-guidance-and-private-chat.md) · [{labels[1]}]({prefix}quality/shared-project-checkpoint.json) · [{labels[2]}]({prefix}contracts/project-configuration-openapi.json) · [{labels[3]}]({prefix}quality/2026-10-25-goal-gap-assessment.md)

~~~mermaid
flowchart TD
    Login[Email or company identity / company / project] --> Cloud[Web and native Side Panel / cloud Codex]
    Login --> Local[Frameless Desktop / customer-local Codex]
    Owner[Project owner or admin] --> Draft[Save draft / preview exact dependencies]
    Draft --> Publish[Explicit immutable publication]
    Publish --> New[New work pins version and digest]
    Old[Existing task or local thread] --> Retain[Retain original version or absence]
    Cloud --> New
    Local --> New
    File[Explicit Side Panel file selection] --> Private[Actor-owned private conversation]
    Private --> Upload[Resumable upload / verify actual bytes]
    Upload --> Cloud
    New --> Gate[Current source / role / permission / budget]
    Retain --> Gate
    Admin[Scoped Admin / separate body and cost access] --> Governance[Audit / quarantine / restore / erasure]
    Governance --> Gate
~~~

{note}

![{labels[4]}]({links[0]})

![{labels[5]}]({links[1]})

![{labels[6]}]({links[2]})

[{labels[7]}]({links[3]})

<details>
<summary>{labels[8]}</summary>

{historical.lstrip()}

</details>
"""
            file.write_text(title + "\n\n" + block, encoding="utf-8", newline="\n")
            records.append({"path": file.relative_to(ROOT).as_posix(), "before_sha256": sha256(before).hexdigest(),
                            "after_sha256": digest(file), "archive": originals[file.relative_to(ROOT).as_posix()]["archive"]})
    output.write_text(json.dumps({"at": datetime.now(timezone.utc).isoformat(), "status": "refreshed_bilingual_shared_project_guidance",
        "checkpoint": {"path": checkpoint_file.relative_to(ROOT).as_posix(), "sha256": digest(checkpoint_file)},
        "files": records, "media_copies": copies, "historical_bytes_retained": True,
        "verifier_sha256": digest(Path(__file__))}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"readmes": len(records), "media_copies": len(copies)}))


if __name__ == "__main__":
    main()
