## `safeToolFeedback` in `dev/copypaste-platform/src/runtime-tool-feedback.ts` (L66-L84)

**Purpose:** Converts in-process failures to static, bounded model guidance and safe customer event fields (L66-L83; runtime.ts L494-L503).

**Inputs & Assumptions:** `error` is unknown/untrusted prose; tool name and input schema come from the registered trusted tool list (`runtime.ts` L471-L476). The `Problem` codes in `renderValidation` must represent pre-output validation for `not_performed` to be accurate (L58-L78). Actual analysis output validation precedes first file save (`analysis-role-tools.ts` L472-L482).

**Outputs & Effects:** Returns a `ToolFeedback`; does not write state, grant permissions, request a model, retry a tool or alter usage (L15-L21, L66-L84).

**Block-by-Block:**

```ts
// L67-L74
if (error instanceof ToolInputFailure) { /* bounded field/rule projection */ }
```

- **What:** Limits to sixteen issues, deduplicates field/rule pairs and emits static correction guidance.
- **Why here:** Only the typed boundary distinguishes this case before generic failure handling.
- **Assumes:** Trusted schema property names are safe. `fieldPath` accepts only actual declared keys, drops dynamic record/rejected keys and truncates paths (L41-L55); `branches` follows only local refs and bounded combinators/depth (L25-L38).
- **Establishes:** Error values, arbitrary messages and rejected keys are not copied into feedback.
- **Depended on by:** Model corrective input and customer canonical event projection.

```ts
// L76-L83
if (error instanceof Problem) { /* static domain/permission/source classes */ }
return { /* static unverified fallback */ };
```

- **What:** Own-property allowlisted codes permit correction; 401/403 and 404/409/410 receive bounded guidance; all else remains unverified.
- **Why here:** Unknown error prose never becomes execution permission.
- **Assumes:** Static code meanings remain stable across callers; no runtime check ties an allowlisted code to a specific tool (L77-L78).
- **Establishes:** Unknown errors and image failures do not claim no operation or zero cost (L82-L83).
- **Depended on by:** Runtime catch path and terminal delivery state.

**Cross-Function Dependencies:** `fieldPath`/`branches` are source-available helper calls; Zod issue codes use an allowlist (L23). `Problem` class identifies local domain errors; error details/messages are not returned (L76-L83). Runtime persists the safe feedback, while canonical SSE exposes an even smaller allowlist (`runtime.ts` L497-L503; task-events.ts L83-L91).

**Open Questions:** Additional handlers using the same allowlisted code after side effects would need separate review. Audio/video prepare currently call ordinary schema `.parse`, not this typed boundary (`audio-production.ts` L72; video-jobs.ts L63).
