"""Build the bilingual publication index after the component README archive exists."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
BASE = "https://github.com/copypasteltd/workmate"
BRANCHES = {
    "backend": ("copypaste-platform", "Backend / API · Codex · 数据与计量"),
    "web": ("copypaste-web", "Web · 云端用户工作台"),
    "admin": ("copypaste-admin", "Admin Dashboard · 管理与运营"),
    "desktop": ("copypaste-desktop", "Desktop · 无边框原生客户端"),
    "extension": ("copypaste-extension", "Extension · Chrome 原生侧栏"),
    "delivery": ("copypaste-delivery", "Delivery · 启动、验证、录制与发布"),
}
T = chr(96)


def save(file, text):
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(text.replace("§", T).strip() + "\n", encoding="utf-8", newline="\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--media", required=True)
    parser.add_argument("--clients", required=True)
    args = parser.parse_args()
    assert len(args.media) == 2 and args.media.isdigit()
    assert (DOCS / "quality/history/stage66-before-workmate-readmes/manifest.json").is_file()
    media = json.loads((DOCS / ("quality/workmate-media-" + args.media + ".json")).read_text(encoding="utf-8"))
    assert media["status"] == "passed" and len(media["recordings"]) == 4
    for en in (False, True):
        suffix = ".en" if en else ""
        readme = "README.en.md" if en else "README.md"
        body = "# Workmate · CopyPaste Enterprise Agent\n\n"
        body += ("[中文](README.md)" if en else "[English](README.en.md)") + " · [GitHub](" + BASE + ")\n\n"
        body += (
            "A Codex-based enterprise Agent platform for Hong Kong businesses, beginning with existing marketing teams. Cloud Web, a Chrome native Side Panel and a full frameless Desktop share company identity, business controls and an internal OpenAI-compatible AI gateway. Admin manages users, scoped content, usage, fees and VIP access.\n\n"
            if en else
            "面向香港企业的 Codex Agent 平台，首批面向现有客户的 marketing 团队。云端 Web、Chrome 原生侧栏、完整无边框 Desktop 共用公司身份、业务控制及内部 OpenAI 兼容网关；Admin 管理用户、内容、消耗、费用与 VIP。\n\n"
        )
        body += ("## Repositories and branches\n\n" if en else "## 仓库和分支\n\n")
        body += ("Each component retains its independent Git history and root layout. Clone different branches into separate directories when running them together. The same documentation commit is published to §main§ and §docs§.\n\n" if en else "每个端保留独立 Git 历史和仓库根目录。多端同时运行时分别检出到不同目录。主文档相同提交发布到 §main§ 与 §docs§。\n\n")
        body += "| Branch | Directory under §dev/§ | Responsibility | README |\n| --- | --- | --- | --- |\n"
        for branch, (directory, title) in BRANCHES.items():
            body += "| [" + branch + "](" + BASE + "/tree/" + branch + ") | §" + directory + "§ | " + title + " | [中文](" + BASE + "/blob/" + branch + "/README.md) / [English](" + BASE + "/blob/" + branch + "/README.en.md) |\n"
        body += "| [docs / main](" + BASE + "/tree/docs) | Project root · §docs/§ | Requirements, architecture, delivery and release notes | [中文](README.md) / [English](README.en.md) |\n\n"
        body += ("## Architecture and usage\n\n" if en else "## 架构与使用逻辑\n\n")
        body += """§§§mermaid
flowchart TB
  User[Customer] --> Web[Cloud Web]
  User --> Side[Chrome native Side Panel]
  User --> Desktop[Frameless Desktop]
  Operator[Administrator + MFA] --> Admin[Admin Dashboard]
  Web & Side & Desktop & Admin --> API[Company Backend]
  API --> Access[Identity / tenant / project / private ownership]
  Access --> Input[Explicit sources / role / skills / version]
  Input --> Budget[Plan / permission / budget hold]
  Budget --> Codex[Version-pinned Codex]
  Codex --> Gateway[Internal OpenAI-compatible API]
  Codex --> Tools[Authorized tools]
  Tools --> Results[Immutable outputs / usage / settlement]
  Results --> Clients[Governed client reads and downloads]
§§§

"""
        steps = (
            [
                "Sign in with an email code, choose a workspace/project and confirm the current funding and permission context. Desktop and extension authorize through the company webpage using PKCE; Admin uses a separate email OTP/TOTP identity.",
                "Select the default assistant, a preset among eighteen roles, or a personal specialist. Tasks freeze role, Skills, model and price versions. Select files, brand resources and authorized connections explicitly.",
                "Confirm a bounded budget before execution. Codex calls company-provided APIs and controlled tools. Recorded usage, budget holds and settled charges remain separate.",
                "When a measured completed turn requests inputs, select authorized current versions and continue the original task/thread/hold. There are eight-round and thirty-two-dependency bounds. Unknown effects require reconciliation.",
                "Read evidence and deliverables, download through authenticated company routes or explicitly publish an independent copy. Current source governance still applies. Workspace switches or failed reads clear prior client content.",
                "Operators filter users/usage, manage scoped content, review fees and grant VIP/credit under independent permissions. Sensitive writes preview impact and use idempotency and required independent approvals.",
            ] if en else [
                "邮箱验证码登录后选择企业和项目，确认当前权限与费用来源。Desktop/Extension 经公司网页和 PKCE 授权；Admin 使用独立邮箱 OTP/TOTP 身份。",
                "选择默认助手、18 个角色预设或私人专员；任务固定角色、Skill、模型和费率版本，明确选择文件、品牌资源和授权连接。",
                "确认有界预算后执行；Codex 调用公司接口及受控工具。已记录用量、预算预留、最终扣费分别展示。",
                "明确计量且已完成的回合需要资料时，选择当前获准版本，沿用原任务、线程与预留继续；限制八轮、三十二项依赖，未知结果进入核对。",
                "查看证据和产物，经认证下载或明确发布独立副本；当前来源治理继续生效。切换范围或读取失败会清空旧内容。",
                "管理员按范围筛选用户和消耗，管理内容、费用与 VIP/额度；敏感操作预览影响，采用幂等命令及必要的独立审批。",
            ]
        )
        body += "\n".join(str(i) + ". " + text for i, text in enumerate(steps, 1)) + "\n\n"
        body += ("## Business scope\n\n" if en else "## 业务范围\n\n")
        body += (
            "Marketing creation includes images, brand layouts, typography, ad/ecommerce/social assets, presentations, editable deliverables and template videos. Analytics includes CSV/XLSX imports, advertising metrics, Google/Meta connection workflows and scoped website audit, evidence, change drafts and rechecks. Enterprise workflows cover assistants, conversations, memory, schedules, files and notifications. The role catalog contains eighteen presets; planned Skills and full professional qualification are tracked separately.\n\n"
            if en else
            "营销创作覆盖生图、品牌版式、字体、广告/电商/社交素材、演示、可编辑交付及模板视频。分析覆盖 CSV/XLSX 导入、广告指标、Google/Meta 连接流程，以及有范围的网站诊断、证据、修改草稿和复查。企业流程涵盖助手、会话、记忆、计划、文件和通知。角色目录有 18 个预设；计划 Skill 与完整专业交付资格另行跟踪。\n\n"
        )
        body += ("## First checkout and local run\n\n" if en else "## 初次检出和本地运行\n\n")
        body += ("The authoritative existing workspace is §D:\\dev\\copypasted\\自有agent§. Do not clone over existing repositories. For a new machine, clone §docs§ at a fresh root and clone component branches under §dev/§ as shown above. Native Windows tools only; no Docker, WSL or virtualization.\n\n" if en else "已有唯一工作区为 §D:\\dev\\copypasted\\自有agent§，不要覆盖现有仓库。新设备在全新根目录检出 §docs§，再按上表在 §dev/§ 检出各端分支。使用原生 Windows 工具，禁止 Docker、WSL 和虚拟化。\n\n")
        body += """§§§powershell
git clone --single-branch --branch docs git@github.com:copypasteltd/workmate.git workmate
cd workmate
New-Item -ItemType Directory -Path dev
git clone --single-branch --branch backend git@github.com:copypasteltd/workmate.git dev/copypaste-platform
git clone --single-branch --branch web git@github.com:copypasteltd/workmate.git dev/copypaste-web
git clone --single-branch --branch admin git@github.com:copypasteltd/workmate.git dev/copypaste-admin
git clone --single-branch --branch desktop git@github.com:copypasteltd/workmate.git dev/copypaste-desktop
git clone --single-branch --branch extension git@github.com:copypasteltd/workmate.git dev/copypaste-extension
git clone --single-branch --branch delivery git@github.com:copypasteltd/workmate.git dev/copypaste-delivery
cd dev/copypaste-delivery
npm ci
npm run bootstrap
npm run demo
§§§

"""
        body += ("Open Web §http://localhost:4317§ and Admin §http://localhost:4318§; Backend uses §4310§, the owned controller §4319§ and native PostgreSQL §55432§. Stop owned demo services with §npm run stop§. See each component README for standalone startup, administrator enrollment, Desktop packaging and extension loading. Node.js ≥22.14 and locked dependencies are required; native verification also needs pinned Codex and FFmpeg/FFprobe.\n\n" if en else "访问 Web §http://localhost:4317§、Admin §http://localhost:4318§；API §4310§、自有控制器 §4319§、原生 PostgreSQL §55432§。使用 §npm run stop§ 关闭自有演示服务。独立启动、管理员登记、Desktop 打包和扩展加载见各端 README。需要 Node.js ≥22.14 与锁定依赖；原生验证另需固定 Codex 及 FFmpeg/FFprobe。\n\n")
        body += ("## Evidence and limits\n\n" if en else "## 验证与边界\n\n")
        body += (
            "Retained Stage 66 evidence includes **782/782** full Platform tests and **34/34** focused tests; suites overlap and are not added together. Current client checks pass **13/13**; the actual packaged Desktop/native Side Panel journey passes **32/32**. The current media report binds screenshots, recording timing, hashes, source and owned-browser cleanup. These counts apply to their recorded source versions.\n\n"
            if en else
            "保留的阶段 66 证据包括平台完整 **782/782**、专项 **34/34**；二者重叠，不相加。当前客户端检查 **13/13**、真实打包 Desktop/原生 Side Panel 旅程 **32/32**。本次媒体回执绑定截图、录制时间、摘要、源码及自建浏览器清理。各数量只适用于对应回执记录的源码版本。\n\n"
        )
        body += "[Stage 66](technical/66-paid-native-input-checkpoints.md) · [Current source-bound evidence](quality/paid-input-checkpoint.json) · [Media](quality/workmate-media-" + args.media + ".json) · [Requirement progress](quality/requirements-alignment-progress.json)\n\n"
        body += (
            "AI turns and provider/business facts in UI demos are explicitly synthetic, as authorized. Separate integration tests run actual Codex processes against a synthetic internal gateway. Admin media shows permission-gated VIP/credit forms and does not claim a financial posting. Applied SQL001–091 remain immutable. All 102 requirements, TC/NFR/G01–G10 and the 81 partial /21 unproven /0 fully accepted baseline remain intact. Canonical TaskDTO/task creation, arbitrary in-flight pause, unknown-effect recovery, full role workflows, GEO, real suppliers, production, signing and store qualification remain outstanding.\n\n"
            if en else
            "UI 演示中的 AI 回合、供应商与业务事实按授权明确模拟；独立集成测试通过模拟内部网关运行真实 Codex 子进程。Admin 媒体展示受权限约束的 VIP/费用表单，不代表财务提交。SQL001–091 保持不可改写。全部 102 项需求、TC/NFR/G01–G10 及 81 局部验证/21 未证明完成/0 完整验收基线保留；规范 TaskDTO/任务创建、任意执行中暂停、未知结果恢复、全角色工作流、GEO、真实供应商、生产、签名与商店资格继续跟踪。\n\n"
        )
        body += ("## Actual client gallery\n\n" if en else "## 实际客户端展示\n\n")
        body += ("Screenshots and GIFs show actual running clients; synthetic data is scoped above. The extension capture is the confirmed native Side Panel document viewport and excludes the browser toolbar. Actual recordings preserve observed capture timing.\n\n" if en else "以下为实际运行页面及 GIF，模拟范围如上。扩展捕获的是已确认原生 Side Panel 的文档视口，不含浏览器工具栏。录制保留实际捕获时间。\n\n")
        for component, screenshot in (
            ("web", "input-ready-en"), ("desktop", "input-ready-en"),
            ("extension", "sidepanel-native-en"), ("admin", "user-usage-en"),
        ):
            stem = "design/implementation/workmate/" + component + "-workmate-" + args.media + "-"
            body += "### " + component.title() + "\n\n![" + component + "](" + stem + screenshot + ".png)\n\n"
            body += "![" + component + " interaction](" + stem + "interaction.gif)\n\n[MP4](" + stem + "interaction.mp4)\n\n"
        body += ("## Documentation map\n\n" if en else "## 文档导航\n\n")
        body += "[Reading order](00-document-map.md) · [PRD](product/01-prd.md) · [Roles/Skills](product/06-role-templates-and-skill-presets.md) · [Brand](product/07-brand-design-system.md) · [Admin](product/08-admin-dashboard.md) · [API contracts](contracts/README.md) · [Delivery](DELIVERY.md)\n\n"
        for folder in ("product", "modules", "technical", "requirements", "governance"):
            body += "### " + folder.title() + "\n\n"
            for file in sorted((DOCS / folder).glob("*.md")):
                title = next((line.removeprefix("# ").strip() for line in file.read_text(encoding="utf-8").splitlines() if line.startswith("# ")), file.stem)
                label = file.stem.replace("-", " ") if en else title
                body += "- [" + label + "](" + file.relative_to(DOCS).as_posix() + ")\n"
            body += "\n"
        body += ("## Updates and publication\n\n" if en else "## 更新与发布\n\n")
        release = "changes/2026-10-22-workmate-publication" + suffix + ".md"
        body += "[2026-10-22 release notes](" + release + ") · [Branch and synchronization policy](governance/04-git-branches-and-publication.md) · [Exact prior README archive](quality/history/stage66-before-workmate-readmes/manifest.json)\n\n"
        body += ("Every later change must synchronize both READMEs, affected captures, bilingual release notes and the mapped remote branch. Publishing uses explicit refs, remote SHA checks and no force-push. Credentials, sessions, databases, dependencies and installers stay out of Git. Browser runs close owned pages/contexts/instances after use.\n" if en else "后续改动同步中英 README、相关实际截图/交互、双语更新说明和对应远端分支。发布只推送明确引用，核对远程 SHA，不强推。凭据、会话、数据库、依赖及安装包不进入 Git；浏览器调用后关闭自建且不用的页面、上下文及实例。\n")
        save(DOCS / readme, body)

        release_body = "# Workmate · 2026-10-22\n\n"
        release_body += ("[中文](2026-10-22-workmate-publication.md)" if en else "[English](2026-10-22-workmate-publication.en.md)") + "\n\n"
        release_body += (
            "This delivery reorganizes the existing independent repositories into the requested GitHub branch layout and replaces accumulated README stage notes with current bilingual entrypoints. It preserves existing source/history, applied SQL and original acceptance requirements.\n\n"
            if en else
            "本次将已有独立仓库按要求整理到 GitHub 对应分支，将累积的 README 阶段说明整理为当前中英双语使用入口，保留既有源码/历史、已应用 SQL 和原始验收要求。\n\n"
        )
        release_body += (
            "- Publish Backend, Web, Admin, Desktop, Extension and Delivery through six component branches; publish the same documentation commit to main/docs.\n- Document architecture, modules, setup, identity, permissions, fees, configuration, checks, supported workflows and limits in twelve component READMEs and two master READMEs.\n- Capture four actual clients as screenshots, wall-clock MP4 and GIF. Admin includes filtered users, membership/usage, VIP and credit forms. Services explicitly attribute reused client media.\n- Preserve all prior README bytes and failed capture attempts. The first browser-window capture produced black frames and failed the changing-frame check; the retained corrected capture uses the actual native SIDE_PANEL target.\n- Add a persistent synchronization rule for future code, bilingual docs, affected media and release notes.\n\n"
            if en else
            "- Backend、Web、Admin、Desktop、Extension、Delivery 分别发布；main/docs 发布相同主文档提交。\n- 十二份各端 README 与两份主文档 README 说明架构、模块、安装、身份、权限、费用、配置、验证、使用流程与边界。\n- 四个真实客户端新增截图、保留实际时间的 MP4 与 GIF；后台含筛选用户、企业/消耗、VIP 和费用表单。服务端明确说明引用的客户端媒体来源。\n- 保留全部旧 README 原字节与失败捕获。首次浏览器整窗捕获产生黑屏，被画面变化检查拒绝；修正后直接捕获真实原生 SIDE_PANEL 文档。\n- 固化后续代码、双语文档、相关媒体及更新说明的同步推送规则。\n\n"
        )
        release_body += ("## Verification\n\n" if en else "## 验证\n\n")
        release_body += "Platform 782/782 · focused 34/34 · client checks 13/13 · actual native journey 32/32.\n\n"
        release_body += "[Implementation and retained scope](../technical/66-paid-native-input-checkpoints.md) · [Actual media](../quality/workmate-media-" + args.media + ".json) · [Requirements](../quality/requirements-alignment-progress.json)\n\n"
        release_body += ("The recorded media uses authorized synthetic AI/business data. Actual Codex subprocess integration is independently tested with a synthetic gateway. Admin dialogs do not prove financial commits. Native packages are local unsigned previews; live providers, production, signing, store submission and the remaining full acceptance scope are not established by publication. No UI/business runtime changes are introduced by this README/media reorganization.\n\n" if en else "媒体采用已授权的模拟 AI/业务数据；真实 Codex 子进程另由模拟网关集成验证。Admin 对话框不证明财务提交。原生包仍是本地未签名预览，真实供应商、生产、签名、商店及剩余综合验收不因本次发布而完成。本次 README/媒体整理没有修改产品 UI/业务运行代码。\n\n")
        release_body += "[Usage and branch map](../" + readme + ") · [Future synchronization](../governance/04-git-branches-and-publication.md)\n"
        save(DOCS / release, release_body)
    print(json.dumps({"status": "passed", "master_readmes": 2, "release_notes": 2, "media": args.media}))


if __name__ == "__main__":
    main()
