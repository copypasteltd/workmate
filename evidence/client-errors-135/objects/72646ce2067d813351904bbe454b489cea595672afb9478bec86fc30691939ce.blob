import { useEffect, useState } from "react";
import { api } from "./api";
import { ErrorNotice, Field, useI18n } from "./ui";

export type DirectoryFilters = Record<string, string>;
export function AdminDirectoryFilters({
  onApply,
  canUsage,
  canVip,
}: {
  onApply: (filters: DirectoryFilters) => void;
  canUsage: boolean;
  canVip: boolean;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<Error | null>(null);
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
          for (const key of ["period_from", "period_to"])
            if (filters[key])
              filters[key] = new Date(filters[key]).toISOString();
          if (
            filters.period_from &&
            filters.period_to &&
            Date.parse(filters.period_from) >= Date.parse(filters.period_to)
          ) {
            setError(
              new Error(
                t(
                  "結束時間必須晚於開始時間。",
                  "The end must follow the start.",
                ),
              ),
            );
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
                pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                title="UUID"
              />
            </Field>
          ))}
          <Field label={t("帳戶狀態", "Account state")}>
            <select name="state">
              <option value="">{t("全部狀態", "All states")}</option>
              <option value="active">{t("有效", "Active")}</option>
              <option value="frozen">{t("已凍結", "Frozen")}</option>
              <option value="closed">{t("已關閉", "Closed")}</option>
            </select>
          </Field>
          <Field label="VIP">
            <select name="vip" disabled={!canVip}>
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
            <select name="limit" defaultValue="50">
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </Field>
          <Field label={t("扣費開始（本機時間）", "Charges from (local time)")}>
            <input
              type="datetime-local"
              name="period_from"
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
              disabled={!canUsage}
            />
          </Field>
        </div>
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
