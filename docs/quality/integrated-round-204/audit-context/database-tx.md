## `Database.tx` in src/db.ts (L24–64)

**Purpose:** Executes a callback with a scoped database transaction and guarantees commit/rollback/connection release.

---
**Inputs & Assumptions:**

Callback: trusted application closure, potentially invoking native/filesystem/provider work. Tenant/actor/imported-snapshot flags: semi-trusted upstream context, converted to local transaction settings; callers must establish authority rather than treating settings alone as proof. Generic callback, lock, query and acquisition time limits: **nothing found** in this function.

---
**Outputs & Effects:**

Returns callback result only after COMMIT; on failure attempts ROLLBACK and rethrows; always releases connection (L55–63). App pool max12, control max6, queue max4 are separate pools (L10–18).

---
**Block-by-Block:**

```ts
// L31–35
const c = await (control ? this.control : this.pool).connect();
// BEGIN, or REPEATABLE READ when importing a snapshot
```

- **What / why:** Obtains a dedicated transaction session before identity/settings/callback use.
- **Assumes:** Pool acquisition and BEGIN eventually complete; no abort signal or timeout parameter is supplied here.
- **Establishes / depended on by:** Subsequent local settings and transaction advisory/row locks live on this connection.

```ts
// L37–54
// SET LOCAL tenant, actor, data_mode, gateway fingerprint, task and financial context
// L55–62
const result = await f(c);
await c.query("COMMIT");
// catch → ROLLBACK; finally → release
```

- **What / why:** Retains transaction scope for the entire awaited callback and commits before returning to caller.
- **Assumes:** Every callback-owned effect that requires atomicity is database-transactional. Filesystem/native process effects themselves do not roll back with PostgreSQL; their result publication/receipt can.
- **Establishes / depended on by:** No nested awaited native call automatically releases row/advisory locks. Worker heartbeat UPDATE, tool authority locks and event-trigger UPDATE can wait on one another while occupying separate connections.

---
**Cross-Function Dependencies:**

Caller decides app/control pool and identity. Native `pg` client is external-source-available; live role/server settings were not read. PostgreSQL transaction-scoped row/advisory lock lifetime and `now()` semantics are documented in the dossier's official source links.

---
**Open Questions:**

Actual deployed role/server lock/statement/idle-in-transaction settings and historical pool occupancy are unobserved. No configured timeout in this wrapper is not a claim that PostgreSQL has no possible external setting.
