## `AudioProduction.execute` in `dev/copypaste-platform/src/audio-production.ts` (L160-L258)

**Purpose:** Executes or reads the original authorized audio operation while keeping generation/usage/delivery separate (L160-L258).

**Inputs & Assumptions:** Task/job identity is server supplied by `audio_produce` after `prepare`; prepare waits for independent authenticated customer authorization (task-business-tools.ts L749-L758; audio-production.ts L71-L87). Origin, capability, current source and dispatch authority are rechecked (L166-L208).

**Outputs & Effects:** Returns metadata with state, usage facts, delivery_state and actual available assets (L132-L146). It can resolve on existing non-prepared jobs, on unknown after owned dispatch, or on completed-but-blocked delivery (L163, L245-L257).

**Block-by-Block:**

```ts
// L161-L163
let job = ...;
if (!job) throw unavailable();
if (job.state !== "prepared") return this.db.tx(tx => this.metadata(tx, job), ...);
```

- **What:** Reuses original durable state without dispatching a second operation.
- **Why here:** Unknown/completed/cancelled jobs cannot silently become a fresh generation.
- **Assumes:** Consumers distinguish returned domain state from generic promise resolution; no generic check exists in runtime.ts L489-L493.
- **Establishes:** A non-prepared original job is observed, not re-executed.
- **Depended on by:** Model tool result and company accounting.

```ts
// L225-L247
// validated response → state completed/known usage
// delivery transaction → available, or caught delivery failure → blocked
```

- **What:** Persists validated generation before attempting authorized artifact delivery.
- **Why here:** A failed artifact save does not erase already occurred usage.
- **Assumes:** Customer access can change after provider completion; `origin` and signal/cancellation are rechecked (L235-L237).
- **Establishes:** Generation may be completed and billable while delivery is blocked (L228-L246).
- **Depended on by:** Metadata and financial receipt handling.

```ts
// L249-L257
catch (error) { ...; if (!ownedDispatch) throw error; }
job = ...;
return this.db.tx(tx => this.metadata(tx, job), ...);
```

- **What:** Marks dispatched unknown/cancelled-before-dispatch appropriately; rethrows only when dispatch was not owned.
- **Why here:** A lost/invalid response remains unknown instead of triggering a paid replay.
- **Assumes:** Callers inspect returned metadata for domain success. `metadata` includes error_code, usage_state and delivery_state (L137-L146).
- **Establishes:** Owned-dispatch unknown can be a resolved tool return, without claiming assets.
- **Depended on by:** Cloud/native tool transport, which currently treats resolve as generic completed.

**Cross-Function Dependencies:** `outcome` only changes eligible nonterminal jobs and records usage-known according to dispatch (L149-L157). `artifact` saves bytes and records audio-job linkage (L260-L267). `metadata` filters currently available authorized assets (L132-L146). Actual audio validation/transcription parsing and provider behavior are source/external boundaries; no real operation was run.

**Open Questions:** Which returned state should be counted as completed delivery? Which original-job reconciliation read can update an earlier generic tool failure without new dispatch? Native Desktop finish handling of this returned state was not completely analyzed.
