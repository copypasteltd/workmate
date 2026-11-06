## `Worker.finish` in `dev/copypaste-platform/src/worker.ts` (L802-L1129; outcome-focused reading)

**Purpose:** Revalidates authorization/content, reconciles actual usage and persists a final task state or a measured continuation checkpoint (L813-L1128).

**Inputs & Assumptions:** Task and fencing are server derived. Native status/text/token counts are adapter output. A control transaction locks the exact task/fencing and returns without changes if no longer running (L813-L822). Pricing capability history is not an execution permission (L887-L910).

**Outputs & Effects:** Updates task status/output/usage/version, settles real charges, emits task/usage events and optional conversation/planning output (L1062-L1123). Input/pause checkpoint paths can return earlier without settlement of the whole task (L941-L972).

**Block-by-Block:**

```sql
-- L881-L885
SELECT coalesce(sum(charge_micros) FILTER(WHERE state='succeeded'),0)::text AS charge,
       bool_or(state IN ('accepted','reconciling')) AS uncertain
FROM tool_operations WHERE task_id=$1
```

- **What:** Reads durable image-operation charge and uncertainty independently of runtime tool events.
- **Why here:** Final status alone is not financial evidence.
- **Assumes:** Operation rows and provider receipts are authoritative and immutable under their own workflows.
- **Establishes:** Any accepted/reconciling operation keeps unknown settlement; provider receipts supersede fallback pricing when present (L918-L933).
- **Depended on by:** Checkpoint admission and settle arguments.

```ts
// L941-L959
// matching requested input checkpoint + native succeeded + known usage
// → completePaidInputCheckpoint(...) → return
```

- **What:** Converts the same paid task to measured needs_input before terminal delivery checks.
- **Why here:** Incomplete requirements can wait without pretending all requested work is delivered.
- **Assumes:** Native checkpoint identity is measured. `completePaidInputCheckpoint` checks exact thread/turn and original budget before setting needs_input (paid-task-inputs.ts L254-L307).
- **Establishes:** A known measured wait, retaining original task usage/reservation and later continuation context.
- **Depended on by:** Next run's persisted reconstruction and input dependency handling.

```ts
// L1058-L1061
if (status === "succeeded") {
  const outstanding = await readUnresolvedDeliveryToolNames(tx, t.tenant_id, t.id);
  if (outstanding.length) { status = "failed"; error = deliveryFailureCode(outstanding); }
}
```

- **What:** Independently rejects succeeded when latest retained delivery-tool outcome is failed.
- **Why here:** Runs after business-specific effect/analysis/SEO finalizers and checkpoint exits (L973-L1055).
- **Assumes:** The reconstruction represents every required unresolved delivery; its current key is tool name.
- **Establishes:** Current durable outstanding names, rather than model prose, affect terminal state.
- **Depended on by:** Task row, events, conversation output and settlement.

**Cross-Function Dependencies:** Authorization/content rechecks can cancel and suppress text (L834-L880). Effect, analysis and SEO finalizers enforce their domain-specific contracts (L973-L1055). `settle` receives known cost plus the independent uncertainty flags (L1066-L1073); a delivery failure does not imply free usage. The full internals of settle/provider accounting were not re-audited here.

**Open Questions:** Whether all twelve delivery tools' domain states have equivalent finalizers; generic audio/video resolution can carry non-delivered states. Independent durable state after event pruning and per-call repair semantics remain open.
