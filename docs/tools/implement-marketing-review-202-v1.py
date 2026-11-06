from pathlib import Path
import json
R=Path(__file__).resolve().parents[2]; D=R/'dev'
def replace(p,old,new):
 s=p.read_text('utf8'); assert old in s,(str(p),old[:100]); p.write_text(s.replace(old,new,1),encoding='utf8',newline='\n')
web=D/'copypaste-web/src'; native=D/'copypaste-desktop/renderer/src'
for folder in [web,native]:
 p=folder/'api.ts'
 replace(p,'import {','import { clearAnalysisPending } from "./analysis-request-state";\nimport {')
 replace(p,'clearMotionDrafts();','clearMotionDrafts(); clearAnalysisPending();')
 replace(p,'      download: (\n        path: string,\n        name: string,\n        tenantId?: string,\n','      download: (\n        path: string,\n        name: string,\n        tenantId?: string,\n        options?: { body: unknown },\n')
 replace(p,'export async function download(\n  path: string,\n  filename: string,\n  tenantId?: string,\n','export const downloadPost = (path: string, filename: string, body: unknown, tenantId?: string) => download(path, filename, tenantId, body);\nexport async function download(\n  path: string,\n  filename: string,\n  tenantId?: string,\n  postBody?: unknown,\n')
 replace(p,'window.copyPasteBridge.download(path, filename, tenantId)','window.copyPasteBridge.download(path, filename, tenantId, postBody === undefined ? undefined : { body: postBody })')
 start=p.read_text('utf8').index('export async function download(');s=p.read_text('utf8'); before=s[:start]; after=s[start:]
 old='''      ...(tenantId ? { headers: { "X-Tenant-ID": tenantId } } : {}),'''
 assert old in after
 after=after.replace(old,'''      ...(postBody === undefined ? {} : { method: "POST", body: JSON.stringify(postBody) }),
      headers: { ...(tenantId ? { "X-Tenant-ID": tenantId } : {}), ...(postBody === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }) },''',1)
 old='''  if (!response.ok)
    throw new ApiError('''
 assert old in after
 after=after.replace(old,'''  if (!response.ok && postBody !== undefined) {
    const problem = await clientJson(response, "POST"); current();
    throw new ApiError(problem?.error?.code ?? "DOWNLOAD_UNAVAILABLE", problem?.error?.message ?? "Download unavailable", response.status);
  }
  if (!response.ok)
    throw new ApiError(''',1)
 old='''  current();
  const url = URL.createObjectURL(blob);'''
 assert old in after
 after=after.replace(old,'''  current();
  if (postBody !== undefined) {
    const expected = response.headers.get("x-content-sha256");
    if (!expected || !/^[a-f0-9]{64}$/.test(expected) || blob.size > 8 * 1024 ** 2) throw new ApiError("DOWNLOAD_INTEGRITY", "Invalid review download", 422);
    const bytes = await blob.arrayBuffer(), actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join(""); current();
    if (actual !== expected) throw new ApiError("DOWNLOAD_INTEGRITY", "Review download checksum mismatch", 422);
  }
  const url = URL.createObjectURL(blob);''',1)
 p.write_text(before+after,encoding='utf8',newline='\n')

p=web/'marketing-reports.tsx'
replace(p,'const metricNames = [','import { AnalysisReview } from "./analysis-review";\nimport { AnalysisHistoryControls, useAnalysisHistory } from "./analysis-history";\nimport { useWorkspace } from "./context";\nimport { metricLabel } from "./analysis-review-model";\nimport { readAnalysisPending, keepAnalysisPending, forgetAnalysisPending, uncertainAnalysisResult, type AnalysisPending } from "./analysis-request-state";\n\nconst metricNames = [')
replace(p,'const list = useData(base + "/analysis/reports", refresh, 5000);','const list = useAnalysisHistory(base + "/analysis/reports", refresh, 5000);\n  useEffect(() => { setSelected(null); }, [base, list.page, list.search]);')
replace(p,'      <ErrorNotice error={list.error ?? detail.error ?? error} />','      <AnalysisHistoryControls history={list} label={t("搜尋私人報告", "Search private reports")} />\n      <ErrorNotice error={list.error ?? detail.error ?? error} />')
s=p.read_text('utf8');start=s.index('                <div className="report-scopes">');end=s.index('                <div className="row-actions">',start)
s=s[:start]+'                <AnalysisReview key={report.id} calculation={data.calculation} base={base} tenant={tenant} />\n'+s[end:];p.write_text(s,encoding='utf8',newline='\n')
replace(p,'  const { t } = useI18n();\n  const available = datasets.filter((d) => d.spec_hash);','''  const { t, locale } = useI18n(), { me } = useWorkspace();
  const scope = [me.user.id, tenant, project].join(":");
  const saved = useRef(readAnalysisPending(scope));
  const original = saved.current?.body.analysis;
  const [pending, setPending] = useState<AnalysisPending | null>(saved.current);
  const pendingRef = useRef<AnalysisPending | null>(saved.current);
  const sourceHistory = useAnalysisHistory(base + "/analytics");
  const available = (sourceHistory.data?.items ?? datasets).filter((d: any) => d.spec_hash);
  const [picked, setPicked] = useState<any[]>(datasets.filter(d => (original?.snapshot_ids ?? [datasets.find(d => d.spec_hash)?.id]).includes(d.id)));''')
replace(p,'      available.slice(0, 1).map((d) => d.id),','      original?.snapshot_ids ?? available.slice(0, 1).map((d: any) => d.id),')
for old,new in [('useState("")','useState(original?.prompt ?? "")'),('useState(initial[0] || "")','useState(original?.date_from ?? initial[0] ?? "")'),('useState(initial.at(-1) || "")','useState(original?.date_to ?? initial.at(-1) ?? "")')]:
 # Only modify the CreateReport portion, not other hooks.
 s=p.read_text('utf8');at=s.index('function CreateReport(');s=s[:at]+s[at:].replace(old,new,1);p.write_text(s,encoding='utf8',newline='\n')
replace(p,'available[0]?.timezone || "Asia/Hong_Kong",','original?.timezone ?? available[0]?.timezone ?? "Asia/Hong_Kong",')
replace(p,'[comparison, setComparison] = useState(false)','[comparison, setComparison] = useState(!!original?.comparison)')
replace(p,'[previousFrom, setPreviousFrom] = useState("")','[previousFrom, setPreviousFrom] = useState(original?.comparison?.date_from ?? "")')
replace(p,'[previousTo, setPreviousTo] = useState("")','[previousTo, setPreviousTo] = useState(original?.comparison?.date_to ?? "")')
replace(p,'[metrics, setMetrics] = useState(["spend", "ctr", "cpc", "cpa", "roas"])','[metrics, setMetrics] = useState<string[]>(original?.metrics ?? ["spend", "ctr", "cpc", "cpa", "roas"])')
replace(p,'[dimensions, setDimensions] = useState<string[]>([])','[dimensions, setDimensions] = useState<string[]>(original?.dimensions ?? [])')
replace(p,'requestKey = useRef(crypto.randomUUID()),','requestKey = useRef(saved.current?.key ?? crypto.randomUUID()),')
replace(p,'  const change = (fn: () => void) => {\n    invalidate();','  const change = (fn: () => void) => {\n    if (saving.current || pendingRef.current) return;\n    invalidate();')
start=p.read_text('utf8').index('      } else {\n        if (!/^\\d+');end=p.read_text('utf8').index('\n    } finally {',start)
s=p.read_text('utf8');s=s[:start]+'''      } else {
        let request = pendingRef.current;
        if (!request) {
          if (!preview || !confirmed) throw new Error(t("請先預覽並確認", "Preview and confirm first"));
          if (!/^\\d+(\\.\\d{1,6})?$/.test(budget)) throw new Error(t("請輸入有效的 HKD 預算", "Enter a valid HKD budget"));
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
      if (live.current) setError(e);'''+s[end:];p.write_text(s,encoding='utf8',newline='\n')
replace(p,'        <fieldset disabled={busy}>','''        {pending && <section className="review-pending" role="status"><h3>{t("繼續原報告申請", "Continue the original report request")}</h3><p>{t("上次結果尚未確認。來源、期間、預算和申請編號已固定；繼續只會查收或完成同一份報告，不會自動另開付費任務。", "The previous result is unconfirmed. Its sources, dates, budget and request identity are fixed. Continuing retrieves or completes the same report; it does not automatically start another paid task.")}</p><p>{pending.body.analysis.prompt}</p><p>{pending.body.analysis.date_from} → {pending.body.analysis.date_to} · {pending.body.analysis.timezone}</p><p>HKD {(BigInt(pending.body.budget.amount_micros) / 1000000n).toString()}.{(BigInt(pending.body.budget.amount_micros) % 1000000n).toString().padStart(6,"0")} · {t("最高預算", "Maximum budget")}</p><button type="button" className="button primary" disabled={busy} onClick={() => void run(true)}>{busy ? t("查收中…", "Checking…") : t("查收並繼續原申請", "Check & continue original request")}</button></section>}
        <fieldset disabled={busy || !!pending}>''')
replace(p,'            {available.map((d) => (','''            <div className="review-selected">{picked.filter(d => selected.includes(d.id)).map(d => <button type="button" className="button secondary" key={d.id} onClick={() => change(() => setSelected(ids => ids.filter(id => id !== d.id)))}>{d.name} ×</button>)}</div>
            <AnalysisHistoryControls history={sourceHistory} label={t("搜尋來源快照", "Search source snapshots")}/>
            <ErrorNotice error={sourceHistory.error}/>
            <div className="review-source-picker">
            {available.map((d: any) => (''')
replace(p,'                          ? [...old, d.id]','                          ? [...old, d.id]')
# Remember selected metadata across source-history pages; IDs alone remain authoritative to the server.
replace(p,'                  onChange={(e) =>\n                    change(() =>\n                      setSelected((old) =>','                  onChange={(e) =>\n                    change(() => {\n                      setPicked(old => old.some(x => x.id === d.id) ? old : [...old, d]);\n                      setSelected((old) =>')
replace(p,'                      ),\n                    )\n                  }\n                />\n                {d.name}', '                      );\n                    })\n                  }\n                />\n                {d.name}')
replace(p,'            ))}\n          </fieldset>\n          <div className="report-date-grid">','            ))}\n            </div>\n          </fieldset>\n          <div className="report-date-grid">')
replace(p,'                {m}\n','                {metricLabel(m, locale === "en")}\n')
s=p.read_text('utf8');start=s.index('              <h3>{t("確認分析範圍"');end=s.index('              <label className="checkbox-row">',start)
s=s[:start]+'              <AnalysisReview key={preview.calculation_sha256} calculation={preview} base={base} tenant={tenant} preview />\n'+s[end:];p.write_text(s,encoding='utf8',newline='\n')

for folder in [web,native]:
 p=folder/'main.tsx'
 replace(p,'import { WorkspaceProvider, useWorkspace } from "./context";','import { WorkspaceProvider, useWorkspace } from "./context";\nimport { AnalysisHistoryControls, useAnalysisHistory } from "./analysis-history";')
 replace(p,'  const { data, error, loading } = useData(w.base + "/analytics", refresh);','  const history = useAnalysisHistory(w.base + "/analytics", refresh);\n  const { data, error, loading } = history;')
 # Keep search available for empty pages as well as lists with rows.
 replace(p,'      <ErrorNotice error={error ?? detail.error ?? err} />','      <AnalysisHistoryControls history={history} label={t("搜尋歷史數據集", "Search dataset history")}/>\n      <ErrorNotice error={error ?? detail.error ?? err} />')

for name in ['analysis-review-model.ts','analysis-review.tsx','analysis-review.css','analysis-history.tsx','analysis-request-state.ts','marketing-reports.tsx']:
 text=(web/name).read_text('utf8')
 if name=='marketing-reports.tsx':text=text.replace('import { browserCrypto as crypto } from "./browser-crypto";\n','')
 (native/name).write_text(text,encoding='utf8',newline='\n')

for repo,version in [('platform','0.5.10'),('web','0.5.11'),('desktop','0.7.15'),('delivery','0.5.9')]:
 p=D/('copypaste-'+repo)/'package.json'; data=json.loads(p.read_text('utf8')); data['version']=version;p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
 p=p.with_name('package-lock.json');data=json.loads(p.read_text('utf8'));data['version']=version;data['packages']['']['version']=version;p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
print('Complete marketing review source batch applied. Builds and tests have not run.')
