import { useState } from "react";
import { Link } from "react-router-dom";
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import { api } from "./api";
import { operationKey, completeOperation } from "./operation-key";
import { formatHKD, parseHKD } from "./financial-money";
import { rateInput, type CapabilityAccess } from "./capability-model";
import {
  PageHeader,
  Field,
  Modal,
  ErrorNotice,
  Loading,
  AsyncForm,
  DateText,
  useData,
  useI18n,
} from "./ui";
import "./provider-control.css";

const root = "/v1/admin/ai";
const labels: Record<string, [string, string]> = {
  global_slots: ["全平台同時請求", "Platform concurrent requests"],
  tenant_slots: ["每企業同時請求", "Concurrent requests / workspace"],
  actor_slots: ["每用戶同時請求", "Concurrent requests / user"],
  text_slots: ["文字同時請求", "Concurrent text requests"],
  image_slots: ["圖片同時請求", "Concurrent image requests"],
  video_slots: ["影片同時作業", "Concurrent video jobs"],
  audio_slots: ["音訊同時作業（0 為停用）", "Concurrent audio jobs (0 disables)"],
  verification_slots: ["後台驗證同時請求", "Concurrent verification requests"],
  global_rpm: ["全平台每分鐘請求", "Platform requests / minute"],
  tenant_rpm: ["每企業每分鐘請求", "Requests / minute / workspace"],
  actor_rpm: ["每用戶每分鐘請求", "Requests / minute / user"],
  text_rpm: ["文字每分鐘請求", "Text requests / minute"],
  image_rpm: ["圖片每分鐘請求", "Image requests / minute"],
  video_rpm: ["影片每分鐘提交", "Video submissions / minute"],
  audio_rpm: ["音訊每分鐘提交（0 為停用）", "Audio submissions / minute (0 disables)"],
  verification_rpm: ["後台驗證每分鐘請求", "Verification requests / minute"],
  preparation_seconds: ["準備時限（秒）", "Preparation timeout (seconds)"],
  count_price_micros: [
    "每次輸入計數費用（HKD）",
    "Input counting fee / call (HKD)",
  ],
  verification_run_micros: [
    "單次後台驗證預算（HKD）",
    "Verification budget / run (HKD)",
  ],
  verification_daily_micros: [
    "每日後台驗證預算（HKD）",
    "Daily verification budget (HKD)",
  ],
  counting_daily_micros: [
    "每日平台計數預算（HKD）",
    "Daily platform counting budget (HKD)",
  ],
};
const limits = Object.keys(labels).filter((k) => !k.endsWith("micros"));
function Money({ value }: { value: string | number | null | undefined }) {
  return (
    <>
      {value === null || value === undefined ? "—" : formatHKD(String(value))}
    </>
  );
}
function Mode({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <span className="badge">
      {value === "simulated"
        ? t("模擬資料", "Simulated data")
        : t("已設定服務", "Configured services")}
    </span>
  );
}
function State({ value }: { value: string }) {
  const { t } = useI18n();
  const names: Record<string, [string, string]> = {
    unknown: ["結果未知", "Unknown outcome"],
    prepared: ["準備中", "Prepared"],
    submitting: ["正在提交", "Submitting"],
    queued: ["等待生成", "Queued"],
    in_progress: ["生成中", "Generating"],
    failed: ["已失敗", "Failed"],
    pending: ["等待交付", "Awaiting delivery"],
    available: ["可供下載", "Available"],
    blocked: ["已停止交付", "Delivery blocked"],
    invalid: ["未通過媒體檢查", "Media check failed"],
    dispatched: ["已發送", "Dispatched"],
    completed: ["已完成", "Completed"],
    cancelled: ["已取消", "Cancelled"],
    denied: ["已拒絕", "Denied"],
    known: ["觀測費用已知", "Observed cost known"],
    manually_confirmed: ["人工確認費用", "Human-confirmed cost"],
  };
  return (
    <span className="badge">{names[value] ? t(...names[value]) : value}</span>
  );
}
async function write(access: CapabilityAccess, path: string, body: unknown) {
  const k = await operationKey(access.me.user.id, "provider:" + path, body);
  const r = await api(root + path, {
    method: "POST",
    headers: { "Idempotency-Key": k },
    body: JSON.stringify(body),
  });
  await completeOperation(access.me.user.id, "provider:" + path, body);
  return r;
}
export function ProviderReviewFacts({
  before,
  command,
}: {
  before: any;
  command: any;
}) {
  const { t } = useI18n();
  if (!before) return null;
  if (command.action === "ai.policy.publish")
    return (
      <>
        <p className="notice">
          {t(
            "此發佈只調整後續准入。現有任務預算、凍結價格與今日已建立的每日預算不會擴大。",
            "Publication changes future admission. Existing task budgets, frozen prices and already-created daily budgets retain their boundaries.",
          )}
        </p>
        <Mode value={before.scope.data_mode} />
        <div className="provider-comparison">
          <section>
            <h3>{t("目前策略", "Current policy")}</h3>
            <PolicyFacts
              definition={{
                limits: before.current.limits,
                budget: before.current.budget,
              }}
            />
          </section>
          <section>
            <h3>{t("擬發佈策略", "Proposed policy")}</h3>
            <PolicyFacts definition={before.definition} />
          </section>
        </div>
        {before.definition.count_contract && (
          <dl className="key-value">
            <dt>{t("計數協議來源", "Counting contract reference")}</dt>
            <dd>{before.definition.count_contract.reference}</dd>
            <dt>{t("條款", "Terms")}</dt>
            <dd className="provider-preserve">
              {before.definition.count_contract.terms}
            </dd>
            <dt>{t("生效時間", "Effective from")}</dt>
            <dd>
              <DateText value={before.definition.count_contract.effective_at} />
            </dd>
          </dl>
        )}
      </>
    );
  if (command.action === "ai.tasks.settle")
    return (
      <>
        <p className="notice">
          {t(
            "費用按已確認用量合計一次取整，計數費用由平台承擔。結算後業務狀態仍為失敗。",
            "Confirmed usage is aggregated and rounded once. Counting is platform-funded. Settlement retains a failed business outcome.",
          )}
        </p>
        <dl className="key-value">
          <dt>{t("工作", "Task")}</dt>
          <dd>
            <code>{before.task.id}</code>
          </dd>
          <dt>{t("原預留", "Original hold")}</dt>
          <dd>
            <Money value={before.reservation.amount_micros} />
          </dd>
          <dt>{t("擬結算費用", "Derived settlement")}</dt>
          <dd>
            <Money value={before.receipt.knownChargeMicros} />
          </dd>
          <dt>{t("已確認生成請求", "Confirmed generation requests")}</dt>
          <dd>{before.receipt.requests}</dd>
          <dt>{t("費用記錄摘要", "Cost record digest")}</dt>
          <dd>
            <code>{before.receipt_hash}</code>
          </dd>
        </dl>
        {before.violations.length > 0 && (
          <p className="notice">
            {t(
              "已明確確認的歷史預算違規",
              "Acknowledged historical budget violations",
            )}
            : {before.violations.map((v: any) => v.code).join(", ")}
          </p>
        )}
      </>
    );
  return (
    <>
      <p className="notice">
        {command.action === "ai.cost.reconcile"
          ? t(
              "確認費用會追加人工記錄。原始未知結果保留；不扣取用戶費用，也不釋放容量。",
              "Cost confirmation appends a human record. The original unknown outcome remains; it does not charge the customer or release capacity.",
            )
          : t(
              "只根據終止證據釋放共享容量；未知費用和預算承諾會繼續保留。",
              "Release shared capacity using termination evidence. Unknown cost and budget commitments remain.",
            )}
      </p>
      <dl className="key-value">
        <dt>{t("請求", "Request")}</dt>
        <dd>
          <code>{before.request.id}</code>
        </dd>
        <dt>{t("原始結果", "Original outcome")}</dt>
        <dd>
          <State value={before.request.state} />
        </dd>
        <dt>{t("證據來源", "Evidence source")}</dt>
        <dd>{before.evidence.document.source_reference}</dd>
        <dt>{t("供應商參考", "Provider reference")}</dt>
        <dd>{before.evidence.document.provider_reference}</dd>
        <dt>{t("來源說明", "Source statement")}</dt>
        <dd className="provider-preserve">
          {before.evidence.document.source_note}
        </dd>
        <dt>{t("用量", "Usage")}</dt>
        <dd>
          {Object.entries(before.evidence.document.usage).map(([k, v]) => (
            <span className="provider-unit" key={k}>
              {k}: {String(v)}
            </span>
          ))}
        </dd>
        <dt>{t("原始帳單金額", "Source invoice amount")}</dt>
        <dd>
          <Money value={before.evidence.document.billed_micros} />
        </dd>
        {before.cost && (
          <>
            <dt>{t("按凍結價格計算", "Calculated at frozen rates")}</dt>
            <dd>
              <Money value={before.cost.amount_micros} />
            </dd>
          </>
        )}
        <dt>{t("證據摘要", "Evidence digest")}</dt>
        <dd>
          <code>{before.evidence.document_hash}</code>
        </dd>
      </dl>
    </>
  );
}
function PolicyFacts({ definition }: { definition: any }) {
  const { t } = useI18n();
  return (
    <dl className="key-value provider-policy-facts">
      {limits.map((k) => (
        <span className="provider-fact" key={k}>
          <dt>{t(...labels[k])}</dt>
          <dd>{definition.limits[k]}</dd>
        </span>
      ))}
      {[
        "count_price_micros",
        "verification_run_micros",
        "verification_daily_micros",
        "counting_daily_micros",
      ].map((k) => (
        <span className="provider-fact" key={k}>
          <dt>{t(...labels[k])}</dt>
          <dd>
            <Money value={definition.budget[k]} />
          </dd>
        </span>
      ))}
      <dt>{t("計數協議確認", "Counting contract confirmed")}</dt>
      <dd>
        {definition.budget.count_verified ? t("是", "Yes") : t("否", "No")}
      </dd>
    </dl>
  );
}
function Command({
  command,
  access,
  onClose,
  onDone,
}: {
  command: any;
  access: CapabilityAccess;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    [preview, setPreview] = useState<any>(null),
    [operation, setOperation] = useState<any>(null);
  return (
    <Modal
      title={t("預覽與獨立審批", "Preview and independent review")}
      onClose={onClose}
    >
      {operation ? (
        <>
          <h3>
            {t(
              "已送交另一位管理員審批",
              "Submitted for another administrator's review",
            )}
          </h3>
          <p>
            <code>{operation.id}</code>
          </p>
          <p>
            {t(
              "尚未產生業務效果。請在審批面板查看此操作。",
              "The business change has not taken effect. Review this operation in the approvals panel.",
            )}
          </p>
          <Link
            className="button secondary"
            to={`/audit?view=approvals&search=${operation.id}`}
            onClick={() => {
              onDone();
              onClose();
            }}
          >
            {t("查看審批", "View approvals")}
          </Link>
        </>
      ) : preview ? (
        <>
          <ProviderReviewFacts before={preview.before} command={command} />
          <p>{command.reason}</p>
          <p className="muted">
            {t("預覽期限", "Preview expires")}:{" "}
            <DateText value={preview.expires_at} />
          </p>
          <AsyncForm
            submitLabel={t("送交獨立審批", "Submit for independent review")}
            onSubmit={async () => {
              setOperation(
                await write(access, "/operations", {
                  command,
                  preview_id: preview.preview_id,
                }),
              );
              onDone();
            }}
          >
            <button
              className="text-button"
              type="button"
              onClick={() => setPreview(null)}
            >
              {t("重新預覽", "Preview again")}
            </button>
          </AsyncForm>
        </>
      ) : (
        <>
          <p>
            {t(
              "系統會重新核對權限、範圍、原始資料和版本。預覽本身不產生業務效果。",
              "The server rechecks authority, scope, original facts and versions. Preview creates no business effect.",
            )}
          </p>
          <AsyncForm
            submitLabel={t("取得目前預覽", "Get current preview")}
            onSubmit={async () =>
              setPreview(await write(access, "/previews", command))
            }
          >
            <span className="muted">
              {t(
                "預覽將固定目前事實與操作原因。",
                "Preview freezes current facts and the reason for this operation.",
              )}
            </span>
          </AsyncForm>
        </>
      )}
    </Modal>
  );
}
function PolicyEditor({
  access,
  current,
  onClose,
  onDone,
}: {
  access: CapabilityAccess;
  current: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    [verified, setVerified] = useState(Boolean(current.budget.count_verified));
  return (
    <Modal title={t("新增策略草稿", "New policy draft")} onClose={onClose}>
      <AsyncForm
        submitLabel={t("儲存草稿", "Save draft")}
        onSubmit={async (f) => {
          const money = (k: string, zero = false) => {
            const v = Number(parseHKD(String(f.get(k)), zero));
            if (!Number.isSafeInteger(v))
              throw new Error(
                t("金額超出上限", "Amount exceeds the supported limit"),
              );
            return v;
          };
          const verified = f.get("verified") === "on",
            fee = money("count_price_micros", true);
          const definition = {
            limits: Object.fromEntries(
              limits.map((k) => [k, Number(f.get(k))]),
            ),
            budget: {
              count_verified: verified,
              count_price_micros: fee,
              verification_run_micros: money("verification_run_micros"),
              verification_daily_micros: money("verification_daily_micros"),
              counting_daily_micros: money("counting_daily_micros"),
            },
            count_contract: verified
              ? {
                  reference: String(f.get("reference")),
                  terms: String(f.get("terms")),
                  service: "responses.input_tokens",
                  fee_micros: fee,
                  effective_at: new Date(
                    String(f.get("effective_at")),
                  ).toISOString(),
                }
              : null,
          };
          await write(access, "/policies/drafts", {
            definition,
            reason: String(f.get("reason")),
          });
          onDone();
          onClose();
        }}
      >
        <div className="provider-form-grid">
          {limits.map((k) => (
            <Field key={k} label={t(...labels[k])}>
              <input
                name={k}
                type="number"
                step="1"
                min={k.startsWith("audio_") ? 0 : 1}
                max={
                  k === "preparation_seconds"
                    ? 300
                    : k.endsWith("rpm")
                      ? 100000
                      : 1000
                }
                defaultValue={current.limits[k] ?? (k.startsWith("audio_") ? 0 : undefined)}
                required
              />
            </Field>
          ))}
        </div>
        <h3>{t("平台費用邊界", "Platform cost boundaries")}</h3>
        <div className="provider-form-grid">
          {[
            "count_price_micros",
            "verification_run_micros",
            "verification_daily_micros",
            "counting_daily_micros",
          ].map((k) => (
            <Field key={k} label={t(...labels[k])}>
              <input
                name={k}
                inputMode="decimal"
                defaultValue={rateInput(Number(current.budget[k] ?? 0))}
                required
              />
            </Field>
          ))}
        </div>
        <Field
          label={t(
            "已核對輸入計數協議及價格",
            "Counting contract and fee have been checked",
          )}
        >
          <input
            name="verified"
            type="checkbox"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
          />
        </Field>
        <Field label={t("協議來源參考", "Contract source reference")}>
          <input name="reference" minLength={3} maxLength={300} required={verified} />
        </Field>
        <Field
          label={t(
            "協議條款與核對說明",
            "Contract terms and verification statement",
          )}
        >
          <textarea name="terms" minLength={10} maxLength={16000} rows={3} required={verified} />
        </Field>
        <Field label={t("協議生效時間", "Contract effective time")}>
          <input
            name="effective_at"
            type="datetime-local"
            step="1"
            required={verified}
          />
        </Field>
        <Field label={t("操作原因", "Reason")}>
          <textarea name="reason" minLength={3} maxLength={1000} required />
        </Field>
        <p className="muted">
          {t(
            "人工協議聲明不代表模型已通過真實服務資格驗證。",
            "A human contract declaration does not qualify a live model service.",
          )}
        </p>
      </AsyncForm>
    </Modal>
  );
}
function PolicyPanel({
  access,
  revision,
  onDone,
}: {
  access: CapabilityAccess;
  revision: number;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    [cursors, setCursors] = useState<string[]>([]),
    current = useData(root + "/policy", revision),
    history = useData(
      root +
        "/policies?limit=25" +
        (cursors.length
          ? "&cursor=" + encodeURIComponent(cursors.at(-1)!)
          : ""),
      revision,
    ),
    [editor, setEditor] = useState(false),
    [command, setCommand] = useState<any>(null);
  return (
    <>
      <ErrorNotice error={current.error ?? history.error} />
      {current.loading && <Loading />}
      {current.data && (
        <>
          <div className="provider-toolbar">
            <Mode value={current.data.data_mode} />
            <span>
              {t("已發佈修訂", "Published revision")} {current.data.revision}
            </span>
            {access.has("admin.ai.policy.draft") && (
              <button className="button" onClick={() => setEditor(true)}>
                {t("新增草稿", "New draft")}
              </button>
            )}
          </div>
          <section className="provider-card">
            <h2>{t("目前准入與預算", "Current admission and budgets")}</h2>
            <PolicyFacts
              definition={{
                limits: current.data.limits,
                budget: current.data.budget,
              }}
            />
            {current.data.periods.length > 0 && (
              <p className="notice">
                {t("今日既有邊界", "Today's established boundaries")}:{" "}
                {current.data.periods.map((p: any) => (
                  <span className="provider-unit" key={p.id}>
                    {p.purpose}: <Money value={p.amount_micros} />
                  </span>
                ))}
              </p>
            )}
          </section>
          <h2>{t("不可變策略版本", "Immutable policy versions")}</h2>
          <div className="provider-history">
            {history.data?.items.map((d: any) => (
              <section className="provider-card" key={d.id}>
                <div className="provider-toolbar">
                  <h3>v{d.version}</h3>
                  <span className="badge">
                    {d.publication_id
                      ? t("已發佈", "Published")
                      : t("草稿", "Draft")}
                  </span>
                </div>
                <p>{d.reason}</p>
                <DateText value={d.created_at} />
                <details>
                  <summary>{t("查看完整定義", "View full definition")}</summary>
                  <PolicyFacts definition={d.definition} />
                  {d.definition.count_contract && (
                    <p className="provider-preserve">
                      {d.definition.count_contract.terms}
                    </p>
                  )}
                </details>
                {!d.publication_id && access.has("admin.ai.policy.publish") && (
                  <button
                    className="button secondary"
                    onClick={() =>
                      setCommand({
                        action: "ai.policy.publish",
                        draft_id: d.id,
                        expected_revision: current.data.revision,
                        reason: d.reason,
                      })
                    }
                  >
                    {t("預覽發佈", "Preview publication")}
                  </button>
                )}
              </section>
            ))}
          </div>
          <div className="provider-pagination">
            <button
              className="button secondary"
              disabled={!cursors.length}
              onClick={() => setCursors((v) => v.slice(0, -1))}
            >
              {t("上一頁", "Previous")}
            </button>
            <span>
              {t("第", "Page")} {cursors.length + 1}
            </span>
            <button
              className="button secondary"
              disabled={!history.data?.next_cursor}
              onClick={() =>
                setCursors((v) => [...v, history.data.next_cursor])
              }
            >
              {t("下一頁", "Next")}
            </button>
          </div>
        </>
      )}
      {editor && (
        <PolicyEditor
          access={access}
          current={current.data}
          onClose={() => setEditor(false)}
          onDone={onDone}
        />
      )}{" "}
      {command && (
        <Command
          command={command}
          access={access}
          onClose={() => setCommand(null)}
          onDone={onDone}
        />
      )}
    </>
  );
}
function EvidenceForm({
  access,
  r,
  onDone,
}: {
  access: CapabilityAccess;
  r: any;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    kind = r.channel === "input_count" ? "input_count" : r.request_class;
  return (
    <details>
      <summary>
        {t(
          "登記供應商用量或終止證據",
          "Register provider usage or termination evidence",
        )}
      </summary>
      <p className="muted">
        {t(
          "這是人工提交的來源聲明，將綁定此請求；另一位管理員必須獨立核對。",
          "This human source statement is bound to this request and requires independent verification by another administrator.",
        )}
      </p>
      <AsyncForm
        submitLabel={t("登記不可變證據", "Register immutable evidence")}
        onSubmit={async (f) => {
          const unit = (k: string) => {
            const n = Number(f.get(k));
            if (!Number.isSafeInteger(n) || n < 0)
              throw new Error(t("請輸入有效用量", "Enter valid usage"));
            return n;
          };
          const usage =
            kind === "text"
              ? {
                  kind,
                  input_tokens: unit("input"),
                  output_tokens: unit("output"),
                }
              : kind === "image"
                ? { kind, image_units: unit("images") }
                : {
                    kind,
                    counted_input_tokens:
                      String(f.get("counted")).trim() === ""
                        ? null
                        : unit("counted"),
                  };
          const document = {
            schema_version: 1,
            data_mode: r.data_mode,
            operation_id: r.operation_id,
            request_hash: r.request_hash,
            provider_reference: String(f.get("provider_reference")),
            source_reference: String(f.get("source_reference")),
            source_note: String(f.get("source_note")),
            observed_at: new Date(String(f.get("observed_at"))).toISOString(),
            terminated: true,
            outcome: String(f.get("outcome")),
            currency: "HKD",
            billed_micros: parseHKD(String(f.get("invoice")), true),
            usage,
          };
          await write(access, `/requests/${r.channel}/${r.id}/evidence`, {
            document,
            reason: String(f.get("reason")),
          });
          onDone();
        }}
      >
        <div className="provider-form-grid">
          <Field label={t("供應商參考", "Provider reference")}>
            <input
              name="provider_reference"
              minLength={3}
              maxLength={300}
              required
            />
          </Field>
          <Field label={t("來源文件參考", "Source document reference")}>
            <input
              name="source_reference"
              minLength={3}
              maxLength={500}
              required
            />
          </Field>
        </div>
        <Field label={t("可供核對的來源說明", "Inspectable source statement")}>
          <textarea
            name="source_note"
            minLength={10}
            maxLength={8000}
            rows={3}
            required
          />
        </Field>
        <div className="provider-form-grid">
          <Field label={t("來源記錄時間", "Source observation time")}>
            <input name="observed_at" type="datetime-local" step="1" required />
          </Field>
          <Field label={t("已終止結果", "Terminated outcome")}>
            <select name="outcome">
              <option value="completed">{t("已完成", "Completed")}</option>
              <option value="failed">{t("已失敗", "Failed")}</option>
              <option value="cancelled">{t("已取消", "Cancelled")}</option>
              <option value="not_executed">
                {t("未執行", "Not executed")}
              </option>
            </select>
          </Field>
          {kind === "text" ? (
            <>
              <Field label={t("實際輸入 tokens", "Actual input tokens")}>
                <input name="input" type="number" min="0" step="1" required />
              </Field>
              <Field label={t("實際輸出 tokens", "Actual output tokens")}>
                <input name="output" type="number" min="0" step="1" required />
              </Field>
            </>
          ) : kind === "image" ? (
            <Field label={t("實際圖片張數", "Actual image units")}>
              <input
                name="images"
                type="number"
                min="0"
                max="1"
                step="1"
                required
              />
            </Field>
          ) : (
            <Field
              label={t(
                "計數結果（未知留空）",
                "Count result (leave blank if unknown)",
              )}
            >
              <input name="counted" type="number" min="0" step="1" />
            </Field>
          )}
          <Field
            label={t("來源帳單金額（HKD）", "Source invoice amount (HKD)")}
          >
            <input name="invoice" inputMode="decimal" required />
          </Field>
        </div>
        <Field label={t("操作原因", "Reason")}>
          <textarea name="reason" minLength={3} maxLength={1000} required />
        </Field>
      </AsyncForm>
    </details>
  );
}
function RequestDetail({
  access,
  selected,
  onClose,
  onDone,
}: {
  access: CapabilityAccess;
  selected: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    [revision, setRevision] = useState(0),
    data = useData(
      `${root}/requests/${selected.channel}/${selected.id}`,
      revision,
    ),
    [command, setCommand] = useState<any>(null),
    [proof, setProof] = useState<any>(null),
    [sourceError, setSourceError] = useState<unknown>(null),
    r = data.data;
  const refresh = () => {
    setRevision((v) => v + 1);
    onDone();
  };
  return (
    <>
      {!command && !proof && (
        <Modal
          title={t("逐次調用與核對", "Provider request and reconciliation")}
          onClose={onClose}
        >
          <ErrorNotice error={data.error} />
          <ErrorNotice error={sourceError} />
          {data.loading && <Loading />}
          {r && (
            <>
              <div className="provider-toolbar">
                <Mode value={r.data_mode} />
                <State value={r.state} />
              </div>
              <dl className="key-value">
                <dt>{t("請求", "Request")}</dt>
                <dd>
                  <code>{r.id}</code>
                </dd>
                <dt>{t("企業／項目", "Workspace / project")}</dt>
                <dd>
                  <code>
                    {r.tenant_id ?? t("平台驗證", "Platform verification")}
                  </code>
                  <small>
                    <code>{r.project_id}</code>
                  </small>
                </dd>
                <dt>{t("原用戶", "Original actor")}</dt>
                <dd>
                  <code>{r.actor_id}</code>
                </dd>
                <dt>{t("服務／模型", "Service / model")}</dt>
                <dd>
                  {r.operation} · {r.model_alias}
                </dd>
                <dt>{t("發送時間", "Dispatched at")}</dt>
                <dd>
                  <DateText value={r.dispatched_at} />
                </dd>
                <dt>{t("原始請求摘要", "Original request digest")}</dt>
                <dd>
                  <code>{r.request_hash}</code>
                </dd>
              </dl>
              <div className="provider-comparison provider-accounting">
                <section>
                  <h3>{t("費用事實", "Cost facts")}</h3>
                  {r.cost ? (
                    <>
                      <State value={r.cost.state} />
                      <p className="provider-amount">
                        <Money value={r.cost.amount_micros} />
                      </p>
                      <p className="muted">
                        {r.cost.source === "human_evidence"
                          ? t("人工來源確認", "Confirmed human evidence")
                          : r.cost.source === "gateway_observation"
                            ? t("網關實際觀測", "Observed gateway response")
                            : t("費用待核對", "Cost awaits reconciliation")}
                      </p>
                      <p>
                        {t("輸入／輸出 tokens", "Input / output tokens")}:{" "}
                        {r.cost.input_tokens ?? "—"} /{" "}
                        {r.cost.output_tokens ?? "—"}
                      </p>
                    </>
                  ) : (
                    <p>
                      {t(
                        "需要內部費用權限",
                        "Internal cost permission required",
                      )}
                    </p>
                  )}
                </section>
                <section>
                  <h3>{t("共享容量", "Shared capacity")}</h3>
                  <span className="badge">
                    {r.capacity_held
                      ? t("仍佔用容量", "Capacity held")
                      : t("容量已釋放", "Capacity released")}
                  </span>
                  <p className="muted">
                    {t(
                      "容量釋放與費用確認分別審批。",
                      "Capacity release and cost confirmation are reviewed separately.",
                    )}
                  </p>
                </section>
              </div>
              {r.cost && (
                <>
                  <h3>
                    {t("核對記錄與來源", "Confirmation records and evidence")}
                  </h3>
                  {r.evidence?.length === 0 && (
                    <p className="muted">
                      {t("尚未登記證據。", "No evidence registered yet.")}
                    </p>
                  )}
                  {r.evidence?.map((e: any) => (
                    <section className="provider-evidence" key={e.id}>
                      <p>{e.reason}</p>
                      <code>{e.document_hash}</code>
                      <div className="provider-toolbar">
                        <button
                          className="text-button"
                          onClick={async () => {
                            setSourceError(null);
                            try {
                              setProof(await api(`${root}/evidence/${e.id}`));
                            } catch (error) {
                              setSourceError(error);
                            }
                          }}
                        >
                          {t("檢查來源", "Inspect source")}
                        </button>
                        {r.state === "unknown" &&
                          access.has("admin.ai.cost.reconcile") &&
                          r.cost.state === "unknown" && (
                            <button
                              className="button secondary"
                              onClick={() =>
                                setCommand({
                                  action: "ai.cost.reconcile",
                                  channel: r.channel,
                                  request_id: r.id,
                                  evidence_id: e.id,
                                  reason: e.reason,
                                })
                              }
                            >
                              {t("預覽確認費用", "Preview cost confirmation")}
                            </button>
                          )}
                        {r.state === "unknown" &&
                          r.capacity_held &&
                          access.has("admin.ai.capacity.release") && (
                            <button
                              className="button secondary"
                              onClick={() =>
                                setCommand({
                                  action: "ai.capacity.release",
                                  channel: r.channel,
                                  request_id: r.id,
                                  evidence_id: e.id,
                                  reason: e.reason,
                                })
                              }
                            >
                              {t("預覽釋放容量", "Preview capacity release")}
                            </button>
                          )}
                      </div>
                    </section>
                  ))}
                  {r.state === "unknown" &&
                    access.has("admin.ai.evidence.write") && (
                      <EvidenceForm access={access} r={r} onDone={refresh} />
                    )}
                </>
              )}
              {r.task_id && r.cost && access.has("admin.ai.tasks.settle") && (
                <details>
                  <summary>
                    {t("結算原任務費用", "Settle original task costs")}
                  </summary>
                  <AsyncForm
                    submitLabel={t(
                      "核對工作與預覽結算",
                      "Check task and preview settlement",
                    )}
                    onSubmit={async (f) => {
                      const facts = await api(
                        `${root}/tasks/${r.task_id}/settlement`,
                      );
                      if (
                        facts.violations.length &&
                        f.get("acknowledge") !== "on"
                      )
                        throw new Error(
                          t(
                            "必須明確確認歷史預算違規",
                            "Explicitly acknowledge the historical budget violations",
                          ),
                        );
                      setCommand({
                        action: "ai.tasks.settle",
                        task_id: r.task_id,
                        expected_task_version: facts.task.version,
                        acknowledge_violation_ids: facts.violations.map(
                          (v: any) => v.id,
                        ),
                        reason: String(f.get("reason")),
                      });
                    }}
                  >
                    <Field label={t("結算原因", "Settlement reason")}>
                      <textarea
                        name="reason"
                        required
                        minLength={3}
                        maxLength={1000}
                      />
                    </Field>
                    <Field
                      label={t(
                        "確認歷史預算違規（如有）",
                        "Acknowledge historical budget violations, if any",
                      )}
                    >
                      <input name="acknowledge" type="checkbox" />
                    </Field>
                  </AsyncForm>
                </details>
              )}
            </>
          )}
        </Modal>
      )}
      {command && (
        <Command
          command={command}
          access={access}
          onClose={() => setCommand(null)}
          onDone={refresh}
        />
      )}{" "}
      {proof && (
        <Modal
          title={t("人工提交的來源聲明", "Human-submitted source statement")}
          onClose={() => setProof(null)}
        >
          <p>{proof.document.source_note}</p>
          <p>
            <code>{proof.document_hash}</code>
          </p>
          <pre className="provider-proof">
            {JSON.stringify(proof.document, null, 2)}
          </pre>
          <button
            className="button secondary"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([proof.canonical_document], {
                  type: "application/json",
                }),
              );
              const el = document.createElement("a");
              el.href = url;
              el.download = `provider-evidence-${proof.id}.json`;
              el.click();
              URL.revokeObjectURL(url);
            }}
          >
            {t("下載來源記錄", "Download source record")}
          </button>
        </Modal>
      )}
    </>
  );
}
function Requests({
  access,
  revision,
  onDone,
}: {
  access: CapabilityAccess;
  revision: number;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    [filters, setFilters] = useState<Record<string, string>>({}),
    [cursors, setCursors] = useState<string[]>([]),
    [selected, setSelected] = useState<any>(null);
  const q = new URLSearchParams({
      ...filters,
      limit: "25",
      ...(cursors.length ? { cursor: cursors.at(-1)! } : {}),
    }),
    result = useData(root + "/requests?" + q, revision);
  const select = (key: string, value: string) => {
    setFilters((f) => {
      const n = { ...f };
      if (value) n[key] = value;
      else delete n[key];
      return n;
    });
    setCursors([]);
  };
  return (
    <>
      <form
        className="provider-card provider-filters"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            next: Record<string, string> = {};
          for (const [k, v] of f.entries()) if (String(v)) next[k] = String(v);
          setFilters(next);
          setCursors([]);
        }}
      >
        <div className="provider-form-grid">
          <Field label={t("結果", "Outcome")}>
            <select
              name="state"
              value={filters.state ?? ""}
              onChange={(e) => select("state", e.target.value)}
            >
              <option value="">{t("全部結果", "All outcomes")}</option>
              {[
                "prepared",
                "dispatched",
                "completed",
                "unknown",
                "cancelled",
                "denied",
              ].map((s) => (
                <option key={s} value={s}>
                  {
                    {
                      unknown: t("結果未知", "Unknown"),
                      prepared: t("準備中", "Prepared"),
                      dispatched: t("已發送", "Dispatched"),
                      completed: t("已完成", "Completed"),
                      cancelled: t("已取消", "Cancelled"),
                      denied: t("已拒絕", "Denied"),
                    }[s]
                  }
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("主體", "Subject")}>
            <select
              name="subject_kind"
              value={filters.subject_kind ?? ""}
              onChange={(e) => select("subject_kind", e.target.value)}
            >
              <option value="">{t("全部主體", "All subjects")}</option>
              <option value="task">{t("客戶工作", "Customer task")}</option>
              <option value="validation">
                {t("平台驗證", "Platform verification")}
              </option>
            </select>
          </Field>
          <Field label={t("共享容量", "Shared capacity")}>
            <select
              name="capacity_state"
              value={filters.capacity_state ?? ""}
              onChange={(e) => select("capacity_state", e.target.value)}
            >
              <option value="">
                {t("全部容量狀態", "All capacity states")}
              </option>
              <option value="held">{t("仍佔用", "Held")}</option>
              <option value="released">{t("已釋放", "Released")}</option>
            </select>
          </Field>
        </div>
        <details>
          <summary>
            {t("範圍、服務與時間篩選", "Scope, service and time filters")}
          </summary>
          <div className="provider-form-grid">
            {[
              ["tenant_id", t("企業 ID", "Workspace ID")],
              ["project_id", t("項目 ID", "Project ID")],
              ["actor_id", t("原用戶 ID", "Original actor ID")],
              ["task_id", t("工作 ID", "Task ID")],
              ["validation_id", t("驗證 ID", "Validation ID")],
              [
                "capability_version_id",
                t("能力版本 ID", "Capability version ID"),
              ],
              ["release_id", t("能力發佈 ID", "Capability release ID")],
            ].map(([k, label]) => (
              <Field label={label} key={k}>
                <input name={k} defaultValue={filters[k] ?? ""} />
              </Field>
            ))}
            <Field label={t("服務", "Service")}>
              <select name="operation" defaultValue={filters.operation ?? ""}>
                <option value="">{t("全部服務", "All services")}</option>
                {[
                  "responses",
                  "responses.input_tokens",
                  "images.generate",
                  "images.edit",
                ].map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("費用狀態", "Cost state")}>
              <select name="cost_state" defaultValue={filters.cost_state ?? ""}>
                <option value="">{t("全部費用狀態", "All cost states")}</option>
                <option value="known">
                  {t("觀測費用已知", "Observed cost known")}
                </option>
                <option value="unknown">{t("費用未知", "Cost unknown")}</option>
                <option value="manually_confirmed">
                  {t("人工確認", "Human confirmed")}
                </option>
              </select>
            </Field>
            <Field label={t("開始時間（含時區）", "From (with timezone)")}>
              <input
                name="period_from"
                placeholder="2026-10-21T00:00:00+08:00"
                defaultValue={filters.period_from}
              />
            </Field>
            <Field label={t("結束時間（含時區）", "Until (with timezone)")}>
              <input
                name="period_to"
                placeholder="2026-10-22T00:00:00+08:00"
                defaultValue={filters.period_to}
              />
            </Field>
          </div>
          <button className="button secondary" type="submit">
            {t("套用篩選", "Apply filters")}
          </button>
        </details>
      </form>
      <ErrorNotice error={result.error} />
      {result.loading && <Loading />}
      {result.data && (
        <>
          <div className="table-scroll provider-table">
            <table>
              <thead>
                <tr>
                  {[
                    t("請求／時間", "Request / time"),
                    t("服務／歸屬", "Service / attribution"),
                    t("原始結果", "Original outcome"),
                    t("費用", "Cost"),
                    t("容量", "Capacity"),
                    t("核對", "Review"),
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((r: any) => (
                  <tr key={r.channel + r.id}>
                    <td>
                      <code>{r.id}</code>
                      <small>
                        <DateText value={r.created_at} />
                      </small>
                    </td>
                    <td>
                      {r.operation}
                      <small>
                        {r.subject_kind === "validation"
                          ? t("平台驗證", "Platform verification")
                          : r.tenant_id}
                      </small>
                    </td>
                    <td>
                      <State value={r.state} />
                      <small>
                        <Mode value={r.data_mode} />
                      </small>
                    </td>
                    <td>
                      {r.cost ? (
                        <>
                          <Money value={r.cost.amount_micros} />
                          <small>
                            <State value={r.cost.state} />
                          </small>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {r.capacity_held
                        ? t("仍佔用", "Held")
                        : t("已釋放", "Released")}
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => setSelected(r)}
                      >
                        {t("查看請求", "View request")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.data.items.length === 0 && (
              <p className="provider-empty">
                {t(
                  "目前範圍與篩選下沒有調用記錄。",
                  "No requests match your current scope and filters.",
                )}
              </p>
            )}
          </div>
          <div className="provider-pagination">
            <button
              className="button secondary"
              disabled={!cursors.length}
              onClick={() => setCursors((v) => v.slice(0, -1))}
            >
              <ChevronLeft size={16} />
              {t("上一頁", "Previous")}
            </button>
            <span>
              {t("第", "Page")} {cursors.length + 1}
            </span>
            <button
              className="button secondary"
              disabled={!result.data.next_cursor}
              onClick={() => setCursors((v) => [...v, result.data.next_cursor])}
            >
              {t("下一頁", "Next")}
              <ChevronRight size={16} />
            </button>
          </div>
        </>
      )}
      {selected && (
        <RequestDetail
          access={access}
          selected={selected}
          onClose={() => setSelected(null)}
          onDone={onDone}
        />
      )}
    </>
  );
}
function GeneratedVideoRequests({ access, revision, onDone }: { access: CapabilityAccess; revision: number; onDone: () => void }) {
  const { t } = useI18n();
  const [filters, setFilters] = useState<Record<string, string>>({}), [cursors, setCursors] = useState<string[]>([]);
  const [recheck, setRecheck] = useState<any>(null), [command, setCommand] = useState<any>(null);
  const query = new URLSearchParams({ ...filters, limit: "20", ...(cursors.length ? { cursor: cursors.at(-1)! } : {}) });
  const result = useData(root + "/video-jobs?" + query, revision);
  return <>
    <form className="provider-card" onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget), next: Record<string, string> = {};
      for (const name of ["tenant_id", "project_id", "task_id"]) if (String(data.get(name) ?? "").trim()) next[name] = String(data.get(name)).trim();
      setFilters(next); setCursors([]);
    }}>
      <div className="provider-form-grid">
        {[["tenant_id", t("企業 ID", "Workspace ID")], ["project_id", t("項目 ID", "Project ID")], ["task_id", t("工作 ID", "Task ID")]].map(([name, label]) =>
          <Field key={name} label={label}><input name={name} defaultValue={filters[name] ?? ""} pattern="[a-fA-F0-9-]{36}" /></Field>)}
      </div>
      <button type="submit" className="button secondary">{t("篩選影片作業", "Filter video jobs")}</button>
    </form>
    <ErrorNotice error={result.error} />{result.loading && <Loading />}
    {result.data && <>
      {!result.data.items.length && <p className="provider-card muted">{t("此授權範圍沒有影片作業。", "No video jobs in this authorized scope.")}</p>}
      <div className="provider-history">
        {result.data.items.map((job: any) => <article className="provider-card" key={job.id} data-generated-video-job={job.id}>
          <div className="provider-toolbar"><Mode value={job.data_mode} /><State value={job.state} /><State value={job.delivery_state} /></div>
          <h3>{t("生成式影片", "Generated video")}</h3>
          <dl className="key-value">
            <dt>{t("作業", "Job")}</dt><dd><code>{job.id}</code></dd>
            <dt>{t("原工作", "Original task")}</dt><dd><code>{job.task_id}</code></dd>
            <dt>{t("企業／項目", "Workspace / project")}</dt><dd><code>{job.tenant_id}<br />{job.project_id}</code></dd>
            <dt>{t("原用戶", "Original user")}</dt><dd><code>{job.actor_id}</code></dd>
            <dt>{t("服務／能力版本", "Service / capability")}</dt><dd>{job.model_alias}<br /><code>{job.capability_version_id}</code></dd>
            <dt>{t("服務回報進度", "Reported progress")}</dt><dd>{job.progress === null ? t("尚未回報", "Not yet reported") : job.progress + "%"}</dd>
            <dt>{t("最近觀測", "Last observation")}</dt><dd>{job.observed_at ? <DateText value={job.observed_at} /> : "—"}</dd>
          </dl>
          {job.cost && <section className="provider-video-cost">
            <dl className="key-value"><dt>{t("原估算上限", "Original quote")}</dt><dd><Money value={job.cost.quoted_micros} /></dd>
              <dt>{t("已確認費用", "Confirmed cost")}</dt><dd>{job.cost.actual_micros === null ? t("待服務確認", "Awaiting service confirmation") : <Money value={job.cost.actual_micros} />}</dd>
              <dt>{t("計費秒數", "Billable seconds")}</dt><dd>{job.cost.billable_seconds ?? "—"}</dd></dl>
            {job.cost.budget_violation && <p className="notice">{t("實際費用超過原估算，交付已停止。結算需獨立核對預算違規。", "Actual cost exceeds the quote. Delivery is stopped and settlement requires independent review of the budget violation.")}</p>}
          </section>}
          {(job.error_code || job.delivery_error) && <p className="muted"><code>{job.error_code ?? job.delivery_error}</code></p>}
          {access.has("admin.ai.cost.reconcile") && <button className="button secondary" onClick={() => setRecheck(job)}>{t("重新核對原作業", "Recheck original job")}</button>}
          {job.cost && access.has("admin.ai.tasks.settle") && <details><summary>{t("結算原任務費用", "Settle original task costs")}</summary>
            <AsyncForm submitLabel={t("預覽結算", "Preview settlement")} onSubmit={async form => {
              const facts = await api(`${root}/tasks/${job.task_id}/settlement`);
              if (facts.violations.length && form.get("acknowledge") !== "on") throw new Error(t("請明確確認歷史預算違規。", "Explicitly acknowledge the historical budget violations."));
              setCommand({ action: "ai.tasks.settle", task_id: job.task_id, expected_task_version: facts.task.version,
                acknowledge_violation_ids: facts.violations.map((value: any) => value.id), reason: String(form.get("reason")) });
            }}><Field label={t("結算原因", "Settlement reason")}><textarea name="reason" minLength={3} maxLength={1000} required /></Field>
              <label className="checkbox"><input type="checkbox" name="acknowledge" />{t("明確確認此工作的歷史預算違規（如有）", "Acknowledge this task's historical budget violations, if any")}</label>
            </AsyncForm></details>}
        </article>)}
      </div>
      <div className="provider-pagination"><button className="button secondary" disabled={!cursors.length} onClick={() => setCursors(values => values.slice(0, -1))}><ChevronLeft size={16} />{t("上一頁", "Previous")}</button>
        <button className="button secondary" disabled={!result.data.next_cursor} onClick={() => setCursors(values => [...values, result.data.next_cursor])}>{t("下一頁", "Next")}<ChevronRight size={16} /></button></div>
    </>}
    {recheck && <Modal title={t("重新核對原作業", "Recheck original job")} onClose={() => setRecheck(null)}>
      <p className="muted">{t("查詢同一作業的最新狀態。費用未知時會保留原預留。", "Query the latest state of the same operation. Its original hold remains while cost is unknown.")}</p>
      <AsyncForm submitLabel={t("要求重新核對", "Request recheck")} onSubmit={async form => {
        await write(access, `/video-jobs/${recheck.id}/recheck`, { expected_revision: recheck.revision, reason: String(form.get("reason")) });
        setRecheck(null); onDone();
      }}><Field label={t("核對原因", "Reason for recheck")}><textarea name="reason" minLength={3} maxLength={1000} required /></Field></AsyncForm>
    </Modal>}
    {command && <Command command={command} access={access} onClose={() => setCommand(null)} onDone={() => { setCommand(null); onDone(); }} />}
  </>;
}

function AudioRequests({ access, revision, onDone }: { access: CapabilityAccess; revision: number; onDone: () => void }) {
  const { t } = useI18n(), [filters, setFilters] = useState<Record<string, string>>({}), [cursors, setCursors] = useState<string[]>([]);
  const [command, setCommand] = useState<any>(null);
  const [content, setContent] = useState<any>(null), [contentError, setContentError] = useState<unknown>(null);
  const query = new URLSearchParams({ ...filters, limit: "20", ...(cursors.length ? { cursor: cursors.at(-1)! } : {}) });
  const result = useData(root + "/audio-jobs?" + query, revision);
  return <>
    <form className="provider-card" onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget), next: Record<string, string> = {};
      for (const name of ["tenant_id", "project_id", "task_id"]) if (String(data.get(name) ?? "").trim()) next[name] = String(data.get(name)).trim();
      setFilters(next); setCursors([]);
    }}><div className="provider-form-grid">
      {[["tenant_id", t("企業 ID", "Workspace ID")], ["project_id", t("項目 ID", "Project ID")], ["task_id", t("工作 ID", "Task ID")]].map(([name, label]) =>
        <Field key={name} label={label}><input name={name} defaultValue={filters[name] ?? ""} pattern="[a-fA-F0-9-]{36}" /></Field>)}
    </div><button className="button secondary">{t("篩選音訊作業", "Filter audio jobs")}</button></form>
    <ErrorNotice error={result.error ?? contentError} />{result.loading && <Loading />}
    {result.data && <>
      {!result.data.items.length && <p className="provider-card muted">{t("此授權範圍沒有音訊作業。", "No audio jobs in this authorized scope.")}</p>}
      <div className="provider-history">{result.data.items.map((job: any) => <article className="provider-card" key={job.id} data-audio-job={job.id}>
        <div className="provider-toolbar"><Mode value={job.data_mode} /><State value={job.state} /><State value={job.delivery_state} /></div>
        <h3>{job.kind === "speech" ? t("AI 配音", "AI speech") : t("轉寫與字幕", "Transcription and subtitles")}</h3>
        <dl className="key-value">
          <dt>{t("作業", "Job")}</dt><dd><code>{job.id}</code></dd>
          <dt>{t("原工作", "Original task")}</dt><dd><code>{job.task_id}</code></dd>
          <dt>{t("企業／項目", "Workspace / project")}</dt><dd><code>{job.tenant_id}<br />{job.project_id}</code></dd>
          <dt>{t("原用戶", "Original user")}</dt><dd><code>{job.actor_id}</code></dd>
          <dt>{t("服務／能力版本", "Service / capability")}</dt><dd>{job.model_alias}<br /><code>{job.capability_version_id}</code></dd>
          <dt>{t("原操作識別", "Original operation")}</dt><dd><code>{job.operation_id}</code></dd>
          <dt>{t("字幕版本", "Transcript version")}</dt><dd>{job.subtitle_revision ? `v${job.subtitle_revision}` : "—"}</dd>
          <dt>{t("建立時間", "Created")}</dt><dd><DateText value={job.created_at} /></dd>
        </dl>
        {job.cost && <section className="provider-video-cost"><dl className="key-value">
          <dt>{t("公司收費上限", "Company tariff limit")}</dt><dd><Money value={job.cost.quoted_micros} /></dd>
          <dt>{t("已確認公司費用", "Confirmed company charge")}</dt><dd>{job.cost.actual_micros === null ? t("待確認；保留原預留", "Unconfirmed; original hold retained") : <Money value={job.cost.actual_micros} />}</dd>
          <dt>{t("已確認計費量", "Confirmed billable units")}</dt><dd>{job.cost.billable_units ?? "—"} · {job.cost.pricing_unit === "unicode_scalar" ? t("字元", "characters") : t("音訊毫秒", "audio milliseconds")}</dd>
          <dt>{t("供應商成本", "Supplier cost")}</dt><dd>{t("未獨立確認", "Not independently confirmed")}</dd>
        </dl></section>}
        {!job.usage_known && <p className="notice">{t("原請求結果尚待核對，保留費用與容量，不自動重新提交或按零結算。", "The original request remains unconfirmed. Cost and capacity holds remain; no automatic resubmission or zero settlement.")}</p>}
        {job.error_code && <p className="muted"><code>{job.error_code}</code></p>}
        <p className="muted">{t("文字、授權聲明與原音訊由獨立的內容權限管理；此處只展示作業記錄。", "Text, rights attestations and source audio use separate content permissions. This view shows operation records.")}</p>
        {access.has("admin.content.body.read") && <button className="button secondary" onClick={() => {
          setContentError(null); void api(`${root}/audio-jobs/${job.id}/content`).then(setContent).catch(setContentError);
        }}>{t("讀取原始要求與授權", "Read original request and rights")}</button>}
        {job.cost && job.usage_known && access.has("admin.ai.tasks.settle") && <details><summary>{t("結算原任務費用", "Settle original task costs")}</summary>
          <AsyncForm submitLabel={t("預覽結算", "Preview settlement")} onSubmit={async form => {
            const facts = await api(`${root}/tasks/${job.task_id}/settlement`);
            if (facts.violations.length && form.get("acknowledge") !== "on") throw new Error(t("請明確確認歷史預算違規。", "Explicitly acknowledge the historical budget violations."));
            setCommand({ action: "ai.tasks.settle", task_id: job.task_id, expected_task_version: facts.task.version,
              acknowledge_violation_ids: facts.violations.map((value: any) => value.id), reason: String(form.get("reason")) });
          }}><Field label={t("結算原因", "Settlement reason")}><textarea name="reason" minLength={3} maxLength={1000} required /></Field>
            <label className="checkbox"><input type="checkbox" name="acknowledge" />{t("確認歷史預算違規（如有）", "Acknowledge historical budget violations, if any")}</label>
          </AsyncForm></details>}
      </article>)}</div>
      <div className="provider-pagination"><button className="button secondary" disabled={!cursors.length} onClick={() => setCursors(values => values.slice(0, -1))}><ChevronLeft size={16} />{t("上一頁", "Previous")}</button>
        <button className="button secondary" disabled={!result.data.next_cursor} onClick={() => setCursors(values => [...values, result.data.next_cursor])}>{t("下一頁", "Next")}<ChevronRight size={16} /></button></div>
    </>}
    {command && <Command command={command} access={access} onClose={() => setCommand(null)} onDone={() => { setCommand(null); onDone(); }} />}
    {content && <Modal title={t("原始要求與授權", "Original request and rights")} onClose={() => setContent(null)}>
      <p className="muted">{t("此次敏感讀取已記錄審計。原始要求不可覆寫；新要求需建立獨立工作。", "This sensitive read is audited. The original request is immutable; a new request requires a separate task.")}</p>
      <pre className="provider-audio-body">{JSON.stringify(content, null, 2)}</pre>
    </Modal>}
  </>;
}

export function AdminProviderControl({ access }: { access: CapabilityAccess }) {
  const { t } = useI18n(),
    [view, setView] = useState(
      access.has("admin.ai.requests.read") ? "requests" : "policies",
    ),
    [revision, setRevision] = useState(0),
    refresh = () => setRevision((v) => v + 1);
  return (
    <div className="provider-control">
      <PageHeader
        eyebrow="COPYPASTE · SERVICE CONTROL"
        title={t("調用管理", "Provider controls")}
        description={t(
          "查看逐次請求、控制費用邊界，按來源證據獨立核對。",
          "Inspect individual requests, control cost boundaries and reconcile source evidence independently.",
        )}
        action={
          <button className="button secondary" onClick={refresh}>
            <RefreshCw size={16} />
            {t("重新整理", "Refresh")}
          </button>
        }
      />
      <nav
        className="provider-tabs"
        aria-label={t("調用管理頁籤", "Provider control tabs")}
      >
        {[
          [
            "requests",
            "admin.ai.requests.read",
            t("逐次請求與核對", "Requests & reconciliation"),
          ],
          [
            "videos",
            "admin.ai.requests.read",
            t("生成式影片作業", "Generated video jobs"),
          ],
          [
            "audio",
            "admin.ai.requests.read",
            t("配音與轉寫作業", "Speech & transcription jobs"),
          ],
          [
            "policies",
            "admin.ai.policy.read",
            t("策略版本", "Policy versions"),
          ],
        ]
          .filter(([, p]) => access.has(p))
          .map(([id, , label]) => (
            <button
              key={id}
              aria-current={view === id ? "page" : undefined}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
      </nav>
      {view === "policies" ? (
        <PolicyPanel access={access} revision={revision} onDone={refresh} />
      ) : view === "videos" ? (
        <GeneratedVideoRequests access={access} revision={revision} onDone={refresh} />
      ) : view === "audio" ? (
        <AudioRequests access={access} revision={revision} onDone={refresh} />
      ) : (
        <Requests access={access} revision={revision} onDone={refresh} />
      )}
      <p className="provider-footnote">
        <ShieldCheck size={15} />
        {t(
          "費用與策略變更需精確授權、近期 MFA、獨立審批和審計；狀態復查同樣受授權、MFA 與審計保護。",
          "Cost and policy changes require scoped authority, recent MFA, independent approval and audit. Status rechecks require scoped authority, recent MFA and audit.",
        )}
      </p>
    </div>
  );
}
