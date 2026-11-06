## `renderSlides` in `dev/copypaste-platform/src/editable-design-tools.ts` (L726-L756)

**Purpose:** Exports one exact prepared presentation source into actual packaged outputs (L726-L755).

**Inputs & Assumptions:** `source_version_id` and SHA are untrusted model-selected references; `readDesignSource` and `version` enforce fixed source availability/provenance/hash (L732-L738; version helper L36-L83). Task/tx are authorized by `txTool` before entry (task-business-tools.ts L424-L432, L238-L264).

**Outputs & Effects:** Returns still-available previous output or awaits `deliver`, which rechecks resources, renders/packages files, saves every output and returns `state: delivered` with exact source linkage (L745-L755, L616-L702).

**Block-by-Block:**

```ts
// L732-L747
const source = await readDesignSource(...);
if (source.kind !== "presentation") throw new Problem(...);
await assertFixedBrand(tx, t, source.input);
const replay = await completed(tx, t, "slides_render", input);
if (replay) return replay;
```

- **What:** Verifies source identity/kind/brand before reusing or creating exports.
- **Why here:** A stale or unrelated model reference cannot grant current resource access.
- **Assumes:** Prior output availability check is authoritative under current source permissions; `completed` checks all output versions (L470-L490).
- **Establishes:** Correct currently authorized presentation input and no automatic recreation of erased prior output.
- **Depended on by:** `deliver` and manifest prepared_source binding.

```ts
// L748-L755
return deliver(tx, storage, t, "presentation", source.input as SlidesInput, input);
```

- **What:** Awaits synchronous-at-tool-boundary final render/persistence; no queue status is returned.
- **Why here:** Returned files have been rendered and saved before `txTool` transaction commits.
- **Assumes:** External PPTX/PDF viewers respect declared limitations, not guaranteed by this function.
- **Establishes:** Output references plus exact prepared source in manifest/metadata (L647-L679).
- **Depended on by:** Native tool content and customer downloads.

**Cross-Function Dependencies:** `deliver` awaits `renderEditableDesign`, adds source/manifest/fonts/package and awaits each `save` before returning (L624-L702). Package format generation and actual PowerPoint/editor review are distinct; declared PDF/PNG/HTML are source reviews, not PowerPoint renders (editable-design-render.ts L589-L594).

**Open Questions:** Which task-level obligation associates this output with a previous prepared/failed source? `renderSlides` has exact source identity, but current generic runtime state uses only tool name (`runtime-tool-feedback.ts` L100-L116).
