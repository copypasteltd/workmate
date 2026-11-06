## `buildSlides` in `dev/copypaste-platform/src/editable-design-tools.ts` (L548-L615)

**Purpose:** Validates and saves an immutable presentation source for a later exact-source render (L548-L614).

**Inputs & Assumptions:** Task and transaction are trusted; input comes from the full slides schema through `txTool` (task-business-tools.ts L413-L421, L238-L264). Brand, revision kind and exact resource provenance must remain valid (L554-L580).

**Outputs & Effects:** Returns an available prior result or saves a JSON source, then returns `state: prepared`, source version/hash, `requires_render: true` and explicit next-step instructions (L555-L556, L581-L614). It does not save the rendered PPTX/page files in this function.

**Block-by-Block:**

```ts
// L572-L580
const checked = await resources(...);
const rendered = await renderEditableDesign("presentation", input, checked.resources, ...);
```

- **What:** Validates/render-computes source geometry, fonts and current resources before source publication.
- **Why here:** Prepared source already has checked layout; final render repeats current checks.
- **Assumes:** Render result metadata describes this exact input/resources; actual external editor typography is separately limited (editable-design-render.ts L589-L594).
- **Establishes:** A prepared source passed local render/layout generation, not that its final export files have been persisted.
- **Depended on by:** Source body/pages and later `slides_render`.

```ts
// L592-L613
const source = await save(...);
return { state: "prepared", source_version_id: source.asset_version_id,
  sha256: source.sha256, files: [source], requires_render: true, ... };
```

- **What:** Persists only the editable source and returns exact identity.
- **Why here:** Final output requires a new, authorized exact-source operation.
- **Assumes:** The caller does not advertise preparation as final delivery; returned instruction says so explicitly (L612-L613).
- **Establishes:** Durable prepared source/version, not final PPTX delivery.
- **Depended on by:** `renderSlides` input and source lineage.

**Cross-Function Dependencies:** `completed` checks saved output availability (L470-L490). `resources` resolves authorized images/evidence/fonts; `save` delegates to actual immutable asset storage (L492-L526). `renderEditableDesign` produces local bytes and limitations; no AI request occurs in this path (L610).

**Open Questions:** No generic runtime prepared-to-render obligation was found in RuntimeToolState; how does task completion ensure the requested final PPTX was rendered from this exact source? This record does not decide the answer from descriptive instructions alone.
