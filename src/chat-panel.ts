import { ConversationState, unfinished, type ChatIO, type ChatScope } from "./conversation.js";
import { exactHKD } from "./financial-notice.js";
import { FolderTransfer } from "./folder-transfer.js";
import { folderBytes } from "./folder-import.js";
import { businessQuestion } from "./business-question.js";
import { openAttachmentPreview } from "./document-preview.js";

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
/** A local side-panel view over authenticated cloud conversations. */
export class ChatPanel {
  readonly state: ConversationState;
  readonly folder: FolderTransfer;
  private interval?: ReturnType<typeof setInterval>;
  private followLatest = true;
  private resize?: ResizeObserver;
  private language: () => string;
  private questionDrafts = new Map<string, string>();
  private questionScope = "";
  private deliveryScope = "";
  private deliveryGeneration = 0;
  private deliveryDownloads = new Map<string, { state: "pending" | "submitted" | "failed"; error?: string }>();
  private documentPreview?:ReturnType<typeof openAttachmentPreview>;
  private tr(zh: string, en: string) { return this.language() === "en" ? en : zh; }
  constructor(private io: Omit<ChatIO, "changed">, language: () => string, private report: (e: unknown) => void,
    private capture: () => Promise<{ title: string; url: string; text: string }>, private details: (id: string) => Promise<void>,
    private download?: (scope: ChatScope, taskId: string) => Promise<unknown>,
    private revise?: (scope: ChatScope, taskId: string) => void) {
    this.language = language;
    this.state = new ConversationState({ ...io, changed: () => this.draw() });
    this.folder = new FolderTransfer(this.state, () => this.draw());
    el("chat-folder").addEventListener("change", () => {
      const input = el<HTMLInputElement>("chat-folder"), files = [...input.files ?? []]; input.value = "";
      if (files.length) void this.run(async () => this.folder.choose(files));
    });
    el("folder-confirm").addEventListener("click", () => void this.run(() => this.folder.start()));
    el("folder-cancel").addEventListener("click", () => this.folder.cancel());
    el("folder-review").addEventListener("cancel", e => { e.preventDefault(); this.folder.cancel(); });
    el("chat-form").addEventListener("submit", e => {
      e.preventDefault(); this.state.draft = el<HTMLTextAreaElement>("chat-input").value;
      void this.run(() => this.state.send(el<HTMLInputElement>("chat-budget").value));
    });
    el("chat-input").addEventListener("input", () => { this.state.draft = el<HTMLTextAreaElement>("chat-input").value; });
    el("chat-input").addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); el<HTMLFormElement>("chat-form").requestSubmit(); }
    });
    el("chat-new").addEventListener("click", () => { this.followLatest = true; void this.run(() => this.state.select("")); });
    el("chat-refresh").addEventListener("click", () => void this.run(() => this.state.refresh()));
    el("chat-stop").addEventListener("click", () => void this.run(() => this.state.stop()));
    el("chat-agent").addEventListener("change", () => { this.state.agentId = el<HTMLSelectElement>("chat-agent").value; });
    el("chat-history").addEventListener("change", () => { this.followLatest = true; void this.run(() => this.state.select(el<HTMLSelectElement>("chat-history").value)); });
    el("chat-file").addEventListener("change", () => {
      const input = el<HTMLInputElement>("chat-file"), files = [...input.files ?? []]; input.value = "";
      void this.run(async () => { await Promise.all(files.map(f => this.state.attach(f))); });
    });
    el("chat-capture").addEventListener("click", () => void this.run(async () => {
      const scope = this.state.scope, c = this.state.conversation?.id;
      const page = await this.capture();
      if (scope !== this.state.scope || c !== this.state.conversation?.id) return;
      await this.state.attach(new File([page.title + "\n" + page.url + "\n\n" + page.text], "webpage.txt", { type: "text/plain" }));
    }));
    const drop = el("chat-shell");
    drop.addEventListener("dragover", e => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); });
    drop.addEventListener("drop", e => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault(); const files = [...e.dataTransfer.files];
      void this.run(async () => { await Promise.all(files.map(f => this.state.attach(f))); });
    });
    const feed = el("chat-messages");
    feed.addEventListener("scroll", () => {
      if (feed.clientHeight) this.followLatest = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    });
    this.resize = new ResizeObserver(() => { if (this.followLatest && feed.clientHeight) feed.scrollTop = feed.scrollHeight; });
    this.resize.observe(feed);
    window.addEventListener("pagehide", () => { this.dispose(); this.resize?.disconnect(); });
    this.draw();
  }
  private async run(fn: () => Promise<void>) {
    const scope = this.state.scope;
    try { await fn(); } catch (e) { if (scope === this.state.scope) this.report(e); }
  }
  reset() { this.dispose(); this.folder.cancel(); this.questionDrafts.clear(); this.questionScope = ""; this.state.reset(); }
  dispose() { if (this.interval) clearInterval(this.interval); this.interval = undefined; this.documentPreview?.close(); this.documentPreview=undefined; }
  async open(scope: ChatScope) {
    this.dispose(); this.followLatest = true; await this.state.open(scope);
    if (!this.state.scope || this.state.scope.actor !== scope.actor || this.state.scope.tenant !== scope.tenant || this.state.scope.project !== scope.project) return;
    await this.state.refresh();
    this.interval = setInterval(() => { if (!document.hidden) void this.run(() => this.state.refresh()); }, 1800);
  }
  draw() {
    this.documentPreview?.check();
    const s = this.state;
    if (!s) return;
    const t = (zh: string, en: string) => this.tr(zh, en);
    for (const [id, zh, en] of [
      ["chat-new", "＋ 新會話", "+ New chat"], ["chat-refresh", "重新整理", "Refresh"],
      ["chat-stop", "停止", "Stop"], ["chat-capture", "目前網頁", "Current page"],
      ["chat-attach-label", "附加檔案", "Attach files"], ["chat-settings-label", "角色與預算", "Specialist & budget"],
      ["chat-budget-label", "每條訊息預算上限（HKD）", "Budget per message (HKD)"],
      ["chat-agent-label", "專業角色", "Specialist"], ["chat-history-label", "會話記錄", "Chat history"],
      ["chat-cloud-note", "獲選檔案上傳至公司雲端的私人會話，由雲端助手處理。分享至專案需另外確認。", "Selected files upload to your private conversation on the company cloud. Project sharing needs separate confirmation."],
    ]) el(id).textContent = t(zh, en);
    const c = s.conversation;
    el("chat-name").textContent = c?.name ?? t("今天想完成什麼？", "What would you like to make?");
    el("chat-name").title = el("chat-name").textContent ?? "";
    el("chat-context").textContent = c ? t("雲端助手", "Cloud assistant") + " · v" + c.agent_version : t("選擇角色，直接開始對話", "Choose a specialist and start a conversation");
    const brief = s.projectConfiguration, briefElement = el<HTMLDetailsElement>("chat-project-brief");
    briefElement.hidden = !brief;
    if (brief) {
      el("chat-project-summary").textContent = (s.projectConfigurationTaskId ? t("本次工作設定", "This task's guidance") : t("專案共享設定", "Shared project guidance")) + ` · v${brief.version}`;
      const content = el("chat-project-content"), signature = JSON.stringify([brief, this.language()]);
      if (content.dataset.signature !== signature) {
        content.dataset.signature = signature; content.replaceChildren();
        const add = (text: string) => { if (text) { const p = document.createElement("p"); p.textContent = text; content.append(p); } };
        if (!brief.available || !brief.body) add(t("資料或方法需要管理員重新確認。", "An administrator needs to review the shared references or methods."));
        else {
          const body = brief.body, resolved = body.resolved ?? {};
          add(body.name); add(body.instructions); add(body.delivery_requirements);
          if (resolved.default_agent) add(t("推薦專家：", "Recommended specialist: ") + `${resolved.default_agent.name} · v${resolved.default_agent.version}`);
          if (resolved.brand) add(`${resolved.brand.name} · v${resolved.brand.version}`);
          for (const r of resolved.resources ?? []) add(`${r.name} · v${r.version}`);
          if (body.max_task_budget_micros !== null) add(t("單次工作上限：", "Task limit: ") + exactHKD(String(body.max_task_budget_micros)));
          add(t("繼承獲准資料及方法；目前權限和費用限制仍會套用。", "Inherits authorized references and methods; current access and billing limits still apply."));
        }
      }
    }
    const history = el<HTMLSelectElement>("chat-history"), agents = el<HTMLSelectElement>("chat-agent");
    const options = (select: HTMLSelectElement, rows: { id: string; name: string }[], empty: string, value: string) => {
      const spec = JSON.stringify([rows, empty, value]);
      if (select.dataset.options === spec) return;
      select.replaceChildren(...[{ id: "", name: empty }, ...rows].map(a => { const o = document.createElement("option"); o.value = a.id; o.textContent = a.name; return o; }));
      select.value = value; select.dataset.options = spec;
    };
    const rows = [...s.history];
    if (c && !rows.some(row => row.id === c.id)) rows.unshift(c);
    options(history, rows, t("新會話", "New chat"), c?.id ?? "");
    options(agents, s.agents, brief?.body?.resolved?.default_agent ? `${brief.body.resolved.default_agent.name} · v${brief.body.resolved.default_agent.version}` : t("預設助手", "Default assistant"), c?.agent_id ?? s.agentId);
    if (c && !s.agents.some(a => a.id === c.agent_id)) {
      const o = document.createElement("option"); o.value = c.agent_id; o.textContent = t("會話原有角色", "Conversation specialist"); agents.append(o); agents.value = c.agent_id;
    }
    const locked = s.loading || s.sending || !!s.pending || s.importing;
    history.disabled = locked || s.preparing; agents.disabled = locked || s.preparing || !!s.creation || !!c;
    el<HTMLButtonElement>("chat-new").disabled = locked || s.preparing;
    const input = el<HTMLTextAreaElement>("chat-input");
    if (input.value !== s.draft) input.value = s.draft;
    input.placeholder = t("傳送訊息…", "Message your assistant…");
    input.disabled = locked || s.unavailable;
    el<HTMLInputElement>("chat-file").disabled = locked;
    el<HTMLInputElement>("chat-folder").disabled = locked || s.preparing || s.attachments.length > 18;
    el("chat-folder-label").textContent = t("資料夾", "Folder");
    el<HTMLButtonElement>("chat-capture").disabled = locked;
    el<HTMLInputElement>("chat-budget").disabled = locked;
    const send = el<HTMLButtonElement>("chat-send");
    send.textContent = s.pending && !s.sending ? t("重試同一訊息", "Retry same message") : s.sending ? t("傳送中…", "Sending…") : t("傳送 ↑", "Send ↑");
    send.disabled = s.loading || s.sending || s.importing || s.unavailable || (!s.pending && (s.busy || s.attachments.some(a => a.state !== "ready")));
    el("chat-pending").hidden = !s.pending || s.sending;
    el("chat-pending").textContent = t("正在確認這條訊息是否已接收。重試會沿用同一內容與預算。", "Acceptance needs confirmation. Retrying keeps the same message and budget.");
    el("chat-unavailable").hidden = !s.unavailable;
    el("chat-unavailable").textContent = t("暫時無法確認會話或來源。請重新整理後繼續。", "The conversation or its sources could not be verified. Refresh to continue.");
    const attachments = el("chat-attachments"); attachments.replaceChildren();
    for (const a of s.attachments) {
      const chip = document.createElement("div"); chip.className = "chat-attachment " + a.state; chip.dataset.attachment = a.id;
      const label = document.createElement("span"); label.textContent = a.name;
      const meta = document.createElement("small"); meta.textContent = `${a.type} · ${Math.ceil(a.size / 1024)} KB · ` + (a.state === "ready" ? t("已上傳，待傳送", "Uploaded, not sent") : a.state === "uploading" ? t("上傳中…", "Uploading…") : t("上傳失敗", "Upload failed"));
      if (a.error) meta.textContent += " · " + a.error;
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.ariaLabel = t("移除附件 ", "Remove attachment ") + a.name; remove.disabled = locked;
      remove.addEventListener("click", () => s.removeAttachment(a.id)); chip.append(label, meta);
      if(a.state==='ready'&&a.assetId&&a.versionId){const preview=document.createElement('button');preview.type='button';preview.textContent=t('預覽附件','Preview attachment');
        preview.addEventListener('click',()=>{const scope=s.scope,conversation=s.conversation?.id;if(!scope)return;this.documentPreview?.close();
          this.documentPreview=openAttachmentPreview({scope,attachment:a,request:this.io.request,tr:(zh,en)=>this.tr(zh,en),
            live:()=>scope===s.scope&&conversation===s.conversation?.id&&!s.unavailable&&s.attachments.some(x=>x.id===a.id)});});chip.append(preview);}
      chip.append(remove); attachments.append(chip);
    }
    const feed = el("chat-messages"), atEnd = this.followLatest || feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    const questionScope = JSON.stringify([s.scope, c?.id]);
    if (questionScope !== this.questionScope || s.unavailable) { this.questionScope = questionScope; this.questionDrafts.clear(); }
    if (questionScope !== this.deliveryScope || s.unavailable) { this.deliveryScope = questionScope; this.deliveryGeneration++; this.deliveryDownloads.clear(); }
    const signature = JSON.stringify([c?.messages, s.progress, s.inputRequests, s.loading, s.unavailable, this.language(), [...this.deliveryDownloads]]);
    if (feed.dataset.signature !== signature) {
      feed.dataset.signature = signature; feed.replaceChildren();
      if (!c?.messages?.length && !s.loading && !s.unavailable) {
        const welcome = document.createElement("div"); welcome.className = "chat-welcome";
        const title = document.createElement("h2"); title.textContent = t("把下一個想法，\n聊成一份成果。", "Bring your next idea\nto life.");
        const note = document.createElement("p"); note.textContent = t("輸入你的目標，或附上檔案，讓助手接著做。", "Share a goal or attach a file. Your assistant takes it from there."); welcome.append(title, note); feed.append(welcome);
      }
      for (const m of c?.messages ?? []) {
        const article = document.createElement("article"); article.className = "chat-message " + (m.role === "user" ? "from-user" : "from-assistant"); article.dataset.message = m.id;
        const who = document.createElement("small"); who.textContent = m.role === "user" ? t("你", "You") : "CopyPaste";
        const body = document.createElement("div"); body.className = "chat-message-body"; body.textContent = m.body;
        article.append(who, body);
        if (m.task_id) { const btn = document.createElement("button"); btn.type = "button"; btn.className = "chat-detail"; btn.textContent = t("工作詳情與附件", "Work details & attachments"); btn.addEventListener("click", () => void this.run(() => this.details(m.task_id))); article.append(btn); }
        if (m.role === "assistant" && m.task_id && this.download && s.scope) {
          const scope = s.scope, generation = this.deliveryGeneration, button = document.createElement("button"), status = document.createElement("small");
          const result = this.deliveryDownloads.get(m.task_id);
          button.type = "button"; button.className = "chat-detail"; button.textContent = t("下載完整交付包", "Download delivery package"); status.setAttribute("role", "status");
          button.disabled = result?.state === "pending";
          if (result?.state === "pending") status.textContent = t("正在整理交付包…", "Preparing delivery package…");
          if (result?.state === "submitted") status.textContent = t("已交給瀏覽器下載管理器。", "Passed to the browser download manager.");
          if (result?.state === "failed") { status.setAttribute("role", "alert"); status.textContent = result.error ?? ""; }
          button.onclick = () => {
            if (this.deliveryDownloads.get(m.task_id)?.state === "pending") return;
            this.deliveryDownloads.set(m.task_id, { state: "pending" }); this.draw();
            void this.download!(scope,m.task_id).then(() => {
              if (generation === this.deliveryGeneration) { this.deliveryDownloads.set(m.task_id, { state: "submitted" }); this.draw(); }
            }).catch(e => {
              if (generation === this.deliveryGeneration) { this.deliveryDownloads.set(m.task_id, { state: "failed", error: (e as Error).message }); this.draw(); }
            });
          };
          article.append(button,status);
        }
        if (m.role === "assistant" && m.task_id && this.revise && s.scope) {
          const scope = s.scope, button = document.createElement("button"); button.type = "button"; button.className = "chat-detail";
          button.textContent = t("以這份成果繼續修改", "Request changes to this delivery");
          button.onclick = () => { if (s.scope === scope) this.revise!(scope, m.task_id); }; article.append(button);
        }
        feed.append(article);
      }
      const progress = s.progress, task = progress.task;
      if (task && unfinished.has(task.status) && !c?.messages?.some((m: any) => m.role === "assistant" && m.task_id === task.id)) {
        const live = document.createElement("article"); live.className = "chat-message from-assistant"; live.dataset.liveTask = task.id;
        const text = progress.events.filter(e => e.kind === "message.delta").map(e => e.body?.text ?? "").join("");
        const content = document.createElement("div"); content.className = "chat-message-body"; content.textContent = text || t("助手正在處理…", "Your assistant is working…");
        const phase = document.createElement("small"); const last = progress.events.at(-1); phase.textContent = task.status + (last?.kind ? " · " + last.kind : ""); live.append(content, phase); feed.append(live);
      }
      if (!s.unavailable) for (const d of s.inputRequests.filter(d => d.kind === "question")) {
        const key = d.id + ":" + d.version;
        feed.append(businessQuestion(d, { draft: this.questionDrafts.get(key) ?? "", language: this.language(),
          changed: answer => this.questionDrafts.set(key, answer),
          confirmed: async answer => { await s.answerInput(d.id, d.version, answer); if (questionScope === this.questionScope) this.questionDrafts.delete(key); },
        }));
      }
      if (atEnd) feed.scrollTop = feed.scrollHeight;
    }
    const active = c?.tasks?.find((task: any) => unfinished.has(task.status));
    el("chat-stop").hidden = !active; el<HTMLButtonElement>("chat-stop").disabled = s.sending;
    const task = s.progress.task;
    const charged = BigInt(task?.charged_micros ?? 0), accrued = BigInt(task?.accrued_micros ?? 0);
    el("chat-cost").textContent = task ? t("已確認用量 ", "Recorded cost ") + exactHKD(String(charged > accrued ? charged : accrued)) + (task.status === "reconciling" ? t(" · 核對中", " · reconciling") : "") : t("每條訊息上限 HKD ", "Per-message limit HKD ") + el<HTMLInputElement>("chat-budget").value;
    this.drawFolder();
  }
  private drawFolder() {
    if (!this.folder) return;
    const folder = this.folder, plan = folder.current, dialog = el<HTMLDialogElement>("folder-review");
    if (!plan) { if (dialog.open) dialog.close(); return; }
    const t = (zh: string, en: string) => this.tr(zh, en), selected = plan.entries.filter(e => e.selected);
    const review = folder.phase === "review", ready = folder.phase === "ready", failed = folder.phase === "failed";
    el("folder-title").textContent = ready ? t("已備妥，等待你的訊息", "Ready for your message") : t("核對所選資料夾", "Review selected folder");
    el("folder-root").textContent = plan.root;
    const capacity = review ? Math.max(0, Math.min(plan.capacity, 19 - this.state.attachments.length)) : plan.capacity;
    el("folder-summary").textContent = `${selected.length} / ${capacity} ` + t("個檔案", "files") + ` · ${folderBytes(selected.reduce((n, e) => n + e.file.size, 0))}`;
    el("folder-note").textContent = review
      ? t("只上傳勾選檔案及一份相對路徑索引。隱藏與建置檔案預設不勾選，每檔最多 5 MiB。確認前不讀取內容或上傳。", "Only checked files and a relative-path index will upload. Hidden and build files start unchecked; each file can be up to 5 MiB. Contents are not read or uploaded before confirmation.")
      : ready ? t("檔案及目錄索引已附加至私人會話。返回後輸入訊息並按傳送，雲端助手才會開始。", "Files and their folder index are attached to your private chat. Return, write a message and click Send to start the cloud assistant.")
      : t("已上傳檔案保留在目前私人會話。重試會沿用相同上傳回執；取消會移除這批待傳送附件。", "Uploaded files stay private to this chat. Retry uses the same upload receipts; cancel removes this batch of unsent attachments.");
    const list = el("folder-files"), signature = JSON.stringify([plan.id, this.language(), review]);
    if (list.dataset.signature !== signature) {
      list.dataset.signature = signature; list.replaceChildren();
      for (const entry of plan.entries) {
        const row = document.createElement("label"); row.className = "folder-file";
        const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.dataset.entry = entry.id;
        checkbox.checked = entry.selected; checkbox.disabled = !review || !!entry.unavailable;
        checkbox.addEventListener("change", () => { try { folder.select(entry.id, checkbox.checked); } catch (e) { checkbox.checked = entry.selected; this.report(e); } });
        const text = document.createElement("span"), path = document.createElement("strong"), meta = document.createElement("small");
        path.textContent = entry.relativePath;
        meta.textContent = folderBytes(entry.file.size) + (entry.unavailable === "empty" ? t(" · 空檔案", " · empty file") : entry.unavailable ? t(" · 超過 5 MiB", " · exceeds 5 MiB") : entry.defaultExcluded ? t(" · 預設不選取", " · starts unchecked") : "");
        text.append(path, meta); row.append(checkbox, text); list.append(row);
      }
    }
    for (const entry of plan.entries) {
      const input = list.querySelector<HTMLInputElement>(`input[data-entry="${entry.id}"]`);
      if (input) { input.checked = entry.selected; input.disabled = !review || !!entry.unavailable || (!entry.selected && selected.length >= capacity); }
    }
    const issue = folder.reviewIssue;
    const issues = {
      conversation: t("請取消此選取，返回會話重新整理後再試。", "Cancel this selection and refresh the chat before trying again."),
      busy: t("請等待目前訊息確認完成。", "Wait for the current message to finish confirming."),
      uploading: t("另一個附件仍在上傳；完成後即可確認這個資料夾。", "Another attachment is uploading. You can confirm this folder when it finishes."),
      failed_attachment: t("請先取消此選取，返回會話移除失敗附件，再選取資料夾。", "Cancel this selection, remove failed attachments in the chat, then choose the folder again."),
      capacity: t("現有附件已減少可用位置，請取消部分勾選後再上傳。", "Existing attachments reduced the available space. Uncheck some files before uploading."),
      empty: t("請至少勾選一個檔案。", "Check at least one file."),
    };
    const status = el("folder-status");
    status.textContent = review ? (issue ? issues[issue] : folder.error || (selected.length >= capacity
      ? t("已達可選數量；取消一項勾選即可替換檔案。", "Selection is full. Uncheck a file to choose a different one.")
      : t("目錄結構將隨檔案一同保留。", "Folder structure travels with your selected files."))) : failed ? folder.error : ready ? t("已上傳，尚未傳送", "Uploaded, not sent") : `${folder.completed} / ${selected.length} ` + t("個檔案已完成，正在上傳…", "files complete. Uploading…");
    status.classList.toggle("failed", failed || (review && (!!folder.error || issue === "failed_attachment" || issue === "conversation" || issue === "capacity")));
    const progress = el<HTMLProgressElement>("folder-progress"); progress.hidden = review; progress.max = selected.length + 1; progress.value = ready ? selected.length + 1 : folder.completed;
    const confirm = el<HTMLButtonElement>("folder-confirm"); confirm.hidden = ready;
    confirm.disabled = (!review && !failed) || !selected.length || (review && !!issue);
    confirm.textContent = failed ? t("重試未完成項目", "Retry unfinished files") : t("確認並上傳", "Confirm & upload");
    el("folder-cancel").textContent = ready ? t("返回會話", "Back to chat") : t("取消", "Cancel");
    if (!dialog.open) dialog.showModal();
  }
}
