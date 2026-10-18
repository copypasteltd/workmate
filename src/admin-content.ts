import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import type { Storage } from "./storage.js";
import { requireAdmin, audit } from "./auth.js";
import { permit } from "./admin-access.js";
import { Problem, uuid, name } from "./lib.js";
import { eraseReplayContent, key, replay } from "./access.js";
import { settle } from "./billing.js";
import { eraseConversation } from "./persistent-work.js";
const tables = [
  "assets",
  "tasks",
  "brand_profiles",
  "analytics_datasets",
  "workflows",
  "workflow_runs",
  "creative_projects",
  "agents",
  "conversations",
  "memories",
] as const;
async function find(tx: Tx, id: string) {
  for (const table of tables) {
    const r = (
      await tx.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [id])
    ).rows[0];
    if (r) return { table, row: r };
  }
  throw new Problem(404, "NOT_FOUND", "Content not found");
}
export const contentUnion = tables
  .map(
    (t) =>
      `SELECT id,tenant_id,project_id,${t === "tasks" ? "title" : t === "workflow_runs" ? "'Workflow run'" : "name"} AS name,'${t}' AS kind,${t === "assets" ? "state" : "content_state"} AS state,moderation_version AS version,created_at FROM ${t}`,
  )
  .join(" UNION ALL ");
export function registerAdminContent(
  app: FastifyInstance,
  db: Database,
  storage: Storage,
) {
  app.get(
    "/v1/admin/content/:id/body",
    { preHandler: requireAdmin(db) },
    async (req) =>
      db.tx(
        async (tx) => {
          const { table, row: r } = await find(
            tx,
            uuid.parse((req.params as any).id),
          );
          await permit(tx, req.principal, "admin.content.body.read", {
            tenant: r.tenant_id,
            project: r.project_id,
          });
          await audit(
            tx,
            req.principal,
            "admin.content.body.read",
            r.id,
            "succeeded",
            {},
            r.tenant_id,
          );
          if (table === "assets") {
            const v = (
              await tx.query(
                "SELECT * FROM asset_versions WHERE asset_id=$1 AND version=$2",
                [r.id, r.current_version],
              )
            ).rows[0];
            return {
              id: r.id,
              name: r.name,
              mime_type: v.mime_type,
              bytes: v.bytes,
              text:
                /^(text\/|application\/json)/.test(v.mime_type) &&
                Number(v.bytes) <= 2_000_000
                  ? (await storage.get(v.storage_key)).toString("utf8")
                  : null,
            };
          }
          if (
            table === "agents" ||
            table === "memories" ||
            table === "conversations"
          ) {
            const body =
              table === "agents"
                ? (
                    await tx.query(
                      "SELECT version,body FROM agent_versions WHERE agent_id=$1 ORDER BY version DESC LIMIT 200",
                      [r.id],
                    )
                  ).rows
                : table === "memories"
                  ? (
                      await tx.query(
                        "SELECT version,content FROM memory_versions WHERE memory_id=$1 ORDER BY version DESC LIMIT 200",
                        [r.id],
                      )
                    ).rows
                  : (
                      await tx.query(
                        "SELECT role,intent,body,task_id,created_at FROM conversation_messages WHERE conversation_id=$1 ORDER BY created_at,id LIMIT 200",
                        [r.id],
                      )
                    ).rows;
            return {
              id: r.id,
              name: r.name,
              mime_type: "application/json",
              text: JSON.stringify(body, null, 2),
            };
          }
          const body =
            table === "tasks"
              ? {
                  title: r.title,
                  prompt: r.prompt,
                  output: r.output,
                  status: r.status,
                }
              : table === "analytics_datasets"
                ? { currency: r.currency, timezone: r.timezone, rows: r.rows }
                : table === "workflows"
                  ? r.definition
                  : table === "workflow_runs"
                    ? {
                        definition: r.definition,
                        results: r.results,
                        state: r.state,
                      }
                    : r.body;
          return {
            id: r.id,
            name: r.name ?? r.title ?? table,
            mime_type: "application/json",
            text: JSON.stringify(body, null, 2),
          };
        },
        undefined,
        true,
      ),
  );
  app.post(
    "/v1/admin/content/:id/action",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id);
      const b = z
        .object({
          action: z.enum(["quarantine", "restore", "delete", "metadata"]),
          name: name.optional(),
          version: z.number().int().positive(),
          reason: z.string().trim().min(3).max(2000),
        })
        .strict()
        .parse(req.body);
      return db.tx(
        (tx) =>
          replay(
            tx,
            req.principal.id,
            "admin.content.action",
            key(req),
            { id, ...b },
            async () => {
              const { table, row: r } = await find(tx, id);
              await permit(
                tx,
                req.principal,
                b.action === "metadata"
                  ? "admin.content.metadata.write"
                  : `admin.content.${b.action}`,
                { tenant: r.tenant_id, project: r.project_id },
              );
              const state = table === "assets" ? "state" : "content_state",
                version = "moderation_version";
              if (r[version] !== b.version)
                throw new Problem(
                  409,
                  "VERSION_CONFLICT",
                  "Content changed; refresh first",
                );
              if (b.action === "metadata") {
                if (table === "agents")
                  throw new Problem(
                    400,
                    "AGENT_VERSION_REQUIRED",
                    "Specialist names and instructions change through a new specialist version",
                  );
                if (!b.name || table === "workflow_runs")
                  throw new Problem(
                    400,
                    "NAME_REQUIRED",
                    "A content name is required",
                  );
                await tx.query(
                  `UPDATE ${table} SET ${table === "tasks" ? "title" : "name"}=$2,moderation_version=moderation_version+1 WHERE id=$1`,
                  [id, b.name],
                );
              } else {
                if (b.action === "restore" && r.content_state === "deleted")
                  throw new Problem(
                    409,
                    "CONTENT_DELETED",
                    "Deleted private content cannot be restored",
                  );
                if (b.action === "delete" && table === "conversations") {
                  await eraseConversation(tx, req.principal, r);
                }
                if (b.action === "delete" && table === "memories") {
                  await eraseReplayContent(tx, [id]);
                  await tx.query(
                    "UPDATE memory_versions SET content=NULL WHERE memory_id=$1",
                    [id],
                  );
                }
                await tx.query(
                  `UPDATE ${table} SET ${state}=$2,moderation_version=moderation_version+1 WHERE id=$1`,
                  [
                    id,
                    b.action === "restore"
                      ? "active"
                      : b.action === "delete"
                        ? "deleted"
                        : "quarantined",
                  ],
                );
                if (b.action !== "restore") {
                  if (table === "assets")
                    await tx.query(
                      "UPDATE shares SET revoked_at=now() WHERE asset_id=$1 AND revoked_at IS NULL",
                      [id],
                    );
                  if (table === "tasks") {
                    if (r.status === "running")
                      await tx.query(
                        "UPDATE tasks SET cancel_requested=true,version=version+1 WHERE id=$1",
                        [id],
                      );
                    else if (
                      ["queued", "paused", "awaiting_approval"].includes(
                        r.status,
                      )
                    ) {
                      await settle(tx, r.tenant_id, id, 0, r.created_by);
                      await tx.query(
                        "UPDATE tasks SET status='cancelled',version=version+1 WHERE id=$1",
                        [id],
                      );
                    }
                  }
                  if (table === "workflows")
                    await tx.query(
                      "UPDATE workflow_runs SET state='cancelled' WHERE workflow_id=$1 AND state IN ('running','awaiting_approval')",
                      [id],
                    );
                }
              }
              await audit(
                tx,
                req.principal,
                `admin.content.${b.action}`,
                id,
                "succeeded",
                { reason: b.reason, kind: table },
                r.tenant_id,
              );
              return { ok: true };
            },
          ),
        undefined,
        true,
      );
    },
  );
}
