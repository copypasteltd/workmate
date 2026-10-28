import { useState } from "react";
import { Archive, RefreshCw, ShieldCheck, Clock, ChevronRight } from "lucide-react";
import type { CapabilityAccess } from "./capability-model";
import { ErrorNotice, Modal, PageHeader, useData, useI18n } from "./ui";
import "./native-recovery.css";

type Receipt = { id: string; kind: string; outcome: string; snapshot_at: string | null; ledger_at: string | null;
  started_at: string; finished_at: string; file_count: number; plaintext_bytes: string; manifest_sha256: string | null; detail: Record<string, any> };
type Recovery = { checked_at: string; environment: { source_id: string; state: string }; backup_age_ms: number | null; ledger_age_ms: number | null;
  latest: Record<string, Receipt | null>; last_verified_backup: Receipt | null; items: Receipt[]; next_cursor: string | null;
  target_rpo_ms: number; target_rto_ms: number; production_recovery_qualified: boolean };

export function AdminNativeRecovery({ access }: { access: CapabilityAccess }) {
  const { t, locale } = useI18n(), [refresh, setRefresh] = useState(0), [kind, setKind] = useState(""), [cursor, setCursor] = useState<string | null>(null), [selected, setSelected] = useState<string | null>(null);
  const state = useData<Recovery>(access.has("admin.recovery.read") ? `/v1/admin/recovery?limit=12${kind ? "&kind=" + kind : ""}${cursor ? "&cursor=" + cursor : ""}` : null, refresh, 10000), data = state.data;
  const detail = data?.items.find(r => r.id === selected);
  const clock = (v: string | null) => v ? new Date(v).toLocaleString(locale === "en" ? "en-HK" : "zh-HK") : "—";
  const age = (v: number | null | undefined) => v == null ? t("尚無記錄", "No record") : t(`${Math.floor(v / 60000)} 分鐘`, `${Math.floor(v / 60000)} min`);
  const label = (k: string) => ({ backup: t("資料備份", "Data backup"), ledger: t("刪除日誌", "Erasure journal"), restore: t("恢復演練", "Recovery drill") }[k] ?? k);
  const outcome = (k: string) => ({ verified: t("完整校驗通過", "Fully verified"), failed: t("失敗", "Failed"), quarantined: t("已恢復・隔離中", "Restored · isolated"), incomplete: t("需繼續核查", "Review required") }[k] ?? k);
  return <>
    <PageHeader eyebrow="KEEP THE WORK. PRESERVE THE TRUST." title={t("備份與恢復", "Backup & recovery")}
      description={t("查看資料、檔案與刪除日誌的恢復準備情況。每次演練保持隔離，待核對工作與外部回執後再作服務恢復決策。", "See recovery readiness across data, files and erasure journals. Drills remain isolated while tasks and external receipts are reconciled.")}
      action={<button className="button secondary" onClick={() => { setSelected(null); setRefresh(v => v + 1); }}><RefreshCw size={16} />{t("重新整理", "Refresh")}</button>} />
    <ErrorNotice error={state.error} />
    {data && <div className="recovery-page" data-testid="recovery-page">
      <div className="recovery-metrics">
        <section className="card"><Archive size={22} /><p>{t("最近有效備份", "Last verified backup")}</p><strong>{age(data.backup_age_ms)}</strong>
          <span className={data.backup_age_ms !== null && data.backup_age_ms <= data.target_rpo_ms ? "recovery-good" : "recovery-review"}>{data.backup_age_ms !== null && data.backup_age_ms <= data.target_rpo_ms ? t("位於 15 分鐘目標內", "Within the 15 min target") : t("需要更新備份", "A fresh backup is needed")}</span>
          <small>{clock(data.last_verified_backup?.snapshot_at ?? null)}</small></section>
        <section className="card"><ShieldCheck size={22} /><p>{t("刪除日誌覆蓋", "Erasure journal coverage")}</p><strong>{age(data.ledger_age_ms)}</strong>
          <span className={data.ledger_age_ms !== null && data.ledger_age_ms < 120000 ? "recovery-good" : "recovery-review"}>{t("恢復時重新套用刪除記錄", "Deletion records are reapplied on restore")}</span><small>{clock(data.latest.ledger?.ledger_at ?? null)}</small></section>
        <section className="card"><Clock size={22} /><p>{t("最近恢復演練", "Last recovery drill")}</p><strong>{data.latest.restore ? outcome(data.latest.restore.outcome) : t("等待演練", "Awaiting a drill")}</strong>
          <span>{data.latest.restore?.detail.native_restore_ms != null ? t(`${(data.latest.restore.detail.native_restore_ms / 1000).toFixed(1)} 秒`, `${(data.latest.restore.detail.native_restore_ms / 1000).toFixed(1)} seconds`) : t("恢復時間目標 4 小時", "Recovery time target: 4 hours")}</span>
          <small>{t("隔離演練不等於正式環境通過驗收", "An isolated drill does not qualify production recovery")}</small></section>
      </div>
      <section className="card recovery-records">
        <div className="recovery-toolbar"><div><h2>{t("恢復憑證", "Recovery receipts")}</h2><p>{t("只顯示可核查的摘要與結果。", "Verifiable summaries and outcomes.")}</p></div>
          <label>{t("記錄類型", "Record type")}<select aria-label={t("記錄類型", "Record type")} value={kind} onChange={e => { setKind(e.target.value); setCursor(null); setSelected(null); }}>
            <option value="">{t("全部類型", "All types")}</option>{["backup", "ledger", "restore"].map(k => <option key={k} value={k}>{label(k)}</option>)}
          </select></label></div>
        {data.items.length === 0 ? <p className="recovery-empty">{t("尚無恢復憑證。由部署負責人執行原生備份與恢復命令後，結果會顯示在此處。", "No recovery receipts yet. Results appear after your deployment operator runs the native backup and recovery commands.")}</p> :
          <div className="recovery-list">{data.items.map(row => <button key={row.id} className="recovery-row" onClick={() => setSelected(row.id)}>
            <span className="recovery-kind"><Archive size={18} />{label(row.kind)}</span><span><b>{outcome(row.outcome)}</b><small>{clock(row.finished_at)}</small></span>
            <span>{row.file_count.toLocaleString()} {t("個檔案", "files")}<small>{(BigInt(row.plaintext_bytes) / 1024n).toLocaleString()} KiB</small></span><ChevronRight size={18} />
          </button>)}</div>}
        <div className="recovery-pagination"><small>{t("檢查時間", "Checked")} {clock(data.checked_at)}</small>
          {cursor && <button className="button secondary" onClick={() => { setCursor(null); setSelected(null); }}>{t("回到最新", "Latest records")}</button>}
          {data.next_cursor && <button className="button secondary" onClick={() => { setCursor(data.next_cursor); setSelected(null); }}>{t("較早記錄", "Older records")}</button>}</div>
      </section>
    </div>}
    {!data && state.loading && <p role="status">{t("正在核查恢復準備情況…", "Checking recovery readiness…")}</p>}
    {detail && <Modal title={label(detail.kind) + " · " + outcome(detail.outcome)} onClose={() => setSelected(null)}>
      <dl className="recovery-detail"><dt>{t("憑證 ID", "Receipt ID")}</dt><dd>{detail.id}</dd><dt>{t("資料快照", "Data snapshot")}</dt><dd>{clock(detail.snapshot_at)}</dd>
        <dt>{t("刪除日誌覆蓋至", "Erasure journal observed through")}</dt><dd>{clock(detail.ledger_at)}</dd><dt>{t("完成時間", "Completed")}</dt><dd>{clock(detail.finished_at)}</dd>
        <dt>SHA-256</dt><dd>{detail.manifest_sha256 ?? "—"}</dd>
        {detail.kind === "restore" && <><dt>{t("未完成刪除工作", "Unfinished erasures")}</dt><dd>{detail.detail.erasure_jobs_remaining ?? "—"}</dd><dt>{t("待核對任務", "Tasks awaiting review")}</dt><dd>{detail.detail.tasks_inflight ?? "—"}</dd>
          <dt>{t("資料快照與故障時間差", "Snapshot-to-incident gap")}</dt><dd>{age(detail.detail.snapshot_gap_ms)}</dd><dt>{t("刪除日誌與故障時間差", "Erasure journal gap")}</dt><dd>{age(detail.detail.ledger_gap_ms)}</dd></>}
      </dl><p className="notice">{detail.kind === "restore" ? t("執行保持隔離，工作、付款及廣告操作不會自動重播。", "Execution remains isolated. Tasks, payments and advertising operations are not automatically replayed.") : t("備份完整性經驗證；正式服務恢復仍須獨立演練與核准。", "Backup integrity is verified. Production service recovery requires its own exercise and review.")}</p>
    </Modal>}
  </>;
}
