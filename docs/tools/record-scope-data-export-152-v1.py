"""Record the bounded authorized-export increment; preserve the first frozen release."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json, re, sys, zipfile

ROOT = Path(r"D:\dev\copypasted\自有agent")
DEV = ROOT / "dev"
D = DEV / "copypaste-delivery"
E = D / "evidence/scope-data-export-152"
backend_attempt, build_attempt, ui_attempt = sys.argv[1:]
assert all(re.fullmatch(r"\d{2}", v) for v in [backend_attempt, build_attempt, ui_attempt])

def digest(p):
    h = sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(4 * 1024 * 1024), b""): h.update(b)
    return h.hexdigest()

def read(p): return json.loads(p.read_bytes())
def put(p, content):
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("x", encoding="utf-8", newline="\n") as f: f.write(content)
def ref(p): return {"path": p.relative_to(ROOT).as_posix(), "sha256": digest(p)}
def copy(a, b):
    b.parent.mkdir(parents=True, exist_ok=True)
    with b.open("xb") as f: f.write(a.read_bytes())
    assert digest(a) == digest(b)
    return ref(b)

baseline = read(D / ".data/scope-export-152/baseline.json")
for name, expected in {**baseline["frozen_files"], **baseline["preserved_user_files"]}.items(): assert digest(ROOT / name) == expected, name
assert digest(DEV / "copypaste-desktop/.gitattributes") == baseline["desktop_attributes_sha256"]
release = D / "release/workmate-v0.1.0-rc.1"
for item in read(release / "release-manifest.json")["artifacts"]: assert digest(release / item["file"]) == item["sha256"]

sources, reports = {}, {}
for name in ["backend-" + backend_attempt, "build-" + build_attempt, "ui-" + ui_attempt]:
    result = read(E / (name + ".json"))
    assert result["status"] == "passed" and result["source_unchanged"], name
    for key in ["source_manifest", "raw_report", "verifier"]: assert digest(D / result[key]["path"]) == result[key]["sha256"]
    for file, item in read(D / result["source_manifest"]["path"]).items():
        assert digest(DEV / file) == item["sha256"], file
        assert digest(D / item["path"]) == item["sha256"]
        assert sources.setdefault(file, item["sha256"]) == item["sha256"]
    if not name.startswith("build-"):
        assert result["owned_database_shutdown"] and result["result_exit_code"] == 0
        assert result["fixture_cleanup"]["status"] == "passed" and result["fixture_cleanup"]["exit_code"] == 0
    reports[name] = ref(E / (name + ".json"))
raw = (E / ("backend-" + backend_attempt + ".tap")).read_text("utf-8")
for label, n in [("tests", 9), ("pass", 9), ("fail", 0), ("skipped", 0)]: assert re.search(r"^# " + label + " " + str(n) + r"\s*$", raw, re.M)
build = read(E / ("build-" + build_attempt + ".json"))
assert len(build["commands"]) == 8 and all(c["exit_code"] == 0 for c in build["commands"])
for file, expected in build["package_files"].items(): assert digest(Path(build["package_root"]) / file) == expected
journey = read(E / ("ui-" + ui_attempt + "-journey.json"))
assert journey["status"] == "passed" and len(journey["checks"]) == 6 and not journey["errors"]
assert all(journey[k] for k in ["browser_closed", "desktop_closed", "api_closed", "fixture_closed"])
assert len(journey["screenshots"]) == 6 and len(journey["recordings"]) == 3 and len(journey["downloads"]) == 3
for item in journey["downloads"]: assert digest(D / item["file"]) == item["sha256"]
with zipfile.ZipFile(D / journey["downloads"][0]["file"]) as archive:
    manifest = json.loads(archive.read("manifest.json"))
    category_names = [c["name"] for c in manifest["categories"]]
media = list(journey["screenshots"])
for recording in journey["recordings"]:
    assert recording["distinct_frames"] >= 2 and recording["skipped_capture_errors"] == 0
    media.extend(recording["files"])
copies = []
for item in media:
    source = DEV / item["path"]; assert digest(source) == item["sha256"]
    copies.append(copy(source, ROOT / "docs/assets/scope-data-export-152" / (source.parent.parent.parent.name + "__" + source.name)))
illustrations = [i for i in media if i["path"].startswith("copypaste-web/") and i["path"].endswith(("project-saved-en.png", ".gif", ".mp4"))]
for repo in ["platform", "extension", "delivery"]:
    for item in illustrations: copies.append(copy(DEV / item["path"], DEV / ("copypaste-" + repo) / "assets/screenshots" / Path(item["path"]).name))

scope = "Complete authorized project/workspace business exports with explicit projections, exact retained originals, source/history fences, shared-only scoped MFA Admin, temporary disk streaming and three actual client download journeys. Full production/backup/cross-OS acceptance remains open."
checkpoint = {"at": datetime.now(timezone.utc).isoformat(), "status": "verified_scope_data_export_increment", "stage": 152, "schema_version": 149,
    "release": "unreleased_after_v0.1.0-rc.1", "frozen_release_unchanged": True, "baseline": baseline,
    "backend_cases": 9, "actual_journey_groups": 6, "native_surface_boundary_cases": 12, "category_count": len(category_names),
    "broad_regression": "deliberately_omitted_by_user", "model_mode": "synthetic_no_model_request", "new_full_acceptance_closures": 0,
    "source_files": sources, "reports": reports, "media": media, "shared_media_copies": copies,
    "package_root": build["package_root"], "package_files": build["package_files"], "scope": scope, "recorder_sha256": digest(Path(__file__))}
put(ROOT / "docs/quality/scope-data-export-checkpoint-152.json", json.dumps(checkpoint, ensure_ascii=False, indent=2) + "\n")
ledger = read(ROOT / "docs/quality/remaining-work-stage151.json")
ledger.update(schema_version=ledger["schema_version"] + 1, current_stage=152, reviewed_at=checkpoint["at"], checkpoint="docs/quality/scope-data-export-checkpoint-152.json", previous_review=ref(ROOT / "docs/quality/remaining-work-stage151.json"), new_full_acceptance_closures=0)
ledger["current_increment"] = {"stage": 152, "scope": scope, "backend_cases": 9, "actual_client_journey_groups": 6, "broad_regression": "deliberately_omitted_by_user", "full_acceptance_closed": False, "release": checkpoint["release"]}
for row in ledger["requirements"]:
    if row["id"] == "REQ-049":
        row["implemented_scope"] += "；152補齊專案/企業完整可讀業務導出、原始CSV、全部可用檔案版本、記憶/會話歷史、同快照來源邊界、Admin共享範圍匯出與三端下載。"
        row["current_audit_remaining"] = "項目/企業整刪、歸檔恢復、備份輪換及完整授權範圍導出已實現；全部衍生資料/外部供應方副本、正式大容量/跨OS及生產備份恢復、保留期限實證驗收仍開放。本機已下載副本不屬雲端刪除範圍。"
        row["current_review_note"] += " 152：9項真實SQL/HTTP定向檢查、6組實際Web/Desktop/Admin下載、6張PNG/3組GIF與MP4及8步三端構建通過；獨立只讀反證後修正工作流歷史父來源、固定輸出與逾時清理。並非全生產矩陣驗收。"
assert len(ledger["requirements"]) == 102 and ledger["summary"]["required_open"] == 88
put(ROOT / "docs/quality/remaining-work-stage152.json", json.dumps(ledger, ensure_ascii=False, indent=2) + "\n")
lines = ["# 当前完整待项 / Remaining whole acceptance — Stage152", "", "152已补齐完整授权范围导出。88项指必需完整验收范围，不能解释为88个未实现模块。", "", "| 编号 | 模块 | 完整验收 | 仍待完成 |", "|---|---|---|---|"]
for row in ledger["requirements"]: lines.append("| " + " | ".join(str(v).replace("|", "\\|").replace("\n", " ") for v in [row["id"], row["module"], row["full_acceptance"], row.get("current_audit_remaining", row["remaining"])]) + " |")
put(ROOT / "docs/quality/remaining-work-stage152.md", "\n".join(lines) + "\n")

diagram = """```mermaid
flowchart LR
 A[Current sign-in and scope] --> B[Preview readable records and fixed originals]
 B --> C[Confirm exact preview]
 C --> D[Same-snapshot source and private access checks]
 D --> E[Disk-streamed ZIP64 and per-file checksums]
 E --> F[Recheck current scope and selection]
 F --> G[Browser or native streamed save]
 G --> H[Close stream and remove temporary archive]
```"""
guide = """# 完整範圍資料匯出 / Complete authorized scope export

增量152已實現並定向驗證；首個凍結版v0.1.0-rc.1的原標籤與五個ZIP保持原樣。本增量不在該凍結包內。

Web/Desktop：「專案」→「匯出資料」→核對預覽→確認保管副本→下載。企業owner/admin可用「預覽企業匯出」一次打包使用中專案及本人可讀私人資料。封存專案先恢復；企業匯出列出排除的封存專案。單一專案包明確排除企業/個人全局記憶，企業包則各包含一次。project viewer可讀自己的授權專案包，不能執行整企業匯出。

Web/Desktop: Projects → Export data → review the preview → acknowledge custody → download. A current workspace owner/admin can export all readable active projects and their own private data. Archived projects must be restored first. Project exports omit global workspace/personal memories; workspace exports include them once. Project viewers can export readable project content; workspace management never grants another member's private content.

Admin：「內容」→「範圍共享資料匯出」→選企業/專案及其ID→預覽→確認→下載。要求admin.exports.create、admin.content.body.read與10分鐘內MFA；企業操作逐一核對專案拒絕。私人會話、私人原始檔及私人工程不冒用客戶導出。權限不足、撤權或永久刪除標記立即阻止新的下載。

Admin: Content → Export shared scope data → choose project/workspace ID → preview → acknowledge → download. Both scoped export and body-read permissions and recent MFA are mandatory; overlapping project denies also block workspace selection. Customer-private content must be exported by the customer. This does not impersonate a customer or transfer their local OS permissions.

ZIP包含manifest.json、SHA256SUMS、中英README、data/*.ndjson及files/<project>/<asset>/v<version>/<original-name>。原始CSV直接導入也保留raw_csv、口徑及摘要；每個可用檔案歷史版本逐一打包原始位元組。會話、任務/事件、分層記憶及版本、品牌、Agent/技能、雲端目錄、設計/影片/矢量/簡報工程、分析/SEO/GEO、工作流/例行/事件、團隊及方案均用明確欄位清單。共享操作記錄不等於全庫備份。沒有自動還原工具。

The ZIP contains a manifest, independent SHA-256 checksums, a bilingual guide, UTF-8 NDJSON categories and exact retained original files. Int64 counters, file sizes and monetary micros use decimal strings. The manifest lists every category, selected project, fixed original/version and explicit exclusion. Credentials, internal storage locations, security/execution logs, backups, withdrawn/deleted/expired sources and unsubmitted local files are excluded. Customer-authored business prose stays business data. Exporting makes no model request and no additional AI charge.

以cp_app RLS讀取客戶資料；控制表保留既有DTO/本人範圍，不增加資料庫授權。受控權限連線匯出PostgreSQL snapshot，資料連線在repeatable-read導入同一快照。一般任務來源、報告/SEO、修訂來源及工作流固定輸入/輸出使用既有讀取檢查；父工程與逐版本來源約束同時保護子表，管理端不能藉缺少private_owner的子表讀到私人正文。預覽摘要綁定帳戶/範圍/整個選擇；打包後再核對，資料改變明確要求刷新，毀損物件不回傳ZIP。

Customer reads retain existing RLS. Control-only publication/feedback data uses explicit public DTOs and ownership rules. Both connections share one exported PostgreSQL snapshot. Source readers include report/revision provenance and fixed workflow outputs; revoked workflow origins also hide retained definitions. Packaging verifies every object's length and hash, then rechecks current authority and the full selection before serving bytes. Completed/aborted/timed-out streams close and remove temporary files; later cloud deletion cannot remove copies already saved by a customer.

每包上限16GiB原始二進位、10,000檔案版本、每類100,000筆、64MiB文字。兩個全局打包槽、每帳戶一個，五分鐘上限延伸到回應流；容量不足明確失敗，不靜默截斷。Desktop經主進程受限下載IPC、原生目的地與串流校驗；支援的瀏覽器使用File System Access串流，其他瀏覽器只允許64MiB以內的完整包。沒有把所有原始檔讀進一個Blob。

Limits are explicit:16GiB original binary data,10,000 versions,100,000 records per category,64MiB metadata,2 global exports,1 per actor and a5-minute timeout through response streaming. Large exports use the native Desktop save path or a supporting browser's file writer. The unsupported-browser fallback refuses archives above64MiB. Exceeding capacity returns an explicit error and suggests exporting individual projects.

必要驗證：9項真實SQL/HTTP、6組實際三端下載、8步三端構建與12項本機/雲端邊界。6張PNG、3組GIF/MP4、三個實際下載ZIP逐一核對原始版本與SHA。Web/Admin使用產品既有的小包fallback（測試中明確停用File System Access能力）；Desktop只固定OS儲存目的地，登入、IPC、HTTP、SQL、原始物件、ZIP與畫面均實際執行。大型File System Access/16GiB/逾時慢接收實機矩陣、跨OS、生產供應方及廣泛歷史回歸按快速發版要求省略。

Nine targeted backend cases and six actual client journey groups passed. The browser capability and native OS destination are controlled test inputs; responses, authentication, original files and archives are not mocked. No live model is invoked. All created windows, browsers, API and disposable native databases are closed. backend01 preserves the original missing-column and fixture failure; backend03 preserves two fixture assumptions; backend04/ui02 passed before the final history fence, and backend05/ui03 qualify the final code. All executed verifiers/results remain unchanged. This is functional completion of authorized export, not full production or whole-product acceptance.

[需求 / Requirements](../requirements/18-scope-data-export.md) · [API](../contracts/scope-data-export-openapi.json) · [完整待項 / Ledger](../quality/remaining-work-stage152.md) · [首個凍結版 / Frozen release](../releases/v0.1.0-rc.1.md)

""" + diagram + "\n\n實際匯出類別 / Actual manifest categories: " + ", ".join(category_names) + ".\n"
for item in journey["screenshots"]:
    if "preview" in item["path"]:
        source = DEV / item["path"]
        guide += "\n![Actual export preview](../assets/scope-data-export-152/" + source.parent.parent.parent.name + "__" + source.name + ")\n"
put(ROOT / "docs/development/152-scope-data-export.md", guide)
put(ROOT / "docs/changes/152-scope-data-export.md", "# Stage152 更新 / Changes\n\n| 编号 | 事项 | 状态 |\n|---|---|---|\n| 1 | 项目/企业完整可读资料、原始CSV和全部可用文件版本导出 | 已实现 |\n| 2 | 用户隐私、来源/历史版本、当前权限及后台MFA控制 | 9项后端通过 |\n| 3 | Web/Desktop/Admin预览、确认与真实下载 | 6组通过，截图/GIF/MP4齐备 |\n| 4 | 中英README、流程图、API及完整待项 | 已同步 |\n| 5 | 首个冻结v0.1.0-rc.1及其五个ZIP | 保留原样 |\n| 6 | 正式模型/媒体/广告、签名更新、跨OS及完整生产矩阵 | 待完成 |\n\n[实现细则 / Implementation](../development/152-scope-data-export.md) · [完整待项 / Whole ledger](../quality/remaining-work-stage152.md)\n")

contract = {"openapi": "3.1.0", "info": {"title": "Workmate authorized scope data export", "version": "152"}, "paths": {},
    "x-manifest-format": "workmate-scope-export-1", "x-export-categories": category_names, "x-limits": manifest["limits"],
    "x-authorization": "Project read or workspace manage; current session/membership/source/erasure fences. Admin: scoped admin.exports.create + admin.content.body.read, fresh MFA, all overlapping project denies; shared content only.",
    "x-preview": "snapshot SHA-256, name, tenant_id, project_id, audience, categories with record/byte counts, versions, binary_bytes, text_bytes, selected/archived projects, exclusions and limits; no raw content or storage keys."}
for base in ["/v1/tenants/{tenant}", "/v1/tenants/{tenant}/projects/{project}", "/v1/admin/scopes/{kind}/{id}"]:
    for suffix in ["preview", "package"]:
        parameters = [{"name": n, "in": "path", "required": True, "schema": {"type": "string", **({"enum": ["projects", "tenants"]} if n == "kind" else {"format": "uuid"})}} for n in re.findall(r"\{([^}]+)\}", base)]
        if suffix == "package": parameters += [{"name": "expected_snapshot", "in": "query", "required": True, "schema": {"type": "string", "pattern": "^[a-f0-9]{64}$"}}, {"name": "acknowledge", "in": "query", "required": True, "schema": {"type": "string", "const": "true"}}]
        responses = {str(c): {"description": description} for c, description in [(200, "Authorized preview JSON" if suffix == "preview" else "Verified ZIP with Content-Length and X-Content-SHA256"), (400, "Invalid parameters or mismatched tenant header"), (401, "Current sign-in required"), (403, "Permission, scope deny or recent MFA required"), (404, "Unavailable or unauthorized scope (including archived customer project)"), (409, "Changed selection, archived admin scope or changing source"), (413, "Explicit complete export capacity exceeded; no truncation"), (429, "Export concurrency or rate capacity"), (503, "Temporary disk unavailable") ]}
        contract["paths"][base + "/export-" + suffix] = {"get": {"summary": "Preview readable scope" if suffix == "preview" else "Save the acknowledged exact readable scope", "parameters": parameters, "responses": responses}}
text = json.dumps(contract, ensure_ascii=False, indent=2) + "\n"
put(ROOT / "docs/contracts/scope-data-export-openapi.json", text)
put(DEV / "copypaste-platform/contracts/scope-data-export-openapi.json", text)

for repo in ["platform", "web", "admin", "desktop", "extension", "delivery"]:
    for name in ["README.md", "README.en.md"]:
        english = name.endswith("en.md"); p = DEV / ("copypaste-" + repo) / name; old = p.read_text("utf-8"); assert "<!-- scope-data-export-152 -->" not in old
        intro = ("**Unreleased increment152: complete authorized data export**\n\nWeb/Desktop: Projects → Export data → preview → acknowledge → save. Owners/admins can export their active workspace; another member's private records remain inaccessible. Admin Content exports shared project/workspace data with both body-read/export permissions and recent MFA. Original CSV, exact file/history versions, business records and memory/conversation history are listed in a checksum manifest. Retained workflow definitions and outputs obey the same current source boundaries as ordinary readers. Credentials and internal locations are excluded.\n\n9 targeted backend cases,6 actual client download groups,8 build steps and12 native-surface boundaries passed.6 PNGs and3 GIF/MP4 pairs are retained. Browser fallback capability and native OS save destination are explicit fixture inputs; actual auth, SQL, HTTP and original ZIP bytes were verified. Large browser-file streaming,16GiB load, cross-OS, production and broad historical regression were omitted for release speed; no model request. Frozen v0.1.0-rc.1 remains unchanged and does not contain this increment.\n\n" if english else "**未凍結增量152：完整授權資料匯出**\n\nWeb/Desktop：「專案」→「匯出資料」→核對預覽→確認→下載；企業owner/admin可匯出使用中專案與本人私人資料。管理企業不代表可讀其他成員私人正文。Admin在內容管理依範圍、正文/匯出權限和近期MFA匯出共享資料。原始CSV、全部可用檔案歷史版本、業務資料、會話及記憶歷史列入清單和SHA256SUMS；工作流歷史與固定輸出沿用當前來源限制。沒有匯出憑據、內部儲存位置、備份或未上傳本機檔案。\n\n9項後端、6組真實三端下載、8步構建及12項本機邊界檢查通過，6張PNG、3組GIF/MP4保留。瀏覽器fallback能力及原生OS目的地是明確測試輸入；登入、SQL、HTTP、原始物件及ZIP真實核對。按快速發版省略16GiB/大型瀏覽器串流、跨OS、廣泛歷史與正式生產矩陣；沒有呼叫模型。首個v0.1.0-rc.1凍結包原樣保留，本增量不在其中。\n\n")
        same = repo if repo in ["web", "desktop", "admin"] else "web"
        cover = next(m for m in media if m["path"].startswith("copypaste-" + same + "/") and m["path"].endswith(("project-saved-en.png", "workspace-saved-en.png", "shared-saved-en.png")))
        gif = next(m for m in media if m["path"].startswith("copypaste-" + same + "/") and m["path"].endswith(".gif")); mp4 = next(m for m in media if m["path"].startswith("copypaste-" + same + "/") and m["path"].endswith(".mp4"))
        qualifier = "Actual component journey." if repo in ["web", "desktop", "admin"] else "Shared actual Web illustration; no new UI acceptance is claimed for this component."
        if repo == "extension": qualifier += " Extension remains a cloud-agent right Side Panel with authorized attachments."
        text = "<!-- scope-data-export-152 -->\n\n" + intro + diagram + "\n\n" + qualifier + "\n\n![Actual saved archive](assets/screenshots/" + Path(cover["path"]).name + ")\n\n![Actual interaction](assets/screenshots/" + Path(gif["path"]).name + ")\n\n[Actual MP4](assets/screenshots/" + Path(mp4["path"]).name + ")\n\n---\n\n"
        p.write_bytes((text + old).encode("utf-8"))
for name in ["README.md", "README.en.md"]:
    p = ROOT / "docs" / name; old = p.read_text("utf-8"); p.write_bytes(("<!-- scope-data-export-152 -->\n\n[完整範圍匯出 / Authorized scope export](development/152-scope-data-export.md) · [完整待項 / Ledger](quality/remaining-work-stage152.md) · [更新 / Changes](changes/152-scope-data-export.md)\n\nUnreleased increment152; frozen v0.1.0-rc.1 preserved. Focused functional checks only.\n\n---\n\n" + old).encode("utf-8"))
print(json.dumps({"status": "recorded", "backend_cases": 9, "actual_client_groups": 6, "categories": len(category_names), "whole_acceptance_closed": 0}, ensure_ascii=False))
