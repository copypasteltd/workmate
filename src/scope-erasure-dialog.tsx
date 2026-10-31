import { useEffect, useRef, useState } from "react";
import { post, clientSessionGeneration } from "./api";
import { completeOperation, operationKey } from "./operation-key";
import { ErrorNotice, Field, Loading, Modal, useData, useI18n } from "./ui";

export type ErasureTarget = { kind: "projects" | "tenants"; id: string; endpoint: string };
export function ScopeErasureDialog({ target, account, onClose, onAccepted }: {
  target: ErasureTarget; account: string; onClose: () => void; onAccepted: () => void;
}) {
  const { t } = useI18n(), preview = useData<any>(target.endpoint + "-preview");
  const [confirmation, setConfirmation] = useState(""), [reason, setReason] = useState("customer_request");
  const [irreversible, setIrreversible] = useState(false), [retention, setRetention] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<Error | null>(null);
  const live = useRef(true), submitted = useRef(false), current = useRef(target);
  current.current = target;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const ready = preview.data && !preview.error && !preview.data.requested && confirmation === preview.data.name && irreversible && retention;
  return <Modal title={t("永久刪除", "Permanently delete")} onClose={onClose}>
    {preview.loading && <Loading />}<ErrorNotice error={preview.error} />
    {preview.data && <form className="form-stack" onSubmit={async e => {
      e.preventDefault(); if (!ready || submitted.current) return;
      submitted.current = true; setBusy(true); setError(null);
      const generation = clientSessionGeneration(), chosen = target;
      const body = { confirmation, reason_code: reason, acknowledge_irreversible: true, acknowledge_retention: true };
      try {
        const key = await operationKey(account, chosen.endpoint, body);
        if (!live.current || current.current !== chosen || generation !== clientSessionGeneration()) return;
        await post(chosen.endpoint, body, key);
        await completeOperation(account, chosen.endpoint, body);
        if (live.current && current.current === chosen && generation === clientSessionGeneration()) onAccepted();
      } catch (e) { if (live.current) setError(e as Error); }
      finally { submitted.current = false; if (live.current) setBusy(false); }
    }}>
      <p><strong>{preview.data.name}</strong></p>
      <p>{t("確認後立即停止此範圍的新操作，並在背景清理內容與歷史版本，無法恢復。", "Confirmation immediately blocks new work in this scope. Content and historical versions are then removed in the background. This cannot be undone.")}</p>
      <p className="muted">{t("專案", "Projects")}: {preview.data.counts.projects} · {t("素材", "Assets")}: {preview.data.counts.assets} · {t("任務", "Tasks")}: {preview.data.counts.tasks} · {t("待結束執行", "Executions to close")}: {preview.data.counts.executions_to_close}</p>
      <p className="small-text">{t("帳務及審計記錄會保留；在途費用須完成核對。共用帳戶、仍被其他專案使用的檔案及客戶本機副本不在刪除範圍。舊備份恢復時必須重播刪除記錄。", "Billing and audit records are retained; in-flight charges must be reconciled. Shared accounts, files still used by other projects and customer-local copies are outside this deletion. Restoring old backups requires replaying deletion records.")}</p>
      {preview.data.requested ? <p role="status">{t("此範圍已進入永久清理，請查看清理記錄。", "Permanent cleanup has already been requested. Review the cleanup records.")}</p> : <>
        <Field label={t("刪除原因", "Reason")}><select value={reason} onChange={e => setReason(e.target.value)} disabled={busy}>
          <option value="customer_request">{t("客戶要求", "Customer request")}</option><option value="workspace_closure">{t("結束工作空間", "Workspace closure")}</option><option value="privacy_request">{t("私隱要求", "Privacy request")}</option>
        </select></Field>
        <Field label={t("輸入完整名稱以確認", "Type the exact name to confirm")}><input value={confirmation} onChange={e => setConfirmation(e.target.value)} maxLength={160} required autoComplete="off" disabled={busy} /></Field>
        <label className="checkbox-row"><input type="checkbox" checked={irreversible} onChange={e => setIrreversible(e.target.checked)} disabled={busy} /><span>{t("我了解永久刪除無法恢復", "I understand this deletion is irreversible")}</span></label>
        <label className="checkbox-row"><input type="checkbox" checked={retention} onChange={e => setRetention(e.target.checked)} disabled={busy} /><span>{t("我了解費用核對及資料保留範圍", "I understand reconciliation and retention limits")}</span></label>
        <ErrorNotice error={error} /><button className="button primary" type="submit" disabled={!ready || busy}>{busy ? t("正在提交", "Submitting") : t("確認永久刪除", "Confirm permanent deletion")}</button>
      </>}
    </form>}
  </Modal>;
}
