/** Cloud conversation state. No local Agent, filesystem paths or model keys. */
export interface ChatScope { actor: string; tenant: string; project: string }
export interface Attachment {
  id: string; name: string; type: string; size: number;
  state: "uploading" | "ready" | "failed"; versionId?: string; error?: string;
  assetId?: string; sha256?: string; importId?: string;
}
export interface ChatIO {
  request(scope: ChatScope, path: string, method?: string, body?: unknown, key?: string): Promise<any>;
  upload(scope: ChatScope, file: File, conversationId: string): Promise<any>;
  read(key: string): Promise<any>;
  write(key: string, value: unknown): Promise<void>;
  changed(): void;
}
interface Pending {
  key: string; createKey: string; name: string; agentId: string;
  prompt: string; budget: string; versionIds: string[];
  conversationId?: string; boundAgentId?: string;
}
interface ConversationCreation { key: string; name: string; agentId: string }
export const unfinished = new Set(["queued", "running", "paused", "needs_input", "awaiting_approval", "reconciling"]);
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export const chatBase = (s: ChatScope) => `/v1/tenants/${s.tenant}/projects/${s.project}`;
export function budgetMicros(value: string) {
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(value)) throw new Error("Use a positive HKD budget with at most two decimal places / 請輸入正數港幣預算，最多兩位小數");
  const [whole, cents = ""] = value.split(".");
  const result = BigInt(whole) * 1_000_000n + BigInt(cents.padEnd(2, "0")) * 10_000n;
  if (result <= 0n || result > 10_000_000_000n) throw new Error("Budget must be HKD 0.01–10,000 / 預算須為港幣 0.01–10,000");
  return String(result);
}
export class ConversationState {
  scope?: ChatScope;
  agents: any[] = [];
  history: any[] = [];
  conversation: any = null;
  projectConfiguration: any = null;
  projectConfigurationTaskId = "";
  attachments: Attachment[] = [];
  draft = "";
  agentId = "";
  loading = false;
  sending = false;
  unavailable = false;
  inputRequests: any[] = [];
  pending?: Pending;
  creation?: ConversationCreation;
  private creating?: Promise<any>;
  private fileImport?: { token: string; generation: number; scope: ChatScope; count: number };
  private generation = 0;
  private poll?: Promise<void>;
  private activeTask: any = null;
  private events: any[] = [];
  private cursor = 0;
  private storageTail: Promise<void> = Promise.resolve();
  constructor(private io: ChatIO) {}
  private storageKey(s: ChatScope) { return `chat:${s.actor}:${s.tenant}:${s.project}`; }
  private current(g: number) { return g === this.generation && !!this.scope; }
  private notify() { this.io.changed(); }
  private persist(s: ChatScope) {
    // Serialize writes so a slow earlier response cannot restore a cleared receipt.
    const value = structuredClone({ conversationId: this.conversation?.id ?? null, pending: this.pending ?? null, creation: this.creation ?? null });
    const work = this.storageTail.catch(() => {}).then(() => this.io.write(this.storageKey(s), value));
    this.storageTail = work;
    return work;
  }
  reset() {
    ++this.generation; this.scope = undefined; this.agents = []; this.history = [];
    this.conversation = null; this.attachments = []; this.draft = ""; this.agentId = "";
    this.projectConfiguration = null; this.projectConfigurationTaskId = "";
    this.loading = false; this.sending = false; this.unavailable = false; this.pending = undefined;
    this.creation = undefined; this.creating = undefined; this.fileImport = undefined;
    this.activeTask = null; this.events = []; this.cursor = 0; this.poll = undefined;
    this.inputRequests = [];
    this.notify();
  }
  async open(scope: ChatScope) {
    if (![scope.actor, scope.tenant, scope.project].every(id => uuid.test(id))) throw new Error("Invalid conversation scope");
    this.reset(); this.scope = { ...scope }; this.loading = true;
    const g = this.generation, s = this.scope;
    this.notify();
    try {
      await this.storageTail.catch(() => {});
      const [agents, history, saved, brief] = await Promise.all([
        this.io.request(s, chatBase(s) + "/agents"),
        this.io.request(s, chatBase(s) + "/conversations"), this.io.read(this.storageKey(s)),
        this.io.request(s, chatBase(s) + "/project-configuration"),
      ]);
      if (!this.current(g)) return;
      this.acceptBrief(brief);
      this.agents = agents.items.filter((a: any) => a.enabled && a.content_state === "active");
      this.history = history.items;
      // Saved state is a receipt, never authority. Server rechecks every read/write.
      if (this.validCreation(saved?.creation)) {
        this.creation = saved.creation; this.agentId = this.creation!.agentId;
      }
      if (saved?.pending && this.validPending(saved.pending)) {
        this.pending = saved.pending; this.draft = this.pending!.prompt;
      }
      const id = this.pending?.conversationId ?? saved?.conversationId;
      if (typeof id === "string" && uuid.test(id)) {
        const c = await this.io.request(s, chatBase(s) + "/conversations/" + id);
        if (!this.current(g)) return;
        this.conversation = c;
      }
    } catch (e) { if (this.current(g)) { this.unavailable = true; this.projectConfiguration = null; } throw e;
    } finally { if (this.current(g)) { this.loading = false; this.notify(); } }
  }
  private acceptBrief(response: any, taskId = "") {
    if (!response || !("published" in response)) throw new Error("Shared project guidance could not be verified / 未能確認專案共享設定");
    this.projectConfiguration = response.published; this.projectConfigurationTaskId = taskId;
  }
  private validPending(p: any): p is Pending {
    return p && uuid.test(p.key) && uuid.test(p.createKey) && typeof p.prompt === "string" && p.prompt.length <= 30000
      && typeof p.name === "string" && p.name.length <= 160 && typeof p.budget === "string" && /^\d{1,13}$/.test(p.budget)
      && typeof p.agentId === "string" && (p.agentId === "" || uuid.test(p.agentId))
      && Array.isArray(p.versionIds) && p.versionIds.length <= 20 && p.versionIds.every((id: any) => typeof id === "string" && uuid.test(id))
      && (!p.conversationId || uuid.test(p.conversationId)) && (!p.boundAgentId || uuid.test(p.boundAgentId));
  }
  private validCreation(c: any): c is ConversationCreation {
    return c && uuid.test(c.key) && typeof c.name === "string" && c.name.length > 0 && c.name.length <= 160
      && typeof c.agentId === "string" && (c.agentId === "" || uuid.test(c.agentId));
  }
  get preparing() { return !!this.creating || this.importing; }
  get importing() { return !!this.fileImport; }
  beginImport(count: number) {
    if (!this.scope || this.loading || this.sending || this.pending || this.unavailable || this.preparing
      || this.attachments.some(a => a.state !== "ready")) throw new Error("Finish the current upload or message first / 請先完成目前上傳或訊息");
    if (!Number.isInteger(count) || count < 2 || count + this.attachments.length > 20)
      throw new Error("The folder and its index exceed the attachment limit / 資料夾及索引超過附件上限");
    const token = crypto.randomUUID();
    this.fileImport = { token, count, generation: this.generation, scope: this.scope };
    this.notify(); return token;
  }
  importActive(token: string) {
    const i = this.fileImport;
    return !!i && i.token === token && i.generation === this.generation && i.scope === this.scope;
  }
  completeImport(token: string) {
    if (!this.importActive(token)) return false;
    const group = this.attachments.filter(a => a.importId === token);
    if (group.length !== this.fileImport!.count || group.some(a => a.state !== "ready"))
      throw new Error("Finish all folder files and the index first / 請先完成資料夾檔案及索引");
    this.fileImport = undefined; this.notify(); return true;
  }
  cancelImport(token: string) {
    if (!this.importActive(token)) return;
    this.fileImport = undefined;
    this.attachments = this.attachments.filter(a => a.importId !== token); this.notify();
  }
  private ensureConversation(s: ChatScope, g: number, proposed?: ConversationCreation): Promise<any> {
    if (!this.current(g)) return Promise.resolve(null);
    if (this.conversation) return Promise.resolve(this.conversation);
    if (this.creating) return this.creating;
    const intent = this.creation ??= proposed ?? {
      key: crypto.randomUUID(), name: this.draft.trim().replace(/\s+/g, " ").slice(0, 160) || "File discussion / 檔案會話", agentId: this.agentId,
    };
    const work = (async () => {
      await this.persist(s); if (!this.current(g)) return null;
      const c = await this.io.request(s, chatBase(s) + "/conversations", "POST", {
        name: intent.name, ...(intent.agentId ? { agent_id: intent.agentId } : {}),
      }, intent.key);
      if (!this.current(g)) return null;
      if (!uuid.test(c?.id) || !uuid.test(c?.agent_id) || c.tenant_id !== s.tenant || c.project_id !== s.project || c.created_by !== s.actor
        || (intent.agentId && c.agent_id !== intent.agentId)) throw new Error("Private conversation acceptance was not confirmed / 未確認私人會話是否已接收");
      this.conversation = { ...c, messages: [], tasks: [] }; this.creation = undefined;
      await this.persist(s); if (!this.current(g)) return null;
      return this.conversation;
    })().catch(async (e: any) => {
      if (this.current(g) && e.status >= 400 && e.status < 500 && ![408, 429].includes(e.status)) {
        this.creation = undefined; await this.persist(s);
      }
      throw e;
    }).finally(() => {
      if (this.current(g) && this.creating === work) { this.creating = undefined; this.notify(); }
    });
    this.creating = work; this.notify(); return work;
  }
  async select(id: string) {
    if (id && !uuid.test(id)) throw new Error("Invalid conversation identity");
    if (!this.scope || this.sending || this.pending || this.importing) throw new Error("Resolve the pending message or folder first / 請先確認待發送訊息或資料夾");
    const s = this.scope, g = ++this.generation;
    this.loading = true; this.unavailable = false; this.poll = undefined; this.attachments = []; this.draft = ""; this.activeTask = null; this.events = []; this.cursor = 0;
    this.conversation = null; this.projectConfiguration = null; this.projectConfigurationTaskId = ""; this.inputRequests = []; this.notify();
    this.creation = undefined; this.creating = undefined;
    try {
      const [c, brief] = await Promise.all([id ? this.io.request(s, chatBase(s) + "/conversations/" + id) : Promise.resolve(null), this.io.request(s, chatBase(s) + "/project-configuration")]);
      if (!this.current(g)) return;
      this.acceptBrief(brief); this.conversation = c; await this.persist(s);
    } catch (e) { if (this.current(g)) this.unavailable = true; throw e;
    } finally { if (this.current(g)) { this.loading = false; this.notify(); } }
  }
  removeAttachment(id: string) {
    if (this.sending || this.pending || this.importing) return;
    this.attachments = this.attachments.filter(a => a.id !== id); this.notify();
  }
  async attach(file: File, importToken?: string, expectedDigest?: string) {
    if (!this.scope || this.sending || this.pending || this.loading) throw new Error("Wait for the current message / 請等待目前訊息");
    if (importToken ? !this.importActive(importToken) : this.importing) throw new Error("Finish or cancel the selected folder first / 請先完成或取消所選資料夾");
    if (this.attachments.length >= 20) throw new Error("Up to 20 attachments / 最多 20 個附件");
    if (importToken && this.attachments.filter(a => a.importId === importToken).length >= this.fileImport!.count)
      throw new Error("The folder selection is already attached / 資料夾選取內容已附加");
    if (file.size > 5 * 1024 * 1024 || !file.size) throw new Error("Choose a non-empty file up to 5 MiB / 請選擇不超過 5 MiB 的非空檔案");
    const a: Attachment = { id: crypto.randomUUID(), name: file.name, type: file.type || "application/octet-stream", size: file.size, state: "uploading", ...(importToken ? { importId: importToken } : {}) };
    this.attachments.push(a); this.notify();
    return this.uploadAttachment(a, file, expectedDigest);
  }
  async retryImportAttachment(id: string, file: File, token: string, expectedDigest?: string) {
    if (!this.importActive(token)) return;
    const a = this.attachments.find(a => a.id === id && a.importId === token);
    if (!a || a.state !== "failed" || a.name !== file.name || a.size !== file.size || a.type !== (file.type || "application/octet-stream"))
      throw new Error("The retry does not match the selected file / 重試內容與所選檔案不符");
    a.state = "uploading"; a.error = undefined; this.notify();
    return this.uploadAttachment(a, file, expectedDigest);
  }
  private async uploadAttachment(a: Attachment, file: File, expectedDigest?: string) {
    const s = this.scope!, g = this.generation;
    try {
      const c = await this.ensureConversation(s, g);
      if (!c || !this.current(g) || !this.attachments.includes(a)) return;
      const asset = await this.io.upload(s, file, c.id);
      if (!this.current(g) || !this.attachments.includes(a)) return;
      if (!uuid.test(asset?.version?.id)) throw new Error("Upload did not return an immutable file version / 上傳未傳回檔案版本");
      if (a.importId && (!uuid.test(asset?.id) || !/^[a-f0-9]{64}$/.test(asset?.version?.sha256)
        || Number(asset?.version?.bytes) !== file.size || (expectedDigest !== undefined && asset.version.sha256 !== expectedDigest)))
        throw new Error("The folder file receipt could not be verified / 未能確認資料夾檔案回執");
      a.assetId = asset.id; a.sha256 = asset.version.sha256;
      a.versionId = asset.version.id; a.state = "ready";
    } catch (e) {
      if (!this.current(g) || !this.attachments.includes(a)) return;
      a.state = "failed"; a.error = e instanceof Error ? e.message : String(e);
    } finally { if (this.current(g)) this.notify(); }
    return a;
  }
  get busy() { return !!this.conversation?.tasks?.some((t: any) => unfinished.has(t.status)); }
  get progress() { return { task: this.activeTask, events: this.events }; }
  async send(budget: string) {
    if (!this.scope || this.loading || this.sending) return;
    if (this.importing) throw new Error("Finish or cancel the folder upload before sending / 請先完成或取消資料夾上傳，再傳送訊息");
    if (this.unavailable) throw new Error("Refresh this conversation before sending / 請先重新整理會話");
    if (this.projectConfiguration && (!this.projectConfiguration.available || !this.projectConfiguration.body))
      throw new Error("Ask an administrator to review the shared project references / 請管理員重新確認專案共享資料");
    if (!this.pending && this.busy) throw new Error("Finish or stop the current work before sending / 請先完成或停止目前工作");
    if (!this.pending && this.attachments.some(a => a.state !== "ready")) throw new Error("Wait for uploads, or remove failed attachments / 請等待上傳完成或移除失敗附件");
    const s = this.scope, g = this.generation;
    if (!this.pending) {
      const prompt = this.draft.trim();
      if (!prompt || prompt.length > 30000) throw new Error("Write a message (up to 30,000 characters) / 請輸入訊息（最多 30,000 字）");
      this.pending = {
        key: crypto.randomUUID(), createKey: this.creation?.key ?? crypto.randomUUID(), prompt, budget: budgetMicros(budget),
        name: this.creation?.name ?? prompt.replace(/\s+/g, " ").slice(0, 160), agentId: this.creation?.agentId ?? this.agentId,
        versionIds: [...new Set(this.attachments.map(a => a.versionId!))],
        ...(this.conversation ? { conversationId: this.conversation.id, boundAgentId: this.conversation.agent_id } : {}),
      };
    }
    const p = this.pending;
    this.sending = true; this.notify();
    try {
      // Persist BEFORE each mutation: a closed panel can retry the exact receipt.
      await this.persist(s); if (!this.current(g)) return;
      if (!p.conversationId) {
        const c = await this.ensureConversation(s, g, { key: p.createKey, name: p.name, agentId: p.agentId });
        if (!c || !this.current(g)) return;
        p.conversationId = c.id; p.boundAgentId = c.agent_id; this.conversation = { ...c, messages: [], tasks: [] };
        await this.persist(s); if (!this.current(g)) return;
      }
      const accepted = await this.io.request(s, "/v1/tasks", "POST", {
        type: "delegation", project_id: s.project, agent_id: p.boundAgentId,
        conversation_id: p.conversationId, mode: "execute",
        input: { prompt: p.prompt, asset_version_ids: p.versionIds },
        budget: { currency: "HKD", amount_micros: p.budget },
      }, p.key);
      if (!this.current(g)) return;
      if (!uuid.test(accepted?.task_id)) throw new Error("Task acceptance was not confirmed / 未確認工作是否已接收");
      this.pending = undefined; this.draft = ""; this.attachments = [];
      await this.persist(s); if (!this.current(g)) return;
      await this.refresh();
    } catch (e: any) {
      if (this.current(g) && !this.pending) { this.pending = p; this.draft = p.prompt; }
      if (this.current(g) && e.status >= 400 && e.status < 500 && ![408, 429].includes(e.status)) {
        // An explicit transactional rejection is safe to edit. Transport/5xx
        // uncertainty retains the SAME body and key, never a new paid task.
        this.pending = undefined; await this.persist(s);
      }
      throw e;
    } finally { if (this.current(g)) { this.sending = false; this.notify(); } }
  }
  refresh() {
    if (this.poll) return this.poll;
    const g = this.generation;
    const work = this.load(g).catch(e => {
      if (this.current(g)) {
        this.unavailable = true; if (this.conversation) this.conversation = { ...this.conversation, messages: [] };
        this.projectConfiguration = null; this.projectConfigurationTaskId = "";
        this.activeTask = null; this.events = []; this.cursor = 0; this.inputRequests = []; this.notify();
      }
      throw e;
    }).finally(() => { if (this.current(g) && this.poll === work) this.poll = undefined; });
    this.poll = work; return work;
  }
  private async load(g: number) {
    const s = this.scope, id = this.conversation?.id;
    if (!s || this.loading) return;
    if (!id) {
      const brief = await this.io.request(s, chatBase(s) + "/project-configuration");
      if (this.current(g)) { this.acceptBrief(brief); this.unavailable = false; this.notify(); }
      return;
    }
    const c = await this.io.request(s, chatBase(s) + "/conversations/" + id);
    if (!this.current(g) || this.conversation?.id !== id) return;
    const t = c.tasks?.slice().reverse().find((t: any) => unfinished.has(t.status)) ?? c.tasks?.at(-1);
    let detail = null, events = this.events, cursor = this.cursor, inputRequests: any[] = [];
    const brief = await this.io.request(s, chatBase(s) + (t ? `/tasks/${t.id}/project-configuration` : "/project-configuration"));
    if (!this.current(g) || this.conversation?.id !== id) return;
    if (t) {
      const same = t.id === this.activeTask?.id;
      const [d, batch] = await Promise.all([
        this.io.request(s, chatBase(s) + "/tasks/" + t.id),
        this.io.request(s, chatBase(s) + "/tasks/" + t.id + "/events?after=" + (same ? this.cursor : 0)),
      ]);
      if (!this.current(g) || this.conversation?.id !== id) return;
      if (d.source_unavailable || d.content_state !== "active" || c.messages?.some((m: any) => m.source_unavailable))
        throw new Error("Conversation sources are unavailable / 會話來源暫不可用");
      detail = d; events = same ? [...this.events] : []; cursor = same ? this.cursor : 0;
      if (d.status === "needs_input") {
        const requested = await this.io.request(s, chatBase(s) + "/tasks/" + t.id + "/dependencies");
        if (!this.current(g) || this.conversation?.id !== id) return;
        inputRequests = requested.items;
      }
      for (const e of batch.items) {
        if (Number(e.id) > cursor) { events.push(e); cursor = Number(e.id); }
      }
      events = events.slice(-1000);
    }
    this.acceptBrief(brief, t?.id); this.conversation = c; this.activeTask = detail; this.events = events; this.cursor = cursor; this.unavailable = false;
    this.inputRequests = inputRequests; this.notify();
  }
  async answerInput(id: string, expectedVersion: number, answer: string) {
    const s = this.scope, g = this.generation, task = this.activeTask;
    if (!s || this.unavailable || task?.status !== "needs_input" || !this.inputRequests.some(d => d.id === id && d.kind === "question" && d.state === "pending" && d.version === expectedVersion))
      throw new Error("Refresh the current input request / 請重新整理目前的資料需求");
    await this.io.request(s, `/v1/tenants/${s.tenant}/task-dependencies/${id}/resolutions`, "POST", { expected_version: expectedVersion, answer }, crypto.randomUUID());
    if (!this.current(g) || this.activeTask?.id !== task.id) return;
    // A poll already in flight may contain the pre-answer snapshot.
    await this.poll;
    if (this.current(g) && this.activeTask?.id === task.id) await this.refresh();
  }
  async stop() {
    const s = this.scope, g = this.generation;
    const t = this.conversation?.tasks?.find((t: any) => unfinished.has(t.status));
    if (!s || !t) return;
    await this.io.request(s, chatBase(s) + "/tasks/" + t.id + "/cancel", "POST", {}, crypto.randomUUID());
    if (this.current(g)) await this.refresh();
  }
}
