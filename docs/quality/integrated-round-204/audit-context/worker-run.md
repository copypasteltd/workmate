## `Worker.run` in src/worker.ts (L412–754)

**Purpose:** Claims authorized queued cloud work, wires Codex to scoped provider/tools, coordinates renewal and completion, and owns the active abort controller. Baseline and scope: [dossier](worker-DOSSIER.md).

---
**Inputs & Assumptions:**

- `tenant`, `id`: semi-trusted queue payload; owner lookup is scoped by both (L416–422); claim re-reads and locks the actual task (L425–434).
- Environment/runtime/catalog: trusted application objects, checked by `assertLiveEnvironment` (L413), current authorization/capability checks (L452–480) and frozen task digests.
- A free pool connection, prompt timer scheduling and responsive callees: nothing found establishing a general time bound (`db.ts:31–64`).

---
**Outputs & Effects:**

Returns no public result. Writes claim/start/terminal state and events, calls runtime/provider/tools, and always removes its active controller after joining renewal (L519–520,750–753). Missing owner, non-cloud/non-queued work, invalid authorization or exhausted capacity can return before runtime starts (L422,433–434,481–512).

---
**Block-by-Block:**

```ts
// L429, L433–434
"SELECT * FROM tasks WHERE id=$1 AND tenant_id=$2 FOR UPDATE"
if (t.execution_location !== "cloud") return null;
if (t.status !== "queued") return null;
```

- **What / why:** Serializes duplicate deliveries before admission, excludes local execution, then validates actor/project/role/skill/source/plan/capability context (L437–480).
- **Assumes:** Queue data alone is not authority; owner and locked row establish scope.
- **Establishes / depended on by:** Runtime sees only a committed eligible claim. Authorization failure uses `settleIdleTask` and marks cancelled or reconciling (L481–497); no zero-cost assumption is made here.

```ts
// L501–512
const started = await claimCapacity(/* scoped task, role, user limit, fence */);
// continuation consumed, native thread retained, task.started emitted
```

- **What / why:** Admission runs while task lock is held; SQL capacity lock and measured continuation checks precede running/attempt/fence/45-second lease.
- **Assumes:** Current composed SQL is the migration 089 body renamed by 092 and patched by 154/162; actual deployed definition was not read.
- **Establishes / depended on by:** A null capacity result exits; a running claim is committed before active controller and heartbeat setup.

```ts
// L685–716
const result = await this.runtime.start(/* abort signal, emit, scoped AI, tools */);
completedUsage = result;
await stopHeartbeat();
await this.finish(/* status, native receipt, known/unknown usage */);
```

- **What / why:** Runtime receives immutable task/skill selections, current permitted tool intersection and fenced provider authority (L646–713). Stop/join renewal precedes finalization.
- **Assumes:** Runtime reports genuine acceptance and usage knowledge; scope and paid checkpoints are checked again in `finish`, not trusted from text.
- **Establishes / depended on by:** Completed/interrupt/failed map explicitly; caught `RuntimeFailure` preserves acceptance/usage/native metadata (L733–749). Finally stops heartbeat again and deletes active state even if finishing fails (L750–753).

---
**Cross-Function Dependencies:**

`claimCapacity` / SQL atomic admission; `heartbeat` live authority; `event` task-row trigger; runtime (external-source-available, separate audit); TaskBusinessTools transaction/receipt guards; `finish` provider-backed settlement. The `emit` closure rechecks task/fence/status and source/dedicated authority and updates native thread/turn where relevant (L599–627). Shared state: tasks, holds, events, active map, runtime child.

---
**Open Questions:**

Exact incident pool waits, installed SQL and native abort cause remain unknown. This path assumes downstream cleanup eventually returns; the Worker wrapper does not impose an independent deadline around `stopHeartbeat` or `finish`.
