import { useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import type { CapabilityAccess } from "./capability-model";
import {
  BudgetControl,
  BudgetOperationDetail,
  BudgetState,
  budgetMoney,
} from "./budget-control";
import { ErrorNotice, Field, Modal, PageHeader, useData, useI18n } from "./ui";

export function AdminExternalBudgets({ access }: { access: CapabilityAccess }) {
  const { t } = useI18n(),
    [refresh, setRefresh] = useState(0),
    [tenant, setTenant] = useState(""),
    [project, setProject] = useState(""),
    [submitted, setSubmitted] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [selected, setSelected] = useState<any>(null),
    [configure, setConfigure] = useState(false),
    [scope, setScope] = useState<any>(null);
  const [connection, setConnection] = useState(""),
    [account, setAccount] = useState(""),
    [currency, setCurrency] = useState("HKD");
  const list = useData<{
    items: any[];
    next_cursor: string | null;
    data_mode: string;
  }>(
    access.has("admin.external_budget.read")
      ? `/v1/admin/external-budget/operations?limit=20${submitted}${cursor ? "&cursor=" + cursor : ""}`
      : null,
    refresh,
    5000,
  );
  const root = (row: any) =>
    `/v1/admin/tenants/${row.tenant_id}/projects/${row.project_id}/external-budget`;
  const uuidPattern =
    "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
  return (
    <>
      <PageHeader
        eyebrow="EXTERNAL ACTIONS. ACCOUNTABLE BY DESIGN."
        title={t("廣告預算控制", "Advertising budget control")}
        description={t(
          "按企業與項目管理確切預算策略、操作與回執。客戶逐次確認仍由其管理員完成；平台管理不會冒充客戶確認。",
          "Manage scoped budget policies, operations and receipts. Customer managers retain per-operation confirmation; platform administrators do not impersonate their approval.",
        )}
        action={
          <button
            className="button secondary"
            onClick={() => setRefresh((v) => v + 1)}
          >
            <RefreshCw size={16} />
            {t("重新整理", "Refresh")}
          </button>
        }
      />
      <section className="card">
        <form
          className="budget-form"
          onSubmit={(e) => {
            e.preventDefault();
            const q = new URLSearchParams();
            if (tenant) q.set("tenant_id", tenant);
            if (project) q.set("project_id", project);
            setSubmitted(q.size ? "&" + q.toString() : "");
            setCursor(null);
            setSelected(null);
          }}
        >
          <Field label={t("企業 ID（可選）", "Workspace ID (optional)")}>
            <input
              pattern={uuidPattern}
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
            />
          </Field>
          <Field label={t("項目 ID（可選）", "Project ID (optional)")}>
            <input
              pattern={uuidPattern}
              value={project}
              onChange={(e) => setProject(e.target.value)}
            />
          </Field>
          <button className="button secondary" type="submit">
            {t("套用範圍", "Apply scope")}
          </button>
        </form>
        <div className="row-actions">
          {access.has("admin.external_budget.policy.write") && (
            <button
              className="button secondary"
              onClick={() => setConfigure(true)}
            >
              <ShieldCheck size={16} />
              {t("設定項目預算策略", "Configure project budget policy")}
            </button>
          )}
        </div>
      </section>
      <ErrorNotice error={list.error} />
      {!list.error && (
        <section
          className="card budget-history"
          aria-label={t("預算操作目錄", "Budget operation directory")}
        >
          {list.data?.data_mode === "simulated" && (
            <p className="notice">
              {t(
                "合成帳戶與模擬操作，沒有真實廣告支出。",
                "Synthetic accounts and simulated operations; no real advertising spend.",
              )}
            </p>
          )}
          {list.data?.items.map((o) => (
            <button
              className="budget-history-row"
              key={o.id}
              onClick={() => setSelected(o)}
            >
              <span>
                <strong>{o.specification.before.name}</strong>
                <small>
                  {o.tenant_id} / {o.project_id}
                </small>
                <small>
                  {o.account_id} / {o.budget_id} · {o.id.slice(0, 8)}
                </small>
              </span>
              <span>
                <strong>
                  {o.specification.before.currency}{" "}
                  {budgetMoney(o.specification.desired_average_daily_micros)}
                </strong>
                <BudgetState state={o.state} />
              </span>
            </button>
          ))}
          {!list.data?.items.length && (
            <p className="muted">
              {t(
                "目前授權範圍沒有操作記錄。",
                "No operations in the current authorized scope.",
              )}
            </p>
          )}
          <div className="row-actions">
            {cursor && (
              <button className="text-button" onClick={() => setCursor(null)}>
                {t("第一頁", "First page")}
              </button>
            )}
            {list.data?.next_cursor && (
              <button
                className="text-button"
                onClick={() => setCursor(list.data!.next_cursor)}
              >
                {t("下一頁", "Next page")}
              </button>
            )}
          </div>
        </section>
      )}
      {selected && !list.error && (
        <Modal
          title={t("確切預算操作", "Exact budget operation")}
          onClose={() => setSelected(null)}
        >
          <BudgetOperationDetail
            root={root(selected)}
            id={selected.id}
            actorId={access.me.user.id}
            manage={access.has("admin.external_budget.resolve")}
            admin
            connection=""
            refresh={refresh}
            onChanged={() => setRefresh((v) => v + 1)}
          />
        </Modal>
      )}
      {configure && (
        <Modal
          title={t("選擇確切策略範圍", "Select exact policy scope")}
          onClose={() => {
            setConfigure(false);
            setScope(null);
          }}
        >
          {!scope ? (
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                setScope({
                  tenant_id: tenant,
                  project_id: project,
                  connection_id: connection,
                  account_id: account,
                  currency,
                });
              }}
            >
              <Field label={t("企業 ID", "Workspace ID")}>
                <input
                  required
                  pattern={uuidPattern}
                  value={tenant}
                  onChange={(e) => setTenant(e.target.value)}
                />
              </Field>
              <Field label={t("項目 ID", "Project ID")}>
                <input
                  required
                  pattern={uuidPattern}
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                />
              </Field>
              <Field
                label={t("Google Ads 連接 ID", "Google Ads connection ID")}
              >
                <input
                  required
                  pattern={uuidPattern}
                  value={connection}
                  onChange={(e) => setConnection(e.target.value)}
                />
              </Field>
              <Field
                label={t("已綁定的廣告帳戶 ID", "Bound advertiser account ID")}
              >
                <input
                  required
                  pattern="[1-9][0-9]{0,19}"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                />
              </Field>
              <Field label={t("帳戶幣種", "Account currency")}>
                <input
                  required
                  pattern="[A-Z]{3}"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                />
              </Field>
              <button className="button primary" type="submit">
                {t("核對範圍與目前策略", "Review scope & current policy")}
              </button>
            </form>
          ) : (
            <BudgetControl
              key={JSON.stringify(scope)}
              root={root(scope)}
              connection={scope.connection_id}
              accounts={[
                {
                  account_id: scope.account_id,
                  name: scope.account_id,
                  currency: scope.currency,
                },
              ]}
              actorId={access.me.user.id}
              admin
              policyAccess={access.has("admin.external_budget.policy.write")}
              resolveAccess={access.has("admin.external_budget.resolve")}
            />
          )}
        </Modal>
      )}
    </>
  );
}
