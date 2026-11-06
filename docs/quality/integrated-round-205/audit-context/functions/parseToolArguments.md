## `parseToolArguments` in `dev/copypaste-platform/src/runtime-tool-feedback.ts` (L9-L13)

**Purpose:** Distinguishes a declared argument-validation failure from later business execution failures (L5-L13).

**Inputs & Assumptions:** `schema` is trusted in-process Zod schema; `args` is untrusted model input. Trusted schema refinements must not perform business side effects; no generic enforcement of this assumption is in this function (L9-L12). Cloud `txTool` calls it after authorization and before replay/effect (task-business-tools.ts L238-L259).

**Outputs & Effects:** Returns parsed/transformed data or throws the typed `ToolInputFailure` carrying validator issues; no business callback is passed (L9-L12).

**Block-by-Block:**

```ts
// L10-L12
const parsed = schema.safeParse(args);
if (!parsed.success) throw new ToolInputFailure(parsed.error.issues);
return parsed.data;
```

- **What:** Parse and preserve a typed pre-business failure.
- **Why here:** The wrapper invokes the business effect only after this returns (task-business-tools.ts L241-L258).
- **Assumes:** Schema itself is trusted and synchronous; all schema-internal side effects: nothing found here.
- **Establishes:** A returned value conforms to that full Zod schema; a thrown typed error identifies this boundary.
- **Depended on by:** `safeToolFeedback` L67-L74 emits `not_performed` for this class.

**Cross-Function Dependencies:** `schema.safeParse` is library behavior; `ToolInputFailure` is an in-process class (L6-L7). This is not a general guarantee for arbitrary Zod errors: those reach fallback feedback (L82-L83).

**Open Questions:** Whether each schema's refinements are pure requires schema-specific reading; this bounded record does not classify every schema in the repository.
