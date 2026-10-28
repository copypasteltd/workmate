import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Database } from "./db.js";
import { audit, requireAdmin, requireUser } from "./auth.js";
import { key, replay } from "./access.js";
import { permit, requireSensitiveAdmin, scopePredicate } from "./admin-access.js";
import { DedicatedCloud } from "./dedicated-cloud.js";
import { dedicatedPlanInput, dedicatedNodeRegistration } from "./dedicated-cloud-model.js";
import { Problem, uuid } from "./lib.js";

const projectParams = z.object({ tenant: uuid, project: uuid });
const sessionParams = projectParams.extend({ session: uuid });
const nodeParams = z.object({ node: uuid });
const base = "/v1/tenants/:tenant/projects/:project/cloud-computers";
const infrastructure = "admin.cloud_runtime.infrastructure.write";
const bearer = (req: FastifyRequest) => {
  const value = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!value) throw new Problem(401, "NODE_AUTHENTICATION_REQUIRED", "Computer authentication required");
  return value;
};
export function registerDedicatedCloud(app: FastifyInstance, db: Database) {
  const service = new DedicatedCloud(db), user = { preHandler: requireUser(db) }, admin = { preHandler: requireAdmin(db) };
  app.get(base + "/plans", user, async req => {
    const p = projectParams.parse(req.params); return { items: await service.plans(req.principal, p.tenant, p.project) };
  });
  app.post(base + "/quotes", user, async (req, reply) => {
    const p = projectParams.parse(req.params); reply.header("Cache-Control", "no-store");
    return service.quote(req.principal, p.tenant, p.project, req.body, key(req));
  });
  app.post(base + "/sessions", user, async (req, reply) => {
    const p = projectParams.parse(req.params); reply.header("Cache-Control", "no-store");
    return service.activate(req.principal, p.tenant, p.project, req.body, key(req));
  });
  app.get(base + "/sessions", user, async (req, reply) => {
    const p = projectParams.parse(req.params); reply.header("Cache-Control", "no-store");
    return { items: await service.list(req.principal, p.tenant, p.project) };
  });
  app.get(base + "/sessions/:session", user, async (req, reply) => {
    const p = sessionParams.parse(req.params); reply.header("Cache-Control", "no-store");
    return service.read(req.principal, p.tenant, p.project, p.session);
  });
  app.post(base + "/sessions/:session/stop", user, async req => {
    const p = sessionParams.parse(req.params); z.object({}).strict().parse(req.body ?? {});
    return service.stop(req.principal, p.tenant, p.project, p.session);
  });
  app.post(base + "/sessions/:session/inputs", user, async req => {
    const p = sessionParams.parse(req.params); return service.input(req.principal, p.tenant, p.project, p.session, req.body, key(req));
  });
  app.get(base + "/sessions/:session/view", user, async (req, reply) => {
    const p = sessionParams.parse(req.params); reply.header("Cache-Control", "no-store");
    return service.view(req.principal, p.tenant, p.project, p.session);
  });
  const nodeOptions = { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } };
  app.post("/v1/cloud-runtime-nodes/:node/poll", nodeOptions, async (req, reply) => {
    const p = nodeParams.parse(req.params); reply.header("Cache-Control", "no-store");
    return service.poll(p.node, bearer(req), req.body);
  });
  app.post("/v1/cloud-runtime-nodes/:node/acknowledgements", nodeOptions, async req => {
    const p = nodeParams.parse(req.params); return service.acknowledge(p.node, bearer(req), req.body);
  });
  app.post("/v1/cloud-runtime-nodes/:node/frames", nodeOptions, async req => {
    const p = nodeParams.parse(req.params); return service.frame(p.node, bearer(req), req.body);
  });
  app.post("/v1/admin/cloud-computers/plans", admin, async req => {
    const b = z.object({ plan: dedicatedPlanInput, enabled: z.boolean(), expected_version: z.number().int().nonnegative() }).strict().parse(req.body);
    return db.tx(async tx => {
      await requireSensitiveAdmin(tx, req.principal); await permit(tx, req.principal, infrastructure);
      return replay(tx, req.principal.id, infrastructure + ":plan", key(req), b, async () => {
        const current = (await tx.query("SELECT version FROM cloud_runtime_plan_heads WHERE key=$1", [b.plan.key])).rows[0];
        if ((current?.version ?? 0) !== b.expected_version) throw new Problem(409, "VERSION_CONFLICT", "Refresh the current computer plan before publishing");
        const value = await service.publishPlan(tx, req.principal, b.plan, b.enabled);
        await audit(tx, req.principal, infrastructure, value.key, "succeeded", { version: value.version, enabled: value.enabled, reason: b.plan.reason });
        return value;
      });
    }, undefined, true, req.principal.id);
  });
  app.post("/v1/admin/cloud-computers/nodes", admin, async (req, reply) => {
    const b = dedicatedNodeRegistration.parse(req.body); reply.header("Cache-Control", "no-store");
    return db.tx(async tx => {
      await requireSensitiveAdmin(tx, req.principal); await permit(tx, req.principal, infrastructure);
      let enrolled: Awaited<ReturnType<typeof service.registerNode>> | undefined;
      const result = await replay(tx, req.principal.id, infrastructure + ":node", key(req), b, async () => {
        enrolled = await service.registerNode(tx, req.principal, b);
        await audit(tx, req.principal, infrastructure, enrolled.id, "succeeded", { plan_key: b.plan_key, reason: b.reason });
        // Never persist the enrollment credential in a saved HTTP response.
        return { id: enrolled.id, name: enrolled.name, plan_key: enrolled.plan_key, state: enrolled.state };
      });
      return enrolled ?? { ...result, token_is_shown_once: true, enrollment_token_unavailable_on_retry: true };
    }, undefined, true, req.principal.id);
  });
  app.get("/v1/admin/cloud-computers/nodes", admin, async req => db.tx(async tx => {
    await requireSensitiveAdmin(tx, req.principal); await permit(tx, req.principal, infrastructure);
    const items = (await tx.query("SELECT id,name,plan_key,machine_fingerprint,state,generation,last_heartbeat_at,version FROM cloud_runtime_nodes ORDER BY created_at DESC,id DESC LIMIT 100")).rows;
    await audit(tx, req.principal, infrastructure + ":read", undefined, "succeeded", { count: items.length });
    return { items };
  }, undefined, true, req.principal.id));
  app.get("/v1/admin/cloud-computers/sessions", admin, async req => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), cursor: uuid.optional() }).strict().parse(req.query);
    return db.tx(async tx => {
      await requireSensitiveAdmin(tx, req.principal);
      const access = await scopePredicate(tx, req.principal, "admin.cloud_runtime.sessions.read", "s.tenant_id", "s.project_id");
      const rows = (await tx.query(`SELECT s.id,s.tenant_id,s.project_id,s.private_owner,s.node_id,s.state,s.generation,s.version,
        s.confirmed_at,s.started_at,s.expires_at,s.stopped_at,s.cleanup_verified,s.charged_micros,q.maximum_cost_micros,h.state AS hold_state
        FROM cloud_runtime_sessions s JOIN cloud_runtime_quotes q ON q.id=s.quote_id LEFT JOIN cloud_runtime_holds h ON h.session_id=s.id
        WHERE ${access.sql} AND ($6::uuid IS NULL OR (s.confirmed_at,s.id)<(SELECT confirmed_at,id FROM cloud_runtime_sessions WHERE id=$6))
        ORDER BY s.confirmed_at DESC,s.id DESC LIMIT $7`, [...access.values, q.cursor ?? null, q.limit + 1])).rows;
      const items = rows.slice(0, q.limit);
      await audit(tx, req.principal, "admin.cloud_runtime.sessions.read", undefined, "succeeded", { count: items.length });
      return { items, next_cursor: rows.length > q.limit ? items.at(-1)!.id : null };
    }, undefined, true, req.principal.id);
  });
  return service;
}
