import { useState } from "react";
import { ScopeExportDialog, type ScopeExportTarget } from "./scope-export-dialog";
import { Field, useI18n } from "./ui";

export function AdminScopeExports({ account }: { account: string }) {
  const { t } = useI18n(), [kind, setKind] = useState("projects"), [id, setId] = useState("");
  const [target, setTarget] = useState<ScopeExportTarget | null>(null);
  return <section className="card"><h2>{t("範圍共享資料匯出", "Export shared scope data")}</h2>
    <p>{t("按內容記錄中的企業或專案 ID 選擇範圍；需要目前正文讀取及匯出權限與近期 MFA，專案拒絕仍會阻止整企業匯出。", "Choose the workspace or project ID shown in content records. Current body-read/export permissions and recent MFA are required; project denies also block workspace exports.")}</p>
    <form className="scope-export-admin-form" onSubmit={e => { e.preventDefault(); setTarget({ endpoint: `/v1/admin/scopes/${kind}/${id}/export`, id }); }}>
      <Field label={t("範圍", "Scope")}><select value={kind} onChange={e => setKind(e.target.value)}><option value="projects">{t("專案", "Project")}</option><option value="tenants">{t("企業", "Workspace")}</option></select></Field>
      <Field label={t("範圍 ID", "Scope ID")}><input required value={id} onChange={e => setId(e.target.value.trim())} pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" maxLength={36} /></Field>
      <button className="button secondary">{t("預覽匯出", "Preview export")}</button>
    </form>
    {target && <ScopeExportDialog key={target.endpoint} target={target} account={account} onClose={() => setTarget(null)} />}
  </section>;
}
