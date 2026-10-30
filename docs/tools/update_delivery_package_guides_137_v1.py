"""Update delivery usage guides and all original requirement identities after qualification."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import copy
import json

ROOT = Path(__file__).resolve().parents[2]
CP = ROOT / "docs/quality/delivery-package-checkpoint-137.json"
cp = json.loads(CP.read_bytes())
assert cp["status"] == "verified_fixed_version_delivery_packages"
previous = ROOT / "docs/quality/remaining-work-stage136.json"
old = json.loads(previous.read_bytes())
value = copy.deepcopy(old)
scopes = {
    "REQ-002": "阶段137完整交付包验证跨企业、私有任务、项目只读下载、审阅拒绝及生成期间项目撤权；既有全部品牌／连接器／异步权限矩阵继续开放。",
    "REQ-012": "阶段137按任务及交付摘要导出全部当前可用成果和答复，保留同名文件、精确版本、校验清单和部分失败说明；所有类型预览、工程依赖完整性和跨环境恢复继续开放。",
    "REQ-014": "阶段137新增顺序流式读取、磁盘生成ZIP及原生客户端下载，真实三端小型交付包独立解压和逐文件摘要一致；三端完整1 GiB实传、生产对象存储及所有桥接大文件组合继续开放。",
    "REQ-022": "阶段137补齐完整当前交付ZIP、任务／素材版本清单、整包及逐文件校验、中英编辑说明、审阅后下载和部分失败导出；全类型修改闭环、完整工程重新导入及跨环境编辑恢复继续开放。",
    "REQ-035": "阶段137Web原对话直接下载完整交付包，实际OTP登录、独立解压、固定版本审阅及繁英下载通过；所有业务的首单、输入发现与专业交付质量继续开放。",
    "REQ-036": "阶段137真实Chrome原生右侧SIDE_PANEL直接从原聊天发起原生下载管理器保存，取得真实ZIP并独立解压；提示跨刷新及语言切换保留，过期版本不创建下载。完整网页协作、安装权限及浏览器兼容矩阵继续开放。",
    "REQ-039": "阶段137实际未签名Windows包经真实PKCE及原生IPC保存已提交成果并校验整包，取消保存不请求或显示成功；三档原生窗口保持无边框、无菜单、无可见纵轨或横向溢出。本机Codex沿用既有实现，完整工具／签名安装／OS及DPI验收继续开放。",
    "REQ-046": "阶段137三端交付导出不产生新的任务／预留／模型请求或AI费用，原任务费用及一次结算保留；全部并行、媒体、未知费用和生产费率矩阵继续开放。",
    "REQ-060": "阶段137六个独立组件同步中英README、实际截图／GIF／MP4、源码绑定、原失败和新下载契约；交付包三端实取并独立解压。完整独立检出复现、签名安装与生产综合交付继续开放。",
    "REQ-073": "阶段137提供所有已交付格式共用的固定版本ZIP及实际编辑说明，不将平面成果或缺少依赖的文件称为可恢复源工程。十八个候选角色的专业输出／修改／异常资格继续按原范围完成。",
    "REQ-078": "阶段137统一当前任务成果导出，真实字节、版本、来源撤回、损坏、只读和私有范围具备定向检查；完整角色输入／输出／异常、工程来源及全部跨端矩阵继续开放。",
}
for row in value["requirements"]:
    if row["id"] in scopes:
        row["current_audit_remaining"] = scopes[row["id"]]
        row["current_review_note"] = "阶段137收口完整交付包及原对话下载子流程；原始完整验收范围保留。"
assert [r["id"] for r in value["requirements"]] == [r["id"] for r in old["requirements"]]
assert len(value["requirements"]) == 102 and value["summary"] == old["summary"]
assert [r["id"] for r in value["requirements"] if r["full_acceptance"] == "accepted"] == ["REQ-095"]
value.update(schema_version=19, reviewed_at=datetime.now(timezone.utc).isoformat(),
    previous_review={"path": previous.relative_to(ROOT).as_posix(), "sha256": sha256(previous.read_bytes()).hexdigest()},
    checkpoint={"path": CP.relative_to(ROOT).as_posix(), "sha256": sha256(CP.read_bytes()).hexdigest()}, new_full_acceptance_closures=0,
    current_increment={"stage": 137, "counts": cp["counts"], "required_open": 88, "unconfirmed_suggestions": 12, "optional_open": 1,
                       "whole_platform_runtime_rerun": False, "full_acceptance_closures": 0, "updated_scope_records": list(scopes)})
ledger = ROOT / "docs/quality/remaining-work-stage137.json"
assert not ledger.exists() and not ledger.with_suffix(".md").exists()
ledger.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
c = cp["counts"]
validation = f'{c["backend_integration_tests"]}项当前后端检查（含11项新打包测试）、{c["extension_state_tests"]}项扩展状态检查、{c["desktop_download_tests"]}项桌面下载回归、12项边界绑定及10项三端实际旅程通过。9张实际截图、3组GIF／MP4、7档布局和3个独立解压的下载包绑定1713份确切源码。'
validation_en = f'{c["backend_integration_tests"]} current backend checks including eleven new export cases, {c["extension_state_tests"]} extension checks, {c["desktop_download_tests"]} native download regression, twelve boundary checks and ten actual client journey checks passed. Nine actual screenshots, three GIF/MP4 pairs, seven layouts and three independently extracted archives bind 1,713 exact source files.'
intro = """# 当前完整编号清单 · 阶段137

保留102条原始身份，REQ-095维持原验收；88条必需、12条未确认建议和1条可选记录继续按原完整范围验收。它们是完整验收记录，并非101个尚未编码模块。本轮收口用户可见的完整交付包、三端下载及固定版本审阅衔接。

""" + validation + " 假业务内容，真实登录、数据库、文件及客户端；Windows包未签名。实际生产模型／广告账户、专业质量和完整工程跨环境恢复继续独立验收。原失败不改写为成功。\n\n" + \
    "[检查点](delivery-package-checkpoint-137.json) · [原始证据](delivery-package-evidence-137/index.json) · [机器清单](remaining-work-stage137.json) · [变更](../changes/137-complete-delivery-package.md)\n\n" + \
    "| 编号 | 优先级 | 模块 | 当前状态 | 原始完整验收的结论及余项 |\n| --- | --- | --- | --- | --- |\n"
lines = [f'| {r["id"]} | {r["priority"]} | {r["module"]} | {r["audit_status"]} | {r["current_audit_remaining"].replace("|", "／")} |' for r in value["requirements"]]
ledger.with_suffix(".md").write_text(intro + "\n".join(lines) + "\n", encoding="utf-8", newline="\n")
base = "https://github.com/copypasteltd/workmate/blob/main/docs/"
links = f'[需求]({base}requirements/14-complete-delivery-package.md) · [方案与使用逻辑]({base}technical/137-complete-delivery-package.md) · [确切源码与证据]({base}quality/delivery-package-checkpoint-137.json) · [全部编号]({base}quality/remaining-work-stage137.md)'
links_en = f'[Requirements]({base}requirements/14-complete-delivery-package.md) · [Architecture and usage]({base}technical/137-complete-delivery-package.md) · [Exact source and evidence]({base}quality/delivery-package-checkpoint-137.json) · [All original identities]({base}quality/remaining-work-stage137.md)'
zh = f"""<!-- delivery-package-stage137 -->
## 完整交付与原对话下载 · 阶段137

主要业务按“提交目标 → 补充资料 → 执行 → 审阅 → 下载成果 → 原对话修改”继续收口。现在 Web 和 Chrome 原生右侧栏可直接在原聊天下载完整当前交付包，任务审阅区也提供入口；Desktop 使用公司授权接口和原生保存窗口。取消保存不发请求、不显示成功，侧栏提示跨刷新及繁英切换保留。

ZIP 包含实际成果、文字答复（如有）、任务及素材固定版本、SHA-256清单及中英编辑说明。同名文件分别保留，失败／停止工作的现有成果明确标示为部分交付。源代码ZIP、SVG／PPTX、工程JSON及只读成片分别按实际编辑能力说明，不虚构源工程。没有提交为交付物的本机文件仍留在本机；Desktop Agent仍是本机Codex，云端包不会扫描本机工作区。

用户看到的任务版本和交付摘要必须一致。后端顺序读取真实文件、流式校验大小与摘要，在受控磁盘生成ZIP，完成后再次检查当前权限、来源、保留期限及精确版本；文件损坏、素材撤回或版本变化会拒绝整个包。只读项目成员可下载获准共享成果，审阅仍需批准权限；管理员身份不自动获取私有会话。导出不调用AI、不创建新任务、不增加AI费用。容量为16 GiB／10,000个成果／文字条目，超限明确拒绝，不悄悄遗漏文件。

本轮不新增数据库迁移：Backend沿用SQL135并重新构建，Web／Desktop／Extension重新构建。扩展新增Chrome `downloads` 权限，使用浏览器默认下载位置及冲突改名；授权只在公司请求头中传递。新增契约为Backend `contracts/delivery-package-v1.json`。从Delivery执行 `npm run qa:delivery-package-backend -- <新两位编号>` 或 `npm run qa:delivery-package -- <新两位编号>`；后者默认完整构建、创建未签名Windows包并操作实际右侧栏与原生下载。

{validation} 使用受控Codex适配器和假业务内容；真实OTP／PKCE、文件读取、权限、原生窗口和Chrome下载管理器实际运行。Desktop保存窗口的选择结果由夹具指定到本轮自有目录。本轮未重新证明全部本机Codex工具、真实公司模型、专业素材质量或完整跨环境工程恢复。既有52项后端／来源回归另有阶段内原始记录，按其自身源码范围保留，不混称本轮全平台回归。

```mermaid
flowchart LR
  A[原对话成果] --> B[当前版本与交付摘要]
  B --> C[权限与来源验证]
  C --> D[逐文件校验与完整ZIP]
  D --> E[再次验证原版本和权限]
  E --> F[浏览器或原生窗口保存]
  F --> G[原对话反馈与新工作确认]
```

{links}

"""
en = f"""<!-- delivery-package-stage137 -->
## Complete delivery and original-chat download · Stage137

The main journey is goal → missing inputs → execution → review → download → revision in the original conversation. Web and the genuine native Chrome right SIDE_PANEL now download a complete current task delivery directly from chat. Delivery review also exposes it. Desktop uses the company API and its native save dialog; cancellation sends no export request and shows no success. Panel receipts survive live refresh and language changes.

The ZIP contains actual output files, task text when present, exact task/artifact versions, SHA-256 checksums and bilingual editing instructions. Identical filenames remain separate; stopped/failed task outputs remain explicitly partial. Instructions distinguish source ZIPs, SVG/PPTX, project JSON and flattened outputs. They never invent a missing editable project. Local files not submitted remain local, and Desktop continues running its own local Codex with customer-granted permissions.

The requested task version and delivery digest must match. The backend verifies real file size and digest while streaming sequentially into a disk-backed ZIP, then repeats current authority, source, retention and version checks before sending any download headers. Corruption, revocation or a changed delivery fails the whole package. Project readers may download authorized shared results; approval remains separate. Admin identity alone does not grant private conversation access. Exporting creates no AI call, new task or AI charge. Capacity is 16 GiB / 10,000 output/text entries; excess is rejected without silent omissions.

No new SQL migration is needed beyond existing SQL135. Rebuild Backend and all three clients. Extension adds Chrome `downloads` permission and uses the browser download location with conflict renaming; authorization stays in company request headers. Backend `contracts/delivery-package-v1.json` specifies the endpoint. From Delivery run `npm run qa:delivery-package-backend -- <new two-digit attempt>` or `npm run qa:delivery-package -- <new two-digit attempt>`; the latter performs full builds, creates an unsigned Windows package and drives actual native client downloads.

{validation_en} Business content and the Codex adapter are controlled; OTP/PKCE, stored files, authorization, native windows and Chrome downloads run for real. Desktop save-dialog selection is directed to an owned fixture destination. This increment does not requalify every local Codex tool, real company model, professional output quality or full project restoration across environments. A separate stage-local 52-case backend/source regression retains its exact original scope rather than being presented as a full current-platform rerun.

```mermaid
flowchart LR
  A[Original chat outputs] --> B[Current version and delivery hash]
  B --> C[Authority and source checks]
  C --> D[Verify every file Build complete ZIP]
  D --> E[Recheck original version and authority]
  E --> F[Browser or native save]
  F --> G[Original conversation feedback and work confirmation]
```

{links_en}

"""
guides = []
for component in ["platform", "web", "admin", "desktop", "extension", "delivery"]:
    guides += [(ROOT / "dev" / ("copypaste-" + component) / name, component) for name in ["README.md", "README.en.md"]]
guides += [(ROOT / "docs" / name, "docs") for name in ["README.md", "README.en.md"]]
archive = ROOT / "docs/quality/history/stage137-guides-before"
assert not archive.exists()
for file, component in guides:
    original = file.read_bytes()
    saved = archive / component / file.name
    saved.parent.mkdir(parents=True, exist_ok=True)
    saved.write_bytes(original)
    text = original.decode("utf-8")
    assert "<!-- delivery-package-stage137 -->" not in text
    section = en if file.name == "README.en.md" else zh
    media_component = component if component in ["web", "desktop", "extension"] else "web"
    branch = media_component
    chosen = [m for m in cp["media_files"] if m["path"].startswith("copypaste-" + media_component + "/")
              and (m["path"].endswith("conversation-en.png") or m["path"].endswith("downloaded.png") or m["path"].endswith(".gif"))]
    section += ("Actual customer workflow captures (synthetic content):\n\n" if file.name == "README.en.md" else "实际客户流程截图与交互（业务内容为假数据）：\n\n")
    for item in chosen:
        rel = item["path"].split("/", 1)[1]
        label = ("Native client delivery" if media_component == component else "Customer Web delivery for operations context") if file.name == "README.en.md" else ("本端实际交付操作" if media_component == component else "客户Web交付页，供运营理解")
        section += f'![{label}](https://github.com/copypasteltd/workmate/blob/{branch}/{rel})\n\n'
    first, _, rest = text.partition("\n")
    file.write_text(first + "\n\n" + section + rest.lstrip("\n"), encoding="utf-8", newline="\n")
print(json.dumps({"stage": 137, "original_identities": len(value["requirements"]), "required_open": 88, "guides_updated": len(guides), "counts": c}))
