import { useEffect, useRef, useState } from "react";
import {
  Grid2X2,
  Plus,
  ArrowUpRight,
  Download,
  RotateCcw,
  Pencil,
  Image as ImageIcon,
  X,
} from "lucide-react";
import { post, download } from "./api";
import {
  AsyncForm,
  ErrorNotice,
  Field,
  Modal,
  Badge as Status,
  useData,
  useI18n,
} from "./ui";
import "./creative-matrices.css";

type Copy = {
  brand_line: string;
  headline: string;
  body: string;
  action: string;
};
type Size = { key: string; name: string; width: number; height: number };
type Creative = {
  key: string;
  name: string;
  theme: { background: string; ink: string; accent: string };
  image: { asset_id: string; version: number } | null;
  copy: { locale: string; text: Copy }[];
};
type Unit = {
  id: string;
  creative_key: string;
  locale: string;
  size_key: string;
  revision: number;
  state: string;
  error_code: string | null;
  source_available: boolean;
  input: {
    creative_name: string;
    size: Size;
    copy: Copy;
    image: Creative["image"];
  };
  attempts: {
    id: string;
    revision: number;
    state: string;
    error_code: string | null;
    png_asset_id: string | null;
    svg_asset_id: string | null;
    source_asset_id: string | null;
    ai_cost_micros: string;
    elapsed_ms: number | null;
    output_available: boolean;
  }[];
};
type Batch = {
  id: string;
  name: string;
  version: number;
  cancelled: boolean;
  state: string;
  counts: Record<string, number>;
  units: Unit[];
};
const sizes: Size[] = [
  { key: "square", name: "Square", width: 1080, height: 1080 },
  { key: "portrait", name: "Portrait", width: 1080, height: 1350 },
  { key: "landscape", name: "Landscape", width: 1200, height: 628 },
];
const emptyCopy = (): Copy => ({
  brand_line: "",
  headline: "",
  body: "",
  action: "",
});
function draft(index: number): Creative {
  return {
    key: "creative-" + crypto.randomUUID().slice(0, 8),
    name: `Creative ${index}`,
    theme: { background: "#F6F6F4", ink: "#15171A", accent: "#1F5EFF" },
    image: null,
    copy: [
      { locale: "zh-HK", text: emptyCopy() },
      { locale: "en", text: emptyCopy() },
    ],
  };
}
function CopyFields({
  value,
  onChange,
  prefix = "",
}: {
  value: Copy;
  onChange: (value: Copy) => void;
  prefix?: string;
}) {
  const { t } = useI18n();
  const fields: [keyof Copy, string, number][] = [
    ["brand_line", t("品牌行", "Brand line"), 80],
    ["headline", t("標題", "Headline"), 240],
    ["body", t("正文", "Body copy"), 800],
    ["action", t("行動文案", "Call to action"), 100],
  ];
  return (
    <>
      {fields.map(([key, label, max]) => (
        <Field key={key} label={prefix + label}>
          {key === "body" ? (
            <textarea
              value={value[key]}
              maxLength={max}
              rows={3}
              onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            />
          ) : (
            <input
              value={value[key]}
              maxLength={max}
              required={key === "headline"}
              onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            />
          )}
        </Field>
      ))}
    </>
  );
}
function ImageChoice({
  value,
  assets,
  onChange,
}: {
  value: Creative["image"];
  assets: any[];
  onChange: (v: Creative["image"]) => void;
}) {
  const { t } = useI18n();
  return (
    <Field label={t("固定版本的專案 PNG", "Fixed project PNG version")}>
      <select
        value={value ? value.asset_id + ":" + value.version : ""}
        onChange={(e) => {
          const a = assets.find(
            (a) => a.id + ":" + a.current_version === e.target.value,
          );
          onChange(a ? { asset_id: a.id, version: a.current_version } : null);
        }}
      >
        <option value="">{t("文字與圖形", "Text and shapes")}</option>
        {assets
          .filter((a) => a.mime_type === "image/png" && !a.private_owner)
          .map((a) => (
            <option key={a.id} value={a.id + ":" + a.current_version}>
              {a.name} · v{a.current_version}
            </option>
          ))}
        {value &&
          !assets.some(
            (a) =>
              a.id === value.asset_id && a.current_version === value.version,
          ) && (
            <option value={value.asset_id + ":" + value.version}>
              {t("原固定圖片版本", "Original fixed image version")} · v
              {value.version}
            </option>
          )}
      </select>
    </Field>
  );
}
function CreateBatch({
  base,
  assets,
  onDone,
}: {
  base: string;
  assets: any[];
  onDone: (id: string) => void;
}) {
  const { t } = useI18n(),
    [creatives, setCreatives] = useState<Creative[]>(() => [draft(1)]),
    [locales, setLocales] = useState(["zh-HK", "en"]),
    [selectedSizes, setSelectedSizes] = useState<Size[]>(sizes),
    request = useRef<{ signature: string; key: string } | null>(null);
  const count = creatives.length * locales.length * selectedSizes.length;
  const change = (i: number, next: Creative) => {
    setCreatives((v) => v.map((old, n) => (n === i ? next : old)));
  };
  return (
    <AsyncForm
      submitLabel={t(
        `建立 ${count} 個交付單元`,
        `Create ${count} delivery units`,
      )}
      onSubmit={async (f) => {
        if (!count || count > 60)
          throw new Error(
            t(
              "每批需要 1–60 個單元，請調整創意、語言或尺寸。",
              "Choose between 1 and 60 units by adjusting creatives, languages or sizes.",
            ),
          );
        const body = {
          name: String(f.get("batch_name")),
          locales,
          sizes: selectedSizes,
          creatives: creatives.map((c) => ({
            ...c,
            copy: c.copy.filter((p) => locales.includes(p.locale)),
          })),
        };
        // A retained request key retries the exact submitted body after unknown responses.
        const signature = JSON.stringify(body);
        if (request.current?.signature !== signature)
          request.current = { signature, key: crypto.randomUUID() };
        const result = await post(
          base + "/creative-batches",
          body,
          request.current.key,
        );
        onDone(result.id);
      }}
    >
      <p className="muted">
        {t(
          "文案與圖片由你提供，每個尺寸重新排版。AI 費用 HK$0。",
          "Provide your copy and images. Each size gets its own layout. AI cost HK$0.",
        )}
      </p>
      <Field label={t("批次名稱", "Batch name")}>
        <input
          name="batch_name"
          defaultValue={t("香港活動素材", "Hong Kong campaign")}
          maxLength={160}
          required
        />
      </Field>
      <fieldset className="matrix-options">
        <legend>{t("語言", "Languages")}</legend>
        {[
          ["zh-HK", "繁體中文"],
          ["en", "English"],
        ].map(([l, name]) => (
          <label key={l}>
            <input
              type="checkbox"
              checked={locales.includes(l)}
              onChange={(e) =>
                setLocales((v) =>
                  e.target.checked ? [...v, l] : v.filter((old) => old !== l),
                )
              }
            />
            {name}
          </label>
        ))}
      </fieldset>
      <fieldset className="matrix-options">
        <legend>{t("輸出尺寸", "Output sizes")}</legend>
        {sizes.map((s) => (
          <label key={s.key}>
            <input
              type="checkbox"
              checked={selectedSizes.some((a) => a.key === s.key)}
              onChange={(e) =>
                setSelectedSizes((v) =>
                  e.target.checked
                    ? [...v, s]
                    : v.filter((a) => a.key !== s.key),
                )
              }
            />
            {s.width} × {s.height}
          </label>
        ))}
      </fieldset>
      {selectedSizes
        .filter((s) => !sizes.some((preset) => preset.key === s.key))
        .map((s) => (
          <fieldset key={s.key} className="matrix-custom-size">
            <legend>{t("自訂尺寸", "Custom size")}</legend>
            <Field label={t("尺寸名稱", "Size name")}>
              <input
                value={s.name}
                maxLength={160}
                required
                onChange={(e) =>
                  setSelectedSizes((v) =>
                    v.map((a) =>
                      a.key === s.key ? { ...a, name: e.target.value } : a,
                    ),
                  )
                }
              />
            </Field>
            {(["width", "height"] as const).map((dimension) => (
              <Field
                key={dimension}
                label={
                  dimension === "width"
                    ? t("寬度 px", "Width px")
                    : t("高度 px", "Height px")
                }
              >
                <input
                  type="number"
                  min={256}
                  max={2048}
                  step={1}
                  required
                  value={Number.isFinite(s[dimension]) ? s[dimension] : ""}
                  onChange={(e) =>
                    setSelectedSizes((v) =>
                      v.map((a) =>
                        a.key === s.key
                          ? { ...a, [dimension]: e.target.valueAsNumber }
                          : a,
                      ),
                    )
                  }
                />
              </Field>
            ))}
            <button
              className="icon-button"
              type="button"
              aria-label={t("移除尺寸", "Remove size") + " " + s.name}
              onClick={() =>
                setSelectedSizes((v) => v.filter((a) => a.key !== s.key))
              }
            >
              <X size={18} />
            </button>
          </fieldset>
        ))}
      <button
        type="button"
        className="text-button"
        disabled={selectedSizes.length >= 10}
        onClick={() =>
          setSelectedSizes((v) => [
            ...v,
            {
              key: "custom-" + crypto.randomUUID().slice(0, 8),
              name: t("自訂版位", "Custom format"),
              width: 1080,
              height: 1920,
            },
          ])
        }
      >
        <Plus size={16} />
        {t("自訂尺寸 · 256–2048 px", "Custom size · 256–2048 px")}
      </button>
      {creatives.map((c, index) => (
        <fieldset className="matrix-creative" key={c.key}>
          <legend>
            {t("創意方向", "Creative")} {index + 1}
          </legend>
          <div className="matrix-creative-heading">
            <Field label={t("方向名稱", "Creative name")}>
              <input
                value={c.name}
                maxLength={160}
                required
                onChange={(e) => change(index, { ...c, name: e.target.value })}
              />
            </Field>
            {creatives.length > 1 && (
              <button
                type="button"
                className="icon-button"
                aria-label={t(
                  `移除創意 ${index + 1}`,
                  `Remove creative ${index + 1}`,
                )}
                onClick={() =>
                  setCreatives((v) => v.filter((_, n) => n !== index))
                }
              >
                <X size={18} />
              </button>
            )}
          </div>
          <ImageChoice
            value={c.image}
            assets={assets}
            onChange={(image) => change(index, { ...c, image })}
          />
          <div className="matrix-colors">
            {(["background", "ink", "accent"] as const).map((key) => (
              <Field
                key={key}
                label={
                  key === "background"
                    ? t("背景", "Background")
                    : key === "ink"
                      ? t("文字色", "Text color")
                      : t("重點色", "Accent")
                }
              >
                <input
                  type="color"
                  value={c.theme[key]}
                  onChange={(e) =>
                    change(index, {
                      ...c,
                      theme: { ...c.theme, [key]: e.target.value },
                    })
                  }
                />
              </Field>
            ))}
          </div>
          <div className="matrix-copy-languages">
            {c.copy
              .filter((v) => locales.includes(v.locale))
              .map((p) => (
                <section key={p.locale} aria-label={c.name + " " + p.locale}>
                  <h4>{p.locale === "zh-HK" ? "繁體中文" : "English"}</h4>
                  <CopyFields
                    value={p.text}
                    onChange={(text) =>
                      change(index, {
                        ...c,
                        copy: c.copy.map((old) =>
                          old.locale === p.locale ? { ...old, text } : old,
                        ),
                      })
                    }
                  />
                </section>
              ))}
          </div>
        </fieldset>
      ))}
      <button
        className="button secondary"
        type="button"
        disabled={creatives.length >= 30}
        onClick={() => setCreatives((v) => [...v, draft(v.length + 1)])}
      >
        <Plus size={16} />
        {t("新增創意方向", "Add creative")}
      </button>
      <div
        className={`matrix-unit-count ${count > 60 || !count ? "invalid" : ""}`}
        role="status"
      >
        {creatives.length} × {locales.length} × {selectedSizes.length} ={" "}
        <strong>{count}</strong>{" "}
        {t("單元 · 每批上限 60", "units · maximum 60 per batch")}
      </div>
    </AsyncForm>
  );
}

function UnitPreview({
  base,
  asset,
  label,
}: {
  base: string;
  asset: string;
  label: string;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false),
    mount = useRef<HTMLDivElement>(null);
  const result = useData<{ base64: string }>(
    visible ? base + "/assets/" + asset + "/thumbnail" : null,
    0,
    15000,
  );
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "100px" },
    );
    if (mount.current) observer.observe(mount.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="matrix-unit-preview" ref={mount}>
      {result.data ? (
        <img
          src={"data:image/png;base64," + result.data.base64}
          alt={label}
          loading="lazy"
        />
      ) : (
        <ImageIcon size={26} aria-hidden="true" />
      )}
      {result.error && <span>{t("預覽暫不可用", "Preview unavailable")}</span>}
    </div>
  );
}
function EditUnit({
  base,
  batch,
  unit,
  assets,
  newRevision,
  onReload,
  onDone,
}: {
  base: string;
  batch: Batch;
  unit: Unit;
  assets: any[];
  newRevision: number | null;
  onReload: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    [copy, setCopy] = useState(unit.input.copy),
    [image, setImage] = useState<Creative["image"]>(() =>
      unit.input.image
        ? {
            asset_id: unit.input.image.asset_id,
            version: unit.input.image.version,
          }
        : null,
    ),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    saved = useRef<{ signature: string; key: string } | null>(null);
  async function retry() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const signature = "retry:" + unit.revision;
    if (saved.current?.signature !== signature)
      saved.current = { signature, key: crypto.randomUUID() };
    try {
      await post(
        `${base}/creative-batches/${batch.id}/units/${unit.id}/retry`,
        { expected_revision: unit.revision },
        saved.current.key,
      );
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="muted">
        {unit.input.creative_name} · {unit.locale} · {unit.input.size.width} ×{" "}
        {unit.input.size.height} · r{unit.revision}
      </p>
      <Status value={unit.state === "rendering" ? "running" : unit.state} />
      <ErrorNotice error={error} />
      {newRevision && (
        <div className="notice" role="status">
          <p>
            {t(
              `其他操作已儲存 r${newRevision}。你的未儲存文案保留在此；載入新版本後再編輯。`,
              `Another action saved r${newRevision}. Your unsaved copy is preserved here; load the new revision before editing.`,
            )}
          </p>
          <button className="text-button" onClick={onReload}>
            {t(
              "捨棄此草稿並載入新版本",
              "Discard this draft and load new revision",
            )}
          </button>
        </div>
      )}
      {!unit.source_available && (
        <p className="notice">
          {t(
            "源圖片目前不可用。你可以選擇其他圖片或改用文字與圖形。",
            "The source image is unavailable. Choose another image or use text and shapes.",
          )}
        </p>
      )}
      {unit.error_code && (
        <p className="notice error">
          {unit.error_code === "TEXT_OVERFLOW"
            ? t(
                "此尺寸的文案太長。縮短後儲存即可重新排版。",
                "The copy is too long for this size. Shorten it and save to render again.",
              )
            : unit.error_code}
        </p>
      )}
      {newRevision && (
        <div className="matrix-stale-draft">
          <CopyFields value={copy} onChange={setCopy} />
        </div>
      )}
      {!["rendering"].includes(unit.state) &&
        !batch.cancelled &&
        !newRevision && (
          <AsyncForm
            submitLabel={t("只重新排版此單元", "Render only this unit")}
            onSubmit={async () => {
              const body = { expected_revision: unit.revision, copy, image },
                signature = JSON.stringify(body);
              if (saved.current?.signature !== signature)
                saved.current = { signature, key: crypto.randomUUID() };
              await post(
                `${base}/creative-batches/${batch.id}/units/${unit.id}/edit`,
                body,
                saved.current.key,
              );
              onDone();
            }}
          >
            <CopyFields value={copy} onChange={setCopy} />
            <ImageChoice value={image} assets={assets} onChange={setImage} />
          </AsyncForm>
        )}
      {!batch.cancelled &&
        !newRevision &&
        unit.source_available &&
        ["failed", "cancelled"].includes(unit.state) && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void retry()}
          >
            <RotateCcw size={16} />
            {t("重試原文案與圖片", "Retry original copy and image")}
          </button>
        )}
      <section className="matrix-history">
        <h3>{t("輸出與執行歷史", "Output and render history")}</h3>
        {unit.attempts.length === 0 && (
          <p className="muted">
            {t("等待首次排版。", "Waiting for its first render.")}
          </p>
        )}
        {[...unit.attempts].reverse().map((a) => (
          <article key={a.id}>
            <header>
              <span>
                r{a.revision} ·{" "}
                <Status value={a.state === "rendering" ? "running" : a.state} />
              </span>
              <span className="muted">
                AI HK$0{a.elapsed_ms !== null ? ` · ${a.elapsed_ms} ms` : ""}
              </span>
            </header>
            {a.error_code && <p className="muted">{a.error_code}</p>}
            {a.state === "succeeded" &&
              (a.output_available ? (
                <div className="matrix-downloads">
                  {[
                    ["PNG", a.png_asset_id],
                    ["SVG", a.svg_asset_id],
                    [t("編輯資料", "Editable source"), a.source_asset_id],
                  ].map(([label, id]) => (
                    <button
                      key={label}
                      className="text-button"
                      onClick={() =>
                        void download(
                          `${base}/assets/${id}/download`,
                          `${unit.creative_key}-${unit.locale}-${unit.size_key}-r${a.revision}.${label === "PNG" ? "png" : label === "SVG" ? "svg" : "json"}`,
                        ).catch(setError)
                      }
                    >
                      <Download size={15} />
                      {label}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted">
                  {t(
                    "此版本的檔案目前不可用。",
                    "Files for this revision are unavailable.",
                  )}
                </p>
              ))}
          </article>
        ))}
      </section>
    </>
  );
}
export function CreativeMatrices({
  base,
  assets,
}: {
  base: string;
  assets: any[];
}) {
  const { t } = useI18n(),
    [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [editing, setEditing] = useState<Unit | null>(null),
    [refresh, setRefresh] = useState(0),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [locale, setLocale] = useState("all"),
    [state, setState] = useState("all"),
    [cursor, setCursor] = useState<string | null>(null);
  const list = useData<{
    items: { id: string; name: string }[];
    next_cursor: string | null;
  }>(base + "/creative-batches" + (cursor ? "?before=" + cursor : ""), refresh);
  const detail = useData<Batch>(
    selected ? base + "/creative-batches/" + selected : null,
    refresh,
    1800,
  );
  const cancelKey = useRef<{ id: string; version: number; key: string } | null>(
    null,
  );
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    setSelected(null);
    setEditing(null);
    setCreating(false);
    setCursor(null);
    setError(null);
  }, [base]);
  useEffect(() => {
    if (detail.error) setEditing(null);
  }, [detail.error]);
  const batch = detail.data;
  const currentUnit = editing && batch?.units.find((u) => u.id === editing.id);
  const editingUnit =
    currentUnit && currentUnit.revision === editing?.revision
      ? currentUnit
      : editing;
  async function cancel() {
    if (!batch || busy) return;
    setBusy(true);
    setError(null);
    if (
      cancelKey.current?.id !== batch.id ||
      cancelKey.current.version !== batch.version
    )
      cancelKey.current = {
        id: batch.id,
        version: batch.version,
        key: crypto.randomUUID(),
      };
    try {
      await post(
        `${base}/creative-batches/${batch.id}/cancel`,
        { expected_version: batch.version },
        cancelKey.current.key,
      );
      if (live.current) setRefresh((v) => v + 1);
    } catch (e) {
      if (live.current) setError(e);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <section
      className="creative-matrices"
      aria-label={t("批量設計", "Batch designs")}
    >
      <header className="matrix-section-heading">
        <div>
          <p className="eyebrow">CAMPAIGN / FORMATS</p>
          <h2>{t("一個方向，每個版位。", "One direction. Every format.")}</h2>
          <p className="muted">
            {t(
              "按創意、語言與尺寸建立矩陣，逐格修改與交付。",
              "Build a matrix of creatives, languages and sizes. Refine and deliver each unit.",
            )}
          </p>
        </div>
        <button className="button secondary" onClick={() => setCreating(true)}>
          <Grid2X2 size={17} />
          {t("新建批量設計", "New batch design")}
        </button>
      </header>
      <ErrorNotice error={list.error ?? detail.error ?? error} />
      {list.data && (
        <div className="matrix-list">
          <label>
            {t("選擇批次", "Choose batch")}
            <select
              aria-label={t("選擇批次", "Choose batch")}
              value={
                selected && list.data.items.some((v) => v.id === selected)
                  ? selected
                  : ""
              }
              onChange={(e) => {
                setSelected(e.target.value || null);
                setLocale("all");
                setState("all");
              }}
            >
              <option value="">
                {t("選擇一個批次查看成果", "Choose a batch to review its work")}
              </option>
              {list.data.items.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          {list.data.next_cursor && (
            <button
              className="text-button"
              onClick={() => setCursor(list.data!.next_cursor)}
            >
              {t("下一頁批次", "Next batches")}
              <ArrowUpRight size={15} />
            </button>
          )}
          {cursor && (
            <button className="text-button" onClick={() => setCursor(null)}>
              {t("返回最新批次", "Latest batches")}
            </button>
          )}
        </div>
      )}
      {batch && (
        <div className="matrix-detail">
          <header className="matrix-summary">
            <div>
              <h3>{batch.name}</h3>
              <Status value={batch.state} />
              <p className="muted">
                {t("已完成", "Completed")} {batch.counts.succeeded}/
                {batch.units.length} · {t("失敗", "Failed")}{" "}
                {batch.counts.failed} ·{" "}
                {t("排隊／排版中", "Queued / rendering")}{" "}
                {batch.counts.queued + batch.counts.rendering}
              </p>
            </div>
            <div className="matrix-cost">
              <strong>AI HK$0</strong>
              <span>{t("本地排版", "Local composition")}</span>
              {!batch.cancelled &&
                (batch.counts.queued > 0 || batch.counts.rendering > 0) && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void cancel()}
                  >
                    {t("停止未完成單元", "Stop unfinished units")}
                  </button>
                )}
            </div>
          </header>
          <div className="matrix-filters">
            <label>
              {t("語言", "Language")}
              <select
                aria-label={t("語言", "Language")}
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
              >
                <option value="all">{t("全部語言", "All languages")}</option>
                <option value="zh-HK">繁體中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <label>
              {t("狀態", "Status")}
              <select
                aria-label={t("狀態", "Status")}
                value={state}
                onChange={(e) => setState(e.target.value)}
              >
                <option value="all">{t("全部狀態", "All states")}</option>
                {[
                  "queued",
                  "rendering",
                  "succeeded",
                  "failed",
                  "cancelled",
                ].map((s) => (
                  <option value={s} key={s}>
                    {s === "queued"
                      ? t("排隊", "Queued")
                      : s === "rendering"
                        ? t("排版中", "Rendering")
                        : s === "succeeded"
                          ? t("已完成", "Completed")
                          : s === "failed"
                            ? t("失敗", "Failed")
                            : t("已取消", "Cancelled")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="matrix-grid">
            {batch.units
              .filter(
                (u) =>
                  (locale === "all" || u.locale === locale) &&
                  (state === "all" || u.state === state),
              )
              .map((u) => {
                const result = [...u.attempts]
                  .reverse()
                  .find(
                    (a) => a.state === "succeeded" && a.revision === u.revision,
                  );
                return (
                  <article
                    key={u.id}
                    className="matrix-unit"
                    data-unit-id={u.id}
                  >
                    <div className="matrix-unit-spec">
                      <strong>{u.input.creative_name}</strong>
                      <span>
                        {u.locale} · {u.input.size.width} ×{" "}
                        {u.input.size.height}
                      </span>
                    </div>
                    {result?.png_asset_id && result.output_available ? (
                      <UnitPreview
                        key={result.id}
                        base={base}
                        asset={result.png_asset_id}
                        label={u.input.copy.headline}
                      />
                    ) : (
                      <div className="matrix-unit-preview matrix-unit-empty">
                        <Grid2X2 size={27} />
                        <span>
                          {result && !result.output_available
                            ? t("檔案目前不可用", "Files unavailable")
                            : u.state === "queued"
                              ? t("等待排版", "Waiting to render")
                              : u.state === "rendering"
                                ? t("正在排版", "Rendering")
                                : u.state === "failed"
                                  ? t("需要處理", "Needs attention")
                                  : t("已停止", "Stopped")}
                        </span>
                      </div>
                    )}
                    <footer>
                      <span>
                        <Status
                          value={u.state === "rendering" ? "running" : u.state}
                        />
                        <small>r{u.revision} · AI HK$0</small>
                      </span>
                      <button
                        className="icon-button"
                        aria-label={
                          t("開啟單元", "Open unit") +
                          " " +
                          u.input.creative_name +
                          " " +
                          u.locale +
                          " " +
                          u.size_key
                        }
                        onClick={() => setEditing(u)}
                      >
                        <Pencil size={17} />
                      </button>
                    </footer>
                  </article>
                );
              })}
          </div>
        </div>
      )}
      {creating && (
        <Modal
          title={t("新建批量設計", "New batch design")}
          onClose={() => setCreating(false)}
        >
          <CreateBatch
            base={base}
            assets={assets}
            onDone={(id) => {
              if (!live.current) return;
              setCreating(false);
              setCursor(null);
              setSelected(id);
              setRefresh((v) => v + 1);
            }}
          />
        </Modal>
      )}
      {editingUnit && currentUnit && batch && !detail.error && (
        <Modal
          title={t("單元文案與輸出", "Unit copy and outputs")}
          onClose={() => setEditing(null)}
        >
          <EditUnit
            key={editingUnit.id + ":" + editingUnit.revision}
            base={base}
            batch={batch}
            unit={editingUnit}
            assets={assets}
            newRevision={
              currentUnit.revision !== editingUnit.revision
                ? currentUnit.revision
                : null
            }
            onReload={() => setEditing(currentUnit)}
            onDone={() => {
              if (!live.current) return;
              setEditing(null);
              setRefresh((v) => v + 1);
            }}
          />
        </Modal>
      )}
    </section>
  );
}
