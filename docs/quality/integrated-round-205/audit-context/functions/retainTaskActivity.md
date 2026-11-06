## `retainTaskActivity` in Web `src/task-tool-state.ts` and Desktop `renderer/src/task-tool-state.ts` (L9-L15)

**Purpose:** Keeps current tool notices while bounding long streamed activity (L8-L15). The files were byte-identical at capture.

**Inputs & Assumptions:** Old/batch are semi-trusted server events. `toolName` accepts only three recognized kinds and a bounded tool-name pattern (L2-L3). Caller `useTaskEvents` merges paginated polling or increasing canonical SSE events (task-events.ts L50-L62, L133-L151).

**Outputs & Effects:** Returns an array without external writes: latest 400 activities plus at most 128 latest-tool events, deduplicated by ID and sorted numerically (L10-L14).

**Block-by-Block:**

```ts
// L10-L14
const all = [...new Map([...old, ...batch].map(event => [String(event.id), event])).values()];
const tools = new Map<string, ActivityEvent>();
for (const event of all) { const name = toolName(event); if (name) tools.set(name, event); }
```

- **What:** De-duplicates exact event IDs, then retains one last-encountered event per tool name.
- **Why here:** Tool status survives hundreds of message deltas outside the normal display window.
- **Assumes:** Input order reflects chronology before the per-tool map is built. Sorting occurs only after the map is reduced (L14); no pre-sort or numeric validity check exists inside this function.
- **Establishes:** At most 528 returned distinct events; a retained tool state can still represent only one call per name.
- **Depended on by:** `pendingToolFeedback` and rendered activity.

**Cross-Function Dependencies:** `toolName` is the only validator in the helper. Both platform transports provide ordered pages on their normal path (platform tasks.ts L221; task-events.ts L194). React state merger invokes this after checking current session generation (web task-events.ts L21-L42).

**Open Questions:** What outcome association should survive multiple independent same-name calls? How should summaries survive cursor resets, which clear this array (web task-events.ts L85-L93, L162-L168)? No per-call unresolved state lives outside the event array here.
