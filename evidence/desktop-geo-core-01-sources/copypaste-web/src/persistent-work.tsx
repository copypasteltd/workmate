import { ProjectConfigurationSummary } from "./project-configuration";
import { useRef, useState } from "react";
import { AdoptionReview } from "./agent-adoption";
import { TaskInputRequests } from "./task-dependencies";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Archive,
  BookOpen,
  Check,
  Copy,
  History,
  LockKeyhole,
  MessageSquare,
  Pin,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api, ApiError, patch, post } from "./api";
import { useWorkspace } from "./context";
import {
  AsyncForm,
  Badge,
  DateText,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  Modal,
  Money,
  PageHeader,
  useData,
  useI18n,
} from "./ui";

export function ModeField({
  value,
  onChange,
}: {
  value?: string;
  onChange?: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Field
      label={t("工作方式", "Working mode")}
      hint={t(
        "諮詢與規劃只讀取資料；執行可建立交付檔案。每次 AI 工作均依用量結算。",
        "Ask and plan can read information. Execute can create deliverables. Each AI task is metered.",
      )}
    >
      <select
        name="mode"
        {...(value === undefined ? { defaultValue: "execute" } : { value })}
        onChange={(e) => onChange?.(e.target.value)}
      >
        <option value="ask">
          {t("諮詢 — 解答與分析", "Ask — answers and analysis")}
        </option>
        <option value="plan">
          {t("規劃 — 確認後再執行", "Plan — review before execution")}
        </option>
        <option value="execute">
          {t("執行 — 建立實際成果", "Execute — create deliverables")}
        </option>
      </select>
    </Field>
  );
}

export function Specialists() {
  const w = useWorkspace(),
    { t } = useI18n(),
    nav = useNavigate();
  const [refresh, setRefresh] = useState(0),
    [editing, setEditing] = useState<any>(null),
    [history, setHistory] = useState<any>(null),
    [adopting, setAdopting] = useState<any>(null),
    [notice, setNotice] = useState(false),
    [error, setError] = useState<Error | null>(null);
  const manage = ["owner", "admin"].includes(
    w.me?.memberships.find((m: any) => m.id === w.tenant)?.role,
  );
  const data = useData(w.base + "/agents", refresh),
    versions = useData(
      history ? w.base + "/agents/" + history.id + "/versions" : null,
    );
  async function start(a: any) {
    try {
      const c = await post(w.base + "/conversations", {
        name: a.name,
        agent_id: a.id,
      });
      nav("/app/conversations/" + c.id);
    } catch (e) {
      setError(e as Error);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="A FAMILIAR WAY TO WORK."
        title={t("我的專家", "Your specialists")}
        description={t(
          "把角色、品牌和工作要求保存為專家，讓每次合作接得上。",
          "Save a role, brand and working brief as a specialist you can return to.",
        )}
        action={
          <div className="row-actions">
            <Link className="button primary" to="/app/roles">
              <BookOpen size={17} />
              {t("從模板建立", "Create from a template")}
            </Link>
            <button className="button quiet" onClick={() => setEditing({})}>
              <Plus size={17} />
              {t("建立專家", "Create specialist")}
            </button>
          </div>
        }
      />
      <ErrorNotice error={data.error ?? error} />
      {notice && (
        <p className="success-line" role="status">
          <Check size={16} />
          {t(
            "已採用新版本。既有會話保留原版本。",
            "New version adopted. Existing conversations keep their original version.",
          )}
        </p>
      )}
      {data.loading && !data.data ? (
        <Loading />
      ) : data.data?.items.length ? (
        <div className="project-grid">
          {data.data.items.map((a: any) => (
            <article key={a.id} className="card specialist-card">
              <div className="specialist-heading">
                <span className="specialist-avatar">
                  <Sparkles size={19} />
                </span>
                <span className="muted small-text">
                  v{a.version} ·{" "}
                  {a.enabled ? t("可選用", "Enabled") : t("已停用", "Disabled")}
                </span>
              </div>
              <h2>{a.name}</h2>
              <p className="muted small-text">
                {a.builtin_default
                  ? t(
                      "預設助手 · 共享方法，私人會話",
                      "Default assistant · shared methods, private conversations",
                    )
                  : a.role_key}
              </p>
              <p className="specialist-brief">
                {a.body.instructions ||
                  t(
                    "沿用角色的專業方法。",
                    "Uses the role’s installed methods.",
                  )}
              </p>
              {a.body.brand && <p className="muted small-text">{t("固定品牌版本", "Fixed brand revision")} · v{a.body.brand.version}</p>}
              <div className="row-actions">
                <button
                  className="button primary"
                  disabled={!a.enabled}
                  onClick={() => void start(a)}
                >
                  <MessageSquare size={16} />
                  {t("開始會話", "Start conversation")}
                </button>
              </div>
              <footer className="row-actions">
                <Link className="text-button" to="/app/skills">
                  <BookOpen size={15} />
                  {t("技能管理", "Manage methods")}
                </Link>
                {!a.builtin_default && (
                  <button className="text-button" onClick={() => setEditing(a)}>
                    <Settings2 size={15} />
                    {t("設定", "Settings")}
                  </button>
                )}
                {a.builtin_default && manage && (
                  <button
                    className="text-button"
                    onClick={() => setAdopting(a)}
                  >
                    {t("採用目前技能版本", "Adopt current methods")}
                  </button>
                )}
                <button
                  className="text-button"
                  onClick={() =>
                    setEditing({
                      ...a,
                      id: undefined,
                      name: a.name + t(" 副本", " copy"),
                      copy: true,
                    })
                  }
                >
                  <Copy size={15} />
                  {t("複製", "Copy")}
                </button>
                <button className="text-button" onClick={() => setHistory(a)}>
                  <History size={15} />
                  {t("版本", "Versions")}
                </button>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={Sparkles}
          title={t(
            "選好專業，保存你的工作方式。",
            "Choose a profession. Make it yours.",
          )}
          body={t(
            "從 18 個預設角色開始，加入品牌和長期使用的工作要求。",
            "Start with one of 18 role presets and add your brand and working instructions.",
          )}
          action={
            <Link className="button primary" to="/app/roles">
              {t("建立第一位專家", "Create your first specialist")}
            </Link>
          }
        />
      )}
      <p className="muted small-text section-block">
        {t(
          "專家設定供專案成員共用；每位成員的會話、個人記憶和私人交付各自保留。",
          "Specialist settings are shared within the project. Conversations, personal memories and private deliverables belong to each member.",
        )}
      </p>
      {editing && (
        <SpecialistEditor
          initial={editing}
          onClose={() => {
            setEditing(null);
            setRefresh((v) => v + 1);
          }}
          onSaved={() => {
            setEditing(null);
            setRefresh((v) => v + 1);
            setNotice(true);
          }}
        />
      )}
      {adopting && (
        <Modal
          title={t("比較並採用版本", "Compare and adopt a version")}
          onClose={() => setAdopting(null)}
        >
          <AdoptionReview
            key={adopting.id}
            endpoint={`${w.base}/agents/${adopting.id}/version-previews`}
            proposal={{ expected_version: adopting.version }}
            onBack={() => {
              setAdopting(null);
              setRefresh((v) => v + 1);
            }}
            onSaved={() => {
              setAdopting(null);
              setRefresh((v) => v + 1);
              setNotice(true);
            }}
          />
        </Modal>
      )}
      {history && (
        <Modal
          title={t("專家版本", "Specialist versions") + " · " + history.name}
          onClose={() => setHistory(null)}
        >
          <ErrorNotice error={versions.error} />
          {versions.loading ? (
            <Loading />
          ) : (
            versions.data?.items.map((v: any) => (
              <details className="version-detail" key={v.version}>
                <summary>
                  v{v.version} · <DateText value={v.created_at} />
                </summary>
                <p className="preserve-text">{v.body.instructions}</p>
                <p className="muted small-text">
                  {v.body.tool_ids.join(" · ")}
                </p>
              </details>
            ))
          )}
        </Modal>
      )}
    </>
  );
}
function SpecialistEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const w = useWorkspace(),
    { t } = useI18n();
  const roles = useData("/v1/catalog/roles"),
    helper = useData("/v1/catalog/default-assistant"),
    brands = useData(w.base + "/brand");
  const [role, setRole] = useState(initial.role_key ?? "marketing-analyst"),
    [tools, setTools] = useState<string[] | undefined>(initial.body?.tool_ids),
    [draft, setDraft] = useState<any>(null),
    [reviewing, setReviewing] = useState(false);
  const selected =
    role === "assistant"
      ? helper.data
      : roles.data?.items.find((r: any) => r.role_key === role);
  return (
    <Modal
      title={
        initial.id
          ? t("更新專家版本", "Update specialist version")
          : t("建立專家", "Create specialist")
      }
      onClose={onClose}
    >
      {reviewing ? (
        <AdoptionReview
          endpoint={`${w.base}/agents/${initial.id}/version-previews`}
          proposal={draft}
          onBack={(stale) => {
            if (stale) onClose();
            else setReviewing(false);
          }}
          onSaved={onSaved}
        />
      ) : (
        <AsyncForm
          submitLabel={
            initial.id
              ? t("比較變更", "Compare changes")
              : t("儲存專家", "Save specialist")
          }
          onSubmit={async (f) => {
            const body = {
              name: String(f.get("name")),
              role_key: role,
              instructions: String(f.get("instructions")),
              brand_id: f.get("brand") || null,
              ...(tools ? { tool_ids: tools } : {}),
            };
            if (initial.id) {
              setDraft({
                expected_version: initial.version,
                definition: { ...body, enabled: f.get("enabled") === "on" },
              });
              setReviewing(true);
            } else {
              await post(w.base + "/agents", body);
              onSaved();
            }
          }}
        >
          <ErrorNotice error={roles.error ?? brands.error} />
          <Field label={t("專家名稱", "Specialist name")}>
            <input
              name="name"
              defaultValue={draft?.definition.name ?? initial.name ?? ""}
              maxLength={160}
              required
            />
          </Field>
          <Field label={t("預設專業角色", "Role preset")}>
            <select
              value={role}
              disabled={!!initial.id}
              onChange={(e) => {
                setRole(e.target.value);
                setTools(undefined);
              }}
            >
              <option value="assistant">
                {t("預設助手", "Default assistant")}
              </option>
              {roles.data?.items.map((r: any) => (
                <option key={r.role_key} value={r.role_key}>
                  {r.display_name} · {r.role_key}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("品牌", "Brand")}>
            <select
              name="brand"
              defaultValue={
                draft
                  ? (draft.definition.brand_id ?? "")
                  : (initial.body?.brand?.id ?? "")
              }
            >
              <option value="">{t("暫不綁定", "No brand binding")}</option>
              {brands.data?.items.map((b: any) => (
                <option key={b.id} value={b.id}>
                  {b.name} · v{b.version}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={t("工作要求", "Working instructions")}
            hint={t(
              "例如：使用繁體中文、列出資料來源、海報保留品牌標誌。",
              "For example: use Traditional Chinese, cite sources, preserve the brand mark in posters.",
            )}
          >
            <textarea
              name="instructions"
              rows={5}
              maxLength={8000}
              defaultValue={
                draft?.definition.instructions ??
                initial.body?.instructions ??
                ""
              }
            />
          </Field>
          <details className="specialist-tools">
            <summary>
              {t("可用工具", "Allowed tools")} ·{" "}
              {(tools ?? selected?.tool_ids ?? []).length}
            </summary>
            <p className="muted small-text">
              {t(
                "可縮減這個角色的工具範圍。",
                "You can narrow the tools available to this role.",
              )}
            </p>
            {selected?.tool_ids.map((id: string) => (
              <label className="check-line" key={id}>
                <input
                  type="checkbox"
                  checked={(tools ?? selected.tool_ids).includes(id)}
                  onChange={(e) =>
                    setTools(
                      e.target.checked
                        ? [...(tools ?? selected.tool_ids), id]
                        : (tools ?? selected.tool_ids).filter(
                            (v: string) => v !== id,
                          ),
                    )
                  }
                />
                {id}
              </label>
            ))}
          </details>
          {initial.id && (
            <label className="check-line">
              <input
                name="enabled"
                type="checkbox"
                defaultChecked={draft?.definition.enabled ?? initial.enabled}
              />
              {t("允許開始新工作", "Allow new work")}
            </label>
          )}
          <p className="muted small-text">
            {t(
              "每次更新保留獨立版本。既有會話會保留原版本，直到你主動更新。",
              "Each update creates a version. Existing conversations keep their version until you choose to update them.",
            )}
          </p>
        </AsyncForm>
      )}
    </Modal>
  );
}

function NewConversation({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const w = useWorkspace(),
    { t } = useI18n(),
    agents = useData(w.base + "/agents");
  const enabled = agents.data?.items.filter((a: any) => a.enabled) ?? [];
  return (
    <Modal title={t("開始會話", "Start conversation")} onClose={onClose}>
      <ProjectConfigurationSummary compact />
      <ErrorNotice error={agents.error} />
      {agents.loading ? (
        <Loading />
      ) : !agents.error ? (
        <AsyncForm
          submitLabel={t("建立會話", "Create conversation")}
          onSubmit={async (f) => {
            const c = await post(w.base + "/conversations", {
              name: String(f.get("name")),
              ...(f.get("agent") ? { agent_id: String(f.get("agent")) } : {}),
            });
            onSaved(c.id);
          }}
        >
          <Field label={t("會話名稱", "Conversation name")}>
            <input
              name="name"
              maxLength={160}
              required
              placeholder={t("例如：秋季推廣計畫", "e.g. Autumn campaign")}
            />
          </Field>
          <Field label={t("我的專家", "Your specialist")}>
            <select name="agent">
              <option value="">
                {t("專案推薦設定或預設助手", "Project recommendation or default assistant")}
              </option>
              {enabled
                .filter((a: any) => !a.builtin_default)
                .map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · v{a.version}
                  </option>
                ))}
            </select>
          </Field>
          <p className="muted small-text">
            {t(
              "建立會話和保存筆記不會啟動 AI 工作。",
              "Creating a conversation and saving notes do not start AI tasks.",
            )}
          </p>
        </AsyncForm>
      ) : (
        <Empty
          title={t("暫時無法載入專家", "Unable to load specialists")}
          body={t("請重新整理後再試。", "Refresh the page and try again.")}
          action={
            <Link className="button primary" to="/app/specialists">
              {t("我的專家", "Your specialists")}
            </Link>
          }
        />
      )}
    </Modal>
  );
}
export function Conversations() {
  const w = useWorkspace(),
    { t } = useI18n(),
    nav = useNavigate();
  const [query, setQuery] = useState(""),
    [archived, setArchived] = useState(false),
    [open, setOpen] = useState(false);
  const data = useData(
    `${w.base}/conversations?archived=${archived}&q=${encodeURIComponent(query)}`,
    0,
    10000,
  );
  return (
    <>
      <PageHeader
        eyebrow="PICK UP WHERE YOU LEFT OFF."
        title={t("我的會話", "Your conversations")}
        description={t(
          "讓想法、指示和成果，留在同一段合作裡。",
          "Keep ideas, instructions and results in one ongoing conversation.",
        )}
        action={
          <button className="button primary" onClick={() => setOpen(true)}>
            <Plus size={17} />
            {t("開始會話", "Start conversation")}
          </button>
        }
      />
      <div className="work-toolbar">
        <label className="field">
          <span className="sr-only">
            {t("搜尋會話", "Search conversations")}
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("搜尋會話名稱…", "Search conversations…")}
            maxLength={160}
          />
        </label>
        <label className="check-line">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          <Archive size={16} />
          {t("已封存", "Archived")}
        </label>
        <span className="privacy-label">
          <LockKeyhole size={14} />
          {t("僅你可見", "Only you")}
        </span>
      </div>
      <ErrorNotice error={data.error} />
      {data.loading && !data.data ? (
        <Loading />
      ) : data.data?.items.length ? (
        <div className="conversation-list">
          {data.data.items.map((c: any) => (
            <Link
              to={"/app/conversations/" + c.id}
              key={c.id}
              className="card conversation-list-item"
            >
              <span className="specialist-avatar">
                <MessageSquare size={20} />
              </span>
              <div>
                <h2>
                  {c.name}
                  {c.pinned && <Pin size={15} />}
                </h2>
                <p className="muted small-text">
                  {c.agent_name} · v{c.agent_version}
                </p>
              </div>
              <DateText value={c.updated_at} />
              <ArrowUpRight size={18} />
            </Link>
          ))}
        </div>
      ) : (
        <Empty
          icon={MessageSquare}
          title={
            query
              ? t("沒有符合的會話", "No matching conversations")
              : archived
                ? t("還沒有封存會話", "No archived conversations")
                : t("工作可以接著聊。", "Keep the conversation going.")
          }
          body={t(
            "直接用預設助手開始，或選一位專家。保存背景，再決定何時交付工作。",
            "Start directly with the default assistant or choose a specialist. Save the background and delegate when ready.",
          )}
          action={
            <button className="button secondary" onClick={() => setOpen(true)}>
              {t("開始會話", "Start conversation")}
            </button>
          }
        />
      )}
      {open && (
        <NewConversation
          onClose={() => setOpen(false)}
          onSaved={(id) => nav("/app/conversations/" + id)}
        />
      )}
    </>
  );
}
export function RecentConversations() {
  const w = useWorkspace(),
    { t } = useI18n(),
    data = useData(w.base + "/conversations");
  return (
    <section className="section-block">
      <div className="section-title">
        <h2>{t("繼續會話", "Continue a conversation")}</h2>
        <Link className="text-link" to="/app/conversations">
          {t("我的會話", "Your conversations")}
          <ArrowRight size={15} />
        </Link>
      </div>
      {data.data?.items.length ? (
        <div className="conversation-strip">
          {data.data.items.slice(0, 3).map((c: any) => (
            <Link className="card" key={c.id} to={"/app/conversations/" + c.id}>
              <MessageSquare size={20} />
              <h3>{c.name}</h3>
              <p className="muted small-text">{c.agent_name}</p>
            </Link>
          ))}
        </div>
      ) : (
        <Link className="conversation-invitation" to="/app/conversations">
          <MessageSquare size={22} />
          <span>
            {t(
              "向預設助手交辦，讓合作延續。",
              "Start with the default assistant. Keep the work moving.",
            )}
          </span>
          <ArrowRight size={17} />
        </Link>
      )}
    </section>
  );
}
export function ConversationDetail() {
  const w = useWorkspace(),
    { t } = useI18n(),
    { id } = useParams(),
    nav = useNavigate();
  const [refresh, setRefresh] = useState(0),
    [settings, setSettings] = useState(false),
    [conversationAdoption, setConversationAdoption] = useState<any>(null),
    [settingsName, setSettingsName] = useState<string | null>(null),
    [adopted, setAdopted] = useState(false),
    [remove, setRemove] = useState(false),
    [mode, setMode] = useState("ask"),
    [intent, setIntent] = useState("delegate"),
    [body, setBody] = useState(""),
    [budget, setBudget] = useState("20"),
    [error, setError] = useState<Error | null>(null);
  const pending = useRef<{ fingerprint: string; payload: any } | null>(null);
  const data = useData(w.base + "/conversations/" + id, refresh, 3000),
    agents = useData(w.base + "/agents", refresh);
  const c = data.data,
    agent = agents.data?.items.find((a: any) => a.id === c?.agent_id),
    active = c?.tasks.find((task: any) =>
      [
        "queued",
        "running",
        "paused",
        "awaiting_approval",
        "reconciling",
        "needs_input",
      ].includes(task.status),
    );
  async function update(fields: unknown) {
    try {
      await patch(w.base + "/conversations/" + id, {
        expected_version: c.version,
        ...(fields as object),
      });
      setRefresh((v) => v + 1);
      setError(null);
    } catch (e) {
      setError(e as Error);
    }
  }
  return (
    <>
      <Link className="text-link" to="/app/conversations">
        ← {t("我的會話", "Your conversations")}
      </Link>
      <ErrorNotice error={data.error ?? error} />
      {c && <ProjectConfigurationSummary taskId={c.tasks?.at(-1)?.id} compact />}
      {!c ? (
        data.loading && <Loading />
      ) : (
        <>
          <PageHeader
            title={c.name}
            description={
              (agent?.name ?? t("專家", "Specialist")) +
              " · v" +
              c.agent_version
            }
            action={
              <div className="row-actions">
                <Link
                  className="button secondary"
                  to={"/app/files?conversation=" + id}
                >
                  {t("會話檔案", "Conversation files")}
                </Link>
                <button
                  className="icon-button"
                  aria-label={
                    c.pinned ? t("取消置頂", "Unpin") : t("置頂", "Pin")
                  }
                  aria-pressed={c.pinned}
                  onClick={() => void update({ pinned: !c.pinned })}
                >
                  <Pin size={18} />
                </button>
                <button
                  className="button secondary"
                  onClick={() => setSettings(true)}
                >
                  <Settings2 size={16} />
                  {t("會話設定", "Conversation settings")}
                </button>
              </div>
            }
          />
          {adopted && (
            <p className="success-line" role="status">
              <Check size={16} />
              {t(
                "已儲存；後續工作將使用已確認的專家版本。",
                "Saved. Future tasks will use the confirmed specialist version.",
              )}
            </p>
          )}
          <div className="conversation-layout">
            <section className="card ongoing-conversation">
              <div className="conversation-topline">
                <span className="privacy-label">
                  <LockKeyhole size={14} />
                  {t(
                    "會話與交付僅你可見",
                    "Conversation and deliverables are private",
                  )}
                </span>
                {c.archived && (
                  <span className="muted">{t("已封存", "Archived")}</span>
                )}
              </div>
              <div
                className="message-stack"
                aria-live="polite"
                aria-relevant="additions"
              >
                {c.messages.length ? (
                  c.messages.map((m: any) => (
                    <article
                      key={m.id}
                      className={"work-message message-" + m.role}
                    >
                      <header>
                        <strong>
                          {m.role === "assistant"
                            ? (agent?.name ?? "CopyPaste")
                            : t("你", "You")}
                        </strong>
                        <span>
                          {m.intent === "note"
                            ? t("筆記", "Note")
                            : m.role === "assistant"
                              ? t("回覆", "Reply")
                              : t("已交付工作", "Delegated")}
                        </span>
                        <DateText value={m.created_at} />
                      </header>
                      <p className="preserve-text">{m.body}</p>
                      {m.task_id && (
                        <Link
                          className="text-link"
                          to={"/app/tasks/" + m.task_id}
                        >
                          {t("查看工作與費用", "View task and usage")}
                          <ArrowUpRight size={14} />
                        </Link>
                      )}
                    </article>
                  ))
                ) : (
                  <div className="conversation-welcome">
                    <Sparkles size={28} />
                    <h2>
                      {t(
                        "先說說你的想法。",
                        "Start with what is on your mind.",
                      )}
                    </h2>
                    <p className="muted">
                      {t(
                        "可以先保存筆記；準備好後再諮詢、規劃或執行。",
                        "Save a note, or choose to ask, plan or execute when you are ready.",
                      )}
                    </p>
                  </div>
                )}
              </div>
              {active && (
                <div className="notice">
                  <Badge value={active.status} />
                  {active.status === "queued" &&
                    active.capacity_wait_reason && (
                      <span>
                        {t(
                          "等待執行名額；原預算保持預留。",
                          "Waiting for execution capacity; the original budget remains reserved.",
                        )}
                      </span>
                    )}
                  <Link className="text-link" to={"/app/tasks/" + active.id}>
                    {t("查看進度或取消工作", "View progress or cancel")}
                  </Link>
                </div>
              )}
              {active?.status === "needs_input" && (
                <TaskInputRequests
                  task={{ ...active, conversation_id: c.id }}
                  onChange={() => setRefresh((v) => v + 1)}
                />
              )}
              {c.archived ? (
                <div className="notice">
                  <p>
                    {t(
                      "取消封存即可繼續會話。",
                      "Unarchive to continue this conversation.",
                    )}
                  </p>
                  <button
                    className="text-button"
                    onClick={() => void update({ archived: false })}
                  >
                    {t("取消封存", "Unarchive")}
                  </button>
                </div>
              ) : (
                <AsyncForm
                  submitLabel={
                    intent === "note"
                      ? t("保存筆記", "Save note")
                      : t("交付工作", "Delegate task")
                  }
                  onSubmit={async () => {
                    const fingerprint = JSON.stringify({
                      body,
                      intent,
                      mode,
                      budget,
                    });
                    if (pending.current?.fingerprint !== fingerprint)
                      pending.current = {
                        fingerprint,
                        payload: {
                          client_message_id: crypto.randomUUID(),
                          expected_version: c.version,
                          intent,
                          mode,
                          body,
                          ...(intent === "delegate"
                            ? {
                                budget_micros: Math.round(Number(budget) * 1e6),
                              }
                            : {}),
                        },
                      };
                    try {
                      await post(
                        `${w.base}/conversations/${id}/messages`,
                        pending.current!.payload,
                      );
                      pending.current = null;
                      setBody("");
                      setRefresh((v) => v + 1);
                    } catch (e) {
                      if (e instanceof ApiError && e.status < 500)
                        pending.current = null;
                      throw e;
                    }
                  }}
                >
                  <Field label={t("訊息用途", "Message purpose")}>
                    <select
                      value={intent}
                      onChange={(e) => setIntent(e.target.value)}
                    >
                      <option value="delegate">
                        {t("交付給專家", "Delegate to specialist")}
                      </option>
                      <option value="note">
                        {t("保存筆記（不啟動 AI）", "Save note (no AI task)")}
                      </option>
                    </select>
                  </Field>
                  <Field label={t("你的訊息", "Your message")}>
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={4}
                      minLength={intent === "delegate" ? 5 : 1}
                      maxLength={30000}
                      required
                      placeholder={t(
                        "描述目標、素材和交付要求…",
                        "Describe your goal, materials and deliverables…",
                      )}
                    />
                  </Field>
                  {intent === "delegate" && (
                    <>
                      <ModeField value={mode} onChange={setMode} />
                      <Field
                        label={t(
                          "本次工作預算上限（HKD）",
                          "Task budget limit (HKD)",
                        )}
                      >
                        <input
                          type="number"
                          min="1"
                          max="10000"
                          step="0.01"
                          value={budget}
                          onChange={(e) => setBudget(e.target.value)}
                          required
                        />
                      </Field>
                      {active && (
                        <p className="muted small-text">
                          {t(
                            "請等待目前工作完成，或先取消；期間仍可保存筆記。",
                            "Wait for the current task or cancel it. You can still save notes.",
                          )}
                        </p>
                      )}
                    </>
                  )}
                </AsyncForm>
              )}
            </section>
            <aside className="conversation-aside">
              <div className="card">
                <h3>{t("這段合作", "This conversation")}</h3>
                <p className="muted small-text">
                  {t(
                    "新工作會使用這個專家版本、已保存的會話和你有權使用的記憶。",
                    "New tasks use this specialist version, saved conversation and memories you are authorized to use.",
                  )}
                </p>
                <Link className="text-link" to="/app/memories">
                  <BookOpen size={16} />
                  {t("管理記憶", "Manage memories")}
                </Link>
              </div>
              <div className="card">
                <h3>{t("工作記錄", "Tasks")}</h3>
                {c.tasks.length ? (
                  c.tasks.map((task: any) => (
                    <Link
                      className="conversation-task"
                      key={task.id}
                      to={"/app/tasks/" + task.id}
                    >
                      <strong>{task.title}</strong>
                      <Badge value={task.status} />
                      <span className="muted small-text">
                        {task.mode} · {t("已結算 ", "Settled ")}
                        <Money value={task.charged_micros} />
                        {Number(task.accrued_micros) >
                          Number(task.charged_micros) && (
                          <>
                            {" "}
                            · {t("已記錄用量 ", "Recorded usage ")}
                            <Money value={task.accrued_micros} />
                          </>
                        )}
                      </span>
                    </Link>
                  ))
                ) : (
                  <p className="muted small-text">
                    {t(
                      "交付工作後，進度和費用會顯示在這裡。",
                      "Delegated tasks and their usage appear here.",
                    )}
                  </p>
                )}
              </div>
            </aside>
          </div>
          {settings && (
            <Modal
              title={t("會話設定", "Conversation settings")}
              onClose={() => {
                setSettings(false);
                setConversationAdoption(null);
                setSettingsName(null);
              }}
            >
              {conversationAdoption ? (
                <AdoptionReview
                  endpoint={`${w.base}/conversations/${id}/adoption-previews`}
                  proposal={conversationAdoption}
                  onBack={(stale) => {
                    setConversationAdoption(null);
                    if (stale) {
                      setSettings(false);
                      setSettingsName(null);
                      setRefresh((v) => v + 1);
                    }
                  }}
                  onSaved={() => {
                    setConversationAdoption(null);
                    setSettings(false);
                    setSettingsName(null);
                    setRefresh((v) => v + 1);
                    setAdopted(true);
                  }}
                />
              ) : (
                <>
                  <AsyncForm
                    submitLabel={t("儲存設定", "Save settings")}
                    onSubmit={async (f) => {
                      if (f.get("adopt") === "on") {
                        const name = String(f.get("name"));
                        setSettingsName(name);
                        setConversationAdoption({
                          name,
                          expected_version: c.version,
                          target_agent_version: agent.version,
                        });
                        return;
                      }
                      await patch(w.base + "/conversations/" + id, {
                        name: String(f.get("name")),
                        expected_version: c.version,
                      });
                      setRefresh((v) => v + 1);
                      setSettings(false);
                    }}
                  >
                    <Field label={t("會話名稱", "Conversation name")}>
                      <input
                        name="name"
                        defaultValue={settingsName ?? c.name}
                        maxLength={160}
                        required
                      />
                    </Field>
                    {agent?.version > c.agent_version && (
                      <label className="check-line">
                        <input type="checkbox" name="adopt" />
                        {t(
                          `後續工作使用專家 v${agent.version}`,
                          `Use specialist v${agent.version} for future tasks`,
                        )}
                      </label>
                    )}
                  </AsyncForm>
                  <div className="conversation-settings-actions">
                    <button
                      className="button secondary"
                      onClick={() =>
                        void update({ archived: !c.archived }).then(() =>
                          setSettings(false),
                        )
                      }
                    >
                      <Archive size={16} />
                      {c.archived
                        ? t("取消封存", "Unarchive")
                        : t("封存會話", "Archive conversation")}
                    </button>
                    <button
                      className="text-button danger-text"
                      onClick={() => {
                        setSettings(false);
                        setRemove(true);
                      }}
                    >
                      <Trash2 size={16} />
                      {t("刪除會話", "Delete conversation")}
                    </button>
                  </div>
                </>
              )}
            </Modal>
          )}
          {remove && (
            <Modal
              title={t("刪除會話", "Delete conversation")}
              onClose={() => setRemove(false)}
            >
              <AsyncForm
                submitLabel={t(
                  "永久刪除此會話內容",
                  "Permanently delete conversation content",
                )}
                onSubmit={async () => {
                  await api(w.base + "/conversations/" + id, {
                    method: "DELETE",
                    body: JSON.stringify({ expected_version: c.version }),
                  });
                  nav("/app/conversations");
                }}
              >
                <p>
                  {t(
                    "會話訊息、工作文字與私有交付的存取將移除。已發佈到專案的檔案和費用記錄會保留。此操作無法還原。",
                    "Messages, task text and access to private deliverables will be removed. Files already published to the project and billing records remain. This cannot be undone.",
                  )}
                </p>
                <label className="check-line">
                  <input type="checkbox" required />
                  {t("我了解並確認刪除", "I understand and confirm deletion")}
                </label>
              </AsyncForm>
            </Modal>
          )}
        </>
      )}
    </>
  );
}

const scopes: Record<string, [string, string]> = {
  personal: ["個人偏好（僅自己）", "Personal (only you)"],
  conversation: ["會話背景（僅自己）", "Conversation (only you)"],
  project: ["專案要求（專案共用）", "Project (shared)"],
  brand: ["品牌規範（專案共用）", "Brand (shared)"],
  tenant: ["企業規範（企業共用）", "Workspace (shared)"],
};
export function Memories() {
  const w = useWorkspace(),
    { t } = useI18n();
  const [refresh, setRefresh] = useState(0),
    [editing, setEditing] = useState<any>(null),
    [removing, setRemoving] = useState<any>(null),
    [filter, setFilter] = useState("all");
  const data = useData(w.base + "/memories", refresh);
  const items =
    data.data?.items.filter(
      (m: any) => filter === "all" || m.scope === filter,
    ) ?? [];
  return (
    <>
      <PageHeader
        eyebrow="THE DETAILS WORTH REMEMBERING."
        title={t("記憶與偏好", "Memory & preferences")}
        description={t(
          "保存確認過的品牌、專案與個人要求。你可以查看、修改、設定期限或刪除。",
          "Save approved brand, project and personal instructions. Review, edit, set an expiry or delete them.",
        )}
        action={
          <button className="button primary" onClick={() => setEditing({})}>
            <Plus size={17} />
            {t("加入記憶", "Add memory")}
          </button>
        }
      />
      <div className="work-toolbar">
        <Field label={t("適用範圍", "Scope")}>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">{t("全部", "All")}</option>
            {Object.entries(scopes).map(([key, label]) => (
              <option value={key} key={key}>
                {t(...label)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ErrorNotice error={data.error} />
      {data.loading && !data.data ? (
        <Loading />
      ) : items.length ? (
        <div className="project-grid">
          {items.map((m: any) => (
            <article className="card memory-card" key={m.id}>
              <span className="privacy-label">
                {m.private_owner ? (
                  <LockKeyhole size={14} />
                ) : (
                  <BookOpen size={14} />
                )}{" "}
                {t(...scopes[m.scope])}
              </span>
              <h2>{m.name}</h2>
              <p className="memory-content preserve-text">{m.content}</p>
              <div className="muted small-text">
                v{m.version}{" "}
                {m.expires_at && (
                  <>
                    {" "}
                    ·{" "}
                    {new Date(m.expires_at) <= new Date()
                      ? t("已到期", "Expired")
                      : t("有效至", "Expires")}{" "}
                    <DateText value={m.expires_at} />
                  </>
                )}
              </div>
              <footer className="row-actions">
                <button className="text-button" onClick={() => setEditing(m)}>
                  <Settings2 size={15} />
                  {t("編輯", "Edit")}
                </button>
                <button
                  className="text-button danger-text"
                  onClick={() => setRemoving(m)}
                >
                  <Trash2 size={15} />
                  {t("刪除", "Delete")}
                </button>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={BookOpen}
          title={t("把重要細節，留給下次。", "Keep the details that matter.")}
          body={t(
            "例如用字風格、不能更改的品牌規範，或專案的驗收要求。",
            "Save a preferred tone, brand requirements or project acceptance criteria.",
          )}
          action={
            <button className="button secondary" onClick={() => setEditing({})}>
              {t("加入記憶", "Add memory")}
            </button>
          }
        />
      )}
      <p className="muted small-text section-block">
        {t(
          "保存記憶不會啟動 AI。共用範圍須具備相應管理權限；已刪除或到期的記憶不會再用於新工作，執行中的工作也會重新檢查。",
          "Saving memory does not start AI. Shared scopes require management permission. Expired or deleted memories are excluded from new tasks and rechecked during active work.",
        )}
      </p>
      {editing && (
        <MemoryEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setRefresh((v) => v + 1);
          }}
        />
      )}
      {removing && (
        <Modal
          title={t("刪除記憶", "Delete memory")}
          onClose={() => setRemoving(null)}
        >
          <AsyncForm
            submitLabel={t("確認刪除", "Confirm deletion")}
            onSubmit={async () => {
              await api(w.base + "/memories/" + removing.id, {
                method: "DELETE",
                body: JSON.stringify({ expected_version: removing.version }),
              });
              setRemoving(null);
              setRefresh((v) => v + 1);
            }}
          >
            <p>
              {t(
                `「${removing.name}」的所有版本文字會被清除，無法還原。引用它的執行中工作會停止後續調用。`,
                `All text versions of “${removing.name}” will be erased. This cannot be undone. Active work referencing it will stop subsequent calls.`,
              )}
            </p>
            <label className="check-line">
              <input type="checkbox" required />
              {t("我了解並確認刪除", "I understand and confirm deletion")}
            </label>
          </AsyncForm>
        </Modal>
      )}
    </>
  );
}
function MemoryEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const w = useWorkspace(),
    { t } = useI18n(),
    [scope, setScope] = useState(initial.scope ?? "personal"),
    brands = useData(w.base + "/brand"),
    conversations = useData(w.base + "/conversations");
  const localTime = initial.expires_at
    ? new Date(
        new Date(initial.expires_at).getTime() -
          new Date(initial.expires_at).getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16)
    : "";
  return (
    <Modal
      title={
        initial.id ? t("編輯記憶", "Edit memory") : t("加入記憶", "Add memory")
      }
      onClose={onClose}
    >
      <AsyncForm
        submitLabel={t("儲存記憶", "Save memory")}
        onSubmit={async (f) => {
          const body = {
            name: String(f.get("name")),
            scope,
            content: String(f.get("content")),
            expires_at: f.get("expires")
              ? new Date(String(f.get("expires"))).toISOString()
              : null,
            ...(scope === "brand"
              ? { brand_id: initial.brand_id ?? String(f.get("brand")) }
              : {}),
            ...(scope === "conversation"
              ? {
                  conversation_id:
                    initial.conversation_id ?? String(f.get("conversation")),
                }
              : {}),
          };
          if (initial.id)
            await patch(w.base + "/memories/" + initial.id, {
              ...body,
              expected_version: initial.version,
            });
          else await post(w.base + "/memories", body);
          onSaved();
        }}
      >
        <Field label={t("記憶名稱", "Memory name")}>
          <input
            name="name"
            defaultValue={initial.name ?? ""}
            maxLength={160}
            required
          />
        </Field>
        <Field label={t("適用範圍", "Scope")}>
          <select
            value={scope}
            disabled={!!initial.id}
            onChange={(e) => setScope(e.target.value)}
          >
            {Object.entries(scopes).map(([key, label]) => (
              <option key={key} value={key}>
                {t(...label)}
              </option>
            ))}
          </select>
        </Field>
        {scope === "brand" && (
          <Field label={t("品牌", "Brand")}>
            <select
              name="brand"
              defaultValue={initial.brand_id ?? ""}
              required
              disabled={!!initial.id}
            >
              <option value="" disabled>
                {t("選擇品牌", "Choose a brand")}
              </option>
              {initial.brand_id &&
                !brands.data?.items.some(
                  (b: any) => b.id === initial.brand_id,
                ) && (
                  <option value={initial.brand_id}>{initial.brand_id}</option>
                )}
              {brands.data?.items.map((b: any) => (
                <option value={b.id} key={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {scope === "conversation" && (
          <Field label={t("會話", "Conversation")}>
            <select
              name="conversation"
              defaultValue={initial.conversation_id ?? ""}
              required
              disabled={!!initial.id}
            >
              <option value="" disabled>
                {t("選擇會話", "Choose a conversation")}
              </option>
              {initial.conversation_id &&
                !conversations.data?.items.some(
                  (c: any) => c.id === initial.conversation_id,
                ) && (
                  <option value={initial.conversation_id}>
                    {initial.conversation_id}
                  </option>
                )}
              {conversations.data?.items.map((c: any) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t("確認過的內容", "Approved content")}>
          <textarea
            name="content"
            defaultValue={initial.content ?? ""}
            rows={6}
            maxLength={8000}
            required
          />
        </Field>
        <Field
          label={t(
            "到期時間（選填，當地時間）",
            "Expiry (optional, local time)",
          )}
        >
          <input
            name="expires"
            type="datetime-local"
            defaultValue={localTime}
          />
        </Field>
        <ErrorNotice
          error={
            scope === "brand"
              ? brands.error
              : scope === "conversation"
                ? conversations.error
                : null
          }
        />
      </AsyncForm>
    </Modal>
  );
}

export function TaskPlan({ task }: { task: any }) {
  const w = useWorkspace(),
    { t } = useI18n(),
    nav = useNavigate(),
    data = useData(
      task.mode === "plan" && task.status === "succeeded"
        ? `${w.base}/tasks/${task.id}/plan`
        : null,
      task.version,
    );
  const plan = data.data;
  if (task.mode !== "plan" || task.status !== "succeeded") return null;
  return (
    <section className="card section-block plan-review">
      <h2>{t("確認計畫，再開始執行。", "Review the plan, then begin.")}</h2>
      <p className="muted">
        {t(
          "規劃工作沒有建立交付檔案。確認上方計畫並設定執行預算，才會開始下一項工作。",
          "Planning did not create deliverables. Review the plan above and set an execution budget to start the next task.",
        )}
      </p>
      <ErrorNotice error={data.error} />
      {data.loading ? (
        <Loading />
      ) : plan?.approved_task_id ? (
        <Link
          className="button primary"
          to={"/app/tasks/" + plan.approved_task_id}
        >
          <Check size={17} />
          {t("查看已確認的執行工作", "View approved execution")}
        </Link>
      ) : (
        plan && (
          <AsyncForm
            submitLabel={t(
              "確認此計畫並開始執行",
              "Approve this plan and execute",
            )}
            onSubmit={async (f) => {
              const result = await post(
                `${w.base}/tasks/${task.id}/plan/approve`,
                {
                  expected_task_version: task.version,
                  plan_version: plan.version,
                  input_hash: plan.input_hash,
                  budget_micros: Math.round(Number(f.get("budget")) * 1e6),
                },
              );
              nav("/app/tasks/" + result.id);
            }}
          >
            <Field
              label={t("執行預算上限（HKD）", "Execution budget limit (HKD)")}
            >
              <input
                name="budget"
                type="number"
                min="1"
                max="10000"
                step="0.01"
                defaultValue="20"
                required
              />
            </Field>
            <label className="check-line">
              <input type="checkbox" required />
              {t(
                "我已審閱計畫並授權執行",
                "I reviewed the plan and authorize execution",
              )}
            </label>
          </AsyncForm>
        )
      )}
    </section>
  );
}
