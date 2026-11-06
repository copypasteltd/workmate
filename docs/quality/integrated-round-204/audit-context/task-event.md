## `event` in src/tasks.ts (L23–36)

**Purpose:** Appends a scoped task event with durable per-task ordering and returns its event ID.

---
**Inputs & Assumptions:**

Transaction and IDs: trusted internal callers whose task authority is established upstream. Body: semi-trusted runtime/application data serialized with JSON. Valid parent task and event scope are enforced by FK/RLS/trigger rather than this helper. Bound on acquiring the task-row write lock: **nothing found** here.

---
**Outputs & Effects:**

Inserts event and returns ID. Crucially, the database trigger also updates the parent task's sequence, so a call can block on the parent task row despite no explicit UPDATE in TypeScript.

---
**Block-by-Block:**

```sql
-- tasks.ts:L32
INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,$3,$4) RETURNING id
-- migrations/020-durable-event-sequences.sql:L16–17, BEFORE INSERT trigger L24
UPDATE tasks SET last_event_seq=last_event_seq+1
WHERE id=NEW.task_id AND tenant_id=NEW.tenant_id
RETURNING last_event_seq,coalesce(fencing_token,initial_attempt_id) INTO NEW.seq,NEW.attempt_id;
```

- **What / why:** Parent UPDATE creates a serialized task-local sequence and binds event attempt to current task fence/initial attempt. Missing parent raises `23503` (020:L18).
- **Assumes:** Caller has not created an incompatible cross-transaction lock order. FK on `(tenant_id,task_id)` also references tasks (`001:95`), but the explicit sequence UPDATE is stronger than the FK's parent key-share check.
- **Establishes / depended on by:** Ordered durable events; runtime emit and provider-authorized event can require a task-row write lock. A different lease table would not remove this existing event serialization.

---
**Cross-Function Dependencies:**

Migration020 trigger is internal source-available; FK defined in001. Called by Worker start/emit/finish, tools, provider-authorized audit event and numerous task controls. Shared `tasks.last_event_seq` is transactional state and rolls back with event insert.

---
**Open Questions:**

No saved incident lock trace establishes whether the event trigger, a tool transaction, or another caller held/waited for the task row during the aborted turn. Actual installed trigger source was not read live.
