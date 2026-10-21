import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import { type Principal, requireUser, audit } from "./auth.js";
import { projectAccess, tenantAccess, key, replay } from "./access.js";
import { Problem, uuid, hash, canonical } from "./lib.js";
import { enqueueTask } from "./task-service.js";
import {
  getAgentVersion,
  freezeWorkContext,
  resolveWorkContext,
} from "./persistent-work.js";
import { assertTaskSkills } from "./skill-lifecycle.js";
import { taskCapabilities } from "./capability-bindings.js";
import { authorizeExecutionPlan } from "./plans.js";
import { settle } from "./billing.js";
import { event } from "./tasks.js";
import { type Storage, saveAsset } from "./storage.js";
import { seoInput } from "./seo-model.js";
import {
  advanceSeoCrawl,
  createSeoCheckpoint,
  collectSeoFindings,
  compareSeoFindings,
  type SeoCheckpoint,
  type SeoCrawlStore,
  validateSeoCheckpoint,
} from "./seo-crawl.js";
import { createSeoTransport } from "./seo-http.js";
import { assertSeoSources } from "./seo-source-access.js";
import {
  readSeoDocument,
  readSeoResult,
  serializeSeoDocument,
  type SeoResult,
} from "./seo-audit-storage.js";

const budget = z
  .object({
    currency: z.literal("HKD"),
    amount_micros: z
      .string()
      .regex(/^[1-9]\d{0,12}$/)
      .refine((v) => BigInt(v) <= 1000000000000n),
  })
  .strict();
const create = z
  .object({ project_id: uuid, agent_id: uuid, input: seoInput, budget })
  .strict();
const tenantOf = (req: FastifyRequest) =>
  uuid.parse(req.headers["x-tenant-id"]);

async function readRun(
  tx: Tx,
  actor: Principal,
  tenant: string,
  id: string,
  write = false,
) {
  await tenantAccess(tx, actor, tenant);
  const run = (
    await tx.query(
      `SELECT r.*,t.status AS task_status,t.error_code AS task_error_code,t.budget_micros,t.charged_micros,
    t.input_context,t.actor_auth_version,t.data_mode FROM seo_runs r JOIN tasks t ON t.id=r.task_id WHERE r.id=$1`,
      [id],
    )
  ).rows[0];
  if (!run) throw new Problem(404, "NOT_FOUND", "Website audit not found");
  await projectAccess(
    tx,
    actor,
    tenant,
    run.project_id,
    write ? "write" : "read",
  );
  await assertSeoSources(tx, {
    id: run.task_id,
    input_context: { seo_audit_id: id },
  });
  return run;
}
const summary = (r: any) => ({
  id: r.id,
  project_id: r.project_id,
  task_id: r.task_id,
  state: r.state,
  revision: r.revision,
  spec_hash: r.spec_hash,
  input: r.checkpoint.spec,
  data_mode: r.data_mode,
  created_at: r.created_at.toISOString(),
  finished_at: r.finished_at?.toISOString() ?? null,
  previous_run_id: r.previous_run_id,
  task_status: r.task_status,
  result_asset_version_id: r.result_asset_version_id,
  report_asset_version_id: r.report_asset_version_id,
  budget: { currency: "HKD", amount_micros: String(r.budget_micros) },
  confirmed_cost: { currency: "HKD", amount_micros: String(r.charged_micros) },
  progress: {
    page_requests: r.checkpoint.page_requests,
    robots_requests: r.checkpoint.robots_requests,
    max_pages: r.checkpoint.spec.max_pages,
    byte_budget_used: r.checkpoint.byte_budget_used,
    remaining_urls: r.checkpoint.frontier.length,
    next_attempt_at: r.checkpoint.next_at,
    limitations: r.checkpoint.limitations,
    error_code: r.error_code ?? r.task_error_code ?? null,
  },
});

async function createRun(
  tx: Tx,
  db: Database,
  catalog: Catalog,
  actor: Principal,
  tenant: string,
  body: z.infer<typeof create>,
  previous?: any,
) {
  await projectAccess(tx, actor, tenant, body.project_id, "write");
  if (body.input.connection_id)
    throw new Problem(
      422,
      "SEO_CONNECTION_REFERENCE_UNSUPPORTED",
      "This crawler inspects public server HTML. Use the separate retained Search Console workflow for connected metrics.",
    );
  const agent = await getAgentVersion(
    tx,
    body.project_id,
    body.agent_id,
    undefined,
    true,
  );
  if (
    !["asset.read", "asset.write"].every((tool) =>
      agent.body.tool_ids.includes(tool),
    )
  )
    throw new Problem(
      403,
      "SEO_AGENT_TOOLS",
      "Choose a specialist with source reading and artifact writing permissions",
    );
  const id = randomUUID(),
    checkpoint = createSeoCheckpoint(body.input);
  const context = {
    ...(await freezeWorkContext(
      tx,
      actor,
      tenant,
      body.project_id,
      agent,
      undefined,
      catalog,
    )),
    seo_audit_id: id,
  };
  const task = await enqueueTask(
    tx,
    db,
    catalog,
    actor,
    tenant,
    body.project_id,
    {
      title: `SEO · ${body.input.start_urls[0]}`.slice(0, 160),
      prompt: body.input.prompt,
      role_key: agent.role_key,
      budget_micros: Number(body.budget.amount_micros),
      mode: "execute",
    },
    "seo-audit:" + id,
    { context },
  );
  await tx.query(
    `INSERT INTO seo_runs(id,tenant_id,project_id,task_id,created_by,private_owner,spec_hash,checkpoint,previous_run_id)
    VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8)`,
    [
      id,
      tenant,
      body.project_id,
      task.id,
      actor.id,
      checkpoint.spec_hash,
      JSON.stringify(checkpoint),
      previous?.id ?? null,
    ],
  );
  await audit(
    tx,
    actor,
    "seo.audit.create",
    id,
    "accepted",
    {
      task_id: task.id,
      spec_hash: checkpoint.spec_hash,
      previous_run_id: previous?.id ?? null,
    },
    tenant,
  );
  return id;
}

export function registerSeoAudits(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
  storage: Storage,
) {
  app.post(
    "/v1/seo/audits",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const tenant = tenantOf(req),
        body = create.parse(req.body);
      const result = await db.tx(
        async (tx) => {
          await projectAccess(
            tx,
            req.principal,
            tenant,
            body.project_id,
            "write",
          );
          const saved = await replay(
            tx,
            req.principal.id,
            "seo.audit.create",
            key(req),
            { tenant, ...body },
            async () => ({
              id: await createRun(tx, db, catalog, req.principal, tenant, body),
            }),
          );
          return summary(await readRun(tx, req.principal, tenant, saved.id));
        },
        tenant,
        false,
        req.principal.id,
      );
      return reply
        .code(202)
        .header("location", "/v1/seo/audits/" + result.id)
        .send(result);
    },
  );
  app.get("/v1/seo/audits", { preHandler: requireUser(db) }, async (req) => {
    const tenant = tenantOf(req),
      query = z.object({ project_id: uuid }).strict().parse(req.query);
    return db.tx(
      async (tx) => {
        await projectAccess(tx, req.principal, tenant, query.project_id);
        const rows = (
          await tx.query(
            `SELECT r.*,t.status AS task_status,t.error_code AS task_error_code,t.data_mode,t.budget_micros,t.charged_micros FROM seo_runs r JOIN tasks t ON t.id=r.task_id WHERE r.project_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 50`,
            [query.project_id],
          )
        ).rows;
        return { items: rows.map(summary) };
      },
      tenant,
      false,
      req.principal.id,
    );
  });
  app.get(
    "/v1/seo/audits/:run",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        id = uuid.parse((req.params as any).run);
      return db.tx(
        async (tx) => summary(await readRun(tx, req.principal, tenant, id)),
        tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.get(
    "/v1/seo/audits/:run/findings",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        id = uuid.parse((req.params as any).run),
        query = z
          .object({
            offset: z.coerce.number().int().min(0).max(100000).default(0),
          })
          .strict()
          .parse(req.query);
      return db.tx(
        async (tx) => {
          const run = await readRun(tx, req.principal, tenant, id),
            result = await readSeoResult(tx, storage, run),
            items = result.findings.slice(query.offset, query.offset + 25);
          return {
            run_id: id,
            spec_hash: run.spec_hash,
            coverage: result.coverage,
            items,
            comparison: result.comparison,
            next_offset:
              query.offset + items.length < result.findings.length
                ? query.offset + items.length
                : null,
            total: result.findings.length,
          };
        },
        tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.get(
    "/v1/seo/audits/:run/download",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const tenant = tenantOf(req),
        id = uuid.parse((req.params as any).run),
        { format } = z
          .object({ format: z.enum(["json", "html"]) })
          .strict()
          .parse(req.query);
      const result = await db.tx(
        async (tx) => {
          const run = await readRun(tx, req.principal, tenant, id),
            version =
              format === "json"
                ? run.result_asset_version_id
                : run.report_asset_version_id;
          if (!version)
            throw new Problem(
              409,
              "SEO_REPORT_NOT_READY",
              "This retained output is not ready",
            );
          const row = (
            await tx.query(
              `SELECT v.* FROM asset_versions v JOIN assets a ON a.id=v.asset_id
          WHERE v.id=$1 AND a.project_id=$2 AND a.private_owner=$3 AND a.state='active'
            AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL`,
              [version, run.project_id, run.private_owner],
            )
          ).rows[0];
          if (!row)
            throw new Problem(
              403,
              "SEO_SOURCE_REVOKED",
              "The retained output is unavailable",
            );
          const bytes = await storage.get(row.storage_key);
          if (
            bytes.length !== Number(row.bytes) ||
            hash(bytes) !== row.sha256 ||
            row.mime_type !==
              (format === "json" ? "application/json" : "text/html")
          )
            throw new Problem(
              409,
              "SEO_SOURCE_INVALID",
              "The retained output does not match its digest",
            );
          if (format === "json") {
            const evidence = JSON.parse(bytes.toString("utf8")) as SeoResult;
            if (
              evidence.run_id !== run.id ||
              evidence.spec_hash !== run.spec_hash ||
              evidence.checkpoint_sha256 !== hash(canonical(run.checkpoint))
            )
              throw new Problem(
                409,
                "SEO_SOURCE_INVALID",
                "The output does not match the frozen checkpoint",
              );
          }
          // Recheck identity, project access, retention and source lineage after storage I/O.
          await projectAccess(tx, req.principal, tenant, run.project_id);
          await assertSeoSources(tx, {
            id: run.task_id,
            input_context: { seo_audit_id: id },
          });
          await audit(
            tx,
            req.principal,
            "seo.audit.download",
            id,
            "succeeded",
            { format, asset_version_id: version },
            tenant,
          );
          return { bytes, sha256: row.sha256, mime: row.mime_type };
        },
        tenant,
        false,
        req.principal.id,
      );
      return reply
        .header("Cache-Control", "private, no-store")
        .header(
          "Content-Disposition",
          `attachment; filename="seo-${format === "json" ? "evidence" : "report"}-${id}.${format}"`,
        )
        .header("X-Content-SHA256", result.sha256)
        .type(result.mime)
        .send(result.bytes);
    },
  );
  app.get(
    "/v1/seo/audits/:run/pages",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        id = uuid.parse((req.params as any).run),
        query = z
          .object({
            offset: z.coerce.number().int().min(0).max(10000).default(0),
          })
          .strict()
          .parse(req.query);
      return db.tx(
        async (tx) => {
          const run = await readRun(tx, req.principal, tenant, id),
            visits = Object.entries(run.checkpoint.visits) as [string, any][],
            selected = visits.slice(query.offset, query.offset + 25);
          return {
            run_id: id,
            items: selected.map(([url, visit]) => ({ url, ...visit })),
            total: visits.length,
            next_offset:
              query.offset + selected.length < visits.length
                ? query.offset + selected.length
                : null,
          };
        },
        tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.get(
    "/v1/seo/audits/:run/documents/:document",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        id = uuid.parse((req.params as any).run),
        document = uuid.parse((req.params as any).document);
      return db.tx(
        async (tx) => {
          const run = await readRun(tx, req.principal, tenant, id);
          const binding = (
            await tx.query(
              "SELECT asset_id,asset_version FROM seo_documents WHERE id=$1 AND run_id=$2",
              [document, id],
            )
          ).rows[0];
          if (!binding)
            throw new Problem(404, "NOT_FOUND", "Website source not found");
          const source = await readSeoDocument(tx, storage, run, document);
          return {
            id: source.id,
            run_id: id,
            kind: source.kind,
            url: source.url,
            http_status: source.status,
            effective_status: source.effective_status,
            captured_at: source.captured_at,
            content_captured_at: source.content_captured_at,
            data_mode: source.source_mode,
            response_sha256: source.response_sha256,
            raw_sha256: source.raw_sha256,
            source_sha256: source.source_sha256,
            charset: source.charset,
            cache_source_id: source.cache_source_id,
            asset_id: binding.asset_id,
            asset_version: binding.asset_version,
            title: source.page?.title.slice(0, 1000) ?? null,
            limitations: source.page?.limitations ?? [],
            error_code: source.error_code,
          };
        },
        tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.post(
    "/v1/seo/audits/:run/recheck",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const tenant = tenantOf(req),
        id = uuid.parse((req.params as any).run),
        body = z
          .object({
            agent_id: uuid,
            expected_revision: z.number().int().min(0),
            budget,
          })
          .strict()
          .parse(req.body);
      const result = await db.tx(
        async (tx) => {
          const original = await readRun(tx, req.principal, tenant, id, true);
          if (original.revision !== body.expected_revision)
            throw new Problem(
              409,
              "VERSION_CONFLICT",
              "The audit changed; refresh first",
            );
          if (
            !["complete", "partial"].includes(original.state) ||
            !original.result_asset_version_id
          )
            throw new Problem(
              409,
              "SEO_CRAWL_NOT_READY",
              "Finish the original crawl before starting a comparison",
            );
          const depth = (
            await tx.query(
              `WITH RECURSIVE history AS (SELECT id,previous_run_id,1 AS depth FROM seo_runs WHERE id=$1 UNION ALL SELECT r.id,r.previous_run_id,h.depth+1 FROM seo_runs r JOIN history h ON r.id=h.previous_run_id WHERE h.depth<=20) SELECT max(depth)::int AS depth FROM history`,
              [id],
            )
          ).rows[0].depth;
          if (depth >= 20)
            throw new Problem(
              409,
              "SEO_COMPARISON_HISTORY_LIMIT",
              "Start a fresh independent audit after this comparison chain",
            );
          const saved = await replay(
            tx,
            req.principal.id,
            "seo.audit.recheck",
            key(req),
            { tenant, id, ...body },
            async () => ({
              id: await createRun(
                tx,
                db,
                catalog,
                req.principal,
                tenant,
                {
                  project_id: original.project_id,
                  agent_id: body.agent_id,
                  budget: body.budget,
                  input: seoInput.parse({
                    ...original.checkpoint.spec,
                    cache_policy: "refresh",
                  }),
                },
                original,
              ),
            }),
          );
          return summary(await readRun(tx, req.principal, tenant, saved.id));
        },
        tenant,
        false,
        req.principal.id,
      );
      return reply
        .code(202)
        .header("location", "/v1/seo/audits/" + result.id)
        .send(result);
    },
  );
}

async function crawlAuthority(
  tx: Tx,
  db: Database,
  catalog: Catalog,
  run: any,
  lease: string,
) {
  const task = (
    await tx.query("SELECT * FROM tasks WHERE id=$1 FOR SHARE", [run.task_id])
  ).rows[0];
  if (
    !task ||
    task.cancel_requested ||
    task.content_state !== "active" ||
    !["queued", "paused"].includes(task.status)
  )
    throw new Problem(
      403,
      "SEO_AUTHORIZATION_CHANGED",
      "The source collection task is no longer active",
    );
  if (task.status === "paused")
    throw new Problem(
      409,
      "SEO_PAUSED",
      "Source collection is paused before the model turn",
    );
  const actor = {
    id: task.created_by,
    authVersion: task.actor_auth_version,
    audience: "user",
    sessionId: "",
    sessionHash: "",
    email: "",
    name: "",
  } as Principal;
  await projectAccess(tx, actor, run.tenant_id, run.project_id, "write");
  const live = (
    await tx.query(
      `SELECT * FROM seo_runs WHERE id=$1 AND lease_token=$2 AND lease_until>clock_timestamp() AND state IN('queued','running') AND invalidated_at IS NULL`,
      [run.id, lease],
    )
  ).rows[0];
  if (
    !live ||
    task.input_context?.seo_audit_id !== live.id ||
    live.spec_hash !== run.spec_hash ||
    (task.data_mode === "simulated") !== db.config.DEMO_MODE
  )
    throw new Problem(
      409,
      "SEO_RUN_FENCED",
      "The source collection lease is no longer active",
    );
  await catalog.ensureEnabled(tx, task.role_key);
  await assertTaskSkills(tx, catalog, task);
  await assertSeoSources(tx, task);
  await authorizeExecutionPlan(
    tx,
    task.tenant_id,
    task.created_by,
    catalog.role(task.role_key),
    task.mode,
  );
  const capabilities = await taskCapabilities(tx, db.config, catalog, task);
  await resolveWorkContext(
    tx,
    actor,
    task.tenant_id,
    task.project_id,
    task.input_context,
    db.config.CODEX_VERSION,
    capabilities.versionIds,
  );
  return task;
}

/** Actual read-only crawl with fenced native DB checkpoints; inference stays in the normal Codex worker. */
export async function advanceSeoAudits(
  db: Database,
  catalog: Catalog,
  storage: Storage,
  options: { signal?: AbortSignal; now?: () => number } = {},
) {
  if (options.signal?.aborted) return false;
  const now = options.now ?? Date.now,
    lease = randomUUID();
  // Cancelled unclaimed tasks release their reservation through the existing task service.
  await db.tx(
    async (tx) => {
      const cancelled = (
        await tx.query(`SELECT r.* FROM seo_runs r JOIN tasks t ON t.id=r.task_id
      WHERE r.state IN('queued','running') AND r.invalidated_at IS NULL AND (t.cancel_requested OR t.status IN('cancelled','failed') OR t.content_state<>'active')
      AND (r.lease_until IS NULL OR r.lease_until<clock_timestamp()) ORDER BY r.created_at LIMIT 10 FOR UPDATE OF r SKIP LOCKED`)
      ).rows;
      for (const row of cancelled) {
        const state = structuredClone(row.checkpoint) as SeoCheckpoint;
        state.state = "cancelled";
        state.active = null;
        state.updated_at = new Date(now()).toISOString();
        for (const url of state.frontier)
          Object.assign(state.visits[url], {
            state: "unvisited",
            reason: "SEO_CANCELLED",
          });
        state.frontier = [];
        if (!state.limitations.includes("SEO_CANCELLED"))
          state.limitations.push("SEO_CANCELLED");
        await tx.query(
          `UPDATE seo_runs SET state='cancelled',checkpoint=$2,finished_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,error_code='SEO_CANCELLED',revision=revision+1 WHERE id=$1`,
          [row.id, JSON.stringify(state)],
        );
      }
    },
    undefined,
    true,
  );
  const run = await db.tx(
    async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('seo-crawl-capacity',0))",
      );
      if (
        Number(
          (
            await tx.query(
              "SELECT count(*) AS n FROM seo_runs WHERE lease_until>clock_timestamp() AND state IN('queued','running')",
            )
          ).rows[0].n,
        ) >= 2
      )
        return null;
      const row = (
        await tx.query(
          `SELECT r.* FROM seo_runs r JOIN tasks t ON t.id=r.task_id
      WHERE r.state IN('queued','running') AND r.invalidated_at IS NULL AND t.status='queued' AND NOT t.cancel_requested
      AND t.data_mode=$1 AND (r.lease_until IS NULL OR r.lease_until<clock_timestamp())
      AND (r.checkpoint->>'next_at')::timestamptz<=$2::timestamptz
      AND NOT EXISTS(SELECT 1 FROM seo_runs busy WHERE busy.tenant_id=r.tenant_id AND busy.lease_until>clock_timestamp())
      ORDER BY r.created_at,r.id LIMIT 1 FOR UPDATE OF r SKIP LOCKED`,
          [
            db.config.DEMO_MODE ? "simulated" : "configured_services",
            new Date(now()).toISOString(),
          ],
        )
      ).rows[0];
      if (!row) return null;
      return (
        await tx.query(
          "UPDATE seo_runs SET lease_token=$2,lease_until=clock_timestamp()+interval '60 seconds',revision=revision+1 WHERE id=$1 RETURNING *",
          [row.id, lease],
        )
      ).rows[0];
    },
    undefined,
    true,
  );
  if (!run) return false;
  const transaction = <T>(effect: (tx: Tx) => Promise<T>) =>
    db.tx(effect, run.tenant_id, false, run.private_owner);
  const transport = createSeoTransport({
    simulated: db.config.DEMO_MODE,
    production: db.config.NODE_ENV === "production",
    fixtureOrigin: db.config.SEO_FIXTURE_ORIGIN,
    fixtureKey: db.config.SEO_FIXTURE_KEY,
  });
  const store: SeoCrawlStore = {
    async authorize() {
      await transaction(async (tx) => {
        await crawlAuthority(tx, db, catalog, run, lease);
      });
    },
    async read(id) {
      return transaction(async (tx) => {
        await crawlAuthority(tx, db, catalog, run, lease);
        return readSeoDocument(tx, storage, run, id);
      });
    },
    async cached(url) {
      return transaction(async (tx) => {
        await crawlAuthority(tx, db, catalog, run, lease);
        const row = (
          await tx.query(
            `SELECT d.id FROM seo_documents d JOIN seo_runs r ON r.id=d.run_id
        WHERE d.project_id=$1 AND d.url_sha256=$2 AND d.kind='page' AND r.private_owner=$3 AND r.id<>$4
          AND d.captured_at>$5::timestamptz-interval '24 hours' AND d.captured_at<=$5::timestamptz
        ORDER BY d.captured_at DESC,d.id LIMIT 1`,
            [
              run.project_id,
              hash(url),
              run.private_owner,
              run.id,
              new Date(now()).toISOString(),
            ],
          )
        ).rows[0];
        return row ? readSeoDocument(tx, storage, run, row.id) : null;
      });
    },
    async acquireOrigin(origin, delay, at) {
      return db.tx(
        async (tx) => {
          const mode = db.config.DEMO_MODE
            ? "simulated"
            : "configured_services";
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            ["seo-origin:" + mode + ":" + origin],
          );
          const slot = (
            await tx.query(
              "SELECT next_at FROM seo_origin_slots WHERE origin=$1 AND data_mode=$2 FOR UPDATE",
              [origin, mode],
            )
          ).rows[0];
          if (slot && slot.next_at.getTime() > at)
            return slot.next_at.getTime();
          await tx.query(
            `INSERT INTO seo_origin_slots(origin,data_mode,next_at) VALUES($1,$2,$3)
        ON CONFLICT(origin,data_mode) DO UPDATE SET next_at=excluded.next_at,touched_at=clock_timestamp()`,
            [
              origin,
              mode,
              new Date(
                Math.min(at + delay, Date.parse(run.checkpoint.expires_at)),
              ).toISOString(),
            ],
          );
          return at;
        },
        undefined,
        true,
      );
    },
    async commit(state, document) {
      await transaction(async (tx) => {
        const task = await crawlAuthority(tx, db, catalog, run, lease);
        await tx.query(
          "SELECT id FROM seo_runs WHERE id=$1 AND lease_token=$2 FOR UPDATE",
          [run.id, lease],
        );
        if (document) {
          if (document.source_mode !== task.data_mode)
            throw new Problem(
              409,
              "DATA_MODE_MISMATCH",
              "The source has a different execution mode",
            );
          const bytes = serializeSeoDocument(document),
            asset = await saveAsset(tx, storage, {
              tenant: run.tenant_id,
              project: run.project_id,
              user: run.created_by,
              name: `seo-source-${document.id}.json`,
              mime: "application/json",
              bytes,
              metadata: {
                task_id: run.task_id,
                seo_run_id: run.id,
                seo_document_id: document.id,
                source_mode: document.source_mode,
                raw_sha256: document.raw_sha256,
              },
            });
          await tx.query(
            `INSERT INTO seo_documents(id,tenant_id,project_id,run_id,asset_id,asset_version,container_sha256,url_sha256,kind,cache_source_id,captured_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              document.id,
              run.tenant_id,
              run.project_id,
              run.id,
              asset.id,
              asset.version.version,
              hash(bytes),
              hash(document.url),
              document.kind,
              document.cache_source_id,
              document.captured_at,
            ],
          );
        }
        let resultVersion: string | null = null;
        if (["complete", "partial"].includes(state.state)) {
          const ids = (
            await tx.query(
              "SELECT id FROM seo_documents WHERE run_id=$1 ORDER BY created_at,id",
              [run.id],
            )
          ).rows;
          const documents = [];
          for (const row of ids)
            documents.push(await readSeoDocument(tx, storage, run, row.id));
          const findings = collectSeoFindings(state, documents),
            counts: Record<string, number> = {};
          for (const visit of Object.values(state.visits))
            counts[visit.state] = (counts[visit.state] ?? 0) + 1;
          let comparison: SeoResult["comparison"] = null;
          if (run.previous_run_id) {
            const old = (
              await tx.query("SELECT * FROM seo_runs WHERE id=$1", [
                run.previous_run_id,
              ])
            ).rows[0];
            if (!old)
              throw new Problem(
                403,
                "SEO_SOURCE_REVOKED",
                "The prior audit source is unavailable",
              );
            const result = await readSeoResult(tx, storage, old);
            comparison = compareSeoFindings(
              { state: old.checkpoint, findings: result.findings },
              { state, findings },
            );
          }
          const result: SeoResult = {
            run_id: run.id,
            spec_hash: run.spec_hash,
            checkpoint_sha256: hash(canonical(state)),
            created_at: new Date(now()).toISOString(),
            coverage: {
              id: randomUUID(),
              state: state.state,
              page_requests: state.page_requests,
              robots_requests: state.robots_requests,
              max_pages: state.spec.max_pages,
              byte_budget_used: state.byte_budget_used,
              states: counts,
              limitations: state.limitations,
              data_mode: task.data_mode,
            },
            findings,
            comparison,
          };
          const asset = await saveAsset(tx, storage, {
            tenant: run.tenant_id,
            project: run.project_id,
            user: run.created_by,
            name: `seo-evidence-${run.id}.json`,
            mime: "application/json",
            kind: "deliverable",
            bytes: Buffer.from(JSON.stringify(result)),
            metadata: {
              task_id: run.task_id,
              seo_run_id: run.id,
              spec_hash: run.spec_hash,
              source_mode: task.data_mode,
              evidence_kind: "seo_crawl",
            },
          });
          resultVersion = asset.version.id;
        }
        const updated = await tx.query(
          `UPDATE seo_runs SET checkpoint=$3,state=$4,revision=revision+1,lease_until=clock_timestamp()+interval '60 seconds',
        result_asset_version_id=coalesce($5::uuid,result_asset_version_id),finished_at=CASE WHEN $4 IN('complete','partial','cancelled') THEN clock_timestamp() ELSE NULL END
        WHERE id=$1 AND lease_token=$2 AND invalidated_at IS NULL RETURNING id`,
          [run.id, lease, JSON.stringify(state), state.state, resultVersion],
        );
        if (!updated.rowCount)
          throw new Problem(
            409,
            "SEO_RUN_FENCED",
            "The source collection lease is no longer active",
          );
        await event(tx, run.tenant_id, run.task_id, "seo.crawl_progress", {
          audit_id: run.id,
          state: state.state,
          page_requests: state.page_requests,
          remaining_urls: state.frontier.length,
          ...(document
            ? { document_id: document.id, http_status: document.status }
            : {}),
        });
      });
    },
  };
  try {
    validateSeoCheckpoint(run.checkpoint);
    await advanceSeoCrawl(run.checkpoint, transport, store, {
      signal: options.signal,
      now,
    });
    return true;
  } catch (error) {
    if (
      error instanceof Problem &&
      ["SEO_PAUSED", "SEO_RUN_FENCED", "SEO_WORKER_STOPPED"].includes(
        error.code,
      )
    )
      return true;
    // Preserve unknown intents for transient infrastructure errors; an unavailable identity/source cannot proceed.
    if (
      error instanceof Problem &&
      (error.status === 403 ||
        error.status === 404 ||
        ["STORAGE_LIMIT_EXCEEDED", "SEO_CHECKPOINT_INVALID"].includes(
          error.code,
        ))
    ) {
      await db.tx(
        async (tx) => {
          const task = (
            await tx.query("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [
              run.task_id,
            ])
          ).rows[0];
          if (
            task?.status === "queued" &&
            task.attempt === 0 &&
            !task.runtime_thread
          ) {
            await settle(tx, run.tenant_id, task.id, 0, task.created_by);
            await tx.query(
              "UPDATE tasks SET status='cancelled',cancel_requested=true,error_code=$2,version=version+1 WHERE id=$1",
              [task.id, error.code],
            );
            await event(tx, run.tenant_id, task.id, "task.cancelled", {
              reason: error.code,
            });
          }
        },
        run.tenant_id,
        true,
        run.private_owner,
      );
      return true;
    }
    throw error;
  } finally {
    await db.tx(
      async (tx) => {
        await tx.query(
          "UPDATE seo_runs SET lease_token=NULL,lease_until=NULL,revision=revision+1 WHERE id=$1 AND lease_token=$2 AND invalidated_at IS NULL",
          [run.id, lease],
        );
      },
      undefined,
      true,
    );
  }
}
