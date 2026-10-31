import { useEffect, useState } from "react";
import { api } from "./api";
import { ErrorNotice, Field, useI18n } from "./ui";

export type DirectoryFilters = Record<string, string>;
const directoryFilterKeys = [
  "user_id",
  "tenant_id",
  "project_id",
  "state",
  "vip",
  "limit",
  "period_from",
  "period_to",
  "registered_from", "registered_to", "active_from", "active_to", "activity", "registration_source",
  "vip_plan", "vip_status", "vip_expiry_from", "vip_expiry_to",
  "charge_min_micros", "charge_max_micros", "balance_state", "balance_required_micros", "billing_subject",
  "cost_exception", "role_key", "role_usage",
] as const;
const dateFilterKeys = ["period_from", "period_to", "registered_from", "registered_to", "active_from", "active_to", "vip_expiry_from", "vip_expiry_to"];
function amountInput(micros?: string) {
  if (!micros || !/^(0|[1-9][0-9]{0,29})$/.test(micros)) return "";
  const n = BigInt(micros), fraction = (n % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return (n / 1_000_000n).toString() + (fraction ? "." + fraction : "");
}
function exactMicros(value: string) {
  if (value.length > 31 || !/^[0-9]+(?:\.[0-9]{1,6})?$/.test(value)) throw new Error("Enter an HKD amount with at most six decimal places.");
  const [whole, decimal = ""] = value.split(".");
  const n = BigInt(whole) * 1_000_000n + BigInt(decimal.padEnd(6, "0"));
  if (n.toString().length > 30) throw new Error("The amount is too large.");
  return n.toString();
}
export function readDirectoryFilters(search: string): DirectoryFilters {
  const query = new URLSearchParams(search),
    filters: DirectoryFilters = {};
  for (const key of directoryFilterKeys) {
    const value = query.get(key)?.trim();
    if (value) filters[key] = value;
  }
  return filters;
}
export function writeDirectoryFilters(search: string, filters: DirectoryFilters) {
  const query = new URLSearchParams(search);
  for (const key of directoryFilterKeys) {
    query.delete(key);
    if (filters[key]) query.set(key, filters[key]);
  }
  return query.size ? "?" + query.toString() : "";
}
function localDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16);
}
export function AdminDirectoryFilters({
  onApply,
  canUsage,
  canVip,
  canBilling,
  filters = {},
}: {
  onApply: (filters: DirectoryFilters) => void;
  canUsage: boolean;
  canVip: boolean;
  canBilling: boolean;
  filters?: DirectoryFilters;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<Error | null>(null);
  const dateField = (name: string, zh: string, en: string, disabled = false) => (
    <Field key={name} label={t(zh, en)}><input type="datetime-local" name={name} defaultValue={localDateTime(filters[name])} disabled={disabled} /></Field>
  );
  const moneyField = (name: string, zh: string, en: string, disabled: boolean) => (
    <Field label={t(zh, en)}><input name={name.replace("_micros", "_hkd")} inputMode="decimal" maxLength={31} defaultValue={amountInput(filters[name])} pattern="[0-9]+([.][0-9]{1,6})?" disabled={disabled} placeholder="HKD" /></Field>
  );
  return (
    <details className="directory-filters card">
      <summary>
        {t("篩選用戶與確認扣費期間", "Filter users & confirmed charge period")}
      </summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget),
            filters: DirectoryFilters = {};
          for (const [key, value] of form.entries())
            if (String(value).trim()) filters[key] = String(value).trim();
          try {
            for (const key of dateFilterKeys) if (filters[key]) filters[key] = new Date(filters[key]).toISOString();
            for (const [from, to] of [["period_from", "period_to"], ["registered_from", "registered_to"], ["active_from", "active_to"], ["vip_expiry_from", "vip_expiry_to"]])
              if (filters[from] && filters[to] && Date.parse(filters[from]) >= Date.parse(filters[to]))
                throw new Error(t("結束時間必須晚於開始時間。", "The end must follow the start."));
            for (const key of ["charge_min_micros", "charge_max_micros", "balance_required_micros"]) {
              const input = key.replace("_micros", "_hkd");
              if (filters[input]) filters[key] = exactMicros(filters[input]);
              delete filters[input];
            }
            if (filters.charge_min_micros && filters.charge_max_micros && BigInt(filters.charge_min_micros) > BigInt(filters.charge_max_micros))
              throw new Error(t("最高扣費不可小於最低扣費。", "Maximum charges must not be below minimum charges."));
            if (filters.activity === "unknown" && (filters.active_from || filters.active_to))
              throw new Error(t("未記錄訪問不可同時設定訪問區間。", "Unrecorded activity cannot have an activity range."));
            if ((filters.balance_required_micros || filters.billing_subject) && !filters.balance_state)
              throw new Error(t("請選擇可用額度條件。", "Select an available credit condition."));
            if (filters.balance_required_micros === "0")
              throw new Error(t("比較金額必須大於零。", "The comparison amount must be positive."));
            if (filters.role_usage && !filters.role_key)
              throw new Error(t("請填寫角色識別。", "Enter a role key."));
          } catch (e) {
            setError(e instanceof Error ? e : new Error(String(e)));
            return;
          }
          setError(null);
          onApply(filters);
        }}
      >
        <div className="directory-filter-grid">
          {[
            ["user_id", t("用戶 ID", "User ID")],
            ["tenant_id", t("企業 ID", "Workspace ID")],
            ["project_id", t("專案 ID", "Project ID")],
          ].map(([name, label]) => (
            <Field key={name} label={label}>
              <input
                name={name}
                defaultValue={filters[name] ?? ""}
                pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                title="UUID"
              />
            </Field>
          ))}
          <Field label={t("帳戶狀態", "Account state")}>
            <select name="state" defaultValue={filters.state ?? ""}>
              <option value="">{t("全部狀態", "All states")}</option>
              <option value="active">{t("有效", "Active")}</option>
              <option value="frozen">{t("已凍結", "Frozen")}</option>
              <option value="closed">{t("已關閉", "Closed")}</option>
            </select>
          </Field>
          <Field label="VIP">
            <select name="vip" disabled={!canVip} defaultValue={filters.vip ?? ""}>
              <option value="">
                {t("全部權益狀態", "All entitlement states")}
              </option>
              <option value="true">{t("有效 VIP", "Effective VIP")}</option>
              <option value="false">
                {t("無有效 VIP", "No effective VIP")}
              </option>
            </select>
          </Field>
          <Field label={t("每頁筆數", "Page size")}>
            <select name="limit" defaultValue={filters.limit ?? "50"}>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </Field>
          <Field label={t("扣費開始（本機時間）", "Charges from (local time)")}>
            <input
              type="datetime-local"
              name="period_from"
              defaultValue={localDateTime(filters.period_from)}
              disabled={!canUsage}
            />
          </Field>
          <Field
            label={t(
              "扣費結束，不含此刻（本機時間）",
              "Charges before (local time)",
            )}
          >
            <input
              type="datetime-local"
              name="period_to"
              defaultValue={localDateTime(filters.period_to)}
              disabled={!canUsage}
            />
          </Field>
        </div>
        <fieldset className="directory-filter-block">
          <legend>{t("註冊與帳戶訪問", "Registration and account access")}</legend>
          <div className="directory-filter-grid">
            {dateField("registered_from", "註冊開始（本機時間）", "Registered from (local time)")}
            {dateField("registered_to", "註冊結束，不含此刻（本機時間）", "Registered before (local time)")}
            {dateField("active_from", "帳戶訪問開始（本機時間）", "Account access from (local time)")}
            {dateField("active_to", "帳戶訪問結束，不含此刻（本機時間）", "Account access before (local time)")}
            <Field label={t("訪問記錄", "Access record")}><select name="activity" defaultValue={filters.activity ?? ""}>
              <option value="">{t("全部記錄狀態", "All recording states")}</option>
              <option value="known">{t("已有訪問記錄", "Recorded access")}</option>
              <option value="unknown">{t("未記錄訪問", "Unrecorded access")}</option>
            </select></Field>
            <Field label={t("註冊來源", "Registration source")}><select name="registration_source" defaultValue={filters.registration_source ?? ""}>
              <option value="">{t("全部來源", "All sources")}</option>
              <option value="email_otp">{t("工作郵箱驗證碼", "Email verification")}</option>
              <option value="unknown">{t("舊來源未知", "Unknown legacy source")}</option>
            </select></Field>
          </div>
          <p className="muted small-text">{t("訪問為成功驗證的帳戶請求，包含裝置輪詢，最多每分鐘記錄一次；不等同人工在線。舊資料未知不當作從未使用。", "Access records authenticated account requests, including device polling, at most once per minute. It does not measure human presence. Unknown legacy activity does not mean never used.")}</p>
        </fieldset>
        <fieldset className="directory-filter-block" disabled={!canVip}>
          <legend>{t("VIP 授予條件", "VIP grant conditions")}</legend>
          <div className="directory-filter-grid">
            <Field label={t("VIP 方案名稱", "VIP plan name")}><input name="vip_plan" maxLength={160} defaultValue={filters.vip_plan ?? ""} placeholder="pro / business" /></Field>
            <Field label={t("VIP 授予狀態", "VIP grant state")}><select name="vip_status" defaultValue={filters.vip_status ?? ""}>
              <option value="">{t("任何授予狀態", "Any grant state")}</option>
              <option value="effective">{t("現時有效", "Currently effective")}</option>
              <option value="scheduled">{t("預約生效", "Scheduled")}</option>
              <option value="expired">{t("已到期", "Expired")}</option>
              <option value="suspended">{t("已暫停", "Suspended")}</option>
              <option value="revoked">{t("已撤銷", "Revoked")}</option>
            </select></Field>
            {dateField("vip_expiry_from", "VIP 到期開始（本機時間）", "VIP expires from (local time)")}
            {dateField("vip_expiry_to", "VIP 到期結束，不含此刻（本機時間）", "VIP expires before (local time)")}
          </div>
          <p className="muted small-text">{t("方案、狀態與到期條件必須由同一項授予符合；免費方案不列作 VIP。", "Plan, state and expiry must match the same grant. Free plans are not VIP.")}</p>
        </fieldset>
        <fieldset className="directory-filter-block" disabled={!canUsage}>
          <legend>{t("扣費與角色使用", "Charges and role use")}</legend>
          <div className="directory-filter-grid">
            {moneyField("charge_min_micros", "最低確認扣費（HKD，含）", "Minimum confirmed charges (HKD, inclusive)", !canUsage)}
            {moneyField("charge_max_micros", "最高確認扣費（HKD，含）", "Maximum confirmed charges (HKD, inclusive)", !canUsage)}
            <Field label={t("費用異常", "Cost exceptions")}><select name="cost_exception" defaultValue={filters.cost_exception ?? ""}>
              <option value="">{t("不限定對賬狀態", "Any reconciliation state")}</option>
              <option value="pending_reconciliation">{t("有待費用對賬", "Pending cost reconciliation")}</option>
              <option value="none">{t("無待費用對賬", "No pending cost reconciliation")}</option>
            </select></Field>
            <Field label={t("角色識別", "Role key")}><input name="role_key" maxLength={80} defaultValue={filters.role_key ?? ""} placeholder="assistant" /></Field>
            <Field label={t("角色使用階段", "Role use stage")}><select name="role_usage" defaultValue={filters.role_usage ?? ""}>
              <option value="">{t("已提交任務", "Submitted work")}</option>
              <option value="started">{t("已開始執行", "Execution started")}</option>
            </select></Field>
          </div>
          <p className="muted small-text">{t("只統計上方期間的已確認扣費；零不表示免費或已完成對賬。角色及待對賬按同一期間內建立的任務；沒有可讀資料不等同零。", "Only confirmed charges in the period above are counted; zero does not mean free or fully reconciled. Role use and reconciliation use tasks created in that period; unavailable data is not zero.")}</p>
        </fieldset>
        <fieldset className="directory-filter-block" disabled={!canBilling}>
          <legend>{t("相關帳務帳戶可用額度", "Available credit of related accounts")}</legend>
          <div className="directory-filter-grid">
            <Field label={t("可用額度條件", "Available credit condition")}><select name="balance_state" defaultValue={filters.balance_state ?? ""}>
              <option value="">{t("不限定可用額度", "Any available credit")}</option>
              <option value="insufficient">{t("任一可見帳戶不足", "Any visible account is insufficient")}</option>
              <option value="sufficient">{t("任一可見帳戶足夠", "Any visible account is sufficient")}</option>
            </select></Field>
            {moneyField("balance_required_micros", "比較金額（HKD，可空）", "Comparison amount (HKD, optional)", !canBilling)}
            <Field label={t("帳務主體", "Billing subject")}><select name="billing_subject" defaultValue={filters.billing_subject ?? ""}>
              <option value="">{t("個人及符合企業範圍的帳戶", "Personal and matching workspace accounts")}</option>
              <option value="personal">{t("只限個人", "Personal only")}</option>
              <option value="tenant">{t("只限企業", "Workspace only")}</option>
            </select></Field>
          </div>
          <p className="muted small-text">{t("按各自帳戶核對授信、已預留及到期贈額，不合併個人與企業資金。比較金額留空時，額度為零或負數視作不足；沒有可讀帳戶或賬務不一致不作分類。", "Checks each account's credit limit, reservations and expired credit without pooling personal/workspace funds. With no comparison amount, zero/negative available credit is insufficient. Unavailable or inconsistent accounts remain unclassified.")}</p>
        </fieldset>
        <p className="muted small-text">
          {t(
            "只顯示獲授權範圍內的確認扣費；預留及對賬中金額另行管理。",
            "Confirmed charges cover your authorized scope. Reservations and reconciliation are managed separately.",
          )}
        </p>
        <ErrorNotice error={error} />
        <div className="row-actions">
          <button
            className="button secondary"
            type="reset"
            onClick={() => {
              setError(null);
              onApply({});
            }}
          >
            {t("重設篩選", "Reset filters")}
          </button>
          <button className="button primary" type="submit">
            {t("套用篩選", "Apply filters")}
          </button>
        </div>
      </form>
    </details>
  );
}

/** Fetch every authorized cursor page before presenting a billing target list. */
export function useAdminTenantOptions(enabled: boolean) {
  const [state, setState] = useState<{
    data?: { items: any[] };
    error?: Error;
    loading: boolean;
  }>({ loading: enabled });
  useEffect(() => {
    if (!enabled) {
      setState({ loading: false });
      return;
    }
    const controller = new AbortController();
    setState({ loading: true });
    void (async () => {
      try {
        let cursor: string | null = null;
        const items: any[] = [],
          seen = new Set<string>();
        do {
          const page: { items: any[]; next_cursor: string | null } = await api<{
            items: any[];
            next_cursor: string | null;
          }>(
            "/v1/admin/tenants?limit=100" +
              (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
            { signal: controller.signal },
          );
          items.push(...page.items);
          cursor = page.next_cursor;
          if (cursor && seen.has(cursor))
            throw new Error("Pagination did not advance");
          if (cursor) seen.add(cursor);
        } while (cursor);
        if (!controller.signal.aborted)
          setState({ data: { items }, loading: false });
      } catch (error) {
        if (!controller.signal.aborted)
          setState({ error: error as Error, loading: false });
      }
    })();
    return () => controller.abort();
  }, [enabled]);
  return state;
}
