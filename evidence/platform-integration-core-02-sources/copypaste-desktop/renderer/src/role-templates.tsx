import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  Code2,
  Palette,
  Sparkles,
  Workflow,
  ChartNoAxesCombined,
  RefreshCw,
} from "lucide-react";
import { api, ApiError } from "./api";
import { useWorkspace } from "./context";
import { RoleBrandVersion } from "./role-brand-version";
import {
  DateText,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  Modal,
  useI18n,
} from "./ui";

export const roleEnglish: Record<string, string> = {
  assistant: "Default assistant",
  fullstack: "Full-stack engineer",
  frontend: "Frontend engineer",
  "backend-api": "Backend & API engineer",
  "software-qa": "Quality engineer",
  "ui-ux": "UI / UX designer",
  designer: "Designer",
  "brand-visual": "Brand designer",
  "ad-creative": "Ad creative designer",
  ecommerce: "E-commerce designer",
  "social-content": "Social content designer",
  "illustration-ip": "Illustrator & IP designer",
  "typography-layout": "Typography designer",
  presentation: "Presentation designer",
  "landing-page": "Landing page designer",
  "information-design": "Information designer",
  "video-motion": "Video & motion designer",
  "marketing-analyst": "Marketing analyst",
  "workflow-consultant": "Workflow consultant",
};
const examplesEnglish: Record<string, string> = {
  assistant:
    "Prepare an evidence-based written answer from authorized materials.",
  fullstack:
    "Build a small workspace with customer sign-in, file uploads and review status.",
  frontend: "Turn an approved design into a responsive customer portal.",
  "backend-api": "Add a tested API to an existing website.",
  "software-qa": "Test a lead form and its data reporting workflow.",
  "ui-ux":
    "Design the journey from receiving a brief to approving the final deliverables.",
  designer:
    "Create a bilingual campaign visual and posters in multiple sizes from approved product and brand materials.",
  "brand-visual":
    "Create a visual direction and opening materials for a Hong Kong café.",
  "ad-creative":
    "Create three campaign concepts, bilingual copy and three ad sizes for one product.",
  ecommerce:
    "Preserve the product label while producing hero images and lifestyle variations.",
  "social-content": "Prepare a week of social posts and two carousel series.",
  "illustration-ip": "Create a brand mascot and six workplace expressions.",
  "typography-layout":
    "Typeset a bilingual menu as an editable two-sided print layout.",
  presentation: "Turn an approved market report into a client presentation.",
  "landing-page":
    "Create a bilingual landing page for enterprise trial enquiries.",
  "information-design":
    "Turn monthly advertising data into an evidence-based infographic.",
  "video-motion":
    "Create a short product promotion with editable captions and a recoverable timeline.",
  "marketing-analyst":
    "Review last month's ad and website data and propose next month's creative tests.",
  "workflow-consultant":
    "Plan a repeatable weekly reporting workflow with explicit review steps.",
};
type Template = {
  id: string;
  version: number;
  name: string;
  role_key: string;
  category: string;
  kind: string;
  role_description: string;
  examples: string[];
  available: boolean;
  availability_reason: string | null;
  data_mode: string;
  qualification_state: string;
  skill_version_ids: string[];
  template_version_id: string;
  runtime_profile_id: string;
  preset_definition?: {
    skill_bindings: { skill_key: string; version: string }[];
    acceptance_checks: string[];
    deliverables: { name: string; format: string }[];
    steps: string[];
  };
};
type Preflight = {
  id: string;
  state: string;
  missing_required_dependencies: string[];
  optional_unavailable_dependencies: string[];
  expires_at: string;
};
const scoped = (tenant: string, url: string, options: RequestInit = {}) =>
  api(url, {
    ...options,
    headers: {
      ...Object.fromEntries(new Headers(options.headers)),
      "X-Tenant-ID": tenant,
    },
  });

function dependencyText(code: string, t: (zh: string, en: string) => string) {
  if (code.startsWith("BRAND_"))
    return t("所選品牌版本或它引用的來源已不可用，請重新選擇。", "The selected brand revision or its sources are unavailable. Choose another revision.");
  if (code.startsWith("TOOL_NOT_IMPLEMENTED:"))
    return t(
      "此角色的部分專業工具尚未提供。",
      "Some professional tools for this role are still being prepared.",
    );
  if (code.startsWith("CAPABILITY:"))
    return t(
      "所需的公司 AI 服務尚未就緒。",
      "A required company AI service is not ready.",
    );
  if (code.startsWith("SKILL_INSTALLATION_REQUIRED:"))
    return t(
      "所需方法已停用或撤銷，請聯絡專案管理員。",
      "A required method is disabled or revoked. Contact your project administrator.",
    );
  if (code.startsWith("SKILL_UNAVAILABLE:"))
    return t(
      "所需的專業方法暫時無法使用。",
      "A required specialist method is unavailable.",
    );
  if (code.includes("PLAN") || code.includes("ENTITLEMENT"))
    return t(
      "目前方案或使用權限不支援此角色。",
      "Your current plan or permissions do not support this role.",
    );
  if (
    code.includes("RUNTIME") ||
    code.includes("CODEX") ||
    code.includes("VERSION")
  )
    return t(
      "此模板的執行版本暫時無法使用，請重新整理或聯絡支援。",
      "This template's execution version is unavailable. Refresh or contact support.",
    );
  if (code.includes("DISABLED"))
    return t("此角色目前已停用。", "This role is currently disabled.");
  return t(
    "此角色仍有設定需要由管理員處理。",
    "An administrator needs to resolve this role's configuration.",
  );
}

export function RoleTemplateCards({
  limit,
  filter = "all",
  search = "",
}: {
  limit?: number;
  filter?: string;
  search?: string;
}) {
  const w = useWorkspace();
  return (
    <TemplatePage
      key={[w.tenant, w.project, filter, search].join(":")}
      limit={limit}
      filter={filter}
      search={search}
    />
  );
}
function TemplatePage({
  limit,
  filter,
  search,
}: {
  limit?: number;
  filter: string;
  search: string;
}) {
  const w = useWorkspace(),
    { t, locale } = useI18n();
  const [page, setPage] = useState<{
      items: Template[];
      next_cursor: string | null;
    } | null>(null),
    [cursor, setCursor] = useState(""),
    [previous, setPrevious] = useState<string[]>([]),
    [refresh, setRefresh] = useState(0),
    [error, setError] = useState<Error | null>(null),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<Template | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    let live = true;
    setLoading(true);
    setPage(null);
    setError(null);
    setSelected(null);
    if (!w.tenant || !w.project) {
      setLoading(false);
      return;
    }
    const query = new URLSearchParams({ project_id: w.project, limit: "50" });
    if (filter !== "all") query.set("category", filter);
    if (search) query.set("q", search);
    if (cursor) query.set("cursor", cursor);
    void scoped(w.tenant, "/v1/agent-templates?" + query, {
      signal: abort.signal,
    })
      .then((data) => {
        if (live) setPage(data);
      })
      .catch((e) => {
        if (live && !abort.signal.aborted) setError(e);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      abort.abort();
    };
  }, [w.tenant, w.project, filter, search, cursor, refresh]);
  const priority = [
      "designer",
      "ad-creative",
      "marketing-analyst",
      "workflow-consultant",
    ],
    items = [...(page?.items ?? [])]
      .filter((row) => row.kind === "role_preset" || !limit)
      .sort((a, b) =>
        limit
          ? (priority.indexOf(a.role_key) < 0
              ? 99
              : priority.indexOf(a.role_key)) -
            (priority.indexOf(b.role_key) < 0
              ? 99
              : priority.indexOf(b.role_key))
          : a.role_key.localeCompare(b.role_key),
      )
      .slice(0, limit ?? 100);
  return (
    <>
      <ErrorNotice error={error} />
      {error && (
        <button
          className="button quiet"
          onClick={() => setRefresh((v) => v + 1)}
        >
          <RefreshCw size={16} />
          {t("重新載入模板", "Reload templates")}
        </button>
      )}
      {loading ? (
        <Loading />
      ) : !error && items.length ? (
        <div className="role-grid">
          {items.map((row, i) => {
            const Icon =
              row.category === "engineering"
                ? Code2
                : row.category === "operations"
                  ? Workflow
                  : row.category === "marketing"
                    ? ChartNoAxesCombined
                    : row.kind === "default_helper"
                      ? Sparkles
                      : Palette;
            return (
              <button
                className={"role-card role-tone-" + (i % 4)}
                key={row.id}
                data-template-role={row.role_key}
                onClick={() => setSelected(row)}
              >
                <div className="role-card-top">
                  <span className="role-icon">
                    <Icon size={23} strokeWidth={1.5} />
                  </span>
                  <ArrowUpRight size={17} />
                </div>
                <h3>
                  {locale === "en"
                    ? (roleEnglish[row.role_key] ?? row.name)
                    : row.name}
                </h3>
                <p>
                  {locale === "en"
                    ? (examplesEnglish[row.role_key] ?? row.examples[0])
                    : row.examples[0]}
                </p>
                <footer>
                  <span className="role-category">
                    v{row.version} · {row.category}
                  </span>
                  <span className={row.available ? "available-mark" : "muted"}>
                    {row.available
                      ? t(
                          row.data_mode === "simulated"
                            ? "可模擬試用"
                            : "可檢查選用",
                          row.data_mode === "simulated"
                            ? "Try with simulated data"
                            : "Check availability",
                        )
                      : t("準備中", "Preparing")}
                  </span>
                </footer>
              </button>
            );
          })}
        </div>
      ) : !error ? (
        <Empty
          icon={BookOpen}
          title={t("找不到符合的角色", "No matching roles")}
          body={t(
            "請調整分類或搜尋文字。",
            "Change the category or search text.",
          )}
        />
      ) : null}
      {!limit && !loading && !error && (
        <div
          className="row-actions section-block"
          aria-label={t("模板分頁", "Template pages")}
        >
          <button
            className="button quiet"
            disabled={!previous.length}
            onClick={() => {
              setCursor(previous.at(-1) ?? "");
              setPrevious(previous.slice(0, -1));
            }}
          >
            {t("上一頁", "Previous")}
          </button>
          <span className="muted small-text">
            {t("第", "Page")} {previous.length + 1}
          </span>
          <button
            className="button quiet"
            disabled={!page?.next_cursor}
            onClick={() => {
              setPrevious([...previous, cursor]);
              setCursor(page!.next_cursor!);
            }}
          >
            {t("下一頁", "Next")}
          </button>
        </div>
      )}
      {selected && (
        <TemplateSetup
          key={selected.id}
          template={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function TemplateSetup({
  template,
  onClose,
}: {
  template: Template;
  onClose: () => void;
}) {
  const w = useWorkspace(),
    { t, locale } = useI18n(),
    nav = useNavigate(),
    [name, setName] = useState(
      locale === "en"
        ? (roleEnglish[template.role_key] ?? template.name)
        : template.name,
    ),
    [instructions, setInstructions] = useState(""),
    [brandVersion, setBrandVersion] = useState(""),
    [check, setCheck] = useState<Preflight | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [now, setNow] = useState(Date.now());
  const live = useRef(true),
    revision = useRef(0),
    replay = useRef<{ body: string; key: string } | null>(null),
    checkReplay = useRef<{ body: string; key: string } | null>(null),
    lock = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    revision.current++;
    setCheck(null);
    replay.current = null;
    checkReplay.current = null;
  }, [locale]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const valid = !!name.trim() && name.trim().length <= 160;
  const fresh = check?.state === "ready" && Date.parse(check.expires_at) > now;
  function change(update: () => void) {
    revision.current++;
    setCheck(null);
    setError(null);
    replay.current = null;
    checkReplay.current = null;
    update();
  }
  function input() {
    return {
      project_id: w.project,
      template_version: template.version,
      overrides: {
        name: name.trim(),
        ...(instructions.trim()
          ? { role_description: instructions.trim() }
          : {}),
        locale: locale === "en" ? "en-HK" : "zh-HK",
        ...(brandVersion ? { brand_version_id: brandVersion } : {}),
      },
    };
  }
  async function run(action: "preflights" | "instances") {
    if (lock.current || !valid || !w.tenant || !w.project) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const current = revision.current,
      body = JSON.stringify(input()),
      slot = action === "instances" ? replay : checkReplay;
    if (slot.current?.body !== body)
      slot.current = { body, key: crypto.randomUUID() };
    try {
      const result = await scoped(
        w.tenant,
        `/v1/agent-templates/${template.id}/${action}`,
        {
          method: "POST",
          body,
          headers: { "Idempotency-Key": slot.current!.key },
        },
      );
      if (!live.current || current !== revision.current) return;
      if (action === "preflights") {
        setCheck(result);
        checkReplay.current = null;
      } else nav("/app/specialists");
    } catch (e) {
      if (live.current && current === revision.current) {
        setError(e as Error);
        if (
          e instanceof ApiError &&
          e.code === "TEMPLATE_PREREQUISITES_REQUIRED"
        ) {
          setCheck((e.details as unknown as Preflight) ?? null);
          replay.current = null;
        }
      }
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  }
  const requirements = [
    ...new Set(
      check?.missing_required_dependencies ??
        (!template.available && template.availability_reason
          ? [template.availability_reason]
          : []),
    ),
  ];
  return (
    <Modal
      title={
        locale === "en"
          ? (roleEnglish[template.role_key] ?? template.name)
          : template.name
      }
      onClose={onClose}
    >
      <p className="muted template-version">
        {t("預設模板", "Role template")} · v{template.version} ·{" "}
        {template.data_mode === "simulated"
          ? t("模擬資料", "Simulated data")
          : t("已配置服務", "Configured services")}
      </p>
      {template.qualification_state !== "qualified" && (
        <div className="notice">
          <BookOpen size={18} />
          <span>
            {t(
              "此模板尚在試用驗證階段；完整專業交付仍待驗收。",
              "This template is under evaluation. Its complete professional deliverables still require acceptance.",
            )}
          </span>
        </div>
      )}
      <p className="template-example">
        {locale === "en"
          ? (examplesEnglish[template.role_key] ?? template.examples[0])
          : template.examples[0]}
      </p>
      {template.preset_definition && (
        <div className="role-detail template-detail">
          <h3>{t("交付內容", "Deliverables")}</h3>
          <ul>
            {template.preset_definition.deliverables.map((item) => (
              <li key={item.name}>
                <Check size={15} />
                <span>
                  {item.name} <small className="muted">{item.format}</small>
                </span>
              </li>
            ))}
          </ul>
          <h3>{t("專業方法", "Specialist methods")}</h3>
          <div className="tags">
            {template.preset_definition.skill_bindings.map((item) => (
              <span key={item.skill_key}>
                {item.skill_key} · {item.version}
              </span>
            ))}
          </div>
          <details>
            <summary>{t("品質標準", "Quality checks")}</summary>
            <ul>
              {template.preset_definition.acceptance_checks.map((item) => (
                <li key={item}>
                  <Check size={15} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      <form
        className="form-stack template-setup"
        onSubmit={(event) => {
          event.preventDefault();
          void run(fresh ? "instances" : "preflights");
        }}
      >
        <fieldset disabled={busy}>
          <Field label={t("專家名稱", "Specialist name")}>
            <input
              name="template_name"
              value={name}
              maxLength={160}
              required
              onChange={(e) => change(() => setName(e.target.value))}
            />
          </Field>
          <Field
            label={t("工作要求", "Working instructions")}
            hint={t(
              "可加入長期工作偏好；留空則使用模板的工作方法。",
              "Add lasting working preferences, or leave blank to use the template's methods.",
            )}
          >
            <textarea
              name="template_instructions"
              rows={3}
              maxLength={6000}
              value={instructions}
              onChange={(e) => change(() => setInstructions(e.target.value))}
            />
          </Field>
          <RoleBrandVersion key={w.tenant + "/" + w.project} tenant={w.tenant} project={w.project} value={brandVersion} disabled={busy}
            onChange={value => change(() => setBrandVersion(value))}/>
        </fieldset>
        <ErrorNotice error={error} />
        {!!requirements.length && (
          <div className="notice template-dependencies" role="status">
            <div>
              <strong>
                {t("需要先處理的項目", "Resolve before creating")}
              </strong>
              <ul>
                {[
                  ...new Set(
                    requirements.map((code) => dependencyText(code, t)),
                  ),
                ].map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
              <Link className="text-link" to="/app/skills">
                {t("查看專案方法", "Review project methods")}
              </Link>
            </div>
          </div>
        )}
        {check?.state === "ready" && (
          <p className="small-text template-check" role="status">
            <Check size={16} />
            {fresh
              ? t(
                  "目前依賴可用，建立時會再次檢查。",
                  "Current dependencies are ready and will be checked again when creating.",
                )
              : t(
                  "檢查結果已到期，請重新檢查。",
                  "This check expired. Check availability again.",
                )}
          </p>
        )}
        {check && (
          <p className="muted small-text">
            {t("檢查有效至", "Check valid until")}{" "}
            <DateText value={check.expires_at} />
          </p>
        )}
        <button
          className="button primary"
          type="submit"
          disabled={busy || !valid}
        >
          {busy
            ? t("正在處理…", "Working…")
            : fresh
              ? t("建立此專家", "Create this specialist")
              : t("檢查可用性", "Check availability")}
          <ArrowUpRight size={17} />
        </button>
        {check && !fresh && (
          <p className="muted small-text">
            {t(
              "檢查不會啟動 AI 任務或預留使用費。",
              "Checking does not start an AI task or reserve a usage budget.",
            )}
          </p>
        )}
      </form>
    </Modal>
  );
}
