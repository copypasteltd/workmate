## REQ-032 — Reusable workflow input/output contracts

> 流程模板：版本化输入输出、步骤、工具范围、预算与失败处理；每次运行冻结版本，允许手动复用。
> — `docs/requirements/01-srs.md:L154`

> 输入输出 schema、步骤、工具和预算；trigger 时区、表达式、版本、生效时间及 catch_up
> — `docs/technical/03-data-model-and-lifecycle.md:L63`, `workflow_versions / triggers` row

**Verdict:** partial · confidence: high · independent refutation: pending

**What this demands of an implementation:** A saved immutable workflow must describe the data it accepts and the results it produces, so a customer can reuse the same approved method with a new set of inputs. An invocation must bind its actual values to that version. The current technical design explicitly calls these contracts schemas. The specification does not prescribe field names, a JSON Schema dialect, primitive types, arbitrary branching, expression evaluation, or a graphical builder. Those details remain implementation choices; they must not be reported as independently mandatory features.

---

### F032-01 — No template-level input/output contract or per-run input binding

**Observed consequence:** A marketing customer can save a fixed weekly report sequence, but cannot declare its changing campaign name, period or dataset as named, checked run inputs. Reusing the method repeats fixed prompts and dataset identifiers. Changing those values requires revising/recreating the workflow or embedding them in a new prompt. A template-specific named result contract cannot be declared either. This does not erase existing role-level tool/deliverable checks or the real predecessor file handoffs.

**Where enforcement lives:**

```ts
// dev/copypaste-platform/src/desktop-workflows.ts:L22-L35
export const nativeWorkflowDefinition = z.object({ steps: z.array(
  z.discriminatedUnion("kind", [ /* codex, approval, analytics.summary */ ])
).min(1).max(8) }).strict().superRefine(/* earlier producing step checks */);

// dev/copypaste-platform/src/cloud-workflows.ts:L38
export const cloudWorkflowDefinition = nativeWorkflowDefinition;

// dev/copypaste-platform/src/business.ts:L208-L210
export const workflow = z.object({ steps: z.array(step).min(1).max(8) }).strict();
```

- The private cloud and Desktop definitions accept only `steps` at the top level. `codex` steps have a fixed prompt, role and budget plus the stage145 predecessor/failure controls. `analytics.summary` accepts a fixed `dataset_id` (`desktop-workflows.ts:L22-L35`).
- The shared workflow route also accepts a strict `steps` definition (`business.ts:L195-L210`, `L405-L424`).
- Private cloud `workflow_run` accepts only workflow/version/hash (`cloud-workflows.ts:L536-L542`); `requestRun` freezes that version and inserts no run input map (`L201-L266`).
- Desktop `workflow_run` similarly accepts workflow/version/hash and inserts the fixed version (`desktop-workflows.ts:L188-L198`). Its trusted runner parses that same fixed definition (`dev/copypaste-desktop/src/local-workflow.ts:L34-L53`).
- Shared manual run stores a copy of `w.definition`; it has no input values/parser/validation and its replay identity contains `{}` (`business.ts:L451-L494`).
- Actual private child creation uses `step.prompt`, `step.role_key`, `step.budget_micros` and selected predecessor manifests, with no template input resolution (`cloud-workflows.ts:L1029-L1053`, `desktop-workflows.ts:L298-L307`).
- Child success is captured into actual text/assets (`workflow-handoffs.ts:L28-L50`), but the workflow definition has no customer-declared named output schema to validate or expose. This is a template contract gap, not a claim that all task output validation is absent.

**Paths walked:**

| Path | Actual behavior |
|---|---|
| Cloud consultant → `workflow_validate`/`workflow_save` → `validate` | Strict shared private definition rejects an input/output schema; real role/Skill availability and step budgets are checked (`cloud-workflows.ts:L106-L168`, `L403-L424`). |
| Cloud `workflow_publish`/`workflow_run` → frozen version → customer decision → `advanceCloudWorkflows` | Immutable definition/hash/role versions and explicit child fees are enforced; children receive fixed prompt and predecessor manifests (`L201-L266`, `L718-L820`, `L857-L1058`). |
| Desktop consultant → `workflow_save`/`workflow_publish`/`workflow_run` → trusted sequencer → `/advance` | Immutable native version, local execution, user approval and per-step budget remain enforced; no invocation input map (`desktop-workflows.ts:L131-L205`, `L208-L318`; `local-workflow.ts:L58-L149`). |
| Shared Web workflow form → `/workflows` → `/run` → `advanceWorkflows` | Form stores a chosen fixed dataset UUID, and run copies that fixed definition. No alternative input form hides in this path (`dev/copypaste-web/src/main.tsx:L2413-L2559`; `business.ts:L385-L494`, `L905-L1088`). |
| Private schedule/event preparation → fixed workflow validation | These callers validate the stored version through the same private workflow service; they do not add a missing template schema (`cloud-schedules.ts:L122-L145`, `L179-L204`; `cloud-events.ts:L208-L235`). This read did not audit all trigger execution semantics. |

**Read-only reproduction executed:** Native Node.js/tsx, current backend imports, no server/database/browser, no repository/test/runtime mutation. PowerShell piped the following module to `node --import tsx --input-type=module`:

```js
import { nativeWorkflowDefinition } from './src/desktop-workflows.ts';
import { workflow } from './src/business.ts';
const steps = [{kind:'codex', role_key:'designer',
  prompt:'Make the weekly campaign', budget_micros:100000}];
const plain = nativeWorkflowDefinition.safeParse({steps});
const named = nativeWorkflowDefinition.safeParse({steps,
  input_schema:{type:'object',properties:{campaign:{type:'string'}}},
  output_schema:{type:'object'}});
const shared = workflow.safeParse({steps,input_schema:{type:'object'}});
```

Observed output, exit code 0:

```json
{"native_plain_accepted":true,"native_named_contract_accepted":false,"native_issues":[{"code":"unrecognized_keys","keys":["input_schema","output_schema"],"path":[],"message":"Unrecognized keys: \"input_schema\", \"output_schema\""}],"shared_named_contract_accepted":false,"shared_issues":[{"code":"unrecognized_keys","keys":["input_schema"],"path":[],"message":"Unrecognized key: \"input_schema\""}]}
```

The reproduction establishes the concrete strict-schema boundary; the complete caller/runner reads establish that an alternate field name or downstream wrapper does not supply this contract in the checked paths. It does not prove that arbitrary JSON Schema is itself the required design.

**Existing behavior that is implemented, not a finding:**

- Exact predecessor output selection, saved full text, pinned original file versions, checksums and bounded reading exist (`workflow-handoffs.ts:L18-L102`).
- `on_failure=stop|review` is frozen. Known settled failures can wait for explicit customer skip, never automatic replay; missing dependent output stops subsequent execution (`workflow-handoffs.ts:L105-L122`, `cloud-workflows.ts:L921-L955`, `desktop-workflows.ts:L260-L280`).
- Private runs freeze workflow and role versions and require explicit approvals. Repeat requests use existing idempotency and immutable run bindings. Failure/reconciliation/authority checks remain real behavior, even though the broad acceptance matrix remains open.
- Definition `input_steps` is a dependency selector, not a named business input declaration. Likewise, actual result manifests are valuable output records, but do not provide the missing declared template contract.

**Searched:**

- `rg --files src -g *workflow* -g *routine* -g *handoff* -g *automation*`: found `workflow-control.ts`, `workflow-handoffs.ts`, `desktop-workflows.ts`, `cloud-workflows.ts`; schedules/events were followed via actual callers/imports.
- `rg -n -g *.ts -e input_schema -e output_schema -e workflow_versions src migrations`: `input_schema`/`output_schema` hits belong to agent templates, Skills and media-effects tools; workflow-version hits lead to the checked three workflow paths, schedule/event callers, admin history and erasure. No separate workflow schema implementation was found.
- `rg -n -e input_steps -e on_failure` in workflow files: the stage145 controls are present and were followed; they are not mislabeled as absent.
- Workflow definitions and invocation sources read: `desktop-workflows.ts:L1-L318`, `cloud-workflows.ts:L1-L1100`, `business.ts:L195-L217,L385-L550,L905-L1088`, `schedules.ts:L51-L143`, `cloud-schedules.ts:L122-L145,L173-L223`, `cloud-events.ts:L202-L260`, `workflow-handoffs.ts:L1-L123`, `local-workflow.ts:L1-L150`, `main.tsx:L2413-L2559`, and the cited source-tracking/immutability migration sections.
- Searches for guessed `automations.ts`, `workbench.ts`, `operations.ts`, `execution.ts`, `business-tools.ts`, and `contracts/openapi.json` returned missing paths. The actual routes were found in `business.ts` and actual tool registration in `task-business-tools.ts`; absence was not inferred from those missing guessed names.

**How the verdict was reached:** `partial`, rather than `absent`, because usable frozen sequential workflows, real output handoffs, budget authorization and known-failure handling exist. The specific missing part is a reusable template's own input/output contract and run input binding required by REQ-032/data-model design. Broad all-business acceptance and professional quality are outside this finding.

**Suggested implementation entry points (choices, not new mandatory scope):** Extend a shared workflow contract module; accept and freeze validated per-run values in the cloud/native request paths; resolve only declared named bindings before child enqueue; record named outputs as exact-version references/text and enforce the declared contract before dependent steps consume it. Keep budget/role/Skill/source permissions outside customer data. Add customer confirmation/preview fields in the existing workflow UI and native approval card. Preserve old definitions and runs as the legacy contract version. Conditional graphs, arbitrary scripts and generic expression evaluation are not needed to close this finding.

**Open questions / not checked:**

- An independent agent should refute F032-01 before root reports it as a final confirmed finding.
- The authoritative sources do not specify the exact contract grammar or full primitive/asset type set. A bounded grammar can be selected as an implementation decision and documented without claiming it was user-specified.
- Arbitrary conditional branching was considered but is not a confirmed requirement: `docs/technical/91-private-cloud-workflows.md:L48` explicitly describes bounded sequential steps, while REQ-032 does not demand a branching language.
- This check does not certify the complete pause/retry/crash/offline matrix or all conditional marketing outcomes. The stage146 requirement's remaining full acceptance scope stays open.
