"""Prepare first-release documentation without changing qualified product sources."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import collections
import json
import shutil

ROOT = Path(r"D:\dev\copypasted\自有agent")
DEV = ROOT / "dev"
EVIDENCE = DEV / "copypaste-delivery/evidence/marketing-import-148"
VERSION = "v0.1.0-rc.1"


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def write(relative, value):
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def main():
    reports = {name: read(EVIDENCE / (name + ".json")) for name in ("backend-03", "build-01", "ui-04", "ui-04-journey")}
    for name, report in reports.items():
        assert report["status"] == "passed", name
    for name in ("backend-03", "build-01", "ui-04"):
        assert reports[name]["source_unchanged"] is True
    assert reports["ui-04"]["package_unchanged"] is True
    assert len(reports["ui-04-journey"]["checks"]) == 4
    assert all(reports["ui-04-journey"][key] for key in ("browser_closed", "desktop_closed", "api_closed", "fixture_closed"))
    source_bindings = {}
    for name in ("backend-03", "build-01", "ui-04"):
        item = reports[name]["source_manifest"]
        manifest = DEV / "copypaste-delivery" / item["path"]
        assert digest(manifest) == item["sha256"]
        for path, entry in read(manifest).items():
            actual = digest(DEV / path)
            assert actual == entry["sha256"], path
            assert digest(DEV / "copypaste-delivery" / entry["path"]) == actual
            if path in source_bindings:
                assert source_bindings[path] == actual
            source_bindings[path] = actual
    baseline = read(DEV / "copypaste-delivery/.data/marketing-import-148/baseline.json")
    for path, expected in baseline["repos"]["docs"]["untracked"].items():
        assert digest(ROOT / path) == expected, path
    assert digest(DEV / "copypaste-desktop/.gitattributes") == baseline["desktop_attributes_sha256"]

    media = reports["ui-04-journey"]["screenshots"] + [f for r in reports["ui-04-journey"]["recordings"] for f in r["files"]]
    for entry in media:
        assert digest(DEV / entry["path"]) == entry["sha256"]
    common = """**首个冻结候选版本 / First frozen candidate: `v0.1.0-rc.1`**

本版用于 Windows x64 本地试用，AI 提供方使用已获准的模拟数据。产品版本与各组件 package.json 版本独立。Web / Extension 在云端运行 Codex；Desktop 在客户本机运行固定版本 Codex，可由客户主动授予完整本机权限。Extension 保留 Chrome 原生右侧 Side Panel，负责获准文件读取与上传。管理后台保留独立管理员登录、用户/企业控制、费用/VIP/用量及内容权限。

This release candidate provides a Windows x64 local trial with explicitly synthetic AI providers. Product and component versions are independent. Web and Extension use cloud Codex; Desktop runs pinned Codex locally with customer-controlled full OS permission. Extension uses Chrome's native right Side Panel for conversation and consented file upload. Admin provides separate administrator authentication, account controls, billing/VIP/usage and content permissions.

```mermaid
flowchart LR
  W[Web / Chrome Side Panel] --> A[Company API / identity / billing]
  A --> C[Cloud Codex / role skills]
  D[Frameless Desktop] --> L[Customer-local Codex]
  L --> A
  A --> P[Company OpenAI-compatible gateway]
  M[Admin dashboard] --> A
```

**首次启动 / First source startup**：六组件按 `copypaste-platform`、`copypaste-web`、`copypaste-admin`、`copypaste-desktop`、`copypaste-extension`、`copypaste-delivery` 放在同一父目录。要求 Windows x64、Node.js ≥22.14、Git、原生 .NET 构建工具；禁止 Docker/WSL。进入 delivery 执行 `npm run bootstrap`，在 desktop 执行 `npm run runtime:prepare`，回到 delivery 执行 `node scripts/start-frozen-demo-148.mjs`。该入口校验 Codex 版本及 SHA-256，避免使用系统 PATH 中的其他版本；停止用 `npm run stop`。管理员首次开户按 platform 已有 enrollment 命令创建独立管理员，勿使用客户登录代替。

Place all six named repositories under one parent. Run delivery `npm run bootstrap`, desktop `npm run runtime:prepare`, then delivery `node scripts/start-frozen-demo-148.mjs`. This entry verifies the pinned Codex binary instead of selecting an arbitrary PATH version. Stop with delivery `npm run stop`. Enroll an independent administrator using the platform's documented enrollment command.

**使用流程 / Journey**：浏览器打开 Web → 邮箱验证码 → 进入企业/项目 → 选择预设角色 → 提交任务并审核所需权限 → 查看结果、费用、下载。Desktop 配置同一后端，使用浏览器授权登录，再选择本机目录和权限。Chrome 在开发者模式加载 extension 的 `dist/`，点击扩展打开右侧面板、登录并主动选择上传文件。营销分析支持原始 CSV/XLSX 上传、明确数字/日期口径、字段映射、精确预览、确认和持久化分析快照；改变格式会撤销旧确认。

Open Web, verify email, select workspace/project and a role preset, review permissions, run a task and inspect results/usage/downloads. Desktop signs in through browser authorization and then selects local scope. Load Extension `dist/` unpacked in Chrome, click its action to open the native side panel, sign in and explicitly attach files. Marketing imports retain original bytes, require explicit conventions and mapping, preview exact facts and create a durable analysis snapshot; changing conventions clears confirmation.

**冻结依据 / Qualification**：当前后端 17 项必要检查通过；Web、Admin、Extension、Desktop 构建完成，Windows 未签名目录包已在真实窗口验证。当前 UI 冒烟覆盖 Web OTP、Desktop 原生 PKCE 和两端原文件→精确预览→分析快照，共 4 组旅程；保留 4 张实际截图、2 组实际 GIF/MP4。阶段147的真实本地/云端 Codex 与 Chrome 原生侧栏为历史证据，本轮未重复完整回归，也没有把模拟 AI 回复称作真实模型验收。

Seventeen focused backend checks passed. All client builds completed; the unsigned Windows directory package was exercised in a real window. Four current smoke groups cover Web OTP, native Desktop PKCE and actual original-file imports through durable snapshots, with four screenshots and two GIF/MP4 pairs. Stage147 local/cloud Codex and native Chrome Side Panel evidence stays historical. Broad regression was deliberately omitted at the user's request; synthetic model replies are not production model acceptance.

**边界 / Boundaries**：这是首个候选冻结版。生产内部 API/真实媒体和 Google/Meta 等账户联调、签名安装及更新、完整权限/故障/并发矩阵和全量验收仍待完成。项目/企业聚合整删尚未实现；归档项目的恢复权限路径需要修复，不能视为已支持。UTF-16 CSV 上传需 BOM；其他编码转换为 UTF-8。原有102项需求逐条记录保留，88项必需完整验收范围仍开放，并非88个模块完全未实现。

Production provider/account integration, signed installers/updates and comprehensive permission/failure/concurrency acceptance remain open. Aggregate project/tenant erasure is unimplemented; archived-project restoration still needs its access-path fix. UTF-16 CSV uploads require a BOM. All102 original requirement records remain, including88 open required full-acceptance scopes; this does not mean88 entirely missing modules.

冻结标签 / Frozen tags: `v0.1.0-rc.1` (docs), `v0.1.0-rc.1-backend`, `-web`, `-admin`, `-desktop`, `-extension`, `-delivery` (full tag prefix for each component). Each tag identifies a complete independent Git history; compact release source archives omit historical evidence/media, which remain available in Git.

"""
    for component in ("platform", "web", "admin", "desktop", "extension", "delivery"):
        repo = DEV / ("copypaste-" + component)
        marker = "<!-- frozen-release-148 -->"
        readme = repo / "README.md"
        assert marker.encode() not in readme.read_bytes()
        source = "desktop" if component == "desktop" else "web"
        names = ["parsed-exact-campaign-en.png", "durable-analysis-snapshot-en.png", "reviewed-marketing-import.gif", "reviewed-marketing-import.mp4"]
        for suffix in names:
            name = "workmate-marketing-release-148-04-" + suffix
            original = DEV / ("copypaste-" + source) / "assets/screenshots" / name
            target = repo / "assets/screenshots" / name
            if target != original:
                target.parent.mkdir(parents=True, exist_ok=True)
                assert not target.exists()
                shutil.copyfile(original, target)
        figure_note = "实际 Desktop 窗口 / Actual Desktop window" if component == "desktop" else "实际 Web 页面（共享流程示意；非本组件新增 UI 验证） / Actual Web journey (shared illustration; not a new UI check of this component)"
        media_text = f"{figure_note}\n\n![Exact imported facts](assets/screenshots/workmate-marketing-release-148-04-parsed-exact-campaign-en.png)\n\n![Actual interaction](assets/screenshots/workmate-marketing-release-148-04-reviewed-marketing-import.gif)\n\n[Actual MP4](assets/screenshots/workmate-marketing-release-148-04-reviewed-marketing-import.mp4) · [Saved analysis](assets/screenshots/workmate-marketing-release-148-04-durable-analysis-snapshot-en.png)\n\n"
        readme.write_bytes((marker + "\n\n" + common + media_text + "---\n\n").encode("utf-8") + readme.read_bytes())

    release_guide = "# Workmate v0.1.0-rc.1 / 首个冻结候选版\n\n" + common + """## 交付包 / Deliverables

本地路径：`dev/copypaste-delivery/release/workmate-v0.1.0-rc.1/`。包含 Windows 未签名便携目录 ZIP、Web/Admin 静态构建、Chrome 扩展 ZIP、六组件可构建源码 ZIP、`release-manifest.json` 和 `SHA256SUMS`。Windows 包解压后运行 `CopyPaste.exe`，需要启动对应后端；不是脱离后端的离线产品。静态包需部署到配置好的同源/代理环境；源码本地启动入口会启动开发代理。

Local output includes the unsigned Windows directory ZIP, Web/Admin static bundles, Chrome extension ZIP, six-component buildable source ZIP, release manifest and SHA-256 checksums. Extract the Windows directory and launch `CopyPaste.exe` with its backend running. Static bundles require configured same-origin/proxy hosting; the source launcher starts development proxies. Chrome ZIP must be extracted before Load unpacked.

`release-manifest.json` 绑定六组件提交、源码树、产品标签、实际构建哈希、固定 Codex、数据库145版及明确的模拟模式。Git 分支和冻结标签通过已授权 SSH 推送并读取远端核对。GitHub Release 网页/附件上传使用的本地 HTTPS 凭证曾被 GitHub 返回403（该凭证所属账号被暂停）；该渠道状态与 SSH Git 推送分开记录，未上传成功前不得声称网页附件已发布。

The manifest binds exact independent commits/trees, tags, actual build hashes, pinned Codex and schema145. Authorized SSH branch/tag publication is verified separately. GitHub's REST API rejected the locally stored HTTPS credential with403 and an account-suspended message; this describes that credential's account, not an inference about the company account. A Release webpage/asset upload is not claimed without success.

## 必要核查与省略项 / Focused checks and omissions

|编号 / ID|状态 / State|内容 / Scope|
|---|---|---|
|F01|通过 / Passed|后端17项：精确值、CSV/XLSX口径、UTF-16原上传、权限与幂等|
|F02|通过 / Passed|Web、Admin、Extension、Desktop构建；原生表面12项边界检查|
|F03|通过 / Passed|真实Web邮箱登录、Desktop浏览器授权及两端上传至快照的4组冒烟|
|F04|冻结交付 / Frozen artifacts|六端源码、Windows/Web/Admin/Extension包、哈希及双语说明|
|F05|按要求省略 / Deliberately omitted|完整历史/全量功能回归、跨系统矩阵、生产真实提供方验收|
|F06|后续 / Follow-up|真实内部API与外部账号、签名更新、聚合整删、归档恢复及完整验收|

原 backend-01 经用户要求主动停止，UI01/02/03 原失败和所有执行器保持原字节；选择 backend-03/build-01/UI04 为本版依据。UI03 是第二次邮件验证码受限，UI04 复用真实已登录浏览器走正常原生授权，没有降低验证码限制。完整需求清单见 [编号表](../quality/remaining-work-stage148.md)，资格见 [冻结检查点](../quality/release-freeze-checkpoint-148.json)。

Original stopped/failed attempts are retained unchanged. backend-03/build-01/UI04 qualify this release. UI04 uses an already authenticated browser for native authorization without weakening OTP limits. See the numbered ledger and source-bound checkpoint for exact scope.
"""
    write("docs/releases/v0.1.0-rc.1.md", release_guide)
    write("docs/development/148-first-frozen-release.md", "# 第一版冻结执行 / First release freeze\n\n" +
          "用户授权在主功能闭环下跳过部分验证。停止增加功能、广泛回归与历史扫描，仅绑定已完成的后端03、构建01、实际UI04；冻结源码后打包，普通原子推送8分支及7个不可变标签。打包不重编译、不替换已核查的Windows目录包。所有文档在docs，执行脚本与产物在dev；禁止虚拟化。\n\n" +
          "At the user's request, stop feature expansion and broad verification. Bind the completed focused results, commit independent repositories, package existing qualified builds, atomically publish eight branches and seven immutable tags, and verify remote references. Do not rebuild or replace the qualified Windows package during packaging.\n\n" +
          "原始失败保留。新包只含运行所需构建/完整可构建源码和当前媒体；旧证据与完整历史仍在冻结Git标签，未重新扫描。发布回执位于delivery/.data/marketing-import-148/publication-UUID/，避免文档提交与回执自引用。\n\n" +
          "Existing evidence remains immutable. Compact archives omit historical evidence while frozen Git tags retain complete histories. A separate publication receipt maps exact commits, artifact checksums and remote readback.\n\n[Release guide](../releases/v0.1.0-rc.1.md)\n")
    write("docs/technical/148-campaign-formats.md", """# 营销原文件与格式口径 / Marketing import conventions

统一资产上传→inspect→明确格式/映射→preview→确认→`POST /v1/dataset-imports`→持久快照/报告/原文件下载。所有阶段重新检查当前企业、项目、资源与授权，重放幂等结果不能绕过已撤销来源。预览与导入使用同一套解析选项；改变任一格式会取消客户旧确认。

Upload original bytes, inspect, select conventions/mappings, preview exact facts, confirm, then create a canonical dataset import and analysis snapshot. Each stage rechecks current scope and source access. Preview and import share options; changing conventions resets confirmation.

|选项 / Option|支持 / Supported|
|---|---|
|number_format|dot_decimal / comma_decimal / space_dot / space_comma；严格分组，NBSP/窄NBSP；不猜测|
|date_format|iso / day_first / month_first / year_first；四位年份和真实日历日期|
|csv_delimiter|comma / semicolon / tab|
|csv_encoding|UTF-8；UTF-16LE/BE上传需相应BOM，检测/指定冲突时报错|
|header_row|API 1–100；先跳过说明行再进行CSV词法解析|
|XLSX|客户选工作表/表头；原生数字和日期使用服务端可信规范值，不按本地文本再次缩放|

不接受负值、指数或百分数字串进入金额/计数字段。字符串数字按十进制定点归一化，既有BigInt/micros计算保持精确；显示端按十进制字符串拆分。ISO日期始终接受，其他日期按明确规则解释，不按语言猜测。默认及显式标准选项保持原import_key/spec_hash；非默认口径进入新规范身份。CSV dialect/encoding/header及原始字节摘要也参与文件规范身份。

Amounts/counts use exact decimal strings and existing integer micros/BigInt calculations. Invalid grouping, negative/scientific/percentage strings are rejected for these fields. Defaults retain existing import identities; nondefault conventions and file dialect selections become part of identity. Original-source download preserves uploaded bytes and SHA, with the correct CSV encoding content type.

CSV行号按真实物理CR/LF/CRLF计数，工作簿规范单元格按记录序号绑定。客户端不能提交可信规范单元格映射。私有角色工具支持同一口径，仍是获准的私有附件，不擅自变成共享数据集。UTF-16放行仅限有BOM的CSV，其他MIME/NUL类型边界保持。

Physical CSV line diagnostics handle CR/LF/CRLF, including quoted newlines. Trusted workbook cells are server-bound by record ordinal and cannot be supplied by clients. Private Codex file tools share conventions without creating shared datasets. UTF-16 acceptance is limited to BOM-marked CSV, preserving other MIME/NUL guards.

[First release](../releases/v0.1.0-rc.1.md) · [Checkpoint](../quality/release-freeze-checkpoint-148.json)
""")
    write("docs/changes/148-first-frozen-release.md", "# 冻结版更新 / Frozen release changes\n\n" +
          "1. 新增明确的本地化数字、日期、CSV分隔符/编码和表头；保留原字节、精确值、规范幂等及来源权限。\n2. Web/无边框Desktop新增精确事实预览与格式变更重新确认；修复真实UTF-16上传与说明行/CRLF解析。\n3. 新增固定Codex版本的本机模拟启动入口、首个候选版打包与普通原子标签发布。\n4. 同步六个独立仓库双语说明、真实截图/GIF/MP4；按用户要求省略广泛回归。\n\n" +
          "Explicit campaign conventions, exact reviewed facts and original bytes are now available in Web/Desktop. A pinned demo launcher and first frozen artifact/tag publisher deliver the existing qualified builds. Six independent guides include actual captures. Broad regression is deliberately omitted.\n\n" +
          "本版不关闭原始完整需求；聚合整删及归档恢复尚需实现/修复。生产接入与签名安装继续开放。\n\nFull acceptance, production integrations, aggregate erasure, archived-project restoration and signing remain open.\n")

    ledger = read(ROOT / "docs/quality/remaining-work-stage147.json")
    ledger["schema_version"] = 27
    ledger["reviewed_at"] = datetime.now(timezone.utc).isoformat()
    ledger["current_stage"] = 148
    ledger["previous_review"] = {"path": "docs/quality/remaining-work-stage147.json", "sha256": digest(ROOT / "docs/quality/remaining-work-stage147.json")}
    ledger["checkpoint"] = "docs/quality/release-freeze-checkpoint-148.json"
    ledger["current_increment"] = {"stage": 148, "scope": "First frozen release; explicit campaign conventions, actual upload and reviewed snapshot", "backend_cases": 17, "actual_client_journey_groups": 4, "broad_regression": "deliberately_omitted_by_user", "full_acceptance_closed": False}
    for row in ledger["requirements"]:
        if row["id"] == "REQ-023":
            row["implemented_scope"] += "；统一原文件上传与dataset-imports API、明确数字/日期/CSV口径及精确事实预览"
            row["current_audit_remaining"] = "全部官方导出及语言/数字组合、多维事实模型与生产账户字段口径验收仍开放；规范资产上传/dataset-imports已实现并经本轮实际上传验证。"
            row["remaining"] = "全部官方导出/语言数字组合、多维事实模型及生产账户口径完整验收。"
            row["current_review_note"] = "148后端17项及Web/打包Desktop实际上传至快照通过；UTF-16 CSV上传需BOM，非全平台回归。"
        elif row["id"] == "REQ-049":
            row["current_audit_remaining"] = "项目/企业聚合整删尚未实现（当前仅单资源删除/企业状态关闭）；全量导出、备份轮换及全部衍生数据/生产恢复仍待验收。"
            row["current_review_note"] += " 148独立只读检查确认聚合整删缺少路由、队列和范围实现；不可标成仅测试未完成。"
        elif row["id"] == "REQ-085":
            row["current_audit_remaining"] = "已有提升另一owner与最后owner保护；统一责任转移流程及全在途任务/三端管理状态组合仍待完善验收。归档项目恢复被projectAccess过滤，恢复路径尚需修复。"
    assert len(ledger["requirements"]) == 102
    assert collections.Counter(row["full_acceptance"] for row in ledger["requirements"]) == {"open": 101, "accepted": 1}
    write("docs/quality/remaining-work-stage148.json", ledger)
    rows = ["# 完整需求编号清单 / Numbered requirement ledger\n\n首版冻结不等同完整验收；88项必需范围仍开放，12项扩展建议、1项可选，1项已完整验收。以下保留全部102原始编号。 / The frozen candidate does not close full acceptance.\n\n|编号|模块|完整验收|当前剩余范围|\n|---|---|---|---|"]
    rows += [f"|{a['id']}|{a['module']}|{a['full_acceptance']}|{a.get('current_audit_remaining', a['remaining']).replace('|', '/').replace(chr(10), ' ')}|" for a in ledger["requirements"]]
    write("docs/quality/remaining-work-stage148.md", "\n".join(rows) + "\n")
    checkpoint = {"product_release": VERSION, "created_at": datetime.now(timezone.utc).isoformat(), "status": "qualified_for_first_candidate_freeze", "schema_version": 145,
                  "model_mode": "authorized_synthetic", "backend_cases": 17, "actual_journey_groups": 4, "broad_regression": "deliberately_omitted_by_user",
                  "reports": [{"path": f"dev/copypaste-delivery/evidence/marketing-import-148/{name}.json", "sha256": digest(EVIDENCE / (name + ".json"))} for name in reports],
                  "qualified_sources": source_bindings, "media": media, "package_files": reports["ui-04"]["package_files"],
                  "baseline_heads": {k:v["head"] for k,v in baseline["repos"].items()}, "preserved_user_files": baseline["repos"]["docs"]["untracked"],
                  "desktop_attributes_sha256": baseline["desktop_attributes_sha256"], "historical_evidence": "Stage147 remains historical; existing proof identities retained by Git ancestry, not rescanned",
                  "attempts": {"backend-01": "stopped at user direction; original result retained", "backend-02": "historical passed15 before upload guard fix", "backend-03": "selected passed17", "ui-01": "failed original upload", "ui-02": "failed UTF16 MIME gate, fixed in source", "ui-03": "failed repeat email cooldown; auth restrictions not weakened", "ui-04": "selected passed; browser session reused for real native PKCE"},
                  "builds": {"web_desktop": "source-bound build-01", "admin_extension": "successful npm run build in Codex tool outputs; no new UI regression claim"},
                  "release_web_assets": {"status": "blocked_by_existing_https_credential", "observed_http_status": 403, "observed_message": "Sorry. Your account was suspended", "scope": "Locally stored HTTPS credential account; SSH Git publication handled separately"},
                  "new_full_acceptance_closures": 0}
    write("docs/quality/release-freeze-checkpoint-148.json", checkpoint)
    root_readme = ROOT / "README.md"
    root_readme.write_bytes(("<!-- frozen-release-148 -->\n\n" + common + "[完整发布说明 / Release guide](docs/releases/v0.1.0-rc.1.md) · [编号清单 / Ledger](docs/quality/remaining-work-stage148.md)\n\n---\n\n").encode() + root_readme.read_bytes())
    print(json.dumps({"status": "prepared", "sources_bound": len(source_bindings), "media": len(media), "release": VERSION}, ensure_ascii=False))


if __name__ == "__main__":
    main()
