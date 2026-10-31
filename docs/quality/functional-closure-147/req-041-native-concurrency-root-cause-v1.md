# REQ-041 native handoff authorization lock conflict

Read-only diagnosis while backend 09 remains frozen. No product/test/migration changes, service startup or test runs were made for this diagnosis.

## Actual failure and boundaries

`dev/copypaste-delivery/evidence/functional-closure-147/ui-07.tap:160` and `:165` record PostgreSQL 55P03 on `task_local_handoffs`, in `lock_task_content_sources`: `FOR SHARE NOWAIT`. The timestamps are 00:10:24.568Z and 00:10:34.862Z.

The retained native session `dev/copypaste-delivery/.data/functional-closure-147/ui-461e0417-4183-4c9e-a020-a0a8352d7856/desktop/local-codex/5d9aead0-bc80-425a-877f-a4ba0e42f25b/home/sessions/2026/10/31/rollout-2026-10-31T08-10-29-01a18f4b-25c0-7ba2-8cd1-a3d72d5ec671.jsonl:17` records the approved CSV write exiting 0. Line 20 records the subsequent model request failing with 403 `AI_REQUEST_AUTHORIZATION_CHANGED`. UI 07's native provider call count is one and provider error is NULL (`ui-07-journey.json:115`). The failure is after an actual successful local shell command, before the second company provider request.

`ui-07-journey.json:104` also reports task project-configuration GET failing at `project-configuration.ts:181` -> `assertTaskContentSources`. This is a second consumer affected by the same row-lock incompatibility; it is not the native inference call stack.

The PostgreSQL log does not identify the blocking transaction. The retained source establishes an exact lock conflict and execution sequence capable of producing both failures; claiming a captured pg_locks identity would exceed this evidence.

## Confirmed competing code paths

- `task-local-handoffs.ts:98-107`: `lockLocalHandoffParent` reads the source task with FOR UPDATE, reads current user authorization with FOR SHARE, then takes FOR UPDATE on the handoff. It never updates the parent or handoff.
- Whole source/test search finds its only product caller at `desktop-executions.ts:277`, inside `own(...lock=true)`. Callers include start, company-tool admission/result recheck, heartbeat, cancellation, finish and registered workflow control. Their direct writes concern native tasks/executions and child workflow content, not this cloud source task or handoff. Actual handoff writers are separate `load(write=true)` / admission / cancel / complete paths and must retain exclusive locks.
- `local-agent.ts:1354-1376` renews by heartbeat every ten seconds. `desktop-executions.ts:1079` calls locked `own`, then renews only the native task lease at line 1084.
- `desktop-executions.ts:381-398` inference authority locks native workflow ancestry, then the native task and execution, then authorizes its content sources. `businessTools.authorize:480-499` and inference proxy preflight `:1260-1280` have the same native-first pattern and currently omit explicit local-handoff parent locking.
- Migration 141 adds the handoff to the source manifest and adds `task_local_handoffs` to the existing FOR SHARE NOWAIT source-lock loop (based on migration 100:241-250). The source check must prevent stale source use, but a compatible authorization reader should not appear to be a source mutation.
- `internal-ai-gateway.ts:479-485` maps a non-AIRequestFailure from inference authority to 403 `AI_REQUEST_AUTHORIZATION_CHANGED`. Thus a transient 55P03 source-check failure can terminate an otherwise valid native turn before provider dispatch.
- Inbox/read `load` at `task-local-handoffs.ts:31,46` uses FOR SHARE, and Desktop inbox polls at `renderer/src/task-local-handoffs.tsx:54` every five seconds. Read/read locks are compatible; reducing inbox polling does not fix the exclusive authorization lock.

## Deterministic concurrency

An inference transaction locks the native child. A simultaneous heartbeat takes source parent + handoff FOR UPDATE and then waits for that child. Inference attempts its handoff FOR SHARE NOWAIT and fails 55P03 instead of completing. An unrelated project-configuration source read can fail against the same heartbeat lock without taking a child lock.

## Minimal repair proposal

Change only the helper's cloud parent and handoff locks to FOR SHARE; it freezes authority without pretending to mutate it. Keep actual admission/complete/cancel `load(write=true)` FOR UPDATE unchanged. Keep native child/execution FOR UPDATE and the current source checks, budget admission, idempotency and revocation gates.

For consistent ancestry order, call the same read-lock helper before native task locking in inference authority, business tool authorization and inference preflight. No schema migration is needed. These are authorization reads; do not introduce a generic source-check retry that could obscure real withdrawal or replay an accepted model call.

## Proposed new regression

Use a new immutable test file, without altering the executed fixture/tests. Hold a real transaction after the actual helper acquires its locks, and explicitly coordinate a second transaction to run the native content-source check and the real task project-configuration endpoint. They must complete successfully while the first transaction is still held, under a bounded lock timeout. This reproduces the incompatibility reliably without timing a polling interval or replacing the source gate.

Also hold the native child row, start a real heartbeat until it is waiting for that child, and then require the holder's source check to succeed before releasing the child. The heartbeat must finish once released. Assert one native task/reservation and unchanged handoff revision; no duplicate execution/fee.

Finally release readers, withdraw the real handoff / revoke the original source authorization, and require subsequent native source checks and admission to fail. Successful compatible reads must not weaken mutation fences. An actual Responses probe requires a separately owned test provider fixture because the existing control-plane fixture asserts zero provider calls; source-gate tests must not be described as proof of actual OS execution or provider dispatch. The parent owns another complete real Desktop journey after the fix.
