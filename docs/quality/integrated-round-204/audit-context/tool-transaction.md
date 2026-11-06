## nested `txTool` in src/task-business-tools.ts (L229–263)

**Purpose:** Wraps a Codex business tool in current task authority, strict schema parsing, idempotency and optional durable output receipt.

---
**Inputs & Assumptions:**

Tool definition/function: trusted code. Arguments and call ID: untrusted model input, schema parsed after authorization (L239–240); replay hashes exact parsed input. Actor/task/fence: trusted captured run context, rechecked through Worker authority. Prompt callback completion: **nothing found** as a generic transaction deadline.

---
**Outputs & Effects:**

Returns replayed or executed result. Database effects and receipt/replay rows commit atomically; real filesystem/process effects are not PostgreSQL rollback effects. A transaction remains open for `await fn(...)` (L242–257).

---
**Block-by-Block:**

```ts
// authorize closure L223–228, called at L239
await lockTaskTools(tx, t.id);
await this.authority.authorize(tx);
// reject pending inputs
await assertTaskToolNotPausing(tx, t.id);
```

- **What / why:** Serializes task tools using transaction advisory key `task-tool:<id>` (`task-tool-reuse.ts:4–8`) before live task authority and pause admission checks.
- **Assumes:** Current live scope from `Worker.authorizeTaskRequest:1077–1123`; pause check takes task `FOR SHARE NOWAIT` and maps conflict to `TASK_CONTROL_CHANGING` (`task-pause.ts:7–17`).
- **Establishes / depended on by:** No new tool starts behind a granted pause/control mutation. The lock is held across replay lookup and effect, not released after validation.

```ts
// L241–257
return replay(/* same actor/action/key/input */, async () =>
  namedIdentity ? reuseCompletedTaskTool(/* effect fn */) : fn(/* scoped tx */));
```

- **What / why:** Same-request replay uses its own advisory lock and input hash (`access.ts:99–138`). Cross-attempt completed reuse requires exact tool/input and current output versions (`task-tool-reuse.ts:23–105`); otherwise effect runs before inserting receipt.
- **Assumes:** A receipt means an effect completed with its recorded outputs. Trigger `guard_task_tool_receipt` rechecks active running owner/attempt/fence/live lease and output lineage (`090:22–46`).
- **Establishes / depended on by:** No third-write receipt in the saved incident means no recorded completed transactional tool, not proof no file changed.

```ts
// examples: L1007–1044
// code_write → writeCloudSource for private conversation, otherwise workspace.write
// L899–983: native program/browser/process tools also use txTool
```

- **What / why:** Code writes and native checks execute inside the wrapper transaction. Workspace write performs awaited reads/hash/conflict checks/mkdir/writeFile (`code-workspace.ts:75–104`); no operation-level AbortSignal is passed there. Program/browser results are reauthorized and source digest rechecked after native work before publishing (`cloud-program-tools.ts:58–121`).
- **Assumes:** Shared authority remains valid while effect runs. Native program timeout up to30s is not total transaction duration: host deadline/force are timeout+15s/+25s; profile cleanup can add15s (`cloud-program-executor.ts:393–415,518–542`).
- **Establishes / depended on by:** Tool SHARE locks overlap heartbeat/event task-row UPDATE. A native elapsed bound is not a bound on pool/lock wait, DB commit or cleanup.

---
**Cross-Function Dependencies:**

`readTool` (L264–277) also uses `Database.tx` and the same authorize closure despite its name; it has no named completed-result receipt. `code_read` (L985–1005) uses unnamed `txTool`. Source manifests hold ordered source `FOR SHARE`; conversations deliberately omit NOWAIT (`100:241–250`, extended by103/108/112/129/141). These locks protect revocation consistency and must not be treated as incidental to lease changes.

---
**Open Questions:**

The exact pending third-write wait location is not captured. Full private-cloud filesystem/lock implementation and every native cleanup branch remain dependencies for their own audit. Historical activity/log snapshots are insufficient to claim one unique blocker.
