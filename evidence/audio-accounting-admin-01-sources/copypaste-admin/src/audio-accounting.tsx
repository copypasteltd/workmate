import { useState } from "react";
import { api } from "./api";
import { operationKey, completeOperation } from "./operation-key";
import { formatHKD } from "./financial-money";
import { audioEvidenceInput } from "./audio-accounting-model";
import type { CapabilityAccess } from "./capability-model";
import { AsyncForm, DateText, ErrorNotice, Field, Loading, useData, useI18n } from "./ui";

const root = "/v1/admin/ai/audio-accounting";
type Props = { access: CapabilityAccess; revision: number; onDone: () => void; onCommand: (command: any) => void };

export function AudioAccountingRecord({ channel, id, access, revision, onCommand }: Props & { channel: string; id: string }) {
  const { t } = useI18n(), [opened, setOpened] = useState(false), [local, setLocal] = useState(0);
  const [evidence, setEvidence] = useState<any>(null), [error, setError] = useState<unknown>(null);
  const path = `${root}/${channel}/${id}`, result = useData(opened ? path : null, revision + local);
  const r = result.data, canWrite = access.has("admin.ai.evidence.write") && access.has("admin.ai.cost.read");
  return <details data-audio-accounting={id} onToggle={e => setOpened(e.currentTarget.open)}>
    <summary>{t("費用與終止對帳", "Cost & termination accounting")}</summary>
    <ErrorNotice error={result.error ?? error} />{result.loading && <Loading />}
    {r && <>
      <dl className="key-value">
        <dt>{t("原操作", "Original operation")}</dt><dd><code>{r.operation_id}</code></dd>
        <dt>{t("模型／原始結果", "Model / original outcome")}</dt><dd>{r.model_alias} · {r.state}</dd>
        <dt>{t("容量", "Capacity")}</dt><dd>{r.capacity_held ? t("仍佔用", "Still held") : t("已釋放", "Released")}</dd>
        {r.cost && <><dt>{t("已確認費用", "Confirmed cost")}</dt><dd>{r.cost.amount_micros === null ? t("待確認", "Unconfirmed") : formatHKD(r.cost.amount_micros)} · {r.cost.source === "human_evidence" ? t("人工證據獨立確認", "Independently confirmed human evidence") : r.cost.state}</dd>
          <dt>{t("原費率／報價", "Original rate / quote")}</dt><dd>{formatHKD(r.cost.rate_micros)} / {r.pricing_unit} · {formatHKD(r.cost.quoted_micros)}</dd></>}
      </dl>
      <p className="muted">{t("證據只作費用及終止核對。原請求不會重送，原媒體與驗證結果會保留。兩項操作分別需要另一位管理員批准；證據提交者也不能審批。", "Evidence supports cost and termination accounting. The original request is never replayed and media qualification is preserved. Each action needs an independent administrator; the evidence author cannot approve.")}</p>
      {r.cost?.allocation_exceeded && <p className="notice error">{t("已確認費用超出原報價；此預算已封鎖。", "Confirmed cost exceeds the original quote; this budget is blocked.")}</p>}
      {r.cost?.accounting_resolved && <p className="notice">{t("費用及容量已完成對帳，原業務結果仍保留。", "Cost and capacity accounting is complete; the original business outcome is retained.")}</p>}
      {canWrite && r.state === "unknown" && <details><summary>{t("提交原請求的外部證據", "Submit external evidence for the original request")}</summary>
        <AsyncForm submitLabel={t("保留不可改寫的證據", "Save immutable evidence")} onSubmit={async form => {
          const body = audioEvidenceInput(r, form), route = path + "/evidence";
          await api(route, { method: "POST", headers: { "Idempotency-Key": await operationKey(access.me.user.id, "audio-evidence:" + route, body) }, body: JSON.stringify(body) });
          await completeOperation(access.me.user.id, "audio-evidence:" + route, body); setLocal(n => n + 1);
        }}>
          <div className="provider-form-grid">
            <Field label={t("供應商參考", "Provider reference")}><input name="provider_reference" required minLength={3} maxLength={300} /></Field>
            <Field label={t("來源引用", "Source reference")}><input name="source_reference" required minLength={3} maxLength={500} /></Field>
            <Field label={t("實際證據時間（本地時間）", "Actual observation (local time)")}><input name="observed_at" type="datetime-local" step="1" required /></Field>
            <Field label={t("最終狀態", "Final provider outcome")}><select name="outcome"><option value="failed">{t("失敗", "Failed")}</option><option value="completed">{t("已完成", "Completed")}</option><option value="cancelled">{t("已取消", "Cancelled")}</option><option value="not_executed">{t("未執行", "Not executed")}</option></select></Field>
            <Field label={t("最終計費量", "Final billable units")}><input name="billable_units" inputMode="numeric" pattern="[0-9]+" required /></Field>
            <Field label={t("來源帳單（HKD）", "Source invoice (HKD)")}><input name="invoice_hkd" inputMode="decimal" required /></Field>
          </div>
          <Field label={t("證據說明", "Evidence statement")}><textarea name="source_note" minLength={10} maxLength={8000} required /></Field>
          <Field label={t("提交原因", "Submission reason")}><textarea name="reason" minLength={3} maxLength={1000} required /></Field>
          <label className="checkbox"><input type="checkbox" name="terminated" required />{t("我已核對原請求已終止的外部證據。", "I have reviewed external evidence that this original request has terminated.")}</label>
        </AsyncForm></details>}
      {r.evidence?.map((e: any) => <section className="provider-video-cost" key={e.id} data-audio-evidence={e.id}>
        <p><code>{e.id}</code> · <DateText value={e.created_at} /></p><p>{e.reason}</p>
        <button className="button secondary" onClick={() => { setError(null); void api("/v1/admin/ai/audio-evidence/" + e.id).then(setEvidence).catch(setError); }}>{t("讀取證據", "Read evidence")}</button>
        {[["ai.cost.reconcile", !r.cost?.confirmation_id, t("預覽費用確認", "Preview cost confirmation")],
          ["ai.capacity.release", r.capacity_held && !r.termination_confirmation_id, t("預覽容量釋放", "Preview capacity release")]].map(([action, available, label]) =>
          available && access.has("admin." + action) && <AsyncForm key={String(action)} submitLabel={String(label)} onSubmit={async form => onCommand({ action, channel, request_id: id, evidence_id: e.id, reason: String(form.get("reason")) })}>
            <Field label={t("本次操作原因", "Reason for this action")}><input name="reason" minLength={3} maxLength={1000} required /></Field>
          </AsyncForm>)}
      </section>)}
      {evidence && <details open><summary>{t("原始人工證據（已審計）", "Original human evidence (audited)")}</summary><pre className="provider-audio-body">{JSON.stringify(evidence, null, 2)}</pre>
        <button className="text-button" onClick={() => setEvidence(null)}>{t("收起證據", "Close evidence")}</button></details>}
    </>}
  </details>;
}

export function AudioAccountingQueue(props: Props) {
  const { t } = useI18n(), [channel, setChannel] = useState("audio_validation"), [filters, setFilters] = useState<Record<string, string>>({ state: "unknown" });
  const [cursors, setCursors] = useState<string[]>([]);
  const query = new URLSearchParams({ channel, ...filters, limit: "10", ...(cursors.length ? { cursor: cursors.at(-1)! } : {}) });
  const result = useData(root + "?" + query, props.revision);
  return <section className="provider-card" aria-label={t("音訊費用對帳", "Audio accounting")}>
    <h2>{t("音訊費用與容量對帳", "Audio cost and capacity accounting")}</h2>
    <form className="form-stack" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget), next: Record<string, string> = {};
      for (const key of ["state", "capacity_state", "cost_state", "tenant_id", "project_id", "task_id", "release_id", "validation_id"])
        if (String(f.get(key) ?? "").trim()) next[key] = String(f.get(key)).trim();
      setFilters(next); setChannel(String(f.get("channel"))); setCursors([]);
    }}><div className="provider-form-grid">
      <Field label={t("費用歸屬", "Funding")}><select name="channel" defaultValue={channel}><option value="audio_validation">{t("平台模型驗證", "Platform model validation")}</option><option value="audio_customer">{t("客戶音訊作業", "Customer audio jobs")}</option></select></Field>
      <Field label={t("原始狀態", "Original state")}><select name="state" defaultValue="unknown"><option value="">{t("全部", "All")}</option>{["unknown", "completed", "cancelled", "prepared", "dispatched"].map(s => <option key={s}>{s}</option>)}</select></Field>
      <Field label={t("容量狀態", "Capacity state")}><select name="capacity_state"><option value="">{t("全部", "All")}</option><option value="held">{t("仍佔用", "Held")}</option><option value="released">{t("已釋放", "Released")}</option></select></Field>
      {props.access.has("admin.ai.cost.read") && <Field label={t("費用狀態", "Cost state")}><select name="cost_state"><option value="">{t("全部", "All")}</option><option value="unknown">{t("待確認", "Unconfirmed")}</option><option value="manually_confirmed">{t("人工確認", "Manually confirmed")}</option><option value="known">{t("服務已知", "Observed")}</option></select></Field>}
      {["tenant_id", "project_id", "task_id", "release_id", "validation_id"].map(key => <Field label={key} key={key}><input name={key} pattern="[a-fA-F0-9-]{36}" /></Field>)}
    </div><button className="button secondary">{t("篩選對帳記錄", "Filter accounting records")}</button></form>
    <ErrorNotice error={result.error} />{result.loading && <Loading />}
    {result.data?.items.map((r: any) => <article className="provider-video-cost" key={r.id}>
      <p>{r.model_alias} · <code>{r.id}</code> · {r.data_mode}</p>
      <AudioAccountingRecord {...props} id={r.id} channel={r.channel} />
    </article>)}
    {result.data?.items.length === 0 && <p className="muted">{t("此範圍沒有對帳記錄。", "No accounting records in this scope.")}</p>}
    <div className="provider-pagination"><button className="button secondary" disabled={!cursors.length} onClick={() => setCursors(c => c.slice(0, -1))}>{t("上一頁", "Previous")}</button>
      <button className="button secondary" disabled={!result.data?.next_cursor} onClick={() => setCursors(c => [...c, result.data.next_cursor])}>{t("下一頁", "Next")}</button>
      <button className="text-button" onClick={() => { setCursors([]); props.onDone(); }}>{t("重新載入最新", "Reload latest")}</button></div>
  </section>;
}
