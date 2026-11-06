## `TaskToolFeedback` in Web `src/task-tool-feedback.tsx` and Desktop `renderer/src/task-tool-feedback.tsx` (L5-L21)

**Purpose:** Shows bilingual current delivery warnings without exposing arbitrary event prose (L5-L20). Files were byte-identical at capture.

**Inputs & Assumptions:** Events/status/errorCode come from authorized task UI data. `pendingToolFeedback` sanitizes the displayed scalar data (task-tool-state.ts L16-L25). Status is presentation information, not authority for a retry or financial change.

**Outputs & Effects:** Renders nothing when no pending failures and no recognized delivery error; otherwise renders `role=status`, generic current/terminal guidance and optional support reference (L7-L19). No network, retry, payment or permission mutation occurs.

**Block-by-Block:**

```ts
// L7-L9
const deliveryFailed = ["TOOL_DELIVERY_INCOMPLETE", "IMAGE_TOOL_FAILED"].includes(errorCode ?? "");
if (!failures.length && !deliveryFailed) return null;
const active = ["queued", "running", "needs_input", "paused"].includes(status ?? "");
```

- **What:** Preserves a generic warning from terminal error code even when events are missing.
- **Why here:** Cursor reset/retention can leave no individual failure reference.
- **Assumes:** Unrecognized states use terminal wording. No business-state reclassification occurs in this component.
- **Establishes:** It does not state prior usage was free; static guidance explicitly preserves actual usage (L17-L18).
- **Depended on by:** Task page/workbench display.

```tsx
// L19
{failures.map(failure => <div key={failure.tool}>...</div>)}
```

- **What:** Renders one notice per tool-name result.
- **Assumes:** Tool names are unique in the returned preview, established by the reducer (task-tool-state.ts L17-L20).
- **Establishes:** Support details show only sanitized code/reference.
- **Depended on by:** Customer ability to report the original record.

**Cross-Function Dependencies:** `useI18n` supplies static bilingual text; `pendingToolFeedback` bounds/sanitizes input. Shared files do not imply local native Codex execution shares the cloud state machine.

**Open Questions:** Complete per-call status and remaining-failure count are not inputs. No actionable resolution control is implemented here; the surrounding task/input/reconciliation workflows must supply it.
