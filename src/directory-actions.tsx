import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { post, clientSessionGeneration } from "./api";
import { operationKey, completeOperation } from "./operation-key";
import { ErrorNotice, Field, Loading, Modal, useData, useI18n } from "./ui";

export type DirectoryAction = { type: "users" | "tenants"; action: "create" | "delete" | "status"; targets?: any[] };
export function DirectoryCommandFacts({ command, before }: { command: any; before?: any[] }) {
  const { t } = useI18n();
  const labels: Record<string, [string, string]> = {
    "users.create": ["新建用戶", "Create user"], "tenants.create": ["新建企業", "Create workspace"],
    "users.delete": ["刪除用戶", "Delete users"], "tenants.delete": ["刪除企業", "Delete workspaces"],
    "users.status": ["變更用戶狀態", "Change user statuses"], "tenants.status": ["變更企業狀態", "Change workspace statuses"],
  };
  return <div className="form-stack">
    <p><strong>{labels[command.action] ? t(...labels[command.action]) : t("管理操作", "Administrative operation")}</strong> · {t("所選記錄", "Selected records")}: {command.targets?.length ?? 1}</p>
    {command.email && <p>{command.display_name} · {command.email}</p>}
    {command.owner_id && <p>{command.name} · {t("擁有人", "Owner")}: <code>{command.owner_id}</code> · {command.project_name}</p>}
    {command.state && <p>{t("目標狀態", "Target state")}: {command.state}</p>}
    {!!before?.length && <ul className="directory-targets">{before.map(r => <li key={r.id}>{r.name} <code>{r.id}</code> · v{r.version}</li>)}</ul>}
    <p>{t("原因", "Reason")}: {command.reason}</p>
  </div>;
}

export function DirectoryCommandDialog({ chosen, account, onClose, onDone }: {
  chosen: DirectoryAction; account: string; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [displayName, setName] = useState(""), [address, setAddress] = useState("");
  const [owner, setOwner] = useState(""), [ownerSearch, setOwnerSearch] = useState("");
  const [project, setProject] = useState(t("首個專案", "First project"));
  const [reason, setReason] = useState(""), [state, setState] = useState("active");
  const [confirmation, setConfirmation] = useState(""), [retention, setRetention] = useState(false);
  const [preview, setPreview] = useState<any>(null), [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<Error | null>(null);
  const live = useRef(true), submitted = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const creating = chosen.action === "create", deleting = chosen.action === "delete", users = chosen.type === "users";
  const owners = useData<any>(creating && !users ? "/v1/admin/users?view=operations&state=active&limit=50" + (ownerSearch.trim() ? "&q=" + encodeURIComponent(ownerSearch.trim()) : "") : null);
  const count = chosen.targets?.length ?? 1;
  const ready = reason.trim().length >= 3 && (!creating || (displayName.trim() && (users ? address.trim() : owner && project.trim()))) &&
    (!deleting || (retention && confirmation === "DELETE " + count));
  const title = creating ? users ? t("新建用戶", "Create user") : t("新建企業", "Create workspace") :
    deleting ? t("刪除所選記錄", "Delete selected records") : t("批次變更狀態", "Change selected statuses");
  const command = () => ({ action: chosen.type + "." + chosen.action, reason: reason.trim(),
    ...(creating ? users ? { email: address, display_name: displayName } : { name: displayName, owner_id: owner, project_name: project } :
      { targets: chosen.targets!.map(r => ({ id: r.id, version: r.version })), ...(deleting ? { acknowledge_retention: true } : { state }) }) });
  async function run(commit: boolean) {
    if (submitted.current || !ready) return;
    submitted.current = true; setBusy(true); setError(null);
    const generation = clientSessionGeneration(), current = () => live.current && generation === clientSessionGeneration();
    try {
      if (!commit) {
        const p = await post("/v1/admin/directory/preview", command());
        if (current()) setPreview(p);
      } else {
        const path = "/v1/admin/directory/commands", body = { preview_id: preview.id, payload_hash: preview.payload_hash };
        const key = await operationKey(account, path, body);
        if (!current()) return;
        const r = await post(path, body, key);
        await completeOperation(account, path, body);
        if (current()) setResult(r);
      }
    } catch (e) { if (current()) setError(e as Error); }
    finally { submitted.current = false; if (current()) setBusy(false); }
  }
  return <Modal title={title} onClose={busy ? () => {} : onClose}>
    {result ? <div className="form-stack" role="status">
      <p>{result.state === "pending_approval" ? t("已提交審批，尚未變更資料。", "Submitted for review. Records have not changed.") :
        chosen.action === "delete" && !users ? t("所選企業已停止新操作，正在背景永久清理。", "Selected workspaces are fenced and permanent cleanup is running in the background.") : t("操作已完成，審計記錄已保存。", "Operation completed and audit records saved.")}</p>
      <p><code>{result.id}</code></p>
      {result.result?.items && <ul>{result.result.items.map((r: any) => <li key={r.id}><code>{r.id}</code> · {r.state}{r.deletion_job_id && <> · <Link to="/content" onClick={onDone}>{t("查看清理記錄", "View cleanup records")}</Link></>}</li>)}</ul>}
      {result.state === "pending_approval" && <Link to={"/audit?view=approvals&search=" + result.id} onClick={onDone}>{t("查看審批", "View review")}</Link>}
      <button className="button primary" onClick={onDone}>{t("完成並重新整理", "Done and refresh")}</button>
    </div> : <form className="form-stack" onSubmit={e => { e.preventDefault(); void run(!!preview); }}>
      {preview ? <>
        <DirectoryCommandFacts command={preview.command} before={preview.before} />
        {preview.retention && <p className="notice">{users ? t("刪除登入身份及個人資料；保留共用企業內容、帳務與審計。該郵箱日後可經驗證註冊為新身份。", "Remove sign-in identity and profile; retain shared workspace content, billing and audit. The email can later verify and register a new identity.") : t("立即停止企業新操作，並在背景永久清理內容。帳務、審計與全域用戶帳戶保留。", "Immediately fence the workspace and permanently clean content in the background. Billing, audit and global user accounts are retained.")}</p>}
        <p>{preview.approval ? t("按目前策略，提交後需由其他管理員審批。", "Current policy requires another administrator to review this request.") : t("確認後直接執行並記錄審計。", "Confirmation executes directly and records the audit.")}</p>
        <p className="muted">{t("預覽有效期五分鐘。所選記錄會原子提交；任一記錄變更或不符合條件時整批不執行。", "Preview expires in five minutes. The selection is committed atomically; if any record changes or becomes ineligible, no records are changed.")}</p>
      </> : <>
        {creating ? <>
          <Field label={users ? t("顯示名稱", "Display name") : t("企業名稱", "Workspace name")}><input autoFocus required maxLength={160} value={displayName} onChange={e => setName(e.target.value)} /></Field>
          {users ? <><Field label={t("電郵", "Email")}><input required type="email" maxLength={254} value={address} onChange={e => setAddress(e.target.value)} /></Field><p className="muted">{t("建立一般用戶。登入時仍須驗證電郵，不會授予管理員權限。", "Creates an ordinary user. Email verification is required at sign-in; no administrator access is granted.")}</p></> : <>
            <Field label={t("搜尋擁有人", "Find owner")}><input value={ownerSearch} maxLength={160} onChange={e => { setOwnerSearch(e.target.value); setOwner(""); }} placeholder={t("名稱或有權查閱的郵箱", "Name or authorized email")} /></Field>
            <ErrorNotice error={owners.error} />{owners.loading && <Loading />}
            <Field label={t("擁有人", "Owner")}><select required value={owner} onChange={e => setOwner(e.target.value)}><option value="">{t("選擇有效用戶", "Choose an active user")}</option>{owners.data?.items?.map((u: any) => <option key={u.id} value={u.id}>{u.display_name} · {u.id.slice(0, 8)}</option>)}</select></Field>
            <Field label={t("首個專案名稱", "First project name")}><input required maxLength={160} value={project} onChange={e => setProject(e.target.value)} /></Field>
            <p className="muted">{t("同時建立企業、擁有人、帳務帳戶及首個專案。", "Creates the workspace, owner membership, billing account and first project together.")}</p>
          </>}
        </> : <>
          <p>{t("只處理明確選取的", "Only the explicitly selected")} <strong>{count}</strong> {t("項記錄。", "records will be processed.")}</p>
          <ul className="directory-targets">{chosen.targets!.map(r => <li key={r.id}>{r.display_name ?? r.name} <code>{r.id}</code></li>)}</ul>
          {!deleting && <Field label={t("目標狀態", "Target state")}><select value={state} onChange={e => setState(e.target.value)}><option value="active">{t("啟用", "Activate")}</option><option value={users ? "frozen" : "suspended"}>{users ? t("凍結並撤銷登入", "Freeze and revoke sign-in") : t("暫停企業", "Suspend workspace")}</option></select></Field>}
          {deleting && <>
            <p className="notice">{t("刪除無法復原。用戶須先移交最後擁有人身份並結清在途任務；企業內容將進入永久清理。帳務及審計保留。", "Deletion is irreversible. Users must transfer last ownership and reconcile outstanding work first; workspace content enters permanent cleanup. Billing and audit are retained.")}</p>
            <Field label={t("輸入", "Type") + " DELETE " + count}><input autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} required /></Field>
            <label className="checkbox-row"><input type="checkbox" checked={retention} onChange={e => setRetention(e.target.checked)} /><span>{t("我已核對選取範圍，並了解永久刪除及資料保留安排。", "I checked the selection and understand permanent deletion and retention.")}</span></label>
          </>}
        </>}
        <Field label={t("操作原因", "Reason")}><textarea required minLength={3} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      </>}
      <ErrorNotice error={error} />
      <div className="row-actions">{preview && <button className="button" type="button" disabled={busy} onClick={() => { setPreview(null); setError(null); }}>{t("返回修改／重新預覽", "Edit / refresh preview")}</button>}
        <button className={"button " + (deleting ? "danger" : "primary")} type="submit" disabled={busy || !ready}>{busy ? t("正在處理", "Working") : preview ? t("確認提交", "Confirm") : t("預覽影響", "Preview impact")}</button></div>
    </form>}
  </Modal>;
}
