import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import { seal } from "../src/lib.js";
import type { buildApp } from "../src/server.js";

// Define and issue a real small plan through existing Admin operations. This
// changes only this isolated tenant, and never edits an immutable plan version.
export async function giveSeoStorageLimit(
  s: Awaited<ReturnType<typeof buildApp>>,
  tenant: string,
  role: string,
  storageBytes = 16,
) {
  async function administrator() {
    const secret = new OTPAuth.Secret({ size: 20 }),
      email = randomUUID() + "@example.invalid";
    const principal = (
      await s.db.control.query(
        "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'SEO quota fixture',$2) RETURNING id",
        [email, seal(s.db.config.MASTER_KEY!, secret.base32)],
      )
    ).rows[0];
    await s.db.control.query(
      "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,'super_admin','global')",
      [principal.id],
    );
    const start = await s.app.inject({
      method: "POST",
      url: "/v1/admin/auth/challenge",
      payload: { email },
    });
    assert.equal(start.statusCode, 200);
    const challenge = start.json(),
      mail = JSON.parse(
        await readFile(
          `${s.db.config.DATA_DIR}/mailbox/${challenge.challenge_id}.json`,
          "utf8",
        ),
      );
    const verified = await s.app.inject({
      method: "POST",
      url: "/v1/admin/auth/verify",
      payload: {
        challenge_id: challenge.challenge_id,
        code: mail.text.match(/\b\d{6}\b/)[0],
        totp: new OTPAuth.TOTP({
          secret,
          digits: 6,
          period: 30,
          algorithm: "SHA1",
        }).generate(),
      },
    });
    assert.equal(verified.statusCode, 200, verified.body);
    const cookie = verified.cookies.find((c) => c.name === "cp_admin_session")!;
    return {
      cookie: `${cookie.name}=${cookie.value}`,
      csrf: verified.json().csrf_token,
    };
  }
  const operator = await administrator(),
    reviewer = await administrator();
  async function call(
    actor: typeof operator,
    method: string,
    url: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) {
    const r = await s.app.inject({
      method: method as any,
      url,
      headers: {
        origin: s.db.config.ADMIN_ORIGIN,
        cookie: actor.cookie,
        "x-csrf-token": actor.csrf,
        "idempotency-key": randomUUID(),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...extra,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
    assert.ok(r.statusCode >= 200 && r.statusCode < 300, r.body);
    return r.json();
  }
  async function approve(operation: any) {
    if (operation.state === "pending_approval") {
      const approval = await call(
        reviewer,
        "GET",
        `/v1/admin/operations/${operation.id}/approval`,
      );
      operation = await call(
        reviewer,
        "POST",
        `/v1/admin/approvals/${approval.id}/decisions`,
        {
          expected_version: approval.version,
          payload_hash: approval.payload_hash,
          decision: "approve",
          reason: "Independent isolated storage fixture review",
        },
      );
    }
    assert.equal(operation.state, "succeeded", JSON.stringify(operation));
  }
  const draft = await call(operator, "POST", "/v1/admin/plans/drafts", {
    plan_id: randomUUID(),
    name: "Isolated SEO storage limit",
    allowances: {
      feature_ids: ["text", "local_files"],
      allowed_role_ids: [role],
      seat_limit: 2,
      task_concurrency: 2,
      storage_bytes: storageBytes,
      included_credit: { currency: "HKD", amount_micros: "0" },
      credit_policy: "no_automatic_credit",
    },
    reason: "Exercise real evidence storage quota",
  });
  const version = await call(
    operator,
    "GET",
    "/v1/admin/plans/" + draft.result_ids[0],
  );
  const publication = {
    expected_version: version.version,
    reason: "Publish isolated resource plan",
  };
  const preview = await call(
    operator,
    "POST",
    `/v1/admin/plans/${version.id}/publication-previews`,
    publication,
  );
  await approve(
    await call(
      operator,
      "POST",
      `/v1/admin/plans/${version.id}/publications`,
      publication,
      { "x-admin-preview-id": preview.preview_id },
    ),
  );
  const subject = await call(
    operator,
    "GET",
    `/v1/admin/entitlement-grants/subjects/tenant/${tenant}`,
  );
  const grant = {
    subject: { kind: "tenant", id: tenant },
    plan_version_id: version.id,
    starts_at: new Date(Date.now() - 1000).toISOString(),
    ends_at: new Date(Date.now() + 3600000).toISOString(),
    overlap_policy: "replace",
    source: "manual",
    auto_renew: false,
    expected_subject_version: subject.version,
    reason: "Exercise actual SQL capacity during crawl",
  };
  const grantPreview = await call(
    operator,
    "POST",
    "/v1/admin/entitlement-previews",
    grant,
  );
  await approve(
    await call(operator, "POST", "/v1/admin/entitlement-grants", grant, {
      "x-admin-preview-id": grantPreview.preview_id,
    }),
  );
}
