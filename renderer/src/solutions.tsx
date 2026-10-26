import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Layers,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { api, ApiError } from "./api";
import { useWorkspace } from "./context";
import {
  Badge,
  ErrorNotice,
  Field,
  Loading,
  Modal,
  Money,
  PageHeader,
  useData,
  useI18n,
} from "./ui";
import "./solutions.css";
import { LocalSolutionTrial } from "./local-solution-trial";

type Bindings = {
  assets: { requirement: string; asset_version_id: string; sha256: string }[];
  connectors: {
    provider: string;
    connection_id: string;
    version: number;
    auth_version: number;
    account_id: string;
  }[];
};
type Definition = {
  project_id: string;
  name: string;
  instructions: string;
  agent_template_ids: string[];
  skill_version_ids: string[];
  required_assets: string[];
  required_connectors: string[];
};
type Method = {
  id: string;
  project_id: string;
  version: number;
  state: string;
  definition: Definition;
  templates?: any[];
  definition_hash?: string;
};
type Attempt = {
  key: string;
  path: string;
  body: any;
  kind:
    | "create"
    | "revise"
    | "trial"
    | "review"
    | "publish"
    | "install"
    | "configure"
    | "disable";
};
type Draft = {
  name: string;
  instructions: string;
  template_ids: string[];
  assets: string;
  connectors: string[];
  brief: string;
  budget: string;
};
type Saved = {
  scope: { user: string; tenant: string; project: string };
  pending?: Attempt;
  draft: Draft;
  method?: string;
  installation?: string;
  trial?: string;
  bindings: Bindings;
};
const blank = (): Bindings => ({ assets: [], connectors: [] });
const draftBlank = (): Draft => ({
  name: "",
  instructions: "",
  template_ids: [],
  assets: "",
  connectors: [],
  brief: "",
  budget: "5",
});
const providers = [
  ["google_ads", "Google Ads"],
  ["ga4", "Google Analytics"],
  ["search_console", "Search Console"],
  ["meta_ads", "Meta Ads"],
];
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function savedDraft(
  key: string,
  scope: Saved["scope"],
): { value: Saved; error?: Error } {
  const fallback = { scope, draft: draftBlank(), bindings: blank() };
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return { value: fallback };
    if (raw.length > 128000) throw new Error();
    const v = JSON.parse(raw);
    if (
      JSON.stringify(v.scope) !== JSON.stringify(scope) ||
      !v.draft ||
      typeof v.draft.instructions !== "string" ||
      !Array.isArray(v.bindings?.assets) ||
      !Array.isArray(v.bindings?.connectors)
    )
      throw new Error();
    if (
      v.pending &&
      (!uuid.test(v.pending.key) ||
        !/^\/v1\/(?:solution-versions(?:\/[a-f0-9-]{36}\/(?:revisions|trials|publications|installations|disable))?|solution-trials\/[a-f0-9-]{36}\/reviews|solution-installations\/[a-f0-9-]{36}\/configurations)$/.test(
          v.pending.path,
        ) ||
        ![
          "create",
          "revise",
          "trial",
          "review",
          "publish",
          "install",
          "configure",
          "disable",
        ].includes(v.pending.kind) ||
        !v.pending.body)
    )
      throw new Error();
    return { value: v };
  } catch {
    return {
      value: fallback,
      error: new Error("SOLUTION_SAVED_REQUEST_UNVERIFIED"),
    };
  }
}
export function Solutions() {
  const w = useWorkspace();
  return (
    <SolutionsWorkspace key={`${w.me?.user?.id}:${w.tenant}:${w.project}`} />
  );
}
function SolutionsWorkspace() {
  const w = useWorkspace(),
    { t, locale } = useI18n(),
    [query, setQuery] = useSearchParams();
  const scope = {
    user: String(w.me.user.id),
    tenant: w.tenant,
    project: w.project,
  };
  const storageKey =
    "cp_work_selection_v1:solutions:" +
    Object.values(scope).map(encodeURIComponent).join(":");
  const [initial] = useState(() => savedDraft(storageKey, scope));
  const [draft, setDraft] = useState(initial.value.draft),
    [bindings, setBindings] = useState(initial.value.bindings);
  const [pending, setPending] = useState<Attempt | undefined>(
      initial.value.pending,
    ),
    [trialId, setTrialId] = useState(initial.value.trial ?? "");
  const [error, setError] = useState<Error | null>(initial.error ?? null),
    [busy, setBusy] = useState(false),
    [storageError, setStorageError] = useState(false);
  const [tab, setTab] = useState("published"),
    [pages, setPages] = useState<string[]>([]),
    [trialPages, setTrialPages] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0),
    [preview, setPreview] = useState<any>(null),
    [consent, setConsent] = useState(false),
    [acceptConsent, setAcceptConsent] = useState(false);
  const [editor, setEditor] = useState<"create" | "revise" | null>(null),
    [reason, setReason] = useState(""),
    [showDisable, setShowDisable] = useState(false);
  const [online, setOnline] = useState(navigator.onLine),
    [assetCursor, setAssetCursor] = useState(""),
    [connectionCursor, setConnectionCursor] = useState("");
  const [assets, setAssets] = useState<any[]>([]),
    [connections, setConnections] = useState<any[]>([]);
  const [bindingRevision, setBindingRevision] = useState("");
  const methodId = uuid.test(query.get("method") ?? "")
    ? query.get("method")!
    : (initial.value.method ?? "");
  const installationId = uuid.test(query.get("installation") ?? "")
    ? query.get("installation")!
    : (initial.value.installation ?? "");
  const live = useRef(true),
    lock = useRef(false),
    state = useRef<Saved>(initial.value);
  state.current = {
    scope,
    draft,
    bindings,
    pending,
    trial: trialId,
    method: methodId,
    installation: installationId,
  };
  const headers = { "X-Tenant-ID": w.tenant };
  const access = useData<any>(
    `/v1/solution-access?project_id=${w.project}`,
    refresh,
    0,
    w.tenant,
  );
  const directoryUrl =
    tab === "installed"
      ? `/v1/solution-installations?project_id=${w.project}`
      : "/v1/solution-versions?limit=12" +
        (tab === "project" ? `&project_id=${w.project}` : "");
  const directory = useData<any>(
    directoryUrl + (pages.length ? "&cursor=" + pages.at(-1) : ""),
    refresh,
    0,
    w.tenant,
  );
  const selected = useData<Method>(
    methodId ? `/v1/solution-versions/${methodId}/details` : null,
    refresh,
    0,
    w.tenant,
  );
  const installation = useData<any>(
    installationId ? `/v1/solution-installations/${installationId}` : null,
    refresh,
    0,
    w.tenant,
  );
  const templates = useData<any>("/v1/agent-templates", refresh, 0, w.tenant);
  const sourcePage = useData<any>(
    access.data?.can_write
      ? `/v1/solution-targets?project_id=${w.project}&kind=assets&limit=30` +
          (assetCursor ? "&cursor=" + assetCursor : "")
      : null,
    refresh,
    0,
    w.tenant,
  );
  const connectorPage = useData<any>(
    access.data?.can_write
      ? `/v1/solution-targets?project_id=${w.project}&kind=connectors&limit=20` +
          (connectionCursor ? "&cursor=" + connectionCursor : "")
      : null,
    refresh,
    0,
    w.tenant,
  );
  const trials = useData<any>(
    methodId && access.data?.can_write
      ? `/v1/solution-versions/${methodId}/trials?project_id=${w.project}&limit=6` +
          (trialPages.length ? "&cursor=" + trialPages.at(-1) : "")
      : null,
    refresh,
    0,
    w.tenant,
  );
  const trial = useData<any>(
    trialId ? `/v1/solution-trials/${trialId}` : null,
    refresh,
    2500,
    w.tenant,
    { retainOnRefresh: true },
  );
  const method = selected.data,
    blocked =
      busy ||
      !!pending ||
      !!initial.error ||
      storageError ||
      (!!installationId &&
        (!installation.data ||
          bindingRevision !==
            installationId + ":" + installation.data.revision)),
    native = !!window.copyPasteBridge;
  const manageable =
    access.data?.can_manage && method?.project_id === w.project;
  useEffect(() => {
    live.current = true;
    const change = () => setOnline(navigator.onLine);
    window.addEventListener("online", change);
    window.addEventListener("offline", change);
    return () => {
      live.current = false;
      window.removeEventListener("online", change);
      window.removeEventListener("offline", change);
    };
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state.current));
    } catch {
      setStorageError(true);
    }
  }, [draft, bindings, pending, trialId, methodId, installationId]);
  useEffect(() => {
    if (sourcePage.data)
      setAssets((old) => [
        ...new Map(
          [...old, ...sourcePage.data.items].map((v) => [
            v.asset_version_id,
            v,
          ]),
        ).values(),
      ]);
  }, [sourcePage.data]);
  useEffect(() => {
    if (connectorPage.data)
      setConnections((old) => [
        ...new Map(
          [...old, ...connectorPage.data.items].map((v) => [v.id, v]),
        ).values(),
      ]);
  }, [connectorPage.data]);
  const installedRevision = useRef({ id: "", revision: 0 });
  useEffect(() => {
    const v = installation.data;
    if (
      !v ||
      (installedRevision.current.id === installationId &&
        installedRevision.current.revision >= v.revision) ||
      pending
    )
      return;
    installedRevision.current = { id: installationId, revision: v.revision };
    setBindings(v.bindings);
    setBindingRevision(installationId + ":" + v.revision);
    setPreview(null);
    setConsent(false);
  }, [installation.data, installationId, pending]);
  function saveBefore(attempt?: Attempt) {
    const value = { ...state.current, pending: attempt };
    // A billable request is never dispatched without a recoverable exact key.
    sessionStorage.setItem(storageKey, JSON.stringify(value));
    state.current = value;
  }
  function choose(id: string, install = "") {
    if (blocked) return;
    setQuery({ method: id, ...(install ? { installation: install } : {}) });
    setBindings(blank());
    setBindingRevision("");
    setPreview(null);
    setTrialId("");
    setConsent(false);
    setAcceptConsent(false);
    setTrialPages([]);
    setError(null);
  }
  function changed(next: Bindings) {
    if (blocked) return;
    setBindings(next);
    setPreview(null);
    setConsent(false);
  }
  async function run(
    kind: Attempt["kind"],
    path: string,
    body: any,
    original?: Attempt,
  ) {
    if (
      lock.current ||
      !online ||
      initial.error ||
      storageError ||
      (pending && !original)
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const attempt = original ?? { key: crypto.randomUUID(), path, body, kind };
    try {
      saveBefore(attempt);
      setPending(attempt);
      const result = await api(attempt.path, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": attempt.key },
        body: JSON.stringify(attempt.body),
      });
      if (!live.current) return;
      let next = { ...state.current, pending: undefined };
      if (attempt.kind === "create" || attempt.kind === "revise") {
        next = {
          ...next,
          method: result.id,
          installation: "",
          trial: "",
          bindings: blank(),
        };
        setQuery({ method: result.id });
        setBindings(blank());
        setTrialId("");
        setEditor(null);
        setTab("project");
        setPages([]);
      } else if (attempt.kind === "trial") {
        next.trial = result.id;
        setTrialId(result.id);
        setConsent(false);
      } else if (attempt.kind === "install") {
        next.installation = result.id;
        next.bindings = blank();
        setQuery({
          method: result.solution_version_id,
          installation: result.id,
        });
        setBindings(blank());
        setTab("installed");
        setPages([]);
      } else if (attempt.kind === "configure") {
        // A late read of the previous revision must not restore old bindings
        // or clear a fresh preview made immediately after this acknowledgement.
        installedRevision.current = {
          id: installationId,
          revision: result.revision,
        };
        setBindingRevision(installationId + ":" + result.revision);
        setBindings(result.bindings);
        next.bindings = result.bindings;
      }
      sessionStorage.setItem(storageKey, JSON.stringify(next));
      state.current = next;
      setPending(undefined);
      setPreview(null);
      setAcceptConsent(false);
      setShowDisable(false);
      setRefresh((v) => v + 1);
    } catch (failure) {
      if (
        !live.current ||
        (failure instanceof ApiError && failure.code === "SESSION_CHANGED")
      )
        return;
      const definite =
        failure instanceof ApiError &&
        failure.status >= 400 &&
        failure.status < 500 &&
        ![401, 408, 425, 429].includes(failure.status) &&
        !["IDEMPOTENCY_CONFLICT", "REQUEST_RESULT_REMOVED"].includes(
          failure.code,
        );
      if (definite) {
        saveBefore();
        setPending(undefined);
        setPreview(null);
        setConsent(false);
      }
      setError(failure as Error);
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function check() {
    if (!method || blocked || !online) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    setConsent(false);
    try {
      const result = await api(`/v1/solution-versions/${method.id}/previews`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          project_id: w.project,
          ...(installationId ? { installation_id: installationId } : {}),
          bindings,
        }),
      });
      if (live.current) setPreview(result);
    } catch (e) {
      if (live.current) setError(e as Error);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  function edit(kind: "create" | "revise") {
    if (blocked) return;
    if (kind === "revise" && method)
      setDraft((v) => ({
        ...v,
        name: method.definition.name,
        instructions: method.definition.instructions,
        template_ids: method.definition.agent_template_ids,
        assets: method.definition.required_assets.join("\n"),
        connectors: method.definition.required_connectors,
      }));
    setEditor(kind);
  }
  const creation = (event: React.FormEvent) => {
    event.preventDefault();
    const body: Definition = {
      project_id: w.project,
      name: draft.name.trim(),
      instructions: draft.instructions.trim(),
      agent_template_ids: draft.template_ids,
      skill_version_ids: [],
      required_assets: draft.assets
        .split(/\r?\n/)
        .map((v) => v.trim())
        .filter(Boolean),
      required_connectors: draft.connectors,
    };
    void run(
      editor === "revise" ? "revise" : "create",
      editor === "revise"
        ? `/v1/solution-versions/${methodId}/revisions`
        : "/v1/solution-versions",
      body,
    );
  };
  const ready =
    preview?.state === "ready" &&
    preview.task_capacity?.available >= preview.task_capacity?.required;
  const result = trial.data,
    allSucceeded =
      result?.tasks?.length &&
      result.tasks.every((v: any) => v.status === "succeeded");
  const matchingTrial =
    result?.solution_version_id === methodId &&
    result?.project_id === w.project;
  return (
    <div className="solutions-workspace">
      <PageHeader
        eyebrow="COPYPASTE · METHODS"
        title={t("讓好方法，再用一次。", "Good work, made repeatable.")}
        description={t(
          "把角色、技能與資料要求整理為一份可驗證的方案。每個新專案，都從自己的資料開始。",
          "Bring roles, skills and input requirements into one reviewed method. Start each project with its own materials.",
        )}
        action={
          access.data?.can_manage && (
            <button
              className="button primary"
              disabled={blocked}
              onClick={() => edit("create")}
            >
              <Plus size={17} />
              {t("建立方案", "Create method")}
            </button>
          )
        }
      />
      <ErrorNotice error={error || access.error} />
      {storageError && (
        <p role="alert" className="notice">
          {t(
            "此分頁無法保存原提交，請恢復儲存權限並重新載入，再提交工作。",
            "This tab cannot save the original submission. Restore browser storage and reload before submitting work.",
          )}
        </p>
      )}
      {!online && (
        <p role="status" className="notice">
          {t(
            "目前離線，已保留原草稿和提交。",
            "You are offline. Your draft and original request are retained.",
          )}
        </p>
      )}
      {pending && (
        <div className="solution-pending" role="status">
          <ShieldCheck size={20} />
          <div>
            <strong>
              {t("原提交尚未確認", "Original request unconfirmed")}
            </strong>
            <p>
              {t(
                "重試會核對同一請求。請先確認原結果，再開始另一項工作。",
                "Retry checks the same request. Confirm its result before starting another operation.",
              )}
            </p>
          </div>
          <button
            className="button primary"
            disabled={busy || !online}
            onClick={() =>
              void run(pending.kind, pending.path, pending.body, pending)
            }
          >
            {t("重試原提交", "Retry original request")}
          </button>
        </div>
      )}
      <div className="solution-layout">
        <aside
          className="solution-library"
          aria-label={t("方案庫", "Method library")}
        >
          <nav
            className="solution-tabs"
            aria-label={t("方案範圍", "Method scope")}
          >
            {[
              ["published", "已發佈", "Published"],
              ["project", "此專案版本", "Project versions"],
              ["installed", "我的已安裝", "Your installations"],
            ].map(([id, zh, en]) => (
              <button
                key={id}
                aria-pressed={tab === id}
                disabled={blocked}
                onClick={() => {
                  setTab(id);
                  setPages([]);
                }}
              >
                {t(zh, en)}
              </button>
            ))}
          </nav>
          <ErrorNotice error={directory.error} />
          {directory.loading && <Loading />}
          {directory.data?.items.length === 0 && (
            <div className="solution-empty">
              <BookOpen size={28} />
              <p>
                {t(
                  "尚未有方案。先在專案建立並試運行一個方法。",
                  "No methods here yet. Create and trial one in your project.",
                )}
              </p>
            </div>
          )}
          <div className="solution-method-list">
            {directory.data?.items.map((row: any) => {
              const installed = tab === "installed",
                id = installed ? row.solution_version_id : row.id;
              return (
                <button
                  key={row.id}
                  disabled={blocked}
                  aria-pressed={
                    installed
                      ? installationId === row.id
                      : methodId === id && !installationId
                  }
                  className="solution-library-item"
                  onClick={() => choose(id, installed ? row.id : "")}
                >
                  <span className="solution-item-title">
                    {installed ? row.name : row.definition.name}
                    <ArrowUpRight size={15} />
                  </span>
                  <small>
                    {installed
                      ? t(
                          "個人安裝 · 目前專案",
                          "Your installation · current project",
                        )
                      : `v${row.version}`}
                  </small>
                  <Badge value={row.state} />
                  {!installed && (
                    <span className="solution-item-dependencies">
                      {row.definition.agent_template_ids.length || 1}{" "}
                      {t("個角色", "roles")} ·{" "}
                      {row.definition.required_assets.length}{" "}
                      {t("項資料", "inputs")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="solution-pagination">
            <button
              className="icon-button"
              aria-label={t("上一頁方案", "Previous methods")}
              disabled={!pages.length || blocked}
              onClick={() => setPages((v) => v.slice(0, -1))}
            >
              <ChevronLeft size={17} />
            </button>
            <span>
              {t("第", "Page ")}
              {pages.length + 1}
              {t("頁", "")}
            </span>
            <button
              className="icon-button"
              aria-label={t("下一頁方案", "Next methods")}
              disabled={!directory.data?.next_cursor || blocked}
              onClick={() =>
                setPages((v) => [...v, directory.data.next_cursor])
              }
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </aside>
        <main className="solution-sheet">
          <ErrorNotice error={selected.error || installation.error} />
          {selected.loading && <Loading />}
          {!method && !selected.loading && (
            <div className="solution-intro">
              <Layers size={36} />
              <h2>
                {t("一份方法，清楚交代。", "A method with a clear brief.")}
              </h2>
              <p>
                {t(
                  "選取已發佈方案，或建立你自己的方法。預覽不建立付費工作；試運行前會列出所需角色、資料及預算。",
                  "Choose a published method or create your own. Preview does not create paid work. Review roles, inputs and budget before a trial.",
                )}
              </p>
              <div className="solution-method-flow">
                <span>{t("角色與技能", "Roles & skills")}</span>
                <span>→</span>
                <span>{t("自己的資料", "Your inputs")}</span>
                <span>→</span>
                <span>{t("驗收與複用", "Review & reuse")}</span>
              </div>
            </div>
          )}
          {method && (
            <>
              <header className="solution-sheet-heading">
                <div>
                  <p className="eyebrow">
                    METHOD / {String(method.version).padStart(2, "0")}
                  </p>
                  <h2>{method.definition.name}</h2>
                </div>
                <Badge value={method.state} />
              </header>
              <p className="solution-method-text">
                {method.definition.instructions}
              </p>
              <section
                className="solution-role-strip"
                aria-label={t("固定角色與技能", "Pinned roles and skills")}
              >
                {method.templates?.map((v: any) => (
                  <div key={v.template_version_id}>
                    <Layers size={17} />
                    <strong>{v.name}</strong>
                    <span>
                      {v.role_key} · v{v.template_version}
                    </span>
                    <small>
                      {v.skill_version_ids.length}{" "}
                      {t("個固定技能版本", "pinned skill versions")}
                    </small>
                  </div>
                ))}
              </section>
              <div className="solution-actions">
                {manageable && (
                  <button
                    className="button secondary"
                    disabled={blocked}
                    onClick={() => edit("revise")}
                  >
                    {t("建立新版本", "Create revision")}
                  </button>
                )}
                {method.state === "published" &&
                  !installationId &&
                  access.data?.can_manage && (
                    <button
                      className="button primary"
                      disabled={blocked || !online}
                      onClick={() =>
                        void run(
                          "install",
                          `/v1/solution-versions/${method.id}/installations`,
                          { project_id: w.project },
                        )
                      }
                    >
                      <Copy size={16} />
                      {t("安裝到此專案", "Install in this project")}
                    </button>
                  )}
                {manageable && method.state !== "disabled" && (
                  <button
                    className="text-button"
                    disabled={blocked}
                    onClick={() => setShowDisable(true)}
                  >
                    {t("停用此版本", "Disable version")}
                  </button>
                )}
              </div>
              {installationId && (
                <p className="solution-copy-note">
                  <Check size={17} />
                  {t(
                    "已安裝方法參照。請為此專案重新選擇所需資料與帳戶。安裝不代表工作已執行。",
                    "Method reference installed. Select the required materials and accounts for this project. Installation does not run work.",
                  )}
                </p>
              )}
              {method.state !== "disabled" && access.data?.can_write && (
                <section className="solution-binding-section">
                  <div className="solution-section-heading">
                    <FileText size={20} />
                    <div>
                      <h3>{t("此專案的資料", "Inputs for this project")}</h3>
                      <p>
                        {t(
                          "只使用目前可獲取的固定版本。試運行的簡報與成果維持私有。",
                          "Use currently accessible, fixed versions. Trial briefs and deliveries stay private.",
                        )}
                      </p>
                    </div>
                  </div>
                  <fieldset disabled={blocked}>
                    {!method.definition.required_assets.length &&
                      !method.definition.required_connectors.length && (
                        <p className="muted">
                          {t(
                            "此方法沒有指定檔案或連接要求。",
                            "This method declares no file or connector requirements.",
                          )}
                        </p>
                      )}
                    {method.definition.required_assets.map((label) => (
                      <Field key={label} label={label}>
                        <select
                          aria-label={t("資料：", "Input: ") + label}
                          value={
                            bindings.assets.find((v) => v.requirement === label)
                              ?.asset_version_id ?? ""
                          }
                          onChange={(e) => {
                            const source = assets.find(
                              (v) => v.asset_version_id === e.target.value,
                            );
                            changed({
                              ...bindings,
                              assets: [
                                ...bindings.assets.filter(
                                  (v) => v.requirement !== label,
                                ),
                                ...(source
                                  ? [
                                      {
                                        requirement: label,
                                        asset_version_id:
                                          source.asset_version_id,
                                        sha256: source.sha256,
                                      },
                                    ]
                                  : []),
                              ],
                            });
                          }}
                        >
                          <option value="">
                            {t(
                              "選擇已批准的檔案版本",
                              "Choose an approved file version",
                            )}
                          </option>
                          {bindings.assets.find(
                            (v) => v.requirement === label,
                          ) &&
                            !assets.some(
                              (v) =>
                                v.asset_version_id ===
                                bindings.assets.find(
                                  (b) => b.requirement === label,
                                )?.asset_version_id,
                            ) && (
                              <option
                                value={
                                  bindings.assets.find(
                                    (v) => v.requirement === label,
                                  )!.asset_version_id
                                }
                              >
                                {t(
                                  "已選固定版本（待重新核對）",
                                  "Selected fixed version (recheck required)",
                                )}
                              </option>
                            )}
                          {assets.map((v) => (
                            <option
                              key={v.asset_version_id}
                              value={v.asset_version_id}
                            >
                              {v.name} · v{v.version}
                              {v.private_owner
                                ? t(" · 我的私有檔案", " · your private file")
                                : ""}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ))}
                    {sourcePage.data?.next_cursor &&
                      method.definition.required_assets.length > 0 && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            setAssetCursor(sourcePage.data.next_cursor)
                          }
                        >
                          {t("載入更多檔案", "Load more files")}
                        </button>
                      )}
                    {method.definition.required_connectors.map((provider) => {
                      const chosen = bindings.connectors.find(
                          (v) => v.provider === provider,
                        ),
                        options = connections
                          .filter(
                            (v) =>
                              (v.provider === "meta"
                                ? "meta_ads"
                                : v.provider) === provider,
                          )
                          .flatMap((c) =>
                            c.accounts.map((a: any) => ({
                              c,
                              a,
                              key: c.id + ":" + a.id,
                            })),
                          );
                      return (
                        <Field
                          key={provider}
                          label={
                            providers.find((v) => v[0] === provider)?.[1] ??
                            provider
                          }
                        >
                          <select
                            aria-label={provider}
                            value={
                              chosen
                                ? chosen.connection_id + ":" + chosen.account_id
                                : ""
                            }
                            onChange={(e) => {
                              const v = options.find(
                                (v) => v.key === e.target.value,
                              );
                              changed({
                                ...bindings,
                                connectors: [
                                  ...bindings.connectors.filter(
                                    (v) => v.provider !== provider,
                                  ),
                                  ...(v
                                    ? [
                                        {
                                          provider,
                                          connection_id: v.c.id,
                                          version: v.c.version,
                                          auth_version: v.c.auth_version,
                                          account_id: v.a.id,
                                        },
                                      ]
                                    : []),
                                ],
                              });
                            }}
                          >
                            <option value="">
                              {t(
                                "選擇目前已批准的報表帳戶",
                                "Choose a currently approved reporting account",
                              )}
                            </option>
                            {chosen &&
                              !options.some(
                                (v) =>
                                  v.key ===
                                  chosen.connection_id +
                                    ":" +
                                    chosen.account_id,
                              ) && (
                                <option
                                  value={
                                    chosen.connection_id +
                                    ":" +
                                    chosen.account_id
                                  }
                                >
                                  {t(
                                    "原帳戶需重新核對",
                                    "Original account requires recheck",
                                  )}
                                </option>
                              )}
                            {options.map((v) => (
                              <option key={v.key} value={v.key}>
                                {v.a.name ?? v.a.id} · {v.a.id}
                              </option>
                            ))}
                          </select>
                        </Field>
                      );
                    })}
                    {connectorPage.data?.next_cursor &&
                      method.definition.required_connectors.length > 0 && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            setConnectionCursor(connectorPage.data.next_cursor)
                          }
                        >
                          {t("載入更多連接", "Load more connections")}
                        </button>
                      )}
                  </fieldset>
                  <ErrorNotice
                    error={sourcePage.error || connectorPage.error}
                  />
                  <div className="solution-actions">
                    <Link className="text-button" to="/app/files">
                      {t("管理檔案", "Manage files")}
                      <ArrowUpRight size={14} />
                    </Link>
                    <Link className="text-button" to="/app/connections">
                      {t(
                        "管理連接與擷取資料",
                        "Manage connections & capture data",
                      )}
                      <ArrowUpRight size={14} />
                    </Link>
                  </div>
                  {installationId &&
                    access.data?.can_manage &&
                    installation.data && (
                      <button
                        className="button secondary"
                        disabled={blocked || !online}
                        onClick={() =>
                          void run(
                            "configure",
                            `/v1/solution-installations/${installationId}/configurations`,
                            {
                              expected_revision: installation.data.revision,
                              bindings,
                            },
                          )
                        }
                      >
                        {t("保存此專案綁定", "Save project bindings")}
                      </button>
                    )}
                  <button
                    className="button secondary"
                    disabled={blocked || !online}
                    onClick={() => void check()}
                  >
                    {t("免費預覽依賴", "Preview dependencies free")}
                  </button>
                  {preview && (
                    <section className="solution-preview" aria-live="polite">
                      <h4>
                        {preview.state === "ready"
                          ? t("資料依賴已齊", "Dependencies ready")
                          : t("先補齊以下資料", "Complete these requirements")}
                      </h4>
                      {preview.missing_requirements.length > 0 && (
                        <ul>
                          {preview.missing_requirements.map((v: string) => (
                            <li key={v}>{v}</li>
                          ))}
                        </ul>
                      )}
                      <p>
                        {preview.template_checks.length}{" "}
                        {t("個固定角色", "pinned roles")} ·{" "}
                        {preview.required_skill_version_ids.length}{" "}
                        {t("個固定技能", "pinned skills")} ·{" "}
                        {t("可用工作額度", "Available task slots")}{" "}
                        {preview.task_capacity.available}/
                        {preview.task_capacity.limit}
                      </p>
                      {preview.assets.map((v: any) => (
                        <p key={v.id}>
                          {v.requirement}: {v.name} · v{v.version} ·{" "}
                          <code>{v.sha256.slice(0, 12)}</code>
                        </p>
                      ))}
                      {preview.connectors.map((v: any) => (
                        <p key={v.provider}>
                          {v.provider}: {v.account_name} ·{" "}
                          {v.snapshot
                            ? t("固定資料已擷取", "Fixed data captured")
                            : t(
                                "先擷取報表資料",
                                "Capture reporting data first",
                              )}
                        </p>
                      ))}
                      {preview.task_capacity.required >
                        preview.task_capacity.available && (
                        <p role="status">
                          {t(
                            "此完整試運行所需工作額度不足，請先完成現有工作，或請管理員調整權益。",
                            "This complete trial needs more available task slots. Finish existing work or ask your administrator to review your allowance.",
                          )}
                        </p>
                      )}
                      <p className="muted">
                        {t(
                          "預覽不預留費用。複製方法不會複製原客戶的檔案、私人簡報、對話或連接憑證。",
                          "Preview reserves no money. Copying a method excludes source customer files, private briefs, conversations and connection credentials.",
                        )}
                      </p>
                    </section>
                  )}
                </section>
              )}
              {method.state !== "disabled" && access.data?.can_write && (
                <section className="solution-trial-section">
                  <h3>
                    {native
                      ? t("在此電腦套用方法", "Apply on this computer")
                      : t("先試運行，再決定。", "Try it, then decide.")}
                  </h3>
                  {native ? (
                    <LocalSolutionTrial
                      key={method.id + ":" + w.project + ":" + installationId}
                      tenant={w.tenant}
                      project={w.project}
                      method={method}
                      installation={installationId}
                      bindings={bindings}
                      preview={preview}
                      blocked={blocked}
                      onPrepared={(id) => {
                        setTrialId(id);
                        setRefresh((v) => v + 1);
                      }}
                    />
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!method || !preview || !consent) return;
                        const budget = Math.round(
                          Number(draft.budget) * 1000000,
                        );
                        if (!Number.isSafeInteger(budget)) return;
                        void run(
                          "trial",
                          `/v1/solution-versions/${method.id}/trials`,
                          {
                            project_id: w.project,
                            ...(installationId
                              ? { installation_id: installationId }
                              : {}),
                            bindings,
                            expected_preview_hash: preview.preview_hash,
                            budget_micros: budget,
                            brief: draft.brief.trim(),
                            approval: true,
                          },
                        );
                      }}
                    >
                      <fieldset disabled={blocked}>
                        <Field
                          label={t(
                            "本次私有簡報",
                            "Private brief for this trial",
                          )}
                        >
                          <textarea
                            name="solution_brief"
                            value={draft.brief}
                            rows={3}
                            minLength={1}
                            maxLength={4000}
                            required
                            onChange={(e) =>
                              setDraft((v) => ({ ...v, brief: e.target.value }))
                            }
                          />
                        </Field>
                        <Field
                          label={t(
                            "本次所有角色的總預算上限（HKD）",
                            "Total budget across all roles (HKD)",
                          )}
                          hint={t(
                            "每個角色獨立建立工作並按實際用量結算；總預留不超過此上限。",
                            "Each role gets its own task and measured charges. Their combined reservation stays within this limit.",
                          )}
                        >
                          <input
                            name="solution_budget"
                            type="number"
                            min="0.001"
                            max="100"
                            step="0.001"
                            value={draft.budget}
                            required
                            onChange={(e) => {
                              setDraft((v) => ({
                                ...v,
                                budget: e.target.value,
                              }));
                              setConsent(false);
                            }}
                          />
                        </Field>
                        <label className="solution-check">
                          <input
                            type="checkbox"
                            checked={consent}
                            onChange={(e) => setConsent(e.target.checked)}
                          />
                          {t(
                            "我已核對本次資料、所有角色及總預算，確認建立付費試運行。",
                            "I reviewed these inputs, all roles and the total budget, and approve this paid trial.",
                          )}
                        </label>
                      </fieldset>
                      <button
                        className="button primary"
                        type="submit"
                        disabled={
                          blocked ||
                          !online ||
                          !ready ||
                          !consent ||
                          !access.data?.can_trial_cloud ||
                          (method.state !== "published" && !manageable)
                        }
                      >
                        {t("確認並開始試運行", "Approve and start trial")}
                        <ArrowUpRight size={16} />
                      </button>
                    </form>
                  )}
                </section>
              )}
              <section className="solution-history">
                <div className="solution-section-heading">
                  <BookOpen size={20} />
                  <div>
                    <h3>{t("我的試運行與驗收", "Your trials & acceptance")}</h3>
                    <p>
                      {t(
                        "每次試運行獨立計費。發佈只分享方法定義。",
                        "Each trial is metered separately. Publication shares the method definition.",
                      )}
                    </p>
                  </div>
                </div>
                <ErrorNotice error={trials.error || trial.error} />
                <div className="solution-trial-list">
                  {trials.data?.items.map((v: any) => (
                    <button
                      key={v.id}
                      className={trialId === v.id ? "selected" : ""}
                      disabled={blocked}
                      onClick={() => {
                        setTrialId(v.id);
                        setAcceptConsent(false);
                      }}
                    >
                      <span>
                        {new Date(v.created_at).toLocaleString(
                          locale === "en" ? "en-HK" : "zh-HK",
                        )}
                      </span>
                      <small>
                        {v.reviewed_at
                          ? t("已驗收", "Accepted")
                          : t("待驗收", "Awaiting review")}{" "}
                        · <Money value={v.budget_micros} />
                      </small>
                    </button>
                  ))}
                </div>
                {(trialPages.length > 0 || trials.data?.next_cursor) && (
                  <div className="solution-pagination">
                    <button
                      className="icon-button"
                      aria-label={t("上一頁試運行", "Previous trials")}
                      disabled={!trialPages.length || blocked}
                      onClick={() => setTrialPages((v) => v.slice(0, -1))}
                    >
                      <ChevronLeft size={17} />
                    </button>
                    <span>{trialPages.length + 1}</span>
                    <button
                      className="icon-button"
                      aria-label={t("下一頁試運行", "Next trials")}
                      disabled={!trials.data?.next_cursor || blocked}
                      onClick={() =>
                        setTrialPages((v) => [...v, trials.data.next_cursor])
                      }
                    >
                      <ChevronRight size={17} />
                    </button>
                  </div>
                )}
                {matchingTrial && result && (
                  <div className="solution-deliveries">
                    {result.data_mode === "simulated" && (
                      <p className="notice">
                        {t(
                          "目前使用模擬模型及帳戶資料；執行、檔案和帳務記錄使用實際程式流程。",
                          "Model and account data are simulated. Execution, files and accounting use the actual application flow.",
                        )}
                      </p>
                    )}
                    {result.tasks.map((v: any) => (
                      <article key={v.task_id}>
                        <div className="solution-section-heading">
                          <strong>{v.role_key}</strong>
                          <Badge value={v.status} />
                          <Money value={v.charged_micros} />
                        </div>
                        <p className="solution-output">
                          {v.output ||
                            v.error_code ||
                            t("等待工作結果…", "Waiting for delivery…")}
                        </p>
                        <Link
                          className="text-button"
                          to={"/app/tasks/" + v.task_id}
                        >
                          {t(
                            "查看實際交付與檔案",
                            "Open actual delivery & files",
                          )}
                          <ArrowUpRight size={14} />
                        </Link>
                      </article>
                    ))}
                    {result.unread_required_sources?.length > 0 && (
                      <p className="notice">
                        {t(
                          "必需資料尚未有讀取記錄，無法驗收或發佈。請檢查角色工具與資料後重新試運行。",
                          "Required inputs have no read record. Acceptance and publication are blocked. Check role tools and inputs before another trial.",
                        )}
                      </p>
                    )}
                    {!result.reviewed && access.data?.can_review && (
                      <>
                        <label className="solution-check">
                          <input
                            type="checkbox"
                            disabled={
                              blocked ||
                              !allSucceeded ||
                              !!result.unread_required_sources?.length
                            }
                            checked={acceptConsent}
                            onChange={(e) => setAcceptConsent(e.target.checked)}
                          />
                          {t(
                            "我已檢查每個角色的實際交付，確認此次方法適用。",
                            "I checked each role's actual delivery and accept this trial.",
                          )}
                        </label>
                        <button
                          className="button secondary"
                          disabled={
                            blocked ||
                            !allSucceeded ||
                            !!result.unread_required_sources?.length ||
                            !acceptConsent
                          }
                          onClick={() =>
                            void run(
                              "review",
                              `/v1/solution-trials/${result.id}/reviews`,
                              {
                                approval: true,
                                tasks: result.tasks.map((v: any) => ({
                                  task_id: v.task_id,
                                  expected_version: v.task_version,
                                  expected_delivery_hash: v.delivery_hash,
                                })),
                              },
                            )
                          }
                        >
                          <Check size={16} />
                          {t("驗收本次所有交付", "Accept every trial delivery")}
                        </button>
                      </>
                    )}
                    {result.reviewed && (
                      <p className="solution-copy-note">
                        <ShieldCheck size={18} />
                        {t(
                          "已保存本次實際交付的驗收記錄。",
                          "Acceptance saved for these actual deliveries.",
                        )}
                      </p>
                    )}
                    {result.reviewed &&
                      manageable &&
                      method.state === "draft" && (
                        <button
                          className="button primary"
                          disabled={blocked || !online}
                          onClick={() =>
                            void run(
                              "publish",
                              `/v1/solution-versions/${method.id}/publications`,
                              {
                                expected_version: method.version,
                                validation_task_id: result.validation_task_id,
                              },
                            )
                          }
                        >
                          {t("發佈已驗收的方法", "Publish accepted method")}
                          <ArrowUpRight size={16} />
                        </button>
                      )}
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
      {editor && (
        <Modal
          title={
            editor === "revise"
              ? t("建立方法新版本", "Create method revision")
              : t("建立可重用的方法", "Create a reusable method")
          }
          onClose={() => {
            if (!blocked) setEditor(null);
          }}
        >
          <form className="form-stack" onSubmit={creation}>
            <fieldset disabled={blocked}>
              <Field label={t("方案名稱", "Method name")}>
                <input
                  name="solution_name"
                  value={draft.name}
                  required
                  maxLength={160}
                  onChange={(e) =>
                    setDraft((v) => ({ ...v, name: e.target.value }))
                  }
                />
              </Field>
              <Field
                label={t("可分享的方法指引", "Reusable method instructions")}
                hint={t(
                  "只寫工作方法。客戶私有內容請放在試運行簡報；不要貼上密鑰。",
                  "Describe the method. Put customer details in the private trial brief; omit credentials.",
                )}
              >
                <textarea
                  name="solution_instructions"
                  rows={6}
                  value={draft.instructions}
                  required
                  maxLength={8000}
                  onChange={(e) =>
                    setDraft((v) => ({ ...v, instructions: e.target.value }))
                  }
                />
              </Field>
              <Field
                label={t("預設角色（最多 6 個）", "Preset roles (up to 6)")}
                hint={t(
                  "不選時使用預設助手。保存後固定當前角色、Codex 設定與技能版本。",
                  "Defaults to the assistant. Saving pins current roles, Codex profiles and skill versions.",
                )}
              >
                <div className="solution-template-picker">
                  {templates.data?.items.map((v: any) => (
                    <label key={v.id}>
                      <input
                        type="checkbox"
                        checked={draft.template_ids.includes(v.id)}
                        disabled={
                          !draft.template_ids.includes(v.id) &&
                          draft.template_ids.length >= 6
                        }
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            template_ids: e.target.checked
                              ? [...d.template_ids, v.id]
                              : d.template_ids.filter((id) => id !== v.id),
                          }))
                        }
                      />
                      {v.name ?? v.display_name ?? v.role_key}
                    </label>
                  ))}
                </div>
              </Field>
              <ErrorNotice error={templates.error} />
              <Field
                label={t(
                  "必需資料名稱（每行一項，最多 12 項）",
                  "Required input labels (one per line, up to 12)",
                )}
              >
                <textarea
                  name="solution_requirements"
                  rows={3}
                  value={draft.assets}
                  maxLength={1211}
                  onChange={(e) =>
                    setDraft((v) => ({ ...v, assets: e.target.value }))
                  }
                />
              </Field>
              <Field
                label={t("必需報表連接", "Required reporting connections")}
              >
                <div className="solution-template-picker">
                  {providers.map(([id, label]) => (
                    <label key={id}>
                      <input
                        type="checkbox"
                        checked={draft.connectors.includes(id)}
                        onChange={(e) =>
                          setDraft((v) => ({
                            ...v,
                            connectors: e.target.checked
                              ? [...v.connectors, id]
                              : v.connectors.filter((k) => k !== id),
                          }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </Field>
            </fieldset>
            <ErrorNotice error={error} />
            <button
              type="submit"
              className="button primary"
              disabled={blocked || !online}
            >
              {t("保存方法草稿", "Save method draft")}
            </button>
            <p className="muted">
              {t(
                "新版本需要重新試運行及驗收，才可發佈。",
                "Every new version needs its own trial and acceptance before publication.",
              )}
            </p>
          </form>
        </Modal>
      )}
      {showDisable && method && (
        <Modal
          title={t("停用此方法版本", "Disable this method version")}
          onClose={() => {
            if (!blocked) setShowDisable(false);
          }}
        >
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                "disable",
                `/v1/solution-versions/${method.id}/disable`,
                { expected_version: method.version, reason },
              );
            }}
          >
            <p>
              {t(
                "此版本的後續讀取、試運行和交付存取會受限。需要再次使用時，建立新版本並重新驗收。",
                "Further reads, trials and deliveries from this version will be restricted. Create and qualify a new version to use the method again.",
              )}
            </p>
            <Field label={t("停用原因", "Reason")}>
              <textarea
                value={reason}
                minLength={3}
                maxLength={1000}
                required
                disabled={blocked}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <ErrorNotice error={error} />
            <button
              className="button primary"
              type="submit"
              disabled={blocked || !online}
            >
              {t("確認停用", "Confirm disablement")}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
