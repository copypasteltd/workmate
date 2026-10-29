import { z } from "zod";
import type { Database, Tx } from "./db.js";
import type { Principal } from "./auth.js";
import type { RuntimeContext } from "./runtime.js";
import { replay } from "./access.js";
import { Problem, uuid } from "./lib.js";
import { Storage } from "./storage.js";
import { publicationDraft, publicationPrepareInput } from "./publication-model.js";
import { publicationMode, publicationProjectAuthority, assertPublicationTask } from "./publication-authority.js";
import { Publications, publicationMetadata, publicationOperation } from "./publication-service.js";
import { recordTaskSourceRead } from "./task-content-sources.js";

const empty = z.object({}).strict();
const statusInput = z.object({ operation_id: uuid }).strict();

/** Versioned company tools prepare work; only the human author confirms a post. */
export function publicationTools(db: Database, storage: Storage, task: any, actor: Principal,
  authorize: (tx: Tx) => Promise<unknown>, signal?: AbortSignal): RuntimeContext["tools"] {
  const service = new Publications(db, storage);
  const guard = async (tx: Tx) => {
    await authorize(tx);
    await publicationProjectAuthority(tx, actor, task.tenant_id, task.project_id, "read");
    await assertPublicationTask(tx, { ...task, actor_id: actor.id, task_id: task.id });
  };
  return [
    { name: "publication_accounts", description: "List current project publishing accounts, formats and explicit policies. This grants no authority and changes no account or policy. Reconnection and account enablement belong to the customer.",
      inputSchema: z.toJSONSchema(empty), run: async args => {
        empty.parse(args);
        return db.tx(async tx => {
          await guard(tx);
          const rows = (await tx.query(`SELECT t.id,t.kind,t.external_id,t.name,t.enabled,t.capabilities,c.state AS connection_state,
            p.version AS policy_version,p.body AS policy FROM publication_targets t JOIN publication_connections c ON c.id=t.connection_id
            JOIN publication_connection_projects g ON g.connection_id=c.id AND g.project_id=$1
            LEFT JOIN LATERAL(SELECT version,body FROM publication_policies WHERE project_id=$1 AND target_id=t.id ORDER BY version DESC LIMIT 1) p ON true
            WHERE t.tenant_id=$2 AND g.tenant_id=$2 AND c.data_mode=$3 ORDER BY t.kind,t.name,t.id LIMIT 100`,
            [task.project_id, task.tenant_id, publicationMode(db)])).rows;
          return { items: rows, data_mode: publicationMode(db) };
        }, task.tenant_id, true, actor.id);
      } },
    { name: "publication_preview", description: "Build an exact publishing preview from customer-selected account, text and immutable approved asset versions. JPEG conversion and media specifications are shown before approval. Never invent a destination, broaden policy, silently crop media or treat a preview as publication. Synthetic mode must be labelled.",
      inputSchema: z.toJSONSchema(publicationDraft), run: async args => {
        const preview = await service.preview(actor, task.tenant_id, task.project_id, args, signal, { authorize: guard, taskId: task.id });
        await db.tx(async tx => {
          await guard(tx);
          const current = (await tx.query("SELECT * FROM tasks WHERE id=$1", [task.id])).rows[0];
          await tx.query("SELECT set_config('app.task_id',$1,true)", [task.id]);
          for (const source of preview.sources)
            await recordTaskSourceRead(tx, current, "asset_version", source.asset_id, source.asset_version_id, source.source_sha256);
        }, task.tenant_id, true, actor.id);
        return preview;
      } },
    { name: "publication_prepare", description: "Prepare an awaiting_confirmation operation using the unchanged preview_id and payload_sha256. This sends no publishing request. Tell the original customer author to review and confirm in Publishing. Never self-confirm, change targets or media, or retry an unknown external effect.",
      inputSchema: z.toJSONSchema(publicationPrepareInput), run: async (args, callId) => {
        const body = publicationPrepareInput.parse(args);
        return db.tx(async tx => {
          await guard(tx);
          return replay(tx, actor.id, `task-publication.prepare:${task.id}`, `task:${task.id}:${callId}`, body,
            () => service.prepare(tx, actor, task.tenant_id, task.project_id, body, task.id));
        }, task.tenant_id, true, actor.id);
      } },
    { name: "publication_status", description: "Read this task's exact publication state and safe provider evidence. Only succeeded proves publication. Unknown may already be published; never resend or treat a pasted remote ID as attribution. Human reconciliation is required.",
      inputSchema: z.toJSONSchema(statusInput), run: async args => {
        const body = statusInput.parse(args);
        return db.tx(async tx => {
          await guard(tx);
          const row = await publicationOperation(tx, task.tenant_id, task.project_id, body.operation_id);
          if (row.task_id !== task.id || row.actor_id !== actor.id) throw new Problem(404, "NOT_FOUND", "Publication not found");
          const effects = (await tx.query("SELECT step_key,state,remote_id,result,error_code FROM publication_effects WHERE operation_id=$1 ORDER BY created_at,id", [row.id])).rows;
          return { ...publicationMetadata(row), effects, result: row.result, observation: row.observation };
        }, task.tenant_id, true, actor.id);
      } },
  ];
}
