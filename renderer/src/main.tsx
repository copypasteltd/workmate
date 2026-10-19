import { RoleTemplateCards, roleEnglish } from "./role-templates";
import { DesignExports } from "./design-exports";
import { NativeFiles } from "./native-files";
import { DeleteAsset, DeletionProgress } from "./deletions";
import { DataModeNotice } from "./data-mode";
import { TaskInputRequests } from "./task-dependencies";
import { ResumableUpload } from "./resumable-upload";
import { CloudFiles } from "./cloud-files";
import { ProjectSkills } from "./skills";
import { Notifications, UnreadNotifications } from "./notifications";
import { Schedules } from "./schedules";
import {
  CompanySignIn,
  ConfirmCompanyIdentity,
  LinkedCompanyIdentities,
} from "./federation";
import {
  Specialists,
  Conversations,
  ConversationDetail,
  Memories,
  ModeField,
  RecentConversations,
  TaskPlan,
} from "./persistent-work";
import React, { useEffect, useState, useRef, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  HashRouter,
  Routes,
  Route,
  Navigate,
  Link,
  NavLink,
  useNavigate,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowUp,
  Plus,
  Command,
  LayoutGrid,
  FolderOpen,
  Image,
  ChartNoAxesCombined,
  Workflow,
  Plug,
  Monitor,
  Users,
  Settings,
  Wallet,
  LogOut,
  Menu,
  X,
  Sparkles,
  Code2,
  Palette,
  Type,
  Clapperboard,
  Search,
  FileText,
  Upload,
  Check,
  ShieldCheck,
  Mail,
  Globe2,
  Layers,
  BookOpen,
  Clock,
  ChevronDown,
  RefreshCw,
  Download,
  Trash2,
  Play,
  PanelLeftClose,
  MessageSquare,
  Brain,
  Bell,
} from "lucide-react";
import { api, post, patch, download, ApiError } from "./api";
import { useTaskEvents } from "./task-events";
import {
  Preferences,
  useI18n,
  useData,
  ErrorNotice,
  Loading,
  Empty,
  Modal,
  PageHeader,
  Badge,
  Money,
  DateText,
  AsyncForm,
  Field,
} from "./ui";
import { WorkspaceProvider, useWorkspace } from "./context";
import "./style.css";

function Logo() {
  return (
    <Link to="/" className="logo" aria-label="CopyPaste home">
      <img className="logo-light" src="./brand-mark.png" alt="" />
      <img className="logo-dark" src="./brand-mark.png" alt="" />
      <strong>CopyPaste</strong>
    </Link>
  );
}
function App() {
  return (
    <Preferences>
      <WorkspaceProvider>
        <DataModeNotice />
        {window.copyPasteBridge ? (
          <HashRouter>
            <AppRoutes />
          </HashRouter>
        ) : (
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        )}
      </WorkspaceProvider>
    </Preferences>
  );
}
function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/sso" element={<CompanySignIn />} />
      <Route path="/sso/confirm" element={<ConfirmCompanyIdentity />} />
      <Route path="/welcome" element={<Onboarding />} />
      <Route path="/invite" element={<Invite />} />
      <Route path="/authorize" element={<NativeAuthorize />} />
      <Route path="/app/*" element={<Shell />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
function Landing() {
  const { t } = useI18n();
  const { me } = useWorkspace();
  if (window.copyPasteBridge)
    return <Navigate to={me ? "/app" : "/login"} replace />;
  return (
    <div className="landing">
      <header className="site-header">
        <Logo />
        <nav>
          <a href="#work">{t("工作方式", "How it works")}</a>
          <a href="#roles">{t("專業角色", "Specialists")}</a>
          <Link className="button primary small" to={me ? "/app" : "/login"}>
            {me
              ? t("進入工作台", "Open workspace")
              : t("開始使用", "Get started")}
            <ArrowUpRight size={16} />
          </Link>
        </nav>
      </header>
      <section className="landing-hero">
        <div>
          <p className="eyebrow">YOUR TEAM, WITH MORE POSSIBILITY.</p>
          <h1>
            {t("讓好想法，", "Good ideas.")}
            <br />
            <em>{t("真正成事。", "Made real.")}</em>
          </h1>
          <p className="hero-description">
            {t(
              "從創意設計到行銷分析，把想法交給你的專屬團隊。在同一個工作空間，完成每一次交付。",
              "From the first creative brief to the next campaign report. Bring your work to a team of specialists, in one considered workspace.",
            )}
          </p>
          <Link to={me ? "/app" : "/login"} className="button primary">
            {t("建立你的工作空間", "Make room for your next idea")}
            <ArrowUpRight size={18} />
          </Link>
          <div className="hero-note">
            <ShieldCheck size={16} />
            {t(
              "企業工作空間 · 專案權限 · 用量透明",
              "Company workspaces · Project access · Clear usage",
            )}
          </div>
        </div>
        <figure className="hero-art">
          <img
            src="./copypaste-folds.png"
            alt={t(
              "藍白紙帶交織，代表從想法到交付的連結",
              "Interlocking blue and paper ribbons, connecting ideas to delivery",
            )}
          />
          <figcaption>
            <span className="tiny-dot" />A LITTLE MORE SPACE TO CREATE.
          </figcaption>
        </figure>
      </section>
      <section id="work" className="landing-how">
        <p className="eyebrow">A BETTER FLOW OF WORK.</p>
        <div className="three-columns">
          {[
            [
              "01",
              t("帶來你的想法", "Bring a brief"),
              t(
                "建立專案，加入品牌與素材。",
                "Start a project with your brand and materials.",
              ),
            ],
            [
              "02",
              t("找到合適的專家", "Choose your specialist"),
              t(
                "設計、開發、分析，按工作選擇。",
                "Design, development or analysis, built around the job.",
              ),
            ],
            [
              "03",
              t("交付，然後再進一步", "Make it yours"),
              t(
                "檢視成果、提出修改、保存每個版本。",
                "Review the work, request changes and keep every version.",
              ),
            ],
          ].map(([n, h, b]) => (
            <article key={n}>
              <span className="number step-number">{n}</span>
              <h3>{h}</h3>
              <p>{b}</p>
            </article>
          ))}
        </div>
      </section>
      <section id="roles" className="landing-roles">
        <div>
          <p className="eyebrow">18 SPECIALISTS. ONE WORKSPACE.</p>
          <h2>
            {t("為每種工作，", "The right minds,")}
            <br />
            <em>{t("找到合適的搭檔。", "for what’s next.")}</em>
          </h2>
        </div>
        <div className="role-name-list">
          {[
            ["設計與品牌", "Design & brand"],
            ["行銷與數據", "Marketing & insights"],
            ["開發與測試", "Engineering & quality"],
            ["內容與影片", "Content & motion"],
          ].map(([zh, en]) => (
            <Link key={en} to="/login">
              <span>{t(zh, en)}</span>
              <ArrowUpRight size={21} />
            </Link>
          ))}
        </div>
      </section>
      <footer className="site-footer">
        <Logo />
        <span>© {new Date().getFullYear()} CopyPaste · Hong Kong</span>
        <a href="https://copypaste.hk/" target="_blank" rel="noreferrer">
          copypaste.hk <ArrowUpRight size={14} />
        </a>
      </footer>
    </div>
  );
}
function Login() {
  const { t } = useI18n();
  const { me, refresh, loading } = useWorkspace();
  const nav = useNavigate();
  const [query] = useSearchParams();
  const [challenge, setChallenge] = useState<any>(null),
    [address, setAddress] = useState("");
  const next = query.get("next");
  const destination =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";
  useEffect(() => {
    if (!loading && me) nav(destination, { replace: true });
  }, [me, loading]);
  return (
    <div className="auth-layout">
      <section className="auth-content">
        <Logo />
        <div className="auth-form">
          <p className="eyebrow">A GOOD PLACE TO START.</p>
          <h1>
            {t("歡迎來到", "Welcome to")}
            <br />
            <em>CopyPaste.</em>
          </h1>
          <p className="muted">
            {t(
              "使用工作郵箱登入，新用戶將自動建立帳戶。",
              "Sign in with your work email. New here? Your account is created when you verify.",
            )}
          </p>
          {window.copyPasteBridge ? (
            <>
              <button
                className="button primary"
                onClick={() => void window.copyPasteBridge!.signIn()}
              >
                {t("透過瀏覽器安全登入", "Sign in securely in your browser")}
                <ArrowUpRight size={18} />
              </button>
              <p className="form-footnote">
                {t(
                  "在系統瀏覽器完成驗證後，會返回此桌面工作台。",
                  "After verification in your system browser, you’ll return to this workspace.",
                )}
              </p>
            </>
          ) : !challenge ? (
            <AsyncForm
              submitLabel={t("發送驗證碼", "Send sign-in code")}
              onSubmit={async (f) => {
                const email = String(f.get("email")).trim();
                const result = await post("/v1/auth/challenge", { email });
                setAddress(email);
                setChallenge(result);
              }}
            >
              <Field label={t("工作郵箱", "Work email")}>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="you@company.hk"
                  required
                  autoFocus
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
                        "本機開發郵箱已收到驗證碼。讀取方式見 README。",
                        "A code is ready in the local development mailbox. See the README for access.",
                      )
                    : t(
                        `驗證碼已發送至 ${address}`,
                        `We sent a code to ${address}`,
                      )}
                </span>
              </div>
              <AsyncForm
                submitLabel={t("驗證並繼續", "Verify & continue")}
                onSubmit={async (f) => {
                  await post("/v1/auth/verify", {
                    challenge_id: challenge.challenge_id,
                    code: String(f.get("code")),
                  });
                  await refresh();
                  nav(destination, { replace: true });
                }}
              >
                <Field label={t("6 位數驗證碼", "6-digit sign-in code")}>
                  <input
                    className="code-input"
                    name="code"
                    pattern="[0-9]{6}"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="one-time-code"
                    placeholder="000000"
                    required
                    autoFocus
                  />
                </Field>
              </AsyncForm>
              <button
                className="text-button"
                onClick={() => setChallenge(null)}
              >
                {t(
                  "使用其他郵箱 / 重新發送",
                  "Use another email / request a new code",
                )}
              </button>
            </>
          )}
          {!window.copyPasteBridge && !challenge && (
            <Link
              className="button secondary"
              to={"/sso?next=" + encodeURIComponent(destination)}
            >
              {t("使用企業身份登入", "Sign in with company identity")}
            </Link>
          )}
          <p className="form-footnote">
            <ShieldCheck size={14} />
            {t(
              "郵箱驗證 · 不需要密碼",
              "Email verification · No password to remember",
            )}
          </p>
        </div>
        <span className="auth-bottom">
          DESIGNED FOR WHAT’S NEXT. © COPYPASTE
        </span>
      </section>
      <aside className="auth-art">
        <img src="./copypaste-folds.png" alt="CopyPaste blue folded sculpture" />
        <div>
          <span className="eyebrow">IDEAS INTO POSSIBILITY.</span>
          <p>
            {t("想法與成果之間，", "A little space between")}
            <br />
            <em>{t("留一點創造的空間。", "an idea and what’s possible.")}</em>
          </p>
        </div>
      </aside>
    </div>
  );
}
function Onboarding() {
  const { t } = useI18n();
  const w = useWorkspace(),
    nav = useNavigate();
  if (w.loading) return <Loading />;
  if (!w.me) return <Navigate to="/login" replace />;
  return (
    <div className="onboarding">
      <Logo />
      <div className="onboarding-card">
        <span className="step-pill">01 / 01</span>
        <h1>
          {t("先為你的團隊，", "Make a little room")}
          <br />
          <em>{t("建立一個空間。", "for your team.")}</em>
        </h1>
        <p className="muted">
          {t(
            "只需要企業和首個專案名稱。品牌素材可以稍後加入。",
            "Just a workspace and your first project. You can add brand materials later.",
          )}
        </p>
        <AsyncForm
          submitLabel={t("建立並進入工作台", "Create workspace & continue")}
          onSubmit={async (f) => {
            const r = await post("/v1/tenants", {
              name: String(f.get("name")),
              project_name: String(f.get("project_name")),
            });
            localStorage.setItem("cp_tenant", r.tenant.id);
            localStorage.setItem("cp_project", r.project.id);
            await w.refresh();
            nav("/app", { replace: true });
          }}
        >
          <Field label={t("企業 / 團隊名稱", "Company / team name")}>
            <input
              name="name"
              placeholder={t("例如：Harbour Studio", "e.g. Harbour Studio")}
              maxLength={160}
              required
            />
          </Field>
          <Field label={t("首個專案", "First project")}>
            <input
              name="project_name"
              placeholder={t(
                "例如：秋季品牌企劃",
                "e.g. Autumn brand campaign",
              )}
              maxLength={160}
              required
            />
          </Field>
        </AsyncForm>
      </div>
    </div>
  );
}
function Invite() {
  const { t } = useI18n(),
    w = useWorkspace(),
    [q] = useSearchParams(),
    nav = useNavigate();
  if (w.loading) return <Loading />;
  if (!w.me)
    return (
      <Navigate
        to={
          "/login?next=" + encodeURIComponent("/invite?token=" + q.get("token"))
        }
        replace
      />
    );
  return (
    <div className="center-page">
      <Logo />
      <section className="card narrow">
        <h1>{t("一起把事情做好。", "Good work, together.")}</h1>
        <p>
          {t(
            "接受邀請後，你將加入所屬企業的工作空間。",
            "Accept your invitation to join your company workspace.",
          )}
        </p>
        <AsyncForm
          submitLabel={t("接受邀請", "Accept invitation")}
          onSubmit={async () => {
            await post("/v1/invites/accept", { token: q.get("token") });
            await w.refresh();
            nav("/app");
          }}
        >
          <p className="muted">{w.me.user.email}</p>
        </AsyncForm>
      </section>
    </div>
  );
}
function NativeAuthorize() {
  const { t } = useI18n(),
    w = useWorkspace(),
    [q] = useSearchParams();
  if (w.loading) return <Loading />;
  if (!w.me)
    return (
      <Navigate
        to={"/login?next=" + encodeURIComponent("/authorize?" + q.toString())}
        replace
      />
    );
  return (
    <div className="center-page">
      <Logo />
      <section className="card narrow">
        <div className="empty-icon">
          <Monitor size={28} />
        </div>
        <h1>{t("連接你的工作台", "Connect your workspace")}</h1>
        <p>
          {t(
            `允許 CopyPaste ${q.get("client_id") === "desktop" ? "Desktop" : "Chrome Extension"} 使用你的帳戶。`,
            `Allow CopyPaste ${q.get("client_id") === "desktop" ? "Desktop" : "Chrome Extension"} to access your account.`,
          )}
        </p>
        <p className="muted">{w.me.user.email}</p>
        <AsyncForm
          submitLabel={t("授權並返回應用", "Authorize & return")}
          onSubmit={async () => {
            const r = await post("/v1/auth/native/authorize", {
              client_id: q.get("client_id"),
              redirect_uri: q.get("redirect_uri"),
              code_challenge: q.get("code_challenge"),
              state: q.get("state"),
            });
            window.location.assign(r.redirect);
          }}
        >
          <p className="form-footnote">
            {t(
              "本機檔案仍需在客戶端逐一授權目錄。你可隨時撤銷裝置。",
              "Local folders require separate permission in the client. You can revoke a device at any time.",
            )}
          </p>
        </AsyncForm>
      </section>
    </div>
  );
}
const navigation = [
  ["", LayoutGrid, "工作台", "Workspace"],
  ["roles", Sparkles, "專業角色", "Specialists"],
  ["specialists", Users, "我的專家", "Your specialists"],
  ["skills", BookOpen, "專案技能", "Project methods"],
  ["notifications", Bell, "工作通知", "Work notifications"],
  ["conversations", MessageSquare, "我的會話", "Your conversations"],
  ["memories", Brain, "記憶與偏好", "Memory & preferences"],
  ["projects", FolderOpen, "專案", "Projects"],
  ["assets", Image, "素材與交付", "Assets & deliverables"],
  ["files", FolderOpen, "雲端檔案", "Cloud files"],
  ["creative", Layers, "設計畫布", "Design canvas"],
  ["analytics", ChartNoAxesCombined, "行銷分析", "Marketing insights"],
  ["workflows", Workflow, "工作流程", "Workflows"],
  ["connections", Plug, "連接應用", "Connections"],
  ["brand", BookOpen, "品牌資料", "Brand library"],
] as const;
function Shell() {
  const { t } = useI18n(),
    w = useWorkspace();
  const [mobile, setMobile] = useState(false);
  const [narrow, setNarrow] = useState(
    () => matchMedia("(max-width: 740px)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(max-width: 740px)");
    const change = () => {
      setNarrow(media.matches);
      setMobile(false);
    };
    media.addEventListener("change", change);
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobile(false);
    };
    document.addEventListener("keydown", escape);
    return () => {
      media.removeEventListener("change", change);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const location = useLocation();
  const published = useData("/v1/public/content");
  const navConfig = (path: string) =>
    published.data?.items.find(
      (i: any) => i.kind === "navigation" && i.body.path === path,
    )?.body;
  useEffect(() => setMobile(false), [location.pathname]);
  if (w.loading) return <Loading />;
  if (!w.me) return <Navigate to="/login" replace />;
  if (!w.me.memberships.length) return <Navigate to="/welcome" replace />;
  const selected = w.me.memberships.find((m: any) => m.id === w.tenant);
  const project = w.projects.find((p) => p.id === w.project);
  return (
    <div className={"app-shell" + (mobile ? " mobile-open" : "")}>
      <a className="skip-link" href="#main">
        {t("跳到內容", "Skip to content")}
      </a>
      <aside
        className="sidebar"
        inert={narrow && !mobile}
        aria-hidden={narrow && !mobile}
      >
        <div className="sidebar-brand">
          <Logo />
          <button
            className="icon-button mobile-only"
            onClick={() => setMobile(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <label className="workspace-switch">
          <span className="workspace-avatar">
            {selected?.name?.slice(0, 1) ?? "C"}
          </span>
          <select
            value={w.tenant}
            onChange={(e) => w.setTenant(e.target.value)}
            aria-label={t("切換企業", "Switch workspace")}
          >
            {w.me.memberships.map((m: any) => (
              <option value={m.id} key={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </label>
        <button
          className="button primary new-task-side"
          onClick={() => document.dispatchEvent(new Event("cp:new-task"))}
        >
          <Plus size={17} />
          {t("新工作", "New task")}
          <span className="keyboard-key">N</span>
        </button>
        <p className="nav-caption">WORKSPACE</p>
        <nav>
          {[...navigation]
            .filter(([path]) => navConfig(path)?.enabled !== false)
            .sort(
              (a, b) =>
                (navConfig(a[0])?.order ?? 50) - (navConfig(b[0])?.order ?? 50),
            )
            .map(([path, Icon, zh, en]) => (
              <NavLink
                key={path}
                to={"/app" + (path ? "/" + path : "")}
                end={!path}
              >
                <Icon size={18} strokeWidth={1.7} />
                <span>
                  {t(
                    navConfig(path)?.label ?? zh,
                    navConfig(path)?.label_en ?? en,
                  )}
                </span>
                {path === "notifications" && <UnreadNotifications />}
              </NavLink>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <NavLink to="/app/devices">
            <Monitor size={17} />
            {t("裝置與檔案", "Devices & files")}
          </NavLink>
          <NavLink to="/app/members">
            <Users size={17} />
            {t("成員與權限", "Members & access")}
          </NavLink>
          <NavLink to="/app/usage">
            <Wallet size={17} />
            {t("用量與方案", "Usage & plan")}
          </NavLink>
          <NavLink to="/app/settings">
            <Settings size={17} />
            {t("帳戶設定", "Account settings")}
          </NavLink>
          <div className="user-chip">
            <span className="user-avatar">
              {w.me.user.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{w.me.user.name}</strong>
              <small>{selected?.role}</small>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                if (window.copyPasteBridge)
                  await window.copyPasteBridge.signOut();
                else await post("/v1/auth/logout");
                await w.refresh();
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
            <Menu size={20} />
          </button>
          <span className="breadcrumb">
            {selected?.name}
            <span>/</span>
          </span>
          <select
            value={w.project}
            onChange={(e) => w.setProject(e.target.value)}
            aria-label={t("目前專案", "Current project")}
          >
            {w.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="topbar-right">
            <span className="environment-dot" />{" "}
            {t("企業工作空間", "Company workspace")}
          </div>
        </header>
        <main
          id="main"
          className="main-content"
          key={w.tenant + ":" + w.project}
        >
          <ErrorNotice error={w.error} />
          {w.base ? (
            <Routes>
              <Route index element={<Workbench />} />
              <Route path="roles" element={<Roles />} />
              <Route path="specialists" element={<Specialists />} />
              <Route path="skills" element={<ProjectSkills />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="conversations" element={<Conversations />} />
              <Route
                path="conversations/:id"
                element={<ConversationDetail />}
              />
              <Route path="memories" element={<Memories />} />
              <Route path="projects" element={<Projects />} />
              <Route path="tasks/:id" element={<TaskDetail />} />
              <Route path="assets" element={<Assets />} />
              <Route path="files" element={<CloudFiles />} />
              <Route path="creative" element={<Creative />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="connections" element={<Connections />} />
              <Route path="workflows" element={<Workflows />} />
              <Route path="brand" element={<Brand />} />
              <Route path="members" element={<Members />} />
              <Route path="devices" element={<Devices />} />
              <Route path="usage" element={<Usage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/app" replace />} />
            </Routes>
          ) : (
            <Empty
              title={t("開始你的第一個專案", "Start your first project")}
              body={t(
                "請聯絡企業管理員分配專案，或建立新專案。",
                "Ask your workspace owner for project access or create a new project.",
              )}
              action={
                <Link to="/welcome" className="button primary">
                  {t("建立工作空間", "Create workspace")}
                </Link>
              }
            />
          )}
        </main>
        <footer className="app-footer">
          <span>COPYPASTE · MAKE ROOM FOR POSSIBILITY.</span>
          <span>HONG KONG</span>
        </footer>
      </div>
      <NewTaskListener />
    </div>
  );
}
function NewTaskListener() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    const shortcut = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === "n" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement)?.tagName,
        ) &&
        !(e.target as HTMLElement)?.isContentEditable
      ) {
        e.preventDefault();
        show();
      }
    };
    document.addEventListener("cp:new-task", show);
    document.addEventListener("keydown", shortcut);
    return () => {
      document.removeEventListener("cp:new-task", show);
      document.removeEventListener("keydown", shortcut);
    };
  }, []);
  return open ? <NewTask onClose={() => setOpen(false)} /> : null;
}
function NewTask({
  onClose,
  role = "assistant",
}: {
  onClose: () => void;
  role?: string;
}) {
  const { t, locale } = useI18n(),
    w = useWorkspace(),
    nav = useNavigate();
  const { data } = useData("/v1/catalog/roles");
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const [selectedRole, setSelectedRole] = useState(role);
  const [requiredInput, setRequiredInput] = useState("");
  return (
    <Modal title={t("開始一項新工作", "Start something new")} onClose={onClose}>
      <AsyncForm
        submitLabel={t("開始工作", "Start task")}
        onSubmit={async (f) => {
          const selectedRole = String(f.get("role")),
            requiredInput = String(f.get("required_input") ?? ""),
            body = {
              title: String(f.get("title")),
              prompt: String(f.get("prompt")),
              mode: String(f.get("mode")),
              budget_micros: Math.round(Number(f.get("budget")) * 1e6),
              ...(requiredInput
                ? {
                    dependencies: [
                      requiredInput === "file"
                        ? {
                            kind: "file",
                            description: t(
                              "請提供已批准的工作素材，然後開始。",
                              "Provide approved source materials before starting.",
                            ),
                          }
                        : {
                            kind: "connection",
                            provider: requiredInput,
                            description: t(
                              "請選取此工作的獲准連接。",
                              "Select the authorized connection for this work.",
                            ),
                          },
                    ],
                  }
                : {}),
            };
          const fingerprint = JSON.stringify({
            tenant: w.tenant,
            project: w.project,
            role: selectedRole,
            ...body,
          });
          if (pending.current?.fingerprint !== fingerprint)
            pending.current = { fingerprint, id: crypto.randomUUID() };
          const result =
            selectedRole === "assistant"
              ? await post(w.base + "/delegations", {
                  ...body,
                  client_message_id: pending.current!.id,
                })
              : await api(w.base + "/tasks", {
                  method: "POST",
                  headers: { "Idempotency-Key": pending.current!.id },
                  body: JSON.stringify({ ...body, role_key: selectedRole }),
                });
          sessionStorage.removeItem("cp_brief");
          onClose();
          nav(
            selectedRole === "assistant"
              ? "/app/conversations/" + result.conversation.id
              : "/app/tasks/" + result.id,
          );
        }}
      >
        <Field label={t("專案", "Project")}>
          <input
            value={w.projects.find((p) => p.id === w.project)?.name ?? ""}
            readOnly
          />
        </Field>
        <Field label={t("專業角色", "Specialist")}>
          <select
            name="role"
            value={selectedRole}
            onChange={(e) => {
              setSelectedRole(e.target.value);
              setRequiredInput("");
            }}
          >
            <option value="assistant">
              {t(
                "預設助手 — 答覆、計畫與文字交付",
                "Default assistant — answers, plans and text deliverables",
              )}
            </option>
            {data?.items.map((r: any) => (
              <option key={r.role_key} value={r.role_key}>
                {locale === "en" ? roleEnglish[r.role_key] : r.display_name}
              </option>
            ))}
          </select>
        </Field>
        <ModeField />
        <Field label={t("工作名稱", "Task name")}>
          <input
            name="title"
            placeholder={t(
              "例如：秋季新品推廣海報",
              "e.g. Autumn launch campaign",
            )}
            maxLength={160}
            required
          />
        </Field>
        <Field label={t("你想完成什麼？", "What would you like to make?")}>
          <textarea
            name="prompt"
            defaultValue={sessionStorage.getItem("cp_brief") ?? ""}
            rows={5}
            minLength={5}
            maxLength={30000}
            placeholder={t(
              "說明目標、對象、交付格式和需要保留的內容…",
              "Describe your goal, audience, deliverables and anything to preserve…",
            )}
            required
          />
        </Field>
        <Field
          label={t("開始前需要補齊資料嗎？", "Inputs needed before starting?")}
          hint={t(
            "選擇後先保存同一項工作並預留預算，補齊資料前不呼叫模型。",
            "Save the task and reserve its budget; the model waits until you provide these inputs.",
          )}
        >
          <select
            name="required_input"
            value={requiredInput}
            onChange={(e) => setRequiredInput(e.target.value)}
          >
            <option value="">{t("資料已齊，可開始", "Ready to start")}</option>
            <option value="file">
              {t("先等我提供檔案", "Wait for my file")}
            </option>
            {data?.items
              .find((r: any) => r.role_key === selectedRole)
              ?.tool_ids.includes("connector.read") &&
              [
                ["google_ads", "Google Ads"],
                ["ga4", "Google Analytics"],
                ["search_console", "Search Console"],
                ["meta", "Meta"],
              ].map(([key, label]) => (
                <option value={key} key={key}>
                  {t("先選取連接：", "Choose connection first: ")}
                  {label}
                </option>
              ))}
          </select>
        </Field>
        <Field
          label={t("本次工作預算上限（HKD）", "Task budget limit (HKD)")}
          hint={t(
            "提交工作時預留額度，依實際用量結算；等待資料期間保持預留。",
            "Credit is reserved on submission and settled against measured usage; it remains reserved while waiting for inputs.",
          )}
        >
          <input
            name="budget"
            type="number"
            min="1"
            max="10000"
            step="0.01"
            defaultValue="20"
            required
          />
        </Field>
      </AsyncForm>
    </Modal>
  );
}
function PublishedContent() {
  const { t, locale } = useI18n();
  const { data } = useData("/v1/public/content");
  return (
    <>
      {data?.items
        .filter((r: any) => ["announcement", "help"].includes(r.kind))
        .slice(0, 6)
        .map((r: any) =>
          r.kind === "help" ? (
            <details key={r.id} className="card section-block">
              <summary>
                {locale === "en"
                  ? (r.body.title_en ?? r.body.title)
                  : r.body.title}
              </summary>
              <p style={{ whiteSpace: "pre-wrap" }}>
                {locale === "en"
                  ? (r.body.text_en ?? r.body.text)
                  : r.body.text}
              </p>
            </details>
          ) : (
            <div key={r.id} className="notice section-block" role="status">
              <div>
                <strong>
                  {locale === "en"
                    ? (r.body.title_en ?? r.body.title)
                    : r.body.title}
                </strong>
                <p style={{ whiteSpace: "pre-wrap" }}>
                  {locale === "en"
                    ? (r.body.text_en ?? r.body.text)
                    : r.body.text}
                </p>
              </div>
            </div>
          ),
        )}
    </>
  );
}
function Workbench() {
  const { t } = useI18n(),
    w = useWorkspace();
  const { data, error, loading } = useData(w.base + "/tasks", 0, 10000);
  const [brief, setBrief] = useState(""),
    [newTask, setNewTask] = useState(false);
  return (
    <>
      <div className="workspace-intro">
        <div>
          <p className="eyebrow">A LITTLE ROOM FOR YOUR NEXT BIG THING.</p>
          <h1>
            {t(`你好，${w.me.user.name}。`, `Hello, ${w.me.user.name}.`)}
            <br />
            <em>{t("今天，想完成什麼？", "What shall we make today?")}</em>
          </h1>
          <p className="muted">
            {t(
              "從一個想法開始，讓合適的專家接手。",
              "Start with an idea. Find the right specialist to move it forward.",
            )}
          </p>
        </div>
        <div className="intro-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
      <PublishedContent />
      <section className="brief-composer">
        <textarea
          aria-label={t("描述你的工作", "Describe your task")}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={t(
            "設計一組海報、整理廣告數據，或建立一個全新工具…",
            "A campaign to design, data to understand, something new to build…",
          )}
          rows={3}
        />
        <footer>
          <span>
            <Command size={15} />
            {t(
              "從想法到交付，在這裡開始。",
              "From idea to delivery, start here.",
            )}
          </span>
          <button
            className="button primary round"
            onClick={() => {
              sessionStorage.setItem("cp_brief", brief);
              setNewTask(true);
            }}
            aria-label={t("開始工作", "Start task")}
          >
            <ArrowUp size={21} />
          </button>
        </footer>
      </section>
      <div className="quick-starts">
        {[
          [Palette, t("製作品牌視覺", "Create campaign visuals")],
          [ChartNoAxesCombined, t("分析廣告表現", "Understand ad performance")],
          [Code2, t("建立網站與工具", "Build a site or tool")],
        ].map(([Icon, label]: any) => (
          <button
            key={label}
            onClick={() => {
              setBrief(label);
              sessionStorage.setItem("cp_brief", label);
              document.dispatchEvent(new Event("cp:new-task"));
            }}
          >
            <Icon size={17} />
            {label}
            <ArrowUpRight size={14} />
          </button>
        ))}
      </div>
      <section className="section-block">
        <div className="section-title">
          <h2>{t("選擇你的專家", "Meet your specialists")}</h2>
          <Link to="/app/roles" className="text-link">
            {t("全部 18 個角色", "All 18 specialists")}
            <ArrowRight size={15} />
          </Link>
        </div>
        <RoleCards limit={4} />
      </section>
      <section className="section-block">
        <div className="section-title">
          <h2>{t("最近的工作", "Your recent work")}</h2>
          <span className="muted small-text">
            {data?.items.length ?? 0} {t("項工作", "tasks")}
          </span>
        </div>
        <ErrorNotice error={error} />
        {loading && !data ? (
          <Loading />
        ) : data?.items.length ? (
          <TaskTable items={data.items} />
        ) : (
          <Empty
            icon={FolderOpen}
            title={t(
              "下一項好工作，從這裡開始。",
              "Your next good piece of work starts here.",
            )}
            body={t(
              "建立工作後，你可以在這裡追蹤進度、查看交付和提出修改。",
              "Create a task to follow its progress, review deliverables and request changes.",
            )}
            action={
              <button
                className="text-button"
                onClick={() => document.dispatchEvent(new Event("cp:new-task"))}
              >
                {t("開始第一項工作", "Start your first task")}
                <ArrowUpRight size={15} />
              </button>
            }
          />
        )}
      </section>
      <RecentConversations />
      {newTask && <NewTask onClose={() => setNewTask(false)} />}
    </>
  );
}
function RoleCards(props: {
  limit?: number;
  filter?: string;
  search?: string;
}) {
  return <RoleTemplateCards {...props} />;
}
function Roles() {
  const { t } = useI18n();
  const [filter, setFilter] = useState("all"),
    [search, setSearch] = useState("");
  return (
    <>
      <PageHeader
        eyebrow="THE RIGHT MIND FOR THE JOB."
        title={t("你的專業團隊", "Your specialist team")}
        description={t(
          "18 個專業角色，從完整設計到軟件開發。選擇角色，查看方法和交付標準。",
          "18 specialists, from full design services to software development. Explore their methods and what they deliver.",
        )}
      />
      <div className="filter-row">
        <div className="tabs">
          {[
            ["all", "全部", "All"],
            ["design", "設計", "Design"],
            ["engineering", "開發", "Engineering"],
            ["marketing", "行銷", "Marketing"],
            ["operations", "流程", "Operations"],
          ].map(([key, zh, en]) => (
            <button
              className={filter === key ? "active" : ""}
              key={key}
              onClick={() => setFilter(key)}
            >
              {t(zh, en)}
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Search specialists"
            placeholder={t("搜尋角色…", "Find a specialist…")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <RoleCards filter={filter} search={search} />
    </>
  );
}
function TaskTable({ items }: { items: any[] }) {
  const { t } = useI18n();
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t("工作", "Task")}</th>
            <th>{t("角色", "Specialist")}</th>
            <th>{t("狀態", "Status")}</th>
            <th>{t("費用", "Usage")}</th>
            <th>{t("建立時間", "Created")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id}>
              <td>
                <Link className="table-link" to={"/app/tasks/" + r.id}>
                  {r.title}
                  <ArrowUpRight size={14} />
                </Link>
              </td>
              <td>{roleEnglish[r.role_key] ?? r.role_key}</td>
              <td>
                <Badge value={r.status} />
              </td>
              <td>
                <Money value={r.charged_micros} />
              </td>
              <td>
                <DateText value={r.created_at} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Projects() {
  const { t } = useI18n(),
    w = useWorkspace(),
    [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader
        eyebrow="SPACE FOR THE WORK."
        title={t("專案", "Projects")}
        description={t(
          "每個專案有自己的工作、素材、品牌和成員權限。",
          "A considered home for each project’s work, materials, brand and access.",
        )}
        action={
          <button className="button primary" onClick={() => setOpen(true)}>
            <Plus size={17} />
            {t("新增專案", "New project")}
          </button>
        }
      />
      <div className="project-grid">
        {w.projects.map((p) => (
          <article className="card project-card" key={p.id}>
            <FolderOpen size={25} strokeWidth={1.5} />
            <h2>{p.name}</h2>
            <p className="muted">
              {p.description ||
                t(
                  "讓下一個想法在這裡成形。",
                  "A space for your next idea to take shape.",
                )}
            </p>
            <footer>
              <DateText value={p.created_at} />
              <button
                className="text-button"
                onClick={() => w.setProject(p.id)}
              >
                {p.id === w.project ? (
                  <Check size={18} />
                ) : (
                  <ArrowUpRight size={18} />
                )}
              </button>
            </footer>
          </article>
        ))}
      </div>
      {open && (
        <Modal
          title={t("建立新專案", "Create a project")}
          onClose={() => setOpen(false)}
        >
          <AsyncForm
            submitLabel={t("建立專案", "Create project")}
            onSubmit={async (f) => {
              const p = await post(`/v1/tenants/${w.tenant}/projects`, {
                name: String(f.get("name")),
                description: String(f.get("description")),
              });
              await w.reloadProjects();
              w.setProject(p.id);
              setOpen(false);
            }}
          >
            <Field label={t("專案名稱", "Project name")}>
              <input name="name" maxLength={160} required />
            </Field>
            <Field label={t("簡介", "Description")}>
              <textarea name="description" maxLength={2000} rows={3} />
            </Field>
          </AsyncForm>
        </Modal>
      )}
    </>
  );
}
function TaskDetail() {
  const { t } = useI18n(),
    w = useWorkspace(),
    location = useLocation();
  const id = location.pathname.split("/").pop();
  const [version, setVersion] = useState(0);
  const { data, error, loading } = useData(
    w.base + "/tasks/" + id,
    version,
    2500,
  );
  const events = useTaskEvents(w.base, w.tenant, id, () =>
    setVersion((v) => v + 1),
  );
  const [actionError, setActionError] = useState<Error | null>(null);
  const activityLabel = (e: any) => {
    const state =
      e.kind === "task.queued"
        ? "queued"
        : e.kind === "task.started"
          ? "running"
          : e.kind === "task.finished"
            ? e.body.status
            : e.kind === "task.state_changed"
              ? e.body.status
              : "";
    const labels: Record<string, [string, string]> = {
      queued: ["工作已排隊", "Work queued"],
      running: ["開始處理工作", "Work started"],
      succeeded: ["工作已完成", "Work completed"],
      failed: ["工作未完成", "Work failed"],
      cancelled: ["工作已取消", "Work cancelled"],
      "artifact.ready": ["交付檔案已就緒", "Deliverable file ready"],
      "delivery.reviewed": ["已記錄審閱結果", "Review recorded"],
      "task.cancel_requested": ["已要求取消工作", "Cancellation requested"],
      "task.capacity_wait": [
        "等待可用執行名額",
        "Waiting for execution capacity",
      ],
      "task.needs_input": ["等待你提供資料", "Waiting for your inputs"],
      "task.inputs_ready": [
        "資料已齊，工作已排隊",
        "Inputs ready; work queued",
      ],
    };
    const labelKey = state || e.body.step_key || e.kind;
    if (labels[labelKey]) return t(...labels[labelKey]);
    if (e.kind === "usage.updated")
      return e.body.cost_state === "reconciling"
        ? t("用量待核對", "Usage needs reconciliation")
        : t("用量已結算", "Usage settled");
    if (e.kind === "task.warning")
      return t("執行狀態需要留意", "Execution needs attention");
    const step = e.body.step_key ?? e.kind;
    if (/cleanup|closed/.test(step))
      return t(
        "執行已結束，正在整理記錄",
        "Execution closed and records saved",
      );
    if (/initialize|thread|turn/.test(step))
      return t("正在準備工作環境", "Preparing the workspace");
    return t("工作進度已更新", "Work progress updated");
  };
  async function act(fn: () => Promise<any>) {
    try {
      await fn();
      setVersion((v) => v + 1);
    } catch (e) {
      setActionError(e as Error);
    }
  }
  if (loading && !data) return <Loading />;
  return (
    <>
      <Link to="/app" className="text-link">
        ← {t("返回工作台", "Back to workspace")}
      </Link>
      <ErrorNotice error={error} />
      {data && (
        <>
          <PageHeader
            title={data.title}
            description={roleEnglish[data.role_key]}
            action={
              ["queued", "running", "paused", "needs_input"].includes(
                data.status,
              ) ? (
                <button
                  className="button secondary"
                  onClick={() =>
                    void act(() => post(w.base + "/tasks/" + id + "/cancel"))
                  }
                >
                  {t("取消工作", "Cancel task")}
                </button>
              ) : (
                <Badge value={data.status} />
              )
            }
          />
          <ErrorNotice error={actionError} />
          <TaskInputRequests
            task={data}
            onChange={() => setVersion((v) => v + 1)}
          />
          {data.conversation_id && (
            <p className="section-block">
              <Link
                className="text-link"
                to={"/app/conversations/" + data.conversation_id}
              >
                {t("返回私人會話", "Return to private conversation")}
                <ArrowUpRight size={15} />
              </Link>
            </p>
          )}
          <div className="task-layout">
            <section className="card task-conversation">
              <div className="conversation-label">
                <span className="user-avatar small-avatar">
                  {w.me.user.name[0]}
                </span>
                <strong>{t("工作簡報", "Your brief")}</strong>
                <DateText value={data.created_at} />
              </div>
              <p className="preserve-text">{data.prompt}</p>
              <hr />
              <div className="conversation-label">
                <span className="specialist-avatar">
                  <Sparkles size={17} />
                </span>
                <strong>CopyPaste</strong>
                <Badge value={data.status} />
              </div>
              {data.output ? (
                <div className="preserve-text agent-output">{data.output}</div>
              ) : (
                <p className="muted">
                  {data.status === "needs_input"
                    ? t(
                        "正在等待你提供上述資料。尚未開始模型執行。",
                        "Waiting for the inputs above. Model execution has not started.",
                      )
                    : data.status === "queued"
                      ? data.capacity_wait_reason
                        ? t(
                            "目前執行名額已滿，系統會自動繼續原工作。尚未呼叫模型，預算仍保持預留。",
                            "Execution capacity is busy. This same task will resume automatically. The model has not been called and the budget remains reserved.",
                          )
                        : t(
                            "工作已排隊，正在等待專家接手。",
                            "Your task is queued for your specialist.",
                          )
                      : data.status === "running"
                        ? t(
                            "正在處理。你可以離開此頁，稍後回來查看進度。",
                            "Work is in progress. You can leave and return to review it later.",
                          )
                        : data.status === "reconciling"
                          ? t(
                              "此次執行需要核對結果和費用，管理員將處理。",
                              "This run needs a result and usage review. Your administrator can resolve it.",
                            )
                          : t(
                              "此項工作沒有可交付結果。請查看下方記錄。",
                              "This task has no deliverable result. Review the activity below.",
                            )}
                </p>
              )}
              {data.error_code && (
                <div className="notice error">{data.error_code}</div>
              )}
              {data.status === "succeeded" && data.mode !== "plan" && (
                <div className="review-actions">
                  <button
                    className="button primary"
                    onClick={() =>
                      void act(() =>
                        post(w.base + "/tasks/" + id + "/acceptance", {
                          decision: "accepted",
                          version: data.version,
                          comment: "",
                        }),
                      )
                    }
                  >
                    <Check size={16} />
                    {t("接受交付", "Accept deliverable")}
                  </button>
                  <button
                    className="button secondary"
                    onClick={() =>
                      void act(() =>
                        post(w.base + "/tasks/" + id + "/acceptance", {
                          decision: "changes_requested",
                          version: data.version,
                          comment: "Revisions requested",
                        }),
                      )
                    }
                  >
                    {t("要求修改", "Request changes")}
                  </button>
                  <Badge value={data.acceptance} />
                </div>
              )}
            </section>
            <aside>
              <div className="card">
                <h3>{t("工作詳情", "Task details")}</h3>
                <dl className="detail-list">
                  <dt>{t("工作方式", "Working mode")}</dt>
                  <dd>
                    {data.mode === "ask"
                      ? t("諮詢", "Ask")
                      : data.mode === "plan"
                        ? t("規劃", "Plan")
                        : t("執行", "Execute")}
                  </dd>
                  <dt>{t("預算預留", "Reserved budget")}</dt>
                  <dd>
                    <Money value={data.budget_micros} />
                  </dd>
                  <dt>{t("已結算用量", "Settled usage")}</dt>
                  <dd>
                    <Money value={data.charged_micros} />
                  </dd>
                  <dt>{t("輸入 / 輸出", "Input / output")}</dt>
                  <dd className="number">
                    {data.input_tokens} / {data.output_tokens}
                  </dd>
                </dl>
                <Link className="text-link" to="/app/assets">
                  {t("查看交付檔案", "View deliverable files")}
                  <ArrowUpRight size={15} />
                </Link>
              </div>
            </aside>
          </div>
          <TaskPlan key={data.id} task={data} />
          <section className="section-block">
            <div className="section-title">
              <h2>{t("工作記錄", "Activity")}</h2>
              <span className="muted small-text" role="status">
                {events.state === "live"
                  ? t("即時更新", "Live updates")
                  : events.state === "reconnecting"
                    ? t("重新連線中…", "Reconnecting…")
                    : events.state === "polling"
                      ? t("自動同步", "Auto sync")
                      : t("同步工作記錄", "Syncing activity")}
              </span>
            </div>
            <ErrorNotice error={events.error} />
            <div className="timeline">
              {events.data?.items
                .filter(
                  (e: any) =>
                    !["message.delta", "message.appended"].includes(e.kind),
                )
                .map((e: any) => (
                  <div key={e.id}>
                    <span className="timeline-dot" />
                    <strong>{activityLabel(e)}</strong>
                    <DateText value={e.created_at} />
                  </div>
                ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}
function AssetPreview({ asset, base }: { asset: any; base: string }) {
  const ref = useRef<HTMLDivElement>(null),
    [src, setSrc] = useState("");
  useEffect(() => {
    let live = true,
      started = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((e) => e.isIntersecting) &&
          !started &&
          asset.mime_type === "image/png"
        ) {
          started = true;
          void api(base + "/assets/" + asset.id + "/thumbnail")
            .then((r) => {
              if (live) setSrc("data:image/png;base64," + r.base64);
            })
            .catch(() => {});
        }
      },
      { rootMargin: "100px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [asset.id, asset.current_version, base]);
  return (
    <div ref={ref} className="thumbnail-mount">
      {src ? (
        <img src={src} alt={asset.name} />
      ) : asset.mime_type?.startsWith("image/") ? (
        <Image size={38} strokeWidth={1} />
      ) : (
        <FileText size={38} strokeWidth={1} />
      )}
    </div>
  );
}
function Assets() {
  const { t } = useI18n(),
    w = useWorkspace(),
    [refresh, setRefresh] = useState(0),
    [upload, setUpload] = useState(false),
    [versions, setVersions] = useState<any>(null),
    [deleting, setDeleting] = useState<any>(null),
    [err, setErr] = useState<Error | null>(null);
  const { data, error, loading } = useData(w.base + "/assets", refresh);
  const history = useData(
    versions ? w.base + "/assets/" + versions.id + "/versions" : null,
    refresh,
  );
  return (
    <>
      <PageHeader
        eyebrow="EVERY VERSION HAS A PLACE."
        title={t("素材與交付", "Assets & deliverables")}
        description={t(
          "素材和交付預設保留 90 天，新增版本會延長保留時間。到期後進入永久清理；請及時下載需要長期保存的檔案。",
          "Materials and deliverables are retained for 90 days; a new version renews retention. Expired files enter permanent cleanup. Download files you need to keep.",
        )}
        action={
          <button className="button primary" onClick={() => setUpload(true)}>
            <Upload size={17} />
            {t("加入素材", "Upload material")}
          </button>
        }
      />
      <ErrorNotice error={error ?? err} />
      {loading ? (
        <Loading />
      ) : data?.items.length ? (
        <div className="asset-grid">
          {data.items.map((a: any) => (
            <article className="card asset-card" key={a.id}>
              <div className="asset-preview">
                <AssetPreview asset={a} base={w.base} />
                <span className="file-extension">
                  {a.name.split(".").pop()}
                </span>
              </div>
              <h3>{a.name}</h3>
              <p className="muted small-text">
                {a.private_owner
                  ? t("私人交付 · 僅自己可見", "Private deliverable · only you")
                  : t("專案共用", "Shared with project")}
              </p>
              <p className="muted small-text">
                v{a.current_version} · {(Number(a.bytes) / 1024).toFixed(1)} KB
              </p>
              {a.retention_expires_at && (
                <p className="muted small-text">
                  {t("保留至：", "Retained until: ")}
                  {new Date(a.retention_expires_at).toLocaleString(
                    t("zh-HK", "en-HK"),
                    { timeZone: "Asia/Hong_Kong" },
                  )}{" "}
                  HKT
                </p>
              )}
              <div className="row-actions">
                <button
                  className="text-button"
                  onClick={() =>
                    void download(
                      w.base + "/assets/" + a.id + "/download",
                      a.name,
                    ).catch(setErr)
                  }
                >
                  <Download size={15} />
                  {t("下載", "Download")}
                </button>
                <button className="text-button" onClick={() => setVersions(a)}>
                  <Clock size={15} />
                  {t("版本", "Versions")}
                </button>
                <button className="text-button" onClick={() => setDeleting(a)}>
                  {t("刪除", "Delete")}
                </button>
                {a.private_owner && (
                  <button
                    className="text-button"
                    onClick={() => {
                      if (
                        window.confirm(
                          t(
                            "將這一版檔案複製到專案，讓有權限的成員使用？",
                            "Copy this file version into the project for authorized members?",
                          ),
                        )
                      )
                        void post(w.base + "/assets/" + a.id + "/publish", {
                          name: a.name,
                          expected_version: a.current_version,
                        })
                          .then(() => setRefresh((v) => v + 1))
                          .catch(setErr);
                    }}
                  >
                    <ArrowUpRight size={15} />
                    {t("發佈到專案", "Publish to project")}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={Image}
          title={t(
            "為好工作，備好素材。",
            "Good work starts with good materials.",
          )}
          body={t(
            "加入品牌、圖片、文件或 CSV。工作成果也會保存在這裡。",
            "Add your brand, images, documents or CSV files. Deliverables will live here too.",
          )}
          action={
            <button
              className="button secondary"
              onClick={() => setUpload(true)}
            >
              {t("加入第一份素材", "Add your first material")}
            </button>
          }
        />
      )}{" "}
      <DeletionProgress refresh={refresh} />
      {deleting && (
        <DeleteAsset
          asset={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => setRefresh((v) => v + 1)}
        />
      )}
      {upload && (
        <Modal
          title={t("加入素材", "Upload material")}
          onClose={() => setUpload(false)}
        >
          <ResumableUpload
            onDone={() => {
              setRefresh((v) => v + 1);
              setUpload(false);
            }}
          />
        </Modal>
      )}
      {versions && (
        <Modal title={versions.name} onClose={() => setVersions(null)}>
          <ErrorNotice error={history.error} />
          {history.data?.items.map((v: any) => (
            <div className="version-row" key={v.id}>
              <strong>v{v.version}</strong>
              <DateText value={v.created_at} />
              <span>{(Number(v.bytes) / 1024).toFixed(1)} KB</span>
              <button
                className="icon-button"
                aria-label="Download version"
                onClick={() =>
                  void download(
                    w.base +
                      "/assets/" +
                      versions.id +
                      "/download?version=" +
                      v.version,
                    versions.name,
                  ).catch(setErr)
                }
              >
                <Download size={17} />
              </button>
            </div>
          ))}
          <ResumableUpload
            asset={versions}
            onDone={() => {
              setVersions(null);
              setRefresh((v) => v + 1);
            }}
          />
        </Modal>
      )}
    </>
  );
}
function Creative() {
  const { t } = useI18n(),
    w = useWorkspace(),
    [refresh, setRefresh] = useState(0),
    [open, setOpen] = useState(false),
    [editing, setEditing] = useState<any>(null),
    [image, setImage] = useState("");
  const { data, error } = useData(w.base + "/creative", refresh);
  const assets = useData(w.base + "/assets", refresh);
  const selectedImage = assets.data?.items.find((a: any) => a.id === image);
  const [title, setTitle] = useState("Make room for possibility."),
    [subtitle, setSubtitle] = useState("COPYPASTE · HONG KONG"),
    [background, setBackground] = useState("#F6F6F4"),
    [ink, setInk] = useState("#15171A");
  const body = {
    width: 1080,
    height: 1350,
    background,
    layers: [
      ...(selectedImage
        ? [
            {
              type: "image",
              asset_id: selectedImage.id,
              version: selectedImage.current_version,
              x: 80,
              y: 300,
              width: 920,
              height: 560,
            },
          ]
        : []),
      {
        type: "rect",
        x: 80,
        y: 90,
        width: 120,
        height: 8,
        color: "#1F5EFF",
        radius: 4,
      },
      {
        type: "text",
        text: subtitle,
        x: 80,
        y: 190,
        font_size: 24,
        color: ink,
        font_family: "sans",
        weight: "normal",
      },
      {
        type: "text",
        text: title,
        x: 80,
        y: 600,
        font_size: 68,
        color: ink,
        font_family: "serif",
        weight: "normal",
      },
      {
        type: "rect",
        x: 80,
        y: 1120,
        width: 920,
        height: 1,
        color: "#BFC3CC",
        radius: 0,
      },
      {
        type: "text",
        text: "A little space for what’s next.",
        x: 80,
        y: 1210,
        font_size: 28,
        color: ink,
        font_family: "sans",
        weight: "normal",
      },
    ],
  };
  return (
    <>
      <PageHeader
        eyebrow="MAKE IT YOURS."
        title={t("設計畫布", "Design canvas")}
        description={t(
          "建立文字與圖形分層的可編輯設計。精確保留品牌色、繁英文字和價格。",
          "Editable text and shape layers, with exact brand colors and copy.",
        )}
        action={
          <button className="button primary" onClick={() => setOpen(true)}>
            <Plus size={17} />
            {t("新建設計", "New design")}
          </button>
        }
      />
      <ErrorNotice error={error} />
      {data?.items.length ? (
        <div className="project-grid">
          {data.items.map((p: any) => (
            <article key={p.id} className="card project-card">
              <Layers size={26} />
              <h3>{p.name}</h3>
              <span className="muted design-canvas-version">
                {p.body.width} × {p.body.height} · v{p.version}
              </span>
              <button className="text-button" onClick={() => setEditing(p)}>
                {t("編輯分層工程", "Edit layered source")}
              </button>
              <DesignExports
                key={w.base + "/" + p.id + "/" + p.version}
                base={w.base}
                design={p}
                refresh={() => setRefresh((v) => v + 1)}
              />
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={Layers}
          title={t("文字與圖像，各就其位。", "Give every element its place.")}
          body={t(
            "從品牌海報開始，輸出保留文字、形狀和來源設計的 SVG。",
            "Start with a brand poster. Export SVG with editable text, shapes and a saved source project.",
          )}
          action={
            <button className="button secondary" onClick={() => setOpen(true)}>
              {t("建立第一個設計", "Create your first design")}
            </button>
          }
        />
      )}
      <p className="section-note">
        {t(
          "匯出檔案保存在「素材與交付」。PDF 為單頁圖片審閱稿；文字與圖層請在分層工程或 SVG 中編輯。",
          "Exports are saved in Assets & deliverables. PDF is a single-page raster review copy; edit text and layers in the source project or SVG.",
        )}
      </p>
      {editing && (
        <Modal
          title={t("編輯分層設計工程", "Edit layered design source")}
          onClose={() => setEditing(null)}
        >
          <AsyncForm
            submitLabel={t("儲存新版本", "Save new version")}
            onSubmit={async (f) => {
              await api(w.base + "/creative/" + editing.id, {
                method: "PUT",
                body: JSON.stringify({
                  name: String(f.get("name")),
                  body: JSON.parse(String(f.get("source"))),
                  version: editing.version,
                }),
              });
              setEditing(null);
              setRefresh((v) => v + 1);
            }}
          >
            <Field label={t("設計名稱", "Design name")}>
              <input name="name" defaultValue={editing.name} required />
            </Field>
            <Field
              label={t(
                "分層工程 JSON（文字／形狀／PNG 圖片）",
                "Layered JSON (text / shapes / PNG images)",
              )}
            >
              <textarea
                name="source"
                rows={16}
                defaultValue={JSON.stringify(editing.body, null, 2)}
                required
              />
            </Field>
          </AsyncForm>
        </Modal>
      )}
      {open && (
        <Modal
          title={t("建立品牌海報", "Create a brand poster")}
          onClose={() => setOpen(false)}
        >
          <AsyncForm
            submitLabel={t("儲存設計", "Save design")}
            onSubmit={async (f) => {
              await post(w.base + "/creative", {
                name: String(f.get("name")),
                body,
              });
              setOpen(false);
              setRefresh((v) => v + 1);
            }}
          >
            <Field label={t("設計名稱", "Design name")}>
              <input
                name="name"
                defaultValue={t("品牌宣傳海報", "Brand poster")}
                required
              />
            </Field>
            <Field label={t("主標題", "Headline")}>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={28}
                required
              />
            </Field>
            <Field label={t("品牌標識文字", "Brand line")}>
              <input
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                maxLength={70}
              />
            </Field>
            <Field
              label={t("專案 PNG 圖片（可選）", "Project PNG image (optional)")}
            >
              <select value={image} onChange={(e) => setImage(e.target.value)}>
                <option value="">
                  {t("純文字與形狀", "Text and shapes only")}
                </option>
                {assets.data?.items
                  .filter((a: any) => a.mime_type === "image/png")
                  .map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · v{a.current_version}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="two-columns">
              <Field label={t("背景色", "Background")}>
                <input
                  type="color"
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                />
              </Field>
              <Field label={t("文字色", "Text color")}>
                <input
                  type="color"
                  value={ink}
                  onChange={(e) => setInk(e.target.value)}
                />
              </Field>
            </div>
            <div className="poster-mini" style={{ background, color: ink }}>
              <div />
              {selectedImage && (
                <div className="poster-image">
                  <AssetPreview asset={selectedImage} base={w.base} />
                </div>
              )}
              <small>{subtitle}</small>
              <strong>{title}</strong>
              <footer>A little space for what’s next.</footer>
            </div>
          </AsyncForm>
        </Modal>
      )}
    </>
  );
}
function Analytics() {
  const { t } = useI18n(),
    w = useWorkspace(),
    [refresh, setRefresh] = useState(0),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState<any>(null),
    [seo, setSeo] = useState(false),
    [report, setReport] = useState<any>(null),
    [err, setErr] = useState<Error | null>(null);
  const { data, error, loading } = useData(w.base + "/analytics", refresh);
  const detail = useData(
    selected ? w.base + "/analytics/" + selected : null,
    refresh,
  );
  const d = detail.data ?? data?.items[0];
  return (
    <>
      <PageHeader
        eyebrow="FROM EVIDENCE TO YOUR NEXT MOVE."
        title={t("行銷分析", "Marketing insights")}
        description={t(
          "先看清數據，再作決定。每份報表保留幣種、時區和資料來源。",
          "Understand the evidence before the next decision. Currency, timezone and source stay with every report.",
        )}
        action={
          <div className="row-actions">
            <button className="button secondary" onClick={() => setSeo(true)}>
              SEO / GEO
            </button>
            <button className="button primary" onClick={() => setOpen(true)}>
              <Upload size={17} />
              {t("匯入數據", "Import data")}
            </button>
          </div>
        }
      />
      <ErrorNotice error={error ?? err} />
      {loading ? (
        <Loading />
      ) : data?.items.length ? (
        <>
          <div className="filter-row">
            <select
              value={selected ?? d?.id}
              onChange={(e) => setSelected(e.target.value)}
              aria-label="Dataset"
            >
              {data.items.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <span className="muted">
              {d?.currency} · {d?.timezone} · {d?.source}
            </span>
          </div>
          <div className="metrics-grid">
            {[
              [
                t("廣告花費", "Ad spend"),
                <Money
                  value={d?.summary.spend_micros}
                  currency={d?.currency}
                />,
              ],
              [
                t("點擊率", "Click-through rate"),
                d?.summary.ctr === null
                  ? "—"
                  : ((d?.summary.ctr ?? 0) * 100).toFixed(2) + "%",
              ],
              [
                t("每次轉換成本", "Cost per conversion"),
                d?.summary.cpa_micros === null ? (
                  "—"
                ) : (
                  <Money value={d?.summary.cpa_micros} currency={d?.currency} />
                ),
              ],
              [
                t("廣告回報", "Return on ad spend"),
                d?.summary.roas === null
                  ? "—"
                  : (d?.summary.roas ?? 0).toFixed(2) + "×",
              ],
            ].map(([label, value], i) => (
              <div className="metric-card" key={i}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>
                  {t("依總量計算", "Calculated from aggregate totals")}
                </small>
              </div>
            ))}
          </div>
          <section className="card">
            <div className="section-title">
              <h2>{t("資料集", "Datasets")}</h2>
              <button
                className="text-button"
                onClick={() =>
                  void download(
                    w.base + "/analytics/" + d?.id + "/export",
                    "analytics.csv",
                  ).catch(setErr)
                }
              >
                <Download size={16} />
                {t("匯出明細", "Export rows")}
              </button>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t("名稱", "Name")}</th>
                    <th>{t("筆數", "Rows")}</th>
                    <th>{t("幣種", "Currency")}</th>
                    <th>{t("點擊", "Clicks")}</th>
                    <th>{t("花費", "Spend")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r: any) => (
                    <tr key={r.id}>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setSelected(r.id)}
                        >
                          {r.name}
                        </button>
                      </td>
                      <td>{r.row_count}</td>
                      <td>{r.currency}</td>
                      <td>{r.summary.clicks.toLocaleString()}</td>
                      <td>
                        <Money
                          value={r.summary.spend_micros}
                          currency={r.currency}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <Empty
          icon={ChartNoAxesCombined}
          title={t(
            "讓數據，說清楚下一步。",
            "Let the numbers clarify what’s next.",
          )}
          body={t(
            "匯入 Google Ads、Meta 或網站數據 CSV，查看可以重算的核心指標。",
            "Import a campaign CSV from Google, Meta or your website to calculate reproducible metrics.",
          )}
          action={
            <button className="button secondary" onClick={() => setOpen(true)}>
              {t("匯入第一份數據", "Import your first dataset")}
            </button>
          }
        />
      )}{" "}
      {open && (
        <Modal
          title={t("匯入行銷數據", "Import campaign data")}
          onClose={() => setOpen(false)}
        >
          <AsyncForm
            submitLabel={t("匯入並分析", "Import & analyze")}
            onSubmit={async (f) => {
              const file = f.get("file") as File;
              await post(w.base + "/analytics/import", {
                name: String(f.get("name")),
                csv: await file.text(),
                timezone: "Asia/Hong_Kong",
              });
              setOpen(false);
              setRefresh((v) => v + 1);
            }}
          >
            <Field label={t("報表名稱", "Report name")}>
              <input name="name" required />
            </Field>
            <Field label="CSV">
              <input type="file" name="file" accept=".csv,text/csv" required />
            </Field>
            <div className="notice">
              <FileText size={18} />
              <div>
                {t("欄位格式", "Required columns")}
                <code className="block-code">
                  date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency
                </code>
                <small>
                  {t(
                    "金額使用元，日期 YYYY-MM-DD。每份資料集只能包含一種幣種。",
                    "Amounts use currency units; dates use YYYY-MM-DD. One currency per dataset.",
                  )}
                </small>
              </div>
            </div>
          </AsyncForm>
        </Modal>
      )}
      {seo && (
        <Modal
          title={t("SEO / GEO 頁面檢視", "SEO / GEO page review")}
          onClose={() => setSeo(false)}
        >
          <AsyncForm
            submitLabel={t("檢視頁面", "Review page")}
            onSubmit={async (f) => {
              const r = await post(w.base + "/seo/audit", {
                url: String(f.get("url")),
                html: String(f.get("html")),
              });
              setReport(r.report);
            }}
          >
            <Field label={t("頁面網址", "Page URL")}>
              <input type="url" name="url" required />
            </Field>
            <Field
              label={t("頁面 HTML 原始碼", "Page HTML source")}
              hint={t(
                "貼上你有權使用的頁面原始碼。",
                "Paste the source of a page you are authorized to review.",
              )}
            >
              <textarea name="html" rows={5} required />
            </Field>
          </AsyncForm>
          {report && (
            <div className="audit-results">
              {report.checks.map((c: any) => (
                <div key={c.key}>
                  <Badge value={c.pass ? "succeeded" : "failed"} />
                  <span>{c.key}</span>
                </div>
              ))}
              <p className="muted">{report.geo.note}</p>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
function Connections() {
  const { t } = useI18n(),
    w = useWorkspace(),
    [refresh, setRefresh] = useState(0),
    [err, setErr] = useState<Error | null>(null);
  const { data, error } = useData(w.base + "/connections", refresh);
  return (
    <>
      <PageHeader
        eyebrow="BRING YOUR WORK TOGETHER."
        title={t("連接應用", "Connections")}
        description={t(
          "由企業授權連接廣告及分析帳戶。你可以隨時撤銷存取。",
          "Connect your company’s advertising and analytics accounts. Revoke access whenever you need.",
        )}
      />
      <ErrorNotice error={error ?? err} />
      <div className="connection-grid">
        {(data?.providers ?? []).map((p: any) => {
          const connected = data.items.find(
            (c: any) => c.provider === p.key && c.state === "connected",
          );
          return (
            <article className="card connection-card" key={p.key}>
              <div className="connection-brand">
                <span>{p.name[0]}</span>
                <Badge value={connected ? "connected" : "pending"} />
              </div>
              <h2>{p.name}</h2>
              <p className="muted">
                {p.key === "ga4"
                  ? t(
                      "網站受眾、來源與轉換。",
                      "Audience, acquisition and conversions.",
                    )
                  : p.key === "search_console"
                    ? t(
                        "搜尋曝光、點擊與關鍵字。",
                        "Search impressions, clicks and queries.",
                      )
                    : t(
                        "廣告活動、花費與表現。",
                        "Campaigns, spend and performance.",
                      )}
              </p>
              {connected ? (
                <div className="row-actions">
                  <button
                    className="button secondary small"
                    onClick={() => {
                      const account = prompt(
                        t(
                          "輸入帳戶 / Property ID",
                          "Enter account / property ID",
                        ),
                      );
                      if (account)
                        void post(
                          w.base + "/connections/" + connected.id + "/report",
                          {
                            account_id: account,
                            start_date: new Date(Date.now() - 30 * 86400000)
                              .toISOString()
                              .slice(0, 10),
                            end_date: new Date().toISOString().slice(0, 10),
                          },
                        )
                          .then(() => setRefresh((v) => v + 1))
                          .catch(setErr);
                    }}
                  >
                    {t("同步報表", "Fetch report")}
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      void api(w.base + "/connections/" + connected.id, {
                        method: "DELETE",
                      })
                        .then(() => setRefresh((v) => v + 1))
                        .catch(setErr)
                    }
                  >
                    {t("撤銷", "Revoke")}
                  </button>
                </div>
              ) : (
                <button
                  className="button secondary"
                  onClick={() =>
                    void post(w.base + "/connections/authorize", {
                      provider: p.key,
                    })
                      .then((r) => window.location.assign(r.url))
                      .catch(setErr)
                  }
                >
                  {t("連接帳戶", "Connect account")}
                  <ArrowUpRight size={16} />
                </button>
              )}
              <small>
                {!p.configured
                  ? t("連接服務待企業設定", "Company connection setup required")
                  : t("由帳戶擁有人授權", "Authorized by account owner")}
              </small>
            </article>
          );
        })}
      </div>
    </>
  );
}
function Workflows() {
  const { t } = useI18n(),
    w = useWorkspace(),
    [refresh, setRefresh] = useState(0),
    [open, setOpen] = useState(false),
    [err, setErr] = useState<Error | null>(null);
  const { data, error } = useData(w.base + "/workflows", refresh, 5000);
  const datasets = useData(w.base + "/analytics");
  return (
    <>
      <PageHeader
        eyebrow="GOOD WORK, ON REPEAT."
        title={t("工作流程", "Workflows")}
        description={t(
          "把反覆工作整理成有步驟、有審批、可追蹤的流程。",
          "Turn repeatable work into a clear sequence, with review points and progress you can follow.",
        )}
        action={
          <button className="button primary" onClick={() => setOpen(true)}>
            <Plus size={17} />
            {t("建立流程", "Create workflow")}
          </button>
        }
      />
      <ErrorNotice error={error ?? err} />
      {data?.items.length ? (
        <div className="project-grid">
          {data.items.map((r: any) => (
            <article className="card project-card" key={r.id}>
              <Workflow size={25} />
              <h3>{r.name}</h3>
              <p>
                {r.definition.steps.length} {t("個步驟", "steps")} · v
                {r.version}
              </p>
              <Badge value={r.state} />
              <footer>
                <button
                  className="button secondary small"
                  onClick={() =>
                    void post(
                      w.base +
                        "/workflows/" +
                        r.id +
                        (r.state === "published" ? "/run" : "/publish"),
                    )
                      .then(() => setRefresh((v) => v + 1))
                      .catch(setErr)
                  }
                >
                  <Play size={15} />
                  {r.state === "published"
                    ? t("執行", "Run workflow")
                    : t("發佈", "Publish")}
                </button>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={Workflow}
          title={t(
            "重複的工作，可以更有條理。",
            "Give repeatable work a better rhythm.",
          )}
          body={t(
            "從「報表計算 → 人工審批」開始，保留每一步的結果。",
            "Start with “calculate report → review”. Keep the result of each step.",
          )}
          action={
            <button className="button secondary" onClick={() => setOpen(true)}>
              {t("建立第一個流程", "Create your first workflow")}
            </button>
          }
        />
      )}{" "}
      <Schedules workflows={data?.items ?? []} />
      {data?.runs?.length > 0 && (
        <section className="section-block">
          <h2>{t("執行記錄", "Workflow runs")}</h2>
          {data.runs.map((r: any) => (
            <div className="version-row workflow-run" key={r.id}>
              <code>{r.id.slice(0, 8)}</code>
              <span>
                {r.cursor} / {r.definition.steps.length}
              </span>
              <Badge value={r.state} />
              {["running", "awaiting_approval"].includes(r.state) && (
                <button
                  className="button secondary small"
                  onClick={() =>
                    void post(w.base + "/workflow-runs/" + r.id + "/cancel")
                      .then(() => setRefresh((v) => v + 1))
                      .catch(setErr)
                  }
                >
                  {t("取消這次執行", "Cancel this run")}
                </button>
              )}
              {r.state === "awaiting_approval" && (
                <button
                  className="button secondary small"
                  onClick={() =>
                    void post(w.base + "/workflow-runs/" + r.id + "/decision", {
                      decision: "approve",
                    })
                      .then(() => setRefresh((v) => v + 1))
                      .catch(setErr)
                  }
                >
                  {t("核准繼續", "Approve & continue")}
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {open && (
        <Modal
          title={t("建立報表工作流程", "Create a report workflow")}
          onClose={() => setOpen(false)}
        >
          <AsyncForm
            submitLabel={t("儲存流程", "Save workflow")}
            onSubmit={async (f) => {
              await post(w.base + "/workflows", {
                name: String(f.get("name")),
                definition: {
                  steps: [
                    {
                      kind: "analytics.summary",
                      dataset_id: String(f.get("dataset")),
                    },
                    {
                      kind: "approval",
                      message: "Review the calculated campaign report.",
                    },
                  ],
                },
              });
              setOpen(false);
              setRefresh((v) => v + 1);
            }}
          >
            <Field label={t("流程名稱", "Workflow name")}>
              <input
                name="name"
                defaultValue={t("行銷週報與審批", "Campaign report & review")}
                required
              />
            </Field>
            <Field label={t("使用資料集", "Source dataset")}>
              <select name="dataset" required>
                <option value="">{t("選擇資料集", "Select a dataset")}</option>
                {datasets.data?.items.map((d: any) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="workflow-steps">
              <div>
                <ChartNoAxesCombined size={18} />
                {t("計算報表並保存交付", "Calculate report & save deliverable")}
              </div>
              <ArrowRight size={16} />
              <div>
                <ShieldCheck size={18} />
                {t("等待成員審批", "Wait for review")}
              </div>
            </div>
          </AsyncForm>
        </Modal>
      )}
    </>
  );
}
function Brand() {
  const { t } = useI18n(),
    w = useWorkspace(),
    [refresh, setRefresh] = useState(0),
    [open, setOpen] = useState(false);
  const { data, error } = useData(w.base + "/brand", refresh);
  return (
    <>
      <PageHeader
        eyebrow="CONSISTENCY, BY DESIGN."
        title={t("品牌資料", "Brand library")}
        description={t(
          "把品牌色、語氣和已核准的文案，帶到每一份工作。",
          "Bring your colors, tone and approved copy into every piece of work.",
        )}
        action={
          <button className="button primary" onClick={() => setOpen(true)}>
            <Plus size={17} />
            {t("加入品牌", "Add brand")}
          </button>
        }
      />
      <ErrorNotice error={error} />
      {data?.items.length ? (
        <div className="project-grid">
          {data.items.map((b: any) => (
            <article key={b.id} className="card">
              <div className="brand-colors">
                {b.body.colors.map((c: string) => (
                  <span key={c} style={{ background: c }} title={c} />
                ))}
              </div>
              <h2>{b.name}</h2>
              <p>{b.body.tone}</p>
              <p className="muted preserve-text">{b.body.approved_copy}</p>
              <span className="small-text">v{b.version}</span>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={BookOpen}
          title={t("讓品牌，每次都像你。", "Make every piece feel like you.")}
          body={t(
            "品牌資料可以隨時加入，不影響你先開始工作。",
            "Add brand guidance whenever you’re ready. You can start working before it’s complete.",
          )}
        />
      )}{" "}
      {open && (
        <Modal
          title={t("加入品牌資料", "Add brand guidance")}
          onClose={() => setOpen(false)}
        >
          <AsyncForm
            submitLabel={t("儲存品牌", "Save brand")}
            onSubmit={async (f) => {
              await post(w.base + "/brand", {
                name: String(f.get("name")),
                colors: String(f.get("colors"))
                  .split(",")
                  .map((s) => s.trim()),
                tone: String(f.get("tone")),
                approved_copy: String(f.get("copy")),
                fonts: [],
              });
              setOpen(false);
              setRefresh((v) => v + 1);
            }}
          >
            <Field label={t("品牌名稱", "Brand name")}>
              <input name="name" required />
            </Field>
            <Field
              label={t("品牌色（以逗號分隔）", "Colors (comma separated)")}
            >
              <input
                name="colors"
                defaultValue="#1F5EFF, #F6F6F4, #15171A"
                required
              />
            </Field>
            <Field label={t("語氣與風格", "Tone & style")}>
              <textarea name="tone" rows={3} required />
            </Field>
            <Field label={t("已核准文案", "Approved copy")}>
              <textarea name="copy" rows={3} />
            </Field>
          </AsyncForm>
        </Modal>
      )}
    </>
  );
}
function Members() {
  const { t } = useI18n(),
    w = useWorkspace(),
    [refresh, setRefresh] = useState(0),
    [open, setOpen] = useState(false),
    [link, setLink] = useState(""),
    [editing, setEditing] = useState<any>(null);
  const { data, error } = useData(`/v1/tenants/${w.tenant}/members`, refresh);
  return (
    <>
      <PageHeader
        eyebrow="THE PEOPLE BEHIND THE WORK."
        title={t("成員與權限", "Members & access")}
        description={t(
          "按企業與專案授予存取權，讓每個人看到合適的內容。",
          "Give people the access they need, at workspace and project level.",
        )}
        action={
          <button className="button primary" onClick={() => setOpen(true)}>
            <Plus size={17} />
            {t("邀請成員", "Invite a member")}
          </button>
        }
      />
      <ErrorNotice error={error} />
      <div className="card table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("成員", "Member")}</th>
              <th>{t("郵箱", "Email")}</th>
              <th>{t("角色", "Role")}</th>
              <th>{t("狀態", "Status")}</th>
              <th>{t("管理", "Manage")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((m: any) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{m.email}</td>
                <td>{m.role}</td>
                <td>
                  <Badge value={m.status} />
                </td>
                <td>
                  <button className="text-button" onClick={() => setEditing(m)}>
                    {t("修改權限", "Edit access")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <Modal
          title={t("修改成員權限", "Edit member access")}
          onClose={() => setEditing(null)}
        >
          <AsyncForm
            submitLabel={t("儲存權限", "Save access")}
            onSubmit={async (f) => {
              await patch(
                `/v1/tenants/${w.tenant}/members/${editing.user_id ?? editing.id}`,
                {
                  role: String(f.get("role")),
                  status: String(f.get("status")),
                  version: editing.version,
                  project_ids: f.getAll("projects").map(String),
                },
              );
              setEditing(null);
              setRefresh((v) => v + 1);
            }}
          >
            <Field label={t("企業角色", "Workspace role")}>
              <select name="role" defaultValue={editing.role}>
                {["owner", "admin", "member", "approver", "viewer"].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
            <Field label={t("狀態", "Status")}>
              <select name="status" defaultValue={editing.status}>
                {["active", "removed"].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
            <Field
              label={t("授權專案（可複選）", "Authorized projects (multiple)")}
            >
              <select
                multiple
                name="projects"
                defaultValue={editing.project_ids ?? []}
              >
                {w.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </AsyncForm>
        </Modal>
      )}
      {open && (
        <Modal
          title={t("邀請成員", "Invite a member")}
          onClose={() => {
            setOpen(false);
            setLink("");
          }}
        >
          <AsyncForm
            submitLabel={t("發送邀請", "Send invitation")}
            onSubmit={async (f) => {
              const r = await post(`/v1/tenants/${w.tenant}/invites`, {
                email: String(f.get("email")),
                role: String(f.get("role")),
                project_ids: [w.project],
              });
              setLink(r.invite_url);
              setRefresh((v) => v + 1);
            }}
          >
            <Field label={t("郵箱", "Email")}>
              <input type="email" name="email" required />
            </Field>
            <Field label={t("企業角色", "Workspace role")}>
              <select name="role" defaultValue="member">
                <option value="member">Member</option>
                <option value="approver">Approver</option>
                <option value="viewer">Viewer</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <p className="muted small-text">
              {t(
                "邀請會包含目前專案的權限，有效期 7 天。",
                "The invite includes the current project and expires in 7 days.",
              )}
            </p>
          </AsyncForm>
          {link && (
            <div className="notice">
              <div>
                {t("邀請已建立", "Invitation created")}
                <input
                  aria-label="Invitation link"
                  value={link}
                  readOnly
                  onFocus={(e) => e.target.select()}
                />
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
function Devices() {
  const { t } = useI18n(),
    w = useWorkspace(),
    [refresh, setRefresh] = useState(0),
    [err, setErr] = useState<Error | null>(null),
    [scheduled, setScheduled] = useState<any>(null),
    [device, setDevice] = useState<any>(null);
  const { data, error } = useData(`/v1/tenants/${w.tenant}/devices`, refresh);
  const commandStatus = useData(
    scheduled
      ? `/v1/tenants/${w.tenant}/devices/${scheduled.device_id}/commands/${scheduled.id}`
      : null,
    0,
    3000,
  );
  return (
    <>
      <PageHeader
        eyebrow="YOUR FILES, WITH YOUR PERMISSION."
        title={t("裝置與檔案", "Devices & files")}
        description={t(
          "本機檔案按你授權的目錄、操作及時效使用。",
          "Local files stay within the folders, actions and time periods you authorize.",
        )}
      />
      <ErrorNotice error={error ?? err} />
      {scheduled && (
        <section className="card section-block">
          <strong>{t("雲端排程結果", "Cloud command result")}</strong>
          <Badge value={commandStatus.data?.state ?? scheduled.state} />
          <pre className="output-text">
            {JSON.stringify(commandStatus.data?.result ?? {}, null, 2)}
          </pre>
          <button className="text-button" onClick={() => setScheduled(null)}>
            {t("關閉", "Close")}
          </button>
        </section>
      )}
      {device && (
        <Modal
          title={t("排程限定檔案操作", "Schedule bounded file action")}
          onClose={() => setDevice(null)}
        >
          <AsyncForm
            submitLabel={t("確認排程", "Confirm scheduling")}
            onSubmit={async (f) => {
              const operation = String(f.get("operation"));
              const result = await post(
                `/v1/tenants/${w.tenant}/devices/${device.id}/commands`,
                {
                  operation,
                  grant_id: String(f.get("grant")),
                  path: String(f.get("path")),
                  ...(operation === "file.write"
                    ? { content: String(f.get("content")) }
                    : {}),
                },
              );
              setScheduled(result);
              setDevice(null);
            }}
          >
            <Field label={t("資料夾授權", "Folder grant")}>
              <select name="grant">
                {device.grants.map((g: any) => (
                  <option key={g.id} value={g.id}>
                    {g.label ?? g.id} · {g.operations.join(", ")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("操作", "Action")}>
              <select name="operation">
                {["file.list", "file.read", "file.write"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label={t("相對路徑", "Relative path")}>
              <input name="path" defaultValue="." required />
            </Field>
            <Field
              label={t(
                "新檔內容（僅建立檔案時）",
                "New file content (create only)",
              )}
            >
              <textarea name="content" rows={3} />
            </Field>
            <p className="muted">
              {t(
                "操作兩分鐘後失效，裝置必須在線。檔案讀取結果會傳回目前企業。",
                "Commands expire after two minutes and require the device online. Read results return to this workspace.",
              )}
            </p>
          </AsyncForm>
        </Modal>
      )}

      <NativeFiles onChange={() => setRefresh((v) => v + 1)} />
      {data?.items.length ? (
        <div className="project-grid">
          {data.items.map((d: any) => (
            <article className="card" key={d.id}>
              <Monitor size={25} />
              <h3>{d.name}</h3>
              <Badge value={d.state} />
              {d.state === "active" && d.grants.length > 0 && (
                <button
                  className="button secondary small"
                  onClick={() => setDevice(d)}
                >
                  {t("排程檔案操作", "Schedule file action")}
                </button>
              )}
              <p className="muted">
                {d.client} · {d.grants.length} {t("項授權", "grants")}
              </p>
              <button
                className="text-button"
                onClick={() =>
                  void api(`/v1/tenants/${w.tenant}/devices/${d.id}`, {
                    method: "DELETE",
                  })
                    .then(() => setRefresh((v) => v + 1))
                    .catch(setErr)
                }
              >
                {t("撤銷裝置", "Revoke device")}
              </button>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={Monitor}
          title={t(
            "把本機工作也連接起來",
            "Bring local work into the picture.",
          )}
          body={t(
            "透過 Chrome 擴展或 Desktop 登入，再主動選擇檔案或授權目錄。",
            "Sign in through the Chrome extension or Desktop, then choose files or grant a folder.",
          )}
        />
      )}
    </>
  );
}

function Usage() {
  const { t } = useI18n(),
    w = useWorkspace();
  const usage = useData(`/v1/tenants/${w.tenant}/usage`),
    billing = useData(`/v1/tenants/${w.tenant}/billing`),
    plan = useData(`/v1/tenants/${w.tenant}/plan`);
  return (
    <>
      <PageHeader
        eyebrow="CLEAR USAGE. CONSIDERED WORK."
        title={t("用量與方案", "Usage & plan")}
        description={t(
          "清楚查看實際消耗、已預留額度和目前有效權益。",
          "See measured usage, reserved credit and your currently effective plan.",
        )}
      />
      <ErrorNotice error={usage.error} />
      <div className="metrics-grid">
        <div className="metric-card">
          <span>{t("累計用量", "Measured usage")}</span>
          <strong>
            <Money value={usage.data?.totals.charged_micros} />
          </strong>
          <small>{t("已結算工作", "Settled tasks")}</small>
        </div>
        <div className="metric-card">
          <span>{t("已建立工作", "Tasks created")}</span>
          <strong>{usage.data?.totals.tasks ?? 0}</strong>
          <small>{t("目前企業範圍", "Current workspace scope")}</small>
        </div>
        <div className="metric-card">
          <span>{t("已預留額度", "Reserved credit")}</span>
          <strong>
            <Money value={billing.data?.wallet.reserved_micros} />
          </strong>
          <small>
            {t("執行中的工作預算", "Budgets held for active tasks")}
          </small>
        </div>
        <div className="metric-card">
          <span>{t("可用餘額", "Available balance")}</span>
          <strong>
            <Money
              value={
                billing.data
                  ? Number(billing.data.wallet.balance_micros) +
                    Number(billing.data.wallet.credit_limit_micros) -
                    Number(billing.data.wallet.reserved_micros)
                  : 0
              }
            />
          </strong>
          <small>{t("含獲批信用額度", "Includes approved credit limit")}</small>
        </div>
      </div>
      <section className="card plan-card">
        <div>
          <span className="eyebrow">YOUR EFFECTIVE PLAN</span>
          <h2>{plan.data?.body.name ?? "Starter"}</h2>
          <p className="muted">
            {t(
              "企業與個人權益會按目前有效期限合併判定。VIP 不會增加帳戶餘額。",
              "Active personal and workspace grants determine your plan. VIP does not add wallet credit.",
            )}
          </p>
          <p>
            {t("未完成工作上限", "Active task limit")}:{" "}
            {plan.data?.body.max_active_tasks ?? "—"} ·{" "}
            {t("單次預算上限", "Task budget limit")}:{" "}
            <Money value={plan.data?.body.max_task_budget_micros} />
          </p>
          <p className="muted">
            {t(
              "排隊、待補資料和待核對的工作也計入上限。實際執行另受企業共用名額與服務容量限制；排隊時不會呼叫模型。",
              "Queued work, missing inputs and reconciliation count toward this limit. Execution also depends on shared workspace slots and service capacity; queued work makes no model call.",
            )}
          </p>
        </div>
        {plan.data?.ends_at && <DateText value={plan.data.ends_at} />}
      </section>
      {billing.error ? (
        <div className="notice">
          {t(
            "詳細帳務由企業 Owner 或 Admin 管理。",
            "Detailed billing is managed by your workspace owner or admin.",
          )}
        </div>
      ) : (
        <>
          <section className="section-block">
            <div className="section-title">
              <h2>{t("費用記錄", "Billing activity")}</h2>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t("類型", "Type")}</th>
                    <th>{t("金額", "Amount")}</th>
                    <th>{t("說明", "Reason")}</th>
                    <th>{t("時間", "Date")}</th>
                  </tr>
                </thead>
                <tbody>
                  {billing.data?.ledger.map((l: any) => (
                    <tr key={l.id}>
                      <td>{l.kind}</td>
                      <td>
                        <Money value={l.amount_micros} />
                      </td>
                      <td>{l.reason}</td>
                      <td>
                        <DateText value={l.created_at} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!billing.data?.ledger.length && (
              <Empty
                title={t("還沒有費用記錄", "No billing activity yet")}
                body={t(
                  "充值、贈送和實際消耗會在這裡逐筆顯示。",
                  "Top-ups, gifts and measured usage will appear here as separate entries.",
                )}
              />
            )}
          </section>
        </>
      )}
    </>
  );
}
function SettingsPage() {
  const { t } = useI18n(),
    w = useWorkspace(),
    [refresh, setRefresh] = useState(0);
  const sessions = useData("/v1/me/sessions", refresh);
  return (
    <>
      <PageHeader
        eyebrow="A WORKSPACE THAT FEELS LIKE YOU."
        title={t("帳戶設定", "Account settings")}
      />
      <div className="settings-grid">
        <LinkedCompanyIdentities />
        <section className="card">
          <h2>{t("個人資料", "Profile")}</h2>
          <AsyncForm
            submitLabel={t("儲存變更", "Save changes")}
            onSubmit={async (f) => {
              await patch("/v1/me", { name: String(f.get("name")) });
              await w.refresh();
            }}
          >
            <Field label={t("顯示名稱", "Display name")}>
              <input name="name" defaultValue={w.me.user.name} required />
            </Field>
            <Field label={t("登入郵箱", "Sign-in email")}>
              <input value={w.me.user.email} readOnly />
            </Field>
          </AsyncForm>
        </section>
        <section className="card">
          <h2>{t("登入中的裝置", "Active sessions")}</h2>
          <ErrorNotice error={sessions.error} />
          {sessions.data?.items.map((s: any) => (
            <div className="session-row" key={s.id}>
              <Monitor size={19} />
              <div>
                <strong>
                  {s.audience === "native" ? "Native client" : "Web browser"}
                </strong>
                <small>
                  <DateText value={s.created_at} />
                </small>
              </div>
              <button
                className="text-button"
                onClick={() =>
                  void api("/v1/me/sessions/" + s.id, {
                    method: "DELETE",
                  }).then(async () => {
                    setRefresh((v) => v + 1);
                    await w.refresh();
                  })
                }
              >
                {t("撤銷", "Revoke")}
              </button>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
