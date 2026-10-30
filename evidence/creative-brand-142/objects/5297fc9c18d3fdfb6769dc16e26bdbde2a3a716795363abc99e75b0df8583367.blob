import { readRevisionPending, revisionDraftPrefix, revisionMicros, textRevisionTarget, type RevisionPending, type RevisionTarget } from "./delivery-revision-state.js";

type RevisionIO = {
  path: string; taskId: string; scopeKey: string; live: () => boolean; tr: (zh: string, en: string) => string;
  request: (path: string, method?: string, body?: unknown, key?: string) => Promise<any>;
  read: (key: string) => Promise<unknown>; write: (key: string, value: unknown) => Promise<void>;
  completed: (result: any) => Promise<void>;
};
/** A modal inside Chrome's native side panel; no tab, popup or local Agent is opened. */
export function openDeliveryRevision(io: RevisionIO) {
  const dialog = document.createElement("dialog"); dialog.className = "revision-dialog";
  const tr = io.tr, make = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const node = document.createElement(tag); if (text) node.textContent = text; return node;
  };
  const title = make("h2", tr("修改這份成果", "Revise this delivery")), close = make("button", tr("關閉", "Close"));
  close.type = "button"; close.onclick = () => dispose(); dialog.append(title, close);
  const area = make("div"), status = make("p"); status.setAttribute("role", "alert"); dialog.append(area, status);
  let active = true, busy = false, generation = 0, data: any, target: RevisionTarget = { kind: "whole" }, pending: RevisionPending | null = null;
  const live = () => active && io.live(), storeKey = revisionDraftPrefix + io.scopeKey + ":" + io.taskId;
  const dispose = () => { active = false; generation++; dialog.close(); dialog.remove(); window.removeEventListener("pagehide", dispose); clearInterval(watcher); };
  dialog.addEventListener("cancel", event => { event.preventDefault(); dispose(); });
  document.body.append(dialog); dialog.showModal(); window.addEventListener("pagehide", dispose, { once: true });
  const watcher = setInterval(() => { if (!io.live()) dispose(); }, 300);
  const fail = (error: unknown) => { if (live()) status.textContent = (error as Error).message; };
  const load = async () => {
    area.textContent = tr("正在載入原成果…", "Loading original delivery…"); status.textContent = "";
    try {
      [data, pending] = await Promise.all([io.request(io.path + "/revision-context"), io.read(storeKey).then(raw => readRevisionPending(typeof raw === "string" ? raw : null, io.taskId, false))]);
      if (!live()) return; draw();
    } catch (error) { if (live()) { area.replaceChildren(); fail(error); const retry = make("button", tr("重新載入", "Reload")); retry.type = "button"; retry.onclick = () => void load(); area.append(retry); } }
  };
  const draw = () => {
    area.replaceChildren();
    area.append(make("strong", data.title + " · v" + data.expected_version), make("p", tr("選擇要改的成果及位置，寫下要求，再確認本次預算。原文件會保留。", "Choose the output and location, describe your changes, then confirm this revision’s budget. Original files are retained.")));
    const canStart = data.can_start && data.execution_location === "cloud";
    if (!canStart) area.append(make("p", data.required_workflow ? tr("請從原方案、團隊或操作流程提出修改，沿用其確認步驟。", "Request changes from the original method, team or operation workflow and retain its approvals.") : tr("目前無法開始修改。請核對工作權限及會話狀態。", "Changes cannot start. Check work access and conversation status.")));
    const form = make("form"), fields = make("fieldset"), content = make("select"), mode = make("select"), preview = make("div");
    const label = (text: string, input: HTMLElement) => { const wrapper = make("label", text); wrapper.append(input); fields.append(wrapper); input.setAttribute("aria-label", text); return wrapper; };
    const option = (select: HTMLSelectElement, value: string, text: string) => { const o = make("option", text); o.value = value; select.append(o); };
    option(content, "all", tr("整份交付", "Complete delivery")); if (data.output) option(content, "output", tr("文字答覆", "Text answer"));
    for (const a of data.artifacts) option(content, a.asset_version_id, a.name + " · v" + a.version);
    label(tr("要修改哪份成果？", "Which output should change?"), content); label(tr("修改範圍", "Change scope"), mode); fields.append(preview);
    const feedback = make("textarea"); feedback.required = true; feedback.minLength = 5; feedback.maxLength = 6000; feedback.rows = 4; feedback.value = pending?.body.instructions ?? "";
    label(tr("希望怎樣修改？", "What should change?"), feedback);
    const budget = make("input"); budget.type = "number"; budget.required = true; budget.min = "0.01"; budget.max = "10000"; budget.step = "0.01"; budget.value = pending ? String(pending.body.budget_micros / 1e6) : "20";
    label(tr("本次修改預算上限（HKD）", "Revision budget limit (HKD)"), budget);
    const consent = make("input"); consent.type = "checkbox"; consent.required = true;
    const consentLine = label(tr("確認以上修改內容及本次預算", "Confirm these changes and this revision’s budget"), consent); consentLine.className = "revision-consent";
    const submit = make("button", pending ? tr("重試原修改要求", "Retry original revision") : tr("開始修改", "Start revision")); submit.type = "submit";
    fields.disabled = !!pending || !canStart; submit.disabled = !canStart; form.append(fields, submit); area.append(form);
    if (pending) area.append(make("p", tr("已保留原要求與預算。重試使用原請求，避免重複建立工作。", "The original request and budget are retained. Retry uses that request to avoid duplicate work.")));
    const drawTarget = async () => {
      const current = ++generation, a = data.artifacts.find((a: any) => a.asset_version_id === content.value);
      preview.replaceChildren(); status.textContent = "";
      target = content.value === "all" ? { kind: "whole" } : content.value === "output" ? { kind: "output" } : { kind: "artifact", asset_version_id: content.value };
      submit.disabled = !canStart || (mode.value === "text" && !pending);
      if (mode.value === "entire") return;
      const valid = () => live() && current === generation;
      const paragraph = make("p"); paragraph.setAttribute("role", "status"); preview.append(paragraph);
      let bytes: any;
      const previewRequest = content.value === "output" ? Promise.resolve(null) : io.request(`${io.path}/revision-preview/${content.value}?` + new URLSearchParams({ expected_version: String(data.expected_version), expected_delivery_hash: data.expected_delivery_hash }));
      if (mode.value === "image") {
        let rectangle = { x: 0, y: 0, width: 1, height: 1 };
        const boxFields = make("div"); boxFields.className = "revision-coordinates"; const inputs: HTMLInputElement[] = [];
        const setBox = (value: typeof rectangle) => { rectangle = value; target = { kind: "image", asset_version_id: content.value, ...value }; inputs.forEach((input, i) => { input.value = String(Object.values(rectangle)[i]); }); };
        for (const [i, key] of (["x", "y", "width", "height"] as const).entries()) {
          const name = tr(["左側比例", "頂部比例", "寬度比例", "高度比例"][i], ["Left ratio", "Top ratio", "Width ratio", "Height ratio"][i]), wrapper = make("label", name), input = make("input");
          input.type = "number"; input.min = "0"; input.max = "1"; input.step = "0.001"; input.value = String(rectangle[key]); input.setAttribute("aria-label", name); input.oninput = () => setBox({ ...rectangle, [key]: Number(input.value) }); wrapper.append(input); inputs.push(input); boxFields.append(wrapper);
        }
        preview.append(make("p", tr("拖曳選取或填寫相對圖片的比例。這是修改位置提示。", "Drag a region or enter image proportions. This identifies the requested change location.")), boxFields); setBox(rectangle);
        try {
          bytes = await previewRequest; if (!valid()) return;
          if (bytes.sha256 !== a.sha256) throw new Error(tr("成果版本已變更，請重新載入。", "The delivery version changed. Reload it."));
          const frame = make("div"), image = make("img"), overlay = make("span"); frame.className = "revision-image"; image.draggable = false; image.alt = a.name; image.src = `data:${bytes.mime_type};base64,${bytes.base64}`;
          const paint = () => { Object.assign(overlay.style, { left: rectangle.x * 100 + "%", top: rectangle.y * 100 + "%", width: rectangle.width * 100 + "%", height: rectangle.height * 100 + "%" }); };
          const point = (e: PointerEvent) => { const r = frame.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
          let start: { x: number; y: number } | null = null;
          frame.onpointerdown = e => { if (fields.disabled) return; start = point(e); frame.setPointerCapture(e.pointerId); };
          frame.onpointermove = e => { if (!start || fields.disabled) return; const p = point(e); setBox({ x: Math.min(p.x, start.x), y: Math.min(p.y, start.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) }); paint(); };
          frame.onpointerup = frame.onpointercancel = () => { start = null; }; inputs.forEach(input => input.addEventListener("input", paint)); frame.append(image, overlay); paint(); preview.prepend(frame);
        } catch (e) { if (valid()) paragraph.textContent = (e as Error).message; }
      } else if (mode.value === "video") {
        const start = make("input"), end = make("input");
        for (const input of [start, end]) { input.type = "number"; input.min = "0"; input.max = String(a.duration_ms / 1000); input.step = "0.001"; input.required = true; }
        start.value = "0"; end.value = String(a.duration_ms / 1000);
        for (const [input, text] of [[start, tr("開始（秒）", "Start (seconds)")], [end, tr("結束（秒）", "End (seconds)")]] as const) { const wrapper = make("label", text); input.setAttribute("aria-label", text); wrapper.append(input); preview.append(wrapper); }
        const setTime = () => { target = { kind: "video", asset_version_id: content.value, start_ms: Math.round(Number(start.value) * 1000), end_ms: Math.round(Number(end.value) * 1000) }; }; start.oninput = end.oninput = setTime; setTime();
        try { bytes = await previewRequest; if (!valid()) return; if (bytes.sha256 !== a.sha256) throw new Error("DELIVERY_VERSION_CHANGED"); const video = make("video"); video.controls = true; video.preload = "metadata"; video.src = `data:${bytes.mime_type};base64,${bytes.base64}`; preview.prepend(video); }
        catch (e) { if (valid()) paragraph.textContent = (e as Error).message; }
      } else if (mode.value === "text") {
        try {
          bytes = await previewRequest; if (!valid()) return;
          if (bytes && bytes.sha256 !== a.sha256) throw new Error("DELIVERY_VERSION_CHANGED");
          const text = bytes ? new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(bytes.base64), c => c.charCodeAt(0))) : data.output;
          const source = make("textarea"); source.readOnly = true; source.rows = 7; source.value = text; source.setAttribute("aria-label", tr("原文選段", "Original text selection")); preview.prepend(source);
          source.onselect = () => { if (fields.disabled || source.selectionStart === source.selectionEnd) return;
            try { target = textRevisionTarget(text, source.selectionStart, source.selectionEnd, content.value === "output" ? undefined : content.value); paragraph.textContent = target.kind === "text" ? target.quote : ""; submit.disabled = !canStart; }
            catch (error) { submit.disabled = true; fail(error); }
          };
        } catch (e) { if (valid()) paragraph.textContent = (e as Error).message; }
      }
    };
    const choose = () => {
      mode.replaceChildren(); option(mode, "entire", tr("完整內容", "Entire output"));
      const a = data.artifacts.find((a: any) => a.asset_version_id === content.value);
      if (content.value === "output" || a?.mime_type.startsWith("text/") || a?.mime_type === "application/json") option(mode, "text", tr("指定文字選段", "Selected text"));
      if (a?.mime_type.startsWith("image/")) option(mode, "image", tr("指定圖片區域", "Image region"));
      if (a?.mime_type.startsWith("video/") && a.duration_ms) option(mode, "video", tr("指定影片時段", "Video interval"));
      void drawTarget();
    };
    content.onchange = choose; mode.onchange = () => void drawTarget(); choose();
    form.onsubmit = event => { event.preventDefault(); if (busy || !canStart || (!pending && (!consent.checked || !form.reportValidity()))) return;
      busy = true; fields.disabled = true; submit.disabled = true; status.textContent = "";
      void (async () => {
        try {
          const request: RevisionPending = pending ?? { key: crypto.randomUUID(), local: false, body: { source_task_id: io.taskId,
            expected_version: data.expected_version, expected_delivery_hash: data.expected_delivery_hash, target,
            instructions: feedback.value.trim(), budget_micros: revisionMicros(budget.value),
            ...(data.conversation_version ? { expected_conversation_version: data.conversation_version } : {}) } };
          if (!pending) { await io.write(storeKey, JSON.stringify(request)); pending = request; }
          if (!live()) return;
          const result = await io.request(io.path + "/revisions", "POST", request.body, request.key);
          await io.write(storeKey, null); if (!live()) return; pending = null;
          area.replaceChildren(make("strong", tr("修改工作已記錄", "Revision recorded")), make("p", tr("沿用原角色和成果，原文件會保留。", "The revision keeps the original role and delivery. Original files are retained.")));
          const open = make("button", tr("查看修改工作", "View revision")); open.type = "button"; open.onclick = () => { dispose(); void io.completed(result); }; area.append(open);
        } catch (error) { fail(error); if (live()) { fields.disabled = !!pending || !canStart; submit.disabled = !canStart; submit.textContent = pending ? tr("重試原修改要求", "Retry original revision") : tr("開始修改", "Start revision"); } }
        finally { busy = false; }
      })();
    };
    if (pending) { const reset = make("button", tr("已核對，重新選擇成果", "Checked existing work; reselect delivery")); reset.type = "button";
      reset.onclick = () => { if (busy || !confirm(tr("請先核對原會話及任務列表。清除表單不會取消已開始的工作。", "Check the original conversation and task list first. Clearing this form does not cancel work that already started."))) return;
        void io.write(storeKey, null).then(() => { if (live()) { pending = null; void load(); } }).catch(fail); }; area.append(reset); }
  };
  void load(); return dispose;
}
