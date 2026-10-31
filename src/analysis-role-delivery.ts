import { createHash } from "node:crypto";
import { zipSync, type Zippable } from "fflate";
import { z } from "zod";
import {
  analysisSpec,
  metricIds,
  reportNarrative,
  validatedNarrative,
  type AnalysisCalculation,
} from "./analysis-calculation.js";
import { canonical, csvCell, hash, Problem, uuid } from "./lib.js";
import { pngFromSVG } from "./render.js";
import { importOptions } from "./analytics-import.js";

export const analysisDeliveryVersion = "copypaste-analysis-delivery-1";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const analysisFileInput = z
  .object({
    asset_version_id: uuid,
    sha256: digest,
    options: importOptions
      .extend({
        mapping: z
          .object({
            date: z.string().max(200).optional(),
            date_end: z.string().max(200).optional(),
            channel: z.string().max(200).optional(),
            campaign: z.string().max(200).optional(),
            entity_id: z.string().max(200).optional(),
            account_id: z.string().max(200).optional(),
            impressions: z.string().max(200).optional(),
            clicks: z.string().max(200).optional(),
            spend: z.string().max(200).optional(),
            conversions: z.string().max(200).optional(),
            revenue: z.string().max(200).optional(),
            currency: z.string().max(200).optional(),
          })
          .strict()
          .default({}),
      })
      .strict(),
    sheet_name: z.string().min(1).max(200).optional(),
    header_row: z.number().int().min(1).max(1000).optional(),
    csv_delimiter: z.enum(["comma", "semicolon", "tab"]).optional(),
    csv_encoding: z.enum(["utf8", "utf16le", "utf16be"]).optional(),
  })
  .strict();
export const roleAnalysisSpec = analysisSpec
  .extend({ file_inputs: z.array(analysisFileInput).max(10).default([]) })
  .strict();
export const analysisCalculateInput = z
  .object({
    specification: roleAnalysisSpec,
    offset: z.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const analysisRenderInput = z
  .object({
    specification: roleAnalysisSpec,
    calculation_sha256: digest,
    title: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine(
        (v) => !/\p{N}/u.test(v),
        "Use a nonnumerical title; measured values belong in evidence-bound narrative",
      ),
    locale: z.enum(["zh-HK", "en-HK"]),
    metrics: z.array(z.enum(metricIds)).min(1).max(4),
    scope_ids: z.array(uuid).min(1).max(8),
    narrative: reportNarrative.optional(),
    revision_of: z
      .object({ source_version_id: uuid, sha256: digest })
      .strict()
      .optional(),
  })
  .strict();
export type AnalysisRenderInput = z.infer<typeof analysisRenderInput>;
const xml = (v: unknown) =>
  String(v ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
// Dates are serialized before canonical hashing; JS Date objects have no own keys.
export function calculationDigest(calculation: AnalysisCalculation) {
  return hash(canonical(JSON.parse(JSON.stringify(calculation))));
}
export function analysisCalculationPage(
  calculation: AnalysisCalculation,
  offset: number,
) {
  if (offset > calculation.evidence.length)
    throw new Problem(
      422,
      "ANALYSIS_PAGE_RANGE",
      "The evidence offset exceeds this calculation",
    );
  const end = offset + 24;
  const evidence = calculation.evidence.slice(offset, end);
  const snapshotIds = new Set(evidence.map((e) => e.snapshot_id));
  return {
    schema: analysisDeliveryVersion,
    calculation_sha256: calculationDigest(calculation),
    specification: calculation.spec,
    coverage: calculation.coverage,
    sources: calculation.sources,
    scopes: calculation.groups
      .filter((g) =>
        Object.values(g.periods).some((s: any) => snapshotIds.has(s.id)),
      )
      .map((g) => ({
        id: g.periods.current.id,
        scope: g.scope,
        periods: Object.entries(g.periods).map(
          ([period, s]: [string, any]) => ({
            period,
            snapshot_id: s.id,
            row_count: s.row_count,
            observed_range: s.observed_range,
          }),
        ),
      })),
    evidence,
    total_scopes: calculation.groups.length,
    total_evidence: calculation.evidence.length,
    next_offset: end < calculation.evidence.length ? end : null,
    limitations: calculation.limitations,
  };
}
const metricNames: Record<string, [string, string]> = {
  spend: ["Spend", "支出"],
  impressions: ["Impressions", "曝光"],
  clicks: ["Clicks", "點擊"],
  conversions: ["Conversions", "轉換"],
  conversion_value: ["Conversion value", "轉換價值"],
  ctr: ["CTR", "點擊率"],
  cpc: ["CPC", "每次點擊成本"],
  cpm: ["CPM", "每千次曝光成本"],
  cvr: ["CVR", "轉換率"],
  cpa: ["CPA", "每次轉換成本"],
  roas: ["ROAS", "廣告支出回報"],
};
const scaled = (v: string) => {
  if (!/^\d+(?:\.\d{1,8})?$/.test(v))
    throw new Error("Unexpected deterministic metric format");
  const [whole, fraction = ""] = v.split(".");
  return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0"));
};
const nullNames: Record<string, [string, string]> = {
  missing_metric: ["Required data is missing", "缺少所需數據"],
  no_rows: ["No rows in this date range", "此日期範圍沒有資料"],
  zero_denominator: ["The denominator is zero", "分母為零，無法計算"],
  missing_conversions: ["Conversion data is incomplete", "轉換數據不完整"],
  missing_conversion_value: [
    "Conversion value is incomplete",
    "轉換價值不完整",
  ],
  new_value: ["No nonzero comparison baseline", "對比期沒有非零基準"],
  zero_previous: ["The comparison baseline is zero", "對比期基準為零"],
};
const nullLabel = (reason: string | null | undefined, zh: boolean) =>
  nullNames[reason ?? "missing_metric"]?.[zh ? 1 : 0] ?? String(reason);
function displayValue(
  value: string | null,
  metric: string,
  unit: string,
  reason?: string | null,
  zh = false,
) {
  if (value === null) return `N/A · ${nullLabel(reason, zh)}`;
  if (["ctr", "cvr"].includes(metric)) {
    const v = scaled(value) * 100n;
    return `${v / 100000000n}.${(v % 100000000n).toString().padStart(8, "0")}%`;
  }
  return `${value}${unit === "count" ? "" : " " + (metric === "roas" ? "×" : unit)}`;
}
function wrap(value: string, width: number, size: number) {
  const lines: string[] = [];
  let line = "",
    used = 0;
  for (const c of value) {
    const next = /[^\u0000-\u007f]/.test(c) ? size : size * 0.59;
    if (used + next > width && line) {
      lines.push(line);
      line = "";
      used = 0;
    }
    line += c;
    used += next;
  }
  if (line) lines.push(line);
  return lines;
}
function svgLines(
  value: string,
  x: number,
  y: number,
  width: number,
  size: number,
  color: string,
  weight = 400,
) {
  const lines = wrap(value, width, size);
  return {
    lines: lines.length,
    svg: `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${lines.map((line, i) => `<tspan x="${x}" dy="${i ? size * 1.4 : 0}">${xml(line)}</tspan>`).join("")}</text>`,
  };
}
function scopeLabel(g: any, zh: boolean) {
  const s = g.scope;
  const dimensions = Object.entries(s.dimensions ?? {})
    .map(([k, v]) => {
      const value =
        k === "date" && v && typeof v === "object"
          ? `day offset ${(v as any).period_day}`
          : v;
      return `${k}: ${value ?? "—"}`;
    })
    .join(" · ");
  return `${s.source} · ${s.account_id || (zh ? "未提供帳戶" : "Unspecified account")} · ${s.currency}${dimensions ? " · " + dimensions : ""}`;
}
function scopeDefinitions(g: any) {
  return `${g.scope.attribution_definition} · ${g.scope.conversion_definition} · ${g.scope.entity_level}`;
}
function renderScope(g: any, input: AnalysisRenderInput, y: number) {
  const zh = input.locale === "zh-HK";
  const label = svgLines(
    scopeLabel(g, zh),
    64,
    y + 34,
    1050,
    19,
    "#15171a",
    600,
  );
  const definitionY = y + 38 + label.lines * 27;
  const definition = svgLines(
    scopeDefinitions(g),
    64,
    definitionY,
    1050,
    13,
    "#52627a",
  );
  let cursor = definitionY + definition.lines * 19 + 22;
  let content = label.svg + definition.svg;
  for (const metric of input.metrics) {
    const a = g.periods.current,
      b = g.periods.comparison;
    const value = a.summary.exact[metric] as string | null;
    const old = b ? (b.summary.exact[metric] as string | null) : null;
    const unit = ["spend", "conversion_value", "cpc", "cpm", "cpa"].includes(
      metric,
    )
      ? String(g.scope.currency)
      : ["ctr", "cvr", "roas"].includes(metric)
        ? "ratio"
        : "count";
    const max = [value, old]
      .filter((v): v is string => v !== null)
      .reduce((m, v) => (scaled(v) > m ? scaled(v) : m), 0n);
    content += `<text x="64" y="${cursor}" font-size="15" font-weight="600" fill="#15171a">${xml(metricNames[metric][zh ? 1 : 0])}</text>`;
    const periods = b
      ? ([
          ["current", a, value, "#1f5eff"],
          ["comparison", b, old, "#778da9"],
        ] as const)
      : ([["current", a, value, "#1f5eff"]] as const);
    for (const [period, s, v, color] of periods) {
      cursor += 29;
      const reason = s.summary.null_reasons[metric];
      const width =
        v === null || max === 0n ? 0 : Number((scaled(v) * 530n) / max);
      const label = zh
        ? period === "current"
          ? "本期"
          : "比較期"
        : period === "current"
          ? "Current"
          : "Previous";
      content += `<text x="64" y="${cursor + 1}" font-size="12" fill="#52627a">${label}</text><line x1="154" x2="684" y1="${cursor + 6}" y2="${cursor + 6}" stroke="#dce4ef"/>`;
      if (v !== null && v !== "0.00000000")
        content += `<rect x="154" y="${cursor - 14}" width="${Math.max(1, width)}" height="20" rx="4" fill="${color}"/>`;
      else if (v !== null)
        content += `<circle cx="154" cy="${cursor - 4}" r="3" fill="${color}"/>`;
      content += `<text x="710" y="${cursor + 1}" font-size="13" fill="${v === null ? "#80623b" : "#15171a"}">${xml(displayValue(v, metric, unit, reason, zh))}</text>`;
    }
    cursor += 32;
  }
  const height = cursor - y + 8;
  return {
    height,
    svg: `<g data-scope="${g.periods.current.id}"><rect x="36" y="${y}" width="1128" height="${height}" rx="16" fill="#fff" stroke="#dce4ef"/>${content}</g>`,
  };
}
function reportSVG(
  calculation: AnalysisCalculation,
  input: AnalysisRenderInput,
  groups: any[],
  dataMode: string,
) {
  const zh = input.locale === "zh-HK";
  const title = svgLines(input.title, 48, 104, 1090, 32, "#15171a", 600);
  let cursor = 130 + title.lines * 45;
  const subtitle = `${calculation.spec.date_from} → ${calculation.spec.date_to} · ${calculation.spec.timezone}`;
  let content = `<text x="48" y="47" font-size="13" fill="#1f5eff" font-weight="700">COPYPASTE / WORKMATE · ${xml(dataMode)}</text>${title.svg}<text x="48" y="${cursor}" font-size="15" fill="#52627a">${xml(subtitle)}</text>`;
  cursor += 28;
  content += `<text x="48" y="${cursor}" font-size="12" fill="#52627a">${zh ? "各指標按本口徑獨立比例；空缺不視為零。完整證據見報告及 CSV。" : "Each metric uses its own scope scale. Missing values are not zero. Full evidence: report and CSV."}</text>`;
  cursor += 24;
  for (const group of groups) {
    const panel = renderScope(group, input, cursor);
    content += panel.svg;
    cursor += panel.height + 20;
  }
  const digest = calculationDigest(calculation);
  content += `<text x="48" y="${cursor + 12}" font-size="12" fill="#52627a">${zh ? "已選視覺口徑" : "Visual scopes"}: ${groups.length}/${calculation.groups.length} · ${zh ? "平台取數截止時間未知" : "Platform extraction cutoff unknown"}</text><text x="48" y="${cursor + 35}" font-size="11" fill="#52627a">SHA-256 ${digest}</text>`;
  const height = cursor + 64;
  if (height > 6000)
    throw new Problem(
      422,
      "ANALYSIS_VISUAL_LIMIT",
      "Select fewer scopes or metrics for one infographic",
    );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}" role="img" aria-labelledby="title desc"><title id="title">${xml(input.title)}</title><desc id="desc">${xml(subtitle)}. ${groups.length} independent scopes. Exact values and missing-data reasons are also available in HTML and CSV.</desc><rect width="1200" height="${height}" fill="#f6f6f4"/><g font-family="Manrope,Microsoft JhengHei,Arial,sans-serif">${content}</g></svg>`;
}
type InputDataset = {
  id: string;
  source: string;
  currency: string;
  timezone: string;
  rows: any[];
  import_spec: any;
  source_sha256: string;
  spec_hash: string;
};
export function renderAnalysisDelivery(
  calculation: AnalysisCalculation,
  raw: unknown,
  datasets: InputDataset[],
  dataMode: string,
) {
  const input = analysisRenderInput.parse(raw),
    zh = input.locale === "zh-HK";
  if (calculationDigest(calculation) !== input.calculation_sha256)
    throw new Problem(
      409,
      "ANALYSIS_CALCULATION_CHANGED",
      "Recalculate the exact specification before rendering; the supplied hash does not match its frozen facts",
    );
  if (
    new Set(input.scope_ids).size !== input.scope_ids.length ||
    new Set(input.metrics).size !== input.metrics.length
  )
    throw new Problem(
      422,
      "ANALYSIS_VISUAL_DUPLICATE",
      "Select each visual scope and metric once",
    );
  const groups = input.scope_ids.map((id) =>
    calculation.groups.find((g) => g.periods.current.id === id),
  );
  if (
    groups.some((g) => !g) ||
    input.metrics.some((m) => !calculation.spec.metrics.includes(m))
  )
    throw new Problem(
      422,
      "ANALYSIS_VISUAL_SCOPE",
      "Every visual scope and metric must belong to this calculation",
    );
  const first =
    calculation.evidence.find((e) => e.value !== null) ??
    calculation.evidence[0];
  const narrative = validatedNarrative(
    JSON.stringify(
      input.narrative ?? {
        observations: [
          {
            text: zh
              ? `已選口徑的計算結果為 {{${first.id}}}。`
              : `The selected scope returns {{${first.id}}}.`,
            evidence_ids: [first.id],
          },
        ],
        hypotheses: [],
        next_steps: [
          zh
            ? "核對資料涵蓋與歸因口徑後，再制定創意測試。"
            : "Review source coverage and attribution before planning a creative test.",
        ],
      },
    ),
    calculation,
  );
  const refs = new Map(calculation.evidence.map((e) => [e.id, e]));
  const interpolate = (text: string, html = false) =>
    (html ? xml(text) : text).replace(/\{\{([a-f0-9-]{36})\}\}/g, (_, id) => {
      const e = refs.get(id)!;
      const value =
        e.value === null ? `N/A (${e.null_reason})` : `${e.value} ${e.unit}`;
      return html
        ? `<a href="#evidence-${id}">${xml(value)}</a>`
        : `${value} [evidence:${id}]`;
    });
  const svg = reportSVG(calculation, input, groups, dataMode);
  const groupIds = new Map(
    calculation.groups.flatMap((g) =>
      Object.values(g.periods).map(
        (s: any) => [s.id, g.periods.current.id] as const,
      ),
    ),
  );
  const script = `const scope=document.getElementById('scope');scope.addEventListener('change',()=>{for(const element of document.querySelectorAll('[data-scope]'))element.toggleAttribute('hidden',scope.value!==''&&element.dataset.scope!==scope.value);document.getElementById('scope-status').textContent=scope.options[scope.selectedIndex].text;});`;
  const scriptDigest = createHash("sha256").update(script).digest("base64");
  const statements = (items: typeof narrative.observations) =>
    items.map((s) => `<li>${interpolate(s.text, true)}</li>`).join("");
  const mobileCharts = groups
    .map(
      (
        g,
      ) => `<article class="card mobile-scope" data-scope="${g!.periods.current.id}">
    <h3>${xml(scopeLabel(g, zh))}</h3><p class="muted">${xml(scopeDefinitions(g))}</p>
    ${input.metrics
      .map(
        (
          metric,
        ) => `<div class="metric"><strong>${xml(metricNames[metric][zh ? 1 : 0])}</strong>
      ${Object.entries(g!.periods)
        .map(([period, snap]: [string, any]) => {
          const e = calculation.evidence.find(
            (e) => e.snapshot_id === snap.id && e.metric_id === metric,
          );
          return `<p><span>${period === "current" ? (zh ? "本期" : "Current") : zh ? "對比期" : "Comparison"}</span><b>${xml(displayValue(snap.summary.exact[metric], metric, e?.unit ?? g!.scope.currency, snap.summary.null_reasons[metric], zh))}</b></p>`;
        })
        .join("")}</div>`,
      )
      .join("")}</article>`,
    )
    .join("");
  const html = `<!doctype html><html lang="${zh ? "zh-Hant-HK" : "en-HK"}"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${scriptDigest}'; base-uri 'none'; form-action 'none'">
    <title>${xml(input.title)}</title><style>
    :root{--paper:#f6f6f4;--ink:#15171a;--muted:#646a75;--blue:#1f5eff;--line:#e3e4e5}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 Manrope,'Microsoft JhengHei',Arial,sans-serif}
    main{max-width:1200px;margin:auto;padding:48px 32px;overflow-wrap:anywhere}header{border-bottom:3px solid var(--blue);padding-bottom:24px}
    h1{font-family:Fraunces,Georgia,'Microsoft JhengHei',serif;font-size:clamp(30px,5vw,54px);font-weight:500;line-height:1.15;max-width:24ch}
    h2{font-size:24px;margin:40px 0 16px}h3{line-height:1.4}a{color:var(--blue)}small,.muted{color:var(--muted)}
    .tag{color:var(--blue);font-weight:750;letter-spacing:.12em}.card{background:white;border:1px solid var(--line);border-radius:12px;padding:24px;margin:20px 0}
    .chart-desktop svg{display:block;width:100%;height:auto}.chart-mobile{display:none}.mode{display:inline-block;background:#edf2ff;color:#1748c6;padding:6px 12px;border-radius:6px;font-size:14px}
    select{font:inherit;width:min(100%,700px);min-height:44px;padding:10px;border:1px solid var(--muted);border-radius:8px;background:white}
    table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{padding:14px 10px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
    th:first-child{width:20%}th:nth-child(2){width:28%}td:nth-child(2){font-variant-numeric:tabular-nums}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}
    details{margin:8px 0}summary{cursor:pointer}li{margin:8px 0}:focus-visible{outline:3px solid var(--blue);outline-offset:3px}[hidden]{display:none!important}
    .metric{border-top:1px solid var(--line);padding:16px 0}.metric strong{color:var(--blue)}.metric p{display:flex;flex-wrap:wrap;gap:6px 16px;justify-content:space-between;margin:6px 0}.metric b{font-variant-numeric:tabular-nums;font-weight:600}
    @media(max-width:640px){main{padding:28px 16px}.card{padding:18px}.chart-desktop{display:none}.chart-mobile{display:block}th,td{padding:10px 5px;font-size:13px}th:first-child{width:24%}th:nth-child(2){width:32%}h2{font-size:22px}}
    @media print{body{background:white}main{padding:0}select,label,#scope-status{display:none}[hidden]{display:revert!important}.chart-desktop{display:block}.chart-mobile{display:none}.card{break-inside:avoid}}
    </style></head><body><main>
    <header><div class="tag">COPYPASTE / WORKMATE</div><h1>${xml(input.title)}</h1>
      <p>${xml(calculation.spec.date_from)} → ${xml(calculation.spec.date_to)} · ${xml(calculation.spec.timezone)}</p>
      <p class="mode">${dataMode === "simulated" ? (zh ? "模擬資料 · 用於核對工作流程" : "Simulated data · workflow review") : zh ? "已選資料來源" : "Selected source data"}</p>
      <p class="muted">${zh ? "平台取數截止時間未知；請核對資料涵蓋再作決策。" : "Platform extraction cutoff is unknown. Review source coverage before making a decision."}</p>
    </header>
    <section><h2>${zh ? "觀察與創意測試方向" : "Observations and creative test directions"}</h2><ul>${statements(narrative.observations)}</ul>
      <h3>${zh ? "待驗證假設" : "Hypotheses to verify"}</h3><ul>${statements(narrative.hypotheses)}</ul>
      <h3>${zh ? "下一步" : "Next steps"}</h3><ul>${narrative.next_steps.map((s) => `<li>${xml(s)}</li>`).join("")}</ul></section>
    <section><h2>${zh ? "可核對的圖表" : "Review the calculated chart"}</h2>
      <p>${zh ? "各口徑獨立呈現，沒有跨幣種換算或跨平台轉換去重。" : "Scopes remain independent; no currency conversion or cross-platform conversion deduplication."}</p>
      <label for="scope">${zh ? "篩選口徑" : "Filter scope"}</label><br>
      <select id="scope"><option value="">${zh ? "全部口徑" : "All scopes"}</option>${calculation.groups.map((g) => `<option value="${g.periods.current.id}">${xml(scopeLabel(g, zh))}</option>`).join("")}</select>
      <p id="scope-status" aria-live="polite"></p><div class="chart-desktop">${svg}</div><div class="chart-mobile">${mobileCharts}</div></section>
    <section><h2>${zh ? "精確數值與證據" : "Exact values and evidence"}</h2><table><thead><tr>
      <th>${zh ? "指標" : "Metric"}</th><th>${zh ? "精確值" : "Exact value"}</th><th>${zh ? "口徑與來源" : "Scope and source"}</th></tr></thead>
      <tbody>${calculation.evidence
        .map(
          (
            e,
          ) => `<tr id="evidence-${e.id}" data-scope="${groupIds.get(e.snapshot_id)}">
        <td>${xml(metricNames[e.metric_id.replace(/\.change$/, "")]?.[zh ? 1 : 0] ?? e.metric_id)}${e.metric_id.endsWith(".change") ? (zh ? " · 變化率" : " · change") : ""}</td>
        <td>${xml(e.value === null ? `N/A · ${nullLabel(e.null_reason, zh)}` : `${e.value} ${e.unit === "count" ? "" : e.unit}`)}</td>
        <td><details><summary>${zh ? "查看證據" : "View evidence"}</summary><small>${e.id}</small><pre>${xml(e.scope)}</pre><small>Formula ${xml(e.formula_version)} · Snapshot ${e.snapshot_id}</small></details></td></tr>`,
        )
        .join("")}</tbody></table></section>
    <section><h2>${zh ? "資料與限制" : "Sources and limitations"}</h2>
      <p>${groups.length}/${calculation.groups.length} ${zh ? "口徑已製圖；CSV 包含全部已選指標證據。" : "scopes charted; CSV contains evidence for all selected metrics."}</p>
      ${calculation.sources
        .map(
          (
            s,
          ) => `<div class="card"><strong>${xml(s.source)}</strong><details><summary>${zh ? "查看來源與核對資訊" : "View source and verification details"}</summary>
        <p>${xml(s.snapshot_id)}</p><small>Source SHA-256 ${xml(s.source_sha256)}<br>Captured ${xml(s.captured_at instanceof Date ? s.captured_at.toISOString() : s.captured_at)}<br>Definition SHA-256 ${xml(s.spec_hash)}</small></details></div>`,
        )
        .join("")}
      <ul>${calculation.limitations.map((s) => `<li>${xml(s)}</li>`).join("")}</ul>
      <details><summary>${zh ? "核對本次交付" : "Verify this delivery"}</summary><p>Calculation SHA-256 <code>${input.calculation_sha256}</code></p>
      ${input.revision_of ? `<p>Revision of source version ${input.revision_of.source_version_id} · ${input.revision_of.sha256}</p>` : ""}</details></section>
    </main><script>${script}</script></body></html>`;
  const csv =
    [
      [
        "evidence_id",
        "metric",
        "exact_value",
        "unit",
        "null_reason",
        "formula_version",
        "snapshot_id",
        "scope",
        "calculation_sha256",
      ]
        .map(csvCell)
        .join(","),
      ...calculation.evidence.map((e) =>
        [
          csvCell(e.id),
          csvCell(e.metric_id),
          e.value === null ? '""' : `"${e.value}"`,
          csvCell(e.unit),
          csvCell(e.null_reason),
          csvCell(e.formula_version),
          csvCell(e.snapshot_id),
          csvCell(e.scope),
          csvCell(input.calculation_sha256),
        ].join(","),
      ),
    ].join("\r\n") + "\r\n";
  const facts = [
    [
      "dataset_id",
      "source",
      "account_id",
      "currency",
      "timezone",
      "attribution_definition",
      "conversion_definition",
      "source_sha256",
      "definition_sha256",
      "date",
      "channel",
      "campaign",
      "entity_id",
      "impressions",
      "clicks",
      "spend_micros",
      "conversions",
      "revenue_micros",
    ]
      .map(csvCell)
      .join(","),
  ];
  for (const d of datasets)
    for (const row of d.rows) {
      if (
        !(
          row.date >= calculation.spec.date_from &&
          row.date <= calculation.spec.date_to
        ) &&
        !(
          calculation.spec.comparison &&
          row.date >= calculation.spec.comparison.date_from &&
          row.date <= calculation.spec.comparison.date_to
        )
      )
        continue;
      facts.push(
        [
          d.id,
          d.source,
          d.import_spec.account_id,
          d.currency,
          d.timezone,
          d.import_spec.attribution_definition,
          d.import_spec.conversion_definition,
          d.source_sha256,
          d.spec_hash,
          row.date,
          row.channel,
          row.campaign,
          row.entity_id,
          row.impressions,
          row.clicks,
          row.spend_micros,
          row.conversions,
          row.revenue_micros,
        ]
          .map(csvCell)
          .join(","),
      );
    }
  const plain = (s: string) => s.replace(/[\\`*_{}\[\]<>#|]/g, (c) => "\\" + c);
  const brief = `# ${plain(input.title)}\n\n${zh ? "客戶需求" : "Customer request"}: ${plain(calculation.spec.prompt)}\n\n## ${zh ? "已驗證計算" : "Verified calculation"}\n\n${narrative.observations.map((s) => "- " + plain(interpolate(s.text))).join("\n")}\n\n## ${zh ? "待驗證創意假設" : "Creative hypotheses to verify"}\n\n${narrative.hypotheses.map((s) => "- " + plain(interpolate(s.text))).join("\n") || (zh ? "尚未提出創意假設。" : "No creative hypothesis has been proposed.")}\n\n## ${zh ? "測試動作" : "Test actions"}\n\n${narrative.next_steps.map((s) => "- " + plain(s)).join("\n")}\n\n${zh ? "假設不是因果或顯著性結論；先確認受眾、渠道及追蹤完整性。" : "Hypotheses do not establish causality or statistical significance. Confirm audience, channel and tracking completeness."}\n\nCalculation SHA-256: ${input.calculation_sha256}\nData mode: ${dataMode}\n`;
  const source = {
    schema: analysisDeliveryVersion,
    renderer_version: "analysis-role/1.0.0",
    data_mode: dataMode,
    calculation_sha256: input.calculation_sha256,
    render: input,
    narrative,
    calculation,
  };
  const files = [
    { name: "infographic.svg", mime: "image/svg+xml", bytes: Buffer.from(svg) },
    {
      name: "infographic.png",
      mime: "image/png",
      bytes: Buffer.from(pngFromSVG(svg)),
    },
    { name: "report.html", mime: "text/html", bytes: Buffer.from(html) },
    {
      name: "metrics.csv",
      mime: "text/csv",
      bytes: Buffer.from("\ufeff" + csv),
    },
    {
      name: "source-facts.csv",
      mime: "text/csv",
      bytes: Buffer.from("\ufeff" + facts.join("\r\n") + "\r\n"),
    },
    {
      name: "creative-brief.md",
      mime: "text/markdown",
      bytes: Buffer.from(brief),
    },
    {
      name: "analysis.source.json",
      mime: "application/json",
      bytes: Buffer.from(JSON.stringify(source, null, 2) + "\n"),
    },
  ];
  if (files.reduce((n, f) => n + f.bytes.length, 0) > 24 * 1024 * 1024)
    throw new Problem(
      422,
      "ANALYSIS_DELIVERY_LIMIT",
      "Reduce the selected range or scopes to produce a delivery below 24 MiB",
    );
  if (
    files.find((f) => f.name === "analysis.source.json")!.bytes.length >
    4 * 1024 * 1024
  )
    throw new Problem(
      422,
      "ANALYSIS_DELIVERY_LIMIT",
      "Reduce the calculation scope to keep its editable source below 4 MiB",
    );
  const manifest = {
    schema: "copypaste-analysis-manifest-1",
    calculation_sha256: input.calculation_sha256,
    data_mode: dataMode,
    revision_of: input.revision_of ?? null,
    files: files.map((f) => ({
      filename: f.name,
      mime_type: f.mime,
      bytes: f.bytes.length,
      sha256: hash(f.bytes),
    })),
    editable_source: "analysis.source.json",
    formula_version: "1.0",
    source_snapshot_ids: calculation.spec.snapshot_ids,
    visual_scopes: input.scope_ids,
    total_scopes: calculation.groups.length,
    limitations: calculation.limitations,
  };
  files.push({
    name: "manifest.json",
    mime: "application/json",
    bytes: Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
  });
  const zip: Zippable = Object.fromEntries(
    files.map((f) => [
      f.name,
      [f.bytes, { mtime: new Date("2000-01-01T00:00:00Z") }],
    ]),
  );
  files.push({
    name: "analysis-delivery.zip",
    mime: "application/zip",
    bytes: Buffer.from(zipSync(zip, { level: 6 })),
  });
  return {
    input,
    calculation_sha256: input.calculation_sha256,
    manifest,
    files,
  };
}
