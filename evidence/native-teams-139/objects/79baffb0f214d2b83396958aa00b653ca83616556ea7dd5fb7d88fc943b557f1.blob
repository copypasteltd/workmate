import { useRef, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  History,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { api, ApiError } from "./api";
import { useWorkspace } from "./context";
import {
  AsyncForm,
  DateText,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  Modal,
  PageHeader,
  useData,
  useI18n,
} from "./ui";
import { ResumableUpload } from "./resumable-upload";
import "./brand-library.css";

const split = (s: string) => s.split(",").map((x) => x.trim());
const localTime = (s: string | null) =>
  s
    ? new Date(Date.parse(s) - new Date(s).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
const moneyScale = (currency: string | null) =>
  10 **
  new Intl.NumberFormat("en-HK", {
    style: "currency",
    currency: currency ?? "HKD",
  }).resolvedOptions().maximumFractionDigits!;
const iso = (s: string) => (s ? new Date(s).toISOString() : null);
const defaultFont = () => ({
  key: "headline",
  label: "Noto Sans TC",
  source: { builtin: "noto-sans-tc" } as any,
  rights: {
    source: "CopyPaste bundled Noto Sans TC / Google Fonts",
    license: "SIL Open Font License 1.1 · OFL included with the font",
    channels: ["social", "print"],
    valid_until: null as string | null,
  },
});
const fresh = (brand?: any) => ({
  schema_version: 2,
  name: brand?.name ?? "",
  colors: brand?.body.colors ?? ["#1F5EFF", "#F6F6F4", "#15171A"],
  tone: brand?.body.tone ?? "",
  approved_copy: brand?.body.approved_copy ?? "",
  fonts: brand?.body.fonts ?? [],
  logos: brand?.body.logos ?? [],
  font_bindings: brand?.body.font_bindings ?? [defaultFont()],
  facts: brand?.body.facts ?? [],
  locales: brand?.body.locales ?? ["zh-Hant-HK", "en-HK"],
  channels: brand?.body.channels ?? ["social", "print"],
  restrictions: brand?.body.restrictions ?? "",
});
function eligibility(f: any) {
  return f.valid_from && Date.parse(f.valid_from) > Date.now()
    ? "future"
    : f.valid_until && Date.parse(f.valid_until) <= Date.now()
      ? "expired"
      : "current";
}

export function BrandLibrary() {
  const { t } = useI18n(),
    w = useWorkspace(),
    [revision, refresh] = useState(0),
    [edit, setEdit] = useState<any>(null),
    [inspect, setInspect] = useState<any>(null);
  const { data, error, loading } = useData(w.base + "/brand", revision);
  return (
    <>
      <PageHeader
        eyebrow="CONSISTENCY, BY DESIGN."
        title={t("品牌資料", "Brand library")}
        description={t(
          "把品牌、字體與核准事實，固定在每一次創作。",
          "Keep your brand, fonts and approved facts consistent in every creation.",
        )}
        action={
          <button className="button primary" onClick={() => setEdit({})}>
            <Plus size={17} />
            {t("加入品牌", "Add brand")}
          </button>
        }
      />
      <ErrorNotice error={error} />
      {loading && <Loading />}
      <section className="brand-library-intro card">
        <ShieldCheck size={23} />
        <div>
          <strong>
            {t(
              "每次更新，都保留原來的版本",
              "Every update preserves the original version",
            )}
          </strong>
          <p>
            {t(
              "已綁定的工作繼續使用原版資料。需要新的品牌資料時，請在專家設定中更新並確認採用。",
              "Bound work continues using its original guidance. Update your specialist and confirm adoption when you want to use a new brand version.",
            )}
          </p>
        </div>
      </section>
      {data?.items.length ? (
        <div className="project-grid brand-library-grid">
          {data.items.map((b: any) => (
            <article className="card" key={b.id}>
              <div className="brand-colors">
                {(b.body.colors ?? []).map((c: string) => (
                  <span key={c} title={c} style={{ background: c }} />
                ))}
              </div>
              <span className="eyebrow">BRAND · v{b.version}</span>
              <h2>{b.name}</h2>
              <p className="preserve-text">{b.body.tone}</p>
              <p className="muted preserve-text">{b.body.approved_copy}</p>
              <div className="brand-fact-tags">
                <span>
                  {b.body.font_bindings?.length ?? 0} {t("組字體", "fonts")}
                </span>
                <span>
                  {b.body.facts?.length ?? 0} {t("項事實", "facts")}
                </span>
                <span>{b.body.logos?.length ?? 0} Logo</span>
              </div>
              {b.body.schema_version !== 2 && (
                <p className="muted">
                  {t(
                    "舊版資料：補全字體使用聲明後即可建立生產版本。",
                    "Legacy guidance: complete font usage declarations to publish a production version.",
                  )}
                </p>
              )}
              <footer className="brand-card-actions">
                <button className="text-button" onClick={() => setEdit(b)}>
                  {t("編輯並發佈新版", "Edit & publish version")}
                </button>
                <button className="text-button" onClick={() => setInspect(b)}>
                  <History size={15} />
                  {t("版本與出圖檢查", "Versions & preflight")}
                </button>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        !loading && (
          <Empty
            icon={BookOpen}
            title={t("讓品牌，每次都像你。", "Make every piece feel like you.")}
            body={t(
              "加入 Logo、品牌字體和產品事實，讓創作有一致的依據。",
              "Add your Logo, brand fonts and product facts to give every creation consistent guidance.",
            )}
          />
        )
      )}
      {edit && (
        <BrandEditor
          key={edit.id ?? "new"}
          brand={edit.id ? edit : undefined}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            refresh((n) => n + 1);
          }}
        />
      )}
      {inspect && (
        <BrandPreflight
          key={inspect.id}
          brand={inspect}
          onClose={() => setInspect(null)}
        />
      )}
    </>
  );
}

function BrandEditor({
  brand,
  onClose,
  onSaved,
}: {
  brand?: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n(),
    w = useWorkspace(),
    [draft, update] = useState<any>(() => fresh(brand)),
    [tab, setTab] = useState("identity"),
    [assetRevision, refreshAssets] = useState(0),
    [upload, setUpload] = useState(false);
  const { data: assets } = useData(w.base + "/assets", assetRevision),
    retry = useRef({ body: "", key: "" });
  const set = (field: string, value: any) =>
    update((d: any) => ({ ...d, [field]: value }));
  const replace = (field: string, index: number, value: any) =>
    set(
      field,
      draft[field].map((x: any, i: number) => (i === index ? value : x)),
    );
  const remove = (field: string, index: number) =>
    set(
      field,
      draft[field].filter((_: any, i: number) => i !== index),
    );
  const choices = (kind: string) =>
    (assets?.items ?? []).filter(
      (a: any) =>
        !a.private_owner &&
        (kind === "logo"
          ? a.mime_type === "image/png"
          : ["font/ttf", "font/otf", "application/octet-stream"].includes(
              a.mime_type,
            )),
    );
  const chooseSource = (value: string) => {
    if (value === "builtin") return { builtin: "noto-sans-tc" };
    const [asset_id, version] = value.split(":");
    return { asset_id, version: Number(version) };
  };
  const sourceValue = (s: any) =>
    s.builtin ? "builtin" : s.asset_id + ":" + s.version;
  return (
    <Modal
      title={
        brand
          ? t("發佈品牌新版", "Publish a brand version")
          : t("加入品牌資料", "Add brand guidance")
      }
      onClose={onClose}
    >
      <div className="brand-editor">
        <p className="muted">
          {brand
            ? t(
                `以 v${brand.version} 為基礎，新版本不會覆寫已綁定的工作。`,
                `Based on v${brand.version}. This publication will preserve already bound work.`,
              )
            : t(
                "先建立品牌基礎，再逐步補充素材與產品事實。",
                "Start with your brand foundations, then add assets and product facts.",
              )}
        </p>
        <nav
          className="brand-editor-tabs"
          aria-label={t("品牌資料分頁", "Brand guidance sections")}
        >
          {[
            ["identity", t("品牌基礎", "Identity")],
            ["fonts", t("字體與使用權", "Fonts & rights")],
            ["facts", t("產品與促銷", "Products & offers")],
            ["logos", "Logo"],
          ].map(([id, label]) => (
            <button
              type="button"
              key={id}
              className={tab === id ? "button primary" : "button secondary"}
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <AsyncForm
          submitLabel={t("發佈品牌版本", "Publish brand version")}
          onSubmit={async () => {
            if (!draft.name.trim()) {
              setTab("identity");
              throw new Error(t("請輸入品牌名稱。", "Enter a brand name."));
            }
            const definition = {
              ...draft,
              colors: draft.colors.filter(Boolean),
              locales: draft.locales.filter(Boolean),
              channels: draft.channels.filter(Boolean),
              font_bindings: draft.font_bindings.map((f: any) => ({
                ...f,
                rights: {
                  ...f.rights,
                  channels: f.rights.channels.filter(Boolean),
                },
              })),
              facts: draft.facts.map((f: any) => ({
                ...f,
                currency:
                  f.amount_minor === null ? null : (f.currency ?? "HKD"),
              })),
            };
            const payload = brand
                ? { expected_version: brand.version, definition }
                : definition,
              body = JSON.stringify(payload);
            if (retry.current.body !== body)
              retry.current = { body, key: crypto.randomUUID() };
            await api(w.base + "/brand/" + (brand ? brand.id : "definitions"), {
              method: brand ? "PUT" : "POST",
              headers: { "Idempotency-Key": retry.current.key },
              body,
            });
            onSaved();
          }}
        >
          <div hidden={tab !== "identity"} className="brand-editor-panel">
            <Field label={t("品牌名稱", "Brand name")}>
              <input
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                maxLength={160}
              />
            </Field>
            <Field
              label={t("品牌色（以逗號分隔）", "Colors (comma separated)")}
            >
              <input
                value={draft.colors.join(", ")}
                onChange={(e) => set("colors", split(e.target.value))}
              />
            </Field>
            <Field label={t("語氣與風格", "Tone & style")}>
              <textarea
                value={draft.tone}
                onChange={(e) => set("tone", e.target.value)}
                rows={3}
                maxLength={2000}
              />
            </Field>
            <Field label={t("已核准文案", "Approved copy")}>
              <textarea
                value={draft.approved_copy}
                onChange={(e) => set("approved_copy", e.target.value)}
                rows={3}
                maxLength={10000}
              />
            </Field>
            <div className="brand-fields">
              <Field
                label={t("語言與地區", "Languages & regions")}
                hint="zh-Hant-HK, en-HK"
              >
                <input
                  value={draft.locales.join(", ")}
                  onChange={(e) => set("locales", split(e.target.value))}
                />
              </Field>
              <Field
                label={t("使用渠道", "Channels")}
                hint="social, print, video, internal"
              >
                <input
                  value={draft.channels.join(", ")}
                  onChange={(e) => set("channels", split(e.target.value))}
                />
              </Field>
            </div>
            <Field
              label={t("禁止聲稱及其他規則", "Restricted claims & other rules")}
            >
              <textarea
                value={draft.restrictions}
                onChange={(e) => set("restrictions", e.target.value)}
                maxLength={5000}
                rows={3}
              />
            </Field>
          </div>
          <div hidden={tab !== "fonts"} className="brand-editor-panel">
            <p className="muted">
              {t(
                "使用內建 Noto Sans TC，或先上傳你有權使用的 TTF / OTF（20 MB 內）。字體使用權由品牌提供者聲明。",
                "Use bundled Noto Sans TC or upload a TTF / OTF you are authorized to use (up to 20 MB). Usage rights are declared by the brand provider.",
              )}
            </p>
            {draft.font_bindings.map((f: any, i: number) => (
              <fieldset className="brand-entry" key={i}>
                <legend>
                  {t("字體", "Font")} {i + 1}
                </legend>
                <div className="brand-fields">
                  <Field label={t("字體標記", "Font key")}>
                    <input
                      value={f.key}
                      onChange={(e) =>
                        replace("font_bindings", i, {
                          ...f,
                          key: e.target.value,
                        })
                      }
                      maxLength={60}
                    />
                  </Field>
                  <Field label={t("字體名稱", "Font label")}>
                    <input
                      value={f.label}
                      onChange={(e) =>
                        replace("font_bindings", i, {
                          ...f,
                          label: e.target.value,
                        })
                      }
                    />
                  </Field>
                </div>
                <Field label={t("字體檔案", "Font file")}>
                  <select
                    value={sourceValue(f.source)}
                    onChange={(e) =>
                      replace("font_bindings", i, {
                        ...f,
                        source: chooseSource(e.target.value),
                      })
                    }
                  >
                    <option value="builtin">Noto Sans TC · OFL</option>
                    {!f.source.builtin &&
                      !choices("font").some(
                        (a: any) =>
                          a.id + ":" + a.current_version ===
                          sourceValue(f.source),
                      ) && (
                        <option value={sourceValue(f.source)}>
                          {f.label} · v{f.source.version}
                        </option>
                      )}
                    {choices("font").map((a: any) => (
                      <option key={a.id} value={a.id + ":" + a.current_version}>
                        {a.name} · v{a.current_version}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("取得來源", "Source")}>
                  <input
                    value={f.rights.source}
                    onChange={(e) =>
                      replace("font_bindings", i, {
                        ...f,
                        rights: { ...f.rights, source: e.target.value },
                      })
                    }
                    maxLength={2000}
                  />
                </Field>
                <Field label={t("許可與使用依據", "License & usage basis")}>
                  <textarea
                    value={f.rights.license}
                    onChange={(e) =>
                      replace("font_bindings", i, {
                        ...f,
                        rights: { ...f.rights, license: e.target.value },
                      })
                    }
                    maxLength={4000}
                    rows={2}
                  />
                </Field>
                <div className="brand-fields">
                  <Field label={t("字體允許渠道", "Permitted font channels")}>
                    <input
                      value={f.rights.channels.join(", ")}
                      onChange={(e) =>
                        replace("font_bindings", i, {
                          ...f,
                          rights: {
                            ...f.rights,
                            channels: split(e.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                  <Field
                    label={t("使用權到期（可留空）", "Usage expiry (optional)")}
                  >
                    <input
                      type="datetime-local"
                      value={localTime(f.rights.valid_until)}
                      onChange={(e) =>
                        replace("font_bindings", i, {
                          ...f,
                          rights: {
                            ...f.rights,
                            valid_until: iso(e.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                </div>
                {draft.font_bindings.length > 1 && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => remove("font_bindings", i)}
                  >
                    <Trash2 size={15} />
                    {t("移除此字體", "Remove font")}
                  </button>
                )}
              </fieldset>
            ))}
            <button
              className="button secondary"
              type="button"
              disabled={draft.font_bindings.length >= 12}
              onClick={() =>
                set("font_bindings", [
                  ...draft.font_bindings,
                  {
                    ...defaultFont(),
                    key: "font" + (draft.font_bindings.length + 1),
                  },
                ])
              }
            >
              <Plus size={16} />
              {t("加入字體", "Add font")}
            </button>
          </div>
          <div hidden={tab !== "facts"} className="brand-editor-panel">
            <p className="muted">
              {t(
                "價格與促銷引用固定的事實版本。促銷必須有結束時間；過期內容會在生產前被攔截。",
                "Prices and offers reference fixed facts. Promotions require an end time; expired facts are blocked before production.",
              )}
            </p>
            {draft.facts.map((f: any, i: number) => (
              <fieldset className="brand-entry" key={i}>
                <legend>
                  {t("產品事實", "Product fact")} {i + 1}
                </legend>
                <div className="brand-fields">
                  <Field label={t("事實標記", "Fact key")}>
                    <input
                      value={f.key}
                      onChange={(e) =>
                        replace("facts", i, { ...f, key: e.target.value })
                      }
                    />
                  </Field>
                  <Field label={t("類型", "Type")}>
                    <select
                      value={f.kind}
                      onChange={(e) =>
                        replace("facts", i, { ...f, kind: e.target.value })
                      }
                    >
                      <option value="product">{t("產品", "Product")}</option>
                      <option value="price">{t("價格", "Price")}</option>
                      <option value="promotion">
                        {t("促銷", "Promotion")}
                      </option>
                    </select>
                  </Field>
                </div>
                <Field label="SKU">
                  <input
                    value={f.sku}
                    onChange={(e) =>
                      replace("facts", i, { ...f, sku: e.target.value })
                    }
                  />
                </Field>
                <Field label={t("核准內容", "Approved statement")}>
                  <textarea
                    value={f.text}
                    rows={2}
                    maxLength={2000}
                    onChange={(e) =>
                      replace("facts", i, { ...f, text: e.target.value })
                    }
                  />
                </Field>
                <div className="brand-fields">
                  <Field label={t("價格（可留空）", "Price (optional)")}>
                    <input
                      type="number"
                      step={1 / moneyScale(f.currency)}
                      min="0"
                      value={
                        f.amount_minor === null
                          ? ""
                          : f.amount_minor / moneyScale(f.currency)
                      }
                      onChange={(e) =>
                        replace("facts", i, {
                          ...f,
                          amount_minor:
                            e.target.value === ""
                              ? null
                              : Math.round(
                                  Number(e.target.value) *
                                    moneyScale(f.currency),
                                ),
                          currency: f.currency ?? "HKD",
                        })
                      }
                    />
                  </Field>
                  <Field label={t("貨幣", "Currency")}>
                    <select
                      value={f.currency ?? "HKD"}
                      onChange={(e) => {
                        const scale = moneyScale;
                        replace("facts", i, {
                          ...f,
                          amount_minor:
                            f.amount_minor === null
                              ? null
                              : Math.round(
                                  (f.amount_minor /
                                    scale(f.currency ?? "HKD")) *
                                    scale(e.target.value),
                                ),
                          currency: e.target.value,
                        });
                      }}
                    >
                      {Intl.supportedValuesOf("currency").map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label={t("生效時間（可留空）", "Valid from (optional)")}
                  >
                    <input
                      type="datetime-local"
                      value={localTime(f.valid_from)}
                      onChange={(e) =>
                        replace("facts", i, {
                          ...f,
                          valid_from: iso(e.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label={t("到期時間", "Valid until")}>
                    <input
                      type="datetime-local"
                      value={localTime(f.valid_until)}
                      onChange={(e) =>
                        replace("facts", i, {
                          ...f,
                          valid_until: iso(e.target.value),
                        })
                      }
                    />
                  </Field>
                </div>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => remove("facts", i)}
                >
                  <Trash2 size={15} />
                  {t("移除此事實", "Remove fact")}
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              className="button secondary"
              disabled={draft.facts.length >= 100}
              onClick={() =>
                set("facts", [
                  ...draft.facts,
                  {
                    key: "fact" + (draft.facts.length + 1),
                    sku: "",
                    kind: "product",
                    text: "",
                    amount_minor: null,
                    currency: null,
                    valid_from: null,
                    valid_until: null,
                  },
                ])
              }
            >
              <Plus size={16} />
              {t("加入產品事實", "Add product fact")}
            </button>
          </div>
          <div hidden={tab !== "logos"} className="brand-editor-panel">
            <p className="muted">
              {t(
                "選取專案內的 PNG Logo，設定最小尺寸及留白距離。尺寸以設計畫布像素計算。",
                "Choose a project PNG Logo and set its minimum size and clear space in canvas pixels.",
              )}
            </p>
            {draft.logos.map((l: any, i: number) => (
              <fieldset className="brand-entry" key={i}>
                <legend>Logo {i + 1}</legend>
                <Field label={t("Logo 標記", "Logo key")}>
                  <input
                    value={l.key}
                    onChange={(e) =>
                      replace("logos", i, { ...l, key: e.target.value })
                    }
                  />
                </Field>
                <Field label={t("Logo 素材", "Logo asset")}>
                  <select
                    value={sourceValue(l)}
                    onChange={(e) =>
                      replace("logos", i, {
                        ...l,
                        ...chooseSource(e.target.value),
                      })
                    }
                  >
                    {!choices("logo").some(
                      (a: any) =>
                        a.id + ":" + a.current_version === sourceValue(l),
                    ) && (
                      <option value={sourceValue(l)}>
                        {t("固定 Logo", "Fixed Logo")} · v{l.version}
                      </option>
                    )}
                    {choices("logo").map((a: any) => (
                      <option key={a.id} value={a.id + ":" + a.current_version}>
                        {a.name} · v{a.current_version}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("使用說明", "Usage guidance")}>
                  <input
                    value={l.usage}
                    onChange={(e) =>
                      replace("logos", i, { ...l, usage: e.target.value })
                    }
                  />
                </Field>
                <div className="brand-fields">
                  <Field label={t("最小寬度（px）", "Minimum width (px)")}>
                    <input
                      type="number"
                      min={1}
                      max={4096}
                      value={l.min_width}
                      onChange={(e) =>
                        replace("logos", i, {
                          ...l,
                          min_width: Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label={t("留白距離（px）", "Clear space (px)")}>
                    <input
                      type="number"
                      min={0}
                      max={4096}
                      value={l.clear_space}
                      onChange={(e) =>
                        replace("logos", i, {
                          ...l,
                          clear_space: Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                </div>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => remove("logos", i)}
                >
                  <Trash2 size={15} />
                  {t("移除此 Logo", "Remove Logo")}
                </button>
              </fieldset>
            ))}
            <button
              className="button secondary"
              type="button"
              disabled={!choices("logo").length || draft.logos.length >= 12}
              onClick={() => {
                const a = choices("logo")[0];
                set("logos", [
                  ...draft.logos,
                  {
                    key: "logo" + (draft.logos.length + 1),
                    asset_id: a.id,
                    version: a.current_version,
                    usage: "",
                    min_width: 80,
                    clear_space: 20,
                  },
                ]);
              }}
            >
              <Plus size={16} />
              {t("加入 Logo", "Add Logo")}
            </button>
          </div>
        </AsyncForm>
        <button
          type="button"
          className="text-button"
          onClick={() => setUpload(!upload)}
        >
          {t("上傳品牌素材", "Upload brand assets")}
        </button>
        {upload && (
          <ResumableUpload
            onDone={() => {
              refreshAssets((n) => n + 1);
              setUpload(false);
            }}
          />
        )}
      </div>
    </Modal>
  );
}

function BrandPreflight({
  brand,
  onClose,
}: {
  brand: any;
  onClose: () => void;
}) {
  const { t } = useI18n(),
    w = useWorkspace(),
    { data, error, loading } = useData(
      w.base + "/brand/" + brand.id + "/versions",
    ),
    [selected, setSelected] = useState(brand.version),
    [result, setResult] = useState<any>(null),
    [failure, setFailure] = useState<any>(null),
    [checking, setChecking] = useState(false);
  const version = data?.items.find((v: any) => v.version === selected),
    b = version?.body;
  return (
    <Modal
      title={t("品牌版本與出圖檢查", "Brand versions & preflight")}
      onClose={onClose}
    >
      <div className="brand-editor">
        <ErrorNotice error={error} />
        {loading && <Loading />}
        <Field label={t("品牌版本", "Brand version")}>
          <select
            value={selected}
            onChange={(e) => {
              setSelected(Number(e.target.value));
              setResult(null);
              setFailure(null);
            }}
          >
            {(data?.items ?? []).map((v: any) => (
              <option key={v.version} value={v.version}>
                v{v.version} · {v.name}
              </option>
            ))}
          </select>
        </Field>
        {version && (
          <>
            <p className="muted">
              <DateText value={version.created_at} />
            </p>
            <p className="preserve-text">{b.tone}</p>
            <p className="preserve-text">{b.approved_copy}</p>
            <div className="brand-fact-tags">
              {(b.facts ?? []).map((f: any) => (
                <span key={f.key}>
                  {f.key} ·{" "}
                  {eligibility(f) === "expired"
                    ? t("已過期", "Expired")
                    : eligibility(f) === "future"
                      ? t("尚未生效", "Not yet valid")
                      : t("可使用", "Available")}
                </span>
              ))}
            </div>
            {b.schema_version === 2 ? (
              <form
                className="form-stack"
                key={selected}
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (checking) return;
                  const form = new FormData(event.currentTarget);
                  setChecking(true);
                  setResult(null);
                  setFailure(null);
                  try {
                    setResult(
                      await api(
                        w.base +
                          "/brand/" +
                          brand.id +
                          "/versions/" +
                          selected +
                          "/check",
                        {
                          method: "POST",
                          body: JSON.stringify({
                            channel: form.get("channel"),
                            locale: form.get("locale"),
                            font_key: form.get("font_key"),
                            text: form.get("text"),
                            ...(form.get("fact_key")
                              ? { fact_key: form.get("fact_key") }
                              : {}),
                          }),
                        },
                      ),
                    );
                  } catch (e) {
                    setFailure(e);
                  } finally {
                    setChecking(false);
                  }
                }}
              >
                <div className="brand-fields">
                  <Field label={t("使用渠道", "Channel")}>
                    <select name="channel">
                      {b.channels.map((c: string) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("語言與地區", "Language & region")}>
                    <select name="locale">
                      {b.locales.map((c: string) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label={t("選用字體", "Selected font")}>
                  <select name="font_key">
                    {b.font_bindings.map((f: any) => (
                      <option key={f.key} value={f.key}>
                        {f.label} · {f.key}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={t(
                    "引用產品事實（可留空）",
                    "Referenced fact (optional)",
                  )}
                >
                  <select name="fact_key">
                    <option value="">
                      {t("使用測試文字", "Use sample text")}
                    </option>
                    {b.facts.map((f: any) => (
                      <option key={f.key} value={f.key}>
                        {f.key} · {f.text}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("測試文字", "Sample text")}>
                  <textarea
                    name="text"
                    defaultValue="春日新章 · A fresh perspective"
                    maxLength={5000}
                    rows={3}
                  />
                </Field>
                <button
                  className="button primary"
                  disabled={checking}
                  type="submit"
                >
                  {checking
                    ? t("檢查中…", "Checking…")
                    : t("檢查字體與事實", "Check fonts & facts")}
                </button>
              </form>
            ) : (
              <p className="muted">
                {t(
                  "此版本未包含可核查的字體及使用規則，請發佈新版後檢查。",
                  "This legacy version has no verifiable font and usage rules. Publish an updated version before checking.",
                )}
              </p>
            )}
          </>
        )}
        <ErrorNotice error={failure} />
        {failure instanceof ApiError && (
          <p className="brand-error-details">
            {failure.code}
            {(failure.details as any)?.font_key &&
              " · " + (failure.details as any).font_key}
            {(failure.details as any)?.fact_key &&
              " · " + (failure.details as any).fact_key}
            {(failure.details as any)?.codepoints?.join(" · ")}
          </p>
        )}
        {result && (
          <section className="brand-preflight-result" role="status">
            <CheckCircle2 size={22} />
            <div>
              <strong>
                {t(
                  "字體與使用範圍檢查通過",
                  "Font coverage & usage checks passed",
                )}
              </strong>
              <p className="preserve-text">{result.text}</p>
              <small>
                {t(
                  "字體權利依品牌提供者聲明；此檢查不代替設計審閱。",
                  "Font rights are declared by the brand provider. This check does not replace design review.",
                )}
              </small>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
