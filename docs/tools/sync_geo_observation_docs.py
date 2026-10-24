"""Refresh bilingual current usage with real media and unchanged acceptance."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

from sync_generated_video_docs import quickstart

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
ARCHIVE = ROOT / "docs/quality/history/before-stage83-docs"


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    output = ROOT / "docs/quality/geo-observation-documentation-refresh.json"
    assert not output.exists()
    proof = json.loads((ROOT / "docs/quality/geo-observation-checkpoint.json").read_text(encoding="utf-8"))
    assert proof["status"] == "verified_reproducible_geo_observation_subflow"
    records = []

    def save(file, text):
        archive = ARCHIVE / file.relative_to(ROOT)
        assert not archive.exists()
        archive.parent.mkdir(parents=True, exist_ok=True)
        raw = file.read_bytes()
        archive.write_bytes(raw)
        file.write_text(text, encoding="utf-8", newline="\n")
        records.append({"path": file.relative_to(ROOT).as_posix(), "archive": archive.relative_to(ROOT).as_posix(), "before_sha256": sha256(raw).hexdigest(), "after_sha256": digest(file)})

    count, core, clients = proof["platform_tests"]["tests"], proof["core_tests"]["tests"], proof["client_counts"]
    docs_url = "https://github.com/copypasteltd/workmate/blob/docs/docs/"
    for component in ["root", "platform", "web", "admin", "desktop", "extension", "delivery"]:
        repo = ROOT if component == "root" else DEV / ("copypaste-" + component)
        surface = component if component in ["admin", "desktop", "extension"] else "web"
        shots = proof["layout_screenshots"] if surface == "desktop" else proof["screenshots"]
        suffixes = {"web": ["-original-api-answer.png", "-compact-zh-dark.png"], "admin": ["-scoped-geo-content.png", "-geo-quarantined.png"],
            "extension": ["-native-panel-en.png", "-native-panel-zh.png"], "desktop": ["-geo-browser-entry-en.png", "-layout-compact-zh-dark.png"]}[surface]
        selected = [next(v for v in shots if v["path"].endswith(suffix)) for suffix in suffixes]
        recording = next(v for v in proof["recordings"] if v["files"][0]["path"].startswith("copypaste-" + surface + "/"))
        selected += [next(v for v in recording["files"] if v["path"].endswith(ext)) for ext in [".gif", ".mp4"]]
        links = []
        for item in selected:
            source = DEV / item["path"]
            assert digest(source) == item["sha256"]
            if component == "root":
                target = ROOT / "docs/design/implementation" / (Path(item["path"]).parts[0] + "__" + source.name)
                assert digest(target) == item["sha256"]
            elif source.is_relative_to(repo):
                target = source
            else:
                target = repo / "assets/screenshots" / ("stage83-" + surface + "-" + source.name)
                assert not target.exists()
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read_bytes())
            links.append(target.relative_to(ROOT / "docs" if component == "root" else repo).as_posix())
        for english in [False, True]:
            file = (ROOT / "docs" if component == "root" else repo) / ("README.en.md" if english else "README.md")
            title, old = file.read_text(encoding="utf-8").split("\n", 1)
            assert "<!-- geo-observation-stage83 -->" not in old
            prefix = "" if component == "root" else docs_url
            start = quickstart(component, english).replace("SQL097", "SQL100")
            if english:
                body = f'''GEO now has reproducible question sets and retained original answers. An immutable configuration pins the complete Agent definition, skills, requested model alias, Codex runtime, language, requested region and protocol. Independent API repeats keep the same configuration; user-supplied consumer answers remain a separate surface.

{start}

1. Sign in through the existing email flow and select your company/project. In **Marketing insights → GEO observations**, create an unbranded Agent in Specialists, then save fixed questions and measured brand aliases. Aliases are excluded from the observation question. Editing a question, region, language or Agent creates a new immutable version from the reviewed previous hash.
2. **Run API observation** displays current active-task capacity and an exact per-question budget. Explicitly review the unchecked confirmation. Each question needs one available task slot; the backend checks and reserves the complete batch atomically. Starter's single slot cannot run a two-question batch. Each independent cloud Codex task uses the company Responses gateway with no memory/history, retrieval or business tools. Repeating creates another run.
3. **Capture completed answers** stores actual successful task output once as a private UTF-8 asset with SHA-256 and observation time. Capture does not call the model again. Open the original answer, download its exact text, or export the full JSON. Missing answers stay absent; unknown usage remains under reconciliation with no invented zero charge. JSON timestamps remain ISO strings even for an unfinished export.
4. **Record consumer sample** requires the product, observed region/language/time, optional displayed model, retrieval state and an initially unchecked attestation. The form records one selected question; the API accepts up to 20 known questions. Paste the complete original answer. Metadata is user supplied and unverified; no AI task or model fee is created.
5. Choose comparison A/B, including across configuration versions. The actual downloadable JSON includes both original answers, hashes and effective configurations. Same-configuration repeats are distinguished from configuration changes; API and consumer/manual surfaces are not aggregated. Literal aliases and answer links do not establish entity identity, recommendation, rankings, independently retrieved evidence or causation. Requested region is prompt context; provider processing region and resolved underlying model are unknown.
6. Records are private to their creator under current project authorization and forced RLS. Admin metadata, independent `admin.content.body.read`, project-scoped quarantine/restore/delete and audit cover configurations, runs and samples. An explicitly published answer copy preserves its GEO provenance. Isolation, expiry or deletion blocks current exports, managed reads and derived outputs. Default retention is 90 days; the erasure journal cancels/settles actual tasks and removes answer files and retained task copies. Files already saved outside the service cannot be recalled.

Desktop keeps **local Codex**, revocable full-machine consent, its frameless native window and no Electron menu. Its clearly labelled **GEO observations · Browser** entry opens the configured company Web URL; it does not start a cloud substitute for a local Agent. A Desktop-local GEO protocol is still open. Native wheel/Home/End, whole-page Ctrl+Home, last-item focus and genuine progress remain usable without visible vertical/horizontal scrollbar rails. Extension keeps a ChatGPT-style conversation/attachment interface, authorized local-file uploads and cloud Codex in the actual right Chrome Side Panel; the GEO entry opens the company Web workspace, with no Desktop dependency.

Validation is bounded: platform **{count}/{count}**, every previous **946** case retained; GEO core **{core}**, clients **{clients}**, actual Web/Admin/native Side Panel **13**, packaged local Desktop **37**. SQL100 is additive; SQL001–099 and the original OpenAPI bytes are unchanged. Model, image and consumer/ad data are explicit synthetic fixtures. Real-provider quality/rankings, all professional roles, signing, full Codex Desktop parity, performance/capacity and complete original acceptance remain open. Original **102 REQ / 102 TC: 83 partial, 19 unproven, 0 fully accepted; G01–G10 not proven**.

Interactive qualifications retain exact product/runtime sources. Later test-only edits update two latest-migration expectations from 99 to 100 and explicitly bound the historical 098-to-099 fixture to 99. Original data, source OID, prepared-reader and replay checks remain. Complete regression qualification spans 19 isolated batches: unchanged-source batches 01–07 from run 33 and fresh batches 08–19 from run 34. Both affected test files execute afresh; every current runtime and executed test/helper byte is checked. Original failed receipts remain failed.
'''
                labels = ["Design and limits", "Exact-source evidence", "Additive API contract", "Actual current viewport", "Actual second locale/state", "Recorded interaction", "Original MP4", "Earlier delivery details (historical evidence scopes)"]
                media_note = "Actual native Desktop cloud-entry/layout screenshots; the GIF below records the existing local creative-feedback interaction, not a Desktop-local GEO protocol." if surface == "desktop" else "Actual UI screenshots and observed-time interaction capture. All business/model content shown is synthetic; native Side Panel captures come from Chrome's real SIDE_PANEL context."
            else:
                body = f'''GEO 现已支持固定问句、可复现配置和原始回答留存。不可改写的配置固定完整 Agent 定义、skills、请求模型别名、Codex 内核、语言、请求地区及协议。独立 API 重复执行保持同一配置；消费者产品人工样本使用单独来源口径。

{start}

1. 按现有邮箱流程登录并选择企业/项目。在「行销分析 → GEO 观测」中，先于「专业角色」建立未绑定品牌的 Agent，再保存固定问句与品牌别名。别名不会注入观测问句。修改问句、地区、语言或 Agent 时，基于已审核旧哈希另存不可改写的新版本。
2. 「执行 API 观测」显示当前可用任务名额和精确每问预算；费用确认框初始不选中。每题需要一个名额，服务端在锁内检查整组容量并原子预留全部预算。Starter 单名额不能绕过限制执行两题。独立云端 Codex 任务经公司 Responses 网关运行，不带历史/记忆，关闭检索及业务工具；重复执行新增 run。
3. 「保存已完成回答」将真实成功任务输出保存一次，形成私有 UTF-8 原文文件、SHA-256 和观察时间，不再调用模型。可打开原文、下载完整回答或导出 JSON。未完成答案保持缺失，未知用量保留待核实状态，不能填零。未完成观测导出仍保留有效 ISO 时间。
4. 「录入消费产品样本」填写产品、实际地区/语言/时间、可留空的显示模型、检索状态，并主动选中初始未勾选声明。当前表单一次录入一个固定问句；API 支持最多 20 个已知问句。粘贴完整原始回答；元数据标为用户提供、未经平台核实，不创建 AI 任务或模型费用。
5. 选择比较 A/B，可跨配置版本选择。实际下载包含双方原始回答、哈希及有效配置；明确区分同配置重复变化、配置差异和 API/人工来源，不混合汇总。字面别名和回答中的链接不等于实体核实、推荐、排名、独立检索证据或因果结论。请求地区只是提示上下文，服务商处理地区及实际解析的底层模型未知。
6. 记录默认私有，仅创建者在当前项目授权下访问，数据库强制 RLS。Admin 元数据、独立 `admin.content.body.read` 正文、项目范围隔离/恢复/删除与审计覆盖配置、run 和 sample。明确发布原文副本时继承 GEO 来源；隔离、过期或删除阻断当前导出、托管读取和派生成果。默认保留 90 天，删除日志处理真实任务取消/结算并回收答案文件及任务副本；无法撤回已另存到服务之外的文件。

Desktop 保留**本机 Codex**、可撤销的完整本机权限、无边框及无 Electron 菜单；明确标注「GEO 观测 · 浏览器」后打开公司 Web 地址，不以云端 Agent 替换本地执行。本机 GEO 协议仍待实现。无可见纵横滚动条，仍支持真实滚轮、局部 Home/End、整页 Ctrl+Home、末项焦点和真实进度。Extension 保留 ChatGPT 式对话/附件、获准本地文件上传和云端 Codex，通过浏览器真实右侧 Side Panel 使用；GEO 入口打开公司 Web 工作区，不依赖 Desktop。

局部验证：平台 **{count}/{count}**，保留全部原 **946** 项；GEO 专项 **{core}**、客户端 **{clients}**、真实 Web/Admin/原生侧栏 **13**、打包本机 Desktop **37**。新增 SQL100，SQL001–099 与原 OpenAPI 字节保留。模型、图片、消费者回答与广告数据均为明确假数据。真实提供方质量/排名、全部专业角色、签名、完整 Codex Desktop 对齐、性能容量和原始完整验收仍保留。原 **102 REQ/102 TC：83 部分、19 未证明、0 完整验收；G01–G10 未证明**。

交互回执对应的产品/运行时源码字节保持一致。其后仅将两处最新迁移预期由 99 更新为 100，并把历史 098→099 夹具明确限定到 99；原有数据、来源 OID、预备查询和重复升级检查保留。完整回归资格覆盖 19 个独立数据库批次：复用第 33 轮源码相同的 01–07 批，第 34 轮重新执行 08–19 批。两个受影响测试文件均重新执行，逐项核对当前运行时、实际执行测试及辅助文件字节；失败原回执不重新标记。
'''
                labels = ["方案与边界", "精确版本证据", "新增接口契约", "实际当前视口", "实际第二语言/状态", "实际交互录制", "原始 MP4", "以前交付细节（保留历史证据范围）"]
                media_note = "下面截图为真实打包 Desktop 的浏览器入口和本机布局；GIF 为现有本机创意反馈操作，不冒充 Desktop 本机 GEO 协议。" if surface == "desktop" else "实际页面截图与按观察时间录制的交互。画面中的业务/模型内容为假数据；侧栏截图来自 Chrome 真实 SIDE_PANEL 上下文。"
            block = f'''<!-- geo-observation-stage83 -->

{body}

[{labels[0]}]({prefix}technical/83-reproducible-geo-observations.md) · [{labels[1]}]({prefix}quality/geo-observation-checkpoint.json) · [{labels[2]}]({prefix}contracts/geo-observation-openapi.json)

```mermaid
flowchart LR
    Login[Email / company / project] --> Version[Immutable questions and harness]
    Version --> API[Independent Codex API runs]
    Version --> Manual[User-attested consumer answers]
    API --> Retained[Private original bytes and hashes]
    Manual --> Retained
    Retained --> Compare[Separate surfaces and configuration differences]
    Compare --> Export[Actual JSON download]
    Admin[Scoped Admin / expiry / deletion] --> Gate[Current source checks]
    Gate --> Retained
    Gate --> Export
```

{media_note}

![{labels[3]}]({links[0]})

![{labels[4]}]({links[1]})

![{labels[5]}]({links[2]})

[{labels[6]}]({links[3]})

<details>
<summary>{labels[7]}</summary>

{old.strip()}

</details>
'''
            save(file, title + "\n\n" + block)
    progress_file = ROOT / "docs/quality/requirements-alignment-progress.json"
    progress = json.loads(progress_file.read_text(encoding="utf-8"))
    assert progress["summary"] == {"partial_verified": 83, "completion_not_proven": 19} and progress["fully_accepted_requirements"] == 0
    progress["at"] = datetime.now(timezone.utc).isoformat()
    progress["current_source_qualification"] = {"stage": 83, "checkpoint": "geo-observation-checkpoint.json", "note": proof["scope"]}
    progress["reproducible_geo_observations"] = {"checkpoint": "geo-observation-checkpoint.json", "stage": 83, "status": proof["status"], "original_full_acceptance": "not_proven"}
    req = next(v for v in progress["requirements"] if v["requirement_id"] == "REQ-030")
    req["finding"] = "固定问句/完整配置、独立 Codex 重复观察、原始回答留存与来源治理已有明确假数据下的局部证据；原始完整 TC-030、真实提供方/消费者产品观察及业务验收仍未完成。"
    req["source_inspection_candidates"] += ["dev/copypaste-platform/src/geo-model.ts", "dev/copypaste-platform/src/geo-observations.ts", "dev/copypaste-web/src/geo-observations.tsx"]
    req["acceptance_evidence"].append("reproducible_geo_observations")
    req["verified_repairs"].append({"cluster": "reproducible_geo_observations", "verified_subflow": proof["scope"], "evidence": ["reproducible_geo_observations"], "implementation_docs": ["technical/83-reproducible-geo-observations.md"]})
    req["remaining_complete_acceptance_conditions"] = "固定问句/配置、重复运行、原始回答、人工样本分离和权限来源治理已在明确假数据下局部验证；真实提供方/消费者产品观测、专业判断、客户价值、本机 GEO 协议及完整 TC-030 仍未证明。"
    save(progress_file, json.dumps(progress, ensure_ascii=False, indent=2) + "\n")
    active = ["docs/00-document-map.md", "docs/DELIVERY.md", "docs/product/01-prd.md", "docs/product/02-user-journeys.md", "docs/product/03-information-architecture-and-interactions.md", "docs/product/08-admin-dashboard.md",
        "docs/requirements/03-client-execution-amendment.md", "docs/requirements/04-desktop-layout-and-scroll.md", "docs/technical/01-architecture-and-stack.md", "docs/technical/06-media-and-data-pipelines.md", "docs/technical/08-development-and-delivery.md", "docs/technical/11-admin-control-plane.md", "docs/technical/12-implementation-and-repositories.md",
        "docs/quality/02-requirements-traceability.md", "docs/quality/04-implementation-acceptance.md", "docs/quality/09-implementation-alignment-audit.md"]
    for name in active:
        file = ROOT / name
        title, rest = file.read_text(encoding="utf-8").split("\n", 1)
        rest = rest.replace("阶段 82 当前增量", "阶段 82 历史基线")
        if name == "docs/requirements/04-desktop-layout-and-scroll.md":
            rest = rest.replace("../quality/creative-feedback-visual-review.md", "../quality/geo-observation-visual-review.md").replace("../quality/creative-feedback-checkpoint.json", "../quality/geo-observation-checkpoint.json")
        link = "83-reproducible-geo-observations.md" if file.parent.name == "technical" else "technical/83-reproducible-geo-observations.md" if file.parent == ROOT / "docs" else "../technical/83-reproducible-geo-observations.md"
        lead = f"**阶段 83 当前增量：** 固定 GEO 问句和完整 Agent/skills 配置、独立 Codex 重复运行、私有原始回答与真实 JSON、人工消费者样本单独声明及后台来源治理已局部核对。平台 {count} 项保留原 946 项，专项 {core}、客户端 {clients}、真实 Web/Admin/原生右侧栏 13、打包本机 Desktop 37 项分别通过。SQL100 新增，SQL001–099 与原 OpenAPI 保持。Desktop 本机 Codex、主动可撤销全权限、无边框/菜单、无可见纵横滚动条，保留滚动/键盘/真实进度；GEO 明确在浏览器打开，本机 GEO 协议仍待实现。原 102 REQ/102 TC 保持 83 部分／19 未证明／0 完整验收，G01–G10 保留。见[当前方案及证据]({link})。"
        save(file, title + "\n\n" + lead + "\n" + rest)
    file = ROOT / "docs/quality/01-test-and-acceptance-plan.md"
    save(file, file.read_text(encoding="utf-8") + f"\n## 阶段 83 局部证据 / Reproducible GEO observations\n\n原 102 REQ/102 TC、完整条件、NFR 与 G01–G10 不变。平台 {count} 项保留原 946 项；GEO 专项 {core}、客户端 {clients}、真实 Web/Admin/Side Panel 13 和打包本机 Desktop 37 分别保留实际来源范围。原始回答与配置、消费者样本分离和无滚动轨道下的内容可访问性均有具体检查；真实提供方观测、专业/客户成果、性能容量与原始完整验收仍未证明。见[检查点](geo-observation-checkpoint.json)。\n")
    file = ROOT / "docs/contracts/README.md"
    save(file, file.read_text(encoding="utf-8") + "\n## Stage83 GEO 观测 / Reproducible observations\n\n[新增 GEO 契约](geo-observation-openapi.json) 覆盖 11 项操作、14 个输入/回执/列表/原文/比较结构；所有操作的真实成功请求与响应均由 AJV 核对。时间序列化、缺失答案、配额、幂等、不可变版本及来源门控另外通过业务测试。[实际模拟模式路由](../quality/geo-observation-route-inventory.json) 保留完整运行时声明。原设计 OpenAPI 不替换。见[方案和限制](../technical/83-reproducible-geo-observations.md)。\n")
    file = ROOT / "docs/technical/83-reproducible-geo-observations.md"
    save(file, file.read_text(encoding="utf-8") + f"\n## 当前验证 / Current evidence\n\n平台 {count}/{count}、全部旧 946 项保留；专项 {core}，客户端 {clients}，实际 Web/Admin/原生侧栏 13，打包本机 Desktop 37。见[精确版本检查点](../quality/geo-observation-checkpoint.json)、[实际画面复核](../quality/geo-observation-visual-review.md)及[原始媒体解码](../quality/geo-observation-media-review.json)。模型和业务数据为明确假数据。完整 TC-030、真实业务价值和专业能力未获接受。\n")
    file = ROOT / "docs/governance/04-git-branches-and-publication.md"
    text = file.read_text(encoding="utf-8").replace("python docs/tools/finalize_creative_feedback_manifest.py", "python docs/tools/finalize_geo_observation_manifest.py")
    save(file, text + "\n阶段 83 使用 `finalize_geo_observation_manifest.py` 绑定已提交的六个组件、当前 GEO/原生布局回执、双语说明、实际媒体及暂存核查，再按既有授权非强制推送。旧阶段工具和回执仅保留其历史范围。Stage 83 binds exact committed components and current evidence before the authorized ordinary push.\n")
    change = ROOT / "docs/changes/2026-10-24-reproducible-geo-observations.md"
    assert not change.exists()
    change.write_text(f"""# 可复核的 GEO 观测 / Reproducible GEO observations

原 GEO 缺少固定问句/配置与原始回答记录。本次新增不可改写的完整 Agent/skills/模型别名配置、独立重复 Codex API 任务、原文资产与哈希、配置差异对比和真实 JSON 导出。消费者人工样本明确标为用户提供，保留未知模型/检索状态，不与 API 样本混算，不调用模型。字面别名和回答链接不冒充提供方核实、全网排名或因果收益。

服务端检查整组任务名额及预算，原子创建；私有 RLS、独立后台正文权限、项目范围内容控制、已发布副本的来源继承、过期及物理删除覆盖新类型。未知用量保持待核实，不产生虚假零费用。

实际验证暴露并修复了两项产品问题：规范导出曾把数据库 Date 写为空对象，并可能输出未定义答案；现先归一化 JSON，保留 ISO 时间并省略缺失原文。配置版本表单的异步 Agent 选项曾丢失已有选择；改为受控选择并核对原 Agent。原 Web 800×600 固定偏好控件遮挡下载按钮的问题用实际点击/下载复测修复。原生 Side Panel 文档创建时 URL 暂为空，测试等待实际 documentUrl 导航完成，未降低原生侧栏断言。全部早期失败回执和源码归档保留。

English: Immutable GEO harness/question versions, independent repeats, exact retained answers and separately attested consumer samples now support reproducible observations. Current source/owner checks govern exports, publication copies and derived reads. Atomic admission preserves plan/wallet limits; unknown usage remains under reconciliation. JSON date/missing-value serialization, asynchronous Agent selection and the compact Web preference overlap were fixed through actual failures. Native Side Panel testing waits for its actual document navigation. Original failed receipts are preserved.

Desktop attempt 45 passed 22 functional checks but exceeded a 60-second long-recording encoding wait and remains failed. Its exact sources and original media are retained. Only that encoding wait changed to 180 seconds; product code, functional/media assertions and the outer owned-journey deadline were unchanged. A new complete journey is required. 第 45 轮的编码超时不计为通过；仅调整编码等待时间，全部功能与媒体断言保留，另用完整新轮次核对。

Attempt 46 passed 36 checks, including the new compact GEO entry and feedback workflow, but the final locale step still expected the local home after the GEO helper had left the marketing route active. It remains failed. The helper now returns to the local workspace and waits for its actual heading before the existing feedback/locale checks. No product or assertion is removed. 第 46 轮的最后语言步骤暴露测试页面恢复遗漏，补齐实际本机首页等待后重新完整验证，失败凭据保留。

Full backend qualification 32 stopped at batch 05: the unchanged complete-inventory check detected all eleven new GEO operations missing from the descriptive route file. The failed batch remains failed, and every source snapshot was archived before refreshing the inventory from the actual app. Both published descriptive copies now list 465 configured operations plus one conditional demo route, retaining every previous route. New native/UI/client qualifications bind the refreshed inventory and unchanged runtime; the final full backend run also covers the later test expectations described below. 第 32 轮真实检出清单漏记接口；保留失败回执并同步完整路由清单后，使用新轮次复核，未删除或放宽原清单断言。

Backend run 33 stopped at batch 08 because its historical 098-to-099 fixture also applied SQL100. That fixture now explicitly stops at 99, preserving its original source OID/prepared-reader/data assertions. Two separate populated-upgrade expectations are proactively advanced from latest version 99 to 100. No product/runtime byte changed. Exact old bytes and failed receipts are archived. Final qualification uses unchanged-source passing batches 01–07 from run 33 and freshly executes 08–19 in run 34, including both changed test files. Every actual test file is covered once with current runtime/test/helper bytes; no failed receipt is relabelled. 第 33 轮实际失败为历史夹具范围，明确限定原迁移目标；另同步最新版本预期。两个受影响批次重新执行，其他通过批次须满足源码字节一致才能计入。

Desktop remains local Codex, frameless and without Electron menus or visible scrollbar rails. Real scroll/keyboard/focus/progress are retained. Its GEO button is an explicit fixed company-browser handoff; the local GEO protocol remains open. Extension remains cloud Codex plus authorized attachments in the real right Chrome Side Panel.

Validation: platform {count}/{count} with every previous 946 case retained; core {core}, clients {clients}, Web/Admin/native Side Panel 13 and packaged local Desktop 37. Synthetic gateway/model/consumer/ad fixtures only. SQL100 is additive; SQL001–099, original OpenAPI, original 102 REQ/102 TC and 83/19/0 acceptance states remain unchanged. G01–G10, professional customer outcomes, full parity, signing, performance and production readiness remain open.

[方案 / Design](../technical/83-reproducible-geo-observations.md) · [证据 / Evidence](../quality/geo-observation-checkpoint.json) · [契约 / API](../contracts/geo-observation-openapi.json)
""", encoding="utf-8", newline="\n")
    output.write_text(json.dumps({"at": datetime.now(timezone.utc).isoformat(), "stage": 83, "readmes": 14, "files": records, "verifier_sha256": digest(Path(__file__)), "scope": "Bounded GEO/native presentation; original acceptance definitions and assessment retained."}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": "updated", "readmes": 14, "archives": len(records)}))


if __name__ == "__main__":
    main()
