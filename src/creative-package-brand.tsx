import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { ErrorNotice, Field, useI18n } from "./ui";

export type BrandRequirements = { source_name: string; texts: { layer: number; font_key: string; fact_key?: string; fact_kind?: string; resolved_text: string }[]; logos: { layer: number; key: string }[] };
type BrandChoice = { id: string; brand_id: string; version: number; name: string; available: boolean; channels: string[]; locales: string[]; colors: string[];
  fonts: { key: string; label: string; channels: string[]; valid_until: string | null; editable_supported?: boolean }[];
  facts: { key: string; kind: string; text: string; state: string }[]; logos: { key: string; usage: string }[] };
export type BrandApproval = { brand_target: { binding: { id: string; version: number; channel: string; locale: string };
  fonts: { source_key: string; target_key: string }[]; facts: { source_key: string; target_key: string }[];
  logos: { source_key: string; target_key: string }[]; colors: { from: string; to: string }[] };
  brand_review_hash: string; confirm_brand_review: true };

/** Every change invalidates approval. Replies from an older choice cannot approve a new one. */
export function CreativePackageBrand({ root, selection, requirements, colors, disabled, editableFonts = false, onChange }: {
  root: string; selection: { asset_id: string; version: number; sha256: string }; requirements: BrandRequirements;
  colors: string[]; disabled: boolean; editableFonts?: boolean; onChange: (value: BrandApproval | null) => void;
}) {
  const { t } = useI18n(), [pages, setPages] = useState<string[]>([""]), [options, setOptions] = useState<BrandChoice[]>([]),
    [next, setNext] = useState<string | null>(null), [chosen, setChosen] = useState<BrandChoice | null>(null),
    [channel, setChannel] = useState(""), [locale, setLocale] = useState(""),
    [fonts, setFonts] = useState<Record<string, string>>({}), [facts, setFacts] = useState<Record<string, string>>({}),
    [logos, setLogos] = useState<Record<string, string>>({}), [palette, setPalette] = useState<Record<string, string>>({}),
    [review, setReview] = useState<any>(null), [approved, setApproved] = useState(false), [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false), [error, setError] = useState<unknown>(null), [revision, setRevision] = useState(0);
  const epoch = useRef(0), live = useRef(true), reviewed = useRef<BrandApproval | null>(null);
  const cursor = pages.at(-1)!;
  useEffect(() => { live.current = true; return () => { live.current = false; epoch.current++; }; }, []);
  useEffect(() => { let active = true; setLoading(true); setError(null);
    void api(root + "/brand-options" + (cursor ? "?cursor=" + cursor : "")).then(data => {
      if (active && live.current) { setOptions(data.items); setNext(data.next_cursor); }
    }).catch(e => { if (active && live.current) setError(e); }).finally(() => { if (active && live.current) setLoading(false); });
    return () => { active = false; };
  }, [root, cursor, revision]);
  const invalidate = () => { epoch.current++; reviewed.current = null; setReview(null); setApproved(false); setError(null); onChange(null); };
  const textKeys = [...new Set(requirements.texts.map(v => v.font_key))], factKeys = [...new Set(requirements.texts.flatMap(v => v.fact_key ? [v.fact_key] : []))],
    logoKeys = [...new Set(requirements.logos.map(v => v.key))];
  const choose = (id: string) => {
    invalidate(); const b = options.find(v => v.id === id) ?? (chosen?.id === id ? chosen : null); setChosen(b);
    setChannel(b?.channels[0] ?? ""); setLocale(b?.locales[0] ?? ""); setPalette({});
    setFonts(Object.fromEntries(textKeys.map(k => [k, b?.fonts.some(f => f.key === k) ? k : ""])));
    setFacts(Object.fromEntries(factKeys.map(k => [k, b?.facts.some(f => f.key === k && f.state === "available" && f.kind === requirements.texts.find(v => v.fact_key === k)?.fact_kind) ? k : ""])));
    setLogos(Object.fromEntries(logoKeys.map(k => [k, b?.logos.some(f => f.key === k) ? k : ""])));
  };
  const locked = disabled || busy, canReview = chosen?.available && channel && locale
    && textKeys.every(k => chosen.fonts.some(f => f.key === fonts[k] && (!editableFonts || f.editable_supported) && f.channels.includes(channel) && (!f.valid_until || Date.parse(f.valid_until) > Date.now())))
    && factKeys.every(k => chosen.facts.some(f => f.key === facts[k] && f.state === "available")) && logoKeys.every(k => logos[k]);
  const mapping = (keys: string[], values: Record<string, string>) => keys.map(source_key => ({ source_key, target_key: values[source_key] }));
  const mapField = (kind: "fonts" | "facts" | "logos", key: string, values: Record<string, string>, choices: { key: string; label: string; disabled?: boolean }[], update: (v: Record<string, string>) => void) =>
    <Field key={kind + key} label={`${t(kind === "fonts" ? "字型" : kind === "facts" ? "事實" : "Logo", kind === "fonts" ? "Font" : kind === "facts" ? "Fact" : "Logo")} · ${key}`}>
      <select aria-label={`${kind}:${key}`} disabled={locked || !chosen} value={values[key] ?? ""} onChange={e => { invalidate(); update({ ...values, [key]: e.target.value }); }}>
        <option value="">{t("選擇目的品牌欄位", "Choose a target brand field")}</option>
        {choices.map(v => <option key={v.key} value={v.key} disabled={v.disabled}>{v.label}</option>)}
      </select>
    </Field>;
  return <section className="creative-brand-rebind" aria-label={t("目的品牌重綁", "Destination brand binding")}>
    <h4>{t("將設計套用到目的品牌", "Adapt this design to your brand")}</h4>
    <p>{t("來源品牌：", "Source brand: ")}{requirements.source_name}</p>
    <p className="muted">{t("逐項核對字型、事實與 Logo。未綁定的文案和未指定替換的顏色會保留，請確認仍適用。", "Map fonts, facts and Logos. Unbound copy and colors without a replacement stay as they are; review their suitability.")}</p>
    {editableFonts && <p className="muted">{t("此工程使用固定 Noto Sans TC 字型；請選擇目的品牌中已授權此字型的欄位。", "This project uses pinned Noto Sans TC. Choose the destination brand field licensed for this font.")}</p>}
    <ErrorNotice error={error} />
    <Field label={t("目的品牌固定版本", "Fixed destination brand version")}>
      <select value={chosen?.id ?? ""} disabled={locked || loading} onChange={e => choose(e.target.value)}>
        <option value="">{t("選擇目前專案的品牌版本", "Choose a brand version in this project")}</option>
        {chosen && !options.some(v => v.id === chosen.id) && <option value={chosen.id}>{chosen.name} · v{chosen.version}</option>}
        {options.map(v => <option key={v.id} value={v.id} disabled={!v.available}>{v.name} · v{v.version}{v.available ? "" : t(" · 來源不可用", " · Sources unavailable")}</option>)}
      </select>
    </Field>
    <div className="row-actions">
      {pages.length > 1 && <button type="button" className="text-button" disabled={locked || loading} onClick={() => setPages(p => p.slice(0, -1))}>{t("上一頁品牌", "Previous brands")}</button>}
      {next && <button type="button" className="text-button" disabled={locked || loading} onClick={() => setPages(p => [...p, next])}>{t("更多品牌版本", "More brand versions")}</button>}
      <button type="button" className="text-button" disabled={locked || loading} onClick={() => { invalidate(); setChosen(null); setPages([""]); setRevision(v => v + 1); }}>{t("重新載入品牌", "Reload brands")}</button>
    </div>
    {!loading && !options.length && !chosen && <p>{t("請先在品牌資料庫建立包含字型使用權與事實欄位的品牌版本。", "First publish a brand version with font usage rights and facts in the Brand library.")}</p>}
    {chosen && <>
      <Field label={t("使用渠道", "Usage channel")}><select value={channel} disabled={locked} onChange={e => { invalidate(); setChannel(e.target.value); }}>{chosen.channels.map(v => <option key={v}>{v}</option>)}</select></Field>
      <Field label={t("語言與地區", "Language and region")}><select value={locale} disabled={locked} onChange={e => { invalidate(); setLocale(e.target.value); }}>{chosen.locales.map(v => <option key={v}>{v}</option>)}</select></Field>
      {textKeys.map(k => mapField("fonts", k, fonts, chosen.fonts.map(f => ({ key: f.key, label: `${f.label} · ${f.key}`, disabled: editableFonts && !f.editable_supported || !f.channels.includes(channel) || !!f.valid_until && Date.parse(f.valid_until) <= Date.now() })), setFonts))}
      {factKeys.map(k => mapField("facts", k, facts, chosen.facts.filter(f => f.kind === requirements.texts.find(v => v.fact_key === k)?.fact_kind).map(f => ({ key: f.key, label: `${f.key} · ${f.text}`, disabled: f.state !== "available" })), setFacts))}
      {logoKeys.map(k => mapField("logos", k, logos, chosen.logos.map(f => ({ key: f.key, label: `${f.key} · ${f.usage}` })), setLogos))}
      <details><summary>{t("套用目的品牌配色（選填）", "Apply destination brand colors (optional)")}</summary>
        {colors.map(c => <Field key={c} label={c}><select aria-label={`color:${c}`} disabled={locked} value={palette[c] ?? ""} onChange={e => { invalidate(); setPalette(v => ({ ...v, [c]: e.target.value })); }}>
          <option value="">{t("保留原色", "Keep original color")}</option>{chosen.colors.map(v => <option key={v}>{v}</option>)}
        </select></Field>)}
      </details>
      <button type="button" className="button secondary" disabled={locked || !canReview} onClick={() => void (async () => {
        invalidate(); const version = epoch.current; setBusy(true);
        const target = { binding: { id: chosen.brand_id, version: chosen.version, channel, locale }, fonts: mapping(textKeys, fonts), facts: mapping(factKeys, facts), logos: mapping(logoKeys, logos),
          colors: colors.filter(c => palette[c]).map(from => ({ from, to: palette[from] })) };
        try { const data = await api(root + "/brand-preview", { method: "POST", body: JSON.stringify({ ...selection, brand_target: target }) });
          if (live.current && version === epoch.current) { reviewed.current = { brand_target: target, brand_review_hash: data.review_hash, confirm_brand_review: true }; setReview(data); }
        } catch (e) { if (live.current && version === epoch.current) setError(e); }
        finally { if (live.current) setBusy(false); }
      })()}>{busy ? t("正在核對品牌…", "Checking brand…") : t("核對品牌替換內容", "Review brand changes")}</button>
    </>}
    {review && <div className="creative-brand-comparison" data-brand-review>
      <p><strong>{review.source_name} → {review.target_name}</strong></p>
      {review.texts.map((v: any) => <article key={v.layer}><strong>{t("文字圖層", "Text layer")} {v.layer + 1}</strong><p>{v.before}</p><p>→ {v.after}</p><small>{v.source_font_key} → {v.target_font_key} · {v.font_label}</small></article>)}
      {review.logos.map((v: any) => <p key={v.layer}>Logo {v.layer + 1}: {v.source_key} → {v.target_key}</p>)}
      {review.colors.map((v: any) => <p key={v.from}>{v.from} → {v.to}</p>)}
      <label className="creative-package-consent"><input type="checkbox" checked={approved} disabled={locked} onChange={e => { setApproved(e.target.checked); onChange(e.target.checked ? reviewed.current : null); }} />
        <span>{t("我已核對字型、事實、Logo、保留文案與配色，確認用於目的品牌。", "I reviewed fonts, facts, Logos, retained copy and colors and approve them for the destination brand.")}</span></label>
    </div>}
  </section>;
}
