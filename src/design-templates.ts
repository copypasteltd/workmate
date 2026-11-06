import { z } from "zod";
import { cleanEditableInput, type EditableKind } from "./editable-project-source.js";

export const designTemplateIds = ["campaign-square", "campaign-story", "web-banner", "pitch-deck", "performance-review", "product-brief"] as const;
export const designTemplateId = z.enum(designTemplateIds);
const definitions = [
  ["campaign-square", "vector", 1080, 1080, "品牌方形宣傳", "Square campaign", "品牌活動與社交貼文", "Brand campaigns and social posts"],
  ["campaign-story", "vector", 1080, 1920, "直向活動海報", "Portrait campaign", "直向活動與限時動態", "Portrait campaigns and stories"],
  ["web-banner", "vector", 1600, 900, "網站橫幅", "Website banner", "產品發布與網站主視覺", "Product launches and website visuals"],
  ["pitch-deck", "presentation", 1600, 900, "客戶提案", "Client proposal", "背景、方案與下一步", "Context, proposal and next steps"],
  ["performance-review", "presentation", 1600, 900, "成效回顧", "Performance review", "匯入已核對的數據圖表", "Add charts from reviewed evidence"],
  ["product-brief", "presentation", 1600, 900, "產品簡報", "Product brief", "需求、產品與決策", "Needs, product and decision"],
] as const;

export const designTemplates = definitions.map(([id, kind, width, height, zh, en, zhDescription, enDescription]) => ({
  id, kind, width, height, name: { "zh-HK": zh, "en-HK": en }, description: { "zh-HK": zhDescription, "en-HK": enDescription },
  pages: kind === "vector" ? 1 : 3,
}));

export function designTemplate(id: z.infer<typeof designTemplateId>, locale: "zh-HK" | "en-HK") {
  const item = designTemplates.find(t => t.id === id)!, zh = locale === "zh-HK", width = item.width, height = item.height;
  const scene = (headline: string, caption: string) => ({ width, height, background: "#f6f3ed", layers: [
    { kind: "rect", id: "accent", x: 72, y: 72, w: 12, h: height - 144, fill: "#b55f36", stroke: null, stroke_width: 0, radius: 0 },
    { kind: "text", id: "eyebrow", x: 120, y: 92, w: width - 192, h: 60, text: zh ? "由好想法開始。" : "A GOOD IDEA STARTS HERE.", font_size: 24, weight: 700, color: "#b55f36" },
    { kind: "text", id: "headline", x: 120, y: Math.round(height * .26), w: width - 240, h: Math.round(height * .36), text: headline, font_size: width === 1080 ? 64 : 76, weight: 700, color: "#282724", line_height: 1.3 },
    { kind: "text", id: "caption", x: 120, y: height - 170, w: width - 240, h: 100, text: caption, font_size: 26, weight: 400, color: "#615b54" },
  ] });
  const title = item.name[locale], kind = item.kind as EditableKind;
  if (kind === "vector") return { kind, input: cleanEditableInput(kind, { title, locale, purpose: item.description[locale],
    scene: scene(zh ? "讓你的下一個\n好想法成形。" : "Give your next\ngood idea a shape.", zh ? "編輯文字，加入你的圖片，再交付下一個版本。" : "Edit the words. Add your image. Make the next version.") }) };
  const headlines = zh ? ["把想法，\n說得更清楚。", "用已核對的證據，\n支持每個觀察。", "把下一步，\n變成共同決定。"]
    : ["Give the idea\na clear direction.", "Let reviewed evidence\nsupport the story.", "Make the next step\na shared decision."];
  return { kind, input: cleanEditableInput(kind, { title, locale, audience: zh ? "客戶與團隊" : "Clients and team", decision: zh ? "確認方案與下一步" : "Agree on the proposal and next step",
    slides: headlines.map((headline, i) => ({ id: "page_" + (i + 1), title: zh ? ["背景與目標", "方案與證據", "下一步"][i] : ["Context and goals", "Proposal and evidence", "Next steps"][i], notes: "",
      scene: scene(headline, zh ? "這是可編輯版面；請加入你的實際內容。" : "An editable starting layout. Add your actual content.") })) }) };
}
