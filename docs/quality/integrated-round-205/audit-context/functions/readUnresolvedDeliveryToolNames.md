## `readUnresolvedDeliveryToolNames` in `dev/copypaste-platform/src/runtime-tool-feedback.ts` (L89-L96)

**Purpose:** Reconstructs server-derived delivery failure names for a new native turn and for final cloud task success (worker.ts L731-L732, L1058-L1061).

**Inputs & Assumptions:** `tx`, tenant and task are trusted server context; runtime entry uses tenant/actor scoped transaction, finalization uses a fenced control transaction (worker.ts L731-L732, L813-L822, L1124-L1128). The query also explicitly filters tenant/task (L91). Correct availability of necessary historical events is assumed; retention independently deletes thirty-day events (retention.ts L127-L130).

**Outputs & Effects:** Read-only query returning names whose latest event is failed (L90-L95). It does not resolve paid operation receipts, grant access or rewrite older events.

**Block-by-Block:**

```sql
-- L90-L94
SELECT DISTINCT ON(body->>'tool') body->>'tool' AS tool,kind
FROM task_events WHERE tenant_id=$1 AND task_id=$2
  AND kind IN('runtime.tool.failed','runtime.tool.completed','runtime.tool.recovered')
  AND body->>'tool'=ANY($3::text[])
ORDER BY body->>'tool',id DESC
```

- **What:** Reduces all retained calls and turns to one event per delivery tool name.
- **Why here:** This is the durable counterpart of the runtime map before a resumed turn or terminal decision.
- **Assumes:** Latest same-name completed/recovered is sufficient to clear earlier same-name failure. Explicit call-repair association: nothing found.
- **Establishes:** Returned names belong to the trusted twelve-name set and latest retained event is failed (L87, L95).
- **Depended on by:** Constructor seed and Worker final status.

**Cross-Function Dependencies:** `Tx.query` is PostgreSQL client behavior. `event` inserts event bodies without additional outcome projection (tasks.ts L23-L35); runtime creates the tool events (runtime.ts L472-L497). RLS additionally restricts task-event parent visibility for app-role callers (migrations/005-persistent-work.sql L97-L99).

**Open Questions:** A durable unresolved obligation independent of retained events was not found here. Full checkpoint lifetime versus pruning policy remains unassessed. Task event bodies have call/argument identity, but this query does not select it.
