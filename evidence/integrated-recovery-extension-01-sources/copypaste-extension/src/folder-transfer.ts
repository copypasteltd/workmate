import { ConversationState, type Attachment, type ChatScope } from "./conversation.js";
import { reviewFolder, selectFolderEntry, folderManifest, type FolderFile, type FolderPlan, type UploadedFolderFile } from "./folder-import.js";

interface Transfer { file?: File; digest?: string; attachment?: Attachment }
const digest = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
/** File handles/bytes live only in this panel. The worker retains scoped upload receipts. */
export class FolderTransfer {
  plan?: FolderPlan;
  phase: "review" | "uploading" | "failed" | "ready" = "review";
  error = "";
  completed = 0;
  private token?: string;
  private scope?: ChatScope;
  private conversation?: string;
  private epoch = 0;
  private running = false;
  private transfers = new Map<string, Transfer>();
  constructor(private chat: ConversationState, private changed: () => void) {}
  /** Discard a stale review before rendering it in another account/conversation. */
  get current() {
    if (this.plan && (this.scope !== this.chat.scope || (["review", "ready"].includes(this.phase) && this.conversation !== this.chat.conversation?.id)
      || ((this.phase === "uploading" || this.phase === "failed") && this.token && !this.chat.importActive(this.token)))) this.clear();
    return this.plan;
  }
  private clear() {
    ++this.epoch; this.plan = undefined; this.token = undefined; this.scope = undefined;
    this.transfers.clear(); this.running = false; this.error = ""; this.completed = 0; this.phase = "review";
  }
  cancel() {
    const token = this.token; this.clear();
    if (token) this.chat.cancelImport(token);
    this.changed();
  }
  choose(files: readonly FolderFile[]) {
    if (this.chat.loading || this.chat.sending || this.chat.pending || this.chat.preparing || !this.chat.scope)
      throw new Error("Wait for the current work before choosing a folder / 請等待目前工作完成，再選擇資料夾");
    const plan = reviewFolder(files, 20 - this.chat.attachments.length);
    this.clear(); this.plan = plan; this.scope = this.chat.scope; this.conversation = this.chat.conversation?.id;
    this.changed();
  }
  select(id: string, selected: boolean) {
    const plan = this.current;
    if (!plan || this.phase !== "review") return;
    try { selectFolderEntry(plan, id, selected); this.error = ""; }
    catch (error) { this.error = error instanceof Error ? error.message : String(error); this.changed(); throw error; }
    this.changed();
  }
  get reviewIssue(): "conversation" | "busy" | "uploading" | "failed_attachment" | "capacity" | "empty" | null {
    if (!this.current || this.phase !== "review") return null;
    if (!this.chat.scope || this.chat.unavailable) return "conversation";
    if (this.chat.loading || this.chat.sending || this.chat.pending || this.chat.preparing) return "busy";
    if (this.chat.attachments.some(a => a.state === "failed")) return "failed_attachment";
    if (this.chat.attachments.some(a => a.state !== "ready")) return "uploading";
    const count = this.plan!.entries.filter(e => e.selected).length;
    if (!count) return "empty";
    return count + this.chat.attachments.length + 1 > 20 ? "capacity" : null;
  }
  private active(epoch: number, token: string) { return epoch === this.epoch && this.chat.importActive(token); }
  async start() {
    const plan = this.current;
    if (!plan || this.running || !["review", "failed"].includes(this.phase)) return;
    const selected = plan.entries.filter(e => e.selected);
    let token: string;
    try {
      if (!selected.length) throw new Error("Select at least one file / 請至少選取一個檔案");
      token = this.token ?? this.chat.beginImport(selected.length + 1);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error); this.changed(); throw error;
    }
    const epoch = this.epoch;
    this.token = token; this.running = true; this.phase = "uploading"; this.error = ""; this.changed();
    try {
      const upload = async (key: string, make: () => Promise<File>) => {
        const item = this.transfers.get(key) ?? {}; this.transfers.set(key, item);
        if (item.attachment?.state === "ready") return item.attachment;
        if (!item.file) {
          const file = await make(); if (!this.active(epoch, token)) return;
          const hash = await digest(await file.arrayBuffer()); if (!this.active(epoch, token)) return;
          item.file = file; item.digest = hash;
        }
        const result = item.attachment
          ? await this.chat.retryImportAttachment(item.attachment.id, item.file, token, item.digest)
          : await this.chat.attach(item.file, token, item.digest);
        if (!this.active(epoch, token)) return;
        if (!result) throw new Error("Folder upload was interrupted / 資料夾上傳已中斷");
        item.attachment = result;
        if (result.state !== "ready") throw new Error(result.error || "Folder upload failed / 資料夾上傳失敗");
        item.file = undefined; // Release successful copies; the immutable version is sufficient.
        return result;
      };
      const uploaded: UploadedFolderFile[] = [];
      for (const entry of selected) {
        const a = await upload(entry.id, async () => new File([await entry.file.arrayBuffer()], entry.uploadName, { type: entry.file.type || "application/octet-stream" }));
        if (!a || !this.active(epoch, token)) return;
        uploaded.push({ relativePath: entry.relativePath, uploadName: entry.uploadName, assetId: a.assetId!, versionId: a.versionId!, sha256: a.sha256!, bytes: a.size });
        this.completed = uploaded.length; this.changed();
      }
      const manifest = folderManifest(plan, uploaded);
      await upload("manifest", async () => new File([JSON.stringify(manifest, null, 2) + "\n"], "folder-index-" + plan.id + ".json", { type: "application/json" }));
      if (!this.active(epoch, token)) return;
      this.phase = "ready"; this.conversation = this.chat.conversation?.id;
      this.chat.completeImport(token); this.token = undefined; this.transfers.clear(); this.changed();
    } catch (error) {
      if (this.active(epoch, token)) { this.phase = "failed"; this.error = error instanceof Error ? error.message : String(error); this.changed(); }
    } finally { if (epoch === this.epoch) this.running = false; }
  }
}
