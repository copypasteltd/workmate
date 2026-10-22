# Workmate · CopyPaste Delivery

[中文](README.md) · [Documentation](https://github.com/copypasteltd/workmate/blob/docs/docs/README.en.md)

[Backend](https://github.com/copypasteltd/workmate/tree/backend) · [Web](https://github.com/copypasteltd/workmate/tree/web) · [Admin Dashboard](https://github.com/copypasteltd/workmate/tree/admin) · [Desktop](https://github.com/copypasteltd/workmate/tree/desktop) · [Chrome Extension](https://github.com/copypasteltd/workmate/tree/extension) · [Delivery](https://github.com/copypasteltd/workmate/tree/delivery)

A cloud Agent product for Hong Kong enterprises. This repository owns **Delivery** and publishes to `delivery`.

<!-- client01-direction -->
## Current client direction — implementation gap

CLIENT01 (2026-10-22) requires **Desktop to run Codex on the customer's computer**, with a real user-opt-in **full local access** mode and Codex Desktop as the operation benchmark. The **Extension uses a ChatGPT-style conversation and attachment layout in Chrome's native right Side Panel**, reads user-selected files and uploads them for cloud Codex execution. All product AI calls still use the company gateway.

**Current implementation:** The Desktop product entry point still uses cloud Codex and a restricted file bridge. An independent native Codex supervisor passes nine real-native integration tests; Electron consent and billing integration remain pending. The Extension has the native Side Panel and basic uploads, while its task-form-first UI needs restructuring. Existing screenshots and recordings show that implementation and do not prove the amended capabilities. [Requirements](https://github.com/copypasteltd/workmate/blob/docs/docs/requirements/03-client-execution-amendment.md) · [Direction audit and development plan](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/69-desktop-local-codex-and-extension-direction.md).

The architecture diagram below describes the implemented cloud/file-bridge baseline; it is not the target Desktop local-agent architecture.

Native supervisor scope, actual permission checks and remaining integration: [implementation details](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/70-desktop-native-codex-supervisor.md).

<!-- /client01-direction -->

## Architecture and constraints

Codex is the only Agent kernel. All AI calls use the company's internal OpenAI-compatible server. Web, Desktop, extension and Admin share server identity, permissions, sources and billing controls. UI follows CopyPaste brand assets, colors, typography and bilingual patterns.

```mermaid
flowchart LR
  Web[Web workspace] --> API[Company Backend]
  Side[Chrome native Side Panel] --> API
  Desktop[Frameless Desktop] --> API
  Admin[Scoped Admin] --> API
  API --> Guard[Identity / sources / budget / queue]
  Guard --> Codex[Version-pinned Codex and Skills]
  Codex --> Gateway[Internal OpenAI-compatible gateway]
  Codex --> Tools[Authorized tools and immutable deliverables]
  Tools --> Ledger[Measured settlement / reconciliation]
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

**802/802** full Platform tests and **52/52** focused task tests pass, with **13 checks** across six repositories and **32** actual packaged Desktop/native Side Panel checks. All prior 782 named regression cases remain. Task checks exercise actual PostgreSQL, identity, ledger and Worker; separate real Codex child processes use a synthetic internal gateway. UI turns/business data are synthetic as authorized. The original 102 requirements remain: 81 partially verified, 21 without proven completion and zero fully accepted.

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

For the independent native supervisor checks, set the task-specific `COPYPASTE_LOCAL_CODEX_TEST_BIN` to the absolute native binary matching the Desktop lock, then run `node scripts/run-local-codex-checks.mjs NN`. It starts no cloud task, database or browser; actual terminal operations use owned isolated files. The current `node scripts/run-paid-input-native.mjs NN --media` UI journey uses Desktop's `release/client-direction-70-01/` candidate: first run `npm run build` and `node scripts/package-client-direction.mjs` in Desktop, preserving old packages. This UI journey still verifies cloud/file-bridge compatibility and is distinct from full local-Agent product acceptance.
