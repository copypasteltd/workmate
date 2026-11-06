## `Worker.finish` in src/worker.ts (L755–1076)

**Purpose:** Commits a measured cloud outcome and its financial/content effects under the original task fence. The source method is named `finish`; no `finishTask` function was found in Worker/runtime search.

---
**Inputs & Assumptions:**

Task/actor/fence: trusted claimed context; runtime status/text/tokens/native receipt: semi-trusted runtime output revalidated here. Caller normally joins heartbeat first (L715,734); the function itself does not stop the timer. Authoritative cost comes from durable provider/tool receipts, not a success paragraph (L834–885).

---
**Outputs & Effects:**

Control-pool transaction writes terminal/reconciling/paused/input state, measured usage, completed reports/effects, events and conversation output; calls financial settlement. A missing/stale-fence/non-running task returns without these effects (L769–775).

---
**Block-by-Block:**

```sql
-- L769–775
SELECT * FROM tasks WHERE id=$1 AND fencing_token=$2 FOR UPDATE
-- return if no live task or status != running
```

- **What / why:** Conversation mutation locking precedes task lock (L768); same-fence running task is the serialization point before any outcome.
- **Assumes:** Expired/reconciling work is handled through separate reconciliation, not late runtime finalization. A fresh lease alone cannot bypass the status check.
- **Establishes / depended on by:** Stale callbacks cannot finalize another attempt. Cancellation/content revocation overrides output and desired status (L780–833).

```ts
// L834–885
// sum succeeded known tool cost; detect accepted/reconciling operations
const receipt = await taskProviderBudgetReceipt(tx, t.id);
// durable receipt replaces token-derived estimate when requests exist
```

- **What / why:** Retains cumulative usage and exact task pricing; missing price, unknown tool cost, receipt uncertainty or budget violation forces reconciliation. Safe-integer checks guard amount conversion (L857–870).
- **Assumes:** Receipt aggregation and its SQL caller/data-mode scope are authoritative. `provider-budgets.ts:102–124` rounds the aggregate once; current SQL audio extension is `migrations/122:192–201`.
- **Establishes / depended on by:** A known runtime finish cannot erase unknown provider cost. Native inputs/pause only complete on known successful outcome, with no unknown operations (L887–925).

```ts
// L926–1008
// finalize reviewed effects / analysis / SEO outputs, mapping specific validation errors
// L1009–1020: update task, clear lease, then settle
```

- **What / why:** Business result finalizers run before committing a success. Recognized invalid report/effect errors produce failed output; unrelated errors roll back. Terminal UPDATE includes `lease_until=NULL` (L1010).
- **Assumes:** Callees enforce their content-specific validation; exhaustive semantic validation is covered by their own audits.
- **Establishes / depended on by:** `settle` binds original payer/actor, locks wallet/reservation/lots and either charges once/releases unused hold, or sets task/hold reconciling for uncertainty/over-budget (`billing.ts:173–306`). Events and conversation/plan output follow (L1021–1069); unknown results do not become trusted conversation results.

---
**Cross-Function Dependencies:**

`conversationMutation`, full authorization chain, tool operations, provider receipt aggregate, paid checkpoint/pause finalizers, business report/effect finalizers and `billing.settle`. Wallet `FOR NO KEY UPDATE`, reservation `FOR UPDATE`, allocated/free lot `FOR UPDATE` serialize finance (`billing.ts:47,55,190,209,230`). Task event insert additionally updates the task sequence via migration 020. Native/runtime cleanup is outside this transaction.

---
**Open Questions:**

Exact installed provider aggregate wrappers and business-finalizer correctness were not independently verified against live DB. A thrown finish/cleanup error is not converted here to a fabricated known cost. Historical late-result ordering remains unproven.
