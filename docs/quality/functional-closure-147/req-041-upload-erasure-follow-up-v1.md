# REQ-041 task-bound upload erasure follow-up

Status: implementation frozen for the parent's next unified native verification. No tests, services, migration execution, browser or Git operation were run by this subtask. Backend 08's preserved result was 88/89; its source-task erasure failure and all executed migrations/tests remain unchanged. UI 06's five completed groups belong to the earlier frozen source, not this migration.

## Confirmed cause and narrow correction

The migration 059 resource guard rejects a completed upload changing to cancelled unless its private conversation is deleted. Migration 143's authoritative source-task erasure performs that transition even for private tasks without a conversation. The filename is absent from the old identity tuple; the failing condition is the terminal-state change.

Independent asset erasure has a second interaction: its existing receipt cleanup sets result to NULL while the task-bound session is still completed, which migration 143's task input result guard correctly rejects.

New migration `dev/copypaste-platform/migrations/145-task-upload-erasure-transitions.sql` preserves the previous identity tuple, non-extensible expiry, insert quota and private-conversation deletion exception. A task-bound upload may additionally change to exactly cancelled / `[deleted]` / NULL only when either:

- Its immutable source task has matching tenant, project and creator, is a deleted cloud execute task, and has the corresponding persisted task deletion journal.
- Its old completed receipt identifies the actual version with that upload_session_id, the version belongs to the same actual asset and owner/project/tenant, and that asset is deleted with its own matching asset deletion journal.

The new branches do not depend on `app.erasing_content`. An unrelated deleted task/asset or a generic erasure flag grants no transition. Source scope remains independently immutable under migration 143; no receipt can reactivate or extend its expiry. Required schema version advances to 145.

`dev/copypaste-platform/src/erasure.ts`, asset scrub case, first cancels only task-bound receipts whose cached asset/version matches the actual upload version. Existing generic filename/result cleanup then handles ordinary uploads as before. This ordering preserves task input provenance until the completed-state result guard is bypassed by the legitimate cancellation; it does not manufacture an original-task product from a user input.

## Trigger and erasure order reviewed

- 016 owner/RLS and 017 insert quotas: no scope or capacity changes.
- 058 resource guard and deferred upload/version commit guards: identity remains fixed; the legitimate cancellation skips completed-upload validation; the erasure transaction creates no asset version.
- 059 terminal exception: preserved for deleted private conversations.
- 143 scope/result guards: source identity remains fixed; cancelled receipts skip completed-result validation.
- 011 content journal runs before 018 upload staging journal by trigger name. Asset deletion journals every existing object and upload before asynchronous scrub clears cached results.
- 143 source deletion explicitly journals upload staging, retires source-bound receipts, deletes private inputs and links their child asset jobs; explicitly shared project assets retain their prior visibility semantics.
- 028 / 141 / 144 source erasure and handoff retirement keep receipt and financial identity while allowing the original deleted task's dependency content to be removed.
- Asset workspace state and specialized campaign/matrix/video/connector/SEO/quality/GEO guards remain unchanged; customer upload metadata uses input_task_id and upload provenance rather than the task-produced task_id relationship.
- ErasureService scrubs before removing journal items. Cancelled receipts no longer enter completed-result validation; asset version metadata is cleared only after object erasure, and staging items use durable upload IDs.

## New regression coverage

New immutable-after-execution file: `dev/copypaste-platform/tests/task-upload-erasure-147-v1.test.ts`, three cases using the existing isolated fixture:

1. Real private upload, completed local handoff return, independent asset deletion, stored object/staging removal, preserved original/native reservations, no replay resurrection, rejection of unrelated completed receipt cancellation even under the generic erasure flag, and continued identity/expiry/restart fences.
2. Explicit shared task input plus a later ordinary version upload to the same asset; both actual versions and staging trees are erased, task-bound receipt retires, legacy ordinary terminal behavior is preserved, and the original source task stays active.
3. Shared source task cancellation then authoritative task erasure; its upload staging and receipt are retired, shared bytes remain available under the existing sharing contract, source/native financial records survive, and handoff receipt becomes cancelled.

The existing `task-local-handoff-scope-147-v3.test.ts` is unchanged and continues to cover private task-without-conversation scope, original Worker reading actual uploaded CSV without a provenance cycle, consumed-source withdrawal, source deletion, Starter reservations, cursor precision and old-auth rejection. Fixture native completion is a control-plane report, never evidence of an actual Codex process or OS permission. The parent owns the next complete backend and real UI verification.
