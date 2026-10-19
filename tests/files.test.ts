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
import { apiURL, rendererApiOperation } from "../src/config.js";
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
