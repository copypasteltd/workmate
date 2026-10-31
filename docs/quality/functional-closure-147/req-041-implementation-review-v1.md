## REQ-041 / UC11 — Independent review of the stage147 local-step implementation

> 三端接续：同一任务、设备与产物身份一致；设备离线进入等待，不把依赖本机的步骤误报完成。
> — `docs/requirements/01-srs.md:163`

> Web 发起任务 → 需要本地目录时显示等待设备 → 用户在 Desktop 选择范围 → 本地完成步骤 → Web 审阅产物。多个客户端通过版本及事件同步，重复点击不创建重复任务。
> — `docs/product/02-user-journeys.md:114`, UC11

CLIENT01 remains authoritative: Desktop runs the customer-local Codex process, supports locally granted OS permissions and does not silently transfer execution to cloud (`docs/requirements/03-client-execution-amendment.md:58,70,72`). A native API report is not independent proof of OS execution.

**Review result:** two confirmed actionable issues in the implementation read for this v1 review. The original Web-to-Desktop admission/return integration now exists; the two issues below concern upload privacy and isolation of revoked inbox entries. This review does not mark REQ-041 or CLIENT01 fully accepted.

**Method and scope:** independent read-only source/refutation review of the new handler, migration141, native admission, actual Desktop caller/runner, Web/renderer and Extension input/return UI. No product, tests, scripts, Git, database or runtime was changed or executed. No browser, Docker, WSL or virtualization was used. All commands explicitly used `D:/dev/copypasted/自有agent/`. The parent is separately running backend-05/UI-01; this report does not claim their results. Only this report was written for the implementation-review task. Paths below are root-relative and line numbers describe the reviewed source before any follow-up repair.

---

### I041-01 — P1: a private task without a conversation silently uploads shared project files

**Confirmed path and consequence:** the new Web/Desktop return modal says files will enter the original private conversation whenever `source_private` is true. A legitimate private cloud task can have `conversation_id = null`. The upload UI still opens, drops that null binding, and the existing upload service creates a project-shared asset. The file becomes visible beyond the private task before `/complete` is called. A later dependency validation failure cannot undo that exposure.

**Exact enforcement/callers read:**

- `dev/copypaste-platform/src/task-local-handoffs.ts:29-35,55-66`: parent admission allows the owner's private cloud task without requiring a conversation; `source_private` is only `!!t.private_owner`.
- `dev/copypaste-platform/src/solution-service.ts:583-603` creates real cloud solution-trial tasks without a conversation argument. `src/task-service.ts:280-288` stores `conversation_id = options.conversation?.id ?? null` while `solution_trial` makes the task private. These are reachable private tasks, not an imagined malformed database state. A later paid `request_input` can create their pending file dependency through the existing input mechanism.
- `dev/copypaste-web/src/task-local-handoffs.tsx:37,43-44` and the identical Desktop renderer component display the private notice, enable upload with any loaded task, then pass `item.source_private ? task.data.conversation_id : undefined`. Neither requires a nonempty conversation when the source is private.
- `dev/copypaste-web/src/resumable-upload.tsx:113-127` omits `conversation_id` when falsy. The Desktop renderer uses the same uploader behavior.
- `dev/copypaste-platform/src/uploads.ts:199-209,234-245,456-473` accepts an upload with no conversation and passes no task/private-owner scope to `saveAssetFile`.
- `src/storage.ts:349-382,434-435` defaults the new asset's private owner to null unless an actual conversation, explicit private owner or source task was supplied. No such source is supplied by this upload request.

**Minimal reproduction (source-derived, not executed):** create a cloud solution trial, reach a requested file input, request its local preparation, finish that native step, open its return modal in Web or Desktop, and select a confidential file for upload. Observe that the source task is private with no conversation but the upload request has no `conversation_id`; the resulting asset has `private_owner = null`. Another project member can then access it under ordinary project-file rules. The private notice is therefore false for this reachable source type.

**Smallest repair:** carry a server-validated original-task/private upload scope through the upload session and final save, or explicitly block this upload path when a private source has no valid private conversation until that scope exists. Do not silently fall back to shared project uploads or invent an unrelated conversation. Reuse the existing private-artifact support in `storage.ts`; revalidate the original task and handoff on upload admission/finalization. Preserve the explicit shared-project warning for sources that really are shared.

**Refutation attempted:** the UI already disables upload while the task is missing or errors; that correctly prevents a loading/error fallback, but does not cover an actual loaded private task whose conversation is null. `saveAssetFile` can inherit privacy from a source task, but this caller supplies neither task metadata nor explicit private owner. The confirmed issue is not arbitrary existing private-file access.

---

### I041-02 — P2: one revoked historical source blocks unrelated Desktop inbox requests

**Confirmed path and consequence:** project-level `GET /local-handoffs` selects entries whose parent task remains active and unexpired, then calls `load` sequentially for every entry. `load` rechecks the full parent content sources; one withdrawn source throws and aborts the whole list. The Desktop main page uses this project inbox, so a revoked older request prevents the same user from discovering or accepting other valid local requests. Even cancelled historical requests remain selected.

**Exact enforcement/callers read:**

- `dev/copypaste-platform/src/task-local-handoffs.ts:29-35`: `parentAccess` calls `assertTaskContentSources` after checking current project/user/cloud-task scope.
- `:113-124`: the SQL filters parent `content_state`/retention but does not filter source validity or terminal handoff states; the loop has no per-entry recovery around `load`.
- `dev/copypaste-platform/src/task-content-sources.ts:7-30`: invalid source manifests throw `TASK_SOURCE_REVOKED`; a source lock conflict throws `TASK_SOURCE_BUSY`. Those errors escape the list loop.
- `dev/copypaste-desktop/renderer/src/local-agent.tsx:217-221` mounts `TaskLocalHandoffs` without a task filter. `renderer/src/task-local-handoffs.tsx:54-62` hides all items on list errors. The same component exists in Web, whose task-filtered view is not blocked by a different task's entry.

**Minimal reproduction (source-derived, not executed):** the same customer has two waiting cloud tasks A and B with local requests in one project. Withdraw a file/configuration source used by A while A's task content remains active. Open the Desktop inbox: A is selected; `load(A)` throws; B is never returned despite retaining all its own authority. Cancelling A's local request does not remove the selected history row or make A's sources available.

**Smallest repair:** isolate per-item source validation using a safe transaction/savepoint boundary and omit inaccessible entries, or emit a properly redacted terminal/unavailable receipt while continuing authorized entries. Maintain stable pagination; do not return A's old title, prompt or source description after access withdrawal. Preserve direct GET/admission/return denial for the revoked request.

**Refutation attempted:** failing the entire list is safe against disclosure, and a tenant/project access revocation should indeed deny the whole inbox. This case is a single task's source withdrawal while the user/project and B remain authorized. It is therefore a recoverability defect, not a request to weaken authorization.

---

**Confirmed implemented paths / attempted refutations that did not reveal another defect:**

| Property | Actual source path and limit |
|---|---|
| Durable offline request | `task-local-handoffs.ts:132-158` inserts a frozen waiting request and emits `waiting_device`; it creates no native task/reservation while the device is offline. Migration141 `:3-33` retains private owner-scoped receipts and limits each dependency to one waiting/working request. This is independent of the old two-minute file-command bridge. |
| Fixed original request and native identity | `task-local-handoffs.ts:38-50,84-101` compares original prompt/dependency hashes and version, current source authority, exact native prompt/role/budget, device/local-session/family/workspace/runtime binding. An existing admitted binding returns the same task; another device/session cannot silently take it over. `desktop-executions.ts:663-701,761-798` uses current native family and ordinary native task admission, without changing the original task's immutable cloud location. |
| Actual local Codex caller | Desktop `main.ts:184-208` supplies real folder selection and native OS consent; `local-agent.ts:612-660` prepares a local session and persists its handoff binding. The default runtime factory is `new LocalCodexSession` (`:213-217`); `execute` builds the pinned local executable profile with company inference, workspace and local grant (`:1406-1444`) and calls `runtime.turn` (`:1604-1624`). These are real code paths. This review did not execute them or certify their OS results. |
| Separate OS and fee/start approval | `local-agent.ts:637-638,662-684` uses native consent independently of `startHandoff`. Renderer `local-agent.tsx:298-304` separately shows the fixed local budget and a fee/start button; only that action creates the persisted operation (`local-agent.ts:649-658`). Web request text explicitly says no OS grant/model start and retains the original reservation (`task-local-handoffs.tsx:22-26`). |
| Duplicate clicks / lost create response | Web request replay plus unique live dependency (`task-local-handoffs.ts:143-155`, migration141 `:24`); native exact-binding reuse (`:84-101`) occurs before cached response replay (`desktop-executions.ts:675-693`). Desktop persists create/start/finish/cancel keys before the native create request (`local-agent.ts:655-658,1298-1317`). The same operation can retry accepting/starting; no alternate task is silently admitted. |
| Lost result acknowledgement / uncertain native effects | `local-agent.ts:1617-1626` persists the known report before sending; `:1225-1240` sends the fixed report/finish key. `retry :725-743` permits accepting/starting/settling, not replay of an accepted native turn. `/finish` fences and compares the exact report hash before settlement (`desktop-executions.ts:1138-1166`); already finished/reconciling execution returns its receipt. Accepted unknown execution remains reconciling (`local-agent.ts:1628-1651`). |
| Revocation and source changes | Migration141 `:67-88,95-112` adds the original task to native source traversal; `:115-142` freezes task/device binding; `:144-159` invalidates active requests when the parent changes out of waiting. Native `authorize` checks current family, project, role/Skills and task sources (`desktop-executions.ts:302-337`). Local heartbeat failure aborts the native runtime (`local-agent.ts:1351-1376`); local revoke stops owned resources. Full cross-OS timing remains outside this review. |
| Explicit actual-file return | Web/renderer require manual exact-version selection, show selected names/versions, distinguish shared sources, disable on authority errors and use the current file picker (`task-local-handoffs.tsx:31-46`). Extension `local-handoffs.ts:61-81` searches current dependency resources and requires explicit selection/return; it never starts native Codex itself. The privacy exception is I041-01. |
| Same parent task/reservation and paid thread | `/complete` requires known settled native success, current source permission, exact request revision/hash and all valid selected versions, then completes the handoff and calls `resolveInputSelections` in the same transaction (`task-local-handoffs.ts:178-199`). The resolver preserves original task ID and reservation, queues the original task only after all inputs are ready and deduplicates its outbox (`task-dependencies.ts:291-422`). Paid checkpoints retain cumulative usage/thread and require the original reservation (`paid-task-inputs.ts:173-217`); worker consumes that continuation and sets `resume_thread` (`worker.ts:497-506,683-685`). Exact completion replays recheck current authority and do not update/reserve again. |
| UI lifetime and privacy on revoke | Web/renderer clear the selected return modal on list error or project/task switch (`task-local-handoffs.tsx:53-59`). Extension mounts by workspace/task revision (`panel.ts:884-892`), invalidates return forms by generation and clears contents on source errors (`local-handoffs.ts:27-34,58-80`); workspace/task reset disposes the mount. No stale list is intentionally used as authority. |

**Search/read record:** `rg --files` identified the actual handoff files, migration141, native controller and UI modules. Searches for `local_handoff`, `local-handoff`, `localHandoff`, `handoff`, `lockLocalHandoffParent`, `registerTaskLocalHandoffs`, `private_owner`, `conversation_id`, `retry`, `settling`, `runtime_thread` and `resume_thread` led to the concrete callers/callees above. The full new backend handler and migration141 were read, along with the cited native controller/admission/finish ranges, Web/renderer return UI, entire Extension handoff module and its panel mounts. Guessed `uploads-multipart.ts` and `local-company-tools.ts` did not exist; actual `uploads.ts`, `storage.ts` and local Codex dynamic-tool handlers were followed instead. No finding rests on a failed filename search.

**Evidence limits / not findings:** the reviewed `task-local-handoff-147-v3.test.ts:33-43` asserts original `attempt === 0`; that proves pre-first-turn input restoration, not a running demonstration of a paid original Codex thread continuing. Its fixture submits a native `/finish` report through the API and creates assets through server helpers; those tests validate controls and accounting, not customer OS execution or current file-picker behavior. Parent backend/UI/native evidence must be assessed separately. No live provider quality, production payments, arbitrary OS operation support, Linux/macOS execution, crash/network-fault reproduction or full role acceptance is claimed here.
