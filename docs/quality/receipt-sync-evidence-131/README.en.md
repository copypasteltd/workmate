# Stage131 original evidence

This archive preserves 6818 original file references as 2118 distinct content-addressed byte objects. Failed/passing reports, executed QA, source snapshots, actual observations and the real Stage130 push receipt retain their original bytes.

[Original index](index.json) · [Current source/media checkpoint](../receipt-sync-checkpoint-131.json) · [Implementation](../../technical/131-desktop-durable-receipt-sync.md) · [Complete numbered open work](../remaining-work-stage131.md)

The checkpoint binds 2215 current source files and eight actual media files: four screenshots and two real-time GIF/MP4 pairs. Bounded checks passed: 124 controller, 43 actual pinned-Codex, three actual native/SQL journeys, two compilers and eight unsigned packaged-Desktop checks. Two explicit outcomes also preserve the old/current regression comparison.

The first controller baseline failed because the new pending-receipt field was absent; that alone does not exercise receipt loss. A separate comparison materializes exact Stage130 Git sources and removes only the new-field precondition. It observes the old code omit the child finish request and the current code submit child before parent.

The first three SQL failures incorrectly expected an unknown parent to have a final charge. The actual service correctly retained its original hold. Versioned replacement QA verifies a single child settlement and a parent still held for reconciliation; accounting rules were not changed to satisfy the test. Original QA bytes, including existing trailing blank lines, remain intact.

The packaged journey fully quits and reopens the application, restores the same account-bound saved receipt with local access still revoked, and synchronizes without native/model replay, new consent, QA or another reservation. All owned test resources were closed.

Model/dialog choices and injected faults are synthetic. Commands, files, SQL, HTTP disconnections and application processes are actual. The qualified restart follows native-process closure and does not establish arbitrary crash/process reclamation, login-family handoff, multi-node, professional-role, live-provider or whole-platform acceptance. All 102 original full-acceptance records remain open.
