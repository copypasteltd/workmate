"""Bind the post-freeze Admin correction to actual focused qualification."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import copy
import json

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"


def digest(p):
    return sha256(p.read_bytes()).hexdigest()


def create(p, text):
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("x", encoding="utf-8", newline="\n") as f:
        f.write(text)


def put(p, obj):
    create(p, json.dumps(obj, ensure_ascii=False, indent=2) + "\n")


def main():
    evidence = DELIVERY / "evidence/admin-overview-160"
    qualification = json.loads((evidence / "qualification-04.json").read_bytes())
    browser = json.loads((evidence / "ui-01.json").read_bytes())
    assert qualification["status"] == "passed" and qualification["owned_services_closed"]
    assert browser["status"] == "passed" and browser["browser_closed"] and len(browser["checks"]) == 3
    assert len(qualification["checks"]) == 4
    logs = DELIVERY / qualification["log_directory"] / "commands.log"
    assert digest(logs) == qualification["log_sha256"]
    raw = logs.read_text(encoding="utf-8", errors="replace")
    assert "# tests 9" in raw and "# pass 9" in raw and "# fail 0" in raw
    assert "# owned_fixture_cleanup" in raw and '"exit_code":0' in raw
    # Retain the original native log privately, and publish its digest plus the
    # actual TAP result. The private UI fixture contains test sign-in material.
    first = raw.index("TAP version 13")
    last = raw.index("# owned_fixture_cleanup", first)
    tail = raw.index("\n", last)
    tap = raw[first:tail + 1]
    assert "postgresql://" not in tap and "enrollment_token" not in tap and "totp_secret" not in tap
    create(evidence / "backend-04.tap", tap)
    sources = [
        "copypaste-platform/src/admin.ts", "copypaste-platform/src/admin-overview.ts",
        "copypaste-platform/src/admin-directory.ts", "copypaste-platform/src/admin-access.ts",
        "copypaste-platform/src/billing.ts", "copypaste-platform/src/db.ts",
        "copypaste-admin/src/main.tsx", "copypaste-admin/src/ui.tsx", "copypaste-admin/src/api.ts",
        "copypaste-platform/tests/admin-overview-160-v2.test.ts",
        "copypaste-platform/tests/admin-overview-fixture-160-v2.ts",
        "copypaste-platform/scripts/serve-admin-overview-160-v1.ts",
        "copypaste-delivery/scripts/qa-admin-overview-160-v1.ts",
        "copypaste-delivery/scripts/qualify-admin-overview-160-v4.mjs",
    ]
    bound = {name: digest(DEV / name) for name in sources}
    baseline = json.loads((DELIVERY / ".data/admin-overview-160/baseline.json").read_bytes())
    media = [*browser["screenshots"], *[f for r in browser["recordings"] for f in r["files"]]]
    assert len(media) == 6
    names = []
    for item in media:
        source = DEV / item["path"]
        assert digest(source) == item["sha256"]
        names.append(source.name)
        for component in ["platform", "web", "admin", "desktop", "extension", "delivery"]:
            target = DEV / ("copypaste-" + component) / "assets/screenshots" / source.name
            if target != source:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("xb") as f:
                    f.write(source.read_bytes())
        target = ROOT / "docs/assets/admin-overview-160" / source.name
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as f:
            f.write(source.read_bytes())
    image = next(n for n in names if n.endswith("-confirmed-charges-personal-hold.png"))
    gif = next(n for n in names if n.endswith(".gif"))
    mp4 = next(n for n in names if n.endswith(".mp4"))
    link = "https://github.com/copypasteltd/workmate/blob/docs/docs/development/160-admin-overview-accuracy.md"
    cn = f"""## 160 · 管理總覽的用戶、費用與目前權限

用戶數沿用完整用戶目錄的可見範圍；預留額度包含目前模式的個人與企業付款帳戶。累計確認扣費以帳本為準，包含任務及雲端資源，不混入充值、贈送、退款或未結算預留。每次請求在權限鎖後重驗目前MFA會話與權限；無權限或暫不可用的數字顯示破折號，可使用「重新載入總覽」恢復。

9項真實SQL/HTTP定向檢查、3組實際Admin操作通過；使用明確合成的客戶和費用資料，沒有模型請求或真正啟動雲端電腦。原失敗及檢查環境修正保持原紀錄。這是未凍結的後端/Admin原始碼修復；既有v0.1.0-rc.2包和標籤不變，其他端本輪同步說明及共用Admin媒體。

[方案及使用 / Implementation and usage]({link}) · [編號待驗收 / Remaining](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage160.md)

**實際Admin畫面；非各原生端新增驗收 / Actual Admin, not new native-client qualification**

![Authorized overview](assets/screenshots/{image})

![Actual permission change and bilingual interaction](assets/screenshots/{gif})

[MP4](assets/screenshots/{mp4})

---

"""
    en = f"""## 160 · Accurate Admin overview and current authority

User counts follow the authorized directory. Reserved credit includes readable personal and enterprise accounts in the current mode. Confirmed customer charges come from the ledger and include task and cloud resource charges; funding, gifts, refunds and unresolved holds remain separate. The access lock protects a fresh check of the exact current MFA session and bindings. Unauthorized or unavailable figures show dashes, with a visible Refresh overview control.

Nine focused real SQL/HTTP cases and three actual Admin journeys pass. Customer/accounting facts are explicitly synthetic; there are no model requests or actual cloud computers. Original failures are retained. This is an unfrozen backend/Admin source correction after v0.1.0-rc.2; frozen packages/tags stay intact. Other components receive documentation and explicitly shared Admin media only.

[Implementation and usage]({link}) · [Original full-scope ledger](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage160.md)

**Actual Admin only; no new installed Desktop or Extension acceptance**

![Authorized overview](assets/screenshots/{image})

![Actual permission change and bilingual interaction](assets/screenshots/{gif})

[Actual MP4](assets/screenshots/{mp4})

---

"""
    for component in ["platform", "web", "admin", "desktop", "extension", "delivery"]:
        for name, prefix in [("README.md", cn), ("README.en.md", en)]:
            p = DEV / ("copypaste-" + component) / name
            p.write_text(prefix + p.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
    now = datetime.now(timezone.utc).isoformat()
    prior = ROOT / "docs/quality/remaining-work-stage159.json"
    ledger = copy.deepcopy(json.loads(prior.read_bytes()))
    ledger["schema_version"] += 1
    ledger.update(reviewed_at=now, current_stage=160, previous_review={"path": "docs/quality/remaining-work-stage159.json", "sha256": digest(prior)}, checkpoint="docs/quality/admin-overview-checkpoint-160.json", new_full_acceptance_closures=0,
        current_increment={"stage": 160, "scope": "Admin overview current authority, directory-consistent user count, personal and enterprise holds, ledger task/resource charges and unavailable-state recovery", "broad_regression": "deliberately_omitted_by_user", "full_acceptance_closed": False, "release": "unfrozen source correction after v0.1.0-rc.2"})
    for row in ledger["requirements"]:
        if row["id"] in ["REQ-048", "REQ-084", "REQ-086", "REQ-094", "REQ-098", "REQ-100"]:
            row["current_review_note"] += " 160：管理總覽與現行目錄/付款帳戶權限統一，補個人預留及任務/雲端資源帳本確認扣費；鎖等待後重驗會話與權限，單SQL快照，錯誤清除舊值並可手動恢復。9項實際SQL/HTTP及3組真實Admin操作，4PNG/1GIF/1MP4；合成資料，無模型及實機雲端電腦。完整原範圍不縮減。"
    put(ROOT / "docs/quality/remaining-work-stage160.json", ledger)
    lines = ["# 160 · 原編號完整驗收 / Original full acceptance", "", "本輪9項定向SQL/HTTP與3組實際Admin操作；未重跑完整歷史/生產矩陣。102個原始編號保持，88項必選完整驗收範圍仍開放，並非88個未開發模組。", "", "| 編號 | 模組 | 狀態 | 原範圍剩餘 |", "| --- | --- | --- | --- |"]
    for row in ledger["requirements"]:
        cells = [row["id"], row["module"], row.get("audit_status", row["full_acceptance"]), row.get("current_audit_remaining", row["remaining"])]
        lines.append("| " + " | ".join(str(c).replace("|", "\\|").replace("\n", " ") for c in cells) + " |")
    create(ROOT / "docs/quality/remaining-work-stage160.md", "\n".join(lines) + "\n")
    report = {"stage": 160, "at": now, "status": "qualified", "schema_version": 155, "qualified_sources": bound, "baseline": baseline, "backend_cases": 9, "actual_admin_journeys": 3, "qualification": qualification, "browser": browser, "prior_attempts": [json.loads((evidence / ("qualification-0" + str(i) + ".json")).read_bytes()) for i in [1, 2, 3]], "backend_tap_sha256": digest(evidence / "backend-04.tap"), "admin_build": {"command": "npm run build", "exit_code": 0, "basis": "Current-turn observed build result before browser qualification; Admin runtime source unchanged afterward", "source_sha256": bound["copypaste-admin/src/main.tsx"], "artifacts": {p.relative_to(DEV).as_posix(): digest(p) for p in sorted((DEV / "copypaste-admin/dist").glob("assets/*")) if p.is_file()}}, "recorder_sha256": digest(Path(__file__)), "new_full_acceptance_closures": 0, "mandatory_full_acceptance_open": 88, "frozen_release_changed": False, "scope": "Unfrozen backend/Admin source correction; synthetic business facts and cloud protocol acknowledgements, no model or physical cloud execution, no new Desktop/Extension acceptance"}
    put(ROOT / "docs/quality/admin-overview-checkpoint-160.json", report)
    create(ROOT / "docs/quality/admin-overview-checkpoint-160.md", "# 160 · 管理總覽定向核對 / Focused overview qualification\n\n9/9實際SQL/HTTP與3組實際Admin旅程通過，4PNG、1GIF/MP4；自建瀏覽器和原生服務已關閉。原始三次失敗保留（檢查程式的型別、Windows原生路徑入口、超過實際經過時間的合成雲端回執）；最後使用有界1ms協議回執，未弱化生產限制。\n\n完整生產/真實提供方/專業品質仍按原編號範圍。原v0.1.0-rc.2凍結包與標籤保持。本輪只有後端/Admin執行碼修正，其他端同步說明及實際Admin媒體。\n")
    create(ROOT / "docs/requirements/25-admin-overview-accuracy.md", """# 管理總覽的數字和權限 / Admin overview accuracy

承接完整用戶、用量、費用與後台細粒度權限的既有要求。總覽的用戶數必須與目前可讀用戶目錄一致，包含僅獲專案範圍的管理員，且明確拒絕不被全域允許繞過。金額採目前運行模式，個人及企業付款帳戶的預留均依現行帳戶權限計入。確認扣費由不可變charge帳本彙總，含任務與雲端資源，充值/贈送/退款及未結算預留另列。

Aggregate user counts must match the currently readable directory. Current-mode holds include readable personal and enterprise payers. Immutable customer charge entries include task and cloud-resource usage. Funding, gifts, refunds and unsettled holds are separate facts. Recheck the exact current MFA session and bindings after the access lock. Unauthorized fields are null; an unavailable request must clear old figures and show dashes, with a visible recovery action. All original whole-product acceptance conditions remain.
""")
    create(ROOT / "docs/development/160-admin-overview-accuracy.md", f"""# 160 · 管理總覽的準確數字 / Accurate Admin overview

舊總覽對全域用戶允許直接計全平台人數，未套明確企業拒絕；只授專案的人數又可能漏算。預留只查企業wallet，遺漏個人付款帳戶；扣費只加tasks欄位，漏掉沒有普通task的雲端資源。頁面在請求失敗、data不存在時又可能將金額格式化成零。此修復沿用既有目錄與付款帳戶的ReadScope，回應原有summary/activity結構不變，無資料庫遷移。

The former aggregate path differed from the canonical user/account scopes, omitted personal holds and resource charges, and could render unavailable money as zero. The corrected endpoint reuses the same ReadScope, retains its response shape and schema155, and executes all numeric subqueries in one database statement. Current MFA/session authority is checked after the shared access lock; field grants remain independent. Directory identities retain their existing scope; task and monetary figures use the current simulated/configured mode.

| 數字 / Figure | 來源與範圍 / Source and scope |
| --- | --- |
| users | 完整用戶目錄的可讀主體，去重；無users.read為null |
| tenants | overview.read的企業或專案可見企業 |
| tasks / reconciling | 目前模式及usage.read / execution.read的專案任務 |
| charged_micros | 目前模式的charge帳本；按任務/雲端會話的執行企業及專案套usage.read，非充值或退款淨額 |
| reserved_micros | 目前模式、billing.read可完整閱讀的個人/企業wallet；專案拒絕不洩漏整體餘額 |

```mermaid
flowchart TD
 A[Admin email OTP and MFA] --> B[Overview / current exact session and bindings]
 B --> C[Authorized directory counts]
 B --> D[Current-mode charge facts and payer holds]
 C --> E[One consistent numeric snapshot]
 D --> E
 E --> F[Visible figures or unauthorized dashes]
 F --> G[Refresh after changes or request failure]
 G --> B
```

使用：登入獨立Admin，查看總覽；確認扣費說明位於卡片下方。「重新載入總覽」重新請求現行數字。缺少欄位權限或連線失敗時顯示破折號，避免把未取得資料當作零。英文及繁中均可用。總覽使用與詳細資料相同的近期MFA規則；MFA過期須重新登入。

Nine real SQL/HTTP checks cover identity/strict queries, denied and project-only directory counts, real personal/enterprise holds and settlements, mode isolation, real control-plane cloud charge facts, field denial and two actual lock-wait revocation races. Three actual browser journeys cover MFA login, network failure/recovery, current field revocation and language switching. Synthetic node acknowledgements do not start or qualify a physical cloud computer. Broad regression is intentionally omitted; full original scopes stay open. This source correction is not inside the sealed v0.1.0-rc.2 ZIP.

![Actual Admin figures](../assets/admin-overview-160/{image})

![Actual permission and bilingual interaction](../assets/admin-overview-160/{gif})

[MP4](../assets/admin-overview-160/{mp4}) · [Evidence](../quality/admin-overview-checkpoint-160.json) · [Remaining full scopes](../quality/remaining-work-stage160.md)
""")
    create(ROOT / "docs/changes/160-admin-overview-accuracy.md", "# 160 · Admin總覽修復 / Admin overview correction\n\n統一總覽與目錄/費用頁的現行權限，修復用戶人數、個人預留及無普通任務的雲端資源扣費漏算。所有數字由單一SQL快照讀取，權限鎖後重驗會話；錯誤時清除舊值並顯示破折號，增加明確刷新與扣費口徑。\n\nUnifies current directory/account scopes and includes personal holds and resource charge facts. Exact-session revalidation, one numeric snapshot and explicit unavailable/recovery states prevent misleading figures.9 SQL/HTTP cases and3 actual Admin journeys; original failures and whole scopes remain. Unfrozen source correction; rc.2 artifacts and tags stay unchanged.\n")
    header = "## 160 · Admin總覽數字與目前權限 / Accurate current Admin overview\n\n[需求](requirements/25-admin-overview-accuracy.md) · [方案 / Usage](development/160-admin-overview-accuracy.md) · [實際核對](quality/admin-overview-checkpoint-160.json) · [原編號範圍](quality/remaining-work-stage160.md)\n\n未凍結後端/Admin原始碼修復；v0.1.0-rc.2包與標籤保持。Unfrozen backend/Admin source correction; sealed release artifacts and tags are unchanged.\n\n---\n\n"
    for name in ["README.md", "README.en.md"]:
        p = ROOT / "docs" / name
        p.write_text(header + p.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
    print(json.dumps({"status": "recorded", "backend_cases": 9, "admin_journeys": 3, "media": len(media), "required_full_scopes_open": 88}))


if __name__ == "__main__":
    main()
