## `pendingToolFeedback` in Web `src/task-tool-state.ts` and Desktop `renderer/src/task-tool-state.ts` (L16-L26)

**Purpose:** Derives at most four current customer notices from retained tool events (L16-L25).

**Inputs & Assumptions:** Activity events are semi-trusted. Trusted-name syntax/kind is checked by `toolName` (L2-L3). Latest encounter order must represent intended current status; no additional operation/call relationship is inspected (L17-L19).

**Outputs & Effects:** Returns only tool/category/code/reference; no body prose or input is forwarded. Invalid codes/references fall back to static generic values (L20-L25).

**Block-by-Block:**

```ts
// L17-L20
const tools = new Map<string, ActivityEvent>();
for (const event of items) { const name = toolName(event); if (name) tools.set(name, event); }
return [...tools.values()].filter(event => event.kind === "runtime.tool.failed")
  .sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 4).map(...);
```

- **What:** Reduces by name, shows only failures, then orders and caps notices.
- **Why here:** A later same-name completion suppresses an earlier failure in the presentation layer.
- **Assumes:** Same-name latest event is the proper replacement; explicit failed-call repair relation: nothing found.
- **Establishes:** At most four notices, with bounded safe scalar fields.
- **Depended on by:** `TaskToolFeedback`.

**Cross-Function Dependencies:** `retainTaskActivity` preserves a latest event per name outside the normal window (L9-L15). The feedback component is a presenter; it does not fetch operation receipts or alter task state (task-tool-feedback.tsx L5-L20).

**Open Questions:** Are four notices intended as a preview with a total remaining count? No count is returned here. Different failed calls for the same tool cannot be independently represented by this return shape (L17-L25).
