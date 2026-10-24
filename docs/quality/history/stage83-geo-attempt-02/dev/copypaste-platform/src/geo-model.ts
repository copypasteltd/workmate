import { z } from "zod";
import { canonical, hash, name, uuid } from "./lib.js";

export const geoProtocol = "codex-internal-no-retrieval-v1";
const label = z.string().trim().min(1).max(120);
export const geoSpec = z.object({
  name, agent_id: uuid, region: label, language: label,
  questions: z.array(z.object({ key: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/), text: z.string().trim().min(3).max(2000) }).strict()).min(1).max(20),
  brands: z.array(z.object({ name: label, aliases: z.array(label).min(1).max(5) }).strict()).min(1).max(10),
}).strict().superRefine((v, c) => {
  for (const [field, values] of [["questions", v.questions.map(q => q.key)], ["brands", v.brands.map(b => b.name.toLowerCase())]] as const)
    if (new Set(values).size !== values.length) c.addIssue({ code: "custom", path: [field], message: "Keys and brand names must be unique" });
  if (new Set(v.questions.map(q => q.text)).size !== v.questions.length)
    c.addIssue({ code: "custom", path: ["questions"], message: "Question texts must be unique" });
});
export const geoManual = z.object({
  name, product: label, reported_model: label.nullable(), region: label, language: label,
  retrieval: z.enum(["enabled", "disabled", "unknown"]),
  observed_at: z.string().datetime({ offset: true }).refine(v => Date.parse(v) <= Date.now() + 60_000, "Observation time cannot be in the future"),
  attested: z.literal(true),
  samples: z.array(z.object({ question_key: z.string().min(1).max(40), answer: z.string().min(1).max(100000) }).strict()).min(1).max(20),
}).strict().superRefine((v, c) => {
  if (new Set(v.samples.map(s => s.question_key)).size !== v.samples.length)
    c.addIssue({ code: "custom", path: ["samples"], message: "One answer per fixed question" });
});
export function geoPrompt(spec: Pick<z.infer<typeof geoSpec>, "region" | "language">, question: string) {
  // Do not put the measured brands/aliases in the model's question.
  return `Observation protocol: ${geoProtocol}\nRequested region context: ${spec.region}\nAnswer language: ${spec.language}\nAnswer the following question independently. No browsing, retrieval or business tools are available. Do not claim to have searched.\n\n${question}`;
}
export function geoDigest(value: unknown) { return hash(canonical(value)); }
export function geoAnalysis(answer: string, brands: z.infer<typeof geoSpec>["brands"]) {
  // Native UTF-16 offsets match the retained original answer exactly. No
  // normalization/fuzzy expansion can shift offsets or invent an entity match.
  const mentions = brands.map(brand => {
    const matches: { alias: string; start: number; end: number }[] = [];
    for (const alias of [...new Set(brand.aliases)]) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(escaped, "giu");
      for (const m of answer.matchAll(re)) {
        const start = m.index!, end = start + m[0].length;
        if (/^[\p{Script=Latin}\p{N}]/u.test(alias) && /[\p{Script=Latin}\p{N}_]/u.test(answer[start - 1] ?? "")) continue;
        if (/[\p{Script=Latin}\p{N}]$/u.test(alias) && /[\p{Script=Latin}\p{N}_]/u.test(answer[end] ?? "")) continue;
        if (matches.length < 1000) matches.push({ alias, start, end });
      }
    }
    return { brand: brand.name, matches, matched: matches.length > 0, limit: 1000 };
  });
  const links: { url: string; start: number; end: number; provenance: "answer_text_unverified" }[] = [];
  for (const m of answer.matchAll(/https?:\/\/[^\s<>"'\u0000-\u001f]+/giu)) {
    const raw = m[0].replace(/[),.;\]，。；）】]+$/u, "");
    try {
      const u = new URL(raw);
      if (u.username || u.password || !["https:", "http:"].includes(u.protocol)) continue;
      if (links.length < 100) links.push({ url: raw, start: m.index!, end: m.index! + raw.length, provenance: "answer_text_unverified" });
    } catch { /* Not a parsed URL; retain it only in the original answer. */ }
  }
  return { answer_sha256: hash(Buffer.from(answer, "utf8")), character_offsets: "utf16" as const, mentions, links,
    limitations: ["Literal alias occurrence is not verified entity identity, ranking or causation.", "Answer links are unverified text, not independently retrieved evidence."] };
}
export type GeoReportRun = { id: string; surface: string; config_hash: string; effective_config: unknown;
  questions: { key: string; text: string }[]; samples: { question_key: string; state: string; answer_sha256: string | null; analysis: ReturnType<typeof geoAnalysis> | null }[] };
export function compareGeo(a: GeoReportRun, b: GeoReportRun) {
  const same = a.surface === b.surface && a.config_hash === b.config_hash;
  const keys = new Set([...a.questions, ...b.questions].map(q => q.text));
  return { schema: 1, left_run_id: a.id, right_run_id: b.id, same_configuration: same,
    classification: same ? "repeat_observation" : "different_configuration",
    mixed_surfaces: a.surface !== b.surface, aggregate: null,
    differences: [...(a.surface !== b.surface ? ["surface"] : []), ...(a.config_hash !== b.config_hash ? ["effective_configuration"] : [])],
    questions: [...keys].map(text => {
      const aq = a.questions.find(q => q.text === text), bq = b.questions.find(q => q.text === text);
      const l = aq ? a.samples.find(s => s.question_key === aq.key) : null, r = bq ? b.samples.find(s => s.question_key === bq.key) : null;
      const known = l?.state === "captured" && r?.state === "captured";
      return { text, left: l ?? null, right: r ?? null, answer_changed: known ? l.answer_sha256 !== r.answer_sha256 : null,
        reason: known ? null : "missing_or_unfinished_answer" };
    }), limitations: ["API and consumer manual samples remain separate.", "Configuration differences prevent attributing variation to the model alone.", "This sample comparison is not a global ranking, causal estimate or coverage claim."] };
}
