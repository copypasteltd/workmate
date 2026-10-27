import { useEffect, useState } from "react";
import { FolderOpen, Upload, FileText, RefreshCw } from "lucide-react";
import { useWorkspace } from "./context";
import { api } from "./api";
import { useI18n, ErrorNotice, DateText, AsyncForm, Field } from "./ui";
export function NativeFiles({ onChange }: { onChange?: () => void }) {
  const { t } = useI18n(),
    w = useWorkspace(),
    [grants, setGrants] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [files, setFiles] = useState<any[]>([]),
    [relative, setRelative] = useState("."),
    [preview, setPreview] = useState(""),
    [error, setError] = useState<Error | null>(null),
    [notice, setNotice] = useState("");
  const bridge = window.copyPasteBridge;
  const load = async () => {
    if (bridge) setGrants(await bridge.localGrants());
  };
  useEffect(() => {
    void load().catch(setError);
  }, []);
  if (!bridge) return null;
  const command = (operation: string, path: string, content?: string) =>
    bridge.localFile({
      operation,
      grant_id: selected,
      path,
      content,
      request_id: crypto.randomUUID(),
    });
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e as Error);
    }
  };
  return (
    <section className="card section-block">
      <div className="section-title">
        <div>
          <p className="eyebrow">EXPLICIT ACCESS. LOCAL CONTROL.</p>
          <h2>{t("本機資料夾", "Local folders")}</h2>
        </div>
        <button
          className="button primary small"
          onClick={() =>
            void run(async () => {
              await bridge.chooseDirectory();
              await load();
            })
          }
        >
          <FolderOpen size={17} />
          {t("選擇資料夾", "Choose folder")}
        </button>
      </div>
      <p className="muted">
        {t(
          "授權有效一小時，可隨時撤銷。建立輸出只會新增檔案。",
          "Grants expire in one hour and can be revoked at any time. Output creates new files only.",
        )}
      </p>
      {bridge.enableChrome && (
        <button
          className="button secondary small"
          onClick={() =>
            void run(async () => {
              const r = await bridge.enableChrome();
              if (r.registered)
                setNotice(
                  t(
                    "Chrome 原生助手已連接，可從擴展選擇資料夾。",
                    "Chrome native helper connected. Choose folders from the extension.",
                  ),
                );
            })
          }
        >
          {t("連接 Chrome 原生助手", "Connect Chrome native helper")}
        </button>
      )}
      <ErrorNotice error={error} />
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {grants.map((g) => (
        <div className="version-row" key={g.id}>
          <FolderOpen size={17} />
          <strong>{g.label}</strong>
          <span className="muted">
            {g.operations.includes("file.write")
              ? "Read + create"
              : "Read only"}
          </span>
          <DateText value={g.expires_at} />
          <button
            className="text-button"
            onClick={() =>
              void run(async () => {
                await bridge.revokeGrant(g.id);
                if (selected === g.id) {
                  setSelected("");
                  setFiles([]);
                  setPreview("");
                }
                await load();
              })
            }
          >
            {t("撤銷", "Revoke")}
          </button>
        </div>
      ))}
      {grants.length > 0 && (
        <>
          <button
            className="button secondary small"
            onClick={() =>
              void run(async () => {
                await bridge.syncDevice(w.tenant);
                onChange?.();
                setNotice(
                  t(
                    "已同步授權至目前企業，雲端可排程限定操作。",
                    "Grants paired with this workspace. Bounded cloud commands can now be scheduled.",
                  ),
                );
              })
            }
          >
            <RefreshCw size={16} />
            {t("同步雲端排程權限", "Pair cloud scheduling")}
          </button>
          <div className="form-stack section-block">
            <Field label={t("資料夾授權", "Folder grant")}>
              <select
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setFiles([]);
                  setPreview("");
                }}
              >
                <option value="">{t("選擇授權", "Choose grant")}</option>
                {grants.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("相對路徑", "Relative path")}>
              <input
                value={relative}
                onChange={(e) => setRelative(e.target.value)}
                placeholder="."
              />
            </Field>
            <div className="row-actions">
              <button
                className="button secondary small"
                disabled={!selected}
                onClick={() =>
                  void run(async () =>
                    setFiles((await command("file.list", relative)).items),
                  )
                }
              >
                {t("列出檔案", "List files")}
              </button>
              <button
                className="button secondary small"
                disabled={!selected}
                onClick={() =>
                  void run(async () => {
                    const r = await command("file.read", relative);
                    const raw = Uint8Array.from(atob(r.base64), (c) =>
                      c.charCodeAt(0),
                    );
                    setPreview(new TextDecoder().decode(raw).slice(0, 50000));
                  })
                }
              >
                <FileText size={16} />
                {t("讀取預覽", "Read preview")}
              </button>
              <button
                className="button secondary small"
                disabled={!selected || !w.project}
                onClick={() =>
                  void run(async () => {
                    const r = await command("file.read", relative);
                    const bytes = Uint8Array.from(atob(r.base64), (c) =>
                      c.charCodeAt(0),
                    );
                    const form = new FormData();
                    form.append(
                      "file",
                      new File([bytes], r.name, {
                        type: "application/octet-stream",
                      }),
                    );
                    await api(w.base + "/assets", {
                      method: "POST",
                      body: form,
                    });
                    setNotice(
                      t(
                        "已上傳至目前專案。",
                        "Uploaded to the current project.",
                      ),
                    );
                  })
                }
              >
                <Upload size={16} />
                {t("上傳此檔至專案", "Upload file to project")}
              </button>
            </div>
            {files.map((f) => (
              <button
                className="version-row text-button"
                key={f.name}
                onClick={() =>
                  setRelative(
                    relative === "."
                      ? f.name
                      : relative.replace(/[\\/]$/, "") + "/" + f.name,
                  )
                }
              >
                {f.type === "directory" ? (
                  <FolderOpen size={16} />
                ) : (
                  <FileText size={16} />
                )}
                <span>{f.name}</span>
              </button>
            ))}
            {preview && <pre className="output-text">{preview}</pre>}
            {grants
              .find((g) => g.id === selected)
              ?.operations.includes("file.write") && (
              <AsyncForm
                submitLabel={t("建立新檔案", "Create new file")}
                onSubmit={async (f) => {
                  await command(
                    "file.write",
                    String(f.get("path")),
                    String(f.get("content")),
                  );
                  setNotice(t("新檔案已建立。", "New file created."));
                }}
              >
                <Field label={t("新檔案相對路徑", "New file relative path")}>
                  <input name="path" required placeholder="deliverable.txt" />
                </Field>
                <Field label={t("檔案內容", "File content")}>
                  <textarea name="content" rows={4} required />
                </Field>
              </AsyncForm>
            )}
          </div>
        </>
      )}
    </section>
  );
}
