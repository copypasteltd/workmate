import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import type { Storage } from "./storage.js";
import { requireAdmin, audit } from "./auth.js";
import { permit } from "./admin-access.js";
import { Problem, uuid, name } from "./lib.js";
import { eraseReplayContent, key, replay } from "./access.js";
import { settleIdleTask } from "./paid-task-inputs.js";
import { eraseConversation } from "./persistent-work.js";
import { eraseSchedule } from "./schedules.js";
import { cancelWorkflowRun } from "./workflow-control.js";
import { eraseWorkspaceNode } from "./cloud-files.js";
import { matrixContentBody } from "./creative-matrices.js";
import { videoContentBody } from "./video-projects.js";
import { stopAgentGroupRun } from "./agent-groups.js";
import { registerAdminContentHistory } from "./admin-content-history.js";
const tables = [
  "assets",
  "tasks",
  "brand_profiles",
  "analytics_datasets",
  "creative_mappings",
  "creative_feedback_reports",
  "geo_experiments",
  "geo_runs",
  "geo_samples",
  "workflows",
  "workflow_runs",
  "workflow_schedules",
  "creative_projects",
  "agents",
  "conversations",
  "memories",
  "workspace_nodes",
  "project_configurations",
  "agent_groups",
  "agent_group_runs",
] as const;
async function find(tx: Tx, id: string) {
  for (const table of tables) {
    const r = (
      await tx.query(
        `SELECT * FROM ${table} WHERE id=$1${["workspace_nodes", "creative_mappings", "creative_feedback_reports"].includes(table) ? "" : " FOR UPDATE"}`,
        [id],
      )
    ).rows[0];
    if (r) {
      if (["creative_mappings", "creative_feedback_reports"].includes(table)) {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "creative-feedback:" + r.project_id,
        ]);
        return {
          table,
          row: (
            await tx.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [
              id,
            ])
          ).rows[0],
        };
      }
      if (table === "workspace_nodes") {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "cloudtree:" + r.project_id,
        ]);
        return {
          table,
          row: (
            await tx.query(
              "SELECT * FROM workspace_nodes WHERE id=$1 FOR UPDATE",
              [id],
            )
          ).rows[0],
        };
      }
      return { table, row: r };
    }
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
  registerAdminContentHistory(app, db);
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
          if (r[table === "assets" ? "state" : "content_state"] === "deleted")
            throw new Problem(
              410,
              "CONTENT_DELETED",
              "Deleted content is unavailable",
            );
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
                      "SELECT version,body FROM agent_versions WHERE agent_id=$1 ORDER BY version DESC LIMIT 201",
                      [r.id],
                    )
                  ).rows
                : table === "memories"
                  ? (
                      await tx.query(
                        "SELECT version,content FROM memory_versions WHERE memory_id=$1 ORDER BY version DESC LIMIT 201",
                        [r.id],
                      )
                    ).rows
                  : (
                      await tx.query(
                        "SELECT id,role,intent,CASE WHEN role='assistant' AND task_id IS NOT NULL AND content_source_manifest($2::uuid,$3::uuid,ARRAY[task_id],'{}'::uuid[]) IS NULL THEN NULL ELSE body END AS body,task_id,created_at FROM conversation_messages WHERE conversation_id=$1 AND tenant_id=$2 AND project_id=$3 ORDER BY created_at,id LIMIT 201",
                        [r.id, r.tenant_id, r.project_id],
                      )
                    ).rows;
            return {
              id: r.id,
              name: r.name,
              mime_type: "application/json",
              text: JSON.stringify(body.slice(0, 200), null, 2),
              truncated: body.length > 200,
              history_url: `/v1/admin/content/${table}/${r.id}/history`,
            };
          }
          const body =
            table === "agent_groups"
              ? {
                  version: r.version,
                  state: r.state,
                  versions: (
                    await tx.query(
                      "SELECT version,body,sha256,created_at FROM agent_group_versions WHERE group_id=$1 AND erased_at IS NULL ORDER BY version DESC LIMIT 100",
                      [r.id],
                    )
                  ).rows,
                }
              : table === "agent_group_runs"
                ? {
                    state: r.state,
                    revision: r.revision,
                    definition: r.definition,
                    definition_hash: r.definition_hash,
                    approved_budget_micros: r.approved_budget_micros,
                    coordinator_task_id: r.coordinator_task_id,
                    nodes: (
                      await tx.query(
                        "SELECT step_key,position,task_id,state,error_code FROM agent_group_nodes WHERE run_id=$1 ORDER BY position",
                        [r.id],
                      )
                    ).rows,
                  }
                : table === "project_configurations"
                  ? {
                      draft: r.draft,
                      revision: r.version,
                      current_version: r.current_version,
                      versions: (
                        await tx.query(
                          "SELECT version,body,sha256,created_at FROM project_configuration_versions WHERE configuration_id=$1 AND erased_at IS NULL ORDER BY version DESC LIMIT 100",
                          [r.id],
                        )
                      ).rows,
                    }
                  : table === "geo_samples"
                    ? {
                        question: r.body.question,
                        run_id: r.run_id,
                        task_id: r.task_id,
                        asset_version_id: r.asset_version_id,
                        answer_sha256: r.answer_sha256,
                        observed_at: r.observed_at,
                        captured_at: r.captured_at,
                        analysis: r.analysis,
                      }
                    : table === "geo_runs"
                      ? {
                          ...r.body,
                          experiment_id: r.experiment_id,
                          surface: r.surface,
                          config_hash: r.config_hash,
                        }
                      : table === "brand_profiles"
                        ? {
                            current_version: r.version,
                            versions: (
                              await tx.query(
                                "SELECT version,name,body,sha256,created_at,created_by FROM brand_profile_versions WHERE brand_id=$1 AND erased_at IS NULL ORDER BY version DESC LIMIT 100",
                                [r.id],
                              )
                            ).rows,
                          }
                        : table === "creative_projects" &&
                            r.kind === "creative_matrix"
                          ? await matrixContentBody(tx, r)
                          : table === "creative_projects" && r.kind === "video"
                            ? await videoContentBody(tx, r)
                            : table === "workflow_schedules"
                              ? (
                                  await tx.query(
                                    "SELECT revision,body,created_at FROM workflow_schedule_versions WHERE schedule_id=$1 ORDER BY revision DESC LIMIT 100",
                                    [r.id],
                                  )
                                ).rows
                              : table === "tasks"
                                ? {
                                    title: r.title,
                                    prompt: r.prompt,
                                    output: r.output,
                                    status: r.status,
                                    dependencies: (
                                      await tx.query(
                                        "SELECT id,step_key,kind,description,required_scope,provider,state,resource_ids,version FROM task_dependencies WHERE task_id=$1 ORDER BY step_key",
                                        [r.id],
                                      )
                                    ).rows,
                                  }
                                : table === "analytics_datasets"
                                  ? {
                                      currency: r.currency,
                                      timezone: r.timezone,
                                      rows: r.rows,
                                      import_spec: r.import_spec,
                                      import_metadata: r.import_metadata,
                                      source_sha256: r.source_sha256,
                                      source_filename: r.source_filename,
                                      source_available:
                                        !!r.source_asset_version_id ||
                                        r.raw_csv !== null,
                                      source_asset_version_id:
                                        r.source_asset_version_id,
                                      source_state: r.source_state,
                                      supersedes_id: r.supersedes_id,
                                      raw_csv: r.raw_csv,
                                      metric_snapshot: r.metric_snapshot,
                                    }
                                  : table === "workflows"
                                    ? r.execution_location === "desktop"
                                      ? {
                                          definition: r.definition,
                                          execution_location:
                                            r.execution_location,
                                          versions: (
                                            await tx.query(
                                              "SELECT version,definition,definition_hash,role_hashes,source_refs,published_at,created_at FROM workflow_versions WHERE workflow_id=$1 ORDER BY version DESC LIMIT 100",
                                              [r.id],
                                            )
                                          ).rows,
                                        }
                                      : r.definition
                                    : table === "workflow_runs"
                                      ? {
                                          definition: r.definition,
                                          results: r.results,
                                          state: r.state,
                                          ...(r.execution_location === "desktop"
                                            ? {
                                                execution_location:
                                                  r.execution_location,
                                                workflow_version:
                                                  r.workflow_version,
                                                cursor: r.cursor,
                                                revision: r.revision,
                                                origin_task_id:
                                                  r.origin_task_id,
                                                active_task: r.active_task,
                                              }
                                            : {}),
                                        }
                                      : table === "workspace_nodes"
                                        ? {
                                            kind: r.kind,
                                            workspace_id: r.workspace_id,
                                            parent_id: r.parent_id,
                                            asset_version_id:
                                              r.asset_version_id,
                                            reference_state: r.reference_state,
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
              if (r[state] === "deleted" && b.action !== "delete")
                throw new Problem(
                  409,
                  "CONTENT_DELETED",
                  "Permanently deleted content cannot be changed or restored",
                );
              if (b.action === "metadata") {
                if (
                  table === "agents" ||
                  table === "brand_profiles" ||
                  table === "memories" ||
                  table === "project_configurations" ||
                  table === "agent_groups" ||
                  table === "agent_group_runs"
                )
                  throw new Problem(
                    400,
                    "AGENT_VERSION_REQUIRED",
                    "Names and instructions change through a new reviewed publication",
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
                if (b.action === "delete" && table === "conversations") {
                  await eraseConversation(tx, req.principal, r);
                }
                if (b.action === "delete" && table === "workspace_nodes")
                  await eraseWorkspaceNode(tx, id);
                if (b.action === "delete" && table === "memories") {
                  await eraseReplayContent(tx, [id]);
                  await tx.query(
                    "SELECT set_config('app.erasing_content','true',true)",
                  );
                  await tx.query(
                    "UPDATE memory_versions SET content=NULL WHERE memory_id=$1",
                    [id],
                  );
                  await tx.query(
                    "SELECT set_config('app.erasing_content','false',true)",
                  );
                }
                if (table === "workflow_schedules" && b.action === "delete")
                  await eraseSchedule(tx, id);
                if (
                  b.action === "delete" &&
                  table === "project_configurations"
                ) {
                  await eraseReplayContent(tx, [id]);
                  await tx.query(
                    "UPDATE project_configurations SET draft='{}',content_state='deleted',version=version+1,moderation_version=moderation_version+1 WHERE id=$1",
                    [id],
                  );
                } else
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
                  if (
                    table === "agent_groups" ||
                    table === "agent_group_runs"
                  ) {
                    const runs =
                      table === "agent_group_runs"
                        ? [r]
                        : (
                            await tx.query(
                              "SELECT * FROM agent_group_runs WHERE group_id=$1 AND state='running' ORDER BY id FOR UPDATE",
                              [id],
                            )
                          ).rows;
                    for (const run of runs)
                      await stopAgentGroupRun(
                        tx,
                        run,
                        "cancelled",
                        "CONTENT_UNAVAILABLE",
                      );
                  }
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
                      [
                        "queued",
                        "paused",
                        "awaiting_approval",
                        "needs_input",
                      ].includes(r.status)
                    ) {
                      const known = await settleIdleTask(tx, r);
                      await tx.query(
                        "UPDATE tasks SET status=$2,version=version+1 WHERE id=$1",
                        [id, known ? "cancelled" : "reconciling"],
                      );
                    }
                  }
                  if (table === "workflow_schedules" && b.action !== "delete")
                    await tx.query(
                      "UPDATE workflow_schedules SET state='paused',next_due_at=NULL,version=version+1 WHERE id=$1",
                      [id],
                    );
                  if (table === "workflows") {
                    const runs = (
                      await tx.query(
                        "SELECT * FROM workflow_runs WHERE workflow_id=$1 AND state IN ('running','awaiting_approval') FOR UPDATE",
                        [id],
                      )
                    ).rows;
                    for (const run of runs)
                      await cancelWorkflowRun(
                        tx,
                        run,
                        req.principal,
                        "WORKFLOW_UNAVAILABLE",
                      );
                    await tx.query(
                      "UPDATE workflow_schedules SET state='blocked',last_error='WORKFLOW_UNAVAILABLE',next_due_at=NULL,version=version+1 WHERE workflow_id=$1 AND state='active'",
                      [id],
                    );
                  }
                  if (table === "workflow_runs")
                    await cancelWorkflowRun(
                      tx,
                      r,
                      req.principal,
                      "CONTENT_UNAVAILABLE",
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
              const deletion =
                b.action === "delete"
                  ? (
                      await tx.query(
                        "SELECT id,state FROM deletion_jobs WHERE target_type=$1 AND target_id=$2",
                        [table, id],
                      )
                    ).rows[0]
                  : undefined;
              return {
                ok: true,
                ...(deletion
                  ? { deletion_id: deletion.id, deletion_state: deletion.state }
                  : {}),
              };
            },
          ),
        undefined,
        true,
      );
    },
  );
}
