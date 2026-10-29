import { useEffect, useRef, useState } from "react";
import { Eye, RefreshCw, ShieldCheck } from "lucide-react";
import { api, ApiError, post } from "./api";
import type { CapabilityAccess } from "./capability-model";
import { ErrorNotice, Field, Loading, Modal, PageHeader, useI18n } from "./ui";
import {
  PublicationContentView,
  PublicationPolicyEditor,
  PublicationResolution,
  PublicationState,
} from "./publication-panels";
import {
  publicationFormatName,
  publicationStates,
  publicationTime,
  usePublicationData,
  type PublicationDetail,
  type PublicationOperation,
  type PublicationPolicy,
  type PublicationTarget,
} from "./publication-data";
import "./publications.css";

const uuid =
  "[a-f0-9A-F]{8}-[a-f0-9A-F]{4}-[a-f0-9A-F]{4}-[a-f0-9A-F]{4}-[a-f0-9A-F]{12}";
const validId = new RegExp("^" + uuid + "$");
type Scope = { tenant_id: string; project_id: string };
type Pending = Scope & {
  key: string;
  action: "policy" | "cancel" | "close-unknown";
  resource_id: string;
};
type Target = PublicationTarget & {
  connection_id: string;
  connection_state: string;
  connection_version: number;
};
const rootOf = (scope: Scope) =>
  `/v1/admin/tenants/${scope.tenant_id}/projects/${scope.project_id}/publications`;
function readPending(key: string): Pending | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (
      !value ||
      !["policy", "cancel", "close-unknown"].includes(value.action) ||
      ![value.key, value.resource_id, value.tenant_id, value.project_id].every(
        (id) => typeof id === "string" && validId.test(id),
      )
    )
      return null;
    return {
      key: value.key,
      action: value.action,
      resource_id: value.resource_id,
      tenant_id: value.tenant_id,
      project_id: value.project_id,
    };
  } catch {
    return null;
  }
}

export function AdminPublications({ access }: { access: CapabilityAccess }) {
  const { t } = useI18n();
  if (!access.has("admin.publication.read")) return <ErrorNotice error={new Error(t("此管理員尚未獲授權讀取發布記錄。", "This administrator is not authorized to read publications."))} />;
  return <PublicationDirectory key={access.me.user.id} access={access} />;
}
function PublicationDirectory({ access }: { access: CapabilityAccess }) {
  const { t } = useI18n(),
    cache = "cp_admin_publication_request:" + access.me.user.id;
  const [tenant, setTenant] = useState(""),
    [project, setProject] = useState(""),
    [state, setState] = useState("");
  const [query, setQuery] = useState(""),
    [cursors, setCursors] = useState<(string | null)[]>([null]),
    [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<PublicationOperation | null>(null),
    [configure, setConfigure] = useState(false),
    [policyScope, setPolicyScope] = useState<Scope | null>(null);
  const [pending, setPending] = useState<Pending | null>(() =>
      readPending(cache),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const flight = useRef(false),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const cursor = cursors[cursors.length - 1];
  const list = usePublicationData<{
    items: PublicationOperation[];
    next_cursor: string | null;
    data_mode: string;
  }>(
    access.has("admin.publication.read")
      ? `/v1/admin/publications/operations?limit=20${query}${cursor ? "&cursor=" + cursor : ""}`
      : null,
    refresh,
  );
  const changed = () => setRefresh((value) => value + 1);
  const clearPending = () => {
    sessionStorage.removeItem(cache);
    setPending(null);
    changed();
  };
  async function run(action: () => Promise<unknown>) {
    if (flight.current || pending) return;
    flight.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      if (live.current) changed();
    } catch (failure) {
      if (live.current) setError(failure);
    } finally {
      flight.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function mutate(
    scope: Scope,
    action: Pending["action"],
    id: string,
    body: unknown,
  ) {
    await run(async () => {
      const record: Pending = {
        ...scope,
        action,
        resource_id: id,
        key: crypto.randomUUID(),
      };
      sessionStorage.setItem(cache, JSON.stringify(record));
      setPending(record);
      try {
        if (action === "policy")
          await api(rootOf(scope) + "/policy/" + id, {
            method: "PUT",
            body: JSON.stringify(body),
            headers: { "Idempotency-Key": record.key },
          });
        else
          await post(
            rootOf(scope) + `/operations/${id}/${action}`,
            body,
            record.key,
          );
        sessionStorage.removeItem(cache);
        if (live.current) {
          setPending(null);
          if (action === "policy") {
            setConfigure(false);
            setPolicyScope(null);
          }
        }
      } catch (failure) {
        if (
          failure instanceof ApiError &&
          [400, 401, 403, 404, 409, 410, 412, 413, 415, 422, 429].includes(
            failure.status,
          ) &&
          failure.code !== "RESPONSE_INVALID"
        ) {
          sessionStorage.removeItem(cache);
          if (live.current) setPending(null);
        } else if (live.current) {
          // The receipt recovery panel must remain reachable after a lost modal response.
          setSelected(null);
          setConfigure(false);
          setPolicyScope(null);
        }
        throw failure;
      }
    });
  }
  return (
    <div className="publications-page admin-publications">
      <PageHeader
        eyebrow="COPYPASTE / PUBLISHING CONTROL"
        title={t(
          "讓每次發布，都有據可查。",
          "Every publication, accounted for.",
        )}
        description={t(
          "按企業與專案管理帳戶範圍、發布策略及執行記錄。私人正文需另行授權；每次發布由原客戶確認。",
          "Manage account policies and execution records by workspace and project. Private content requires separate access. The original customer confirms every publication.",
        )}
        action={
          <button
            className="button secondary"
            onClick={changed}
            disabled={busy}
          >
            <RefreshCw size={16} />
            {t("重新整理", "Refresh")}
          </button>
        }
      />
      <ErrorNotice error={error || list.error} />
      {pending && (
        <RequestRecovery
          key={pending.key}
          pending={pending}
          refresh={refresh}
          busy={busy}
          onResolved={() => {
            clearPending();
            if (pending.action === "policy") {
              setConfigure(false);
              setPolicyScope(null);
            }
          }}
          onRelease={clearPending}
        />
      )}
      <section className="card publication-admin-scope">
        <form
          className="publication-admin-filter"
          onSubmit={(event) => {
            event.preventDefault();
            const q = new URLSearchParams();
            if (tenant) q.set("tenant_id", tenant);
            if (project) q.set("project_id", project);
            if (state) q.set("state", state);
            setQuery(q.size ? "&" + q : "");
            setCursors([null]);
            setSelected(null);
            changed();
          }}
        >
          <Field label={t("企業 ID（可選）", "Workspace ID (optional)")}>
            <input
              pattern={uuid}
              value={tenant}
              onChange={(event) => setTenant(event.target.value)}
            />
          </Field>
          <Field label={t("專案 ID（可選）", "Project ID (optional)")}>
            <input
              pattern={uuid}
              value={project}
              onChange={(event) => setProject(event.target.value)}
            />
          </Field>
          <Field label={t("發布狀態", "Publication status")}>
            <select
              value={state}
              onChange={(event) => setState(event.target.value)}
            >
              <option value="">{t("所有狀態", "All states")}</option>
              {Object.entries(publicationStates).map(([key, label]) => (
                <option key={key} value={key}>
                  {t(...label)}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className="button secondary" disabled={busy}>
            {t("套用範圍", "Apply filters")}
          </button>
        </form>
        {access.has("admin.publication.policy.write") && (
          <button
            className="button secondary"
            disabled={busy || !!pending}
            onClick={() => {
              setConfigure(true);
              setPolicyScope(null);
            }}
          >
            <ShieldCheck size={16} />
            {t("管理專案發布範圍", "Manage project publishing policy")}
          </button>
        )}
      </section>
      {list.data?.data_mode === "simulated" && (
        <p className="notice">
          {t(
            "模擬帳戶與發布記錄，不會發布至真實社交帳戶。",
            "Synthetic accounts and publication records. No real social account receives a post.",
          )}
        </p>
      )}
      {!list.error && (
        <section
          className="card publication-admin-directory"
          aria-label={t("發布操作目錄", "Publication operation directory")}
        >
          {!list.data && <Loading />}
          {list.data?.items.map((operation) => (
            <div className="publication-admin-operation" key={operation.id}>
              <button
                type="button"
                onClick={() => {
                  setSelected(operation);
                  setError(null);
                }}
              >
                <span>
                  <strong>{publicationFormatName(operation.format, t)}</strong>
                  <small>{publicationTime(operation.created_at)} HKT</small>
                  <code>{operation.id}</code>
                </span>
                <span>
                  <PublicationState state={operation.state} />
                  <small>
                    {operation.tenant_id} / {operation.project_id}
                  </small>
                </span>
              </button>
              {access.has("admin.publication.policy.write") && (
                <button
                  className="text-button"
                  disabled={busy || !!pending}
                  onClick={() => {
                    setPolicyScope(operation);
                    setConfigure(true);
                  }}
                >
                  {t("此專案的發布範圍", "Policy for this project")}
                </button>
              )}
            </div>
          ))}
          {list.data && !list.data.items.length && (
            <p className="publication-empty">
              {t(
                "目前授權範圍沒有發布記錄。可調整篩選，或先設定專案發布範圍。",
                "No publications in this authorized scope. Adjust filters or configure a project policy.",
              )}
            </p>
          )}
          <div className="publication-actions">
            <button
              className="text-button"
              disabled={cursors.length === 1}
              onClick={() => setCursors((old) => old.slice(0, -1))}
            >
              {t("上一頁", "Previous page")}
            </button>
            <span className="muted">{cursors.length}</span>
            <button
              className="text-button"
              disabled={!list.data?.next_cursor}
              onClick={() =>
                setCursors((old) => [...old, list.data!.next_cursor])
              }
            >
              {t("下一頁", "Next page")}
            </button>
          </div>
        </section>
      )}
      {selected && !list.error && (
        <Modal
          title={t("發布記錄與處置", "Publication record & resolution")}
          onClose={() => setSelected(null)}
        >
          <PublicationInspector
            key={selected.id}
            operation={selected}
            access={access}
            refresh={refresh}
            busy={busy || !!pending}
            onObserve={(current, remote) =>
              run(async () => {
                await post(
                  rootOf(current) + `/operations/${current.id}/observe`,
                  {
                    expected_version: current.version,
                    ...(remote ? { remote_id: remote } : {}),
                  },
                );
              })
            }
            onCancel={(current) =>
              mutate(current, "cancel", current.id, {
                expected_version: current.version,
              })
            }
            onCloseUnknown={(current, reason, observation) =>
              mutate(current, "close-unknown", current.id, {
                expected_version: current.version,
                reason,
                observation_sha256: observation,
                acknowledge_unknown_attribution: true,
              })
            }
          />
        </Modal>
      )}
      {configure && (
        <Modal
          title={t("專案發布範圍", "Project publishing policy")}
          onClose={() => {
            setConfigure(false);
            setPolicyScope(null);
          }}
        >
          {!policyScope ? (
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                setPolicyScope({ tenant_id: tenant, project_id: project });
              }}
            >
              <Field label={t("企業 ID", "Workspace ID")}>
                <input
                  pattern={uuid}
                  required
                  value={tenant}
                  onChange={(event) => setTenant(event.target.value)}
                />
              </Field>
              <Field label={t("專案 ID", "Project ID")}>
                <input
                  pattern={uuid}
                  required
                  value={project}
                  onChange={(event) => setProject(event.target.value)}
                />
              </Field>
              <button className="button primary">
                {t("讀取獲授權帳戶", "Load authorized accounts")}
              </button>
            </form>
          ) : (
            <PolicyManager
              key={`${policyScope.tenant_id}:${policyScope.project_id}`}
              scope={policyScope}
              refresh={refresh}
              busy={busy || !!pending}
              error={error}
              onSave={(target, policy, version) =>
                mutate(policyScope, "policy", target.id, {
                  expected_version: version,
                  policy,
                })
              }
              onClose={() => {
                setConfigure(false);
                setPolicyScope(null);
              }}
            />
          )}
        </Modal>
      )}
    </div>
  );
}

function RequestRecovery({
  pending,
  refresh,
  busy,
  onResolved,
  onRelease,
}: {
  pending: Pending;
  refresh: number;
  busy: boolean;
  onResolved: () => void;
  onRelease: () => void;
}) {
  const { t } = useI18n(),
    request = usePublicationData<{ result: unknown }>(
      rootOf(pending) +
        `/requests/${pending.key}?action=${pending.action}&resource_id=${pending.resource_id}`,
      refresh,
      3000,
    );
  return (
    <aside className="publication-pending" role="status">
      <h2>{t("先核對原操作回執", "Check the original action receipt")}</h2>
      <p>
        {t(
          "回應尚未確認，系統會查詢原請求，不會自動重送變更。",
          "The response needs confirmation. The original request is checked without automatically resubmitting changes.",
        )}
      </p>
      {request.data ? (
        <>
          <p>
            {t(
              "原操作已提交。請讀取最新狀態。",
              "The original action committed. Read the current state.",
            )}
          </p>
          <button className="button" disabled={busy} onClick={onResolved}>
            {t("讀取最新狀態", "Read current state")}
          </button>
        </>
      ) : (
        <>
          <ErrorNotice
            error={
              request.error instanceof ApiError && request.error.status === 404
                ? null
                : request.error
            }
          />
          <p className="muted">
            {t(
              "尚未找到回執不代表操作未執行。",
              "A missing receipt does not prove that the action did not run.",
            )}
          </p>
          <button className="text-button" disabled={busy} onClick={onRelease}>
            {t(
              "返回最新記錄，重新核對",
              "Return to current records for review",
            )}
          </button>
        </>
      )}
    </aside>
  );
}

function PolicyManager({
  scope,
  refresh,
  busy,
  error,
  onSave,
  onClose,
}: {
  scope: Scope;
  refresh: number;
  busy: boolean;
  error: unknown;
  onSave: (
    target: Target,
    policy: PublicationPolicy["policy"],
    version: number,
  ) => void;
  onClose: () => void;
}) {
  const { t } = useI18n(),
    [selected, setSelected] = useState("");
  const accounts = usePublicationData<{ items: Target[] }>(
    rootOf(scope) + "/connections",
    refresh,
  );
  const target = accounts.data?.items.find((item) => item.id === selected);
  const policy = usePublicationData<{ policy: PublicationPolicy | null }>(
    target ? rootOf(scope) + "/policy?target_id=" + target.id : null,
    refresh,
  );
  return (
    <div className="publication-admin-policy">
      <p className="muted">
        {scope.tenant_id} / {scope.project_id}
      </p>
      <ErrorNotice error={accounts.error || policy.error} />
      <Field label={t("品牌帳戶", "Brand account")}>
        <select
          value={selected}
          disabled={busy || !accounts.data}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">{t("選擇帳戶", "Select an account")}</option>
          {accounts.data?.items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ·{" "}
              {item.kind === "facebook_page" ? "Facebook" : "Instagram"} ·{" "}
              {item.external_id}
            </option>
          ))}
        </select>
      </Field>
      {accounts.data && !accounts.data.items.length && (
        <p>
          {t(
            "此專案尚未連接帳戶，請由客戶完成授權與專案範圍選擇。",
            "No accounts are connected to this project. Ask the customer to authorize an account and project scope.",
          )}
        </p>
      )}
      {target && (
        <p>
          {target.connection_state === "connected" && target.enabled
            ? t("帳戶已連接並啟用。", "The account is connected and enabled.")
            : t(
                "帳戶尚未啟用或需要客戶重新授權；設定策略不會代替客戶授權。",
                "The account is disabled or needs customer reconnection. A policy change does not replace customer authorization.",
              )}
        </p>
      )}
      {target && policy.data && !accounts.error && !policy.error && (
        <PublicationPolicyEditor
          key={`${target.id}:${policy.data.policy?.version ?? 0}`}
          target={target}
          policy={policy.data.policy}
          busy={busy}
          error={error}
          onSave={(body, version) => onSave(target, body, version)}
          onClose={onClose}
        />
      )}
    </div>
  );
}

function PublicationInspector({
  operation,
  access,
  refresh,
  busy,
  onObserve,
  onCancel,
  onCloseUnknown,
}: {
  operation: PublicationOperation;
  access: CapabilityAccess;
  refresh: number;
  busy: boolean;
  onObserve: (current: PublicationDetail, remote?: string) => void;
  onCancel: (current: PublicationDetail) => void;
  onCloseUnknown: (
    current: PublicationDetail,
    reason: string,
    observation: string,
  ) => void;
}) {
  const { t } = useI18n(),
    [showBody, setShowBody] = useState(false),
    [bodyError, setBodyError] = useState<unknown>(null);
  const root = rootOf(operation),
    metadata = usePublicationData<PublicationDetail>(
      root + `/operations/${operation.id}`,
      refresh,
      3000,
    );
  const body = usePublicationData<PublicationDetail>(
    showBody && access.has("admin.content.body.read") && metadata.data
      ? root + `/operations/${operation.id}?include_content=true`
      : null,
    refresh,
    3000,
  );
  useEffect(() => {
    if (metadata.error || body.error) { setShowBody(false); setBodyError(metadata.error || body.error); }
  }, [metadata.error, body.error]);
  const current = metadata.data;
  if (!current)
    return metadata.error ? (
      <ErrorNotice error={metadata.error} />
    ) : (
      <Loading />
    );
  const canResolve = access.has("admin.publication.resolve");
  return (
    <article className="publication-inspector">
      <PublicationState state={current.state} />
      <dl className="publication-admin-facts">
        <div>
          <dt>{t("操作編號", "Operation")}</dt>
          <dd>
            <code>{current.id}</code>
          </dd>
        </div>
        <div>
          <dt>{t("原客戶", "Original customer")}</dt>
          <dd>
            <code>{current.actor_id}</code>
          </dd>
        </div>
        <div>
          <dt>{t("帳戶編號", "Account ID")}</dt>
          <dd>
            <code>{current.target_id}</code>
          </dd>
        </div>
        <div>
          <dt>{t("版本", "Version")}</dt>
          <dd>{current.version}</dd>
        </div>
        <div>
          <dt>{t("建立時間", "Created")}</dt>
          <dd>{publicationTime(current.created_at)} HKT</dd>
        </div>
        <div>
          <dt>{t("內容摘要", "Content digest")}</dt>
          <dd>
            <code>{current.payload_sha256}</code>
          </dd>
        </div>
      </dl>
      <p className="muted">
        {t(
          "發布確認由原客戶完成。平台管理員可核對、取消尚未發送的操作或記錄未知結果處置。",
          "The original customer confirms publication. Platform administrators can observe, cancel unsent work or record an unknown-outcome resolution.",
        )}
      </p>
      {current.error_code && (
        <p className="notice error">{current.error_code}</p>
      )}
      {access.has("admin.content.body.read") && (
        <button
          className="button secondary"
          onClick={() => {
            setBodyError(null);
            setShowBody((value) => !value);
          }}
        >
          <Eye size={16} />
          {showBody
            ? t("隱藏私人正文", "Hide private content")
            : t("查看私人正文", "View private content")}
        </button>
      )}
      <ErrorNotice error={body.error || bodyError} />
      {showBody &&
        body.data?.can_view_content &&
        body.data.content &&
        access.has("admin.content.body.read") && (
          <PublicationContentView
            root={root}
            kind="operations"
            id={current.id}
            tenant={current.tenant_id}
            content={body.data.content}
            digest={current.payload_sha256}
            onWithdraw={() => {
              setShowBody(false);
              setBodyError(
                new Error(
                  t(
                    "來源或授權已不可用，私人內容已收起。",
                    "The source or authorization is unavailable. Private content has been withdrawn.",
                  ),
                ),
              );
            }}
          />
        )}
      {showBody && body.data && !body.data.can_view_content && (
        <p>
          {t(
            "此操作的私人內容已不可用。",
            "Private content for this operation is unavailable.",
          )}
        </p>
      )}
      <div className="publication-actions">
        {canResolve &&
          ["awaiting_confirmation", "queued"].includes(current.state) && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => onCancel(current)}
            >
              {t("取消尚未發送的操作", "Cancel unsent operation")}
            </button>
          )}
      </div>
      {canResolve && ["unknown", "processing"].includes(current.state) && (
        <PublicationResolution
          key={`${current.id}:${current.version}`}
          operation={current}
          busy={busy}
          onObserve={(remote) => onObserve(current, remote)}
          onClose={(reason, observation) =>
            onCloseUnknown(current, reason, observation)
          }
        />
      )}
      {current.result && (
        <div className="notice">
          <strong>{t("平台回執", "Provider receipt")}</strong>
          <pre>{JSON.stringify(current.result, null, 2)}</pre>
        </div>
      )}
      {current.observation && (
        <details>
          <summary>{t("平台核對證據", "Provider observation")}</summary>
          <pre>{JSON.stringify(current.observation, null, 2)}</pre>
        </details>
      )}
      {current.resolution && (
        <details>
          <summary>{t("人工處置記錄", "Manual resolution")}</summary>
          <pre>
            {JSON.stringify(
              showBody && body.data ? body.data.resolution : current.resolution,
              null,
              2,
            )}
          </pre>
        </details>
      )}
      <h3>{t("發送步驟", "Dispatch steps")}</h3>
      <ul className="publication-admin-events">
        {current.effects.map((effect) => (
          <li key={effect.id}>
            <strong>{effect.step_key}</strong>
            <span>{effect.state}</span>
            {effect.remote_id && <code>{effect.remote_id}</code>}
            {effect.error_code && <code>{effect.error_code}</code>}
          </li>
        ))}
      </ul>
      <h3>{t("狀態歷程", "State history")}</h3>
      <ol className="publication-admin-events">
        {current.events.map((event) => (
          <li key={event.version}>
            <span>v{event.version}</span>
            <PublicationState state={event.state} />
            <time>{publicationTime(event.created_at)} HKT</time>
          </li>
        ))}
      </ol>
    </article>
  );
}
