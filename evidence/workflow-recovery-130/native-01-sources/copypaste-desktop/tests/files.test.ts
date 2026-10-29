import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalFiles, type Journal, resolveInGrant } from "../src/files.js";
import {
  apiURL,
  rendererApiOperation,
  connectorLaunchURL,
} from "../src/config.js";
test("folder grants enforce expiry, explicit writes, create-only semantics and idempotency", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cp-files-"));
  try {
    let j: Journal = { grants: [], completed: {} };
    const f = new LocalFiles(
      async () => structuredClone(j),
      async (next) => {
        j = structuredClone(next);
      },
    );
    await writeFile(path.join(root, "brief.txt"), "品牌 brief");
    const g = await f.grant(root);
    const listing = (await f.execute({
      operation: "file.list",
      grant_id: g.id,
      path: ".",
      request_id: "list-id-1234567890",
    })) as any;
    assert.equal(listing.items[0].name, "brief.txt");
    const command = {
      operation: "file.read" as const,
      grant_id: g.id,
      path: "brief.txt",
      request_id: "read-id-1234567890",
    };
    const r = (await f.execute(command)) as any;
    assert.equal(Buffer.from(r.base64, "base64").toString(), "品牌 brief");
    await assert.rejects(
      f.execute({ ...command, operation: "file.write", content: "replace" }),
    );
    for (const p of [
      "../outside",
      "NUL",
      "sub./file",
      "COM1.txt",
      "C:\\private",
      "//server/share",
      "file.txt:secret",
      "sub/../../escape",
    ])
      await assert.rejects(resolveInGrant(root, p));
    const w = await f.grant(root, true);
    const c = {
      operation: "file.write" as const,
      grant_id: w.id,
      path: "new.txt",
      content: "deliverable",
      request_id: "write-id-123456789",
    };
    assert.deepEqual(await f.execute(c), await f.execute(c));
    await assert.rejects(f.execute({ ...c, content: "changed" }));
    await assert.rejects(f.execute({ ...c, request_id: "write-id-987654321" }));
    assert.equal(
      await readFile(path.join(root, "new.txt"), "utf8"),
      "deliverable",
    );
    await f.revoke(w.id);
    await assert.rejects(f.execute({ ...c, request_id: "write-id-555555555" }));
    j.grants[0].expires_at = new Date(Date.now() - 1).toISOString();
    await assert.rejects(f.execute(command));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("API bridge cannot change origin or escape the API prefix", () => {
  assert.equal(
    apiURL("https://agent.example", "/v1/me"),
    "https://agent.example/v1/me",
  );
  for (const p of [
    "//evil.example/v1/me",
    "/v1/../../private",
    "https://evil/v1/me",
    "/auth",
  ])
    assert.throws(() => apiURL("https://agent.example", p));
});

test("native workspace bridge permits canonical session/onboarding/business calls and rejects credential and path escapes", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  for (const [route, method] of [
    ["/v1/session/context", "GET"],
    ["/v1/plans?limit=30", "GET"],
    ["/v1/effective-entitlements", "GET"],
    ["/v1/entitlement-notifications", "GET"],
    ["/v1/support-grants?limit=20", "GET"],
    ["/v1/support-grants", "POST"],
    [`/v1/support-grants/${id}/revoke`, "POST"],
    [`/v1/entitlement-notifications/${id}`, "PATCH"],
    ["/v1/tenants", "POST"],
    ["/v1/me/sessions", "GET"],
    [`/v1/me/sessions/${id}`, "DELETE"],
    [`/v1/tenants/${id}/projects`, "GET"],
    [`/v1/members/${id}`, "DELETE"],
    [`/v1/evidence/${id}?version=1`, "GET"],
    ["/v1/reports", "POST"],
    ["/v1/dataset-imports", "POST"],
  ])
    assert.equal(rendererApiOperation(route, method), true, route);
  for (const [route, method] of [
    ["/v1/session/context", "POST"],
    ["/v1/effective-entitlements", "POST"],
    ["/v1/plans", "DELETE"],
    ["/v1/support-grants", "DELETE"],
    [`/v1/support-grants/${id}/revoke`, "GET"],
    [`/v1/admin/support/sessions/${id}/view`, "GET"],
    [`/v1/entitlement-notifications/${id}`, "DELETE"],
    ["/v1/session/context/extra", "GET"],
    ["/v1/auth/token", "POST"],
    ["/v1/auth/sessions", "POST"],
    ["/v1/admin/users", "GET"],
    ["/v1/me/../admin/users", "GET"],
    ["/v1/me/%2e%2e/admin/users", "GET"],
    ["/v1/me%2f..%2fadmin/users", "GET"],
    ["//evil.invalid/v1/me", "GET"],
    ["/v1/session/context#fragment", "GET"],
    ["/v1/reports", "DELETE"],
  ])
    assert.equal(rendererApiOperation(route, method), false, route);
  assert.equal(rendererApiOperation(null), false);
  assert.equal(rendererApiOperation("/v1/me", {}), false);
});

test("marketing bridge permits scoped reporting operations while rejecting admin and OAuth credential access", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  for (const [route, method] of [
    ["/v1/connector-providers", "GET"],
    ["/v1/connections", "POST"],
    ["/v1/connections?limit=20", "GET"],
    [`/v1/connections/${id}`, "PATCH"],
    [`/v1/connections/${id}`, "DELETE"],
    [`/v1/connections/${id}/detail`, "GET"],
    [`/v1/connections/${id}/history?cursor=${id}`, "GET"],
    [`/v1/connections/${id}/syncs`, "POST"],
    [`/v1/connections/${id}/discovery`, "POST"],
    [`/v1/syncs/${id}/cancel`, "POST"],
    [`/v1/syncs/${id}/retry`, "POST"],
    [`/v1/connector-snapshots/${id}?offset=0&limit=25`, "GET"],
  ])
    assert.equal(rendererApiOperation(route, method), true, route);
  for (const [route, method] of [
    ["/v1/connector-providers", "POST"],
    [`/v1/connections/${id}/history`, "POST"],
    [`/v1/connector-snapshots/${id}`, "DELETE"],
    [`/v1/connections/${id}/syncs`, "GET"],
    [`/v1/admin/connections/${id}/revocations`, "POST"],
    ["/v1/connections/callback", "GET"],
    [`/v1/connections/launch/${"a".repeat(43)}`, "GET"],
  ])
    assert.equal(rendererApiOperation(route, method), false, route);
});

test("provider authorization opens only the configured company page with a bounded state", () => {
  const state = "a".repeat(43);
  assert.equal(
    connectorLaunchURL("https://app.example.invalid", state),
    `https://app.example.invalid/connect-provider?state=${state}`,
  );
  assert.equal(
    new URL(connectorLaunchURL("http://127.0.0.1:4310", state)).origin,
    "http://127.0.0.1:4310",
  );
  for (const value of [
    null,
    {},
    "https://evil.invalid",
    `${state}&redirect=https://evil.invalid`,
    "a".repeat(44),
  ])
    assert.throws(() =>
      connectorLaunchURL("https://app.example.invalid", value),
    );
  for (const origin of [
    "http://evil.invalid",
    "https://company.invalid/redirect",
    "https://user:pass@company.invalid",
  ])
    assert.throws(() => connectorLaunchURL(origin, state));
});

test("website audit bridge admits explicit read/create/recheck operations and rejects unrelated writes", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  for (const [route, method] of [
    ["/v1/seo/audits", "GET"],
    ["/v1/seo/audits", "POST"],
    [`/v1/seo/audits/${id}`, "GET"],
    [`/v1/seo/audits/${id}/pages?offset=25`, "GET"],
    [`/v1/seo/audits/${id}/findings?offset=0`, "GET"],
    [`/v1/seo/audits/${id}/documents/${id}`, "GET"],
    [`/v1/seo/audits/${id}/download?format=json`, "GET"],
    [`/v1/seo/audits/${id}/recheck`, "POST"],
  ])
    assert.equal(rendererApiOperation(route, method), true, route);
  for (const [route, method] of [
    ["/v1/seo/audits", "DELETE"],
    [`/v1/seo/audits/${id}`, "PATCH"],
    [`/v1/seo/audits/${id}/download`, "POST"],
    [`/v1/seo/audits/${id}/recheck`, "GET"],
    [`/v1/seo/audits/${id}/documents/${id}/extra`, "GET"],
    [`/v1/seo/audits/${id}/../../admin/users`, "GET"],
    [`/v1/admin/seo/audits/${id}`, "GET"],
  ])
    assert.equal(rendererApiOperation(route, method), false, route);
});
test("saved website change bridge exposes creation and private reads without any website mutation operation", () => {
  const id = "11111111-1111-4111-8111-111111111111",
    base = `/v1/seo/audits/${id}/change-tasks`;
  for (const [route, method] of [
    [base, "GET"],
    [base, "POST"],
    [base + `/${id}`, "GET"],
    [base + `/${id}/download?format=html`, "GET"],
  ])
    assert.equal(rendererApiOperation(route, method), true);
  for (const [route, method] of [
    [base, "DELETE"],
    [base + `/${id}`, "PATCH"],
    [base + `/${id}`, "POST"],
    [base + `/${id}/download`, "POST"],
    [base + `/${id}/apply`, "POST"],
    [base + `/${id}/publish`, "POST"],
    [base + `/${id}/download/extra`, "GET"],
  ])
    assert.equal(rendererApiOperation(route, method), false);
});
test("sign-out removes every folder grant and cached file result before queued work can replay", async () => {
  const base = path.resolve(".data/test/logout-grants");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, "run-"));
  assert.equal(path.dirname(root), base);
  try {
    let journal: Journal = { grants: [], completed: {} };
    const files = new LocalFiles(
      async () => structuredClone(journal),
      async (value) => {
        journal = structuredClone(value);
      },
    );
    await writeFile(
      path.join(root, "private.txt"),
      "Account-specific local file",
    );
    const grant = await files.grant(root);
    const command = {
      operation: "file.read" as const,
      path: "private.txt",
      grant_id: grant.id,
      request_id: "logout-read-123456789",
    };
    await files.execute(command);
    assert.ok(Object.keys(journal.completed).length > 0);
    await files.revokeAll();
    assert.deepEqual(await files.grants(), []);
    assert.deepEqual(journal.completed, {});
    await assert.rejects(files.execute(command), /revoked/);
    assert.equal(
      await readFile(path.join(root, "private.txt"), "utf8"),
      "Account-specific local file",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("method library bridge admits scoped metadata and configuration but no cloud trial execution", () => {
 const id="11111111-1111-4111-8111-111111111111";
 for(const [url,method] of [["/v1/solution-access?project_id="+id,"GET"],["/v1/solution-targets?project_id="+id+"&kind=assets","GET"],["/v1/solution-versions","POST"],[`/v1/solution-versions/${id}/details`,"GET"],[`/v1/solution-versions/${id}/installations`,"POST"],[`/v1/solution-installations/${id}/configurations`,"POST"],[`/v1/solution-trials/${id}`,"GET"]]) assert.equal(rendererApiOperation(url,method),true);
 for(const [url,method] of [[`/v1/solution-versions/${id}/trials`,"POST"],[`/v1/solution-versions/${id}`,"DELETE"],[`/v1/solution-installations/${id}/configurations`,"GET"],["/v1/solution-targets","POST"],[`/v1/solution-versions/${id}/publish`,"POST"]]) assert.equal(rendererApiOperation(url,method),false);
});
