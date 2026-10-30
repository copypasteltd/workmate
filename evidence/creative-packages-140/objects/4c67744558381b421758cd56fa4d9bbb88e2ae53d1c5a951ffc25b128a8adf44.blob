import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import {
  randomUUID,
  randomBytes,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { hash } from "../src/lib.js";
import {
  pairingProtocol,
  pairingMessage,
  verifyPairing,
  type PairingInput,
  type PairingRequest,
} from "../src/desktop-pairing-contract.js";
import {
  desktopPairingSchema,
  desktopPairingReceiptSchema,
  desktopPairingRetirementSchema,
} from "../src/desktop-pairing-routes.js";
import { z } from "zod";
let fixture: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
before(async () => {
  fixture = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...fixture.env,
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
    await s?.app.close();
  } finally {
    await fixture?.cleanup();
  }
});
const key = generateKeyPairSync("ed25519"),
  pem = key.publicKey.export({ type: "spki", format: "pem" }).toString();
async function account(owner?: string, client = "desktop") {
  owner ??= (
    await s.db.control.query(
      "INSERT INTO users(email,name) VALUES($1,'Synthetic pairing') RETURNING id",
      [randomUUID() + "@example.invalid"],
    )
  ).rows[0].id;
  const access = randomBytes(32).toString("base64url"),
    refresh = randomBytes(32).toString("base64url"),
    family = randomUUID();
  const session = (
    await s.db.control.query(
      "INSERT INTO sessions(user_id,token_hash,audience,auth_version,expires_at) VALUES($1,$2,'native',1,now()+interval '15 minutes') RETURNING id",
      [owner, hash(access)],
    )
  ).rows[0].id;
  await s.db.control.query(
    "INSERT INTO refresh_tokens(digest,family_id,user_id,session_id,client_id,auth_version,expires_at) VALUES($1,$2,$3,$4,$5,1,now()+interval '30 days')",
    [hash(refresh), family, owner, session, client],
  );
  const tenant = (
    await s.db.control.query(
      "INSERT INTO tenants(name,data_mode) VALUES('Synthetic pairing','simulated') RETURNING id",
    )
  ).rows[0].id;
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
    [tenant, owner],
  );
  return { owner: owner!, access, refresh, family, session, tenant };
}
function request(
  a: Awaited<ReturnType<typeof account>>,
  action: "pair" | "retire",
  input?: PairingInput,
): PairingRequest {
  const b: PairingRequest = {
    protocol: pairingProtocol,
    refresh_token: a.refresh,
    input: input ?? {
      id: randomUUID(),
      tenant_id: a.tenant,
      name: "Synthetic computer",
      public_key: pem,
      grants: [
        {
          id: randomUUID(),
          label: "Synthetic folder",
          operations: ["file.read"],
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        },
      ],
    },
    signature: "",
  };
  b.signature = sign(null, pairingMessage(action, b), key.privateKey).toString(
    "base64url",
  );
  return b;
}
async function post(
  body: unknown,
  a?: Awaited<ReturnType<typeof account>>,
  retire = false,
) {
  const r = await s.app.inject({
    method: "POST",
    url: "/v1/auth/native/device-pair" + (retire ? "/retire" : ""),
    headers: {
      "content-type": "application/json",
      ...(a ? { authorization: "Bearer " + a.access } : {}),
    },
    payload: JSON.stringify(body),
  });
  return { status: r.statusCode, body: r.json(), raw: r };
}
async function state(id: string) {
  return (await s.db.control.query("SELECT * FROM devices WHERE id=$1", [id]))
    .rows[0];
}
test("pair and retire signatures bind the fixed inputs, original credential and distinct action", async () => {
  assert.deepEqual(
    await readFile("src/desktop-pairing-contract.ts"),
    await readFile("../copypaste-desktop/src/desktop-pairing-contract.ts"),
  );
  const a = await account(),
    b = request(a, "pair");
  assert.equal(verifyPairing("pair", b), true);
  assert.equal(verifyPairing("retire", b), false);
  for (const changed of [
    { ...b, refresh_token: "q".repeat(43) },
    { ...b, input: { ...b.input, tenant_id: randomUUID() } },
    { ...b, input: { ...b.input, name: "Other" } },
  ])
    assert.equal(verifyPairing("pair", changed), false);
});
test("concurrent duplicate creates return one exact device and immutable one-time pairing facts", async () => {
  const a = await account(),
    b = request(a, "pair"),
    results = await Promise.all(Array.from({ length: 5 }, () => post(b, a)));
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(new Set(results.map((r) => r.body.device.id)).size, 1);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*) FROM desktop_pairings WHERE user_id=$1",
        [a.owner],
      )
    ).rows[0].count,
    "1",
  );
  assert.equal(results[0].raw.headers["cache-control"], "no-store");
  const altered = request(a, "pair", { ...b.input, name: "Changed" });
  assert.equal((await post(altered, a)).status, 409);
});
test("an absent create can be retired first and its later signed replay cannot create a device", async () => {
  const a = await account(),
    b = request(a, "pair"),
    r = request(a, "retire", b.input);
  assert.equal((await post(r, undefined, true)).body.status, "retired");
  assert.equal((await post(b, a)).status, 410);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*) FROM devices WHERE user_id=$1",
        [a.owner],
      )
    ).rows[0].count,
    "0",
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE desktop_pairings SET state='paired' WHERE user_id=$1 AND id=$2",
      [a.owner, b.input.id],
    ),
    /immutable/,
  );
});
test("lost create acknowledgements can be retired using expired revoked credentials after membership removal", async () => {
  const a = await account(),
    b = request(a, "pair"),
    d = (await post(b, a)).body.device;
  assert.ok(d?.id);
  await s.db.control.query(
    "UPDATE refresh_tokens SET expires_at=now()-interval '1 day',revoked_at=now() WHERE user_id=$1",
    [a.owner],
  );
  await s.db.control.query(
    "UPDATE memberships SET status='removed' WHERE user_id=$1",
    [a.owner],
  );
  const r = request(a, "retire", b.input);
  assert.equal((await post(r, undefined, true)).body.status, "retired");
  assert.equal((await state(d.id)).state, "revoked");
  assert.deepEqual((await state(d.id)).grants, []);
  assert.equal((await post(r, undefined, true)).body.status, "retired");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*) FROM audit_log WHERE principal_id=$1 AND action='device.desktop_pair_retire'",
        [a.owner],
      )
    ).rows[0].count,
    "1",
  );
});
test("creation and retirement races always end retired with no active device", async () => {
  for (let i = 0; i < 4; i++) {
    const a = await account(),
      b = request(a, "pair");
    const [created, retired] = await Promise.all([
      post(b, a),
      post(request(a, "retire", b.input), undefined, true),
    ]);
    assert.ok([200, 410].includes(created.status));
    assert.equal(retired.body.status, "retired");
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*) FROM devices WHERE user_id=$1 AND state='active'",
          [a.owner],
        )
      ).rows[0].count,
      "0",
    );
  }
});
test("foreign credentials, Extension sessions and forged proofs cannot create or retire another owner's pairing", async () => {
  const a = await account(),
    foreign = await account(),
    extension = await account(a.owner, "extension"),
    b = request(a, "pair");
  const d = (await post(b, a)).body.device;
  assert.equal((await post(b, foreign)).status, 401);
  assert.equal((await post(b, extension)).status, 401);
  const forged = {
    ...request(a, "retire", b.input),
    refresh_token: foreign.refresh,
  };
  assert.equal((await post(forged, undefined, true)).body.status, "unverified");
  // Even a correctly signed foreign credential only retires its own private intent namespace.
  assert.equal(
    (await post(request(foreign, "retire", b.input), undefined, true)).body
      .status,
    "retired",
  );
  assert.equal((await state(d.id)).state, "active");
  assert.equal(
    (await post(request(extension, "retire", b.input), undefined, true)).body
      .status,
    "unverified",
  );
});
test("a newer login family cannot replay the former family's pairing and retirement preserves unrelated families", async () => {
  const a = await account(),
    b = request(a, "pair"),
    d = (await post(b, a)).body.device,
    fresh = await account(a.owner);
  assert.equal(
    (await post(request(fresh, "pair", b.input), fresh)).status,
    409,
  );
  assert.equal(
    (await post(request(a, "retire", b.input), undefined, true)).body.status,
    "retired",
  );
  assert.equal((await state(d.id)).state, "revoked");
  assert.equal(
    (
      await s.db.control.query("SELECT revoked_at FROM sessions WHERE id=$1", [
        fresh.session,
      ])
    ).rows[0].revoked_at,
    null,
  );
});
test("retirement cancels only uncompleted commands and preserves completed results", async () => {
  const a = await account(),
    b = request(a, "pair"),
    d = (await post(b, a)).body.device;
  for (const value of ["pending", "claimed", "succeeded"])
    await s.db.control.query(
      "INSERT INTO device_commands(tenant_id,device_id,operation,payload,state,nonce,expires_at,result) VALUES($1,$2,'file.read','{}',$3,$4,now()+interval '1 hour',$5)",
      [
        a.tenant,
        d.id,
        value,
        randomUUID(),
        value === "succeeded" ? '{"kept":true}' : null,
      ],
    );
  await post(request(a, "retire", b.input), undefined, true);
  const rows = (
    await s.db.control.query(
      "SELECT state,result FROM device_commands WHERE device_id=$1 ORDER BY state",
      [d.id],
    )
  ).rows;
  assert.deepEqual(
    rows.map((r) => r.state),
    ["cancelled", "cancelled", "succeeded"],
  );
  assert.deepEqual(rows[2].result, { kept: true });
});
test("retirement hides unknown tenant existence and cannot be forged through application SQL", async () => {
  const a = await account(),
    input = { ...request(a, "pair").input, tenant_id: randomUUID() };
  assert.equal(
    (await post(request(a, "retire", input), undefined, true)).body.status,
    "retired",
  );
  await assert.rejects(
    s.db.app.query(
      "INSERT INTO desktop_pairings(user_id,id,tenant_id,family_id,input_hash,public_key,state) VALUES($1,$2,$3,$4,$5,$6,'retired')",
      [a.owner, randomUUID(), a.tenant, a.family, "a".repeat(64), pem],
    ),
    /permission denied/,
  );
  assert.equal(
    (await s.db.app.query("SELECT count(*) FROM desktop_pairings")).rows[0]
      .count,
    "0",
  );
});
test("expired grants, missing native login and strict request schemas reject before creating devices", async () => {
  const a = await account(),
    b = request(a, "pair"),
    bad = request(a, "pair", {
      ...b.input,
      grants: [{ ...b.input.grants[0], expires_at: new Date(0).toISOString() }],
    });
  assert.equal((await post(b)).status, 401);
  assert.equal((await post(bad, a)).status, 400);
  assert.equal((await post({ ...b, unexpected: true }, a)).status, 400);
  const strip = (schema: z.ZodType) => {
    const { $schema, ...body } = z.toJSONSchema(schema);
    return body;
  };
  const mirror = JSON.parse(
    await readFile("contracts/desktop-pairing-schemas.json", "utf-8"),
  );
  const normative = JSON.parse(
    await readFile(
      "../../docs/contracts/native-pairings.openapi.json",
      "utf-8",
    ),
  );
  assert.deepEqual(normative.components.schemas, mirror.schemas);
  assert.equal(
    normative["x-runtime-schema-sha256"],
    hash(await readFile("contracts/desktop-pairing-schemas.json")),
  );
  assert.deepEqual(mirror.schemas, {
    DesktopPairingRequest: strip(desktopPairingSchema),
    DesktopPairingReceipt: strip(desktopPairingReceiptSchema),
    DesktopPairingRetirement: strip(desktopPairingRetirementSchema),
  });
});
