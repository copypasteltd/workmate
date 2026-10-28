import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Folder,
  FileText,
  Plus,
  Search,
  Upload,
  Download,
  ArrowUpRight,
  ChevronRight,
  RefreshCw,
  Trash2,
  Link2,
  Pencil,
} from "lucide-react";
import { api, post, patch, download } from "./api";
import { useWorkspace } from "./context";
import {
  AsyncForm,
  DateText,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  Modal,
  PageHeader,
  useData,
  useI18n,
} from "./ui";
import { ResumableUpload } from "./resumable-upload";
type Node = {
  id: string;
  workspace_id: string;
  project_id: string;
  parent_id?: string;
  name: string;
  kind: "directory" | "file";
  asset_version_id?: string;
  version: number;
  updated_at: string;
  root_kind?: string;
  reference_state?: string;
};
function usePage(url: string, refresh = 0) {
  const [items, setItems] = useState<any[]>([]),
    [next, setNext] = useState<string | undefined>(),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<Error | null>(null),
    controller = useRef<AbortController | undefined>(undefined),
    previousUrl = useRef(url);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    if (previousUrl.current !== url) {
      setItems([]);
      setNext(undefined);
      previousUrl.current = url;
    }
    setError(null);
    setLoading(true);
    void api(url, { signal: c.signal })
      .then((d) => {
        if (!c.signal.aborted) {
          setItems(d.items);
          setNext(d.next_cursor);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [url, refresh]);
  const more = async () => {
    if (!next || loading) return;
    const c = controller.current;
    if (!c) return;
    setLoading(true);
    try {
      const d = await api(
        url + (url.includes("?") ? "&" : "?") + "cursor=" + next,
        { signal: c.signal },
      );
      if (!c.signal.aborted) {
        setItems((old) => [
          ...old,
          ...d.items.filter((n: any) => !old.some((x) => x.id === n.id)),
        ]);
        setNext(d.next_cursor);
      }
    } catch (e) {
      if (!c.signal.aborted) setError(e as Error);
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  };
  return { items, next, loading, error, more };
}
function rootLabel(n: Node, t: (zh: string, en: string) => string) {
  return (
    (
      {
        attachments: t("會話附件", "Attachments"),
        working_files: t("工作檔案", "Working files"),
        project_materials: t("專案資料", "Project materials"),
        deliverables: t("交付產物", "Deliverables"),
      } as Record<string, string>
    )[n.root_kind ?? ""] ?? n.name
  );
}
export function CloudFiles() {
  const w = useWorkspace();
  return <CloudFilesView key={w.base} />;
}
function CloudFilesView() {
  const w = useWorkspace(),
    { t } = useI18n(),
    [params] = useSearchParams(),
    [refresh, setRefresh] = useState(0),
    [workspaceId, setWorkspaceId] = useState("");
  const spaces = usePage(w.base + "/cloud-workspaces?limit=100", refresh),
    conversations = useData(w.base + "/conversations", refresh);
  const requested = params.get("conversation");
  const selected =
    spaces.items.find((x) => x.id === workspaceId) ??
    spaces.items.find((x) =>
      requested ? x.conversation_id === requested : x.kind === "project",
    ) ??
    spaces.items[0];
  const changed = () => setRefresh((v) => v + 1);
  return (
    <>
      <PageHeader
        eyebrow="A PLACE FOR EVERY PIECE."
        title={t("雲端檔案", "Cloud files")}
        description={t(
          "整理專案資料、私人附件、工作檔案與交付版本。會話檔案僅自己可見，主動發佈的副本才與專案共用。",
          "Organize project materials, private attachments, working files and deliverables. Conversation files stay private; publish a copy when your project is ready to use it.",
        )}
        action={
          <button className="button secondary" onClick={changed}>
            <RefreshCw size={16} />
            {t("重新整理", "Refresh")}
          </button>
        }
      />
      <ErrorNotice error={spaces.error ?? conversations.error} />
      {spaces.items.length > 0 && (
        <div className="cloud-workspace-choice">
          <Field label={t("檔案範圍", "File workspace")}>
            <select
              value={selected?.id ?? ""}
              onChange={(e) => setWorkspaceId(e.target.value)}
            >
              {spaces.items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.kind === "project"
                    ? t("專案共用資料", "Shared project files")
                    : t("私人會話：", "Private conversation: ") +
                      (conversations.data?.items.find(
                        (c: any) => c.id === x.conversation_id,
                      )?.name ?? t("會話檔案", "Conversation files"))}
                </option>
              ))}
            </select>
          </Field>
          {spaces.next && (
            <button
              className="text-button"
              disabled={spaces.loading}
              onClick={() => void spaces.more()}
            >
              {t("載入更多會話", "Load more conversations")}
            </button>
          )}
        </div>
      )}
      {selected ? (
        <FileBrowser
          key={selected.id}
          space={selected}
          shared={spaces.items.find((x) => x.kind === "project")}
          refresh={refresh}
          changed={changed}
        />
      ) : spaces.loading ? (
        <Loading />
      ) : (
        <Empty
          icon={Folder}
          title={t("準備你的檔案空間", "Preparing your file workspace")}
          body={t(
            "重新整理以載入專案檔案。",
            "Refresh to load your project files.",
          )}
        />
      )}
    </>
  );
}
function FileBrowser({
  space,
  shared,
  refresh,
  changed,
}: {
  space: any;
  shared: any;
  refresh: number;
  changed: () => void;
}) {
  const w = useWorkspace(),
    { t } = useI18n(),
    [crumbs, setCrumbs] = useState<Node[]>([]),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [create, setCreate] = useState(false),
    [editing, setEditing] = useState<Node | null>(null),
    [removing, setRemoving] = useState<Node | null>(null),
    [preview, setPreview] = useState<Node | null>(null),
    [publishing, setPublishing] = useState<Node | null>(null),
    [upload, setUpload] = useState(false);
  const parent = crumbs.at(-1),
    base = `${w.base}/cloud-workspaces/${space.id}/nodes`,
    roots = useData(base, refresh),
    files = usePage(
      base +
        "?limit=100" +
        (query
          ? "&q=" + encodeURIComponent(query)
          : parent
            ? "&parent_id=" + parent.id
            : ""),
      refresh,
    );
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const open = (n: Node) => {
    setSearch("");
    setQuery("");
    setCrumbs((old) => (query ? [n] : [...old, n]));
  };
  return (
    <>
      <div className="cloud-toolbar">
        <label className="cloud-search">
          <Search size={17} />
          <input
            aria-label={t("搜尋雲端檔案", "Search cloud files")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("搜尋此範圍的檔案…", "Search this workspace…")}
          />
        </label>
        <button className="button secondary" onClick={() => setCreate(true)}>
          <Plus size={16} />
          {t("新增項目", "New entry")}
        </button>
        <button className="button primary" onClick={() => setUpload(true)}>
          <Upload size={16} />
          {t("上傳檔案", "Upload file")}
        </button>
      </div>
      <div className="cloud-layout">
        <aside
          className="cloud-folders"
          aria-label={t("預設資料夾", "Workspace folders")}
        >
          <p className="eyebrow">
            {space.kind === "project"
              ? t("專案共用", "SHARED PROJECT")
              : t("僅自己可見", "PRIVATE TO YOU")}
          </p>
          {roots.data?.items
            .filter((n: Node) => n.root_kind)
            .map((n: Node) => (
              <button
                key={n.id}
                className={crumbs[0]?.id === n.id ? "active" : ""}
                onClick={() => {
                  setSearch("");
                  setQuery("");
                  setCrumbs([n]);
                }}
              >
                <Folder size={18} />
                {rootLabel(n, t)}
              </button>
            ))}
          <p className="muted small-text">
            {t(
              "資料與版本會持續保存，檔案保留期限以素材頁面為準。",
              "Files and version references persist between sessions. Retention dates are shown in Assets & deliverables.",
            )}
          </p>
        </aside>
        <section className="card cloud-list">
          <nav
            className="cloud-breadcrumbs"
            aria-label={t("目前資料夾", "Current folder")}
          >
            <button
              onClick={() => {
                setCrumbs([]);
                setSearch("");
                setQuery("");
              }}
            >
              {t("所有資料夾", "All folders")}
            </button>
            {crumbs.map((n, i) => (
              <span key={n.id}>
                <ChevronRight size={14} />
                <button
                  onClick={() => {
                    setCrumbs(crumbs.slice(0, i + 1));
                    setSearch("");
                    setQuery("");
                  }}
                >
                  {rootLabel(n, t)}
                </button>
              </span>
            ))}
          </nav>
          <ErrorNotice error={files.error ?? roots.error} />
          <div role="status" className="muted small-text">
            {query
              ? t("搜尋結果：", "Search results: ") + query
              : parent
                ? rootLabel(parent, t)
                : t("選擇資料夾開始整理", "Choose a folder to get organized")}
          </div>
          {files.items.map((n: Node) => (
            <article className="cloud-file-row" key={n.id}>
              <div className="cloud-file-name">
                {n.kind === "directory" ? (
                  <Folder size={21} />
                ) : (
                  <FileText size={21} />
                )}
                <button
                  className="text-button"
                  onClick={() =>
                    n.kind === "directory" ? open(n) : setPreview(n)
                  }
                >
                  <strong>{rootLabel(n, t)}</strong>
                </button>
                {n.kind === "file" && n.reference_state !== "ready" && (
                  <span className="cloud-reference-warning">
                    {n.reference_state === "deleted"
                      ? t("來源已刪除", "Source deleted")
                      : t("暫時無法使用", "Unavailable")}
                  </span>
                )}
              </div>
              <div className="cloud-file-meta">
                <span>
                  {n.kind === "directory"
                    ? t("資料夾", "Folder")
                    : t("固定版本", "Pinned version")}
                </span>
                <DateText value={n.updated_at} />
              </div>
              <div className="row-actions">
                {n.kind === "file" && (
                  <button className="text-button" onClick={() => setPreview(n)}>
                    <Link2 size={14} />
                    {t("預覽及引用", "Preview & reference")}
                  </button>
                )}
                {!n.root_kind && (
                  <>
                    <button
                      className="text-button"
                      onClick={() => setEditing(n)}
                    >
                      <Pencil size={14} />
                      {t("編輯或移動", "Edit or move")}
                    </button>
                    {space.kind === "conversation" &&
                      n.kind === "file" &&
                      n.reference_state === "ready" && (
                        <button
                          className="text-button"
                          onClick={() => setPublishing(n)}
                        >
                          <ArrowUpRight size={14} />
                          {t("發佈副本", "Publish copy")}
                        </button>
                      )}
                    <button
                      className="text-button"
                      onClick={() => setRemoving(n)}
                    >
                      <Trash2 size={14} />
                      {t("移除項目", "Remove entry")}
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
          {!files.items.length && !files.loading && (
            <Empty
              icon={Folder}
              title={t(
                "留一點空間，給下一個好想法。",
                "Room for your next good idea.",
              )}
              body={t(
                "上傳檔案，或加入既有素材的指定版本。",
                "Upload a file or reference an exact version of an existing asset.",
              )}
            />
          )}
          {files.loading && <Loading />}
          {files.next && (
            <button
              className="button secondary"
              disabled={files.loading}
              onClick={() => void files.more()}
            >
              {t("載入更多檔案", "Load more files")}
            </button>
          )}
        </section>
      </div>
      {create && (
        <NodeEditor
          space={space}
          parent={parent?.id}
          onClose={() => setCreate(false)}
          onDone={() => {
            setCreate(false);
            changed();
          }}
        />
      )}
      {editing && (
        <NodeEditor
          space={space}
          initial={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            setCrumbs([]);
            changed();
          }}
        />
      )}
      {preview && <Preview node={preview} onClose={() => setPreview(null)} />}
      {removing && (
        <RemoveEntry
          node={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null);
            changed();
          }}
        />
      )}
      {publishing && shared && (
        <PublishEntry
          node={publishing}
          shared={shared}
          onClose={() => setPublishing(null)}
          onDone={() => {
            setPublishing(null);
            changed();
          }}
        />
      )}
      {upload && (
        <Modal
          title={
            space.kind === "conversation"
              ? t("上傳私人會話附件", "Upload private attachment")
              : t("上傳專案資料", "Upload project material")
          }
          onClose={() => setUpload(false)}
        >
          <ResumableUpload
            conversationId={space.conversation_id}
            onDone={() => {
              setUpload(false);
              setCrumbs([]);
              changed();
            }}
          />
        </Modal>
      )}
    </>
  );
}
function FolderPicker({
  spaceId,
  initial,
  onChange,
}: {
  spaceId: string;
  initial?: string;
  onChange: (id: string | null) => void;
}) {
  const w = useWorkspace(),
    { t } = useI18n(),
    [path, setPath] = useState<Node[]>([]),
    [selection, setSelection] = useState<string | null>(initial ?? null);
  const parent = path.at(-1),
    data = usePage(
      `${w.base}/cloud-workspaces/${spaceId}/nodes?limit=100&kind=directory` +
        (parent ? "&parent_id=" + parent.id : ""),
    );
  return (
    <div className="cloud-folder-picker">
      <p className="small-text">{t("目的資料夾", "Destination folder")}</p>
      <p className="muted small-text">
        {selection
          ? t(
              "已保留目的位置；開啟資料夾並按選擇即可更改。",
              "Destination retained. Open a folder and choose it to change the destination.",
            )
          : t("目前選擇：根目錄", "Selected: workspace root")}
      </p>
      <div className="cloud-breadcrumbs">
        <button type="button" onClick={() => setPath([])}>
          {t("根目錄", "Workspace root")}
        </button>
        {path.map((n, i) => (
          <button
            type="button"
            key={n.id}
            onClick={() => setPath(path.slice(0, i + 1))}
          >
            {" "}
            / {rootLabel(n, t)}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="button secondary"
        onClick={() => {
          setSelection(parent?.id ?? null);
          onChange(parent?.id ?? null);
        }}
      >
        {selection === (parent?.id ?? null)
          ? t("已選擇此資料夾", "Selected folder")
          : t("選擇目前資料夾", "Choose current folder")}
      </button>
      <div className="cloud-folder-options">
        {data.items
          .filter((n: Node) => n.kind === "directory")
          .map((n: Node) => (
            <button
              type="button"
              className="text-button"
              key={n.id}
              onClick={() => setPath([...path, n])}
            >
              <Folder size={16} />
              {rootLabel(n, t)}
              <ChevronRight size={14} />
            </button>
          ))}
      </div>
      <ErrorNotice error={data.error} />
      {data.next && (
        <button
          type="button"
          className="text-button"
          onClick={() => void data.more()}
        >
          {t("更多資料夾", "More folders")}
        </button>
      )}
    </div>
  );
}
function NodeEditor({
  space,
  initial,
  parent,
  onClose,
  onDone,
}: {
  space: any;
  initial?: Node;
  parent?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const w = useWorkspace(),
    { t } = useI18n(),
    [kind, setKind] = useState(initial?.kind ?? "directory"),
    [destination, setDestination] = useState<string | null>(
      initial?.parent_id ?? parent ?? null,
    ),
    [assetId, setAssetId] = useState(""),
    [version, setVersion] = useState("");
  const assets = useData(w.base + "/assets"),
    versions = useData(
      assetId ? w.base + "/assets/" + assetId + "/versions" : null,
    );
  const versionId = version || versions.data?.items[0]?.id;
  return (
    <Modal
      title={
        initial
          ? t("編輯檔案項目", "Edit file entry")
          : t("新增檔案項目", "New file entry")
      }
      onClose={onClose}
    >
      <AsyncForm
        submitLabel={t("儲存項目", "Save entry")}
        onSubmit={async (f) => {
          const name = String(f.get("name"));
          if (initial)
            await patch(w.base + "/cloud-nodes/" + initial.id, {
              expected_version: initial.version,
              name,
              parent_id: destination,
              ...(versionId ? { asset_version_id: versionId } : {}),
            });
          else
            await post(w.base + "/cloud-workspaces/" + space.id + "/nodes", {
              name,
              kind,
              ...(destination ? { parent_id: destination } : {}),
              ...(kind === "file" ? { asset_version_id: versionId } : {}),
            });
          onDone();
        }}
      >
        <Field label={t("名稱", "Name")}>
          <input
            name="name"
            required
            maxLength={180}
            defaultValue={initial?.name ?? ""}
          />
        </Field>
        {!initial && (
          <Field label={t("項目類型", "Entry type")}>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as any)}
            >
              <option value="directory">{t("資料夾", "Folder")}</option>
              <option value="file">
                {t("引用素材版本", "Asset version reference")}
              </option>
            </select>
          </Field>
        )}
        {kind === "file" && (
          <>
            <p className="muted small-text">
              {t(
                "引用會保留指定版本；移動或重新命名不會改變來源檔案。",
                "References keep an exact version. Moving or renaming an entry preserves its source.",
              )}
            </p>
            <Field label={t("來源素材", "Source asset")}>
              <select
                value={assetId}
                required={!initial}
                onChange={(e) => {
                  setAssetId(e.target.value);
                  setVersion("");
                }}
              >
                <option value="">
                  {initial
                    ? t("保留目前版本", "Keep the current version")
                    : t("選擇素材", "Choose an asset")}
                </option>
                {assets.data?.items
                  .filter(
                    (a: any) =>
                      space.kind === "conversation" || !a.private_owner,
                  )
                  .map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · v{a.current_version}
                    </option>
                  ))}
              </select>
            </Field>
            {assetId && (
              <Field label={t("固定版本", "Pinned version")}>
                <select
                  value={versionId ?? ""}
                  required
                  onChange={(e) => setVersion(e.target.value)}
                >
                  {versions.data?.items.map((v: any) => (
                    <option key={v.id} value={v.id}>
                      v{v.version} · {new Date(v.created_at).toLocaleString()}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <ErrorNotice error={assets.error ?? versions.error} />
          </>
        )}
        <FolderPicker
          spaceId={space.id}
          initial={destination ?? undefined}
          onChange={setDestination}
        />
      </AsyncForm>
    </Modal>
  );
}
function Preview({ node, onClose }: { node: Node; onClose: () => void }) {
  const w = useWorkspace(),
    { t } = useI18n(),
    data = useData(w.base + "/cloud-nodes/" + node.id + "/reference"),
    [error, setError] = useState<Error | null>(null),
    [copied, setCopied] = useState(false);
  return (
    <Modal title={node.name} onClose={onClose}>
      <ErrorNotice error={data.error ?? error} />
      {data.loading && <Loading />}
      {data.data && (
        <>
          <p className="muted">
            {t("固定版本：", "Pinned version: ")}v{data.data.source_version} ·{" "}
            {(data.data.size_bytes / 1024).toFixed(1)} KB
          </p>
          {data.data.preview_image ? (
            <img
              className="cloud-image-preview"
              alt={node.name}
              src={
                "data:" +
                data.data.preview_image.content_type +
                ";base64," +
                data.data.preview_image.base64
              }
            />
          ) : data.data.text !== undefined ? (
            <pre className="cloud-text-preview">{data.data.text}</pre>
          ) : (
            <p className="muted">
              {t(
                "此類型可下載到電腦預覽。",
                "Download this file to preview it on your computer.",
              )}
            </p>
          )}
          <div className="row-actions">
            <button
              className="button primary"
              onClick={() =>
                void download(
                  `${w.base}/assets/${data.data.asset_id}/download?version=${data.data.source_version}`,
                  node.name,
                ).catch(setError)
              }
            >
              <Download size={16} />
              {t("下載這一版", "Download this version")}
            </button>
            <button
              className="button secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(
                    JSON.stringify({
                      workspace_node_id: node.id,
                      asset_version_id: data.data.asset_version_id,
                    }),
                  )
                  .then(() => setCopied(true))
                  .catch(setError)
              }
            >
              <Link2 size={16} />
              {copied
                ? t("已複製引用", "Reference copied")
                : t("複製工作引用", "Copy work reference")}
            </button>
          </div>
          <p className="muted small-text">
            {t(
              "檔案引用會核對目前權限及固定版本。移除目錄項目不會刪除素材本體。",
              "File references check current access and the pinned version. Removing an entry preserves the source asset.",
            )}
          </p>
        </>
      )}
    </Modal>
  );
}
function RemoveEntry({
  node,
  onClose,
  onDone,
}: {
  node: Node;
  onClose: () => void;
  onDone: () => void;
}) {
  const w = useWorkspace(),
    { t } = useI18n();
  return (
    <Modal title={t("移除檔案項目", "Remove file entry")} onClose={onClose}>
      <p>{node.name}</p>
      <p className="muted">
        {t(
          "這會永久移除此項目及資料夾內的項目。素材本體與其他引用會保留；要永久刪除素材，請前往「素材與交付」。",
          "This permanently removes the entry and its folder contents. Source assets and independent references remain. Delete a source file in Assets & deliverables.",
        )}
      </p>
      <AsyncForm
        submitLabel={t("永久移除項目", "Remove entry permanently")}
        onSubmit={async () => {
          await api(w.base + "/cloud-nodes/" + node.id, { method: "DELETE" });
          onDone();
        }}
      >
        <label className="check-line">
          <input type="checkbox" required />
          {t(
            "我確認移除此項目與子項目",
            "I confirm removal of this entry and its children",
          )}
        </label>
      </AsyncForm>
    </Modal>
  );
}
function PublishEntry({
  node,
  shared,
  onClose,
  onDone,
}: {
  node: Node;
  shared: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const w = useWorkspace(),
    { t } = useI18n(),
    reference = useData(w.base + "/cloud-nodes/" + node.id + "/reference"),
    [parent, setParent] = useState<string | null>(null);
  return (
    <Modal
      title={t("發佈副本到專案", "Publish a copy to the project")}
      onClose={onClose}
    >
      <p>{node.name}</p>
      <p className="muted">
        {t(
          "有此專案存取權的成員將能使用副本。副本保留獨立版本，之後刪除私人來源不會移除已發佈的副本。",
          "Authorized project members can use the copy. It has an independent version and remains available if you later delete the private source.",
        )}
      </p>
      <ErrorNotice error={reference.error} />
      {reference.data && (
        <AsyncForm
          submitLabel={t("確認發佈副本", "Publish the copy")}
          onSubmit={async () => {
            await post(
              w.base + "/assets/" + reference.data.asset_id + "/promotions",
              {
                workspace_id: shared.id,
                base_asset_version_id: node.asset_version_id,
                sharing_scope: "project",
                ...(parent ? { parent_id: parent } : {}),
              },
            );
            onDone();
          }}
        >
          <FolderPicker spaceId={shared.id} onChange={setParent} />
          <label className="check-line">
            <input type="checkbox" required />
            {t(
              "我同意將此檔案版本分享給專案成員",
              "I approve sharing this version with project members",
            )}
          </label>
        </AsyncForm>
      )}
    </Modal>
  );
}
