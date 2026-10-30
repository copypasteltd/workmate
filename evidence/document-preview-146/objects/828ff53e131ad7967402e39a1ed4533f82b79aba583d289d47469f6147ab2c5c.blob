import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { openPublicationWorkspace } from "../src/publication-handoff.js";

function fixture() {
  const scope = { tenant: randomUUID(), project: randomUUID(), operation: randomUUID() };
  let identity: string | undefined = randomUUID();
  const reads: string[] = [], opened: string[] = [];
  const row = { id: scope.operation, tenant_id: scope.tenant, project_id: scope.project,
    state: "awaiting_confirmation", format: "facebook_photo", version: 1,
    payload_sha256: "a".repeat(64), created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60000).toISOString(), data_mode: "simulated" };
  const io = {
    webOrigin: "https://workmate.example",
    identity: async () => identity,
    request: async (path: string, tenant: string): Promise<unknown> => {
      assert.equal(tenant, scope.tenant); reads.push(path);
      return path.endsWith("/settings") ? { available: true } : row;
    },
    open: async (url: string) => { opened.push(url); },
  };
  return { scope, row, io, reads, opened, identity: (next?: string) => { identity = next; } };
}

test("publishing handoff checks current project and exact operation before opening the fixed company route", async () => {
  const f = fixture();
  await openPublicationWorkspace(f.scope, f.io);
  assert.deepEqual(f.reads, [
    `/v1/tenants/${f.scope.tenant}/projects/${f.scope.project}/publications/settings`,
    `/v1/tenants/${f.scope.tenant}/projects/${f.scope.project}/publications/operations/${f.scope.operation}`,
  ]);
  const actual = new URL(f.opened[0]);
  assert.equal(actual.origin, f.io.webOrigin);
  assert.equal(actual.pathname, "/app/publications");
  assert.deepEqual(Object.fromEntries(actual.searchParams), f.scope);
  assert.equal(actual.hash, ""); assert.equal(actual.username, ""); assert.equal(actual.password, "");
});

test("account changes while project authorization is pending cannot open a stale handoff", async () => {
  const f = fixture();
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const original = f.io.request;
  f.io.request = async (...args) => { await barrier; return original(...args); };
  const pending = openPublicationWorkspace(f.scope, f.io);
  await new Promise(resolve => setImmediate(resolve));
  f.identity(randomUUID()); release();
  await assert.rejects(pending, (error: any) => error.code === "AUTH_CHANGED");
  assert.deepEqual(f.opened, []);
});

test("revoked project access prevents opening a browser tab", async () => {
  const f = fixture();
  f.io.request = async () => { throw Object.assign(new Error("Project access revoked"), { status: 403 }); };
  await assert.rejects(openPublicationWorkspace(f.scope, f.io), /Project access revoked/);
  assert.deepEqual(f.opened, []);
});

test("a foreign project operation or substituted operation identity cannot be handed off", async () => {
  for (const changed of [{ project_id: randomUUID() }, { tenant_id: randomUUID() }, { id: randomUUID() }]) {
    const f = fixture(); Object.assign(f.row, changed);
    await assert.rejects(openPublicationWorkspace(f.scope, f.io), /does not match/);
    assert.deepEqual(f.opened, []);
  }
});

test("invalid scope and injected destinations fail before authorization or browser creation", async () => {
  for (const invalid of [
    { tenant: "../../other", project: randomUUID() },
    { tenant: randomUUID(), project: randomUUID(), operation: "x?token=secret" },
    { tenant: randomUUID(), project: randomUUID(), url: "https://other.example" },
  ]) {
    const f = fixture();
    await assert.rejects(openPublicationWorkspace(invalid, f.io), /Invalid publishing scope/);
    assert.deepEqual(f.reads, []); assert.deepEqual(f.opened, []);
  }
});

test("missing identity epoch and invalid company origins cannot bypass session checks", async () => {
  const f = fixture(); f.identity();
  await assert.rejects(openPublicationWorkspace(f.scope, f.io), (error: any) => error.code === "AUTH_CHANGED");
  assert.deepEqual(f.reads, []); assert.deepEqual(f.opened, []);
  for (const origin of ["https://name:secret@workmate.example", "https://workmate.example/elsewhere", "http://workmate.example"]) {
    const next = fixture(); next.io.webOrigin = origin;
    await assert.rejects(openPublicationWorkspace(next.scope, next.io), /Invalid company Web origin/);
    assert.deepEqual(next.reads, []); assert.deepEqual(next.opened, []);
  }
});

test("workspace navigation without an operation still authorizes the exact project", async () => {
  const f = fixture();
  await openPublicationWorkspace({ tenant: f.scope.tenant, project: f.scope.project }, f.io);
  assert.equal(f.reads.length, 1);
  assert.equal(new URL(f.opened[0]).searchParams.has("operation"), false);
});
