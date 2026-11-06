## `Worker.dispatch` in src/worker.ts (L193–410)

**Purpose:** Moves eligible durable outbox work to PgBoss, quarantines expired execution, and initiates bounded category maintenance without duplicate dispatch loops.

---
**Inputs & Assumptions:**

Trusted Worker configuration; authoritative outbox/task data; `dispatching` local guard (L195–196). Multi-process exclusion relies on DB locks, not that local boolean. Prompt execution of the timer and unblocked control-pool queries: nothing found enforcing a general bound.

---
**Outputs & Effects:**

Queues jobs, marks dispatched outbox rows, marks expired running tasks and their reserved holds reconciling, starts maintenance and resets local dispatch state. Dispatch runs every second from `start` (L184); PgBoss retries are disabled, expiry is 1200 seconds (L173–176).

---
**Block-by-Block:**

```ts
// L198–223
const c = await this.db.control.connect();
// BEGIN → readyOutbox → boss.send(singleton) → dispatched marker → COMMIT
```

- **What / why:** Outbox rows are `FOR UPDATE OF o SKIP LOCKED` and limited/fairly ordered (`execution-capacity.ts:4–17`); queued cloud placement/retry/SEO readiness is checked before dispatch.
- **Assumes:** PgBoss singleton plus locked outbox bookkeeping handles duplicate send windows. Queue uses a separate pool; application/control connections are not substituted.
- **Establishes / depended on by:** Commit after queue send; rollback and release occur on failure. Actual task authority is rechecked by `run`.

```sql
-- L228, then a separate query L230–232
UPDATE tasks SET status='reconciling',error_code='WORKER_LEASE_EXPIRED',version=version+1
WHERE status='running' AND lease_until<now()
```

- **What / why:** Retains uncertain abandoned execution instead of blindly replaying (comment L225). Audio origin recovery is called first (L226).
- **Assumes:** The task lease is the relevant deadline for all matching running tasks; there is no placement, data-mode or fence predicate in this SQL. The reservation update is a later statement, not the same transaction as the task expiry update.
- **Establishes / depended on by:** `finish` will return on reconciling tasks; provider recovery can mark dispatched requests unknown; holds and capacity remain governed by reconciliation rules.

```ts
// L233–409
// finally: launch each maintenance category only if its existing promise is absent
// per-operation error handling → dispatching = false
```

- **What / why:** Maintenance remains reachable through finalization; each category retains its own execution promise and abort controller (L129–150).
- **Assumes:** Individual maintenance functions honor their own ownership/timeout contracts. Those independent worker implementations are outside this focused audit.
- **Establishes / depended on by:** Local dispatch guard is reset after the maintained sequence; it cannot make the current expiry query non-blocking.

---
**Cross-Function Dependencies:**

`readyOutbox`, PgBoss source-available external library, task expiry, audio/provider recovery, category-specific maintenance. Shared task rows also have native-tool share locks, event-trigger writes, Desktop owner recovery and financial reconciliation.

---
**Open Questions:**

Incident query/blocker history and actual interval cadence are not retained. PgBoss delivery crash windows were not independently tested. All maintenance callees were located, but their complete implementations were not audited here.
