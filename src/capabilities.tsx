import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { api } from "./api";
import { operationKey, completeOperation } from "./operation-key";
import { formatHKD } from "./financial-money";
import {
  Badge,
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
import {
  capabilityDraft,
  capabilityRoot as root,
  rateInput,
  type CapabilityAccess,
  type CapabilityComparison,
  type CapabilityDocument,
  type CapabilityPreview,
  type CapabilityRelease,
  type CapabilityValidation,
  type WorkspacePurge,
} from "./capability-model";
import "./capabilities.css";

function ProfileName({ value }: { value: CapabilityDocument["profile_key"] }) {
  const { t } = useI18n();
  return (
    <>
      {value === "internal-text-v1"
        ? t("文字與開發", "Text & development")
        : t("圖片生成與編輯", "Image generation & editing")}
    </>
  );
}
function Mode({ value }: { value: CapabilityRelease["data_mode"] }) {
  const { t } = useI18n();
  return (
    <span className="badge">
      {value === "simulated"
        ? t("模擬資料", "Simulated data")
        : t("已設定服務", "Configured services")}
    </span>
  );
}
function ReleaseState({ value }: { value: CapabilityRelease["state"] }) {
  const { t } = useI18n(),
    labels = {
      published: t("目前發佈", "Currently published"),
      superseded: t("歷史發佈", "Previous publication"),
      validated: t("驗證有效", "Validation current"),
      rejected: t("驗證未通過", "Validation failed"),
      draft: t("待驗證", "Needs validation"),
    };
  return <span className={`badge status-${value}`}>{labels[value]}</span>;
}
export function CapabilityFacts({
  document,
  version,
}: {
  document: CapabilityDocument;
  version?: number;
}) {
  const { t } = useI18n(),
    text = document.profile_key === "internal-text-v1";
  return (
    <div className="cap-facts">
      <h3>
        {document.model_alias}{" "}
        {version !== undefined && <small>v{version}</small>}
      </h3>
      <dl className="key-value">
        <dt>{t("能力", "Capability")}</dt>
        <dd>
          <ProfileName value={document.profile_key} />
        </dd>
        <dt>{t("Agent 內核", "Agent kernel")}</dt>
        <dd>Codex</dd>
        <dt>{t("請求路由", "Request routing")}</dt>
        <dd>{t("公司內部伺服器", "Company internal server")}</dd>
        <dt>{t("推理強度", "Reasoning effort")}</dt>
        <dd>{document.reasoning_effort ?? t("不適用", "Not applicable")}</dd>
        {text ? (
          <>
            <dt>{t("輸入／一百萬 tokens", "Input / million tokens")}</dt>
            <dd>{formatHKD(String(document.rates[0]))}</dd>
            <dt>{t("輸出／一百萬 tokens", "Output / million tokens")}</dt>
            <dd>{formatHKD(String(document.rates[1]))}</dd>
          </>
        ) : (
          <>
            <dt>{t("每張圖片", "Per image")}</dt>
            <dd>{formatHKD(String(document.rates[0]))}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
export function CapabilityPublicationFacts({
  before,
}: {
  before: CapabilityComparison;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="cap-comparison">
        <section aria-label={t("目前模型配置", "Current model configuration")}>
          <h4>{t("目前配置", "Current configuration")}</h4>
          {before.current ? (
            <CapabilityFacts {...before.current} />
          ) : (
            <p className="muted">
              {t(
                "此能力尚無後台發佈版本。",
                "This capability has no Admin publication yet.",
              )}
            </p>
          )}
        </section>
        <section
          aria-label={t("待發佈模型配置", "Proposed model configuration")}
        >
          <h4>{t("待發佈配置", "Proposed configuration")}</h4>
          <CapabilityFacts {...before.proposed} />
        </section>
      </div>
      <div className="cap-meta">
        <Mode value={before.data_mode} />
        <span>
          {t("發佈序號", "Publication revision")} {before.head_revision}
        </span>
      </div>
      <p className="notice">
        {t(
          "發佈後，新工作使用新配置；已有工作保留原模型與費率。已有專家及會話須由用戶明確採用新版本。",
          "New tasks use the published configuration. Existing tasks retain their model and rates. Existing experts and sessions require an explicit version adoption.",
        )}
      </p>
    </>
  );
}
async function command<T>(
  access: CapabilityAccess,
  action: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const result = await api<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Idempotency-Key": await operationKey(access.me.user.id, action, body),
      ...headers,
    },
  });
  await completeOperation(access.me.user.id, action, body);
  return result;
}
export function AdminCapabilities({ access }: { access: CapabilityAccess }) {
  const { t } = useI18n(),
    [revision, setRevision] = useState(0),
    [page, setPage] = useState(0),
    [cursors, setCursors] = useState<(string | null)[]>([null]),
    [edit, setEdit] = useState<{ from?: CapabilityRelease } | null>(null),
    [detail, setDetail] = useState<string | null>(null),
    [publish, setPublish] = useState<{
      release: CapabilityRelease;
      rollback: boolean;
    } | null>(null),
    [notice, setNotice] = useState("");
  const query = new URLSearchParams({ limit: "12" });
  if (cursors[page]) query.set("cursor", cursors[page]!);
  const list = useData<{
    items: CapabilityRelease[];
    next_cursor: string | null;
  }>(
    access.has("admin.catalog.read") ? `${root}?${query}` : null,
    revision,
    10000,
  );
  const refresh = () => {
    setPage(0);
    setCursors([null]);
    setRevision((v) => v + 1);
  };
  return (
    <>
      <PageHeader
        eyebrow="THE MODEL BEHIND THE WORK."
        title={t("模型能力", "Model capabilities")}
        description={t(
          "為文字與圖片建立可驗證的配置，逐次審核模型、強度與費率。",
          "Create verifiable text and image configurations. Review the model, reasoning effort and rates before each publication.",
        )}
        action={
          access.has("admin.catalog.draft") && (
            <button className="button primary" onClick={() => setEdit({})}>
              <Plus size={17} />
              {t("建立配置", "Create configuration")}
            </button>
          )
        }
      />
      <div className="cap-toolbar">
        <p className="muted">
          {t(
            "配置存檔後保留原定義；變更會建立新版本。",
            "Saved configurations retain their definition. Changes create a new version.",
          )}
        </p>
        <button className="button secondary" onClick={refresh}>
          <RefreshCw size={16} />
          {t("重新整理", "Refresh")}
        </button>
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {!access.has("admin.catalog.read") && (
        <p className="notice">
          {t("需要讀取目錄的權限。", "Catalog read permission is required.")}
        </p>
      )}
      <ErrorNotice error={list.error} />
      {list.loading && <Loading />}
      {list.data && (
        <>
          {!list.data.items.length ? (
            <Empty
              title={t("尚未建立模型配置", "No model configurations yet")}
              body={t(
                "建立文字或圖片配置，完成驗證後再申請發佈。",
                "Create a text or image configuration, validate it, then request publication.",
              )}
            />
          ) : (
            <div className="cap-release-list">
              {list.data.items.map((r) => (
                <article
                  className="cap-release"
                  key={r.id}
                  data-release-id={r.id}
                >
                  <div className="cap-release-heading">
                    <div>
                      <p className="eyebrow">
                        <ProfileName value={r.profile_key} />
                      </p>
                      <h2>
                        {r.document.model_alias} <small>v{r.version}</small>
                      </h2>
                    </div>
                    <ReleaseState value={r.state} />
                  </div>
                  <CapabilityFacts document={r.document} />
                  <div className="cap-meta">
                    <Mode value={r.data_mode} />
                    <span>
                      {t("建立於", "Created")} <DateText value={r.created_at} />
                    </span>
                  </div>
                  {r.validation_id && (
                    <p className="muted">
                      {t("最近驗證", "Latest validation")}: {r.validation_state}{" "}
                      · {t("資格期限", "Eligibility expires")}{" "}
                      <DateText value={r.validation_expires_at} />
                    </p>
                  )}
                  <div className="cap-actions">
                    <button
                      className="button secondary"
                      onClick={() => setDetail(r.id)}
                    >
                      {t("配置與驗證", "Configuration & validation")}
                    </button>
                    {access.has("admin.catalog.draft") && (
                      <button
                        className="button secondary"
                        onClick={() => setEdit({ from: r })}
                      >
                        {t("建立新版本", "Create new version")}
                      </button>
                    )}
                    {r.state === "validated" &&
                      access.has("admin.catalog.publish") && (
                        <button
                          className="button primary"
                          onClick={() =>
                            setPublish({ release: r, rollback: false })
                          }
                        >
                          {t("發佈預覽", "Preview publication")}
                        </button>
                      )}
                    {r.state === "superseded" &&
                      access.has("admin.catalog.rollback") && (
                        <button
                          className="button secondary"
                          onClick={() =>
                            setPublish({ release: r, rollback: true })
                          }
                        >
                          {t("回滾預覽", "Preview rollback")}
                        </button>
                      )}
                  </div>
                </article>
              ))}
            </div>
          )}
          <nav
            className="cap-pagination"
            aria-label={t("配置分頁", "Configuration pages")}
          >
            <button
              className="button secondary"
              disabled={page === 0 || list.loading}
              onClick={() => setPage((v) => v - 1)}
            >
              <ChevronLeft size={16} />
              {t("上一頁", "Previous")}
            </button>
            <span>
              {t("第", "Page")} {page + 1}
            </span>
            <button
              className="button secondary"
              disabled={!list.data.next_cursor || list.loading}
              onClick={() => {
                setCursors((v) => [
                  ...v.slice(0, page + 1),
                  list.data!.next_cursor,
                ]);
                setPage((v) => v + 1);
              }}
            >
              {t("下一頁", "Next")}
              <ChevronRight size={16} />
            </button>
          </nav>
        </>
      )}
      {edit && (
        <DraftModal
          access={access}
          from={edit.from}
          onClose={() => setEdit(null)}
          onDone={(id) => {
            setEdit(null);
            setNotice(
              t(
                "配置已儲存，請執行驗證。",
                "Configuration saved. Run validation next.",
              ),
            );
            setDetail(id);
            refresh();
          }}
        />
      )}
      {detail && (
        <DetailModal
          access={access}
          id={detail}
          onClose={() => {
            setDetail(null);
            refresh();
          }}
          onDone={refresh}
        />
      )}
      {publish && (
        <PublicationModal
          access={access}
          {...publish}
          onClose={() => setPublish(null)}
          onDone={refresh}
        />
      )}
    </>
  );
}
function DraftModal({
  access,
  from,
  onClose,
  onDone,
}: {
  access: CapabilityAccess;
  from?: CapabilityRelease;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const { t } = useI18n(),
    [profile, setProfile] = useState<CapabilityDocument["profile_key"]>(
      from?.profile_key ?? "internal-text-v1",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const body = capabilityDraft(form),
        result = await command<{ target_ids: string[] }>(
          access,
          "capability.draft",
          root + "/drafts",
          body,
        );
      onDone(result.target_ids[0]);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  const d = from?.document;
  return (
    <Modal
      title={t("建立模型配置", "Create model configuration")}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="form-stack" onSubmit={submit}>
        <p className="muted">
          {t(
            "固定使用 Codex，所有 AI 請求經公司內部伺服器。模型別名必須由內部服務提供。",
            "Codex is fixed. All AI requests use the company internal server. Use a model alias provided by that service.",
          )}
        </p>
        <fieldset disabled={busy} className="cap-fields">
          <Field label={t("能力類型", "Capability type")}>
            <select
              name="profile"
              value={profile}
              onChange={(e) => setProfile(e.target.value as typeof profile)}
            >
              <option value="internal-text-v1">
                {t("文字與開發", "Text & development")}
              </option>
              <option value="internal-image2-v1">
                {t("圖片生成與編輯", "Image generation & editing")}
              </option>
            </select>
          </Field>
          <Field label={t("內部模型別名", "Internal model alias")}>
            <input
              name="model"
              required
              maxLength={200}
              defaultValue={d?.model_alias ?? ""}
              autoComplete="off"
            />
          </Field>
          {profile === "internal-text-v1" ? (
            <>
              <Field label={t("推理強度", "Reasoning effort")}>
                <select
                  name="effort"
                  defaultValue={d?.reasoning_effort ?? "max"}
                >
                  {["low", "medium", "high", "xhigh", "max"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <div className="cap-input-grid">
                <Field
                  label={t(
                    "輸入費率（HKD／一百萬 tokens）",
                    "Input rate (HKD / million tokens)",
                  )}
                  hint={t(
                    "可為零，最多六位小數。",
                    "Zero allowed; up to six decimal places.",
                  )}
                >
                  <input
                    name="input_rate"
                    required
                    inputMode="decimal"
                    defaultValue={
                      d?.profile_key === profile ? rateInput(d.rates[0]) : ""
                    }
                  />
                </Field>
                <Field
                  label={t(
                    "輸出費率（HKD／一百萬 tokens）",
                    "Output rate (HKD / million tokens)",
                  )}
                >
                  <input
                    name="output_rate"
                    required
                    inputMode="decimal"
                    defaultValue={
                      d?.profile_key === profile ? rateInput(d.rates[1]) : ""
                    }
                  />
                </Field>
              </div>
            </>
          ) : (
            <Field
              label={t("每張圖片費率（HKD）", "Rate per image (HKD)")}
              hint={t(
                "必須大於零；驗證包含生成及編輯各一次。",
                "Must be positive. Validation includes one generation and one edit.",
              )}
            >
              <input
                name="image_rate"
                required
                inputMode="decimal"
                defaultValue={
                  d?.profile_key === profile ? rateInput(d.rates[0]) : ""
                }
              />
            </Field>
          )}
          <Field label={t("操作原因", "Operation reason")}>
            <textarea name="reason" required minLength={3} maxLength={1000} />
          </Field>
        </fieldset>
        <ErrorNotice error={error} />
        <button className="button primary" type="submit" disabled={busy}>
          {busy
            ? t("正在儲存…", "Saving…")
            : t("儲存配置", "Save configuration")}
        </button>
      </form>
    </Modal>
  );
}
function DetailModal({
  access,
  id,
  onClose,
  onDone,
}: {
  access: CapabilityAccess;
  id: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [receiptId, setReceiptId] = useState<string | null>(null);
  const release = useData<CapabilityRelease>(
      access.has("admin.catalog.read") ? `${root}/${id}` : null,
      revision,
      10000,
    ),
    validationId = receiptId ?? release.data?.validation_id,
    receipt = useData<CapabilityValidation>(
      validationId && release.data
        ? `${root}/validations/${validationId}`
        : null,
      revision,
      4000,
    );
  async function validate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !release.data) return;
    const body = {
      expected_version: release.data.version,
      reason: String(new FormData(e.currentTarget).get("reason")),
    };
    setBusy(true);
    setError(null);
    try {
      const result = await command<CapabilityValidation>(
        access,
        "capability.validate:" + id,
        `${root}/${id}/validations`,
        body,
      );
      setReceiptId(result.id);
      setRevision((v) => v + 1);
      onDone();
    } catch (e) {
      setError(e as Error);
      setRevision((v) => v + 1);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t("配置與驗證", "Configuration & validation")}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <ErrorNotice error={release.error} />
      {release.loading && !release.data && <Loading />}
      {release.data && (
        <>
          <div className="cap-meta">
            <ReleaseState value={release.data.state} />
            <Mode value={release.data.data_mode} />
          </div>
          <CapabilityFacts
            document={release.data.document}
            version={release.data.version}
          />
          <details className="cap-technical">
            <summary>{t("版本識別", "Version identity")}</summary>
            <dl className="key-value">
              <dt>{t("配置 ID", "Configuration ID")}</dt>
              <dd>
                <code>{id}</code>
              </dd>
              <dt>{t("定義雜湊", "Definition hash")}</dt>
              <dd>
                <code>{release.data.definition_hash}</code>
              </dd>
              <dt>{t("執行版本", "Runtime profile")}</dt>
              <dd>
                <code>{release.data.runtime_profile_id}</code>
              </dd>
            </dl>
          </details>
          <ErrorNotice error={receipt.error} />
          {receipt.data && (
            <ValidationReceipt
              value={receipt.data}
              access={access}
              onDone={() => setRevision((v) => v + 1)}
            />
          )}
          {access.has("admin.catalog.publish") && (
            <form
              className="form-stack cap-validation-form"
              onSubmit={validate}
            >
              <h3>{t("驗證此配置", "Validate this configuration")}</h3>
              <p className="muted">
                {t(
                  "驗證會實際呼叫內部模型並記錄費用。結果不明的請求會保留待對帳狀態；重新整理可查看已保存的回執。",
                  "Validation calls the internal model and records its cost. Uncertain requests remain pending reconciliation. Refresh to inspect the saved receipt.",
                )}
              </p>
              <Field label={t("驗證原因", "Validation reason")}>
                <textarea
                  name="reason"
                  required
                  minLength={3}
                  maxLength={1000}
                  disabled={busy}
                />
              </Field>
              <ErrorNotice error={error} />
              <button
                className="button primary"
                disabled={
                  busy ||
                  ["running", "reconciling"].includes(
                    receipt.data?.state ?? release.data.validation_state ?? "",
                  )
                }
                type="submit"
              >
                <ShieldCheck size={17} />
                {busy
                  ? t(
                      "驗證中，正在等待回執…",
                      "Validating; waiting for the receipt…",
                    )
                  : t("執行驗證", "Run validation")}
              </button>
              {busy && (
                <p role="status" className="muted">
                  {t(
                    "此操作可能需數分鐘。請保留此頁等待回執。",
                    "This may take a few minutes. Keep this page open for the receipt.",
                  )}
                </p>
              )}
            </form>
          )}
        </>
      )}
    </Modal>
  );
}
function ValidationReceipt({
  value,
  access,
  onDone,
}: {
  value: CapabilityValidation;
  access: CapabilityAccess;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    r = value.result,
    labels: Record<string, [string, string]> = {
      passed: ["驗證通過", "Validation passed"],
      failed: ["驗證未通過", "Validation failed"],
      running: ["驗證進行中", "Validation running"],
      reconciling: ["待對帳", "Pending reconciliation"],
      cancelled: ["資格已取消", "Eligibility cancelled"],
    },
    checks: Record<string, [string, string]> = {
      pinned_codex: ["固定 Codex 程序", "Pinned Codex binary"],
      requested_model_and_effort: [
        "指定模型與推理強度",
        "Requested model and effort",
      ],
      tool_call_and_result: ["工具呼叫與返回", "Tool call and result"],
      completed_output: ["完成輸出", "Completed output"],
      known_usage: ["已知用量", "Known usage"],
      "images.generate": ["圖片生成", "Image generation"],
      "images.edit": ["圖片編輯", "Image editing"],
      bounded_inline_png: ["圖片格式與尺寸", "Image format and dimensions"],
      decoded_png: [
        "圖片完整解碼與校驗",
        "Complete image decoding and checksums",
      ],
    };
  return (
    <section
      className="cap-receipt"
      aria-label={t("驗證回執", "Validation receipt")}
    >
      <h3>{t(...(labels[value.state] ?? [value.state, value.state]))}</h3>
      <dl className="key-value">
        <dt>{t("開始時間", "Started")}</dt>
        <dd>
          <DateText value={value.created_at} />
        </dd>
        <dt>{t("完成時間", "Finished")}</dt>
        <dd>
          <DateText value={value.finished_at} />
        </dd>
        <dt>{t("發佈資格期限", "Publication eligibility expires")}</dt>
        <dd>
          <DateText value={value.expires_at} />
        </dd>
        <dt>{t("費用狀態", "Cost status")}</dt>
        <dd>
          {r.usage_known === true
            ? t("用量已知", "Usage known")
            : t("用量待確認", "Usage unconfirmed")}
        </dd>
        <dt>{t("已知費用", "Known cost")}</dt>
        <dd>
          {r.known_cost_micros !== undefined
            ? formatHKD(r.known_cost_micros)
            : "—"}
          {r.usage_known !== true && (
            <small>{t("不代表最終費用", "Not the final cost")}</small>
          )}
        </dd>
        <dt>{t("輸入／輸出 tokens", "Input / output tokens")}</dt>
        <dd>
          {r.input_tokens ?? "—"} / {r.output_tokens ?? "—"}
        </dd>
      </dl>
      {r.checks?.length ? (
        <ul className="cap-checks">
          {r.checks
            .filter((c) => !/^[a-f0-9]{64}$/.test(c))
            .map((c) => (
              <li key={c}>
                {checks[c] ? t(...checks[c]) : c.replaceAll("_", " ")}
              </li>
            ))}
        </ul>
      ) : null}
      {r.error_code && (
        <p className="notice error" role="alert">
          {t("驗證錯誤", "Validation error")}: <code>{r.error_code}</code>
        </p>
      )}
      {value.state === "reconciling" && (
        <p className="notice">
          {t(
            "服務可能已接受呼叫，結果仍待核對。請先查看回執，避免再次產生費用。",
            "The service may have accepted the call. Its result needs reconciliation. Inspect the receipt before creating another charge.",
          )}
        </p>
      )}
      {value.workspace_cleanup ? (
        <WorkspaceCleanup
          value={value.workspace_cleanup}
          access={access}
          onDone={onDone}
        />
      ) : r.workspace_cleanup_completed === true ? (
        <p className="muted">
          {t("驗證暫存已清理。", "Validation workspace reclaimed.")}
        </p>
      ) : null}
      <details className="cap-technical">
        <summary>{t("驗證識別", "Verification identity")}</summary>
        <dl className="key-value">
          <dt>{t("回執 ID", "Receipt ID")}</dt>
          <dd>
            <code>{value.id}</code>
          </dd>
          <dt>Codex</dt>
          <dd>{r.codex_version ?? "—"}</dd>
          <dt>{t("程序雜湊", "Binary hash")}</dt>
          <dd>
            <code>{r.codex_binary_sha256 ?? "—"}</code>
          </dd>
        </dl>
      </details>
    </section>
  );
}
function WorkspaceCleanup({
  value,
  access,
  onDone,
}: {
  value: WorkspacePurge;
  access: CapabilityAccess;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null);
  async function retry(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const body = {
      expected_version: value.version,
      reason: String(new FormData(e.currentTarget).get("reason")),
    };
    setBusy(true);
    setError(null);
    try {
      await command(
        access,
        "capability.cleanup:" + value.validation_id,
        `${root}/validations/${value.validation_id}/workspace-purge-retries`,
        body,
      );
      onDone();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="cap-cleanup">
      <h4>{t("驗證暫存清理", "Validation workspace cleanup")}</h4>
      <Badge value={value.state} />
      <p className="muted">
        {t("已嘗試", "Attempts")}: {value.attempts} / 8 ·{" "}
        {value.state === "completed" ? (
          <DateText value={value.completed_at} />
        ) : (
          <>
            {t("下次處理", "Next attempt")}:{" "}
            <DateText value={value.next_attempt_at} />
          </>
        )}
      </p>
      {value.error_code && <code>{value.error_code}</code>}
      {value.state === "failed" && access.has("admin.catalog.publish") && (
        <form className="form-stack" onSubmit={retry}>
          <Field label={t("重新清理原因", "Cleanup retry reason")}>
            <textarea
              name="reason"
              required
              minLength={3}
              maxLength={1000}
              disabled={busy}
            />
          </Field>
          <ErrorNotice error={error} />
          <button className="button secondary" disabled={busy}>
            {t("重新排程清理", "Reschedule cleanup")}
          </button>
        </form>
      )}
    </div>
  );
}
function PublicationModal({
  access,
  release,
  rollback,
  onClose,
  onDone,
}: {
  access: CapabilityAccess;
  release: CapabilityRelease;
  rollback: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    [reason, setReason] = useState(""),
    [preview, setPreview] = useState<CapabilityPreview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [operation, setOperation] = useState<{ id: string; state: string } | null>(
      null,
    ),
    [now, setNow] = useState(Date.now()),
    suffix = rollback ? "rollbacks" : "publications",
    body = { expected_version: release.version, reason: reason.trim() },
    expired = !!preview && Date.parse(preview.expires_at) <= now;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function compare(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      setPreview(
        await command<CapabilityPreview>(
          access,
          `capability.preview:${suffix}:${release.id}`,
          `${root}/${release.id}/${suffix}-previews`,
          body,
        ),
      );
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  async function request(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !preview || expired) return;
    setBusy(true);
    setError(null);
    try {
      const result = await command<{ id: string; state: string }>(
        access,
        `capability.publish:${suffix}:${release.id}:${preview.preview_id}`,
        `${root}/${release.id}/${suffix}`,
        body,
        { "x-admin-preview-id": preview.preview_id },
      );
      setOperation(result);
      onDone();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        rollback
          ? t("回滾模型配置", "Roll back model configuration")
          : t("發佈模型配置", "Publish model configuration")
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {operation ? (
        <div role="status">
          <h3>
            {operation.state === "pending_approval"
              ? t("等待另一位管理員審批", "Waiting for another administrator")
              : t("申請已記錄", "Request recorded")}
          </h3>
          <p className="muted">
            {t(
              "審批時會再次檢查權限、驗證資格及目前配置。",
              "Review rechecks permissions, validation eligibility and the current configuration.",
            )}
          </p>
          <p>
            <code>{operation.id}</code>
          </p>
          <Link
            className="button primary"
            to={`/audit?view=approvals&search=${encodeURIComponent(operation.id)}`}
            onClick={onClose}
          >
            {t("查看審批", "View approval")}
          </Link>
        </div>
      ) : (
        <>
          <form className="form-stack" onSubmit={compare}>
            <Field label={t("操作原因", "Operation reason")}>
              <textarea
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setPreview(null);
                  setError(null);
                }}
                minLength={3}
                maxLength={1000}
                required
                disabled={busy}
              />
            </Field>
            <button className="button secondary" disabled={busy}>
              {t("取得配置比較", "Compare configurations")}
            </button>
          </form>
          <ErrorNotice error={error} />
          {preview && (
            <>
              <CapabilityPublicationFacts before={preview.before} />
              <p className="muted">
                {t("預覽期限", "Preview expires")}:{" "}
                <DateText value={preview.expires_at} />
              </p>
              {expired ? (
                <p className="notice" role="status">
                  {t(
                    "預覽已到期，請重新取得比較。",
                    "This preview expired. Compare configurations again.",
                  )}
                </p>
              ) : (
                <form className="form-stack" onSubmit={request}>
                  <label className="cap-confirm">
                    <input type="checkbox" required disabled={busy} />
                    {t(
                      "已核對模型、強度與費率，申請獨立審批。",
                      "I have reviewed the model, effort and rates and request independent approval.",
                    )}
                  </label>
                  <button
                    type="submit"
                    className="button primary"
                    disabled={busy}
                  >
                    <ShieldCheck size={17} />
                    {busy
                      ? t("正在申請…", "Requesting…")
                      : t("申請獨立審批", "Request independent approval")}
                  </button>
                </form>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
