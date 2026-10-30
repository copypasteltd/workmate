import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Database, Tx } from "./db.js";
import { audit, requireUser } from "./auth.js";
import { key, replay, projectAccess } from "./access.js";
import { hash, name, Problem, uuid } from "./lib.js";
import type { Storage } from "./storage.js";
import { recordTaskContentRead } from "./task-content-sources.js";
import { inspectBrandFont, assertBrandGlyphs } from "./brand-font.js";
import { loadVideoFont } from "./video-font.js";

const code = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,59}$/),
  channels = z.array(code).min(1).max(30),
  ref = z
    .object({ asset_id: uuid, version: z.number().int().positive() })
    .strict();
const rights = z
  .object({
    source: z.string().trim().min(3).max(2000),
    license: z.string().trim().min(3).max(4000),
    channels,
    valid_until: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .strict();
const font = z
  .object({
    key: code,
    label: name,
    source: z.union([
      z.object({ builtin: z.literal("noto-sans-tc") }).strict(),
      ref,
    ]),
    rights,
  })
  .strict();
const fact = z
  .object({
    key: code,
    sku: z.string().max(120).default(""),
    kind: z.enum(["product", "price", "promotion"]),
    text: z.string().trim().min(1).max(2000),
    amount_minor: z.number().int().min(0).max(1e12).nullable().default(null),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .refine(
        (v) => Intl.supportedValuesOf("currency").includes(v),
        "Choose a supported ISO currency",
      )
      .nullable()
      .default(null),
    valid_from: z.iso.datetime({ offset: true }).nullable().default(null),
    valid_until: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (
      (f.amount_minor === null) !== (f.currency === null) ||
      (f.kind === "price" && f.amount_minor === null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Prices require an amount in minor units and a currency",
      });
    if (f.kind === "promotion" && !f.valid_until)
      ctx.addIssue({
        code: "custom",
        message: "Promotions require an explicit expiry",
      });
    if (
      f.valid_from &&
      f.valid_until &&
      Date.parse(f.valid_from) >= Date.parse(f.valid_until)
    )
      ctx.addIssue({
        code: "custom",
        message: "Validity must end after it starts",
      });
  });
export const brandDefinition = z
  .object({
    schema_version: z.literal(2),
    name,
    colors: z
      .array(z.string().regex(/^#[a-fA-F\d]{6}$/))
      .min(1)
      .max(12),
    tone: z.string().max(2000),
    approved_copy: z.string().max(10000).default(""),
    fonts: z.array(z.string().max(100)).max(12).default([]),
    logos: z
      .array(
        ref
          .extend({
            key: code,
            usage: z.string().max(500),
            min_width: z.number().int().min(1).max(4096),
            clear_space: z.number().int().min(0).max(4096),
          })
          .strict(),
      )
      .max(12)
      .default([]),
    font_bindings: z.array(font).min(1).max(12),
    facts: z.array(fact).max(100).default([]),
    locales: z
      .array(
        code.refine((value) => {
          try {
            return Intl.NumberFormat.supportedLocalesOf([value]).length === 1;
          } catch {
            return false;
          }
        }, "Choose a supported locale, for example zh-Hant-HK or en-HK"),
      )
      .min(1)
      .max(20),
    channels,
    restrictions: z.string().max(5000).default(""),
  })
  .strict()
  .superRefine((b, ctx) => {
    for (const [field, values] of [
      ["font_bindings", b.font_bindings],
      ["logos", b.logos],
      ["facts", b.facts],
    ] as const)
      if (new Set(values.map((v) => v.key)).size !== values.length)
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Keys must be unique within this brand version",
        });
    if (
      b.font_bindings.some((f) =>
        f.rights.channels.some((c) => !b.channels.includes(c)),
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["font_bindings"],
        message: "Font usage must be a subset of the brand channels",
      });
  });
export const brandBinding = z
  .object({
    id: uuid,
    version: z.number().int().positive(),
    channel: code,
    locale: code,
  })
  .strict();
export type BrandBinding = z.infer<typeof brandBinding>;
export type BrandDefinition = z.infer<typeof brandDefinition>;

async function file(
  tx: Tx,
  project: string,
  source: z.infer<typeof ref>,
  kind: "font" | "logo",
) {
  const row = (
    await tx.query(
      `SELECT v.* FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=$3
    WHERE a.id=$1 AND a.project_id=$2 AND a.state='active' AND a.private_owner IS NULL AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL FOR SHARE OF a`,
      [source.asset_id, project, source.version],
    )
  ).rows[0];
  if (
    !row ||
    Number(row.bytes) > (kind === "font" ? 20_000_000 : 8_000_000) ||
    (kind === "logo" && row.mime_type !== "image/png") ||
    (kind === "font" &&
      !["font/ttf", "font/otf", "application/octet-stream"].includes(
        row.mime_type,
      ))
  )
    throw new Problem(
      422,
      "BRAND_SOURCE_UNAVAILABLE",
      "Choose an active shared project font or PNG Logo version",
      { kind, asset_id: source.asset_id, version: source.version },
    );
  return row;
}
export async function brandVersion(
  tx: Tx,
  project: string,
  id: string,
  version: number,
) {
  const row = (
    await tx.query(
      `SELECT v.* FROM brand_profile_versions v JOIN brand_profiles b ON b.id=v.brand_id
    WHERE v.brand_id=$1 AND v.version=$2 AND v.project_id=$3 AND b.content_state='active' AND v.erased_at IS NULL FOR SHARE OF b`,
      [id, version, project],
    )
  ).rows[0];
  if (
    !row ||
    !(
      await tx.query("SELECT brand_version_available($1,$2) AS ok", [
        id,
        version,
      ])
    ).rows[0].ok
  )
    throw new Problem(
      409,
      "BRAND_SOURCE_UNAVAILABLE",
      "The fixed brand version or one of its source files is unavailable",
    );
  return { id, version, name: row.name, body: row.body, sha256: row.sha256 };
}
export function factEligibility(
  f: { valid_from: string | null; valid_until: string | null },
  now = Date.now(),
) {
  return f.valid_from && Date.parse(f.valid_from) > now
    ? "not_yet_valid"
    : f.valid_until && Date.parse(f.valid_until) <= now
      ? "expired"
      : "available";
}
export async function brandContext(
  tx: Tx,
  project: string,
  id: string,
  version: number,
) {
  const row = await brandVersion(tx, project, id, version);
  if (row.body.schema_version !== 2)
    return { ...row, production_constraints: "legacy_unverified" };
  const b = brandDefinition.parse(row.body);
  return {
    ...row,
    body: {
      ...b,
      facts: b.facts.filter((f) => factEligibility(f) === "available"),
    },
    unavailable_facts: b.facts
      .filter((f) => factEligibility(f) !== "available")
      .map((f) => ({ key: f.key, state: factEligibility(f) })),
    rights_status: "customer_declared",
  };
}
async function fontBytes(
  tx: Tx,
  storage: Storage,
  project: string,
  f: z.infer<typeof font>,
) {
  if ("builtin" in f.source) {
    const info = await loadVideoFont([]),
      bytes = await readFile(
        path.resolve("assets/fonts/noto-sans-tc/NotoSansTC-VF.ttf"),
      );
    if (hash(bytes) !== info.sha256)
      throw new Problem(
        503,
        "BRAND_FONT_INTEGRITY",
        "The fixed font changed during verification",
      );
    return { bytes, sha256: info.sha256 };
  }
  const v = await file(tx, project, f.source, "font"),
    bytes = await storage.get(v.storage_key);
  if (bytes.length !== Number(v.bytes) || hash(bytes) !== v.sha256)
    throw new Problem(
      409,
      "BRAND_FONT_INTEGRITY",
      "The selected font bytes do not match their version",
    );
  inspectBrandFont(bytes);
  const running = (
    await tx.query(
      "SELECT t.* FROM tasks t WHERE t.id=nullif(current_setting('app.task_id',true),'')::uuid AND t.status='running'",
    )
  ).rows[0];
  if (running)
    await recordTaskContentRead(
      tx,
      running,
      "asset_version",
      v.id,
      v.id,
      v.sha256,
    );
  return { bytes, sha256: v.sha256 as string };
}
export async function checkBrandDefinition(
  tx: Tx,
  storage: Storage,
  project: string,
  b: BrandDefinition,
) {
  for (const logo of b.logos) {
    const v = await file(tx, project, logo, "logo"),
      bytes = await storage.get(v.storage_key);
    if (
      hash(bytes) !== v.sha256 ||
      bytes.length !== Number(v.bytes) ||
      bytes.length < 24 ||
      bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      bytes.readUInt32BE(16) > 4096 ||
      bytes.readUInt32BE(20) > 4096
    )
      throw new Problem(
        422,
        "BRAND_LOGO_INVALID",
        "Brand Logo must be a verified PNG up to 4096 pixels",
      );
  }
  for (const f of b.font_bindings) await fontBytes(tx, storage, project, f);
}
export async function prepareBrandProduction(
  tx: Tx,
  storage: Storage,
  project: string,
  binding: BrandBinding,
  texts: { text: string; font_key?: string; fact_key?: string }[],
) {
  const row = await brandVersion(tx, project, binding.id, binding.version);
  if (row.body.schema_version !== 2)
    throw new Problem(
      422,
      "BRAND_UPGRADE_REQUIRED",
      "Publish explicit font rights and production rules before using this legacy brand for fixed-font output",
    );
  const body = brandDefinition.parse(row.body);
  if (
    !body.channels.includes(binding.channel) ||
    !body.locales.includes(binding.locale)
  )
    throw new Problem(
      422,
      "BRAND_USAGE_DENIED",
      "The selected channel or language is outside this brand version",
    );
  const fonts = new Map<string, { bytes: Buffer; alias: string }>(),
    resolved: { text: string; family: string }[] = [];
  for (const text of texts) {
    const f = body.font_bindings.find(
      (f) => f.key === (text.font_key ?? body.font_bindings[0].key),
    );
    if (
      !f ||
      !f.rights.channels.includes(binding.channel) ||
      (f.rights.valid_until && Date.parse(f.rights.valid_until) <= Date.now())
    )
      throw new Problem(
        422,
        "BRAND_FONT_USAGE_DENIED",
        "The selected font has no current declared usage for this channel",
        { font_key: text.font_key ?? body.font_bindings[0].key },
      );
    let content = text.text;
    if (text.fact_key) {
      const fact = body.facts.find((f) => f.key === text.fact_key);
      if (!fact || factEligibility(fact) !== "available")
        throw new Problem(
          422,
          "BRAND_FACT_UNAVAILABLE",
          "The fixed product or promotional fact is not currently valid",
          {
            fact_key: text.fact_key,
            state: fact ? factEligibility(fact) : "not_found",
          },
        );
      content = fact.text;
      if (fact.amount_minor !== null) {
        const formatter = new Intl.NumberFormat(binding.locale, {
          style: "currency",
          currency: fact.currency!,
          currencyDisplay: "code",
        });
        const amount = formatter.format(
          fact.amount_minor /
            10 ** formatter.resolvedOptions().maximumFractionDigits!,
        );
        content += " · " + amount;
      }
    }
    if (!fonts.has(f.key)) {
      const source = await fontBytes(tx, storage, project, f);
      fonts.set(f.key, {
        bytes: source.bytes,
        alias: "CPBrand_" + source.sha256.slice(0, 24),
      });
    }
    const loaded = fonts.get(f.key)!;
    assertBrandGlyphs(loaded.bytes, content, f.key);
    resolved.push({ text: content, family: loaded.alias });
  }
  return { row, fonts, resolved, rights_status: "customer_declared" };
}
export function registerBrandProduction(
  app: FastifyInstance,
  db: Database,
  storage: Storage,
) {
  const base = "/v1/tenants/:tenant/projects/:project/brand",
    scope = z.object({ tenant: uuid, project: uuid });
  app.post(
    base + "/definitions",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const { tenant, project } = scope.parse(req.params),
        b = brandDefinition.parse(req.body);
      const result = await db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "write");
        return replay(
          tx,
          req.principal.id,
          "brand.definition.create:" + project,
          key(req),
          b,
          async () => {
            await checkBrandDefinition(tx, storage, project, b);
            const row = (
              await tx.query(
                "INSERT INTO brand_profiles(tenant_id,project_id,name,body) VALUES($1,$2,$3,$4) RETURNING *",
                [tenant, project, b.name, b],
              )
            ).rows[0];
            await audit(
              tx,
              req.principal,
              "brand.version.publish",
              row.id,
              "succeeded",
              { version: row.version, project_id: project },
              tenant,
            );
            return row;
          },
        );
      }, tenant);
      return reply.code(201).send(result);
    },
  );
  app.put(base + "/:id", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project, id } = scope
        .extend({ id: uuid })
        .parse(req.params),
      b = z
        .object({
          expected_version: z.number().int().positive(),
          definition: brandDefinition,
        })
        .strict()
        .parse(req.body);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project, "write");
      return replay(
        tx,
        req.principal.id,
        "brand.version.publish:" + id,
        key(req),
        b,
        async () => {
          const old = (
            await tx.query(
              "SELECT * FROM brand_profiles WHERE id=$1 AND project_id=$2 AND content_state='active' FOR UPDATE",
              [id, project],
            )
          ).rows[0];
          if (!old) throw new Problem(404, "NOT_FOUND", "Brand not found");
          if (old.version !== b.expected_version)
            throw new Problem(
              409,
              "VERSION_CONFLICT",
              "Refresh the brand before publishing another version",
            );
          await checkBrandDefinition(tx, storage, project, b.definition);
          const row = (
            await tx.query(
              "UPDATE brand_profiles SET name=$2,body=$3,version=version+1 WHERE id=$1 RETURNING *",
              [id, b.definition.name, b.definition],
            )
          ).rows[0];
          await audit(
            tx,
            req.principal,
            "brand.version.publish",
            id,
            "succeeded",
            { version: row.version, project_id: project },
            tenant,
          );
          return row;
        },
      );
    }, tenant);
  });
  app.get(
    base + "/:id/versions",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, id } = scope
        .extend({ id: uuid })
        .parse(req.params);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project);
        if (
          !(
            await tx.query(
              "SELECT 1 FROM brand_profiles WHERE id=$1 AND project_id=$2 AND content_state='active'",
              [id, project],
            )
          ).rowCount
        )
          throw new Problem(404, "NOT_FOUND", "Brand not found");
        return {
          items: (
            await tx.query(
              "SELECT version,name,body,sha256,created_at,created_by,CASE WHEN created_by_admin IS NOT NULL THEN 'administrator' WHEN created_by IS NOT NULL THEN 'customer' ELSE 'legacy_unattributed' END AS origin FROM brand_profile_versions WHERE brand_id=$1 AND erased_at IS NULL ORDER BY version DESC LIMIT 100",
              [id],
            )
          ).rows,
        };
      }, tenant);
    },
  );
  app.post(
    base + "/:id/versions/:version/check",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, id, version } = scope
        .extend({ id: uuid, version: z.coerce.number().int().positive() })
        .parse(req.params);
      const b = z
        .object({
          channel: code,
          locale: code,
          text: z.string().max(5000),
          font_key: code.optional(),
          fact_key: code.optional(),
        })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project);
        const result = await prepareBrandProduction(
          tx,
          storage,
          project,
          { id, version, channel: b.channel, locale: b.locale },
          [b],
        );
        return {
          id,
          version,
          sha256: result.row.sha256,
          text: result.resolved[0].text,
          glyphs: "covered",
          rights_status: result.rights_status,
        };
      }, tenant);
    },
  );
}
