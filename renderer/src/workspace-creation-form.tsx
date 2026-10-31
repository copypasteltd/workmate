import { useState, useRef, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api, post, ApiError, clientSessionGeneration } from "./api";
import { useWorkspace } from "./context";
import { ErrorNotice, Field, useI18n } from "./ui";
import { beginWorkspaceAttempt, completeWorkspaceAttempt, loadWorkspaceAttempt, saveWorkspaceAttempt, workspaceFingerprint, type WorkspaceAttempt, type WorkspaceResult } from "./workspace-creation";

export function WorkspaceCreationForm({ owner }: { owner: string }) {
  const { t } = useI18n(), w = useWorkspace(), nav = useNavigate();
  const [initial] = useState(() => { try { return { attempt: loadWorkspaceAttempt(owner), error: null }; } catch (error) { return { attempt: null, error }; } });
  const [attempt, setAttempt] = useState<WorkspaceAttempt | null>(initial.attempt);
  const [error, setError] = useState<unknown>(initial.error), [busy, setBusy] = useState(false);
  const [name, setName] = useState(initial.attempt?.body?.name ?? ""), [projectName, setProjectName] = useState(initial.attempt?.body?.project_name ?? "");
  const live = useRef(true), submitting = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const terminal = attempt?.state === "removed" || attempt?.state === "unavailable";
  const persist = (a: WorkspaceAttempt) => { saveWorkspaceAttempt(a); setAttempt(a); };
  const submit = async () => {
    const generation = clientSessionGeneration();
    const current = () => { if (!live.current || generation !== clientSessionGeneration()) throw new ApiError("SESSION_CHANGED", "Sign-in state changed", 409); };
    if (submitting.current) return;
    submitting.current = true;
    let a = attempt;
    try {
      setBusy(true); setError(null);
      if (a && a.state !== "completed") {
        const receipt = await api<{ state: "not_found" | "in_progress" | "completed" | "removed" | "unavailable"; result?: WorkspaceResult }>(`/v1/workspace-creation-requests/${a.key}`);
        current();
        if (receipt.state === "in_progress") throw new Error(t("仍在建立中，請稍後再次確認。", "Your workspace is still being created. Check again shortly."));
        if (receipt.state === "removed" || receipt.state === "unavailable") { persist({ ...a, state: receipt.state, body: undefined, result: undefined }); return; }
        if (receipt.state === "completed" && receipt.result) { a = { ...a, state: "completed", result: receipt.result }; persist(a); }
      }
      if (!a || a.state === "pending") {
        const body = a?.body ?? { name: name.trim(), project_name: projectName.trim() };
        if (!body.name || !body.project_name) throw new Error(t("請輸入原來的企業及專案名稱。", "Enter the original workspace and project names."));
        if (a && await workspaceFingerprint(body) !== a.fingerprint) throw new Error(t("請填回首次提交的企業及專案名稱，以恢復原來的請求。", "Use the names from your first submission to recover that request."));
        current();
        a = a ?? await beginWorkspaceAttempt(owner, body, current);
        current(); setAttempt(a);
        const result = await post("/v1/tenants", body, a.key) as WorkspaceResult;
        current(); a = { ...a, state: "completed", result }; persist(a);
      }
      if (a.state !== "completed" || !a.result) return;
      // Reconcile using live authority, even when the browser held a previous successful response.
      const receipt = await api<{ state: string; result?: WorkspaceResult }>(`/v1/workspace-creation-requests/${a.key}`);
      current();
      if (receipt.state !== "completed" || !receipt.result) {
        if (receipt.state === "removed" || receipt.state === "unavailable") persist({ ...a, state: receipt.state, body: undefined, result: undefined });
        else throw new Error(t("暫未能確認工作區，請再次確認。", "Your workspace could not be confirmed yet. Check again."));
        return;
      }
      w.setTenant(receipt.result.tenant.id);
      if (receipt.result.project) w.setProject(receipt.result.project.id);
      else localStorage.removeItem("cp_project");
      await w.refresh(true);
      current(); completeWorkspaceAttempt(owner, a.key);
      nav("/app", { replace: true });
    } catch (e) {
      if (!live.current || generation !== clientSessionGeneration()) return;
      // Validation fails before any creation. All uncertain/server/session outcomes keep the same key.
      if (a?.state === "pending" && (e as any)?.status === 400 && ["VALIDATION_ERROR", "VALIDATION_FAILED"].includes((e as any)?.code)) {
        completeWorkspaceAttempt(owner, a.key); setAttempt(null);
      }
      setError(e);
    } finally { submitting.current = false; if (live.current && generation === clientSessionGeneration()) setBusy(false); }
  };
  return <form className="form" onSubmit={event => { event.preventDefault(); if (!busy && !initial.error && !terminal) void submit(); }}>
    {attempt && <div className="notice" role="status">{terminal
      ? t("此建立記錄目前無法使用。請返回現有工作區或聯絡管理員；我們不會重複建立。", "This creation record is no longer available. Return to your workspaces or contact an administrator.")
      : t("我們已保留這次建立記錄。繼續時會先確認結果，避免重複建立。", "Your creation request is saved. Continuing checks the original result before retrying.")}</div>}
    <Field label={t("企業 / 團隊名稱", "Company / team name")}><input name="name" value={name} onChange={e => setName(e.target.value)} readOnly={!!attempt?.body || terminal} disabled={busy} maxLength={160} required={!attempt} placeholder={t("例如：Harbour Studio", "e.g. Harbour Studio")} /></Field>
    <Field label={t("首個專案", "First project")}><input name="project_name" value={projectName} onChange={e => setProjectName(e.target.value)} readOnly={!!attempt?.body || terminal} disabled={busy} maxLength={160} required={!attempt} placeholder={t("例如：秋季品牌企劃", "e.g. Autumn brand campaign")} /></Field>
    <ErrorNotice error={error} />
    <button className="button primary" type="submit" disabled={busy || !!initial.error || terminal}>{busy ? t("正在確認…", "Checking…") : attempt ? t("確認並繼續", "Check & continue") : t("建立並進入工作台", "Create workspace & continue")}</button>
    {terminal && <Link className="text-link" to="/app">{t("返回工作台", "Return to workspace")}</Link>}
  </form>;
}
