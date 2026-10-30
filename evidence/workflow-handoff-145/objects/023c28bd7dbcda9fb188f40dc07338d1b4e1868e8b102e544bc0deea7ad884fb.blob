import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import {
  randomUUID,
  randomBytes,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { hash } from "../src/lib.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import {
  disconnectProtocol,
  disconnectMessage,
  verifyDisconnectProof,
  type DesktopDisconnectRequest,
} from "../src/desktop-disconnect-contract.js";
import {
  desktopDisconnectSchema,
  desktopDisconnectReceiptSchema,
} from "../src/desktop-disconnect-routes.js";
import { z } from "zod";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  system: Awaited<ReturnType<typeof buildApp>>;
before(async () => {
  isolated = await isolatedTestEnvironment();
  system = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      WORKER_ENABLED: "false",
      DEV_MAILBOX: "true",
    }),
    { worker: false },
  );
});
after(async () => {
  try {
    await system?.app.close();
  } finally {
    await isolated?.cleanup();
  }
});
const pair = generateKeyPairSync("ed25519"),
  other = generateKeyPairSync("ed25519");
const pem = (key = pair) =>
  key.publicKey.export({ type: "spki", format: "pem" }).toString();
async function user() {
  return (
    await system.db.control.query(
      "INSERT INTO users(email,name) VALUES($1,'Synthetic removal test') RETURNING id",
      [randomUUID() + "@example.invalid"],
    )
  ).rows[0].id as string;
}
async function credential(
  owner = undefined as string | undefined,
  client = "desktop",
) {
  owner ??= await user();
  const family = randomUUID(),
    token = randomBytes(32).toString("base64url"),
    access = randomBytes(32).toString("base64url");
  const session = (
    await system.db.control.query(
      "INSERT INTO sessions(token_hash,user_id,audience,auth_version,expires_at) VALUES($1,$2,'native',1,now()+interval '15 minutes') RETURNING id",
      [hash(access), owner],
    )
  ).rows[0].id;
  await system.db.control.query(
    "INSERT INTO refresh_tokens(digest,family_id,user_id,session_id,client_id,auth_version,expires_at) VALUES($1,$2,$3,$4,$5,1,now()+interval '30 days')",
    [hash(token), family, owner, session, client],
  );
  return { owner, family, token, session, access };
}
async function device(
  owner: string,
  public_key = pem(),
  client = "desktop",
  tenant?: string,
) {
  tenant ??= (
    await system.db.control.query(
      "INSERT INTO tenants(name) VALUES('Synthetic removal tenant') RETURNING id",
    )
  ).rows[0].id;
  return (
    await system.db.control.query(
      "INSERT INTO devices(tenant_id,user_id,name,client,public_key,grants) VALUES($1,$2,'Synthetic computer',$3,$4,$5) RETURNING id,tenant_id",
      [
        tenant,
        owner,
        client,
        public_key,
        JSON.stringify([
          {
            id: randomUUID(),
            label: "Synthetic folder",
            operations: ["file.list"],
            expires_at: new Date(Date.now() + 3600000).toISOString(),
          },
        ]),
      ],
    )
  ).rows[0] as { id: string; tenant_id: string };
}
function request(
  token: string,
  devices: { id: string; tenant_id: string }[],
  key = pair,
): DesktopDisconnectRequest {
  const body: DesktopDisconnectRequest = {
    protocol: disconnectProtocol,
    client_id: "desktop",
    request_id: randomUUID(),
    refresh_token: token,
    devices: [],
  };
  body.devices = devices.map((d) => {
    const proof = { tenant_id: d.tenant_id, device_id: d.id };
    return {
      ...proof,
      signature: sign(
        null,
        disconnectMessage(body, proof),
        key.privateKey,
      ).toString("base64url"),
    };
  });
  return body;
}
async function post(body: unknown) {
  const raw = await system.app.inject({
    method: "POST",
    url: "/v1/auth/native/disconnect",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
  return { status: raw.statusCode, body: raw.json(), raw };
}
async function state(id: string) {
  return (
    await system.db.control.query(
      "SELECT state,grants FROM devices WHERE id=$1",
      [id],
    )
  ).rows[0];
}

test("the exact shared proof binds device, tenant, nonce and credential without authorizing any read or execution", async () => {
  assert.deepEqual(
    await readFile("src/desktop-disconnect-contract.ts"),
    await readFile(
      path.resolve("../copypaste-desktop/src/desktop-disconnect-contract.ts"),
    ),
  );
  const b = request("a".repeat(43), [
      { id: randomUUID(), tenant_id: randomUUID() },
    ]),
    d = b.devices[0];
  assert.equal(verifyDisconnectProof(b, d, pem()), true);
  for (const altered of [
    { ...b, request_id: randomUUID() },
    { ...b, refresh_token: "b".repeat(43) },
  ])
    assert.equal(verifyDisconnectProof(altered, d, pem()), false);
  for (const altered of [
    { ...d, device_id: randomUUID() },
    { ...d, tenant_id: randomUUID() },
    { ...d, signature: d.signature.slice(1) },
  ])
    assert.equal(verifyDisconnectProof(b, altered, pem()), false);
  assert.equal(verifyDisconnectProof(b, d, pem(other)), false);
  assert.equal(verifyDisconnectProof(b, d, "invalid key"), false);
});
test("the published strict request/receipt schemas match the actual runtime and OpenAPI supplement", async () => {
  const schemas = JSON.parse(
    await readFile("contracts/desktop-removal-schemas.json", "utf8"),
  ).schemas;
  for (const [name, schema] of [
    ["DesktopDisconnectRequest", desktopDisconnectSchema],
    ["DesktopDisconnectReceipt", desktopDisconnectReceiptSchema],
  ] as const) {
    const { $schema, ...actual } = z.toJSONSchema(schema);
    assert.deepEqual(schemas[name], actual);
  }
  const docs = JSON.parse(
    await readFile(
      path.resolve("../../docs/contracts/desktop-removal.openapi.json"),
      "utf8",
    ),
  );
  assert.deepEqual(docs.components.schemas, schemas);
});
test("one signed removal revokes only this credential family and verified computers, cancelling pending and claimed commands", async () => {
  const c = await credential(),
    otherFamily = await credential(c.owner),
    a = await device(c.owner),
    b = await device(c.owner, pem(other)),
    body = request(c.token, [a, b]);
  const commandIds = [];
  for (const phase of ["pending", "claimed", "succeeded"]) {
    const r = (
      await system.db.control.query(
        "INSERT INTO device_commands(tenant_id,device_id,operation,payload,state,nonce,expires_at) VALUES($1,$2,'file.list','{}',$3,$4,now()+interval '1 hour') RETURNING id",
        [a.tenant_id, a.id, phase, randomUUID()],
      )
    ).rows[0];
    commandIds.push(r.id);
  }
  const r = await post(body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.raw.headers["cache-control"], "no-store");
  assert.deepEqual(
    r.body.devices.map((d: any) => d.status),
    ["revoked", "unverified"],
  );
  assert.deepEqual(await state(a.id), { state: "revoked", grants: [] });
  assert.equal((await state(b.id)).state, "active");
  const phases = (
    await system.db.control.query(
      "SELECT id,state FROM device_commands WHERE id=ANY($1::uuid[])",
      [commandIds],
    )
  ).rows;
  assert.deepEqual(
    commandIds.map((id) => phases.find((x) => x.id === id).state),
    ["cancelled", "cancelled", "succeeded"],
  );
  const sessions = (
    await system.db.control.query(
      "SELECT id,revoked_at FROM sessions WHERE id=ANY($1::uuid[])",
      [[c.session, otherFamily.session]],
    )
  ).rows;
  assert.ok(sessions.find((x) => x.id === c.session).revoked_at);
  assert.equal(
    sessions.find((x) => x.id === otherFamily.session).revoked_at,
    null,
  );
});
test("expired and already revoked refresh tokens still permit one-way retirement; retry is idempotent and creates no duplicate audit", async () => {
  const c = await credential(),
    d = await device(c.owner),
    body = request(c.token, [d]);
  await system.db.control.query(
    "UPDATE refresh_tokens SET expires_at=now()-interval '1 day',used_at=now(),revoked_at=now() WHERE digest=$1",
    [hash(c.token)],
  );
  const first = await post(body),
    second = await post(body);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, second.body);
  assert.equal((await state(d.id)).state, "revoked");
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*)::int n FROM audit_log WHERE action='device.desktop_disconnect' AND target=$1",
        [d.id],
      )
    ).rows[0].n,
    1,
  );
});
test("foreign owners, extension devices, wrong keys and cross-tenant identifiers all remain unverified", async () => {
  const c = await credential(),
    foreign = await user(),
    a = await device(foreign),
    b = await device(c.owner, pem(), "extension"),
    d = await device(c.owner),
    forged = { ...d, tenant_id: randomUUID() };
  const body = request(c.token, [a, b, forged]);
  const r = await post(body);
  assert.equal(r.status, 200);
  assert.ok(r.body.devices.every((x: any) => x.status === "unverified"));
  for (const item of [a, b, d])
    assert.equal((await state(item.id)).state, "active");
});
test("an extension credential cannot revoke Desktop sessions or devices even when a proof key is shared", async () => {
  const c = await credential(undefined, "extension"),
    d = await device(c.owner),
    r = await post(request(c.token, [d]));
  assert.equal(r.status, 200);
  assert.equal(r.body.devices[0].status, "unverified");
  assert.equal((await state(d.id)).state, "active");
  assert.equal(
    (
      await system.db.control.query(
        "SELECT revoked_at FROM sessions WHERE id=$1",
        [c.session],
      )
    ).rows[0].revoked_at,
    null,
  );
});
test("unknown credentials have the same bounded receipt shape and do not reveal device ownership", async () => {
  const c = await credential(),
    d = await device(c.owner),
    r = await post(request(randomBytes(32).toString("base64url"), [d]));
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["devices", "ok", "request_id"]);
  assert.equal(r.body.devices[0].status, "unverified");
  assert.equal((await state(d.id)).state, "active");
});
test("strict validation rejects duplicated proofs, oversized batches and unauthorized payload fields before mutation", async () => {
  const c = await credential(),
    d = await device(c.owner),
    b = request(c.token, [d]);
  for (const bad of [
    { ...b, admin: true },
    { ...b, client_id: "extension" },
    { ...b, devices: [b.devices[0], b.devices[0]] },
    { ...b, devices: Array(65).fill(b.devices[0]) },
    { ...b, devices: [{ ...b.devices[0], private_key: "do-not-accept" }] },
    { ...b, refresh_token: "short" },
  ])
    assert.equal((await post(bad)).status, 400);
  assert.equal((await state(d.id)).state, "active");
});
test("concurrent identical signed disconnects remain safe and a proof cannot replay against a different refresh credential", async () => {
  const c = await credential(),
    other = await credential(c.owner),
    d = await device(c.owner),
    b = request(c.token, [d]);
  const wrong = await post({ ...b, refresh_token: other.token });
  assert.equal(wrong.body.devices[0].status, "unverified");
  assert.equal((await state(d.id)).state, "active");
  const results = await Promise.all([post(b), post(b), post(b)]);
  assert.ok(
    results.every(
      (r) => r.status === 200 && r.body.devices[0].status === "revoked",
    ),
  );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*)::int n FROM audit_log WHERE action='device.desktop_disconnect' AND target=$1",
        [d.id],
      )
    ).rows[0].n,
    1,
  );
});
