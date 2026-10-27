import { z } from "zod";
import { hash, Problem } from "./lib.js";

export const clientKinds = ["web", "desktop", "extension"] as const;
export const clientKind = z.enum(clientKinds);
export const clientNavigation = {
  web: [
    "roles",
    "specialists",
    "teams",
    "skills",
    "solutions",
    "notifications",
    "conversations",
    "memories",
    "projects",
    "assets",
    "files",
    "creative",
    "effects",
    "analytics",
    "workflows",
    "connections",
    "brand",
  ],
  desktop: [
    "roles",
    "specialists",
    "skills",
    "solutions",
    "notifications",
    "conversations",
    "memories",
    "projects",
    "assets",
    "files",
    "creative",
    "analytics",
    "workflows",
    "connections",
    "brand",
  ],
  extension: [
    "batch-designs",
    "video-workspace",
    "marketing-connections",
    "website-audits",
    "creative-feedback",
    "geo-observations",
  ],
} as const;
const key = z.string().regex(/^[\w-]{1,80}$/);
const optionalDate = z.string().datetime({ offset: true }).optional();
const item = z
  .object({
    key,
    title: z.string().trim().min(1).max(160),
    title_en: z.string().trim().min(1).max(160),
    text: z.string().trim().max(10000),
    text_en: z.string().trim().max(10000),
    enabled: z.boolean(),
    starts_at: optionalDate,
    ends_at: optionalDate,
  })
  .strict()
  .refine(
    (v) =>
      !v.starts_at ||
      !v.ends_at ||
      Date.parse(v.starts_at) < Date.parse(v.ends_at),
    "The end must follow the start",
  );
const navigation = z
  .object({
    client: clientKind,
    path: z.string().min(1).max(80),
    label: z.string().trim().min(1).max(80),
    label_en: z.string().trim().min(1).max(80),
    enabled: z.boolean(),
    order: z.number().int().min(0).max(100),
  })
  .strict()
  .refine(
    (v) => (clientNavigation[v.client] as readonly string[]).includes(v.path),
    "Choose an existing optional navigation item",
  );
export const clientContentDocument = z
  .object({
    schema: z.literal(1),
    announcements: z.array(item).max(12),
    help: z.array(item).max(20),
    navigation: z.array(navigation).max(90),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const name of ["announcements", "help", "navigation"] as const) {
      const ids = v[name].map((i) =>
        "client" in i ? i.client + ":" + i.path : i.key,
      );
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: "Choose each item once",
        });
    }
  });
const ids = z
  .array(z.string().uuid())
  .max(100)
  .refine((v) => new Set(v).size === v.length, "Choose each subject once");
export const clientContentAudience = z
  .object({
    clients: z
      .array(clientKind)
      .min(1)
      .max(3)
      .refine((v) => new Set(v).size === v.length, "Choose each client once"),
    tenant_ids: ids,
    user_ids: ids,
    percentage: z.number().int().min(0).max(100),
    cohort_key: key,
  })
  .strict();
export type ClientContentDocument = z.infer<typeof clientContentDocument>;
export type ClientContentAudience = z.infer<typeof clientContentAudience>;
export type ContentSubject = {
  client: z.infer<typeof clientKind>;
  user_id?: string;
  tenant_id?: string;
};
export const emptyClientContent = (): ClientContentDocument => ({
  schema: 1,
  announcements: [],
  help: [],
  navigation: [],
});
export function fullClientAudience(v: ClientContentAudience) {
  return (
    v.clients.length === 3 &&
    clientKinds.every((c) => v.clients.includes(c)) &&
    !v.tenant_ids.length &&
    !v.user_ids.length &&
    v.percentage === 100
  );
}
export function clientAudienceMatches(
  v: ClientContentAudience,
  subject: ContentSubject,
) {
  if (!v.clients.includes(subject.client)) return false;
  if (
    v.tenant_ids.length &&
    (!subject.tenant_id || !v.tenant_ids.includes(subject.tenant_id))
  )
    return false;
  if (
    v.user_ids.length &&
    (!subject.user_id || !v.user_ids.includes(subject.user_id))
  )
    return false;
  if (v.percentage === 0) return false;
  if (v.percentage === 100) return true;
  if (!subject.user_id) return false;
  const bucket =
    Number.parseInt(
      hash("client-content:" + v.cohort_key + ":" + subject.user_id).slice(
        0,
        8,
      ),
      16,
    ) % 10000;
  return bucket < v.percentage * 100;
}
function contentID(version: string, kind: string, key: string) {
  const digest = hash("client-content:" + version + ":" + kind + ":" + key);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
export function projectClientContent(
  document: ClientContentDocument,
  subject: ContentSubject,
  version: string,
  now = Date.now(),
) {
  const items: any[] = [];
  for (const section of ["announcements", "help"] as const)
    for (const value of document[section]) {
      if (
        !value.enabled ||
        (value.starts_at && now < Date.parse(value.starts_at)) ||
        (value.ends_at && now >= Date.parse(value.ends_at))
      )
        continue;
      const kind = section === "announcements" ? "announcement" : "help";
      items.push({
        id: contentID(version, kind, value.key),
        kind,
        key: value.key,
        version,
        body: {
          title: value.title,
          title_en: value.title_en,
          text: value.text,
          text_en: value.text_en,
          enabled: true,
        },
      });
    }
  for (const value of document.navigation)
    if (value.client === subject.client) {
      items.push({
        id: contentID(version, "navigation", value.client + ":" + value.path),
        kind: "navigation",
        key: value.path,
        version,
        body: {
          path: value.path,
          label: value.label,
          label_en: value.label_en,
          enabled: value.enabled,
          order: value.order,
        },
      });
    }
  return items;
}
/** Freeze only already-public presentation content. No account, role execution,
 * plan, Skill, credential or customer project data enters a public document. */
export function legacyClientContent(rows: any[]): ClientContentDocument {
  const value = emptyClientContent();
  for (const row of rows) {
    const b = row.body;
    if (["announcement", "help"].includes(row.kind)) {
      const parsed = item.safeParse({
        key: row.key,
        title: b.title,
        title_en: b.title_en || b.title,
        text: b.text ?? "",
        text_en: b.text_en ?? b.text ?? "",
        enabled: b.enabled !== false,
      });
      if (!parsed.success)
        throw new Problem(
          409,
          "LEGACY_CONTENT_CONFLICT",
          "Correct the published content before creating its frozen baseline",
          { key: row.key },
        );
      value[row.kind === "announcement" ? "announcements" : "help"].push(
        parsed.data,
      );
    }
    if (row.kind === "navigation")
      for (const client of ["web", "desktop"] as const) {
        const parsed = navigation.safeParse({
          client,
          path: b.path,
          label: b.label,
          label_en: b.label_en || b.label,
          enabled: b.enabled,
          order: b.order,
        });
        if (
          parsed.success &&
          !value.navigation.some(
            (v) => v.client === client && v.path === parsed.data.path,
          )
        )
          value.navigation.push(parsed.data);
      }
  }
  // Existing global content may exceed the new editor limits. Never silently
  // truncate the frozen fallback. Publication must resolve that conflict first.
  const parsed = clientContentDocument.safeParse(value);
  if (!parsed.success)
    throw new Problem(
      409,
      "LEGACY_CONTENT_CONFLICT",
      "The existing public content exceeds the editor limits; resolve it before publication",
    );
  return parsed.data;
}
