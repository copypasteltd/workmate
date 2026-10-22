# Workmate · CopyPaste Chrome Extension

[中文](README.md) · [Documentation](https://github.com/copypasteltd/workmate/blob/docs/docs/README.en.md)

[Backend](https://github.com/copypasteltd/workmate/tree/backend) · [Web](https://github.com/copypasteltd/workmate/tree/web) · [Admin Dashboard](https://github.com/copypasteltd/workmate/tree/admin) · [Desktop](https://github.com/copypasteltd/workmate/tree/desktop) · [Chrome Extension](https://github.com/copypasteltd/workmate/tree/extension) · [Delivery](https://github.com/copypasteltd/workmate/tree/delivery)

A cloud Agent product for Hong Kong enterprises. This repository owns **Chrome Extension** and publishes to `extension`.

<!-- client01-direction -->
## Current client direction — implementation gap

CLIENT01 (2026-10-22) requires **Desktop to run Codex on the customer's computer**, with a real user-opt-in **full local access** mode and Codex Desktop as the operation benchmark. The **Extension uses a ChatGPT-style conversation and attachment layout in Chrome's native right Side Panel**, reads user-selected files and uploads them for cloud Codex execution. All product AI calls still use the company gateway.

**Current implementation:** Desktop integrates local Codex, main-process consent, file/terminal tools, same-thread follow-up, stop and company-gateway billing. Validation covers 37 client tests, 10 native-supervisor tests, 86 server/cloud-compatibility tests and seven actual packaged-Electron journey checks. Model turns and native chooser/consent decisions are explicit fixtures. Five local specialists are admitted; all eighteen roles/media tools, production signing and complete client acceptance remain open. The Extension keeps native Side Panel cloud conversations and file uploads. See [implementation and limits](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/72-desktop-local-execution-and-control-plane.md).

The architecture diagram below describes the implemented cloud/file-bridge baseline; it is not the target Desktop local-agent architecture.

Native supervisor scope, actual permission checks and remaining integration: [implementation details](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/70-desktop-native-codex-supervisor.md).

<!-- /client01-direction -->

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

## Native Side Panel

Chrome Manifest V3 uses `side_panel.default_path` and `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true})`. The toolbar opens the real browser Side Panel and can close it again, without an action popup or simulated sidebar tab. It is right by default and respects Chrome's selected side.

`src/background.ts` handles lifecycle, company authorization and panel behavior. `src/panel.ts` owns workspace/project, tasks, inputs and results. `public/sidepanel.html` and `public/panel.css` provide the local UI. `scripts/build.mjs` generates fixed origins, CSP and the stable extension ID.

## Usage flow

1. Build/load the extension and pin its toolbar icon.
2. Click the icon to open the native workspace. Complete email verification and PKCE authorization at the fixed company webpage.
3. Choose a workspace/project and start or restore a conversation. Specialist and per-message budget settings are collapsible; ordinary messages need no task title.
4. Select or drop files, wait for “Uploaded, not sent”, then send. Only this message's immutable versions are attached. Network retries and reopening reuse the original request and budget.
5. Continue asking in the same cloud conversation, observe actual incremental events, deliverables and costs, or request Stop. Source denial clears old content. Basic chat/upload requires no Desktop.

An extension cannot arbitrarily read every local path. Uploads require explicit selection; persistent folder/device work requires grants and a Native Messaging companion. `nativeMessaging` is optional. Models cannot grant local permissions.

## Build and load

```powershell
npm ci
npm run build
```

Open `chrome://extensions`, enable developer mode, choose Load unpacked and select this repository's `dist/`. Pin and click the icon. Chrome 120+ is required; retained native evidence identifies the actual Chromium used.

Set `COPYPASTE_API_ORIGIN` and `COPYPASTE_WEB_ORIGIN` at build time. Defaults are localhost 4310/4317; production requires company HTTPS origins. Preserve `manifest-key.txt` to retain the ID; it contains a public key, not a signing private key. `extension-id.txt` is used for Backend/companion registration.

The branch contains reproducible source. The local preview ZIP is ignored under `release/paid-input-66-03/`. Store submission, signing, other browser/system matrices and live supplier integration require separate qualification.

## Checkout and prerequisites

Clone this branch into a fresh working directory; update an existing repository without reinitializing it.

```powershell
git clone --single-branch --branch extension git@github.com:copypasteltd/workmate.git copypaste-extension
cd copypaste-extension
```

Use Node.js ≥22.14, npm and Git with pinned lockfiles. The qualified local environment is Windows x64. Backend/full delivery also needs native PostgreSQL launcher resources, pinned Codex `0.163.0-alpha.10.2` and FFmpeg/FFprobe. No local Docker, WSL or virtualization. Run components in separate directories; see [workspace](https://github.com/copypasteltd/workmate/blob/docs/docs/governance/04-git-branches-and-publication.md).

## Checks and evidence scope

```powershell
npm run typecheck
npm test
npm run build
```

Historical-source **802/802** full Platform tests and **52/52** focused task tests pass, with **13 checks** across six repositories and **32** actual packaged Desktop/native Side Panel checks. All prior 782 named regression cases remain. Task checks exercise actual PostgreSQL, identity, ledger and Worker; separate real Codex child processes use a synthetic internal gateway. UI turns/business data are synthetic as authorized. The original 102 requirements remain: 81 partially verified, 21 without proven completion and zero fully accepted.

Canonical TaskDTO/task creation, arbitrary in-flight pause, unknown-effect recovery, independent complete role workflows, GEO, live suppliers and production/signing/store qualification remain tracked.

This revision adds canonical task APIs and atomic original-task inputs. Current UIs continue to use their existing project/conversation interfaces over the same execution domain. The refreshed actual recordings verify compatibility; they do not claim migration of every UI to canonical task APIs. See [the implementation and limits](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/68-canonical-task-contracts-and-input-transactions.md) for exact money, idempotency, source revocation and unsupported business parameters.

## Actual screens and interactions

Actual recordings preserve capture timing. AI turns/business data are explicitly synthetic. Admin form demonstrations do not claim a financial commit.

![Actual product capture](assets/screenshots/workmate-chat-05-conversation-zh.png)

![Actual product capture](assets/screenshots/workmate-chat-05-continued-en.png)

![Actual interaction GIF](assets/screenshots/workmate-chat-05-conversation.gif)

[MP4](assets/screenshots/workmate-chat-05-conversation.mp4) · [Capture/source evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/extension-chat-checkpoint.json)

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

## Conversation and attachment flow

Choose a company/project and start or restore a chat. Ordinary messages need no task title. Attach or drop files, wait for “Uploaded, not sent”, then send. Only confirmed immutable versions bind this message. The browser reads the selected file; cloud Codex executes through the company gateway. Basic upload/chat needs no Desktop or Native Messaging. Per-message budgets and specialists are in settings; accounts and standalone business forms are collapsed.

Lost acceptance responses retain the original payload, budget and idempotency key across panel reopening. Actual incremental events update the conversation. Current source denial clears old content and blocks sending. Unsaved attachments are not restored after closing; uploaded files remain in the project. Current limits: 20 attachments, each non-empty and up to 5 MiB.

Validation: 32 tests, successful type/build checks and seven native right Side Panel journey checks using real email/PKCE, uploads, Worker, files and billing. Model turns are synthetic. Earlier four-client media below keep their original scope.

![Native conversation](assets/screenshots/workmate-chat-05-continued-en.png)

![Uploaded attachment](assets/screenshots/workmate-chat-05-attachment-ready-en.png)

[Source-bound chat evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/extension-chat-checkpoint.json) · [Design and recovery rules](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/71-extension-cloud-conversations.md)

Latest Desktop local execution: [design](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/72-desktop-local-execution-and-control-plane.md) · [source-bound proof](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-local-execution-checkpoint.json). Prior recordings below retain their original source scopes.
