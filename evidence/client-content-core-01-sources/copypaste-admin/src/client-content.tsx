import { useEffect, useRef, useState } from "react";
import { Eye, Plus, RefreshCw, RotateCcw, Send, Trash2 } from "lucide-react";
import { api } from "./api";
import { operationKey, completeOperation } from "./operation-key";
import {
  DateText,
  ErrorNotice,
  Field,
  Loading,
  Modal,
  PageHeader,
  useI18n,
} from "./ui";
import "./client-content.css";

type Client = "web" | "desktop" | "extension";
type Copy = {
  key: string;
  title: string;
  title_en: string;
  text: string;
  text_en: string;
  enabled: boolean;
  starts_at?: string;
  ends_at?: string;
};
type Navigation = {
  client: Client;
  path: string;
  label: string;
  label_en: string;
  enabled: boolean;
  order: number;
};
type Document = {
  schema: 1;
  announcements: Copy[];
  help: Copy[];
  navigation: Navigation[];
};
type Audience = {
  clients: Client[];
  tenant_ids: string[];
  user_ids: string[];
  percentage: number;
  cohort_key: string;
};
type Release = {
  id: string;
  version: number;
  document: Document;
  audience: Audience;
  definition_hash: string;
  reason: string;
  created_at: string;
  publications: number;
};
type Access = { me: { user: { id: string } }; has: (p: string) => boolean };
const root = "/v1/admin/client-content";
const clients: Client[] = ["web", "desktop", "extension"];
const blank = (): Document => ({
  schema: 1,
  announcements: [],
  help: [],
  navigation: [],
});
const everyone = (): Audience => ({
  clients: [...clients],
  tenant_ids: [],
  user_ids: [],
  percentage: 100,
  cohort_key: "workmate-content",
});
const names: Record<string, [string, string]> = {
  roles: ["專業角色", "Specialists"],
  specialists: ["我的專家", "Your specialists"],
  teams: ["專業團隊", "Your teams"],
  skills: ["專案技能", "Project methods"],
  solutions: ["業務方案", "Business methods"],
  notifications: ["工作通知", "Work notifications"],
  conversations: ["我的會話", "Your conversations"],
  memories: ["記憶與偏好", "Memory & preferences"],
  projects: ["專案", "Projects"],
  assets: ["素材與交付", "Assets & deliverables"],
  files: ["雲端檔案", "Cloud files"],
  creative: ["設計畫布", "Design canvas"],
  effects: ["特效工作室", "Motion studio"],
  analytics: ["行銷分析", "Marketing insights"],
  workflows: ["工作流程", "Workflows"],
  connections: ["連接應用", "Connections"],
  brand: ["品牌資料", "Brand library"],
  "batch-designs": ["批量設計工作台", "Design batches"],
  "video-workspace": ["影片製作工作台", "Video workspace"],
  "marketing-connections": ["廣告資料連接", "Marketing connections"],
  "website-audits": ["網站與 SEO 檢查", "Website & SEO audits"],
  "creative-feedback": ["創意表現回饋", "Creative feedback"],
  "geo-observations": ["GEO 觀察", "GEO observations"],
};
function DirectoryPicker({
  kind,
  value,
  onChange,
  enabled,
}: {
  kind: "users" | "tenants";
  value: string[];
  onChange: (v: string[]) => void;
  enabled: boolean;
}) {
  const { t } = useI18n(),
    [search, setSearch] = useState(""),
    [data, setData] = useState<any>(null),
    [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController(),
      timer = setTimeout(() => {
        setData(null);
        setError(null);
        void api(
          `/v1/admin/${kind}?limit=30${search.trim() ? "&q=" + encodeURIComponent(search.trim()) : ""}`,
          { signal: controller.signal },
        )
          .then((v) => {
            if (!controller.signal.aborted) setData(v);
          })
          .catch((e) => {
            if (!controller.signal.aborted) setError(e);
          });
      }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [kind, search, enabled]);
  return (
    <fieldset className="cc-directory">
      <legend>
        {kind === "users"
          ? t("指定用戶", "Selected users")
          : t("指定企業", "Selected workspaces")}
      </legend>
      <p className="muted">
        {t(
          "留空表示不限制此條件。企業與用戶條件同時符合才會選中。",
          "Leave empty for any. Workspace and user filters must both match.",
        )}
      </p>
      {!enabled ? (
        <p>
          {t(
            "需要目錄讀取權限才可選取。",
            "Directory read permission is required to select recipients.",
          )}
        </p>
      ) : (
        <>
          <input
            aria-label={
              kind === "users"
                ? t("搜尋用戶", "Search users")
                : t("搜尋企業", "Search workspaces")
            }
            placeholder={t("輸入名稱搜尋…", "Search by name…")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            aria-label={
              kind === "users"
                ? t("加入用戶", "Add user")
                : t("加入企業", "Add workspace")
            }
            value=""
            onChange={(e) => {
              if (e.target.value && !value.includes(e.target.value))
                onChange([...value, e.target.value]);
            }}
          >
            <option value="">{t("選擇並加入…", "Choose to add…")}</option>
            {data?.items
              .filter((v: any) => !value.includes(v.id))
              .map((v: any) => (
                <option key={v.id} value={v.id}>
                  {v.name || v.email} · {v.id.slice(0, 8)}
                </option>
              ))}
          </select>
          {data?.next_cursor && (
            <small>
              {t(
                "請收窄搜尋以找到其餘項目。",
                "Refine the search to find other recipients.",
              )}
            </small>
          )}
          <ErrorNotice error={error} />
        </>
      )}
      <ul>
        {value.map((id) => (
          <li key={id}>
            <span>{data?.items.find((v: any) => v.id === id)?.name ?? id}</span>
            <button
              type="button"
              className="icon-button"
              aria-label={t("移除 ", "Remove ") + id}
              onClick={() => onChange(value.filter((v) => v !== id))}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
function CopyFields({
  value,
  index,
  onChange,
  remove,
}: {
  value: Copy;
  index: number;
  onChange: (v: Copy) => void;
  remove: () => void;
}) {
  const { t } = useI18n();
  const dateValue = (v?: string) =>
    v
      ? new Date(Date.parse(v) - new Date(v).getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
      : "";
  return (
    <details className="cc-copy" open>
      <summary>
        {index + 1}. {value.title || t("新增內容", "New content")}
      </summary>
      <div className="cc-fields">
        <Field label={t("識別名稱", "Content key")}>
          <input
            required
            pattern="[\w-]{1,80}"
            maxLength={80}
            value={value.key}
            onChange={(e) => onChange({ ...value, key: e.target.value })}
          />
        </Field>
        <label className="cc-check">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
          />
          {t("顯示內容", "Show content")}
        </label>
        {(["title", "title_en", "text", "text_en"] as const).map((k) => (
          <Field
            key={k}
            label={
              {
                title: "標題 · 繁體中文",
                title_en: "Title · English",
                text: "內文 · 繁體中文",
                text_en: "Body · English",
              }[k]
            }
          >
            {k.startsWith("title") ? (
              <input
                required
                maxLength={160}
                value={value[k]}
                onChange={(e) => onChange({ ...value, [k]: e.target.value })}
              />
            ) : (
              <textarea
                rows={4}
                maxLength={10000}
                value={value[k]}
                onChange={(e) => onChange({ ...value, [k]: e.target.value })}
              />
            )}
          </Field>
        ))}
        {(["starts_at", "ends_at"] as const).map((k) => (
          <Field
            key={k}
            label={
              k === "starts_at"
                ? t(
                    "開始顯示（本地時間，可留空）",
                    "Visible from (local time, optional)",
                  )
                : t(
                    "停止顯示（本地時間，可留空）",
                    "Visible until (local time, optional)",
                  )
            }
          >
            <input
              type="datetime-local"
              value={dateValue(value[k])}
              onChange={(e) => {
                const next = { ...value };
                if (e.target.value)
                  next[k] = new Date(e.target.value).toISOString();
                else delete next[k];
                onChange(next);
              }}
            />
          </Field>
        ))}
      </div>
      <button className="button secondary" type="button" onClick={remove}>
        <Trash2 size={14} />
        {t("移除此內容", "Remove content")}
      </button>
    </details>
  );
}
function ClientView({ value, client }: { value: any; client: Client }) {
  const { t, locale } = useI18n();
  const items = value.items ?? [],
    navigation = items
      .filter((i: any) => i.kind === "navigation")
      .sort((a: any, b: any) => a.body.order - b.body.order);
  return (
    <div className="cc-client-view" data-testid="client-content-render">
      <small>
        {client.toUpperCase()} · {t("工作台內容", "Workspace content")}
      </small>
      {navigation.length > 0 && (
        <ul className="cc-menu-preview">
          {navigation.map((i: any) => (
            <li key={i.key} className={i.body.enabled ? "" : "cc-hidden-menu"}>
              <span>{locale === "en" ? i.body.label_en : i.body.label}</span>
              {!i.body.enabled && <small>{t("隱藏", "Hidden")}</small>}
            </li>
          ))}
        </ul>
      )}
      {items
        .filter((i: any) => i.kind !== "navigation")
        .map((i: any) =>
          i.kind === "help" ? (
            <details key={i.key}>
              <summary>
                {locale === "en" ? i.body.title_en : i.body.title}
              </summary>
              <p>{locale === "en" ? i.body.text_en : i.body.text}</p>
            </details>
          ) : (
            <article className="cc-notice-preview" key={i.key}>
              <strong>
                {locale === "en" ? i.body.title_en : i.body.title}
              </strong>
              <p>{locale === "en" ? i.body.text_en : i.body.text}</p>
            </article>
          ),
        )}
      {!items.length && (
        <p className="muted">
          {t(
            "沒有自訂公告、幫助或選單。",
            "No custom announcements, help or menus.",
          )}
        </p>
      )}
    </div>
  );
}
export function AdminClientContent({ access }: { access: Access }) {
  const { t } = useI18n(),
    [data, setData] = useState<any>(null),
    [history, setHistory] = useState<any[]>([]),
    [historyCursor, setHistoryCursor] = useState<number | null>(null),
    [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [document, setDocument] = useState<Document>(blank),
    [audience, setAudience] = useState<Audience>(everyone),
    [reason, setReason] = useState(""),
    [selected, setSelected] = useState<Release | null>(null),
    [client, setClient] = useState<Client>("web"),
    [nav, setNav] = useState(""),
    [sampleUser, setSampleUser] = useState(""),
    [sampleTenant, setSampleTenant] = useState(""),
    [preview, setPreview] = useState<any>(null),
    [confirm, setConfirm] = useState(false),
    [now, setNow] = useState(Date.now());
  const initialized = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const refresh = async (more = false) => {
    const [list, log] = await Promise.all([
      api(
        root +
          (more && data?.next_before_version
            ? "?before_version=" + data.next_before_version
            : ""),
      ),
      api(root + "/publications"),
    ]);
    if (!mounted.current) return;
    setData(more ? { ...list, items: [...data.items, ...list.items] } : list);
    setHistory(log.items);
    setHistoryCursor(log.next_before_revision);
    if (!initialized.current) {
      setDocument(list.initial_document);
      initialized.current = true;
    }
  };
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await f();
    } catch (e) {
      if (mounted.current) {
        setError(e as Error);
        setPreview(null);
        setConfirm(false);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  useEffect(() => {
    void run(() => refresh());
  }, []);
  useEffect(() => {
    if (!preview) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [preview]);
  const change = (v: Document) => {
    setDocument(v);
    setSelected(null);
    setPreview(null);
    setConfirm(false);
  };
  const target = (v: Audience) => {
    setAudience(v);
    setSelected(null);
    setPreview(null);
    setConfirm(false);
  };
  const choose = (r: Release) => {
    setSelected(r);
    setDocument(r.document);
    setAudience(r.audience);
    setReason(r.reason);
    setPreview(null);
    setConfirm(false);
  };
  const canDraft = access.has("admin.catalog.draft"),
    canPublish = access.has("admin.catalog.publish"),
    canRollback = access.has("admin.catalog.rollback");
  const evaluate = async (action: "publish" | "rollback", r = selected) => {
    if (!r) return;
    const result = await api(`${root}/${r.id}/previews`, {
      method: "POST",
      body: JSON.stringify({
        action,
        reason,
        sample: {
          client,
          ...(sampleUser ? { user_id: sampleUser } : {}),
          ...(sampleTenant ? { tenant_id: sampleTenant } : {}),
        },
      }),
    });
    if (mounted.current) {
      setPreview(result);
      setNow(Date.now());
    }
  };
  if (!access.has("admin.catalog.read"))
    return (
      <p>
        {t("需要內容目錄讀取權限。", "Catalog read permission is required.")}
      </p>
    );
  return (
    <section className="client-content" data-testid="client-content-admin">
      <PageHeader
        title={t("用戶端內容", "Client content")}
        description={t(
          "管理三端公告、幫助與選單。先看用戶實際會看到的內容，再發佈。",
          "Manage announcements, help and menus across clients. Review what recipients will see before publishing.",
        )}
        action={
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void run(() => refresh())}
          >
            <RefreshCw size={15} />
            {t("重新整理", "Refresh")}
          </button>
        }
      />
      <ErrorNotice error={error} />
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="cc-status">
            <span>
              {t("目前發佈", "Current publication")}{" "}
              <strong>#{data.revision}</strong>
            </span>
            <span>
              {data.rollout_active
                ? t(
                    "定向發佈中 · 其餘用戶保留原版",
                    "Targeted rollout · everyone else keeps the baseline",
                  )
                : t("統一內容", "Shared content")}
            </span>
          </div>
          <div className="cc-layout">
            <aside className="cc-versions">
              <h2>{t("內容版本", "Content versions")}</h2>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  change(data.initial_document);
                  setAudience(everyone());
                  setReason("");
                }}
              >
                {t("以目前內容建立新版", "Start from current content")}
              </button>
              <ol>
                {data.items.map((r: Release) => (
                  <li key={r.id}>
                    <button
                      aria-pressed={selected?.id === r.id}
                      onClick={() => choose(r)}
                      disabled={busy}
                    >
                      <strong>v{r.version}</strong>
                      <span>
                        {r.id === data.current_release_id
                          ? t("目前", "Current")
                          : r.publications
                            ? t("已發佈", "Published")
                            : t("草稿", "Draft")}
                      </span>
                      <small>{r.reason}</small>
                      <DateText value={r.created_at} />
                    </button>
                  </li>
                ))}
              </ol>
              {data.next_before_version && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void run(() => refresh(true))}
                >
                  {t("較早版本", "Older versions")}
                </button>
              )}
            </aside>
            <form
              className="cc-editor"
              onSubmit={(e) => {
                e.preventDefault();
                if (!canDraft) return;
                void run(async () => {
                  const payload = { document, audience, reason },
                    key = await operationKey(
                      access.me.user.id,
                      "client-content-draft",
                      payload,
                    );
                  const r = await api<Release>(root, {
                    method: "POST",
                    headers: { "Idempotency-Key": key },
                    body: JSON.stringify(payload),
                  });
                  await completeOperation(
                    access.me.user.id,
                    "client-content-draft",
                    payload,
                  );
                  choose(r);
                  await refresh();
                  setNotice(
                    t(
                      "草稿已保存，尚未對用戶發佈。",
                      "Draft saved. Review and publish it to update clients.",
                    ),
                  );
                });
              }}
            >
              <header className="cc-editor-header">
                <div>
                  <small>COPYPASTE · CLIENT EXPERIENCE</small>
                  <h2>
                    {selected
                      ? `v${selected.version}`
                      : t("新內容草稿", "New content draft")}
                  </h2>
                </div>
                <span className="badge">
                  {selected
                    ? t("已保存版本", "Saved version")
                    : t("尚未保存", "Unsaved changes")}
                </span>
              </header>
              <fieldset disabled={busy || !canDraft}>
                {(["announcements", "help"] as const).map((section) => (
                  <section className="cc-section" key={section}>
                    <div className="cc-section-heading">
                      <h3>
                        {section === "announcements"
                          ? t("公告", "Announcements")
                          : t("幫助內容", "Help content")}
                      </h3>
                      <span>
                        {document[section].length} /{" "}
                        {section === "announcements" ? 12 : 20}
                      </span>
                    </div>
                    {document[section].map((v, i) => (
                      <CopyFields
                        key={section + i}
                        value={v}
                        index={i}
                        onChange={(next) =>
                          change({
                            ...document,
                            [section]: document[section].map((old, n) =>
                              n === i ? next : old,
                            ),
                          })
                        }
                        remove={() =>
                          change({
                            ...document,
                            [section]: document[section].filter(
                              (_, n) => n !== i,
                            ),
                          })
                        }
                      />
                    ))}
                    <button
                      className="button secondary"
                      type="button"
                      disabled={
                        document[section].length >=
                        (section === "announcements" ? 12 : 20)
                      }
                      onClick={() =>
                        change({
                          ...document,
                          [section]: [
                            ...document[section],
                            {
                              key:
                                section + "-" + crypto.randomUUID().slice(0, 8),
                              title: "",
                              title_en: "",
                              text: "",
                              text_en: "",
                              enabled: true,
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={14} />
                      {section === "announcements"
                        ? t("加入公告", "Add announcement")
                        : t("加入幫助", "Add help")}
                    </button>
                  </section>
                ))}
                <section className="cc-section">
                  <h3>{t("選單顯示", "Menu appearance")}</h3>
                  <p className="muted">
                    {t(
                      "選單設定只影響入口的名稱、排序及顯示；使用權限由帳戶、方案及角色另外控制。",
                      "Menu settings change labels, order and visibility. Account, plan and role permissions still govern access.",
                    )}
                  </p>
                  <div className="cc-client-tabs">
                    {clients.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={client === c}
                        onClick={() => {
                          setClient(c);
                          setNav("");
                          setPreview(null);
                        }}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  {document.navigation
                    .filter((v) => v.client === client)
                    .map((v) => (
                      <div className="cc-nav-row" key={v.path}>
                        <code>{v.path}</code>
                        <Field label="繁體中文">
                          <input
                            required
                            maxLength={80}
                            value={v.label}
                            onChange={(e) =>
                              change({
                                ...document,
                                navigation: document.navigation.map((x) =>
                                  x === v ? { ...v, label: e.target.value } : x,
                                ),
                              })
                            }
                          />
                        </Field>
                        <Field label="English">
                          <input
                            required
                            maxLength={80}
                            value={v.label_en}
                            onChange={(e) =>
                              change({
                                ...document,
                                navigation: document.navigation.map((x) =>
                                  x === v
                                    ? { ...v, label_en: e.target.value }
                                    : x,
                                ),
                              })
                            }
                          />
                        </Field>
                        <Field label={t("排序", "Order")}>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            required
                            value={v.order}
                            onChange={(e) =>
                              change({
                                ...document,
                                navigation: document.navigation.map((x) =>
                                  x === v
                                    ? { ...v, order: Number(e.target.value) }
                                    : x,
                                ),
                              })
                            }
                          />
                        </Field>
                        <label className="cc-check">
                          <input
                            type="checkbox"
                            checked={v.enabled}
                            onChange={(e) =>
                              change({
                                ...document,
                                navigation: document.navigation.map((x) =>
                                  x === v
                                    ? { ...v, enabled: e.target.checked }
                                    : x,
                                ),
                              })
                            }
                          />
                          {t("顯示", "Visible")}
                        </label>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={
                            t("移除選單設定 ", "Remove menu setting ") + v.path
                          }
                          onClick={() =>
                            change({
                              ...document,
                              navigation: document.navigation.filter(
                                (x) => x !== v,
                              ),
                            })
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  <div className="cc-add-menu">
                    <select
                      aria-label={t("選擇自訂選單", "Choose menu to customize")}
                      value={nav}
                      onChange={(e) => setNav(e.target.value)}
                    >
                      <option value="">
                        {t("選擇現有入口…", "Choose an existing item…")}
                      </option>
                      {data.navigation[client]
                        .filter(
                          (p: string) =>
                            !document.navigation.some(
                              (v) => v.client === client && v.path === p,
                            ),
                        )
                        .map((p: string) => (
                          <option key={p} value={p}>
                            {names[p] ? t(...names[p]) : p}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={!nav}
                      onClick={() => {
                        change({
                          ...document,
                          navigation: [
                            ...document.navigation,
                            {
                              client,
                              path: nav,
                              label: names[nav]?.[0] ?? nav,
                              label_en: names[nav]?.[1] ?? nav,
                              enabled: true,
                              order: 50,
                            },
                          ],
                        });
                        setNav("");
                      }}
                    >
                      {t("自訂選單", "Customize menu")}
                    </button>
                  </div>
                </section>
                <section className="cc-section">
                  <h3>{t("接收範圍", "Recipients")}</h3>
                  <div className="cc-client-tabs">
                    {clients.map((c) => (
                      <label key={c} className="cc-check">
                        <input
                          type="checkbox"
                          checked={audience.clients.includes(c)}
                          onChange={(e) =>
                            target({
                              ...audience,
                              clients: e.target.checked
                                ? [...audience.clients, c]
                                : audience.clients.filter((v) => v !== c),
                            })
                          }
                        />
                        {c}
                      </label>
                    ))}
                  </div>
                  <div className="cc-fields">
                    <Field
                      label={t("顯示比例（%）", "Recipient percentage (%)")}
                    >
                      <input
                        type="number"
                        min={0}
                        max={100}
                        required
                        value={audience.percentage}
                        onChange={(e) =>
                          target({
                            ...audience,
                            percentage: Number(e.target.value),
                          })
                        }
                      />
                    </Field>
                    <Field label={t("固定分組名稱", "Stable cohort key")}>
                      <input
                        required
                        pattern="[\w-]{1,80}"
                        maxLength={80}
                        value={audience.cohort_key}
                        onChange={(e) =>
                          target({ ...audience, cohort_key: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                  <p className="muted">
                    {t(
                      "相同分組名稱會穩定選中相同用戶。0% 不展示新版；未選中的用戶保留原版。",
                      "The same cohort key selects the same users consistently. At 0%, everyone keeps the baseline.",
                    )}
                  </p>
                  <div className="cc-fields">
                    <DirectoryPicker
                      kind="tenants"
                      value={audience.tenant_ids}
                      onChange={(v) => target({ ...audience, tenant_ids: v })}
                      enabled={access.has("admin.tenants.read")}
                    />
                    <DirectoryPicker
                      kind="users"
                      value={audience.user_ids}
                      onChange={(v) => target({ ...audience, user_ids: v })}
                      enabled={access.has("admin.users.read")}
                    />
                  </div>
                </section>
              </fieldset>
              <Field label={t("本次變更原因", "Reason for this change")}>
                <textarea
                  required
                  minLength={3}
                  maxLength={1000}
                  rows={2}
                  value={reason}
                  disabled={busy}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setPreview(null);
                    setConfirm(false);
                  }}
                />
              </Field>
              <div className="cc-actions">
                <button
                  className="button primary"
                  type="submit"
                  disabled={busy || !canDraft}
                >
                  {t("保存為新草稿", "Save new draft")}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={
                    busy || !selected || !canPublish || reason.trim().length < 3
                  }
                  onClick={() => void run(() => evaluate("publish"))}
                >
                  <Eye size={15} />
                  {t("預覽發佈", "Preview publication")}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={
                    busy ||
                    !selected?.publications ||
                    !canRollback ||
                    reason.trim().length < 3
                  }
                  onClick={() => void run(() => evaluate("rollback"))}
                >
                  <RotateCcw size={15} />
                  {t("預覽回滾", "Preview rollback")}
                </button>
              </div>
            </form>
          </div>
          <section className="cc-review card">
            <div className="cc-section-heading">
              <h2>{t("發佈前預覽", "Review before publishing")}</h2>
              <span>{client.toUpperCase()}</span>
            </div>
            <p className="muted">
              {t(
                "可填入有權查看的用戶與企業 ID，核對指定接收者。留空只預覽不含身份條件的範圍。",
                "Optionally enter a user and workspace ID you can read to preview that recipient. Empty fields preview the audience without identity filters.",
              )}
            </p>
            <div className="cc-fields">
              <Field
                label={t("預覽用戶 ID（選填）", "Preview user ID (optional)")}
              >
                <input
                  value={sampleUser}
                  disabled={busy || !access.has("admin.users.read")}
                  onChange={(e) => {
                    setSampleUser(e.target.value.trim());
                    setPreview(null);
                  }}
                />
              </Field>
              <Field
                label={t(
                  "預覽企業 ID（選填）",
                  "Preview workspace ID (optional)",
                )}
              >
                <input
                  value={sampleTenant}
                  disabled={busy || !access.has("admin.tenants.read")}
                  onChange={(e) => {
                    setSampleTenant(e.target.value.trim());
                    setPreview(null);
                  }}
                />
              </Field>
            </div>
            {preview ? (
              <>
                <div className="cc-review-status">
                  <strong>
                    {preview.sample_selected
                      ? t(
                          "此接收者將看到新版",
                          "This recipient will see the new content",
                        )
                      : t(
                          "此接收者將保留原版",
                          "This recipient keeps the baseline",
                        )}
                  </strong>
                  <span>
                    {t("預覽有效至", "Preview expires")}{" "}
                    <DateText value={preview.expires_at} />
                  </span>
                </div>
                <div className="cc-comparison">
                  <section>
                    <h3>{t("目前顯示", "Before")}</h3>
                    <ClientView value={preview.before} client={client} />
                  </section>
                  <section>
                    <h3>{t("發佈後顯示", "After")}</h3>
                    <ClientView value={preview.after} client={client} />
                  </section>
                </div>
                <p className="muted">
                  {t(
                    "預覽依目前時間與選定身份計算；排程內容會在設定時間生效。未自訂的入口沿用客戶端預設。",
                    "The preview uses the current time and selected identity. Scheduled copy changes at its configured time. Uncustomized menus keep client defaults.",
                  )}
                </p>
                <button
                  className="button primary"
                  disabled={busy || now >= Date.parse(preview.expires_at)}
                  onClick={() => setConfirm(true)}
                >
                  <Send size={15} />
                  {preview.action === "rollback"
                    ? t("確認回滾…", "Review rollback…")
                    : t("確認發佈…", "Review publication…")}
                </button>
                {now >= Date.parse(preview.expires_at) && (
                  <p role="status">
                    {t(
                      "預覽已過期，請重新預覽。",
                      "Preview expired. Create a fresh preview.",
                    )}
                  </p>
                )}
              </>
            ) : (
              <p>
                {t(
                  "保存草稿後選擇「預覽發佈」，查看前後內容及接收範圍。",
                  "Save a draft, then choose Preview publication to compare the content and recipients.",
                )}
              </p>
            )}
          </section>
          <section className="cc-history card">
            <h2>{t("發佈記錄", "Publication history")}</h2>
            {!history.length && (
              <p className="muted">{t("尚未發佈。", "No publications yet.")}</p>
            )}
            <ol>
              {history.map((p) => (
                <li key={p.id}>
                  <strong>
                    #{p.revision} · v{p.version}
                  </strong>
                  <span>
                    {p.action === "rollback"
                      ? t("回滾", "Rollback")
                      : t("發佈", "Publication")}
                  </span>
                  <p>{p.reason}</p>
                  <DateText value={p.created_at} />
                </li>
              ))}
            </ol>
            {historyCursor && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const next = await api(
                      root + "/publications?before_revision=" + historyCursor,
                    );
                    setHistory([...history, ...next.items]);
                    setHistoryCursor(next.next_before_revision);
                  })
                }
              >
                {t("較早記錄", "Older publications")}
              </button>
            )}
          </section>
        </>
      )}
      {confirm && preview && (
        <Modal
          title={
            preview.action === "rollback"
              ? t("回滾用戶端內容", "Roll back client content")
              : t("發佈用戶端內容", "Publish client content")
          }
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <p>
            {t(
              "本次操作將更新所選範圍的公告、幫助與選單。",
              "This updates announcements, help and menus for the selected audience.",
            )}
          </p>
          <p>
            v{preview.release.version} ·{" "}
            {preview.release.audience.clients.join(", ")} ·{" "}
            {preview.release.audience.percentage}%
          </p>
          <p>{preview.reason}</p>
          <small className="cc-hash">
            SHA-256 {preview.release.definition_hash}
          </small>
          <div className="cc-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              {t("返回檢查", "Keep reviewing")}
            </button>
            <button
              className="button primary"
              disabled={busy || now >= Date.parse(preview.expires_at)}
              onClick={() =>
                void run(async () => {
                  const p = await api(root + "/" + preview.action, {
                    method: "POST",
                    body: JSON.stringify({ preview_id: preview.id }),
                  });
                  setConfirm(false);
                  setPreview(null);
                  await refresh();
                  setNotice(
                    t(
                      "內容已發佈，客戶端會在重新整理或 15 秒內更新。發佈序號：",
                      "Published. Clients update on refresh or within 15 seconds. Publication: ",
                    ) + p.revision,
                  );
                })
              }
            >
              {preview.action === "rollback"
                ? t("確認回滾", "Confirm rollback")
                : t("確認發佈", "Confirm publication")}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
