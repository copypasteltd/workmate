# Baseline literal reference index

Read-only index from platform commit bb36f993347cc529ddb317f6bf5284a43bf103cb. No test was executed. Locations list all literal lease_until matches, including independent job leases; semantic task-only classification is in worker-lease-map.md. Source contents, credentials and runtime arguments are intentionally omitted.

Lease references: 317 literal lines across 118 files.

## src

| File | Lines containing lease_until |
|---|---|
| src/admin-accounts.ts | 305 |
| src/audio-authorizations.ts | 192, 203 |
| src/audio-production.ts | 51, 362 |
| src/capability-audio-verification.ts | 30, 65, 66, 94, 274, 277, 285, 286, 322 |
| src/capability-releases.ts | 245, 1018, 1097 |
| src/capability-video-verification.ts | 35, 57, 59, 91, 259, 262, 270, 271, 351 |
| src/connectors.ts | 1148, 1418, 1739, 1770, 2026, 2072, 2080, 2081, 2089, 2187, 2299, 2339, 2363, 2390 |
| src/creative-matrices.ts | 602, 615, 698, 729, 813 |
| src/deletions.ts | 324, 332 |
| src/desktop-executions.ts | 228, 375, 441, 567, 1106, 1197, 1207, 1417, 1420, 1458, 1466 |
| src/desktop-startup-recovery.ts | 74, 151 |
| src/desktop-video-origin.ts | 21 |
| src/desktop-workflows.ts | 65 |
| src/erasure.ts | 70, 75, 90, 133, 143, 221, 231, 240 |
| src/external-budget.ts | 256, 818, 1161, 1185, 1258 |
| src/invitation-delivery.ts | 35, 49, 53, 58, 69, 82, 90, 110, 116 |
| src/membership.ts | 75, 486, 637 |
| src/native-recovery.ts | 302 |
| src/paid-task-inputs.ts | 296 |
| src/provider-request-control.ts | 83, 86 |
| src/publication-erasure.ts | 16, 57 |
| src/publication-receipts.ts | 77, 82, 86, 89 |
| src/publication-reconciliation.ts | 78, 106 |
| src/publication-service.ts | 26, 222 |
| src/publication-worker.ts | 21, 35, 41, 42, 49, 60, 112, 143, 154, 176, 183, 202 |
| src/scope-erasure-cleanup.ts | 98, 165 |
| src/seo-audits.ts | 627, 680, 696, 713, 723, 725, 736, 941, 1035 |
| src/seo-changes.ts | 107 |
| src/task-dependencies.ts | 217, 226 |
| src/task-pause.ts | 31 |
| src/video-jobs.ts | 43, 167, 203, 338, 340, 347, 397 |
| src/video-projects.ts | 1101, 1110, 1187, 1221, 1299 |
| src/worker.ts | 228, 579, 1010, 1116 |

## migrations

| File | Lines containing lease_until |
|---|---|
| migrations/001-foundation.sql | 88 |
| migrations/011-content-erasure.sql | 9 |
| migrations/029-execution-capacity.sql | 74 |
| migrations/037-membership-invitation-lifecycle.sql | 23 |
| migrations/064-controlled-capability-releases.sql | 30 |
| migrations/066-durable-provider-requests.sql | 213, 223, 279, 281 |
| migrations/067-per-request-budget-enforcement.sql | 205, 392, 402, 460, 462 |
| migrations/069-creative-production-matrices.sql | 23, 37 |
| migrations/070-template-video-projects.sql | 23, 32, 38, 56, 57, 58 |
| migrations/072-marketing-connector-sync.sql | 37, 44, 75, 76, 106, 129 |
| migrations/073-connector-analysis-source-lineage.sql | 36 |
| migrations/078-scoped-seo-audits.sql | 8, 17, 121, 122, 123, 125, 126, 213 |
| migrations/088-paid-input-checkpoints.sql | 45 |
| migrations/089-paid-checkpoint-capacity.sql | 53 |
| migrations/090-completed-task-tool-receipts.sql | 33 |
| migrations/091-paid-checkpoint-turn-boundaries.sql | 16, 30 |
| migrations/093-desktop-video-origin.sql | 20, 54 |
| migrations/094-desktop-workflow-origin.sql | 99, 140 |
| migrations/097-generated-video-jobs.sql | 45, 58, 114, 117, 266 |
| migrations/098-managed-video-capabilities.sql | 15, 17, 74, 75 |
| migrations/101-internal-audio-production.sql | 184 |
| migrations/102-audio-customer-authorizations.sql | 60, 99 |
| migrations/105-private-cloud-workflows.sql | 81 |
| migrations/120-private-cloud-schedules.sql | 157 |
| migrations/121-managed-audio-capabilities.sql | 15, 17, 63, 64 |
| migrations/124-external-budget-operations.sql | 33, 68, 69 |
| migrations/132-controlled-publications.sql | 79, 209, 210 |
| migrations/133-desktop-startup-recovery.sql | 113, 121 |
| migrations/146-scope-erasure.sql | 86, 90, 91 |
| migrations/162-terminated-desktop-execution-capacity.sql | 12 |

## tests

| File | Lines containing lease_until |
|---|---|
| tests/audio-authorization-upgrade-189-v1.test.ts | 109 |
| tests/audio-authorization-upgrade.test.ts | 97 |
| tests/audio-production.test.ts | 267, 272 |
| tests/capability-audio-verification-188-v1.test.ts | 300 |
| tests/capability-audio-verification.test.ts | 300 |
| tests/capability-bindings-189-v1.test.ts | 653, 654 |
| tests/capability-bindings-189-v2.test.ts | 653, 654 |
| tests/capability-bindings.test.ts | 653, 654 |
| tests/capability-releases-188-v1.test.ts | 702 |
| tests/capability-releases.test.ts | 701 |
| tests/capability-video-verification-188-v1.test.ts | 246, 266 |
| tests/capability-video-verification.test.ts | 246, 266 |
| tests/connectors.test.ts | 43, 657 |
| tests/desktop-executions-139-v1.test.ts | 263, 280 |
| tests/desktop-executions-139-v2.test.ts | 263, 280, 555, 565 |
| tests/desktop-executions-139-v3.test.ts | 263, 280, 555, 565, 618, 620, 623, 626 |
| tests/desktop-executions.test.ts | 259, 276 |
| tests/desktop-unstarted-settlement-197-v1.test.ts | 109, 118 |
| tests/desktop-video.test.ts | 144 |
| tests/desktop-workflows.test.ts | 41 |
| tests/execution-capacity.test.ts | 238, 475 |
| tests/external-budget.test.ts | 60, 663, 670 |
| tests/generated-video-jobs-188-v1.test.ts | 183, 184, 185, 294 |
| tests/generated-video-jobs.test.ts | 183, 184, 185, 294 |
| tests/membership.test.ts | 581 |
| tests/native-input-ceiling-181-v1.test.ts | 193 |
| tests/native-input-ceiling-181-v2.test.ts | 193 |
| tests/notifications-189-v1.test.ts | 189 |
| tests/notifications.test.ts | 189 |
| tests/paid-task-inputs.test.ts | 799, 818, 829, 920, 954 |
| tests/persistent-work-189-v1.test.ts | 292 |
| tests/persistent-work.test.ts | 292 |
| tests/platform-189-v1.test.ts | 410 |
| tests/platform.test.ts | 409 |
| tests/provider-admin-188-v1.test.ts | 275, 313 |
| tests/provider-admin.test.ts | 273, 311 |
| tests/provider-request-control.test.ts | 193, 754 |
| tests/provider-termination-fixture-189-v1.ts | 275, 313 |
| tests/provider-termination-fixture-189-v2.ts | 275, 313 |
| tests/provider-termination-fixture-189-v3.ts | 276, 314 |
| tests/runtime-startup-billing.test.ts | 219, 225 |
| tests/scope-erasure-150-v1.test.ts | 100 |
| tests/scope-erasure-150-v10.test.ts | 108 |
| tests/scope-erasure-150-v11.test.ts | 108 |
| tests/scope-erasure-150-v2.test.ts | 100 |
| tests/scope-erasure-150-v3.test.ts | 100 |
| tests/scope-erasure-150-v4.test.ts | 105 |
| tests/scope-erasure-150-v5.test.ts | 106 |
| tests/scope-erasure-150-v6.test.ts | 106 |
| tests/scope-erasure-150-v7.test.ts | 106 |
| tests/scope-erasure-150-v8.test.ts | 107 |
| tests/scope-erasure-150-v9.test.ts | 108 |
| tests/seo-change-tasks-202-v1.test.ts | 214, 220 |
| tests/seo-change-tasks.test.ts | 214, 220 |
| tests/workflow-native-handoff-fixture-145-v1.ts | 41 |

## Task foreign-key declarations

Literal REFERENCES tasks/public.tasks declarations: 63. This is a location index, not proof of the installed constraint catalog or transitive trigger lock behavior.

| Migration | Declaration lines |
|---|---|
| migrations/001-foundation.sql | 91, 95, 101, 108, 116, 120, 151, 174 |
| migrations/005-persistent-work.sql | 38, 65, 68, 69 |
| migrations/019-retention-enforcement.sql | 35, 57 |
| migrations/025-project-skill-lifecycle.sql | 28 |
| migrations/026-in-app-notifications.sql | 7 |
| migrations/028-task-input-dependencies.sql | 12 |
| migrations/034-analysis-reports.sql | 49 |
| migrations/041-billing-settlement-sources.sql | 11 |
| migrations/043-billing-operation-provenance.sql | 30, 42 |
| migrations/063-frozen-task-capabilities.sql | 9 |
| migrations/066-durable-provider-requests.sql | 42 |
| migrations/067-per-request-budget-enforcement.sql | 25, 53 |
| migrations/068-provider-admin-control.sql | 61 |
| migrations/078-scoped-seo-audits.sql | 13 |
| migrations/080-seo-change-tasks.sql | 5 |
| migrations/082-task-content-source-lineage.sql | 9 |
| migrations/088-paid-input-checkpoints.sql | 14 |
| migrations/090-completed-task-tool-receipts.sql | 7 |
| migrations/092-desktop-execution-ownership.sql | 16 |
| migrations/093-desktop-video-origin.sql | 3, 42 |
| migrations/094-desktop-workflow-origin.sql | 4, 10, 55 |
| migrations/095-business-delivery-quality.sql | 11, 20 |
| migrations/097-generated-video-jobs.sql | 9 |
| migrations/100-reproducible-geo-observations.sql | 27 |
| migrations/101-internal-audio-production.sql | 10 |
| migrations/102-audio-customer-authorizations.sql | 6 |
| migrations/108-persistent-agent-groups.sql | 38, 59 |
| migrations/112-versioned-solution-packages.sql | 48, 65, 72 |
| migrations/120-private-cloud-schedules.sql | 4 |
| migrations/124-external-budget-operations.sql | 29 |
| migrations/126-private-cloud-events.sql | 4 |
| migrations/129-dedicated-cloud-runtime.sql | 59, 378, 381 |
| migrations/132-controlled-publications.sql | 65, 70, 88 |
| migrations/133-desktop-startup-recovery.sql | 32 |
| migrations/141-task-local-handoffs.sql | 5, 15 |
| migrations/143-task-scoped-uploads.sql | 3 |
| migrations/153-running-task-pause-checkpoints.sql | 18 |
| migrations/163-role-acceptance-evidence.sql | 4 |
