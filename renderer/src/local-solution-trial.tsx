import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FolderOpen, Monitor, Play, RefreshCw, Square } from "lucide-react";
import { useI18n, Money } from "./ui";

async function native(action: string, payload: unknown) {
  const r = await window.copyPasteBridge!.localAgent(action, payload);
  if (!r.ok) throw new Error(r.code ?? "LOCAL_OPERATION_FAILED");
  return r.value;
}

export function LocalSolutionTrial({
  tenant,
  project,
  method,
  installation,
  bindings,
  preview,
  blocked,
  onPrepared,
}: {
  tenant: string;
  project: string;
  method: any;
  installation: string;
  bindings: unknown;
  preview: any;
  blocked: boolean;
  onPrepared: (id: string) => void;
}) {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<any[]>([]),
    [roles, setRoles] = useState<string[]>([]),
    [selected, setSelected] = useState<Record<number, string>>({});
  const [mode, setMode] = useState("workspace-write"),
    [budget, setBudget] = useState("5"),
    [brief, setBrief] = useState("");
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const live = useRef(true),
    gate = useRef(false);
  const templates = method.templates ?? [];
  const load = async () => {
    const result = await native("list", { tenant, project });
    if (live.current) {
      setSessions(result.sessions);
      setRoles(result.roles);
    }
  };
  useEffect(() => {
    live.current = true;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        await load();
      } catch (e) {
        if (live.current) setError((e as Error).message);
      } finally {
        loading = false;
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 3000);
    const off = window.copyPasteBridge!.onLocalAgentChanged(
      () => void refresh(),
    );
    return () => {
      live.current = false;
      clearInterval(interval);
      off();
    };
  }, [tenant, project]);
  useEffect(
    () => setConsent(false),
    [preview?.preview_hash, budget, brief, selected],
  );
  const action = async (key: string, run: () => Promise<void>) => {
    if (gate.current || blocked) return;
    gate.current = true;
    setBusy(key);
    setError("");
    try {
      await run();
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      gate.current = false;
      if (live.current) {
        setBusy("");
        await load().catch(() => {});
      }
    }
  };
  const amount = Math.round(Number(budget) * 1000000);
  const ready =
    preview?.execution_location === "desktop" &&
    preview.state === "ready" &&
    preview.task_capacity.available >= templates.length &&
    Number.isSafeInteger(amount) &&
    amount >= templates.length * 10000 &&
    amount <= 100000000 &&
    brief.trim().length > 0 &&
    brief.length <= 4000 &&
    templates.every((v: any, i: number) =>
      sessions.some(
        (s) =>
          s.id === selected[i] &&
          s.role === v.role_key &&
          s.permission &&
          !s.busy &&
          s.phase === "idle" &&
          !s.task &&
          !s.revoked,
      ),
    );
  const work = sessions.filter((s) => s.solution?.versionId === method.id);
  return (
    <div
      className="local-solution-trial"
      aria-label={t("本機方案試運行", "Local method trial")}
    >
      <p>
        <Monitor size={16} />
        {t(
          "每位角色都在你選擇的電腦目錄執行 Codex。先確認資料與總預算，再逐項啟動；每項均可停止。",
          "Every specialist runs Codex in your selected local folder. Review inputs and the total budget, then start each task; each can be stopped.",
        )}
      </p>
      <fieldset disabled={blocked || !!busy}>
        <label>
          {t("新會話的本機權限", "Local permissions for new sessions")}
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="read-only">{t("唯讀", "Read only")}</option>
            <option value="workspace-write">
              {t("可寫入所選目錄", "Write to selected folder")}
            </option>
            <option value="full-access">
              {t("完整本機權限", "Full local access")}
            </option>
          </select>
        </label>
        {templates.map((v: any, i: number) => (
          <section className="solution-binding" key={v.template_version_id}>
            <strong>
              {i + 1}. {v.name}
            </strong>
            {roles.includes(v.role_key) ? (
              <>
                <label>
                  {t("已授權的新本機會話", "Authorized fresh local session")}
                  <select
                    value={selected[i] ?? ""}
                    onChange={(e) =>
                      setSelected((s) => ({ ...s, [i]: e.target.value }))
                    }
                  >
                    <option value="">{t("選擇會話", "Choose session")}</option>
                    {sessions
                      .filter(
                        (s) =>
                          s.role === v.role_key &&
                          s.phase === "idle" &&
                          !s.specialist &&
                          !s.task &&
                          !s.revoked &&
                          s.permission &&
                          !Object.entries(selected).some(
                            ([n, id]) => Number(n) !== i && id === s.id,
                          ),
                      )
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.workspace} · {s.permission}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() =>
                    void action("create:" + i, async () => {
                      const session = await native("create", {
                        tenant,
                        project,
                        role: v.role_key,
                      });
                      if (!session) return;
                      const allowed = await native("permission", {
                        id: session.id,
                        mode,
                      });
                      if (allowed.permission && live.current)
                        setSelected((s) => ({ ...s, [i]: session.id }));
                    })
                  }
                >
                  <FolderOpen size={15} />
                  {t("選取目錄並授權", "Choose folder and permissions")}
                </button>
              </>
            ) : (
              <p role="status">
                {t(
                  "此固定角色尚未提供本機執行，請修改方案角色。",
                  "This pinned role does not support local execution. Revise the method's roles.",
                )}
              </p>
            )}
          </section>
        ))}
        <label>
          {t("本次私有簡報", "Private brief for this trial")}
          <textarea
            name="local_solution_brief"
            maxLength={4000}
            rows={3}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
          />
        </label>
        <label>
          {t("整套方案總預算（HKD）", "Total method budget (HKD)")}
          <input
            name="local_solution_budget"
            type="number"
            min={templates.length * 0.01}
            max={100}
            step="0.01"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </label>
        <p className="muted">
          {t(
            "總預算平均分配給固定角色，餘數歸第一項。預留後可逐項執行或取消；不會啟動雲端 Agent。",
            "The total budget is split evenly across pinned roles, with the remainder on the first task. After reservation, run or cancel each task. Preparation does not start an agent.",
          )}
        </p>
        <label className="solution-consent">
          <input
            type="checkbox"
            checked={consent}
            disabled={!ready}
            onChange={(e) => setConsent(e.target.checked)}
          />
          {t(
            "我已核對資料、各目錄權限與總預算，同意預留本機工作額度。",
            "I reviewed the inputs, folder permissions and total budget, and approve the local task reservation.",
          )}
        </label>
        <button
          className="button primary"
          disabled={!ready || !consent}
          onClick={() =>
            void action("prepare", async () => {
              const result = await native("solution.prepare", {
                tenant,
                project,
                solution: method.id,
                sessions: templates.map((_v: any, i: number) => selected[i]),
                trial: {
                  project_id: project,
                  ...(installation ? { installation_id: installation } : {}),
                  bindings,
                  expected_preview_hash: preview.preview_hash,
                  budget_micros: amount,
                  brief: brief.trim(),
                  approval: true,
                },
              });
              if (live.current) {
                setConsent(false);
                onPrepared(result.id);
              }
            })
          }
        >
          {t(
            "確認預算並準備本機任務",
            "Confirm budget and prepare local tasks",
          )}
        </button>
      </fieldset>
      {error && (
        <p role="alert">
          {t("操作尚未完成：", "Action incomplete: ")}
          {error}
        </p>
      )}
      {work.length > 0 && (
        <div className="local-solution-tasks">
          <h4>{t("此方案的本機任務", "Local tasks for this method")}</h4>
          <p className="muted">
            {t(
              "網絡回應不明時，恢復只會核對原預留；已執行的任務不會重新啟動。",
              "After an uncertain network response, resume reconciles the original reservation. Executed tasks are never restarted.",
            )}
          </p>
          {work.map((s) => (
            <article className="solution-binding" key={s.id}>
              <strong>{s.role}</strong>
              <p className="local-solution-path">{s.workspace}</p>
              <p>
                {s.task?.status ?? s.phase} · {t("已用", "Used")}{" "}
                <Money value={s.task?.charged_micros ?? 0} /> ·{" "}
                {t("上限", "Limit")}{" "}
                <Money value={s.task?.budget_micros ?? 0} />
              </p>
              <div className="solution-actions">
                {s.retryable && !s.busy && (
                  <button
                    className="button primary"
                    disabled={!!busy || blocked}
                    onClick={() =>
                      void action(s.id, async () => {
                        await native("retry", { id: s.id });
                      })
                    }
                  >
                    <Play size={14} />
                    {s.phase === "starting"
                      ? t("在本機啟動", "Run locally")
                      : t("核對並恢復", "Reconcile and resume")}
                  </button>
                )}
                {s.phase !== "idle" && (
                  <button
                    className="button secondary"
                    disabled={false}
                    onClick={() => {
                      void native("stop", { id: s.id })
                        .then(load)
                        .catch((e) => setError(e.message));
                    }}
                  >
                    <Square size={14} />
                    {t("停止此項", "Stop this task")}
                  </button>
                )}
                {s.solution?.trialId && (
                  <button
                    className="button secondary"
                    disabled={blocked}
                    onClick={() => onPrepared(s.solution.trialId)}
                  >
                    {t("查看交付與驗收", "Review deliveries")}
                  </button>
                )}
                <Link className="button secondary" to="/app">
                  {t("開啟本機工作台", "Open local workspace")}
                </Link>
              </div>
              {s.error && <p role="status">{s.error}</p>}
            </article>
          ))}
        </div>
      )}
      <button
        type="button"
        className="button secondary"
        disabled={!!busy}
        onClick={() => void load().catch((e) => setError(e.message))}
      >
        <RefreshCw size={14} />
        {t("更新本機會話", "Refresh local sessions")}
      </button>
    </div>
  );
}
