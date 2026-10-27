import { chatBase, type ChatScope } from "./conversation.js";

interface UploadIO {
  request(scope: ChatScope, path: string, method?: string, body?: unknown, key?: string): Promise<any>;
  read(key: string): Promise<any>;
  write(key: string, value: unknown): Promise<void>;
}
interface SelectedFile { name: string; type: string; base64: string }
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const sha = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer))].map(b => b.toString(16).padStart(2, "0")).join("");
function encoded(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}

/** Resumes only an exact selected file in its original user's private conversation. */
export class PrivateChatUploads {
  private inflight = new Map<string, Promise<any>>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private io: UploadIO) {}
  async upload(scope: ChatScope, conversationId: string, file: SelectedFile) {
    if (![scope?.actor, scope?.tenant, scope?.project, conversationId].every(id => typeof id === "string" && uuid.test(id)))
      throw new Error("Invalid private upload scope");
    if (!file || typeof file.name !== "string" || !file.name || file.name.length > 180 || /[\x00-\x1f\\/]/.test(file.name)
      || typeof file.type !== "string" || file.type.length > 120 || typeof file.base64 !== "string"
      || !file.base64.length || file.base64.length > 7_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.base64))
      throw new Error("Choose a non-empty file up to 5 MiB / 請選擇不超過 5 MiB 的非空檔案");
    const raw = atob(file.base64), bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
    if (!bytes.length || bytes.length > 5 * 1024 * 1024 || encoded(bytes) !== file.base64) throw new Error("Invalid selected file bytes");
    const digest = await sha(bytes), type = file.type || "application/octet-stream";
    const identity = await sha(new TextEncoder().encode(JSON.stringify([scope.actor, scope.tenant, scope.project, conversationId, file.name, type, digest, bytes.length])));
    const key = `chat-upload:${scope.actor}:${scope.tenant}:${scope.project}:${identity}`;
    const existing = this.inflight.get(key); if (existing) return existing;
    // Serialize file transfers so twenty attachments cannot exhaust ten reserved upload slots.
    const work = this.tail.catch(() => {}).then(() => this.transfer(scope, conversationId, file.name, type, bytes, digest, key))
      .finally(() => { if (this.inflight.get(key) === work) this.inflight.delete(key); });
    this.inflight.set(key, work); this.tail = work; return work;
  }
  private async transfer(scope: ChatScope, conversationId: string, name: string, type: string, bytes: Uint8Array, digest: string, key: string) {
    const base = chatBase(scope) + "/uploads", saved = await this.io.read(key);
    const receipt = saved && uuid.test(saved.createKey) && (!saved.uploadId || uuid.test(saved.uploadId))
      ? { createKey: saved.createKey as string, uploadId: saved.uploadId as string | undefined }
      : { createKey: crypto.randomUUID(), uploadId: undefined as string | undefined };
    await this.io.write(key, receipt);
    try {
      if (!receipt.uploadId) {
        const accepted = await this.io.request(scope, base, "POST", {
          project_id: scope.project, conversation_id: conversationId, filename: name, content_type: type, size_bytes: bytes.length, sha256: digest,
        }, receipt.createKey);
        if (!uuid.test(accepted?.upload_id)) throw new Error("Private upload acceptance was not confirmed");
        receipt.uploadId = accepted.upload_id; await this.io.write(key, receipt);
      }
      const path = base + "/" + receipt.uploadId;
      const current = await this.io.request(scope, path);
      if (current?.upload_id !== receipt.uploadId || current.size_bytes !== bytes.length || current.sha256 !== digest
        || !Number.isInteger(current.part_size_bytes) || current.part_size_bytes < 1 || current.part_size_bytes > 4 * 1024 * 1024
        || !["pending", "completed"].includes(current.state) || !Array.isArray(current.parts)) throw new Error("Private upload manifest could not be verified");
      const parts = new Map<number, any>(), count = Math.ceil(bytes.length / current.part_size_bytes);
      for (const part of current.parts) {
        if (!Number.isInteger(part.part_index) || part.part_index < 0 || part.part_index >= count || parts.has(part.part_index)) throw new Error("Invalid retained upload parts");
        parts.set(part.part_index, part);
      }
      for (let index = 0; index < count; index++) {
        const chunk = bytes.subarray(index * current.part_size_bytes, (index + 1) * current.part_size_bytes), hash = await sha(chunk), old = parts.get(index);
        if (old && (old.sha256 !== hash || old.size_bytes !== chunk.length)) throw new Error("Retained upload bytes do not match this selected file");
        if (current.state === "pending" && !old) await this.io.request(scope, path + "/parts/" + index, "POST", { sha256: hash, base64: encoded(chunk) }, receipt.createKey);
        if (current.state === "completed" && !old) throw new Error("Completed upload is missing verified parts");
      }
      // Completion rechecks current ownership, source state and conversation on the server.
      const asset = await this.io.request(scope, path + "/complete", "POST", { sha256: digest, size_bytes: bytes.length }, receipt.createKey);
      if (!uuid.test(asset?.id) || !uuid.test(asset?.version?.id) || asset.private_owner !== scope.actor
        || asset.tenant_id !== scope.tenant || asset.project_id !== scope.project || asset.version.metadata?.conversation_id !== conversationId
        || asset.version.sha256 !== digest || Number(asset.version.bytes) !== bytes.length) throw new Error("Private file ownership was not confirmed / 未能確認檔案的私人會話歸屬");
      return asset;
    } catch (e: any) {
      if (e.status === 410 && e.code === "UPLOAD_EXPIRED") await this.io.write(key, null);
      throw e;
    }
  }
}
