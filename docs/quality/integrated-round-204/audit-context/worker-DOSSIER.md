# Worker context dossier · round 204

Scope: context building only; no bug verdict, chosen fix, source changes, test execution, or server changes. Baseline: platform Git `bb36f993347cc529ddb317f6bf5284a43bf103cb` (round 203). All source locations below are relative to `dev/copypaste-platform` at that commit. Concurrent round 204 edits are outside this snapshot.

## Execution map

`start → dispatch/outbox → PgBoss job → run → atomic capacity claim → heartbeat + Codex runtime/tools → stopHeartbeat → finish → settlement → active.delete`.

| Boundary | Observed authority and serialization | Evidence |
|---|---|---|
| Claim | Tenant/actor/source/role/capability authorization; task `FOR UPDATE`; capacity advisory lock; new attempt/fence and 45-second lease committed before runtime starts | `src/worker.ts:425–520`; migrations `089:8–54`, `092:98–115`, `154:4–15`, `162:32–35` |
| Heartbeat | 3-second interval, one in-flight callback; authorization transaction; task deadline updated using transaction-start `now()` | `src/worker.ts:521–598` |
| Native tool | Transaction-scoped task-tool advisory lock; live scoped authority; task `FOR SHARE NOWAIT`; replay/receipt guard; same transaction remains open across awaited tool/native/filesystem work | `src/task-business-tools.ts:223–277`; `src/task-pause.ts:7–17`; `src/task-tool-reuse.ts:4–8,23–105` |
| Events | `event` inserts a row, whose trigger also updates `tasks.last_event_seq` | `src/tasks.ts:23–36`; `migrations/020-durable-event-sequences.sql:14–24` |
| Expiration | Separate control-pool queries mark all expired running tasks reconciling, then reserved holds reconciling; no automatic replay | `src/worker.ts:225–232` |
| Finish | Join pending heartbeat first; control transaction locks same fenced task; returns immediately unless still running; reconcile uncertainty instead of inventing zero cost | `src/worker.ts:714–775,834–885,1009–1032`; `src/billing.ts:173–205` |
| Desktop | Same legacy task lease but separate owner/family/startup checks, authenticated inference renewal, received-before-expiry renewal evidence, local finish/recovery | `src/desktop-executions.ts:227–230,392–443,1081–1115,1183–1224,1414–1475` |

## Locks and clock facts

Task `FOR SHARE` blocks another transaction's ordinary row update. Thus retaining the tool's task authority lock across native work and renewing `tasks.lease_until` are directly coupled. Events create another task-row write, even when their TypeScript caller only appears to insert. Foreign-key checks add parent-key locks: tool receipts reference the composite task key (`090:7`); native execution, events, operations and finance also reference tasks (`001:95–120`, `092:16`). FK key-share locks differ from explicit share locks. See [PostgreSQL's lock matrix](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS) and [referential-integrity implementation](https://doxygen.postgresql.org/ri__triggers_8c_source.html).

`Database.tx` holds its connection and all transaction-scoped locks until callback completion and COMMIT/ROLLBACK (`src/db.ts:24–64`). No generic lock, statement, pool-acquisition or callback deadline is set there. Heartbeats use the application pool (max 12), while dispatch/finish can use the control pool (max 6). A different pool does not bypass a conflicting row lock (`src/db.ts:10–18,31`).

`now()` is transaction start time; `clock_timestamp()` advances inside a transaction. A heartbeat waiting on a lock therefore does not obtain a fresh wall clock from its existing `now()` expression. This is a clock/transaction fact, not proof of the historical incident's cause. [PostgreSQL date/time functions](https://www.postgresql.org/docs/18/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT).

Intervals, promise continuations, abort callbacks and heartbeat cleanup run on the Worker process's Node event loop (`src/worker.ts:184–190,521–598`). The callback awaits database/source checks; `checking` suppresses further heartbeats while one is pending. There is no separate heartbeat process in this path. Filesystem writes are awaited asynchronous calls (`src/code-workspace.ts:75–104`); the retained incident alone does not establish an event-loop stall.

## Retained round 203 incident

Evidence remains unchanged under delivery `.data/acceptance-203/`. No credential or raw tool argument is reproduced.

| Evidence | Observed fact |
|---|---|
| `settlement-diagnosis-v1.private.json` | 18 completed requests (9 counting, 9 generation), known usage; 28 retained native records |
| Last `exec` | `2026-11-06T12:16:49.855Z`; calls `code_write` |
| Its next native output | `12:17:33.483Z`, **“Script running with cell ID 9”**, reported wall time 31.6 seconds; yielded work, not a completed write receipt |
| Subsequent native records | `token_count` at `12:17:34.459Z`; `turn_aborted` at `12:17:35.088Z` |
| `lease-diagnosis-v2.private.json` | Later snapshot: task reconciling / `WORKER_LEASE_EXPIRED`, lease `12:17:36.601Z`, hold reconciling; two earlier completed code writes and two browser receipts, no third completed write receipt |
| Lock evidence | Saved activity is empty and logs have no lines. This later snapshot cannot reconstruct the earlier blocker, wait duration, pool pressure or event-loop delay |

The call-message-to-yield interval is 43.628 seconds. It must not be described as a completed 44-second write. The later stored lease and the earlier abort record are separate observations; their ordering does not establish the unique causal chain. A subsequently retained Admin settlement receipt records actual cost `250508` micros and terminal `PROVIDER_COST_RECONCILED`; the initial diagnostic's zero charged field is not the final financial outcome.

SHA-256: lease diagnosis `F5143BD49D291811F2CDCFD6C51262C16F4D0C8045E3DC59BD06D29377CD0A52`; settlement diagnosis `6FEB173690131A6C33D35E2C653D3562DB6CDA2BC0D4A5AF5FD3729AADACA7F9`.

## Cross-file invariants for the complete implementation batch

1. Claim must remain atomic with task status, immutable owner, attempt, fresh fence, capacity admission and the original reservation. Cloud and Desktop placement cannot claim each other (`089`, `092`, `154`, `162`).
2. Liveness cannot replace source/role/capability/project/actor authorization, pause intent, revocation, cancellation or erasure. Tool share locks protect the authorization-to-effect interval (`task-business-tools:223–263`, `task-pause:7–17`).
3. A renewal cannot revive a stale fence, finished/cancelled/reconciling owner, or an expired Desktop native credential. Finishing must quiesce the renewal callback and leave no active terminal lease (`worker:592–598,750–775`; Desktop tests cited in lease map).
4. Every provider admission, dispatch, origin recovery, media origin and checkpoint/receipt guard must consume the same authoritative deadline for its placement. The complete literal map and SQL helper names are in [worker-lease-map.md](worker-lease-map.md).
5. Expiration is uncertainty, not proof of zero spend or permission to replay. Preserve provider request receipts, held capacity, existing reservations, billing actor and journal uniqueness (`provider-request-control:77–89`; `billing:181–205,249–306`; `089:18–23`; `162:10–26`).
6. Events and FK parent locks belong in the lock order. A separate row by itself does not imply that its INSERT or trigger call avoids the task row. Respect task-before-desktop-execution ordering and source NOWAIT rules (`desktop-executions:394–405`; `020:16`; `090:7`; `task-content-sources:8–30`).
7. Legacy Desktop timing and its received-before-expiry pending renewal evidence must retain meaning; independently leased media/connector/verification/publication jobs must retain their own lease namespaces.

## Analysis files and open questions

[run](worker-run.md), [heartbeat](worker-heartbeat.md), [dispatch](worker-dispatch.md), [finish](worker-finish.md), [stop](worker-stop.md), [transaction](database-tx.md), [tool transaction](tool-transaction.md), [event](task-event.md), [lease inventory and tests](worker-lease-map.md), [complete literal/FK index](worker-literal-index.md).

- Which SQL function definitions and role-specific settings were actually installed during the incident? Source migration composition is mapped; no live DB inspection was authorized in this child audit.
- Which task/source/event transaction, pool wait or native operation was in flight when the heartbeat stopped progressing? Historical wait graph, heartbeat start/end stamps, connection acquisition timings and loop lag were not retained.
- Why did native `turn_aborted` precede the deadline value seen in the later snapshot? In-flight renewal timing and abort reason are not established by these records.
- Native process/gateway cleanup behavior is delegated to the runtime context audit; this dossier establishes Worker's joins/abort behavior and transactional native-tool boundaries only.

All questions remain explicit. No tests were run, no production files changed, and no server/network operation occurred in this audit.
