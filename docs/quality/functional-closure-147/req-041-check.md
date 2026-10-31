## REQ-041 — Web-origin work waits for an authorized local step and resumes its original task

> 三端接续：同一任务、设备与产物身份一致；设备离线进入等待，不把依赖本机的步骤误报完成。
> — `docs/requirements/01-srs.md:163`

> Web 发起任务 → 需要本地目录时显示等待设备 → 用户在 Desktop 选择范围 → 本地完成步骤 → Web 审阅产物。多个客户端通过版本及事件同步，重复点击不创建重复任务。
> — `docs/product/02-user-journeys.md:114` (UC11)

> 本机运行 Agent 与本机运行模型是两件事。 Desktop 的会话执行循环、Codex 进程、文件工具和命令执行必须在客户电脑；推理和媒体 AI API 仍走公司内部服务器，不要求本机部署模型。
> — `docs/requirements/03-client-execution-amendment.md:58` (CLIENT01; emphasis removed)

CLIENT01 also requires native stop/checkpoint recovery without automatic cloud replacement (DESK-L05, line 70), and says only the local customer can grant full local permission (DESK-L07, line 72). The bounded bridge below can implement a file-collection step; it does not substitute for the Desktop Codex kernel or general local Agent execution. UC11 requires an original Web task to connect to the appropriate authorized local capability and return its result.

**Verdict:** partial · confidence: high. Confirmed source divergence; no live reproduction was run in this read-only audit. Existing local execution ownership and basic file-command security are implemented. The Web-origin durable local-step handoff in UC11 is absent from the creation, dependency, workflow and bridge-result paths inspected below. This is a functional gap, not only an unexecuted OS/installation matrix.

**Scope and basis:** published documentation HEAD `8755c105dbc831149cefb9e065b3f6e0cf45097c`; platform published HEAD `820d494cd3308ade7cc09d1099b475651783fa1e`. Paths below are relative to `D:/dev/copypasted/自有agent/`. No runtime, tests or Git state was modified. Only this evidence report was written. No browser, Docker, WSL or virtualization was used. Root AGENTS applies; explicit checks found no `docs/AGENTS.md`, `docs/quality/AGENTS.md` or `docs/quality/functional-closure-147/AGENTS.md`.

**What this demands of an implementation:**

- A cloud task started from Web can persist a dependency on customer-local work; offline means waiting with the original task and reservation intact.
- The customer chooses a local directory and operation/OS grant in Desktop. The Web/model cannot manufacture that grant.
- A current owning device executes only the accepted local step. Its result is bound to the original tenant, project, user, task, step and immutable content version.
- Reconnecting/reloading may deliver an unstarted request or submit an already produced result; it must not silently repeat an uncertain OS write, run a second model task, or bill the original work twice.
- Web receives the real result and the original cloud task can continue. Keeping all work local, changing the cloud task into a Desktop task, or requiring manual copy/upload does not implement this original journey.

---

**Where enforcement lives and what already holds:**

| Enforcement inspected | Actual behavior |
|---|---|
| `dev/copypaste-platform/src/server.ts:452-478`; `src/business.ts:552,643-904` | Business/device, native execution, task dependency and cloud workflow route registrations are active. This is not an unregistered-handler finding. |
| `dev/copypaste-platform/src/business.ts:643-719` | A device belongs to the authenticated user; creation requires native audience and future, operation-specific folder grants. |
| `dev/copypaste-platform/src/business.ts:720-775` | Revoke cancels pending/claimed commands. Native command polling locks the active owning device, updates last-seen, expires overdue pending commands and claims live pending commands. |
| `dev/copypaste-platform/src/business.ts:777-839` | A Web user can explicitly schedule `file.list`, `file.read` or create-only `file.write` against an already registered, unexpired grant. Optional `task_id` checks task project access, but causes no task/dependency transition. Command creation is idempotent. |
| `dev/copypaste-platform/src/device-signing.ts:8-46` | The server signs a canonical envelope containing command, device, tenant, operation, payload, nonce and expiry with its domain-separated Ed25519 key. |
| `dev/copypaste-desktop/src/main.ts:511-553,558-629` | The customer explicitly chooses a directory and read-only/create-output grant. Pairing is bound to current native login. Polling verifies the command signer and envelope, then invokes the local file executor. |
| `dev/copypaste-desktop/src/files.ts:148-237` | Serialized local execution checks command expiry, current grant/operation, nonce digest and canonical grant path. Completed results are journaled and reused for the same nonce/input. Reads preserve actual bytes and SHA; writes use exclusive creation. |
| `dev/copypaste-platform/src/task-service.ts:97-112,122-142,259-351` | Desktop login cannot silently submit cloud work. Parent task execution location must match the child location. Initial task reservation, dependency staging and cloud-only dispatch are atomic. |
| `dev/copypaste-platform/src/desktop-family.ts:5-25`; `src/desktop-executions.ts:657-789,809-884` | Local Codex execution has a current Desktop family; task creation binds user/project/device/local session/workspace/runtime. Start rechecks that binding and claims a single local owner/capacity. |
| `dev/copypaste-platform/src/worker.ts:421-430`; `migrations/092-desktop-execution-ownership.sql:68-88` | The cloud worker excludes Desktop tasks and execution location is immutable. These protections must remain. |
| `dev/copypaste-platform/src/paid-task-inputs.ts:22-46,48-118,185-217,245-325`; `src/task-dependencies.ts:298-422` | Completed, metered cloud turns can wait for explicit file/connection/question input, preserve the reservation, then queue the same task/thread and cumulative usage. Existing replay, version and source checks are suitable reuse points. |

---

**Confirmed gaps / paths walked:**

### F041-1 — No Web task/dependency handoff to a Desktop-selected local step

1. Unified creation `POST /v1/tasks` explicitly lists `device_id` as unsupported and returns `TASK_CONTRACT_CAPABILITY_UNAVAILABLE` (`dev/copypaste-platform/src/canonical-tasks.ts:377-404`).
2. The dedicated task API accepts `inputDependencies`; its schema permits only file, connection and question (`src/tasks.ts:88-100`; `src/task-dependencies.ts:14-43`). The paid-turn request schema has the same three types (`src/paid-task-inputs.ts:22-46`).
3. The Web task input UI searches existing project resources, uploads a file, or opens Connections. It has no request/accept state for a Desktop-owned step (`dev/copypaste-web/src/task-dependencies.tsx:18-89,91-170,185-291`). Its successful resolution submits selected asset versions or an answer, not a local request identity.
4. The shared workflow definition supports only `codex`, `approval` and `analytics.summary` (`dev/copypaste-platform/src/desktop-workflows.ts:22-35`; cloud alias `src/cloud-workflows.ts:38`). The cloud validator checks those types (`src/cloud-workflows.ts:106-168`) and advancement creates cloud children through `enqueueTask` (`src/cloud-workflows.ts:857-920,948-1019,1020-1058`). No branch creates a local request or waits for a native decision.
5. The Devices page is independent of task inputs. It schedules against an existing grant and does not submit `task_id` (`dev/copypaste-web/src/main.tsx:2599-2659`). A file result is displayed as raw command result, not uploaded/bound/resolved into the original task.
6. The bridge result handler only updates `device_commands.state/result` and returns `{ok:true}` (`dev/copypaste-platform/src/business.ts:861-902`). It does not create a private immutable asset, resolve a task dependency, queue original continuation or append a result to a workflow.

**Consequence:** UC11 cannot currently be completed from the product. A customer can manually upload a local file or separately inspect a bounded device-command response, but that does not provide the specified persisted, task-bound local-step wait/continue flow.

### F041-2 — Existing bridge polling cannot be reused unchanged for offline/reconnect delivery

- Creation fixes command expiry to two minutes (`dev/copypaste-platform/src/business.ts:833-834`). Reconnection after that interval marks still-pending commands expired and returns no executable request (`:759-772`). The Web UI accurately warns that the device must be online (`dev/copypaste-web/src/main.tsx:2688-2691`). This is an explicit bounded-command feature, not durable offline task waiting.
- A poll changes the row from pending to claimed **before** the client receives it (`business.ts:769`). Only pending rows are returned on later polls. If that response is lost, the same row is not redelivered; no claim receipt/lease recovery exists in these routes.
- The Desktop client executes a command, then submits its result once (`dev/copypaste-desktop/src/main.ts:609-621`). The outer error handler does not persist a pending result submission (`:624-628`). If execution completed but submission failed, the file executor's local completed journal exists, but subsequent server polling never supplies the claimed command again.
- Result submission accepts only claimed and still-unexpired rows (`dev/copypaste-platform/src/business.ts:888-899`), with no idempotent replay of an identical completed receipt. A successful commit with a lost response therefore cannot be acknowledged by a retry through this endpoint.

**Consequence:** a new local-step feature must retain result-submission and admission state; simply increasing the two-minute timeout or polling again is insufficient. Do not indiscriminately reclaim uncertain writes: local journaling helps known-completed retries, but it is not proof that an arbitrary unreported OS effect never ran.

### Native parent/run identity is intentionally separate, not a workaround

`dev/copypaste-platform/src/desktop-workflows.ts:46-63` requires a live Desktop root task/execution, a Desktop workflow run and current child cursor; `dev/copypaste-desktop/src/local-workflow.ts:58-77,113-149` admits only a new local run and executes its local children. That path cannot resume a Web-origin cloud parent. `src/desktop-executions.ts:1351-1420` fences lost owners and moves uncertain in-flight executions to reconciliation; changing that into automatic replay would weaken an existing required invariant.

---

**Minimal source-derived reproduction (not executed):**

1. Log in to Web, create a delegation requiring a local source file, and reach its pending file input.
2. Observe that the input UI offers existing asset versions/upload, with no Desktop request/choice/accept path. Creating the canonical task with `device_id` returns the explicit unsupported-capability error.
3. As the same user, register/authorize a Desktop folder, close Desktop, and create a bounded `file.read` device command associated with that task through the API.
4. Reopen Desktop after the command expiry: polling expires the command and returns no executable request. The original task dependency remains pending. Even if the device was online and returned content successfully, the result handler does not resolve the task or create an asset.
5. Alternative fault: commit the command-claim poll but drop its response, then poll again. The old claimed command is not returned. Or let local execution finish and drop the result submission: no client outbox retries the receipt.

**Searched (search scope and actual results):**

- `rg -n -e waiting_device -e needs_device -e device_offline -e DEVICE_OFFLINE -e awaiting_device src migrations tests`: only `src/task-events.ts:26` names `waiting_device`; it is accepted event vocabulary, not a state transition. This search alone was not used to conclude absence.
- `rg -n -e device_commands src`: ten hits across `business.ts`, `admin.ts`, `desktop-disconnect-routes.ts`, `desktop-pairing-routes.ts`, `paid-task-inputs.ts`. Business contains the only create/claim/result paths; other hits cancel commands or block uncertain paid continuation. No task result integration is hidden there.
- `rg -n -e device -e operation -e inputDependency src/canonical-tasks.ts src/tasks.ts src/task-business-tools.ts src/task-service.ts src/task-dependencies.ts`: canonical `device_id` rejection, current input schema, and unrelated tool operations; no native task-input requester.
- `rg -n -e /commands -e commandId -e command_id -e /devices` over Web/Desktop/Extension source: Web/Desktop Devices page creates and reads bounded commands; Desktop main polls/submits results; Extension does not implement this server-device command handoff.
- Read the active route registrations, bridge command create/claim/result handlers, native file executor, task creation/dependency resolution, cloud workflow validation/advancement, native creation/start admission, and native lost-owner recovery. Relevant exact ranges are listed in the tables and paths above. The initial glob attempts against nonexistent `renderer/src` in platform/Web and shell wildcard filenames were corrected; they are not evidence of absence.

---

**Implementation entry points / smallest correct integration (proposal, not existing behavior):**

1. Add a durable, private local-step request bound to the **original Web task + checkpoint/dependency + current user/project + immutable request hash**. Its waiting phase must not create an executable OS command or a second AI reservation while the device is offline. The Web task/input panel should display the actual waiting device/step and permit cancellation.
2. On Desktop, show the pending request separately from starting an unrelated local chat. Use current native family/device admission, actual customer directory/OS grant and explicit accepted prompt/role/budget before local execution. Reuse `files.ts` for a bounded local-file collection step; reuse `desktop-executions.ts`/local Codex for a general native Agent step. A general native step needs its own linked native-owned execution identity; do not flip the original cloud task's immutable `execution_location` or relax the generic parent-location check.
3. Persist exact step admission and result-submission intent locally. Server retries should acknowledge the same request/result identity and SHA. Unknown writes remain blocked/reconciling; known-completed results may be resubmitted without rerunning the local action or Codex.
4. In one current-authority transaction, accept and store the actual result as private immutable content, finish the local command/result receipt, and resolve the original dependency. Reuse `resolveInputSelections` (`task-dependencies.ts:291`)/paid checkpoint continuation for the original cloud task, reservation and thread. A pending/claimed legacy command currently blocks `paidInputCheckpoint` (`paid-task-inputs.ts:198-215`), so finishing the bound command must precede dependency resolution in that same transaction.
5. Revalidate task content, user/project rights, owning device/family/grant, original dependency version and request hash at accept, result upload, resume and Web download. Revoke/cancel must stop future admission and clear current views while preserving uncertain financial/action records.

**How the verdict was reached:** partial, rather than wholly absent or contradicted, because existing shared task identities, native execution ownership, signed bounded file commands and paid-turn continuation are real. The missing piece is their durable, customer-authorized Web-to-local-step integration. Neither a status label nor a new all-local resume button closes UC11.

**Open questions / not checked:** live network-fault reproduction; all OS/DPI/signed-install combinations; arbitrary local app operations; production model professional quality; cross-device reassignment of an already started step. This audit does not claim those are satisfied and does not prescribe automatic replay for them. Independent refutation and runtime validation are required before reporting the gap as a closed feature.
