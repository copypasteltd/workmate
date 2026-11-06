# Round 205 tool-outcome context dossier

This is a source-reading record, not a test result, vulnerability verdict or acceptance decision. Product code, prior reports, server settings and browser state were not changed. Line references describe the source captured by `source-manifest.json`; later implementation changes require a new record.

## Entry points and state

Cloud work enters `Worker.run` after the queued cloud task is authorized and capacity/fencing is claimed (`dev/copypaste-platform/src/worker.ts` L456-L560). It creates `RuntimeToolState` from server-derived persisted tool names through `RuntimeContext.unresolvedDeliveryToolNames` (`worker.ts` L730-L759; `runtime.ts` L27-L45, L379).

The native process requests `item/tool/call`. The adapter validates registered name, admitted turn, namespace, call ID and abort state, then awaits the business tool (`runtime.ts` L469-L489). Stdout handlers run in a promise chain, so callbacks within one adapter are serialized (`runtime.ts` L559-L562). This does not replace the database fencing/transaction checks across workers (`worker.ts` L647-L672; `task-business-tools.ts` L224-L264).

Three related state representations exist:

| Representation | Identity retained | Update rule | Source |
| --- | --- | --- | --- |
| In-memory runtime failures | Tool name → one feedback object | `fail` replaces; `complete` deletes by name | `runtime-tool-feedback.ts` L100-L116 |
| Durable reconstruction | Latest event per tool name | `DISTINCT ON(tool)` over failed/completed/recovered | `runtime-tool-feedback.ts` L89-L95 |
| Web and Desktop renderer feedback | Latest activity per tool name | Last encountered tool event replaces earlier event | `task-tool-state.ts` L9-L25 in both repositories |

Runtime events also store a hash-derived `call_ref` and `arguments_sha256`; completion/recovery state does not consume either identity (`runtime.ts` L472-L497). An explicit relation between one failed call and a different corrective call: **nothing found in these paths**. This is an assumption boundary to assess, not a verdict.

## Completion, waits and usage

A resolved `tool.run` is converted to native content, then emits `runtime.tool.completed`; any previous same-name failure produces `runtime.tool.recovered` (`runtime.ts` L489-L493). No generic inspection of domain return fields occurs in this block. The twelve delivery-tool return contracts are documented in [delivery-handler-contracts.md](delivery-handler-contracts.md).

The successful `request_input` marks an in-memory wait flag, making `unresolvedDelivery` false for that adapter (`runtime-tool-feedback.ts` L108-L113). Worker finalization checks a matching requested checkpoint and known usage; its successful conversion to `needs_input` returns before the final durable tool-outcome check (`worker.ts` L935-L959, L1056-L1061; `paid-task-inputs.ts` L245-L307). The next admitted turn reconstructs unresolved names from event history (`worker.ts` L731-L732).

The final cloud success check is independent of the adapter result, but uses the same latest-per-tool reconstruction (`worker.ts` L1058-L1061). Event history is separately pruned after thirty days without a task-status condition (`retention.ts` L127-L130). An independent delivery-failure ledger that survives this event pruning: **nothing found in the inspected paths**. Input checkpoint expiry and task retention may restrict reachability of a later resume; their complete temporal relationship remains an open question.

Usage and side-effect reconciliation have separate authority. Worker finalization sums persisted succeeded image operations, retains accepted/reconciling operations as uncertain, then uses provider receipts where present (`worker.ts` L881-L933). Settlement receives uncertainty even when the task status is failed (`worker.ts` L1066-L1085). Image execution refuses to replay accepted/reconciling prior operations (`task-business-tools.ts` L2195-L2259). A tool-status correction is not authority to replace or zero these facts.

## Customer event paths

Web SSE exposes a bounded allowlist: tool name, call reference, static-format code and category; raw arguments, guidance and upstream errors are excluded (`task-events.ts` L83-L91). Desktop polling reads the authorized raw event page instead (`tasks.ts` L190-L226). `useTaskEvents` consumes both into the same renderer state helper, using canonical sequence for SSE and database event ID for polling (`dev/copypaste-web/src/task-events.ts` L50-L62, L133-L146). The renderer helper and feedback component were byte-identical between Web and Desktop at capture; see the manifest.

SSE cursor-expiry recovery clears activity and resumes at the snapshot watermark (`task-events.ts` in Web L85-L93, L162-L168). The feedback component can still display a generic incomplete-delivery notice from task error code, without a failure reference (`task-tool-feedback.tsx` L7-L8, L15-L19). A snapshot containing all unresolved per-call failures: **nothing found in the inspected snapshot return** (`platform/src/tasks.ts` L165-L187).

## Native Desktop scope boundary

The Desktop renderer is not the Desktop execution engine. Company tools share `TaskBusinessTools`, but native `local-codex.ts` has its own grant, turn and result handling (`platform/src/desktop-executions.ts` L474-L536; `desktop/src/local-codex.ts` L594-L648). Its successful hook resolution is logged as `local.company-tool.completed` and returned as success without a generic business-state check (`local-codex.ts` L604-L640). It extracts typed references for video/audio separately; these references do not establish their domain state (`local-codex.ts` L620-L638). Full native task finishing was not analyzed here; no parity claim follows from the byte-identical renderer.

## Open questions for the subsequent assessment

1. Which identity represents each requested deliverable, and what proves that a later successful call repairs a specific failed call rather than producing another independent output? No explicit correction relation was found in runtime/state/UI paths (`runtime.ts` L472-L497; `runtime-tool-feedback.ts` L100-L116).
2. How are unresolved delivery obligations preserved when events expire, a cursor is reset, a task continues or output is erased? State currently derives from task events; retention independently removes old events (`runtime-tool-feedback.ts` L89-L95; `retention.ts` L128).
3. Which terminal domain states count as delivery for audio and generated video? Both handlers can resolve with a non-delivered state; details are in the handler contract table and function records.
4. How is a prepared presentation source linked to its exact final render? `buildSlides` returns `requires_render: true`, while `slides_render` accepts its exact source/version digest (`editable-design-tools.ts` L602-L614, L726-L755). No prepared-to-render obligation exists in the generic runtime map.
5. Which read/status receipt can resolve an earlier paid call without a new create request? Audio/video expose original operation IDs, but this dossier does not establish a generic reconciliation transition from those reads into runtime failure state (`audio-production.ts` L137-L146; `video-jobs.ts` L87-L97; `runtime-tool-feedback.ts` L100-L116).
6. Which native finish rules consume company-tool outcomes? The shared business handlers and native result forwarding were read, but the entire Desktop finish transaction remains outside this bounded context record (`desktop-executions.ts` L1010-L1030; `local-codex.ts` L639-L648).

## Function records

- [Argument parse boundary](functions/parseToolArguments.md)
- [Safe feedback](functions/safeToolFeedback.md)
- [Persistent outcome reconstruction](functions/readUnresolvedDeliveryToolNames.md)
- [Runtime completion state](functions/RuntimeToolState-complete.md)
- [Native cloud tool callback](functions/runtime-onLine.md)
- [Worker start](functions/Worker-run.md)
- [Worker finish](functions/Worker-finish.md)
- [Canonical event projection](functions/canonicalEvent.md)
- [Bounded activity retention](functions/retainTaskActivity.md)
- [Pending feedback](functions/pendingToolFeedback.md)
- [Feedback component](functions/TaskToolFeedback.md)
- [Audio execution](functions/AudioProduction-execute.md)
- [Generated video wait](functions/GeneratedVideoJobs-wait.md)
- [Presentation preparation](functions/buildSlides.md)
- [Presentation final render](functions/renderSlides.md)

No tests, model requests, business task creation, server operations, browser calls or publication commands were run by this context task. The capture is not a replacement for full business, professional, production or network acceptance.
