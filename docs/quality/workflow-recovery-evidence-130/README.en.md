# Stage130 original evidence

This archive retains original controller, compiler, actual pinned-Codex, complete native parent/child and packaged-UI outcomes, including failures, executed verifier versions and matching source snapshots. SHA-256 content deduplication retains every original index entry without rewriting outcomes.

[中文](README.md) · [Original index](index.json) · [Current checkpoint](../workflow-recovery-checkpoint-130.json) · [Implementation](../../technical/130-desktop-workflow-recovery.md) · [Complete numbered ledger](../remaining-work-stage130.md)

| No. | Original record | Retained outcome |
| --- | --- | --- |
| 1 | Desktop 01 | Old-logic reproduction fails when shutdown waits for a stalled heartbeat. |
| 2 | Desktop 02 | 107/109 pass; two new fixture cases also held mandatory fresh authority checks. Original failure retained. |
| 3 | Desktop 03 / 05 / 06 | 109 controller, 43 actual pinned-Codex and two current compiler checks pass, with unchanged sources and restored fixtures. |
| 4 | Desktop 04 | Both compilers succeed, but an overlapping native fixture invalidates the environment comparison. Overall failure retained. |
| 5 | Native 01 | Two test outcome type errors fail compilation before any database or native journey starts. |
| 6 | Native 02 | Three complete native parent/child journeys pass: two child recoveries, withdrawal with a stalled authority response and normal completion with that response withheld. |
| 7 | Packaged 01 | Eight actual unsigned Electron checks pass. Four screenshots and one 119-second actual-time GIF/MP4 contain 645 observed frames, 37 distinct frames and no capture error. |
| 8 | Earlier publication receipts | Original Stage128 full publication and Stage129 documentation-supplement receipts establish the ordinary incremental baseline. |

Model output, customer/dialog choices and injected faults are fixtures. Codex, PostgreSQL, company APIs, shell files and Electron actually run. Owned processes, browsers, temporary databases and fixtures close. Verify archived bytes, current sources and media from the workspace root with `python -X utf8 docs/tools/record_workflow_recovery_130_v1.py --verify`.

No full-acceptance record closes: 89 required, 12 unconfirmed suggested and one optional remain. Arbitrary crash/multi-node behavior, full tool/role coverage, live providers, signed installation and durable lost-child-finish-receipt resubmission remain open.
