"""Bind the actual HTTP races and SQL-backed browser journeys to current sources."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import copy
import json

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"


def digest(p):
    h = sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(4194304), b""):
            h.update(b)
    return h.hexdigest()


def create(p, text):
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("x", encoding="utf-8", newline="\n") as f:
        f.write(text)


def put(p, value):
    create(p, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def main():
    evidence = DELIVERY / "evidence/session-boundary-163"
    q = json.loads((evidence / "qualification-01.json").read_bytes())
    browser = json.loads((evidence / "ui-04.json").read_bytes())
    ui = json.loads((evidence / "ui-qualification-04.json").read_bytes())
    assert q["status"] == browser["status"] == ui["status"] == "passed"
    assert q["source_unchanged"] and ui["source_unchanged"] and ui["owned_services_closed"] and browser["browser_closed"]
    assert len(q["commands"]) == 7 and all(x["exit_code"] == 0 for x in q["commands"])
    assert len(browser["checks"]) == 3 and len(browser["screenshots"]) == 3 and len(browser["recordings"]) == 1
    log = DELIVERY / q["raw_log"]["path"]
    assert digest(log) == q["raw_log"]["sha256"]
    raw = log.read_text(encoding="utf-8")
    assert "# tests 28" in raw and "# pass 28" in raw and "# fail 0" in raw
    assert digest(DELIVERY / q["source_manifest"]["path"]) == q["source_manifest"]["sha256"]
    bound = {"dev/" + p: h for p, h in json.loads((DELIVERY / q["source_manifest"]["path"]).read_bytes()).items()}
    bound.update({"dev/" + p: h for p, h in ui["source_before"].items()})
    for p, h in bound.items():
        assert digest(ROOT / p) == h, p
    assert digest(DELIVERY / ui["private_log"]) == ui["private_log_sha256"]
    media = [*browser["screenshots"], *[x for recording in browser["recordings"] for x in recording["files"]]]
    for row in media:
        source = DEV / row["path"]
        assert digest(source) == row["sha256"]
        for c in ["platform", "web", "admin", "desktop", "extension", "delivery"]:
            target = DEV / ("copypaste-" + c) / "assets/screenshots" / source.name
            if source != target:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("xb") as f:
                    f.write(source.read_bytes())
        target = ROOT / "docs/assets/session-boundary-163" / source.name
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as f:
            f.write(source.read_bytes())
    image = next(Path(x["path"]).name for x in browser["screenshots"] if "revoked-stream" in x["path"])
    gif = next(Path(x["path"]).name for x in media if x["path"].endswith(".gif"))
    mp4 = next(Path(x["path"]).name for x in media if x["path"].endswith(".mp4"))
    now = datetime.now(timezone.utc).isoformat()
    baseline = json.loads((DELIVERY / ".data/session-fence-163/baseline.json").read_bytes())
    prior = ROOT / "docs/quality/remaining-work-stage162.json"
    ledger = copy.deepcopy(json.loads(prior.read_bytes()))
    ledger["schema_version"] += 1
    ledger.update(reviewed_at=now, current_stage=163, previous_review={"path": prior.relative_to(ROOT).as_posix(), "sha256": digest(prior)}, checkpoint="docs/quality/session-boundary-checkpoint-163.json", new_full_acceptance_closures=0, current_increment={"stage": 163, "scope": "Default business401 handling, stale sign-in response fencing and SSE session withdrawal", "broad_regression": "deliberately_omitted_by_user", "full_acceptance_closed": False, "release": "Unfrozen source correction after the published rc.3"})
    assert len(ledger["requirements"]) == 102 and ledger["summary"]["required_open"] == 88
    for row in ledger["requirements"]:
        if row["id"] in ["REQ-003", "REQ-009", "REQ-023", "REQ-024", "REQ-035", "REQ-039", "REQ-083", "REQ-098", "REQ-100"]:
            row["current_review_note"] += " 163：业务请求默认处理当前401，明确公开读取/登录/OAuth链接例外；所有迟到响应按登录代次拒绝，进度流失效清除工作台。28项HTTP/桥接定向检查、三端界面构建及3组实际Web/SQL旅程通过；完整原范围保持。"
    put(ROOT / "docs/quality/remaining-work-stage163.json", ledger)
    lines = ["# 163 · 原编号完整验收 / Original whole acceptance", "", "102个原始编号保持；88项必选完整验收范围开放，不代表88个未实现模块。本轮为登录与进度流源码收口，未覆盖全部生产/专业/安装范围。", "", "| 编号 | 模块 | 状态 | 完整范围待项 |", "| --- | --- | --- | --- |"]
    for row in ledger["requirements"]:
        values = [row["id"], row["module"], row.get("audit_status", row["full_acceptance"]), row.get("current_audit_remaining", row["remaining"])]
        lines.append("| " + " | ".join(str(v).replace("|", "\\|").replace("\n", " ") for v in values) + " |")
    create(ROOT / "docs/quality/remaining-work-stage163.md", "\n".join(lines) + "\n")
    guide = f"""# 163 · 登录失效与旧响应 / Session expiry and old responses

独立的广告文件导入、报告、证据、品牌版本选择和清理记录未被原业务路径清单覆盖，导致401可能只显示请求错误；HTML401可能被当作普通响应格式错误。当前所有业务接口默认按会话保护处理，仅明确的公开内容/角色目录、登录交换及准确的OAuth跳转链接例外。权限不足403保留当前登录。

Web and Desktop renderer requests now protect business routes by default. Explicit public reads, sign-in exchanges and the state-bound OAuth launcher retain their own failure semantics. Every request, including a pending sign-in challenge/verification, checks the captured session generation before accepting its response or changing CSRF state. Admin uses the same unconditional stale-response fence. Writes are never automatically repeated.

进度流在读取每批数据后核对登录代次。真实HTTP401和服务端的登录失效reset清除旧工作台；403只停止该进度视图。旧登录的数据、错误和延迟刷新不能覆盖新登录；关闭视图继续取消其读取。Desktop保留本机Codex和明确授权，Extension保持原生右侧栏及云端执行。

```mermaid
flowchart TD
 A[Request captures current sign-in] --> B[Receive HTTP or progress frame]
 B --> C{{Same current sign-in?}}
 C -->|No| D[Reject old response]
 C -->|Yes| E{{Business401 or session reset?}}
 E -->|Yes| F[Clear old workspace and sign in]
 E -->|No| G[Show result or permission error]
```

使用：从Web登录并使用任务或广告业务；当前会话被撤销后重新登录。旧请求提示登录已变更时重新载入视图；已提交的付费操作应先查收结果，不自动重复。构建命令沿用各仓README：Web/Admin为 `npm run build`，Desktop为 `npm run build`。当前源码已经修复；原rc.3冻结包与标签保持，此源码修复尚未重新冻结进安装包。

Validation:28 Node test results cover real loopback HTTP failures and races, public exceptions, permission403 and a controlled native bridge. Seven build/check commands cover the current Web, Admin and Desktop renderer. Three actual Web journeys use email OTP, native PostgreSQL revocation, a real SSE reset and the independently authenticated dataset-import endpoint. No model requests, production providers, installed Desktop/Extension qualification or broad historical suite.

The first failed expectation used200 instead of the canonical202 challenge response. The next attempt correctly hit the two-per-minute email challenge limit; another preserved attempt observed a concurrent request ending the old session first. The final check uses a separate customer and isolates the target import request without changing rate limits or production policy. Original failed records/media remain intact.

![实际Web撤销登录](../assets/session-boundary-163/{image})

![实际进度流撤销与登录](../assets/session-boundary-163/{gif})

[MP4](../assets/session-boundary-163/{mp4}) · [实际证据](../quality/session-boundary-checkpoint-163.json) · [原编号完整待项](../quality/remaining-work-stage163.md)
"""
    create(ROOT / "docs/development/163-session-boundary.md", guide)
    create(ROOT / "docs/changes/163-session-boundary.md", "# 163 · 登录与进度流收口 / Session boundary correction\n\n业务接口默认处理401并清除旧工作台；准确的公开/登录/OAuth例外保持。Web、Admin及Desktop界面对所有迟到响应检查当前登录代次；SSE登录失效清理、权限403保留。28项定向检查、三端界面构建、3组实际Web/SQL旅程；原失败保留。源码修复在当前分支，既有rc.3安装/冻结包未替换。\n\nDefault business401 handling, unconditional stale-response fences and authenticated progress withdrawal. Explicit public exchanges and permission403 retain their semantics. Original full acceptance scopes remain open.\n")
    cn = f"## 163 · 登录失效、旧响应与实时进度\n\n广告导入、报告、证据等业务接口失去登录时清除旧工作台；旧请求不能覆盖新登录。实时进度收到登录失效时返回登录；权限不足保留登录。28项定向请求检查、三端界面构建及3组实际Web/SQL旅程通过。当前为源码修复，尚未加入既有rc.3安装包；原冻结包保持。\n\n[方案、构建与使用](https://github.com/copypasteltd/workmate/blob/docs/docs/development/163-session-boundary.md) · [原编号待项](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage163.md)\n\n共享的实际Web画面及录制；非本轮新增原生端验收。\n\n![实际登录撤销](assets/screenshots/{image})\n\n![实际进度流到登录](assets/screenshots/{gif})\n\n[MP4](assets/screenshots/{mp4})\n\n---\n\n"
    en = f"## 163 · Current sign-in, old responses and live progress\n\nBusiness401 responses now clear the old workspace; stale responses cannot overwrite a newer sign-in. Progress-session withdrawal returns to sign-in while permission403 retains it.28 focused results, three client-interface builds and three actual Web/SQL journeys pass. This source correction is not inside the sealed rc.3 installers; frozen bytes stay unchanged.\n\n[Implementation, build and usage](https://github.com/copypasteltd/workmate/blob/docs/docs/development/163-session-boundary.md) · [Original remaining scopes](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage163.md)\n\nShared actual Web capture; no new installed-client qualification.\n\n![Actual session withdrawal](assets/screenshots/{image})\n\n![Actual stream-to-sign-in interaction](assets/screenshots/{gif})\n\n[MP4](assets/screenshots/{mp4})\n\n---\n\n"
    for c in ["platform", "web", "admin", "desktop", "extension", "delivery"]:
        for name, prefix in [("README.md", cn), ("README.en.md", en)]:
            p = DEV / ("copypaste-" + c) / name
            p.write_text(prefix + p.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
    header = "## 163 · 登录与进度流 / Sign-in and live progress\n\n[方案和使用](development/163-session-boundary.md) · [证据](quality/session-boundary-checkpoint-163.json) · [原编号待项](quality/remaining-work-stage163.md)\n\n源码修复，未替换rc.3冻结包。Source correction; original frozen distributions remain unchanged.\n\n---\n\n"
    for name in ["README.md", "README.en.md"]:
        p = ROOT / "docs" / name
        p.write_text(header + p.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
    for p in ["docs/tools/record-session-boundary-163-v1.py", "docs/tools/publish-session-boundary-163-v1.py", "docs/development/163-session-boundary.md"]:
        bound[p] = digest(ROOT / p)
    report = {"stage": 163, "at": now, "status": "qualified", "baseline": baseline, "qualified_sources": bound, "qualification": q, "http_test_results": 28, "browser": browser, "browser_qualification": ui, "original_failed_attempts": [{"journey": json.loads((evidence / ("ui-0" + str(i) + ".json")).read_bytes()), "qualification": json.loads((evidence / ("ui-qualification-0" + str(i) + ".json")).read_bytes())} for i in [1, 2, 3]], "new_full_acceptance_closures": 0, "mandatory_full_acceptance_open": 88, "frozen_release_changed": False, "scope": "Actual browser/SQL session withdrawal and three source-interface builds only. Synthetic business records, no models, no installed Desktop/Extension or whole-product acceptance."}
    put(ROOT / "docs/quality/session-boundary-checkpoint-163.json", report)
    create(ROOT / "docs/quality/session-boundary-checkpoint-163.md", "# 163 · 登录收口定向证据 / Focused session qualification\n\n28项定向测试结果、7项构建/检查命令、3组实际Web/SQL旅程通过。真实SSE撤销在没有其他401请求时清除旧工作台；独立广告导入路径在隔离其他后台请求后单独触发真实401。所有自建浏览器/API/原生数据库退出；模型调用为零。原三次检查失败及媒体均保留。\n\n[机器证据](session-boundary-checkpoint-163.json) · [方案及实际媒体](../development/163-session-boundary.md) · [完整原编号待项](remaining-work-stage163.md)\n")
    print(json.dumps({"status": "recorded", "http_test_results": 28, "actual_browser_journeys": 3, "media": len(media), "mandatory_full_scopes_open": 88}))


if __name__ == "__main__":
    main()
