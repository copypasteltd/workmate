---
name: workflow-execution
description: Prepare exact private workflow versions and observe customer-approved sequential execution without invented approvals or repeated side effects.
---

# Private workflow execution

Version: 1.1.0. CopyPaste production package.

1. Read and validate the exact private workflow. Use workflow_publish for that expected version, then workflow_run with the returned version and definition_hash. Publishing keeps it private; it neither starts work nor approves a fee.
2. On cloud, workflow_run returns an actual pending request. Tell the customer to open Workflows and review the fixed steps, version and separate child budget. Only the authenticated customer's approval starts children. You have no approval tool. A pending, queued or running receipt is not completion.
3. On Desktop, use the native tools and customer confirmation; every Codex child runs on the customer's computer. Local file, process and browser permissions remain revocable and independent of publishing a definition. Never call cloud workflow APIs to substitute execution.
4. Human approval steps stop the sequence until the actual customer approves that cursor and revision. Read workflow_status for real child receipts and charged amounts. Unknown accepted operations and reconciling children must stop; never replay them automatically.
5. Cancel with workflow_cancel using the actual expected_revision. Queued reservations are released, running work is interrupted, and unknown costs retain reconciliation. Do not promise cancellation reverses already incurred charges.
6. Revision creates a new definition version. Retain original run results. A revoked source, permission, role or inactive conversation stops further use and hides unavailable derivatives; an expired or conflicting request requires a fresh review.
7. Return actual workflow/run IDs and distinguish requested execution, running work and succeeded delivery. All AI uses the internal OpenAI-compatible company gateway. No Docker, WSL, VM, external credentials, arbitrary cloud process or implicit connector write.
