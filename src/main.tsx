import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Building2,
  ChartNoAxesCombined,
  Wallet,
  ShieldCheck,
  Files,
  Workflow,
  BookOpen,
  Plug,
  KeyRound,
  Headphones,
  ScrollText,
  ListChecks,
  SlidersHorizontal,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  LogOut,
  Menu,
  X,
  RefreshCw,
  Download,
  Eye,
  Pause,
  Play,
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Mail,
  Monitor,
  Crown,
  AlertTriangle,
  Clock,
  FileText,
} from "lucide-react";
import { api, post, patch, download } from "./api";
import {
  Preferences,
  useI18n,
  useData,
  ErrorNotice,
  Loading,
  Modal,
  PageHeader,
  Badge,
  Money,
  DateText,
  AsyncForm,
  Field,
  Empty,
} from "./ui";
import {
  Enrollment,
  AuthenticatorSettings,
  InviteAdministrator,
  PrincipalActions,
  PrincipalDetail,
} from "./admin-identities";
import "./style.css";
import "./admin.css";

const Context = createContext<{
  me: any;
  refresh: () => Promise<void>;
  has: (key: string) => boolean;
}>(null!);
const useAdmin = () => useContext(Context);
function Logo() {
  return (
    <Link to="/" className="logo">
      <img className="logo-light" src="/brand-mark.png" alt="" />
      <img className="logo-dark" src="/brand-mark.png" alt="" />
      <strong>CopyPaste</strong>
      <span className="admin-label">ADMIN</span>
    </Link>
  );
}
function App() {
  const [me, setMe] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<Error | null>(null);
  async function refresh() {
    try {
      setMe(await api("/v1/admin/me"));
      setError(null);
    } catch (e) {
      if ((e as any).status === 401) {
        setMe(null);
        setError(null);
      } else setError(e as Error);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <Preferences>
      <Context.Provider
        value={{
          me,
          refresh,
          has: (key) => me?.permissions.includes(key) ?? false,
        }}
      >
        <BrowserRouter>
          <AdminEntry loading={loading} error={error} />
        </BrowserRouter>
      </Context.Provider>
    </Preferences>
  );
}
function AdminEntry({
  loading,
  error,
}: {
  loading: boolean;
  error: Error | null;
}) {
  const { pathname } = useLocation(),
    a = useAdmin();
  if (pathname === "/enroll")
    return (
      <Enrollment
        me={a.me}
        onComplete={a.refresh}
        onLogout={async () => {
          await post("/v1/admin/auth/logout");
          await a.refresh();
        }}
      />
    );
  if (loading) return <Loading />;
  if (error)
    return (
      <div className="center-page">
        <ErrorNotice error={error} />
        <button className="button primary" onClick={() => void a.refresh()}>
          Retry
        </button>
      </div>
    );
  return a.me ? <AdminShell /> : <Login />;
}
function Login() {
  const { t } = useI18n(),
    a = useAdmin();
  const [challenge, setChallenge] = useState<any>(null),
    [address, setAddress] = useState("");
  return (
    <div className="auth-layout">
      <section className="auth-content">
        <Logo />
        <div className="auth-form">
          <p className="eyebrow">THE CARE BEHIND THE WORK.</p>
          <h1>
            {t("管理好每一份", "Make room for")}
            <br />
            <em>{t("信任。", "better oversight.")}</em>
          </h1>
          <p className="muted">
            {t(
              "使用管理員郵箱和驗證器登入。企業用戶帳戶不能直接進入此控制面板。",
              "Sign in with your administrator email and authenticator. Workspace accounts use a separate sign-in.",
            )}
          </p>
          {!challenge ? (
            <AsyncForm
              submitLabel={t("發送登入驗證碼", "Send admin sign-in code")}
              onSubmit={async (f) => {
                const email = String(f.get("email"));
                setChallenge(await post("/v1/admin/auth/challenge", { email }));
                setAddress(email);
              }}
            >
              <Field label={t("管理員郵箱", "Administrator email")}>
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="admin@company.hk"
                  required
                />
              </Field>
            </AsyncForm>
          ) : (
            <>
              <div className="notice">
                <Mail size={18} />
                <span>
                  {challenge.delivery === "local_mailbox"
                    ? t(
                        "開發驗證碼已寫入本機郵箱。",
                        "A development code is ready in your local mailbox.",
                      )
                    : t(
                        `請檢查 ${address} 的驗證碼。`,
                        `Check ${address} for a sign-in code.`,
                      )}
                </span>
              </div>
              <AsyncForm
                submitLabel={t("驗證並登入後台", "Verify & open dashboard")}
                onSubmit={async (f) => {
                  await post("/v1/admin/auth/verify", {
                    challenge_id: challenge.challenge_id,
                    code: String(f.get("code")),
                    totp: String(f.get("totp")),
                  });
                  await a.refresh();
                }}
              >
                <Field label={t("郵箱驗證碼", "Email code")}>
                  <input
                    name="code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                  />
                </Field>
                <Field label={t("驗證器 MFA 代碼", "Authenticator MFA code")}>
                  <input
                    name="totp"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    inputMode="numeric"
                    required
                  />
                </Field>
              </AsyncForm>
              <button
                className="text-button"
                onClick={() => setChallenge(null)}
              >
                {t("重新開始", "Start again")}
              </button>
            </>
          )}
          <p className="form-footnote">
            <ShieldCheck size={15} />
            {t(
              "獨立管理身份 · 操作範圍控制 · 完整審計",
              "Separate admin identity · Scoped access · Audited actions",
            )}
          </p>
        </div>
        <span className="auth-bottom">COPYPASTE CONTROL ROOM · HONG KONG</span>
      </section>
      <aside className="auth-art">
        <img src="/copypaste-folds.png" alt="CopyPaste brand sculpture" />
        <div>
          <span className="eyebrow">A CONSIDERED VIEW OF THE WHOLE.</span>
          <p>
            {t("看清全局，", "A clearer view.")}
            <br />
            <em>{t("照顧好每個細節。", "A little more care.")}</em>
          </p>
        </div>
      </aside>
    </div>
  );
}
const nav = [
  ["overview", LayoutDashboard, "總覽", "Overview", "admin.overview.read"],
  ["users", Users, "用戶管理", "Users", "admin.users.read"],
  ["tenants", Building2, "企業管理", "Workspaces", "admin.tenants.read"],
  ["usage", ChartNoAxesCombined, "用量與消耗", "Usage", "admin.usage.read"],
  ["billing", Wallet, "費用與帳務", "Billing", "admin.billing.read"],
  [
    "entitlements",
    Crown,
    "VIP 與權益",
    "VIP & entitlements",
    "admin.entitlements.read",
  ],
  ["content", Files, "用戶端內容", "User content", "admin.content.read"],
  [
    "execution",
    Workflow,
    "工作與執行",
    "Task operations",
    "admin.execution.read",
  ],
  [
    "catalog",
    BookOpen,
    "角色與內容發佈",
    "Catalog & publishing",
    "admin.catalog.read",
  ],
  [
    "connections",
    Plug,
    "連接與裝置",
    "Connections & devices",
    "admin.connections.read",
  ],
  ["access", KeyRound, "管理員與權限", "Admin access", "admin.access.read"],
  ["support", Headphones, "支援工作台", "Support", "admin.support.read"],
  ["audit", ScrollText, "審計與審批", "Audit & approvals", "admin.audit.read"],
  ["jobs", ListChecks, "批次與匯出", "Jobs & exports", "admin.jobs.read"],
  ["plans", Wallet, "方案與價格", "Plans & pricing", "admin.plans.read"],
  [
    "policy",
    SlidersHorizontal,
    "控制政策",
    "Control policies",
    "admin.policy.read",
  ],
] as const;
function AdminShell() {
  const { t } = useI18n(),
    a = useAdmin(),
    location = useLocation();
  const [mobile, setMobile] = useState(false),
    [mfa, setMfa] = useState(false);
  const start = nav.find((n) => a.has(n[4]))?.[0];
  useEffect(() => setMobile(false), [location.pathname]);
  return (
    <div className={"app-shell admin-shell" + (mobile ? " mobile-open" : "")}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo />
          <button
            className="icon-button mobile-only"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="control-chip">
          <span className="control-mark">
            <ShieldCheck size={18} />
          </span>
          <div>
            <strong>{t("平台控制中心", "Platform control room")}</strong>
            <small>{t("依角色與範圍授權", "Role & scope controlled")}</small>
          </div>
        </div>
        <nav className="admin-nav">
          {nav
            .filter(
              (n) =>
                a.has(n[4]) ||
                (n[0] === "audit" && a.has("admin.approvals.read")),
            )
            .map(([path, Icon, zh, en]) => (
              <NavLink key={path} to={"/" + path}>
                <Icon size={17} />
                <span>{t(zh, en)}</span>
              </NavLink>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-chip">
            <span className="user-avatar">
              {a.me.user.name[0]?.toUpperCase()}
            </span>
            <div>
              <strong>{a.me.user.name}</strong>
              <small>{a.me.bindings[0]?.role_key?.replaceAll("_", " ")}</small>
            </div>
            <button
              className="icon-button"
              aria-label="Authenticator settings"
              title={t("驗證器設定", "Authenticator settings")}
              onClick={() => setMfa(true)}
            >
              <ShieldCheck size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="Sign out admin"
              onClick={async () => {
                try {
                  await post("/v1/admin/auth/logout");
                } catch {
                  /* Refresh resolves an already expired session. */
                } finally {
                  await a.refresh();
                }
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="app-topbar">
          <button
            className="icon-button mobile-only"
            aria-label="Open navigation"
            onClick={() => setMobile(true)}
          >
            <Menu size={19} />
          </button>
          <span className="breadcrumb">
            CopyPaste<span>/</span>
            {t("平台管理", "Platform administration")}
          </span>
          <div className="topbar-right">
            <ShieldCheck size={13} />
            {t("操作已受審計保護", "Audited workspace")}
          </div>
        </header>
        <main id="main" className="main-content">
          {!start ? (
            <Empty
              icon={ShieldCheck}
              title={t(
                "帳戶已開通，等待授權",
                "Your account is ready; access awaits assignment",
              )}
              body={t(
                "管理員已驗證你的身分。請聯絡權限管理員分配工作範圍和角色。",
                "Your identity is verified. Ask an access administrator to assign your working scope and role.",
              )}
              action={
                <button
                  className="button secondary"
                  onClick={() => void a.refresh()}
                >
                  {t("重新檢查權限", "Check access again")}
                </button>
              }
            />
          ) : (
            <Routes>
              <Route path="/" element={<Navigate to={"/" + start} replace />} />
              <Route path="/overview" element={<Overview />} />
              <Route path="/users/:id" element={<UserDetail />} />
              {nav
                .filter((n) => n[0] !== "overview")
                .map((n) => (
                  <Route
                    key={n[0]}
                    path={"/" + n[0]}
                    element={<Section section={n[0]} />}
                  />
                ))}
              <Route path="*" element={<Navigate to={"/" + start} replace />} />
            </Routes>
          )}
        </main>
        <footer className="app-footer">
          <span>COPYPASTE · THE CARE BEHIND THE WORK.</span>
          <span>PLATFORM ADMINISTRATION</span>
        </footer>
      </div>
      {mfa && (
        <AuthenticatorSettings access={a} onClose={() => setMfa(false)} />
      )}
    </div>
  );
}
function Overview() {
  const { t } = useI18n(),
    a = useAdmin();
  const { data, error, loading } = useData("/v1/admin/overview", 0, 30000);
  const approvals = useData(
    a.has("admin.approvals.read") ? "/v1/admin/approvals" : null,
  );
  return (
    <>
      <PageHeader
        eyebrow="A CLEARER VIEW OF THE WHOLE."
        title={t("平台總覽", "A considered overview")}
        description={t(
          "用戶、企業、用量與待處理事項，集中在一個清楚的視圖。",
          "Your people, workspaces, usage and the items that need attention, in one clear view.",
        )}
        action={
          <span className="badge">
            <span />
            {t("平台即時資料", "Live platform data")}
          </span>
        }
      />
      <ErrorNotice error={error} />
      {loading && !data ? (
        <Loading />
      ) : (
        <>
          <div className="metrics-grid">
            {[
              [t("註冊用戶", "Registered users"), data?.summary.users],
              [t("企業工作空間", "Workspaces"), data?.summary.tenants],
              [
                t("累計消耗", "Settled usage"),
                data?.summary.charged_micros === null ? (
                  "—"
                ) : (
                  <Money value={data?.summary.charged_micros} />
                ),
              ],
              [
                t("預留額度", "Reserved credit"),
                data?.summary.reserved_micros === null ? (
                  "—"
                ) : (
                  <Money value={data?.summary.reserved_micros} />
                ),
              ],
            ].map(([label, value], i) => (
              <div className="metric-card" key={i}>
                <span>{label}</span>
                <strong>{value ?? "—"}</strong>
                <small>
                  {t("限目前授權範圍", "Within your authorized scope")}
                </small>
              </div>
            ))}
          </div>
          <div className="admin-overview-grid">
            <section className="card attention-card">
              <p className="eyebrow">WHAT NEEDS YOUR ATTENTION.</p>
              <h2>{t("待處理事項", "A few things to keep in view")}</h2>
              <div className="attention-row">
                <span className="attention-icon">
                  <ShieldCheck size={20} />
                </span>
                <div>
                  <strong>
                    {t("等待獨立審批", "Awaiting independent approval")}
                  </strong>
                  <p>
                    {t(
                      "高影響操作在執行前，由另一位管理員覆核。",
                      "A second administrator reviews high-impact operations before execution.",
                    )}
                  </p>
                </div>
                <Link to="/audit" className="attention-number">
                  {approvals.data?.total ?? "—"}
                  <ArrowUpRight size={16} />
                </Link>
              </div>
              <div className="attention-row">
                <span className="attention-icon warm">
                  <Clock size={20} />
                </span>
                <div>
                  <strong>
                    {t("需要結果與費用核對", "Result & usage reconciliation")}
                  </strong>
                  <p>
                    {t(
                      "不確定結果保留原始預留，避免重複執行和扣費。",
                      "Uncertain runs keep their holds until their outcome is reconciled.",
                    )}
                  </p>
                </div>
                <Link to="/execution" className="attention-number">
                  {data?.summary.reconciling ?? "—"}
                  <ArrowUpRight size={16} />
                </Link>
              </div>
              <div className="admin-shortcuts">
                {a.has("admin.users.read") && (
                  <Link to="/users">
                    <Users size={16} />
                    {t("查看用戶", "View users")}
                    <ArrowRight size={14} />
                  </Link>
                )}
                {a.has("admin.entitlements.read") && (
                  <Link to="/entitlements">
                    <Crown size={16} />
                    {t("管理 VIP", "Manage VIP")}
                    <ArrowRight size={14} />
                  </Link>
                )}
              </div>
            </section>
            <section className="card">
              <div className="section-title">
                <h2>{t("你的近期操作", "Your recent activity")}</h2>
                <ScrollText size={18} className="muted" />
              </div>
              <div className="admin-activity">
                {data?.activity.length ? (
                  data.activity.map((r: any, i: number) => (
                    <div key={i}>
                      <span className="timeline-dot" />
                      <div>
                        <strong>
                          {r.action
                            .replaceAll("admin.", "")
                            .replaceAll(".", " · ")}
                        </strong>
                        <small>
                          <DateText value={r.created_at} />
                        </small>
                      </div>
                      <Badge value={r.outcome} />
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    {t(
                      "操作記錄會在這裡顯示。",
                      "Your activity will appear here.",
                    )}
                  </p>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}
const columns: Record<string, string[]> = {
  users: [
    "name",
    "email",
    "status",
    "workspaces",
    "charged_micros",
    "created_at",
  ],
  tenants: [
    "name",
    "status",
    "members",
    "balance_micros",
    "reserved_micros",
    "created_at",
  ],
  usage: [
    "name",
    "tenant_name",
    "tasks",
    "charged_micros",
    "input_tokens",
    "output_tokens",
    "reconciling",
  ],
  billing: ["tenant_name", "kind", "amount_micros", "reason", "created_at"],
  entitlements: [
    "tenant_name",
    "user_name",
    "plan",
    "state",
    "effective",
    "starts_at",
    "ends_at",
  ],
  content: ["name", "kind", "state", "version", "created_at"],
  execution: [
    "title",
    "role_key",
    "status",
    "charged_micros",
    "error_code",
    "created_at",
  ],
  catalog: ["kind", "key", "version", "state", "created_at"],
  connections: ["name", "provider", "state", "created_at"],
  devices: ["name", "client", "state", "last_seen_at"],
  access: ["name", "email", "status", "enrollment_state", "created_at"],
  support: ["reason", "tenant_id", "expires_at", "body_granted"],
  audit: ["action", "actor_kind", "outcome", "target", "created_at"],
  approvals: ["action", "state", "principal_id", "created_at"],
  jobs: ["action", "state", "created_at"],
  plans: ["key", "version", "state", "created_at"],
  policy: ["key", "version", "state", "created_at"],
};
const headers: Record<string, [string, string]> = {
  name: ["名稱", "Name"],
  email: ["郵箱", "Email"],
  enrollment_state: ["MFA 開通", "MFA setup"],
  status: ["狀態", "Status"],
  workspaces: ["企業", "Workspaces"],
  charged_micros: ["實際消耗", "Settled usage"],
  created_at: ["建立時間", "Created"],
  members: ["成員", "Members"],
  balance_micros: ["餘額", "Balance"],
  reserved_micros: ["預留額度", "Reserved"],
  tenant_name: ["企業", "Workspace"],
  tasks: ["工作數", "Tasks"],
  input_tokens: ["輸入量", "Input tokens"],
  output_tokens: ["輸出量", "Output tokens"],
  reconciling: ["待對帳", "Reconciling"],
  kind: ["類型", "Type"],
  amount_micros: ["金額", "Amount"],
  reason: ["說明", "Reason"],
  user_name: ["用戶", "User"],
  plan: ["方案", "Plan"],
  state: ["狀態", "State"],
  effective: ["目前生效", "Effective now"],
  starts_at: ["開始", "Starts"],
  ends_at: ["截止", "Ends"],
  version: ["版本", "Version"],
  title: ["工作", "Task"],
  role_key: ["角色", "Specialist"],
  error_code: ["原因", "Reason"],
  key: ["名稱", "Key"],
  provider: ["平台", "Provider"],
  client: ["客戶端", "Client"],
  last_seen_at: ["最近活動", "Last seen"],
  expires_at: ["有效期限", "Expires"],
  body_granted: ["正文授權", "Content access"],
  action: ["操作", "Action"],
  actor_kind: ["身份", "Actor"],
  outcome: ["結果", "Outcome"],
  target: ["目標", "Target"],
  principal_id: ["申請人", "Requested by"],
  tenant_id: ["企業 ID", "Workspace ID"],
};
function Value({ field, value }: { field: string; value: any }) {
  if (value === null || value === undefined)
    return <span className="muted">—</span>;
  if (field.endsWith("_micros")) return <Money value={value} />;
  if (field === "enrollment_state")
    return (
      <Badge value={value === "enrolled" ? "mfa_enabled" : "mfa_pending"} />
    );
  if (field.endsWith("_at")) return <DateText value={value} />;
  if (["status", "state", "outcome"].includes(field))
    return <Badge value={String(value)} />;
  if (typeof value === "boolean") return <span>{value ? "✓" : "—"}</span>;
  if (field.endsWith("_id"))
    return (
      <code className="id-chip" title={String(value)}>
        {String(value).slice(0, 8)}
      </code>
    );
  return <span>{String(value)}</span>;
}
function Section({ section }: { section: string }) {
  const { t } = useI18n(),
    a = useAdmin(),
    navTo = useNavigate();
  const [refresh, setRefresh] = useState(0),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [sub, setSub] = useState(""),
    [operation, setOperation] = useState<string | null>(null),
    [row, setRow] = useState<any>(null),
    [dialog, setDialog] = useState<string | null>(null),
    [err, setErr] = useState<Error | null>(null);
  useEffect(() => {
    setPage(1);
    setSearch("");
    setSub("");
    setRow(null);
    setOperation(null);
    setDialog(null);
  }, [section]);
  const active =
    section === "audit" && sub === "approvals"
      ? "approvals"
      : section === "connections" && sub === "devices"
        ? "devices"
        : section;
  const { data, error, loading } = useData(
    "/v1/admin/" +
      active +
      "?page=" +
      page +
      "&page_size=25&search=" +
      encodeURIComponent(search),
    refresh,
  );
  const entry = nav.find((n) => n[0] === section)!;
  const bump = () => setRefresh((v) => v + 1);
  const action = async (fn: () => Promise<any>) => {
    try {
      await fn();
      bump();
      setErr(null);
    } catch (e) {
      setErr(e as Error);
    }
  };
  const descriptions: Record<string, [string, string]> = {
    users: [
      "完整用戶列表、企業歸屬、狀態和消耗。",
      "Every registered account, its workspace membership, status and measured usage.",
    ],
    tenants: [
      "管理企業狀態，查看成員與可用額度。",
      "Workspace status, members and available credit.",
    ],
    usage: [
      "按實際發起者歸屬統計，避免重複計算團隊消耗。",
      "Usage is attributed once to its initiator, with workspace context.",
    ],
    billing: [
      "分開記錄充值、贈送、扣款與退款，保留原始資金來源。",
      "Top-ups, gifts, debits and refunds, with their original funding source preserved.",
    ],
    entitlements: [
      "主動開通、延長、暫停或撤銷個人與企業權益。",
      "Grant, extend, suspend or revoke personal and workspace entitlements.",
    ],
    content: [
      "管理用戶上傳、生成與交付的內容和版本。正文與下載需要獨立權限。",
      "Manage uploaded, generated and delivered content. Body access and downloads have separate permissions.",
    ],
    execution: [
      "查看工作狀態，安全地取消、暫停或恢復執行。",
      "Follow task state and safely cancel, pause or resume work.",
    ],
    access: [
      "管理角色、動作權限、企業與專案範圍，以及額度和期限限制。",
      "Roles, action permissions, workspace and project scopes, with amount and duration limits.",
    ],
    catalog: [
      "草稿、發佈與回滾。執行能力需要先通過真實業務驗證。",
      "Draft, publish and roll back content. Executable capabilities require live qualification.",
    ],
  };
  return (
    <>
      <PageHeader
        eyebrow="THE DETAILS THAT KEEP THINGS WORKING."
        title={t(entry[2], entry[3])}
        description={
          descriptions[section]
            ? t(...descriptions[section])
            : t(
                "所有操作依管理員權限、範圍和當前狀態執行。",
                "Actions are checked against your permissions, scope and the current resource state.",
              )
        }
        action={
          <div className="row-actions">
            {section === "jobs" &&
              a.has("admin.jobs.create") &&
              a.has("admin.users.status.write") && (
                <button
                  className="button primary"
                  onClick={() => setDialog("batch")}
                >
                  <Plus size={16} />
                  {t("批次用戶操作", "Batch user action")}
                </button>
              )}
            {section === "billing" && a.has("admin.billing.gift") && (
              <button
                className="button primary"
                onClick={() => setOperation("billing.gift")}
              >
                <Plus size={16} />
                {t("調整費用", "Billing operation")}
              </button>
            )}
            {section === "entitlements" &&
              a.has("admin.entitlements.grant") && (
                <button
                  className="button primary"
                  onClick={() => setOperation("entitlements.grant")}
                >
                  <Crown size={17} />
                  {t("開通 VIP", "Grant VIP")}
                </button>
              )}
            {["catalog", "plans", "policy"].includes(section) &&
              a.has(
                section === "catalog"
                  ? "admin.catalog.draft"
                  : section === "plans"
                    ? "admin.plans.draft"
                    : "admin.policy.draft",
              ) && (
                <button
                  className="button primary"
                  onClick={() => setDialog("catalog")}
                >
                  <Plus size={16} />
                  {t("新增草稿", "Create draft")}
                </button>
              )}
            {section === "access" && a.has("admin.access.principals.write") && (
              <button
                className="button primary"
                onClick={() => setDialog("invite")}
              >
                <Plus size={16} />
                {t("邀請管理員", "Invite administrator")}
              </button>
            )}
            {section === "access" && a.has("admin.access.roles.write") && (
              <button
                className="button secondary"
                onClick={() => setDialog("role")}
              >
                {t("建立權限角色", "Create permission role")}
              </button>
            )}
            {section === "access" && a.has("admin.access.bindings.write") && (
              <button
                className="button primary"
                onClick={() => setDialog("binding")}
              >
                <Plus size={16} />
                {t("新增授權", "Add binding")}
              </button>
            )}
            {section === "support" && a.has("admin.support.start") && (
              <button
                className="button primary"
                onClick={() => setDialog("support")}
              >
                <Plus size={16} />
                {t("建立支援會話", "Start support session")}
              </button>
            )}
          </div>
        }
      />
      <div className="filter-row">
        <div className="tabs">
          {section === "audit" ? (
            <>
              <button
                className={sub !== "approvals" ? "active" : ""}
                onClick={() => {
                  setSub("");
                  setPage(1);
                }}
              >
                {t("審計記錄", "Audit log")}
              </button>
              <button
                className={sub === "approvals" ? "active" : ""}
                onClick={() => {
                  setSub("approvals");
                  setPage(1);
                }}
              >
                {t("待審批", "Pending approvals")}
              </button>
            </>
          ) : section === "connections" ? (
            <>
              <button
                className={sub !== "devices" ? "active" : ""}
                onClick={() => setSub("")}
              >
                {t("應用連接", "Connections")}
              </button>
              <button
                className={sub === "devices" ? "active" : ""}
                onClick={() => setSub("devices")}
              >
                {t("裝置", "Devices")}
              </button>
            </>
          ) : (
            <span className="list-total">
              {data?.total ?? "—"} {t("筆記錄", "records")}
            </span>
          )}
        </div>
        <div className="row-actions">
          <label className="search-field">
            <Search size={16} />
            <input
              placeholder={t("搜尋記錄…", "Search records…")}
              aria-label="Search records"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <button
            className="icon-button"
            title={t("重新整理", "Refresh")}
            onClick={bump}
          >
            <RefreshCw size={17} />
          </button>
          {a.has("admin.exports.create") &&
            ["users", "usage", "billing", "audit"].includes(active) && (
              <button
                className="icon-button"
                title={t("匯出已授權資料", "Export authorized data")}
                onClick={() =>
                  void action(async () => {
                    const r = await post("/v1/admin/exports", {
                      source: active,
                    });
                    await download(
                      "/v1/admin/exports/" + r.id + "/download",
                      "copypaste-" + active + ".csv",
                    );
                  })
                }
              >
                <Download size={17} />
              </button>
            )}
        </div>
      </div>
      <ErrorNotice error={error ?? err} />
      {loading && !data ? (
        <Loading />
      ) : data?.items.length ? (
        <>
          <div className="table-scroll admin-table">
            <table>
              <thead>
                <tr>
                  {columns[active].map((f) => (
                    <th key={f}>{headers[f] ? t(...headers[f]) : f}</th>
                  ))}
                  <th>{t("操作", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r: any, i: number) => (
                  <tr key={r.id ?? i}>
                    {columns[active].map((f, j) => (
                      <td key={f}>
                        {active === "users" && f === "name" ? (
                          <Link className="table-link" to={"/users/" + r.id}>
                            {r.name}
                            <ArrowUpRight size={13} />
                          </Link>
                        ) : (
                          <Value field={f} value={r[f]} />
                        )}
                      </td>
                    ))}
                    <td>
                      <div className="table-actions">
                        {active === "users" ? (
                          <button
                            onClick={() => navTo("/users/" + r.id)}
                            aria-label="View user"
                          >
                            <ArrowUpRight size={16} />
                          </button>
                        ) : null}
                        {active === "access" && (
                          <PrincipalActions
                            principal={r}
                            onOpen={() => {
                              setRow(r);
                              setDialog("principal");
                            }}
                          />
                        )}
                        {active === "tenants" &&
                          a.has("admin.tenants.status.write") && (
                            <button
                              title="Change workspace status"
                              onClick={() => {
                                setRow(r);
                                setDialog("tenant");
                              }}
                            >
                              {r.status === "active" ? (
                                <Pause size={15} />
                              ) : (
                                <Play size={15} />
                              )}
                            </button>
                          )}
                        {active === "content" && (
                          <>
                            {a.has("admin.content.body.read") && (
                              <button
                                title="Read content"
                                onClick={() => {
                                  setRow(r);
                                  setDialog("body");
                                }}
                              >
                                <Eye size={15} />
                              </button>
                            )}
                            {a.has("admin.content.quarantine") && (
                              <button
                                title="Manage content"
                                onClick={() => {
                                  setRow(r);
                                  setDialog("content");
                                }}
                              >
                                <ShieldCheck size={15} />
                              </button>
                            )}
                          </>
                        )}
                        {active === "execution" &&
                          a.has("admin.execution.cancel") && (
                            <button
                              title="Manage task"
                              onClick={() => {
                                setRow(r);
                                setDialog("execution");
                              }}
                            >
                              <Workflow size={16} />
                            </button>
                          )}
                        {active === "entitlements" &&
                          a.has("admin.entitlements.extend") && (
                            <button
                              title="Manage VIP"
                              onClick={() => {
                                setRow(r);
                                setOperation("entitlements.extend");
                              }}
                            >
                              <Crown size={16} />
                            </button>
                          )}
                        {active === "approvals" &&
                          a.has("admin.approvals.decide") && (
                            <button
                              title="Review operation"
                              onClick={() => {
                                setRow(r);
                                setDialog("approval");
                              }}
                            >
                              <ShieldCheck size={16} />
                            </button>
                          )}
                        {["connections", "devices"].includes(active) &&
                          a.has(`admin.${active}.revoke`) && (
                            <button
                              title="Revoke"
                              onClick={() => {
                                setRow(r);
                                setDialog("revoke");
                              }}
                            >
                              <Ban size={15} />
                            </button>
                          )}
                        {["catalog", "plans", "policy"].includes(active) && (
                          <button
                            title="Publishing controls"
                            onClick={() => {
                              setRow(r);
                              setDialog("publish");
                            }}
                          >
                            <ArrowUpRight size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>
              {t("每頁 25 筆", "25 per page")} · {t("目前第", "Page")} {page}
            </span>
            <div>
              <button
                className="icon-button"
                aria-label="Previous page"
                disabled={page === 1}
                onClick={() => setPage((v) => v - 1)}
              >
                <ChevronLeft size={17} />
              </button>
              <button
                className="icon-button"
                aria-label="Next page"
                disabled={page * 25 >= data.total}
                onClick={() => setPage((v) => v + 1)}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        </>
      ) : (
        <Empty
          icon={entry[1]}
          title={t("目前沒有符合的記錄", "No matching records yet")}
          body={t(
            "記錄會依你的權限範圍顯示。可以調整搜尋或開始一項操作。",
            "Records appear within your authorized scope. Adjust your search or start an action.",
          )}
        />
      )}{" "}
      {section === "execution" && (
        <AdminSchedules
          canPause={a.has("admin.execution.pause")}
          canResume={a.has("admin.execution.resume")}
        />
      )}
      {section === "access" && data?.roles && (
        <section className="section-block">
          <div className="section-title">
            <h2>{t("角色與動作權限", "Roles & action permissions")}</h2>
            <span className="muted small-text">
              {data.permission_catalog.length}{" "}
              {t("項獨立權限", "registered permissions")}
            </span>
          </div>
          <div className="admin-role-grid">
            {data.roles.map((r: any) => (
              <article className="card" key={r.key}>
                <KeyRound size={20} />
                <h3>{r.name.replaceAll("_", " ")}</h3>
                <span className="permission-count">{r.permissions.length}</span>
                <p className="muted">
                  {t("項可授予的動作權限", "assignable action permissions")}
                </p>
                <details>
                  <summary>{t("查看權限", "View permissions")}</summary>
                  <div className="permission-list">
                    {r.permissions.map((p: string) => (
                      <code key={p}>{p}</code>
                    ))}
                  </div>
                </details>
              </article>
            ))}
          </div>
          <h2 className="bindings-title">
            {t("目前授權綁定", "Current access bindings")}
          </h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Principal</th>
                  <th>Scope</th>
                  <th>Effect</th>
                  <th>Limits</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.bindings.map((b: any) => (
                  <tr key={b.id}>
                    <td>{b.role_key}</td>
                    <td>
                      <code>{b.principal_id.slice(0, 8)}</code>
                    </td>
                    <td>
                      {b.scope_kind} {b.scope_id?.slice(0, 8)}
                    </td>
                    <td>{b.effect}</td>
                    <td>
                      <code>{JSON.stringify(b.limits)}</code>
                    </td>
                    <td>
                      {a.has("admin.access.bindings.revoke") && (
                        <button
                          className="text-button"
                          onClick={() =>
                            void action(() =>
                              api("/v1/admin/access/bindings/" + b.id, {
                                method: "DELETE",
                              }),
                            )
                          }
                        >
                          {t("撤銷", "Revoke")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {operation && (
        <BillingModal
          initial={operation}
          entitlement={row}
          onClose={() => {
            setOperation(null);
            setRow(null);
          }}
          onDone={bump}
        />
      )}{" "}
      {dialog === "batch" && (
        <BatchDialog onClose={() => setDialog(null)} onDone={bump} />
      )}
      {dialog === "invite" && (
        <InviteAdministrator
          roles={data?.roles ?? []}
          canBind={a.has("admin.access.bindings.write")}
          onDone={bump}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "principal" && row && (
        <PrincipalDetail
          key={row.id}
          id={row.id}
          access={a}
          onDone={bump}
          onClose={() => {
            setDialog(null);
            setRow(null);
          }}
        />
      )}
      {dialog && !["batch", "invite", "principal"].includes(dialog) && (
        <AdminDialog
          kind={dialog}
          row={row}
          active={active}
          data={data}
          onClose={() => {
            setDialog(null);
            setRow(null);
          }}
          onDone={bump}
        />
      )}
    </>
  );
}
function BillingModal({
  initial,
  entitlement,
  onClose,
  onDone,
  user,
}: {
  initial: string;
  entitlement?: any;
  onClose: () => void;
  onDone: () => void;
  user?: any;
}) {
  const { t } = useI18n(),
    a = useAdmin();
  const [preview, setPreview] = useState<any>(null),
    [result, setResult] = useState<any>(null),
    [action, setAction] = useState(initial),
    [scope, setScope] = useState("tenant");
  const tenants = useData(
    a.has("admin.tenants.read") ? "/v1/admin/tenants?page_size=100" : null,
  );
  const title = action.startsWith("entitlements")
    ? t("管理 VIP 與權益", "Manage VIP & entitlements")
    : t("費用操作", "Billing operation");
  return (
    <Modal title={title} onClose={onClose}>
      {result ? (
        <div className="operation-result">
          <ShieldCheck size={34} />
          <h2>
            {result.state === "pending_approval"
              ? t("已提交獨立審批", "Submitted for independent approval")
              : t("操作已完成", "Operation completed")}
          </h2>
          <p className="muted">
            {result.state === "pending_approval"
              ? t(
                  "另一位具備範圍權限的管理員需覆核此項操作。",
                  "A different authorized administrator must review this operation.",
                )
              : t(
                  "費用或權益已生效，並保留完整審計記錄。",
                  "The change is applied and its audit record is preserved.",
                )}
          </p>
          <button className="button primary" onClick={onClose}>
            {t("完成", "Done")}
          </button>
        </div>
      ) : preview ? (
        <>
          <div className="notice">
            <ShieldCheck size={18} />
            <span>
              {t(
                "請核對操作目標、金額或期限。預覽本身不會變更費用或權益。",
                "Review the target, amount or dates. This preview does not change funds or entitlements.",
              )}
            </span>
          </div>
          <dl className="preview-details">
            {Object.entries(preview.command).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt>{k.replaceAll("_", " ")}</dt>
                <dd>
                  {k.endsWith("_micros") ? <Money value={v} /> : String(v)}
                </dd>
              </React.Fragment>
            ))}
          </dl>
          {preview.approval && (
            <div className="notice">
              <ShieldCheck size={18} />
              {t(
                "此操作需另一位管理員獨立審批。",
                "This operation requires independent review by another administrator.",
              )}
            </div>
          )}
          <AsyncForm
            submitLabel={
              preview.approval
                ? t("提交審批", "Submit for approval")
                : t("確認執行", "Confirm operation")
            }
            onSubmit={async () => {
              const r = await post("/v1/admin/operations/commit", {
                preview_id: preview.id,
                payload_hash: preview.payload_hash,
              });
              setResult(r);
              onDone();
            }}
          >
            <p className="form-footnote">
              {t(
                "預覽有效期 5 分鐘。若目標狀態改變，需要重新預覽。",
                "The preview expires in 5 minutes. Changes to the target require a fresh preview.",
              )}
            </p>
          </AsyncForm>
          <button className="text-button" onClick={() => setPreview(null)}>
            {t("返回修改", "Back to edit")}
          </button>
        </>
      ) : (
        <AsyncForm
          submitLabel={t("預覽操作", "Preview operation")}
          onSubmit={async (f) => {
            const b: any = { action, reason: String(f.get("reason")) };
            if (
              [
                "billing.top_up",
                "billing.gift",
                "billing.debit",
                "billing.refund",
                "billing.credit_limit.write",
              ].includes(action)
            ) {
              b.tenant_id = String(f.get("tenant"));
              b.amount_micros = Math.round(Number(f.get("amount")) * 1e6);
              if (f.get("reference")) b.reference = String(f.get("reference"));
              if (f.get("source")) b.source_id = String(f.get("source"));
              if (action === "billing.gift")
                b.expires_at = new Date(String(f.get("expiry"))).toISOString();
            }
            if (action === "billing.reconcile") {
              b.tenant_id = String(f.get("tenant"));
              b.task_id = String(f.get("task"));
              b.actual_micros = Math.round(Number(f.get("amount")) * 1e6);
            }
            if (action === "entitlements.grant") {
              if (scope === "user") b.user_id = String(f.get("user_id"));
              else b.tenant_id = String(f.get("tenant"));
              b.plan = String(f.get("plan"));
              b.starts_at = new Date(String(f.get("starts"))).toISOString();
              b.ends_at = new Date(String(f.get("ends"))).toISOString();
            }
            if (
              action.startsWith("entitlements.") &&
              action !== "entitlements.grant"
            ) {
              b.entitlement_id = entitlement.id;
              if (action === "entitlements.extend")
                b.ends_at = new Date(String(f.get("ends"))).toISOString();
            }
            setPreview(await post("/v1/admin/operations/preview", b));
          }}
        >
          <Field label={t("操作類型", "Operation")}>
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              {(initial.startsWith("entitlements")
                ? entitlement
                  ? [
                      "entitlements.extend",
                      "entitlements.suspend",
                      "entitlements.resume",
                      "entitlements.revoke",
                    ]
                  : ["entitlements.grant"]
                : [
                    "billing.gift",
                    "billing.top_up",
                    "billing.debit",
                    "billing.refund",
                    "billing.credit_limit.write",
                    "billing.reconcile",
                  ]
              )
                .filter((s) =>
                  a.has(
                    "admin." +
                      (["entitlements.suspend", "entitlements.resume"].includes(
                        s,
                      )
                        ? "entitlements.extend"
                        : s),
                  ),
                )
                .map((s) => (
                  <option key={s} value={s}>
                    {
                      (
                        {
                          "billing.gift": t("贈送額度", "Gift credit"),
                          "billing.top_up": t(
                            "確認收款充值",
                            "Confirmed payment top-up",
                          ),
                          "billing.debit": t(
                            "扣減原始額度",
                            "Debit original funding",
                          ),
                          "billing.refund": t("確認退款", "Confirmed refund"),
                          "billing.credit_limit.write": t(
                            "設定信用上限",
                            "Set credit limit",
                          ),
                          "billing.reconcile": t(
                            "核對實際消耗",
                            "Reconcile measured usage",
                          ),
                          "entitlements.grant": t("開通 VIP", "Grant VIP"),
                          "entitlements.extend": t(
                            "延長有效期",
                            "Extend period",
                          ),
                          "entitlements.suspend": t("暫停", "Suspend"),
                          "entitlements.resume": t("恢復", "Resume"),
                          "entitlements.revoke": t("撤銷", "Revoke"),
                        } as Record<string, string>
                      )[s]
                    }
                  </option>
                ))}
            </select>
          </Field>
          {action === "entitlements.grant" && (
            <Field label={t("權益歸屬", "Entitlement subject")}>
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="tenant">{t("企業", "Workspace")}</option>
                <option value="user">{t("個人", "Personal")}</option>
              </select>
            </Field>
          )}
          {(!action.startsWith("entitlements") ||
            (action === "entitlements.grant" && scope === "tenant")) && (
            <Field label={t("企業工作空間", "Workspace")}>
              <select
                name="tenant"
                required
                defaultValue={user?.memberships?.[0]?.tenant_id ?? ""}
              >
                <option value="">{t("選擇企業", "Choose workspace")}</option>
                {(user?.memberships ?? tenants.data?.items ?? []).map(
                  (r: any) => (
                    <option
                      value={r.tenant_id ?? r.id}
                      key={r.tenant_id ?? r.id}
                    >
                      {r.tenant_name ?? r.name}
                    </option>
                  ),
                )}
              </select>
            </Field>
          )}
          {action === "entitlements.grant" && scope === "user" && (
            <Field label="User ID">
              <input
                name="user_id"
                defaultValue={user?.user?.id ?? ""}
                required
              />
            </Field>
          )}
          {action.startsWith("billing") && (
            <Field label={t("金額（HKD）", "Amount (HKD)")}>
              <input
                name="amount"
                type="number"
                step="0.01"
                min={
                  ["billing.credit_limit.write", "billing.reconcile"].includes(
                    action,
                  )
                    ? 0
                    : 0.01
                }
                max="1000000"
                required
              />
            </Field>
          )}
          {["billing.top_up", "billing.refund"].includes(action) && (
            <Field
              label={t(
                "已確認收款 / 退款憑證編號",
                "Confirmed payment / refund reference",
              )}
            >
              <input name="reference" minLength={3} maxLength={200} required />
            </Field>
          )}
          {["billing.debit", "billing.refund"].includes(action) && (
            <Field
              label={t("原始充值 / 贈送記錄 ID", "Original funding ledger ID")}
            >
              <input name="source" required />
            </Field>
          )}
          {action === "billing.gift" && (
            <Field label={t("贈送額度截止時間", "Gift credit expiry")}>
              <input name="expiry" type="datetime-local" required />
            </Field>
          )}
          {action === "billing.reconcile" && (
            <Field
              label={t("待對帳工作 ID", "Task ID awaiting reconciliation")}
            >
              <input name="task" required />
            </Field>
          )}
          {action === "entitlements.grant" && (
            <>
              <Field label={t("方案", "Plan")}>
                <select name="plan" defaultValue="pro">
                  <option value="starter">Starter</option>
                  <option value="pro">Pro</option>
                  <option value="business">Business</option>
                </select>
              </Field>
              <Field label={t("開始時間", "Start time")}>
                <input
                  name="starts"
                  type="datetime-local"
                  defaultValue={new Date(
                    Date.now() - new Date().getTimezoneOffset() * 60000,
                  )
                    .toISOString()
                    .slice(0, 16)}
                  required
                />
              </Field>
            </>
          )}
          {["entitlements.grant", "entitlements.extend"].includes(action) && (
            <Field label={t("截止時間", "End time")}>
              <input name="ends" type="datetime-local" required />
            </Field>
          )}
          <Field label={t("操作原因", "Reason")}>
            <textarea
              name="reason"
              minLength={3}
              rows={3}
              maxLength={2000}
              placeholder={t(
                "記錄業務原因，供日後核對。",
                "Record the business reason for future review.",
              )}
              required
            />
          </Field>
        </AsyncForm>
      )}
    </Modal>
  );
}
function UserDetail() {
  const { id } = useParams(),
    { t } = useI18n(),
    a = useAdmin();
  const [refresh, setRefresh] = useState(0),
    [edit, setEdit] = useState(false),
    [operation, setOperation] = useState<string | null>(null);
  const { data, error, loading } = useData("/v1/admin/users/" + id, refresh);
  if (loading) return <Loading />;
  return (
    <>
      <Link to="/users" className="text-link">
        <ChevronLeft size={16} />
        {t("返回用戶列表", "Back to users")}
      </Link>
      <ErrorNotice error={error} />
      {data && (
        <>
          <PageHeader
            title={data.user.name}
            description={data.user.email}
            action={
              <div className="row-actions">
                {a.has("admin.users.status.write") && (
                  <button
                    className="button secondary"
                    onClick={() => setEdit(true)}
                  >
                    {t("編輯帳戶", "Manage account")}
                  </button>
                )}
                {a.has("admin.entitlements.grant") && (
                  <button
                    className="button primary"
                    onClick={() => setOperation("entitlements.grant")}
                  >
                    <Crown size={16} />
                    {t("開通 VIP", "Grant VIP")}
                  </button>
                )}
                {a.has("admin.billing.gift") && (
                  <button
                    className="button secondary"
                    onClick={() => setOperation("billing.gift")}
                  >
                    {t("調整費用", "Manage credit")}
                  </button>
                )}
              </div>
            }
          />
          <div className="user-profile-card card">
            <div className="user-profile-avatar">
              {data.user.name[0]?.toUpperCase()}
            </div>
            <div>
              <h2>{data.user.name}</h2>
              <p className="muted">{data.user.email}</p>
              <Badge value={data.user.status} />
            </div>
            <dl>
              <dt>{t("加入時間", "Joined")}</dt>
              <dd>
                <DateText value={data.user.created_at} />
              </dd>
              <dt>{t("用戶識別", "User ID")}</dt>
              <dd>
                <code>{id}</code>
              </dd>
            </dl>
          </div>
          <section className="section-block">
            <h2>{t("企業歸屬與消耗", "Workspace membership & usage")}</h2>
            <div className="project-grid">
              {data.memberships.map((m: any) => {
                const u = data.usage.find(
                  (r: any) => r.tenant_id === m.tenant_id,
                );
                return (
                  <article className="card" key={m.tenant_id}>
                    <Building2 size={23} />
                    <h3>{m.tenant_name}</h3>
                    <span className="badge">{m.role}</span>
                    <dl className="detail-list">
                      <dt>{t("工作數量", "Tasks")}</dt>
                      <dd>{u?.tasks ?? 0}</dd>
                      <dt>{t("實際消耗", "Measured usage")}</dt>
                      <dd>
                        <Money value={u?.charged_micros} />
                      </dd>
                    </dl>
                  </article>
                );
              })}
            </div>
          </section>
          <section className="section-block">
            <h2>{t("個人權益", "Personal entitlements")}</h2>
            {data.entitlements.length ? (
              data.entitlements.map((e: any) => (
                <div className="version-row" key={e.id}>
                  <Crown size={18} />
                  <strong>{e.plan}</strong>
                  <Badge value={e.state} />
                  <DateText value={e.ends_at} />
                </div>
              ))
            ) : (
              <p className="muted">
                {t(
                  "尚未開通個人權益。企業方案由企業帳務獨立管理。",
                  "No personal entitlements. Workspace plans and billing are managed independently.",
                )}
              </p>
            )}
          </section>
          {edit && (
            <Modal
              title={t("管理用戶帳戶", "Manage user account")}
              onClose={() => setEdit(false)}
            >
              <AsyncForm
                submitLabel={t("儲存變更", "Save changes")}
                onSubmit={async (f) => {
                  await patch("/v1/admin/users/" + id, {
                    name: String(f.get("name")),
                    status: String(f.get("status")),
                    revoke_sessions: f.get("revoke") === "on",
                    reason: String(f.get("reason")),
                  });
                  setEdit(false);
                  setRefresh((v) => v + 1);
                }}
              >
                <Field label={t("名稱", "Name")}>
                  <input name="name" defaultValue={data.user.name} required />
                </Field>
                <Field label={t("帳戶狀態", "Account status")}>
                  <select name="status" defaultValue={data.user.status}>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </Field>
                <label className="checkbox">
                  <input type="checkbox" name="revoke" />
                  {t("撤銷所有登入會話", "Revoke all active sessions")}
                </label>
                <Field label={t("原因", "Reason")}>
                  <textarea name="reason" minLength={3} rows={3} required />
                </Field>
              </AsyncForm>
            </Modal>
          )}
          {operation && (
            <BillingModal
              initial={operation}
              user={data}
              onClose={() => setOperation(null)}
              onDone={() => setRefresh((v) => v + 1)}
            />
          )}
        </>
      )}
    </>
  );
}
function AdminDialog({
  kind,
  row,
  active,
  data,
  onClose,
  onDone,
}: {
  kind: string;
  row: any;
  active: string;
  data: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    a = useAdmin();
  const body = useData(
    kind === "body" ? "/v1/admin/content/" + row?.id + "/body" : null,
  );
  const titles: Record<string, [string, string]> = {
    tenant: ["變更企業狀態", "Change workspace status"],
    content: ["管理內容狀態", "Manage content"],
    execution: ["管理工作執行", "Manage task execution"],
    approval: ["獨立審批", "Independent review"],
    revoke: ["撤銷存取", "Revoke access"],
    body: ["內容正文", "Content body"],
    publish: ["版本發佈", "Publish version"],
    catalog: ["新增內容草稿", "Create catalog draft"],
    binding: ["新增管理授權", "Add admin access binding"],
    role: ["建立管理權限角色", "Create admin permission role"],
    support: ["建立支援會話", "Start a support session"],
  };
  return (
    <Modal title={titles[kind] ? t(...titles[kind]) : kind} onClose={onClose}>
      {kind === "body" ? (
        <>
          <ErrorNotice error={body.error} />
          {body.loading ? (
            <Loading />
          ) : (
            <>
              <p className="muted">
                {body.data?.name} · {body.data?.mime_type}
              </p>
              {body.data?.text ? (
                <pre className="content-body">{body.data.text}</pre>
              ) : (
                <p className="muted">
                  {t(
                    "此格式以檔案提供。",
                    "This format is available as a file.",
                  )}
                </p>
              )}
              {a.has("admin.content.download") && row.kind === "assets" && (
                <button
                  className="button secondary"
                  onClick={() =>
                    void download(
                      "/v1/admin/content/" + row.id + "/download",
                      row.name,
                    )
                  }
                >
                  <Download size={16} />
                  {t("下載檔案", "Download file")}
                </button>
              )}
            </>
          )}
        </>
      ) : (
        <AsyncForm
          submitLabel={t("確認操作", "Confirm action")}
          onSubmit={async (f) => {
            const reason = String(
              f.get("reason") ?? "Admin reviewed publication",
            );
            if (kind === "tenant")
              await patch("/v1/admin/tenants/" + row.id, {
                status: String(f.get("status")),
                reason,
              });
            if (kind === "content")
              await post("/v1/admin/content/" + row.id + "/action", {
                action: String(f.get("action")),
                version: row.version,
                reason,
                ...(f.get("name") ? { name: String(f.get("name")) } : {}),
              });
            if (kind === "execution")
              await post("/v1/admin/execution/" + row.id + "/action", {
                action: String(f.get("action")),
                version: row.version,
                reason,
              });
            if (kind === "approval")
              await post("/v1/admin/operations/" + row.id + "/decision", {
                decision: String(f.get("decision")),
                reason,
              });
            if (kind === "revoke")
              await post("/v1/admin/" + active + "/" + row.id + "/revoke", {
                reason,
              });
            if (kind === "publish")
              await post(
                "/v1/admin/catalog/" + row.id + "/" + String(f.get("action")),
              );
            if (kind === "catalog")
              await post("/v1/admin/catalog", {
                kind: String(f.get("kind")),
                key: String(f.get("key")),
                body: JSON.parse(String(f.get("body"))),
              });
            if (kind === "role")
              await post("/v1/admin/access/roles", {
                key: String(f.get("key")),
                name: String(f.get("name")),
                permissions: f.getAll("permissions").map(String),
                reason,
              });
            if (kind === "binding") {
              const limits: any = {};
              if (f.get("max_amount"))
                limits.max_amount_micros = Math.round(
                  Number(f.get("max_amount")) * 1e6,
                );
              if (f.get("max_hours"))
                limits.max_duration_hours = Number(f.get("max_hours"));
              if (f.get("max_batch"))
                limits.max_batch = Number(f.get("max_batch"));
              await post("/v1/admin/access/bindings", {
                ...(f.get("expires_at")
                  ? {
                      expires_at: new Date(
                        String(f.get("expires_at")),
                      ).toISOString(),
                    }
                  : {}),
                principal_id: String(f.get("principal")),
                role_key: String(f.get("role")),
                scope_kind: String(f.get("scope")),
                ...(f.get("scope_id")
                  ? { scope_id: String(f.get("scope_id")) }
                  : {}),
                effect: String(f.get("effect")),
                limits,
                reason,
              });
            }
            if (kind === "support")
              await post("/v1/admin/support", {
                tenant_id: String(f.get("tenant")),
                duration_minutes: Number(f.get("duration")),
                reason,
              });
            onDone();
            onClose();
          }}
        >
          {row && (
            <div className="notice">
              <FileText size={17} />
              <div>
                {row.name ?? row.title ?? row.action ?? row.key}
                <small>{row.id}</small>
              </div>
            </div>
          )}
          {kind === "tenant" && (
            <Field label={t("企業狀態", "Workspace status")}>
              <select
                name="status"
                defaultValue={row.status === "active" ? "suspended" : "active"}
              >
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </Field>
          )}
          {kind === "content" && (
            <>
              <Field label={t("操作", "Action")}>
                <select name="action">
                  <option value="quarantine">
                    {t("隔離內容", "Quarantine content")}
                  </option>
                  <option
                    value="restore"
                    disabled={row.state === "deleted" && row.kind !== "assets"}
                  >
                    {t("恢復內容", "Restore content")}
                  </option>
                  <option value="delete">
                    {t("移除內容", "Delete content")}
                  </option>
                  <option value="metadata" disabled={row.kind === "agents"}>
                    {t("更新名稱", "Update name")}
                  </option>
                </select>
              </Field>
              <Field
                label={t("新名稱（更新名稱時填寫）", "New name (for rename)")}
              >
                <input name="name" />
              </Field>
              <p className="muted small-text">
                {t(
                  "隔離或刪除會撤銷分享。恢復不會重新啟用舊連結。",
                  "Quarantine or deletion revokes shares. Restore does not re-enable old links.",
                )}
              </p>
              {["conversations", "memories"].includes(row.kind) && (
                <p className="notice">
                  {t(
                    "刪除會清除會話或記憶文字，無法還原。進行中的會話須先取消工作或完成對帳。",
                    "Deletion erases conversation or memory text permanently. Active conversation tasks must be cancelled or reconciled first.",
                  )}
                </p>
              )}
            </>
          )}
          {kind === "execution" && (
            <Field label={t("執行動作", "Task action")}>
              <select name="action">
                <option value="cancel">Cancel</option>
                <option value="pause">Pause queued task</option>
                <option value="resume">Resume paused task</option>
                <option value="retry">Retry</option>
              </select>
            </Field>
          )}
          {kind === "approval" && (
            <Field label={t("審批決定", "Decision")}>
              <select name="decision">
                <option value="approve">Approve</option>
                <option value="reject">Reject</option>
              </select>
            </Field>
          )}
          {kind === "publish" && (
            <Field label={t("發佈操作", "Publication action")}>
              <select name="action">
                <option value="publish">Publish this version</option>
                <option value="rollback">Roll back to retired version</option>
              </select>
            </Field>
          )}
          {kind === "catalog" && (
            <>
              <Field label={t("內容類型", "Content type")}>
                <select
                  name="kind"
                  defaultValue={
                    active === "plans"
                      ? "plan"
                      : active === "policy"
                        ? "policy"
                        : "announcement"
                  }
                >
                  {[
                    "announcement",
                    "help",
                    "navigation",
                    "role",
                    "skill",
                    "plan",
                    "policy",
                  ].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("識別名稱", "Key")}>
                <input name="key" pattern="[A-Za-z0-9_-]+" required />
              </Field>
              <Field label={t("內容（JSON）", "Content (JSON)")}>
                <textarea
                  name="body"
                  rows={8}
                  defaultValue={
                    active === "policy"
                      ? '\n{\n  "approval_threshold_micros": 10000000000,\n  "max_vip_hours": 8784\n}'
                      : active === "plans"
                        ? '\n{\n  "name": "Pro",\n  "capabilities": ["text", "image"],\n  "monthly_hkd_micros": 0,\n  "max_active_tasks": 3,\n  "max_task_budget_micros": 500000000\n}'
                        : '\n{\n  "title": "",\n  "text": "",\n  "title_en": "",\n  "text_en": ""\n}'
                  }
                  required
                />
              </Field>
            </>
          )}
          {kind === "role" && (
            <>
              <Field label={t("識別名稱", "Key")}>
                <input name="key" pattern="[a-z][a-z0-9_-]{2,63}" required />
              </Field>
              <Field label={t("角色名稱", "Role name")}>
                <input name="name" required />
              </Field>
              <fieldset className="permission-options">
                <legend>
                  {t("明確授予的操作", "Explicit allowed actions")}
                </legend>
                {data?.permission_catalog.map((p: any) => (
                  <label key={p.key}>
                    <input type="checkbox" name="permissions" value={p.key} />
                    <code>{p.key}</code>
                  </label>
                ))}
              </fieldset>
            </>
          )}
          {kind === "binding" && (
            <>
              <Field label={t("管理員", "Administrator")}>
                <select name="principal" required>
                  <option value="">Choose administrator</option>
                  {data?.items.map((r: any) => (
                    <option value={r.id} key={r.id}>
                      {r.name} · {r.email}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("角色", "Role")}>
                <select name="role">
                  {data?.roles.map((r: any) => (
                    <option value={r.key} key={r.key}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="two-columns">
                <Field label={t("批次筆數上限", "Maximum batch size")}>
                  <input name="max_batch" type="number" min="1" max="100" />
                </Field>
                <Field
                  label={t("授權到期時間（可選）", "Grant expiry (optional)")}
                >
                  <input name="expires_at" type="datetime-local" />
                </Field>
              </div>
              <div className="two-columns">
                <Field label={t("範圍", "Scope")}>
                  <select name="scope">
                    <option value="global">Global</option>
                    <option value="tenant">Workspace</option>
                    <option value="project">Project</option>
                  </select>
                </Field>
                <Field label={t("效果", "Effect")}>
                  <select name="effect">
                    <option value="allow">Allow</option>
                    <option value="deny">Explicit deny</option>
                  </select>
                </Field>
              </div>
              <Field
                label={t(
                  "範圍 ID（Global 留空）",
                  "Scope ID (blank for global)",
                )}
              >
                <input name="scope_id" />
              </Field>
              <div className="two-columns">
                <Field label={t("單筆金額上限（HKD）", "Amount limit (HKD)")}>
                  <input name="max_amount" type="number" min="0" />
                </Field>
                <Field label={t("期限上限（小時）", "Duration limit (hours)")}>
                  <input name="max_hours" type="number" min="1" />
                </Field>
              </div>
            </>
          )}
          {kind === "support" && (
            <>
              <Field label="Workspace ID">
                <input name="tenant" required />
              </Field>
              <Field label={t("有效分鐘數", "Duration (minutes)")}>
                <input
                  name="duration"
                  type="number"
                  min="5"
                  max="60"
                  defaultValue="15"
                  required
                />
              </Field>
              <p className="muted">
                {t(
                  "支援會話預設只讀元資料，不取得用戶身份或寫入權。",
                  "Support sessions provide read-only metadata by default, without impersonation or write access.",
                )}
              </p>
            </>
          )}
          {!["catalog", "publish"].includes(kind) && (
            <Field label={t("操作原因", "Reason")}>
              <textarea name="reason" rows={3} minLength={3} required />
            </Field>
          )}
        </AsyncForm>
      )}
    </Modal>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

function BatchDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<any>(null);
  return (
    <Modal title={t("批次用戶操作", "Batch user action")} onClose={onClose}>
      {preview ? (
        <>
          <div className="notice">
            <div>
              <strong>{t("確認變更範圍", "Review affected users")}</strong>
              <p>
                {preview.found} {t("名用戶", "users")} ·{" "}
                {preview.command.status} · {preview.missing}{" "}
                {t("筆不存在", "not found")}
              </p>
              <p>{preview.command.reason}</p>
            </div>
          </div>
          <AsyncForm
            submitLabel={t("確認套用並撤銷會話", "Apply and revoke sessions")}
            onSubmit={async () => {
              await post("/v1/admin/jobs", {
                preview_id: preview.id,
                payload_hash: preview.payload_hash,
              });
              onDone();
              onClose();
            }}
          >
            <button
              className="text-button"
              type="button"
              onClick={() => setPreview(null)}
            >
              {t("重新編輯", "Edit")}
            </button>
          </AsyncForm>
        </>
      ) : (
        <AsyncForm
          submitLabel={t("預覽影響", "Preview impact")}
          onSubmit={async (f) => {
            setPreview(
              await post("/v1/admin/jobs/preview", {
                action: "users.status",
                ids: String(f.get("ids"))
                  .split(/[\s,]+/)
                  .filter(Boolean),
                status: String(f.get("status")),
                reason: String(f.get("reason")),
              }),
            );
          }}
        >
          <Field
            label={t(
              "用戶 ID（以逗號或換行分隔，最多 100 名）",
              "User IDs (comma/newline separated, up to 100)",
            )}
          >
            <textarea name="ids" rows={4} required />
          </Field>
          <Field label={t("狀態", "Status")}>
            <select name="status">
              <option value="suspended">Suspended</option>
              <option value="active">Active</option>
            </select>
          </Field>
          <Field label={t("操作原因", "Reason")}>
            <textarea name="reason" minLength={3} required />
          </Field>
        </AsyncForm>
      )}
    </Modal>
  );
}
import { AdminSchedules } from "./schedules";
