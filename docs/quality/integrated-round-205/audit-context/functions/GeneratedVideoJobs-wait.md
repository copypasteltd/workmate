## `GeneratedVideoJobs.wait` in `dev/copypaste-platform/src/video-jobs.ts` (L404-L416)

**Purpose:** Observes/advances one original durable video job until its usage/outcome boundary or a bounded interruption (L404-L415).

**Inputs & Assumptions:** Actor/tenant/project/job are trusted handler context; `read` rechecks project authorization, task content and private ownership (L100-L106). The job comes from `prepare` of the same original request (`task-business-tools.ts` L784-L792; video-jobs.ts L62-L75).

**Outputs & Effects:** Can return a confirmed failed/cancelled job, or a completed job with delivery state other than pending. It throws budget violation, abort or fourteen-minute observation expiry (L405-L415). `advance` can progress the durable original job; this function does not call `prepare` again (L412).

**Block-by-Block:**

```ts
// L408-L411
const result = await this.read(actor, tenant, project, id);
if (result.budget_violation) throw unavailable("VIDEO_COST_RECONCILIATION_REQUIRED");
if (result.usage_state === "confirmed" && (["failed", "cancelled"].includes(result.state)
  || result.state === "completed" && result.delivery_state !== "pending")) return result;
```

- **What:** Uses confirmed usage plus terminal observation to stop waiting.
- **Why here:** It can return known failed/cancelled accounting without polling forever.
- **Assumes:** Consumer interprets domain state and available assets separately. Generic runtime only checks promise resolution (runtime.ts L489-L493).
- **Establishes:** Returned usage is confirmed and no budget violation; it does not establish completed/available delivery.
- **Depended on by:** `generated_video_create` native output and generic completed event.

**Cross-Function Dependencies:** `metadata` selects only available output assets and computes independent delivery_state (L78-L97). Delivery advance can persist invalid/blocked/pending errors (`video-jobs.ts` L325-L326), so `delivery_state !== pending` is broader than available. Provider/advance internals are not fully analyzed by this wait-function record.

**Open Questions:** Whether domain failed/cancelled/invalid output should return native success; which original status read closes an unresolved attempt; native Desktop finish classification of the returned metadata. No retry or state-change recommendation is made here.
