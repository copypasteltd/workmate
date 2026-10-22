import { ConversationState, unfinished, type ChatIO, type ChatScope } from "./conversation.js";
import { exactHKD } from "./financial-notice.js";

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
/** A local side-panel view over authenticated cloud conversations. */
export class ChatPanel {
  readonly state: ConversationState;
  private interval?: ReturnType<typeof setInterval>;
  private followLatest = true;
  private resize?: ResizeObserver;
  private language: () => string;
  private tr(zh: string, en: string) { return this.language() === "en" ? en : zh; }
  constructor(io: Omit<ChatIO, "changed">, language: () => string, private report: (e: unknown) => void,
    private capture: () => Promise<{ title: string; url: string; text: string }>, private details: (id: string) => Promise<void>) {
    this.language = language;
    this.state = new ConversationState({ ...io, changed: () => this.draw() });
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
  reset() { this.dispose(); this.state.reset(); }
  dispose() { if (this.interval) clearInterval(this.interval); this.interval = undefined; }
  async open(scope: ChatScope) {
    this.dispose(); this.followLatest = true; await this.state.open(scope);
    if (!this.state.scope || this.state.scope.actor !== scope.actor || this.state.scope.tenant !== scope.tenant || this.state.scope.project !== scope.project) return;
    await this.state.refresh();
    this.interval = setInterval(() => { if (!document.hidden) void this.run(() => this.state.refresh()); }, 1800);
  }
  draw() {
    const s = this.state;
    if (!s) return;
    const t = (zh: string, en: string) => this.tr(zh, en);
    for (const [id, zh, en] of [
      ["chat-new", "＋ 新會話", "+ New chat"], ["chat-refresh", "重新整理", "Refresh"],
      ["chat-stop", "停止", "Stop"], ["chat-capture", "目前網頁", "Current page"],
      ["chat-attach-label", "附加檔案", "Attach files"], ["chat-settings-label", "角色與預算", "Specialist & budget"],
      ["chat-budget-label", "每條訊息預算上限（HKD）", "Budget per message (HKD)"],
      ["chat-agent-label", "專業角色", "Specialist"], ["chat-history-label", "會話記錄", "Chat history"],
      ["chat-cloud-note", "獲選檔案上傳至公司雲端的目前專案，由雲端助手處理。", "Selected files upload to this project on the company cloud for your cloud assistant."],
    ]) el(id).textContent = t(zh, en);
    const c = s.conversation;
    el("chat-name").textContent = c?.name ?? t("今天想完成什麼？", "What would you like to make?");
    el("chat-context").textContent = c ? t("雲端助手", "Cloud assistant") + " · v" + c.agent_version : t("選擇角色，直接開始對話", "Choose a specialist and start a conversation");
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
    options(agents, s.agents, t("預設助手", "Default assistant"), c?.agent_id ?? s.agentId);
    if (c && !s.agents.some(a => a.id === c.agent_id)) {
      const o = document.createElement("option"); o.value = c.agent_id; o.textContent = t("會話原有角色", "Conversation specialist"); agents.append(o); agents.value = c.agent_id;
    }
    const locked = s.loading || s.sending || !!s.pending;
    history.disabled = locked; agents.disabled = locked || !!c;
    el<HTMLButtonElement>("chat-new").disabled = locked;
    const input = el<HTMLTextAreaElement>("chat-input");
    if (input.value !== s.draft) input.value = s.draft;
    input.placeholder = t("傳送訊息…", "Message your assistant…");
    input.disabled = locked || s.unavailable;
    el<HTMLInputElement>("chat-file").disabled = locked;
    el<HTMLButtonElement>("chat-capture").disabled = locked;
    el<HTMLInputElement>("chat-budget").disabled = locked;
    const send = el<HTMLButtonElement>("chat-send");
    send.textContent = s.pending && !s.sending ? t("重試同一訊息", "Retry same message") : s.sending ? t("傳送中…", "Sending…") : t("傳送 ↑", "Send ↑");
    send.disabled = s.loading || s.sending || s.unavailable || (!s.pending && (s.busy || s.attachments.some(a => a.state !== "ready")));
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
      remove.addEventListener("click", () => s.removeAttachment(a.id)); chip.append(label, meta, remove); attachments.append(chip);
    }
    const feed = el("chat-messages"), atEnd = this.followLatest || feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    const signature = JSON.stringify([c?.messages, s.progress, s.loading, s.unavailable, this.language()]);
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
        feed.append(article);
      }
      const progress = s.progress, task = progress.task;
      if (task && unfinished.has(task.status) && !c?.messages?.some((m: any) => m.role === "assistant" && m.task_id === task.id)) {
        const live = document.createElement("article"); live.className = "chat-message from-assistant"; live.dataset.liveTask = task.id;
        const text = progress.events.filter(e => e.kind === "message.delta").map(e => e.body?.text ?? "").join("");
        const content = document.createElement("div"); content.className = "chat-message-body"; content.textContent = text || t("助手正在處理…", "Your assistant is working…");
        const phase = document.createElement("small"); const last = progress.events.at(-1); phase.textContent = task.status + (last?.kind ? " · " + last.kind : ""); live.append(content, phase); feed.append(live);
      }
      if (atEnd) feed.scrollTop = feed.scrollHeight;
    }
    const active = c?.tasks?.find((task: any) => unfinished.has(task.status));
    el("chat-stop").hidden = !active; el<HTMLButtonElement>("chat-stop").disabled = s.sending;
    const task = s.progress.task;
    const charged = BigInt(task?.charged_micros ?? 0), accrued = BigInt(task?.accrued_micros ?? 0);
    el("chat-cost").textContent = task ? t("已確認用量 ", "Recorded cost ") + exactHKD(String(charged > accrued ? charged : accrued)) + (task.status === "reconciling" ? t(" · 核對中", " · reconciling") : "") : t("每條訊息上限 HKD ", "Per-message limit HKD ") + el<HTMLInputElement>("chat-budget").value;
  }
}
