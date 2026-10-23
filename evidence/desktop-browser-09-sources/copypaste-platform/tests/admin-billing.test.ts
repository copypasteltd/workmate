import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as OTPAuth from "otpauth";
import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../contracts/admin-billing-schemas.json" with { type: "json" };
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal } from "../src/lib.js";
import {
  billingAccount,
  fund,
  reserve,
  settle,
  setBillingAccountLimit,
} from "../src/billing.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
type Client = {
  id: string;
  email: string;
  cookie: string;
  csrf: string;
  admin?: boolean;
};
const ajv = new Ajv2020({ allErrors: true });
createRequire(import.meta.url)("ajv-formats")(ajv);
const defs = JSON.parse(
  JSON.stringify(contract.schemas).replaceAll(
    "#/components/schemas/",
    "#/$defs/",
  ),
);
function schema(name: string, value: unknown) {
  const check = ajv.compile({ $defs: defs, $ref: "#/$defs/" + name });
  assert.ok(check(value), JSON.stringify(check.errors));
}
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  options: { key?: string | null; headers?: Record<string, string> } = {},
) {
  const tenant = /^\/v1\/tenants\/([a-f0-9-]{36})/.exec(url)?.[1];
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: c?.admin ? s.db.config.ADMIN_ORIGIN : s.db.config.WEB_ORIGIN,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(options.key === null
        ? {}
        : { "idempotency-key": options.key ?? randomUUID() }),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...options.headers,
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function signIn(
  address: string,
  secret?: OTPAuth.Secret,
): Promise<Client> {
  const prefix = secret ? "/v1/admin/auth" : "/v1/auth";
  await s.db.control.query(
    "UPDATE auth_challenges SET created_at=now()-interval '2 minutes' WHERE email=$1",
    [address],
  );
  const ch = await call(undefined, "POST", prefix + "/challenge", {
    email: address,
  });
  assert.equal(ch.status, 200, JSON.stringify(ch.data));
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${ch.data.challenge_id}.json`,
      "utf8",
    ),
  );
  const r = await call(undefined, "POST", prefix + "/verify", {
    challenge_id: ch.data.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
    ...(secret
      ? {
          totp: new OTPAuth.TOTP({
            secret,
            digits: 6,
            period: 30,
            algorithm: "SHA1",
          }).generate(),
        }
      : {}),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cookie =
    r.raw.cookies.find(
      (c) => c.name === (secret ? "cp_admin_session" : "cp_session"),
    ) ?? r.raw.cookies[0];
  return {
    id: r.data.user?.id ?? r.data.admin?.id,
    email: address,
    cookie: `${cookie.name}=${cookie.value}`,
    csrf: r.data.csrf_token,
    admin: !!secret,
  };
}
async function user() {
  return signIn(`admin-directory-${randomUUID()}@example.invalid`);
}
async function admin(tenant?: string, role = "user_operator") {
  const email = `admin-directory-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 });
  const p = (
    await s.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Membership operator',$2) RETURNING id",
      [email, seal(s.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,$3,$4)",
    [p.id, role, tenant ? "tenant" : "global", tenant ?? null],
  );
  return { ...(await signIn(email, secret)), id: p.id };
}
async function workspace(o: Client) {
  const r = await call(o, "POST", "/v1/tenants", {
    name: "Admin membership authority",
    project_name: "Campaign",
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return {
    ...r.data,
    base: `/v1/admin/tenants/${r.data.tenant.id}/memberships`,
  };
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEV_MAILBOX: "true",
      WORKER_ENABLED: "false",
      AI_BASE_URL: "http://127.0.0.1:9/v1",
      AI_ALLOWED_HOSTS: "127.0.0.1",
      AI_API_KEY: "controlled-fixture",
      AI_MODEL: "controlled-fixture",
      AI_VERIFIED: "true",
      AI_INPUT_HKD_MICROS_PER_MILLION: "1000000",
      AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000",
      DEMO_MODE: "false",
    }),
    { worker: false },
  );
});
after(async () => {
  try {
    await s?.app.close();
  } finally {
    await isolated?.cleanup();
  }
});

async function bind(
  a: Client,
  permissions: string[],
  kind = "global",
  target: string | null = null,
  effect = "allow",
) {
  const role = "directory_" + randomUUID().replaceAll("-", "");
  await s.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [role, JSON.stringify(permissions)],
  );
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,$3,$4,$5)",
    [a.id, role, kind, target, effect],
  );
}

async function personal(u: Client, dataMode = "configured_services") {
  return (
    await s.db.control.query(
      "SELECT * FROM wallets WHERE user_id=$1 AND data_mode=$2",
      [u.id, dataMode],
    )
  ).rows[0];
}
async function enterprise(tenant: string) {
  return (
    await s.db.control.query("SELECT * FROM wallets WHERE tenant_id=$1", [
      tenant,
    ])
  ).rows[0];
}
const payment = (
  account: string,
  amount: string,
  kind: "top_up" | "gift" = "top_up",
) =>
  s.db.tx(
    (tx) =>
      fund(
        tx,
        {
          billing_account_id: account,
          action: kind,
          amount_micros: amount,
          reason: "Controlled fixture; no payment received",
          ...(kind === "gift"
            ? { expires_at: new Date(Date.now() + 86400000).toISOString() }
            : { reference: "fixture-" + randomUUID() }),
        },
        randomUUID(),
      ),
    undefined,
    true,
  );
async function manualTask(u: Client, w: any, payer: string, budget = 60) {
  return s.db.tx(
    async (tx) => {
      const row = (
        await tx.query(
          "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key,billing_account_id) VALUES($1,$2,$3,'Controlled task','Not executed','assistant','fixture',$4,$5,$6) RETURNING *",
          [w.tenant.id, w.project.id, u.id, budget, randomUUID(), payer],
        )
      ).rows[0];
      await reserve(tx, w.tenant.id, row.id, budget);
      return row;
    },
    w.tenant.id,
    false,
    u.id,
  );
}
const base = "/v1/admin/billing/accounts";

test("genuine personal subjects are provisioned in separate modes and only the current self account is exposed", async () => {
  const u = await user(),
    other = await user(),
    a = await personal(u),
    sim = await personal(u, "simulated");
  assert.notEqual(a.id, sim.id);
  assert.equal(a.tenant_id, null);
  const r = await call(u, "GET", "/v1/me/billing-accounts");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.items.length, 1);
  schema("AdminBillingAccount", r.data.items[0]);
  assert.equal(r.data.items[0].id, a.id);
  assert.deepEqual(r.data.items[0].subject, { kind: "user", id: u.id });
  assert.equal(
    (await call(other, "GET", "/v1/me/billing-accounts?subject_id=" + u.id))
      .status,
    400,
  );
  assert.equal(
    (await call(undefined, "GET", "/v1/me/billing-accounts")).status,
    401,
  );
  assert.equal((await call(u, "GET", base)).status, 401);
});

test("personal task holds, mixed settlement and journal events retain the actual payer, actor and source once", async () => {
  const u = await user(),
    w = await workspace(u),
    p = await personal(u),
    t = await enterprise(w.tenant.id),
    a = await admin(undefined, "super_admin");
  await payment(p.id, "80");
  await payment(p.id, "20", "gift");
  const task = await manualTask(u, w, p.id);
  await s.db.tx(
    (tx) => settle(tx, w.tenant.id, task.id, 35, u.id),
    w.tenant.id,
  );
  await s.db.tx(
    (tx) => settle(tx, w.tenant.id, task.id, 35, u.id),
    w.tenant.id,
  );
  const r = await call(a, "GET", base + "/" + p.id),
    jr = await call(a, "GET", base + "/" + p.id + "/ledger");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  schema("AdminBillingAccount", r.data);
  assert.equal(r.data.paid_balance.amount_micros, "65");
  assert.equal(r.data.promotional_balance.amount_micros, "0");
  assert.equal(r.data.reserved.amount_micros, "0");
  assert.equal(r.data.debt.amount_micros, "0");
  schema("AdminLedgerEntryList", jr.data);
  const entries = jr.data.items,
    hold = entries.find((j: any) => j.kind === "reserve"),
    charge = entries.find((j: any) => j.kind === "consume"),
    release = entries.find((j: any) => j.kind === "release");
  assert.equal(hold.actor_id, u.id);
  assert.equal(charge.actor_id, u.id);
  assert.equal(charge.source_entry_id, hold.id);
  assert.equal(release.source_entry_id, hold.id);
  assert.equal(release.amount.amount_micros, "25");
  assert.equal(entries.filter((j: any) => j.kind === "consume").length, 1);
  assert.equal(entries.filter((j: any) => j.kind === "release").length, 1);
  const facts = (
    await s.db.control.query(
      "SELECT j.id FROM billing_journal j JOIN billing_operations o ON o.id=j.operation_id AND o.actor_id=j.actor_id AND o.billing_account_id=j.billing_account_id JOIN billing_actors a ON a.id=j.actor_id WHERE j.billing_account_id=$1",
      [p.id],
    )
  ).rows;
  assert.equal(facts.length, entries.length);
  assert.deepEqual(await enterprise(w.tenant.id), t);
  const tenantLedger = await call(
    u,
    "GET",
    `/v1/tenants/${w.tenant.id}/billing`,
  );
  assert.equal(tenantLedger.status, 200, JSON.stringify(tenantLedger.data));
  assert.ok(!tenantLedger.data.ledger.some((l: any) => l.task_id === task.id));
  const legacy = await call(
    a,
    "GET",
    "/v1/admin/billing?tenant_id=" + w.tenant.id,
  );
  assert.equal(legacy.status, 200, JSON.stringify(legacy.data));
  assert.ok(!legacy.data.items.some((l: any) => l.task_id === task.id));
});

test("exact personal credit debt and repayment use the same invariants without leaking into enterprise or simulated funds", async () => {
  const u = await user(),
    w = await workspace(u),
    p = await personal(u),
    a = await admin(undefined, "super_admin");
  await s.db.tx(
    (tx) => setBillingAccountLimit(tx, p.id, "100"),
    undefined,
    true,
  );
  const task = await manualTask(u, w, p.id);
  await s.db.tx(
    (tx) => settle(tx, w.tenant.id, task.id, 40, u.id),
    w.tenant.id,
  );
  await payment(p.id, "25");
  const r = await call(a, "GET", base + "/" + p.id);
  assert.equal(r.data.debt.amount_micros, "15");
  assert.equal(r.data.paid_balance.amount_micros, "0");
  await assert.rejects(
    s.db.tx((tx) => setBillingAccountLimit(tx, p.id, "14"), undefined, true),
    (e: any) => e.code === "CREDIT_RESERVED",
  );
  const sim = await personal(u, "simulated"),
    e = await enterprise(w.tenant.id);
  assert.equal(sim.balance_micros, "0");
  assert.equal(e.balance_micros, "0");
  await payment(p.id, "9007199254740993");
  const large = await call(a, "GET", base + "/" + p.id);
  schema("AdminBillingAccount", large.data);
  assert.equal(large.data.paid_balance.amount_micros, "9007199254740978");
  assert.equal(large.data.debt.amount_micros, "0");
  assert.equal((await call(a, "GET", base + "/" + sim.id)).status, 404);
});

test("whole financial scopes exclude project-only grants and all overlapping explicit denies, including personal balances", async () => {
  const u = await user(),
    w = await workspace(u),
    w2 = await workspace(u),
    p = await personal(u),
    e = await enterprise(w.tenant.id),
    e2 = await enterprise(w2.tenant.id);
  const scoped = await admin(w.tenant.id);
  await bind(scoped, ["admin.billing.read"], "tenant", w.tenant.id);
  const scopedList = await call(scoped, "GET", base + "?subject_id=" + u.id);
  assert.equal(scopedList.status, 200);
  assert.deepEqual(scopedList.data.items, []);
  assert.equal((await call(scoped, "GET", base + "/" + e.id)).status, 200);
  assert.equal((await call(scoped, "GET", base + "/" + e2.id)).status, 404);
  assert.equal(
    (await call(scoped, "GET", base + "/" + p.id + "/ledger")).status,
    404,
  );
  const project = await admin();
  await bind(project, ["admin.billing.read"], "project", w.project.id);
  assert.deepEqual((await call(project, "GET", base)).data.items, []);
  const global = await admin(undefined, "super_admin");
  await bind(global, ["admin.billing.read"], "project", w.project.id, "deny");
  assert.equal((await call(global, "GET", base + "/" + e.id)).status, 404);
  assert.equal((await call(global, "GET", base + "/" + p.id)).status, 404);
  assert.equal((await call(global, "GET", base + "/" + e2.id)).status, 200);
  const legacy = await call(
    global,
    "GET",
    "/v1/admin/billing?tenant_id=" + w.tenant.id,
  );
  assert.equal(legacy.status, 200, JSON.stringify(legacy.data));
  assert.deepEqual(legacy.data.items, []);
  const directory = await call(global, "GET", "/v1/admin/users/" + u.id);
  assert.equal(directory.status, 200);
  assert.deepEqual(directory.data.billing_account_ids, [e2.id]);
  const denied = await admin(undefined, "super_admin");
  await bind(denied, ["admin.billing.read"], "global", null, "deny");
  assert.equal((await call(denied, "GET", base)).status, 403);
});

test("account and journal pagination binds current session, complete permissions, subject, target and insertion cutoff", async () => {
  const u = await user(),
    w = await workspace(u),
    p = await personal(u),
    a = await admin(undefined, "super_admin"),
    b = await admin(undefined, "super_admin");
  const first = await call(a, "GET", base + "?limit=1");
  schema("AdminBillingAccountList", first.data);
  assert.ok(first.data.next_cursor);
  const cursor = encodeURIComponent(first.data.next_cursor);
  assert.equal(
    (await call(b, "GET", base + "?limit=1&cursor=" + cursor)).status,
    400,
  );
  assert.equal(
    (
      await call(
        a,
        "GET",
        base + "?limit=1&subject_id=" + u.id + "&cursor=" + cursor,
      )
    ).status,
    400,
  );
  const added = await user(),
    addedId = (await personal(added)).id;
  let next = first.data.next_cursor,
    seen = [first.data.items[0].id];
  while (next) {
    const r = await call(
      a,
      "GET",
      base + "?limit=1&cursor=" + encodeURIComponent(next),
    );
    assert.equal(r.status, 200, JSON.stringify(r.data));
    seen.push(...r.data.items.map((x: any) => x.id));
    next = r.data.next_cursor;
  }
  assert.equal(new Set(seen).size, seen.length);
  assert.ok(!seen.includes(addedId));
  await payment(p.id, "10");
  await payment(p.id, "20");
  const journal = await call(a, "GET", base + "/" + p.id + "/ledger?limit=1");
  assert.ok(journal.data.next_cursor);
  const jc = encodeURIComponent(journal.data.next_cursor),
    oldIds = (
      await s.db.control.query(
        "SELECT id FROM billing_journal WHERE billing_account_id=$1",
        [p.id],
      )
    ).rows.map((x) => x.id);
  await payment(p.id, "30");
  const tail = await call(
    a,
    "GET",
    base + "/" + p.id + "/ledger?limit=1&cursor=" + jc,
  );
  assert.equal(tail.status, 200);
  assert.equal(tail.data.next_cursor, null);
  assert.ok(oldIds.includes(tail.data.items[0].id));
  assert.equal(
    (
      await call(
        a,
        "GET",
        base +
          "/" +
          (await enterprise(w.tenant.id)).id +
          "/ledger?limit=1&cursor=" +
          jc,
      )
    ).status,
    400,
  );
  await bind(a, ["admin.billing.read"], "tenant", w.tenant.id);
  assert.equal(
    (await call(a, "GET", base + "?limit=1&cursor=" + cursor)).status,
    400,
  );
});

test("task submission freezes the explicit payer in idempotency and rejects foreign or wrong-mode accounts without holds", async () => {
  const u = await user(),
    v = await user(),
    w = await workspace(u),
    p = await personal(u),
    other = await personal(v),
    sim = await personal(u, "simulated");
  await payment(p.id, "100");
  const path = `/v1/tenants/${w.tenant.id}/projects/${w.project.id}/tasks`,
    body = {
      title: "Payer test",
      prompt: "Please outline a task plan",
      role_key: "assistant",
      mode: "ask",
      budget_micros: 30,
    },
    key = randomUUID();
  const valid = await call(u, "POST", path, body, {
    key,
    headers: { "x-billing-account-id": p.id },
  });
  assert.equal(valid.status, 200, JSON.stringify(valid.data));
  const again = await call(u, "POST", path, body, {
    key,
    headers: { "x-billing-account-id": p.id },
  });
  assert.deepEqual(again.data, valid.data);
  assert.equal(
    (
      await call(u, "POST", path, body, {
        key,
        headers: { "x-billing-account-id": other.id },
      })
    ).status,
    409,
  );
  for (const id of [other.id, sim.id])
    assert.equal(
      (
        await call(u, "POST", path, body, {
          headers: { "x-billing-account-id": id },
        })
      ).status,
      404,
    );
  const tasks = (
    await s.db.control.query(
      "SELECT id,billing_account_id FROM tasks WHERE tenant_id=$1",
      [w.tenant.id],
    )
  ).rows;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].billing_account_id, p.id);
  assert.equal((await personal(u)).reserved_micros, "30");
  const unsupported = await call(
    u,
    "POST",
    "/v1/tenants",
    { name: "Must not be created", project_name: "Unsupported payer" },
    { headers: { "x-billing-account-id": p.id } },
  );
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.data.error.code, "BILLING_SELECTION_UNSUPPORTED");
  assert.equal((await enterprise(w.tenant.id)).reserved_micros, "0");
});

test("database guards forbid reassignment, forged provenance and immutable-history edits even through the control role", async () => {
  const u = await user(),
    v = await user(),
    w = await workspace(u),
    p = await personal(u),
    other = await personal(v);
  const source = await payment(p.id, "100"),
    task = await manualTask(u, w, p.id);
  for (const [sql, args] of [
    ["UPDATE wallets SET user_id=$2 WHERE id=$1", [p.id, v.id]],
    ["UPDATE wallets SET data_mode='simulated' WHERE id=$1", [p.id]],
    ["UPDATE tasks SET created_by=$2 WHERE id=$1", [task.id, v.id]],
    ["UPDATE tasks SET billing_account_id=$2 WHERE id=$1", [task.id, other.id]],
    [
      "UPDATE reservations SET billing_account_id=$2 WHERE task_id=$1",
      [task.id, other.id],
    ],
    [
      "UPDATE funding_lots SET billing_account_id=$2 WHERE ledger_id=$1",
      [source.id, other.id],
    ],
  ] as [string, unknown[]][])
    await assert.rejects(
      s.db.control.query(sql, args),
      (e: any) => e.code === "42501",
    );
  const entry = (
    await s.db.control.query("SELECT * FROM billing_journal WHERE id=$1", [
      source.id,
    ])
  ).rows[0];
  await assert.rejects(
    s.db.control.query(
      "INSERT INTO billing_journal(billing_account_id,operation_id,actor_id,kind,direction,bucket,amount_micros,reason) VALUES($1,$2,$3,'gift','credit','promotional',1,'Forged target')",
      [other.id, entry.operation_id, entry.actor_id],
    ),
    (e: any) => e.code === "23514",
  );
  for (const table of ["billing_journal", "billing_operations"])
    await assert.rejects(
      s.db.control.query(`UPDATE ${table} SET actor_id=$2 WHERE id=$1`, [
        table === "billing_journal" ? entry.id : entry.operation_id,
        v.id,
      ]),
      (e: any) => e.code === "42501",
    );
  const hidden = await s.db.tx(
    (tx) =>
      tx.query("SELECT id FROM billing_journal WHERE billing_account_id=$1", [
        p.id,
      ]),
    undefined,
    false,
    v.id,
  );
  assert.equal(hidden.rowCount, 0);
});

test("unrecorded historical provenance is explicit and never replaced by invented response identities", async () => {
  const u = await user(),
    p = await personal(u),
    a = await admin(undefined, "super_admin"),
    entry = await payment(p.id, "10");
  await s.db.control.query(
    "INSERT INTO billing_provenance_gaps(ledger_id,billing_account_id,reason) VALUES($1,$2,'Controlled historical gap fixture')",
    [entry.id, p.id],
  );
  const r = await call(a, "GET", base + "/" + p.id + "/ledger");
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, "BILLING_PROVENANCE_UNRECORDED");
  assert.equal((await call(a, "GET", base + "/" + p.id)).status, 200);
});
