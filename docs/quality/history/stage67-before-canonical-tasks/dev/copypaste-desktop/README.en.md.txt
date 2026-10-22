# Workmate · CopyPaste Desktop

[中文](README.md) · [Documentation](https://github.com/copypasteltd/workmate/blob/docs/docs/README.en.md)

[Backend](https://github.com/copypasteltd/workmate/tree/backend) · [Web](https://github.com/copypasteltd/workmate/tree/web) · [Admin Dashboard](https://github.com/copypasteltd/workmate/tree/admin) · [Desktop](https://github.com/copypasteltd/workmate/tree/desktop) · [Chrome Extension](https://github.com/copypasteltd/workmate/tree/extension) · [Delivery](https://github.com/copypasteltd/workmate/tree/delivery)

A cloud Agent product for Hong Kong enterprises. This repository owns **Desktop** and publishes to `desktop`.

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

## Native window and architecture

A frameless Electron window uses `frame:false` and `thickFrame:false`, removes the application menu and disables default/Alt menus. A custom 40px title bar provides dragging, minimize, maximize/restore and close. Actual packaged-window state transitions are verified.

`src/main.ts` owns lifecycle, authorization, native saves and restricted IPC. `src/preload.cts` exposes only approved bridge functions; `src/window-controls.ts` validates window actions. `renderer/` is a self-contained React snapshot and builds without sibling Web sources.

contextIsolation and sandbox are enabled; nodeIntegration is disabled. The renderer cannot freely call Admin, arbitrary URLs or system files. Company API/Web origins are compiled; model credentials remain server-side.

## Usage flow

Launch → fixed company login page → email verification/PKCE authorization → localhost callback → workspace/project selection → tasks, inputs, conversations and deliverables. Sessions and refresh families are revocable; requests carry current scope.

Local work requires explicit file/folder selection and time-bounded grants. Device commands, signatures, hashes, expiry and single-use results are checked by Backend and the local bridge. Downloads use the current tenant's authenticated bridge and native save dialog; cancellation does not create a fake success file. Autonomous Codex local-file dispatch and strongly isolated customer-code execution remain incomplete.

## Develop and package

```powershell
npm ci
npm run build
npm start
```

```powershell
npm run typecheck
npm test
npm run package
```

`COPYPASTE_API_ORIGIN`, `COPYPASTE_WEB_ORIGIN`, `COPYPASTE_EXTENSION_ID` or `deployment.json` configure deployment. `scripts/configure-deployment.mjs` compiles the configuration. Production uses HTTPS. Local NSIS Setup and Portable outputs are ignored under `release/`.

The qualified preview executes `release/paid-input-66-03/win-unpacked/CopyPaste.exe`. Setup/Portable are generated but unsigned; installation, upgrade/uninstall, signing and distribution matrices remain unqualified.

## Files and extension companion

Register the Native Messaging companion according to the runbook; the extension ID must match its fixed allowlist. Models and ordinary webpages cannot enlarge grants. Desktop and Side Panel share company identity and Backend business services without embedded independent AI-provider secrets.

## Checkout and prerequisites

Clone this branch into a fresh working directory; update an existing repository without reinitializing it.

```powershell
git clone --single-branch --branch desktop git@github.com:copypasteltd/workmate.git copypaste-desktop
cd copypaste-desktop
```

Use Node.js ≥22.14, npm and Git with pinned lockfiles. The qualified local environment is Windows x64. Backend/full delivery also needs native PostgreSQL launcher resources, pinned Codex `0.163.0-alpha.10.2` and FFmpeg/FFprobe. No local Docker, WSL or virtualization. Run components in separate directories; see [workspace](https://github.com/copypasteltd/workmate/blob/docs/docs/governance/04-git-branches-and-publication.md).

## Checks and evidence scope

```powershell
npm run typecheck
npm test
npm run build
```

**782/782** Platform and **34/34** focused tests, plus **13 checks** across six repositories for types/build/existing client suites. The actual packaged Desktop and native Side Panel journey passes **32** checks, retaining every prior named test among 765. Actual Codex child-process tool/thread/usage behavior is tested through a synthetic internal API. UI turns/business data in these demonstrations are synthetic as authorized. All 102 original requirements remain: 81 partially verified, 21 without proven completion and zero fully accepted. Screenshots and test counts do not establish whole-product acceptance.

Canonical TaskDTO/task creation, arbitrary in-flight pause, unknown-effect recovery, independent complete role workflows, GEO, live suppliers and production/signing/store qualification remain tracked.

## Actual screens and interactions

Actual recordings preserve capture timing. AI turns/business data are explicitly synthetic. Admin form demonstrations do not claim a financial commit.

![Actual product capture](assets/screenshots/workmate-06-input-ready-en.png)

![Actual product capture](assets/screenshots/workmate-06-result-en.png)

![Actual interaction GIF](assets/screenshots/workmate-06-interaction.gif)

[MP4](assets/screenshots/workmate-06-interaction.mp4) · [Capture/source evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/workmate-media-06.json)

## Detailed design and updates

- [Product](https://github.com/copypasteltd/workmate/blob/docs/docs/product/01-prd.md)
- [Architecture](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/01-architecture-and-stack.md)
- [Identity and permissions](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/07-security-and-permissions.md)
- [Task continuation](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/66-paid-native-input-checkpoints.md)
- [Admin](https://github.com/copypasteltd/workmate/blob/docs/docs/product/08-admin-dashboard.md)
- [Native clients](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/30-native-window-and-browser-sidepanel.md)
- [Release notes](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-22-workmate-publication.en.md)

Every later change updates both READMEs, affected actual captures/GIFs, release notes and its mapped branch. Verify remote SHAs through Delivery publishing; do not force-push collaborator history. Keep environment secrets, databases, sessions, dependencies and installers out of Git. Exact historical README bytes are retained in [archive](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/history/stage66-before-workmate-readmes/manifest.json).
