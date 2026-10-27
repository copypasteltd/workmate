import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  LockKeyhole,
  Play,
  SlidersHorizontal,
} from "lucide-react";
import { api, ApiError, download } from "./api";
import { useWorkspace } from "./context";
import {
  Badge,
  ErrorNotice,
  Loading,
  Money,
  PageHeader,
  useData,
  useI18n,
} from "./ui";
import "./media-effects.css";

type Source = {
  asset_id: string;
  asset_version_id: string;
  sha256: string;
  name: string;
  version: number;
  bytes: number;
  mime_type: string;
};
type Effect = {
  id: string;
  version: string;
  name_zh: string;
  name_en: string;
  category: string;
  description: string;
  defaults: Record<string, string | number>;
  source_count: number;
  definition_sha256: string;
  input_schema: any;
};
type Catalog = {
  items: Effect[];
  version: string;
  catalog_sha256: string;
  output_sizes: string[];
  available: boolean;
};
type Attempt = {
  key: string;
  body: { title: string; budget_micros: number; request: any };
};
const sample = (id: string, extension: string) =>
  "/effects/1.0.0/" + id.replaceAll(".", "-") + "." + extension;
const captions: Record<string, string> = {
  "transition.crossfade": "讓兩段畫面自然交融。",
  "transition.slide-left": "以向左推移銜接下一段畫面。",
  "transition.wipe-right": "由左至右揭示下一段畫面。",
  "transition.dip-black": "經過黑場，再帶出下一段畫面。",
  "text.fade-in": "讓核准文案柔和地進入畫面。",
  "text.slide-up": "從畫面下方帶出重點文案。",
  "key.chroma": "移除指定色鍵，合成到純色背景。",
  "cleanup.denoise": "減少雜訊，同時可能柔化細節。",
  "cleanup.sharpen": "增加邊緣對比，不能還原遺失的細節。",
  "cleanup.exposure": "調整曝光、對比和伽瑪；不能修復已裁切資訊。",
};

export function MediaEffects() {
  const w = useWorkspace();
  return (
    <EffectsWorkspace key={`${w.me?.user?.id}:${w.tenant}:${w.project}`} />
  );
}
function EffectsWorkspace() {
  const w = useWorkspace(),
    { t, locale } = useI18n(),
    [query, setQuery] = useSearchParams();
  const catalog = useData<Catalog>(w.base ? w.base + "/effects/catalog" : null);
  const [after, setAfter] = useState<string[]>([]),
    [refresh, setRefresh] = useState(0);
  const sourcePage = useData<{ items: Source[]; next_after_id: string | null }>(
    w.base
      ? w.base +
          "/effects/sources" +
          (after.length ? "?after_id=" + after.at(-1) : "")
      : null,
    refresh,
  );
  const [selected, setSelected] = useState("transition.crossfade"),
    [category, setCategory] = useState("all");
  const [parameters, setParameters] = useState<Record<string, string | number>>(
    { transition_seconds: "1" },
  );
  const [sources, setSources] = useState<(Source | undefined)[]>([]),
    [size, setSize] = useState("1280x720"),
    [seconds, setSeconds] = useState("4"),
    [budget, setBudget] = useState("5"),
    [title, setTitle] = useState("");
  const storageKey =
    "cp_work_selection_v1:effects:" +
    [w.me?.user?.id, w.tenant, w.project].map(encodeURIComponent).join(":");
  const [saved] = useState(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return {};
      const value = JSON.parse(raw);
      if (
        value.scope?.user !== w.me?.user?.id ||
        value.scope?.tenant !== w.tenant ||
        value.scope?.project !== w.project ||
        raw.length > 128000 ||
        (value.pending &&
          (!/^[a-f0-9-]{36}$/.test(value.pending.key) ||
            !value.pending.body?.request)) ||
        (value.result && !/^[a-f0-9-]{36}$/.test(value.result))
      )
        throw new Error();
      return value;
    } catch {
      return { invalid: true };
    }
  });
  const [pending, setPending] = useState<Attempt | undefined>(saved.pending),
    [result, setResult] = useState<string | undefined>(saved.result),
    [error, setError] = useState<Error | null>(
      saved.invalid
        ? new Error(
            t(
              "儲存的提交無法核對，請聯絡支援，避免重複扣費。",
              "The saved submission cannot be verified. Contact support to avoid duplicate work.",
            ),
          )
        : null,
    );
  const [busy, setBusy] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [confirmed, setConfirmed] = useState(false);
  const lock = useRef(false),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      live.current = false;
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const definition = catalog.data?.items.find((e) => e.id === selected);
  const name = (e: Effect) => (locale === "en" ? e.name_en : e.name_zh);
  function persist(value: Record<string, unknown>) {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        scope: { user: w.me?.user?.id, tenant: w.tenant, project: w.project },
        ...value,
      }),
    );
  }
  function choose(effect: Effect) {
    if (pending || busy) return;
    setSelected(effect.id);
    setParameters({ ...effect.defaults });
    setSources([]);
    setConfirmed(false);
    setError(null);
  }
  async function submit() {
    if (
      !definition ||
      lock.current ||
      saved.invalid ||
      !online ||
      window.copyPasteBridge
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    let attempt = pending;
    try {
      if (!attempt) {
        if (
          !confirmed ||
          sources.slice(0, definition.source_count).filter(Boolean).length !==
            definition.source_count
        )
          throw new Error(
            t(
              "請先選取素材並確認費用。",
              "Choose sources and confirm the budget first.",
            ),
          );
        const amount = Math.round(Number(budget) * 1_000_000);
        if (
          !Number.isSafeInteger(amount) ||
          amount < 1_000_000 ||
          amount > 10_000_000_000
        )
          throw new Error(t("請輸入有效預算。", "Enter a valid budget."));
        attempt = {
          key: crypto.randomUUID(),
          body: {
            title: title.trim() || name(definition),
            budget_micros: amount,
            request: {
              schema: "copypaste-media-effect-1",
              effect_id: definition.id,
              version: definition.version,
              output: { size, seconds: Number(seconds) },
              sources: sources
                .slice(0, definition.source_count)
                .map((s) => ({
                  asset_version_id: s!.asset_version_id,
                  sha256: s!.sha256,
                })),
              parameters: { ...parameters },
            },
          },
        };
        // Save the exact attempt before payment admission. Failed storage stops
        // dispatch, and uncertain replies keep the same key across reloads.
        persist({ pending: attempt });
        setPending(attempt);
      }
      const accepted = await api<{ id: string }>(w.base + "/effects/tasks", {
        method: "POST",
        headers: { "Idempotency-Key": attempt.key },
        body: JSON.stringify(attempt.body),
      });
      persist({ result: accepted.id });
      if (live.current) {
        setPending(undefined);
        setResult(accepted.id);
        setQuery({ task: accepted.id });
        setConfirmed(false);
      }
    } catch (failure) {
      const rejected =
        failure instanceof ApiError &&
        failure.status >= 400 &&
        failure.status < 500 &&
        ![401, 408, 425, 429].includes(failure.status) &&
        ![
          "SESSION_CHANGED",
          "IDEMPOTENCY_CONFLICT",
          "REQUEST_RESULT_REMOVED",
        ].includes(failure.code);
      if (live.current) {
        if (rejected && attempt) {
          persist({});
          setPending(undefined);
          setConfirmed(false);
        }
        setError(failure as Error);
      }
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  }
  const task = query.get("task") ?? result;
  const disabled = busy || !!pending || !!saved.invalid;
  return (
    <div className="effects-page">
      <PageHeader
        eyebrow="CREATIVE / MOTION"
        title={t("讓畫面，多一點可能。", "A little motion. More possibility.")}
        description={t(
          "選擇效果、放入素材，以你的方式完成下一個版本。",
          "Choose an effect, bring your materials, and make the next version yours.",
        )}
      />
      <ErrorNotice error={error ?? catalog.error} />
      {window.copyPasteBridge && (
        <div className="notice">
          {t(
            "請在本機對話中請影片設計師執行特效，並授權所需素材；本機 Agent 保持在你的電腦執行。",
            "Ask your local video specialist to run an effect and authorize its materials. Your Desktop Agent runs on your computer.",
          )}
        </div>
      )}
      {catalog.loading && !catalog.data ? (
        <Loading />
      ) : (
        catalog.data && (
          <>
            <div
              className="effects-filter"
              role="group"
              aria-label={t("效果類別", "Effect categories")}
            >
              {[
                ["all", "全部效果", "All effects"],
                ["transition", "轉場", "Transitions"],
                ["text", "文字動效", "Text motion"],
                ["key", "合成", "Compositing"],
                ["cleanup", "畫面修正", "Cleanup"],
              ].map(([key, zh, en]) => (
                <button
                  key={key}
                  type="button"
                  className={category === key ? "active" : ""}
                  aria-pressed={category === key}
                  onClick={() => setCategory(key)}
                >
                  {t(zh, en)}
                </button>
              ))}
              <span>
                10 {t("個預設", "presets")} · v{catalog.data.version}
              </span>
            </div>
            <div className="effects-grid">
              {catalog.data.items
                .filter((e) => category === "all" || e.category === category)
                .map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={
                      "effect-card" + (selected === e.id ? " selected" : "")
                    }
                    data-effect-id={e.id}
                    aria-pressed={selected === e.id}
                    disabled={disabled}
                    onClick={() => choose(e)}
                  >
                    <img src={sample(e.id, "png")} alt="" loading="lazy" />
                    <div>
                      <span className="effect-number">
                        {String(catalog.data!.items.indexOf(e) + 1).padStart(
                          2,
                          "0",
                        )}{" "}
                        / {e.category.toUpperCase()}
                      </span>
                      <h2>
                        {name(e)}
                        {selected === e.id && <Check size={18} />}
                      </h2>
                      <p>{t(captions[e.id], e.description)}</p>
                    </div>
                  </button>
                ))}
            </div>
            {definition && (
              <section
                className="effect-studio"
                aria-label={t("設定效果", "Configure effect")}
              >
                <div className="effect-preview">
                  <div className="effect-section-label">
                    <Play size={15} />
                    {t("看看它如何呈現", "See it in motion")}
                  </div>
                  <video
                    key={definition.id}
                    controls
                    playsInline
                    preload="metadata"
                    poster={sample(definition.id, "png")}
                    src={sample(definition.id, "mp4")}
                    aria-label={name(definition) + t("示例", " example")}
                  />
                  <p>
                    {t(
                      "示例使用原創測試圖形。你的成果將由下方選定的素材製作。",
                      "This example uses original test artwork. Your result will use the materials selected below.",
                    )}
                  </p>
                  <div className="effect-spec">
                    <span>
                      <Film size={16} />
                      24 fps
                    </span>
                    <span>{t("無音訊 MP4", "Silent MP4")}</span>
                    <span>v{definition.version}</span>
                  </div>
                  <div className="effect-preview-notes">
                    <LockKeyhole size={18} />
                    <p>
                      {t(
                        "保留原始素材。每次交付包含影片、預覽、設定源文件和 ZIP。",
                        "Your originals stay intact. Each delivery includes the video, preview, settings source and ZIP.",
                      )}
                    </p>
                  </div>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  <div className="effect-section-label">
                    <SlidersHorizontal size={15} />
                    {t("做成你的版本", "Make it yours")}
                  </div>
                  <h2>{name(definition)}</h2>
                  <fieldset disabled={disabled} className="effect-fields">
                    <label>
                      {t("工作名稱", "Task name")}
                      <input
                        maxLength={160}
                        value={title}
                        placeholder={name(definition)}
                        onChange={(e) => {
                          setTitle(e.target.value);
                          setConfirmed(false);
                        }}
                      />
                    </label>
                    <div className="effect-source-heading">
                      <span>{t("專案素材", "Project materials")}</span>
                      <Link to="/app/assets">
                        {t("上傳素材", "Upload materials")}
                        <ArrowUpRight size={14} />
                      </Link>
                    </div>
                    <ErrorNotice error={sourcePage.error} />
                    {Array.from({ length: definition.source_count }, (_, i) => (
                      <label key={i}>
                        {t("素材", "Source")} {i + 1}
                        <select
                          required
                          value={sources[i]?.asset_version_id ?? ""}
                          onChange={(e) => {
                            const chosen = sourcePage.data?.items.find(
                              (s) => s.asset_version_id === e.target.value,
                            );
                            setSources((previous) => {
                              const next = [...previous];
                              next[i] = chosen;
                              return next;
                            });
                            setConfirmed(false);
                          }}
                        >
                          <option value="">
                            {t(
                              "選取 PNG 或 H.264 MP4",
                              "Choose a PNG or H.264 MP4",
                            )}
                          </option>
                          {sources[i] &&
                            !sourcePage.data?.items.some(
                              (s) =>
                                s.asset_version_id ===
                                sources[i]!.asset_version_id,
                            ) && (
                              <option value={sources[i]!.asset_version_id}>
                                {sources[i]!.name} · v{sources[i]!.version}
                              </option>
                            )}
                          {sourcePage.data?.items.map((s) => (
                            <option
                              key={s.asset_version_id}
                              value={s.asset_version_id}
                            >
                              {s.name} · v{s.version}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                    <div className="effects-source-pages">
                      <button
                        type="button"
                        className="text-button"
                        disabled={!after.length || sourcePage.loading}
                        onClick={() => setAfter((v) => v.slice(0, -1))}
                      >
                        <ChevronLeft size={16} />
                        {t("上一頁", "Previous sources")}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        disabled={
                          !sourcePage.data?.next_after_id || sourcePage.loading
                        }
                        onClick={() =>
                          setAfter((v) => [
                            ...v,
                            sourcePage.data!.next_after_id!,
                          ])
                        }
                      >
                        {t("下一頁", "Next sources")}
                        <ChevronRight size={16} />
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        disabled={sourcePage.loading}
                        onClick={() => setRefresh((v) => v + 1)}
                      >
                        {t("重新整理", "Refresh sources")}
                      </button>
                    </div>
                    {!sourcePage.loading &&
                      sourcePage.data?.items.length === 0 && (
                        <p className="form-footnote">
                          {t(
                            "此頁沒有可選素材。請先上傳已獲授權的專案素材；私人會話檔案請在原會話中使用。",
                            "No eligible materials on this page. Upload authorized project materials first; use private conversation files in their original conversation.",
                          )}
                        </p>
                      )}
                    <div className="effect-field-pair">
                      <label>
                        {t("輸出尺寸", "Output size")}
                        <select
                          value={size}
                          onChange={(e) => {
                            setSize(e.target.value);
                            setConfirmed(false);
                          }}
                        >
                          {catalog.data.output_sizes.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {t("影片秒數", "Duration in seconds")}
                        <input
                          type="number"
                          min={2}
                          max={12}
                          step={1}
                          required
                          value={seconds}
                          onChange={(e) => {
                            setSeconds(e.target.value);
                            setConfirmed(false);
                          }}
                        />
                      </label>
                    </div>
                    {Object.entries(definition.defaults).map(
                      ([key, fallback]) => {
                        const schema =
                            definition.input_schema.properties.parameters
                              .properties[key],
                          value = parameters[key] ?? fallback;
                        const labels: Record<string, [string, string]> = {
                          transition_seconds: [
                            "轉場秒數",
                            "Transition seconds",
                          ],
                          entrance_seconds: ["進場秒數", "Entrance seconds"],
                          text: ["顯示文案", "Display text"],
                          color: ["文字顏色", "Text color"],
                          font_size: ["文字大小", "Font size"],
                          position: ["文字位置", "Text position"],
                          key_color: ["色鍵顏色", "Key color"],
                          similarity: ["相似度", "Similarity"],
                          blend: ["邊緣混合", "Edge blend"],
                          background: ["背景顏色", "Background color"],
                          strength: ["降噪強度", "Denoise strength"],
                          amount: ["銳化強度", "Sharpen amount"],
                          brightness: ["亮度", "Brightness"],
                          contrast: ["對比", "Contrast"],
                          gamma: ["伽瑪", "Gamma"],
                        };
                        const update = (v: string) => {
                          setParameters((p) => ({
                            ...p,
                            [key]: typeof fallback === "number" ? Number(v) : v,
                          }));
                          setConfirmed(false);
                        };
                        return (
                          <label key={key}>
                            {t(...labels[key])}
                            {schema.enum ? (
                              <select
                                value={String(value)}
                                onChange={(e) => update(e.target.value)}
                              >
                                {schema.enum.map((s: string) => (
                                  <option key={s} value={s}>
                                    {s === "center"
                                      ? t("置中", "Center")
                                      : s === "lower_third"
                                        ? t("下方安全區", "Lower third")
                                        : s}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type={
                                  typeof fallback === "number"
                                    ? "number"
                                    : key.includes("color") ||
                                        key === "background"
                                      ? "color"
                                      : "text"
                                }
                                min={schema.minimum}
                                max={schema.maximum}
                                maxLength={schema.maxLength}
                                step={key === "font_size" ? 1 : "any"}
                                required
                                value={value}
                                onChange={(e) => update(e.target.value)}
                              />
                            )}
                          </label>
                        );
                      },
                    )}
                    <p className="form-footnote">
                      {t(
                        "PNG / H.264 MP4，每份上限 32 MiB、1920 px；影片最長 60 秒且須覆蓋所需片段。原音訊不會保留。",
                        "PNG / H.264 MP4, up to 32 MiB and 1920 px each. Video must cover the required interval and stay within 60 seconds. Original audio is omitted.",
                      )}
                    </p>
                    <label>
                      {t("本次費用上限（HKD）", "Task budget limit (HKD)")}
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        step="0.01"
                        value={budget}
                        required
                        onChange={(e) => {
                          setBudget(e.target.value);
                          setConfirmed(false);
                        }}
                      />
                    </label>
                    <label className="effect-consent">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      <span>
                        {t(
                          "我確認素材、參數及無音訊輸出，並批准本次 Agent 費用上限。",
                          "I confirm these materials, parameters and silent output, and approve this Agent budget limit.",
                        )}
                      </span>
                    </label>
                  </fieldset>
                  {pending && (
                    <div className="notice" role="status">
                      <p>
                        {t(
                          "原提交已保存。重試會沿用相同素材、參數、預算及請求編號。",
                          "The original submission is saved. Retry keeps its materials, parameters, budget and request ID.",
                        )}
                      </p>
                      <strong>
                        {pending.body.title} ·{" "}
                        <Money value={pending.body.budget_micros} />
                      </strong>
                    </div>
                  )}
                  {pending && (
                    <details className="effect-saved-request">
                      <summary>
                        {t("檢視原提交的完整設定", "Review original settings")}
                      </summary>
                      <pre>{JSON.stringify(pending.body.request, null, 2)}</pre>
                    </details>
                  )}
                  <button
                    type="submit"
                    className="button primary"
                    disabled={
                      busy ||
                      saved.invalid ||
                      !online ||
                      !!window.copyPasteBridge ||
                      !catalog.data.available ||
                      (!pending && (!confirmed || !sourcePage.data))
                    }
                  >
                    {busy
                      ? t("正在核對提交…", "Checking submission…")
                      : pending
                        ? t("重試原提交", "Retry original submission")
                        : t("確認並製作", "Confirm & create")}
                    <ArrowUpRight size={16} />
                  </button>
                  <p className="form-footnote">
                    {t(
                      "提交時預留預算，依實際 Agent 用量結算；特效渲染本身不新增模型請求或 AI 費用。",
                      "Budget is reserved on submission and settled against measured Agent usage. Effect rendering adds no model request or AI fee.",
                    )}
                  </p>
                </form>
              </section>
            )}
          </>
        )
      )}
      {task && /^[a-f0-9-]{36}$/.test(task) && (
        <EffectDelivery key={w.base + task} taskId={task} />
      )}
    </div>
  );
}
export function EffectDelivery({ taskId }: { taskId: string }) {
  const w = useWorkspace(),
    { t } = useI18n(),
    [error, setError] = useState<Error | null>(null);
  const read = useData<any>(
    w.base + "/effects/tasks/" + taskId,
    0,
    3000,
    w.tenant,
    { retainOnRefresh: true },
  );
  const result = read.data?.delivery,
    video = result?.files.find((f: any) => f.mime_type === "video/mp4"),
    poster = result?.files.find((f: any) => f.mime_type === "image/png");
  if (read.data && !read.data.request && !result) return null;
  return (
    <section
      className="effect-delivery"
      aria-label={t("特效成果", "Effect delivery")}
    >
      <div className="effect-section-label">
        <Film size={16} />
        {t("你的下一個版本", "Your next version")}
      </div>
      <h2>{t("成果與源文件", "Video & source files")}</h2>
      <ErrorNotice error={read.error ?? error} />
      {read.data && (
        <>
          <div className="effect-delivery-status">
            <Badge value={read.data.status} />
            <Link to={"/app/tasks/" + taskId}>
              {t("查看工作與費用", "View task & usage")}
              <ArrowUpRight size={14} />
            </Link>
          </div>
          {video && !window.copyPasteBridge && (
            <video
              controls
              playsInline
              preload="metadata"
              aria-label={t("特效成果影片", "Effect result video")}
              poster={
                poster
                  ? `${w.base}/assets/${poster.asset_id}/download?version=${poster.version}`
                  : undefined
              }
              src={`${w.base}/assets/${video.asset_id}/download?version=${video.version}`}
            />
          )}
          {result ? (
            <>
              <p>
                {result.probe.width} × {result.probe.height} ·{" "}
                {result.probe.seconds}s · 24 fps · {t("無音訊", "No audio")}
              </p>
              <div className="effect-downloads">
                {result.files.map((f: any) => (
                  <button
                    key={f.asset_version_id}
                    className="button secondary"
                    onClick={() => {
                      setError(null);
                      void download(
                        `${w.base}/assets/${f.asset_id}/download?version=${f.version}`,
                        f.name,
                        w.tenant,
                      ).catch(setError);
                    }}
                  >
                    <Download size={15} />
                    {f.name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p>
              {["failed", "cancelled"].includes(read.data.status)
                ? t(
                    "本次工作沒有可用的特效成果，請查看工作記錄。",
                    "This task has no available effect delivery. Review its task record.",
                  )
                : t(
                    "正在準備成果；可離開此頁，稍後回來查看。",
                    "Your delivery is being prepared. You can leave and come back later.",
                  )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
