# Workmate · CopyPaste Desktop

[中文](README.md) · [Documentation](https://github.com/copypasteltd/workmate/blob/docs/docs/README.en.md) · [Desktop branch](https://github.com/copypasteltd/workmate/tree/desktop)

<!-- business-quality-stage78 -->

## Current delivery review and usage

Frameless Windows app running Codex, files, terminal and browser tools on the customer device. Reviews now retain the exact current delivery version, with accept, changes requested and discard decisions. Customers can report baseline minutes, cumulative human effort and revisions independently. Project usage and the scoped Admin quality dashboard distinguish technical success, customer acceptance, recorded reuse and company service costs.

Desktop remains customer-local Codex with explicit revocable full local access, no Electron menu/frame, no visible vertical or horizontal scrollbar rails, and real wheel/keyboard access. Content reflows, focused inputs remain visible at 800×600, and the composer and receipt stay accessible. The previous progress-bar constraint is withdrawn; truthful progress remains. Extension remains independent native right Side Panel chat/file upload to cloud Codex. Every AI request uses the company gateway.

1. Sign in, choose a tenant/project and create a task in its correct execution location. Desktop needs an explicit folder and local permission; the Extension needs no Desktop installation.
2. Inspect the actual result and open “Review this delivery” (Desktop) or the task review form. Save acceptance, requested changes or discard with optional feedback. Task/version or delivery changes return a conflict requiring reload.
3. Optionally record cumulative human figures. Blank means unknown; zero means explicitly none. Refresh preserves the open effort form and visible input access.
4. Inspect project usage or Admin → Delivery quality within your permission scope. Incomplete costs stay incomplete; service costs exclude refund offsets, outside services and labor. No ROI or retention is inferred.

Apply additive SQL095 before publishing the dependent API/UI; published SQL001–094 and the original task OpenAPI are unchanged. Legacy acceptance without a delivery snapshot requires a new customer review. The original review endpoint remains compatible; current forms require both task version and delivery digest plus idempotency. Customer review requires project approval authority. Admin can read scoped aggregates under `admin.usage.read` but cannot accept for a customer, read feedback through aggregates or grant OS access.

Build independently with `npm ci`, the approved `COPYPASTE_LOCAL_CODEX_BIN`, `npm run runtime:prepare`, `npm run build` and `npm start`. Use `npm run package:dir` for the unsigned candidate. Runtime version/hash, company origins and native setup details remain in the full guide below. Signing and human installation/upgrade acceptance remain pending.

```mermaid
flowchart LR
    Web[Web and native Chrome Side Panel] --> Cloud[Company cloud Codex]
    Desktop[Frameless Desktop] --> Local[Customer-device Codex and local tools]
    Cloud --> AI[Company OpenAI-compatible AI gateway]
    Local --> AI
    Cloud --> Delivery[Output and fixed artifact versions]
    Local --> Delivery
    Delivery --> Review[Customer review and human-effort records]
    Review --> Metrics[Scoped quality and service costs]
    Admin[Admin usage permission and explicit denies] --> Metrics
```

Current source qualification: 861/861 platform cases across 67 files/17 batches, 68 client units, 26 actual packaged-Desktop checks, four Web/Admin checks and 8 native Side Panel checks. The retained 17-case native-supervisor proof has all 57 bound files unchanged. These scopes are separate and not additive. Actual auth, database, files, billing and local Codex run; model/business/customer inputs and native-dialog decisions are explicit fixtures. TC-056 real-task baselines/blind review, all 18 roles/29 Skills, complete OS/Codex Desktop parity and production gates remain unproven. Original 102 requirements/102 cases and 81 partial / 21 unproven / 0 fully accepted remain.

The Desktop31 and Web/Admin07 journeys retain their original bytes. Their only later bound-file difference is two migration-test expectations updated from 94 to 95, archived and checked exactly; all runtime, UI and journey sources remain unchanged. Platform21 freshly reruns the updated tests. See the checkpoint for this explicit qualification.

![Actual frameless Desktop at 1440 by 980](assets/screenshots/workmate-local-31-layout-1440-en.png)

![Actual desktop interface](assets/screenshots/workmate-local-31-delivery-review-compact-en.png)

![Actual desktop interaction](assets/screenshots/workmate-local-31-local-agent.gif)

[MP4](assets/screenshots/workmate-local-31-local-agent.mp4)

[Design](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/78-business-delivery-quality.md) · [Contract](https://github.com/copypasteltd/workmate/blob/docs/docs/contracts/business-quality-openapi.json) · [Exact source and media evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/business-quality-checkpoint.json) · [Changes](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-23-business-delivery-quality.md)

<details>
<summary>Full setup, architecture and historical verification records (earlier counts/captures retain their original scope)</summary>

**Historical stage-77 implementation:** Desktop runs Codex on the customer device with explicit full access, local files/terminal, persistent threads, native questions, company design/video tools and native workflow children. Twelve local browser tools now perform actual navigation, interaction, upload, screenshots and downloads; Stop/revoke reclaim owned pages. Desktop hides scrollbar rails and reflows artifacts, code and tables while preserving vertical scrolling and keyboard access. The previous progress-bar constraint is withdrawn; truthful progress feedback remains. Separate qualification covers 851 platform, 68 client, 17 native-supervisor, 10 standalone Electron-browser and 25 packaged-journey checks; counts are not additive. Full professional delivery across 18 roles/29 Skills, complete OS-application/Codex Desktop parity, live models and production remain pending. Extension retains independent ChatGPT-style native right Side Panel cloud chat and authorized-file upload; its UI was not rerun. See [design](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/77-desktop-native-browser.md), [layout requirements](https://github.com/copypasteltd/workmate/blob/docs/docs/requirements/04-desktop-layout-and-scroll.md) and [source/media checkpoint](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-browser-checkpoint.json).

## Product and execution location

A frameless Windows Desktop Agent whose Codex process, session loop, file tools and terminal run on the customer computer. Inference uses the company internal OpenAI-compatible server. The Web application and Chrome Extension run cloud Codex; their file-upload service is not a substitute for the local Desktop kernel.

```mermaid
flowchart LR
  Desktop[Frameless Desktop] --> Main[Trusted local permission and session control]
  Main --> Native[Customer-device Codex and local tools]
  Main --> Control[Company identity / role / budget control]
  Native --> Gateway[Company scoped AI gateway]
  Native --> CompanyTools[Company project and media tools via trusted main]
  CompanyTools --> Artifacts[Private immutable artifacts and explicit native download]
  Web[Web] --> Cloud[Cloud Codex and business tools]
  Extension[Native right Side Panel and selected-file uploads] --> Cloud
  Cloud --> Gateway
  Gateway --> Ledger[Server-observed usage and ledger]
```

## Sign-in and usage

1. Open Desktop, complete email/enterprise identity in the fixed company browser page, then return through localhost PKCE. Choose a company and project.
2. Choose a supported local specialist and a workspace using the native directory chooser. Folder selection grants no execution permission.
3. Choose read-only, workspace-write or full local access and confirm the native permission dialog. Full access defaults to Cancel and explicitly covers resources outside the workspace under the current OS user.
4. Enter the request and per-turn budget. Main reserves once, receives a task-scoped credential and launches the pinned bundled Codex. Watch messages, terminal output, file changes and company billing receipts.
5. Use company image/design/data tools allowed by the current specialist. Artifact buttons identify exact versions; choose their local destination in the native save dialog. Files and commands still run on this computer.
6. Continue the same local thread. Stop a running turn; change permission while idle or revoke at any time. Signing out revokes local grants. Network retries never blindly rerun accepted local actions.

Company Admin can manage service access, VIP and fees, but cannot grant local OS permission. Full access is `danger-full-access` / `never`, without repeated command approval after consent; it does not elevate the OS account. Grants last until revocation/sign-out, independent of the optional legacy file bridge's one-hour/create-only grants.

## Implementation and recovery

- `src/main.ts`: trusted identity, native dialogs, IPC and lifecycle.
- `src/local-agent.ts`: encrypted journal, stable request keys, ownership, permission and result synchronization.
- `src/local-codex.ts`: native app-server, pinned Skills, checkpoint, sandbox, streaming, interruption and owned-process shutdown.
- `src/preload.cts` / `renderer/src/local-agent.tsx`: restricted bridge and local work UI; no credential or executable path crosses IPC.
- `src/window-controls.ts`: custom 40px title bar; `frame:false`, `thickFrame:false`, no Electron/Alt menu.

Each native turn has an immutable desktop execution owner. Desktop-native authentication cannot enqueue a cloud Agent task; unsupported local tools require an explicit Web handoff. Native output is client-reported; fees use only server-observed usage. A lost settlement response retries only the saved receipt. Unknown effects, expired leases or missing provider usage keep a reconciliation hold and block automatic replay.

contextIsolation and sandbox are enabled, nodeIntegration is disabled. The generic renderer API rejects native execution/inference routes and encoded path aliases. Local history is encrypted, scoped to account/session epoch/company/project; sign-out stops owned runtimes. Renderer-only reload preserves the same-account history. No Docker, WSL, VM, PATH fallback or alternate kernel.

## Checkout, configure and run

```powershell
git clone --single-branch --branch desktop git@github.com:copypasteltd/workmate.git copypaste-desktop
cd copypaste-desktop
npm ci
$env:COPYPASTE_LOCAL_CODEX_BIN = 'D:\approved-runtime\codex.exe'
npm run runtime:prepare
npm run build
npm start
```

Use Windows x64, Node.js ≥22.14 and the exact version/hash in `contracts/local-codex-runtime.json` (`0.163.0-alpha.11`). The path above is an explicit example: supply your approved binary with its adjacent native helpers. Preparation verifies version/hash, copies native resources into ignored `.data/runtime/windows-x64` and writes a resource manifest. Nothing is downloaded or read from PATH. The cloud runtime has its own independent version lock.

Company origins and extension ID are configured through `deployment.json` or `COPYPASTE_API_ORIGIN`, `COPYPASTE_WEB_ORIGIN`, `COPYPASTE_EXTENSION_ID`. Production requires company HTTPS origins. Provider master keys stay on the server. Backend migration 092 must be applied by the native migration runbook.

```powershell
npm run typecheck
npm test
$env:COPYPASTE_LOCAL_CODEX_TEST_BIN = $env:COPYPASTE_LOCAL_CODEX_BIN
npm run test:local
npm run package:dir
npm run package
```

Packaging includes Codex and native helpers in `resources/local-codex`. `package` builds NSIS Setup and Portable under ignored `release/`; current automated evidence qualifies a separate unsigned unpacked candidate whose exact path/ASAR/native hashes are in the checkpoint. Signing, human install/upgrade/uninstall and production provider qualification remain open. Do not copy local credentials or state into Git.

The native renderer is maintained in this repository and builds independently. `renderer:sync` refuses to overwrite it with the Web snapshot; merge shared changes explicitly and run `node scripts/record-renderer.mjs` to record actual source hashes.

## Current screenshots and interaction

Actual packaged Electron and native Codex; real auth, database, local files, sandbox and ledger. Model/image responses and native chooser/consent/save decisions are explicit fixtures, not human-click or live-provider acceptance.

![Local full access](assets/screenshots/workmate-local-19-full-access-en.png)

![Company image edit and private artifacts](assets/screenshots/workmate-local-19-company-artifacts-en.png)

![Read-only downgrade](assets/screenshots/workmate-local-19-read-only-en.png)

![Stopped task and reconciliation hold](assets/screenshots/workmate-local-19-stopped-en.png)

![Minimum native window](assets/screenshots/workmate-local-19-compact-en.png)

![Chinese local workspace](assets/screenshots/workmate-local-19-workspace-zh.png)

![Native customer question](assets/screenshots/workmate-local-19-waiting-input-en.png)

![Explicit answer at minimum window size](assets/screenshots/workmate-local-19-input-compact-en.png)

![Actual private video playback](assets/screenshots/workmate-local-19-video-ready-en.png)

![Native video at 800x600](assets/screenshots/workmate-local-19-video-compact-en.png)

![Revoked native video](assets/screenshots/workmate-local-19-video-revoke-en.png)

![Actual local interaction](assets/screenshots/workmate-local-19-local-agent.gif)

[MP4](assets/screenshots/workmate-local-19-local-agent.mp4) · [Source and capture checkpoint](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-video-checkpoint.json) · [Design and recovery](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/75-desktop-private-video.md)

## Coverage and remaining work

All 18 roles now admit customer-device Codex; the workflow consultant uses actual native specialist children. Protocol admission and Skill hashes are not complete professional qualification. Current evidence covers 848 platform tests, 75 overlapping focused checks, 3 real workflow cases, 17 supervisor regressions, 56 client tests and 19 packaged checks. All 18 roles/29 Skills, full browser/application operation and the original 102 REQ/TC, NFR and G01–G10 remain in scope at 81 partial / 21 unproven / zero fully accepted.

The optional Native Messaging file companion remains separate. It does not confer full local Agent access and is not required for the Extension's selected-file upload/cloud conversation flow. Close task-owned browser pages after use and preserve user tabs.

[Update notes](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-23-desktop-company-tools.en.md) · [Repository and branch policy](https://github.com/copypasteltd/workmate/blob/docs/docs/governance/04-git-branches-and-publication.md) · [Requirements](https://github.com/copypasteltd/workmate/blob/docs/docs/requirements/03-client-execution-amendment.md)

Keep bilingual README, affected captures and release notes in sync, commit and push the mapped branch, then verify remote SHAs. No force-push. Local state, dependencies, native binaries and installers stay ignored.

## Native company-tool contract

The Agent loop stays on the customer device. Main registers trusted `copypaste` dynamic tools for the pinned native runtime, binds each call to its task/call/thread/turn, and rechecks company permissions before effects and disclosure. Local read-only denies company mutations. Original business validation remains enforced after the native schema projection. Same-call retries reuse durable results; unknown accepted image operations stop further calls and retain reconciliation holds. Private artifact downloads use exact versions and a native save selection.

Stage 73 company-tool update: [release notes](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-23-desktop-company-tools.en.md) · [source-bound checkpoint](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-company-tools-checkpoint.json). Earlier reports and media retain their historical source scopes.

## Native questions and continuing work

Questions appear inside the local conversation without a preselected answer. Answer every question, then choose **Answer and continue**; the same native task/thread/turn and reservation continue. Renderer reload preserves a live question. Stop, revocation, sign-out and app close cancel it; stale or duplicate answers are rejected. Question/answer fields are temporary main-process state, but submitted answers still reach native Codex history and company model context. At the minimum window size the inactive composer and large page heading collapse to leave room for questions; fixed Stop and the budget remain available.

The narrow `answer` IPC carries only the session id, one-time request id and validated answers. `src/local-input.ts` bounds the protocol; `local-codex.ts` keeps human waiting outside the event queue; `local-agent.ts` rechecks ownership, permission and the company execution before delivery.

Stage 74 native-input update: [release notes](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-23-desktop-native-input.en.md) · [current checkpoint](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-native-input-checkpoint.json). Earlier reports/media retain their original source scopes.

During stage 74, the unbundled renderer hash index was refreshed after qualification; all other covered sources and the actual package are unchanged. See the [separate metadata check](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-native-input-renderer-manifest-01.json). This adds no native/UI test count.

## Private video projects

Choose **Video & motion designer**, select a folder and grant the local access you want. Local Codex uses seven company tools: list, read, queue, status, edit, render and cancel. Queued means the composition is still pending; no download appears until all six private deliveries are available. The actual MP4 plays inline; authenticated MP4/timeline/script/storyboard/subtitle/check downloads use the native save chooser.

Follow-up edits freeze a new expected version and preserve the earlier MP4. Explicit retries create a new render; status refresh never rerenders. Active task stop or revocation cancels only that task's pending origin jobs and fences late encoder publication. Revoking idle OS permission does not revoke an already accepted remote composition: its card can still cancel using current company project permissions. Same-project members cannot read the private definition or outputs.

The company service uses actual FFmpeg composition with zero AI media charge in this flow. Native reasoning retains its original server-observed budget and usage. Renderer profile 2 fixes minimum-landscape CTA layout; frozen profile 1 remains readable and requires an explicit new version to change its renderer. `renderer/src/local-video.tsx` owns the bounded state cards; `src/local-codex.ts` projects only safe ids and versions from actual tool results.

Stage 75 private-video update: [release notes](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-23-desktop-private-video.en.md) · [current checkpoint](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-video-checkpoint.json). Earlier reports retain their actual source scopes; platform/main-process qualification and later UI qualification are explicitly separated.

<!-- desktop-native-browser-stage77 -->

## Native browser and scrollbar-free Desktop

Start a new local session, select a folder and explicitly grant Full local access. Ask the local Codex to work in a browser. The trusted frameless address bar and remote page run in separate customer-device renderers. The tool namespace `copypaste_browser` v1 includes tabs/open/navigate/history/snapshot/screenshot/interact/evaluate/wait/dialog/downloads/close; interact supports real click, fill/type/select, keys, scroll/drag and exact local-file upload. Completed downloads remain in the selected workspace’s browser-downloads directory. Model screenshots capture the actual page; README browser media uses actual OS window capture, with no compositing.

Current local permission, company identity, project access, origin and budget are rechecked. Web content cannot grant OS access or acquire company inference credentials. Call IDs bind exact operations; unknown accepted actions never replay automatically. Stop, revoke, sign-out or exit close owned pages and pending downloads, preserving completed files and the customer’s original windows. Existing threads retain their original tool binding; create a new session for browser tools.

The previous progress-bar constraint is withdrawn. Truthful upload/task/workflow/video feedback remains. Hidden scrollbar rails do not disable native scrolling. Artifacts wrap into rows, code and tables reflow, scroll areas have keyboard focus, and the composer/receipt remain usable in actual 800×600, 1280×800 and 1440×980 windows. Real wheel/Home/End and last-download focus are verified, alongside compact billing/devices/account pages and English/Traditional Chinese light/dark controls. Physical touchpad hardware and every display-scaling configuration are not claimed by these automated checks.

Current complete inventory: 66 test files / 17 batches / 851 passing cases, retaining all 848 prior cases. SQL001–094 and all 428 HTTP routes remain unchanged. The isolated UI fixture alone allocates 32 user/platform/tenant slots and appends immutable provider-policy version 2 with 32 slots and 10,000 requests/minute, retaining intentional unknown cancellation holds. Bootstrap policy and production defaults/enforcement remain unchanged. Synthetic Responses, campaign content and native-dialog choices are explicit. Original 102 REQ/102 TC, NFR and G01–G10 remain at 81 partial / 21 unproven / 0 fully accepted. Extension product/verifier bytes are unchanged; no new Extension UI claim.

```mermaid
flowchart LR
    Customer --> Permission[Explicit local permission]
    Permission --> Native[Customer-device Codex]
    Native --> Gateway[Company identity, budget and AI gateway]
    Native --> Browser[Owned local browser and real websites]
    Browser --> Files[Actual uploads, screenshots and downloads]
    Stop[Stop, revoke, sign-out, exit] --> Cleanup[Close task-owned pages]
    Extension[Native Chrome right Side Panel and selected files] --> Cloud[Company cloud Codex]
```

![Actual compact Desktop](assets/screenshots/workmate-local-28-layout-800-en.png)

![Actual local browser](assets/screenshots/workmate-local-28-browser-saved-en.png)

![Actual native interaction](assets/screenshots/workmate-local-28-local-agent.gif)

[MP4](assets/screenshots/workmate-local-28-local-agent.mp4) · [Browser GIF](assets/screenshots/workmate-local-28-native-browser.gif) · [Browser MP4](assets/screenshots/workmate-local-28-native-browser.mp4) · [繁中深色](assets/screenshots/workmate-local-28-layout-compact-zh-dark.png)

[Design](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/77-desktop-native-browser.md) · [Requirements](https://github.com/copypasteltd/workmate/blob/docs/docs/requirements/04-desktop-layout-and-scroll.md) · [Evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-browser-checkpoint.json) · [Changes](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-23-desktop-native-browser.md)

<details>
<summary>Stage 76 historical implementation and captures (previous scrollbar layout)</summary>

<!-- desktop-native-workflow-stage76 -->

## Native workflows and verification

Choose Workflow consultant, select a folder and explicitly grant the desired local permission. Describe the work and agree its frozen steps. Review the separate per-child budgets and approve the exact version before a child can reserve money or run. Approve any concrete human step before the next specialist starts. Review real files, private SOP/workflow JSON/recovery downloads and company usage; this conversation and incomplete steps have separate charges. Stop or revoke to terminate local parent and child processes; unknown accepted actions retain reconciliation state and never replay automatically.

The first workflow subset permits up to eight sequential native Codex, human approval or analytics-summary steps. Every child uses its own approved role Skills, company tools and scoped credentials while retaining the current explicit local grant. Local full access does not grant another customer's data, project rights or unlimited budget. Company cloud Workers and schedules cannot take over native workflows. Each immutable version freezes actual external input provenance across new sessions and derived SOPs, without depending on the creator task lifetime. Source withdrawal also governs first reads, cached calls, child admission and private or explicitly published derivatives; administrators use existing permission/MFA/reason/audit controls. Closing the app fences requests still waiting for their local journal write.

Historical stage-76 inventory: 65 actual test files / 17 complete batches / 848 passing tests; all 830 stage-75 cases remain covered. SQL001–093 remain unchanged; SQL094 adds native workflow provenance and immutable versions. The actual 428-route inventory retains all prior 415 routes. Original 102 REQ/102 TC, NFR and G01–G10 remain open at 81 partial / 21 unproven / 0 fully accepted. Earlier evidence and media retain their original source scope.

```mermaid
flowchart LR
    User[Customer] --> Consent[Desktop main: permission and fee consent]
    Consent --> Local[Local consultant Codex]
    Local --> API[Company identity, sources and usage]
    API --> Consent
    Consent --> Children[Local role Codex children]
    Children --> API
    Children --> Approval[Human step approval]
    Approval --> Consent
    Children --> Files[Real files and private deliveries]
    Extension[Chrome right Side Panel and files] --> Cloud[Company cloud Codex]
```

![Native workflow fee confirmation](assets/screenshots/workmate-local-21-workflow-fees-en.png)

![Native workflow complete](assets/screenshots/workmate-local-21-workflow-completed-zh.png)

![Actual packaged interaction](assets/screenshots/workmate-local-21-local-agent.gif)

[MP4](assets/screenshots/workmate-local-21-local-agent.mp4) · [800×600](assets/screenshots/workmate-local-21-workflow-compact-en.png)

[Design and lifecycle](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/76-desktop-native-workflows.md) · [Bound evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-workflow-checkpoint.json) · [Change notes](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-23-desktop-native-workflows.md)

</details>

</details>
