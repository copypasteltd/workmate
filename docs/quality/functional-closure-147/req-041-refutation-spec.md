# REQ-041 independent specification refutation

Scope: independently attempt to refute `req-041-check.md` using an implemented Web-origin cloud task → persisted device wait → Desktop-selected local scope → local work → original Web task continuation. Read-only source inspection; no runtime, test, Git, browser or virtualization operations. Only this report was written. Paths below are relative to `D:/dev/copypasted/自有agent/`.

Source path abbreviations in the evidence tables: `platform/` = `dev/copypaste-platform/`, `web/` = `dev/copypaste-web/`, `desktop/` = `dev/copypaste-desktop/`. A bare source filename belongs to the immediately named repository.

**Result: the central missing-integration finding survives. No implemented complete counterexample was found.** Native Codex execution, same-task cloud input continuation and the signed file bridge exist, but their actual contracts do not compose into UC11. This conclusion is narrower than claiming all of REQ-041 absent or claiming a failed live acceptance test.

## Authoritative behavior and a necessary scope qualification

- `docs/product/02-user-journeys.md:114` explicitly specifies Web starts the task, the task waits for a device when a local directory is needed, the customer chooses scope in Desktop, a local step completes, and Web reviews the result. Line 116 preserves current execution ownership and prohibits cloud takeover of an offline native task.
- `docs/requirements/01-srs.md:163` requires consistent task/device/artifact identity and waiting when a device is offline. It does not prescribe a database state name or a particular step protocol.
- `docs/requirements/03-client-execution-amendment.md:40` retains the original requirements. Lines 54–58 place Web/Extension Agent loops in the cloud and Desktop's actual Codex loop/files/commands on the customer's computer. DESK-L05/L07/L08 at lines 70–73 preserve local stop/recovery, customer-only local permission and ownership.
- `docs/technical/05-local-executor-and-browser.md:20` explicitly keeps a restricted file bridge as a valid separate path. Therefore **UC11's narrow file-collection step need not itself invoke Codex**. A durable, task-bound, customer-approved bridge that collects exact files and resumes the original cloud task could satisfy that journey. Requiring every local read to incur a second Codex run would add unsupported scope. For a general local Agent transformation, however, replacing native Codex with the legacy bridge does not satisfy CLIENT01.

This qualification refutes an unnecessarily broad reading of “every local step must run Codex”; it does **not** refute F041-1, because even the narrower integrated file-collection journey is missing from the inspected entry points.

## Strongest candidate counterexamples, followed through their callers

| Candidate | What actually works | Why it does not complete the specified journey |
|---|---|---|
| Existing cloud file dependency | Web `src/task-dependencies.tsx:18–89` renders `needs_input`; lines 193–225 upload/select a resource version and submit `{expected_version, resource_ids}`. Platform `src/task-dependencies.ts:291–422` rechecks exact current resources and resumes **the same task**, reservation/checkpoint and outbox dispatch. | The union at `task-dependencies.ts:14–43` contains only file, connection and question requests. The file resolver accepts existing authorized asset versions (`:50–69`), not a durable native step/result identity. There is no Desktop request/accept action in this Web input caller. Manual upload is a real supported alternative, but omits UC11's task-bound device wait and scope selection. |
| Web Devices page → signed native file command | `web/src/main.tsx:2599–2659` schedules against an existing grant, polls the command result and shows its raw JSON. `platform/src/business.ts:777–839` permits file.list/read/write, optionally binds a task ID for access validation. Desktop `src/main.ts:558–629` verifies the command and calls `files.execute`. | The Web caller does not send `task_id`. Even if a caller supplies it, server creation only checks project access (`business.ts:815–823`); result handling (`:861–902`) updates only `device_commands` and returns `{ok:true}`. It does not save an immutable task asset, resolve a dependency or resume the task. No Codex execution is involved in this bridge loop. |
| Native Desktop task with selected workspace | Desktop `src/local-agent.ts:1106–1122,1234–1258` submits the native session/device/workspace/runtime binding and stores the returned task ID. Platform `src/desktop-executions.ts:657–789` requires the current native family and enqueues `execution_location: desktop`. | This creates a local task. The strict create contract at `desktop-executions.ts:74–88`, including `desktop-startup-recovery.ts:13–19`, accepts no original cloud request/dependency identity. Its only parent is a prior native task in the same native session (`:679–703,744–761`). `task-service.ts:137–142` rejects changing a parent's execution location. It is not an authorized local leg attached to a waiting cloud task. |
| All-native workflow | `platform/src/desktop-workflows.ts:46–63` locks a live native root and native run; lines 298–317 create native-owned child executions in the same device/workspace. Desktop `src/local-workflow.ts:58–83` confirms a fresh native run. | The root must already have an active Desktop execution; children stay Desktop-owned. The successful native sequence does not create or resolve a Web-origin cloud dependency. |
| Private cloud workflow plus predecessor handoff | Stage 145's actual saved text/file handoff is wired into cloud children at `platform/src/cloud-workflows.ts:1029–1053`. | These remain cloud `enqueueTask` children, without a native execution or Desktop-selected scope. Exact predecessor files are real, but they are not a Web-to-Desktop handoff. |

`platform/src/canonical-tasks.ts:377–404` additionally rejects `device_id` in unified task creation. That single rejection is not sufficient evidence by itself: the dedicated input, bridge and native creation paths above were examined as alternative entry points.

## Offline/reconnect candidate also fails to refute F041-2

The legacy command transport cannot currently supply durable task waiting merely by reusing its existing endpoints:

- Creation fixes expiry to two minutes (`business.ts:833–834`). Native polling expires overdue pending commands and only claims pending, unexpired rows (`:741–774`). It does not redeliver claimed rows after a lost polling response.
- Desktop polls, executes, then submits once (`desktop/src/main.ts:609–628`). Its outer catch resets polling; this inspected loop has no persisted receipt-submission outbox.
- Result submission accepts only claimed, unexpired rows (`business.ts:888–900`). A completed receipt retry receives a conflict; an expired completed local operation cannot be acknowledged through this route.
- A pending/claimed command only **blocks** paid task continuation in `paid-task-inputs.ts:198–215`; it is not an execution/dependency bridge. Completing that command makes the block disappear but does not itself resolve the original file request.

This independently supports the reconnect integration gap without claiming that native Codex's separate encrypted journal/recovery path is absent, and without prescribing unsafe replay of uncertain OS effects.

## Source-derived rejection/observable reproduction (not executed)

1. Reach a Web cloud task's pending local-file input. Its UI exposes an uploaded/existing asset choice and submit action, with no native request identity or Desktop scope-selection action.
2. Start a normal Desktop Codex task to read the same folder. The create caller and server create a distinct native task; there is no accepted field linking its output to the original cloud dependency. Manually submitting a Web task as `parent_id` through generic enqueue cannot bypass the execution-location guard.
3. Alternatively schedule `file.read` with the original `task_id` through the legacy API. A successful native result updates only the command row. The original dependency remains unresolved until a separate asset upload and resolution.
4. Keep the device offline beyond the two-minute command expiry. Reopening Desktop expires that command rather than delivering a durable pending task step. This is a concrete source-derived failure of the proposed bridge counterexample, not a report of a live run.

## Searches and actual read scope

- Platform `rg -n -e waiting_device -e needs_device -e device_offline -e local_step -e local-step -e handoff src migrations`: the waiting name occurs only in `src/task-events.ts:26`; other hits are stage-145 workflow handoffs and an unrelated gateway comment. `task-events.ts:17–28` was read and is accepted event vocabulary, not a transition.
- Desktop the same search with `-g '*.ts' -g '*.tsx' src renderer`: no matches (exit 1). Absence of a string was not used as standalone absence evidence.
- Platform `rg -n -e device_commands src`: ten source hits in business, admin, disconnect, pairing and paid-input code. The full create/claim/result route bodies at `business.ts:720–904` were inspected; the remaining hits cancel commands or block uncertain continuation.
- Desktop fixed-string search for `local_session_id`, `request(this.base` and `this.base(r)` located the native caller. An initial unescaped regular-expression search failed and was corrected; its failure supplies no absence evidence.
- Exact independent reads: UC11 `02-user-journeys.md:109–128`; SRS `:154–169`; CLIENT01 `:40–98`; local executor doc `:18–74`; finding report `:1–102`; platform task dependencies `:14–43,50–73,291–424,447–507`; canonical tasks `:377–411`; task service `:91–152`; paid inputs `:181–225`; business `:720–904`; Desktop main `:558–631`; native create contract `:68–135,657–789`; native startup binding `:1–39`; desktop family `:1–26`; Desktop local-agent `:1104–1186,1232–1270`; native workflows `:46–68,292–318`; local workflow `:58–83`; cloud workflow `:1021–1064`; task event states `:17–33`. REQ-032's separate prior full workflow/handoff read is not counted as proof of a cross-device path.

## Actionable disposition

Keep the central REQ-041 missing integration finding. Prefer the smallest customer-usable scope: persist a cloud task's local-file request, let the native customer accept its exact directory/read operation, retain offline/cancel/admission/result identities, upload a private immutable result and atomically resolve that original dependency using the existing same-task continuation. A general local Codex step may use a separately linked native execution; preserve immutable task execution location and current owner guards. Do not require every file collection to become a Codex task, and do not count an all-native workflow or a raw command result as closure.
