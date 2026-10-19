# CopyPaste Desktop

[简体中文](README.md) · Windows enterprise Agent client · 0.5.0

An independent Electron repository bundling the Web workspace and a narrow local bridge. It supports system-browser login, Windows user-level encrypted credentials, explicit folder grants, platform-signed local file dispatch and Chrome Native Messaging. Codex execution remains on the company platform; the client never connects directly to model providers.

![Packaged Windows application](assets/screenshots/03-packaged-windows.png)
![Authenticated workspace](assets/screenshots/01-workspace.png)
![Local files](assets/screenshots/02-local-files.png)

## Run and package

Windows x64, Node.js 22.14+ and npm are required. macOS/Linux packages have not been built or qualified. Start platform and Web first:

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm start
```

Public `deployment.json` contains API/Web origins and the official extension ID. `COPYPASTE_API_ORIGIN` / `COPYPASTE_WEB_ORIGIN` can override at build or runtime. Only HTTPS or localhost is accepted. Delivered binaries target local demonstration at `localhost:4310/4317`; rebuild with company cloud origins for deployment.

```powershell
npm run package
```

Outputs include `release/CopyPaste-0.5.0-x64-Setup.exe`, `release/CopyPaste-0.5.0-x64-Portable.exe` and `release/win-unpacked/CopyPaste.exe`. `package:dir` produces only the unpacked app for QA. Packages are unsigned and are not store-published. Docker, WSL and virtualization are prohibited.

## Identity and local files

```mermaid
flowchart LR
  D[Launch Desktop] --> B[System browser and PKCE]
  B --> E[Email verification and consent]
  E --> L[Single-use loopback callback]
  L --> V[DPAPI-protected local session]
  V --> W[Workspace and cloud deliverables]
  W --> F[Native folder selection]
  F --> G[One-hour read-only grant]
  G --> P[Device pairing and pinned public key]
  P --> C[Verify signature, nonce and expiry]
  C --> R[Limited file execution and result]
```

State, PKCE, exact loopback callbacks and single-use codes protect sign-in. Short-lived access tokens use rotating refresh families. Logout revokes the platform session and local folder grants. Windows DPAPI CurrentUser wraps a local profile key; AES-256-GCM authenticates encrypted state. Credentials never persist as plaintext. The key does not depend on concurrent Chromium profiles, so Desktop and native-host processes share grants safely. A fixed native Windows PowerShell/.NET helper invokes DPAPI using stdin for secret bytes; it never executes customer commands.

Normal user state is `%APPDATA%/CopyPaste/`; QA uses isolated `COPYPASTE_USER_DATA`. Installed application user state is distinct from source/build artifacts, which remain in this repository.

Roots stay local. Grants default to list/read, require separate consent for create-only writes, expire after one hour and are limited to 20. Reads are limited to 5 MB, text creates to 2 MB and listings to 500 items. Traversal, links/junctions, ADS, Windows device names, trailing dots/spaces and overwrites are rejected. Revocation/expiry is checked before journal replay; journal size/count are bounded and cross-process writes are serialized.

Downloads use the company API and native save dialog with create-only semantics. Uploads require chosen files or authorized folders. Commands verify Ed25519 signatures, pinned keys, nonces and expiry. Results currently use native bearer tokens plus nonce, not client-signed result envelopes.

## Specialists and conversations

Version 0.2.0 bundles persistent specialists, private conversations, five memory scopes and ask/plan/execute modes. Notes persist through the limited native API bridge and survive renderer reloads. Desktop and Web share platform user/permission rules. Private task outputs become shared project copies through explicit publication.

![Private conversation in the packaged client](assets/screenshots/04-private-conversation.png)

## Chrome helper

Install Setup to a stable path, then explicitly connect the Chrome helper from the device page. This writes the current user's `HKCU/Software/Google/Chrome/NativeMessagingHosts/hk.copypaste.agent` registration and only permits the configured official extension. The extension separately requests nativeMessaging and individual folder grants. Use Setup for persistent registration; portable paths may change.

Trusted deployment staff may also use:

```powershell
npm run native:register -- fffkcnmfdhahlnifgdilabheppkgnlok 'C:\YourStableInstall\CopyPaste.exe'
```

Point registration only at a stable trusted executable. QA does not overwrite existing user registry settings. The helper implements Chrome length-prefixed JSON with responses capped at 900 KB.

## Independent renderer

Committed `renderer/` is a self-contained Web source snapshot. Normal builds do not require a neighboring Web checkout. Explicit refresh:

```powershell
npm run renderer:sync -- 'D:\path\to\copypaste-web'
npm run build
```

`renderer-source.json` records provenance and hashes. Context isolation and sandboxing are enabled; Node integration and webviews are disabled. CSP prevents direct renderer networking; a limited IPC API handles requests. Extra permissions, arbitrary external origins and navigation are denied. Native-host mode creates no browser window.

## Validation and remaining scope

`npm test` covers path confinement, revocation, replay, create-only behavior, fixed API origin and actual Windows DPAPI cross-process decryption/tamper rejection. Delivery `qa:desktop` uses the packaged application for real OTP/PKCE, specialist creation/private-note persistence, encrypted credentials, folder access, signed cloud dispatch and native-host framing. Test dialogs select fixture paths; they do not authorize real user folders. `qa:packaged` separately checks packaging, version and launch.

The company AI gateway and external advertising platforms still require live qualification. Arbitrary desktop UI control, customer shell execution, full AI video/speech are not implemented. This release does not certify every long-term requirement. QA closes its browser/application processes in finally. See [third-party notices](THIRD_PARTY_NOTICES.md); master documents remain under the delivery root's `docs/`.

Chrome Host launches the bundled Node-mode script through `resources/native-host.cmd`; its source is `src/native-host.ts`. This keeps Chrome's binary stdin/stdout independent of the GUI process.

## Cloud workflow schedules

Version 0.4.0 includes the matching calendar interface: daily/weekly frequency, IANA zones, budget preview, explicit authorization, history and pause/resume/retire. Requests use the native bearer bridge with the same platform checks. Cloud execution continues after the app closes. These calendars do not grant unconfirmed local-folder access. Delivery `qa:desktop` creates, displays and retires a calendar in the actual packaged application.

![Cloud schedule in the packaged app](assets/screenshots/05-cloud-schedules.png)

## 0.5.0 company identity and unified sign-in

OIDC uses code + PKCE S256, signature verification, state/nonce and a fixed callback. An existing registered account and active workspace membership are required. First binding requires a separate CopyPaste work-email code; domains never auto-enroll users. Configuration changes, disablement or unlinking revoke all linked users’ CopyPaste browser/native/refresh sessions and prior execution authorization. Administrator email and TOTP remain separate.

Choose company identity in the system browser and explicitly authorize return. The real loopback PKCE callback stores independent native credentials in DPAPI-protected local storage. Account settings show connected identities. Disabling the company connection invalidates existing native access/refresh credentials and outstanding codes; there is no separate local sign-in bypass.

```mermaid
flowchart LR
  Member[Existing workspace member] --> IdP[Signed OIDC and PKCE]
  IdP --> Proof[First-link email proof]
  Proof --> Web[CopyPaste session]
  Web --> Native[Explicit native consent and PKCE]
  Revoke[Disable or unlink] --> All[Revoke browser and native credentials]
```

![Actual company identity interface](assets/screenshots/06-company-identity.png)


## Native file-channel repairs in progress

The renderer inherits resumable uploads, synthetic-mode labels, deletion progress and retention expiry. IPC forwards stable Idempotency-Key values. Downloads ask for a destination first, stream to a temporary file, validate size and SHA-256, refuse existing destinations and clean up after failure, with a 1 GiB limit. JSON event IPC drains pages using a cursor.

Native source validation is recorded below. Windows installers have not been rebuilt for these changes; packaged regression remains pending. Existing 0.5.0 installers retain their original behavior.

## Current source validation

Native source QA passes system-browser PKCE, stable upload idempotency, an actual 29 MiB part upload, streamed download with matching digest, existing-file protection and browsing the shared cloud tree over the native bridge. Owned browser and Electron instances close after the run.

![Verified native transfer](assets/screenshots/06-verified-transfer.png)
![Desktop cloud workspace](assets/screenshots/07-cloud-files.png)

This evidence covers current source execution. Historical 0.5.0 installers have not been rebuilt and do not contain these changes.

## Project methods (current source snapshot)

Project methods now have exact installation and specialist/task bindings. Ordinary disable affects new work; uninstall and permanent security revocation block subsequent calls, including old tasks. Reinstallation creates a new identity and requires explicit adoption by a new specialist version. Current plan access is checked before tools and final output; measured usage settles against the original reservation.

Platform regression: **108/108**. `npm run qa:skills` in the delivery repository passed three browser groups; ten captured HTTP payloads passed the strict design schemas. Custom package review/publication and complete live-role qualification remain pending. Existing 0.5.0 installers are historical.
