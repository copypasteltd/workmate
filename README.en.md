# CopyPaste Desktop

## Marketing accounts and native clients (stage 61)

Connections supports Google Ads, Meta Ads, Google Analytics 4 and Search Console. Select a provider, complete the clearly labelled synthetic consent, wait for account/property/site discovery, then confirm discovered accounts and the projects allowed to use snapshots. Select dates and explicitly create a snapshot. The workbench shows durable pages, errors, rate-limit retry time and immutable history. Queued/running jobs can be cancelled; an explicit retry creates a new linked job.

As requested, business data remains synthetic. The supplier fixture runs only in non-production loopback development mode, using actual HTTP, one-use OAuth state, Google S256 PKCE and pagination. UI, facts and snapshots identify this mode; no real marketing account was accessed. Live application approval, actual account permissions, versions and reporting definitions require separate verification. AI requests continue through the company's OpenAI-compatible server, with Codex as the only agent kernel.

Only discovered authorized accounts can be bound. Google manager paths, GA4 reporting identity/timezone, GSC site permissions and Meta ad-read scope are retained. Snapshots distinguish capture time, source dates/grains, currencies, query digests and coverage limits. Missing cutoff times and metrics remain unknown. Overlapping Meta purchase types are not summed, GA4 traffic/event grains remain separate, and GSC pagination does not claim exhaustive detail. Inspect facts or download actual JSON/CSV. Normalized Google/Meta datasets retain immutable source-asset lineage.

Connection and history directories use bounded pagination; scope changes check their expected version. Revocation clears credentials, cancels unfinished work and fences late publication. Existing snapshots retain original project permissions, retention and content governance. Admin metadata is scoped by tenant/project. Body reading and fresh-MFA revocation are separate permissions; revocation returns a durable audited operation without revealing tokens. Source quarantine, expiry and physical deletion constrain derived analysis, downloads and shares while retaining content-free historical receipts.

Desktop is **frameless**, with a custom drag region and minimize/maximize/close controls, no native frame, Electron application menu or Alt menu. Provider authorization opens only a fixed company page in the browser and returns to the native workspace. Protected JSON passes through the current authenticated bridge into the native save dialog. The extension toolbar toggles **Chrome's native Side Panel**, right by default and subject to the user's Chrome preference. Its Marketing accounts & sync entry opens only the fixed company workspace.

Validation: **39/39 focused checks within 674/674 Platform tests**, retaining all 638 prior named tests; **17 actual Web/Admin checks and 16 newly packaged native checks** passed. Independent suites: web 8, admin 3, desktop 27, extension 21, delivery 12. Both native databases upgraded SQL071→077 while retaining every row digest in 157 prior public tables and SQL001–071. Seven new tables force RLS; legacy connections receive directory-only profiles without invented account/project grants or business history.

Current localhost previews: Desktop `release/connectors-61/`, Extension `release/connectors-61/CopyPaste-0.5.0-sidepanel.zip`. The unpacked executable was run. Setup/Portable remain unsigned and were not installed by these checks. All original 102 requirements and complete TC/NFR/G01–G10, professional-role and production acceptance remain tracked. Earlier receipts and screenshots below retain their original execution scope.

```mermaid
flowchart LR
  Client[Web / frameless Desktop] --> Consent[Fixed company launch / supplier consent]
  Consent --> Directory[Discovered authorized accounts]
  Directory --> Scope[Confirm account and project scope]
  Scope --> Queue[Freeze query / durable bounded pages]
  Queue --> Recover[Cancel / bounded retry / immutable history]
  Queue --> Snapshot[Immutable facts / cutoff / metric limits]
  Snapshot --> Export[Actual JSON / CSV / normalized source lineage]
  Panel[Chrome native Side Panel] --> Client
  Admin[Scoped Admin / separate body and revoke rights] --> Queue
  Admin --> Governance[Quarantine / expiry / physical erasure]
  Governance --> Export
```

![Actual packaged frameless Desktop](assets/screenshots/connector-native-02-facts-en.png)

![Actual Traditional Chinese dark Desktop](assets/screenshots/connector-native-02-facts-zh-dark.png)

## Template video and current clients (stage 60)

Open Design canvas → Video production. Save independent scripts, scene/storyboard tracks, branding, captions and fixed shared project PNG versions. Optionally select a fixed WAV/MP3, its in point/gain and an ownership or license statement. Save the project, explicitly render, then play or download six files: MP4, project JSON, script, storyboard, WebVTT and media probe. Edits append versions; failed receipts remain visible and retries are explicit. Queued and running renders can be cancelled.

`campaign-cuts-1` supports 3–60 seconds, 24/25/30/30000÷1001 fps and even dimensions from 256 to 1920 px within a total pixel/frame budget. Integer-frame timelines are encoded by native FFmpeg as H.264/yuv420p and optional AAC/48 kHz. Actual frames, duration, complete decoding and post-encode audio volume are verified. The bundled Noto Sans TC font includes its OFL, pinned source commit and full SHA. Missing glyphs, overflowing text, missing/quarantined/expired sources and short audio fail explicitly. Encoder fingerprints hash version output. Exported projects reference fixed source media: rebuilding requires those original versions and the recorded environment; byte-identical cross-environment output is not claimed.

The durable queue has immutable input versions, leases, bounded concurrency, cancellation and final authority/source checks. Admin scope, body reading and content actions remain independent permissions. Shared and authenticated downloads recheck derived source availability. Deletion physically erases objects and content copies. Composition makes no AI call; AI HK$0 excludes upstream source creation costs.

New R16 video preset v1.1.0 exposes the implemented `video.render` composition tool. Controlled Codex execute-mode calls can idempotently create and queue a project. Ask/plan and private conversations do not expose this shared writer. The 29th preset skill, `template-video-composition`, preserves the earlier 28 packages and complete acceptance conditions of all 18 roles; earlier installed versions remain unchanged. Generated video, effects, TTS/ASR and complete professional-role qualification retain separate requirements.

Validation: **34/34 focused checks within 638/638 full Platform tests**, retaining all 607 previous named tests; **10 actual Web checks and 17 newly packaged native checks** passed. Independent suites: Web 8, Desktop 25, Extension 21 and Delivery 12. Both native databases upgraded 069→071 while preserving all row digests in 154 prior public tables and SQL001–069; three new tables force RLS.

Desktop remains frameless, with custom controls and no Electron or Alt menu. Protected video bytes pass through the existing authenticated bridge into the local player. The extension toolbar still toggles Chrome's native Side Panel, right by default and subject to the user's Chrome setting, with a new video workspace entry. Current previews: Desktop `release/video-60/`, Extension `release/video-60/CopyPaste-0.5.0-sidepanel.zip`. The unpacked runtime was executed. Setup/Portable remain unsigned localhost previews without installer execution acceptance. All original 102 requirements and TC/NFR/G01–G10 retain their complete acceptance conditions.

```mermaid
flowchart LR
  Editor[Script / storyboard / captions / supplied audio] --> Version[Save immutable project revision]
  Version --> Queue[Explicit render / bounded durable queue]
  Codex[Controlled Codex execute tool] --> Queue
  Queue --> Check[Current authority / fixed source SHA / expiry]
  Check --> Encode[Native FFmpeg / integer frames]
  Encode --> Probe[Full decode / media probe / audio volume]
  Probe --> Publish[Recheck lease and sources / publish six files]
  Publish --> Playback[Web and frameless Desktop playback]
  Panel[Native Chrome Side Panel] --> Editor
  Queue --> Cancel[Cancel / immutable failure / explicit retry]
  Publish --> Policy[Admin isolation / source expiry / physical deletion]
```

![Actual packaged frameless Desktop video player](assets/screenshots/video-native-01-video-player-en.png)

## Batch designs and current clients (stage 59)

Design canvas now creates a creative × language × size matrix, capped at 60 independent delivery units. Supply Traditional Chinese/English copy, a fixed shared project PNG and preset or custom dimensions. Each size receives its own layout and actual PNG, SVG and editable JSON files. Edits, retries, failures and output history belong to individual units. Layout makes no AI calls: its recorded AI cost is HK$0 from local composition, excluding upstream source creation costs.

Claims and publication recheck current authority, input revision and source access. Cancellation, revocation and expired leases fence late output. Existing scoped Admin body permissions apply. Source quarantine blocks derived downloads; deletion physically erases embedded copies. SVG references server fonts; custom font distribution and commercial font qualification remain separate work.

Validation: **22/22 focused checks within 607/607 complete Platform tests**, retaining all original 588 named tests; **10 actual Web journeys and 13 new packaged/native journeys** passed. Independent unit suites passed Web 8, Desktop 25, Extension 21 and Delivery 12. Both native databases upgraded 068→069 while preserving every row digest in 151 prior public tables and SQL001–068; three new tables force RLS.

Desktop remains frameless with custom controls and no default Electron menu. The extension toolbar opens the native Side Panel and toggles it closed; its batch-design entry opens the full company workspace. Current previews are Desktop `release/matrices-59-02/` and Extension `release/matrices-59-02/CopyPaste-0.5.0-sidepanel.zip`. Earlier packages remain intact. These unsigned localhost previews have not passed installer execution or store distribution acceptance. Other professional workflows, live services, all original 102 requirements and TC/NFR/G01–G10 remain independently tracked.

```mermaid
flowchart LR
  Brief[Copy / fixed PNG / languages / sizes] --> Bound[Authorize / 60-unit bound]
  Bound --> Units[Durable independent units]
  Units --> Layout[Reflow text and image / lease]
  Layout --> Recheck[Recheck current authority and sources]
  Recheck --> Files[PNG / SVG / editable JSON]
  Layout --> Failed[Keep failed receipt]
  Failed --> Retry[Retry only this cell]
  Files --> Edit[New input revision for this cell]
  Retry --> Units
  Edit --> Units
```

![Actual packaged frameless Desktop](assets/screenshots/matrix-native-04-matrix-en.png)

## Explicit adoption (stage 54)

Default assistant updates, specialist settings and conversation adoption now compare the exact models, effort, unit rates and Skill versions before explicit consent. Five-minute comparisons bind the real session and current configuration; stale comparisons are rejected. Retries use one persistent operation key. Previously accepted tasks keep their original versions and prices.

Current backend regression: **484/484**, including all 462 prior named tests; focused **93/93** overlaps that total. Actual built Web: **12/12**; new packaged frameless Desktop and real native Chrome Side Panel: **11/11**. AI/media use the authorized simulated dependencies; identity, PostgreSQL, permissions and version transactions execute normally. All 102 original requirements remain tracked. Earlier sections below retain their historical source and artifact scope.

![Actual version review](assets/screenshots/adoption-native-05-comparison-en.png)

New local preview: `release/adoption-54/CopyPaste-0.5.0-x64-Setup.exe`, `CopyPaste-0.5.0-x64-Portable.exe` and `win-unpacked/CopyPaste.exe`. No native frame, Electron menu or Alt menu; custom controls remain active. The packaged executable was run; Setup/Portable were not installed. These are unsigned localhost previews. Previous `release/frameless/` bytes are retained.

```mermaid
flowchart LR
  Entry[Workspace / native entry] --> Compare[Freeze model and rate comparison]
  Compare --> Consent[Explicit user consent]
  Consent --> Save[Atomic version and receipt]
  Save --> Future[Future tasks]
  Existing[Already accepted tasks] --> Original[Original versions and prices]
```

## Controlled support update / 受控客服协助

The client retains its frameless window, custom title bar and no default Electron menu. Its independent renderer includes support-grant settings, with a narrowly allowed list/create/revoke bridge. Administrator support views cannot cross the customer bridge.

Stage 51 current regression: 424/424 with 711 source files; controlled-support browser workflows: 8/8 with 816 source files and 9 unedited captures. The 14 support tests, original contract checks, migration preservation and separate native checks are bounded evidence, not completion of all 102 acceptance cases. Current binaries are rebuilt; stage 50 binaries remain unchanged in their archive.

```mermaid
flowchart LR
  Customer[Customer grant] --> Scope[Explicit projects and deadline]
  Admin[Real administrator with MFA] --> Scope
  Scope --> Read[Read-only support view]
  Revoke[Expiry or revocation] --> Clear[Block reads and clear view]
```

The settings form shares the verified Web renderer. Packaged window/session checks remain separate; installer signing and the full OS/DPI matrix are pending.


[简体中文](README.md) · Windows enterprise Agent client · 0.5.0

An independent Electron repository bundling the Web workspace and a narrow local bridge. It supports system-browser login, Windows user-level encrypted credentials, explicit folder grants, platform-signed local file dispatch and Chrome Native Messaging. Codex execution remains on the company platform; the client never connects directly to model providers.

![Frameless Windows workspace](assets/screenshots/18-frameless-workspace.png)
![Authenticated workspace](assets/screenshots/01-workspace.png)
![Local files](assets/screenshots/02-local-files.png)

The historical stage 49 recheck verified frameless Desktop, the native Chrome right Side Panel, live rights/notifications and sign-out while retaining that stage's installer bytes. Stage 50 below rebuilds the current previews with financial views. Complete installation, signing, SSO and system acceptance remain separate.

## Durable financial notifications and three-client accounts (stage 50)

The independent renderer includes the financial accounts and inbox. The main process admits only the bounded user GET/PATCH paths, with credentials retained by the secure local bridge. The window stays frameless with custom controls and no Electron application menu. The actual packaged client verifies PKCE, exact gift values, unknown refunds, cross-client read state and clearing on revocation/sign-out. Current previews are rebuilt from the new source; stage 49 binaries remain archived separately.

Stage 50 historical platform regression: 410/410; actual three-client financial workflows: 8/8. AI/media and payment evidence are authorized local simulations; authentication, database, authorization, ledger and notification paths execute for real. This does not complete the original 102 acceptance cases, production banking or the full installation/system matrix.

```mermaid
flowchart LR
  Source[Canonical financial fact] --> Tx[Same-transaction outbox]
  Tx --> Worker[Current eligible recipient]
  Worker --> Access[Recheck current authority]
  Access --> Clients[Web / frameless Desktop / native Side Panel]
```

![Frameless financial accounts](assets/screenshots/28-financial-inbox.png)

![Actual unknown refund](assets/screenshots/29-financial-unknown.png)

## Frameless window

The main window has no native frame/title bar or Electron default application menu, including after Alt. A 40px CopyPaste title bar provides a drag region and bilingual minimize, maximize/restore and close controls using the existing light/dark tokens. Content and modals start below it. Eight invisible edge/corner handles resize within a minimum of 800×600; the bottom-right handle also supports arrow keys (10px) and Shift+arrows (50px). System file and permission dialogs keep their native UI.

The isolated preload creates this shell outside the Web renderer snapshot, so explicit renderer synchronization preserves it. Main-process IPC checks both the owning webContents and main frame, permits only fixed window actions and bounded resize, and retains sandbox/context isolation with Node integration disabled.

```mermaid
flowchart LR
  Bar[Title bar / resize handles] --> Preload[Isolated preload]
  Preload --> Guard[Own window / main frame]
  Guard --> Native[Fixed actions / bounded resize]
  Native --> State[State and accessible labels]
```

![Title bar and modal](assets/screenshots/19-frameless-dialog.png)
![Dark window](assets/screenshots/20-frameless-dark.png)

The current-source preview is under `release/frameless/`: `CopyPaste-0.5.0-x64-Setup.exe`, `CopyPaste-0.5.0-x64-Portable.exe` and `win-unpacked/CopyPaste.exe`. These unsigned previews use localhost origins. Earlier frameless artifacts remain byte-for-byte in `release/frameless-stage30/`, alongside the separately preserved original complete release. Rebuild with `npm run build` followed by `node node_modules/electron-builder/cli.js --win portable nsis --config.directories.output=release/frameless --publish never`.

The 2026-10-20 review fixed successful browser sign-in leaving Desktop on its login page: the local API policy now permits the read-only `/v1/session/context` operation and existing workspace-creation, member, analysis-evidence and report operations. Credential exchange remains in the main process; renderer access to credential/Admin endpoints and normalized path escapes is denied. All 25 Desktop tests and type checks pass. Delivery binds native QA to the actual client runtime, source, installer and extension bytes, preventing a historical green report from qualifying a changed package. Setup/Portable installation, uninstall and the full native authentication matrix remain separate acceptance work.

Run `npm run qa:native-surfaces` in the delivery repository for real window/menu/Alt controls, pointer/keyboard minimum-size enforcement, cross-window IPC denial, browser PKCE, modal clearance and themes/languages. Set `COPYPASTE_DESKTOP_EXECUTABLE` to the unpacked preview EXE for packaged verification; results are in `evidence/native-surfaces.json`. Signed updates, uninstall and the complete display/DPI matrix remain pending.

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

Platform regression: **185/185**. `npm run qa:skills` in the delivery repository passed three browser groups; 31 captured HTTP request/response payloads passed the strict design schemas. Custom package review/publication and complete live-role qualification remain pending. Existing 0.5.0 installers are historical.

## Default assistant and inbox (current source)

The synchronized renderer supports direct text-assistant use, private conversations and notifications. Eight source Electron journey groups cover native PKCE, verified 29 MiB transfers/no overwrite, cloud files, a real Codex synthetic text deliverable and original-task navigation. Only the two public configuration/content reads work before login, allowing the demo notice to appear; private calls still fail while signed out and writes still require native credentials.

The simulated-data notice persists before and after sign-in. Four native tests pass. Owned browser/Electron instances are closed; historical installers do not include this increment.

![Native inbox and simulated-data notice](assets/screenshots/08-notifications.png)

## Initial input checkpoint (current source)

The synchronized renderer keeps file/connection requests in the original conversation. Choose a current resource explicitly, or upload through the native bridge; resolving the request resumes the same task and budget hold. The eighth source Electron journey selects the actual 29 MiB upload, verifies no model execution while waiting and receives a result through real Codex with synthetic model data. Four native unit tests also pass. The renderer snapshot records all 41 source files.

This does not qualify paid-step continuation or replace historical installers.

![Native task waiting for its file](assets/screenshots/09-input-wait.png)
![Original task after explicit selection](assets/screenshots/10-input-result.png)

## Capacity waits (current source)

The renderer snapshot includes shared-slot notices and usage explanations. Server-side workspace, current-user and capability limits preserve the original queued task and hold, then resume automatically. Source builds and the existing eight native journeys are checked separately; historical installers do not include this increment.

## Native template selection and tenant isolation

The current renderer snapshot includes the persisted template directory, preflight and instance flow. The main process validates tenant UUIDs and forwards only to the fixed product API with protected credentials. Missing, foreign and malformed tenant identities are rejected. After real PKCE sign-in, a Desktop-created specialist is visible as the same persisted record on Web, with no implicit AI task or charge.

`qa:agent-templates` verifies current-source Electron with an isolated profile and closes its application and browser. All 18 professional presets still await live qualification. This screenshot does not mean historical 0.5.0 installers were rebuilt.

![Current-source native template specialists](assets/screenshots/13-role-template-specialists.png)

## Native PDF export and save (current source)

The synchronized canvas exports single-page raster review PDFs while retaining editable sources. Real PKCE sign-in precedes authenticated main-process requests and the existing streamed save to an explicitly selected destination. The new journey saves real PDF bytes and matches their hash to the immutable server version, then closes its owned application. Historical installers have not been rebuilt.

![Current-source native PDF export](assets/screenshots/14-design-pdf-export.png)

## Marketing CSV, exact metrics and provenance (current source)

Preview and confirm the account, currency, timezone, entity level, attribution and conversion definitions before import. Generic CSV and candidate Google/Meta-style headers support explicit column mapping. Actual UTF-8/BOM source bytes, SHA-256, definitions and computed results are retained. Duplicate requests, including a lost accepted response, return one project snapshot. Quarantine prevents reimport bypass. Unknown conversions stay unknown; exact decimal CTR/CPC/CPM/CVR/CPA/ROAS use aggregate totals and historical results are frozen.

Download the original CSV, normalized CSV, JSON calculation report with 11 evidence references and an actual SVG chart. Data dates are shown; upload time is not presented as the platform extraction cutoff. Official account sync, cross-platform conversion deduplication, FX and complete AI narrative acceptance remain pending. The marketing role is still unqualified. Authorized model dependencies are simulated; database and file behavior are real. Historical installers have not been rebuilt.

The independent renderer snapshot includes the same flow. `qa:marketing-analytics` uses real PKCE and protected IPC for a Meta-style import and native CSV save; local bytes match the source. Owned Electron/browser resources close in finally. Current source builds, renderer type checks and all four native unit tests pass.

```mermaid
flowchart LR
  UI[Desktop preview and confirmation] --> IPC[Protected main-process IPC]
  IPC --> API[Fixed product API]
  API --> Snapshot[Atomic snapshot and frozen metrics]
  Snapshot --> Save[Native save / digest verification]
```

![Current-source Desktop analytics](assets/screenshots/15-marketing-analytics.png)

## Private AnalysisSpec reports (current source)

Select saved snapshots, a business question, current/comparison dates, metrics, dimensions and a maximum HKD budget in Marketing insights. Preview neither calls a model nor reserves credit. Explicit confirmation atomically creates a private Codex task, frozen calculations/evidence and one reservation. Sources, accounts, currencies, timezones and attribution stay independent; identical facts deduplicate, conflicts reject, and zero/missing comparison values retain reasons. Retrying a lost accepted response returns the same report.

Real Codex reads paginated frozen evidence. The server validates evidence placeholders and numeric literals before publishing an immutable HTML asset; JSON preserves full calculations. Natural-language meaning and professional quality still require acceptance. Model dependencies are explicitly simulated. Source quarantine/erasure and project revocation block reads and downloads. All 102 complete acceptance cases, official connectors, live-role qualification and production release remain pending. Historical installers have not been rebuilt.

The independent renderer snapshot now records **41** source digests and builds without a sibling Web checkout. Actual Electron QA covers browser PKCE, protected IPC, report reads, HashRouter navigation to the original task and native HTML saving. Saved bytes match the Web download SHA-256. Owned application/browser resources close in finally. Builds, renderer type checks and all four native unit tests pass.

```mermaid
flowchart LR
  PKCE[Browser PKCE] --> UI[Private report / original task]
  UI --> IPC[Protected API bridge]
  IPC --> Save[Native explicit save / byte identity]
```

![AnalysisSpec report](assets/screenshots/16-analysis-report.png)

## File-backed CSV/XLSX and correction history (current source)

Marketing inputs are uploaded as immutable shared project-file versions before reviewing the sheet, header row, mapping and account definitions. Google/Meta use canonical `POST /v1/dataset-imports`; generic tables use the compatible nested endpoint. Preview calls no model and reserves no credit. Duplicate content and retries after a lost accepted reply reuse the snapshot. Original CSV/XLSX downloads verify actual bytes and SHA-256.

The bounded read-only XLSX parser accepts up to 5,000,000 bytes, 50 worksheets, 100 columns and 10,000 data rows. Multiple visible sheets require explicit selection; header rows range from 1 to 100. Shared/inline strings, XML Unicode references, exact decimals and 1900/1904 dates are supported. Money inputs allow six decimal places; frozen metric values retain eight. Formulas, including cached results, macros, external links, encrypted files and merged data cells are rejected. Errors identify actual worksheet cells. The UI explains that a failed preview still retains the explicitly uploaded original project file.

Corrections create new immutable snapshots and a complete ancestor chain; prior metrics and reports retain their original values. AnalysisSpec rejects selecting an ancestor with its correction before creating a task or budget hold. Source quarantine/erasure prevents dependent data, reports and downloads. Recovery closes only unclaimed unavailable tasks and releases unused holds; started or uncertain charges keep reconciliation rules. Private files require explicit publication as a shared copy first.

```mermaid
flowchart LR
  File[CSV / XLSX] --> Version[Immutable shared file version]
  Version --> Preview[Sheet / header / mapping / uncharged preview]
  Preview --> Confirm[Current authorization and explicit confirmation]
  Confirm --> Snapshot[Idempotent snapshot / frozen metrics]
  Snapshot --> Correction[New correction / preserved ancestors]
  Version --> Lifecycle[Source quarantine and erasure guards]
```

The full platform regression passes **185/185**; strict captured HTTP samples pass **31/31**. Four file-import and six existing CSV Web/source Electron groups pass, along with native type checks and four unit tests. Model/media dependencies are authorized synthetic data; database, Codex, files and authorization are real. All 102 complete acceptance cases, the complete official export matrix, live connectors, professional qualification and production release remain pending. Historical 0.5.0 installers have not been rebuilt. See master `docs/technical/29-file-imports-and-correction-lineage.md` for detailed limits.

The independent renderer snapshot records 41 source digests. The main process permits only the exact POST import route while retaining fixed-origin, tenant and credential checks. Actual Electron QA completes PKCE, upload parts, Meta XLSX import and a byte-identical native download.

![Source Desktop XLSX import](assets/screenshots/17-xlsx-import.png)

Task details inside the frameless window now offer initial queued pause/resume through the native API bridge, preserving the original task and reservation. Delivery `qa:task-controls` verifies browser PKCE, controls and cancellation releases. This is a source change; previous `release/frameless/` previews retain their recorded commits/hashes and do not yet include these controls. Paid-step continuation remains unfinished.

![Paused task](assets/screenshots/21-task-paused.png)

## Session races and local sign-out

The native session controller fences late login/refresh writes, coalesces concurrent refreshes and prevents an obsolete 401 from clearing a later account. Definitive rejection clears credentials; temporary failures preserve recoverable state. Sign-out clears encrypted credentials, revokes local folder grants/cached results and revokes the server family through refresh proof, including after access expiry. Offline feedback explicitly says remote revocation is unconfirmed and can be completed from another signed-in device. Account replacement also resets previous folder/device associations.

![Source frameless client sessions](assets/screenshots/22-active-sessions.png)
![Offline sign-out feedback](assets/screenshots/23-offline-signout.png)

This increment delivers source/builds. Historical frameless preview installers retain their recorded commits/hashes and do not include this session repair. `npm test` covers ten session race/persistence groups and existing native capabilities; delivery `qa:sessions` exercises actual Electron/PKCE and remote revocation.

## Membership suspension renderer source

The renderer explicitly synchronizes the Web suspension notice and builds with recorded source hashes. Frameless native controls and the removed Electron application menu remain enforced. This UI rerun did not rebuild installers/portable packages. Twelve current source authentication/session groups pass separately; the complete packaged/system matrix remains unproven.

## Current source authentication recovery (2026-10-20)

Delivery `qa:sessions` now passes all 12 Web/source Electron/MV3 groups. Actual Desktop browser S256 authorization, same-key recovery after committed first-exchange/refresh response loss, DPAPI clearing, Web remote revocation and explicit offline sign-out feedback are verified. All 769 source/runtime files match before/after execution. Owned browsers, Electron, MV3 and test credentials are cleared; old startup failures and diagnostics remain unchanged.

![Current frameless source-client sessions](assets/screenshots/24-active-sessions-current.png)
![Current offline sign-out feedback](assets/screenshots/25-offline-signout-current.png)

This run uses source Electron with current dist/renderer-dist; it does not accept twelve flows in Setup/Portable packages. Native frames/default menus remain removed. The independent 10/10 native-preview evidence governs window/side-panel appearance. Complete installation/uninstall, system/DPI, signing/updates and enterprise identity acceptance remain outstanding.

After the refund increment, current-source Web membership passes 6/6 (169 sources), Admin membership 6/6 (196), and Web/source Electron/MV3 authentication 12/12 (775), with unchanged source hashes and owned credential/process cleanup. The initial Electron debugging connection timeout is retained; the same source passed the rerun. Frameless Desktop and native Side Panel preview bytes are unchanged. Full packaged authentication and system acceptance remain separate.

Current-source verification after the immutable-plan increment (2026-10-20): Web membership 6/6 (172 source files), Admin membership 6/6 (200), and Web/source Electron/MV3 authentication 12/12 (779). Source digests match before and after each run; owned browsers, Electron and extension instances are closed and test credentials cleared. Immutable definitions and frozen legacy bindings do not change the native preview packages. Complete VIP/quota behavior, packaged authentication and system acceptance remain tracked in the main documentation.

## Current preview: frameless window and live entitlements

The CopyPaste title bar provides custom minimize, maximize, restore, close and bounded resize controls. Electron's native frame and default menu are removed. The rebuilt `release/frameless/` preview passes ten actual native-window/Side Panel checks. Six additional packaged Desktop/native Side Panel groups verify browser S256 PKCE, canonical VIP grants and suspensions, coherent plan/task-quota refresh, persistent notification reads and sign-out cleanup. Twelve source-runtime session groups are separate. Authorized synthetic model/media dependencies remain in use; full installation, update, SSO and system-matrix acceptance is still open.

```mermaid
flowchart LR
  Login[System browser authorization] --> Session[DPAPI credentials]
  Session --> Bridge[Restricted IPC methods and paths]
  Bridge --> Rights[Current server plan and rights]
  Rights --> Coherence[Matching revision and pinned plans]
  Coherence --> UI[Plan quotas features and notices]
  Logout[Sign out or remote revocation] --> Clear[Clear credentials and local grants]
```

Manual and scheduled refresh update the plan and rights together. A mismatch between the two transactions triggers another confirmation, preventing stale plan headings. Suspension restores the actually published free plan, including its existing features. VIP changes do not post wallet funds. The native bridge only exposes explicit entitlement/notice reads and the current user's notification read action.

![Actual frameless Desktop with current Pro plan and rights](assets/screenshots/26-vip-effective-rights.png)
![Actual suspension restores the free plan and limits](assets/screenshots/27-vip-suspended-rights.png)

The adjacent Delivery repository generates `qa:native-surfaces` and `qa:native-vip` receipts. `evidence/native-vip.json` binds 790 source files and the runtime, installers and extension bytes. The independent renderer snapshot contains 46 recorded file digests and builds from its own clone.

## Enterprise seat and storage enforcement (stage 48)

The independent renderer now includes workspace capacity with 47 source entries. Usage and Members read seats, retained bytes, upload reservations and limits through the existing restricted IPC bridge. Session/scope changes and failed reads clear stale data. Setup, Portable and the actual preview runtime were rebuilt. The window remains frameless with custom controls and no native Electron menu.

Ten native appearance checks, six packaged Desktop/actual Side Panel integration checks and twelve source authentication checks have separate receipts. Overlapping checks do not establish complete installation, system, SSO or production acceptance.

![Actual rebuilt desktop preview](assets/screenshots/26-vip-effective-rights.png)
