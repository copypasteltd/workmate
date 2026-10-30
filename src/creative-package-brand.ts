type Context = { root: string; live: () => boolean; tr: (zh: string, en: string) => string;
  request: (path: string, method?: string, body?: unknown) => Promise<any> };

/** Project-scoped brand review inside the existing native right Side Panel. */
export function mountCreativePackageBrand(host: HTMLElement, io: Context, selection: any, preview: any, onChange: (approval: any) => void) {
  let disposed = false, busy = false, epoch = 0, options: any[] = [], chosen: any = null, approved: any = null;
  const active = () => !disposed && io.live(), tr = io.tr, requirements = preview.brand_requirements;
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => { const e = document.createElement(tag); if (text) e.textContent = text; return e; };
  const section = make("section"), fields = make("fieldset"), selectors = make("div"), maps = make("div"), comparison = make("div"), error = make("p");
  section.className = "creative-brand-rebind"; fields.className = "creative-brand-fields"; error.setAttribute("role", "alert");
  const brand = make("select"), previous = make("button", tr("上一頁品牌", "Previous brands")), more = make("button", tr("更多品牌版本", "More brand versions")),
    reload = make("button", tr("重新載入品牌", "Reload brands"));
  brand.ariaLabel = tr("目的品牌固定版本", "Fixed destination brand version");
  for (const b of [previous, more, reload]) b.type = "button";
  let cursors = [""], next: string | null = null;
  section.append(make("h4", tr("將設計套用到目的品牌", "Adapt this design to your brand")),
    make("p", tr("來源品牌：", "Source brand: ") + requirements.source_name),
    make("p", tr("請核對字型、事實與 Logo；未綁定的文案和未替換的顏色會保留。", "Review fonts, facts and Logos. Unbound copy and colors without replacements stay as they are.")), error, fields);
  fields.append(brand, previous, more, reload, selectors, maps, comparison); host.replaceChildren(section);
  const resetReview = () => { epoch++; approved = null; onChange(null); comparison.replaceChildren(); error.textContent = ""; };
  const run = async (work: () => Promise<void>) => { if (busy || !active()) return; busy = true; fields.disabled = true; error.textContent = "";
    try { await work(); } catch (e) { if (active()) error.textContent = (e as Error).message; }
    finally { busy = false; if (active()) fields.disabled = false; } };
  async function load() {
    const data = await io.request(io.root + "/brand-options" + (cursors.at(-1) ? "?cursor=" + cursors.at(-1) : "")); if (!active()) return;
    options = data.items; next = data.next_cursor;
    brand.replaceChildren(new Option(tr("選擇目的品牌固定版本", "Choose destination brand version"), ""));
    if (chosen && !options.some(v => v.id === chosen.id)) brand.append(new Option(`${chosen.name} · v${chosen.version}`, chosen.id));
    for (const b of options) { const option = new Option(`${b.name} · v${b.version}`, b.id); option.disabled = !b.available; brand.append(option); }
    brand.value = chosen?.id ?? ""; previous.hidden = cursors.length < 2; more.hidden = !next;
    if (!options.length && !chosen) error.textContent = tr("請先在品牌資料庫發佈包含字型使用權與事實的品牌版本。", "First publish a brand version with font usage rights and facts in the Brand library.");
  }
  const label = (text: string, control: HTMLElement) => { const l = make("label"); l.append(make("span", text), control); return l; };
  const select = (name: string, values: { key: string; label: string; disabled?: boolean }[], value = "", optional = false) => {
    const e = make("select"); e.ariaLabel = name;
    e.append(new Option(optional ? tr("保留原色", "Keep original color") : tr("選擇目的品牌欄位", "Choose a target brand field"), ""));
    for (const v of values) { const o = new Option(v.label, v.key); o.disabled = !!v.disabled; e.append(o); }
    e.value = value; return e;
  };
  brand.onchange = () => {
    resetReview(); chosen = options.find(v => v.id === brand.value) ?? (chosen?.id === brand.value ? chosen : null); selectors.replaceChildren(); maps.replaceChildren();
    if (!chosen) return; const b = chosen;
    const channel = select(tr("使用渠道", "Usage channel"), b.channels.map((v: string) => ({ key: v, label: v })), b.channels[0]),
      locale = select(tr("語言與地區", "Language and region"), b.locales.map((v: string) => ({ key: v, label: v })), b.locales[0]);
    selectors.append(label(tr("使用渠道", "Usage channel"), channel), label(tr("語言與地區", "Language and region"), locale));
    const fontKeys = [...new Set<string>(requirements.texts.map((v: any) => v.font_key))],
      factKeys = [...new Set<string>(requirements.texts.flatMap((v: any) => v.fact_key ? [v.fact_key] : []))],
      logoKeys = [...new Set<string>(requirements.logos.map((v: any) => v.key))];
    const controls: { kind: string; source: string; field: HTMLSelectElement }[] = [];
    for (const [kind, keys, rows] of [["fonts", fontKeys, b.fonts], ["facts", factKeys, b.facts], ["logos", logoKeys, b.logos]] as const) {
      for (const key of keys) {
        const choices = rows.filter((v: any) => kind !== "facts" || v.kind === requirements.texts.find((r: any) => r.fact_key === key)?.fact_kind)
          .map((v: any) => ({ key: v.key, label: `${v.key} · ${v.label ?? v.text ?? v.usage ?? ""}`, disabled: kind === "facts" && v.state !== "available" }));
        const field = select(`${kind}:${key}`, choices, choices.some((v: any) => v.key === key) ? key : "");
        controls.push({ kind, source: key, field }); maps.append(label(`${kind === "fonts" ? tr("字型", "Font") : kind === "facts" ? tr("事實", "Fact") : "Logo"} · ${key}`, field));
      }
    }
    const colors = make("details"); colors.append(make("summary", tr("套用品牌配色（選填）", "Apply brand colors (optional)")));
    const palette = (preview.brand_design_colors ?? []).map((from: string) => {
      const field = select(`color:${from}`, b.colors.map((v: string) => ({ key: v, label: v })), "", true); colors.append(label(from, field)); return { from, field };
    }); maps.append(colors);
    const review = make("button", tr("核對品牌替換內容", "Review brand changes")); review.type = "button"; maps.append(review);
    const update = () => { review.disabled = !channel.value || !locale.value || controls.some(c => !c.field.value || c.field.selectedOptions[0]?.disabled); };
    const updateFonts = () => { for (const c of controls.filter(v => v.kind === "fonts")) for (const option of c.field.options) {
      const f = b.fonts.find((v: any) => v.key === option.value); if (f) option.disabled = !f.channels.includes(channel.value) || !!f.valid_until && Date.parse(f.valid_until) <= Date.now();
    } };
    for (const e of [channel, locale, ...controls.map(c => c.field), ...palette.map((c: any) => c.field)]) e.onchange = () => { resetReview(); updateFonts(); update(); };
    updateFonts(); update();
    review.onclick = () => void run(async () => {
      resetReview(); const version = epoch;
      const mapping = (kind: string) => controls.filter(c => c.kind === kind).map(c => ({ source_key: c.source, target_key: c.field.value }));
      const target = { binding: { id: b.brand_id, version: b.version, channel: channel.value, locale: locale.value }, fonts: mapping("fonts"), facts: mapping("facts"), logos: mapping("logos"),
        colors: palette.filter((c: any) => c.field.value).map((c: any) => ({ from: c.from, to: c.field.value })) };
      const data = await io.request(io.root + "/brand-preview", "POST", { ...selection, brand_target: target }); if (!active() || version !== epoch) return;
      approved = { brand_target: target, brand_review_hash: data.review_hash, confirm_brand_review: true };
      comparison.replaceChildren(make("strong", `${data.source_name} → ${data.target_name}`));
      for (const v of data.texts) { const card = make("article"); card.append(make("strong", `${tr("文字圖層", "Text layer")} ${v.layer + 1}`), make("p", v.before), make("p", "→ " + v.after), make("small", `${v.source_font_key} → ${v.target_font_key} · ${v.font_label}`)); comparison.append(card); }
      for (const v of data.logos) comparison.append(make("p", `Logo ${v.layer + 1}: ${v.source_key} → ${v.target_key}`));
      for (const v of data.colors) comparison.append(make("p", `${v.from} → ${v.to}`));
      const acknowledge = make("input"); acknowledge.type = "checkbox"; const consent = label(tr("我已核對字型、事實、Logo、保留文案與配色，確認用於目的品牌。", "I reviewed fonts, facts, Logos, retained copy and colors and approve them for the destination brand."), acknowledge);
      consent.className = "creative-package-consent"; comparison.append(consent);
      acknowledge.onchange = () => { if (active()) onChange(acknowledge.checked ? approved : null); };
    });
  };
  previous.onclick = () => void run(async () => { cursors.pop(); await load(); });
  more.onclick = () => void run(async () => { if (next) cursors.push(next); await load(); });
  reload.onclick = () => void run(async () => { resetReview(); chosen = null; cursors = [""]; selectors.replaceChildren(); maps.replaceChildren(); await load(); });
  void run(load);
  return () => { disposed = true; epoch++; };
}
