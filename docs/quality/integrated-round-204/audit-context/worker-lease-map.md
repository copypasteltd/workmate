# Task lease references and compatibility boundaries

Baseline: platform `bb36f993347cc529ddb317f6bf5284a43bf103cb`. This is a read-only context map, not a selected implementation. All literal `lease_until` occurrences in baseline `src/`, `migrations/`, and `tests/` are indexed in [worker-literal-index.md](worker-literal-index.md), including unrelated lease namespaces. Locations below refer specifically to **tasks.lease_until**. Reads via a fetched task object are included; implicit `SELECT *` consumers still require placement-aware interpretation by their caller.

## TypeScript production reads and writes

| File and baseline lines | Kind | Contract |
|---|---|---|
| `src/worker.ts:228` | Read | Global running-task expiry -> reconciling, `WORKER_LEASE_EXPIRED`; no placement predicate |
| `src/worker.ts:579` | Write | Cloud heartbeat, same task/fence, transaction-start `now()+45s` |
| `src/worker.ts:1010` | Write | Cloud finish clears legacy deadline |
| `src/worker.ts:1116` | Read | Task/provider/tool authority requires running, active, non-cancelled scoped owner/fence and live deadline |
| `src/provider-request-control.ts:83` | Read | Dispatched provider generation/count request becomes unknown when its task origin is no longer active; retain uncertainty/capacity, no replay |
| `src/audio-authorizations.ts:192,203` | Read | Origin attempt/fence/task authorization invalidation must use current task deadline |
| `src/audio-production.ts:51,362` | Read | Active audio origin and queued origin recovery are task-scope checks, distinct from audio-job ownership |
| `src/video-jobs.ts:43` | Read | Active video task-origin authority; this file also has **ai_video_jobs** independent leases (167,203,338–347,397) |
| `src/paid-task-inputs.ts:296` | Write | Completed measured turn -> needs_input; clears deadline |
| `src/task-pause.ts:31` | Write | Completed measured turn -> paused; clears deadline |
| `src/task-dependencies.ts:217,226` | Write | Invalidated plan -> cancelled / needs_input; clear deadline |
| `src/seo-changes.ts:107` | Write | Revoked SEO-change source -> cancelled; clear deadline |
| `src/desktop-executions.ts:228` | Read | `liveRenewal`: heartbeat arrival before stored expiry plus same active company-call family/fence |
| `src/desktop-executions.ts:375` | Read | `authorize`: running task/native execution, active content, credential and deadline; may compare the authenticated observed arrival time |
| `src/desktop-executions.ts:441` | Write | Authenticated still-live inference activity extends legacy Desktop deadline using `clock_timestamp()+45s` |
| `src/desktop-executions.ts:567` | Read/output | `publicExecution` exposes deadline to local client |
| `src/desktop-executions.ts:1106` | Write | Native heartbeat, after scoped ownership, current authorization and provider receipt; completion clock +45s |
| `src/desktop-executions.ts:1197,1207` | Read / clear | Finish treats expired owner as uncertainty except independently proved unstarted; clears lease before settlement |
| `src/desktop-executions.ts:1417,1420,1458,1466` | Read / clear | Recovery scans expiry, respects pending timely renewal for actual operation (1424–1429), locks task then execution, rechecks and clears |
| `src/desktop-startup-recovery.ts:74,151` | Read / write | Current startup deadline plus task lease; one scoped zero-admission recovery can renew task lease within original reservation |
| `src/desktop-video-origin.ts:21` | Read | Local video origin retains native execution and current task deadline |
| `src/desktop-workflows.ts:65` | Read | Native workflow root retains local owner and current task deadline |

All other TypeScript files with the same field spelling refer to invitation delivery, deletion jobs, capability validations/suites, connectors, creative matrix attempts, render jobs, SEO runs, publication operations or external-budget operations. Their own leases are independent and are not task-deadline reads.

## SQL definitions / consumers

These functions also enforce existing actor, tenant/project, native ownership, content, cancellation, capability, reservation, attempt and fence conditions. A deadline change does not replace those conditions. Some functions are used by policy/trigger calls even when TypeScript contains no literal lease comparison.

| Migration and lines | Function / role | Applicability |
|---|---|---|
| `001-foundation.sql:88` | Column definition | Shared legacy task field |
| `029-execution-capacity.sql:74` | Original `claim_execution_capacity` write | Superseded by089 |
| `089-paid-checkpoint-capacity.sql:8,28,52–54` | Atomic task/capacity claim; status, attempt, fence, lease | Shared implementation renamed `claim_execution_capacity_v89` by092:98; cloud and Desktop wrappers092:100–115 |
| `154-running-pause-capacity.sql:4–15` | Patches v89 continuation gate to include measured pause checkpoints | Must retain exact cost/thread/turn/attempt/hold checks |
| `162-terminated-desktop-execution-capacity.sql:12,32–35` | `task_occupies_execution_slot` and patched v89 counts | Lease-null exception applies only to independently terminated Desktop work without held/unknown side effects; cloud reconciling still occupies slot |
| `066-durable-provider-requests.sql:213` | `admit_ai_gateway_request` | Task generation admission uses wall clock; validation branch223 has a different lease |
| `066-durable-provider-requests.sql:279` | `dispatch_ai_gateway_request` | Rechecks task origin/fence/deadline at dispatch; validation branch281 is independent |
| `067-per-request-budget-enforcement.sql:392` | `admit_ai_input_count_request` | Task counting admission; validation402 independent |
| `067-per-request-budget-enforcement.sql:460` | `dispatch_ai_input_count_request` | Task counting dispatch; validation462 independent |
| `088-paid-input-checkpoints.sql:45` | Old `guard_paid_input_checkpoint` | Superseded by091 |
| `091-paid-checkpoint-turn-boundaries.sql:16,30` | `guard_paid_input_checkpoint` | Insert and completion require live task lease plus actual native turn / measured costs |
| `090-completed-task-tool-receipts.sql:33` | `guard_task_tool_receipt` | Insert requires active running owner, live lease, attempt/fence and scoped output lineage |
| `093-desktop-video-origin.sql:20,54` | `check_private_video_project`, `check_desktop_video_origin` | Desktop-specific scope predicates; preserve legacy ownership |
| `094-desktop-workflow-origin.sql:99,140` | `check_native_workflow_scope`, `check_native_workflow_step` | Desktop-specific root authority |
| `097-generated-video-jobs.sql:266` | `prepare_ai_video_job` | Task-origin scope; ai_video_jobs has a separate worker lease |
| `101-internal-audio-production.sql:184` | `prepare_ai_audio_job` | Task-origin scope; audio validation/suite leases are unrelated |
| `102-audio-customer-authorizations.sql:60,99` | `guard_audio_authorization` | Task-origin audio authorization both insertion and relevant updates |
| `105-private-cloud-workflows.sql:81` | `check_private_cloud_workflow` | Private cloud workflow task root |
| `133-desktop-startup-recovery.sql:113,121` | `guard_desktop_startup_state` | Desktop startup state transition and deadline authority |

The complete literal scan found no additional task deadline reference in migration146; its lease fields are connector-job erasure allowances. SQL deployment can compose/rename functions using `pg_get_functiondef` (e.g.092/154/162), so a new migration needs the actual final function definitions, not only the first historical definition. This audit did not query production `pg_proc`, policies or triggers.

## Existing test contracts (read, not executed)

| Test source | Established expectation |
|---|---|
| `tests/runtime-startup-billing.test.ts:219–227`; `tests/seo-change-tasks.test.ts:214–222` and202-v1 copy | Completed work has null lease; late heartbeat cannot retain it |
| `tests/paid-task-inputs.test.ts:916–954` | Correct native scope without a live lease cannot insert a checkpoint; test intentionally nulls/restores task deadline |
| `tests/paid-task-inputs.test.ts:782–837` | Continuation waiting for occupied capacity neither reruns model nor consumes an extra attempt; fixture directly edits task lease |
| `tests/provider-request-control.test.ts:744–779` | Expired task causes an orphan dispatched request to become unknown once; no replay, no fabricated zero cost, capacity retained |
| `tests/execution-capacity.test.ts:468–493` | Cloud uncertain paid execution still occupies capacity when deadline has passed; unclaimed input wait occupies none |
| `tests/desktop-executions-139-v3.test.ts:547–568` | Actual company operation may hold task lock across expiry; timely same-owner heartbeat survives, renewal uses completion wall clock (>35s), no cloud outbox replay |
| `tests/desktop-executions-139-v3.test.ts:588–612` | Native finished/reconciling may free execution slot only without unreleased provider capacity; hold remains reconciling and cost is not invented |
| `tests/desktop-executions-139-v3.test.ts:616–629` | Authenticated live inference renews; expired or completed local execution cannot be revived or call provider |
| `tests/task-tool-protocol-199.ts:1–15` | Only explicit pre-admission `TASK_CONTROL_CHANGING`409 may be retried with original key; pause, unknown outcomes and provider errors must not replay |

The literal index includes all direct test deadline injections. Many fixtures create a running task with `UPDATE tasks ... lease_until=now()+5 minutes` without invoking claim. Others deliberately expire or clear that exact field. These are explicit test premises; treating a second stale field as authority solely to preserve fixture behavior would not establish production correctness. Source-only reading does not claim these tests pass on any new design.

## FK and lock coupling

`task_tool_receipts` composite task FK (`090:7`), events/operations/ledger/holds/allocations/device commands (`001:95–120,174`) and Desktop execution (`092:16`) reference the task. The complete baseline FK location index has 63 literal declarations; it is included in the companion index. PostgreSQL FK parent verification uses key-share, compatible with a non-key UPDATE but incompatible with explicit parent FOR UPDATE. Tool pause authority is stronger FOR SHARE and conflicts with ordinary task UPDATE. Events go further: their BEFORE INSERT trigger updates task sequence (`020:14–24`). [Official row-lock matrix](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS), [FK source](https://doxygen.postgresql.org/ri__triggers_8c_source.html).

Open questions: actual installed function/policy composition and any migration-induced FK/trigger side effects must be established from final code/deployment. This inventory chooses no schema or lock strategy and does not weaken the existing tool authority lock.
