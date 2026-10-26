import type { FastifyInstance } from "fastify";
import { z } from "zod";
import path from "node:path";
import type { Database } from "./db.js";
import type { Storage } from "./storage.js";
import { requireUser } from "./auth.js";
import { projectAccess } from "./access.js";
import { Problem, uuid } from "./lib.js";
import { assertTaskContentSources } from "./task-content-sources.js";
import { assertReportSources } from "./analysis-reports.js";
import { CodeWorkspace } from "./code-workspace.js";
import { exportCloudSources } from "./cloud-source.js";
import { sourceDigest, sourceManifest } from "./cloud-program-executor.js";

export function registerCloudProgramRoutes(
  app: FastifyInstance,
  db: Database,
  storage: Storage,
) {
  const handler = (canonical: boolean) => async (req: any) => {
    const tenant = uuid.parse(
        canonical ? req.headers["x-tenant-id"] : req.params.tenant,
      ),
      id = uuid.parse(canonical ? req.params.task_id : req.params.task);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(20).default(10),
        before: uuid.optional(),
      })
      .strict()
      .parse(req.query);
    return db.tx(
      async (tx) => {
        const t = (
          await tx.query("SELECT * FROM tasks WHERE id=$1 AND tenant_id=$2", [
            id,
            tenant,
          ])
        ).rows[0];
        if (
          !t ||
          (!canonical && t.project_id !== uuid.parse(req.params.project))
        )
          throw new Problem(404, "NOT_FOUND", "Task not found");
        await projectAccess(tx, req.principal, tenant, t.project_id);
        await assertReportSources(tx, t, false);
        await assertTaskContentSources(tx, t);
        await tx.query("SELECT set_config('app.task_id',$1,true)", [t.id]);
        let current: string | null = null;
        try {
          if (t.private_owner && t.conversation_id) {
            const tree = await exportCloudSources(tx, storage, t, false);
            current = sourceDigest(
              sourceManifest(
                Object.entries(tree.data).map(([path, bytes]) => ({
                  path,
                  bytes: Buffer.from(bytes),
                })),
              ),
            );
          } else
            current = sourceDigest(
              await new CodeWorkspace(
                path.resolve(
                  db.config.DATA_DIR,
                  "runs",
                  t.tenant_id,
                  t.id,
                  "project",
                ),
              ).list(),
            );
        } catch (error) {
          if (
            !(error instanceof Problem) &&
            !(error as any)?.code?.startsWith("ENOENT")
          )
            throw error;
        }
        const rows = (
          await tx.query(
            `SELECT id,created_at,result FROM task_tool_receipts WHERE task_id=$1 AND tool_name='process_run_allowed'
        AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM task_tool_receipts WHERE id=$2 AND task_id=$1 AND tool_name='process_run_allowed'))
        ORDER BY created_at DESC,id DESC LIMIT $3`,
            [t.id, query.before ?? null, query.limit + 1],
          )
        ).rows;
        const items = [];
        for (const r of rows.slice(0, query.limit)) {
          const v = r.result,
            ids = [v.record.version.id, v.artifacts.version.id];
          const visible =
            (
              await tx.query(
                "SELECT v.id FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=ANY($1::uuid[]) AND a.state='active' AND v.erased_at IS NULL AND a.retention_expires_at>clock_timestamp() AND task_asset_version_sources_available(v.id)",
                [ids],
              )
            ).rowCount === ids.length;
          if (!visible) continue;
          const c = v.receipt;
          items.push({
            id: r.id,
            created_at: r.created_at,
            execution_id: c.execution_id,
            program: c.program,
            entry: c.entry,
            args: c.args,
            exit_code: c.exit_code,
            passed: c.passed,
            stop_reason: c.stop_reason,
            source_digest: c.source_digest,
            matches_current_sources:
              current !== null ? current === c.source_digest : null,
            stdout: c.stdout,
            stderr: c.stderr,
            output_truncated: c.output_truncated,
            elapsed_ms: c.host.elapsed_ms,
            files: c.output_manifest,
            receipt: {
              id: v.record.id,
              version: v.record.version.version,
              name: v.record.name,
            },
            artifacts: {
              id: v.artifacts.id,
              version: v.artifacts.version.version,
              name: v.artifacts.name,
            },
          });
        }
        return {
          task_id: t.id,
          items,
          next_cursor:
            rows.length > query.limit ? rows[query.limit - 1].id : null,
        };
      },
      tenant,
      false,
      req.principal.id,
    );
  };
  app.get(
    "/v1/tenants/:tenant/projects/:project/tasks/:task/software-checks",
    { preHandler: requireUser(db) },
    handler(false),
  );
  app.get(
    "/v1/tasks/:task_id/software-checks",
    { preHandler: requireUser(db) },
    handler(true),
  );
}
