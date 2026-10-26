import { z } from "zod";
import { canonical, hash, uuid, Problem } from "./lib.js";

export const connectorProvider = z.enum([
  "google_ads",
  "meta_ads",
  "ga4",
  "search_console",
]);
export type ConnectorProvider = z.infer<typeof connectorProvider>;
export const connectorVersion = "marketing-read/1.0.0";
export const internalProvider = (p: ConnectorProvider) =>
  p === "meta_ads" ? "meta" : p;
export const publicProvider = (p: string): ConnectorProvider =>
  connectorProvider.parse(p === "meta" ? "meta_ads" : p);
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T00:00:00.000Z");
    return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === s;
  }, "Use a real calendar date");
export const connectorSyncInput = z
  .object({ date_from: calendarDate, date_to: calendarDate })
  .strict()
  .refine((v) => v.date_from <= v.date_to, "Start must precede end")
  .refine(
    (v) => Date.parse(v.date_to) - Date.parse(v.date_from) < 366 * 86400000,
    "Use at most 366 days",
  );
export const connectorCreateInput = z
  .object({ project_id: uuid, provider: connectorProvider })
  .strict();
export const connectorUpdateInput = z
  .object({
    expected_version: z.number().int().nonnegative(),
    account_ids: z.array(z.string().min(1).max(512)).max(20),
    project_ids: z.array(uuid).max(20),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.account_ids).size === v.account_ids.length &&
      new Set(v.project_ids).size === v.project_ids.length,
    "Remove duplicate accounts or projects",
  );
const cleanText = z
  .string()
  .max(2000)
  .refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s));
export const connectorAccount = z
  .object({
    account_id: z.string().min(1).max(512),
    name: cleanText.min(1),
    timezone: z.string().min(1).max(100).nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    readable: z.boolean(),
    kind: z.enum(["advertiser", "manager", "property", "site"]),
    login_customer_id: z
      .string()
      .regex(/^\d{1,20}$/)
      .nullable(),
    reporting_identity: z.string().max(100).nullable(),
    reporting_identity_source: z.enum([
      "provider",
      "unavailable",
      "not_applicable",
    ]),
    permission_level: z.string().max(100).nullable(),
  })
  .strict();
export type ConnectorAccount = z.infer<typeof connectorAccount>;
export const connectorCredential = z
  .object({
    access_token: z.string().min(1).max(8192),
    refresh_token: z.string().min(1).max(8192).nullable(),
    expires_at: z.number().finite().nullable(),
    scopes: z.array(z.string().min(1).max(300)).max(30),
  })
  .strict();
export type ConnectorCredential = z.infer<typeof connectorCredential>;
export const reportProfile = z.enum([
  "campaign",
  "ga4_traffic",
  "ga4_events",
  "search_performance",
]);
export type ReportProfile = z.infer<typeof reportProfile>;
export const profilesFor = (p: ConnectorProvider): ReportProfile[] =>
  p === "ga4"
    ? ["ga4_traffic", "ga4_events"]
    : p === "search_console"
      ? ["search_performance"]
      : ["campaign"];
export const connectorQuery = z
  .object({
    provider: connectorProvider,
    api_version: z.string().min(1).max(50),
    account: connectorAccount,
    profile: reportProfile,
    date_from: calendarDate,
    date_to: calendarDate,
    page_size: z.number().int().min(1).max(25000),
    // One exact action type; broad and narrow action types are never added together.
    conversion_action_type: z
      .string()
      .regex(/^[a-zA-Z0-9_.]{1,100}$/)
      .default("purchase"),
    version: z.literal(connectorVersion),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      !connectorSyncInput.safeParse({
        date_from: v.date_from,
        date_to: v.date_to,
      }).success
    )
      ctx.addIssue({ code: "custom", message: "Invalid date range" });
    if (!profilesFor(v.provider).includes(v.profile))
      ctx.addIssue({
        code: "custom",
        message: "Profile does not belong to provider",
      });
    if (!v.account.readable || v.account.kind === "manager")
      ctx.addIssue({
        code: "custom",
        message: "Select a readable reporting account",
      });
    if (
      v.provider !== "search_console" &&
      !/^\d{1,20}$/.test(v.account.account_id)
    )
      ctx.addIssue({
        code: "custom",
        message: "Numeric provider account required",
      });
    if (v.provider === "search_console") {
      try {
        const id = v.account.account_id;
        if (id.startsWith("sc-domain:")) {
          if (
            !/^(?:[a-zA-Z\d](?:[a-zA-Z\d-]{0,61}[a-zA-Z\d])?\.)+[a-zA-Z]{2,63}$/.test(
              id.slice(10),
            )
          )
            throw new Error();
        } else {
          const u = new URL(id);
          if (
            !["http:", "https:"].includes(u.protocol) ||
            u.username ||
            u.password ||
            u.hash ||
            u.search
          )
            throw new Error();
        }
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "Select a verified URL-prefix or domain property",
        });
      }
    }
  });
export type ConnectorQuery = z.infer<typeof connectorQuery>;
export const pageCursor = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("token"), token: z.string().min(1).max(8192) })
    .strict(),
  z
    .object({
      kind: z.literal("offset"),
      offset: z.number().int().min(0).max(1000000),
      total: z.number().int().nonnegative().nullable(),
    })
    .strict(),
]);
export type PageCursor = z.infer<typeof pageCursor>;
export const decimalValue = z.string().regex(/^\d{1,20}(?:\.\d{1,12})?$/);
export const connectorFact = z
  .object({
    key: z.string().regex(/^[a-f\d]{64}$/),
    account_id: z.string().min(1).max(512),
    profile: reportProfile,
    date: calendarDate,
    dimensions: z.record(z.string().max(100), cleanText),
    metrics: z.record(z.string().max(100), decimalValue.nullable()),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    timezone: z.string().min(1).max(100).nullable(),
  })
  .strict();
export type ConnectorFact = z.infer<typeof connectorFact>;
export function fact(
  query: ConnectorQuery,
  date: string,
  dimensions: Record<string, string>,
  metrics: Record<string, string | null>,
): ConnectorFact {
  if (date < query.date_from || date > query.date_to)
    throw new Problem(
      502,
      "CONNECTOR_ROW_SCOPE",
      "The provider returned a row outside the frozen date range",
    );
  return connectorFact.parse({
    key: hash(
      canonical({
        provider: query.provider,
        account: query.account.account_id,
        profile: query.profile,
        date,
        dimensions,
      }),
    ),
    account_id: query.account.account_id,
    profile: query.profile,
    date,
    dimensions,
    metrics,
    currency: query.account.currency,
    timezone: query.account.timezone,
  });
}
export const connectionDTO = z
  .object({
    id: uuid,
    project_id: uuid,
    provider: connectorProvider,
    state: z.enum([
      "pending",
      "active",
      "reauth_required",
      "degraded",
      "revoked",
    ]),
    auth_version: z.number().int().nonnegative(),
    account_ids: z.array(z.string().min(1)),
    data_as_of: z.iso.datetime().nullable(),
    authorization_url: z.url().optional(),
    version: z.number().int().nonnegative(),
  })
  .strict();
export const connectionListDTO = z
  .object({ items: z.array(connectionDTO), next_cursor: z.string().nullable() })
  .strict();
export const connectorSyncDTO = z
  .object({
    id: uuid,
    connection_id: uuid,
    state: z.enum(["queued", "running", "complete", "partial", "failed"]),
    snapshot_id: uuid.optional(),
  })
  .strict();
export const connectorLimits = {
  accounts: 20,
  catalogAccounts: 500,
  pages: 250,
  facts: 100000,
  rawBytes: 50000000,
  attemptsPerPage: 5,
  retentionDays: 90,
  lifetimeHours: 6,
} as const;

export const discoveryCursor = z
  .object({
    stage: z.enum([
      "start",
      "ads_root",
      "ads_clients",
      "ga4_list",
      "ga4_property",
      "ga4_identity",
      "meta_list",
    ]),
    remaining: z.array(z.string().min(1).max(512)).max(500).default([]),
    token: z.string().min(1).max(8192).nullable().default(null),
    current: z.string().max(512).nullable().default(null),
    account: connectorAccount.nullable().default(null),
  })
  .strict();
export type DiscoveryCursor = z.infer<typeof discoveryCursor>;
export type ConnectorPage = {
  facts: ConnectorFact[];
  next: PageCursor | null;
  limitations: string[];
  raw: unknown;
  raw_sha256: string;
  raw_bytes: number;
};
export type DiscoveryPage = {
  accounts: ConnectorAccount[];
  next: DiscoveryCursor | null;
  limitations: string[];
};
