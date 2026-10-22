# Workmate · CopyPaste Delivery

[中文](README.md) · [Documentation](https://github.com/copypasteltd/workmate/blob/docs/docs/README.en.md)

[Backend](https://github.com/copypasteltd/workmate/tree/backend) · [Web](https://github.com/copypasteltd/workmate/tree/web) · [Admin Dashboard](https://github.com/copypasteltd/workmate/tree/admin) · [Desktop](https://github.com/copypasteltd/workmate/tree/desktop) · [Chrome Extension](https://github.com/copypasteltd/workmate/tree/extension) · [Delivery](https://github.com/copypasteltd/workmate/tree/delivery)

A cloud Agent product for Hong Kong enterprises. This repository owns **Delivery** and publishes to `delivery`.

<!-- client01-direction -->
## Current client direction and qualified scope

CLIENT01 (2026-10-22) requires **Desktop to run Codex on the customer's computer**, with a real user-opt-in **full local access** mode and Codex Desktop as the operation benchmark. The **Extension uses a ChatGPT-style conversation and attachment layout in Chrome's native right Side Panel**, reads user-selected files and uploads them for cloud Codex execution. All product AI calls still use the company gateway.

**Current implementation:** Desktop runs Codex locally with user-granted full access, local files/terminal, same-thread follow-up, stop and company billing. Company image/design/data tools and private-artifact downloads are now connected. Validation passes 37 client tests, 14 real-native tests, 818 full Platform regression tests and nine actual packaged-Electron journey checks. Sixteen roles have the native tool protocol connected; this is not complete professional qualification. Native video/workflow integration, all eighteen roles/twenty-nine Skills, signing and full client acceptance remain open. Model/image responses and native dialog decisions are explicit synthetic fixtures. The Extension retains native Side Panel cloud conversations and selected-file uploads. See [design and limits](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/73-desktop-native-company-tools.md) and [source/media evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-company-tools-checkpoint.json).

Desktop runs the native Agent locally; the Web and Extension run cloud Codex. The linked stage 73 proof states the tested scope.

Native supervisor scope, actual permission checks and remaining integration: [implementation details](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/70-desktop-native-codex-supervisor.md).

<!-- /client01-direction -->

To repeat the native Side Panel conversation journey, configure the existing Platform `.env` and native runtime resources, then run `node scripts/run-extension-chat.mjs NN` with an unused two-digit attempt. The runner requires free ports 4310/4317/55432, runs 32 Extension tests and type/build checks, starts only its own native PostgreSQL/preview/browser, and verifies shutdown plus isolated fixture reclamation. Model turns are synthetic; the native panel, upload, cloud Worker and ledger are real. See the [Extension checkpoint](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/extension-chat-checkpoint.json).

## Architecture and constraints

Codex is the only Agent kernel. All AI calls use the company's internal OpenAI-compatible server. Web, Desktop, extension and Admin share server identity, permissions, sources and billing controls. UI follows CopyPaste brand assets, colors, typography and bilingual patterns.

```mermaid
flowchart LR
  Desktop[Frameless Desktop] --> Main[Trusted local permission and session control]
  Main --> Native[Customer-device Codex and local tools]
  Main --> Control[Company identity / role / budget control]
  Native --> Gateway[Company scoped AI gateway]
  Web[Web] --> Cloud[Cloud Codex and business tools]
  Extension[Native right Side Panel and selected-file uploads] --> Cloud
  Cloud --> Gateway
  Gateway --> Ledger[Server-observed usage and ledger]
```

## Responsibility and layout

This repository starts native development services, verifies cross-client behavior, preserves raw results, checks package bytes, captures actual interactions and synchronizes mapped branches. It coordinates sibling repositories rather than containing another business kernel.

| Directory | Responsibility |
| --- | --- |
| `scripts/` | Bootstrap, native process control, migration checks, client/API/permission/media verification, recording and publishing |
| `tests/` | Integrity checks for native-package and Side Panel verifiers |
| `evidence/` | Per-execution raw TAP/logs, source bindings, cleanup and actual screenshot digests |
| `assets/screenshots/` | Actual README screenshots, MP4 and GIF |
| `.data/` | Ignored owned process state, browser profiles, raw recordings and temporary data |

## Workspace layout

Check out docs at the project root. Place component branches under `dev/copypaste-platform`, `copypaste-web`, `copypaste-admin`, `copypaste-desktop`, `copypaste-extension` and this `copypaste-delivery` repository. Use separate working directories when running components together.

## Install, start and stop

```powershell
npm ci
npm run bootstrap
npm run demo
```

Ports: Web `4317`, Admin `4318`, API `4310`, controller `4319` and native PostgreSQL `55432`. `npm run stop` only stops controller-owned processes and requests a normal database checkpoint. Occupied ports fail startup while preserving existing processes.

`demo` explicitly enables local synthetic mode, which production and non-loopback hosts reject. Authorized synthetic data does not qualify live model quality, prices or production services. Original errors/failures remain intact.

## Actual interaction recording

```powershell
node scripts/run-paid-input-native.mjs NN --media
```

Use a fresh two-digit ID for a new recording. The command starts owned native PostgreSQL, isolated fixtures, Web/Admin previews, actual unpacked Desktop and a native Chrome Side Panel. All owned browsers/previews close and isolated fixtures are reclaimed afterward. First reproduce the local Desktop/Extension previews named by the script using the packaging runbook; source branches do not include installers or dist.

Replace `NN` with a fresh two-digit ID. `qa-workmate-media.ts` hooks actual UI operations. `record-workmate-media.ts` encodes captured wall-clock intervals into MP4/GIF. Captures come directly from the confirmed native SIDE_PANEL document viewport and exclude the browser toolbar. The same journey independently asserts right-side layout, reduced main-page width and no popup/extra tab. Evidence binds synthetic-turn scope, source/media hashes and exit receipts.

## Branch publication

After committing the six components, run `python docs/tools/finalize_workmate_manifest.py --update` at the main documentation root to explicitly refresh component SHAs. Review the media attempt and release notes, then commit docs. The publisher accepts local `codex/*` working branches and published branch names created by the README clone commands. With all repositories clean:

```powershell
node scripts/publish-workmate.mjs --check
node scripts/publish-workmate.mjs --push
```

The publisher updates only the eight mapped branches atomically, checks remote ancestry and verifies post-push SHAs. It never force-pushes or deletes other branches. Preflight calls the documentation audit for historical objects, credentials, README links and media. Ignored runtime receipts live in `.data/publication/`; failures remain available and stop publication.

The current manifest generator binds retained Stage 66/journey 06 evidence. Product source changes require rerunning checks and selecting matching new reports; changing component SHAs alone cannot reuse passing results from older source.

## Verification boundaries

`npm run typecheck` and `npm test` check this repository. Backend runs full platform tests; cross-client/native scripts enforce their own prerequisites. Applied migration bytes are immutable. Pre-upgrade snapshots, first failures and later read-only corrections remain separate. Docker/WSL/virtualization are prohibited for all tests and captures.

## Checkout and prerequisites

Clone this branch into a fresh working directory; update an existing repository without reinitializing it.

```powershell
git clone --single-branch --branch delivery git@github.com:copypasteltd/workmate.git copypaste-delivery
cd copypaste-delivery
```

Use Node.js ≥22.14, npm and Git with pinned lockfiles. The qualified local environment is Windows x64. Backend/full delivery also needs native PostgreSQL launcher resources, pinned Codex `0.163.0-alpha.10.2` and FFmpeg/FFprobe. No local Docker, WSL or virtualization. Run components in separate directories; see [workspace](https://github.com/copypasteltd/workmate/blob/docs/docs/governance/04-git-branches-and-publication.md).

## Checks and evidence scope

```powershell
npm run typecheck
npm test
```

Historical-source **802/802** full Platform tests and **52/52** focused task tests pass, with **13 checks** across six repositories and **32** actual packaged Desktop/native Side Panel checks. All prior 782 named regression cases remain. Task checks exercise actual PostgreSQL, identity, ledger and Worker; separate real Codex child processes use a synthetic internal gateway. UI turns/business data are synthetic as authorized. The original 102 requirements remain: 81 partially verified, 21 without proven completion and zero fully accepted.

Canonical TaskDTO/task creation, arbitrary in-flight pause, unknown-effect recovery, independent complete role workflows, GEO, live suppliers and production/signing/store qualification remain tracked.

This revision adds canonical task APIs and atomic original-task inputs. Current UIs continue to use their existing project/conversation interfaces over the same execution domain. The refreshed actual recordings verify compatibility; they do not claim migration of every UI to canonical task APIs. See [the implementation and limits](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/68-canonical-task-contracts-and-input-transactions.md) for exact money, idempotency, source revocation and unsupported business parameters.

## Actual screens and interactions

This service has no independent customer page. The following captures show the actual Desktop client connected to the service.

Actual recordings preserve capture timing. AI turns/business data are explicitly synthetic. Admin form demonstrations do not claim a financial commit.

![Actual product capture](assets/screenshots/workmate-10-input-ready-en.png)

![Actual product capture](assets/screenshots/workmate-10-result-en.png)

![Actual interaction GIF](assets/screenshots/workmate-10-interaction.gif)

[MP4](assets/screenshots/workmate-10-interaction.mp4) · [Capture/source evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/workmate-media-10.json)

## Detailed design and updates

- [Product](https://github.com/copypasteltd/workmate/blob/docs/docs/product/01-prd.md)
- [Architecture](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/01-architecture-and-stack.md)
- [Identity and permissions](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/07-security-and-permissions.md)
- [Task continuation](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/66-paid-native-input-checkpoints.md)
- [Admin](https://github.com/copypasteltd/workmate/blob/docs/docs/product/08-admin-dashboard.md)
- [Native clients](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/30-native-window-and-browser-sidepanel.md)
- [Canonical task update](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-22-canonical-task-repair.en.md)
- [Local Codex update](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-22-native-codex-supervisor.en.md)

Every later change updates both READMEs, affected actual captures/GIFs, release notes and its mapped branch. Verify remote SHAs through Delivery publishing; do not force-push collaborator history. Keep environment secrets, databases, sessions, dependencies and installers out of Git. Exact historical README bytes are retained in [archive](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/history/stage66-before-workmate-readmes/manifest.json).

Canonical task verification:

```powershell
node scripts/run-canonical-task-checks.mjs NN
node scripts/run-canonical-task-checks.mjs NN --full
```

Use a new two-digit attempt ID every time. Retain failures; successful reports require actual native database shutdown and owned-fixture cleanup.

For the independent native supervisor checks, set the task-specific `COPYPASTE_LOCAL_CODEX_TEST_BIN` to the absolute native binary matching the Desktop lock, then run `node scripts/run-local-codex-checks.mjs NN`. It starts no cloud task, database or browser; actual terminal operations use owned isolated files. The historical compatibility `node scripts/run-paid-input-native.mjs NN --media` UI journey uses Desktop's `release/client-direction-70-01/` candidate: first run `npm run build` and `node scripts/package-client-direction.mjs` in Desktop, preserving old packages. This UI journey still verifies cloud/file-bridge compatibility and is distinct from full local-Agent product acceptance.

Latest Desktop local execution: [design](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/73-desktop-native-company-tools.md) · [source-bound proof](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-company-tools-checkpoint.json). Prior recordings below retain their original source scopes.

## Local Desktop verification

Set explicit locked `COPYPASTE_LOCAL_CODEX_BIN` and `COPYPASTE_LOCAL_CODEX_TEST_BIN`. Run `node scripts/run-desktop-execution-checks.mjs NN`, `node scripts/run-local-codex-checks.mjs NN`, and `node scripts/run-desktop-local-ui.mjs NN` using fresh two-digit attempt IDs. Reports refuse overwrite, bind before/after source hashes and retain failed attempts. The UI runner packages a new unsigned candidate under Desktop `.data/local-candidates/`, uses an isolated native PostgreSQL fixture, actual Electron and an owned browser, then closes them and proves fixture cleanup. Never run database-owning suites on occupied ports. Native dialog decisions/provider messages are fixtures; real local tools and billing are exercised.

## Native company-tool contract

The Agent loop stays on the customer device. Main registers trusted `copypaste` dynamic tools for the pinned native runtime, binds each call to its task/call/thread/turn, and rechecks company permissions before effects and disclosure. Local read-only denies company mutations. Original business validation remains enforced after the native schema projection. Same-call retries reuse durable results; unknown accepted image operations stop further calls and retain reconciliation holds. Private artifact downloads use exact versions and a native save selection.

The current company-tool checkpoint selects a complete Platform run with `node scripts/run-desktop-execution-checks.mjs NN --full-platform`, plus the native and actual packaged UI runners. Use a new attempt ID, explicit pinned binaries and free owned ports; failed receipts remain immutable. Never modify covered source while a bound run is active.

For execution environments that interrupt long runs, the selected checkpoint uses the resumable runner: `node scripts/run-desktop-platform-resumable.mjs NN --init`, then `--next` for each planned batch, and `--finish`. It fixes all 63 test files and source hashes before execution, verifies six recovery-rule tests, and records sixteen independently owned batches. Every file must pass with unchanged source, separate complete TAP, fixture cleanup and database shutdown. Interrupted attempts contribute no coverage; only their unfinished batch is retried. A failed batch requires review and a new qualification. The final index sums the complete inventory without fabricating a single TAP stream.

Latest company-tool update: [release notes](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-23-desktop-company-tools.en.md) · [source-bound checkpoint](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-company-tools-checkpoint.json). Earlier reports and media retain their historical source scopes.
