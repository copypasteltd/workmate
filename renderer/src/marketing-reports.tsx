import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, FileText, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { api, post, download } from "./api";
import { ErrorNotice, Field, Loading, Modal, useData, useI18n } from "./ui";

import { AnalysisReview } from "./analysis-review";
import { AnalysisHistoryControls, useAnalysisHistory } from "./analysis-history";
import { useWorkspace } from "./context";
import { metricLabel } from "./analysis-review-model";
import { readAnalysisPending, keepAnalysisPending, forgetAnalysisPending, uncertainAnalysisResult, type AnalysisPending } from "./analysis-request-state";

const metricNames = [
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "conversion_value",
  "ctr",
  "cpc",
  "cpm",
  "cvr",
  "cpa",
  "roas",
];
const dates = (items: any[]) =>
  items
    .flatMap((d) => [
      d.import_spec?.date_range?.from,
      d.import_spec?.date_range?.to,
    ])
    .filter(Boolean)
    .sort();
export function MarketingReports({
  base,
  tenant,
  project,
  datasets,
}: {
  base: string;
  tenant: string;
  project: string;
  datasets: any[];
}) {
  const { t } = useI18n(),
    [refresh, setRefresh] = useState(0),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  const list = useAnalysisHistory(base + "/analysis/reports", refresh, 5000);
  useEffect(() => { setSelected(null); }, [base, list.page, list.search]);
  const id = selected ?? list.data?.items[0]?.id;
  const detail = useData(
    id ? base + "/analysis/reports/" + id : null,
    refresh,
    3000,
  );
  const [error, setError] = useState<unknown>(null),
    [evidence, setEvidence] = useState<any>(null);
  const evidenceRequest = useRef(0);
  useEffect(() => {
    evidenceRequest.current++;
    setEvidence(null);
    return () => {
      evidenceRequest.current++;
    };
  }, [id, detail.error, list.error]);
  const data = detail.data,
    report = data?.report;
  const state = (s: string) =>
    s === "ready"
      ? t("可下載", "Ready")
      : s === "failed"
        ? t("未完成", "Failed")
        : s === "running"
          ? t("分析中", "Running")
          : t("排隊中", "Queued");
  const refs = new Map<string, any>(
    (data?.calculation?.evidence || []).map((e: any) => [e.id, e]),
  );
  const readEvidence = async (id: string) => {
    const request = ++evidenceRequest.current;
    setError(null);
    setEvidence(null);
    try {
      const result = await api("/v1/evidence/" + id, {
        headers: { "X-Tenant-ID": tenant },
      });
      if (evidenceRequest.current === request) setEvidence(result);
    } catch (e) {
      if (evidenceRequest.current === request) setError(e);
    }
  };
  function prose(text: string) {
    const output: ReactNode[] = [];
    let offset = 0;
    for (const m of text.matchAll(/\{\{([a-f0-9-]{36})\}\}/g)) {
      output.push(text.slice(offset, m.index));
      const e = refs.get(m[1]);
      output.push(
        <button
          className="text-button report-evidence-link"
          key={m.index}
          onClick={() => void readEvidence(m[1])}
        >
          {e?.value === null ? t("未知", "Unknown") : e?.value} {e?.unit}
        </button>,
      );
      offset = m.index! + m[0].length;
    }
    output.push(text.slice(offset));
    return output;
  }
  return (
    <section
      className="card analysis-reports"
      aria-label={t("證據報告", "Evidence reports")}
    >
      <div className="section-title">
        <div>
          <p className="eyebrow">FROM FACTS TO A FROZEN REPORT.</p>
          <h2>{t("證據報告", "Evidence reports")}</h2>
        </div>
        <button
          className="button secondary"
          disabled={!datasets.some((d) => d.spec_hash)}
          onClick={() => setOpen(true)}
        >
          <Plus size={16} />
          {t("建立分析報告", "Create analysis report")}
        </button>
      </div>
      <p className="muted">
        {t(
          "選擇快照和比較區間，由分析師解讀工具計算結果。報告只供你查看，保留獨立的幣種、來源和歸因口徑。",
          "Choose snapshots and comparison dates. Your analyst interprets calculated facts in a private report, keeping currencies, sources and attribution separate.",
        )}
      </p>
      <AnalysisHistoryControls history={list} label={t("搜尋私人報告", "Search private reports")} />
      <ErrorNotice error={list.error ?? detail.error ?? error} />
      {list.loading && !list.data ? (
        <Loading />
      ) : list.data?.items.length ? (
        <>
          <label className="report-select">
            {t("已保存報告", "Saved reports")}
            <select
              value={id ?? ""}
              onChange={(e) => {
                setSelected(e.target.value);
                setEvidence(null);
                setError(null);
              }}
            >
              {selected &&
                !list.data.items.some((r: any) => r.id === selected) && (
                  <option value={selected} disabled>
                    {t("報告不可使用", "Report unavailable")}
                  </option>
                )}
              {list.data.items.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {state(r.state)} · {r.prompt}
                </option>
              ))}
            </select>
          </label>
          {!data && !detail.error ? (
            <Loading />
          ) : (
            data && (
              <div className="report-result" data-analysis-report={report.id}>
                <div className="section-title">
                  <h3>{data.spec.prompt}</h3>
                  <span className="status">{state(report.state)}</span>
                </div>
                <p className="muted">
                  {data.spec.date_from} → {data.spec.date_to} ·{" "}
                  {data.spec.timezone} · {t("最高預算", "Maximum budget")} HKD{" "}
                  {(Number(data.budget_micros) / 1e6).toFixed(2)}
                </p>
                {report.state === "failed" && (
                  <p role="status">
                    {data.error_code === "REPORT_NARRATIVE_INVALID"
                      ? t(
                          "敘述未通過數字或證據檢查，未發佈報告。請檢查原任務後重新建立。",
                          "The narrative failed numerical or evidence checks. No report was published. Review the original task before creating another.",
                        )
                      : t(
                          "任務未完成，請查看任務詳情。",
                          "The task did not finish. Review its details.",
                        )}
                  </p>
                )}
                <Link
                  className="text-button"
                  to={`/app/tasks/${report.task_id}`}
                >
                  {t("查看原任務", "View original task")}
                </Link>
                {data.narrative && (
                  <div className="report-prose">
                    {[
                      [t("觀察", "Observations"), data.narrative.observations],
                      [
                        t("待驗證假設", "Hypotheses to verify"),
                        data.narrative.hypotheses,
                      ],
                    ].map(([label, items]: any) => (
                      <section key={label}>
                        <h4>{label}</h4>
                        {items.length ? (
                          <ul>
                            {items.map((s: any, i: number) => (
                              <li key={i}>{prose(s.text)}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="muted">
                            {t("沒有提出額外假設", "No additional hypotheses")}
                          </p>
                        )}
                      </section>
                    ))}
                    <section>
                      <h4>{t("下一步", "Next steps")}</h4>
                      <ul>
                        {data.narrative.next_steps.map(
                          (s: string, i: number) => (
                            <li key={i}>{s}</li>
                          ),
                        )}
                      </ul>
                    </section>
                  </div>
                )}
                <AnalysisReview key={report.id} calculation={data.calculation} base={base} tenant={tenant} />
                <div className="row-actions">
                  <button
                    className="button secondary"
                    disabled={report.state !== "ready"}
                    onClick={() =>
                      void download(
                        base +
                          `/analysis/reports/${report.id}/download?format=html`,
                        "campaign-report.html",
                      ).catch(setError)
                    }
                  >
                    <Download size={16} />
                    {t("下載 HTML 報告", "Download HTML report")}
                  </button>
                  <button
                    className="button secondary"
                    disabled={report.state !== "ready"}
                    onClick={() =>
                      void download(
                        base +
                          `/analysis/reports/${report.id}/download?format=json`,
                        "campaign-report.json",
                      ).catch(setError)
                    }
                  >
                    <FileText size={16} />
                    {t("下載計算與證據", "Download calculation & evidence")}
                  </button>
                </div>
                <details>
                  <summary>
                    {t("報告範圍與驗證", "Report scope & validation")}
                  </summary>
                  <pre className="preserve-text">
                    {JSON.stringify(
                      {
                        spec: data.spec,
                        spec_hash: data.spec_hash,
                        validation: data.validation,
                        coverage: data.calculation.coverage,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </div>
            )
          )}
        </>
      ) : (
        <p>
          {t(
            "匯入資料後，選擇「建立分析報告」開始。",
            "Import data, then choose “Create analysis report” to begin.",
          )}
        </p>
      )}
      {open && (
        <CreateReport
          key={base}
          base={base}
          tenant={tenant}
          project={project}
          datasets={datasets}
          onClose={() => setOpen(false)}
          onCreated={(r) => {
            setSelected(r.id);
            setRefresh((n) => n + 1);
            setOpen(false);
          }}
        />
      )}
      {evidence && (
        <Modal
          size="wide"
          title={t("原始證據引用", "Evidence reference")}
          onClose={() => setEvidence(null)}
        >
          <div className="report-evidence">
            <strong>{evidence.metric_id}</strong>
            <p>
              {evidence.value ?? t("未知", "Unknown")} {evidence.unit}
            </p>
            {evidence.null_reason && <p>{evidence.null_reason}</p>}
            <pre className="preserve-text">
              {JSON.stringify(evidence, null, 2)}
            </pre>
          </div>
        </Modal>
      )}
    </section>
  );
}
function CreateReport({
  base,
  tenant,
  project,
  datasets,
  onClose,
  onCreated,
}: {
  base: string;
  tenant: string;
  project: string;
  datasets: any[];
  onClose: () => void;
  onCreated: (r: any) => void;
}) {
  const { t, locale } = useI18n(), { me } = useWorkspace();
  const scope = [me.user.id, tenant, project].join(":");
  const saved = useRef(readAnalysisPending(scope));
  const original = saved.current?.body.analysis;
  const [pending, setPending] = useState<AnalysisPending | null>(saved.current);
  const pendingRef = useRef<AnalysisPending | null>(saved.current);
  const sourceHistory = useAnalysisHistory(base + "/analytics");
  const available = (sourceHistory.data?.items ?? datasets).filter((d: any) => d.spec_hash);
  const [picked, setPicked] = useState<any[]>(datasets.filter(d => (original?.snapshot_ids ?? [datasets.find(d => d.spec_hash)?.id]).includes(d.id)));
  const initial = dates(available.slice(0, 1));
  const [selected, setSelected] = useState<string[]>(
      original?.snapshot_ids ?? available.slice(0, 1).map((d: any) => d.id),
    ),
    [prompt, setPrompt] = useState(original?.prompt ?? ""),
    [from, setFrom] = useState(original?.date_from ?? initial[0] ?? ""),
    [to, setTo] = useState(original?.date_to ?? initial.at(-1) ?? ""),
    [timezone, setTimezone] = useState(
      original?.timezone ?? available[0]?.timezone ?? "Asia/Hong_Kong",
    ),
    [comparison, setComparison] = useState(!!original?.comparison),
    [previousFrom, setPreviousFrom] = useState(original?.comparison?.date_from ?? ""),
    [previousTo, setPreviousTo] = useState(original?.comparison?.date_to ?? ""),
    [metrics, setMetrics] = useState<string[]>(original?.metrics ?? ["spend", "ctr", "cpc", "cpa", "roas"]),
    [dimensions, setDimensions] = useState<string[]>(original?.dimensions ?? []),
    [budget, setBudget] = useState("1.00"),
    [preview, setPreview] = useState<any>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const saving = useRef(false),
    requestKey = useRef(saved.current?.key ?? crypto.randomUUID()),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const spec = {
    prompt,
    snapshot_ids: selected,
    date_from: from,
    date_to: to,
    timezone,
    currency_policy: "group_by_currency",
    metrics,
    dimensions,
    ...(comparison
      ? { comparison: { date_from: previousFrom, date_to: previousTo } }
      : {}),
  };
  const invalidate = () => {
    setPreview(null);
    setConfirmed(false);
    requestKey.current = crypto.randomUUID();
    setError(null);
  };
  const change = (fn: () => void) => {
    if (saving.current || pendingRef.current) return;
    invalidate();
    fn();
  };
  const run = async (create: boolean) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!create) {
        const p = await post(base + "/analysis/preview", spec);
        if (live.current) setPreview(p);
      } else {
        let request = pendingRef.current;
        if (!request) {
          if (!preview || !confirmed) throw new Error(t("請先預覽並確認", "Preview and confirm first"));
          if (!/^\d+(\.\d{1,6})?$/.test(budget)) throw new Error(t("請輸入有效的 HKD 預算", "Enter a valid HKD budget"));
          const [a, b = ""] = budget.split("."), amount = BigInt(a) * 1000000n + BigInt(b.padEnd(6, "0"));
          if (amount <= 0n || amount > 1000000000000n) throw new Error(t("預算超出支援範圍", "Budget is outside the supported range"));
          const agent = await post(base + "/analysis/assistant", {});
          if (!live.current) return;
          request = { schema: 1, at: Date.now(), key: requestKey.current, body: { project_id: project, agent_id: agent.id, analysis: preview.spec, expected_calculation_sha256: preview.calculation_sha256, budget: { currency: "HKD", amount_micros: amount.toString() } } };
          keepAnalysisPending(scope, request);
          pendingRef.current = request; setPending(request);
        }
        const r = await api("/v1/reports", { method: "POST", headers: { "X-Tenant-ID": tenant, "Idempotency-Key": request.key }, body: JSON.stringify(request.body) });
        forgetAnalysisPending(scope); pendingRef.current = null;
        if (live.current) { setPending(null); onCreated(r); }
      }
    } catch (e) {
      if (create && pendingRef.current && !uncertainAnalysisResult(e)) {
        forgetAnalysisPending(scope); pendingRef.current = null; requestKey.current = crypto.randomUUID();
        if (live.current) { setPending(null); setConfirmed(false); setPreview(null); }
      }
      if (live.current) setError(e);
    } finally {
      saving.current = false;
      if (live.current) setBusy(false);
    }
  };
  return (
    <Modal
          size="wide"
      title={t("建立分析報告", "Create analysis report")}
      onClose={() => {
        if (!saving.current) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(false);
        }}
        className="analysis-report-form"
      >
        <ErrorNotice error={error} />
        {pending && <section className="review-pending" role="status"><h3>{t("繼續原報告申請", "Continue the original report request")}</h3><p>{t("上次結果尚未確認。來源、期間、預算和申請編號已固定；繼續只會查收或完成同一份報告，不會自動另開付費任務。", "The previous result is unconfirmed. Its sources, dates, budget and request identity are fixed. Continuing retrieves or completes the same report; it does not automatically start another paid task.")}</p><p>{pending.body.analysis.prompt}</p><p>{pending.body.analysis.date_from} → {pending.body.analysis.date_to} · {pending.body.analysis.timezone}</p><p>HKD {(BigInt(pending.body.budget.amount_micros) / 1000000n).toString()}.{(BigInt(pending.body.budget.amount_micros) % 1000000n).toString().padStart(6,"0")} · {t("最高預算", "Maximum budget")}</p><button type="button" className="button primary" disabled={busy} onClick={() => void run(true)}>{busy ? t("查收中…", "Checking…") : t("查收並繼續原申請", "Check & continue original request")}</button></section>}
        <fieldset disabled={busy || !!pending}>
          <Field label={t("業務問題", "Business question")}>
            <textarea
              required
              maxLength={8000}
              value={prompt}
              onChange={(e) => change(() => setPrompt(e.target.value))}
              placeholder={t(
                "比較本期表現，並提出下一步測試。",
                "Compare performance and propose the next test.",
              )}
            />
          </Field>
          <fieldset>
            <legend>
              {t("來源快照（最多十個）", "Source snapshots (up to ten)")}
            </legend>
            <div className="review-selected">{picked.filter(d => selected.includes(d.id)).map(d => <button type="button" className="button secondary" key={d.id} onClick={() => change(() => setSelected(ids => ids.filter(id => id !== d.id)))}>{d.name} ×</button>)}</div>
            <AnalysisHistoryControls history={sourceHistory} label={t("搜尋來源快照", "Search source snapshots")}/>
            <ErrorNotice error={sourceHistory.error}/>
            <div className="review-source-picker">
            {available.map((d: any) => (
              <label className="checkbox-row" key={d.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(d.id)}
                  disabled={!selected.includes(d.id) && selected.length >= 10}
                  onChange={(e) =>
                    change(() => {
                      setPicked(old => old.some(x => x.id === d.id) ? old : [...old, d]);
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, d.id]
                          : old.filter((id) => id !== d.id),
                      );
                    })
                  }
                />
                {d.name} · {d.currency}
              </label>
            ))}
            </div>
          </fieldset>
          <div className="report-date-grid">
            <Field label={t("開始日期", "Start date")}>
              <input
                type="date"
                required
                value={from}
                max={to || undefined}
                onChange={(e) => change(() => setFrom(e.target.value))}
              />
            </Field>
            <Field label={t("結束日期", "End date")}>
              <input
                type="date"
                required
                value={to}
                min={from || undefined}
                onChange={(e) => change(() => setTo(e.target.value))}
              />
            </Field>
          </div>
          <Field label={t("資料時區", "Source timezone")}>
            <input
              required
              value={timezone}
              onChange={(e) => change(() => setTimezone(e.target.value))}
            />
          </Field>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={comparison}
              onChange={(e) => change(() => setComparison(e.target.checked))}
            />
            {t("加入比較區間", "Add comparison period")}
          </label>
          {comparison && (
            <div className="report-date-grid">
              <Field label={t("比較期開始", "Comparison start")}>
                <input
                  type="date"
                  required
                  value={previousFrom}
                  max={previousTo || undefined}
                  onChange={(e) =>
                    change(() => setPreviousFrom(e.target.value))
                  }
                />
              </Field>
              <Field label={t("比較期結束", "Comparison end")}>
                <input
                  type="date"
                  required
                  value={previousTo}
                  min={previousFrom || undefined}
                  onChange={(e) => change(() => setPreviousTo(e.target.value))}
                />
              </Field>
            </div>
          )}
          <fieldset className="report-options">
            <legend>{t("指標", "Metrics")}</legend>
            {metricNames.map((m) => (
              <label className="checkbox-row" key={m}>
                <input
                  type="checkbox"
                  checked={metrics.includes(m)}
                  onChange={(e) =>
                    change(() =>
                      setMetrics((old) =>
                        e.target.checked
                          ? [...old, m]
                          : old.filter((v) => v !== m),
                      ),
                    )
                  }
                />
                {metricLabel(m, locale === "en")}
              </label>
            ))}
          </fieldset>
          <Field label={t("拆分維度", "Breakdown")}>
            <select
              value={dimensions[0] || ""}
              onChange={(e) =>
                change(() =>
                  setDimensions(e.target.value ? [e.target.value] : []),
                )
              }
            >
              <option value="">
                {t("按來源與口徑彙總", "Totals by source and definition")}
              </option>
              <option value="date">
                {t(
                  "每日（比較期按相對日對齊）",
                  "Daily (align comparison day offsets)",
                )}
              </option>
              <option value="channel">{t("渠道", "Channel")}</option>
              <option value="campaign">{t("活動", "Campaign")}</option>
              <option value="entity_id">{t("實體 ID", "Entity ID")}</option>
            </select>
          </Field>
          <Field label={t("最高預算（HKD）", "Maximum budget (HKD)")}>
            <input
              inputMode="decimal"
              required
              value={budget}
              onChange={(e) => change(() => setBudget(e.target.value))}
            />
          </Field>
          <p className="muted">
            {t(
              "先預覽確定性計算，不收取模型費用。確認後才預留預算並建立私人 Codex 任務。幣種始終分組。",
              "Preview deterministic calculations without model charges. Confirmation reserves the budget and creates a private Codex task. Currencies always remain separate.",
            )}
          </p>
          <button
            type="submit"
            className="button secondary"
            disabled={!selected.length || !metrics.length}
          >
            {busy
              ? t("處理中…", "Working…")
              : t("預覽報告範圍", "Preview report scope")}
          </button>
          {preview && (
            <section
              className="report-preview"
              aria-label={t("報告預覽", "Report preview")}
            >
              <AnalysisReview key={preview.calculation_sha256} calculation={preview} base={base} tenant={tenant} preview />
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                {t(
                  "我確認來源、區間和最高預算。",
                  "I confirm the sources, dates and maximum budget.",
                )}
              </label>
              <button
                type="button"
                className="button primary"
                disabled={!confirmed}
                onClick={() => void run(true)}
              >
                {t("確認並建立報告", "Confirm & create report")}
              </button>
            </section>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
