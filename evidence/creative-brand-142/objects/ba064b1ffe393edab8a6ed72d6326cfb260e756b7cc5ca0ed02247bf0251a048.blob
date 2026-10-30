import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, ShieldCheck } from "lucide-react";
import { api, ApiError } from "./api";
import type { CapabilityAccess } from "./capability-model";
import {
  PageHeader,
  Field,
  Modal,
  ErrorNotice,
  Loading,
  Badge,
  DateText,
  useData,
  useI18n,
} from "./ui";
import "./solutions.css";
import { AdminContentRevision, canReviseContent } from "./content-revisions";

export function AdminSolutions({ access }: { access: CapabilityAccess }) {
  const { t } = useI18n(),
    [filter, setFilter] = useState(""),
    [pages, setPages] = useState<string[]>([]),
    [refresh, setRefresh] = useState(0);
  const [body, setBody] = useState<any>(null),
    [reading, setReading] = useState(""),
    [selected, setSelected] = useState<any>(null),
    [reason, setReason] = useState("");
  const [revision, setRevision] = useState<any>(null);
  const [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<any>(null);
  const live = useRef(true),
    lock = useRef(false);
  const storageKey = "cp_admin_solution_attempt:" + access.me.user.id;
  const data = useData<any>(
    "/v1/admin/solutions?limit=15" +
      (filter ? "&state=" + filter : "") +
      (pages.length ? "&cursor=" + pages.at(-1) : ""),
    refresh,
  );
  useEffect(() => {
    const revised = () => setRefresh(value => value + 1);
    window.addEventListener("cp-admin-content-revised", revised);
    return () => window.removeEventListener("cp-admin-content-revised", revised);
  }, []);
  useEffect(() => {
    live.current = true;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const p = JSON.parse(raw);
        if (
          !/^[a-f0-9-]{36}$/.test(p.id) ||
          !/^[a-f0-9-]{36}$/.test(p.key) ||
          typeof p.body?.reason !== "string"
        )
          throw new Error("ADMIN_SOLUTION_SAVED_REQUEST_UNVERIFIED");
        setPending(p);
      }
    } catch (e) {
      setError(e as Error);
      lock.current = true;
    }
    return () => {
      live.current = false;
    };
  }, [storageKey]);
  async function read(row: any) {
    if (reading || busy || pending) return;
    setReading(row.id);
    setError(null);
    setBody(null);
    try {
      const v = await api(`/v1/admin/solutions/${row.id}/body`);
      if (live.current) setBody(v);
    } catch (e) {
      if (live.current) setError(e as Error);
    } finally {
      if (live.current) setReading("");
    }
  }
  async function disable(original?: any) {
    if (lock.current || (!original && pending)) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const attempt = original ?? {
      id: selected.id,
      key: crypto.randomUUID(),
      body: { expected_version: selected.version, reason: reason.trim() },
    };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(attempt));
      setPending(attempt);
      await api(`/v1/admin/solutions/${attempt.id}/disable`, {
        method: "POST",
        headers: { "Idempotency-Key": attempt.key },
        body: JSON.stringify(attempt.body),
      });
      sessionStorage.removeItem(storageKey);
      if (live.current) {
        setPending(null);
        setSelected(null);
        setBody(null);
        setRefresh((v) => v + 1);
        setReason("");
      }
    } catch (e) {
      const definite =
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        ![401, 408, 425, 429].includes(e.status) &&
        !["IDEMPOTENCY_CONFLICT", "REQUEST_RESULT_REMOVED"].includes(e.code);
      if (definite) {
        sessionStorage.removeItem(storageKey);
        if (live.current) setPending(null);
      }
      if (live.current) setError(e as Error);
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  }
  return (
    <div className="admin-solutions">
      <PageHeader
        eyebrow="COPYPASTE · METHOD CONTROL"
        title={t("業務方案管理", "Business method control")}
        description={t(
          "按目前權限範圍管理方法版本。正文查閱與停用分別授權並記錄審計。",
          "Manage method versions within your current scope. Body reads and disablement have separate permissions and audit records.",
        )}
      />
      <ErrorNotice error={error || data.error} />
      {pending && (
        <div className="notice" role="status">
          <p>
            {t(
              "原停用提交尚未確認，重試會使用同一請求。",
              "The original disablement is unconfirmed. Retry uses the same request.",
            )}
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void disable(pending)}
          >
            {t("重試原提交", "Retry original request")}
          </button>
        </div>
      )}
      <div className="admin-solution-filter">
        <Field label={t("版本狀態", "Version state")}>
          <select
            value={filter}
            disabled={busy || !!pending}
            onChange={(e) => {
              setFilter(e.target.value);
              setPages([]);
            }}
          >
            <option value="">{t("全部狀態", "All states")}</option>
            <option value="draft">{t("草稿", "Draft")}</option>
            <option value="published">{t("已發佈", "Published")}</option>
            <option value="disabled">{t("已停用", "Disabled")}</option>
          </select>
        </Field>
        <p className="muted">
          {t(
            "此列表只載入方法名稱、版本及範圍；試運行對話與客戶檔案由原內容權限控制。",
            "This list loads method names, versions and scope. Trial conversations and customer files retain their existing content permissions.",
          )}
        </p>
      </div>
      {data.loading && <Loading />}
      <div className="admin-solution-list">
        {data.data?.items.map((row: any) => (
          <article key={row.id}>
            <div className="admin-solution-meta">
              <div>
                <h2>{row.name}</h2>
                <p>
                  v{row.version} · <Badge value={row.state} />
                </p>
              </div>
              <DateText value={row.created_at} />
            </div>
            <dl>
              <div>
                <dt>{t("企業", "Workspace")}</dt>
                <dd>{row.tenant_id}</dd>
              </div>
              <div>
                <dt>{t("專案", "Project")}</dt>
                <dd>{row.project_id}</dd>
              </div>
              <div>
                <dt>{t("版本 ID", "Version ID")}</dt>
                <dd>{row.id}</dd>
              </div>
            </dl>
            <div className="admin-solution-actions">
              {row.state !== "disabled" && canReviseContent(access) && <button className="button secondary" disabled={!!reading || busy || !!pending} onClick={() => setRevision(row)}>{t("建立修訂草稿", "Create revision draft")}</button>}
              {access.has("admin.content.body.read") && (
                <button
                  className="button secondary"
                  disabled={!!reading || busy || !!pending}
                  onClick={() => void read(row)}
                >
                  <Eye size={16} />
                  {reading === row.id
                    ? t("載入正文…", "Loading body…")
                    : t("查閱方法正文", "Read method body")}
                </button>
              )}
              {row.state !== "disabled" &&
                access.has("admin.content.quarantine") && (
                  <button
                    className="button secondary"
                    disabled={busy || !!pending}
                    onClick={() => {
                      setSelected(row);
                      setReason("");
                      setError(null);
                    }}
                  >
                    <ShieldCheck size={16} />
                    {t("停用此版本", "Disable version")}
                  </button>
                )}
            </div>
          </article>
        ))}
      </div>
      {data.data?.items.length === 0 && (
        <p className="muted">
          {t(
            "目前範圍沒有符合的方案版本。",
            "No matching method versions in your current scope.",
          )}
        </p>
      )}
      <nav
        className="admin-solution-pagination"
        aria-label={t("方案分頁", "Method pages")}
      >
        <button
          className="icon-button"
          disabled={!pages.length || busy || !!pending}
          aria-label={t("上一頁", "Previous page")}
          onClick={() => setPages((v) => v.slice(0, -1))}
        >
          <ChevronLeft size={18} />
        </button>
        <span>{pages.length + 1}</span>
        <button
          className="icon-button"
          disabled={!data.data?.next_cursor || busy || !!pending}
          aria-label={t("下一頁", "Next page")}
          onClick={() => setPages((v) => [...v, data.data.next_cursor])}
        >
          <ChevronRight size={18} />
        </button>
      </nav>
      {revision && <AdminContentRevision access={access} kind="solutions" id={revision.id} onClose={() => setRevision(null)} onDone={() => { setRevision(null); setRefresh(v => v + 1); }} />}
      {body && (
        <Modal
          title={t("方法正文（已記錄查閱）", "Method body (read audited)")}
          onClose={() => setBody(null)}
        >
          <h3>
            {body.definition.name} · v{body.version}
          </h3>
          <p className="admin-solution-body">{body.definition.instructions}</p>
          <dl>
            <div>
              <dt>{t("固定角色", "Pinned roles")}</dt>
              <dd>
                {body.templates
                  .map(
                    (v: any) =>
                      `${v.name} · ${v.role_key} v${v.template_version}`,
                  )
                  .join("; ")}
              </dd>
            </div>
            <div>
              <dt>{t("資料要求", "Input requirements")}</dt>
              <dd>{body.definition.required_assets.join("; ") || "—"}</dd>
            </div>
            <div>
              <dt>{t("連接要求", "Connection requirements")}</dt>
              <dd>{body.definition.required_connectors.join("; ") || "—"}</dd>
            </div>
            <div>
              <dt>SHA-256</dt>
              <dd>{body.definition_hash}</dd>
            </div>
          </dl>
        </Modal>
      )}
      {selected && (
        <Modal
          title={t("確認停用方法版本", "Confirm method disablement")}
          onClose={() => {
            if (!busy && !pending) setSelected(null);
          }}
        >
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void disable();
            }}
          >
            <p>
              {selected.name} · v{selected.version}
            </p>
            <p>
              {t(
                "需要目前範圍的停用權限及近期 MFA。停用會阻止後續使用及依賴此方法的內容存取，不會替客戶驗收或修改費用。",
                "Requires disable permission in this scope and recent MFA. Disablement blocks further use and dependent content access; it does not accept work or change customer fees.",
              )}
            </p>
            <Field label={t("原因（記錄到審計）", "Reason (audited)")}>
              <textarea
                name="solution_disable_reason"
                required
                minLength={3}
                maxLength={1000}
                value={reason}
                disabled={busy || !!pending}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <ErrorNotice error={error} />
            <button
              type="submit"
              className="button primary"
              disabled={busy || !!pending}
            >
              {t("確認停用", "Confirm disablement")}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
