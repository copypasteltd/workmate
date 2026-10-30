import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  GitBranch,
  LockKeyhole,
  Plus,
  RefreshCw,
  Square,
  Users,
  X,
} from "lucide-react";
import { api, download } from "./api";
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
  created_at: string;
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
  "assistant", "fullstack", "frontend", "backend-api", "software-qa", "landing-page", "ui-ux", "video-motion",
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
async function native(action: string, payload: unknown) {
  const reply = await window.copyPasteBridge!.localAgent(action, payload);
  if (!reply.ok) throw new Error(reply.code ?? "LOCAL_OPERATION_FAILED");
  return reply.value;
}

export function AgentGroups() {
  const w = useWorkspace();
  return (
    <AgentGroupsWorkspace key={`${w.me?.user?.id}:${w.tenant}:${w.project}`} />
  );
}

function HistoryPager({
  label,
  page,
  hasNext,
  previous,
  next,
  disabled,
  onPrevious,
  onNext,
}: {
  label: string;
  page: number;
  hasNext: boolean;
  previous: string;
  next: string;
  disabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const { t } = useI18n();
  return (
    <nav className="team-pagination" aria-label={label}>
      <button
        className="button"
        disabled={disabled || page === 1}
        onClick={onPrevious}
        aria-label={previous}
      >
        <ChevronLeft size={15} />
        {previous}
      </button>
      <span className="muted" role="status" aria-live="polite">
        {t(`第 ${page} 頁`, `Page ${page}`)}
      </span>
      <button
        className="button"
        disabled={disabled || !hasNext}
        onClick={onNext}
        aria-label={next}
      >
        {next}
        <ChevronRight size={15} />
      </button>
    </nav>
  );
}

type HistoryPages<T> = { group: string; cursors: (T | null)[] };

function AgentGroupsWorkspace() {
  const w = useWorkspace(),
    { t } = useI18n();
  const [permissionMode, setPermissionMode] = useState("workspace-write");
  const [localSessions, setLocalSessions] = useState<any[]>([]);
  const localReviews = useRef(new Map<string,string>());
  const permissionRef=useRef(permissionMode); permissionRef.current=permissionMode;
  const [teams, setTeams] = useState<Team[]>([]),
    [agents, setAgents] = useState<any[]>([]),
    [group, setGroup] = useState<Team | null>(null);
  const [teamPages, setTeamPages] = useState<(string | null)[]>([null]),
    [nextTeam, setNextTeam] = useState<string | null>(null),
    [runPages, setRunPages] = useState<HistoryPages<string>>({
      group: "",
      cursors: [null],
    }),
    [versionPages, setVersionPages] = useState<HistoryPages<number>>({
      group: "",
      cursors: [null],
    });
  const [runs, setRuns] = useState<Run[]>([]),
    [versions, setVersions] = useState<any[]>([]),
    [failure, setFailure] = useState<unknown>(null);
  const [nextRun, setNextRun] = useState<string | null>(null),
    [nextVersion, setNextVersion] = useState<number | null>(null),
    [fixedBindings, setFixedBindings] = useState<any[]>([]),
    [historyLoading, setHistoryLoading] = useState(false);
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
    detailSequence = useRef(0),
    groupRef = useRef(group);
  groupRef.current = group;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      ++sequence.current;
      ++detailSequence.current;
    };
  }, []);
  const selected = group?.id ?? "",
    teamCursor = teamPages[teamPages.length - 1],
    runCursors = runPages.group === selected ? runPages.cursors : [null],
    versionCursors =
      versionPages.group === selected ? versionPages.cursors : [null],
    runCursor = runCursors[runCursors.length - 1],
    versionCursor = versionCursors[versionCursors.length - 1],
    directoryTeams =
      group && !teams.some((g) => g.id === group.id)
        ? [group, ...teams]
        : teams,
    root = "/v1/agent-groups";
  const request = useCallback(
    async (path: string, method = "GET", body?: any, key?: string) => {
      const preflight = /^\/([a-f0-9-]{36})\/preflight$/.exec(path);
      if (method === "POST" && preflight) {
        const result = await native("team.prepare", { tenant:w.tenant, project:w.project, group:preflight[1], plan:body, mode:permissionRef.current });
        if (!result) throw new Error("LOCAL_TEAM_PERMISSION_CANCELLED");
        localReviews.current.set(result.id,result.local_session_id);
        return result;
      }
      const admission = /^\/([a-f0-9-]{36})\/runs$/.exec(path);
      if (method === "POST" && admission) {
        const id = localReviews.current.get(body?.preflight_id);
        if (!id) throw new Error("LOCAL_TEAM_REVIEW_CHANGED");
        return native("team.start", { id, preflightId:body.preflight_id });
      }
      const stop = /^\/([a-f0-9-]{36})\/runs\/([a-f0-9-]{36})\/cancel$/.exec(path);
      if (method === "POST" && stop) return native("team.cancel-run", { tenant:w.tenant, project:w.project,
        group:stop[1], run:stop[2], expectedRevision:body.expected_revision, requestId:key });
      const nativePath = path.replace(/^(\/[a-f0-9-]{36})\/runs(?=[/?]|$)/,"$1/native/runs");
      return api(root + nativePath, { method, headers:{ "X-Tenant-ID":w.tenant, ...(key?{"Idempotency-Key":key}:{}) },
        ...(body===undefined?{}:{body:JSON.stringify(body)}) });
    }, [w.tenant,w.project],
  );
  const reload = useCallback(
    async (preferred?: Team | null) => {
      const n = ++sequence.current;
      setLoading(true);
      try {
        const [gs, as] = await Promise.all([
          request(
            "?project_id=" +
              w.project +
              "&limit=100" +
              (teamCursor ? "&cursor=" + teamCursor : ""),
          ),
          api(w.base + "/agents"),
        ]);
        if (!live.current || n !== sequence.current) return;
        const current =
          preferred === null ? null : (preferred ?? groupRef.current);
        let active = current
          ? gs.items.find((g: Team) => g.id === current.id)
          : null;
        if (current && !active) {
          try {
            active = await request("/" + current.id);
          } catch (e) {
            if ((e as any).status !== 404 && (e as any).status !== 403) throw e;
          }
        }
        if (!live.current || n !== sequence.current) return;
        setTeams(gs.items);
        setNextTeam(gs.next_cursor);
        setAgents(
          as.items.filter(
            (a: any) => a.enabled && a.content_state === "active",
          ),
        );
        if ((active ?? gs.items[0])?.id !== groupRef.current?.id) {
          setRunPages({ group: "", cursors: [null] });
          setVersionPages({ group: "", cursors: [null] });
        } else if (active?.version !== groupRef.current?.version) {
          setVersionPages({ group: "", cursors: [null] });
        }
        setGroup(active ?? gs.items[0] ?? null);
      } catch (e) {
        if (live.current && n === sequence.current) {
          setTeams([]);
          setGroup(null);
          setNextTeam(null);
          setFailure(e);
        }
      } finally {
        if (live.current && n === sequence.current) setLoading(false);
      }
    },
    [request, w.project, w.base, teamCursor],
  );
  const loadRuns = useCallback(
    async (quiet = false) => {
      if (!selected) return;
      const n = ++detailSequence.current;
      if (!quiet) setHistoryLoading(true);
      try {
        const [rs, vs, locals] = await Promise.all([
          request(
            `/${selected}/runs?limit=8` +
              (runCursor ? "&cursor=" + runCursor : ""),
          ),
          request(
            `/${selected}/versions?limit=20` +
              (versionCursor !== null ? "&before=" + versionCursor : ""),
          ),
          native("list", {tenant:w.tenant,project:w.project}),
        ]);
        const pinned =
          vs.items.find((v: any) => v.version === group?.version) ??
          (
            await request(
              `/${selected}/versions?limit=1&before=${(group?.version ?? 0) + 1}`,
            )
          ).items[0];
        if (live.current && n === detailSequence.current) {
          setRuns(rs.items);
          setLocalSessions(locals.sessions.filter((s:any)=>s.team));
          setVersions(vs.items);
          setNextRun(rs.next_cursor);
          setNextVersion(vs.next_before);
          setFixedBindings(pinned?.body.bindings ?? []);
        }
      } catch (e) {
        if (live.current && n === detailSequence.current) {
          setRuns([]);
          setVersions([]);
          setNextRun(null);
          setNextVersion(null);
          setFixedBindings([]);
          setFailure(e);
        }
      } finally {
        if (live.current && n === detailSequence.current)
          setHistoryLoading(false);
      }
    },
    [request, selected, group?.version, runCursor, versionCursor],
  );
  useEffect(() => {
    void reload(null);
  }, [reload]);
  useEffect(() => {
    setRuns([]);
    setVersions([]);
    setReview(null);
    setCancel(null);
    setSteps([]);
    setBrief("");
    setFixedBindings([]);
    setNextRun(null);
    setNextVersion(null);
  }, [selected]);
  useEffect(() => {
    setReview(null);
  }, [group?.version]);
  useEffect(() => {
    if (!selected) return;
    void loadRuns();
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadRuns(true);
    }, 4000);
    return () => {
      window.clearInterval(timer);
      ++detailSequence.current;
    };
  }, [loadRuns, selected]);
  const selectGroup = (g: Team | null) => {
    ++detailSequence.current;
    setRuns([]);
    setVersions([]);
    setFixedBindings([]);
    setRunPages({ group: "", cursors: [null] });
    setVersionPages({ group: "", cursors: [null] });
    setGroup(g);
    setFailure(null);
  };
  const changeDirectory = (pages: (string | null)[]) => {
    if (busy || loading) return;
    ++sequence.current;
    selectGroup(null);
    setLoading(true);
    setTeamPages(pages);
  };
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
      await reload(saved);
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
    fixedBindings.find((a: any) => a.agent_id === id)?.name ??
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
        if (runCursor === null) await loadRuns();
        else setRunPages({ group: selected, cursors: [null] });
        window.requestAnimationFrame(() => {
          if (live.current) document.querySelector(".team-runs")?.scrollIntoView({ block: "start", behavior: "smooth" });
        });
      }
    });
  return (
    <div className="team-page">
      <label className="team-native-permission">{t("團隊本機權限","Team local permission")}
        <select value={permissionMode} disabled={busy||!!review} onChange={e=>setPermissionMode(e.target.value)}>
          <option value="read-only">{t("唯讀","Read only")}</option><option value="workspace-write">{t("工作目錄讀寫","Workspace write")}</option><option value="full-access">{t("完整本機權限","Full local access")}</option>
        </select>
      </label>
      <PageHeader
        eyebrow="WORK TOGETHER"
        title={t("本機專家團隊", "Your local specialist team")}
        description={t(
          "由此電腦的 Codex 分工執行，在獲准的本機目錄工作，再由協調員整理交付。",
          "Codex runs each member on this computer in your approved folder, then the coordinator combines their delivery.",
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
            onChange={(e) =>
              selectGroup(
                directoryTeams.find((g) => g.id === e.target.value) ?? null,
              )
            }
            disabled={loading || busy}
          >
            <option value="">
              {loading
                ? t("載入中…", "Loading…")
                : t("選擇團隊", "Choose a team")}
            </option>
            {directoryTeams.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} · v{g.version}
                {g.state === "archived" ? t(" · 已封存", " · Archived") : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button"
          onClick={() => void act(() => reload())}
          disabled={busy}
          aria-label={t("重新整理團隊", "Refresh teams")}
        >
          <RefreshCw size={16} />
        </button>
        <HistoryPager
          label={t("團隊分頁", "Team pages")}
          page={teamPages.length}
          hasNext={nextTeam !== null}
          disabled={busy || loading}
          previous={t("上一頁團隊", "Previous teams")}
          next={t("下一頁團隊", "Next teams")}
          onPrevious={() => changeDirectory(teamPages.slice(0, -1))}
          onNext={() => nextTeam && changeDirectory([...teamPages, nextTeam])}
        />
      </div>
      {!loading && !directoryTeams.length && (
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
            <details aria-busy={historyLoading}>
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
              <HistoryPager
                label={t("版本歷史分頁", "Version history pages")}
                page={versionCursors.length}
                hasNext={nextVersion !== null}
                disabled={busy || historyLoading}
                previous={t("較新版本", "Newer versions")}
                next={t("較舊版本", "Older versions")}
                onPrevious={() =>
                  setVersionPages({
                    group: selected,
                    cursors: versionCursors.slice(0, -1),
                  })
                }
                onNext={() =>
                  nextVersion !== null &&
                  setVersionPages({
                    group: selected,
                    cursors: [...versionCursors, nextVersion],
                  })
                }
              />
            </details>
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
            <div className="team-section-title" aria-busy={historyLoading}>
              <h2>{t("我的團隊執行", "Your team runs")}</h2>
              <span className="muted">
                {runCursor === null
                  ? t("最新執行", "Newest runs")
                  : t("歷史執行", "Earlier runs")}
              </span>
            </div>
            <HistoryPager
              label={t("執行歷史分頁", "Run history pages")}
              page={runCursors.length}
              hasNext={nextRun !== null}
              disabled={busy || historyLoading}
              previous={t("較新執行", "Newer runs")}
              next={t("較舊執行", "Older runs")}
              onPrevious={() =>
                setRunPages({
                  group: selected,
                  cursors: runCursors.slice(0, -1),
                })
              }
              onNext={() =>
                nextRun &&
                setRunPages({
                  group: selected,
                  cursors: [...runCursors, nextRun],
                })
              }
            />
            {!runs.length && (
              <p className="muted">
                {t(
                  "確認分工與預算後，實際進度會出現在這裡。",
                  "Once you approve a plan, follow its actual progress here.",
                )}
              </p>
            )}
            {localSessions.filter(s=>!s.team.stepKey && s.team.group===selected && !s.team.runId && ["accepting","interrupted"].includes(s.team.phase)).map(s=><div className="team-native-session" key={s.id}>
              <p>{t("此電腦有一項待同步的受理。繼續只取回原回執。","An admission is pending on this computer. Continue retrieves its original receipt.")}</p>
              <button className="button" disabled={busy||s.busy||s.revoked} onClick={()=>void act(async()=>{await native("team.resume",{id:s.id});await loadRuns();})}>{t("同步原受理","Recover admission")}</button>
              <button className="button" disabled={busy} onClick={()=>void act(async()=>{await native("team.cancel",{id:s.id});await loadRuns();})}>{t("停止並同步","Stop and synchronize")}</button>
            </div>)}
            {runs.map((run) => {
              const local = localSessions.find(s=>!s.team.stepKey && s.team.runId===run.id);
              return <article className="team-run" key={run.id} data-run-id={run.id}>
                <header>
                  <div>
                    <span className="eyebrow">
                      v{run.version} · {t("本機 Codex", "Local Codex")}
                    </span>
                    <h3>{run.name}</h3>
                    <time
                      className="team-run-created"
                      dateTime={run.created_at}
                    >
                      {new Intl.DateTimeFormat(t("zh-HK", "en-HK"), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(run.created_at))}
                    </time>
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
                {local && <div className="team-native-session">
                  <span>{local.workspace} · {local.permission ?? t("已撤權","Revoked")}</span>
                  {local.team.error && <code role="status">{local.team.error}</code>}
                  {run.state==="running" && !local.busy && <button className="button" disabled={busy||local.revoked} onClick={()=>void act(async()=>{await native("team.resume",{id:local.id});await loadRuns();})}>{t("繼續原團隊","Resume original run")}</button>}
                  <Link className="button" to={`/app?native_project=${w.project}&native_session=${local.id}`}>{t("本機會話","Local session")}</Link>
                  {!local.revoked && <button className="button" disabled={busy} onClick={()=>void act(async()=>{await native("revoke",{id:local.id});await loadRuns();})}>{t("撤銷本機權限","Revoke local access")}</button>}
                </div>}
                {["succeeded","failed","cancelled"].includes(run.state) && <button className="button" disabled={busy} onClick={()=>void act(async()=>{
                  const info=await request(`/${selected}/runs/${run.id}/delivery`);
                  await download(`${root}/${selected}/native/runs/${run.id}/download?expected_revision=${run.revision}&expected_delivery_hash=${info.delivery_hash}`,`workmate-team-${run.id}.zip`,w.tenant);
                })}>{t("下載團隊交付包","Download team delivery")}</button>}
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
                            to={localSessions.some(s=>s.task?.task_id===n.task_id) ? `/app?native_project=${w.project}&native_session=${localSessions.find(s=>s.task?.task_id===n.task_id)!.id}` : "/app/tasks/" + n.task_id}
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
              </article>;
            })}
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
                "確認後，團隊會在此電腦使用 Codex 執行。每步及協調員均受已批准的預算限制；預留金額與實際消耗分開顯示。",
                "Approval starts the team with Codex on this computer. Each step and the coordinator stay within their approved budgets; reserved funds and actual charges are shown separately.",
              )}
            </p>
            <p className="team-native-workspace"><strong>{t("本機工作目錄","Local workspace")}</strong><br/>{review.workspace}<br/>{review.permission}</p>
            <p>{t("成員會共用此目錄；並行步驟應分開檔案，避免同時修改同一檔案。可隨時停止整個團隊或撤銷權限。", "Members share this folder. Use separate files for parallel steps. Stop the whole team or revoke access at any time.")}</p>
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
