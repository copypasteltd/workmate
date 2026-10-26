import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, RefreshCw } from "lucide-react";
import { adoptionPrice } from "./adoption-price";
import { api, ApiError, post } from "./api";
import { useWorkspace } from "./context";
import { completeOperation, operationKey } from "./operation-key";
import { DateText, ErrorNotice, useI18n } from "./ui";

type Capability = {
  id: string;
  profile_key: string;
  model_alias: string | null;
  reasoning_effort: string | null;
  state: "ready" | "unavailable" | "unrecorded";
  input_micros_per_million: string | null;
  output_micros_per_million: string | null;
  micros_per_image: string | null;
};
type Snapshot = {
  agent_version: number;
  recorded: boolean;
  runtime_version: string | null;
  capabilities: Capability[];
  skills: {
    key: string;
    version: string;
    sha256: string;
    installation_id: string | null;
  }[];
  tool_ids: string[];
  brand: { id: string; version: number } | null;
};
type Preview = {
  id: string;
  preview_hash: string;
  expires_at: string;
  state: "ready" | "consumed";
  result: unknown;
  comparison: {
    data_mode: string;
    source: Snapshot;
    target: Snapshot;
    changed_fields: string[];
  };
};

export function AdoptionReview({
  endpoint,
  proposal,
  onSaved,
  onBack,
}: {
  endpoint: string;
  proposal: unknown;
  onSaved: () => void;
  onBack: (stale: boolean) => void;
}) {
  const w = useWorkspace(),
    { t } = useI18n();
  const [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [verified, setVerified] = useState(false),
    [consent, setConsent] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [invalid, setInvalid] = useState(false);
  const generation = useRef(0),
    inFlight = useRef(false),
    done = useRef(false),
    saved = useRef(onSaved);
  saved.current = onSaved;
  const account = w.me?.user?.id ?? "",
    signature = JSON.stringify(proposal),
    identity = `${account}:${w.base}:${endpoint}:${signature}`;
  const previewPath = (id: string) =>
    w.base + "/version-adoption-previews/" + id;
  const explain = (e: unknown) =>
    e instanceof ApiError && [401, 403, 404, 409].includes(e.status)
      ? new Error(
          t(
            "比較已失效或權限已變更。請重新載入設定，再建立比較。",
            "This comparison expired or settings or access changed. Reload settings and create a new comparison.",
          ),
        )
      : new Error(
          t(
            "暫時無法核對或儲存。請重試；已提交的確認不會重複建立版本。",
            "Unable to check or save right now. Retry; an accepted confirmation will not create another version.",
          ),
        );
  const finish = async (value: Preview) => {
    if (done.current) return;
    done.current = true;
    const body = { preview_hash: value.preview_hash, proposal };
    await completeOperation(account, endpoint, proposal);
    await completeOperation(
      account,
      previewPath(value.id) + "/confirmations",
      body,
    );
    saved.current();
  };
  async function compare() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setVerified(false);
    setConsent(false);
    const current = generation.current;
    try {
      const requestKey = await operationKey(account, endpoint, proposal);
      const value = (await post(endpoint, proposal, requestKey)) as Preview;
      if (current !== generation.current) return;
      if (value.state === "consumed") {
        await finish(value);
        return;
      }
      setPreview(value);
      setVerified(true);
      setInvalid(false);
    } catch (e) {
      if (current !== generation.current) return;
      const stale =
        e instanceof ApiError && [401, 403, 404, 409].includes(e.status);
      setPreview(null);
      setInvalid(stale);
      setError(explain(e));
    } finally {
      if (current === generation.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  async function verify(value: Preview) {
    const current = generation.current;
    const latest = await api<Preview>(previewPath(value.id));
    if (current !== generation.current) return false;
    if (latest.state === "consumed") {
      await finish(latest);
      return false;
    }
    if (
      latest.preview_hash !== value.preview_hash ||
      Date.parse(latest.expires_at) <= Date.now()
    )
      throw new ApiError("ADOPTION_PREVIEW_EXPIRED", "Comparison expired", 409);
    return true;
  }
  useEffect(() => {
    ++generation.current;
    inFlight.current = false;
    done.current = false;
    setPreview(null);
    setInvalid(false);
    setError(null);
    void compare();
    const clear = () => {
      ++generation.current;
      setPreview(null);
      setVerified(false);
    };
    window.addEventListener("copypaste:session-ended", clear);
    return () => {
      ++generation.current;
      window.removeEventListener("copypaste:session-ended", clear);
    };
  }, [identity]);
  useEffect(() => {
    if (!preview) return;
    const current = generation.current;
    async function recheck() {
      if (inFlight.current || document.visibilityState === "hidden") return;
      try {
        const usable = await verify(preview!);
        if (current === generation.current) setVerified(usable);
      } catch (e) {
        if (current !== generation.current) return;
        setVerified(false);
        setError(explain(e));
        if (e instanceof ApiError && [401, 403, 404, 409].includes(e.status)) {
          setPreview(null);
          setInvalid(true);
        }
      }
    }
    const timer = window.setInterval(() => void recheck(), 15000);
    const expiry = window.setTimeout(
      () => {
        setPreview(null);
        setVerified(false);
        setInvalid(true);
        setError(
          explain(new ApiError("ADOPTION_PREVIEW_EXPIRED", "Expired", 409)),
        );
      },
      Math.max(0, Date.parse(preview.expires_at) - Date.now()),
    );
    window.addEventListener("focus", recheck);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(expiry);
      window.removeEventListener("focus", recheck);
    };
  }, [preview, identity]);
  async function confirm() {
    if (!preview || !verified || !consent || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const current = generation.current;
    try {
      if (!(await verify(preview))) return;
      if (current !== generation.current) return;
      const path = previewPath(preview.id) + "/confirmations",
        body = { preview_hash: preview.preview_hash, proposal };
      await post(path, body, await operationKey(account, path, body));
      if (current === generation.current) await finish(preview);
    } catch (e) {
      if (current !== generation.current) return;
      setError(explain(e));
      if (e instanceof ApiError && [401, 403, 404, 409].includes(e.status)) {
        setPreview(null);
        setVerified(false);
        setInvalid(true);
      }
    } finally {
      if (current === generation.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  const fields: Record<string, string> = {
    name: t("名稱", "Name"),
    instructions: t("工作要求", "Working instructions"),
    enabled: t("可用狀態", "Availability"),
    runtime: t("執行版本", "Runtime version"),
    models: t("模型", "Models"),
    reasoning_effort: t("推理強度", "Reasoning effort"),
    rates: t("單價", "Rates"),
    skills: t("技能", "Methods"),
    tools: t("工具", "Tools"),
    brand: t("品牌版本", "Brand version"),
  };
  const price = (v: string | null) =>
    adoptionPrice(v) ?? t("未記錄", "Not recorded");
  function column(value: Snapshot, title: string) {
    return (
      <section className="adoption-version" aria-label={title}>
        <h3>
          {title} <span className="muted">v{value.agent_version}</span>
        </h3>
        {!value.recorded && (
          <p className="adoption-unknown">
            {t(
              "歷史配置未完整記錄；未知價格不會以目前價格補填。",
              "Historical settings are incomplete. Unknown prices are not filled with today's rates.",
            )}
          </p>
        )}
        {value.capabilities.map((c) => (
          <div className="adoption-capability" key={c.id}>
            <p className="small-text muted">
              {c.profile_key === "internal-text-v1"
                ? t("文字模型", "Text model")
                : c.profile_key === "internal-image2-v1"
                  ? t("圖片模型", "Image model")
                  : c.profile_key}
            </p>
            <strong>
              {c.model_alias ?? t("未記錄模型", "Model not recorded")}
            </strong>
            <p className="small-text">
              {c.state === "ready"
                ? t("已就緒", "Ready")
                : c.state === "unavailable"
                  ? t("暫不可用", "Unavailable")
                  : t("未完整記錄", "Not fully recorded")}
              {c.reasoning_effort
                ? ` · ${t("推理強度", "Reasoning effort")}: ${c.reasoning_effort}`
                : ""}
            </p>
            {c.profile_key === "internal-text-v1" ? (
              <dl>
                <div>
                  <dt>{t("輸入 / 百萬 token", "Input / million tokens")}</dt>
                  <dd>{price(c.input_micros_per_million)}</dd>
                </div>
                <div>
                  <dt>{t("輸出 / 百萬 token", "Output / million tokens")}</dt>
                  <dd>{price(c.output_micros_per_million)}</dd>
                </div>
              </dl>
            ) : c.profile_key === "internal-image2-v1" ? (
              <dl>
                <div>
                  <dt>{t("每張圖片", "Per image")}</dt>
                  <dd>{price(c.micros_per_image)}</dd>
                </div>
              </dl>
            ) : null}
          </div>
        ))}
        <dl>
          <div>
            <dt>{t("技能版本", "Method versions")}</dt>
            <dd>
              {value.skills.map((s) => (
                <span className="adoption-method" key={s.key}>
                  {s.key} · {s.version}
                </span>
              ))}
            </dd>
          </div>
          <div>
            <dt>{t("可用工具", "Allowed tools")}</dt>
            <dd>
              {value.tool_ids.length} {t("項", "tools")}
            </dd>
          </div>
          <div>
            <dt>{t("品牌版本", "Brand version")}</dt>
            <dd>
              {value.brand
                ? `v${value.brand.version}`
                : t("未綁定", "No binding")}
            </dd>
          </div>
        </dl>
      </section>
    );
  }
  return (
    <div className="adoption-review" aria-busy={busy}>
      <p>
        {t(
          "確認本次採用的模型、單價與技能。變更只用於之後的新工作；已接收工作保留原版本與原費率。",
          "Review the models, rates and methods you are adopting. Changes apply to future tasks; accepted tasks keep their original versions and rates.",
        )}
      </p>
      <ErrorNotice error={error} />
      {preview && (
        <>
          {preview.comparison.data_mode === "simulated" && (
            <p className="adoption-unknown">
              {t(
                "目前使用示範模型與示範費率。",
                "Demo models and demo rates are in use.",
              )}
            </p>
          )}
          <p className="small-text muted">
            {t("本次變更", "Changes")}:{" "}
            {preview.comparison.changed_fields
              .map((f) => fields[f])
              .join(" · ") ||
              t(
                "沿用相同配置，建立新版",
                "Keep the same settings in a new version",
              )}
          </p>
          <div className="adoption-columns">
            {column(
              preview.comparison.source,
              t("目前採用", "Currently adopted"),
            )}
            {column(
              preview.comparison.target,
              t("確認後採用", "After confirmation"),
            )}
          </div>
          <p className="small-text muted">
            {t("比較有效至", "Comparison expires")}{" "}
            <DateText value={preview.expires_at} />
          </p>
          <label className="check-line">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
            />
            {t(
              "我已核對上述模型與單價",
              "I have reviewed these models and rates",
            )}
          </label>
        </>
      )}
      <div className="row-actions">
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            void (async () => {
              if (invalid) await completeOperation(account, endpoint, proposal);
              onBack(invalid);
            })()
          }
        >
          {invalid
            ? t("重新載入設定", "Reload settings")
            : t("返回編輯", "Back to edit")}
        </button>
        {!invalid && (!preview || !verified) && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void compare()}
          >
            <RefreshCw size={16} />
            {t("重試比較", "Retry comparison")}
          </button>
        )}
        {preview && (
          <button
            className="button primary"
            disabled={busy || !verified || !consent}
            onClick={() => void confirm()}
          >
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Check size={17} />
            )}{" "}
            {t("確認採用並儲存", "Confirm adoption and save")}
          </button>
        )}
      </div>
      {busy && (
        <p className="small-text muted" role="status">
          {t("正在核對並處理…", "Checking and processing…")}
        </p>
      )}
    </div>
  );
}
