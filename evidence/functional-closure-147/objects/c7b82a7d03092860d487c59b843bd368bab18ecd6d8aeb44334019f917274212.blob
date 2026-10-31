import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Check,
  ChevronRight,
  Circle,
  FileText,
  LockKeyhole,
  PauseCircle,
  Play,
  RefreshCw,
  Square,
  Workflow,
} from "lucide-react";
import { download, post } from "./api";
import { useWorkspace } from "./context";
import { useData, useI18n, Badge, ErrorNotice, Modal, Money } from "./ui";
import "./cloud-workflows.css";
import { ScheduleFromRun } from "./cloud-schedules";
import { EventFromRun } from "./cloud-events";
import {WorkflowInputs,WorkflowOutputs} from "./workflow-contracts";

type Step = {
  kind: string;
  role_key?: string;
  prompt?: string;
  message?: string;
  dataset_id?: string;
  budget_micros?: number;
  input_steps?:number[];
  on_failure?:"stop"|"review";
};
type Run = {
  id: string;
  workflow_id: string;
  version: number;
  revision: number;
  state: string;
  cursor: number;
  authorized: boolean;
  definition_hash: string;
  definition: { steps: Step[];input_schema?:unknown;output_schema?:unknown };
  input_hash?:string|null;input_values?:Record<string,unknown>;input_files?:any[];named_outputs?:Record<string,unknown>;
  step_budget_micros: number;
  origin_task_id: string;
  active_task: string | null;
  error_code: string | null;
  results: any[];
};

export function PrivateCloudWorkflows() {
  const { t } = useI18n(),
    w = useWorkspace(),
    base = w.base + "/cloud-workflows";
  const [refresh, setRefresh] = useState(0),
    [action, setAction] = useState<{
      run: Run;
      decision: "approve" | "cancel";
      requestKey: string;
    } | null>(null);
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const location = useLocation(),
    focusedRun = /^#cloud-run-[\da-f-]{36}$/.test(location.hash)
      ? location.hash.slice(11)
      : null;
  const { data, error, loading } = useData(
    base + (focusedRun ? "?run_id=" + focusedRun : ""),
    refresh,
    5000,
    "",
    {
      retainOnRefresh: true,
    },
  );
  useEffect(() => {
    if (!/^#cloud-run-[\da-f-]{36}$/.test(location.hash) || !data) return;
    const target = document.getElementById(location.hash.slice(1));
    if (target) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.focus({ preventScroll: true });
    }
  }, [location.hash, Boolean(data), base]);
  useEffect(() => {
    setAction(null);
    setFailure(null);
    setBusy(false);
  }, [base]);
  useEffect(() => {
    // Confirmation is valid only while its private run remains readable. Keep
    // the original version/budget snapshot during ordinary successful polling.
    if (error) {
      setAction(null);
      setFailure(null);
    } else if (data) {
      setAction((current) =>
        current && !data.runs.some((run: Run) => run.id === current.run.id)
          ? null
          : current,
      );
    }
  }, [data, error]);
  const names = new Map<string, string>(
    (data?.items ?? []).map((v: any) => [v.id, v.name]),
  );
  const open = (run: Run, decision: "approve" | "cancel") => {
    setFailure(null);
    setAction({ run, decision, requestKey: crypto.randomUUID() });
  };
  const stepTitle = (step: Step) =>
    step.kind === "approval"
      ? t("人工審批", "Human review")
      : step.kind === "analytics.summary"
        ? t("計算資料摘要", "Calculate data summary")
        : t("專業助手工作", "Specialist work");
  async function submit() {
    if (!action || busy) return;
    const current = action,
      scope = base;
    setBusy(true);
    setFailure(null);
    try {
      const r = current.run;
      await post(
        scope + "/runs/" + r.id + "/decision",
        {
          decision: current.decision,
          expected_revision: r.revision,
          definition_hash: r.definition_hash,
          ...(r.input_hash?{input_hash:r.input_hash}:{}),
          stage: r.authorized ? "step" : "start",
          max_budget_micros: r.step_budget_micros,
          expected_cursor: r.cursor,
        },
        current.requestKey,
      );
      setAction(null);
      setRefresh((v) => v + 1);
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="section-block private-cloud-workflows"
      aria-label={t("我的私有雲端流程", "My private cloud workflows")}
    >
      <div className="section-title">
        <div>
          <span className="workflow-private-label">
            <LockKeyhole size={14} />
            {t("只對你可見", "Only visible to you")}
          </span>
          <h2>
            {t("讓好流程，繼續運轉。", "Good work, with a clear next step.")}
          </h2>
          <p className="muted">
            {t(
              "由流程顧問準備，在這裡核對步驟、確認費用及查看每次結果。",
              "Prepare a workflow with your consultant. Review steps, approve the budget and follow each result here.",
            )}
          </p>
        </div>
        <button
          className="button secondary small"
          onClick={() => setRefresh((v) => v + 1)}
          disabled={loading}
        >
          <RefreshCw size={15} />
          {t("重新整理", "Refresh")}
        </button>
      </div>
      <ErrorNotice error={error ?? (!action ? failure : null)} />
      {focusedRun && (
        <p>
          <Link className="button secondary small" to={location.pathname}>
            {t("查看所有流程執行", "Show all workflow runs")}
          </Link>
        </p>
      )}
      {!data && !error && (
        <p role="status" className="muted">
          {t("正在載入你的流程…", "Loading your workflows…")}
        </p>
      )}
      {data && !data.items.length && !data.runs.length && (
        <div className="private-workflow-empty card">
          <Workflow size={26} />
          <div>
            <h3>
              {t(
                "把重複工作交給流程顧問。",
                "Give repeated work a clear routine.",
              )}
            </h3>
            <p className="muted">
              {t(
                "選用「企業流程自動化顧問」，描述你的目標。顧問準備好固定版本後，會在這裡等待你確認。",
                "Choose the Workflow consultant and describe your goal. Its prepared version will wait here for your confirmation.",
              )}
            </p>
          </div>
          <Link className="button secondary" to="../specialists">
            {t("選用流程顧問", "Choose a consultant")}
            <ChevronRight size={15} />
          </Link>
        </div>
      )}
      <div className="private-workflow-grid">
        {data?.runs.map((run: Run) => (
          <article
            className="card private-workflow-run"
            key={run.id}
            data-workflow-run={run.id}
            id={"cloud-run-" + run.id}
            tabIndex={-1}
          >
            <header>
              <span className="workflow-private-label">
                <LockKeyhole size={13} />
                {t("私有雲端流程", "Private cloud workflow")}
              </span>
              <Badge value={run.state} />
            </header>
            <h3>
              {names.get(run.workflow_id) ??
                t("已保留的流程版本", "Retained workflow version")}
            </h3>
            <p className="muted">
              v{run.version} · {t("執行", "Run")} {run.id.slice(0, 8)}
            </p>
            <ol className="private-workflow-steps">
              {run.definition.steps.map((step, index) => {
                const failed = run.results.some(r=>r.kind === "failure_review" && r.cursor === index);
                const finished =
                    !failed && (index < run.cursor || run.state === "succeeded"),
                  current =
                    index === run.cursor &&
                    ["running", "awaiting_approval"].includes(run.state);
                return (
                  <li
                    key={index}
                    className={
                      finished ? "is-finished" : current ? "is-current" : ""
                    }
                  >
                    <span
                      className="private-step-icon"
                      aria-label={
                        failed ? t("步驟失敗", "Step failed") : finished
                          ? t("已完成", "Completed")
                          : current
                            ? t("當前步驟", "Current step")
                            : t("未開始", "Not started")
                      }
                    >
                      {failed ? <Square size={14} aria-hidden="true" /> : finished ? (
                        <Check size={14} />
                      ) : step.kind === "approval" ? (
                        <PauseCircle size={16} />
                      ) : (
                        <Circle size={14} />
                      )}
                    </span>
                    <div>
                      <strong>{stepTitle(step)}</strong>
                      <p>
                        {step.kind === "approval"
                          ? step.message
                          : step.kind === "codex"
                            ? step.prompt
                            : t(
                                "根據已授權的固定資料計算並保存檔案。",
                                "Calculate from the authorized fixed source and save the file.",
                              )}
                      </p>
                      {step.kind === "codex" && (
                        <small>
                          {t("此步預算上限", "Step budget limit")}{" "}
                          <Money value={step.budget_micros} />
                          <br />{t("使用成果：", "Uses outputs: ")}{step.input_steps ? step.input_steps.map(i=>i+1).join(", ") || t("無", "None") : t("全部先前步驟", "All prior steps")}
                          <br />{step.on_failure === "review" ? t("失敗時等待你確認，不會自動重試。", "Wait for your review on failure; never retry automatically.") : t("失敗時停止流程。", "Stop the workflow on failure.")}
                        </small>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            <WorkflowInputs run={run}/><WorkflowOutputs run={run}/>
            <div className="private-workflow-budget">
              <span>
                {t(
                  "全部 Agent 步驟預算上限",
                  "Budget limit for all Agent steps",
                )}
              </span>
              <strong>
                <Money value={run.step_budget_micros} />
              </strong>
            </div>
            <p className="private-workflow-cost-note">
              {t(
                "另計準備此流程的顧問費用。實際費用以各步驟完成後的紀錄為準。",
                "The consultant's preparation is billed separately. Actual charges appear in each completed step receipt.",
              )}
            </p>
            {run.state === "awaiting_approval" && (
              <p className="private-workflow-waiting">
                {run.authorized
                  ? t(
                      "已停在人工審批點，等待你核准下一步。",
                      "Paused at a review point until you approve the next step.",
                    )
                  : t(
                      "尚未開始，也未預留後續步驟的費用。",
                      "Not started. No child-step fees have been reserved.",
                    )}
              </p>
            )}
            {run.results.at(-1)?.kind === "failure_review" && run.results.at(-1)?.status === "awaiting_customer" && (
              <p className="notice warning" role="status">{t("有步驟失敗。確認繼續將略過該步驟，保留已產生費用及失敗標記；不會重試。需要該成果的後續步驟將停止。", "A step failed. Continuing skips it, retains incurred charges and the failure record, and never retries it. Later steps that require its output will stop.")}</p>
            )}
            {run.state === "failed" && (
              <p role="status" className="muted">
                {run.error_code === "WORKFLOW_STEP_RECONCILIATION_REQUIRED"
                  ? t(
                      "上一步的費用或結果仍待核對；此流程已停止，請先查看該項工作。",
                      "The previous step's cost or outcome needs reconciliation. This run has stopped; review that work before starting again.",
                    )
                  : t(
                      "流程已停止。請查看步驟紀錄，修訂後重新準備，避免重複執行。",
                      "This run stopped. Review the step receipts and prepare a revision before running again.",
                    )}
              </p>
            )}
            <footer>
              <ScheduleFromRun run={run} />
              <EventFromRun run={run} />
              {run.state === "awaiting_approval" && (
                <button
                  className="button primary small"
                  onClick={() => open(run, "approve")}
                >
                  <Play size={14} />
                  {run.authorized
                    ? t("核對並繼續", "Review & continue")
                    : t("核對並開始", "Review & start")}
                </button>
              )}
              {["running", "awaiting_approval"].includes(run.state) && (
                <button
                  className="button secondary small"
                  onClick={() => open(run, "cancel")}
                >
                  <Square size={13} />
                  {t("停止流程", "Stop workflow")}
                </button>
              )}
              {run.active_task && (
                <Link
                  className="button secondary small"
                  to={"../tasks/" + run.active_task}
                >
                  {t("查看當前工作", "View current work")}
                </Link>
              )}
            </footer>
            {run.results.length > 0 && (
              <details className="private-workflow-receipts">
                <summary>
                  <FileText size={14} />
                  {t("步驟紀錄與交付", "Step receipts & deliverables")} (
                  {run.results.length})
                </summary>
                <ul>
                  {run.results.map((r: any, index: number) => (
                    <li key={index}>
                      <span>
                        {r.kind === "authorization"
                          ? t("已確認執行及預算", "Execution & budget approved")
                          : r.kind === "failure_review" ? t("步驟失敗，保留紀錄", "Step failed; record retained")
                          : r.kind === "failure_review_decision" ? t("已確認略過失敗步驟", "Failed step skipped after review")
                          : r.kind === "approval"
                            ? t("已核准繼續", "Review approved")
                            : r.kind === "codex"
                              ? t("專業助手已完成", "Specialist work completed")
                              : t("資料摘要已保存", "Data summary saved")}
                      </span>
                      {r.charged_micros != null && (
                        <small>
                          {t("實際費用", "Actual charge")}{" "}
                          <Money value={r.charged_micros} />
                        </small>
                      )}
                      {r.task_id && (
                        <Link to={"../tasks/" + r.task_id}>
                          {t("查看成果", "View result")}
                        </Link>
                      )}
                      {r.asset_id && (
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => {
                            void download(
                              w.base + "/assets/" + r.asset_id + "/download",
                              "workflow-summary.json",
                              w.tenant,
                            ).catch(setFailure);
                          }}
                        >
                          {t("下載資料摘要", "Download summary")}
                        </button>
                      )}
                      {r.files?.map((f:any)=>(
                        <button type="button" className="button secondary small" key={f.asset_version_id}
                          onClick={()=>{void download(w.base+"/assets/"+f.asset_id+"/download?version="+f.version,f.name,w.tenant).catch(setFailure);}}>
                          {t("下載", "Download")} {f.name}
                        </button>
                      ))}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </article>
        ))}
      </div>
      {data?.items.length > 0 && (
        <details className="private-workflow-library">
          <summary>
            {t("已保存的流程", "Saved workflows")} ({data.items.length})
          </summary>
          {data.items.map((v: any) => (
            <div className="version-row" key={v.id}>
              <LockKeyhole size={14} />
              <strong>{v.name}</strong>
              <span>v{v.version}</span>
              <Badge value={v.state} />
              <span className="muted">
                {v.definition.steps.length} {t("個步驟", "steps")}
              </span>
            </div>
          ))}
        </details>
      )}
      {action && (
        <Modal
          title={
            action.decision === "cancel"
              ? t("停止這次流程？", "Stop this workflow run?")
              : action.run.authorized
                ? t("核對下一步", "Review the next step")
                : t("核對流程及預算", "Review workflow & budget")
          }
          onClose={() => {
            if (!busy) setAction(null);
          }}
        >
          <div className="private-workflow-confirm">
            <p>
              {names.get(action.run.workflow_id) ??
                t("私有流程", "Private workflow")}{" "}
              · v{action.run.version}
            </p>
            <WorkflowInputs run={action.run}/>
            {action.decision === "cancel" ? (
              <p>
                {t(
                  "將停止尚未執行的步驟並中止當前工作。已產生的費用會保留；結果或費用未知的工作會繼續核對。",
                  "Future steps will stop and current work will be interrupted. Incurred charges remain; uncertain costs and outcomes stay under reconciliation.",
                )}
              </p>
            ) : (
              <>
                <div className="private-workflow-budget">
                  <span>
                    {t(
                      "全部 Agent 步驟預算上限",
                      "Budget limit for all Agent steps",
                    )}
                  </span>
                  <strong>
                    <Money value={action.run.step_budget_micros} />
                  </strong>
                </div>
                <p className="muted">
                  {action.run.authorized
                    ? t(
                        "這是原流程的總上限，繼續不會重新執行已完成的步驟。",
                        "This is the original run's total limit. Continuing will keep completed steps intact.",
                      )
                    : t(
                        "確認後，系統會逐步執行並按每項工作的實際用量結算。準備流程的顧問費用另計。",
                        "After confirmation, work runs step by step and settles from actual usage. The consultant's preparation is billed separately.",
                      )}
                </p>
                {action.run.results.at(-1)?.kind === "failure_review" && action.run.results.at(-1)?.status === "awaiting_customer" && (
                  <p className="notice warning">{t("你正在確認略過已失敗的步驟。該步驟不會重試；其費用和失敗狀態會保留。只有不依賴其成果的工作才能繼續。", "You are approving a skip of a failed step. It will not be retried; its charges and failure remain. Only work independent of its output can continue.")}</p>
                )}
                <ol className="private-confirm-steps">
                  {action.run.definition.steps.map((step, index) => (
                    <li key={index}>
                      <strong>{stepTitle(step)}</strong>
                      <p>
                        {step.message ??
                          step.prompt ??
                          t(
                            "根據已確認的資料計算摘要。",
                            "Calculate a summary from the confirmed source.",
                          )}
                      </p>
                      {step.kind === "codex" && (
                        <><Money value={step.budget_micros} /><p>{t("使用成果：", "Uses outputs: ")}{step.input_steps ? step.input_steps.map(i=>i+1).join(", ") || t("無", "None") : t("全部先前步驟", "All prior steps")}</p><p>{step.on_failure === "review" ? t("失敗後等待確認，不會重試。", "Review after failure; no retry.") : t("失敗後停止。", "Stop after failure.")}</p></>
                      )}
                    </li>
                  ))}
                </ol>
                <label className="private-workflow-consent">
                  <input
                    type="checkbox"
                    required
                    id="workflow-budget-confirmation"
                    form="private-workflow-approval"
                  />
                  {t(
                    "我已核對上述固定版本、步驟及預算，並同意繼續。",
                    "I have reviewed this fixed version, its steps and budget, and authorize continuation.",
                  )}
                </label>
              </>
            )}
            <ErrorNotice error={failure} />
            {!!failure && (
              <button
                type="button"
                className="button secondary small"
                onClick={() => {
                  setAction(null);
                  setFailure(null);
                  setRefresh((v) => v + 1);
                }}
              >
                {t("重新載入目前狀態", "Reload current state")}
              </button>
            )}
            <form
              id="private-workflow-approval"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <button className="button primary" type="submit" disabled={busy}>
                {busy
                  ? t("正在提交…", "Submitting…")
                  : action.decision === "cancel"
                    ? t("確認停止", "Confirm stop")
                    : failure
                      ? t("重試本次確認", "Retry this confirmation")
                      : t("確認並繼續", "Confirm & continue")}
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => setAction(null)}
              >
                {t("返回核對", "Back to review")}
              </button>
            </form>
          </div>
        </Modal>
      )}
    </section>
  );
}
