import { useState } from "react";
import { Field, useData, useI18n } from "./ui";
import { ErrorNotice } from "./ui";

export function DesignTemplateStart({ root, disabled, create }: { root: string; disabled: boolean; create: (body: any) => void }) {
  const { t, locale } = useI18n(), templates = useData<{ items: any[] }>(root + "/templates"),
    [chosen, setChosen] = useState(""), [name, setName] = useState(""), [language, setLanguage] = useState<"zh-HK" | "en-HK">(locale === "en" ? "en-HK" : "zh-HK"), [confirmed, setConfirmed] = useState(false);
  const labels = (value: any) => value[locale === "en" ? "en-HK" : "zh-HK"], selected = templates.data?.items.find(v => v.id === chosen);
  return <details className="editable-create design-template-start"><summary>{t("從版面開始新作品", "Start a new work from a layout")}</summary>
    <div className="form-stack"><p className="muted">{t("選擇可直接編輯的版面，再加入自己的文字、圖片與資料。開工及人工編輯不產生AI調用費用。", "Choose an editable layout, then add your words, images and data. Starting and editing manually incur no AI request charge.")}</p><ErrorNotice error={templates.error} />
      <div className="design-template-grid">{templates.data?.items.map(item => <button key={item.id} type="button" className="design-template-card" aria-pressed={chosen === item.id} disabled={disabled} onClick={() => { setChosen(item.id); setName(labels(item.name)); setConfirmed(false); }}>
        <span className={`design-template-mini ${item.kind}`} aria-hidden="true"><i /><b /><em /></span><strong>{labels(item.name)}</strong><span>{labels(item.description)}</span><small>{item.width} × {item.height} · {item.pages} {t("頁", "pages")}</small></button>)}</div>
      <div className="editable-properties"><Field label={t("新作品名稱", "New work name")}><input value={name} maxLength={160} disabled={disabled} onChange={e => setName(e.target.value)} /></Field><Field label={t("版面文字語言", "Layout text language")}><select value={language} disabled={disabled} onChange={e => setLanguage(e.target.value as "zh-HK" | "en-HK")}><option value="zh-HK">繁體中文</option><option value="en-HK">English</option></select></Field></div>
      <label className="creative-package-consent"><input type="checkbox" checked={confirmed} disabled={disabled} onChange={e => setConfirmed(e.target.checked)} />{t("我同意在目前專案建立可共用的作品。", "Create a shared work in the current project.")}</label>
      <button className="button secondary" disabled={disabled || !selected || !name.trim() || !confirmed} onClick={() => create({ name: name.trim(), template_id: chosen, locale: language, confirm_project_sharing: true })}>{t("建立版面並開始編輯", "Create layout & start editing")}</button>
    </div></details>;
}
