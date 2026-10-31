## REQ-032 — Independent specification and alternate-binding refutation

**Reviewed finding:** `req-032-check.md`, F032-01. This reviewer did not author that finding. Read-only source/specification review; no runtime/test/Git changes, browser or virtualization. Only this report and the separately assigned REQ-041 report were edited. Sources are under `D:/dev/copypasted/自有agent/` and refer to the published stage146 baseline read for this audit, before any proposed stage147 repair. Root AGENTS applies; the checked `dev/`, platform/Desktop/Web root and `src/` AGENTS paths do not exist.

**Refutation result:** **survives with narrowed wording** · confidence: high. The product already has reusable solution input bindings and real predecessor handoffs. The confirmed gap is specifically a **WorkflowVersion-level declared input/output contract and invocation-to-contract binding** in the inspected shared/private cloud/native workflow paths. Do not report a product-wide absence of method inputs or demand a particular JSON Schema dialect, scalar field catalog, branching language or graphical builder.

---

**Authoritative requirement and attempted specification refutation:**

> 流程模板：版本化输入输出、步骤、工具范围、预算与失败处理；每次运行冻结版本，允许手动复用。
> — `docs/requirements/01-srs.md:154`, REQ-032

> WorkflowVersion 定义 input_schema、output_schema、steps、依赖、工具范围、预算、失败策略及授权策略。步骤类型初始为 agent_task、query、transform、render、approval、local_command 和 export。
> — `docs/modules/06-connectors-workflows.md:49`, section 4

> 输入输出 schema、步骤、工具和预算；trigger 时区、表达式、版本、生效时间及 catch_up
> — `docs/technical/03-data-model-and-lifecycle.md:63`, workflow_versions / triggers row

The strongest attempted refutation is that frozen prompts, selected predecessor indices and the generic saved-file manifest already constitute versioned inputs/outputs. Those are real partial implementation, but the module specifies input/output contracts on **WorkflowVersion**, alongside its steps. No current definition can declare those contracts; the fixed predecessor manifest is a server transport schema, not a workflow's declared business contract. The section also separately specifies SolutionVersion at line 53, so solution input bindings are relevant alternative capability rather than an alternate spelling of WorkflowVersion.

The stage145 supplement `docs/requirements/10-workflow-handoffs.md:3-24` explicitly preserves the original SRS scope and defines a bounded predecessor handoff/failure subset. It does not supersede the original template contract with only `input_steps`. `docs/technical/91-private-cloud-workflows.md:46-50` describes a bounded sequence; it does not require arbitrary branching and does not close the original contract gap. `docs/quality/remaining-work-stage146.md:38` separately records the remaining input/output contracts. That status row supports scope interpretation; the source paths below supply the actual defect evidence.

---

**Alternate implementations inspected and why they do/don't refute the finding:**

| Candidate | Exact evidence and disposition |
|---|---|
| SolutionVersion / trial / installation bindings | `dev/copypaste-platform/src/solution-model.ts:22-35,45-89` declares named required assets, connectors, exact asset-version/SHA bindings, per-trial brief and explicit approval. `solution-service.ts:261-292` rejects undeclared requirements and resolves actual authorized exact versions. `:555-603` freezes bindings in a real trial and enqueues independent pinned role tasks. **This refutes any product-wide claim of absent reusable method input binding.** |
| Solutions as a workflow wrapper | `solution-model.ts:22-35,76-90` has no workflow/version/run selector. `solution-service.ts:573-603` creates independent role tasks with solution bindings, not a workflow run, cursor, step dependency graph or workflow contract. `solution-tools.ts:102-115` returns method instructions/requirements for the current exact role, not a workflow invocation binding. Reading an installed method or allowing a consultant to prepare a new fixed workflow cannot bind declared inputs to an unchanged existing workflow version. **Does not refute the workflow-specific gap.** |
| Role / agent template contract | `agent-templates.ts:107-132` derives an input schema from a role's required/optional string fields and records role steps/deliverables. Workflows freeze role hashes (`cloud-workflows.ts:113-163`) and retain those meaningful checks. Neither the workflow definition nor its invocation maps a workflow input contract to these role contracts. **Existing role checks must not be described as missing.** |
| Exact predecessor files and saved full text | `workflow-handoffs.ts:8-15,18-24,28-77,80-102` defines strict manifests, records full private output, selects prior producing steps and verifies original asset versions/SHA on read. **Real typed transport and exact output handoff exist.** The manifest only describes already produced results; it does not declare or accept a new run's initial workflow inputs or customer-defined output contract. |
| Private schedule expected output | `cloud-schedule-model.ts:9-25,41-58` accepts fixed workflow identity and an `expected_output` string with calendar/catch-up data. `cloud-schedules.ts:179-204` validates the same stored workflow through CloudWorkflows. **An expected-output description is real metadata, but supplies no input or output contract validator/binder.** |
| Signed event workflow | `cloud-event-model.ts:6-26,54-86` freezes fixed workflow identity, role/source references and an expected-output description. `cloud-events.ts:208-235` reaches the same fixed-definition validation. **Event metadata does not add a workflow contract/run map.** |
| Conversational context / customer follow-up | Workflow child creation uses fixed `step.prompt`, exact predecessor inputs and current source/authority checks (`cloud-workflows.ts:1020-1053`, `desktop-workflows.ts:298-307`). Task dependency tools and prompts can collect information. This does **not** justify claiming that all varying customer information is impossible; it also does not supply a declared WorkflowVersion contract or freeze a per-run binding to it. |

---

**Direct enforcement and caller checks:**

1. `desktop-workflows.ts:22-35` accepts only `{steps}` in a strict definition, with fixed codex prompt/role/budget, predecessor selector and failure policy, fixed dataset UUID, or approval text. `cloud-workflows.ts:38` aliases this definition. `business.ts:195-210` separately has a strict top-level `{steps}` shared contract. None can represent a declared template input/output contract under another recognized field.
2. Cloud tool validate/save parse that exact definition (`cloud-workflows.ts:403-424`). Cloud run accepts only workflow/version/hash (`:536-542`); `requestRun` validates the frozen version and stores its exact definition/role hashes without invocation inputs (`:201-266`). This checks actual parsers/callees rather than only a schema-name search.
3. Native tool wrapper parses arguments before dispatch (`desktop-workflows.ts:131-142`); save/publish use the strict definition (`:157-186`), and run accepts the same version/hash-only reference (`:188-198`). Native trusted sequencer validates fixed steps (`dev/copypaste-desktop/src/local-workflow.ts:34-53`). `/advance` binds predecessor files and enqueues the fixed prompt (`desktop-workflows.ts:298-307`).
4. Shared create parses `{name,definition:workflow}` (`business.ts:405-424`). Shared run does not consume request-body input values: replay identity is `{}`, and the insert copies `w.definition` (`:451-494`). The Web Run button passes no bindings (`dev/copypaste-web/src/main.tsx:2453-2463`).
5. Cloud child enqueue passes only the fixed prompt, role, budget, conversation, pinned role hash, billing account, run/cursor and predecessor manifests (`cloud-workflows.ts:1029-1053`). Native enqueue similarly passes its fixed prompt and predecessor manifests (`desktop-workflows.ts:300-307`). These paths do not route through the real `solution_trial` binding option. `task-service.ts:285-303` shows predecessor and solution-trial contexts are distinct optional server-owned fields.
6. Actual registrations are active: `server.ts:457,470,477-478` registers native executions, solutions, shared business and private cloud workflows. `task-business-tools.ts:214-220,1572-1606` gates and installs the actual consultant workflow/schedule/event tools. This is not an unregistered dead-code finding.
7. `migrations/094-desktop-workflow-origin.sql:23-28,43-52` stores immutable workflow definitions/hashes/role/source references. JSONB storage capacity alone cannot refute strict API parsers and fixed downstream execution. Source references record provenance, not a customer-editable invocation contract.

---

**Searches and actual results:**

- `rg --files src -g '*workflow*' -g '*routine*' -g '*template*' -g '*handoff*'` identified workflow services, handoffs/control and agent templates; `rg --files src -g '*solution*' -g '*method*' -g '*routine*'` found `solutions.ts`, `solution-tools.ts`, `solution-service.ts`, `solution-model.ts`, `desktop-solutions.ts`, which were followed as alternate implementations.
- `rg -n -e routine -e 'workflow.*schema' -e 'schema.*workflow' -e input_bind -e output_bind -e run_inputs -e input_values -e parameters src -g '*.ts'`: no workflow input/output binder; other results were dedicated media, publication, project/configuration or route parameters. This was only discovery, not the absence proof.
- `rg -n -e input_schema -e output_schema -e 'workflow.*input' -e 'workflow.*output' -e 'outputs:' -e 'inputs:' src -g '*.ts'`: actual role/Skill schemas and workflow predecessor tools were found and inspected. They were not ignored as irrelevant names.
- `rg -n -e workflow_id -e workflow_version -e workflow_runs src/solution-model.ts src/solution-service.ts src/solutions.ts src/desktop-solutions.ts`: zero hits. The full model fields and trial enqueue/read paths above confirm why this is not a hidden workflow wrapper; zero hits alone are not used as proof.
- `rg -n -e solution_trial -e enqueueTask src/cloud-workflows.ts src/desktop-workflows.ts src/business.ts`: workflow child enqueue sites, no solution-trial binding. The actual enqueue call argument lists were read.
- `rg -n -e registerSolutions -e registerCloudWorkflows -e registerBusiness -e registerDesktopExecutions src/server.ts`: active registrations at 457,470,477,478.
- Mistaken nonexistent guessed filenames (`agents.ts`, template/model guesses, an old requirement-register/module name), a `src/solution*.ts` shell glob error and docs paths once searched from the platform cwd were corrected using actual `rg --files` results and the root cwd. No absence conclusion rests on those errors.

**Minimal reproduction supported by source (not executed by this reviewer):** save a reusable workflow with a fixed campaign prompt/dataset. Try to declare a workflow input/output contract or pass a new run binding to its published unchanged version: the private save/run parsers reject unknown fields; the shared run handler ignores request-body values and copies the stored definition. Binding a solution asset instead creates a separate solution trial's independent role tasks, not that workflow run. Existing predecessor file handoffs continue to work and are not part of this failure.

**Actionable narrowed finding / entry points:** retain F032-01 as workflow-specific. Reuse the existing exact-version asset/connector and source checks from `solution-model.ts` / `solution-service.ts` when defining a bounded workflow contract. Share the new contract across native/private cloud/shared definitions, freeze invocation bindings with run identity, and resolve bindings before child enqueue. Freeze/validate named output references through the actual saved-file capture path. Preserve old definitions and current predecessor semantics. Do not redesign this into arbitrary expression evaluation or claim the completed repair certifies all business/OS/production acceptance.

**Not checked / remaining limits:** no live database, provider, browser or network-fault reproduction was executed for this independent specification refutation; no all-business or full professional role acceptance was inferred. Exact contract grammar and supported initial input/output types remain implementation choices. This review does not refute the existing immutable version, approval, budget, provenance or exact predecessor handoff protections.
