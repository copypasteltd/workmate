import type { Tx } from "./db.js";
import { Problem } from "./lib.js";

export const modelEntryJoins = ` LEFT JOIN capability_model_revisions model_revision ON model_revision.release_id=r.id
 LEFT JOIN capability_model_entries model_entry ON model_entry.id=model_revision.model_id`;
export const modelEntryColumns = `coalesce(model_entry.id,r.id) AS model_id,
 coalesce(model_entry.current_release_id,r.id) AS model_current_release_id,
 coalesce(model_entry.revision,1) AS management_revision,model_entry.deleted_at AS model_deleted_at,`;

export function assertModelManageable(row: any, current = true) {
  if (row.model_deleted_at)
    throw new Problem(
      409,
      "MODEL_DELETED",
      "This model has been deleted; its task history is retained",
    );
  if (
    current &&
    row.model_current_release_id &&
    row.model_current_release_id !== row.id
  )
    throw new Problem(
      409,
      "MODEL_VERSION_CHANGED",
      "This model was edited. Reload its current configuration",
    );
}

/** Holds the same shared lock as default-model selection, closing deletion races. */
export async function assertNewModelSelection(tx: Tx, ids: string[]) {
  await tx.query(
    "SELECT pg_advisory_xact_lock_shared(hashtextextended('capability-heads:'||current_setting('app.data_mode'),0))",
  );
  if (
    (
      await tx.query(
        "SELECT 1 FROM deleted_model_capability_versions WHERE id=ANY($1::uuid[]) AND data_mode=current_setting('app.data_mode') LIMIT 1",
        [ids],
      )
    ).rowCount
  )
    throw new Problem(
      409,
      "MODEL_DELETED",
      "This model was removed. Select an available model before starting new work",
    );
}
