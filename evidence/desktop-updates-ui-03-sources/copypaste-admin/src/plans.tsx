import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { api, ApiError } from "./api";
import { operationKey, completeOperation } from "./operation-key";
import { formatHKD, parseHKD } from "./financial-money";
import {
  AsyncForm,
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

type Allowances = {
  feature_ids: string[];
  allowed_role_ids: string[];
  seat_limit: number;
  task_concurrency: number;
  storage_bytes: number;
  included_credit: { currency: "HKD"; amount_micros: string };
  credit_policy: "no_automatic_credit" | "separate_idempotent_grant";
};
export type PlanVersion = {
  id: string;
  plan_id: string;
  version: number;
  name: string;
  allowances: Allowances;
  state: "draft" | "published" | "retired";
};
type Access = {
  me: { user: { id: string } };
  has: (permission: string) => boolean;
};
type Comparison = { previous: PlanVersion | null; proposed: PlanVersion };
const root = "/v1/admin/plans";
const featureNames: Record<string, [string, string]> = {
  text: ["文字與開發", "Text & development"],
  image: ["圖片", "Images"],
  video: ["影片", "Video"],
  design: ["設計", "Design"],
  analytics: ["數據分析", "Analytics"],
  workflow: ["流程自動化", "Workflows"],
  local_files: ["本機檔案", "Local files"],
};
const roleNames: Record<string, [string, string]> = {
  assistant: ["通用助理", "General assistant"],
};
function usePlanName() {
  const { t } = useI18n();
  return (id: string, role = false) => {
    const names = role ? roleNames : featureNames;
    return names[id] ? t(...names[id]) : id.replaceAll("_", " ");
  };
}
function creditInput(micros: string) {
  const value = BigInt(micros);
  return `${value / 1000000n}.${(value % 1000000n).toString().padStart(6, "0")}`;
}
export function PlanFacts({ value }: { value: PlanVersion }) {
  const { t } = useI18n(),
    name = usePlanName(),
    a = value.allowances;
  return (
    <div className="admin-plan-facts">
      <h3>
        {value.name} <small>v{value.version}</small>
      </h3>
      <Badge value={value.state} />
      <dl className="key-value">
        <dt>{t("方案 ID", "Plan family ID")}</dt>
        <dd>
          <code>{value.plan_id}</code>
        </dd>
        <dt>{t("版本 ID", "Version ID")}</dt>
        <dd>
          <code>{value.id}</code>
        </dd>
        <dt>{t("席位定義", "Seat allowance")}</dt>
        <dd>{a.seat_limit.toLocaleString("en-HK")}</dd>
        <dt>{t("同時工作數", "Concurrent tasks")}</dt>
        <dd>{a.task_concurrency.toLocaleString("en-HK")}</dd>
        <dt>{t("儲存空間（bytes）", "Storage allowance (bytes)")}</dt>
        <dd>{a.storage_bytes.toLocaleString("en-HK")}</dd>
        <dt>{t("附送額度定義", "Included credit rule")}</dt>
        <dd>{formatHKD(a.included_credit.amount_micros)}</dd>
        <dt>{t("額度處理", "Credit policy")}</dt>
        <dd>
          {a.credit_policy === "no_automatic_credit"
            ? t("不自動入帳", "No automatic credit")
            : t("須另行記錄額度授予", "Separate credit grant required")}
        </dd>
      </dl>
      <h4>{t("可用功能", "Features")}</h4>
      <div className="admin-plan-tags">
        {a.feature_ids.length ? (
          a.feature_ids.map((id) => (
            <span className="badge" key={id}>
              {name(id)}
            </span>
          ))
        ) : (
          <span className="muted">
            {t("未啟用功能", "No features enabled")}
          </span>
        )}
      </div>
      <h4>{t("可用角色", "Roles")}</h4>
      <div className="admin-plan-tags">
        {a.allowed_role_ids.length ? (
          a.allowed_role_ids.map((id) => (
            <span className="badge" key={id}>
              {name(id, true)}
            </span>
          ))
        ) : (
          <span className="muted">{t("未啟用角色", "No roles enabled")}</span>
        )}
      </div>
    </div>
  );
}
export function PlanPublicationFacts({ before }: { before: Comparison }) {
  const { t } = useI18n();
  return (
    <>
      <div className="admin-plan-comparison">
        <section aria-label={t("目前發佈版本", "Current published version")}>
          <h4>{t("目前發佈版本", "Current published version")}</h4>
          {before.previous ? (
            <PlanFacts value={before.previous} />
          ) : (
            <p className="muted">
              {t("此方案尚未發佈", "This family has no publication")}
            </p>
          )}
        </section>
        <section aria-label={t("待發佈版本", "Proposed version")}>
          <h4>{t("待發佈版本", "Proposed version")}</h4>
          <PlanFacts value={before.proposed} />
        </section>
      </div>
      <p className="notice">
        {t(
          "發佈後供後續授權選用；已有授權保留原方案定義。發佈不會自動開通 VIP、入帳或收費。",
          "Publication makes this version available for future grants. Existing grants retain their definitions. Publishing does not activate VIP access, credit a balance or charge a payment.",
        )}
      </p>
    </>
  );
}
export function AdminPlans({ access }: { access: Access }) {
  const { t } = useI18n(),
    [revision, setRevision] = useState(0),
    [page, setPage] = useState(0),
    [cursors, setCursors] = useState<(string | null)[]>([null]),
    [edit, setEdit] = useState<{ from?: PlanVersion } | null>(null),
    [detail, setDetail] = useState<PlanVersion | null>(null),
    [publication, setPublication] = useState<PlanVersion | null>(null),
    [notice, setNotice] = useState("");
  const query = new URLSearchParams({ limit: "12" });
  if (cursors[page]) query.set("cursor", cursors[page]!);
  const list = useData<{ items: PlanVersion[]; next_cursor: string | null }>(
    access.has("admin.plans.read") ? `${root}?${query}` : null,
    revision,
  );
  const refresh = () => {
    setPage(0);
    setCursors([null]);
    setRevision((v) => v + 1);
  };
  return (
    <>
      <PageHeader
        eyebrow="ACCESS, WITH A CLEAR DEFINITION."
        title={t("方案與權限", "Plans & access")}
        description={t(
          "建立不可修改的方案版本，核對功能與額度規則，再提交發佈。",
          "Create immutable plan versions, review features and allowance rules, then submit a publication.",
        )}
        action={
          <div className="admin-plan-actions">
            <button className="button secondary" onClick={refresh}>
              <RefreshCw size={16} />
              {t("更新資料", "Refresh")}
            </button>
            {access.has("admin.plans.draft") && (
              <button className="button primary" onClick={() => setEdit({})}>
                <Plus size={16} />
                {t("建立方案", "Create plan")}
              </button>
            )}
          </div>
        }
      />
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <ErrorNotice error={list.error} />
      {list.loading && <Loading />}
      {!access.has("admin.plans.read") && (
        <p className="notice">
          {t("需要讀取方案權限。", "Plan read permission is required.")}
        </p>
      )}
      {list.data && !list.data.items.length && (
        <Empty
          title={t("尚無方案", "No plan versions")}
          body={t(
            "建立第一個版本，確認後再發佈。",
            "Create a version and review it before publication.",
          )}
        />
      )}
      {list.data && (
        <div className="admin-plan-grid">
          {list.data.items.map((v) => (
            <article className="admin-plan-card" key={v.id}>
              <div className="admin-plan-card-heading">
                <span className="eyebrow">VERSION {v.version}</span>
                <Badge value={v.state} />
              </div>
              <h2>{v.name}</h2>
              <code className="admin-plan-id">{v.plan_id}</code>
              <dl className="admin-plan-metrics">
                <div>
                  <dt>{t("席位定義", "Seats")}</dt>
                  <dd>{v.allowances.seat_limit.toLocaleString("en-HK")}</dd>
                </div>
                <div>
                  <dt>{t("同時工作數", "Concurrent tasks")}</dt>
                  <dd>
                    {v.allowances.task_concurrency.toLocaleString("en-HK")}
                  </dd>
                </div>
              </dl>
              <p className="muted">
                {v.allowances.feature_ids.length} {t("項功能", "features")} ·{" "}
                {v.allowances.allowed_role_ids.length} {t("個角色", "roles")}
              </p>
              <div className="admin-plan-actions">
                <button
                  className="button secondary"
                  onClick={() => setDetail(v)}
                >
                  {t("查看定義", "View definition")}
                </button>
                {access.has("admin.plans.draft") && (
                  <button
                    className="button secondary"
                    onClick={() => setEdit({ from: v })}
                  >
                    {t("建立新版本", "New version")}
                  </button>
                )}
                {v.state === "draft" && access.has("admin.plans.publish") && (
                  <button
                    className="button primary"
                    onClick={() => setPublication(v)}
                  >
                    <ShieldCheck size={15} />
                    {t("發佈審核", "Review publication")}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {list.data && (
        <div className="admin-plan-pagination">
          <button
            className="button secondary"
            disabled={!page}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={16} />
            {t("上一頁", "Previous")}
          </button>
          <span aria-live="polite">
            {t("頁", "Page")} {page + 1}
          </span>
          <button
            className="button secondary"
            disabled={!list.data.next_cursor}
            onClick={() => {
              setCursors((c) => [
                ...c.slice(0, page + 1),
                list.data!.next_cursor,
              ]);
              setPage((p) => p + 1);
            }}
          >
            {t("下一頁", "Next")}
            <ChevronRight size={16} />
          </button>
        </div>
      )}
      {detail && (
        <Modal
          title={t("方案版本定義", "Plan version definition")}
          onClose={() => setDetail(null)}
        >
          <PlanFacts value={detail} />
        </Modal>
      )}
      {edit && (
        <PlanDraftForm
          from={edit.from}
          access={access}
          onClose={() => setEdit(null)}
          onDone={() => {
            setEdit(null);
            setNotice(
              t(
                "方案草稿已建立，發佈前請先核對完整定義。",
                "Draft created. Review its definition before publishing.",
              ),
            );
            refresh();
          }}
        />
      )}
      {publication && (
        <PlanPublication
          value={publication}
          operator={access.me.user.id}
          onClose={() => setPublication(null)}
          onDone={refresh}
        />
      )}
    </>
  );
}
function PlanDraftForm({
  from,
  access,
  onClose,
  onDone,
}: {
  from?: PlanVersion;
  access: Access;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    name = usePlanName(),
    [family] = useState(from?.plan_id ?? crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    summary = useRef<HTMLDivElement>(null),
    formRef = useRef<HTMLFormElement>(null),
    options = useData<{ feature_ids: string[]; role_ids: string[] }>(
      root + "/options",
    );
  const errors = error instanceof ApiError ? (error.details ?? []) : [];
  useEffect(() => {
    if (error) summary.current?.focus();
  }, [error]);
  const a = from?.allowances;
  const fieldError = (path: string) =>
    errors.find((e) => e.path === path)?.message;
  const fieldProps = (path: string) => ({
    id: `admin-plan-${path}`,
    "aria-invalid": !!fieldError(path),
    ...(fieldError(path)
      ? { "aria-describedby": `admin-plan-error-${path}` }
      : {}),
  });
  const inline = (path: string) =>
    fieldError(path) ? (
      <small className="admin-plan-field-error" id={`admin-plan-error-${path}`}>
        {fieldError(path)}
      </small>
    ) : null;
  const integer = (f: FormData, key: string, min: number, max: number) => {
    const value = String(f.get(key));
    if (
      !/^(0|[1-9][0-9]*)$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < min ||
      Number(value) > max
    )
      throw new ApiError(
        "VALIDATION_ERROR",
        t("請檢查數值。", "Check the allowance values."),
        400,
        [
          {
            path: `allowances.${key}`,
            message: t(
              "請輸入範圍內的整數",
              "Enter an integer within the allowed range",
            ),
          },
        ],
      );
    return Number(value);
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const f = new FormData(event.currentTarget);
      let credit: string;
      try {
        credit = parseHKD(String(f.get("included_credit")), true);
      } catch (e) {
        throw new ApiError("VALIDATION_ERROR", (e as Error).message, 400, [
          { path: "allowances.included_credit", message: (e as Error).message },
        ]);
      }
      const body = {
        plan_id: family,
        name: String(f.get("name")),
        allowances: {
          feature_ids: f.getAll("feature_ids").map(String),
          allowed_role_ids: f.getAll("allowed_role_ids").map(String),
          seat_limit: integer(f, "seat_limit", 1, 2147483647),
          task_concurrency: integer(f, "task_concurrency", 1, 2147483647),
          storage_bytes: integer(
            f,
            "storage_bytes",
            0,
            Number.MAX_SAFE_INTEGER,
          ),
          included_credit: { currency: "HKD", amount_micros: credit },
          credit_policy: String(f.get("credit_policy")),
        },
        reason: String(f.get("reason")),
      };
      const action = "admin.plans.draft";
      await api(root + "/drafts", {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
          "Idempotency-Key": await operationKey(
            access.me.user.id,
            action,
            body,
          ),
        },
      });
      await completeOperation(access.me.user.id, action, body);
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
        from
          ? t("建立方案新版本", "Create a new version")
          : t("建立方案", "Create plan")
      }
      onClose={onClose}
    >
      <p className="muted">
        {t(
          "草稿建立後保留原始定義。修改內容請再建立新版本。",
          "A saved draft retains its definition. Create another version to make changes.",
        )}
      </p>
      <ErrorNotice error={options.error} />
      {options.loading && <Loading />}
      {options.data && (
        <form className="form-stack" onSubmit={submit} ref={formRef}>
          {error && (
            <div
              className="notice error admin-plan-error-summary"
              tabIndex={-1}
              ref={summary}
              role="alert"
            >
              <div>
                <strong>{error.message}</strong>
                {errors.length > 0 && (
                  <ul>
                    {errors.map((e, i) => (
                      <li key={i}>
                        <a
                          href={`#admin-plan-${e.path}`}
                          onClick={(event) => {
                            event.preventDefault();
                            document
                              .getElementById(`admin-plan-${e.path}`)
                              ?.focus();
                          }}
                        >
                          {e.message}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
          <Field label={t("方案 ID", "Plan family ID")}>
            <input value={family} readOnly />
          </Field>
          <Field label={t("方案名稱", "Plan name")}>
            <input
              name="name"
              defaultValue={from?.name ?? ""}
              required
              {...fieldProps("name")}
            />
          </Field>
          {inline("name")}
          <div className="admin-plan-input-grid">
            {(
              [
                [
                  "seat_limit",
                  t("席位定義", "Seat allowance"),
                  a?.seat_limit ?? 5,
                  1,
                  2147483647,
                ],
                [
                  "task_concurrency",
                  t("同時工作數", "Concurrent tasks"),
                  a?.task_concurrency ?? 2,
                  1,
                  2147483647,
                ],
                [
                  "storage_bytes",
                  t("儲存空間（bytes）", "Storage allowance (bytes)"),
                  a?.storage_bytes ?? 1073741824,
                  0,
                  Number.MAX_SAFE_INTEGER,
                ],
              ] as const
            ).map(([key, label, value, min, max]) => (
              <div key={key}>
                <Field label={label}>
                  <input
                    name={key}
                    type="number"
                    min={min}
                    max={max}
                    step="1"
                    defaultValue={value}
                    required
                    {...fieldProps(`allowances.${key}`)}
                  />
                </Field>
                {inline(`allowances.${key}`)}
              </div>
            ))}
          </div>
          <Field label={t("附送額度（HKD）", "Included credit (HKD)")}>
            <input
              name="included_credit"
              inputMode="decimal"
              defaultValue={creditInput(
                a?.included_credit.amount_micros ?? "0",
              )}
              required
              {...fieldProps("allowances.included_credit")}
            />
          </Field>
          {inline("allowances.included_credit")}
          <Field label={t("額度處理規則", "Credit policy")}>
            <select
              name="credit_policy"
              defaultValue={a?.credit_policy ?? "no_automatic_credit"}
            >
              <option value="no_automatic_credit">
                {t("不自動入帳", "No automatic credit")}
              </option>
              <option value="separate_idempotent_grant">
                {t("須另行記錄額度授予", "Separate credit grant required")}
              </option>
            </select>
          </Field>
          {(
            [
              [
                "feature_ids",
                t("可用功能", "Features"),
                options.data.feature_ids,
                a?.feature_ids ?? ["text"],
              ],
              [
                "allowed_role_ids",
                t("可用角色", "Roles"),
                options.data.role_ids,
                a?.allowed_role_ids ?? ["assistant"],
              ],
            ] as const
          ).map(([key, label, ids, selected]) => (
            <fieldset className="admin-plan-options" key={key}>
              <legend>{label}</legend>
              {ids.map((id) => (
                <label key={id}>
                  <input
                    name={key}
                    type="checkbox"
                    value={id}
                    defaultChecked={selected.includes(id)}
                  />
                  <span>{name(id, key === "allowed_role_ids")}</span>
                </label>
              ))}
            </fieldset>
          ))}
          <Field label={t("建立原因", "Reason for creation")}>
            <textarea
              name="reason"
              minLength={3}
              maxLength={1000}
              required
              {...fieldProps("reason")}
            />
          </Field>
          {inline("reason")}
          <p className="notice">
            {t(
              "建立與發佈方案不會自動授予權限或入帳。",
              "Creating and publishing a plan does not automatically grant access or credit.",
            )}
          </p>
          <button className="button primary" type="submit" disabled={busy}>
            {busy
              ? t("正在建立…", "Creating…")
              : t("儲存新草稿", "Save new draft")}
          </button>
        </form>
      )}
    </Modal>
  );
}
function PlanPublication({
  value,
  operator,
  onClose,
  onDone,
}: {
  value: PlanVersion;
  operator: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    [prepared, setPrepared] = useState<{
      preview: any;
      facts: { before: Comparison; reason: string };
      command: { expected_version: number; reason: string };
    } | null>(null),
    [result, setResult] = useState<any>(null);
  return (
    <Modal title={t("發佈方案版本", "Publish plan version")} onClose={onClose}>
      {result ? (
        <div role="status">
          <h3>
            {result.state === "pending_approval"
              ? t("已提交獨立審批", "Submitted for independent review")
              : t("方案已發佈", "Plan published")}
          </h3>
          <Badge value={result.state} />
          <p className="admin-plan-id">
            <code>{result.id}</code>
          </p>
          {result.state === "pending_approval" && (
            <p>
              {t(
                "另一位具備權限的管理員核對後才能生效。",
                "Another authorized administrator must review this publication before it takes effect.",
              )}
            </p>
          )}
          <Link
            className="button secondary"
            to="/audit?view=approvals"
            onClick={onClose}
          >
            {t("前往審批列表", "Open approvals")}
          </Link>
        </div>
      ) : prepared ? (
        <>
          <PlanPublicationFacts before={prepared.facts.before} />
          <p>{prepared.facts.reason}</p>
          <p className="notice">
            {prepared.preview.decision === "independent_approval"
              ? t(
                  "此項發佈需要另一位管理員獨立審批。",
                  "This publication requires independent review by another administrator.",
                )
              : t(
                  "此項發佈將於確認後生效。",
                  "This publication takes effect after confirmation.",
                )}
          </p>
          <p>
            {t("預覽有效至", "Preview expires")}{" "}
            <DateText value={prepared.preview.expires_at} />
          </p>
          <AsyncForm
            submitLabel={
              prepared.preview.decision === "independent_approval"
                ? t("確認並提交審批", "Confirm and request review")
                : t("確認發佈", "Confirm publication")
            }
            onSubmit={async () => {
              const action = `admin.plans.publish:${value.id}`,
                command = prepared.command;
              const operation = await api(`${root}/${value.id}/publications`, {
                method: "POST",
                body: JSON.stringify(command),
                headers: {
                  "Idempotency-Key": await operationKey(
                    operator,
                    action,
                    command,
                  ),
                  "X-Admin-Preview-ID": prepared.preview.preview_id,
                },
              });
              await completeOperation(operator, action, command);
              setResult(operation);
              onDone();
            }}
          >
            <label className="admin-plan-confirm">
              <input type="checkbox" required />
              {t(
                "我已核對新舊方案及發佈影響。",
                "I have reviewed both versions and the publication effect.",
              )}
            </label>
          </AsyncForm>
          <button className="text-button" onClick={() => setPrepared(null)}>
            {t("重新預覽", "Create a fresh preview")}
          </button>
        </>
      ) : (
        <>
          <PlanFacts value={value} />
          <AsyncForm
            submitLabel={t("預覽發佈影響", "Preview publication")}
            onSubmit={async (f) => {
              const command = {
                  expected_version: value.version,
                  reason: String(f.get("reason")),
                },
                // A deliberate refresh creates a new short-lived preview. The final
                // business command has its own durable idempotency key.
                preview = await api(
                  `${root}/${value.id}/publication-previews`,
                  { method: "POST", body: JSON.stringify(command) },
                ),
                facts = await api(
                  `${root}/publication-previews/${preview.preview_id}`,
                );
              setPrepared({ preview, facts, command });
            }}
          >
            <Field label={t("發佈原因", "Publication reason")}>
              <textarea name="reason" required minLength={3} maxLength={1000} />
            </Field>
          </AsyncForm>
        </>
      )}
    </Modal>
  );
}
