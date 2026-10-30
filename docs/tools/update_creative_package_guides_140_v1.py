"""Update authoritative requirements and bilingual client guides from an actual passed journey."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
from collections import Counter

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(); parser.add_argument("--ui", required=True); args = parser.parse_args()
journey = json.loads((ROOT / f"dev/copypaste-delivery/evidence/creative-packages-140/ui-{args.ui}-journey.json").read_bytes())
assert journey["status"] == "passed"
now = datetime.now(timezone.utc).isoformat()
old_file = ROOT / "docs/quality/remaining-work-stage139.json"
ledger = json.loads(old_file.read_bytes())
original = [(r["id"], r["full_acceptance"], r["recorded_assessment"], r["requirement_origin"], r["remaining"]) for r in ledger["requirements"]]
note = "阶段140新增普通分层画布及campaign-cuts影片的ZIP打包、固定素材和影片字型／授权、上传校验、明确共用确认、新编号恢复、原请求结果核对及继续编辑。真实Web、无边框Windows包和Chrome原生右侧栏验证；画布编辑再出PNG，影片编辑再出MP4。全部格式、品牌重绑、完整专业工程和跨机器渲染一致性仍按原范围验收。"
for row in ledger["requirements"]:
    if row["id"] in {"REQ-012", "REQ-014", "REQ-018", "REQ-022", "REQ-035", "REQ-036", "REQ-038", "REQ-039", "REQ-060"}:
        row["current_review_note"] = (row.get("current_review_note", "") + "\n" + note).strip()
assert original == [(r["id"], r["full_acceptance"], r["recorded_assessment"], r["requirement_origin"], r["remaining"]) for r in ledger["requirements"]]
assert len(original) == 102
ledger.update(schema_version=21, reviewed_at=now,
    previous_review={"path": old_file.relative_to(ROOT).as_posix(), "sha256": sha256(old_file.read_bytes()).hexdigest()},
    checkpoint="docs/quality/creative-packages-checkpoint-140.json", new_full_acceptance_closures=0,
    current_increment={"stage": 140, "scope": note, "actual_client_checks": journey["checks"], "full_acceptance_scope_changed": False})
out = ROOT / "docs/quality/remaining-work-stage140.json"; assert not out.exists()
out.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
text = "# 当前未完成项 · 阶段140\n\n" + note + "\n\n保留102个原始编号及完整验收范围。88个必要项仍待完整验收；另有12个未确认扩展建议、1个可选项。已接受REQ-095。以下记录是完整验收缺口，不等于所有模块均未实现。\n\n| 编号 | 模块 | 当前状态 | 原始完整验收待项 |\n|---|---|---|---|\n"
for r in ledger["requirements"]:
    text += "| " + " | ".join(str(r[k]).replace("|", "／").replace("\n", " ") for k in ["id", "module", "full_acceptance", "remaining"]) + " |\n"
(ROOT / "docs/quality/remaining-work-stage140.md").write_text(text, encoding="utf-8", newline="\n")
diagram = """```mermaid
flowchart LR
 A[Fixed canvas or video version] --> B[Source JSON and exact media ZIP]
 B --> C[Explicit project sharing and verified upload]
 C --> D[Review manifest and rights]
 D --> E[Restore new project and media IDs]
 E --> F[Edit layers or timeline]
 F --> G[Render PNG or MP4 and export again]
 D --> H[Lost response: check original receipt]
 H --> E
```

"""
detail = """# 工程打包与恢复 / Creative project packages

普通分层画布与 campaign-cuts 影片可以打包固定版本的来源；编辑影片后可重新整理工程版本，再确认导出。上传后先校验、预览，再明确确认恢复为目的项目的共用副本。原工程与原素材不被覆盖；导入不调用 AI，不产生 AI 费用。

Layered canvases and campaign-cuts video projects export their fixed sources. Refresh project versions after editing before choosing the exact export. Upload, inspect and explicitly approve a new shared copy in the destination project. Original projects and media remain intact. Import/export make no AI request or AI charge.

## 使用流程 / User flow

1. Web/Desktop：进入「设计画布 → 工程打包与恢复」，选择固定版本下载ZIP。Extension：点击工具栏打开原生右侧栏，在「工作、通知与账户 → 工程打包与恢复」操作。
2. 明确确认上传工程包可供当前项目成员使用，再选择ZIP。一般文件上限100 MiB；扩展为工程包单独提供已校验的分片上传，原私人会话附件的5 MiB限制不被放宽。
3. 查看类型、素材数量、文件清单和限制；填写新名称，确认素材权利及新的共用副本。系统逐个核对SHA-256、大小和固定引用后，以新工程／素材ID创建副本。
4. Web/Desktop直接继续编辑：画布修改图层后输出PNG；影片修改脚本、逐帧分镜、字幕及音轨后渲染MP4。Extension恢复后的内容可在同一项目的Web/Desktop编辑器中使用。
5. 结果未确认时，保留原请求。重新打开页面后核对原结果，再继续同一请求；已移除的结果不重新创建。原工程始终不覆写。

On Web/Desktop open Design canvas → Project packages & restore. In Extension use the toolbar-opened native right SIDE_PANEL → Work, notices & account. Explicitly approve project sharing before upload. Inspect the package, give the new copy a name and confirm media rights. Continue editing in the existing Web/Desktop editor; Extension restores to that same project. Unknown results retain the original request across reload. Removed results are not recreated.

## 包结构和边界 / Format and boundaries

- `project.json`：严格校验的分层画布或视频定义。视频保留脚本、分镜、逐帧时间线、字幕及音轨设置。
- `media/NNN.png|wav|mp3`：每个固定版本的实际素材；映射后重新分配ID，不绑定旧项目授权。
- `manifest.json`、`SHA256SUMS`、双语`README.md`：大小、SHA-256、来源版本参考、渲染约束及使用说明。
- 影片另含固定`fonts/NotoSansTC-VF.ttf`及`fonts/OFL.txt`。当前需完全匹配的原生渲染配置；缺少或不相容会阻止恢复。
- 画布另含`preview.svg`，使用包内媒体的相对引用。画布的原系统字体参考保留，换环境可能改变排版，不能据此声称全部字体均可移植或逐像素一致。
- v1只接受产品生成的未压缩ZIP成员，以惰性读流逐个落盘，文件白名单、数量、单项和总大小有上限。拒绝加密、压缩、路径穿越、重复名称、链接、缺失引用及散列不符；不执行包内脚本，不按包内路径解压到客户工作区。
- 不导入身份、权限、账单、VIP、连接器凭据、旧任务或已验证来源标记。导入素材明确标注为用户上传与用户权利确认。Admin继续按既有范围和独立正文权限管理新内容。
- 生命周期、当前登录、项目写权限、素材可用性、存储额度和原请求幂等都参与校验。清理由本次操作自己的临时目录承担，用户上传包作为普通素材保留。

## API

以下前缀统一为`/v1/tenants/:tenant/projects/:project/creative-project-packages`。

| 方法 / Method | 路径 / Path | 作用 / Behavior |
|---|---|---|
| GET | `/` | 当前可见画布／影片列表，最多100项 / Up to100 visible current projects |
| GET | `/:id?expected_version=N` | 校验精确版本并流式下载ZIP / Exact-version streamed export |
| POST | `/preview` | 固定上传素材ID、版本与SHA-256，返回清单和preview_hash / Inspect exact archive version |
| POST | `/restore` | 强制preview_hash、名称、共用及权利确认，Idempotency-Key保持原请求 / Explicit new-copy import |
| GET | `/requests/:key` | 当前发起人原恢复结果；未记录、已完成或已移除 / Original request outcome |

导出需要项目读取权限；预览／恢复及回执核对需要项目写权限。重操作按已认证用户限流，每进程最多2项、每人1项并行，避免同一企业出口IP使所有员工共用一个操作额度。AI成本始终为0；以后发起Agent修改仍沿用原有费用与权限确认。

## 当前验收和待项 / Acceptance limits

本轮验证不同项目间的实际恢复，保留既有视频回归及三端真实操作。业务内容为假数据；HTTP、OTP/PKCE、原生PostgreSQL、分片上传、ZIP校验、PNG/MP4渲染和Windows程序／右侧栏操作真实执行。Windows包未签名，本轮未发起模型调用。

仍需完成品牌绑定画布的明确重绑、所有SVG/PPTX及专业工程的完整应用内恢复、全部字体和复杂来源依赖、不同机器和渲染环境的完整验收，以及原需求清单中的其他模块完整验收。102项完整范围不缩减，本轮不新增整项验收关闭。

This is a canvas/campaign-video restoration slice, validated across different projects with synthetic campaign content and real clients/storage/rendering. It does not complete all-format or cross-machine recovery, brand rebinding, professional project dependencies, signed installation or full-platform acceptance.

"""
folder = ROOT / "docs/development"; folder.mkdir(parents=True, exist_ok=True)
(folder / "140-creative-project-packages.md").write_text(detail + diagram, encoding="utf-8", newline="\n")
change = ROOT / "docs/changes/140-creative-project-packages.md"
change.write_text("# 阶段140：设计与视频工程恢复闭环\n\n" + note + "\n\n" + diagram + "\n新增6项业务集成、23项现有视频回归、3项扩展下载边界检查。实际三端验证和截图／录制见阶段140检查点。失败尝试保持原始记录，未用修改后的结果覆盖。\n\n同时修复画布素材读取时的过期、撤回与校验检查，以及已过期画布的列表、更新和渲染入口。恢复按已认证用户限流；不可更新的版本表不取得更新型锁，归属素材记录在导入事务内锁定并复核。\n\n详细格式、API、用户路径和限制见[开发说明](../development/140-creative-project-packages.md)，完整编号见[当前清单](../quality/remaining-work-stage140.md)。\n", encoding="utf-8", newline="\n")
specific = {
 "platform": ("后端新增完整素材工程包导出、分片上传后的逐项校验、明确共用恢复、固定引用重映射和原请求回执。", "The backend adds source-complete project exports, bounded archive inspection, explicit shared-project restore, reference remapping and original-request receipts."),
 "web": ("进入「设计画布 → 工程打包与恢复」，下载固定版本，上传并核对ZIP，再确认恢复为新的共用副本。恢复后可直接修改图层并输出PNG，或继续编辑影片。", "Open Design canvas → Project packages & restore. Download a fixed version, upload and inspect its ZIP, then explicitly restore a new shared copy. Edit restored layers and render PNG, or continue editing video."),
 "desktop": ("无边框Desktop内已接上相同恢复流程：完整影片素材与字型恢复后，修改脚本并重新渲染MP4，也可通过本机保存窗口下载工程ZIP。本机Codex执行与客户授权沿用既有本机流程。", "The frameless Desktop restores video sources and the pinned font, edits the script, re-renders MP4 and saves a complete project ZIP through a native dialog. Codex execution and customer OS permissions retain the existing local workflow."),
 "extension": ("点击工具栏进入Chrome原生右侧栏，再打开「工作、通知与账户 → 工程打包与恢复」。支持100 MiB工程包分片校验上传、清单确认和新项目副本恢复；恢复结果在同一项目的Web/Desktop编辑器继续使用。Agent在云端运行。", "Use the toolbar-opened native right SIDE_PANEL → Work, notices & account → Project packages & restore. Upload project ZIPs up to100 MiB in verified parts, review the manifest and create a new shared copy. Continue editing in that project's Web/Desktop editor. The Agent runs in the cloud."),
 "admin": ("新恢复工程和素材沿用完整后台的现有内容管理、项目范围与正文独立权限。工程导入不改变费用、VIP、用户权限或连接器授权。", "Restored projects and media use existing dashboard content management, project scopes and separate body permissions. Import never changes fees, VIP, user permissions or connector grants."),
 "delivery": ("本轮交付包括普通分层画布及模板影片的恢复代码、真实Web／Windows包／Chrome侧栏操作与截图、GIF／MP4录制；所有失败与通过尝试保留独立记录。原生工具运行，不使用Docker／WSL。", "This increment delivers layered-canvas and campaign-video restoration, actual Web/Windows/Chrome-side-panel journeys, screenshots and GIF/MP4 recordings. Failed and passing attempts remain separate. All tooling runs natively without Docker/WSL."),
 "docs": (note, "The current functional increment restores layered canvases and campaign videos with exact media, explicit sharing, new IDs and receipt recovery. Actual clients edit/render the restored copy. Original102 full-acceptance scopes remain intact."),
}
guides = [(ROOT / "dev" / ("copypaste-" + component) / name, component) for component in ["platform", "web", "admin", "desktop", "extension", "delivery"] for name in ["README.md", "README.en.md"]]
guides += [(ROOT / "docs" / name, "docs") for name in ["README.md", "README.en.md"]]
archive = ROOT / "docs/quality/history/stage140-guides-before"; assert not archive.exists()
for file, component in guides:
    raw = file.read_bytes(); saved = archive / component / file.name; saved.parent.mkdir(parents=True, exist_ok=True); saved.write_bytes(raw)
    english = file.name == "README.en.md"; text = raw.decode("utf-8"); assert "<!-- creative-packages-stage140 -->" not in text
    section = "<!-- creative-packages-stage140 -->\n## " + ("Project packages & restore · Stage140" if english else "工程打包与恢复 · 阶段140") + "\n\n" + specific[component][int(english)] + "\n\n"
    section += ("Export and restore make no AI request. Confirm project sharing before upload and media rights before restoring. Sources remain intact; an interrupted restore retains its original receipt. The supported slice covers ordinary layered canvases and campaign-cuts videos. Canvas system-font differences, brand rebinding, all-format and cross-machine restoration remain open.\n\n" if english else "导出和恢复不请求AI。上传前先明确确认项目共用，恢复前再确认素材权利；原工程不覆写，中断后核对原请求。当前支持普通分层画布和campaign-cuts影片；画布系统字型差异、品牌重绑、全部格式及跨机器恢复仍待完整验收。\n\n")
    section += diagram
    if component == "delivery":
        section += ("Reproduce with native dependencies and the configured local test environment: run `node scripts/qualify-creative-packages-140-v6.mjs 90`, then `node scripts/qualify-creative-packages-ui-140-v6.mjs 91 90` from this repository. Choose unused two-digit attempt IDs; reports are immutable. The first command owns and stops a native PostgreSQL cluster; the second builds real clients and reuses that stopped cluster. Run these sequentially to avoid concurrent writes to backend build outputs. Synthetic campaign data; no AI credentials are needed for this slice.\n\n" if english else "在本仓库按现有原生依赖和本地测试环境配置，先执行 `node scripts/qualify-creative-packages-140-v6.mjs 90`，再执行 `node scripts/qualify-creative-packages-ui-140-v6.mjs 91 90`。使用未占用的两位尝试编号，报告不可覆盖。第一步自主管理并关闭原生 PostgreSQL，第二步构建实际客户端并复用已关闭的测试集群；必须依次执行，避免同时写后端构建文件。本流程使用合成业务数据，无需真实模型密钥。\n\n")
    for title, suffix in [("Format, APIs & usage / 格式、接口及使用", "development/140-creative-project-packages.md"), ("Actual qualification / 实际验证", "quality/creative-packages-checkpoint-140.json"), ("Open acceptance scopes / 未完成验收", "quality/remaining-work-stage140.md")]:
        section += f"- [{title}](https://github.com/copypasteltd/workmate/blob/docs/docs/{suffix})\n"
    section += "\n"
    chosen = [r for r in journey["screenshots"] if r["path"].startswith("copypaste-" + component + "/")]
    if not chosen: chosen = [journey["screenshots"][1]]
    for item in chosen[:2]:
        repo, rel = item["path"].split("/", 1); branch = repo.removeprefix("copypaste-")
        section += f"![Actual {branch} project restoration · synthetic campaign content](https://github.com/copypasteltd/workmate/blob/{branch}/{rel})\n\n"
    for recording in journey["recordings"]:
        for item in recording["files"]:
            repo, rel = item["path"].split("/", 1); branch = repo.removeprefix("copypaste-")
            if Path(rel).suffix == ".gif" and (branch == component or (component in {"platform", "admin", "delivery", "docs"} and branch == "web")):
                section += f"![Actual {branch} project restoration interaction](https://github.com/copypasteltd/workmate/blob/{branch}/{rel})\n\n"
            section += f"- [Actual {branch} interaction {Path(rel).suffix.upper()}](https://github.com/copypasteltd/workmate/blob/{branch}/{rel})\n"
    first, _, rest = text.partition("\n"); file.write_text(first + "\n\n" + section + "\n" + rest.lstrip("\n"), encoding="utf-8", newline="\n")
print(json.dumps({"stage": 140, "guides_updated": len(guides), "preserved_original_requirements": 102, "new_full_acceptance_closures": 0}))
