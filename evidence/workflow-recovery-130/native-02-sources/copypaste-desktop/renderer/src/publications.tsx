import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronRight,
  Link2,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, ApiError, post } from "./api";
import { useWorkspace } from "./context";
import { ErrorNotice, Field, Modal, PageHeader, useI18n } from "./ui";
import {
  PublicationConfirmation,
  PublicationContentView,
  PublicationPolicyEditor,
  PublicationResolution,
  PublicationState,
} from "./publication-panels";
import {
  publicationBytes,
  publicationFormats,
  publicationFormatName,
  publicationStates,
  publicationTime,
  readPendingPublication,
  savePendingPublication,
  usePublicationData,
  type PendingPublication,
  type PublicationConnection,
  type PublicationDetail,
  type PublicationDraft,
  type PublicationFormat,
  type PublicationOperation,
  type PublicationPolicy,
  type PublicationPreview,
  type PublicationSelectedSource,
  type PublicationTarget,
} from "./publication-data";
import "./publications.css";

type Settings = {
  available: boolean;
  can_manage: boolean;
  data_mode: string;
  browser_connection_url: string;
};
type ChosenSource = PublicationSelectedSource & {
  name: string;
  mime: string;
  bytes: number;
};
type Asset = {
  id: string;
  name: string;
  current_version: number;
  mime_type: string;
  bytes: number;
};
type AssetVersion = {
  id: string;
  version: number;
  mime_type: string;
  bytes: number;
  sha256: string;
};
const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function Publications() {
  const w = useWorkspace(),
    { t } = useI18n(),
    [params] = useSearchParams();
  const requestedTenant = params.get("tenant"),
    requestedProject = params.get("project");
  const operation = params.get("operation");
  const initialOperation =
    operation && uuidPattern.test(operation) ? operation : null;
  const validTenant =
    requestedTenant &&
    uuidPattern.test(requestedTenant) &&
    w.me?.memberships?.some((m: any) => m.id === requestedTenant);
  useEffect(() => {
    if (
      !validTenant ||
      !requestedProject ||
      !uuidPattern.test(requestedProject)
    )
      return;
    if (w.tenant !== requestedTenant) {
      w.setTenant(requestedTenant!);
      return;
    }
    if (
      w.project !== requestedProject &&
      w.projects.some((p) => p.id === requestedProject)
    )
      w.setProject(requestedProject);
  }, [
    requestedTenant,
    requestedProject,
    validTenant,
    w.tenant,
    w.project,
    w.projects,
  ]);
  if (
    (requestedTenant && !validTenant) ||
    (requestedProject && !uuidPattern.test(requestedProject)) ||
    (validTenant &&
      requestedProject &&
      w.tenant === requestedTenant &&
      w.project &&
      !w.projects.some((p) => p.id === requestedProject))
  )
    return (
      <ErrorNotice
        error={
          new Error(
            t(
              "此連結的企業或專案不可用，請從目前工作台重新開啟發布。",
              "The workspace or project in this link is unavailable. Reopen publishing from your current workspace.",
            ),
          )
        }
      />
    );
  if (
    validTenant &&
    requestedProject &&
    (w.tenant !== requestedTenant ||
      (w.projects.some((p) => p.id === requestedProject) &&
        w.project !== requestedProject))
  )
    return (
      <p role="status">
        {t("正在開啟獲授權的專案…", "Opening the authorized project…")}
      </p>
    );
  return (
    <PublicationWorkspace
      key={`${w.me?.user?.id}:${w.tenant}:${w.project}:${initialOperation ?? ""}`}
      initialOperation={initialOperation}
    />
  );
}

function PublicationWorkspace({
  initialOperation,
}: {
  initialOperation: string | null;
}) {
  const w = useWorkspace(),
    { t } = useI18n(),
    root = w.base + "/publications",
    actor = String(w.me.user.id);
  const scope = `cp_publication_request:${actor}:${w.tenant}:${w.project}`;
  const [refresh, setRefresh] = useState(0),
    [targetId, setTargetId] = useState(""),
    [selected, setSelected] = useState<string | null>(initialOperation);
  const [preview, setPreview] = useState<PublicationPreview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const [scopeEditor, setScopeEditor] = useState<PublicationConnection | null>(
      null,
    ),
    [editPolicy, setEditPolicy] = useState(false);
  const [pending, setPending] = useState<PendingPublication | null>(() =>
    readPendingPublication(scope),
  );
  const live = useRef(true),
    inFlight = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const settings = usePublicationData<Settings>(root + "/settings", refresh);
  const connections = usePublicationData<{
    items: PublicationConnection[];
    data_mode: string;
  }>(root + "/connections", refresh);
  const accounts =
    connections.data?.items.flatMap((connection) =>
      connection.targets.map((target) => ({ connection, target })),
    ) ?? [];
  const chosen = accounts.find((a) => a.target.id === targetId) ?? accounts[0];
  const target = chosen?.target,
    connection = chosen?.connection,
    selectedTarget = target?.id ?? "";
  const policy = usePublicationData<{ policy: PublicationPolicy | null }>(
    selectedTarget ? root + "/policy?target_id=" + selectedTarget : null,
    refresh,
  );
  const currentPolicy = policy.data?.policy ?? null;
  const ready =
    !!settings.data?.available &&
    connection?.state === "connected" &&
    !!target?.enabled &&
    !!currentPolicy?.policy.enabled &&
    Date.parse(currentPolicy.policy.expires_at) > Date.now();
  useEffect(() => {
    setPreview(null);
    setEditPolicy(false);
  }, [selectedTarget, currentPolicy?.version, connection?.version]);
  useEffect(() => {
    if (connections.error || policy.error || settings.error) {
      setPreview(null);
      setScopeEditor(null);
      setEditPolicy(false);
    }
  }, [connections.error, policy.error, settings.error]);
  const changed = () => setRefresh((value) => value + 1);
  async function run<T>(action: () => Promise<T>, done?: (value: T) => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const value = await action();
      if (live.current) {
        done?.(value);
        changed();
      }
    } catch (failure) {
      if (live.current) {
        setError(failure);
        changed();
      }
    } finally {
      inFlight.current = false;
      if (live.current) setBusy(false);
    }
  }
  function track(
    action: PendingPublication["action"],
    path: string,
    body: unknown,
    operationId?: string,
  ) {
    if (pending || inFlight.current) return;
    const record: PendingPublication = {
      key: crypto.randomUUID(),
      action,
      ...(operationId ? { operation_id: operationId } : {}),
    };
    void run(
      async () => {
        savePendingPublication(scope, record);
        setPending(record);
        try {
          const result = await post(path, body, record.key);
          savePendingPublication(scope, null);
          if (live.current) setPending(null);
          return result as PublicationOperation;
        } catch (failure) {
          if (
            failure instanceof ApiError &&
            failure.status >= 400 &&
            failure.status < 500 &&
            failure.code !== "SESSION_CHANGED"
          ) {
            savePendingPublication(scope, null);
            if (live.current) setPending(null);
          }
          throw failure;
        }
      },
      (result) => {
        setPreview(null);
        setSelected(result.id);
      },
    );
  }
  const connect = (existing?: PublicationConnection) =>
    void run(async () => {
      if (window.copyPasteBridge) {
        await window.copyPasteBridge.openExternal(
          settings.data!.browser_connection_url,
        );
        return;
      }
      const result = await post(root + "/connections/authorize", {
        project_id: w.project,
        ...(existing
          ? { connection_id: existing.id, expected_version: existing.version }
          : {}),
      });
      window.location.assign(result.authorization_url);
    });
  return (
    <div className="publications-page">
      <PageHeader
        eyebrow="COPYPASTE / PUBLISH"
        title={t("讓好內容，準時見面。", "Good work. Ready to go live.")}
        description={t(
          "選好帳戶與素材，核對實際內容，再由你確認發布。",
          "Choose an account and assets, review the outgoing content, then confirm publication.",
        )}
        action={
          <button className="button" disabled={busy} onClick={changed}>
            <RefreshCw size={16} />
            {t("更新狀態", "Refresh")}
          </button>
        }
      />
      {settings.data?.data_mode === "simulated" && (
        <aside className="publication-demo" role="status">
          <span className="publication-dot" />
          {t(
            "模擬發布環境：檔案及確認流程會實際執行，不會發布至真實社交帳戶。",
            "Simulated publishing: files and approvals run through the actual flow. No real social account receives a post.",
          )}
        </aside>
      )}
      <ol
        className="publication-steps"
        aria-label={t("發布流程", "Publishing flow")}
      >
        {[
          ["帳戶", "Account"],
          ["內容", "Content"],
          ["預覽", "Preview"],
          ["確認與結果", "Confirm & track"],
        ].map((label, index) => (
          <li key={index}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            {t(label[0], label[1])}
            {index < 3 && <ChevronRight size={15} aria-hidden="true" />}
          </li>
        ))}
      </ol>
      <ErrorNotice
        error={settings.error || connections.error || policy.error || error}
      />
      {pending && (
        <PendingRequest
          key={pending.key}
          root={root}
          pending={pending}
          refresh={refresh}
          busy={busy}
          onFound={(result) => {
            savePendingPublication(scope, null);
            setPending(null);
            setSelected(result.id);
            changed();
          }}
          onRelease={() => {
            savePendingPublication(scope, null);
            setPending(null);
            if (pending.operation_id) setSelected(pending.operation_id);
            changed();
          }}
        />
      )}
      <section
        className="publication-section publication-accounts"
        aria-label={t("發布帳戶", "Publishing accounts")}
      >
        <div className="publication-section-heading">
          <div>
            <span className="eyebrow">01 / {t("帳戶", "ACCOUNT")}</span>
            <h2>{t("這次，在哪裡發聲？", "Where will this go live?")}</h2>
          </div>
          {settings.data?.can_manage && (
            <button
              className="button"
              disabled={busy || !settings.data.available}
              onClick={() => connect()}
            >
              <Link2 size={17} />
              {window.copyPasteBridge
                ? t("在瀏覽器連接帳戶", "Connect in browser")
                : t("連接 Meta 帳戶", "Connect Meta account")}
            </button>
          )}
        </div>
        {settings.data && !settings.data.available && (
          <p className="publication-empty">
            {t(
              "發布服務尚未配置，請聯絡企業管理員。",
              "Publishing is not configured. Contact your workspace administrator.",
            )}
          </p>
        )}
        {!accounts.length && (
          <div className="publication-empty">
            <Link2 size={28} />
            <h3>{t("先連接你的品牌帳戶", "Connect your brand account")}</h3>
            <p>
              {settings.data?.can_manage
                ? t(
                    "授權後，逐一選擇可用帳戶並設定發布範圍。",
                    "After authorization, enable each account and set its publishing policy.",
                  )
                : t(
                    "請企業管理員連接並啟用本專案可用的帳戶。",
                    "Ask your workspace administrator to connect and enable an account for this project.",
                  )}
            </p>
          </div>
        )}
        <div className="publication-account-grid">
          {accounts.map(({ target: item, connection: owner }) => (
            <div
              key={item.id}
              className={
                "publication-account " +
                (item.id === selectedTarget ? "selected" : "")
              }
            >
              <button
                className="publication-account-select"
                type="button"
                aria-pressed={item.id === selectedTarget}
                disabled={busy}
                onClick={() => {
                  setTargetId(item.id);
                  setPreview(null);
                }}
              >
                <span className="publication-avatar">
                  {item.kind === "facebook_page" ? "f" : "◎"}
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.kind === "facebook_page"
                      ? "Facebook Page"
                      : "Instagram Professional"}{" "}
                    · {item.external_id}
                  </small>
                  <span className="publication-account-state">
                    {owner.state === "connected"
                      ? item.enabled
                        ? t("已啟用", "Enabled")
                        : t("待選擇發布範圍", "Choose account scope")
                      : owner.state === "reauth_required"
                        ? t("需要重新授權", "Reconnect required")
                        : t("已解除連接", "Disconnected")}
                  </span>
                </span>
                {item.id === selectedTarget && <Check size={17} />}
              </button>
              {settings.data?.can_manage && (
                <div className="publication-account-actions">
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy || owner.state !== "connected"}
                    onClick={() => setScopeEditor(owner)}
                  >
                    {t("帳戶與專案範圍", "Account & project scope")}
                  </button>
                  {owner.created_by === actor && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => connect(owner)}
                    >
                      {t("重新授權", "Reconnect")}
                    </button>
                  )}
                  {owner.state !== "disconnected" && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          post(root + `/connections/${owner.id}/disconnect`, {
                            expected_version: owner.version,
                          }),
                        )
                      }
                    >
                      {t("解除連接", "Disconnect")}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {target && (
          <div className="publication-policy-strip">
            <ShieldCheck size={20} />
            <div>
              <strong>
                {currentPolicy?.policy.enabled
                  ? t("逐次確認發布", "Confirm every publication")
                  : t("尚未啟用發布範圍", "Publishing policy is disabled")}
              </strong>
              <span>
                {currentPolicy
                  ? `${currentPolicy.policy.maximum_daily_publications} / 24h · ${publicationTime(currentPolicy.policy.expires_at)} HKT`
                  : t(
                      "由管理員選擇格式、上限與到期時間。",
                      "Your administrator chooses formats, limits and expiry.",
                    )}
              </span>
            </div>
            {settings.data?.can_manage && (
              <button
                className="button"
                disabled={busy || settings.refreshing || connections.refreshing || policy.refreshing || !policy.data}
                onClick={() => setEditPolicy(true)}
              >
                {t("設定發布範圍", "Set publishing policy")}
              </button>
            )}
          </div>
        )}
      </section>
      <div className="publication-work-grid">
        <section className="publication-section">
          <div className="publication-section-heading">
            <div>
              <span className="eyebrow">02 / {t("內容", "CONTENT")}</span>
              <h2>
                {t("準備一則值得分享的內容。", "Make something worth sharing.")}
              </h2>
            </div>
          </div>
          {target ? (
            <PublicationComposer
              key={target.id}
              base={w.base}
              target={target}
              policy={currentPolicy}
              ready={ready}
              busy={busy || !!pending}
              onChange={() => setPreview(null)}
              onPreview={(draft) =>
                void run(
                  () =>
                    post(
                      root + "/previews",
                      draft,
                    ) as Promise<PublicationPreview>,
                  (result) => {
                    setPreview(result);
                    setSelected(null);
                  },
                )
              }
            />
          ) : (
            <p className="muted">
              {t(
                "連接帳戶後即可開始準備內容。",
                "Connect an account to start preparing content.",
              )}
            </p>
          )}
        </section>
        <section className="publication-section publication-preview-section">
          <div className="publication-section-heading">
            <div>
              <span className="eyebrow">03 / {t("預覽", "PREVIEW")}</span>
              <h2>{t("核對每一個細節。", "Review every detail.")}</h2>
            </div>
          </div>
          {preview ? (
            <>
              <PublicationContentView
                root={root}
                kind="previews"
                id={preview.preview_id}
                tenant={w.tenant}
                content={preview}
                digest={preview.payload_sha256}
                onWithdraw={() => {
                  setPreview(null);
                  setError(
                    new Error(
                      t(
                        "來源或預覽已不可用，請重新核對素材。",
                        "The source or preview is no longer available. Review the assets again.",
                      ),
                    ),
                  );
                }}
              />
              <p className="muted">
                {t("預覽有效至", "Preview valid until")}{" "}
                {publicationTime(preview.expires_at)} HKT
              </p>
              <button
                className="button primary"
                disabled={
                  busy ||
                  !!pending ||
                  !ready ||
                  Date.parse(preview.expires_at) <= Date.now()
                }
                onClick={() =>
                  track("prepare", root + "/operations", {
                    preview_id: preview.preview_id,
                    payload_sha256: preview.payload_sha256,
                  })
                }
              >
                {t("下一步：核對發布確認", "Next: review confirmation")}
                <ArrowUpRight size={17} />
              </button>
            </>
          ) : (
            <div className="publication-preview-empty">
              <span className="publication-preview-mark">
                <Send size={31} />
              </span>
              <h3>
                {t("正式發送前，先看清楚。", "See exactly what will be sent.")}
              </h3>
              <p>
                {t(
                  "預覽會固定文字與素材版本，顯示實際發布的圖片或影片。",
                  "Preview fixes your text and asset versions, and displays the outgoing images or videos.",
                )}
              </p>
            </div>
          )}
        </section>
      </div>
      <PublicationHistory
        root={root}
        refresh={refresh}
        selected={selected}
        onSelect={setSelected}
      />
      {selected && (
        <PublicationInspector
          key={selected}
          root={root}
          tenant={w.tenant}
          id={selected}
          actor={actor}
          canManage={!!settings.data?.can_manage}
          refresh={refresh}
          busy={busy || !!pending}
          onDismiss={() => setSelected(null)}
          onRefresh={changed}
          onDecision={(operation, decision, previous) =>
            track(
              "decision",
              root + `/operations/${operation.id}/decision`,
              {
                expected_version: operation.version,
                payload_sha256: operation.payload_sha256,
                decision,
                acknowledge_publication: true,
                acknowledge_previous_unknown: previous,
              },
              operation.id,
            )
          }
          onCancel={(operation) =>
            track(
              "cancel",
              root + `/operations/${operation.id}/cancel`,
              { expected_version: operation.version },
              operation.id,
            )
          }
          onObserve={(operation, remote) =>
            void run(() =>
              post(root + `/operations/${operation.id}/observe`, {
                expected_version: operation.version,
                ...(remote ? { remote_id: remote } : {}),
              }),
            )
          }
          onResolve={(operation, reason, observation) =>
            track(
              "close",
              root + `/operations/${operation.id}/close-unknown`,
              {
                expected_version: operation.version,
                observation_sha256: observation,
                reason,
                acknowledge_unknown_attribution: true,
              },
              operation.id,
            )
          }
        />
      )}
      {scopeEditor && (
        <Modal
          title={t("帳戶與專案範圍", "Account and project scope")}
          onClose={() => {
            if (!busy) setScopeEditor(null);
          }}
        >
          <ConnectionScope
            key={scopeEditor.id + ":" + scopeEditor.version}
            connection={scopeEditor}
            projects={w.projects}
            busy={busy}
            error={error}
            onSave={(projects, targets) =>
              void run(
                () =>
                  api(root + `/connections/${scopeEditor.id}/scope`, {
                    method: "PUT",
                    body: JSON.stringify({
                      expected_version: scopeEditor.version,
                      project_ids: projects,
                      target_ids: targets,
                    }),
                  }),
                () => setScopeEditor(null),
              )
            }
          />
        </Modal>
      )}
      {editPolicy && target && (
        <Modal
          title={t("設定發布範圍", "Publishing policy")}
          onClose={() => {
            if (!busy) setEditPolicy(false);
          }}
        >
          <PublicationPolicyEditor
            key={target.id + ":" + currentPolicy?.version}
            target={target}
            policy={currentPolicy}
            busy={busy}
            error={error}
            onClose={() => setEditPolicy(false)}
            onSave={(body, version) =>
              void run(
                () =>
                  api(root + "/policy/" + target.id, {
                    method: "PUT",
                    body: JSON.stringify({
                      expected_version: version,
                      policy: body,
                    }),
                  }),
                () => setEditPolicy(false),
              )
            }
          />
        </Modal>
      )}
    </div>
  );
}

function ConnectionScope({
  connection,
  projects,
  busy,
  error,
  onSave,
}: {
  connection: PublicationConnection;
  projects: any[];
  busy: boolean;
  error: unknown;
  onSave: (projects: string[], targets: string[]) => void;
}) {
  const { t } = useI18n(),
    [projectIds, setProjectIds] = useState(connection.project_ids),
    [targetIds, setTargetIds] = useState(
      connection.targets
        .filter((target) => target.enabled)
        .map((target) => target.id),
    );
  const toggle = (old: string[], id: string) =>
    old.includes(id) ? old.filter((value) => value !== id) : [...old, id];
  return (
    <form
      className="publication-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(projectIds, targetIds);
      }}
    >
      <p>
        {t(
          "只啟用明確選取的帳戶。變更會使舊發布確認失效。",
          "Enable only the accounts you select. Changes invalidate earlier publication approvals.",
        )}
      </p>
      <fieldset disabled={busy}>
        <legend>{t("可發布帳戶", "Accounts enabled for publishing")}</legend>
        {connection.targets.map((target) => (
          <label className="publication-check" key={target.id}>
            <input
              type="checkbox"
              checked={targetIds.includes(target.id)}
              onChange={() => setTargetIds((old) => toggle(old, target.id))}
            />
            <span>
              {target.name} · {target.external_id}
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset disabled={busy}>
        <legend>{t("可使用專案", "Projects with access")}</legend>
        {projects.map((project) => (
          <label className="publication-check" key={project.id}>
            <input
              type="checkbox"
              checked={projectIds.includes(project.id)}
              onChange={() => setProjectIds((old) => toggle(old, project.id))}
            />
            <span>{project.name}</span>
          </label>
        ))}
        {projectIds
          .filter((id) => !projects.some((p) => p.id === id))
          .map((id) => (
            <p className="muted" key={id}>
              {t("保留其他已授權專案", "Retain another authorized project")}:{" "}
              {id}
            </p>
          ))}
      </fieldset>
      <ErrorNotice error={error} />
      <button className="button primary" disabled={busy || !projectIds.length}>
        {t("儲存明確範圍", "Save selected scope")}
      </button>
    </form>
  );
}

function PublicationComposer({
  base,
  target,
  policy,
  ready,
  busy,
  onChange,
  onPreview,
}: {
  base: string;
  target: PublicationTarget;
  policy: PublicationPolicy | null;
  ready: boolean;
  busy: boolean;
  onChange: () => void;
  onPreview: (draft: PublicationDraft) => void;
}) {
  const { t } = useI18n(),
    [format, setFormat] = useState<PublicationFormat>(
      target.capabilities.formats[0] ?? "facebook_post",
    ),
    [caption, setCaption] = useState(""),
    [title, setTitle] = useState(""),
    [link, setLink] = useState(""),
    [share, setShare] = useState(true),
    [sources, setSources] = useState<ChosenSource[]>([]);
  const gallery = ["facebook_gallery", "instagram_carousel"].includes(format),
    maximum = gallery ? 10 : format === "facebook_post" ? 0 : 1;
  const requiredCount = gallery ? 2 : maximum,
    supported =
      target.capabilities.formats.includes(format) &&
      !!policy?.policy.formats.includes(format);
  const update = (fn: () => void) => {
    fn();
    onChange();
  };
  return (
    <form
      className="publication-form"
      onSubmit={(e) => {
        e.preventDefault();
        onPreview({
          target_id: target.id,
          format,
          caption: format === "instagram_story" ? "" : caption,
          title: format === "facebook_video" ? title : "",
          link: format === "facebook_post" && link.trim() ? link.trim() : null,
          share_to_feed: format === "instagram_reel" ? share : true,
          sources: sources.map(
            ({
              asset_id,
              version,
              expected_sha256,
              alt_text,
              jpeg_background,
            }) => ({
              asset_id,
              version,
              expected_sha256,
              alt_text,
              jpeg_background,
            }),
          ),
        });
      }}
    >
      <fieldset disabled={busy}>
        <Field label={t("發布格式", "Publication format")}>
          <select
            value={format}
            onChange={(e) =>
              update(() => {
                setFormat(e.target.value as PublicationFormat);
                setSources([]);
              })
            }
          >
            {target.capabilities.formats.map((value) => (
              <option key={value} value={value}>
                {publicationFormatName(value, t)}
              </option>
            ))}
          </select>
        </Field>
        {format !== "instagram_story" && (
          <Field
            label={t("發布文字", "Publication text")}
            hint={`${[...caption].length} / ${format.startsWith("instagram_") ? 2200 : 63206}`}
          >
            <textarea
              rows={6}
              value={caption}
              maxLength={format.startsWith("instagram_") ? 4400 : 126412}
              onChange={(e) => update(() => setCaption(e.target.value))}
              placeholder={t(
                "寫下品牌想說的話…",
                "What would your brand like to say?",
              )}
            />
          </Field>
        )}
        {format === "instagram_story" && (
          <p className="muted">
            {t(
              "限時動態的文字請先編排在素材內。",
              "Include story text in the selected media.",
            )}
          </p>
        )}
        {format === "facebook_video" && (
          <Field label={t("影片標題", "Video title")}>
            <input
              value={title}
              maxLength={255}
              onChange={(e) => update(() => setTitle(e.target.value))}
            />
          </Field>
        )}
        {format === "facebook_post" && (
          <Field label={t("連結（可選）", "HTTPS link (optional)")}>
            <input
              type="url"
              value={link}
              onChange={(e) => update(() => setLink(e.target.value))}
              placeholder="https://…"
            />
          </Field>
        )}
        {format === "instagram_reel" && (
          <label className="publication-check">
            <input
              type="checkbox"
              checked={share}
              onChange={(e) => update(() => setShare(e.target.checked))}
            />
            <span>{t("同時分享至動態消息", "Also share to feed")}</span>
          </label>
        )}
        {maximum > 0 && (
          <>
            <h3>{t("選擇固定版本素材", "Choose exact asset versions")}</h3>
            <p className="muted">
              {gallery
                ? t(
                    "按下方順序發布2至10個素材。",
                    "Publish two to ten items in the order below.",
                  )
                : t(
                    "選擇一個已上傳或已生成的素材。",
                    "Choose one uploaded or generated asset.",
                  )}
            </p>
            {sources.map((source, index) => (
              <div
                className="publication-selected-source"
                key={source.asset_id + ":" + source.version}
              >
                <div className="publication-source-heading">
                  <strong>
                    {index + 1}. {source.name} · v{source.version}
                  </strong>
                  <span>{publicationBytes(source.bytes)}</span>
                  <div className="publication-source-controls">
                    <button
                      type="button"
                      className="icon-button"
                      disabled={index === 0}
                      aria-label={t("移至上一項", "Move earlier")}
                      onClick={() =>
                        update(() =>
                          setSources((old) => {
                            const next = [...old];
                            [next[index - 1], next[index]] = [
                              next[index],
                              next[index - 1],
                            ];
                            return next;
                          }),
                        )
                      }
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={index === sources.length - 1}
                      aria-label={t("移至下一項", "Move later")}
                      onClick={() =>
                        update(() =>
                          setSources((old) => {
                            const next = [...old];
                            [next[index], next[index + 1]] = [
                              next[index + 1],
                              next[index],
                            ];
                            return next;
                          }),
                        )
                      }
                    >
                      <ArrowDown size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t("移除素材", "Remove asset")}
                      onClick={() =>
                        update(() =>
                          setSources((old) =>
                            old.filter((_, i) => i !== index),
                          ),
                        )
                      }
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
                <Field label={t("替代文字", "Alternative text")}>
                  <input
                    value={source.alt_text}
                    maxLength={1000}
                    onChange={(e) =>
                      update(() =>
                        setSources((old) =>
                          old.map((item, i) =>
                            i === index
                              ? { ...item, alt_text: e.target.value }
                              : item,
                          ),
                        ),
                      )
                    }
                  />
                </Field>
                {format.startsWith("instagram_") &&
                  source.mime === "image/png" && (
                    <Field
                      label={t("JPEG 背景色", "JPEG background")}
                      hint={t(
                        "預覽將顯示實際轉換結果。",
                        "The preview shows the actual conversion.",
                      )}
                    >
                      <input
                        type="color"
                        value={source.jpeg_background}
                        onChange={(e) =>
                          update(() =>
                            setSources((old) =>
                              old.map((item, i) =>
                                i === index
                                  ? { ...item, jpeg_background: e.target.value }
                                  : item,
                              ),
                            ),
                          )
                        }
                      />
                    </Field>
                  )}
              </div>
            ))}
            {sources.length < maximum && (
              <PublicationAssetPicker
                base={base}
                format={format}
                selected={sources}
                onAdd={(source) =>
                  update(() => setSources((old) => [...old, source]))
                }
              />
            )}
          </>
        )}
        {!ready && (
          <p className="publication-inline-note">
            {t(
              "請先啟用帳戶，並設定有效的發布範圍。",
              "Enable the account and a valid publishing policy before creating a preview.",
            )}
          </p>
        )}
        {ready && !supported && (
          <p className="publication-inline-note">
            {t(
              "此格式未在目前發布範圍內。",
              "This format is outside the current publishing policy.",
            )}
          </p>
        )}
        <button
          className="button primary"
          disabled={
            busy ||
            !ready ||
            !supported ||
            sources.length < requiredCount ||
            (format !== "instagram_story" &&
              [...caption].length >
                (format.startsWith("instagram_") ? 2200 : 63206)) ||
            (format === "facebook_post" && !caption.trim() && !link.trim())
          }
        >
          {t("建立實際內容預覽", "Preview outgoing content")}
          <ArrowUpRight size={17} />
        </button>
      </fieldset>
    </form>
  );
}

function PublicationAssetPicker({
  base,
  format,
  selected,
  onAdd,
}: {
  base: string;
  format: PublicationFormat;
  selected: ChosenSource[];
  onAdd: (source: ChosenSource) => void;
}) {
  const { t } = useI18n(),
    assets = usePublicationData<{ items: Asset[] }>(base + "/assets", 0, 0),
    [assetId, setAssetId] = useState(""),
    [version, setVersion] = useState(0);
  const mimeAllowed = (mime: string) =>
    ["facebook_video", "instagram_reel"].includes(format)
      ? mime === "video/mp4"
      : ["instagram_story", "instagram_carousel"].includes(format)
        ? ["image/png", "image/jpeg", "video/mp4"].includes(mime)
        : ["image/png", "image/jpeg"].includes(mime);
  const available =
    assets.data?.items.filter((asset) => mimeAllowed(asset.mime_type)) ?? [];
  const asset = available.find((item) => item.id === assetId) ?? available[0];
  const versions = usePublicationData<{ items: AssetVersion[] }>(
    asset ? base + `/assets/${asset.id}/versions` : null,
    0,
    0,
  );
  const allowed =
    versions.data?.items.filter((item) => mimeAllowed(item.mime_type)) ?? [];
  const chosen =
    allowed.find((item) => item.version === version) ??
    allowed.find((item) => item.version === asset?.current_version) ??
    allowed[0];
  const duplicate = selected.some(
    (item) => item.asset_id === asset?.id && item.version === chosen?.version,
  );
  return (
    <div className="publication-asset-picker">
      <div className="publication-field-pair">
        <Field label={t("素材（最近200個）", "Asset (latest 200)")}>
          <select
            value={asset?.id ?? ""}
            onChange={(e) => {
              setAssetId(e.target.value);
              setVersion(0);
            }}
          >
            <option value="" disabled>
              {t("選擇素材", "Choose an asset")}
            </option>
            {available.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("素材版本", "Asset version")}>
          <select
            value={chosen?.version ?? ""}
            onChange={(e) => setVersion(Number(e.target.value))}
          >
            <option value="" disabled>
              —
            </option>
            {allowed.map((item) => (
              <option key={item.id} value={item.version}>
                v{item.version} · {publicationBytes(item.bytes)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ErrorNotice error={assets.error || versions.error} />
      {!available.length && assets.data && (
        <p className="muted">
          {t(
            "暫無支援素材。請先在素材與交付頁上傳 PNG、JPEG 或 MP4。",
            "No supported asset is available. Upload PNG, JPEG or MP4 in Assets & deliverables first.",
          )}
        </p>
      )}
      <button
        type="button"
        className="button"
        disabled={!asset || !chosen || duplicate}
        onClick={() => {
          if (asset && chosen)
            onAdd({
              asset_id: asset.id,
              name: asset.name,
              version: chosen.version,
              expected_sha256: chosen.sha256,
              alt_text: "",
              jpeg_background: "#ffffff",
              mime: chosen.mime_type,
              bytes: chosen.bytes,
            });
        }}
      >
        <Plus size={16} />
        {duplicate
          ? t("已選擇此版本", "Version already selected")
          : t("加入此版本", "Add this version")}
      </button>
    </div>
  );
}

function PendingRequest({
  root,
  pending,
  refresh,
  busy,
  onFound,
  onRelease,
}: {
  root: string;
  pending: PendingPublication;
  refresh: number;
  busy: boolean;
  onFound: (result: PublicationOperation) => void;
  onRelease: () => void;
}) {
  const { t } = useI18n(),
    result = usePublicationData<{ result: PublicationOperation }>(
      root +
        "/requests/" +
        pending.key +
        (pending.operation_id ? "?operation_id=" + pending.operation_id : ""),
      refresh,
      3000,
    );
  const found = useRef(onFound);
  found.current = onFound;
  useEffect(() => {
    if (result.data?.result) found.current(result.data.result);
  }, [result.data]);
  const notCommitted =
    result.error instanceof ApiError && result.error.status === 404;
  return (
    <aside className="publication-pending" role="status">
      <RefreshCw size={19} />
      <div>
        <strong>{t("正在核對原請求", "Checking the original request")}</strong>
        <p>
          {t(
            "回應未確認時，只讀取原請求結果，不會另建發布。",
            "While the response is uncertain, only the original result is checked. Another publication is not created.",
          )}
        </p>
        {notCommitted && !busy && (
          <p>
            {t(
              "目前未找到已提交記錄。你可以回到原操作查看最新狀態。",
              "No committed record is currently found. You can review the latest original operation.",
            )}
          </p>
        )}
        {!!result.error && !notCommitted && (
          <ErrorNotice error={result.error} />
        )}
        {!busy &&
          (notCommitted ||
            (result.error instanceof ApiError &&
              result.error.status === 410)) && (
            <button className="button" onClick={onRelease}>
              {pending.operation_id
                ? t("開啟原操作核對", "Review original operation")
                : t("返回內容編輯", "Return to content editor")}
            </button>
          )}
      </div>
    </aside>
  );
}

function PublicationHistory({
  root,
  refresh,
  selected,
  onSelect,
}: {
  root: string;
  refresh: number;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n(),
    [state, setState] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [stack, setStack] = useState<(string | null)[]>([]);
  const history = usePublicationData<{
    items: PublicationOperation[];
    next_cursor: string | null;
  }>(
    root +
      "/operations?limit=10" +
      (state ? "&state=" + state : "") +
      (cursor ? "&cursor=" + cursor : ""),
    refresh,
    3000,
  );
  return (
    <section className="publication-section publication-history">
      <div className="publication-section-heading">
        <div>
          <span className="eyebrow">
            04 / {t("確認與結果", "CONFIRM & TRACK")}
          </span>
          <h2>
            {t("每一次發布，都有記錄。", "Every publication, accounted for.")}
          </h2>
        </div>
        <Field label={t("篩選狀態", "Filter state")}>
          <select
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setCursor(null);
              setStack([]);
            }}
          >
            <option value="">{t("全部狀態", "All states")}</option>
            {Object.entries(publicationStates).map(([value, label]) => (
              <option key={value} value={value}>
                {t(...label)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ErrorNotice error={history.error} />
      {history.data && !history.data.items.length && (
        <p className="publication-empty">
          {t("此範圍尚未有發布記錄。", "No publications in this view yet.")}
        </p>
      )}
      <div className="publication-records">
        {history.data?.items.map((operation) => (
          <button
            key={operation.id}
            className={
              "publication-record " +
              (selected === operation.id ? "selected" : "")
            }
            onClick={() => onSelect(operation.id)}
          >
            <span>
              <strong>{publicationFormatName(operation.format, t)}</strong>
              <small>{publicationTime(operation.created_at)} HKT</small>
            </span>
            <PublicationState state={operation.state} />
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
      <div className="publication-actions">
        <button
          className="button"
          disabled={!stack.length}
          onClick={() => {
            setCursor(stack[stack.length - 1]);
            setStack((old) => old.slice(0, -1));
          }}
        >
          {t("上一頁", "Previous")}
        </button>
        <button
          className="button"
          disabled={!history.data?.next_cursor}
          onClick={() => {
            setStack((old) => [...old, cursor]);
            setCursor(history.data!.next_cursor);
          }}
        >
          {t("下一頁", "Next")}
        </button>
      </div>
    </section>
  );
}

function PublicationInspector({
  root,
  tenant,
  id,
  actor,
  canManage,
  refresh,
  busy,
  onDismiss,
  onRefresh,
  onDecision,
  onCancel,
  onObserve,
  onResolve,
}: {
  root: string;
  tenant: string;
  id: string;
  actor: string;
  canManage: boolean;
  refresh: number;
  busy: boolean;
  onDismiss: () => void;
  onRefresh: () => void;
  onDecision: (
    operation: PublicationDetail,
    decision: "confirm" | "reject",
    previous: boolean,
  ) => void;
  onCancel: (operation: PublicationDetail) => void;
  onObserve: (operation: PublicationDetail, remote?: string) => void;
  onResolve: (
    operation: PublicationDetail,
    reason: string,
    observation: string,
  ) => void;
}) {
  const { t } = useI18n(),
    detail = usePublicationData<PublicationDetail>(
      root + "/operations/" + id,
      refresh,
      2500,
    ),
    [withdrawn, setWithdrawn] = useState(false);
  const operation = detail.data,
    own = operation?.actor_id === actor;
  useEffect(() => setWithdrawn(false), [id, refresh]);
  return (
    <section
      className="publication-section publication-inspector"
      aria-label={t("發布詳情", "Publication details")}
    >
      <div className="publication-section-heading">
        <div>
          <span className="eyebrow">
            {t("發布詳情", "PUBLICATION DETAILS")}
          </span>
          <h2>
            {operation
              ? publicationFormatName(operation.format, t)
              : t("正在讀取…", "Loading…")}
          </h2>
        </div>
        <div className="publication-actions">
          <button className="button" disabled={busy} onClick={onRefresh}>
            <RefreshCw size={16} />
            {t("重新核對", "Refresh")}
          </button>
          <button
            className="icon-button"
            aria-label={t("關閉詳情", "Close details")}
            onClick={onDismiss}
          >
            <X size={20} />
          </button>
        </div>
      </div>
      <ErrorNotice error={detail.error} />
      {operation && (
        <>
          <div className="publication-operation-summary">
            <PublicationState state={operation.state} />
            <span>{publicationTime(operation.created_at)} HKT</span>
          </div>
          {operation.content && operation.can_view_content && !withdrawn ? (
            <PublicationContentView
              root={root}
              kind="operations"
              id={id}
              tenant={tenant}
              content={operation.content}
              digest={operation.payload_sha256}
              onWithdraw={() => setWithdrawn(true)}
            />
          ) : (
            <p className="publication-inline-note">
              {t(
                "目前只顯示操作記錄；正文與素材不可讀取。",
                "Only the operation record is available. Content and media are not accessible.",
              )}
            </p>
          )}
          {operation.error_code && (
            <p className="publication-inline-note">
              {t("此操作需要留意", "This operation needs attention")}:{" "}
              <code>{operation.error_code}</code>
            </p>
          )}
          {own && operation.state === "awaiting_confirmation" && (
            <PublicationConfirmation
              key={operation.id + ":" + operation.version}
              operation={operation}
              busy={busy}
              blocked={
                withdrawn || !operation.content || !operation.can_view_content
              }
              onDecision={(decision, previous) =>
                onDecision(operation, decision, previous)
              }
            />
          )}
          {own && operation.state === "queued" && (
            <button
              className="button"
              disabled={busy}
              onClick={() => onCancel(operation)}
            >
              {t("取消尚未發送的操作", "Cancel before dispatch")}
            </button>
          )}
          {(own || canManage) && operation.state === "unknown" && (
            <PublicationResolution
              key={operation.version}
              operation={operation}
              busy={busy}
              onObserve={(remote) => onObserve(operation, remote)}
              onClose={(reason, observation) =>
                onResolve(operation, reason, observation)
              }
            />
          )}
          {operation.state === "succeeded" && (
            <p className="publication-success">
              <Check size={20} />
              {t(
                "已取得可歸因的發布證據。",
                "Attributable publication evidence is recorded.",
              )}{" "}
              {operation.result?.remote_id && (
                <span>
                  {t("平台編號", "Provider ID")}: {operation.result.remote_id}
                </span>
              )}
            </p>
          )}
          {operation.state === "closed_unknown" && (
            <p className="publication-inline-note">
              {t(
                "已記錄人工處置；仍無法確定本次發布歸因。",
                "A manual resolution is recorded. Publication attribution remains unknown.",
              )}
            </p>
          )}
          <details className="publication-proof">
            <summary>{t("操作步驟與時間記錄", "Steps and timeline")}</summary>
            <p>
              <code>{operation.id}</code>
            </p>
            <ul>
              {operation.effects.map((effect) => (
                <li key={effect.id}>
                  <strong>{effect.step_key}</strong> · {effect.state}
                  {effect.remote_id && ` · ${effect.remote_id}`}
                </li>
              ))}
            </ul>
            <ol>
              {operation.events.map((event) => (
                <li key={event.version}>
                  <PublicationState state={event.state} />{" "}
                  <time>{publicationTime(event.created_at)} HKT</time>
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </section>
  );
}
