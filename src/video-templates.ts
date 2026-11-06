import {
  videoDefinition,
  type VideoDefinition,
} from "./video-project-model.js";

const entries = [
  [
    "campaign-launch",
    "活動開場",
    "Campaign launch",
    ["讓下一個點子被看見", "展示真正的亮點", "一起開始下一步"],
    [
      "Make room for ideas",
      "Show what matters",
      "Take the next step",
    ],
  ],
  [
    "product-story",
    "產品故事",
    "Product story",
    ["從一個需要開始", "把產品放進生活", "看看它如何幫到你"],
    [
      "Start with a need",
      "Meet the product",
      "Find your fit",
    ],
  ],
  [
    "event-invite",
    "活動邀請",
    "Event invitation",
    ["為相遇留一點時間", "分享這次活動的內容", "填上日期與報名方式"],
    [
      "Make time to meet",
      "Explore the agenda",
      "Date and booking",
    ],
  ],
  [
    "service-explainer",
    "服務介紹",
    "Service explainer",
    ["先了解你的需要", "說清楚我們如何協作", "約定下一次交流"],
    [
      "Know the work ahead",
      "Work together",
      "Let us talk",
    ],
  ],
  [
    "announcement",
    "品牌消息",
    "Brand announcement",
    ["我們有個新消息", "說說這次改變的意義", "邀請大家一起參與"],
    [
      "Something to share",
      "What is changing",
      "Join the next step",
    ],
  ],
  [
    "recruitment",
    "團隊招募",
    "Team recruitment",
    ["讓工作多一種可能", "分享真實的團隊日常", "填上職位與聯絡方式"],
    [
      "Join our team",
      "A day with the team",
      "Role and contact",
    ],
  ],
] as const;
export const videoTemplateIds = entries.map((e) => e[0]);
export function videoTemplates(
  locale: "zh-HK" | "en",
  format: "portrait" | "square" | "landscape",
) {
  const [width, height] =
    format === "portrait"
      ? [720, 1280]
      : format === "landscape"
        ? [1280, 720]
        : [720, 720];
  return entries.map(([id, zh, en, zhText, enText]) => {
    const labels = locale === "zh-HK" ? zhText : enText;
    const definition: VideoDefinition = videoDefinition.parse({
      schema_version: "copypaste-video-1",
      template: "campaign-cuts-1",
      locale,
      width,
      height,
      frame_rate: { numerator: 30, denominator: 1 },
      duration_frames: 450,
      script: {
        title: locale === "zh-HK" ? zh : en,
        brief: "",
        narration: "",
        call_to_action: locale === "zh-HK" ? "了解更多" : "Find out more",
      },
      brand: {
        label: "",
        background: "#f4f5f7",
        ink: "#161c28",
        accent: "#2458df",
        logo: null,
      },
      storyboard: labels.map((headline, i) => ({
        key: "scene_" + (i + 1),
        start_frame: i * 150,
        end_frame: (i + 1) * 150,
        direction: "",
        headline,
        body: "",
        image: null,
        ...(i
          ? {
              transition: {
                kind: i === 1 ? "crossfade" : "slide-left",
                frames: 15,
              },
            }
          : {}),
      })),
      subtitles: [],
      audio: null,
    });
    return { id, name: { "zh-HK": zh, en }, definition };
  });
}
