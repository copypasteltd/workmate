## `Worker.run` heartbeat callback in src/worker.ts (L521–591)

**Purpose:** Rechecks ongoing execution authority and extends the claimed task's 45-second lease; aborts its runtime when current authority is lost.

---
**Inputs & Assumptions:**

- Closed-over task/tenant/actor/fence/controller: trusted values from committed `run` claim (L425–520).
- Current task/source/configuration state: authoritative database state, freshly read (L529–567).
- Timer fires promptly and transaction completes before the prior lease expires: nothing found establishing either scheduling or database waiting bounds.

---
**Outputs & Effects:**

At most one callback is pending. The interval is 3000 ms (L591); it is not a guarantee of a completed renewal every 3 seconds. Success updates the task lease. Missing/currently cancelled/unavailable task, most authority errors, or transaction errors abort the controller (L535–538,568–588).

---
**Block-by-Block:**

```ts
// L521–527
if (checking) return;
checking = true;
heartbeatPending = this.db.tx(async (tx) => { /* ... */ });
```

- **What / why:** Serializes heartbeat attempts within this Worker and retains a promise for finalization to join.
- **Assumes:** One in-flight callback eventually resolves; no separate watchdog cancels a blocked query here.
- **Establishes / depended on by:** Later interval ticks skip work until `finally` resets `checking` (L588–590). Cleanup depends on the same pending promise.

```sql
-- L529–534: SELECT current task for this fence and running status, no FOR clause
-- L578–581
UPDATE tasks SET lease_until=now()+interval '45 seconds'
WHERE id=$1 AND fencing_token=$2
```

- **What / why:** Reads live task; validates project, role hash, skills, dependencies, report sources, plan, work context, capability bindings and sources before updating (L539–567).
- **Assumes:** The earlier status/content/cancel checks remain valid until the update; the UPDATE itself only predicates task ID and fence, and no row-count check follows it (L578–585).
- **Establishes / depended on by:** Renewal updates the same task row held `FOR SHARE` by tools. Its deadline uses transaction-start time, not completion time. The runtime, admission SQL, checkpoints and recovery all consume task lease state; see lease map.

```ts
// L568–577
if (error instanceof Problem && error.code === "TASK_SOURCE_BUSY") return;
controller.abort();
```

- **What / why:** A transient source lock conflict skips renewal without immediate abort. Other authority errors abort; outer transaction failure also aborts (L587).
- **Assumes:** Retaining the old lease while a source is busy is sufficient until a future renewal or expiry. This is the coded policy; no extension is granted in that branch.
- **Establishes / depended on by:** Source busy differs from a task UPDATE waiting on its row lock, because that UPDATE does not use NOWAIT.

---
**Cross-Function Dependencies:**

`Database.tx` holds app-pool connection; `assertTaskContentSources` saves/rolls back source-lock savepoint and maps `55P03` to `TASK_SOURCE_BUSY`; task-tool `FOR SHARE` spans native work; `event` trigger writes the same task. `stopHeartbeat` clears timer and awaits this callback (L592–598), invoked before normal/caught finish and in final cleanup. Node interval/abort/promise callbacks share the process event loop.

---
**Open Questions:**

No retained trace identifies the particular blocking statement or loop/pool delay in round 203. The last yielded tool call and later lease snapshot cannot resolve the unique cause. Live timeout/role settings were not read.
