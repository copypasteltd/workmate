# CopyPaste Chrome Extension

[简体中文](README.md) · Chrome MV3 side panel and native bridge · 0.4.0

An independent repository for project/specialist tasks, explicitly selected files and user-triggered current-page capture. Persistent folder operations use the installed Desktop native helper. Execution and billing stay on the platform; this extension contains no AI credentials.

![Sign-in](assets/screenshots/01-login.png)
![Authenticated side panel](assets/screenshots/02-workspace.png)

## Build and load

Requires Node.js 22.14+ and Chrome 120+. Native Chromium was used for qualification. Start platform and Web first:

```powershell
npm ci
npm run typecheck
npm run build
```

Enable developer mode at `chrome://extensions`, load `dist/` unpacked and open the CopyPaste side panel. Stable unpacked ID: `fffkcnmfdhahlnifgdilabheppkgnlok`. `manifest-key.txt` is a public SPKI key, not an AI credential or store private key. Match platform `EXTENSION_ID` and Desktop `deployment.json`.

Defaults are API `http://localhost:4310` and Web `http://localhost:4317`. For production:

```powershell
$env:COPYPASTE_API_ORIGIN='https://api.your-company.example'
$env:COPYPASTE_WEB_ORIGIN='https://agent.your-company.example'
npm run build
```

Only HTTPS company origins or localhost development origins are accepted, without embedded credentials, paths or queries. Host permissions contain only the API origin. The extension has not been published to the Chrome Web Store. Docker, WSL and virtualization are prohibited.

## Authentication and use

```mermaid
flowchart LR
  E[Open panel] --> I[chrome.identity window]
  I --> W[Web email sign-in and consent]
  W --> P[Single-use PKCE code]
  P --> S[Trusted service worker session]
  S --> T[Select project and specialist]
  T --> A[Platform tasks, status and cancellation]
  T --> F[Explicit picker or current page]
  T --> N[Optional Native Messaging]
  N --> D[Desktop folder grants]
```

The exact callback is registered to Chrome identity. Access/refresh tokens stay in trusted-context `chrome.storage.session`, not the panel, localStorage or `storage.local`. Closing the browser ends that session. Local extension storage only retains locale. The platform handles refresh rotation and logout.

Uploads require a user picker and are limited to 5 MB by the extension; the server rechecks project rights. Current-page capture requires a click and activeTab/scripting, excludes forms/editable/hidden content and does not run continuous site-wide capture.

## Web and Desktop integration

Version 0.2.0 uses the same platform identity, permissions and task API. The build derives the manifest version from package.json. The panel provides lightweight tasks/materials; configure persistent specialists, full private conversations and memory in Web or Desktop. Private outputs require explicit publication before project sharing.

## Native folders

The extension cannot silently scan the local disk. Install Desktop using the Windows Setup package, explicitly connect the Chrome helper in its device page, then grant optional nativeMessaging permission in the extension. Registration is per Windows user and allowlists the official extension origin.

Each folder needs separate native consent, expires after one hour and is read-only by default. Creating new files requires extra consent. List, preview, upload, create-only text output and revoke operations reject traversal, links/junctions, device names, ADS, overwrite and remote shell. Responses are capped at 900 KB; use the file picker for larger transfers.

## Verification and source

- `background.ts`: PKCE, token rotation, limited API/native messages and current-page capture.
- `panel.ts`: workspaces/projects/roles/tasks, upload, folder tools and locale.
- `build.mjs`: public deployment origins, manifest and stable ID.
- Delivery `npm run qa:extension`: real MV3 loading, chrome.identity login, upload, token privacy and logout; browser contexts close in finally.
- Delivery `npm run qa:desktop`: packaged native-host framing, allowlist, folder grants and local operations. QA does not overwrite the user's existing registry registration.

Static interface text supports Chinese/English; some dynamic statuses remain Traditional Chinese. Without live internal AI qualification, executable AI tasks remain unavailable. New organizations are initialized on Web. Daily/weekly cloud schedules are managed in Web or Desktop; full AI video/speech remain outside this release. See [notices](THIRD_PARTY_NOTICES.md).
