<!-- integrated-round-196 -->

## 196 · 0.5.3 · Codex services and review APIs

[完整交付與限制 / Delivery and limits](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/integrated-round-196/README.md) · [下載 / Downloads](https://agent.copypaste.hk/downloads)

1. Configure each model with its own API URL, key, upstream name and rates. Customers choose an organization/project. Company servers run cloud Codex; Desktop Codex runs on the customer computer.
2. Workspace APIs expose eligible versions, comparison, editor reads and saving. Only authorized project writers can revise the current UTF-8 file of a successful cloud execution; the limit is256KiB. Binary, mixed-newline and larger files retain read/download behavior.
3. Saving verifies task version, delivery digest, asset version and source digest under task/head locks. It creates an immutable version and invalidates the old review while retaining original bytes. Manual editing starts no model work or model fee.
4. An uncertain save requires an explicit retry of the original key/body. Authorization precedes replay. Comparisons include eligible older versions and authorized originals only, rechecking source access after reads and returning private/no-store.
5. view=all/terminal/browser filters program records before SQL pagination. An additive contract declares11 workspace routes from195/196; the inventory contains751 regular routes and1 conditional route without rewriting the historical baseline.

```mermaid
flowchart LR
 A[Sign in / 登入] --> B[Project, role and budget / 專案角色預算]
 B --> C{Execution / 執行}
 C -->|Web or Extension| D[Company cloud Codex / 公司雲端]
 C -->|Desktop native permission| E[Local Codex / 本機]
 D --> F[Results, files and actual usage / 成果檔案實際費用]
 E --> F
 F --> G[Review and compare / 審閱比較]
 G --> H[Explicit revision / 明確修改]
```

`GET .../workspace/versions` · `GET .../workspace/compare` · `GET .../workspace/editor` · `POST .../workspace/edit`

Scope: selected current journeys pass; original failures remain. Intermittent public HTTPS timeouts, professional outcomes, external integrations and full production/compatibility acceptance remain open. Earlier sections below describe historical releases.

<!-- integrated-round-195 -->

## 195 · 0.5.2 · 后台与运行内核 / Backend and runtime

Authorized task workspaces, actual readiness, append-only role evidence, Linux Office and private attachment delegation.

[Round delivery / 本輪交付](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/integrated-round-195/README.md) · [Download / 下載](https://agent.copypaste.hk/downloads)

```mermaid
flowchart LR
 A[Visit / 訪問] --> B[Email sign-in / 郵箱登入]
 B --> C[Workspace / 企業與專案]
 C --> D[Role, files, budget / 角色、檔案、預算]
 D --> E{Client / 客戶端}
 E -->|Web or Extension| F[Cloud Codex / 雲端]
 E -->|Desktop native permission| G[Local Codex / 本機]
 F --> H[Results, revisions, usage / 成果、修改、費用]
 G --> H
```

`GET .../tasks/:task/workspace` · `GET .../workspace/preview?asset_version_id=...` · `GET /v1/admin/operational-readiness` · `GET/POST /v1/admin/role-acceptance` · `POST /v1/admin/role-acceptance/revoke`. Schema163 is additive; owner migrations and non-root runtime remain separate.

<!-- usage-195 -->

Using this release:

1. Configure each model with its own API URL, key, upstream model name and rates. Readiness exposes state without disclosing values.
2. Complete resumable uploads and pin their versions. Conversation delegation validates private ownership, project, version and budget; message/task/reservation commit atomically.
3. Authorized task workspaces expose results, up to200 deliverables, preview actions and actual usage. Original downloads and paged Office previews use separate authorized endpoints.
4. Human role reviews preserve task, template, skill and deliverable snapshots. Additive schema163 retains existing billing and audit history.

<!-- /usage-195 -->

本輪實際測試與旅程見報告；保留歷史失敗，不以代碼量替代全部專業/生產驗收。影片/語音/Google/Meta真實配置、至少12角色專業驗收及完整兼容/運營矩陣仍開放。測試郵箱及未簽名安裝按已確認範圍保留。

Selected regression and real journeys are in the report. Historical failures remain. Real video/audio/Google/Meta configuration, at least12 professional role evaluations and the full compatibility/operations matrix remain open. The requested test mailbox and unsigned manual installation remain.

<!-- product-downloads-193 -->

## Public product downloads · 193

[Open the download page](https://agent.copypaste.hk/downloads). Desktop 0.7.4 (Windows Setup/Portable), Chrome extension 0.5.4 ZIP and file checksums download directly from the company site without signing in.

Client files are served as public static downloads without administrator or provider secrets. App use still requires the existing company/project authorization and company API.

The Windows build is unsigned. The extension is installed manually and is not listed in the Chrome Web Store. macOS/Linux installers are not available.

[方案 / Implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/development/193-product-downloads.md) · [驗證 / Verification](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/193-product-downloads.md)

![實際下載頁 / Actual public download page](assets/screenshots/193-downloads-desktop-en.png)

[實際手機下載頁 / Actual mobile download page](assets/screenshots/193-downloads-mobile-zh.png)

![實際頁面操作錄製 / Actual download navigation recording](assets/screenshots/193-actual-download-navigation.gif)

<!-- native-recheck-192 -->

## Recheck and native error visibility · 192

Adds a separate bounded client_error_code to native receipts, task reads, administrator execution lists and authorized support metadata. Rejects trailing whitespace, retains source restrictions and never exposes the whole native report. Settlement and reservations keep their original authority.

Final regressions: backend91, Web30, Admin22, Extension89, Desktop controller74; native Linux8 passed. Ordinary direct-browser GETs returned200 on all three domains; direct Python GETs returned403. This does not certify a zero-defect complete product. Item12 is excluded; unselected video/audio, Google/Meta, Linux Office and full-matrix scope remains open.

[方案 / Implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/development/192-native-error-observability.md) · [复查 / Recheck](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/192-native-recheck.md)

![本机原始原因 / Reported local cause](assets/screenshots/192-web-local-cause.png)

![实际桌面结果 / Actual Desktop result](assets/screenshots/192-desktop-local-result.png)

![实际云端下载录像 / Actual cloud download recording](assets/screenshots/192-actual-cloud-download.gif)

<!-- selected-repairs-191 -->

## Selected execution repairs and Desktop handoff · 191

Native Linux execution, schema162 capacity accounting, original Desktop errors, active inference renewal and linear fragmented-SSE parsing are deployed. Selected issues02/03/04/05/07 have current evidence. The owner removed12; the new Windows build is unsigned and installed manually. Unknown supplier fees/reservations remain unresolved; execution-capacity release does not settle a bill.

The final Desktop uses the installer default company HTTPS origin through raw CONNECT forwarding, preserving end-to-end TLS verification, requests, model output and accounting. Browser PKCE uses the canonical HTTPS domain. This real workflow passed; a single acceptance does not establish long-term public-route reliability, so issue01 remains open. Fresh scopes: backend40/40, streaming gateway24/24, Windows cloud compatibility38/38, Desktop controller74/74, actual pinned-Codex disconnect1/1 and native Linux8/8; actual cloud task HK$0.126067 and final-build Desktop task HK$0.035144. These are separate checks, not a fresh whole-product acceptance. Public reliability and other unselected190 items retain their gaps. Older entries below are historical.

```mermaid
flowchart LR
 A[Sign in and select workspace] --> B[Cloud Codex: Web and Extension]
 A --> C[Desktop: explicit local permission]
 C --> D[Customer-local Codex]
 B --> E[Company model API and usage]
 D --> E
 B --> F[Native Linux program and browser receipts]
 E --> G[Measured billing and delivery]
 F --> G
```

[方案 / Implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/development/191-native-execution-and-capacity.md) · [证据 / Evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/191-selected-repairs.json) · [Desktop0.7.4手动下载 / Manual download](https://github.com/copypasteltd/workmate/releases/tag/desktop-v0.7.4)

![Actual Desktop result / 实际本机结果](assets/screenshots/191-real-desktop-result.png)

![Actual Web delivery / 实际Web交付](assets/screenshots/191-real-cloud-delivery.png)

Actual Web download recording excerpt; identity labels redacted. 这是Web实际录像节选，不代表其他端的新交互录像。

![Actual Web download](assets/demos/191-actual-cloud-download.gif)

<!-- live-acceptance-189 -->

## Real image deployment and acceptance · 189

`gpt-image-2` passed actual generation and editing and is published with the same upstream URL/key as text. An actual Web Designer task generated persisted files, downloaded verified hashes and settled measured usage. Larger1254-square PNGs are decoded and normalized to1024 while exact originals remain downloadable. Image tools now resolve their frozen per-model connection without a duplicate global key; unrecovered image-tool failures cannot become successful tasks.

This repository owns cloud Codex, frozen per-model connection resolution, permissions, files and billing. Schema remains161; generation and editing use the published image version.

The full backend run recorded1950 tests:1949 passed and one failed; that browser deadline issue subsequently passed14/14 focused checks. Web28/28, Admin20/20, Extension89/89, Desktop269/269 and all builds passed. Separate image normalization48/48, per-model image/original persistence and discovery36/36, and actual native protocol image failure/recovery2/2 passed; overlapping runs are not summed into a new full-pass result.

Actual supplier-backed Desktop completion, public reliability, video/audio/Google/Meta credentials, SMTP and Linux native executor qualification remain open. The requested protected test mailbox remains. This is not full-product acceptance. See the [design, usage, original failures and rollback guide](https://github.com/copypasteltd/workmate/blob/docs/docs/development/189-real-image-and-acceptance.md).

```mermaid
flowchart LR
 A[Select Designer and budget] --> B[Cloud Codex with design skills]
 B --> C[Company API and frozen model connection]
 C --> D[Decode and verify PNG]
 D --> E[1024 image and exact upstream original]
 E --> F[Authorized download and measured billing]
```

![实际 Web 图片交付 / Actual Web image delivery](assets/screenshots/189-real-image-delivery.png)

Actual Web download interaction excerpt. Reuse in other client repositories remains Web evidence.

![Actual interaction](assets/demos/189-actual-image-download.gif)

<!-- live-acceptance-188 -->

## Real-service acceptance and deployment · 188

Real text service is deployed. Web and the native Chrome right Side Panel completed email sign-in, authorized file upload, actual cloud Codex analysis, file delivery/download and measured billing. Actual admin checks cover user/workspace creation and deletion, atomic bulk changes, per-model API/key editing and deletion, VIP grants/revocation and audit records. See the [complete evidence and usage guide](https://github.com/copypasteltd/workmate/blob/docs/docs/development/188-live-acceptance.md).

Desktop runs pinned Codex on the customer's computer with explicit folder and full-access consent. Recognized GPT model exec compatibility is repaired; actual local command/file/company-tool operations passed a labelled protocol fixture. Final real-supplier Desktop acceptance remains blocked by intermittent public connectivity. The original full backend regression recorded 1,936 tests: 1,834 passed, 101 failed and one skipped. Subsequent targeted checks are separate evidence, not a replacement full-pass certificate.

To configure service, administrators enter each model's upstream URL, API key, alias and rates in Model capabilities, then qualify and publish its version. Users verify email, select a real workspace/project and submit bounded work. The protected test mailbox remains enabled. Actual image generation returned403; video/audio and Google/Meta credentials are absent and remain unqualified.

```mermaid
flowchart LR
 A[Email verification] --> B[Workspace and project]
 B --> C[Web and Extension: cloud Codex]
 B --> D[Desktop: explicit local permission]
 D --> E[Customer-local Codex]
 C --> F[Company service and per-model connection]
 E --> F
 F --> G[File delivery, measured usage and audit]
```

![实际 Web 云端交付 / Actual Web cloud delivery](assets/screenshots/188-real-cloud-result.png)

Actual read-only scrolling through the completed Web task, not new inference or a certificate for every client:

![Actual Web result interaction](assets/demos/188-actual-cloud-result.gif)

<!-- admin-directory-lifecycle-184 -->

## User/workspace creation, deletion and bulk management · stage184

User and Company management now provide Create, permanent row deletion, current-page selection, bulk status changes and bulk deletion. Reasons, explicit targets, versions, five-minute previews and idempotency are mandatory. Highest administrators execute directly; other roles follow the published approval policy. Ordinary user creation still requires OTP at first sign-in; workspace creation includes its owner, billing account and first project.

Select only the records you intend to change, choose an action, enter a reason, preview and confirm. For deletion, type DELETE followed by the exact count and acknowledge retention. A changed or ineligible record rejects the entire selection. User deletion revokes sign-in and removes contact/profile data while preserving shared workspace content and billing/audit references. Workspace deletion immediately fences new work and queues permanent cleanup; track the actual cleanup status in Content management. API maximum100; the UI never silently selects other pages.

```mermaid
flowchart LR
 A[Directory / 目录] --> B[Create or select / 新建或多选]
 B --> C[Authority and frozen preview / 权限与预览]
 C --> D[Confirm or policy review / 确认或策略审批]
 D --> E[Atomic effects and audit / 原子操作与审计]
 E --> F[Result and cleanup tracking / 结果与清理追踪]
```

[Detailed design, API, permissions, retention and deployment](https://github.com/copypasteltd/workmate/blob/docs/docs/development/184-admin-directory-lifecycle.md)

13 focused native checks and10 final actual-browser checks passed. Two owned UI runs created and cleaned4 users and4 workspaces; all18 operations have matching direct-execution audit facts. The four root cleanup jobs finished with empty operational exception arrays and documented retained facts. Server configuration, model API/key settings and unknown financial holds are preserved.

<!-- highest-admin-direct-182 -->

## Highest-administrator direct execution · stage182

Active global built-in super_admin executes protected administrative changes directly. Other roles keep policy-based approval and cannot approve their own protected requests. Sensitive operations retain MFA, business permissions, scope, limits and original evidence checks. Actual actors, reasons, command hashes and outcomes are audited atomically.

Production gpt-6-luna was published directly through the real Admin UI. Operation `7d32d69d-5680-4199-bd04-1ebe2b1b4813`, audit `7174`; no pending review was created.18 focused checks and6 real browser checks passed. Existing model settings, encrypted keys, unknown holds and historical violations are preserved. Additive schema160 requires the matching API.

[设计、使用和逻辑图 / Design, usage and diagram](https://github.com/copypasteltd/workmate/blob/docs/docs/development/182-highest-admin-direct.md)

![实际交互 / Actual interaction](https://raw.githubusercontent.com/copypasteltd/workmate/docs/docs/assets/highest-admin-direct-182/182-highest-admin-direct.gif)

# Workmate · backend

<!-- model-tool-contract-181 -->
## Complete Codex model validation · stage181

The current saved **gpt-6-luna** passed real production Admin validation: pinned Codex, requested model/effort, a registered tool/result round trip, completed text and known usage. Per-model API URLs/keys are retained. Both flat function tools and native code-mode additional_tools are supported, with business permissions enforced.

Receipt `b8c8c28a-1df1-4ef7-af55-91d9d51b4bcc`; input/output tokens `20230/139`. Earlier uncertain requests remain intact. The unpublished bootstrap policy moves actor/verification ceilings from2 to4 to retain two old holds and restore two available slots; all budget amounts and other limits stay intact. Native code-mode context is pre-funded from complete serialized bytes, then settled using measured tokens; exceeding input, output or monetary bounds still fails.

Run `npm run build`. Focused checks use `scripts/run-tests-owned.mjs` with the current181 test versions and `tests/internal-ai-gateway.test.ts`. Failed historical attempts remain available and excluded from current automatic selection.

[Implementation, workflow and evidence / 方案、逻辑图与回执](https://github.com/copypasteltd/workmate/blob/docs/docs/development/181-model-tool-contract.md)

![Actual full Codex validation](https://raw.githubusercontent.com/copypasteltd/workmate/admin/assets/screenshots/181-codex-validation-passed-03f66d6b-a57b-4554-a7ab-1dca62712999.png)

![Actual Admin interaction recording](https://raw.githubusercontent.com/copypasteltd/workmate/admin/assets/demos/181-model-tool-contract.gif)

Earlier records follow. 以下为历史记录。

---

<!-- model-http-180 -->
## HTTP and HTTPS model upstreams · stage180

Model API base URLs accept **HTTP and HTTPS**. Public HTTP does not need the private-network checkbox. Saving, connection tests, Codex capability verification and inference use the same transport. Existing addresses and encrypted keys are retained.

The deployed gpt-6-luna connection was tested through the real Admin UI: authentication succeeded and the model list contains gpt-6-luna. This is a connection check, not full Codex capability qualification or automatic publication.

Build: `npm run build`. The per-model normalizer and shared transport support both schemes. Private address access still uses its explicit setting; the Admin label reflects this meaning.

[Usage and implementation / 使用与开发](https://github.com/copypasteltd/workmate/blob/docs/docs/development/180-model-http.md)

![Actual HTTP model connection](https://raw.githubusercontent.com/copypasteltd/workmate/admin/assets/screenshots/180-http-model-connected-f49d8316-fe59-4bea-beca-07a1668315f1.png)

![Actual connection test recording](https://raw.githubusercontent.com/copypasteltd/workmate/admin/assets/demos/180-model-http.gif)

Earlier records follow. 以下为历史记录。

---

<!-- model-management-179 -->
## Edit and delete existing models · stage179

Open [Model capabilities](https://agent-dashboard.copypaste.hk/catalog?view=capabilities). Each current model has **Edit model** and **Delete model** actions in both the list and detail view. Edit preloads the existing model/API/rates; its masked API Key field accepts a replacement directly. Keep the saved key with the same URL/network scope, or enter a new key after changing that scope.

**Save changes** updates the current model entry. Validate and publish the updated configuration before using it for new customer work. **Delete model → Confirm deletion** removes the model family from new selection, including pinned new-agent/task paths; a deleted default cannot reactivate a bootstrap fallback. Existing tasks and billing keep exact historical versions and encrypted connections. Current/history/deleted views expose the retained records.

Migration158 adds stable `capability_model_entries` and immutable `capability_model_revisions`. `POST /v1/admin/capability-releases/:id/edits` requires `admin.catalog.draft`; `/:id/deletions` requires `admin.catalog.publish`. Both require expected document/management revisions, idempotency and audited reasons. Deletion takes the exclusive capability-head lock; new selection takes its shared counterpart. `current_internal_capabilities` filters deleted heads and Catalog removes their bootstrap fallback. Original published/task bindings remain usable. Build: `npm run build`.

```mermaid
flowchart LR
 E[Edit existing model] --> C[Same model entry, updated configuration]
 C --> V[Validate and publish for new work]
 D[Confirm deletion] --> X[Remove future availability]
 C --> H[Preserve original task and billing bindings]
 X --> H
```

[Usage and implementation / 使用细则](https://github.com/copypasteltd/workmate/blob/docs/docs/development/179-model-management.md)

![Actual editing of an existing model](https://raw.githubusercontent.com/copypasteltd/workmate/admin/assets/screenshots/179-edit-model-087bfaac-ff46-480c-ae08-dc1b2aea04ea.png)

![Actual save and deletion](https://raw.githubusercontent.com/copypasteltd/workmate/admin/assets/demos/179-model-management.gif)

Earlier implementation and deployment records follow. 以下为原有版本记录。

---

<!-- per-model-connections-178 -->
## Per-model API configuration · stage178

Open [Admin → Model capabilities](https://agent-dashboard.copypaste.hk/catalog?view=capabilities) → **Create configuration**. Enter `gpt-6-luna` (or the actual upstream alias), its **API Base URL** and **API Key** in the same form. Each model owns its address and key. Text models require the OpenAI Responses API.

Save draft → test connection → run full capability validation → independent approval/publication → assign the published capability to roles/templates. A connection test reads `/models`; it does not publish a model. Validation and real use consume actual upstream credit, including in the current trial-accounting environment.

The server encrypts keys and never returns them. Version changes preserve frozen task connections. Retain an existing key explicitly when copying a version; changing the URL or network scope requires a new key. Missing explicit connections fail closed. No real supplier key was configured for this deployment.

Storage: `capability_model_connections`, migration157, cp_control-only encrypted credentials. Draft: `POST /v1/admin/capability-releases/drafts` with `connection: {base_url, api_key, allow_private_network}`. Probe: `POST /v1/admin/capability-releases/:id/connection-test`. Both use existing `admin.catalog.publish` authorization. Task execution resolves credentials by the frozen capability version and verifies model/operation; clients cannot override that identity. Build: `npm run build`. Related native PostgreSQL checks: `../copypaste-delivery/scripts/test-model-connections-178-v4.mjs`.

```mermaid
flowchart LR
 A[Model, URL and API Key] --> D[Immutable model configuration]
 D --> C[Connection check]
 C --> V[Validation and independent publication]
 V --> T[Task freezes model version]
 T --> G[Company gateway]
 G --> U[That model upstream]
```

[使用细则 / Usage and operations](https://github.com/copypasteltd/workmate/blob/docs/docs/releases/model-connections-178.md) · [Source/runtime increment](https://agent.copypaste.hk/downloads/workmate-model-configuration-178.zip)

![Actual model form](https://raw.githubusercontent.com/copypasteltd/workmate/admin/assets/screenshots/178-model-form-cdb03034-7f0f-4f3b-b68c-da666853b1c2.png)

![Actual save and connection test](https://raw.githubusercontent.com/copypasteltd/workmate/admin/assets/demos/178-model-connections.gif)

Earlier deployment/release records follow; their synthetic-service descriptions describe their original scope. 以下历史记录保留原部署范围。

---

<!-- public-domains-177 -->
## Public HTTPS deployment · stage177

[Web](https://agent.copypaste.hk) · [Admin](https://agent-dashboard.copypaste.hk) · [API readiness](https://ai-api.copypaste.hk/health/ready)

Backend origins and Secure cookies are updated; scoped authorization, CSRF, MFA, usage and audits remain enforced.

[Current deployment, login and operations / 当前部署、登录与运维](https://github.com/copypasteltd/workmate/blob/docs/docs/releases/domains-177.md)

Credentials are unchanged: server `/root/cfg/workmate/credentials.txt`, root `0600`. Admin: `admin@workmate.local` + email OTP + TOTP. Test mailbox: [protected operator inbox](https://agent-dashboard.copypaste.hk/ops/mailbox/). AI/media/ads/payment remain synthetic; records/files persist. 凭据保留，测试收件箱使用独立操作口令，外部服务仍为假数据。

[Desktop 0.7.2 Setup](https://agent.copypaste.hk/downloads/CopyPaste-0.7.2-x64-Setup.exe) · [Portable](https://agent.copypaste.hk/downloads/CopyPaste-0.7.2-x64-Portable.exe) · [Extension 0.5.3 ZIP](https://agent.copypaste.hk/downloads/CopyPaste-Extension-0.5.3.zip) · [Source increment / 源码增量](https://agent.copypaste.hk/downloads/workmate-domains-177.zip)

Windows installers are unsigned. Extract the Extension ZIP and load it unpacked in Chrome developer mode; the extension ID stays `fffkcnmfdhahlnifgdilabheppkgnlok`. Desktop AI access uses company services; supplier keys are not embedded. Windows 未签名，扩展采用已解压加载，固定 ID 不变。

```mermaid
flowchart LR
 W[Web HTTPS] --> P[Same-origin API proxy]
 A[Admin HTTPS and MFA] --> P
 N[Desktop / Extension] --> I[Company API HTTPS]
 P --> B[Isolated backend and database]
 I --> B
 N --> L[Local Codex / approved file upload]
```

[Actual public Web task](https://github.com/copypasteltd/workmate/blob/web/assets/screenshots/177b-domain-task-result.png) · [Actual interaction GIF](https://github.com/copypasteltd/workmate/blob/web/assets/demos/177-public-domains.gif)

---

Earlier releases and deployment history / 以下为历史版本及部署记录。

<!-- lan-deployment-176 -->
## LAN HTTP deployment · stage176

Web: http://192.168.31.20:63070 · Admin: http://192.168.31.20:63071 · API: http://192.168.31.20:63072

Native Linux Codex, a private PostgreSQL 18 cluster and API/worker are deployed.

Server plaintext credentials: `/root/cfg/workmate/credentials.txt` (root `0600`). Email OTP is retrieved through the protected test mailbox; Admin additionally requires TOTP. Synthetic services remain explicitly labeled.

[部署、登录与运维 / Deployment and login guide](https://github.com/copypasteltd/workmate/blob/docs/docs/releases/lan-176.md)

[实际 Web 交互 / Actual Web recording](https://github.com/copypasteltd/workmate/blob/web/assets/demos/176-lan-http.gif) · [后台截图 / Admin capture](https://github.com/copypasteltd/workmate/blob/admin/assets/screenshots/176e-lan-users.png)


## v0.1.3 · 当前完整交付 / Current complete delivery

[Release / 下载](https://github.com/copypasteltd/workmate/releases/tag/v0.1.3) · [中英使用手册 / Bilingual guide](https://github.com/copypasteltd/workmate/blob/v0.1.3/docs/releases/v0.1.3.md)

本轮完整包包含六仓源码和全部端，纳入团队/单次运行费用报表、原成员/协调员账目、交叉筛选和同快照CSV。当前源码与假数据冻结交付按使用者要求收口；服务器资料和正式服务接入后续提供。AI/媒体/广告/支付使用假数据，Windows未签名；完整专业/生产台账保持。

All six source trees/clients are delivered, including team/run financial reports, original member/coordinator entries, intersecting filters and matching snapshot CSV. This current source/synthetic frozen delivery closes as requested; server/live configuration follows later. External services are synthetic and Windows is unsigned. Full professional/production qualification remains tracked.


## 團隊費用 / Team consumption · stage174

團隊及執行ID交叉篩選，成員與協調員實際帳目只加總一次；固定快照明細／CSV保留原身份，舊來源不推斷。Team/run filters and groups sum original work entries once, with immutable detail/CSV and explicit unknown legacy attribution. 21 native report cases and seven current actual Admin journeys; original failed capture retained. Final freeze rebuilds Admin for current CSS.

```mermaid
flowchart LR
 T[Team] --> R[Individual run]
 R --> M[Member / coordinator works]
 M --> L[Original charges and refunds]
 L --> S[Scoped financial snapshot]
 S --> C[Detail and matching CSV]
```

![實際團隊費用 / Actual team consumption](assets/screenshots/workmate-admin-team-usage-174-03-team-02-single-run.png)

![實際操作 / Actual interaction](assets/screenshots/workmate-admin-team-usage-174-03-team-consumption-workflow.gif)

[MP4](assets/screenshots/workmate-admin-team-usage-174-03-team-consumption-workflow.mp4)


## Current complete frozen delivery · v0.1.2

The complete bundle includes every client, six source trees and the current posting-period reports. Desktop runs Codex locally with explicitly granted full local permission; the native Extension Side Panel reads/uploads authorized files for cloud Codex. Schema156, authorized synthetic AI/media/ads/payments and unsigned Windows.

[完整下载 / Complete release](https://github.com/copypasteltd/workmate/releases/tag/v0.1.2) · [安装、登录和使用 / Setup and flows](https://github.com/copypasteltd/workmate/blob/v0.1.2/docs/releases/v0.1.2.md)

本轮重新构建Backend/Admin；其余运行产物及Windows分发核对后复用。继承源码一致的阶段172定向验证，阶段173不重跑功能测试。Backend/Admin rebuilt; unchanged runtimes/Windows distributions verified and reused. Exact-source stage172 focused checks inherited; no functional tests rerun at173. Older entries below retain their historical scope.


## Current source increment · stage172

Admin supports creation and posting periods. Reports include old-work charges, Hong Kong posting days, refunds with an out-of-period original charge and negative net. Summary, projected detail and CSV share one immutable snapshot. Holds and lifetime operation units stay separate. Use matching backend/Admin sources with schema156. This increment is outside the frozen v0.1.1 ZIP; archives/tags remain unchanged.

Eight fresh native SQL/API cases and one exact projection case passed; six actual successful legacy cases are inherited only from identical sources. Seven actual Admin journeys passed. The first historical fixture was rejected for missing funding-source entries; a new version records balanced sources and funding movements without disabling guards. Original failures and all whole-acceptance scopes remain.

```mermaid
flowchart LR
 A[Admin MFA] --> B[Creation or posting period]
 B --> C[Scoped fixed snapshot]
 C --> D[Hong Kong day entries]
 D --> E[Same summary and detail]
 D --> F[Authorized CSV]
```

![Posting-period report](assets/screenshots/workmate-admin-posting-period-172-01-posting-01-period-summary.png)

![Actual interaction](assets/screenshots/workmate-admin-posting-period-172-01-posting-period-workflow.gif)

[MP4](assets/screenshots/workmate-admin-posting-period-172-01-posting-period-workflow.mp4) · [方案 / Behavior](https://github.com/copypasteltd/workmate/blob/docs/docs/development/172-admin-posting-period.md)

## Frozen delivery v0.1.1

The complete bundle includes local-Codex frameless Windows Desktop, Web, independent Admin, native Chrome Side Panel, backend, six buildable source trees and pinned runtime. Authorized synthetic services, unsigned Windows and schema156.

[完整发行包 / Complete release](https://github.com/copypasteltd/workmate/releases/tag/v0.1.1) · [安装及流程 / Setup and flows](https://github.com/copypasteltd/workmate/blob/v0.1.1/docs/releases/v0.1.1.md)

## Current source increment · stage169

Consumption reports add payer/project/creation-period filters, eight groupings, work accounting detail and same-snapshot CSV. Exact charges, refunds, holds, reconciliation and unknown supplier costs remain distinct. Current scopes, MFA and both export permissions are enforced. Schema156; existing v0.1.0 assets are unchanged. This increment is included in the next complete freeze.

```mermaid
flowchart LR
 A[Admin MFA] --> S[Scoped filters]
 S --> R[Encrypted fixed snapshot]
 R --> D[Groups / work / ledger]
 R --> E[Authorized CSV]
```

![Consumption report](assets/screenshots/workmate-admin-usage-report-169-02-usage-01-snapshot-summary.png)

![Actual interaction](assets/screenshots/workmate-admin-usage-report-169-02-consumption-report-workflow.gif)

[MP4](assets/screenshots/workmate-admin-usage-report-169-02-consumption-report-workflow.mp4) · [方案 / Behavior](https://github.com/copypasteltd/workmate/blob/docs/docs/development/169-admin-usage-reports.md)


[中文](README.md) · [Complete release](https://github.com/copypasteltd/workmate/releases/tag/v0.1.0) · [Bilingual setup guide](https://github.com/copypasteltd/workmate/blob/v0.1.0/docs/releases/v0.1.0.md)

Workmate serves Hong Kong enterprises, beginning with existing marketing teams. This independent **backend** component uses **Fastify / PostgreSQL / cloud Codex**. Business areas include design/media, advertising and website/SEO/GEO analytics, repeatable workflows and software development. CopyPaste's warm background, dark text, brand accents and editorial typography guide the interface.

## Current source increment · stage168

Combine registration/account-access dates and origin, VIP plan/state/expiry, confirmed charges, submitted/started role tasks, reconciliation and individual-account credit conditions. URLs survive reload/detail/return. Authenticated account access includes legitimate device polling; it is not human presence. Historical origin/activity stays unknown. Exact micro-HKD calculations count confirmed charges and never pool personal/workspace funds or classify unavailable/inconsistent accounts as zero.

Deploy complete schema001–156 with matching API/Worker: stop old services, back up, migrate and start the new services. Default directory DTOs remain compatible; view=operations opts into origin/access fields. Current independent usage/VIP/billing scopes and recent MFA are enforced. Directory reads do not mutate billing.

This source update follows v0.1.0 and is **not inside its frozen ZIP**. Frozen tags/assets remain unchanged. Backend/Admin builds, eight native SQL/API cases and six actual Admin browser checks passed; original fixture/locator failures remain preserved. Authorized synthetic dependencies and original whole-acceptance scopes remain explicit.

```mermaid
flowchart LR
 A[Admin OTP and TOTP] --> F[URL filters]
 F --> S[Current user and field scopes]
 S --> E[Same grant / exact charges / separate wallet]
 E --> U[Matching users]
 U --> D[User detail]
 D --> F
```

![Directory result](assets/screenshots/workmate-admin-directory-filters-168-03-filters-02-confirmed-result.png)

![Actual interaction](assets/screenshots/workmate-admin-directory-filters-168-03-directory-filter-workflow.gif)

[MP4](assets/screenshots/workmate-admin-directory-filters-168-03-directory-filter-workflow.mp4) · [Logic / 逻辑](https://github.com/copypasteltd/workmate/blob/docs/docs/development/168-admin-directory-operational-filters.md) · [Evidence / 回执](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/admin-directory-filters-168.json)

## Included user tasks/content · stage166

User detail opens creator-filtered tasks and content. Search, pagination and reload retain the user; return navigation restores directory conditions. Changing users discards previous bodies/operations. Current user scope intersects resource scope; body/download authority and recent MFA remain separate. Twenty content kinds use their actual creator; brands retain the original version-1 author. Unknown legacy authors remain unattributed in the full directory. Counts represent resource records; an asset and its cloud node have independent identities.

This functionality is included in v0.1.0 sources/distributions. Previous rc.5 tags/downloads stay unchanged. Current backend/Admin builds, eight native SQL/API cases and eight actual browser checks passed. The original locator failure and its media remain preserved. Authorized synthetic dependencies and all whole-acceptance scopes remain.

```mermaid
flowchart LR
 U[User detail] --> T[User tasks]
 U --> C[User content]
 T --> P[Current user and resource scope intersection]
 C --> P
 P --> S[Search, pagination and reload retain target]
 S --> U
 C --> B[Separate body and management authority]
```

![User tasks](assets/screenshots/workmate-admin-user-resources-166-02-user-resources-02-selected-user-tasks.png)

![User content](assets/screenshots/workmate-admin-user-resources-166-02-user-resources-04-original-user-content.png)

![Actual interaction](assets/screenshots/workmate-admin-user-resources-166-02-user-task-content-scope.gif)

[MP4](assets/screenshots/workmate-admin-user-resources-166-02-user-task-content-scope.mp4) · [Logic / 逻辑](https://github.com/copypasteltd/workmate/blob/docs/docs/development/166-admin-user-resource-context.md) · [Evidence / 回执](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/admin-user-resources-166.json)

## Current frozen release · v0.1.0

All clients, backend and six source trees are delivered together, including the latest creator-filtered Admin tasks/content. Six components are rebuilt. Rebuilt Desktop outputs match the qualified Windows app/Portable/Setup byte for byte, so those verified binaries are reused. Stage166's eight SQL/API cases and eight actual UI checks retain their source-bound original evidence; broad historical regression is not rerun.

Branch`backend`, frozen tag`v0.1.0-backend`. [Source and installers](https://github.com/copypasteltd/workmate/releases/tag/v0.1.0) · [Freeze record](https://github.com/copypasteltd/workmate/blob/v0.1.0/docs/quality/release-freeze-checkpoint-167.json) · [Open work](https://github.com/copypasteltd/workmate/blob/v0.1.0/docs/quality/remaining-work-stage167.md). AI/media/ads/payments use the authorized synthetic mode; Windows is unsigned. Existing screenshots/GIF/MP4 retain their actual capture scope and do not imply new full installation/professional qualification.

## Architecture and responsibilities

Entry points: `src/server.ts, src/workspaces.ts, catalog/, skills/, migrations/`. Codex is the only agent kernel. All AI calls use the company's OpenAI-compatible gateway; provider secrets remain server-side. Presets pin Skills, tools and configuration versions. The designer combines Codex, design Skills and company Image 2.

Web runs cloud agents. Chrome MV3 provides conversation and attachments in its native right Side Panel; customers explicitly select files and consent to upload for cloud execution. Desktop is frameless without Electron's default menu, runs Codex on the customer's computer and supports explicitly granted full local permission, stop/revocation and account/directory isolation.

Admin has independent email OTP plus TOTP and scoped permissions for users/organizations, usage, billing, VIP, roles/Skills and content. User detail passes the actual target ID; fee accounts are subject-filtered and VIP locks that target. Switching users unmounts previous dialogs/previews. Amounts use HKD micro-units. Budgets, balances, receipts, gifts, credit and VIP are distinct. Manual changes require preview, confirmation, current MFA/policy/approval, audited idempotency and current authority.

```mermaid
flowchart LR
 W[Web and Chrome Side Panel] --> A[Company API, identity and metering]
 A --> C[Cloud Codex and versioned Skills]
 D[Frameless Desktop] --> L[Customer-local Codex]
 L --> A
 A --> G[Company OpenAI-compatible gateway]
 M[Independent Admin MFA] --> A
 C --> R[Review, revise and download]
 L --> R
```

## Setup and commands

Place six independent repositories beside each other under `dev/`: platform, web, admin, desktop, extension and delivery, each with the `copypaste-` prefix. Use Windows x64, Node.js 22.14+, Git and native PostgreSQL. Media requires FFmpeg/FFprobe. Pinned Codex ships in the runtime archive. Docker, WSL and virtualization are prohibited.

Read the release guide. Before first configuration, choose an available database port. From Delivery run `demo:preflight`, `bootstrap:demo`, `demo:check`, then `demo`. Preserve existing configuration/data. Run Delivery `npm run stop` to close owned services.

Individual component development after supporting dependencies/backend are ready:

```powershell
npm ci
npm run build
npm start
```

API uses localhost4310, Web4317 and Admin4318. Development OTP messages are in platform `.data/mailbox/`. Enroll an administrator with platform `npm run admin:create -- admin@example.com super_admin` and configure TOTP from its one-time material. Desktop uses browser PKCE, a chosen local directory and explicit permission. Load the extension unpacked in Chrome developer mode and click its icon to open the side panel.

## Customer and operator workflow

1. Sign in and accept an invitation or create a workspace/initial project. An uncertain creation keeps its original request. Check & continue after reload reconciles that operation; unavailable/removed receipts never silently create a replacement company.
2. Select a project/preset, provide the brief, approved files/brand/accounts, budget and permission. Supply missing inputs within the original task. Execution pins accepted configuration and Skill versions.
3. Review durable progress, approvals, delivery versions, costs and consumption. Download original files or request revisions. Unknown costs stay under reconciliation instead of being treated as free or blindly repeated.
4. From Admin user detail, verify the billing/VIP subject, inspect its preview and confirm under current policy. Directory filters survive refresh/return. The current branch connects creator-filtered task/content pages and preserves the original directory conditions on return.

## Configuration and authority

Web/Admin use `VITE_API_BASE` or a same-origin proxy. Native deployment settings pin allowed origins and extension ID. Use HTTPS outside approved loopback development. Current SQL history is001–156 (frozen v0.1.0 uses155); API/Worker check schema and environment identity. Sources exclude secrets, private `.env`, user databases, dependencies and Git metadata.

Expired sessions clear the previous workspace. Delayed responses cannot replace a newer sign-in. Files are private by default. Requests, worker claims, tools and downloads recheck authority. Saved responses confer no permanent access. Explicit sign-out removes private workspace-draft names while retaining an owner-scoped opaque recovery key.

## Preset and Skill bindings

Eighteen professional presets are defined; this count does not prove complete professional qualification of twelve roles.

| ID | Role | Required Skill bindings |
| --- | --- | --- |
| R01 | Full-stack engineer | `fullstack-engineering@1.0.0`, `frontend-implementation@1.0.0`, `backend-api@1.0.0`, `qa-testing@1.0.0`, `delivery-core@1.0.0` |
| R02 | Frontend engineer | `frontend-implementation@1.0.0`, `ui-system@1.0.0`, `qa-testing@1.0.0`, `delivery-core@1.0.0` |
| R03 | Backend/API engineer | `backend-api@1.0.0`, `qa-testing@1.0.0`, `delivery-core@1.0.0` |
| R04 | QA engineer | `qa-testing@1.0.0`, `frontend-implementation@1.0.0`, `delivery-core@1.0.0` |
| R05 | UI/UX designer | `ux-research@1.0.0`, `ui-system@1.0.0`, `frontend-implementation@1.0.0`, `delivery-core@1.0.0` |
| R06 | Designer | `creative-direction@1.0.0`, `image-art-direction@1.0.0`, `image2-production@1.0.0`, `typography-layout@1.0.0`, `delivery-core@1.0.0` |
| R07 | Brand designer | `brand-system@1.1.0`, `image-art-direction@1.0.0`, `image2-production@1.0.0`, `typography-layout@1.0.0`, `delivery-core@1.0.0` |
| R08 | Advertising creative designer | `ad-creative@1.0.0`, `image-art-direction@1.0.0`, `image2-production@1.0.0`, `typography-layout@1.0.0`, `delivery-core@1.0.0` |
| R09 | E-commerce designer | `ecommerce-visual@1.0.0`, `image-art-direction@1.0.0`, `image2-production@1.0.0`, `typography-layout@1.0.0`, `delivery-core@1.0.0` |
| R10 | Social content designer | `social-content@1.0.0`, `image2-production@1.0.0`, `typography-layout@1.0.0`, `delivery-core@1.0.0` |
| R11 | Illustration/IP designer | `illustration-ip@1.0.0`, `image-art-direction@1.0.0`, `image2-production@1.0.0`, `delivery-core@1.0.0` |
| R12 | Typography/layout designer | `typography-layout@1.0.0`, `image-art-direction@1.0.0`, `image2-production@1.0.0`, `delivery-core@1.0.0` |
| R13 | Presentation designer | `presentation-production@1.1.0`, `typography-layout@1.0.0`, `dataviz@1.1.0`, `delivery-core@1.0.0`, `deterministic-metrics@1.1.0` |
| R14 | Landing page designer | `landing-page@1.0.0`, `ui-system@1.0.0`, `frontend-implementation@1.0.0`, `image2-production@1.0.0`, `delivery-core@1.0.0` |
| R15 | Data visualization designer | `dataviz@1.1.0`, `deterministic-metrics@1.1.0`, `typography-layout@1.0.0`, `delivery-core@1.0.0` |
| R16 | Video/motion designer | `video-storyboard@1.0.0`, `template-video-composition@1.0.0`, `video-generation@1.1.0`, `speech-production@1.2.0`, `delivery-core@1.0.0` |
| R17 | Marketing analyst | `ads-analysis@1.1.0`, `deterministic-metrics@1.1.0`, `dataviz@1.1.0`, `delivery-core@1.0.0` |
| R18 | Workflow automation consultant | `workflow-design@1.1.0`, `workflow-execution@1.1.0`, `delivery-core@1.0.0` |


[Role contract](https://github.com/copypasteltd/workmate/blob/backend/catalog/role-preset-catalog.json) · [Skill contract](https://github.com/copypasteltd/workmate/blob/backend/catalog/skill-packages.json)

## Actual screenshots and interaction

The shared media shows this release's actual Web/SQL recovery and Admin MFA/target checks with synthetic business facts. It does not claim fresh installation acceptance of other native clients.

![Recovered original workspace](assets/screenshots/workmate-functional-closure-165-01-original-workspace-recovered.png)

![Actual dropped-reply recovery](assets/screenshots/workmate-functional-closure-165-01-recover-original-workspace.gif)

[Actual MP4](assets/screenshots/workmate-functional-closure-165-01-recover-original-workspace.mp4)

## rc.5 frozen baseline qualification and publication

Historical rc.5 record: seven focused SQL cases, four draft-state cases and actual Web/Admin interactions accompanied six builds and Windows unpacked/Portable/Setup packaging. Current ASAR bytes and pinned Codex hashes are checked. Repeated broad regression is omitted as requested; the release checkpoint records actual results.

Branch `backend`, frozen tag `v0.1.0-rc.5-backend`. Later changes advance branches and notes while frozen bytes/tags remain. AI/media/ads/payments use the authorized synthetic mode. Windows is unsigned. All102 IDs and88 required whole-acceptance scopes remain;88 is not a count of missing modules. Production providers, signed updates, other OSes and full professional acceptance remain tracked.

[Checkpoint](https://github.com/copypasteltd/workmate/blob/v0.1.0-rc.5/docs/quality/release-freeze-checkpoint-165.json) · [Original acceptance ledger](https://github.com/copypasteltd/workmate/blob/v0.1.0-rc.5/docs/quality/remaining-work-stage165.md) · [Historical README](https://github.com/copypasteltd/workmate/blob/v0.1.0-rc.5/docs/history/readme-before-rc5/platform-en.md)
