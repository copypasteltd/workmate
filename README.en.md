# Workmate · CopyPaste Enterprise Agent · web

<!-- native-pairing-stage118 -->
Desktop 0.7.1 adds durable native device pairing, exact retry and permanent intent retirement.

Web Devices reflects retirement of the original, recovered and unacknowledged Desktop pairings while retaining the other computer. New Desktop login still uses actual Web authorization/PKCE and does not restore prior local grants. No new Web screen is claimed.

Validation: 42 backend + 141 Desktop + 22 native Codex checks; 13 builds; 7 real UI flows; 5 layouts; 2 GIF/MP4 pairs.

Real Windows DPAPI, owned Native Host, Electron IPC, Web PKCE and native PostgreSQL; synthetic customer/model data. Native consent answers and shell launch interception belong to the isolated automation. Company-signed installed-product uninstall/upgrade, macOS and complete product/live-model acceptance remain unqualified.

[Runbook / 方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/118-recoverable-native-pairings.md) · [Evidence / 证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/native-pairing-checkpoint.json)

```mermaid
flowchart LR
  Customer[Explicit folder pairing] --> Intent[Durable signed intent]
  Intent --> Pair[Current session and atomic create]
  Pair --> Retry[Same device on retry]
  Intent --> Retire[Sign-out or uninstall]
  Retire --> Fence[Permanent private retirement]
  Fence --> Receipt[Confirmed or durable pending receipt]
```

![Actual Desktop/Web pairing and retirement / 实际配对与撤权界面](media/native-pairing-copypaste-web__workmate-native-pairing-04-device-withdrawn.png)


<!-- desktop-removal-stage117 -->
Desktop 0.7.0 adds confirmed local withdrawal, signed device retirement, Chrome Host cleanup and optional safe cache removal.

Web Devices reflects a signed Desktop withdrawal while retaining other computers. The same browser session can grant a fresh Desktop PKCE login after withdrawal; it does not restore previous local folder or Chrome permissions. The screenshots below include the actual Web device state after the real company API processes the withdrawal.

Validation: 79 backend + 127 Desktop + 22 native Codex checks; 13 builds; 5 real UI flows; 4 layouts; 1 GIF/MP4 pair.

Real Windows DPAPI, owned Native Host, Electron IPC, Web PKCE and native PostgreSQL; synthetic customer/model data. Native consent answers and shell launch interception belong to the isolated automation. Company-signed installed-product uninstall/upgrade, macOS and complete product/live-model acceptance remain unqualified.

[Runbook / 方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/117-desktop-removal.md) · [Evidence / 证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-removal-checkpoint.json)

```mermaid
flowchart LR
  Customer[Native customer confirmation] --> Outbox[Encrypted signed withdrawal]
  Outbox --> Stop[Stop local Codex and revoke grants]
  Stop --> Host[Owned Host exit and registry check]
  Host --> Company[Company device retirement]
  Company --> Receipt[Confirmed or durable retry receipt]
  Receipt --> Windows[Windows uninstall with preparation hook]
```

![Actual Desktop/Web withdrawal UI / 实际撤权界面](media/desktop-removal-copypaste-web__workmate-desktop-removal-02-device-withdrawn.png)


<!-- desktop-updates-stage116-final -->
Final Desktop update qualification includes the corrected NSIS silent-install restart handoff, Admin release operations and local installation admission.

This release adds the company Desktop update service and Admin operations. Web continues to use company-cloud Codex and requires no Desktop installation. It does not silently install native software or gain local file access; screenshots below identify the affected Desktop/Admin surfaces.

Validation: 64 backend + 96 Desktop + 22 native Codex checks; 13 builds; 4 real UI flows; 5 layouts; 2 GIF/MP4 pairs.

Real Windows trust and Electron; synthetic accounts/models and an inert signed test file. Company-signed installed-product upgrades, macOS and complete product/live-model acceptance remain unqualified.

[Runbook / 方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/116-desktop-updates.md) · [Evidence / 证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-updates-final-checkpoint.json)

```mermaid
flowchart LR
  Sign[Offline signed release] --> Admin[Global MFA release review]
  Admin --> Head[Versioned company channel]
  Head --> Desktop[Local Desktop verification]
  Desktop --> Trust[Hash and Windows signer trust]
  Trust --> Confirm[Customer confirmation]
  Confirm --> Idle[Local work checkpoints]
  Idle --> Helper[Locked native installer handoff]
```

![Actual Desktop/Admin update UI / 实际更新界面](media/desktop-updates-copypaste-desktop__workmate-desktop-updates-03-update-verified.png)

[Actual interaction video / 实际交互视频](media/desktop-updates-copypaste-desktop__workmate-desktop-updates-03-signed-update-download.mp4)

![Actual Desktop/Admin update UI / 实际更新界面](media/desktop-updates-copypaste-desktop__workmate-desktop-updates-03-signed-update-download.gif)


<!-- desktop-updates-stage116 -->
Controlled Desktop updates now connect Admin release operations, signed downloads and local installation admission.

This release adds the company Desktop update service and Admin operations. Web continues to use company-cloud Codex and requires no Desktop installation. It does not silently install native software or gain local file access; screenshots below identify the affected Desktop/Admin surfaces.

Validation: 64 backend + 96 Desktop + 22 native Codex checks; 13 builds; 4 real UI flows; 5 layouts; 2 GIF/MP4 pairs.

Real Windows trust and Electron; synthetic accounts/models and an inert signed test file. Company-signed installed-product upgrades, macOS and complete product/live-model acceptance remain unqualified.

[Runbook / 方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/116-desktop-updates.md) · [Evidence / 证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-updates-checkpoint.json)

```mermaid
flowchart LR
  Sign[Offline signed release] --> Admin[Global MFA release review]
  Admin --> Head[Versioned company channel]
  Head --> Desktop[Local Desktop verification]
  Desktop --> Trust[Hash and Windows signer trust]
  Trust --> Confirm[Customer confirmation]
  Confirm --> Idle[Local work checkpoints]
  Idle --> Helper[Locked native installer handoff]
```

![Actual Desktop/Admin update UI / 实际更新界面](media/desktop-updates-copypaste-desktop__workmate-desktop-updates-02-update-verified.png)

[Actual interaction video / 实际交互视频](media/desktop-updates-copypaste-desktop__workmate-desktop-updates-02-signed-update-download.mp4)

![Actual Desktop/Admin update UI / 实际更新界面](media/desktop-updates-copypaste-desktop__workmate-desktop-updates-02-signed-update-download.gif)


<!-- cloud-events-stage115 -->
Private signed event work now connects customer confirmation, durable deduplicated receipts and independent cloud runs with scoped administration.

Open Workflows, prepare event work from an existing run or your consultant conversation, review the exact method/inputs, time zone and per-run/daily limits, check consent and activate. Save the masked one-time key with your sender. Events and method shows stable history, fixed revisions and the actual run link. Pause preserves current runs; resume/revision requires fresh review. Rotation immediately revokes the old key.

Validation: 85 affected backend tests, 13 build/type checks, 7 actual Web/Admin/native Side Panel flows, 5 layouts and 2 pinned native Codex executions. Model/accounts/sender are synthetic. Provider-native webhook and full-product acceptance remain unproven.

[Runbook / 方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/115-signed-cloud-events.md) · [Evidence / 证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/cloud-events-checkpoint.json)

```mermaid
flowchart LR
  Customer[Customer reviews fixed method and budgets] --> Trigger[Private event rule]
  Sender[Customer configured sender] --> Verify[Raw byte HMAC and current authority]
  Trigger --> Verify
  Verify --> Inbox[Durable deduplicated inbox]
  Inbox --> Policy[Age overlap interval daily caps]
  Policy --> Run[One independent private run]
  Run --> Review[Human review]
  Review --> Codex[Company cloud Codex child]
  Codex --> Receipt[Actual delivery and settled usage]
```

![Actual copypaste-web event flow / 实际事件流程](media/cloud-events-copypaste-web__workmate-cloud-events-04-review-en.png)

![Actual copypaste-web event flow / 实际事件流程](media/cloud-events-copypaste-web__workmate-cloud-events-04-receipt-en.png)

![Actual copypaste-web event flow / 实际事件流程](media/cloud-events-copypaste-web__workmate-cloud-events-04-compact-zh-dark.png)

[Actual interaction video / 实际交互视频](media/cloud-events-copypaste-web__workmate-04-cloud-events-confirmation.mp4)

![Actual copypaste-web event flow / 实际事件流程](media/cloud-events-copypaste-web__workmate-04-cloud-events-confirmation.gif)


<!-- native-recovery-stage114 -->
Native encrypted backups and isolated recovery are implemented. A consistent database snapshot and immutable files are authenticated together; a newer independent deletion journal suppresses deleted content before a restored environment can be reviewed.

Customer login, tenant/project access and cloud Codex remain the normal entry. A restored isolated environment refuses API startup, so historical tasks and financial facts cannot silently resume. Recovery readiness is an administrator operation; this delivery does not claim an additional customer recovery screen.

Validation: 64 affected backend tests (including 10 native recovery tests), 13 build/type checks and 6 actual Admin flows across 3 measured layouts. Real native backup/restore; synthetic customer/model data. Production cutover, offsite durability, PITR and full production RPO/RTO remain unqualified.

[Runbook / 方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/114-native-backup-recovery.md) · [Evidence / 证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/native-recovery-checkpoint.json)

```mermaid
flowchart LR
  Live[Native database and immutable objects] --> Snapshot[One exported snapshot]
  Snapshot --> Archive[Authenticated encrypted archive]
  Live --> Journal[Independent deletion journal]
  Archive --> Verify[Verify every file and key]
  Journal --> Verify
  Verify --> Restore[New quarantined database and directory]
  Restore --> Erase[Replay newer deletion records]
  Erase --> Receipt[Immutable isolated recovery receipt]
  Receipt --> Admin[Global permission and current MFA]
  Restore --> Fence[API and workers remain fenced]
```

![Actual Admin recovery readiness / 实际后台恢复面板](https://raw.githubusercontent.com/copypasteltd/workmate/admin/assets/screenshots/workmate-recovery-06-overview-en.png)

![Actual Admin recovery interaction / 实际后台恢复交互](https://raw.githubusercontent.com/copypasteltd/workmate/admin/assets/screenshots/workmate-06-native-recovery.gif)


<!-- controlled-budget-stage113 -->
Google Ads budget changes now have an explicit expiring policy, exact immutable previews, customer confirmation, a single durable dispatch and immutable receipts. Unknown outcomes are observed and manually closed without resending.

Connections → Google Ads → authorize and bind an advertiser/project → Manage budgets & operations → configure policy → exact preview → submit → customer-manager confirmation → immutable receipt. Changed inputs require a fresh preview.

154 backend · 53 Desktop unit · 22 actual native Codex · 12 actual client flows · 3 measured layouts. Synthetic models/accounts and an unsigned installer candidate; real advertising spend, production signing and full-product acceptance remain unproven. Average daily budget is not a maximum daily charge; Google bills advertising separately.

[Design / 方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/113-controlled-advertising-budgets.md) · [Evidence / 证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/external-budget-checkpoint.json)

```mermaid
flowchart LR
  Login[Login and project authority] --> Policy[Explicit bounded budget policy]
  Policy --> Preview[Immutable exact preview]
  Preview --> Confirm[Customer confirmation or authorized policy]
  Confirm --> Admission[Revalidate and persist dispatch]
  Admission --> Once[One provider mutation]
  Once --> Receipt[Encrypted receipt and immutable events]
  Once --> Unknown[Unknown never resent]
  Unknown --> Review[Observe and manually close]
  Admin[Scoped Admin and current MFA] --> Policy
  Admin --> Review
```

![Actual scoped budget panel / 实际预算面板](assets/screenshots/workmate-budget-05-exact-confirmation-en.png)

![Actual interaction / 实际交互](assets/screenshots/workmate-05-controlled-budgets.gif)


<!-- responsive-report-stage112 -->
Website reports now use a dedicated wider dialog and intrinsic metric columns. Complete CTR, ranking and refund values remain readable on one line at the measured 375px Web and 800px Desktop sizes; scrolling remains available without Desktop rails.

16 actual client flows, five measured layout states and 11 build/package checks passed. The previous 195 backend/native checks are retained; this CSS increment does not claim they were rerun. Synthetic accounts/models and unsigned packaging.

[Evidence / 證據](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/report-layout-checkpoint.json)

![Actual readable search report / 實際搜尋報告](assets/screenshots/workmate-web-analysis-08-search-en.png)

![Actual interaction / 實際交互](assets/screenshots/workmate-08-website-analysis.gif)


<!-- website-analytics-stage111 -->
Website reports now connect captured GA4 traffic/events and Search Console data to exact metrics and complete HTML/CSV/JSON. Distinct users are never summed across rows, refund revenue can be negative, and missing dates remain unknown. Report calculation adds no AI call or fee.

Sign in, open Connections, authorize an account, confirm project scope, capture dates, inspect facts and open Website analysis & report. Submit filters before downloading.

122 backend checks · 53 Desktop unit checks · 20 actual native Codex checks · 11 actual client flows. Synthetic accounts/models; live provider quality, production signing and full-product acceptance remain unproven.

[方案 / Design](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/111-web-analytics.md) · [證據 / Evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/web-analytics-checkpoint.json)

```mermaid
flowchart LR
  Login[Login and project scope] --> Capture[Immutable GA4 or GSC snapshot]
  Capture --> Verify[Source hash and current authority]
  Verify --> Metrics[Exact captured-row calculation]
  Metrics --> Clients[Web and native Desktop report]
  Metrics --> Skill[Versioned marketing specialist]
  Metrics --> Files[Complete HTML CSV JSON]
  Admin[Admin source controls] --> Verify
```

![Actual website report / 實際網站報告](assets/screenshots/workmate-web-analysis-07-ga4-en.png)

![Actual report interaction / 實際報告交互](assets/screenshots/workmate-07-website-analysis.gif)


<!-- desktop-native-geo-stage110 -->
Desktop GEO now runs fixed questions with local Codex in independent empty sessions. Review the exact batch reservation, run or stop questions, recover original receipts, retain full answers and compare new immutable runs. All AI uses the company gateway; observed costs come from company receipts.

135 backend checks · 46 Desktop unit checks · 20 actual native Codex checks · 9 actual Electron flows · 11 build/type checks. Synthetic accounts and models; native answers are client reported. Live model quality, production signing and whole-product acceptance remain unproven.

[方案 / Design](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/110-desktop-native-geo.md) · [证据 / Evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-geo-checkpoint.json)

```mermaid
flowchart LR
  Review[Desktop review] --> Journal[Encrypted local journal]
  Journal --> API[Company API: atomic holds]
  API --> Local[Local Codex: fresh question thread]
  Local --> Gateway[Company Responses and cost receipt]
  Gateway --> Answer[Original answer and SHA-256]
  Review --> Stop[Stop or recover original receipt]
```

![Actual local GEO / 实际本机观测](https://raw.githubusercontent.com/copypasteltd/workmate/desktop/assets/screenshots/workmate-native-geo-05-prepared-en.png)

![Actual interaction / 实际交互](https://raw.githubusercontent.com/copypasteltd/workmate/desktop/assets/screenshots/workmate-05-native-geo.gif)


<!-- audio-accounting-stage109 -->

Unknown customer audio and platform verification fees now accept immutable original-operation evidence, separate independent cost and termination approvals, scoped read controls and exact frozen tariffs. Cost confirmation does not debit the customer or release capacity. Task settlement remains independently approved, occurs once within its original hold and preserves business failure.

Both confirmations permit an explicit new platform validation; the old POST, media result and verification receipt remain unchanged. Web, frameless Desktop and the native Chrome right Side Panel show human-evidence provenance. Existing Desktop local Codex/full permission and Extension cloud execution remain in force.

253 initial affected backend checks plus 65 follow-up audio/concurrency checks, nine Admin form/money checks, seven client compilation/build checks and eight actual Admin browser flows passed. Original failed runs are retained. Screenshots and GIF/MP4 below show actual Admin interactions with synthetic accounts/models/evidence. Native decoding is not live audio-quality qualification. Stage106 retains its unattributed full-run timeout and unchanged passing replay; this is not complete-product acceptance.

[Design / 方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/109-audio-evidence-accounting.md) · [MP4](assets/verification/audio-accounting-109/workmate-audio-accounting-08-audio-evidence-and-cost-preview.mp4)

![Actual immutable evidence / 实际不可变证据](assets/verification/audio-accounting-109/workmate-audio-accounting-08-platform-immutable-evidence-form-en.png)

![Original verification retained / 原验证保留](assets/verification/audio-accounting-109/workmate-audio-accounting-08-original-verification-accounted-unqualified-en.png)

![Actual evidence and preview / 实际证据及预览](assets/verification/audio-accounting-109/workmate-audio-accounting-08-audio-evidence-and-cost-preview.gif)


<!-- managed-audio-stage108 -->

Admin now manages immutable speech and transcription model releases: fixed voices/locales and exact rates, durable platform-funded protocol checks, actual background progress, stop controls, independent publication and historical rollback. Existing customer work retains its original model and rates; customer audio authorization remains separate.

229 affected backend checks, six Admin form/money checks and eight actual browser flows passed. A real crashed processor after POST retains the original unknown operation without resubmission. Actual Admin screenshots and GIF/MP4 below show this shared control flow; previous client-specific captures retain their original scope. Models/accounts and audio replies are explicitly synthetic.

The build now bundles its original audio reference files and license. The compiled verifier loads and fully decodes both formats from an unrelated working directory; the original missing-file failure is retained.

Native decoding and timestamp structure do not qualify voice, transcription accuracy or Cantonese quality. Unknown audio costs still require external evidence. Stage106 retains its one unattributed full-run timeout and the passing unchanged two-case replay; this increment is the affected regression, not a new complete-product acceptance.

[Design / 方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/108-managed-audio-capabilities.md) · [MP4](assets/verification/managed-audio-108/workmate-managed-audio-01-audio-configuration-and-background-resume.mp4)

![Actual Admin speech verification / 实际后台语音验证](assets/verification/managed-audio-108/workmate-managed-audio-01-speech-completed-en.png)

![Actual transcription formats / 实际转录格式](assets/verification/managed-audio-108/workmate-managed-audio-01-transcription-formats-and-timestamps-en.png)

![Actual background continuation / 实际后台继续执行](assets/verification/managed-audio-108/workmate-managed-audio-01-audio-configuration-and-background-resume.gif)


<!-- capability-inventory-stage107 -->

Video, speech and transcription now use their exact implemented protocols and independent verification flags in the customer capability inventory. Changed availability expires the signed page cursor. Revoked versions, mismatched protocols, tenant scope and task execution authorization remain checked.

The repaired capability suites passed 68 actual checks. The original failing reproduction is retained. The Stage106 complete backend attempt and its unchanged-source runtime replay are retained, including one unattributed timeout in the full attempt. This increment reruns the affected capability suites. Models/accounts remain synthetic, with no live professional-quality claim.

Reproduce in Delivery: `node scripts/run-capability-inventory.mjs <new-two-digit-attempt> core`. The customer API correction adds no page. Screenshots and GIF/MP4 below retain their actual Stage106 recording and source scope.

[Design / 方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/107-profile-specific-capability-inventory.md)


<!-- platform-integration-stage106 -->

Explicitly selected private file versions now remain usable by subsequent private tasks while unselected files stay isolated. Replaced/revoked inputs still stop execution. Native cloud HTTP checks wait for actual application readiness before starting each request deadline. Web clears a private workflow confirmation after a denied read or source withdrawal.

Desktop strict tool admission now matches the pinned native schema compaction and preserved array constraints; altered or duplicate declarations remain denied. The actual local native request carries all 23 media tools plus browser/program namespaces.

The complete 97-file backend run executed 1230 tests: 1,229 passed and one existing continuation test timed out/cancelled. Both checks in that unchanged runtime file passed independently; the timeout cause remains unattributed. Eleven actual client journeys, 15 screenshots and five GIF/MP4 pairs are retained. Models/accounts are synthetic; Codex, native execution and database operations are actual. Historical failures and exact source copies are retained. Desktop remains customer-local Codex; Extension retains its native right Side Panel and authorized uploads.

Reproduce from the Delivery checkout: `node scripts/run-platform-integration.mjs <new-two-digit-attempt> full`, then `node scripts/run-workflow-view-ui.mjs <new-two-digit-attempt>`. Prepare the pinned Desktop runtime first with `npm run runtime:prepare` in Desktop. The complete runner checks the binary hash and observed version, sets all four native/cloud test variables and owns its native PostgreSQL. Every attempt retains its original evidence.

[Design / 方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/106-selected-inputs-and-runtime-readiness.md)

![Actual recovered private workflow](assets/screenshots/integration-workmate-workflow-view-03-workflow-recovered-fresh-consent-en.png)

![Actual private workflow source withdrawal](assets/screenshots/integration-workmate-workflow-view-03-workflow-view-withdrawal.gif)

[Actual interaction MP4](assets/screenshots/integration-workmate-workflow-view-03-workflow-view-withdrawal.mp4)


<!-- live-private-views-stage105 -->

Web now clears an already-open private schedule review, editor, action or history when an authoritative read loses access or removes the source. Normal polling preserves readable drafts and exact version confirmation; a recovered read does not reopen discarded private content. Pending immutable requests refresh readiness and expiry.

Nine actual cross-client journeys passed, including a real source quarantine without page reload and an explicitly simulated denied HTTP403 read. Eleven screenshots and four GIF/MP4 pairs are retained. The unchanged backend retains its 78-check baseline; those tests were not rerun. Synthetic model/accounts; no new Desktop qualification. Desktop remains customer-local Codex and Extension remains the native right cloud Side Panel with authorized file upload.

[Design / 方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/105-live-private-schedule-views.md)

![Actual Web private history](assets/screenshots/live-views-workmate-private-view-03-history-before-withdrawal-zh.png)

![Actual Web source withdrawal, without reload](assets/screenshots/live-views-workmate-private-view-03-private-view-withdrawal.gif)

[Actual Web interaction MP4](assets/screenshots/live-views-workmate-private-view-03-private-view-withdrawal.mp4)


<!-- cloud-schedules-stage104 -->

Private cloud schedules now connect consultant conversation or an existing private result to explicit customer review and daily/weekly execution. Review the fixed method, inputs, time zone, outputs and per-run Agent budget → check consent → activate → inspect each independent run, human review point, private deliverable and actual charges. Web and the real Chrome right Side Panel provide confirmation and pause; Admin lists scoped metadata and can pause future times after recent MFA and a recorded reason.

Pause preserves current work; cancel a current run separately. Resumption is confirmed by the customer and skips the paused interval. Editing creates a new pending request and immutable version. Failed or unknown paid work blocks future launches for review. Fixed inputs do not automatically refresh external account data, and activation does not precharge all future runs. Desktop continues running customer-local Codex; its native credentials cannot activate cloud replacement work.

Verified: 78 checks across six related backend suites, eight actual cross-client journeys, eight unedited PNGs and three actual GIF/MP4 pairs, using native PostgreSQL, pinned native Codex, real email/MFA/PKCE and explicitly synthetic model/account data. This scoped increment does not establish live model quality or complete product acceptance.

[Design / 方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/104-private-cloud-schedules.md) · [Exact evidence / 确切证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/private-cloud-schedules-checkpoint.json)

```mermaid
flowchart LR
 A[Private conversation or result] --> B[Pending fixed-method request]
 B --> C[Customer reviews and confirms]
 C --> D[Durable calendar]
 D --> E[Independent private run]
 E --> F[Human review and actual settlement]
 C --> G[Pause future times]
 G --> H[Customer confirms resume]
 H --> D
```

![Actual copypaste-web cloud schedule / 实际云端计划](assets/screenshots/schedule-copypaste-web-workmate-cloud-schedule-06-active-en.png)

![Actual confirmation or pause / 实际确认或暂停](assets/screenshots/schedule-copypaste-web-workmate-cloud-schedule-06-cloud-schedule-confirm.gif)

[Actual interaction MP4](assets/screenshots/schedule-copypaste-web-workmate-cloud-schedule-06-cloud-schedule-confirm.mp4)


<!-- admin-data-stage103 -->

Admin now processes persistent account batches and frozen directory, usage, billing and audit exports. Select targets/filters → review exact records, versions and projected fields → explicitly confirm → follow each item → retry only failed targets in a reviewed child or download authorized CSV/manifest. Cancellation preserves committed effects. Existing billing/VIP approval history remains available.

Limits: 100 accounts per batch, 10,000 export rows; oversize selections are rejected. Every item and download rechecks live permissions, explicit denies, recent MFA, versions and field visibility. Previews expire after 5 minutes; encrypted job payloads after 15. Three bounded automatic attempts apply only to transient DB errors.

Verified with native PostgreSQL and actual Admin email/TOTP: 94 checks across six backend suites, seven browser journeys, six unedited PNGs and two actual GIF/MP4 recordings. Synthetic accounts, zero model calls. Customer-local Codex Desktop and native right Chrome Side Panel retain their existing execution model; this increment does not newly qualify those clients or the whole product.

[Design / 方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/103-persistent-admin-data-jobs.md) · [Exact evidence / 确切证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/admin-data-jobs-checkpoint.json)

```mermaid
flowchart LR
 A[Select accounts or export criteria] --> B[Freeze and review]
 B --> C[Confirm persistent job]
 C --> D[Atomic item outcomes]
 D --> E[Failed-only child preview]
 E --> B
 D --> F[Recheck permission and download]
```

![Actual Admin export / 实际后台导出](assets/screenshots/admin-workmate-admin-data-03-export-ready-en.png)

![Actual batch and retry / 实际批量与重试](assets/screenshots/admin-workmate-03-admin-data-batch.gif)

[Actual interaction MP4](assets/screenshots/admin-workmate-03-admin-data-batch.mp4)


<!-- client-content-stage102 -->

The Web workspace displays effective guidance and configured optional menu labels/order.

Usage: sign in to Admin → Catalog → Client content; edit both languages, schedules and existing optional menus; select clients, directory recipients and a stable percentage cohort; save a draft, preview the selected recipient and confirm. Unselected customers keep the exact baseline. Rollback previews a previously published release and appends a new publication. Account, VIP, billing, role and Skill permissions still control execution.

Verified: 79 related backend checks in five suites, seven actual client journey checks, eight unedited screenshots and four real GIF/MP4 recordings. Native PostgreSQL, real email/MFA/PKCE sessions and an unsigned packaged Desktop were used. Accounts/copy are synthetic; this increment makes zero model calls and does not establish live professional quality or complete product acceptance.

[Design / 方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/102-client-content-releases.md) · [Exact evidence / 确切证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/client-content-checkpoint.json).

```mermaid
flowchart LR
 A[Bilingual draft] --> B[Recipient preview]
 B --> C[Live authority and MFA check]
 C --> D[Append publication]
 D --> E[Selected: release]
 D --> F[Others: frozen baseline]
 D --> G[Historical rollback preview]
 G --> B
```

![Actual web content](assets/screenshots/web-workmate-client-content-06-pilot-en.png)

[Actual web MP4](assets/screenshots/web-workmate-06-client-content-workspace.mp4)

![Actual web interaction](assets/screenshots/web-workmate-06-client-content-workspace.gif)


<!-- cloud-browser-stage101 -->

Cloud Codex now performs actual page interactions and DOM checks with a pinned native Chromium runtime, retaining a real screenshot and exact source. Web task details lazily display the actual page screenshot, assertions and source versions with image/source downloads.

Usage: sign in, select an authorized software role and approve a cloud task/budget. Codex writes an HTML entry and local assets, executes named page checks, repairs failures and repeats. Expand Software checks to see the actual PNG and expected/actual values; download execution files or the matching source package. Four additive Skill packages and six role versions preserve historical approved bindings and do not expand permissions.

Verified: 113 checks in fourteen related suites and four authenticated Web journey checks; actual Codex, browser and downloads, synthetic provider responses and credit. Static task preview and independent API/SQLite checks do not establish a combined deployed application, arbitrary npm/framework support, live professional quality or complete product acceptance. Chromium policy restrictions are separate from an OS-wide no-network guarantee. Earlier notes below keep their historical scope.

[Evidence / 证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/cloud-browser-checkpoint.json) · [Design, setup and limits / 方案、安装与边界](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/101-cloud-browser-preview.md).

```mermaid
flowchart LR
 A[Authorized cloud task] --> B[Codex writes exact source]
 B --> C[Native Chromium actions and assertions]
 C --> D[Actual PNG and version-bound receipt]
 D --> E[Scoped UI and downloads]
 B --> F[Repair failed source]
 F --> C
```

![Actual Web browser checks / 实际 Web 页面检查](assets/screenshots/workmate-cloud-browser-01-checks-en.png)

![Actual Web browser checks / 实际 Web 页面检查](assets/screenshots/workmate-cloud-browser-01-compact-zh.png)

![Actual Web interaction / 实际 Web 交互](assets/screenshots/workmate-01-cloud-browser.gif)

[Actual interaction MP4 / 实际交互录像](assets/screenshots/workmate-01-cloud-browser.mp4)

<!-- cloud-development-stage100 -->

Cloud Codex can now run actual HTTP application requests and native SQLite data/constraint checks. Exact-source receipts retain failures, mark results stale after source changes, and accompany matching code packages. Web task pages show passed, failed and stale checks, expandable output and exact-version downloads.

Usage: approve an eligible cloud task and its budget, let Codex write and check the code, inspect Software checks, expand output, then download execution files or the full record. The Windows-only native boundary has no network or child processes; external TCP/TLS endpoints, PostgreSQL/MySQL compatibility, arbitrary npm dependencies and cloud browser preview remain outside this scope.

Earlier implementation notes below retain their historical validation scope; this section describes the current change.

Verified: 96 related checks across eleven suites and four actual authenticated Web journey checks. Synthetic provider responses and credit; actual Codex, native execution and downloads. [Evidence / 证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/cloud-development-checkpoint.json) · [Design and limits / 方案与边界](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/100-cloud-development-checks.md).

```mermaid
flowchart LR
 A[Authorized cloud task] --> B[Codex writes exact source]
 B --> C[HTTP API / SQLite checks]
 C --> D[Source-bound receipt and files]
 D --> E[Task UI and matching code package]
```

![Actual Web software checks / 实际 Web 软件检查](assets/screenshots/workmate-cloud-development-06-checks-en.png)

![Actual Web software checks / 实际 Web 软件检查](assets/screenshots/workmate-cloud-development-06-compact-zh.png)

![Actual Web interaction / 实际 Web 交互](assets/screenshots/workmate-06-cloud-development.gif)

[Actual interaction MP4 / 实际交互录像](assets/screenshots/workmate-06-cloud-development.mp4)

<!-- cloud-program-stage99 -->

Cloud Codex can now run actual pinned Node programs, built-in tests and syntax checks. Exact-source receipts retain failures, mark results stale after source changes, and accompany matching code packages. Web task pages show passed, failed and stale checks, expandable output and exact-version downloads.

Usage: approve an eligible cloud task and its budget, let Codex write and check the code, inspect Software checks, expand output, then download execution files or the full record. The Windows-only native boundary has no network or child processes; arbitrary npm dependencies and the other three cloud development tools remain unavailable.

Verified: 83 related checks across ten suites and four actual authenticated Web journey checks. Synthetic provider responses and credit; actual Codex, native execution and downloads. [Evidence / 证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/cloud-program-checkpoint.json) · [Design and limits / 方案与边界](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/99-cloud-program-execution.md).

```mermaid
flowchart LR
 A[Authorized cloud task] --> B[Codex writes exact source]
 B --> C[Native Node check]
 C --> D[Source-bound receipt and files]
 D --> E[Task UI and matching code package]
```

![Actual Web software checks / 实际 Web 软件检查](assets/screenshots/workmate-cloud-program-03-checks-en.png)

![Actual Web software checks / 实际 Web 软件检查](assets/screenshots/workmate-cloud-program-03-compact-zh.png)

![Actual Web interaction / 实际 Web 交互](assets/screenshots/workmate-03-cloud-program.gif)

[Actual interaction MP4 / 实际交互录像](assets/screenshots/workmate-03-cloud-program.mp4)

<!-- preset-specialists-stage98 -->

Saved specialists now start local Codex from Desktop. Select a preset, lasting instructions and an exact project brand revision, save it after a free check, then choose a local folder, grant permissions and approve each turn budget. Web and Extension keep cloud execution. Later brand publications and specialist edits do not silently replace an existing native session’s saved version.

Verified: 212 related integration checks, 51 Desktop unit checks, two actual local Codex protocol probes and seven packaged Desktop / authenticated Web journey checks. [Current evidence / 当前证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/preset-specialists-checkpoint.json).

![Actual Web fixed brand / 实际 Web 固定品牌](assets/screenshots/workmate-preset-specialists-01-brand-en.png)

<!-- native-methods-stage97 -->

## Native Desktop method trials

Desktop prepares a complete pinned method as local tasks, then runs, stops, reconciles, accepts and publishes those tasks using the customer's local Codex. Select a fresh session, folder and native permission for every specialist, preview approved inputs, and explicitly approve the private brief and total budget. Preparation reserves the exact batch once. Each task starts only on a customer action. The server rejects Desktop-to-cloud trial fallback.

Uncertain admissions reuse the original encrypted journal request and key across renderer reload or application restart. Already executed work cannot silently restart. Acceptance requires every current successful delivery and required source-read fact. Installation copies method references only. Pre-upgrade native conversations retain their original company-tool version.

Isolated acceptance uses synthetic models, accounts and credit with actual local Codex processes, native files and company usage settlement. It does not establish real payment, live provider quality, human native-dialog clicks, signed installers or complete product acceptance. Read the [execution, permission, recovery and data contract](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/97-native-method-trials.md).

```mermaid
flowchart LR
 A[Desktop sign-in and pinned method] --> B[Fresh local sessions and folder permissions]
 B --> C[Native preview and approved total budget]
 C --> D[Atomic batch reservation]
 D --> E[Start or stop each local Codex task]
 E --> F[Observed usage and exact delivery review]
 F --> G[Customer acceptance and publication]
```


Verified: 124 related integration checks, 49 Desktop unit checks, two actual local Codex protocol probes and six packaged Desktop journey checks. Earlier entries retain their historical validation scope. [Current evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/native-methods-checkpoint.json).

<!-- solution-packages-stage96 -->

## Versioned business methods

Stage 96 implements immutable business-method versions, free dependency previews, private paid trials, exact-delivery acceptance, publication and fresh cross-project rebinding. 122 related integration checks, 45 Desktop unit checks, two actual local Codex checks and eight actual browser checks pass. Model/account data remain explicitly synthetic; files, processes, authorization, accounting and audit execute normally.

1. Sign in, select a project and open Business methods. Save reusable instructions, preset roles, input labels and reporting requirements. This pins template, role, Codex profile and Skill versions; revisions require new trials and acceptance.
2. Select currently approved fixed files and reporting accounts. Preview missing requirements, snapshots, source hashes and task capacity free. Explicitly approve a private brief and total budget; each role gets an independent task in one atomic batch. Insufficient capacity rejects the complete batch.
3. Inspect every actual delivery before acceptance and publication. Browsing file or snapshot metadata cannot qualify required content; exact versions and hashes need separate actual content-read facts. Incomplete or unrelated trials, stale delivery hashes and revoked accounts cannot qualify a version. Unknown responses retain the same body and idempotency key across reload.
4. Installation copies a published method reference only. Source customer files, private briefs, results, memories, accounts and keys are not automatically copied. Upload target-project inputs, save revision-safe bindings and separately approve paid reuse.
5. Admin metadata, body reads and disablement use separate scoped permissions. Body access is audited; disablement requires recent MFA and a reason. Withdrawn methods, inputs and account authority fence dependent content.

```mermaid
flowchart LR
 A[Login and current project] --> B[Pinned method and role versions]
 B --> C[Fresh inputs and free preview]
 C --> D[Approve private brief and total budget]
 D --> E[Actual Codex tasks and measured usage]
 E --> F[Accept exact deliveries then publish]
 F --> G[Install reference in target project]
 G --> C
```

Desktop keeps local Codex with explicit local folder, permission and budget approval. Its generic bridge rejects cloud method-trial admission; exact installed methods are read-only company tools available only to compatible pinned native roles. The cloud default assistant is not a local role. Extension keeps a cloud agent, approved attachment upload and a native right side panel. These new captures show actual Web/Admin; new packaged Desktop method-library visuals are not qualified here. Earlier Desktop screenshots keep their historical scope.

[方案与使用 / Implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/96-versioned-business-solutions.md) · [Exact-source evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/solution-packages-checkpoint.json)

![Actual Web source and dependency preview / 实际 Web 资料预览](assets/screenshots/workmate-solution-packages-07-preview-en.png)

![Actual scoped Admin method control / 实际 Admin 方案管理](assets/screenshots/workmate-solution-packages-07-admin-metadata.png)

![Actual review, original request retry and acceptance / 实际审阅、原提交重试和验收](assets/screenshots/workmate-solution-packages-07-method-review-and-publish.gif)

[375px](assets/screenshots/workmate-solution-packages-07-responsive-375.png) · [Published method](assets/screenshots/workmate-solution-packages-07-published-en.png) · [Fresh target requirements](assets/screenshots/workmate-solution-packages-07-installed-missing.png) · [Audited body read](assets/screenshots/workmate-solution-packages-07-admin-body-audited.png) · [Review MP4](assets/screenshots/workmate-solution-packages-07-method-review-and-publish.mp4) · [Copy & rebind GIF](assets/screenshots/workmate-solution-packages-07-copy-rebind-and-trial.gif) · [Copy & rebind MP4](assets/screenshots/workmate-solution-packages-07-copy-rebind-and-trial.mp4)

<!-- media-effects-stage95 -->

## Earlier reviewed native media effects (stage 95)

Stage 95 connects ten versioned native effects: transitions, Chinese animated text, chroma key and cleanup. After reviewing exact source versions, parameters and budget, customers approve Codex to invoke native FFmpeg and deliver actual silent MP4, PNG, source JSON and ZIP. All 106 related regression cases and eight real browser checks pass, including two native Codex processes, eight private downloads and real accounting. Model responses and account capacity are explicitly synthetic.

1. Sign in, select a project and open Motion studio. Inspect ten actual procedural examples and upload authorized PNG/H.264 MP4 inputs through Assets. Choose fixed source versions and hashes.
2. Review output size, duration, text/filter settings and budget, then explicitly consent. Preflight checks actual media, licensed font layout and encoder availability before reserving funds. A lost network acknowledgement can replay the exact saved request and idempotency key after reload.
3. Preview and download the actual silent MP4, PNG, immutable source JSON and ZIP. A revision needs a new approval; completed repeats retain original files. Source withdrawal or output quarantine fences access and prevents automatic regeneration. Normal Codex usage is charged; native rendering adds no extra AI call or fee.
4. Role video-motion@1.5.0 loads media-effects@1.0.0; formal approval exposes only catalog and render tools. SQL110 freezes inputs and source lineage; SQL111 adds the receipt type. Published old migrations, contracts and Skills keep exact bytes. Admin can publish the effects navigation entry; disabled role/Skill admission is rejected before media inspection or budget holds. Existing asset controls apply.

```mermaid
flowchart LR
  A[Login and project] --> B[Approved fixed source versions]
  B --> C[Choose preset and review parameters and budget]
  C --> D[Free preflight and immutable approval]
  D --> E[One task and reservation]
  E --> F[Codex and bounded native FFmpeg]
  F --> G[Four actual private files]
  G --> H[Preview or separately approve revision]
```

Desktop remains local Codex with customer-controlled permission; Extension remains a cloud-agent native side panel. These captures show Web effects. The native Desktop disables this cloud-only review form; company effect tools remain versioned. Earlier source-wide qualification retains its original stage; this scoped regression is not a full product or live professional-quality acceptance.

[Implementation and usage](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/95-reviewed-media-effects.md) · [Exact-source evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/media-effects-checkpoint.json)

![Actual ten-preset directory / 实际十种特效目录](assets/screenshots/workmate-media-effects-05-directory-en.png)

![Actual private delivery / 实际私有交付](assets/screenshots/workmate-media-effects-05-first-delivery.png)

![Actual review and original request retry / 实际审阅与原请求重放](assets/screenshots/workmate-media-effects-05-effect-review-retry.gif)

[375px](assets/screenshots/workmate-media-effects-05-responsive-375.png) · [Reviewed input](assets/screenshots/workmate-media-effects-05-reviewed-en.png) · [Review MP4](assets/screenshots/workmate-media-effects-05-effect-review-retry.mp4) · [Actual revision GIF](assets/screenshots/workmate-media-effects-05-effect-delivery-revision.gif) · [Revision MP4](assets/screenshots/workmate-media-effects-05-effect-delivery-revision.mp4)

<!-- team-history-stage94 -->

## Earlier team history and pagination (stage 94)

Stage 94 completes independent team, version and private run pages and fixes newest-run ordering previously based on random UUIDs. History browsing preserves the draft, approval returns to the newest run, and a saved team outside the directory page remains selected. Withdrawn cursors and project switches fence stale bodies. All 18 team cases and 11 real browser checks pass, including three native Codex processes, private files and actual accounting with explicitly synthetic model/account capacity.

1. Select a project and team. Use Previous/Next teams to traverse the directory; saving and refreshing keep the current team even when it falls outside that page.
2. Browse fixed versions and private runs independently. Pages contain at most 20 versions or eight actual runs, newest first by creation time with an exact database tie-breaker. Draft fields survive page changes and polling.
3. Review and explicitly approve new work. Starting from an older page returns to the newest run; stopping releases known unused funds. History navigation creates no task, retry or charge.
4. Withdrawn/expired/private cursor anchors return 404 and clear stale run bodies. Changing user, tenant or project discards late responses. SQL109 only adds a history index and preserves published migrations, contracts and Skills.

```mermaid
flowchart LR
  A[Current project] --> B[Team directory pages]
  B --> C[Fresh selected team]
  C --> D[Independent version and private run pages]
  D --> E[Preserved customer draft]
  E --> F[Review and explicit approval]
  F --> G[Newest actual run and original accounting]
```

Desktop remains local Codex with customer-controlled permission; Extension remains a cloud-agent native side panel. These captures show Web cloud teams. Earlier source-wide qualification retains its original stage; this scoped regression is not a full product or live professional-quality acceptance.

[Implementation and usage](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/94-agent-group-history.md) · [Exact-source evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/agent-group-history-checkpoint.json)

![Actual independent history pages / 实际历史翻页](assets/screenshots/workmate-agent-group-history-02-history-pages.png)

![Actual saved team outside the page / 实际页外团队](assets/screenshots/workmate-agent-group-history-02-history-directory.png)

![Actual history, approval and selection / 实际翻页、批准与选择](assets/screenshots/workmate-agent-group-history-02-team-history.gif)

[375px](assets/screenshots/workmate-agent-group-history-02-history-responsive-375.png) · [Newest run](assets/screenshots/workmate-agent-group-history-02-history-newest.png) · [History MP4](assets/screenshots/workmate-agent-group-history-02-team-history.mp4) · [Actual Codex delivery GIF](assets/screenshots/workmate-agent-group-history-02-team-delivery.gif) · [Delivery MP4](assets/screenshots/workmate-agent-group-history-02-team-delivery.mp4)

<!-- agent-groups-stage93 -->

## Earlier persistent team implementation (stage 93)

Stage 93 implements persistent Web teams with a coordinator, distinct specialists, frozen versions, customer-reviewed briefs/dependencies/budgets, bounded actual Codex execution and unified delivery. All 115 relevant backend cases and seven actual browser checks pass. Model/account capacity is explicitly synthetic; authentication, native Codex processes, company tools, private files, budgets and accounting actually run.

1. Sign in and select a project. Create specialists in Your specialists, then save a coordinator and distinct members in Your teams. Team settings are project-shared; runs and files remain private to their customer.
2. Add the brief, step instructions, dependencies, individual caps and parallelism. Review the exact fixed member versions and full plan for free. Only the current customer can explicitly approve the budget and start.
3. Follow actual task links, member states, approved maximum, reserved funds and actual charges. The coordinator waits for all actual members to succeed, then reads their authorized outputs. Stop prevents new dispatch and preserves uncertain-cost reconciliation.
4. Team edits create immutable versions. A repeated request reuses its original run; a new execution needs a new review. Withdrawing a source blocks private derivatives. Admin body access, quarantine, restore and erasure retain independent scoped permissions and audit.

```mermaid
flowchart LR
  A[Saved team and fixed versions] --> B[Brief, steps and dependencies]
  B --> C[Free review and customer budget approval]
  C --> D[Bounded actual member tasks]
  D --> E[Coordinator reads completed results]
  E --> F[Private delivery and per-task accounting]
```

Apply **SQL108** after SQL001–107. A team has one coordinator and up to seven distinct members, with 1–16 acyclic steps and 1–3 concurrent member slots bounded by actual plan capacity. At least two active task slots are required. Reviews expire after 15 minutes; runs have a two-hour deadline. Only each actual task allocation is reserved; the displayed total is a maximum, not another charge. Existing single-task conversation admission remains enforced.

Desktop keeps local Codex and customer-controlled full permission, frameless windows and no native Electron menus. This new team interface is cloud Web work; it is hidden in native Desktop. Extension remains a ChatGPT-style native right Side Panel for authorized uploads and cloud conversations. These recordings do not establish new native team interfaces, professional role quality, live providers or full product acceptance.

[Implementation and API](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/93-persistent-agent-groups.md) · [Exact-source evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/agent-groups-checkpoint.json)

![Actual team plan / 实际团队计划](assets/screenshots/workmate-agent-groups-04-plan.png)

![Actual completed run / 实际完成状态](assets/screenshots/workmate-agent-groups-04-completed.png)

![Actual team creation and approval / 实际建立与批准](assets/screenshots/workmate-agent-groups-04-team-authoring.gif)

[375px](assets/screenshots/workmate-agent-groups-04-responsive-375.png) · [Delivery GIF](assets/screenshots/workmate-agent-groups-04-team-delivery.gif) · [Authoring MP4](assets/screenshots/workmate-agent-groups-04-team-authoring.mp4) · [Delivery MP4](assets/screenshots/workmate-agent-groups-04-team-delivery.mp4)

<!-- editable-design-stage92 -->

## Earlier editable design verification (stage 92)

Stage 92 connects actual brand-vector and presentation tools. Brand delivery includes editable and outlined SVG. Presentations include PPTX with native editable text, shapes, paths and evidence bars, plus per-page SVG/PNG, PDF/HTML reviews, exact evidence CSV, immutable source, manifest and a ZIP with the licensed font. Ninety-three relevant backend tests and eight actual browser checks pass. Codex, permissions, files and financial receipts are real; model/content are explicitly synthetic.

1. Create a brand/presentation specialist from the role directory, confirm the audience, exact copy, sources and brand, then explicitly select Execute and a budget. Ask/Plan cannot generate files.
2. Download actual editable files and the ZIP from Assets & deliverables. Presentations require slides_build followed by slides_render on the exact returned source version/hash; a prepared source is not delivered work.
3. Review all pages in the actual offline HTML or PDF. Request a correction against the saved source. New versions retain old files; retries reuse original tool receipts. Native rendering adds no AI charge.
4. Chart layers select actual deterministic evidence IDs, keeping currency/account/metric/attribution/date scopes separate. A brand-bound specialist must retain its exact brand version and authorized channel/locale; omission or replacement is rejected. Private source permissions and quarantine apply to every derivative.

```mermaid
flowchart LR
  A[Customer brief and fixed role] --> B[Authorized source versions]
  B --> C[Codex and design Skill]
  C --> D[Structured scene and validated layout]
  D --> E[Editable SVG or native-object PPTX]
  E --> F[Private downloads and page review]
  F --> G[Read source and create immutable revision]
```

Desktop keeps Codex on the customer computer. The 1.1.0 specialists expose these company file tools through the authenticated native bridge; source revision access additionally requires the same device, native sign-in family, local session and workspace. Another local session cannot read its private source. Backend checks exercise actual native authorization, schema admission, tool delivery and source revisions; the new recordings below show the Web workflow and downloaded source-based reviews, not a new Desktop UI recording.

Apply **SQL106** and **SQL107** after SQL001–105 and install the pinned dependencies. The second migration binds private design derivatives to exact sources without changing explicit publication authority. Brand/presentation roles and their production Skills are 1.1.0; the original 37 Skill packages remain byte-identical. The ZIP supplies checked CopyPaste Sans TC Regular/Bold static faces derived from Noto Sans TC under OFL, retaining the original variable font for provenance. Fonts are not embedded in PPTX. **PDF/PNG/HTML are fixed-source reviews, not PowerPoint renders**; inspect actual target-editor typography before publication. Charts are native editable bars/labels with exact CSV, not embedded Excel charts. Current brand-bound editable export requires Noto Sans TC; other licensed custom fonts use the existing brand layout renderer. Professional/customer role qualification remains unverified.

[Implementation and use](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/92-editable-brand-and-presentation.md) · [Source-bound checks](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/editable-design-checkpoint.json)

![Actual vector review / 实际矢量稿](assets/screenshots/workmate-editable-design-06-vector-review.png)

![Actual slide review / 实际演示核对](assets/screenshots/workmate-editable-design-06-slide-review-2.png)

![Actual 375px review / 实际窄屏核对](assets/screenshots/workmate-editable-design-06-review-375.png)

![Actual navigation and revision / 实际浏览与修改](assets/screenshots/workmate-editable-design-06-editable-design-review.gif)

[Work GIF](assets/screenshots/workmate-editable-design-06-editable-design-work.gif) · [Work MP4](assets/screenshots/workmate-editable-design-06-editable-design-work.mp4) · [Review MP4](assets/screenshots/workmate-editable-design-06-editable-design-review.mp4)

<!-- cloud-workflows-stage91 -->

## Earlier private cloud workflow verification (stage 91)

Stage 91 connects the workflow consultant to private cloud execution. Actual pinned Codex prepares an immutable procedure; the customer reviews its fixed steps and child budget before confirming execution, which pauses again at human approval steps. Fifty-five relevant backend cases and eight actual browser checks pass, including private downloads, single child reservations/settlements, versioned corrections, cancellation, source withdrawal and exact retries. Model replies/account data are synthetic; Codex, tools, database, files and UI interactions are real.

1. Select the workflow consultant and use Execute to prepare an authorized private procedure. Preparation has its own actual task bill.
2. Open Workflows, review the exact version, all steps and the separate total child budget, then explicitly check consent and confirm. No child task/reservation exists beforehand.
3. Download the calculated private summary, approve the next human review, and follow the actual child task, delivered file and cost receipt. Unknown usage blocks replacement execution.
4. Ask the same consultant for a correction. A new version/request keeps original versions and runs intact. Cancellation stops only this run; withdrawn sources block history/downloads.

```mermaid
flowchart LR
  A[Consultant and fixed Skills] --> B[Private version and pending request]
  B --> C[Customer reviews steps and budget]
  C --> D[Actual ordered execution]
  D --> E[Human approval when required]
  E --> F[Private files and original receipts]
  F --> G[New revision preserves old version]
```

Apply **SQL105** after SQL001–104. The consultant and its two fixed workflow Skills are 1.1.0. At most eight sequential authorized cloud-role, data-summary or human-review steps are supported; nested workflows, arbitrary cloud shell, external account writes and video child tasks are not enabled here. Desktop keeps its separate local Codex runtime.

[Implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/91-private-cloud-workflows.md) · [Source-bound evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/cloud-workflows-checkpoint.json)

![Actual pending workflow](assets/screenshots/workmate-cloud-workflow-04-pending-request.png)

![Actual narrow Traditional Chinese review](assets/screenshots/workmate-cloud-workflow-04-review-zh-375.png)

![Actual execution and revision](assets/screenshots/workmate-cloud-workflow-04-cloud-workflow-review.gif)

[Preparation GIF](assets/screenshots/workmate-cloud-workflow-04-cloud-workflow-prepare.gif) · [Preparation MP4](assets/screenshots/workmate-cloud-workflow-04-cloud-workflow-prepare.mp4) · [Review MP4](assets/screenshots/workmate-cloud-workflow-04-cloud-workflow-review.mp4)

<!-- analysis-roles-stage90 -->

## Earlier analysis and infographic verification (stage 90)

Stage 90 connects versioned marketing-analyst and information-design presets to deterministic calculation and nine real deliverable files. Sixty-eight relevant backend checks and eleven actual browser checks pass. Both roles use the real pinned Codex process and authorized company tools. Model replies and account data are explicitly synthetic; the program, database, PNG/ZIP bytes, downloads, private isolation, source fences and ledger operations are real. This does not replace the requirement for twelve professionally qualified roles or complete product acceptance.

1. Create the marketing analyst or information designer from the specialist directory. Existing specialists keep their old role/Skill versions.
2. Confirm the dates, currency, account, attribution and conversion definition. Choose actual imported data or upload CSV/XLSX to this private conversation; inspect the real worksheet and headers.
3. Select **Execute**, confirm the budget and delegate the work. Ask/Plan cannot write files. Download SVG, PNG, interactive HTML, metrics/source CSV, creative brief, editable JSON, manifest and ZIP.
4. Request a correction using the original source version. Recalculation creates new immutable files; prior versions remain available while their sources are authorized. Identical render retries reuse the original files. Rendering makes no extra AI request; text inference follows the task ledger.

```mermaid
flowchart LR
  A[Role and authorized sources] --> B[Exact calculation and evidence]
  B --> C[Codex and fixed Skills]
  C --> D[Private files and task receipt]
  D --> E[Read source and confirm revision]
  E --> B
```

Apply **SQL104** before starting the updated backend; SQL001–103 and all old Skill bytes remain intact.

[Design and implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/90-analysis-role-delivery.md) · [Exact evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/analysis-roles-checkpoint.json)

![Actual desktop report](assets/screenshots/workmate-analysis-04-report-en-desktop.png)

![Actual Traditional Chinese mobile report](assets/screenshots/workmate-analysis-04-report-zh-375.png)

![Actual report interaction](assets/screenshots/workmate-analysis-04-analysis-report-review.gif)

[Creation and download GIF](assets/screenshots/workmate-analysis-04-analysis-role-work.gif) · [MP4](assets/screenshots/workmate-analysis-04-analysis-role-work.mp4) · [Report MP4](assets/screenshots/workmate-analysis-04-analysis-report-review.mp4)

<!-- work-intake-stage89 -->

Select specialists and use cloud Codex in a browser, with projects, references, tasks and deliverables.

## Earlier first-work verification (stage 89)

Stage 89 verifies Web first-work onboarding, design/analysis/development shortcuts and actor/tenant/project scoped tab drafts. Fourteen actual browser checks and 195 client unit tests pass, including offline handling, expired-session reauthentication, committed response loss, exact retries, receipts, late responses and removed results. Real Worker delivery/download bytes agree; the original request has one task, one reservation and a 30-micro-HKD settlement. Reply content is explicitly synthetic; this UI fixture does not launch native Codex. The full login/client matrix, twelve qualified professional roles, all 102 complete conditions and G01–G10 remain open.

Select a role, edit the brief and confirm the budget. Drafts survive modal closure/reload and same-account reauthentication in this tab. Explicit sign-out clears text. While a submission is unknown, retry the original request; review the accepted receipt before explicitly starting another task. New work waits for authorized projects to finish loading. Browser/tab loss and full ongoing-conversation recovery remain unqualified.

## Product and boundaries

The first customers are existing marketing teams. Scope includes image/design/typography, video/effects, advertising and website analysis, SEO/GEO, repeated business processes and software development. The catalog has 18 candidates with exact Skill bindings; at least twelve individually qualified professional presets remain an acceptance requirement. The designer combines Codex, design Skills and company Image 2. Codex is the only Agent core. All AI uses the company's OpenAI-compatible backend; development currently uses authorized synthetic providers, not a claim of live professional quality.

React, TypeScript, Vite and React Router provide the cloud workspace. New users create a company or accept an invitation, select a project and available specialist, and provide explicit inputs. Missing dependencies request customer input and continuation keeps the original task. Project pages save, preview and publish guidance with exact brand/reference versions; histories retain versions, sources and costs without silently adopting later defaults.

## Setup

### Local startup

Run these commands in the checked-out component. The complete workspace has the six independent repositories side by side under `dev/`; see the [branch and checkout layout](https://github.com/copypasteltd/workmate/blob/docs/docs/governance/04-git-branches-and-publication.md). Use Windows x64, Node.js >=22.14, npm/Git and the documented native PostgreSQL, FFmpeg/FFprobe and pinned Codex resources. Preserve existing local configuration/data. No Docker/WSL/VM is used.

```powershell
Set-Location 'D:/dev/copypasted/自有agent/dev/copypaste-web'
npm ci
npm run dev
```

Start the backend first, then open `http://localhost:4317`. Use `npm run build` for the static build. Sign in with email/OTP and select a workspace/project.

### Use the current workflow

1. Complete sign-in, company membership/invitation and project selection. Native clients use browser PKCE; Admin uses separate MFA identities. Expired/revoked credentials must not silently change identity or company.
2. Select a specialist and supply the brief and explicitly authorized references/accounts. Missing inputs request customer action. Project owners can save, preview and explicitly publish immutable shared guidance; publication starts no AI and grants no new permission.
3. New tasks pin their accepted role, Skill, brand, reference and guidance versions. Existing work, including an originally absent configuration, retains its original state. Source revocation hides unavailable bodies and blocks later use; history is not a permission bypass.
4. Confirm budget and any required operation/media approval. View genuine status, progress, exact deliverables and original receipts. Continue requested edits in the same task lineage. Unknown usage remains reserved for reconciliation; it is never silently free or blindly replayed.
5. Admin can independently manage authorized user/workspace status, inspect permitted consumption, preview/confirm manual fees or credits and activate scoped VIP/expiry. Balances, recorded payments, credits, budgets and VIP are separate records. Idempotent confirmation and audit prevent duplicate grants.

## Customer-local programs and browser resources

Sign in and select company/project → create a local session → explicitly grant full local permission → open **Local programs** → choose an actual executable and confirm the native dialog, which defaults to Cancel → request work in Conversation → inspect exact arguments, actual output, PID/exit code and the original task bill. Cancelling or declining grants nothing. Approvals pin file identity and SHA-256; the Agent supplies a program ID and argument array, not a replacement shell/environment.

Stopping the original task or revoking the program ends its owned native process tree. Program revocation leaves the separate customer full-access grant intact. Success, failure, cancellation and unknown outcomes remain distinct; an original call ID never replays. After restart, uncertain records remain unknown. Customer review only permits future calls, never rewrites the old record as success. Approved programs run with the customer's OS-user rights, not an additional workspace OS sandbox; Admin/cloud cannot approve on their behalf.

The Windows x64 native Job Object guardian does not pass company inference credentials to programs. Limits are two active programs per executor, 100 approval/200 run records, at most 64 arguments and 120 seconds per invocation, and 32 KiB retained per stdout/stderr with explicit truncation. New sessions pin the program tool version; legacy tool sets remain unchanged. Normal browser opens and popups share three pages per task/two active contexts per executor. A third context is denied without evicting another task; reuse clears cookies/localStorage.

## Customer-local folder work

In Desktop, choose a writable local session and open **Folder work**. Select an input folder inside the workspace and configure extensions, instructions, a quiet period, per-file/total limits and maximum runs. Existing files are excluded unless selected. Saving creates a **paused** rule; **Confirm and activate** opens a separate native automatic-spend confirmation that defaults to Cancel.

Stable native file events and bounded scans feed a persistent serial queue. Each job gets an exact snapshot, separate output directory, original task ID and company cost receipt. An unanswered native question is visible from Folder work; **Answer questions** returns to Conversation and requires the customer's explicit answer. Identical already-processed bytes and product outputs do not create another paid task. Unstarted old versions coalesce to the latest stable input.

Pause stops new dispatch and lets the current file finish. Revoke stops only that rule's owned work while keeping outputs/receipts. App closure stops watching; a real reopen retains the encrypted journal and allocated limits but requires fresh confirmation. Lost replies reuse original dispatch/create/start/finish keys; uncertain native actions block for review. Full OS permission remains the customer's grant, not an additional folder sandbox. Web/Extension keep cloud execution; folder work is a Desktop capability.

Limits: 20 rules; 1,000 history/200 queued items per rule; 1,000 dispatch receipts per session; 2,000 matching files/10,000 entries/12 levels per scan; 20 MiB per file and 64 MiB new reads per scan; at most 100 authorized runs, one scheduled job at a time. Limits do not reset on pause/restart. Outputs are under `.copypaste-local-jobs/<rule>/<job>/output/`. Symlinks/junctions, traversal, outside input, source replacement and conflicts block automatic work. See approved programs above; complete application-operation and crash/sleep/offline matrices remain open.

## Configuration, UI and verification

Apply SQL105 before starting the updated backend. Private workflow listing and customer decisions are additive routes; SQL001–104 and 532 historical contracts remain byte-preserved. Set company gateways, exact model aliases, verified media capabilities and tariffs on the backend; consult its `.env.example` and the deployment runbook. Never embed company provider keys in a renderer/extension. Unconfigured capability is unavailable rather than silently redirected. Ordinary demo data does not activate every media fixture.

CopyPaste blue/cream, Manrope/Fraunces, English/Traditional Chinese and light/dark themes remain. Desktop has no Electron frame/menu or visible scrollbar rails. Real wheel/focus/last-action access and truthful progress remain. The narrow session guidance card separates its icon/version from the readable name. Focused page Home/End and Ctrl+Home/End act on that page; focused text fields keep caret navigation.

Historical stage 88 verified approved pinned customer-local programs, structured argv, owned native process lifecycle/parent loss and original billing; one browser ledger enforces three pages per task/two active contexts with actual destruction and cleared storage on reuse. Fresh scopes: 68 packaged Desktop checks, 114 Desktop unit cases, 18 native Codex cases, 184 client cases, 91 related backend cases and six strict-declaration cases. Synthetic providers/dialog decisions remain explicit. Full product acceptance, twelve qualified professional roles and G01–G10 remain open. All prior 57 Desktop checks, 91 unit and 17 native cases remain. Folder work still checks a real new-PID restart, pinned original thread/versions and separately settled 90/60-micro-HKD tasks. All 14 runtime assets/licenses remain exact and repository recordings stay outside ASAR.

Historical stage-86 platform/core/compatibility suites were not rerun. Stage-88 packaged Desktop and native Codex results remain historical; Desktop, Admin, Extension and backend product sources are unchanged. Web and delivery now have separate stage-89 checks. Synthetic content does not qualify professional quality. Owned browser/API/previews/test databases are closed; no virtualization.

The original 102 requirements remain **86 partial / 16 unproven / 0 fully accepted**. REQ-040/042 gain bounded evidence without closing their original conditions. At least twelve professional-role qualifications, complete Admin breadth, teams/solution packages, full marketing workflows, live quality, signed installation/update/uninstall, load/restore exercises and G01–G10 remain open. Test counts are not a product-completion percentage. See the complete numbered gap assessment.


[Plan and limits](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/87-desktop-folder-work.md) · [Current-source checkpoint](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/folder-work-checkpoint.json) · [Complete numbered gaps](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/2026-10-25-goal-gap-assessment.md) · [Branch/checkout and publication](https://github.com/copypasteltd/workmate/blob/docs/docs/governance/04-git-branches-and-publication.md)

[Role catalog](https://github.com/copypasteltd/workmate/blob/backend/catalog/role-preset-catalog.json) · [Skill packages](https://github.com/copypasteltd/workmate/blob/backend/catalog/skill-packages.json)

## Architecture

```mermaid
flowchart TD
  Login[Sign in and select company/project] --> Role[Available specialist and exact Skill version]
  Role --> Cloud[Web / native Side Panel: cloud Codex]
  Role --> Local[Frameless Desktop: customer-local Codex]
  Files[Explicit private attachment selection] --> Cloud
  Local --> Grant[Customer OS grant / local files and tools]
  Local --> Programs[Customer-pinned program and structured argv]
  Programs --> Process[Owned native Job Object and exact receipt]
  Local --> Rules[Paused folder rule / explicit spend confirmation]
  Rules --> Queue[Stable snapshot / persistent serial queue]
  Queue --> Local
  Cloud --> Company[Company OpenAI-compatible API]
  Local --> Company
  Company --> Ledger[Original task / usage / unknown-cost hold]
  Admin[Separate Admin MFA and scoped permissions] --> Governance[Users / content / fees / VIP / audit]
```

Retained stage-86 media for unchanged product sources; this stage adds no fresh Web/Admin/Side Panel UI qualification.

![Actual full window](assets/screenshots/workmate-guidance-14-publication-preview-en.png)

![Actual compact window](assets/screenshots/workmate-guidance-14-unavailable-reference-en.png)

[Original MP4](assets/screenshots/workmate-guidance-14-project-guidance.mp4)

![Actual interaction](assets/screenshots/workmate-guidance-14-project-guidance.gif)

[Local program plan](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/88-approved-local-programs.md) · [Stage 88 checkpoint](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/local-programs-checkpoint.json)


## Actual stage-89 interactions

[Implementation and limits](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/89-first-work-and-submission-recovery.md) · [Stage 89 checkpoint](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/work-intake-checkpoint.json)

```mermaid
flowchart LR
  Login[Email sign in] --> Scope[Authorized project]
  Scope --> Draft[Role and saved brief]
  Draft --> Send[Original request identity]
  Send -->|Unknown| Retry[Explicit exact retry]
  Retry --> Send
  Send --> Receipt[Original work receipt]
  Receipt --> File[Review and download]
```

![Actual Web interaction](assets/screenshots/workmate-intake-05-restored-brief.png)

![Actual Web interaction](assets/screenshots/workmate-intake-05-actual-output-download.png)

![Actual Web interaction](assets/screenshots/workmate-intake-05-layout-800x600-zh-HK.png)

[MP4: first-work](assets/screenshots/workmate-intake-05-first-work.mp4)

![first-work](assets/screenshots/workmate-intake-05-first-work.gif)

[MP4: submission-recovery](assets/screenshots/workmate-intake-05-submission-recovery.mp4)

![submission-recovery](assets/screenshots/workmate-intake-05-submission-recovery.gif)
