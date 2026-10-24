/** Cloud conversation state. No local Agent, filesystem paths or model keys. */
export interface ChatScope { actor: string; tenant: string; project: string }
export interface Attachment {
  id: string; name: string; type: string; size: number;
  state: "uploading" | "ready" | "failed"; versionId?: string; error?: string;
}
export interface ChatIO {
  request(scope: ChatScope, path: string, method?: string, body?: unknown, key?: string): Promise<any>;
  upload(scope: ChatScope, file: File): Promise<any>;
  read(key: string): Promise<any>;
  write(key: string, value: unknown): Promise<void>;
  changed(): void;
}
interface Pending {
  key: string; createKey: string; name: string; agentId: string;
  prompt: string; budget: string; versionIds: string[];
  conversationId?: string; boundAgentId?: string;
}
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
  attachments: Attachment[] = [];
  draft = "";
  agentId = "";
  loading = false;
  sending = false;
  unavailable = false;
  pending?: Pending;
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
    const value = { conversationId: this.conversation?.id ?? null, pending: this.pending ?? null };
    const work = this.storageTail.catch(() => {}).then(() => this.io.write(this.storageKey(s), value));
    this.storageTail = work;
    return work;
  }
  reset() {
    ++this.generation; this.scope = undefined; this.agents = []; this.history = [];
    this.conversation = null; this.attachments = []; this.draft = ""; this.agentId = "";
    this.loading = false; this.sending = false; this.unavailable = false; this.pending = undefined;
    this.activeTask = null; this.events = []; this.cursor = 0; this.poll = undefined;
    this.notify();
  }
  async open(scope: ChatScope) {
    if (![scope.actor, scope.tenant, scope.project].every(id => uuid.test(id))) throw new Error("Invalid conversation scope");
    this.reset(); this.scope = { ...scope }; this.loading = true;
    const g = this.generation, s = this.scope;
    this.notify();
    try {
      await this.storageTail.catch(() => {});
      const [agents, history, saved] = await Promise.all([
        this.io.request(s, chatBase(s) + "/agents"),
        this.io.request(s, chatBase(s) + "/conversations"), this.io.read(this.storageKey(s)),
      ]);
      if (!this.current(g)) return;
      this.agents = agents.items.filter((a: any) => a.enabled && a.content_state === "active");
      this.history = history.items;
      // Saved state is a receipt, never authority. Server rechecks every read/write.
      if (saved?.pending && this.validPending(saved.pending)) {
        this.pending = saved.pending; this.draft = this.pending!.prompt;
      }
      const id = this.pending?.conversationId ?? saved?.conversationId;
      if (typeof id === "string" && uuid.test(id)) {
        const c = await this.io.request(s, chatBase(s) + "/conversations/" + id);
        if (!this.current(g)) return;
        this.conversation = c;
      }
    } finally { if (this.current(g)) { this.loading = false; this.notify(); } }
  }
  private validPending(p: any): p is Pending {
    return p && uuid.test(p.key) && uuid.test(p.createKey) && typeof p.prompt === "string" && p.prompt.length <= 30000
      && typeof p.name === "string" && p.name.length <= 160 && typeof p.budget === "string" && /^\d{1,13}$/.test(p.budget)
      && typeof p.agentId === "string" && (p.agentId === "" || uuid.test(p.agentId))
      && Array.isArray(p.versionIds) && p.versionIds.length <= 20 && p.versionIds.every((id: any) => typeof id === "string" && uuid.test(id))
      && (!p.conversationId || uuid.test(p.conversationId)) && (!p.boundAgentId || uuid.test(p.boundAgentId));
  }
  async select(id: string) {
    if (id && !uuid.test(id)) throw new Error("Invalid conversation identity");
    if (!this.scope || this.sending || this.pending) throw new Error("Resolve the pending message first / 請先確認待發送訊息");
    const s = this.scope, g = ++this.generation;
    this.loading = true; this.unavailable = false; this.poll = undefined; this.attachments = []; this.draft = ""; this.activeTask = null; this.events = []; this.cursor = 0;
    this.conversation = null; this.notify();
    try {
      const c = id ? await this.io.request(s, chatBase(s) + "/conversations/" + id) : null;
      if (!this.current(g)) return;
      this.conversation = c; await this.persist(s);
    } finally { if (this.current(g)) { this.loading = false; this.notify(); } }
  }
  removeAttachment(id: string) {
    if (this.sending || this.pending) return;
    this.attachments = this.attachments.filter(a => a.id !== id); this.notify();
  }
  async attach(file: File) {
    if (!this.scope || this.sending || this.pending || this.loading) throw new Error("Wait for the current message / 請等待目前訊息");
    if (this.attachments.length >= 20) throw new Error("Up to 20 attachments / 最多 20 個附件");
    if (file.size > 5 * 1024 * 1024 || !file.size) throw new Error("Choose a non-empty file up to 5 MiB / 請選擇不超過 5 MiB 的非空檔案");
    const s = this.scope, g = this.generation;
    const a: Attachment = { id: crypto.randomUUID(), name: file.name, type: file.type || "application/octet-stream", size: file.size, state: "uploading" };
    this.attachments.push(a); this.notify();
    try {
      const asset = await this.io.upload(s, file);
      if (!this.current(g) || !this.attachments.includes(a)) return;
      if (!uuid.test(asset?.version?.id)) throw new Error("Upload did not return an immutable file version / 上傳未傳回檔案版本");
      a.versionId = asset.version.id; a.state = "ready";
    } catch (e) {
      if (!this.current(g) || !this.attachments.includes(a)) return;
      a.state = "failed"; a.error = e instanceof Error ? e.message : String(e);
    } finally { if (this.current(g)) this.notify(); }
  }
  get busy() { return !!this.conversation?.tasks?.some((t: any) => unfinished.has(t.status)); }
  get progress() { return { task: this.activeTask, events: this.events }; }
  async send(budget: string) {
    if (!this.scope || this.loading || this.sending) return;
    if (this.unavailable) throw new Error("Refresh this conversation before sending / 請先重新整理會話");
    if (!this.pending && this.busy) throw new Error("Finish or stop the current work before sending / 請先完成或停止目前工作");
    if (!this.pending && this.attachments.some(a => a.state !== "ready")) throw new Error("Wait for uploads, or remove failed attachments / 請等待上傳完成或移除失敗附件");
    const s = this.scope, g = this.generation;
    if (!this.pending) {
      const prompt = this.draft.trim();
      if (!prompt || prompt.length > 30000) throw new Error("Write a message (up to 30,000 characters) / 請輸入訊息（最多 30,000 字）");
      this.pending = {
        key: crypto.randomUUID(), createKey: crypto.randomUUID(), prompt, budget: budgetMicros(budget),
        name: prompt.replace(/\s+/g, " ").slice(0, 160), agentId: this.agentId,
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
        const c = await this.io.request(s, chatBase(s) + "/conversations", "POST", {
          name: p.name, ...(p.agentId ? { agent_id: p.agentId } : {}),
        }, p.createKey);
        if (!this.current(g)) return;
        if (!uuid.test(c?.id) || !uuid.test(c?.agent_id)) throw new Error("Conversation acceptance was not confirmed");
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
      if (this.current(g) && this.conversation) {
        this.unavailable = true; this.conversation = { ...this.conversation, messages: [] };
        this.activeTask = null; this.events = []; this.cursor = 0; this.notify();
      }
      throw e;
    }).finally(() => { if (this.current(g) && this.poll === work) this.poll = undefined; });
    this.poll = work; return work;
  }
  private async load(g: number) {
    const s = this.scope, id = this.conversation?.id;
    if (!s || !id || this.loading) return;
    const c = await this.io.request(s, chatBase(s) + "/conversations/" + id);
    if (!this.current(g) || this.conversation?.id !== id) return;
    const t = c.tasks?.slice().reverse().find((t: any) => unfinished.has(t.status)) ?? c.tasks?.at(-1);
    let detail = null, events = this.events, cursor = this.cursor;
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
      for (const e of batch.items) {
        if (Number(e.id) > cursor) { events.push(e); cursor = Number(e.id); }
      }
      events = events.slice(-1000);
    }
    this.conversation = c; this.activeTask = detail; this.events = events; this.cursor = cursor; this.unavailable = false;
    this.notify();
  }
  async stop() {
    const s = this.scope, g = this.generation;
    const t = this.conversation?.tasks?.find((t: any) => unfinished.has(t.status));
    if (!s || !t) return;
    await this.io.request(s, chatBase(s) + "/tasks/" + t.id + "/cancel", "POST", {}, crypto.randomUUID());
    if (this.current(g)) await this.refresh();
  }
}
