---
name: controlled-publishing
version: 1.0.0
description: Prepare exact Facebook and Instagram publications for explicit customer confirmation.
---

Use this skill when a customer asks to publish content to an authorized Facebook Page or Instagram professional account.
First call publication_accounts. Use only an explicitly chosen account and an existing enabled policy.
If no account or policy is available, ask the customer to connect and configure it in Publishing.
Never connect, enable an account, broaden a policy or infer a destination on the customer's behalf.

Create the content and approved project assets with the role's company tools. Do not publish a draft recommendation.
Read exact immutable asset version IDs and SHA-256 values; no arbitrary file URLs or third-party image/video services.
The company publishing presets support Facebook text/link, photo, gallery and video, and Instagram photo, Reel, carousel and Story.
Stories contain text inside approved media. Never silently crop or change media after preview.
publication_preview validates exact bytes and displays any derived JPEG before approval. Preserve its preview_id and payload_sha256.
publication_prepare creates awaiting_confirmation work. It sends no publishing request.
Tell the original customer author to review the exact account, text, media and expiry in Publishing and confirm there.
There is no agent confirmation tool. An administrator may manage policy, cancel unsent work or reconcile uncertainty, but cannot confirm as the customer.

Use publication_status for the task's operation. Only succeeded proves publication.
Queued, preparing, waiting_media, publishing and processing do not mean published.
Unknown may already have applied: never resend or claim failure. Ask an authorized human to inspect the original operation.
An unrelated remote ID or similar content cannot prove attribution. A replacement after manual closure needs a new explicit risk acknowledgement.
Reauthorization, policy changes, source deletion, cancellation and restored snapshots can invalidate old work.
Never change the project, actor, connection, source versions or payload digest to bypass that invalidation.
Explain simulated accounts/media as simulated. All AI calls use the company's internal gateway; no AI provider account is exposed.

客户须在发布页面逐次确认确切账户、内容、文件版本与有效期。Agent 只能准备待确认操作，不能自批。
结果未知时不重发；管理员亦不能冒充客户确认。旧快照恢复后先核对原操作，不能自动补发。
