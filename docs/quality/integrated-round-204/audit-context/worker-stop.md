## `Worker.stop` in src/worker.ts (L1205–1227)

**Purpose:** Stops local dispatch/maintenance and aborts owned task runtimes during service shutdown.

---
**Inputs & Assumptions:**

No explicit parameters. Trusted Worker maps/promises/controllers. Assumes owned runtime/maintenance promises respond to abort and settle; a general deadline for every awaited promise is **nothing found**.

---
**Outputs & Effects:**

Sets `stopping`, clears dispatcher/resource intervals, aborts active controllers, awaits PgBoss graceful shutdown, aborts maintenance categories and joins their promises. No direct task or ledger writes occur in this method.

---
**Block-by-Block:**

```ts
// L1206–1210
this.stopping = true;
if (this.timer) clearInterval(this.timer);
if (this.resourceTimer) clearInterval(this.resourceTimer);
for (const c of this.active.values()) c.abort();
await this.boss.stop({ graceful: true, timeout: 20000 });
```

- **What / why:** Prevents new local work before interrupting active owned runs and waiting for queue worker closure.
- **Assumes:** Abort reaches runtime; the PgBoss 20-second graceful timeout does not itself prove every application callback/DB query has ended.
- **Establishes / depended on by:** Per-run `finally` must join heartbeat and remove active entries (`run:750–753`). Shutdown does not forcibly resolve `heartbeatPending`.

```ts
// L1211–1226
// abort media / connector / SEO / publication controllers; await retained promises
```

- **What / why:** Category promises are joined after cancellation.
- **Assumes:** Native tools can still be in their own cleanup transaction. Program tools have separate process deadline/kill and cleanup waits (`cloud-program-executor.ts:381–415,498–544`); those may exceed a task lease and are not a substitute for DB query cancellation.
- **Establishes / depended on by:** Returned stop means these retained promises have settled; return timing is not a bound on each resource.

---
**Cross-Function Dependencies:**

`run`/runtime abort handling, PgBoss `stop`, each maintenance promise, and per-run heartbeat quiescence. No direct external message or server network-setting operation.

---
**Open Questions:**

Native Codex/gateway process cleanup is audited separately. The incident's snapshot process listing does not prove which process owned the unfinished tool at abort time.
