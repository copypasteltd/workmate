import { mountCreativePackageBrand } from "./creative-package-brand.js";
type IO = { base: string; scopeKey: string; project: string; live: () => boolean; tr: (zh: string, en: string) => string;
  request: (path: string, method?: string, body?: unknown, key?: string) => Promise<any>;
  read: (key: string) => Promise<any>; write: (key: string, value: unknown) => Promise<void>;
  download: (project: { id: string; version: number }) => Promise<unknown>;
};
const sha = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer))].map(b => b.toString(16).padStart(2, "0")).join("");
const encode = (bytes: Uint8Array) => { let text = ""; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(text); };

/** All content operations stay inside the actual SIDE_PANEL. No local Agent dispatch. */
export function mountCreativePackages(container: HTMLDetailsElement, io: IO) {
  let disposed = false, busy = false, selected: any = null, preview: any = null, pending: any = null;
  let disposeBrand: (() => void) | undefined;
  const active = () => !disposed && io.live(), root = io.base + "/creative-project-packages", pendingKey = "creative-restore:" + io.scopeKey;
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => { const e = document.createElement(tag); if (text) e.textContent = text; return e; };
  const summary = make("summary", io.tr("工程打包與恢復", "Project packages & restore")), content = make("div"); content.className = "creative-package-panel";
  const note = make("p", io.tr("來源素材、可編輯工程與校驗清單一起帶走。AI HK$0。", "Keep editable source, fixed media and checksums together. AI HK$0."));
  const projects = make("select"); projects.ariaLabel = io.tr("選擇工程", "Choose a project");
  const download = make("button", io.tr("下載完整工程 ZIP", "Download complete project ZIP")); download.type = "button";
  const refresh = make("button", io.tr("更新工程列表", "Refresh projects")); refresh.type = "button"; refresh.className = "secondary";
  const consent = make("input"); consent.type = "checkbox";
  const consentLabel = make("label"); consentLabel.className = "creative-package-consent";
  consentLabel.append(consent, make("span", io.tr("我確認此工程包及恢復素材可供目前專案成員使用。", "I confirm this archive and restored media may be shared with this project's members.")));
  const file = make("input"); file.type = "file"; file.accept = ".zip,application/zip"; file.disabled = true; file.ariaLabel = io.tr("選擇工程 ZIP", "Choose project ZIP");
  const upload = make("button", io.tr("上傳並校驗工程包", "Upload & inspect project ZIP")); upload.type = "button"; upload.disabled = true;
  const review = make("div"), status = make("p"), error = make("p"); status.setAttribute("role", "status"); error.setAttribute("role", "alert");
  const progress = make("progress"); progress.max = 100; progress.hidden = true; progress.ariaLabel = io.tr("工程包上傳進度", "Project upload progress");
  content.append(note, projects, download, refresh, consentLabel, file, upload, progress, status, error, review);
  container.replaceChildren(summary, content); container.hidden = false;
  const controls = () => { projects.disabled = busy; download.disabled = busy || !projects.value; refresh.disabled = busy; consent.disabled = busy || !!preview || !!pending;
    file.disabled = busy || !consent.checked || !!pending; upload.disabled = busy || !consent.checked || !file.files?.length || !!pending; };
  const run = async (work: () => Promise<void>) => { if (busy || !active()) return; busy = true; error.textContent = ""; controls();
    try { await work(); } catch (e) { if (active()) error.textContent = (e as Error).message; }
    finally { busy = false; if (active()) { controls(); const retry = review.querySelector<HTMLButtonElement>("[data-restore-retry]"); if (retry) retry.disabled = false; } } };
  const load = async () => { const data = await io.request(root); if (!active()) return;
    projects.replaceChildren(new Option(io.tr("選擇工程", "Choose a project"), ""), ...data.items.map((p: any) => new Option(`${p.name} · v${p.version}`, `${p.id}:${p.version}`))); controls(); };
  const done = async (result: any) => { await io.write(pendingKey, null); if (!active()) return; disposeBrand?.(); pending = null; preview = null; selected = null;
    review.replaceChildren(); file.value = ""; consent.checked = false; status.textContent = io.tr("已恢復，可在 Web／Desktop 的對應工程繼續編輯：", "Restored. Continue editing in the matching Web/Desktop project: ") + result.name;
    status.dataset.packageRestored = result.id; await load(); };
  const restore = async () => {
    if (!pending) return; const attempt = pending; await io.write(pendingKey, attempt); if (!active()) return;
    const receipt = await io.request(root + "/requests/" + attempt.key); if (!active()) return;
    if (receipt.state === "completed") { await done(receipt.result); return; }
    if (receipt.state === "removed") { await io.write(pendingKey, null); pending = null; review.replaceChildren(); throw new Error(io.tr("先前恢復的工程已被移除，不會再次建立。", "The previous restore was removed and will not be recreated.")); }
    const result = await io.request(root + "/restore", "POST", attempt.body, attempt.key); if (active()) await done(result);
  };
  const showPending = () => { disposeBrand?.(); review.replaceChildren(make("h3", io.tr("核對上次恢復結果", "Check previous restore")), make("p", pending.body.name),
    make("p", io.tr("核對或重試沿用原請求，避免重複建立。", "Checking or retrying keeps the original request to prevent duplicates.")));
    const retry = make("button", io.tr("核對並繼續原恢復", "Check & continue original restore")); retry.type = "button";
    retry.dataset.restoreRetry = "true";
    retry.onclick = () => void run(async () => { retry.disabled = true; await restore(); });
    const reselect = make("button", io.tr("核對後重新選擇來源", "Check before choosing another source")); reselect.type = "button"; reselect.className = "secondary";
    reselect.onclick = () => void run(async () => {
      const receipt = await io.request(root + "/requests/" + pending.key); if (!active()) return;
      if (receipt.state === "completed") { await done(receipt.result); return; }
      if (!["not_recorded", "removed"].includes(receipt.state)) throw new Error(io.tr("結果仍未確認，請保留原請求。", "The result is still unknown. Keep the original request."));
      await io.write(pendingKey, null); if (!active()) return;
      pending = null; preview = null; selected = null; review.replaceChildren(); file.value = ""; consent.checked = false; controls();
    }); review.append(retry, reselect); controls(); };
  const showPreview = () => {
    disposeBrand?.();
    review.replaceChildren(); review.dataset.packagePreview = "true";
    review.append(make("h3", io.tr("恢復前確認", "Review before restoring")), make("p", `${preview.media_count} ${io.tr("個來源素材", "source files")} · ${(preview.total_bytes / 1024 ** 2).toFixed(1)} MiB`));
    for (const line of preview.limitations) review.append(make("p", line));
    const list = make("details"); list.append(make("summary", io.tr("完整檔案清單", "Complete file list"))); const ul = make("ul");
    for (const f of preview.files) ul.append(make("li", `${f.path} · ${Math.ceil(f.bytes / 1024)} KiB`)); list.append(ul); review.append(list);
    const name = make("input"); name.value = preview.name + io.tr(" · 恢復副本", " · Restored"); name.maxLength = 150; name.ariaLabel = io.tr("新工程名稱", "New project name");
    const rights = make("input"); rights.type = "checkbox"; const label = make("label"); label.className = "creative-package-consent";
    label.append(rights, make("span", io.tr("我確認素材授權，並建立新的專案共用副本；不覆寫來源。", "I confirm media rights and a new shared copy without overwriting the source.")));
    const confirm = make("button", io.tr("恢復為新工程", "Restore a new project")); confirm.type = "button"; confirm.disabled = true;
    let brandApproval: any = null, evidenceApproved = !preview.has_imported_evidence;
    const update = () => { confirm.disabled = busy || !rights.checked || !name.value.trim() || !evidenceApproved || !!preview.brand_requirements && !brandApproval; }; rights.onchange = update; name.oninput = update;
    if (preview.brand_requirements) { const brand = make("div"); review.append(brand);
      disposeBrand = mountCreativePackageBrand(brand, { root, live: active, tr: io.tr, request: io.request }, selected, preview, value => { brandApproval = value; update(); }); }
    if (preview.has_imported_evidence) {
      const evidence = make("section"); evidence.className = "creative-evidence-review"; evidence.ariaLabel = io.tr("匯入圖表資料核對", "Imported chart data review");
      evidence.append(make("h4", io.tr("核對圖表原值與範圍", "Review chart values and scope")), make("p", io.tr("這是工程包內的資料快照，恢復後標示為自行確認的匯入資料。", "This package contains a snapshot, labelled as user-attested imported data after restore.")));
      const records = make("div"), position = make("p"), prev = make("button", io.tr("上一頁資料", "Previous records")), next = make("button", io.tr("下一頁資料", "Next records"));
      let page = 0; const rows = preview.evidence_rows;
      const show = () => { records.replaceChildren(); position.textContent = `${page + 1}/${Math.ceil(rows.length / 20)} · ${rows.length}`;
        for (const r of rows.slice(page * 20, (page + 1) * 20)) { const card = make("article"), detail = make("details");
          detail.append(make("summary", io.tr("資料定義與範圍", "Definition & scope")), make("p", r.metric_id), make("pre", JSON.stringify(JSON.parse(r.scope), null, 2)));
          card.append(make("strong", r.label), make("p", `${r.value ?? io.tr("缺少數值", "Missing value")} ${r.unit}`)); if (r.value === null) card.append(make("p", r.null_reason)); card.append(detail); records.append(card); }
        prev.disabled = page === 0; next.disabled = (page + 1) * 20 >= rows.length;
      };
      prev.type = next.type = "button"; prev.onclick = () => { page--; show(); }; next.onclick = () => { page++; show(); }; show();
      const ack = make("input"), consent = make("label"); ack.type = "checkbox"; consent.className = "creative-package-consent";
      consent.append(ack, make("span", io.tr("我已核對匯入圖表原值與範圍，了解這些資料尚未透過目的專案的平台帳戶核實。", "I reviewed the imported chart values and scope and understand they have not been verified against the destination project's platform accounts.")));
      ack.onchange = () => { evidenceApproved = ack.checked; update(); }; evidence.append(position, records, prev, next, consent); review.append(evidence);
    }
    confirm.onclick = () => void run(async () => {
      if (!rights.checked || !name.value.trim() || !evidenceApproved || preview.brand_requirements && !brandApproval) return; confirm.disabled = true;
      pending = { key: crypto.randomUUID(), body: { ...selected, name: name.value.trim(), preview_hash: preview.preview_hash, confirm_project_sharing: true, confirm_media_rights: true, ...(preview.has_imported_evidence && evidenceApproved ? { confirm_imported_evidence: true } : {}), ...(brandApproval ?? {}) } };
      await io.write(pendingKey, pending); if (!active()) return; showPending(); await restore();
    }); review.append(name, label, confirm); controls();
  };
  consent.onchange = controls; projects.onchange = controls;
  file.onchange = () => { disposeBrand?.(); preview = null; selected = null; review.replaceChildren(); controls(); };
  refresh.onclick = () => void run(load);
  download.onclick = () => void run(async () => { const [id, version] = projects.value.split(":"); await io.download({ id, version: Number(version) }); });
  upload.onclick = () => void run(async () => {
    const selectedFile = file.files?.[0]; if (!selectedFile || !consent.checked) return;
    if (!selectedFile.size || selectedFile.size > 100 * 1024 ** 2 || !/\.zip$/i.test(selectedFile.name)) throw new Error(io.tr("請選擇最多 100 MiB 的工程 ZIP。", "Choose a project ZIP up to 100 MiB."));
    const bytes = new Uint8Array(await selectedFile.arrayBuffer()); if (!active()) return; const checksum = await sha(bytes); if (!active()) return;
    const uploadKey = `creative-upload:${io.scopeKey}:${selectedFile.name}:${selectedFile.size}:${checksum}`;
    let saved = await io.read(uploadKey); if (!active()) return;
    if (!saved || typeof saved.key !== "string") { saved = { key: crypto.randomUUID() }; await io.write(uploadKey, saved); }
    if (!saved.id) { const created = await io.request(io.base + "/uploads", "POST", { project_id: io.project, filename: selectedFile.name, content_type: "application/zip", size_bytes: bytes.length, sha256: checksum }, saved.key);
      if (!active()) return; saved.id = created.upload_id; await io.write(uploadKey, saved); }
    const path = io.base + "/uploads/" + saved.id, current = await io.request(path); if (!active()) return;
    if (current.upload_id !== saved.id || current.sha256 !== checksum || current.size_bytes !== bytes.length
      || !["pending", "completed"].includes(current.state) || !Number.isInteger(current.part_size_bytes) || current.part_size_bytes < 1 || current.part_size_bytes > 4 * 1024 ** 2 || !Array.isArray(current.parts)) throw new Error("Upload manifest mismatch");
    const old = new Map<number, any>(); for (const part of current.parts) { if (!Number.isInteger(part.part_index) || old.has(part.part_index)) throw new Error("Upload parts mismatch"); old.set(part.part_index, part); }
    progress.hidden = false;
    for (let offset = 0, index = 0; offset < bytes.length; offset += current.part_size_bytes, index++) {
      if (!active()) return; const chunk = bytes.subarray(offset, offset + current.part_size_bytes), digest = await sha(chunk), previous = old.get(index);
      if (previous && (previous.sha256 !== digest || previous.size_bytes !== chunk.length)) throw new Error("Retained part mismatch");
      if (!previous && current.state === "completed") throw new Error("Completed upload is missing a part");
      if (!previous) await io.request(path + "/parts/" + index, "POST", { sha256: digest, base64: encode(chunk) }, saved.key);
      if (!active()) return; progress.value = Math.min(100, (offset + chunk.length) / bytes.length * 100);
    }
    const asset = await io.request(path + "/complete", "POST", { sha256: checksum, size_bytes: bytes.length }, saved.key); if (!active()) return;
    if (asset.project_id !== io.project || asset.private_owner || asset.version.sha256 !== checksum || Number(asset.version.bytes) !== bytes.length) throw new Error("Completed upload ownership mismatch");
    selected = { asset_id: asset.id, version: asset.version.version, sha256: checksum }; await io.write(uploadKey, null);
    preview = await io.request(root + "/preview", "POST", selected); if (!active()) return;
    progress.hidden = true; status.textContent = ""; showPreview();
  });
  void run(async () => { pending = await io.read(pendingKey); if (!active()) return; await load(); if (pending?.key && pending?.body?.confirm_project_sharing === true) showPending(); else pending = null; });
  return () => { disposed = true; disposeBrand?.(); container.hidden = true; container.replaceChildren(); };
}
