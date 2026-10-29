import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Database } from "./db.js";
import { audit, requireAdmin, requireUser } from "./auth.js";
import { key, replay } from "./access.js";
import { permit, requireSensitiveAdmin, scopePredicate } from "./admin-access.js";
import { DedicatedCloud } from "./dedicated-cloud.js";
import { dedicatedPlanInput, dedicatedNodeRegistration } from "./dedicated-cloud-model.js";
import { Problem, uuid } from "./lib.js";
import type { Storage } from "./storage.js";
import type { Catalog } from "./catalog.js";

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
export function registerDedicatedCloud(app: FastifyInstance, db: Database, storage: Storage, catalog: Catalog) {
  const service = new DedicatedCloud(db, storage), user = { preHandler: requireUser(db) }, admin = { preHandler: requireAdmin(db) };
  app.get(base + "/plans", user, async req => {
    const p = projectParams.parse(req.params); return { items: await service.plans(req.principal, p.tenant, p.project) };
  });
  app.get(base + "/source-files", user, async (req, reply) => {
    const p = projectParams.parse(req.params), q = z.object({limit:z.coerce.number().int().min(1).max(100).default(20),cursor:uuid.optional()}).strict().parse(req.query);
    reply.header("Cache-Control", "no-store");
    return service.sources(req.principal, p.tenant, p.project, q.limit, q.cursor);
  });
  app.post(base + "/quotes", user, async (req, reply) => {
    const p = projectParams.parse(req.params); reply.header("Cache-Control", "no-store");
    return service.quote(req.principal, p.tenant, p.project, req.body, key(req));
  });
  app.delete(base + "/quotes/:quote", user, async req => {
    const p = projectParams.extend({quote:uuid}).parse(req.params);
    return service.remove(req.principal, p.tenant, p.project, p.quote, true);
  });
  app.post(base + "/sessions", user, async (req, reply) => {
    const p = projectParams.parse(req.params); reply.header("Cache-Control", "no-store");
    return service.activate(req.principal, p.tenant, p.project, req.body, key(req));
  });
  app.get(base + "/sessions", user, async (req, reply) => {
    const p = projectParams.parse(req.params); reply.header("Cache-Control", "no-store");
    const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), cursor: uuid.optional() }).strict().parse(req.query);
    return service.list(req.principal, p.tenant, p.project, q.limit, q.cursor);
  });
  app.get(base + "/sessions/:session", user, async (req, reply) => {
    const p = sessionParams.parse(req.params); reply.header("Cache-Control", "no-store");
    return service.read(req.principal, p.tenant, p.project, p.session);
  });
  app.delete(base + "/sessions/:session", user, async req => {
    const p = sessionParams.parse(req.params);
    return service.remove(req.principal, p.tenant, p.project, p.session);
  });
  app.post(base + "/sessions/:session/stop", user, async req => {
    const p = sessionParams.parse(req.params); z.object({}).strict().parse(req.body ?? {});
    return service.stop(req.principal, p.tenant, p.project, p.session);
  });
  app.post(base + "/sessions/:session/inputs", user, async req => {
    const p = sessionParams.parse(req.params); return service.input(req.principal, p.tenant, p.project, p.session, req.body, key(req));
  });
  app.post(base + "/sessions/:session/agent-tasks", user, async (req, reply) => {
    const p = sessionParams.parse(req.params); reply.header("Cache-Control", "no-store");
    return service.createAgentTask(catalog, req.principal, p.tenant, p.project, p.session, req.body, key(req));
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
  app.get("/v1/cloud-runtime-nodes/:node/sessions/:session/files/:version", nodeOptions, async (req, reply) => {
    const p = nodeParams.extend({ session: uuid, version: uuid }).parse(req.params);
    const q = z.object({ generation: z.coerce.number().int().positive(), instance_id: uuid }).strict().parse(req.query);
    reply.header("Cache-Control", "no-store");
    return service.sourceFile(p.node, bearer(req), p.session, q.generation, q.instance_id, p.version);
  });
  app.post("/v1/admin/cloud-computers/plans", admin, async req => {
    const b = z.object({ plan: dedicatedPlanInput, enabled: z.boolean(), expected_version: z.number().int().nonnegative() }).strict().parse(req.body);
    return db.tx(async tx => {
      await requireSensitiveAdmin(tx, req.principal); await permit(tx, req.principal, infrastructure);
      return replay(tx, req.principal.id, infrastructure + ":plan", key(req), b, async () => {
        const value = await service.publishPlan(tx, req.principal, b.plan, b.enabled, b.expected_version);
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
  app.post("/v1/admin/cloud-computers/nodes/:node/rotate-credential", admin, async (req, reply) => {
    const p = nodeParams.parse(req.params), b = z.object({ expected_version: z.number().int().positive(), reason: z.string().trim().min(8).max(500) }).strict().parse(req.body);
    reply.header("Cache-Control", "no-store");
    return db.tx(async tx => {
      await requireSensitiveAdmin(tx, req.principal); await permit(tx, req.principal, infrastructure);
      let rotated: Awaited<ReturnType<typeof service.rotateNode>> | undefined;
      const result = await replay(tx, req.principal.id, infrastructure + ":rotate:" + p.node, key(req), b, async () => {
        rotated = await service.rotateNode(tx, p.node, b.expected_version);
        await audit(tx, req.principal, infrastructure + ":rotate", p.node, "succeeded", { reason: b.reason, version: rotated.version });
        return { id: rotated.id, state: rotated.state, version: rotated.version };
      });
      return rotated ?? {...result,token_is_shown_once:true,enrollment_token_unavailable_on_retry:true};
    }, undefined, true, req.principal.id);
  });
  for (const action of ["stop", "reconciliation"] as const) app.post("/v1/admin/cloud-computers/sessions/:session/" + action, admin, async req => {
    const p = z.object({session:uuid}).parse(req.params), b = z.object({expected_version:z.number().int().positive(),reason:z.string().trim().min(8).max(500)}).strict().parse(req.body);
    return db.tx(async tx => {
      await requireSensitiveAdmin(tx, req.principal);
      const permission = action === "stop" ? "admin.cloud_runtime.sessions.stop" : "admin.cloud_runtime.sessions.reconcile";
      const s = (await tx.query("SELECT tenant_id,project_id FROM cloud_runtime_sessions WHERE id=$1", [p.session])).rows[0];
      if (!s) throw new Problem(404, "NOT_FOUND", "Computer session not found");
      await permit(tx, req.principal, permission, {tenant:s.tenant_id,project:s.project_id});
      return replay(tx, req.principal.id, permission + ":" + p.session, key(req), b, async () => {
        const result = await service.adminStop(tx, req.principal, p.session, b.expected_version, b.reason, action === "reconciliation");
        await audit(tx, req.principal, permission, p.session, "succeeded", {reason:b.reason,hold_retained:true});
        return result;
      });
    }, undefined, true, req.principal.id);
  });
  app.get("/v1/admin/cloud-computers/nodes", admin, async req => db.tx(async tx => {
    const q = z.object({limit:z.coerce.number().int().min(1).max(100).default(30),cursor:uuid.optional()}).strict().parse(req.query);
    await requireSensitiveAdmin(tx, req.principal); await permit(tx, req.principal, infrastructure);
    if (q.cursor && !(await tx.query("SELECT 1 FROM cloud_runtime_nodes WHERE id=$1", [q.cursor])).rowCount) throw new Problem(404, "NOT_FOUND", "Computer cursor not found");
    const rows = (await tx.query(`SELECT id,name,plan_key,machine_fingerprint,state,generation,last_heartbeat_at,version FROM cloud_runtime_nodes
      WHERE ($1::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM cloud_runtime_nodes WHERE id=$1))
      ORDER BY created_at DESC,id DESC LIMIT $2`, [q.cursor ?? null, q.limit + 1])).rows;
    const items = rows.slice(0, q.limit);
    await audit(tx, req.principal, infrastructure + ":read", undefined, "succeeded", { count: items.length });
    return { items, next_cursor: rows.length > q.limit ? items.at(-1)!.id : null };
  }, undefined, true, req.principal.id));
  app.get("/v1/admin/cloud-computers/plans", admin, async req => db.tx(async tx => {
    const q = z.object({limit:z.coerce.number().int().min(1).max(100).default(30),cursor:z.string().regex(/^[a-z][a-z0-9-]{2,63}$/).optional()}).strict().parse(req.query);
    await requireSensitiveAdmin(tx, req.principal); await permit(tx, req.principal, infrastructure);
    if (q.cursor && !(await tx.query("SELECT 1 FROM cloud_runtime_plan_heads WHERE key=$1", [q.cursor])).rowCount) throw new Problem(404, "NOT_FOUND", "Plan cursor not found");
    const rows = (await tx.query(`SELECT p.key,p.version,p.body,p.data_mode,h.enabled,p.created_at FROM cloud_runtime_plan_heads h
      JOIN cloud_runtime_plans p ON p.key=h.key AND p.version=h.version WHERE ($1::text IS NULL OR p.key>$1) ORDER BY p.key LIMIT $2`, [q.cursor ?? null, q.limit + 1])).rows;
    const items = rows.slice(0, q.limit);
    await audit(tx, req.principal, infrastructure + ":plans.read", undefined, "succeeded", {count:items.length});
    return {items,next_cursor:rows.length>q.limit?items.at(-1)!.key:null};
  }, undefined, true, req.principal.id));
  app.get("/v1/admin/cloud-computers/sessions", admin, async req => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), cursor: uuid.optional() }).strict().parse(req.query);
    return db.tx(async tx => {
      await requireSensitiveAdmin(tx, req.principal);
      const access = await scopePredicate(tx, req.principal, "admin.cloud_runtime.sessions.read", "s.tenant_id", "s.project_id");
      if (q.cursor && !(await tx.query(`SELECT 1 FROM cloud_runtime_sessions s WHERE s.id=$6 AND ${access.sql}`, [...access.values, q.cursor])).rowCount)
        throw new Problem(404, "NOT_FOUND", "Computer session cursor is unavailable");
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
