import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Circle,
  GitBranch,
  LockKeyhole,
  Plus,
  RefreshCw,
  Square,
  Users,
  X,
} from "lucide-react";
import { api } from "./api";
import { useWorkspace } from "./context";
import { Badge, ErrorNotice, Modal, Money, PageHeader, useI18n } from "./ui";
import "./agent-groups.css";

type Team = {
  id: string;
  name: string;
  project_id: string;
  version: number;
  state: string;
  coordinator_agent_id: string;
  members: { agent_id: string; role_description: string }[];
};
type Step = {
  key: string;
  agent_id: string;
  title: string;
  prompt: string;
  depends_on: string[];
  budget: string;
};
type Run = {
  id: string;
  name: string;
  state: string;
  revision: number;
  version: number;
  error_code: string | null;
  coordinator_task_id: string;
  approved_budget_micros: number;
  charged_micros: number;
  reserved_micros: number;
  nodes: any[];
  tasks: any[];
  definition: any;
};
const readyRoles = new Set([
  "assistant",
  "designer",
  "ad-creative",
  "ecommerce",
  "social-content",
  "illustration-ip",
  "typography-layout",
  "information-design",
  "marketing-analyst",
  "brand-visual",
  "presentation",
]);
const requestId = () => crypto.randomUUID();

export function AgentGroups() {
  const w = useWorkspace(),
    { t } = useI18n();
  const [teams, setTeams] = useState<Team[]>([]),
    [agents, setAgents] = useState<any[]>([]),
    [selected, setSelected] = useState("");
  const [runs, setRuns] = useState<Run[]>([]),
    [versions, setVersions] = useState<any[]>([]),
    [failure, setFailure] = useState<unknown>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [editor, setEditor] = useState(false);
  const [name, setName] = useState(""),
    [coordinator, setCoordinator] = useState(""),
    [members, setMembers] = useState<Team["members"]>([]);
  const [editing, setEditing] = useState<Team | null>(null),
    [brief, setBrief] = useState(""),
    [steps, setSteps] = useState<Step[]>([]);
  const [parallel, setParallel] = useState(2),
    [coordinatorBudget, setCoordinatorBudget] = useState("1"),
    [review, setReview] = useState<any>(null);
  const [reviewKey, setReviewKey] = useState(""),
    [cancel, setCancel] = useState<Run | null>(null),
    [cancelKey, setCancelKey] = useState("");
  const live = useRef(true),
    sequence = useRef(0),
    detailSequence = useRef(0);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      ++sequence.current;
      ++detailSequence.current;
    };
  }, []);
  const group = teams.find((g) => g.id === selected),
    root = "/v1/agent-groups";
  const request = useCallback(
    (path: string, method = "GET", body?: unknown, key?: string) =>
      api(root + path, {
        method,
        headers: {
          "X-Tenant-ID": w.tenant,
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    [w.tenant],
  );
  const reload = useCallback(async () => {
    const n = ++sequence.current;
    try {
      const [gs, as] = await Promise.all([
        request("?project_id=" + w.project + "&limit=100"),
        api(w.base + "/agents"),
      ]);
      if (!live.current || n !== sequence.current) return;
      setTeams(gs.items);
      setAgents(
        as.items.filter((a: any) => a.enabled && a.content_state === "active"),
      );
      setSelected((id) =>
        gs.items.some((g: Team) => g.id === id) ? id : (gs.items[0]?.id ?? ""),
      );
    } catch (e) {
      if (live.current && n === sequence.current) setFailure(e);
    } finally {
      if (live.current && n === sequence.current) setLoading(false);
    }
  }, [request, w.project, w.base]);
  const loadRuns = useCallback(async () => {
    if (!selected) {
      setRuns([]);
      setVersions([]);
      return;
    }
    const n = ++detailSequence.current;
    try {
      const [rs, vs] = await Promise.all([
        request(`/${selected}/runs?limit=8`),
        request(`/${selected}/versions?limit=20`),
      ]);
      if (live.current && n === detailSequence.current) {
        setRuns(rs.items);
        setVersions(vs.items);
      }
    } catch (e) {
      if (live.current && n === detailSequence.current) setFailure(e);
    }
  }, [request, selected]);
  useEffect(() => {
    if (!window.copyPasteBridge) void reload();
  }, [reload]);
  useEffect(() => {
    if (window.copyPasteBridge) return;
    setRuns([]);
    setVersions([]);
    setReview(null);
    setCancel(null);
    setSteps([]);
    setBrief("");
    void loadRuns();
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadRuns();
    }, 4000);
    return () => {
      window.clearInterval(timer);
      ++detailSequence.current;
    };
  }, [loadRuns]);
  const act = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await operation();
    } catch (e) {
      if (live.current) setFailure(e);
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const openEditor = (g?: Team) => {
    setEditing(g ?? null);
    setName(g?.name ?? "");
    setCoordinator(
      g?.coordinator_agent_id ??
        agents.find((a) => a.role_key === "assistant")?.id ??
        "",
    );
    setMembers(g?.members.map((m) => ({ ...m })) ?? []);
    setEditor(true);
    setFailure(null);
  };
  const save = () =>
    act(async () => {
      const body = { name, coordinator_agent_id: coordinator, members };
      const saved = await request(
        editing ? "/" + editing.id : "",
        editing ? "PATCH" : "POST",
        editing
          ? { ...body, expected_version: editing.version }
          : { ...body, project_id: w.project },
        requestId(),
      );
      if (!live.current) return;
      setEditor(false);
      await reload();
      setSelected(saved.id);
      await loadRuns();
    });
  const addStep = () => {
    if (!group || steps.length >= 16) return;
    let n = steps.length + 1;
    while (steps.some((s) => s.key === "step_" + n)) ++n;
    setSteps([
      ...steps,
      {
        key: "step_" + n,
        agent_id:
          group.members[steps.length % Math.max(1, group.members.length)]
            ?.agent_id ?? "",
        title: "",
        prompt: "",
        depends_on: [],
        budget: "1",
      },
    ]);
    setReview(null);
  };
  const changeStep = (i: number, patch: Partial<Step>) => {
    setSteps((rows) => rows.map((s, j) => (i === j ? { ...s, ...patch } : s)));
    setReview(null);
  };
  const titleOf = (id: string) =>
    agents.find((a) => a.id === id)?.name ??
    versions[0]?.body.bindings.find((a: any) => a.agent_id === id)?.name ??
    t("已停用的專家", "Unavailable specialist");
  const micros = (amount: string) => {
    if (!/^\d+(?:\.\d{1,6})?$/.test(amount))
      throw new Error(
        t(
          "請填寫有效的預算金額，最多六位小數。",
          "Enter a valid budget amount with at most six decimals.",
        ),
      );
    const [whole, decimal = ""] = amount.split("."),
      value = Number(BigInt(whole) * 1000000n + BigInt(decimal.padEnd(6, "0")));
    if (!Number.isSafeInteger(value) || value < 1 || value > 1e12)
      throw new Error(
        t("預算超出可用範圍。", "Budget is outside the permitted range."),
      );
    return value;
  };
  const preflight = () =>
    act(async () => {
      if (!group) return;
      const r = await request(
        `/${group.id}/preflight`,
        "POST",
        {
          expected_version: group.version,
          brief,
          nodes: steps.map(({ budget, ...s }) => ({
            ...s,
            budget_micros: micros(budget),
          })),
          coordinator_budget_micros: micros(coordinatorBudget),
          max_parallelism: parallel,
        },
        requestId(),
      );
      if (live.current) {
        setReview(r);
        setReviewKey(requestId());
      }
    });
  const start = () =>
    act(async () => {
      if (!review || !group) return;
      await request(
        `/${group.id}/runs`,
        "POST",
        {
          preflight_id: review.id,
          expected_version: review.version,
          definition_hash: review.definition_hash,
          approved_budget_micros: review.approved_budget_micros,
          confirm: true,
        },
        reviewKey,
      );
      if (live.current) {
        setReview(null);
        await loadRuns();
      }
    });
  if (window.copyPasteBridge)
    return (
      <PageHeader
        title={t("雲端團隊", "Cloud teams")}
        description={t(
          "請在 Web 版管理雲端團隊。本機工作請使用 Desktop 專家。",
          "Manage cloud teams in the Web app. Use Desktop specialists for local work.",
        )}
      />
    );
  return (
    <div className="team-page">
      <PageHeader
        eyebrow="WORK TOGETHER"
        title={t("讓專家一起完成工作", "Bring your specialists together")}
        description={t(
          "保存團隊分工，安排依賴步驟，再由協調員整理最終交付。",
          "Save a team, arrange its steps and let your coordinator combine the final delivery.",
        )}
        action={
          <button
            className="button primary"
            onClick={() => openEditor()}
            disabled={busy || loading}
          >
            <Plus size={17} />
            {t("建立團隊", "Create team")}
          </button>
        }
      />
      <ErrorNotice error={failure} />
      <div className="team-directory" aria-busy={loading}>
        <label>
          {t("專案團隊", "Project team")}
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={loading || busy}
          >
            <option value="">
              {loading
                ? t("載入中…", "Loading…")
                : t("選擇團隊", "Choose a team")}
            </option>
            {teams.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} · v{g.version}
                {g.state === "archived" ? t(" · 已封存", " · Archived") : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button"
          onClick={() => void act(reload)}
          disabled={busy}
          aria-label={t("重新整理團隊", "Refresh teams")}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {!loading && !teams.length && (
        <section className="team-empty">
          <Users size={28} />
          <h2>
            {t("為下一個企劃組一個團隊", "Build a team for your next brief")}
          </h2>
          <p>
            {t(
              "先在「我的專家」建立助手，再選擇協調員和不同成員。",
              "Create your assistants in Your specialists, then choose a coordinator and distinct members.",
            )}
          </p>
          <Link className="button" to="/app/specialists">
            {t("查看我的專家", "Your specialists")}
            <ArrowUpRight size={15} />
          </Link>
        </section>
      )}
      {group && (
        <>
          <section className="team-overview">
            <div>
              <span className="eyebrow">
                {t("團隊方法", "TEAM METHOD")} · v{group.version}
              </span>
              <h2>{group.name}</h2>
              <p className="muted">
                {t(
                  "團隊設定與專案共享；執行內容和成果只限你本人。",
                  "Team settings are shared with the project. Runs and deliverables are private to you.",
                )}
              </p>
            </div>
            <div className="team-actions">
              <Badge value={group.state} />
              <button
                className="button"
                disabled={busy}
                onClick={() => openEditor(group)}
              >
                {t("編輯團隊", "Edit team")}
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await request(
                      `/${group.id}`,
                      "PATCH",
                      {
                        expected_version: group.version,
                        state: group.state === "active" ? "archived" : "active",
                      },
                      requestId(),
                    );
                    await reload();
                    await loadRuns();
                  })
                }
              >
                {group.state === "active"
                  ? t("封存", "Archive")
                  : t("恢復使用", "Activate")}
              </button>
            </div>
            <div className="team-members">
              <article className="team-coordinator">
                <span className="team-member-icon">
                  <GitBranch size={18} />
                </span>
                <div>
                  <small>
                    {t("協調員 · 最後匯總", "Coordinator · final review")}
                  </small>
                  <strong>{titleOf(group.coordinator_agent_id)}</strong>
                </div>
              </article>
              {group.members.map((m) => (
                <article key={m.agent_id}>
                  <span className="team-member-icon">
                    <Users size={17} />
                  </span>
                  <div>
                    <strong>{titleOf(m.agent_id)}</strong>
                    <p>{m.role_description}</p>
                  </div>
                </article>
              ))}
            </div>
            {versions[0] && (
              <details>
                <summary>
                  {t("固定成員版本與歷史", "Fixed member versions & history")}
                </summary>
                {versions.map((v) => (
                  <div className="team-version" key={v.version}>
                    <strong>
                      v{v.version} · {v.body.name}
                    </strong>
                    <span>
                      {v.body.bindings
                        .map((b: any) => `${b.name} v${b.agent_version}`)
                        .join(" / ")}
                    </span>
                  </div>
                ))}
              </details>
            )}
          </section>
          {group.state === "active" && (
            <section
              className="team-planner"
              aria-label={t("安排團隊工作", "Plan team work")}
            >
              <div className="team-section-title">
                <div>
                  <span className="eyebrow">
                    {t("下一次合作", "NEXT COLLABORATION")}
                  </span>
                  <h2>
                    {t("從一份清楚的 Brief 開始", "Start with a clear brief")}
                  </h2>
                </div>
                <span className="team-private">
                  <LockKeyhole size={14} />
                  {t("我的私有執行", "Your private run")}
                </span>
              </div>
              <fieldset className="team-editable-fields" disabled={busy}>
                <label>
                  {t("整體工作目標", "Overall brief")}
                  <textarea
                    rows={3}
                    maxLength={8000}
                    value={brief}
                    onChange={(e) => {
                      setBrief(e.target.value);
                      setReview(null);
                    }}
                    placeholder={t(
                      "例如：準備新品推廣的視覺方向、廣告素材與企劃簡報。",
                      "For example: prepare the visual direction, ad creative and presentation for a product launch.",
                    )}
                  />
                </label>
                <div className="team-step-list">
                  {steps.map((s, i) => (
                    <article className="team-step" key={s.key}>
                      <div className="team-step-heading">
                        <span className="team-step-number">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <strong>{t("專家步驟", "Specialist step")}</strong>
                        <button
                          className="icon-button"
                          aria-label={t(
                            `移除步驟 ${i + 1}`,
                            `Remove step ${i + 1}`,
                          )}
                          onClick={() => {
                            setSteps((rows) =>
                              rows
                                .filter((row) => row.key !== s.key)
                                .map((row) => ({
                                  ...row,
                                  depends_on: row.depends_on.filter(
                                    (k) => k !== s.key,
                                  ),
                                })),
                            );
                            setReview(null);
                          }}
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <div className="team-input-pair">
                        <label>
                          {t("執行成員", "Assigned specialist")}
                          <select
                            value={s.agent_id}
                            onChange={(e) =>
                              changeStep(i, { agent_id: e.target.value })
                            }
                          >
                            <option value="">
                              {t("選擇成員", "Choose member")}
                            </option>
                            {group.members.map((m) => (
                              <option key={m.agent_id} value={m.agent_id}>
                                {titleOf(m.agent_id)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {t("步驟名稱", "Step title")}
                          <input
                            maxLength={160}
                            value={s.title}
                            onChange={(e) =>
                              changeStep(i, { title: e.target.value })
                            }
                          />
                        </label>
                      </div>
                      <label>
                        {t("具體要求", "Instructions")}
                        <textarea
                          rows={2}
                          maxLength={8000}
                          value={s.prompt}
                          onChange={(e) =>
                            changeStep(i, { prompt: e.target.value })
                          }
                        />
                      </label>
                      <div className="team-step-footer">
                        <fieldset>
                          <legend>
                            {t("等待這些步驟完成", "Wait for these steps")}
                          </legend>
                          {i === 0 && (
                            <span className="muted">
                              {t("可直接開始", "Ready to start")}
                            </span>
                          )}
                          {steps.slice(0, i).map((d, j) => (
                            <label className="team-check" key={d.key}>
                              <input
                                type="checkbox"
                                checked={s.depends_on.includes(d.key)}
                                onChange={(e) =>
                                  changeStep(i, {
                                    depends_on: e.target.checked
                                      ? [...s.depends_on, d.key]
                                      : s.depends_on.filter((k) => k !== d.key),
                                  })
                                }
                              />
                              {j + 1}.{" "}
                              {d.title || t("未命名步驟", "Untitled step")}
                            </label>
                          ))}
                        </fieldset>
                        <label className="team-budget">
                          {t("預算上限（HKD）", "Budget cap (HKD)")}
                          <input
                            type="number"
                            min="0.000001"
                            max="1000000"
                            step="0.01"
                            value={s.budget}
                            onChange={(e) =>
                              changeStep(i, { budget: e.target.value })
                            }
                          />
                        </label>
                      </div>
                    </article>
                  ))}
                </div>
                <button
                  className="button"
                  onClick={addStep}
                  disabled={!group.members.length || steps.length >= 16}
                >
                  <Plus size={16} />
                  {t("新增步驟", "Add step")}
                </button>
                <div className="team-final-step">
                  <ArrowDown size={20} />
                  <div>
                    <strong>
                      {t(
                        "協調員整理最終交付",
                        "Coordinator combines the final delivery",
                      )}
                    </strong>
                    <p>
                      {t(
                        "所有成員完成後才執行；每步失敗都會停止後續派工。",
                        "Starts after every member finishes. A failed step stops further dispatch.",
                      )}
                    </p>
                  </div>
                  <label className="team-budget">
                    {t("協調員上限（HKD）", "Coordinator cap (HKD)")}
                    <input
                      type="number"
                      min="0.000001"
                      step="0.01"
                      value={coordinatorBudget}
                      onChange={(e) => {
                        setCoordinatorBudget(e.target.value);
                        setReview(null);
                      }}
                    />
                  </label>
                </div>
                <div className="team-plan-submit">
                  <label>
                    {t("最多同時執行", "Maximum parallel steps")}
                    <select
                      value={parallel}
                      onChange={(e) => {
                        setParallel(Number(e.target.value));
                        setReview(null);
                      }}
                    >
                      {[1, 2, 3].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="button primary"
                    disabled={
                      busy ||
                      !brief.trim() ||
                      !steps.length ||
                      steps.some(
                        (s) =>
                          !s.agent_id || !s.title.trim() || !s.prompt.trim(),
                      )
                    }
                    onClick={() => void preflight()}
                  >
                    {busy
                      ? t("處理中…", "Working…")
                      : t("檢查分工與預算", "Review team & budget")}
                  </button>
                </div>
              </fieldset>
            </section>
          )}
          <section
            className="team-runs"
            aria-label={t("我的團隊執行", "My team runs")}
          >
            <div className="team-section-title">
              <h2>{t("我的團隊執行", "Your team runs")}</h2>
              <span className="muted">{t("最近 8 次", "Latest 8 runs")}</span>
            </div>
            {!runs.length && (
              <p className="muted">
                {t(
                  "確認分工與預算後，實際進度會出現在這裡。",
                  "Once you approve a plan, follow its actual progress here.",
                )}
              </p>
            )}
            {runs.map((run) => (
              <article className="team-run" key={run.id}>
                <header>
                  <div>
                    <span className="eyebrow">
                      v{run.version} · {t("雲端 Codex", "Cloud Codex")}
                    </span>
                    <h3>{run.name}</h3>
                  </div>
                  <Badge value={run.state} />
                  {run.state === "running" && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => {
                        setCancel(run);
                        setCancelKey(requestId());
                      }}
                    >
                      <Square size={13} />
                      {t("停止團隊", "Stop run")}
                    </button>
                  )}
                </header>
                <div className="team-run-cost">
                  <span>
                    {t("已批准上限", "Approved maximum")}{" "}
                    <Money value={run.approved_budget_micros} />
                  </span>
                  <span>
                    {t("當前預留", "Currently reserved")}{" "}
                    <Money value={run.reserved_micros} />
                  </span>
                  <span>
                    {t("實際消耗", "Actual charges")}{" "}
                    <Money value={run.charged_micros} />
                  </span>
                </div>
                <ol>
                  {[
                    ...run.nodes.map((n) => ({
                      ...n,
                      title: run.definition.nodes.find(
                        (s: any) => s.key === n.step_key,
                      )?.title,
                    })),
                    {
                      step_key: "coordinator",
                      title: t("最終整理", "Final delivery"),
                      task_id: run.coordinator_task_id,
                      state:
                        run.tasks.find((t) => t.step_key === "coordinator")
                          ?.status ?? "pending",
                      depends_on: [],
                    },
                  ].map((n) => {
                    const task = run.tasks.find(
                        (task) => task.id === n.task_id,
                      ),
                      status = task?.status ?? n.state;
                    return (
                      <li key={n.step_key}>
                        {status === "succeeded" ? (
                          <Check size={17} />
                        ) : (
                          <Circle size={14} />
                        )}
                        <div>
                          <strong>{n.title}</strong>
                          {n.depends_on.length > 0 && (
                            <small>
                              {t("等待：", "After: ")}
                              {n.depends_on.join(", ")}
                            </small>
                          )}
                        </div>
                        <Badge value={status} />
                        {n.task_id && (
                          <Link
                            to={"/app/tasks/" + n.task_id}
                            className="button"
                          >
                            {t("查看工作", "View task")}
                            <ArrowUpRight size={14} />
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ol>
                {run.error_code && (
                  <p role="status" className="muted">
                    {t(
                      "本次執行已停止；請檢查步驟詳情後重新審閱新的工作。",
                      "This run stopped. Check its task details before reviewing a new run.",
                    )}{" "}
                    <code>{run.error_code}</code>
                  </p>
                )}
              </article>
            ))}
          </section>
        </>
      )}
      {editor && (
        <Modal
          title={
            editing ? t("編輯團隊", "Edit team") : t("建立團隊", "Create team")
          }
          onClose={() => {
            if (!busy) setEditor(false);
          }}
        >
          <form
            className="team-editor"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <ErrorNotice error={failure} />
            <label>
              {t("團隊名稱", "Team name")}
              <input
                value={name}
                maxLength={160}
                required
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              {t("協調員", "Coordinator")}
              <select
                required
                value={coordinator}
                onChange={(e) => {
                  setCoordinator(e.target.value);
                  setMembers((ms) =>
                    ms.filter((m) => m.agent_id !== e.target.value),
                  );
                }}
              >
                <option value="">
                  {t("選擇通用助手", "Choose a general assistant")}
                </option>
                {agents
                  .filter((a) => a.role_key === "assistant")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
            <p className="muted">
              {t(
                "協調員負責最終整理。成員各自使用已安裝的 Codex、Skill 與工具。",
                "The coordinator handles the final review. Each member uses its installed Codex, Skills and tools.",
              )}
            </p>
            {members.map((m, i) => (
              <fieldset key={i}>
                <legend>{t(`成員 ${i + 1}`, `Member ${i + 1}`)}</legend>
                <label>
                  {t("專家", "Specialist")}
                  <select
                    value={m.agent_id}
                    required
                    onChange={(e) =>
                      setMembers((ms) =>
                        ms.map((v, j) =>
                          i === j ? { ...v, agent_id: e.target.value } : v,
                        ),
                      )
                    }
                  >
                    <option value="">
                      {t("選擇專家", "Choose specialist")}
                    </option>
                    {agents
                      .filter(
                        (a) =>
                          a.id !== coordinator &&
                          readyRoles.has(a.role_key) &&
                          !members.some(
                            (v, j) => j !== i && v.agent_id === a.id,
                          ),
                      )
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  {t("分工說明", "Responsibility")}
                  <textarea
                    required
                    maxLength={1200}
                    rows={2}
                    value={m.role_description}
                    onChange={(e) =>
                      setMembers((ms) =>
                        ms.map((v, j) =>
                          i === j
                            ? { ...v, role_description: e.target.value }
                            : v,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    setMembers((ms) => ms.filter((_, j) => i !== j))
                  }
                >
                  {t("移除成員", "Remove member")}
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              className="button"
              disabled={members.length >= 7}
              onClick={() =>
                setMembers([...members, { agent_id: "", role_description: "" }])
              }
            >
              <Plus size={15} />
              {t("新增成員", "Add member")}
            </button>
            {editing && (
              <p className="muted">
                {t(
                  "儲存會建立新團隊版本，固定所選專家的當前版本。進行中的工作保留原有版本。",
                  "Saving creates a new team version with the selected specialists' current versions. Existing runs keep their original versions.",
                )}
              </p>
            )}
            <footer>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setEditor(false)}
              >
                {t("取消", "Cancel")}
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={busy || !coordinator || !name.trim()}
              >
                {t("儲存團隊", "Save team")}
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {review && group && (
        <Modal
          title={t("確認本次分工與預算", "Approve this team plan")}
          onClose={() => {
            if (!busy) setReview(null);
          }}
        >
          <div className="team-review">
            <ErrorNotice error={failure} />
            <p>
              {t(
                "確認後會建立私有雲端工作。每步啟動時才預留其金額；總消耗不會超過這次批准的上限。",
                "Approval creates private cloud work. Each step reserves its allocation when it starts; total charges stay within this approved maximum.",
              )}
            </p>
            <div className="team-review-total">
              <span>{t("本次總上限", "Approved maximum")}</span>
              <strong>
                <Money value={review.approved_budget_micros} />
              </strong>
            </div>
            <p className="team-reviewed-brief">{review.definition.brief}</p>
            <ol>
              {[...review.definition.nodes, review.definition.coordinator].map(
                (n: any) => (
                  <li key={n.key}>
                    <div>
                      <strong>{n.title}</strong>
                      <small>
                        {n.member_name} · v{n.agent_version} · {n.role_key}
                      </small>
                      <p>
                        {n.customer_prompt ??
                          t(
                            "所有成員完成後，整理本次工作成果。",
                            "Combine this run's deliverables after all members finish.",
                          )}
                      </p>
                      {n.depends_on.length > 0 && (
                        <small>
                          {t("等待：", "After: ")}
                          {n.depends_on
                            .map(
                              (key: string) =>
                                review.definition.nodes.find(
                                  (s: any) => s.key === key,
                                )?.title ?? key,
                            )
                            .join(" / ")}
                        </small>
                      )}
                    </div>
                    <Money value={n.budget_micros} />
                  </li>
                ),
              )}
            </ol>
            <p className="muted">
              {t(
                "待審預算不會扣費；若餘額不足或權限失效，後續步驟會安全停止。審閱有效期 15 分鐘。",
                "Reviewing is free. Later steps stop safely if funds or permissions become unavailable. This review expires in 15 minutes.",
              )}
            </p>
            <footer>
              <button
                className="button"
                disabled={busy}
                onClick={() => setReview(null)}
              >
                {t("返回修改", "Back to edit")}
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void start()}
              >
                {t("批准並開始執行", "Approve & start")}
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {cancel && group && (
        <Modal
          title={t("停止這次團隊工作", "Stop this team run")}
          onClose={() => {
            if (!busy) setCancel(null);
          }}
        >
          <div className="team-review">
            <ErrorNotice error={failure} />
            <p>
              {t(
                "會停止新步驟並請求取消正在執行的工作。已實際消耗的金額保留；尚未確定的外部操作會保留待對帳。",
                "This stops new steps and requests cancellation of active work. Actual charges remain; uncertain external operations stay in reconciliation.",
              )}
            </p>
            <footer>
              <button
                className="button"
                disabled={busy}
                onClick={() => setCancel(null)}
              >
                {t("繼續執行", "Keep running")}
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await request(
                      `/${group.id}/runs/${cancel.id}/cancel`,
                      "POST",
                      { expected_revision: cancel.revision },
                      cancelKey,
                    );
                    if (live.current) {
                      setCancel(null);
                      await loadRuns();
                    }
                  })
                }
              >
                {t("確認停止", "Confirm stop")}
              </button>
            </footer>
          </div>
        </Modal>
      )}
    </div>
  );
}
