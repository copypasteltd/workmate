import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { api, ApiError } from "./api";
import { operationKey, completeOperation } from "./operation-key";
import { PlanFacts, type PlanVersion } from "./plans";
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

const root = "/v1/admin/entitlement-grants";
type Subject = { kind: "user" | "tenant"; id: string };
type Grant = {
  id: string;
  subject: Subject;
  plan_version_id: string;
  starts_at: string;
  ends_at: string;
  state: string;
  source: string;
  actor_id: string;
  operation_id: string;
  version: number;
};
type Access = { me: { user: { id: string } }; has: (key: string) => boolean };
const actions = {
  grant: "",
  extend: "extensions",
  suspend: "suspensions",
  resume: "resumptions",
  revoke: "revocations",
};
type Action = keyof typeof actions;
export const vipPermission = (action: string) =>
  "admin.entitlements." +
  (action.endsWith("suspend")
    ? "revoke"
    : action.endsWith("resume")
      ? "grant"
      : action.split(".").at(-1));
const uuidPattern =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const localDate = (value: Date) =>
  new Date(value.getTime() - value.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
function useActionName() {
  const { t } = useI18n();
  return (action: string) =>
    ({
      grant: t("開通 VIP", "Grant VIP"),
      extend: t("延長期限", "Extend"),
      suspend: t("暫停", "Suspend"),
      resume: t("恢復", "Resume"),
      revoke: t("撤銷", "Revoke"),
    })[action.split(".").at(-1)!] ?? action;
}

function GrantFacts({ grant }: { grant: Grant }) {
  const { t } = useI18n();
  return (
    <dl className="key-value">
      <dt>{t("授予記錄", "Grant")}</dt>
      <dd>
        <code>{grant.id}</code>
      </dd>
      <dt>{t("歸屬", "Subject")}</dt>
      <dd>
        {grant.subject.kind === "user"
          ? t("個人", "Personal")
          : t("企業", "Workspace")}{" "}
        · <code>{grant.subject.id}</code>
      </dd>
      <dt>{t("固定方案版本", "Fixed plan version")}</dt>
      <dd>
        <code>{grant.plan_version_id}</code>
      </dd>
      <dt>{t("狀態 / 修訂", "State / revision")}</dt>
      <dd>
        <Badge value={grant.state} /> · v{grant.version}
      </dd>
      <dt>{t("生效至截止", "Effective interval")}</dt>
      <dd>
        <DateText value={grant.starts_at} /> →{" "}
        <DateText value={grant.ends_at} />
      </dd>
      <dt>{t("原始來源", "Original source")}</dt>
      <dd>{grant.source}</dd>
      <dt>{t("原授予者", "Original administrator")}</dt>
      <dd>
        <code>{grant.actor_id}</code>
      </dd>
      <dt>{t("原始操作", "Origin operation")}</dt>
      <dd>
        <code>{grant.operation_id}</code>
      </dd>
    </dl>
  );
}
export function VipChangeFacts({
  command,
  before,
}: {
  command: any;
  before: any;
}) {
  const { t } = useI18n(),
    subject = command.subject ?? before?.subject;
  return (
    <div className="form-stack">
      <h3>{t("已凍結的權益變更", "Frozen entitlement change")}</h3>
      {subject && (
        <p>
          {subject.kind === "user"
            ? t("個人", "Personal")
            : t("企業", "Workspace")}{" "}
          · <code>{subject.id}</code> · {t("主體版本", "Subject version")}{" "}
          {before?.subject_version}
        </p>
      )}
      {before?.current && <GrantFacts grant={before.current} />}
      {before?.plan && <PlanFacts value={before.plan} />}
      <dl className="key-value">
        {command.starts_at && (
          <>
            <dt>{t("開始時間", "Starts")}</dt>
            <dd>
              <DateText value={command.starts_at} />
            </dd>
          </>
        )}
        {command.ends_at && (
          <>
            <dt>{t("新截止時間", "Proposed end")}</dt>
            <dd>
              <DateText value={command.ends_at} />
            </dd>
          </>
        )}
        {command.overlap_policy && (
          <>
            <dt>{t("重疊處理", "Overlap policy")}</dt>
            <dd>
              {
                (
                  {
                    reject: t("有重疊時拒絕", "Reject overlap"),
                    replace: t("取代以下授予", "Replace grants below"),
                    extend_same_plan: t(
                      "續期同一方案版本",
                      "Extend the exact same plan",
                    ),
                  } as any
                )[command.overlap_policy]
              }
            </dd>
          </>
        )}
        {command.source && (
          <>
            <dt>{t("來源", "Source")}</dt>
            <dd>{command.source}</dd>
          </>
        )}
        {before?.payment && (
          <>
            <dt>{t("已驗證付款", "Verified payment")}</dt>
            <dd>
              <code>{before.payment.id}</code> · v{before.payment.version}
            </dd>
          </>
        )}
        <dt>{t("原因", "Reason")}</dt>
        <dd>{command.reason}</dd>
      </dl>
      {!!before?.grants?.length && (
        <section>
          <h4>{t("涉及的規範授予", "Affected canonical grants")}</h4>
          {before.grants.map((g: Grant) => (
            <GrantFacts key={g.id} grant={g} />
          ))}
        </section>
      )}
      {!!before?.legacy?.length && (
        <section>
          <h4>{t("涉及的歷史授予", "Affected historical grants")}</h4>
          {before.legacy.map((g: any) => (
            <p key={g.id}>
              <code>{g.id}</code> · {g.plan} · v{g.version} ·{" "}
              <DateText value={g.ends_at} />
            </p>
          ))}
          <p className="muted">
            {t(
              "保留原行及未知來源；取代另記實際生效時點。",
              "Original rows and unknown provenance are retained; replacements record their actual boundary.",
            )}
          </p>
        </section>
      )}
      <p className="notice">
        {t(
          "此操作不自動續費、不扣款或贈額。生效後仍需具備資源權限及可用預算。",
          "This operation creates no renewal, charge or credit. Resource permissions and available budget still apply.",
        )}
      </p>
    </div>
  );
}

export function AdminVip({ access }: { access: Access }) {
  const { t } = useI18n(),
    [revision, setRevision] = useState(0),
    [filter, setFilter] = useState(""),
    [legacyCursor, setLegacyCursor] = useState<string | null>(null),
    [cursors, setCursors] = useState<(string | null)[]>([null]),
    [page, setPage] = useState(0),
    [create, setCreate] = useState(false),
    [selected, setSelected] = useState<Grant | null>(null);
  const list = useData(
    `${root}?limit=20${filter ? "&subject_id=" + encodeURIComponent(filter) : ""}${cursors[page] ? "&cursor=" + encodeURIComponent(cursors[page]!) : ""}`,
    revision,
  );
  const legacy = useData(
    filter
      ? `${root}/legacy?subject_id=${encodeURIComponent(filter)}&limit=50${legacyCursor ? "&cursor=" + legacyCursor : ""}`
      : null,
    revision,
  );
  const refresh = () => {
    setPage(0);
    setCursors([null]);
    setLegacyCursor(null);
    setRevision((n) => n + 1);
  };
  return (
    <>
      <PageHeader
        eyebrow="ACCESS CONTROL"
        title={t("VIP 與權益", "VIP & entitlements")}
        description={t(
          "管理個人與企業的固定方案、期限和每次權益修訂。",
          "Manage fixed plans, effective intervals and every entitlement revision.",
        )}
        action={
          <>
            <button className="button secondary" onClick={refresh}>
              <RefreshCw size={16} />
              {t("重新整理", "Refresh")}
            </button>
            {access.has("admin.entitlements.grant") && (
              <button
                className="button primary"
                onClick={() => setCreate(true)}
              >
                <Plus size={16} />
                {t("開通 VIP", "Grant VIP")}
              </button>
            )}
          </>
        }
      />
      <form
        className="filter-bar"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter(
            String(new FormData(e.currentTarget).get("subject_id")).trim(),
          );
          setLegacyCursor(null);
          setPage(0);
          setCursors([null]);
        }}
      >
        <Field label={t("個人或企業 ID", "User or workspace ID")}>
          <input
            name="subject_id"
            pattern={uuidPattern}
            placeholder={t(
              "輸入 ID 查閱授予及歷史記錄",
              "Enter an ID to include historical grants",
            )}
          />
        </Field>
        <button className="button secondary" type="submit">
          {t("篩選", "Filter")}
        </button>
      </form>
      <ErrorNotice error={list.error} />
      {list.loading && <Loading />}
      {list.data?.items.length === 0 && (
        <Empty
          icon={ShieldCheck}
          title={t("尚無規範授予", "No canonical grants")}
          body={t(
            "開通時選擇已發佈方案，先預覽再提交。輸入歸屬 ID 可查閱歷史記錄。",
            "Choose a published plan and preview before committing. Filter by subject to view historical records.",
          )}
        />
      )}
      {!!list.data?.items.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  t("歸屬", "Subject"),
                  t("狀態", "State"),
                  t("截止時間", "Ends"),
                  t("修訂", "Revision"),
                  t("操作", "Actions"),
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((g: Grant) => (
                <tr key={g.id}>
                  <td>
                    <strong>
                      {g.subject.kind === "user"
                        ? t("個人", "Personal")
                        : t("企業", "Workspace")}
                    </strong>
                    <small>
                      <code>{g.subject.id}</code>
                    </small>
                  </td>
                  <td>
                    <Badge value={g.state} />
                  </td>
                  <td>
                    <DateText value={g.ends_at} />
                  </td>
                  <td>v{g.version}</td>
                  <td>
                    <button
                      className="button secondary"
                      onClick={() => setSelected(g)}
                    >
                      {t("查看與管理", "View & manage")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="admin-plan-pagination">
        <button
          className="button secondary"
          disabled={!page}
          onClick={() => setPage((p) => p - 1)}
        >
          {t("上一頁", "Previous")}
        </button>
        <span aria-live="polite">
          {t("頁", "Page")} {page + 1}
        </span>
        <button
          className="button secondary"
          disabled={!list.data?.next_cursor}
          onClick={() => {
            setCursors((c) => [...c.slice(0, page + 1), list.data.next_cursor]);
            setPage((p) => p + 1);
          }}
        >
          {t("下一頁", "Next")}
        </button>
      </div>
      {filter && (
        <section className="card">
          <h2>{t("歷史授予原始記錄", "Original historical grants")}</h2>
          <ErrorNotice error={legacy.error} />
          {legacy.loading && <Loading />}
          {legacy.data?.items.map((g: any) => (
            <p key={g.id}>
              <code>{g.id}</code> · {g.plan} · {g.state} ·{" "}
              <DateText value={g.ends_at} />
              {g.replaced_at && (
                <>
                  {" "}
                  · {t("已另記取代時間", "Replacement recorded")}{" "}
                  <DateText value={g.replaced_at} />
                </>
              )}
            </p>
          ))}
          {(legacyCursor || legacy.data?.next_cursor) && (
            <div className="admin-plan-pagination">
              <button
                className="button secondary"
                disabled={!legacyCursor}
                onClick={() => setLegacyCursor(null)}
              >
                {t("返回首批記錄", "First historical page")}
              </button>
              <button
                className="button secondary"
                disabled={!legacy.data?.next_cursor}
                onClick={() => setLegacyCursor(legacy.data.next_cursor)}
              >
                {t("更多歷史記錄", "More historical grants")}
              </button>
            </div>
          )}
          <p className="muted">
            {t(
              "未知的來源、操作者或原操作不補造。若需新方案，請在開通預覽中明確選擇取代。",
              "Unknown source, administrator or origin operation stays unknown. To change plans, explicitly review a replacement grant.",
            )}
          </p>
        </section>
      )}
      {create && (
        <VipCommandModal
          access={access}
          onClose={() => setCreate(false)}
          onDone={refresh}
        />
      )}
      {selected && (
        <VipDetail
          id={selected.id}
          access={access}
          onClose={() => setSelected(null)}
          onDone={refresh}
        />
      )}
    </>
  );
}
function VipDetail({
  id,
  access,
  onClose,
  onDone,
}: {
  id: string;
  access: Access;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    name = useActionName(),
    [revision, setRevision] = useState(0),
    [action, setAction] = useState<{ action: Action; grant: Grant } | null>(null),
    history = useData(`${root}/${id}/history`, revision);
  const g = history.data?.grant as Grant | undefined;
  if (action)
    return (
      <VipCommandModal
        access={access}
        grant={action.grant}
        initial={action.action}
        onClose={() => setAction(null)}
        onDone={() => {
          setRevision((n) => n + 1);
          onDone();
        }}
      />
    );
  return (
    <Modal
      title={t("授予與修訂記錄", "Grant & revision history")}
      onClose={onClose}
    >
      <ErrorNotice error={history.error} />
      {history.loading && <Loading />}
      {g && (
        <>
          <GrantFacts grant={g} />
          <div className="admin-plan-actions">
            {(["extend", "suspend", "resume", "revoke"] as Action[])
              .filter(
                (a) =>
                  access.has(vipPermission(a)) &&
                  !["revoked", "replaced"].includes(g.state) &&
                  (a !== "resume" || g.state === "suspended") &&
                  (a !== "suspend" ||
                    ["active", "scheduled"].includes(g.state)),
              )
              .map((a) => (
                <button
                  className="button secondary"
                  key={a}
                  onClick={() => setAction({ action: a, grant: g })}
                >
                  {name(a)}
                </button>
              ))}
          </div>
          <h3>{t("不可改寫的修訂", "Immutable revisions")}</h3>
          {history.data.items.map((e: any) => (
            <article className="card" key={e.id}>
              <strong>
                v{e.version} · {name(e.action)}
              </strong>
              <p>
                <DateText value={e.created_at} /> · <code>{e.actor_id}</code>
              </p>
              <p>
                {t("操作", "Operation")} <code>{e.operation_id}</code>
              </p>
              <p>
                {e.before_value?.state ?? "—"} → {e.after_value.state} ·{" "}
                <DateText value={e.after_value.ends_at} />
              </p>
              {e.after_value.replacement_at && (
                <p>
                  {t("取代生效", "Replacement effective")}{" "}
                  <DateText value={e.after_value.replacement_at} />
                </p>
              )}
            </article>
          ))}
        </>
      )}
    </Modal>
  );
}

export function VipCommandModal({
  access,
  grant,
  subject,
  initial = "grant",
  onClose,
  onDone,
}: {
  access: Access;
  grant?: Grant;
  subject?: Subject;
  initial?: Action;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    actionName = useActionName(),
    [kind, setKind] = useState<"user" | "tenant">(subject?.kind ?? "user"),
    [source, setSource] = useState("manual"),
    [planId, setPlanId] = useState(""),
    [options, setOptions] = useState<PlanVersion[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null),
    [prepared, setPrepared] = useState<any>(null),
    [result, setResult] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [errors, setErrors] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null),
    summary = useRef<HTMLDivElement>(null);
  const plans = useData(
    initial === "grant"
      ? `${root}/plan-options?limit=30${cursor ? "&cursor=" + cursor : ""}`
      : null,
  );
  const live = useData(
    result?.state === "pending_approval" && access.has("admin.jobs.read")
      ? `/v1/admin/operations/${result.id}`
      : null,
    0,
    3000,
  );
  const outcome = live.data ?? result;
  useEffect(() => {
    if (plans.data) {
      setOptions((old) => [
        ...old,
        ...plans.data.items.filter(
          (v: PlanVersion) => !old.some((o) => o.id === v.id),
        ),
      ]);
      setNext(plans.data.next_cursor);
    }
  }, [plans.data]);
  useEffect(() => {
    if (error || Object.keys(errors).length) summary.current?.focus();
  }, [error, errors]);
  const props = (key: string) => ({
    id: "vip-" + key,
    "aria-invalid": !!errors[key],
    "aria-describedby": errors[key] ? "vip-error-" + key : undefined,
  });
  const inline = (key: string) =>
    errors[key] ? (
      <small className="error-line" id={"vip-error-" + key}>
        {errors[key]}
      </small>
    ) : null;
  async function preview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const b: any = {
        expected_version: grant?.version,
        reason: String(f.get("reason")),
      };
      if (initial === "grant") {
        const selected: Subject = {
          kind,
          id: String(f.get("subject_id")).trim(),
        };
        const current = await api(`${root}/subjects/${kind}/${selected.id}`);
        delete b.expected_version;
        Object.assign(b, {
          subject: selected,
          plan_version_id: planId,
          starts_at: new Date(String(f.get("starts_at"))).toISOString(),
          ends_at: new Date(String(f.get("ends_at"))).toISOString(),
          overlap_policy: String(f.get("overlap_policy")),
          source,
          auto_renew: false,
          expected_subject_version: current.version,
        });
        if (source === "paid")
          b.payment_record_id = String(f.get("payment_record_id")).trim();
      } else if (initial === "extend")
        b.ends_at = new Date(String(f.get("ends_at"))).toISOString();
      const path =
        initial === "grant"
          ? "/v1/admin/entitlement-previews"
          : `${root}/${grant!.id}/${actions[initial]}/previews`;
      const preview = await api(path, {
          method: "POST",
          body: JSON.stringify(b),
        }),
        facts = await api(
          "/v1/admin/entitlement-previews/" + preview.preview_id,
        );
      setPrepared({ preview, facts, command: b });
    } catch (e) {
      setError(e as Error);
      if (e instanceof ApiError && e.details) {
        const fields: Record<string, string> = {};
        for (const d of e.details)
          fields[d.path.split(".").at(-1)!] = d.message;
        setErrors(fields);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={actionName(initial)} onClose={onClose}>
      {outcome ? (
        <div className="form-stack">
          <Badge value={outcome.state} />
          <p role="status">
            {outcome.state === "pending_approval"
              ? t(
                  "已提交，另一位授權管理員完成審批後才會生效。",
                  "Submitted. Access changes only after another authorized administrator approves.",
                )
              : t(
                  "操作已記錄，請查看授予及修訂結果。",
                  "Operation recorded. Review the resulting grant and revision.",
                )}
          </p>
          <code>{outcome.id}</code>
          <ErrorNotice error={live.error} />
          {outcome.state === "pending_approval" && access.has("admin.approvals.read") && <Link to={"/audit?view=approvals&search=" + outcome.id} onClick={onClose}>{t("前往審批中心", "Open approval center")}</Link>}
          <Link to="/entitlements" onClick={onClose}>{t("查看授予結果", "View grant result")}</Link>
          <button className="button primary" onClick={onClose}>
            {t("完成", "Done")}
          </button>
        </div>
      ) : (
        <>
          <div ref={summary} tabIndex={-1} role={error ? "alert" : undefined}>
            {error && (
              <>
                <ErrorNotice error={error} />
                {Object.entries(errors).map(([key, text]) => (
                  <p key={key}>
                    <a
                      href={"#vip-" + key}
                      onClick={(e) => {
                        e.preventDefault();
                        form.current
                          ?.querySelector<HTMLElement>("#vip-" + key)
                          ?.focus();
                      }}
                    >
                      {text}
                    </a>
                  </p>
                ))}
              </>
            )}
          </div>
          {prepared && (
            <section className="form-stack">
              <VipChangeFacts
                command={prepared.command}
                before={prepared.facts.before}
              />
              <p>
                {t("預覽截止", "Preview expires")}{" "}
                <DateText value={prepared.preview.expires_at} />
              </p>
              <p className="notice">
                {prepared.preview.decision === "independent_approval"
                  ? t(
                      "需要另一位管理員獨立審批。",
                      "Independent review by another administrator is required.",
                    )
                  : t(
                      "確認後立即記錄，按生效時間提供權益。",
                      "Confirmation records the grant; access follows its effective interval.",
                    )}
              </p>
              <AsyncForm
                submitLabel={t("確認提交", "Confirm submission")}
                onSubmit={async () => {
                  const b = prepared.command,
                    action = `admin.vip.${initial}:${grant?.id ?? b.subject.id}`,
                    path =
                      initial === "grant"
                        ? root
                        : `${root}/${grant!.id}/${actions[initial]}`;
                  const op = await api(path, {
                    method: "POST",
                    body: JSON.stringify(b),
                    headers: {
                      "X-Admin-Preview-ID": prepared.preview.preview_id,
                      "Idempotency-Key": await operationKey(
                        access.me.user.id,
                        action,
                        b,
                      ),
                    },
                  });
                  await completeOperation(access.me.user.id, action, b);
                  setResult(op);
                  onDone();
                }}
              >
                <label className="admin-plan-confirm">
                  <input type="checkbox" required />
                  {t(
                    "我已核對歸屬、固定方案、日期、來源及重疊影響。",
                    "I reviewed the subject, fixed plan, dates, source and overlap effects.",
                  )}
                </label>
              </AsyncForm>
              <button
                className="text-button"
                onClick={() => {
                  setPrepared(null);
                  setError(null);
                }}
              >
                {t("返回修改並重新預覽", "Edit and create a fresh preview")}
              </button>
            </section>
          )}
          <form
            ref={form}
            style={prepared ? { display: "none" } : undefined}
            className="form-stack"
            onSubmit={preview}
          >
            {grant && <GrantFacts grant={grant} />}
            {initial === "grant" && (
              <>
                <Field label={t("歸屬類型", "Subject type")}>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as any)}
                    disabled={!!subject}
                  >
                    <option value="user">{t("個人", "Personal")}</option>
                    <option value="tenant">{t("企業", "Workspace")}</option>
                  </select>
                </Field>
                <Field label={t("歸屬 ID", "Subject ID")}>
                  <input
                    name="subject_id"
                    defaultValue={subject?.id}
                    readOnly={!!subject}
                    pattern={uuidPattern}
                    required
                    {...props("subject_id")}
                  />
                </Field>
                {inline("subject_id")}
                <ErrorNotice error={plans.error} />
                {plans.loading && <Loading />}
                <Field
                  label={t(
                    "已發佈的固定方案版本",
                    "Published fixed plan version",
                  )}
                >
                  <select
                    value={planId}
                    onChange={(e) => setPlanId(e.target.value)}
                    required
                    {...props("plan_version_id")}
                  >
                    <option value="">{t("選擇方案", "Select plan")}</option>
                    {options.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} · v{v.version} · {v.id}
                      </option>
                    ))}
                  </select>
                </Field>
                {inline("plan_version_id")}
                {next && (
                  <button
                    className="button secondary"
                    type="button"
                    disabled={plans.loading}
                    onClick={() => setCursor(next)}
                  >
                    {t("載入更多已發佈方案", "Load more published plans")}
                  </button>
                )}
                {options.find((v) => v.id === planId) && (
                  <PlanFacts value={options.find((v) => v.id === planId)!} />
                )}
                <Field label={t("來源", "Source")}>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    {[
                      "manual",
                      "paid",
                      "trial",
                      "promotion",
                      "compensation",
                      "contract",
                    ].map((v) => (
                      <option key={v} value={v}>
                        {
                          (
                            {
                              manual: t("人工授予", "Manual"),
                              paid: t("已付款", "Paid"),
                              trial: t("試用", "Trial"),
                              promotion: t("推廣", "Promotion"),
                              compensation: t("補償", "Compensation"),
                              contract: t("合約", "Contract"),
                            } as any
                          )[v]
                        }
                      </option>
                    ))}
                  </select>
                </Field>
                {source === "paid" && (
                  <>
                    <Field
                      label={t(
                        "已驗證付款記錄 ID",
                        "Verified payment record ID",
                      )}
                    >
                      <input
                        name="payment_record_id"
                        pattern={uuidPattern}
                        required
                        {...props("payment_record_id")}
                      />
                    </Field>
                    {inline("payment_record_id")}
                  </>
                )}
                <Field label={t("開始時間（本機時區）", "Starts (local time)")}>
                  <input
                    name="starts_at"
                    type="datetime-local"
                    defaultValue={localDate(new Date())}
                    required
                    {...props("starts_at")}
                  />
                </Field>
                {inline("starts_at")}
                <Field label={t("重疊處理", "Overlap policy")}>
                  <select name="overlap_policy" defaultValue="reject">
                    <option value="reject">
                      {t("有重疊時拒絕", "Reject overlap")}
                    </option>
                    <option value="replace">
                      {t(
                        "明確取代重疊授予",
                        "Explicitly replace overlapping grants",
                      )}
                    </option>
                    <option value="extend_same_plan">
                      {t(
                        "續期同一固定版本與來源",
                        "Extend the same fixed version and source",
                      )}
                    </option>
                  </select>
                </Field>
              </>
            )}
            {["grant", "extend"].includes(initial) && (
              <>
                <Field label={t("截止時間（本機時區）", "Ends (local time)")}>
                  <input
                    name="ends_at"
                    type="datetime-local"
                    defaultValue={localDate(
                      new Date(
                        grant
                          ? Date.parse(grant.ends_at) + 86400000
                          : Date.now() + 30 * 86400000,
                      ),
                    )}
                    required
                    {...props("ends_at")}
                  />
                </Field>
                {inline("ends_at")}
              </>
            )}
            <Field label={t("操作原因", "Reason")}>
              <textarea
                name="reason"
                minLength={3}
                maxLength={1000}
                required
                {...props("reason")}
              />
            </Field>
            {inline("reason")}
            <p className="notice">
              {t(
                "先預覽完整影響，再確認或提交獨立審批。VIP 不自動贈額或扣款。",
                "Preview the full effect before confirmation or independent review. VIP creates no automatic credit or charge.",
              )}
            </p>
            <button className="button primary" type="submit" disabled={busy}>
              {busy
                ? t("正在預覽…", "Preparing…")
                : t("預覽權益變更", "Preview entitlement change")}
            </button>
          </form>
        </>
      )}
    </Modal>
  );
}
