"""Record actual online publication without modifying the frozen candidate."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import copy
import json

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"
VERSION = "v0.1.0-rc.2"
URL = "https://github.com/copypasteltd/workmate/releases/tag/" + VERSION
COMPONENTS = ["platform", "web", "admin", "desktop", "extension", "delivery"]


def digest(p):
    h = sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def create(p, text):
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("x", encoding="utf-8", newline="\n") as f:
        f.write(text)


def put_json(p, value):
    create(p, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--publication", type=Path, required=True)
    parser.add_argument("--browser", type=Path, required=True)
    args = parser.parse_args()
    publication = json.loads(args.publication.read_bytes())
    browser = json.loads(args.browser.read_bytes())
    baseline = json.loads((DELIVERY / ".data/release-publication-159/baseline.json").read_bytes())
    assert publication["status"] == "published" and publication["release_url"] == URL
    assert publication["all_asset_digests_match"] and publication["frozen_bytes_unchanged"]
    assert publication["repository_private"] is False and len(publication["assets"]) == 6
    assert browser["status"] == "passed" and browser["browser_closed"]
    assert not browser["credentials_used_in_browser"] and len(browser["checks"]) == 3
    assert browser["download"]["matches_frozen_file"]
    frozen_receipt = json.loads((DELIVERY / ".data/release-freeze-158/frozen-receipt.json").read_bytes())
    frozen = DELIVERY / "release" / ("workmate-" + VERSION)
    complete = DELIVERY / "release" / ("workmate-" + VERSION + "-complete.zip")
    assert digest(complete) == frozen_receipt["complete_archive"]["sha256"]
    for name, expected in [("release-manifest.json", frozen_receipt["manifest_sha256"]), ("SHA256SUMS", frozen_receipt["sums_sha256"])]:
        assert digest(frozen / name) == expected
    for asset in publication["assets"]:
        p = complete.parent / asset["name"] if asset["name"].startswith(complete.name) else frozen / asset["name"]
        assert p.stat().st_size == asset["size"] and asset["state"] == "uploaded"
        assert asset["digest"] == "sha256:" + digest(p)
    assert publication["publisher_sha256"] == digest(DELIVERY / "scripts/publish-github-release-159-v1.py")
    evidence = DELIVERY / "evidence/release-publication-159"
    put_json(evidence / "github.json", publication)
    put_json(evidence / "browser.json", browser)
    put_json(evidence / "baseline.json", baseline)
    media = [*browser["screenshots"], *[f for r in browser["recordings"] for f in r["files"]]]
    names = []
    for item in media:
        source = DEV / item["path"]
        assert digest(source) == item["sha256"]
        names.append(source.name)
        for component in COMPONENTS:
            target = DEV / ("copypaste-" + component) / "assets/screenshots" / source.name
            if target != source:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("xb") as f:
                    f.write(source.read_bytes())
        target = ROOT / "docs/assets/release-publication-159" / source.name
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as f:
            f.write(source.read_bytes())
    assert len(names) == 4
    image = next(n for n in names if n.endswith("-verified-assets.png"))
    gif = next(n for n in names if n.endswith(".gif"))
    mp4 = next(n for n in names if n.endswith(".mp4"))
    complete_asset = next(a for a in publication["assets"] if a["name"] == complete.name)
    download = complete_asset["browser_download_url"]
    sha = frozen_receipt["complete_archive"]["sha256"]
    cn = f"""## v0.1.0-rc.2 · GitHub Release 已发布

[完整下载 / Complete ZIP]({download}) · [发布页面 / Release]({URL}) · [发布记录 / Publication](https://github.com/copypasteltd/workmate/blob/docs/docs/releases/v0.1.0-rc.2-publication.md)

完整包850,454,316字节，内含七类分发包：Windows客户端、Web、Admin、Chrome右侧栏、后端、六仓可构建源码及固定Codex运行文件。GitHub六个附件的尺寸与SHA-256逐一匹配；实际公共页面和校验文件下载通过。旧冻结说明中的HTTP403是当时旧凭据的历史状态，本次已使用现有授权发布；冻结文件与全部版本标签保持不变。

用户流程与权限沿用下方完整说明。源码运行从 `npm run bootstrap:demo` → `npm run demo:check` → `npm run demo` 开始，结束执行 `npm run stop`。当前为模拟外部依赖、Windows未签名候选版；完整生产验收仍见原编号清单。

**实际GitHub发布页面和下载交互 / Actual public release and checksum download**

![Published assets / 已发布附件](assets/screenshots/{image})

![Actual release interaction / 实际发布交互](assets/screenshots/{gif})

[MP4 recording / 下载交互录像](assets/screenshots/{mp4})

---

"""
    en = f"""## v0.1.0-rc.2 · Published GitHub Release / 已发布

[Complete download / 完整包]({download}) · [Release page / 发布页]({URL}) · [Publication details](https://github.com/copypasteltd/workmate/blob/docs/docs/releases/v0.1.0-rc.2-publication.md)

The 850,454,316-byte complete ZIP contains seven distributions: Windows Desktop, Web, Admin, Chrome Side Panel, backend, buildable six-repository sources and pinned Codex runtime files. All six GitHub assets match the frozen sizes and SHA-256 values. The actual public page and checksum download passed. The archived HTTP403 entry is historical; an existing authorized credential published this release without changing frozen bytes or version tags.

The full user/permission flow remains documented below. Start the source demo with `npm run bootstrap:demo` → `npm run demo:check` → `npm run demo`; stop with `npm run stop`. External dependencies are synthetic and Windows is unsigned. Complete production acceptance remains tracked under the original requirement IDs.

**Actual public GitHub page and checksum download / 实际发布页与校验文件下载**

![Published assets](assets/screenshots/{image})

![Actual release interaction](assets/screenshots/{gif})

[Actual MP4 recording](assets/screenshots/{mp4})

---

"""
    for component in COMPONENTS:
        for filename, header in [("README.md", cn), ("README.en.md", en)]:
            p = DEV / ("copypaste-" + component) / filename
            old = p.read_text(encoding="utf-8")
            assert "## v0.1.0-rc.2 · GitHub Release 已发布" not in old
            p.write_text(header + old, encoding="utf-8", newline="\n")
    now = datetime.now(timezone.utc).isoformat()
    previous = ROOT / "docs/quality/remaining-work-stage158.json"
    ledger = copy.deepcopy(json.loads(previous.read_bytes()))
    ledger["schema_version"] += 1
    ledger["reviewed_at"] = now
    ledger["current_stage"] = 159
    ledger["previous_review"] = {"path": "docs/quality/remaining-work-stage158.json", "sha256": digest(previous)}
    ledger["checkpoint"] = "docs/quality/release-publication-159.json"
    ledger["new_full_acceptance_closures"] = 0
    ledger["current_increment"] = {"stage": 159, "release": VERSION, "scope": "Publish the unchanged frozen release; six digest-verified assets, actual public page and checksum download, bilingual documentation sync", "broad_regression": "deliberately_omitted_by_user", "full_acceptance_closed": False}
    row = next(r for r in ledger["requirements"] if r["id"] == "REQ-060")
    row["current_review_note"] += " 159：已正式建立GitHub候选Release并上传冻结完整包及五份校验/清单；六附件SHA-256核对、实际公共页面与校验文件下载通过。旧403记录保留为历史；完整生产、签名及原综合验收范围不变。"
    assert len(ledger["requirements"]) == 102 and ledger["summary"]["required_open"] == 88
    put_json(ROOT / "docs/quality/remaining-work-stage159.json", ledger)
    lines = ["# 159 · 原编号完整验收清单 / Full acceptance ledger", "", "本轮完成冻结版本线上发布和实际下载交付，不扩大历史功能验收结论。102个原始编号保持；88项必选完整验收范围仍开放，包含已实现功能的生产、专业质量及组合验收，并非88个待开发模块。", "", "Stage159 completes online frozen delivery. Original scopes and status remain; 88 mandatory full acceptance scopes are open, including production/professional/combinatorial validation of implemented functions.", "", "| 编号 / ID | 模块 / Module | 状态 / Status | 原范围剩余 / Remaining scope |", "| --- | --- | --- | --- |"]
    for row in ledger["requirements"]:
        cells = [row["id"], row["module"], row.get("audit_status", row["full_acceptance"]), row.get("current_audit_remaining", row["remaining"])]
        lines.append("| " + " | ".join(str(c).replace("|", "\\|").replace("\n", " ") for c in cells) + " |")
    create(ROOT / "docs/quality/remaining-work-stage159.md", "\n".join(lines) + "\n")
    report = {"stage": 159, "at": now, "status": "published", "release": VERSION, "release_url": URL, "complete_download_url": download, "complete_archive": {"bytes": complete.stat().st_size, "sha256": sha}, "github": publication, "actual_browser": browser, "baseline": baseline, "source_sha256": {str(p.relative_to(ROOT)).replace("\\", "/"): digest(p) for p in [Path(__file__), DELIVERY / "scripts/publish-github-release-159-v1.py", DELIVERY / "scripts/capture-github-release-159-v1.ts"]}, "app_runtime_changed": False, "tags_moved": False, "frozen_files_changed": False, "new_full_acceptance_closures": 0, "mandatory_full_acceptance_open": 88, "broad_regression": "omitted under explicit fast-release instruction; Stage158 focused qualification retained"}
    put_json(ROOT / "docs/quality/release-publication-159.json", report)
    create(ROOT / "docs/quality/release-publication-159.md", f"""# 159 · 实际发布核对 / Publication evidence

[Release]({URL}) · [Complete download]({download})

| 编号 | 已核对内容 / Verified | 结果 / Result |
| --- | --- | --- |
| 1 | GitHub候选Release及六附件 / Published prerelease and six assets | 已发布；六项大小、状态、SHA-256匹配冻结文件 |
| 2 | 实际公共页面 / Actual unauthenticated public page | 200；全部六个实际附件链接可见 |
| 3 | 校验文件实际下载 / Real checksum download | 原字节相同；自建浏览器全部关闭 |
| 4 | 原冻结包和版本标签 / Frozen files and tags | 包不改写；标签通过发布器再次只读核对 |
| 5 | 全范围验收 / Whole acceptance | 本轮0项新增整项结案；88项必选完整范围仍开放 |

完整包SHA-256：`{sha}`。当前发布证据来自实际GitHub回执、公开页面、真实下载及未编辑截图/GIF/MP4。未重新运行产品历史回归；本轮只新增发布工具和文档，不修改产品运行逻辑。原冻结记录的403按历史保留。
""")
    supplement = f"""# Workmate v0.1.0-rc.2 · 线上发布交付 / Online publication

[完整交付包 / Complete ZIP]({download}) · [GitHub Release]({URL})

已发布到原冻结标签，完整包850,454,316字节，SHA-256为 `{sha}`。GitHub提供完整ZIP、相邻`.sha256`、`release-manifest.json`、`SHA256SUMS`、`source-files.json`和`artifact-contents.json`六个附件，逐一核对GitHub报告的尺寸和SHA-256。完整ZIP内已经包含七个分包，下载后在本机解压选择所需部分，无须另找构建产物。

The complete frozen candidate is published under its original tag. All six uploaded assets match the frozen bytes. The complete ZIP contains the seven distributions; component hashes in SHA256SUMS apply to those extracted files. Original frozen files and rc.1/rc.2 tags remain unchanged. A real unauthenticated browser loaded the public release, expanded the asset list and downloaded the checksum file with an exact-byte comparison.

## 包与使用路径 / Distributions and usage

| 包 / Package | 使用逻辑 / Usage |
| --- | --- |
| windows-x64-unsigned | 解压运行无边框Workmate；客户本机Codex，权限由客户明确授予 / Local Codex and explicit native permission |
| web | 云端服务配套的Web构建；登录、工作区、角色、任务、交付文件 / Hosted customer Web |
| admin | 独立Admin身份；用户、费用/VIP、用量、内容与权限控制 / Dedicated operator dashboard |
| extension | Chrome开发者模式加载解压目录，点击打开右侧栏；同意后上传所选文件 / Native Side Panel with consented uploads |
| backend | 服务端构建及完整001–155迁移，按说明配置并启动 / Backend distribution and schema155 migrations |
| buildable-sources | 六端完整源码、锁文件、说明和真实媒体 / Six buildable source repositories |
| source-runtime-windows-x64 | 与源码合并的固定Codex及配套文件 / Pinned native runtime companions |

将两个源码/运行文件包解压合并到同一个较短父目录；进入生成的 `dev/copypaste-delivery`，依次运行 `npm run bootstrap:demo`、`npm run demo:check`、`npm run demo`。默认数据库55432若占用，先在每个启动窗口将 `COPYPASTE_SOURCE_DATABASE_PORT` 设置为空闲本机端口。结束执行 `npm run stop`。独立目录和公司API的详细配置见[源码首次启动](../development/158-current-source-startup.md)及[原冻结说明](v0.1.0-rc.2.md)。

Extract and merge the two source/runtime archives under the same short parent, enter generated `dev/copypaste-delivery`, then run the three source-demo commands above. Select a free explicit database port in every launch shell when the default is occupied. Stop with `npm run stop`. The bootstrap installs locked dependencies using native Windows tooling; no Docker/WSL is involved.

```mermaid
flowchart TD
 A[GitHub Release / complete ZIP] --> B[Verify adjacent SHA-256]
 B --> C[Extract seven distributions]
 C --> D[Windows local Codex / explicit permission]
 C --> E[Hosted backend + Web + Admin]
 E --> F[Chrome native Side Panel / consented files]
 C --> G[Merge buildable sources and pinned runtime]
 G --> H[bootstrap:demo → demo:check → demo]
 H --> I[Login → workspace → role/task → private output]
 I --> J[demo stop / owned services only]
```

## 冻结与验收范围 / Freeze and qualification

原包中的HTTP403记录描述冻结时旧凭据的状态，本次使用另一套已有授权凭据完成发布；不回写历史清单，也不移动标签。本轮Git分支另行同步发布工具、实际发布媒体和说明，产品运行逻辑及冻结包不变。当前是模拟外部依赖、Windows未签名候选版；真实公司API、外部平台、签名更新和完整专业/客户综合验收按[原编号清单](../quality/remaining-work-stage159.md)继续保留。

This publication fixes the delivery channel using an existing authorized credential. The old HTTP403 entry is historical. Current branch documentation and publishing tools are a post-freeze supplement; product/runtime bytes in the candidate remain sealed. Synthetic external dependencies and unsigned Windows distribution are explicit. Live providers, signing and full customer/professional acceptance remain separately tracked. Broad repeated regression was omitted at the user's request; Stage158 build/first-task/native-start evidence remains the qualification baseline.

![Actual published assets](../assets/release-publication-159/{image})

![Actual asset expansion and checksum download](../assets/release-publication-159/{gif})

[Actual MP4](../assets/release-publication-159/{mp4}) · [Publication evidence](../quality/release-publication-159.json)
"""
    create(ROOT / "docs/releases/v0.1.0-rc.2-publication.md", supplement)
    create(ROOT / "docs/changes/159-github-release-publication.md", f"""# 159 · GitHub完整发版交付 / Frozen release publication

已解决旧HTTPS凭据造成的发布渠道阻塞，使用现有授权凭据将原冻结 `v0.1.0-rc.2` 发布为GitHub候选Release，上传850,454,316字节完整ZIP及五份校验/清单。六附件逐一匹配GitHub SHA-256；真实公共页面及校验文件下载通过，自建浏览器已关闭。原冻结包、历史证据和所有rc.1/rc.2标签保持；六仓双语README增加下载入口、实际发布截图/GIF/MP4和使用说明。

Published the unchanged candidate and six verified assets using an existing authorized credential. Actual public-page and checksum-download checks passed. All self-created browser resources closed. Frozen files/tags remain intact; bilingual six-repository documentation now includes direct download and actual release media. No application runtime change or broad repeated regression; original full acceptance scopes remain.

[实际Release / Actual release]({URL}) · [交付说明 / Handoff](../releases/v0.1.0-rc.2-publication.md) · [原编号待验收 / Ledger](../quality/remaining-work-stage159.md)
""")
    header = f"""## v0.1.0-rc.2 · 已发布 / Published

[GitHub Release]({URL}) · [完整包 / Complete ZIP]({download}) · [交付 / Handoff](releases/v0.1.0-rc.2-publication.md) · [实际核对 / Evidence](quality/release-publication-159.json) · [原编号验收 / Ledger](quality/remaining-work-stage159.md)

七类分发包已在完整ZIP中交付；六项线上附件SHA-256核对及实际公共下载通过。原冻结文件/标签保持，产品运行逻辑未变。Seven distributions are delivered inside the complete ZIP; all six online assets match frozen hashes and an actual public download passed. Frozen bytes/tags are preserved.

---

"""
    for filename in ["README.md", "README.en.md"]:
        p = ROOT / "docs" / filename
        p.write_text(header + p.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
    print(json.dumps({"status": "recorded", "release": URL, "media": len(media), "requirements": len(ledger["requirements"]), "required_full_acceptance_open": 88}, ensure_ascii=False))


if __name__ == "__main__":
    main()
