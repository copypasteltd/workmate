import { clientFailureMessage } from "./client-failure";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useId,
  cloneElement,
  isValidElement,
  type ReactNode,
  type ReactElement,
  type FormEvent,
} from "react";
import {
  X,
  LoaderCircle,
  AlertCircle,
  ArrowUpRight,
  Check,
  Plus,
  Sun,
  Moon,
  Globe2,
} from "lucide-react";
import { api } from "./api";
let modalBodyLocks = 0;
let previousBodyOverflow = "";
export type Locale = "zh-HK" | "en";
const I18n = createContext({
  locale: "zh-HK" as Locale,
  setLocale: (_: Locale) => {},
  t: (zh: string, en: string) => zh,
});
export function Preferences({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(
    localStorage.getItem("cp_locale") === "en" ? "en" : "zh-HK",
  );
  const [theme, setTheme] = useState(
    localStorage.getItem("cp_theme") ?? "system",
  );
  useEffect(() => {
    localStorage.setItem("cp_locale", locale);
    document.documentElement.lang = locale === "en" ? "en" : "zh-Hant-HK";
  }, [locale]);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === "system" ? (mq.matches ? "dark" : "light") : theme);
    apply();
    localStorage.setItem("cp_theme", theme);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  return (
    <I18n.Provider
      value={{ locale, setLocale, t: (zh, en) => (locale === "en" ? en : zh) }}
    >
      <div className="preference-controls">
        <button
          className="icon-button"
          title={locale === "en" ? "切換至繁體中文" : "Switch to English"}
          onClick={() => setLocale(locale === "en" ? "zh-HK" : "en")}
        >
          <Globe2 size={17} />
          <span>{locale === "en" ? "EN" : "繁"}</span>
        </button>
        <button
          className="icon-button"
          title="Theme: light / dark / system"
          onClick={() =>
            setTheme(
              theme === "light"
                ? "dark"
                : theme === "dark"
                  ? "system"
                  : "light",
            )
          }
        >
          {theme === "dark" ? <Moon size={17} /> : <Sun size={17} />}
          <span className="sr-only">{theme}</span>
        </button>
      </div>
      {children}
    </I18n.Provider>
  );
}
export const useI18n = () => useContext(I18n);
export function useData<T = any>(
  url: string | null,
  refresh = 0,
  interval = 0,
  tenant = "",
  options: { retainOnRefresh?: boolean } = {},
) {
  const scopedUrl = tenant ? tenant + ":" + url : url;
  const priorScope = useRef(scopedUrl);
  const retainOnRefresh = options.retainOnRefresh === true;
  const [data, setData] = useState<T | null>(null),
    [loadedUrl, setLoadedUrl] = useState<string | null>(null),
    [error, setError] = useState<Error | null>(null),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    // Keep interactive children mounted only for a refresh of this same scope.
    // Route/tenant changes and failed reads must still clear prior content.
    if (!retainOnRefresh || priorScope.current !== scopedUrl) setData(null);
    priorScope.current = scopedUrl;
    setError(null);
    if (!url)
      return () => {
        live = false;
      };
    const load = async () => {
      try {
        if (live) setLoading(true);
        const d = await api<T>(url, {
          signal: ctrl.signal,
          ...(tenant ? { headers: { "X-Tenant-ID": tenant } } : {}),
        });
        if (live) {
          setData(d);
          setLoadedUrl(scopedUrl);
          setError(null);
        }
      } catch (e) {
        if (live && !(e instanceof DOMException && e.name === "AbortError")) {
          setData(null);
          setError(e as Error);
        }
      } finally {
        if (live) setLoading(false);
        if (live && interval) timer = setTimeout(load, interval);
      }
    };
    void load();
    return () => {
      live = false;
      ctrl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [url, refresh, interval, tenant, retainOnRefresh]);
  return { data: loadedUrl === scopedUrl ? data : null, error, loading };
}
export function ErrorNotice({ error }: { error: unknown }) {
  const { t, locale } = useI18n();
  if (!error) return null;
  const friendly = clientFailureMessage(error, locale);
  return (
    <div className="notice error" role="alert">
      <AlertCircle size={19} />
      <div>
        {friendly ?? (error instanceof Error ? error.message : String(error))}
        {(error as any)?.details?.length > 0 && (
          <ul>
            {(error as any).details.map((d: any, i: number) => (
              <li key={i}>
                {d.path}: {d.message}
              </li>
            ))}
          </ul>
        )}
        {!friendly && <small>
          {t(
            "請檢查資料或稍後再試。",
            "Check your input or try again shortly.",
          )}
        </small>}
      </div>
    </div>
  );
}
export function Loading() {
  const { t } = useI18n();
  return (
    <div className="loading" role="status">
      <LoaderCircle size={20} className="spin" />
      {t("正在載入…", "Loading…")}
    </div>
  );
}
export function Empty({
  icon: Icon = Plus,
  title,
  body,
  action,
}: {
  icon?: any;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={27} strokeWidth={1.5} />
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    if (modalBodyLocks++ === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key === "Tab") {
        const dialog = document.querySelector('[role="dialog"]');
        const list = dialog?.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,[tabindex="0"]',
        );
        if (!list?.length) return;
        const first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(
          '[role="dialog"] input,[role="dialog"] button',
        )
        ?.focus(),
    );
    return () => {
      document.removeEventListener("keydown", key);
      if (--modalBodyLocks === 0)
        document.body.style.overflow = previousBodyOverflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Badge({ value }: { value: string }) {
  const labels: Record<string, [string, string]> = {
    active: ["有效", "Active"],
    connected: ["已連接", "Connected"],
    pending: ["待處理", "Pending"],
    queued: ["排隊中", "Queued"],
    cleaning: ["清理中", "Cleaning"],
    completed: ["清理完成", "Cleanup completed"],
    completed_with_exceptions: ["部分項目需處理", "Completed with exceptions"],
    running: ["進行中", "Running"],
    succeeded: ["已完成", "Completed"],
    failed: ["未完成", "Failed"],
    cancelled: ["已取消", "Cancelled"],
    reconciling: ["待對帳", "Reconciling"],
    suspended: ["已暫停", "Suspended"],
    expired: ["已到期", "Expired"],
    scheduled: ["預約生效", "Scheduled"],
    replaced: ["已取代", "Replaced"],
    quarantined: ["已隔離", "Quarantined"],
    draft: ["草稿", "Draft"],
    published: ["已發佈", "Published"],
    awaiting_approval: ["待審批", "Awaiting approval"],
    waiting_approval: ["待審批", "Awaiting approval"],
    needs_input: ["需要補充資料", "Needs input"],
    partially_succeeded: ["部分完成", "Partially completed"],
    accepted: ["已驗收", "Accepted"],
    revoked: ["已撤銷", "Revoked"],
    paused: ["已暫停", "Paused"],
    blocked: ["需重新確認", "Needs review"],
    ended: ["已到期", "Ended"],
    retired: ["已停止", "Retired"],
    launched: ["已觸發", "Triggered"],
    skipped_overlap: ["前次未結束，已略過", "Skipped: prior run active"],
    skipped_missed: ["漏跑已略過", "Missed time skipped"],
    skipped_dst: ["不存在的時刻，已略過", "Nonexistent time skipped"],
  };
  const { t } = useI18n();
  return (
    <span className={`badge status-${value}`}>
      <span />
      {labels[value] ? t(...labels[value]) : value.replaceAll("_", " ")}
    </span>
  );
}
export function Money({
  value,
  currency = "HKD",
}: {
  value: any;
  currency?: string;
}) {
  const n = Number(value ?? 0) / 1_000_000;
  return (
    <span className="number">
      {new Intl.NumberFormat("en-HK", {
        style: "currency",
        currency,
        maximumFractionDigits: n !== 0 && Math.abs(n) < 0.01 ? 6 : 2,
      }).format(n)}
    </span>
  );
}
export function DateText({ value }: { value: any }) {
  return (
    <span className="number">
      {value
        ? new Date(value).toLocaleString("en-HK", {
            dateStyle: "medium",
            timeStyle: "short",
          })
        : "—"}
    </span>
  );
}
export function AsyncForm({
  onSubmit,
  children,
  submitLabel,
  submitDisabled = false,
}: {
  onSubmit: (form: FormData) => Promise<void>;
  children: ReactNode;
  submitLabel: string;
  submitDisabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [done, setDone] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || submitDisabled) return;
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await onSubmit(form);
      setDone(true);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      {children}
      <ErrorNotice error={error} />
      {done && (
        <p className="success-line" role="status">
          <Check size={16} />
          已儲存 / Saved
        </p>
      )}
      <button
        className="button primary"
        type="submit"
        disabled={busy || submitDisabled}
      >
        {busy ? <LoaderCircle size={17} className="spin" /> : null}
        {submitLabel}
        {!busy && <ArrowUpRight size={17} />}
      </button>
    </form>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const hintId = useId();
  const control = isValidElement(children)
    ? cloneElement(
        children as ReactElement<{
          "aria-label"?: string;
          "aria-describedby"?: string;
        }>,
        {
          "aria-label": label,
          ...(hint ? { "aria-describedby": hintId } : {}),
        },
      )
    : children;
  return (
    <label className="field">
      <span>{label}</span>
      {control}
      {hint && <small id={hintId}>{hint}</small>}
    </label>
  );
}
