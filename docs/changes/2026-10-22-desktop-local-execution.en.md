# Desktop local Agent, customer full access and company billing

The previous Desktop entry still submitted cloud tasks while local execution existed only as a separate supervisor/file bridge. Desktop now opens a local Agent workspace. The customer chooses a specialist and directory, confirms native permission, and native Codex runs file and terminal work on that computer. Model calls continue through the company internal server.

## Customer flow

- Keep the frameless window, custom title bar and absence of Electron/Alt menus. Add local sessions, messages, activity, per-turn budget, stop and company billing receipts.
- Selecting a folder grants no execution permission. Choose read-only, workspace-write or full local access. Full access defaults to Cancel, permits current-OS-user resources outside the workspace and does not repeatedly approve commands after consent. Downgrade while idle, revoke at any time; signing out revokes access.
- Follow-up messages resume the same native thread with a new task-scoped credential and separate reservation per turn.
- Stop/revoke checks the local login binding and closes owned runtimes even when the company network is unavailable; receipts synchronize separately. Lost create/start responses can be cancelled using the original requests, without replaying native actions.
- Desktop-native authentication cannot silently enqueue a cloud Agent through old APIs. Cloud work opens the Web application explicitly. A specialist whose local tools are unqualified does not fall back to cloud execution.
- The Extension remains a native right Side Panel for cloud conversations and selected-file uploads, with no arbitrary local command permission.

## Execution and billing

Migration 092 adds immutable execution placement and device/account/native-family/session/workspace-hash/runtime bindings. Local tasks have no cloud outbox; cloud admission, Worker, recovery and database triggers enforce placement. Both locations share role/Skill versions, frozen capabilities/pricing, capacity, reservation and ledger rules.

The main process owns encrypted state, native consent, stable request keys and native process lifecycle. Renderer IPC never exposes inference credentials or executable paths, and generic API calls reject native-execution routes and encoded aliases. Native shells exclude the inference credential. Packaging includes the pinned Windows x64 `0.163.0-alpha.11` Codex and helpers, without PATH or alternate-kernel fallback.

Every inference request rechecks identity, project, entitlement, version, source, lease and budget. Finishing fences admission, closes upstream and settles using only company-observed usage. Client-reported money is rejected. Lost responses reuse original requests; accepted local actions are not blindly replayed. Unknown outcomes, expired leases and missing provider usage retain a reconciliation hold.

## Evidence and limits

The [checkpoint](../quality/desktop-local-execution-checkpoint.json) binds source files, tests, packaged artifact hashes, four screenshots, MP4/GIF and cleanup of owned processes, browsers and native PostgreSQL. Codex, Electron, email/PKCE, files, native sandbox, API and ledger actually run. Provider responses and native chooser/consent decisions are explicit test fixtures.

Five native specialists are admitted: fullstack, frontend, backend-api, software-qa and landing-page. All eighteen roles and twenty-nine Skills remain required. Complete native media/design/marketing and browser/app tools, human OS-dialog clicks, live model, signing, installation/upgrade/uninstall and the full OS matrix remain unqualified. The original 102 REQ/102 TC, NFR and G01–G10 baseline remains unchanged.

Original failures and earlier full-Platform, Extension and file-bridge evidence keep their exact bytes and historical source scopes. Development remains under the sole D-drive workspace, code/tools/builds under `dev/`, primary documents under `docs/`. No local Docker/WSL/virtualization; close unused owned browser pages.

The publication manifest explicitly records Git's declared CRLF-to-LF normalization for the Desktop test file, with separate qualified-working and committed-blob hashes. Original source archives and test evidence remain untouched.

[Implementation](../technical/72-desktop-local-execution-and-control-plane.md) · [Requirements](../requirements/03-client-execution-amendment.md) · [中文](2026-10-22-desktop-local-execution.md)
