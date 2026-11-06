## `onLine` in `dev/copypaste-platform/src/runtime.ts` (L441-L558)

**Purpose:** Decodes native RPC responses, dispatches registered company tools, forwards safe message deltas/usage and signals native turn completion (L441-L558).

**Inputs & Assumptions:** `line` is native-process JSON. Malformed JSON is ignored (L442-L447). Tool arguments/call IDs are untrusted native/model data; tool definition is trusted registry data (L469-L488). Task budget and permissions remain in each business handler, not in model input (task-business-tools.ts L224-L264).

**Outputs & Effects:** Resolves pending RPCs, calls business operations, persists safe tool events and writes native RPC results; usage only updates for current thread/turn and monotonic safe integer totals (L448-L558).

**Block-by-Block:**

```ts
// L472-L475
const identity = { tool: tool?.name ?? "unavailable_tool",
  call_ref: hash(String(m.params?.callId ?? "")).slice(0, 16),
  arguments_sha256: hash(canonical(m.params?.arguments ?? null)) };
```

- **What:** Stores bounded hashed identities instead of raw arguments in tool events.
- **Why here:** Available to both completion and failure paths, including rejected calls.
- **Assumes:** Native call IDs distinguish intended operations within the task. No explicit uniqueness ledger is established by this block; business replay uses the raw call ID separately (access.ts L99-L137).
- **Establishes:** Event identity includes tool/call/argument hashes.
- **Depended on by:** Persisted diagnostics; the current state reducer consumes tool name only (L491, L496).

```ts
// L479-L503
// validate admitted turn → tool.run → content conversion → completed/recovered
// catch → safeToolFeedback → tool-wide failure → safe failed result
```

- **What:** Rejects unavailable/noncurrent/aborted calls, otherwise awaits the tool and reports its promise outcome.
- **Why here:** No business operation runs before basic native scope checks (L479-L488).
- **Assumes:** A resolved return warrants generic completed. No domain `state`, `delivery_state` or `requires_render` validation was found in L489-L493.
- **Establishes:** Completion event is persisted before map deletion; failures receive static feedback. An event persistence error enters the catch after any preceding operation, so fallback remains unverified (L489-L503).
- **Depended on by:** Native reasoning, runtime final status, Worker durable recheck and customer feedback.

```ts
// L521-L557
// current-turn usage validation; turn/completed or nonretryable error finishes done
```

- **What:** Tracks incremental measured counters and native terminal status independently of tool state.
- **Why here:** Previous resumed-turn counters do not become new spend (L523-L551).
- **Assumes:** Provider gateway measurements and native counters agree; later code keeps unknown when they do not (L686-L697).
- **Establishes:** Invalid/nonmonotonic totals clear usageKnown.
- **Depended on by:** RuntimeResult and financial finalization.

**Cross-Function Dependencies:** `runtimeToolContent` only serializes trusted output forms (runtime-tool-content.ts L12-L16). `safeToolFeedback` projects errors. `ctx.onEvent` is Worker emit with current fencing/source checks (worker.ts L644-L672). `tool.run` has heterogeneous contracts documented in the handler table. Serialized input handling is established by the promise chain (L559-L562), not by each handler.

**Open Questions:** Native protocol guarantees around duplicate tool requests and late terminal frames are external to this local reader. The adapter hashes call IDs without thread/turn in `call_ref`; the raw business idempotency key is task scoped. No explicit corrective-call relation is attached to recovered events (L492).
