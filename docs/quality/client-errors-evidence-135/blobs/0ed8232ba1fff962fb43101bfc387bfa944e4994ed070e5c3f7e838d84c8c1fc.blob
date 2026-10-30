/** Only browser-selected files enter this plan; discovery never reads file bytes. */
export const folderLimits = Object.freeze({ candidates: 1000, attachments: 20, fileBytes: 5 * 1024 * 1024 });
export function folderBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
export interface FolderFile {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly webkitRelativePath: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface FolderEntry {
  readonly id: string;
  readonly relativePath: string;
  readonly uploadName: string;
  readonly file: FolderFile;
  readonly defaultExcluded: boolean;
  readonly unavailable: "empty" | "too_large" | null;
  selected: boolean;
}
export interface FolderPlan {
  readonly id: string;
  readonly root: string;
  readonly entries: FolderEntry[];
  readonly capacity: number;
}
const ignored = new Set(["node_modules", "dist", "build", "coverage", "__pycache__", "vendor"]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function shortName(value: string, max: number) {
  let result = "";
  for (const char of value) {
    if (result.length + char.length > max) break;
    result += char;
  }
  return result;
}
function pathOf(file: FolderFile) {
  const path = file.webkitRelativePath;
  if (typeof path !== "string" || path.length > 512 || /[\\\x00-\x1f\x7f]/.test(path))
    throw new Error("Choose a folder with relative file paths / 請透過資料夾選擇器選取檔案");
  const parts = path.split("/");
  if (parts.length < 2 || parts.length > 14 || parts.some(p => !p || p === "." || p === ".." || p.includes(":"))
    || parts.at(-1) !== file.name || typeof file.name !== "string" || !file.name
    || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.type !== "string" || file.type.length > 120)
    throw new Error("The selected folder contains an invalid relative path / 所選資料夾含有無效相對路徑");
  return parts;
}
export function reviewFolder(files: readonly FolderFile[], remainingAttachments: number = folderLimits.attachments): FolderPlan {
  if (!files.length || files.length > folderLimits.candidates)
    throw new Error("Choose a folder containing 1–1,000 files / 請選擇含有 1 至 1,000 個檔案的資料夾");
  if (!Number.isInteger(remainingAttachments) || remainingAttachments < 2 || remainingAttachments > folderLimits.attachments)
    throw new Error("Leave room for a file and its folder index / 請先移除附件，為檔案及目錄索引預留位置");
  const candidates = files.map(file => ({ file, parts: pathOf(file) }));
  const root = candidates[0].parts[0], paths = new Set<string>();
  for (const { parts } of candidates) {
    const path = parts.slice(1).join("/");
    if (parts[0] !== root || paths.has(path))
      throw new Error("Choose one folder without duplicate paths / 請選擇一個沒有重複路徑的資料夾");
    paths.add(path);
  }
  candidates.sort((a, b) => {
    const x = a.parts.slice(1).join("/"), y = b.parts.slice(1).join("/");
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const capacity = remainingAttachments - 1;
  let chosen = 0;
  const entries = candidates.map(({ file, parts }, index): FolderEntry => {
    const defaultExcluded = parts.slice(1).some(part => part.startsWith(".") || ignored.has(part.toLowerCase()));
    const unavailable = file.size === 0 ? "empty" : file.size > folderLimits.fileBytes ? "too_large" : null;
    const selected = !defaultExcluded && !unavailable && chosen < capacity;
    if (selected) chosen++;
    return {
      id: crypto.randomUUID(), relativePath: parts.slice(1).join("/"), file,
      uploadName: shortName(root, 40) + "-" + String(index + 1).padStart(4, "0") + "-" + shortName(file.name, 120),
      defaultExcluded, unavailable, selected,
    };
  });
  return { id: crypto.randomUUID(), root, entries, capacity };
}
export function selectFolderEntry(plan: FolderPlan, id: string, selected: boolean) {
  const entry = plan.entries.find(e => e.id === id);
  if (!entry || entry.unavailable) throw new Error("This file cannot be selected / 無法選取此檔案");
  if (selected && !entry.selected && plan.entries.filter(e => e.selected).length >= plan.capacity)
    throw new Error(`Select up to ${plan.capacity} files; one attachment stores the folder index / 最多選取 ${plan.capacity} 個檔案，另預留一個目錄索引附件`);
  entry.selected = selected;
}
export interface UploadedFolderFile {
  relativePath: string;
  uploadName: string;
  assetId: string;
  versionId: string;
  sha256: string;
  bytes: number;
}
/** The cloud receives relative paths plus exact private versions, never local handles. */
export function folderManifest(plan: FolderPlan, uploaded: readonly UploadedFolderFile[]) {
  const selected = plan.entries.filter(e => e.selected);
  if (!selected.length || selected.length > plan.capacity || selected.length !== uploaded.length)
    throw new Error("Finish the selected folder files before creating its index / 請先完成所選檔案再建立目錄索引");
  const byPath = new Map(uploaded.map(u => [u.relativePath, u]));
  if (byPath.size !== uploaded.length || new Set(uploaded.map(u => u.versionId)).size !== uploaded.length)
    throw new Error("Folder upload receipts are duplicated / 資料夾上傳回執重複");
  const files = selected.map(entry => {
    const u = byPath.get(entry.relativePath);
    if (!u || u.uploadName !== entry.uploadName || u.bytes !== entry.file.size || !uuid.test(u.assetId)
      || !uuid.test(u.versionId) || !/^[a-f0-9]{64}$/.test(u.sha256))
      throw new Error("A selected file upload has not been verified / 尚未確認所選檔案的上傳結果");
    return { relative_path: entry.relativePath, uploaded_filename: u.uploadName, asset_id: u.assetId,
      asset_version_id: u.versionId, sha256: u.sha256, size_bytes: u.bytes,
      content_type: entry.file.type || "application/octet-stream" };
  });
  return { protocol: "copypaste.selected-folder.v1", folder: plan.root, files };
}
