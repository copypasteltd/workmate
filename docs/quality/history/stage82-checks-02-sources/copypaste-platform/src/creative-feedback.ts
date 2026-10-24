import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Database, Tx } from "./db.js";
import { requireUser, audit, type Principal } from "./auth.js";
import { lockUserAuthorities } from "./user-authority.js";
import { lockMemberships } from "./membership.js";
import { key, projectAccess, replay } from "./access.js";
import { canonical, hash, Problem, uuid } from "./lib.js";
import { saveAsset, type Storage } from "./storage.js";
import { creativeMappingInput, creativeFeedbackInput, freezeCreativeMapping, calculateCreativeFeedback } from "./creative-feedback-model.js";

const root = "/v1/tenants/:tenant/projects/:project/creative-feedback";
const params = z.object({ tenant: uuid, project: uuid });
const decision = z.object({ expected_version: z.number().int().positive(), expected_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(5).max(2000) }).strict();
const confirm = decision.extend({ confirm_single_creative_allocation: z.literal(true) }).strict();
const media = new Set(["image/png", "image/jpeg", "image/svg+xml", "image/webp", "video/mp4", "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"]);

async function projectLock(tx: Tx, project: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["creative-feedback:" + project]);
}
async function authorizeWrite(tx: Tx, actor: Principal, tenant: string, project: string) {
  await lockUserAuthorities(tx, [actor.id]);
  await lockMemberships(tx, tenant);
  await projectAccess(tx, actor, tenant, project, "write");
  await tx.query("SELECT id FROM projects WHERE id=$1 AND tenant_id=$2 AND NOT archived FOR SHARE", [project, tenant]);
  await projectLock(tx, project);
}
export async function creativeSources(tx: Tx, tenant: string, project: string, versions: string[], datasets: string[]) {
  // Match existing source readers' lock order. Hold asset and dataset locks until
  // the frozen report and source bindings commit; never use private source data.
  await tx.query(`SELECT a.id FROM assets a WHERE a.id IN(
    SELECT v.asset_id FROM asset_versions v WHERE v.id=ANY($1::uuid[]) UNION
    SELECT v.asset_id FROM asset_versions v JOIN analytics_datasets d ON d.source_asset_version_id=v.id WHERE d.id=ANY($2::uuid[]))
    ORDER BY a.id FOR SHARE OF a NOWAIT`, [versions, datasets]);
  const assets = (await tx.query(`SELECT v.*,a.project_id,a.name FROM asset_versions v JOIN assets a ON a.id=v.asset_id
    WHERE v.id=ANY($1::uuid[]) AND a.tenant_id=$2 AND a.project_id=$3 AND a.private_owner IS NULL AND a.state='active'
    AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL
    AND content_source_manifest(a.tenant_id,a.project_id,'{}',ARRAY[v.id]) IS NOT NULL ORDER BY v.id`, [versions, tenant, project])).rows;
  const sources = (await tx.query(`SELECT d.* FROM analytics_datasets d WHERE d.id=ANY($1::uuid[]) AND d.tenant_id=$2 AND d.project_id=$3
    AND d.content_state='active' AND d.source_state='active' AND d.retention_expires_at>clock_timestamp()
    AND (d.raw_csv IS NOT NULL OR d.source_asset_version_id IS NOT NULL)
    AND (d.source_asset_version_id IS NULL OR EXISTS(SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id
      WHERE v.id=d.source_asset_version_id AND a.tenant_id=d.tenant_id AND a.project_id=d.project_id AND a.private_owner IS NULL
      AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL AND v.sha256=d.source_sha256
      AND content_source_manifest(a.tenant_id,a.project_id,'{}',ARRAY[v.id]) IS NOT NULL))
    ORDER BY d.id FOR SHARE OF d NOWAIT`, [datasets, tenant, project])).rows;
  if (assets.length !== new Set(versions).size || sources.length !== new Set(datasets).size)
    throw new Problem(404, "CREATIVE_SOURCE_UNAVAILABLE", "A shared creative version or retained source is unavailable");
  if (assets.some(a => !media.has(a.mime_type)))
    throw new Problem(422, "CREATIVE_MEDIA_REQUIRED", "Choose a shared image, video, PDF or presentation version");
  return { assets, datasets: sources };
}

async function mapping(tx: Tx, tenant: string, project: string, id: string) {
  const row = (await tx.query("SELECT * FROM creative_mappings WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND content_state='active'", [id, tenant, project])).rows[0];
  if (!row) throw new Problem(404, "NOT_FOUND", "Creative mapping not found");
  return row;
}
async function availableMapping(tx: Tx, row: any) {
  if (!(await tx.query("SELECT creative_mapping_sources_available($1) AS ok", [row.id])).rows[0].ok)
    throw new Problem(404, "CREATIVE_SOURCE_UNAVAILABLE", "A retained mapping source is unavailable");
}
function receipt(row: any) {
  return { id: row.id, state: row.state, version: row.version, sha256: row.sha256 };
}
function matches(row: any, b: z.infer<typeof decision>) {
  if (row.version !== b.expected_version || row.sha256 !== b.expected_sha256)
    throw new Problem(409, "CREATIVE_MAPPING_CHANGED", "Review the current mapping before confirming or withdrawing it");
}

export function registerCreativeFeedback(app: FastifyInstance, db: Database, storage: Storage) {
  app.get(root + "/mappings", { preHandler: requireUser(db) }, async req => {
    const { tenant, project } = params.parse(req.params);
    return db.tx(async tx => {
      await projectAccess(tx, req.principal, tenant, project);
      const query = z.object({ cursor: uuid.optional(), limit: z.coerce.number().int().min(1).max(100).default(40) }).strict().parse(req.query);
      const items = (await tx.query(`SELECT * FROM creative_mappings WHERE project_id=$1 AND content_state='active'
        AND creative_mapping_sources_available(id) AND ($2::uuid IS NULL OR id<$2) ORDER BY id DESC LIMIT $3`, [project, query.cursor ?? null, query.limit + 1])).rows;
      return { items: items.slice(0, query.limit), next_cursor: items.length > query.limit ? items[query.limit - 1].id : null };
    }, tenant, true);
  });
  app.get(root + "/options", { preHandler: requireUser(db) }, async req => {
    const { tenant, project } = params.parse(req.params);
    const q = z.object({ dataset_id: uuid.optional(), asset_id: uuid.optional() }).strict().parse(req.query);
    return db.tx(async tx => {
      await projectAccess(tx, req.principal, tenant, project);
      if (q.dataset_id) {
        const { datasets } = await creativeSources(tx, tenant, project, [], [q.dataset_id]);
        const d = datasets[0];
        if (!['google_ads', 'meta_ads'].includes(d.source) || d.import_spec?.entity_level !== 'ad')
          throw new Problem(422, "CREATIVE_AD_SOURCE_REQUIRED", "Import a confirmed ad-level source first");
        const rows = new Map<string, any>();
        for (const r of d.rows) {
          const id = canonical([r.channel, r.campaign, r.entity_id]);
          if (!r.entity_id) continue;
          const item = rows.get(id) ?? { channel: r.channel, campaign: r.campaign, ad_id: r.entity_id, date_from: r.date, date_to: r.date };
          if (r.date < item.date_from) item.date_from = r.date;
          if (r.date > item.date_to) item.date_to = r.date;
          rows.set(id, item);
        }
        const items = [...rows.values()];
        if (items.length > 1000) throw new Problem(422, "CREATIVE_IDENTITY_LIMIT", "Import a smaller ad-level snapshot containing at most 1,000 identities");
        return { dataset_id: d.id, source: d.source, account_id: d.import_spec.account_id, currency: d.currency, timezone: d.timezone,
          items: items.sort((a, b) => canonical(a).localeCompare(canonical(b))) };
      }
      if (q.asset_id) {
        const items = (await tx.query(`SELECT v.id,v.version,v.sha256,v.mime_type,a.name FROM asset_versions v JOIN assets a ON a.id=v.asset_id
          WHERE a.id=$1 AND a.tenant_id=$2 AND a.project_id=$3 AND a.private_owner IS NULL AND a.state='active'
          AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL AND task_asset_version_sources_available(v.id)
          ORDER BY v.version DESC LIMIT 100`, [q.asset_id, tenant, project])).rows.filter(v => media.has(v.mime_type));
        return { asset_id: q.asset_id, items };
      }
      const sources = (await tx.query(`SELECT id,name,source,currency,timezone,import_spec FROM analytics_datasets
        WHERE tenant_id=$1 AND project_id=$2 AND content_state='active' AND source_state='active' AND retention_expires_at>clock_timestamp()
        AND source IN('google_ads','meta_ads') AND import_spec->>'entity_level'='ad' ORDER BY created_at DESC,id DESC LIMIT 100`, [tenant, project])).rows;
      const assets = (await tx.query(`SELECT id,name,current_version FROM assets WHERE tenant_id=$1 AND project_id=$2 AND private_owner IS NULL
        AND state='active' AND retention_expires_at>clock_timestamp() AND task_asset_sources_available(id) ORDER BY created_at DESC,id DESC LIMIT 100`, [tenant, project])).rows;
      return { datasets: sources, assets, limit: 100 };
    }, tenant, true);
  });
  app.post(root + "/mappings", { preHandler: requireUser(db) }, async (req, reply) => {
    const { tenant, project } = params.parse(req.params), b = creativeMappingInput.parse(req.body);
    const result = await db.tx(async tx => {
      await authorizeWrite(tx, req.principal, tenant, project);
      // Check current source access even for an old idempotency key. Receipts
      // contain IDs/state only, never a serialized private source body.
      const sources = await creativeSources(tx, tenant, project, [b.asset_version_id], [b.dataset_id]);
      const body = freezeCreativeMapping(b, sources.datasets[0], sources.assets[0]);
      return replay(tx, req.principal.id, "creative.mapping.create:" + project, key(req), b, async () => {
        const row = (await tx.query(`INSERT INTO creative_mappings(tenant_id,project_id,name,body,sha256,asset_version_id,dataset_id,platform,account_id,channel,ad_id,creative_id,date_from,date_to,created_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [tenant, project, b.name, body, hash(canonical(body)), b.asset_version_id,
          b.dataset_id, body.dataset.source, body.dataset.account_id, b.channel, b.ad_id, b.creative_id, b.date_from, b.date_to, req.principal.id])).rows[0];
        await audit(tx, req.principal, "creative.mapping.create", row.id, "succeeded", { sha256: row.sha256 }, tenant);
        return receipt(row);
      });
    }, tenant, true);
    return reply.code(201).send(result);
  });
  for (const action of ["confirm", "withdraw"] as const) app.post(root + "/mappings/:id/" + action, { preHandler: requireUser(db) }, async req => {
    const { tenant, project, id } = params.extend({ id: uuid }).parse(req.params);
    const b = (action === "confirm" ? confirm : decision).parse(req.body);
    return db.tx(async tx => {
      await authorizeWrite(tx, req.principal, tenant, project);
      const row = await mapping(tx, tenant, project, id);
      if (action === "confirm") {
        await creativeSources(tx, tenant, project, [row.asset_version_id], [row.dataset_id]);
        await availableMapping(tx, row);
      }
      return replay(tx, req.principal.id, "creative.mapping." + action + ":" + id, key(req), b, async () => {
        const current = (await tx.query("SELECT * FROM creative_mappings WHERE id=$1 FOR UPDATE", [id])).rows[0];
        matches(current, b);
        if (current.state === "withdrawn" || (action === "confirm" && current.state !== "candidate"))
          throw new Problem(409, "CREATIVE_MAPPING_STATE", "Create a new candidate to change or reconfirm this identity");
        if (action === "confirm") {
          const conflicting = await tx.query(`SELECT id FROM creative_mappings WHERE project_id=$1 AND state='confirmed' AND content_state='active'
            AND platform=$2 AND account_id=$3 AND channel=$4 AND ad_id=$5 AND date_from<=$7 AND date_to>=$6
            AND (asset_version_id<>$8 OR creative_id<>$9) LIMIT 1`, [project, current.platform, current.account_id, current.channel, current.ad_id,
            current.date_from, current.date_to, current.asset_version_id, current.creative_id]);
          if (conflicting.rowCount) throw new Problem(409, "CREATIVE_ALLOCATION_CONFLICT", "Withdraw the conflicting ad allocation before confirming another creative version");
        }
        const updated = (await tx.query(action === "confirm"
          ? "UPDATE creative_mappings SET state='confirmed',version=version+1,confirmed_by=$2,confirmed_at=clock_timestamp() WHERE id=$1 RETURNING *"
          : "UPDATE creative_mappings SET state='withdrawn',version=version+1,withdrawn_by=$2,withdrawn_at=clock_timestamp(),withdrawal_reason=$3 WHERE id=$1 RETURNING *",
        action === "confirm" ? [id, req.principal.id] : [id, req.principal.id, b.reason])).rows[0];
        await audit(tx, req.principal, "creative.mapping." + action, id, "succeeded", { sha256: current.sha256, reason: b.reason, version: updated.version }, tenant);
        return receipt(updated);
      });
    }, tenant, true);
  });
  app.post(root + "/reports", { preHandler: requireUser(db) }, async (req, reply) => {
    const { tenant, project } = params.parse(req.params), b = creativeFeedbackInput.parse(req.body);
    const result = await db.tx(async tx => {
      await authorizeWrite(tx, req.principal, tenant, project);
      const ids = [...b.mapping_ids].sort();
      const mappings = (await tx.query(`SELECT * FROM creative_mappings WHERE id=ANY($1::uuid[]) AND tenant_id=$2 AND project_id=$3
        AND content_state='active' ORDER BY id FOR SHARE`, [ids, tenant, project])).rows;
      if (mappings.length !== ids.length) throw new Problem(404, "NOT_FOUND", "A selected mapping is unavailable");
      const sources = await creativeSources(tx, tenant, project, [...new Set(mappings.map(m => m.asset_version_id))], [...new Set(mappings.map(m => m.dataset_id))]);
      for (const m of mappings) await availableMapping(tx, m);
      return replay(tx, req.principal.id, "creative.feedback.create:" + project, key(req), b, async () => {
        const id = randomUUID(), body = calculateCreativeFeedback(id, b, mappings, sources.datasets), digest = hash(canonical(body));
        const asset = await saveAsset(tx, storage, { tenant, project, user: req.principal.id, name: b.name + ".json", mime: "application/json", kind: "report",
          bytes: Buffer.from(JSON.stringify(body, null, 2)), metadata: { creative_feedback_id: id, calculation_version: body.schema } });
        await tx.query("INSERT INTO creative_feedback_reports(id,tenant_id,project_id,name,body,sha256,asset_version_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [id, tenant, project, b.name, body, digest, asset.version.id, req.principal.id]);
        for (const m of mappings) await tx.query("INSERT INTO creative_feedback_mappings(report_id,mapping_id,tenant_id,project_id,mapping_version) VALUES($1,$2,$3,$4,$5)",
          [id, m.id, tenant, project, m.version]);
        await audit(tx, req.principal, "creative.feedback.create", id, "succeeded", { sha256: digest, mapping_ids: ids }, tenant);
        return { id, sha256: digest, asset_id: asset.id, asset_version_id: asset.version.id, version: asset.version.version };
      });
    }, tenant, true);
    return reply.code(201).send(result);
  });
  app.get(root + "/reports", { preHandler: requireUser(db) }, async req => {
    const { tenant, project } = params.parse(req.params);
    const q = z.object({ cursor: uuid.optional(), limit: z.coerce.number().int().min(1).max(100).default(40) }).strict().parse(req.query);
    return db.tx(async tx => {
      await projectAccess(tx, req.principal, tenant, project);
      const items = (await tx.query(`SELECT r.*,v.asset_id,v.version AS asset_version FROM creative_feedback_reports r
        JOIN asset_versions v ON v.id=r.asset_version_id JOIN assets a ON a.id=v.asset_id
        WHERE r.project_id=$1 AND r.content_state='active' AND a.state='active' AND a.retention_expires_at>clock_timestamp()
        AND v.erased_at IS NULL AND task_asset_version_sources_available(v.id) AND ($2::uuid IS NULL OR r.id<$2)
        ORDER BY r.id DESC LIMIT $3`, [project, q.cursor ?? null, q.limit + 1])).rows;
      return { items: items.slice(0, q.limit), next_cursor: items.length > q.limit ? items[q.limit - 1].id : null };
    }, tenant, true);
  });
}
