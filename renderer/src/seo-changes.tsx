import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, FilePenLine, RefreshCw, Search } from "lucide-react";
import { api, download, post } from "./api";
import { useWorkspace } from "./context";
import {
  Badge,
  ErrorNotice,
  Field,
  Loading,
  Modal,
  useData,
  useI18n,
} from "./ui";
import { seoFindingLabel, type Audit, type Finding } from "./seo-audits";

type Change = {
  id: string;
  audit_id: string;
  task_id: string;
  title: string;
  objective: string;
  finding_ids: string[];
  state: string;
  task_status: string;
  task_version: number;
  data_mode: string;
  created_at: string;
  error_code: string | null;
  source_result_version_id: string;
  source_result_sha256: string;
  spec_hash: string;
  json_asset_version_id: string | null;
  html_asset_version_id: string | null;
  budget: { amount_micros: string };
  confirmed_cost: { amount_micros: string };
  draft?: {
    website_modified: false;
    changes: {
      finding_id: string;
      rationale: string;
      proposed_change: string;
      verification: string[];
      evidence: Finding;
    }[];
  } | null;
};
const money = (value: string) => (Number(value) / 1e6).toFixed(4);

export function SeoChanges({
  audit,
  selected,
  clearSelection,
  onRecheck,
  onSource,
}: {
  audit: Audit;
  selected: Finding[];
  clearSelection: () => void;
  onRecheck: () => void;
  onSource: (id: string, finding: Finding) => void;
}) {
  const w = useWorkspace(),
    { t } = useI18n();
  const [refresh, setRefresh] = useState(0),
    [offset, setOffset] = useState(0);
  const [form, setForm] = useState<{
    audit: Audit;
    findings: Finding[];
  } | null>(null);
  const [open, setOpen] = useState<string | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const base = `/v1/seo/audits/${audit.id}/change-tasks`;
  const directory = useData<{
    items: Change[];
    total: number;
    next_offset: number | null;
  }>(`${base}?offset=${offset}`, refresh, 2500, w.tenant);
  const detail = useData<Change>(
    open ? `${base}/${open}` : null,
    refresh,
    2500,
    w.tenant,
  );
  const live = useRef(true),
    saving = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (directory.error || detail.error) {
      setForm(null);
      setOpen(null);
    }
  }, [directory.error, detail.error]);
  const act = async (action: () => Promise<unknown>, refreshData = true) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      if (live.current && refreshData) setRefresh((v) => v + 1);
    } catch (e) {
      if (live.current) setError(e);
    } finally {
      saving.current = false;
      if (live.current) setBusy(false);
    }
  };
  const control = async (c: Change, action: "pause" | "resume" | "cancel") => {
    await post(
      `${w.base}/tasks/${c.task_id}/${action === "cancel" ? "cancel" : "controls"}`,
      action === "cancel" ? {} : { action, expected_version: c.task_version },
    );
  };
  return (
    <section
      className="card seo-changes"
      aria-label={t("網站修改任務", "Website change tasks")}
    >
      <div className="section-title">
        <div>
          <p className="eyebrow">FIND IT. DRAFT IT. REVIEW IT.</p>
          <h2>{t("網站修改任務", "Website change tasks")}</h2>
        </div>
        <button
          className="button primary"
          disabled={!selected.length || !!directory.error}
          onClick={() =>
            setForm({ audit: { ...audit }, findings: [...selected] })
          }
        >
          <FilePenLine size={16} />
          {t("保存修改任務", "Save change task")}{" "}
          {selected.length > 0 ? `(${selected.length})` : ""}
        </button>
      </div>
      <p className="muted">
        {t(
          "選取上方問題，保存有原始證據的修改草稿。草稿需要人工審核，網站不會自動修改。",
          "Select findings above to save an evidence-linked change draft. Human review is required; the website is not modified automatically.",
        )}
      </p>
      <ErrorNotice error={directory.error ?? detail.error ?? error} />
      {!directory.data && directory.loading ? (
        <Loading />
      ) : (
        !directory.error &&
        directory.data && (
          <>
            {!directory.data.items.length ? (
              <p className="muted">
                {t("尚未保存修改任務。", "No saved change tasks yet.")}
              </p>
            ) : (
              <div className="seo-change-list">
                {directory.data.items.map((c) => (
                  <button
                    key={c.id}
                    className="seo-change-item"
                    onClick={() => {
                      setError(null);
                      setOpen(c.id);
                    }}
                  >
                    <span>
                      <strong>{c.title}</strong>
                      <small>
                        {c.finding_ids.length}{" "}
                        {t("個已選問題", "selected findings")} ·{" "}
                        {new Date(c.created_at).toLocaleString()}
                      </small>
                    </span>
                    <span>
                      <Badge value={c.task_status} />
                      {c.state === "draft_ready" && (
                        <small>
                          {t("待審核草稿", "Draft ready for review")}
                        </small>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="seo-pager">
              <button
                className="text-button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 25))}
              >
                {t("上一頁", "Previous")}
              </button>
              <span>
                {directory.data.total} {t("項任務", "tasks")}
              </span>
              <button
                className="text-button"
                disabled={directory.data.next_offset === null}
                onClick={() =>
                  directory.data?.next_offset != null &&
                  setOffset(directory.data.next_offset)
                }
              >
                {t("下一頁", "Next")}
              </button>
            </div>
          </>
        )
      )}
      {form && !directory.error && (
        <CreateChange
          snapshot={form}
          onClose={() => setForm(null)}
          onCreated={(c) => {
            setForm(null);
            clearSelection();
            setOffset(0);
            setRefresh((v) => v + 1);
            setOpen(c.id);
          }}
        />
      )}
      {open && !detail.error && !directory.error && (
        <Modal
          title={t("修改草稿與原始證據", "Change draft & original evidence")}
          onClose={() => setOpen(null)}
        >
          {!detail.data ? (
            <Loading />
          ) : (
            (() => {
              const c = detail.data;
              return (
                <div className="seo-change-detail">
                  <Badge
                    value={c.data_mode === "simulated" ? "simulated" : "active"}
                  />
                  <h3>{c.title}</h3>
                  <p>{c.objective}</p>
                  <p className="notice">
                    {t(
                      "網站尚未修改。請先人工審核草稿，另行實施修改後再確認復查。",
                      "The website is unchanged. Review the draft, implement changes separately, then explicitly recheck.",
                    )}
                  </p>
                  <div className="seo-change-cost">
                    <span>
                      <Badge value={c.task_status} />
                    </span>
                    <span>
                      {t("預算上限", "Budget limit")} HK$
                      {money(c.budget.amount_micros)}
                    </span>
                    <span>
                      {t("已確認費用", "Confirmed cost")} HK$
                      {money(c.confirmed_cost.amount_micros)}
                    </span>
                  </div>
                  {c.error_code && <p role="status">{c.error_code}</p>}
                  {c.draft?.changes.map((item) => (
                    <article key={item.finding_id}>
                      <h3>{seoFindingLabel(item.evidence.code, t)}</h3>
                      <code>{item.evidence.url}</code>
                      <p>{item.rationale}</p>
                      {item.evidence.location && (
                        <>
                          <h4>{t("原始證據", "Original evidence")}</h4>
                          <pre>{item.evidence.location.quote}</pre>
                        </>
                      )}
                      <h4>{t("待審核修改", "Proposed change")}</h4>
                      <pre>{item.proposed_change}</pre>
                      <h4>{t("驗證步驟", "Verification steps")}</h4>
                      <ol>
                        {item.verification.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                      <button
                        className="text-button"
                        onClick={() => {
                          setOpen(null);
                          onSource(item.evidence.source_id, item.evidence);
                        }}
                      >
                        <Search size={15} />
                        {t("查看原始證據", "Inspect source evidence")}
                      </button>
                    </article>
                  ))}
                  <details>
                    <summary>
                      {t("原始版本與摘要", "Original version and hashes")}
                    </summary>
                    <p>{t("診斷結果版本", "Audit result version")}</p>
                    <code>{c.source_result_version_id}</code>
                    <p>SHA-256</p>
                    <code>{c.source_result_sha256}</code>
                    <p>{t("修改規格摘要", "Change specification hash")}</p>
                    <code>{c.spec_hash}</code>
                  </details>
                  <ErrorNotice error={error} />
                  <div className="row-actions">
                    {c.state === "draft_ready" && (
                      <>
                        {(["json", "html"] as const).map((format) => (
                          <button
                            key={format}
                            className="button"
                            disabled={busy}
                            onClick={() =>
                              void act(
                                () =>
                                  download(
                                    `${base}/${c.id}/download?format=${format}`,
                                    `website-change-${c.id}.${format}`,
                                    w.tenant,
                                  ),
                                false,
                              )
                            }
                          >
                            <Download size={16} />
                            {format === "json"
                              ? t("下載修改資料", "Download change JSON")
                              : t("下載修改草稿", "Download change draft")}
                          </button>
                        ))}
                        <button
                          className="button primary"
                          onClick={() => {
                            setOpen(null);
                            onRecheck();
                          }}
                        >
                          <RefreshCw size={16} />
                          {t("修改後復查", "Recheck after changes")}
                        </button>
                      </>
                    )}
                    {c.task_status === "queued" && (
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => void act(() => control(c, "pause"))}
                      >
                        {t("暫停", "Pause")}
                      </button>
                    )}
                    {c.task_status === "paused" && (
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => void act(() => control(c, "resume"))}
                      >
                        {t("繼續", "Resume")}
                      </button>
                    )}
                    {["queued", "paused", "running"].includes(
                      c.task_status,
                    ) && (
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => void act(() => control(c, "cancel"))}
                      >
                        {t("取消任務", "Cancel task")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })()
          )}
        </Modal>
      )}
    </section>
  );
}

function CreateChange({
  snapshot,
  onClose,
  onCreated,
}: {
  snapshot: { audit: Audit; findings: Finding[] };
  onClose: () => void;
  onCreated: (change: Change) => void;
}) {
  const w = useWorkspace(),
    { t } = useI18n();
  const [title, setTitle] = useState(
      t("網站問題修改草稿", "Website repair draft"),
    ),
    [objective, setObjective] = useState("");
  const [budget, setBudget] = useState("1.00"),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const live = useRef(true),
    saving = useRef(false),
    key = useRef(crypto.randomUUID());
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    key.current = crypto.randomUUID();
    setConfirmed(false);
  }, [title, objective, budget]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!/^\d+(\.\d{1,6})?$/.test(budget))
        throw new Error(
          t("請輸入有效 HKD 預算。", "Enter a valid HKD budget."),
        );
      const [major, minor = ""] = budget.split("."),
        amount = BigInt(major) * 1000000n + BigInt(minor.padEnd(6, "0"));
      if (amount <= 0n || amount > 1000000000000n)
        throw new Error(
          t("預算超出支援範圍。", "Budget is outside the supported range."),
        );
      const agent = await post(w.base + "/analysis/assistant", {});
      if (!live.current) return;
      const c = await api<Change>(
        `/v1/seo/audits/${snapshot.audit.id}/change-tasks`,
        {
          method: "POST",
          headers: { "X-Tenant-ID": w.tenant, "Idempotency-Key": key.current },
          body: JSON.stringify({
            agent_id: agent.id,
            source_result_version_id: snapshot.audit.result_asset_version_id,
            title,
            objective,
            finding_ids: snapshot.findings.map((f) => f.id),
            budget: { currency: "HKD", amount_micros: amount.toString() },
          }),
        },
      );
      if (live.current) onCreated(c);
    } catch (e) {
      if (live.current) setError(e);
    } finally {
      saving.current = false;
      if (live.current) setBusy(false);
    }
  };
  return (
    <Modal
      title={t("確認保存修改任務", "Confirm saved change task")}
      onClose={onClose}
    >
      <form className="form seo-change-form" onSubmit={submit}>
        <p>
          {t(
            "將依據以下問題與原始結果版本建立獨立任務；不會重新抓取或寫回網站。",
            "A separate task will use these findings and the original result version. It will not refetch or modify the website.",
          )}
        </p>
        <ul className="seo-selected-findings">
          {snapshot.findings.map((f) => (
            <li key={f.id}>
              <strong>{seoFindingLabel(f.code, t)}</strong>
              <code>{f.url}</code>
            </li>
          ))}
        </ul>
        <Field label={t("任務名稱", "Task title")}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={160}
            disabled={busy}
          />
        </Field>
        <Field
          label={t("修改目標與限制", "Change objective and constraints")}
          hint={t(
            "說明希望如何修改，以及必須保留的內容。",
            "Describe the intended corrections and anything that must be preserved.",
          )}
        >
          <textarea
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            required
            minLength={5}
            maxLength={8000}
            rows={4}
            disabled={busy}
          />
        </Field>
        <Field label={t("AI 預算上限（HKD）", "AI budget limit (HKD)")}>
          <input
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            required
            disabled={busy}
          />
        </Field>
        <p className="notice">
          {t(
            "此預算獨立於原診斷。交付為需人工審核的修改草稿，並不代表修改已完成或網站已發布。",
            "This budget is separate from the original audit. The output is a draft for human review; it does not mean changes were implemented or the website was published.",
          )}
        </p>
        {snapshot.audit.data_mode === "simulated" && (
          <Badge value="simulated" />
        )}
        <label className="seo-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            required
            disabled={busy}
          />
          <span>
            {t(
              "我確認選定的原始證據和修改目標，並同意在此預算內生成草稿。",
              "I confirm the selected original evidence and change objective, and approve draft generation within this budget.",
            )}
          </span>
        </label>
        <ErrorNotice error={error} />
        <button
          type="submit"
          className="button primary"
          disabled={!confirmed || busy}
        >
          {busy
            ? t("正在保存…", "Saving…")
            : t("保存並生成草稿", "Save and generate draft")}
        </button>
      </form>
    </Modal>
  );
}
