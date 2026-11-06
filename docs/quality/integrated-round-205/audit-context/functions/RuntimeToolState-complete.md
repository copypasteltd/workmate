## `RuntimeToolState.complete` in `dev/copypaste-platform/src/runtime-tool-feedback.ts` (L108-L112)

**Purpose:** Removes a previous same-name failure and tells the caller whether to emit recovered; successful input request also enables a wait checkpoint (L108-L113; runtime.ts L491-L492).

**Inputs & Assumptions:** `name` is the trusted registered tool's name (runtime.ts L471, L491). Failure map is seeded from persisted names or written by `fail` (L103-L107). Failure-call identity, corrected argument relation and paid operation state are not passed to this method (L108).

**Outputs & Effects:** Returns prior feedback if present, deletes its single map entry, sets `waitingForInput` when name is `request_input` (L109-L111).

**Block-by-Block:**

```ts
// L109-L111
const previous = this.failures.get(name); this.failures.delete(name);
if (name === "request_input") this.waitingForInput = true;
return previous;
```

- **What:** Replaces the current tool-wide failure state with success/wait.
- **Why here:** Called only after business tool resolves and completed event persistence succeeds (runtime.ts L489-L491).
- **Assumes:** Resolved return means enough success for this tool-wide state; domain fields are not inspected here. No explicit one-failed-call/one-corrective-call check was found.
- **Establishes:** That tool name is absent from `failures`; all map failures are temporarily ignored by `unresolvedDelivery` while waiting (L113).
- **Depended on by:** Adapter terminal status/error code (runtime.ts L677, L715).

**Cross-Function Dependencies:** `fail` sets one feedback per tool name (L107); constructor converts persisted names to static generic feedback (L103-L105). `terminalCode` selects image/general code from names (L97-L98, L114-L115). No database or external calls occur in these methods.

**Open Questions:** How should multiple independent same-name deliverables or multiple failures be represented? Which business read can resolve an unverified call without repeating its side effect? Is `waitingForInput` only reachable after an authoritative checkpoint? Actual tool handler confirms that checkpoint before resolving (paid-task-inputs.ts L56-L146), and Worker independently checks it before needs_input (worker.ts L935-L959).
