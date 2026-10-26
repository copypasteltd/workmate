import { Link } from "react-router-dom";
import { Badge, ErrorNotice, Modal, useData, useI18n } from "./ui";
import "./connections.css";
type Detail = {
  name: string;
  tenant_id: string;
  project_id: string;
  project_ids: string[];
  source_mode: string;
  api_version: string;
  catalog_state: string;
  scopes: string[];
  last_sync_at: string | null;
  connection: {
    id: string;
    state: string;
    version: number;
    auth_version: number;
    account_ids: string[];
  };
  jobs: {
    id: string;
    kind: string;
    status: string;
    row_count: number;
    page_count: number;
    error_code: string | null;
    created_at: string;
  }[];
  snapshots: {
    id: string;
    project_id: string;
    state: string;
    row_count: number;
    captured_at: string;
    data_as_of: null;
    asset_id: string;
    limitations: string[];
  }[];
};
export function AdminConnectionDetail({
  id,
  onClose,
  canReadBody,
}: {
  id: string;
  onClose: () => void;
  canReadBody: boolean;
}) {
  const { t } = useI18n(),
    { data: d, error } = useData<Detail>(
      `/v1/admin/connections/${id}/detail`,
      0,
      3000,
    );
  return (
    <Modal
      title={t("連接與同步記錄", "Connection & sync history")}
      onClose={onClose}
    >
      <ErrorNotice error={error} />
      {d && (
        <div className="connector-admin-detail">
          <h2>{d.name}</h2>
          <Badge value={d.connection.state} />
          <p className="muted">
            {d.source_mode === "simulated"
              ? t("合成資料", "Synthetic data")
              : t("已設定的供應商服務", "Configured provider service")}{" "}
            · {d.api_version}
          </p>
          <dl className="preview-details">
            <dt>{t("連接 ID", "Connection ID")}</dt>
            <dd>
              <code>{d.connection.id}</code>
            </dd>
            <dt>{t("企業 / 項目", "Company / project")}</dt>
            <dd>
              {d.tenant_id}
              <br />
              {d.project_id}
            </dd>
            <dt>{t("帳戶範圍", "Account scope")}</dt>
            <dd>{d.connection.account_ids.join(", ") || "—"}</dd>
            <dt>{t("項目範圍", "Project scope")}</dt>
            <dd>{d.project_ids.join(", ") || "—"}</dd>
            <dt>{t("目錄 / 綁定版本", "Discovery / binding version")}</dt>
            <dd>
              {d.catalog_state} · {d.connection.version}
            </dd>
            <dt>{t("授權版本", "Authorization version")}</dt>
            <dd>{d.connection.auth_version}</dd>
            <dt>{t("已授予 scope", "Granted scopes")}</dt>
            <dd>{d.scopes.join(" · ")}</dd>
            <dt>{t("最近同步", "Last synchronization")}</dt>
            <dd>
              {d.last_sync_at ? new Date(d.last_sync_at).toLocaleString() : "—"}
            </dd>
            <dt>{t("供應商數據截止時間", "Provider data cutoff")}</dt>
            <dd>{t("供應商未提供", "Not supplied by provider")}</dd>
          </dl>
          <h3>{t("最近同步作業", "Recent sync jobs")}</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("作業", "Job")}</th>
                  <th>{t("狀態", "State")}</th>
                  <th>{t("頁 / 行", "Pages / rows")}</th>
                  <th>{t("錯誤", "Error")}</th>
                </tr>
              </thead>
              <tbody>
                {d.jobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      {j.kind}
                      <br />
                      <code>{j.id.slice(0, 8)}</code>
                    </td>
                    <td>
                      <Badge value={j.status} />
                    </td>
                    <td>
                      {j.page_count} / {j.row_count}
                    </td>
                    <td>{j.error_code ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>{t("快照內容管理", "Snapshot content management")}</h3>
          {d.snapshots.length ? (
            d.snapshots.map((s) => (
              <div
                className="card"
                key={s.id}
                style={{ padding: 16, marginBottom: 12 }}
              >
                <Badge value={s.state} />
                <p>
                  {s.row_count} {t("行", "rows")} ·{" "}
                  {new Date(s.captured_at).toLocaleString()}
                </p>
                <code>{s.id}</code>
                <p className="muted small-text">{s.limitations.join(" · ")}</p>
                {canReadBody && (
                  <Link
                    to={`/content?search=${s.asset_id}`}
                    onClick={onClose}
                    className="text-button"
                  >
                    {t(
                      "前往內容面板審查來源正文",
                      "Review source content in the content panel",
                    )}
                  </Link>
                )}
              </div>
            ))
          ) : (
            <p className="muted">{t("尚無快照", "No snapshots yet")}</p>
          )}
        </div>
      )}
    </Modal>
  );
}
