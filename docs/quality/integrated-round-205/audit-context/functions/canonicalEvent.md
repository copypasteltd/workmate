## `canonicalEvent` in `dev/copypaste-platform/src/task-events.ts` (L29-L124)

**Purpose:** Projects stored task events into a stable customer SSE format (L29-L124).

**Inputs & Assumptions:** Stored event comes from an authorized task page, with project/source/membership checks before retrieval (L165-L201). Event body content is not automatically safe merely because stored; each recognized kind projects its own payload (L29-L110).

**Outputs & Effects:** Pure event projection with canonical task/attempt/sequence/time fields; sequence must be positive safe integer through the cursor schema (L111-L124). It does not acknowledge a business operation.

**Block-by-Block:**

```ts
// L83-L91
// runtime.tool.* → allowlisted tool/call_ref/code/category only
```

- **What:** Copies safe-format scalars and omits all other feedback/body fields.
- **Why here:** Customer activity does not inherit raw provider messages, arguments or arbitrary event body prose.
- **Assumes:** Kind identifies a trusted tool-outcome producer; this function checks field formats, not business success semantics.
- **Establishes:** Tool name <=64 matching syntax, 16-hex call reference, bounded error-code syntax and one of four categories (L88-L91).
- **Depended on by:** Web activity merge and feedback component.

**Cross-Function Dependencies:** Runtime constructs identities/feedback (runtime.ts L472-L503). `registerTaskEvents` authorizes every emitted batch and checks expired/ahead cursors (L165-L201). The Desktop JSON polling endpoint returns authorized raw bodies instead (`tasks.ts` L190-L226), so this projector is not shared by that endpoint.

**Open Questions:** No explicit repair target, argument digest, operation outcome or correction permission is present in the projected payload (L87-L91). Any future per-call association must account for this transport boundary; no implementation change is prescribed by this record.
