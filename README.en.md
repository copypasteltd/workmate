# CopyPaste Admin Dashboard

[简体中文](README.md) · Independent operations console · 0.5.0

An independent Git repository and admin client with separate identity, cookies and entry point from customer Web. It manages customers, workspaces, consumption, funding, VIP, content, execution, access and published product configuration. It shares CopyPaste branding, Traditional Chinese/English and light/dark themes. The platform enforces all authorization, auditing and transactions.

![Operations overview](assets/screenshots/01-overview.png)

## Run

Requires Node.js 22.14+ and a running platform/database. Enroll an administrator and import TOTP using the platform CLI:

```powershell
# Run in the platform checkout
npm run admin:create -- admin@your-company.example super_admin
```

Then in this repository:

```powershell
npm ci
npm run dev
npm run typecheck
npm run build
```

Visit `http://localhost:4318`. Deploy `dist/` with HTTPS, an exact Admin origin and `/v1` reverse proxy; keep SPA fallbacks separate from API responses. Optional public `VITE_API_BASE` is in `.env.example`. Never embed AI/database secrets. Docker, WSL and virtualization are prohibited.

Every admin login requires email OTP and TOTP. Sensitive writes require MFA in the last 10 minutes; sign in again when it expires. Development codes are in the platform's local mailbox. There is no shared default administrator.

## Sixteen pages

| Page        | Implementation                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| Overview    | Separately authorized workspace/user/usage/reservation/reconciliation summaries                               |
| Users       | Database pagination/search, contact permissions, profile, memberships, consumption, status/session operations |
| Workspaces  | Status, member count and separately authorized financial fields                                               |
| Usage       | User/workspace/project-scoped task, token and charge aggregates                                               |
| Billing     | Personal/workspace accounts, original ledger and canonical fee previews/reviews; full payment/refund contracts pending                    |
| VIP         | Personal/workspace grants, actual start/end times, suspend/resume/extend/revoke                               |
| Content     | Unified metadata, separate body/download permissions, quarantine/restore and version checks                   |
| Execution   | Status, cancellation, reconciliation and eligible child-task retries                                          |
| Catalog     | Installed role/Skill enablement and presentation, versioned help/announcements/navigation                     |
| Connections | Connected provider scope and revocation                                                                       |
| Access      | Eight roles, 68 permissions, bounded custom roles, scoped/expiring bindings and revocation                    |
| Support     | Time-limited support-session metadata; no silent impersonation                                                |
| Audit       | Attributable operations, outcomes and timestamps                                                              |
| Jobs        | Preview/commit user-status batches and restricted CSV exports                                                 |
| Plans       | Versioned capabilities/roles/concurrency/task-budget policies                                                 |
| Policy      | Versioned approval thresholds and maximum VIP duration                                                        |

![Customer detail](assets/screenshots/02-user-detail.png)
![Financial ledger](assets/screenshots/01-billing.png)
![Access management](assets/screenshots/01-access.png)

## Administrator identity lifecycle

Version 0.3.0 adds Access-page invitations with an optional initial role, scope, amount/duration/batch limits and expiry. Account creation and initial delegation are atomic. Every delegated permission and limit must fit the inviter's current grants. Only the recipient receives the invitation link. Enrolled accounts without business permissions see an access-assignment waiting screen.

```mermaid
flowchart LR
  Bootstrap[Trusted first-admin CLI] --> Invite[Invite and bounded initial role]
  Invite --> Mail[Recipient-only email link]
  Mail --> OTP[Recipient verifies email]
  OTP --> MFA[Recipient confirms new authenticator]
  MFA --> Session[Independent admin session]
  Session --> Scope[Scoped dashboard access]
  Scope --> Control[Suspend / reset / revoke]
  Control --> Fresh[Old sessions invalidated]
```

The page removes the URL fragment immediately and keeps the invitation only in component memory. Email codes and MFA setups expire, limit attempts and have one consumer. New keys are returned only to the verified person. Account detail contains safe session metadata, roles/scopes, MFA and mail status. Resending invalidates the previous link/setup; failed delivery is shown explicitly. Resuming never revives old sessions.

Sidebar authenticator settings require a recent admin sign-in and fresh email proof. The old key remains valid until the new TOTP is confirmed; success revokes old sessions and creates a current session. Account status, another administrator's MFA reset and session revocation require the matching permission, expected version and reason. Self-reset/self-suspension and removal of the last enrolled permanent recovery super administrator are rejected, including concurrent changes. Pending invitees do not count as recovery administrators. Role changes revoke sessions; pending recipients keep their invitation but must verify email and restart MFA setup.

![Actual administrator inventory](assets/screenshots/04-admin-identities.png)
![Recipient email verification](assets/screenshots/05-admin-email-enrollment.png)
![MFA and safe session detail](assets/screenshots/08-admin-account-sessions.png)
![Mobile account detail](assets/screenshots/09-admin-account-mobile.png)

Removing a deny restores access, so the server checks delegation permissions, scope intersections, limits and expiry. Operators cannot remove their own deny or delegate broader access over an explicit restriction in a smaller scope. Binding deletion supports same-key retries without repeated session revocation.

`src/admin-identities.tsx` implements enrollment, self MFA and account detail. Delivery `npm run qa:admin-identities` runs six actual browser groups, backed by 14 PostgreSQL/API test groups. Screenshots mask keys and verification codes. Production SMTP and enterprise SSO require separate live qualification.

## Sensitive operations

```mermaid
flowchart LR
  A[Admin email OTP and TOTP] --> R[Permission and scope]
  R --> P[Financial or VIP command]
  P --> V[Read-only preview, hash and target version]
  V --> C[Commit within five minutes]
  C --> T{Approval threshold reached?}
  T -->|Yes| I[Different authorized approver]
  T -->|No| D[Transactional commit]
  I --> D
  D --> L[Ledger, entitlement events and audit]
```

HKD values use integer micros. Confirmed-payment references are unique; this console does not acquire online payments. VIP is separate from wallet funds. Default monthly fees remain commercially unpriced.

Global/tenant/project scope, explicit denies, amount/duration/batch limits and expiry constrain operations. Delegation cannot exceed the grantor's own grants. Self-grants and removal of the last permanent recovery administrator are rejected. Contacts, consumption, balances, content bodies and downloads are separate permissions.

Published role JSON can only enable/disable installed definitions and adjust presentation; Skills can only be enabled/disabled. It cannot replace executable tools, kernel or model configuration. Quarantine affects customer visibility, sharing and subsequent execution. Collection filtering happens in authorized SQL before pagination.

## Private-content governance

The content inventory includes specialists, private conversations and memory alongside existing resources. Metadata and body reads require separate scoped permissions; body inspection is audited. Customer workspace administration does not provide platform-admin access to another user's private work.

Quarantine affects customer APIs, RLS reads and subsequent running-task tools. Conversation deletion checks active work, then clears readable messages, task content, memory versions and cached replays. Deleted conversations/memory have no restore action. Instructions change through the versioned specialist API, preserving frozen task definitions. Retried work retains private ownership/context and rechecks authorization and entitlements.

![Actual private-body governance](assets/screenshots/03-private-content-governance.png)

## Verification and limits

`npm test` is type checking. Delivery `npm run qa:web` exercises all 16 pages, actual OTP/TOTP, funding/VIP submission and customer detail. Delivery `npm run qa:persistent` also checks private-body reads and quarantine/restore. Platform tests cover access denial, concurrency, financial replay, VIP, bounded delegation and recovery-admin protection.

Exports are limited to 500 rows and 15 minutes, with source authorization rechecked at download. A trusted CLI bootstraps the first recovery super administrator; the UI handles subsequent invitations, MFA enrollment/replacement, suspension/resumption, resend and session revocation. Support sessions expose metadata, not customer impersonation or delegated body access. Online payments, SAML/SCIM and large exports remain unfinished.

`src/main.tsx` contains pages/commands, `api.ts` handles Cookie/CSRF, and UI foundations are a self-contained snapshot recorded in `shared-source.json`. Screenshots use real development records with fictional fixtures. Master documents are in the delivery root's `docs/`; see [notices](THIRD_PARTY_NOTICES.md).

## Cloud schedule controls

Version 0.4.0 adds scoped search and pagination for calendars on Execution, displaying metadata. Pause and resume separately require `execution.pause` / `execution.resume`, recent MFA, the current record version and a reason. Pausing preserves current work; resuming starts now without backfilling. Original user authorization is retained. Revoked authorization requires a project administrator to confirm a fresh one; an Admin cannot create new user authority through this operation.

Content governance can quarantine or delete calendars. Deletion scrubs configuration bodies and replay responses while retaining audit metadata. Quarantining the parent workflow stops future triggers and cancels current runs. `src/schedules.tsx` supplies the UI; platform queries enforce scope and authorization.

![Actual cloud schedule controls](assets/screenshots/11-cloud-schedules.png)

## 0.5.0 company identity and unified sign-in

OIDC uses code + PKCE S256, signature verification, state/nonce and a fixed callback. An existing registered account and active workspace membership are required. First binding requires a separate CopyPaste work-email code; domains never auto-enroll users. Configuration changes, disablement or unlinking revoke all linked users’ CopyPaste browser/native/refresh sessions and prior execution authorization. Administrator email and TOTP remain separate.

The workspace identity action configures OIDC callback URI, email domains, client ID, write-only secret, signature and email policy. Save, check, enable and disable are separate commands. Global `admin.tenants.sso.write` excludes ordinary user operators. The UI explains metadata-only checks and the all-device sign-out impact of changes or disablement.

```mermaid
flowchart LR
  Member[Existing workspace member] --> IdP[Signed OIDC and PKCE]
  IdP --> Proof[First-link email proof]
  Proof --> Web[CopyPaste session]
  Web --> Native[Explicit native consent and PKCE]
  Revoke[Disable or unlink] --> All[Revoke browser and native credentials]
```

![Actual company identity interface](assets/screenshots/12-company-sign-in.png)

## Lifecycle repairs in progress

Content management now shows durable deletion progress, failed cleanup items and retries guarded by scope, recent MFA, reason and idempotency. Permanently deleted assets cannot be restored or renamed, and download streams recheck authorization after opening. A persistent banner identifies synthetic mode; demo gifts are distinct from payments. Tiny nonzero charges display up to six decimals.

These source changes have not been repackaged; 0.5.0 archives retain their original contents. Full requirements and outstanding conditions remain in the master alignment report.

![Erasure journal](assets/screenshots/18-erasure-journal.png)
![Dark cleanup panel](assets/screenshots/19-erasure-dark.png)

## Cloud directory governance (current source)

Workspace nodes are included in the content resource inventory. Existing scope, body-access, version, reason and audit checks govern metadata inspection, quarantine, restoration and deletion. Quarantining a folder hides descendants from user search and model reads. Entry removal preserves independent source assets; permanent asset erasure remains a separate lifecycle action.

## Waiting-task input governance (current source)

Authorized task-body inspection now includes requested input descriptions, provider, scope, state, selected IDs and version. Body reads retain their separate permission, data scope and audit; support-role metadata access does not expose private requests or credentials. Execution cancellation can release the original hold of an unstarted waiting task without a model charge. Retry preserves private ownership and requirements, then rechecks current resources.

Delivery `qa:admin-task-inputs` passes three actual browser groups. Platform negative tests also reject support-role body access. Screenshots use synthetic task data; browser instances close after verification.

![Authorized inspection of requested inputs](assets/screenshots/20-task-input-review.png)
![The same task-body panel in dark mode](assets/screenshots/21-task-input-review-dark.png)

## Execution queue reasons (current source)

Execution lists readable reasons for shared workspace slots, current user limits and platform/media/service capacity. Existing execution-read scope, cancellation/retry and audit checks apply; no other-workspace counts or credentials are exposed. Delivery `qa:execution-capacity` checks the actual page after independent MFA.

![Scoped queue reason](assets/screenshots/22-capacity-queue.png)
![Dark execution queue](assets/screenshots/23-capacity-queue-dark.png)

## Cleanup pages and current authorization

The content journal filters by state, type and literal record/target ID. Its URL retains filters and paging. The default is 50 records, with explicit 25/50/100 choices and bounded keyboard-focusable scrolling. General Admin collections, administrator identities and schedules also default to 50. Polls start after the previous response finishes; errors hide old records, and switching queries never exposes the previous page. Retry still requires its separate delete permission, current scope, recent MFA, reason and idempotency key.

Delivery `npm run qa:admin-records` passes five browser groups: 58 visible and six excluded records, paging/combined filters, grant expiry, delayed-denial cleanup, four widths and two themes/languages. Journal targets are explicit synthetic fixtures; email/MFA login and authorization queries are real. Full operational filters, column configuration and million-record benchmarks remain pending.

```mermaid
flowchart LR
  URL[Filters and page] --> Scope[Current scope and deny]
  Scope --> Page[Bounded records and visible total]
  Page --> Panel[Scrollable table]
  Error[Failure or expiry] --> Clear[Hide old records]
```

![Cleanup pagination](assets/screenshots/24-cleanup-pagination.png)
![Traditional Chinese dark journal](assets/screenshots/25-cleanup-pagination-dark.png)
![Narrow cleanup panel](assets/screenshots/26-cleanup-mobile.png)

## Administrative boundary for template execution

New persisted templates recheck current role/method disabling, project access and plans at preflight and creation. Server-owned versions pin Codex and the internal gateway, and revocation blocks later execution. Existing Admin catalog controls still apply. Drafts, complete template version editing/publication and enterprise brand overrides remain pending; the registry alone does not constitute a complete template administration panel.

Queued pause/resume now shares platform domain guards with customer controls: only the unclaimed initial checkpoint and an intact original reservation are eligible. Resume rechecks beneficiary authorization, role/Skills, entitlements and inputs. Admin scope does not replace revoked beneficiary access; reasons, versions and human audit remain required. See master `docs/technical/31-task-controls-and-native-continuation.md`.

## Workspace membership management

User details now open a membership form for role, active/admin-suspended/removed state, explicit projects and reason. Preview the before/after access, then execute or submit for independent review. Reviewers see frozen business parameters and the deadline. Unknown-result retries retain their operation identity; the browser receipt stores no raw reasons or credentials. Six current UI groups now pass, with corrected result navigation and three new screenshots below; earlier unverified receipts and gallery images retain their historical scope.

```mermaid
flowchart LR
  CurrentScope --> RecentMFA --> FrozenPreview --> Policy
  Policy --> DirectApply
  Policy --> IndependentReview --> Recheck --> DirectApply
  DirectApply --> MembershipAndAudit
```


## Global accounts and workspace state

The user detail account dialog separates name/labels, account state and all-session revocation. Workspace state uses the same canonical preview flow. Controls load the current revision/capabilities, show frozen differences and in-flight handling, and retain the result until dismissal. Closure/reopening defaults to another administrator's review; approval screens load the frozen command before deciding. Canonical POST commands return 202 AdminOperation and retain one idempotency key after an unknown result. Obsolete account PATCH calls are removed. Existing brand tokens, English/Traditional Chinese labels, focus handling and modal components remain in use; backend authorization is decisive.

Global suspension revokes credentials across clients; workspace suspension affects that workspace. Accepted work still requires settlement/reconciliation, and account closure retains data rather than performing privacy erasure. Build, API and targeted evidence do not establish complete UI, native or release acceptance.


The new account form passes **5/5** real browser groups: profile preview/confirmation, freeze, closure navigation and visible self-review refusal, three widths with English/light and Traditional Chinese/dark, and Escape dismissal. All owned browser resources closed. Other membership/native open issues remain separate. Results link directly to filtered approval or operation records.

![Profile differences](assets/screenshots/54-account-profile-preview.png)
![Frozen account review](assets/screenshots/55-account-closure-review.png)
![Traditional Chinese dark controls](assets/screenshots/56-account-control-dark-zh.png)


## Canonical directory and scoped charges

User lists, details and workspace lists consume the original strict AdminUserList/AdminUserDetail/AdminTenantList. Filters include user/workspace/project, state, effective VIP, confirmed-charge interval and page size. Reset/refresh starts a new cursor sequence; previous/next use actual signed cursors. Counts describe the current page. Unauthorized contact, charge and entitlement fields display a dash or an explicit permission message instead of fabricated zero/no-VIP claims.

A separately authorized context supplies workspace names, task counts and personal grant history. Account, membership, billing and VIP controls retain canonical user IDs. Billing target selection reads every authorized workspace cursor page. Typechecking and production build pass. Seven actual API/Vite UI groups cover 23 users across 20/3 pages, filters, detail and existing management entry points, recent MFA and anonymous rejection. Owned Chromium closes after synthetic-data verification.

```mermaid
flowchart LR
  Filters[Search and advanced filters] --> First[Reset cursor]
  First --> Page[Current authorized page]
  Page --> Next[Saved signed cursor / previous and next]
  Page --> Detail[Strict user detail]
  Detail --> Actions[Account / membership / billing / VIP]
```

![Directory and filters](assets/screenshots/57-users-directory.png)
![Strict detail and scoped workspace charges](assets/screenshots/58-user-detail-scopes.png)
![Traditional Chinese dark mobile filters](assets/screenshots/59-directory-mobile-dark.png)

These are actual local screenshots. English light layouts were checked at 375/768/1440 and Traditional Chinese dark at 375; this does not accept every language/theme/page or financial write operation. The separate older membership UI open receipt remains.

## Canonical financial commands and independent review

Billing now uses actual personal/workspace accounts, subject filters, cursor pages, original ledger entries, canonical gift/debit/credit-limit forms and independent approval requests. Inputs and reviews retain six decimal places. Previews do not change funds; retries keep the same idempotency key. A distinct request ID, frozen hash and version bind each review, with live financial/approval permissions and the original submitting session rechecked. Existing CopyPaste colors, bilingual labels and light/dark themes are retained.

```mermaid
flowchart LR
  Account[Authorized account and original ledger] --> Preview[Amount, source and revision]
  Preview --> Submit[Idempotent confirmation]
  Submit --> Apply[Actual ledger and audit]
  Submit --> Review[Independent administrator]
  Review --> Apply
```

`npm test` checks precise amounts and invalid boundaries; `npm run build` checks production output. Delivery's `npm run qa:admin-fees` passed four actual HTTP/browser groups with ten strict response captures and closed its owned browser resources. Screenshots contain synthetic customers and simulated funds, with no external payment or model call.

![Billing accounts](assets/screenshots/24-billing-accounts.png)
![Pure preview](assets/screenshots/25-fee-preview.png)
![Actual independent review](assets/screenshots/26-financial-independent-review.png)
![Original ledger](assets/screenshots/27-billing-ledger.png)
![Traditional Chinese dark/mobile](assets/screenshots/28-billing-mobile-dark.png)

This does not accept the complete billing/admin product. Payment evidence/records, external refunds/reconciliation, original-bucket consumption refunds, immutable plans/VIP, financial outbox, the full canonical approval directory and remaining client consumers still require implementation and acceptance. Existing legacy funding/refund/VIP pages do not establish those contracts. Central scope: `docs/technical/41-canonical-fee-commands-and-independent-approvals.md`.

## Current membership UI verification (2026-10-20)

Membership results now locate the actual operation: pending reviews use `/audit?view=approvals&search=…`; completed changes use `/jobs?search=…`. Delivery `npm run qa:admin-membership-ui` passes 6/6 groups with two real scoped email/TOTP admin logins: pure previews, suspension/restoration and Web owner feedback, frozen parameters, self-review rejection, another administrator's approval and Traditional Chinese dark at 390px. Four actual AdminOperation payloads pass strict validation; 179 source/verifier files remain unchanged. Unit tests pass 3/3 and production builds. Owned browsers/sessions close, temporary admins are confirmed suspended in the database, and model calls are zero.

![Suspension preview](assets/screenshots/29-membership-suspension-preview.png)
![Independent frozen-command review](assets/screenshots/30-membersship-independent-review.png)
![Traditional Chinese dark/mobile](assets/screenshots/31-membership-mobile-dark.png)

Original unverified/failed receipts are preserved. This member workflow still uses supplementary frozen review and its legacy decision endpoint; the complete normative approval directory, other Admin domains and all native/system acceptance remain unfinished. Central evidence: `docs/technical/42-current-membership-ui-and-native-auth-recovery.md`.

## Shared approval directory and independent review (2026-10-20)

The directory consumes the original AdminApprovalList and displays real request IDs, associated operations, requesters, persisted states, deadlines and revisions with signed cursor pagination. Membership/account result links resolve the actual request; review submits its frozen revision and hash. Requesters see a notice requiring another administrator. A different reviewer needs both approval and business permissions. Fees retain their detailed amount and original-source review. Overview pending counts use a separate scoped summary.

```mermaid
flowchart LR
  Queue[Approval request directory] --> Frozen[Frozen command and prior state]
  Link[Business operation result link] --> Frozen
  Frozen --> Other[Different reviewer confirms revision and hash]
  Other --> API[Atomic server authorization and execution]
  API --> Reload[Reload actual request and business state]
```

![Normative approval request directory](assets/screenshots/32-canonical-approval-directory.png)

This increment does not constitute complete payments, refunds, VIP or full Admin authority-matrix acceptance; all original conditions remain tracked.

Current checks pass: membership 6/6, fees 4/4 and accounts 5/5, with real list/decision payloads validated against the original schemas. The new component was rerun after matching working-tree bytes to Git LF bytes; earlier receipts remain archived.
