import {
  pngFromSVG,
  pdfFromSVG,
  motionFromSVG,
  designFormats,
} from "./render.js";
import { signCommand, commandPublicKey } from "./device-signing.js";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Database } from "./db.js";
import { requireUser, audit, type Principal } from "./auth.js";
import { key, projectAccess, replay, tenantAccess } from "./access.js";
import { hash, name, Problem, token, uuid } from "./lib.js";
import { registerConnections } from "./connectors.js";
import { Storage, saveAsset } from "./storage.js";
import type { Catalog } from "./catalog.js";
import { analyticsEvidence } from "./analytics.js";
import { enqueueTask } from "./task-service.js";
import { cancelWorkflowRun } from "./workflow-control.js";

const params = z.object({ tenant: uuid, project: uuid });
const color = z.string().regex(/^#[a-f\d]{6}$/i);
const layer = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("image"),
      asset_id: uuid,
      version: z.number().int().positive(),
      x: z.number().min(0).max(4096),
      y: z.number().min(0).max(4096),
      width: z.number().min(1).max(4096),
      height: z.number().min(1).max(4096),
    })
    .strict(),
  z.object({
    type: z.literal("text"),
    text: z.string().max(5000),
    x: z.number().min(0).max(4096),
    y: z.number().min(0).max(4096),
    font_size: z.number().min(8).max(600),
    color,
    font_family: z.enum(["sans", "serif", "mono"]).default("sans"),
    weight: z.enum(["normal", "bold"]).default("normal"),
  }),
  z.object({
    type: z.literal("rect"),
    x: z.number().min(0).max(4096),
    y: z.number().min(0).max(4096),
    width: z.number().min(1).max(4096),
    height: z.number().min(1).max(4096),
    color,
    radius: z.number().min(0).max(200).default(0),
  }),
]);
export const poster = z
  .object({
    width: z.number().int().min(256).max(4096),
    height: z.number().int().min(256).max(4096),
    background: color,
    layers: z.array(layer).max(100),
  })
  .strict();
const esc = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function renderPoster(
  body: unknown,
  images: Record<string, string> = {},
) {
  const b = poster.parse(body);
  const layers = b.layers
    .map((l) =>
      l.type === "image"
        ? `<image x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height}" preserveAspectRatio="xMidYMid meet" href="${
            images[l.asset_id + ":" + l.version] ??
            (() => {
              throw new Error(
                "Resolve authorized project images before rendering",
              );
            })()
          }"/>`
        : l.type === "rect"
          ? `<rect x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height}" rx="${l.radius}" fill="${l.color}"/>`
          : `<text x="${l.x}" y="${l.y}" font-size="${l.font_size}" fill="${l.color}" font-family="${l.font_family === "serif" ? "Georgia, serif" : l.font_family === "mono" ? "monospace" : "Microsoft JhengHei, Noto Sans TC, sans-serif"}" font-weight="${l.weight}">${esc(l.text)}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}"><rect width="100%" height="100%" fill="${b.background}"/>${layers}</svg>`;
}
export async function renderProjectPoster(
  tx: any,
  storage: Storage,
  project: string,
  body: unknown,
) {
  const parsed = poster.parse(body),
    images: Record<string, string> = {};
  for (const layer of parsed.layers)
    if (layer.type === "image") {
      const key = layer.asset_id + ":" + layer.version;
      if (images[key]) continue;
      const v = (
        await tx.query(
          "SELECT v.* FROM assets a JOIN asset_versions v ON v.asset_id=a.id WHERE a.id=$1 AND a.project_id=$2 AND a.state='active' AND v.version=$3 AND (a.private_owner IS NULL OR nullif(current_setting('app.task_id',true),'') IS NOT NULL)",
          [layer.asset_id, project, layer.version],
        )
      ).rows[0];
      if (!v || v.mime_type !== "image/png" || Number(v.bytes) > 8_000_000)
        throw new Problem(
          400,
          "IMAGE_SOURCE_INVALID",
          "Choose an authorized project PNG up to 8 MB",
        );
      const bytes = await storage.get(v.storage_key);
      if (
        bytes.length < 24 ||
        bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        bytes.readUInt32BE(16) > 4096 ||
        bytes.readUInt32BE(20) > 4096
      )
        throw new Problem(
          400,
          "IMAGE_SOURCE_INVALID",
          "PNG dimensions must be at most 4096 px",
        );
      images[key] = "data:image/png;base64," + bytes.toString("base64");
    }
  return renderPoster(parsed, images);
}
const step = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("analytics.summary"), dataset_id: uuid }),
  z.object({
    kind: z.literal("codex"),
    role_key: z.string().max(80),
    prompt: z.string().min(5).max(12000),
    budget_micros: z.number().int().positive().max(1e12),
  }),
  z.object({
    kind: z.literal("approval"),
    message: z.string().min(3).max(2000),
  }),
]);
export const workflow = z
  .object({ steps: z.array(step).min(1).max(8) })
  .strict();
export function registerBusiness(
  app: FastifyInstance,
  db: Database,
  storage: Storage,
  catalog: Catalog,
) {
  const base = "/v1/tenants/:tenant/projects/:project";
  app.get(base + "/creative", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      return {
        items: (
          await tx.query(
            "SELECT * FROM creative_projects WHERE project_id=$1 AND kind='poster' ORDER BY created_at DESC LIMIT 100",
            [project],
          )
        ).rows,
      };
    }, tenant);
  });
  app.post(base + "/creative", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    const b = z.object({ name, body: poster }).strict().parse(req.body);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project, "write");
      return (
        await tx.query(
          "INSERT INTO creative_projects(tenant_id,project_id,name,kind,body,created_by) VALUES($1,$2,$3,'poster',$4,$5) RETURNING *",
          [tenant, project, b.name, b.body, req.principal.id],
        )
      ).rows[0];
    }, tenant);
  });
  app.put(
    base + "/creative/:id",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, id } = params
        .extend({ id: uuid })
        .parse(req.params);
      const b = z
        .object({ name, body: poster, version: z.number().int().positive() })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "write");
        const r = (
          await tx.query(
            "UPDATE creative_projects SET name=$3,body=$4,version=version+1 WHERE id=$1 AND project_id=$2 AND version=$5 AND kind='poster' RETURNING *",
            [id, project, b.name, b.body, b.version],
          )
        ).rows[0];
        if (!r)
          throw new Problem(
            409,
            "VERSION_CONFLICT",
            "Creative project changed; refresh before saving",
          );
        return r;
      }, tenant);
    },
  );
  app.post(
    base + "/creative/:id/render",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, id } = params
        .extend({ id: uuid })
        .parse(req.params);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "write");
        return replay(
          tx,
          req.principal.id,
          `creative.render:${id}`,
          key(req),
          req.body ?? {},
          async () => {
            const p = (
              await tx.query(
                "SELECT * FROM creative_projects WHERE id=$1 AND project_id=$2 AND kind='poster'",
                [id, project],
              )
            ).rows[0];
            if (!p)
              throw new Problem(404, "NOT_FOUND", "Creative project not found");
            const output = z
              .object({
                format: z.enum(designFormats).default("svg"),
                expected_version: z.number().int().positive().optional(),
                duration: z.number().int().min(3).max(15).default(6),
                effect: z.enum(["fade", "zoom", "still"]).default("fade"),
              })
              .strict()
              .parse(req.body ?? {});
            if (
              output.expected_version !== undefined &&
              output.expected_version !== p.version
            )
              throw new Problem(
                409,
                "VERSION_CONFLICT",
                "Creative project changed; refresh before exporting",
              );
            const svg = await renderProjectPoster(tx, storage, project, p.body);
            let bytes: Buffer = Buffer.from(svg),
              mime = "image/svg+xml",
              probe: any = null;
            if (output.format === "png") {
              bytes = Buffer.from(pngFromSVG(svg));
              mime = "image/png";
            }
            if (output.format === "pdf") {
              const rendered = await pdfFromSVG(
                svg,
                p.body.width,
                p.body.height,
              );
              bytes = rendered.bytes;
              probe = rendered.probe;
              mime = "application/pdf";
            }
            if (output.format === "mp4") {
              const rendered = await motionFromSVG(
                svg,
                p.body.width,
                p.body.height,
                {
                  duration: output.duration,
                  effect: output.effect,
                  dataDir: db.config.DATA_DIR,
                },
              );
              bytes = rendered.bytes;
              probe = rendered.probe;
              mime = "video/mp4";
            }
            return saveAsset(tx, storage, {
              tenant,
              project,
              user: req.principal.id,
              name: `${p.name}-v${p.version}.${output.format}`,
              mime,
              bytes,
              kind:
                output.format === "svg"
                  ? "editable_design"
                  : output.format === "mp4"
                    ? "motion_creative"
                    : "rendered_design",
              metadata: {
                creative_project: id,
                version: p.version,
                source: p.body,
                render: output,
                probe,
              },
            });
          },
        );
      }, tenant);
    },
  );
  app.get(base + "/workflows", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      return {
        items: (
          await tx.query(
            "SELECT * FROM workflows WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100",
            [project],
          )
        ).rows,
        runs: (
          await tx.query(
            "SELECT * FROM workflow_runs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100",
            [project],
          )
        ).rows,
      };
    }, tenant);
  });
  app.post(
    base + "/workflows",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = params.parse(req.params);
      const b = z
        .object({ name, definition: workflow })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "manage");
        for (const s of b.definition.steps)
          if (s.kind === "codex") catalog.role(s.role_key);
        return (
          await tx.query(
            "INSERT INTO workflows(tenant_id,project_id,name,definition,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",
            [tenant, project, b.name, b.definition, req.principal.id],
          )
        ).rows[0];
      }, tenant);
    },
  );
  app.post(
    base + "/workflows/:id/publish",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, id } = params
        .extend({ id: uuid })
        .parse(req.params);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "manage");
        const w = (
          await tx.query(
            "SELECT * FROM workflows WHERE id=$1 AND project_id=$2 AND execution_location='cloud' FOR UPDATE",
            [id, project],
          )
        ).rows[0];
        if (!w) throw new Problem(404, "NOT_FOUND", "Workflow not found");
        workflow.parse(w.definition);
        await tx.query("UPDATE workflows SET state='published' WHERE id=$1", [
          id,
        ]);
        return { ok: true };
      }, tenant);
    },
  );
  app.post(
    base + "/workflows/:id/run",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, id } = params
        .extend({ id: uuid })
        .parse(req.params);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "write");
        return replay(
          tx,
          req.principal.id,
          `workflow.run:${id}`,
          key(req),
          {},
          async () => {
            const w = (
              await tx.query(
                "SELECT * FROM workflows WHERE id=$1 AND project_id=$2 AND state='published' AND execution_location='cloud'",
                [id, project],
              )
            ).rows[0];
            if (!w)
              throw new Problem(
                409,
                "WORKFLOW_NOT_PUBLISHED",
                "Publish the workflow before running it",
              );
            return (
              await tx.query(
                "INSERT INTO workflow_runs(tenant_id,project_id,workflow_id,created_by,actor_auth_version,definition) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
                [
                  tenant,
                  project,
                  id,
                  req.principal.id,
                  req.principal.authVersion,
                  w.definition,
                ],
              )
            ).rows[0];
          },
        );
      }, tenant);
    },
  );
  app.post(
    base + "/workflow-runs/:id/decision",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, id } = params
        .extend({ id: uuid })
        .parse(req.params);
      const b = z
        .object({ decision: z.enum(["approve", "cancel"]) })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "approve");
        const r = (
          await tx.query(
            "UPDATE workflow_runs SET state=$3,cursor=cursor+$4 WHERE id=$1 AND project_id=$2 AND state='awaiting_approval' AND execution_location='cloud' RETURNING *",
            [
              id,
              project,
              b.decision === "approve" ? "running" : "cancelled",
              b.decision === "approve" ? 1 : 0,
            ],
          )
        ).rows[0];
        if (!r)
          throw new Problem(
            409,
            "NOT_AWAITING_APPROVAL",
            "Run is not awaiting approval",
          );
        return r;
      }, tenant);
    },
  );
  app.post(
    base + "/workflow-runs/:id/cancel",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, id } = params
        .extend({ id: uuid })
        .parse(req.params);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "write");
        const run = (
          await tx.query(
            "SELECT * FROM workflow_runs WHERE id=$1 AND project_id=$2 FOR UPDATE",
            [id, project],
          )
        ).rows[0];
        if (!run) throw new Problem(404, "NOT_FOUND", "Workflow run not found");
        await cancelWorkflowRun(tx, run, req.principal);
        return { ok: true };
      }, tenant);
    },
  );
  registerDevices(app, db);
  registerConnections(app, db, storage);
  app.post(
    base + "/seo/audit",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = params.parse(req.params);
      const b = z
        .object({
          html: z.string().min(1).max(2_000_000),
          url: z.string().url(),
        })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "write");
        const html = b.html;
        const title =
          html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
        const descriptions = [...html.matchAll(/<meta\b[^>]*>/gi)].filter((m) =>
          /name\s*=\s*["']description["']/i.test(m[0]),
        );
        const headings = [
          ...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi),
        ].map((m) => m[1].replace(/<[^>]*>/g, ""));
        const canonicals = [...html.matchAll(/<link\b[^>]*>/gi)].filter((m) =>
          /rel\s*=\s*["']canonical["']/i.test(m[0]),
        );
        const structured = [
          ...html.matchAll(
            /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
          ),
        ];
        const checks = [
          {
            key: "title",
            pass: title.length >= 15 && title.length <= 80,
            evidence: title,
          },
          {
            key: "description",
            pass: descriptions.length === 1,
            evidence: descriptions.length,
          },
          { key: "single_h1", pass: headings.length === 1, evidence: headings },
          {
            key: "canonical",
            pass: canonicals.length === 1,
            evidence: canonicals.map((m) => m[0]),
          },
          {
            key: "structured_data",
            pass:
              structured.length > 0 &&
              structured.every((m) => {
                try {
                  JSON.parse(m[1]);
                  return true;
                } catch {
                  return false;
                }
              }),
            evidence: structured.length,
          },
        ];
        const result = {
          url: b.url,
          source: "user_supplied_html",
          source_sha256: hash(html),
          checks,
          geo: {
            status: "qualitative_review_required",
            note: "Structured data and clear source attribution support review; no search or answer-engine ranking is guaranteed.",
          },
        };
        return {
          report: result,
          asset: await saveAsset(tx, storage, {
            tenant,
            project,
            user: req.principal.id,
            name: "seo-audit.json",
            mime: "application/json",
            bytes: Buffer.from(JSON.stringify(result, null, 2)),
            kind: "seo_report",
          }),
        };
      }, tenant);
    },
  );
}
function registerDevices(app: FastifyInstance, db: Database) {
  app.get(
    "/v1/tenants/:tenant/devices",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = uuid.parse((req.params as any).tenant);
      return db.tx(async (tx) => {
        await tenantAccess(tx, req.principal, tenant);
        return {
          items: (
            await tx.query(
              "SELECT id,name,client,state,grants,last_seen_at,created_at FROM devices WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC",
              [tenant, req.principal.id],
            )
          ).rows,
        };
      }, tenant);
    },
  );
  app.post(
    "/v1/tenants/:tenant/devices",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = uuid.parse((req.params as any).tenant);
      const b = z
        .object({
          name,
          client: z.enum(["desktop", "extension"]),
          public_key: z.string().min(40).max(2000),
          grants: z
            .array(
              z
                .object({
                  id: uuid,
                  label: name,
                  operations: z
                    .array(z.enum(["file.list", "file.read", "file.write"]))
                    .min(1),
                  expires_at: z.string().datetime({ offset: true }),
                })
                .strict(),
            )
            .max(20),
        })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await tenantAccess(tx, req.principal, tenant, "write");
        if (req.principal.audience !== "native")
          throw new Problem(
            403,
            "DEVICE_CLIENT_REQUIRED",
            "Pair devices from the native client",
          );
        for (const g of b.grants)
          if (Date.parse(g.expires_at) <= Date.now())
            throw new Problem(
              400,
              "GRANT_EXPIRED",
              "Grant expiry must be in the future",
            );
        return (
          await tx.query(
            "INSERT INTO devices(tenant_id,user_id,name,client,public_key,grants,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,now()) RETURNING id,name,client,state,grants",
            [
              tenant,
              req.principal.id,
              b.name,
              b.client,
              b.public_key,
              JSON.stringify(b.grants),
            ],
          )
        ).rows[0];
      }, tenant);
    },
  );
  app.delete(
    "/v1/tenants/:tenant/devices/:id",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, id } = z
        .object({ tenant: uuid, id: uuid })
        .parse(req.params);
      return db.tx(async (tx) => {
        await tenantAccess(tx, req.principal, tenant);
        await tx.query(
          "UPDATE devices SET state='revoked',grants='[]' WHERE id=$1 AND user_id=$2",
          [id, req.principal.id],
        );
        await tx.query(
          "UPDATE device_commands SET state='cancelled' WHERE device_id=$1 AND state IN ('pending','claimed') AND EXISTS(SELECT 1 FROM devices WHERE id=$1 AND user_id=$2)",
          [id, req.principal.id],
        );
        return { ok: true };
      }, tenant);
    },
  );
  app.get(
    "/v1/tenants/:tenant/devices/:id/commands",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, id } = z
        .object({ tenant: uuid, id: uuid })
        .parse(req.params);
      return db.tx(async (tx) => {
        await tenantAccess(tx, req.principal, tenant);
        const d = (
          await tx.query(
            "SELECT * FROM devices WHERE id=$1 AND user_id=$2 AND state='active' FOR UPDATE",
            [id, req.principal.id],
          )
        ).rows[0];
        if (!d || req.principal.audience !== "native")
          throw new Problem(404, "NOT_FOUND", "Device not found");
        await tx.query(
          "UPDATE device_commands SET state='expired' WHERE device_id=$1 AND expires_at<=now() AND state='pending'",
          [id],
        );
        await tx.query("UPDATE devices SET last_seen_at=now() WHERE id=$1", [
          id,
        ]);
        return {
          public_key: commandPublicKey(db.config.MASTER_KEY!),
          items: (
            await tx.query(
              "UPDATE device_commands SET state='claimed' WHERE id IN (SELECT id FROM device_commands WHERE device_id=$1 AND state='pending' AND expires_at>now() ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING *",
              [id],
            )
          ).rows.map((c) => signCommand(db.config.MASTER_KEY!, c)),
        };
      }, tenant);
    },
  );
  app.post(
    "/v1/tenants/:tenant/devices/:id/commands",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, id } = z
        .object({ tenant: uuid, id: uuid })
        .parse(req.params);
      const b = z
        .object({
          operation: z.enum(["file.list", "file.read", "file.write"]),
          grant_id: uuid,
          path: z.string().min(1).max(1000),
          content: z.string().max(2_000_000).optional(),
          task_id: uuid.optional(),
        })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await tenantAccess(tx, req.principal, tenant, "write");
        const d = (
          await tx.query(
            "SELECT * FROM devices WHERE id=$1 AND user_id=$2 AND state='active'",
            [id, req.principal.id],
          )
        ).rows[0];
        if (!d) throw new Problem(404, "NOT_FOUND", "Device not found");
        const grant = d.grants.find(
          (g: any) =>
            g.id === b.grant_id &&
            g.operations.includes(b.operation) &&
            Date.parse(g.expires_at) > Date.now(),
        );
        if (!grant)
          throw new Problem(
            403,
            "GRANT_DENIED",
            "Device grant does not allow this action",
          );
        if (b.task_id) {
          const t = (
            await tx.query("SELECT project_id FROM tasks WHERE id=$1", [
              b.task_id,
            ])
          ).rows[0];
          if (!t) throw new Problem(404, "NOT_FOUND", "Task not found");
          await projectAccess(tx, req.principal, tenant, t.project_id, "write");
        }
        return replay(
          tx,
          req.principal.id,
          `device.command:${id}`,
          key(req),
          b,
          async () =>
            (
              await tx.query(
                "INSERT INTO device_commands(tenant_id,device_id,task_id,operation,payload,nonce,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '2 minutes') RETURNING *",
                [tenant, id, b.task_id ?? null, b.operation, b, token()],
              )
            ).rows[0],
        );
      }, tenant);
    },
  );
  app.get(
    "/v1/tenants/:tenant/devices/:id/commands/:command",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, id, command } = z
        .object({ tenant: uuid, id: uuid, command: uuid })
        .parse(req.params);
      return db.tx(async (tx) => {
        await tenantAccess(tx, req.principal, tenant);
        const r = (
          await tx.query(
            "SELECT c.id,c.device_id,c.operation,c.state,c.result,c.expires_at,c.created_at FROM device_commands c JOIN devices d ON d.id=c.device_id WHERE c.id=$1 AND c.device_id=$2 AND d.user_id=$3",
            [command, id, req.principal.id],
          )
        ).rows[0];
        if (!r) throw new Problem(404, "NOT_FOUND", "Command not found");
        return r;
      }, tenant);
    },
  );
  app.post(
    "/v1/tenants/:tenant/devices/:id/commands/:command/result",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, id, command } = z
        .object({ tenant: uuid, id: uuid, command: uuid })
        .parse(req.params);
      const b = z
        .object({
          nonce: z.string().min(40).max(100),
          state: z.enum(["succeeded", "failed"]),
          result: z.record(z.string(), z.unknown()),
        })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await tenantAccess(tx, req.principal, tenant);
        if (
          req.principal.audience !== "native" ||
          !(
            await tx.query(
              "SELECT 1 FROM devices WHERE id=$1 AND user_id=$2 AND state='active'",
              [id, req.principal.id],
            )
          ).rowCount
        )
          throw new Problem(404, "NOT_FOUND", "Device not found");
        const r = (
          await tx.query(
            "UPDATE device_commands SET state=$4,result=$5 WHERE id=$1 AND device_id=$2 AND nonce=$3 AND state='claimed' AND expires_at>now() RETURNING id",
            [command, id, b.nonce, b.state, b.result],
          )
        ).rows[0];
        if (!r)
          throw new Problem(
            409,
            "COMMAND_EXPIRED",
            "Command expired, revoked or already completed",
          );
        return { ok: true };
      }, tenant);
    },
  );
}
export async function advanceWorkflows(
  db: Database,
  catalog: Catalog,
  storage: Storage,
) {
  const candidates = (
    await db.control.query(
      "SELECT id,tenant_id FROM workflow_runs WHERE state='running' AND execution_location='cloud' ORDER BY created_at LIMIT 20",
    )
  ).rows;
  for (const run of candidates)
    await db
      .tx(async (tx) => {
        const r = (
          await tx.query(
            "SELECT * FROM workflow_runs WHERE id=$1 AND state='running' AND execution_location='cloud' FOR UPDATE SKIP LOCKED",
            [run.id],
          )
        ).rows[0];
        if (!r) return;
        const u = (
          await tx.query("SELECT * FROM users WHERE id=$1", [r.created_by])
        ).rows[0];
        const p: Principal = {
          id: u.id,
          email: u.email,
          name: u.name,
          audience: "user",
          sessionId: "",
          sessionHash: "",
          authVersion: r.actor_auth_version,
        };
        try {
          await projectAccess(tx, p, r.tenant_id, r.project_id, "write");
        } catch {
          await cancelWorkflowRun(tx, r, p, "AUTHORIZATION_CHANGED");
          return;
        }
        if (
          !(
            await tx.query(
              "SELECT 1 FROM workflows WHERE id=$1 AND content_state='active' AND state='published'",
              [r.workflow_id],
            )
          ).rowCount
        ) {
          await cancelWorkflowRun(tx, r, p, "WORKFLOW_UNAVAILABLE");
          return;
        }
        let cursor = r.cursor,
          results = r.results;
        if (r.active_task) {
          const t = (
            await tx.query("SELECT id,status FROM tasks WHERE id=$1", [
              r.active_task,
            ])
          ).rows[0];
          if (
            [
              "queued",
              "running",
              "awaiting_approval",
              "paused",
              "needs_input",
            ].includes(t?.status)
          )
            return;
          if (t?.status !== "succeeded") {
            await tx.query(
              "UPDATE workflow_runs SET state='failed',error_code=$2 WHERE id=$1",
              [r.id, t?.status ?? "TASK_MISSING"],
            );
            return;
          }
          results = [...results, { task_id: t.id, status: t.status }];
          cursor++;
          await tx.query(
            "UPDATE workflow_runs SET active_task=NULL,cursor=$2,results=$3 WHERE id=$1",
            [r.id, cursor, JSON.stringify(results)],
          );
        }
        const definition = workflow.parse(r.definition),
          s = definition.steps[cursor];
        if (!s) {
          await tx.query(
            "UPDATE workflow_runs SET state='succeeded' WHERE id=$1",
            [r.id],
          );
          return;
        }
        if (s.kind === "approval") {
          await tx.query(
            "UPDATE workflow_runs SET state='awaiting_approval' WHERE id=$1",
            [r.id],
          );
          return;
        }
        if (s.kind === "analytics.summary") {
          const d = (
            await tx.query(
              "SELECT * FROM analytics_datasets WHERE id=$1 AND project_id=$2",
              [s.dataset_id, r.project_id],
            )
          ).rows[0];
          if (!d) {
            await tx.query(
              "UPDATE workflow_runs SET state='failed',error_code='DATASET_NOT_FOUND' WHERE id=$1",
              [r.id],
            );
            return;
          }
          const a = await saveAsset(tx, storage, {
            tenant: r.tenant_id,
            project: r.project_id,
            user: p.id,
            name: `${d.name}-summary.json`,
            mime: "application/json",
            bytes: Buffer.from(
              JSON.stringify(
                {
                  currency: d.currency,
                  timezone: d.timezone,
                  snapshot_id: d.id,
                  metrics: analyticsEvidence(d),
                },
                null,
                2,
              ),
            ),
            kind: "analytics_report",
          });
          await tx.query(
            "UPDATE workflow_runs SET cursor=cursor+1,results=$2 WHERE id=$1",
            [
              r.id,
              JSON.stringify([
                ...results,
                { asset_id: a.id, status: "succeeded" },
              ]),
            ],
          );
          return;
        }
        await catalog.ensureEnabled(tx, s.role_key);
        const role = catalog.role(s.role_key);
        if (
          r.role_hashes[s.role_key] &&
          r.role_hashes[s.role_key] !== catalog.digest(role)
        ) {
          await tx.query(
            "UPDATE workflow_runs SET state='failed',error_code='ROLE_VERSION_CHANGED' WHERE id=$1",
            [r.id],
          );
          return;
        }
        if (!(await catalog.availableFor(tx, db.config, role)).available) {
          await tx.query(
            "UPDATE workflow_runs SET state='failed',error_code='AI_SETUP_REQUIRED' WHERE id=$1",
            [r.id],
          );
          return;
        }
        const t = await enqueueTask(
          tx,
          db,
          catalog,
          p,
          r.tenant_id,
          r.project_id,
          {
            title: `Workflow step ${cursor + 1}`,
            prompt: s.prompt,
            role_key: s.role_key,
            budget_micros: s.budget_micros,
          },
          `workflow:${r.id}:${cursor}`,
        );
        await tx.query("UPDATE workflow_runs SET active_task=$2 WHERE id=$1", [
          r.id,
          t.id,
        ]);
      }, run.tenant_id)
      .catch(async () => {
        await db.control.query(
          "UPDATE workflow_runs SET state='failed',error_code='STEP_FAILED' WHERE id=$1 AND state='running'",
          [run.id],
        );
      });
}
