## `Worker.run` in `dev/copypaste-platform/src/worker.ts` (L456-L801; outcome-focused reading)

**Purpose:** Claims an authorized cloud task, maintains execution lifecycle and passes the correct paid/runtime context into Codex (L456-L801).

**Inputs & Assumptions:** Tenant/task come from the queue; owner is located using control identity, then task claims run under tenant/owner RLS (L460-L560). Only queued cloud tasks in the configured data mode can proceed (L477-L480). Capacity claim produces the active attempt/fencing (L545-L556).

**Outputs & Effects:** Starts the adapter with bound Skills/capability/budget/tool context, records events under fencing, stops heartbeat before finalization, finalizes exact usage and removes the active controller (L644-L801).

**Block-by-Block:**

```ts
// L730-L732
const result = await this.runtime.start({
  unresolvedDeliveryToolNames: await this.db.tx(
    tx => readUnresolvedDeliveryToolNames(tx, tenant, id), tenant, false, owner),
```

- **What:** Seeds runtime from persisted historical outcomes across attempts.
- **Why here:** Input dependencies, sources, role/context and capabilities were already checked (L691-L723).
- **Assumes:** Reconstruction returns complete relevant history; it currently reduces latest retained events by name (runtime-tool-feedback.ts L89-L95).
- **Establishes:** Customer input cannot directly set this list (runtime.ts L36-L37).
- **Depended on by:** Runtime terminal status and same-name recovery.

```ts
// L761-L796
// stopHeartbeat → finish(result), or finish(failure/current measured usage)
```

- **What:** Converts completed/interrupted/other native result to succeeded/cancelled/failed and passes measured usage.
- **Why here:** Awaiting heartbeat shutdown prevents late renewal during finalization (L637-L643, L762).
- **Assumes:** `finish` revalidates task/canonical business state; it does so under fencing (L813-L822, L834-L1061).
- **Establishes:** A failed tool does not reset measured model usage to zero (L788-L795).
- **Depended on by:** Task UI and settlement.

**Cross-Function Dependencies:** `readUnresolvedDeliveryToolNames`, `RuntimeContext` and tool registry establish outcome input. `authorizeInference` freezes capability/model/attempt/budget authority (L1183-L1238). Business tools share transaction and task-authority checks (L1240-L1256). The full cloud lease implementation was not re-audited by this bounded outcome task.

**Open Questions:** Event-pruning compatibility with resumed waits; per-call versus tool-wide pending obligations; relation between original attempt's delivery results and later corrective calls. These are not decided by queue or capacity authorization.
