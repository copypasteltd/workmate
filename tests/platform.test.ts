import { isolatedTestEnvironment } from "./native-test-environment.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  mkdir,
  writeFile,
  stat,
  utimes,
  symlink,
  unlink,
  readdir as readdirForTest,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import * as OTPAuth from "otpauth";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal, hash } from "../src/lib.js";
import { reserve, settle, tokenCharge, wallet } from "../src/billing.js";
import { metrics, parseMetricsCSV } from "../src/analytics.js";
import { renderPoster } from "../src/business.js";
import { ErasureService } from "../src/erasure.js";
import { saveAsset } from "../src/storage.js";
import { cleanUploadStaging } from "../src/uploads.js";
import { dispatchInvitationMail } from "../src/invitation-delivery.js";
import { RetentionService } from "../src/retention.js";
import { recoverQueuedClaims } from "../src/task-recovery.js";
import { PgBoss } from "pg-boss";
let system: Awaited<ReturnType<typeof buildApp>>;
const origin = "http://localhost:4317",
  adminOrigin = "http://localhost:4318";
interface Client {
  cookie: string;
  csrf: string;
  id: string;
  email: string;
  admin?: boolean;
}
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  idempotency = randomUUID(),
  headers: Record<string, string> = {},
) {
  const r = await system.app.inject({
    method: method as any,
    url,
    headers: {
      origin: c?.admin ? adminOrigin : origin,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      "idempotency-key": idempotency,
      ...(url.match(/^\/v1\/tenants\/([a-f0-9-]{36})/)
        ? { "x-tenant-id": url.split("/")[3] }
        : {}),
      ...headers,
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
    ...(body !== undefined
      ? {
          headers: {
            origin: c?.admin ? adminOrigin : origin,
            ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
            "idempotency-key": idempotency,
            ...(url.match(/^\/v1\/tenants\/([a-f0-9-]{36})/)
              ? { "x-tenant-id": url.split("/")[3] }
              : {}),
            "content-type": "application/json",
            ...headers,
          },
        }
      : {}),
  });
  let data: any;
  try {
    data = r.json();
  } catch {
    data = r.body;
  }
  return { status: r.statusCode, data, raw: r };
}
async function code(address: string, admin = false) {
  const prefix = admin ? "/v1/admin/auth" : "/v1/auth";
  const c = await call(undefined, "POST", prefix + "/challenge", {
    email: address,
  });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const m = JSON.parse(
    await readFile(
      `${system.db.config.DATA_DIR}/mailbox/${c.data.challenge_id}.json`,
      "utf8",
    ),
  );
  return {
    challenge_id: c.data.challenge_id,
    code: m.text.match(/\b\d{6}\b/)[0],
  };
}
async function user() {
  const address = `test-${randomUUID()}@example.invalid`;
  const c = await code(address);
  const v = await call(undefined, "POST", "/v1/auth/verify", c);
  assert.equal(v.status, 200, JSON.stringify(v.data));
  return {
    cookie: v.raw.cookies[0].name + "=" + v.raw.cookies[0].value,
    csrf: v.data.csrf_token,
    id: v.data.user.id,
    email: address,
  } as Client;
}
async function admin(role = "super_admin", scope?: string) {
  const address = `admin-${randomUUID()}@example.invalid`;
  const secret = new OTPAuth.Secret({ size: 20 });
  const p = (
    await system.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id",
      [address, role, seal(system.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,$3,$4)",
    [p.id, role, scope ? "tenant" : "global", scope ?? null],
  );
  const c = await code(address, true);
  const otp = new OTPAuth.TOTP({
    secret,
    digits: 6,
    period: 30,
    algorithm: "SHA1",
  }).generate();
  const v = await call(undefined, "POST", "/v1/admin/auth/verify", {
    ...c,
    totp: otp,
  });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  return {
    cookie: v.raw.cookies[0].name + "=" + v.raw.cookies[0].value,
    csrf: v.data.csrf_token,
    id: p.id,
    email: address,
    admin: true,
  } as Client;
}
async function workspace(c: Client) {
  const r = await call(c, "POST", "/v1/tenants", {
    name: "QA workspace",
    project_name: "QA campaign",
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function verifiedTopUp(
  a: Client,
  reviewer: Client,
  owner: Client,
  w: any,
  amount: string,
  reference: string,
) {
  const evidence = await system.db.tx(
    (tx) =>
      saveAsset(tx, system.storage, {
        tenant: w.tenant.id,
        project: w.project.id,
        user: owner.id,
        name: "Controlled payment receipt.txt",
        mime: "text/plain",
        bytes: Buffer.from(
          "Controlled receipt; no actual money received: " + reference,
        ),
      }),
    w.tenant.id,
  );
  const account = (
    await system.db.control.query(
      "SELECT id,version FROM wallets WHERE tenant_id=$1",
      [w.tenant.id],
    )
  ).rows[0];
  const receipt = {
    billing_account_id: account.id,
    external_reference: reference,
    amount: { currency: "HKD", amount_micros: amount },
    received_at: new Date(Date.now() - 1000).toISOString(),
    evidence_asset_version_id: evidence.version.id,
    reason: "Controlled evidence; no actual money received",
  };
  const recorded = await call(a, "POST", "/v1/admin/billing/payments", receipt);
  assert.equal(recorded.status, 202, JSON.stringify(recorded.data));
  const payment = recorded.data.result_ids[0];
  const confirmed = await call(
    reviewer,
    "POST",
    `/v1/admin/billing/payments/${payment}/confirmations`,
    {
      expected_version: 1,
      verified_reference: reference,
      reason: "Independent review of controlled payment evidence",
    },
  );
  assert.equal(confirmed.status, 202, JSON.stringify(confirmed.data));
  return {
    account,
    receipt,
    command: {
      action: "top_up",
      expected_version: account.version,
      amount: receipt.amount,
      payment_record_id: payment,
      reason: "Post independently verified controlled receipt",
    },
  };
}
async function money(a: Client, b: unknown, k = randomUUID()) {
  const old = b as any;
  if (
    ["billing.gift", "billing.debit", "billing.credit_limit.write"].includes(
      old.action,
    )
  ) {
    const w = (
      await system.db.control.query(
        "SELECT id,version FROM wallets WHERE tenant_id=$1",
        [old.tenant_id],
      )
    ).rows[0];
    const action =
      old.action === "billing.credit_limit.write"
        ? "credit_limit"
        : old.action.split(".")[1];
    const body = {
      action,
      expected_version: w.version,
      reason: old.reason,
      ...(action === "credit_limit"
        ? {
            new_limit: {
              currency: "HKD",
              amount_micros: String(old.amount_micros),
            },
          }
        : {
            amount: {
              currency: "HKD",
              amount_micros: String(old.amount_micros),
            },
          }),
      ...(action === "gift" ? { expires_at: old.expires_at } : {}),
      ...(action === "debit" ? { original_entry_id: old.source_id } : {}),
    };
    const pv = await call(
      a,
      "POST",
      `/v1/admin/billing/accounts/${w.id}/previews`,
      body,
    );
    assert.equal(pv.status, 200, JSON.stringify(pv.data));
    return call(
      a,
      "POST",
      `/v1/admin/billing/accounts/${w.id}/${action === "credit_limit" ? "credit-limit" : action}`,
      body,
      k,
      { "X-Admin-Preview-ID": pv.data.preview_id },
    );
  }
  const p = await call(a, "POST", "/v1/admin/operations/preview", b);
  assert.equal(p.status, 200, JSON.stringify(p.data));
  return call(
    a,
    "POST",
    "/v1/admin/operations/commit",
    { preview_id: p.data.id, payload_hash: p.data.payload_hash },
    k,
  );
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  const env = { ...isolated.env };
  const c = loadConfig({ ...env, NODE_ENV: "test", WORKER_ENABLED: "false" });
  system = await buildApp(c, { worker: false });
});
after(async () => {
  try {
    await system.app.close();
  } finally {
    await isolated?.cleanup();
  }
});

test("Admin cleanup pages filter before counting, retain tied timestamp order and redact journal internals", async () => {
  const u = await user(),
    w = await workspace(u),
    a = await admin(),
    rows: { id: string; target: string; state: string; type: string }[] = [];
  for (let i = 0; i < 58; i++) {
    const row = {
      id: randomUUID(),
      target: randomUUID(),
      state: i % 3 ? "completed" : "failed",
      type: i % 2 ? "workspace_nodes" : "assets",
    };
    rows.push(row);
    await system.db.control.query(
      "INSERT INTO deletion_jobs(id,tenant_id,project_id,target_type,target_id,state,private_owner,created_by,lease_token,created_at,next_attempt_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,'2026-01-01','2100-01-01')",
      [
        row.id,
        w.tenant.id,
        w.project.id,
        row.type,
        row.target,
        row.state,
        u.id,
        randomUUID(),
      ],
    );
  }
  const failed = rows.find((row) => row.state === "failed")!;
  await system.db.control.query(
    "INSERT INTO deletion_items(job_id,kind,locator,state,error_code,attempts) VALUES($1,'object','private-store/not-for-admin','failed','ERASURE_STORAGE_BUSY',3),($1,'object','private-store/removed','completed',NULL,1)",
    [failed.id],
  );
  const url = `/v1/admin/deletions?tenant_id=${w.tenant.id}`,
    first = await call(a, "GET", url),
    second = await call(a, "GET", url + "&page=2");
  assert.equal(first.status, 200);
  assert.equal(first.data.page_size, 50);
  assert.equal(first.data.total, 58);
  assert.equal(first.data.items.length, 50);
  assert.equal(second.data.items.length, 8);
  assert.deepEqual(
    [...first.data.items, ...second.data.items].map((row: any) => row.id),
    rows
      .map((row) => row.id)
      .sort()
      .reverse(),
  );
  const filtered = await call(
      a,
      "GET",
      url + "&state=failed&target_type=assets&page_size=100",
    ),
    expected = rows.filter(
      (row) => row.state === "failed" && row.type === "assets",
    );
  assert.equal(filtered.data.total, expected.length);
  assert.deepEqual(
    filtered.data.items.map((row: any) => row.id),
    expected
      .map((row) => row.id)
      .sort()
      .reverse(),
  );
  const target = await call(
    a,
    "GET",
    url + "&search=" + failed.target.toUpperCase(),
  );
  assert.equal(target.data.total, 1);
  assert.deepEqual(target.data.items[0].progress, { total: 2, completed: 1 });
  assert.equal(
    target.data.items[0].failures[0].error_code,
    "ERASURE_STORAGE_BUSY",
  );
  const encoded = JSON.stringify(target.data);
  for (const forbidden of [
    "locator",
    "private-store",
    "private_owner",
    "created_by",
    "lease_token",
    "lease_until",
    "storage_key",
  ])
    assert.ok(!encoded.includes(forbidden), forbidden);
  assert.equal(
    (await call(a, "GET", url + "&search=" + failed.id)).data.total,
    1,
  );
  assert.equal((await call(a, "GET", url + "&search=%25")).data.total, 0);
  assert.equal(
    (await call(a, "GET", url + "&page=10000")).data.items.length,
    0,
  );
  for (const suffix of [
    "&state=invalid",
    "&target_type=users",
    "&page_size=101",
    "&page=10001",
    "&search=" + "a".repeat(161),
    "&include_private=true",
  ])
    assert.equal((await call(a, "GET", url + suffix)).status, 400, suffix);
});

test("Admin cleanup totals and retries enforce current tenant/project grants, denies and read-only access", async () => {
  const u = await user(),
    w = await workspace(u),
    other = await workspace(u),
    allowed = await admin("support_agent", w.tenant.id),
    denied = await admin("auditor"),
    superAdmin = await admin();
  const secondProject = (
    await call(u, "POST", `/v1/tenants/${w.tenant.id}/projects`, {
      name: "Another cleanup scope",
    })
  ).data;
  assert.ok(secondProject.id);
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const [index, tenant, project] of [
    [0, w.tenant.id, w.project.id],
    [1, w.tenant.id, secondProject.id],
    [2, other.tenant.id, other.project.id],
  ] as const) {
    await system.db.control.query(
      "INSERT INTO deletion_jobs(id,tenant_id,project_id,target_type,target_id,state,next_attempt_at) VALUES($1,$2,$3,'assets',$4,'failed','2100-01-01')",
      [ids[index], tenant, project, randomUUID()],
    );
  }
  const before = await call(allowed, "GET", "/v1/admin/deletions");
  assert.equal(before.data.total, 2);
  assert.equal(before.data.page_size, 50);
  assert.equal(
    (
      await call(
        allowed,
        "GET",
        `/v1/admin/deletions?tenant_id=${other.tenant.id}`,
      )
    ).data.total,
    0,
  );
  assert.equal(
    (await call(denied, "GET", "/v1/admin/deletions")).data.total,
    0,
  );
  assert.equal((await call(u, "GET", "/v1/admin/deletions")).status, 401);
  assert.equal(
    (
      await call(allowed, "POST", `/v1/admin/deletions/${ids[0]}/retry`, {
        reason: "Read-only access cannot retry",
      })
    ).status,
    403,
  );
  const role = "cleanup_read_" + randomUUID().replaceAll("-", "");
  await system.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [role, JSON.stringify(["admin.content.read"])],
  );
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')",
    [allowed.id, role, w.project.id],
  );
  const after = await call(allowed, "GET", "/v1/admin/deletions");
  assert.equal(after.data.total, 1);
  assert.equal(after.data.items[0].id, ids[1]);
  assert.equal(
    (await call(allowed, "GET", `/v1/admin/deletions?search=${ids[0]}`)).data
      .total,
    0,
  );
  await system.db.control.query(
    "UPDATE admin_bindings SET expires_at=now()-interval '1 second' WHERE principal_id=$1 AND effect='allow'",
    [allowed.id],
  );
  assert.equal(
    (await call(allowed, "GET", "/v1/admin/deletions")).data.total,
    0,
  );
  assert.equal(
    (
      await call(
        superAdmin,
        "GET",
        `/v1/admin/deletions?tenant_id=${w.tenant.id}`,
      )
    ).data.total,
    2,
  );
});

test("Admin collection defaults consistently use 50 rows and cap explicit page sizes at 100", async () => {
  const a = await admin();
  const prefix = "Collection limit " + randomUUID();
  await system.db.control.query(
    "INSERT INTO users(email,name) SELECT gen_random_uuid()::text||'@example.invalid',$1||n::text FROM generate_series(1,51) n",
    [prefix],
  );
  const tenants = (
    await system.db.control.query(
      "INSERT INTO tenants(name) SELECT $1||n::text FROM generate_series(1,51) n RETURNING id",
      [prefix],
    )
  ).rows;
  await system.db.control.query(
    "INSERT INTO wallets(tenant_id) SELECT unnest($1::uuid[])",
    [tenants.map((r) => r.id)],
  );
  for (const resource of ["users", "tenants"]) {
    const url = "/v1/admin/" + resource + "?q=" + encodeURIComponent(prefix),
      list = await call(a, "GET", url);
    assert.equal(list.status, 200, JSON.stringify(list.data));
    assert.equal(list.data.items.length, 50);
    assert.ok(list.data.next_cursor);
    assert.equal(list.data.page_size, undefined);
    assert.equal(list.data.total, undefined);
    const explicit = await call(a, "GET", url + "&limit=100");
    assert.equal(explicit.status, 200);
    assert.equal(explicit.data.items.length, 51);
    assert.equal(explicit.data.next_cursor, null);
    assert.equal((await call(a, "GET", url + "&limit=101")).status, 400);
  }
  for (const url of [
    "/v1/admin/access/principals",
    "/v1/admin/workflow-schedules",
    "/v1/admin/deletions",
    "/v1/admin/content",
  ]) {
    const list = await call(a, "GET", url);
    assert.equal(list.status, 200, url);
    assert.equal(list.data.page_size, 50, url);
    assert.ok(list.data.items.length <= 50, url);
    assert.equal(
      (await call(a, "GET", url + "?page_size=100")).data.page_size,
      100,
      url,
    );
    assert.equal(
      (await call(a, "GET", url + "?page_size=101")).status,
      400,
      url,
    );
  }
});

test("retention expires online content through the durable journal, prunes old events/results without replaying effects, and preserves money/audit", async () => {
  const u = await user(),
    w = await workspace(u),
    tenant = w.tenant.id,
    project = w.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  const make = () =>
    system.db.tx(
      (tx) =>
        saveAsset(tx, system.storage, {
          tenant,
          project,
          user: u.id,
          name: "Retained content.txt",
          mime: "text/plain",
          bytes: Buffer.from("Retention fixture"),
        }),
      tenant,
      true,
    );
  const expired = await make(),
    fresh = await make();
  await system.db.control.query(
    "UPDATE assets SET retention_expires_at=now()-interval '1 second' WHERE id=ANY($1::uuid[])",
    [[expired.id, fresh.id]],
  );
  await system.db.tx(
    (tx) =>
      saveAsset(tx, system.storage, {
        tenant,
        project,
        user: u.id,
        name: "New immutable version.txt",
        mime: "text/plain",
        bytes: Buffer.from("Version renews retention"),
        asset: fresh.id,
        expectedVersion: 1,
      }),
    tenant,
    true,
  );
  const terminal = randomUUID(),
    running = randomUUID();
  for (const [id, status] of [
    [terminal, "succeeded"],
    [running, "running"],
  ])
    await system.db.control.query(
      "INSERT INTO tasks(id,tenant_id,project_id,created_by,title,prompt,role_key,role_hash,status,budget_micros,idempotency_key,retention_expires_at) VALUES($1,$2,$3,$4,'Expiry fixture','Expired private input','fullstack','fixture',$5,10000,$6,now()-interval '1 day')",
      [id, tenant, project, u.id, status, randomUUID()],
    );
  const oldEvent = (
    await system.db.control.query(
      "INSERT INTO task_events(tenant_id,task_id,kind,body,created_at) VALUES($1,$2,'fixture.old','{\"text\":\"old text\"}',now()-interval '31 days') RETURNING id,seq",
      [tenant, terminal],
    )
  ).rows[0];
  const recentEvent = (
    await system.db.control.query(
      "INSERT INTO task_events(tenant_id,task_id,kind,body,created_at) VALUES($1,$2,'fixture.recent','{}',now()-interval '29 days') RETURNING id",
      [tenant, running],
    )
  ).rows[0].id;
  const memory = (
    await system.db.control.query(
      "INSERT INTO memories(tenant_id,project_id,scope,name,created_by,expires_at) VALUES($1,$2,'project','Expired memory',$3,now()-interval '1 second') RETURNING id",
      [tenant, project, u.id],
    )
  ).rows[0].id;
  const dataset = (
    await system.db.control.query(
      "INSERT INTO analytics_datasets(tenant_id,project_id,name,rows,source,created_by,retention_expires_at) VALUES($1,$2,'Expired report','[]','fixture',$3,now()-interval '1 second') RETURNING id",
      [tenant, project, u.id],
    )
  ).rows[0].id;
  const k = randomUUID();
  await system.db.control.query(
    "INSERT INTO request_replays(actor_id,action,key,input_hash,response,created_at) VALUES($1,$2,$3,'expired','{\"private\":\"old request result\"}',now()-interval '8 days')",
    [u.id, `task.create:${project}`, k],
  );
  const moneyId = (
    await system.db.control.query(
      "INSERT INTO ledger(tenant_id,user_id,kind,amount_micros,idempotency_key,reason,created_at) VALUES($1,$2,'gift',1,$3,'Retained finance fixture',now()-interval '400 days') RETURNING id",
      [tenant, u.id, randomUUID()],
    )
  ).rows[0].id;
  const service = new RetentionService(system.db, system.storage);
  const [first, second] = await Promise.all([
    service.expireContent(1000),
    service.expireContent(1000),
  ]);
  assert.ok(first || second);
  assert.equal(
    (
      await system.db.control.query("SELECT state FROM assets WHERE id=$1", [
        expired.id,
      ])
    ).rows[0].state,
    "deleted",
  );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT state,retention_expires_at>now()+interval '89 days' AS renewed FROM assets WHERE id=$1",
        [fresh.id],
      )
    ).rows[0].renewed,
    true,
  );
  assert.equal(
    (
      await system.db.control.query("SELECT state FROM assets WHERE id=$1", [
        fresh.id,
      ])
    ).rows[0].state,
    "active",
  );
  for (const [table, id] of [
    ["tasks", terminal],
    ["memories", memory],
    ["analytics_datasets", dataset],
  ])
    assert.equal(
      (
        await system.db.control.query(
          `SELECT content_state FROM ${table} WHERE id=$1`,
          [id],
        )
      ).rows[0].content_state,
      "deleted",
    );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT content_state FROM tasks WHERE id=$1",
        [running],
      )
    ).rows[0].content_state,
    "active",
  );
  assert.equal(
    (
      await system.db.control.query("SELECT 1 FROM task_events WHERE id=$1", [
        oldEvent.id,
      ])
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await system.db.control.query("SELECT 1 FROM task_events WHERE id=$1", [
        recentEvent,
      ])
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT pruned_through FROM task_event_retention WHERE task_id=$1",
        [terminal],
      )
    ).rows[0].pruned_through,
    oldEvent.seq,
  );
  assert.equal(
    (
      await call(
        u,
        "POST",
        base + "/tasks",
        {
          title: "Do not re-run",
          prompt:
            "An expired accepted request must never execute a second time",
          role_key: "fullstack",
          budget_micros: 10000,
        },
        k,
      )
    ).status,
    410,
  );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT response FROM request_replays WHERE actor_id=$1 AND key=$2",
        [u.id, k],
      )
    ).rows[0].response.private,
    undefined,
  );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT amount_micros FROM ledger WHERE id=$1",
        [moneyId],
      )
    ).rows[0].amount_micros,
    "1",
  );
  const job = (
    await system.db.control.query(
      "SELECT id FROM deletion_jobs WHERE target_type='assets' AND target_id=$1",
      [expired.id],
    )
  ).rows[0];
  assert.ok(job);
  const eraser = new ErasureService(system.db, system.storage);
  await eraser.advance(1000);
  assert.equal(
    (
      await system.db.control.query(
        "SELECT state FROM deletion_jobs WHERE id=$1",
        [job.id],
      )
    ).rows[0].state,
    "completed",
  );
});

test("terminal runtime cache cleanup waits for a live process, persists I/O failures and resumes without deleting task results", async () => {
  const u = await user(),
    w = await workspace(u),
    tenant = w.tenant.id,
    project = w.project.id,
    id = randomUUID();
  await system.db.control.query(
    "INSERT INTO tasks(id,tenant_id,project_id,created_by,title,prompt,role_key,role_hash,status,output,budget_micros,idempotency_key) VALUES($1,$2,$3,$4,'Finished fixture','private input','fullstack','fixture','succeeded','Business result survives',10000,$5)",
    [id, tenant, project, u.id, randomUUID()],
  );
  const dir = path.resolve(system.db.config.DATA_DIR, "runs", tenant, id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "request.json"), "private runtime input");
  await system.db.control.query(
    "UPDATE runtime_cache_purges SET next_attempt_at=now()-interval '1 day' WHERE task_id=$1",
    [id],
  );
  let active = true;
  const service = new RetentionService(
    system.db,
    system.storage,
    (candidate) => candidate === id && active,
  );
  await service.purgeRuntime();
  assert.ok(await stat(dir));
  active = false;
  const original = system.storage.removeRuntime.bind(system.storage);
  let failures = 1;
  system.storage.removeRuntime = async (t, task) => {
    if (task === id && failures--)
      throw Object.assign(new Error("Injected busy fixture"), {
        code: "EBUSY",
      });
    return original(t, task);
  };
  try {
    await service.purgeRuntime();
    assert.equal(
      (
        await system.db.control.query(
          "SELECT error_code FROM runtime_cache_purges WHERE task_id=$1",
          [id],
        )
      ).rows[0].error_code,
      "RUNTIME_CACHE_BUSY",
    );
  } finally {
    system.storage.removeRuntime = original;
  }
  await system.db.control.query(
    "UPDATE runtime_cache_purges SET next_attempt_at=now()-interval '1 day' WHERE task_id=$1",
    [id],
  );
  await Promise.all([service.purgeRuntime(), service.purgeRuntime()]);
  await assert.rejects(stat(dir), { code: "ENOENT" });
  assert.equal(
    (
      await system.db.control.query(
        "SELECT state FROM runtime_cache_purges WHERE task_id=$1",
        [id],
      )
    ).rows[0].state,
    "completed",
  );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT output,content_state FROM tasks WHERE id=$1",
        [id],
      )
    ).rows[0].output,
    "Business result survives",
  );
});

test(
  "SSE replays durable task-local sequences exactly, rejects stale/foreign cursors and closes on session revocation",
  { timeout: 30000 },
  async () => {
    const u = await user(),
      other = await user(),
      w = await workspace(u),
      tenant = w.tenant.id,
      project = w.project.id,
      id = randomUUID();
    await system.db.control.query(
      "INSERT INTO tasks(id,tenant_id,project_id,created_by,private_owner,title,prompt,role_key,role_hash,budget_micros,idempotency_key) VALUES($1,$2,$3,$4,$4,'Event fixture','Private prompt never in progress metadata','fullstack','fixture',10000,$5)",
      [id, tenant, project, u.id, randomUUID()],
    );
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        system.db.control.query(
          "INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,'message.delta',$3)",
          [tenant, id, { text: `fragment ${i}` }],
        ),
      ),
    );
    const stored = (
      await system.db.control.query(
        "SELECT * FROM task_events WHERE task_id=$1 ORDER BY seq",
        [id],
      )
    ).rows;
    assert.deepEqual(
      stored.map((e) => Number(e.seq)),
      Array.from({ length: 10 }, (_, i) => i + 1),
    );
    const address = system.app.server.listening
      ? "http://127.0.0.1:" + (system.app.server.address() as any).port
      : await system.app.listen({ host: "127.0.0.1", port: 0 });
    const url = address + `/v1/tasks/${id}/events`,
      headers = { cookie: u.cookie, "X-Tenant-ID": tenant };
    const readEvents = async (after: number, n: number) => {
      const abort = new AbortController(),
        timer = setTimeout(() => abort.abort(), 5000);
      try {
        const r = await fetch(url, {
          headers: { ...headers, "Last-Event-ID": String(after) },
          signal: abort.signal,
        });
        assert.equal(r.status, 200);
        assert.match(r.headers.get("content-type")!, /text\/event-stream/);
        const reader = r.body!.getReader(),
          events: any[] = [];
        let text = "";
        try {
          while (events.length < n) {
            const chunk = await reader.read();
            if (chunk.done) break;
            text += new TextDecoder().decode(chunk.value);
            const frames = text.split("\n\n");
            text = frames.pop()!;
            for (const frame of frames) {
              const data = frame
                .split("\n")
                .find((l) => l.startsWith("data: "));
              if (data) events.push(JSON.parse(data.slice(6)));
            }
          }
        } finally {
          await reader.cancel();
        }
        return events;
      } finally {
        clearTimeout(timer);
        abort.abort();
      }
    };
    const first = await readEvents(0, 10);
    assert.deepEqual(
      first.map((e) => e.event_id),
      stored.map((e) => e.event_id),
    );
    assert.ok(
      first.every(
        (e) =>
          e.type === "message.appended" &&
          e.attempt_id &&
          e.tenant_id === tenant,
      ),
    );
    const replayed = await readEvents(6, 4);
    assert.deepEqual(
      replayed.map((e) => e.seq),
      [7, 8, 9, 10],
    );
    assert.equal(
      (
        await fetch(url, {
          headers: { ...headers, "X-Tenant-ID": randomUUID() },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(url, {
          headers: { cookie: other.cookie, "X-Tenant-ID": tenant },
        })
      ).status,
      404,
    );
    assert.equal(
      (await fetch(url, { headers: { ...headers, "Last-Event-ID": "11" } }))
        .status,
      409,
    );
    await system.db.control.query(
      "INSERT INTO task_event_retention(task_id,tenant_id,pruned_through) VALUES($1,$2,3)",
      [id, tenant],
    );
    const expired = await fetch(url, {
      headers: { ...headers, "Last-Event-ID": "2" },
    });
    assert.equal(expired.status, 410);
    assert.equal(
      ((await expired.json()) as any).error.code,
      "EVENT_CURSOR_EXPIRED",
    );
    const live = await fetch(url, {
        headers: { ...headers, "Last-Event-ID": "10" },
        signal: AbortSignal.timeout(5000),
      }),
      reader = live.body!.getReader();
    await system.db.control.query(
      "UPDATE sessions SET revoked_at=now() WHERE user_id=$1",
      [u.id],
    );
    let final = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        final += new TextDecoder().decode(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    assert.match(final, /stream.reset/);
    assert.match(final, /SESSION_EXPIRED/);
    assert.doesNotMatch(final, /Private prompt/);
  },
);

test("queued claim recovery checks real queue state, deduplicates repair, preserves running work and releases exhausted pre-execution reservations", async () => {
  const u = await user(),
    w = await workspace(u),
    tenant = w.tenant.id,
    project = w.project.id,
    ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const boss = new PgBoss({
    connectionString: system.db.config.QUEUE_DATABASE_URL,
    schema: "pgboss",
  });
  await boss.start();
  await boss.createQueue("task.run", { retryLimit: 0 });
  try {
    await system.db.control.query(
      "UPDATE wallets SET credit_limit_micros=1000000 WHERE tenant_id=$1",
      [tenant],
    );
    for (const [index, id] of ids.entries()) {
      await system.db.control.query(
        "INSERT INTO tasks(id,tenant_id,project_id,created_by,title,prompt,role_key,role_hash,status,budget_micros,idempotency_key,next_claim_retry_at,claim_retry_count) VALUES($1,$2,$3,$4,'Claim recovery fixture','No model has been accepted','fullstack','fixture',$5,10000,$6,now()-interval '400 days',$7)",
        [
          id,
          tenant,
          project,
          u.id,
          index === 2 ? "running" : "queued",
          randomUUID(),
          index === 3 ? 8 : 0,
        ],
      );
      const job = await boss.send(
        "task.run",
        { tenant, task: id },
        { retryLimit: 0 },
      );
      if (index !== 1)
        await boss.fail("task.run", job!, {
          code: "INJECTED_PRE_CLAIM_FAILURE",
        });
      await system.db.control.query(
        "INSERT INTO outbox(tenant_id,topic,payload,dispatched_at,queue_job_id) VALUES($1,'task.run',$2,now()-interval '1 minute',$3)",
        [tenant, { task_id: id }, job],
      );
    }
    await system.db.tx(
      (tx) => reserve(tx, tenant, ids[3], 10000),
      tenant,
      true,
    );
    await Promise.all([
      recoverQueuedClaims(system.db),
      recoverQueuedClaims(system.db),
    ]);
    assert.equal(
      (
        await system.db.control.query(
          "SELECT count(*)::int AS n FROM outbox WHERE payload->>'task_id'=$1 AND dispatched_at IS NULL",
          [ids[0]],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await system.db.control.query(
          "SELECT claim_retry_count FROM tasks WHERE id=$1",
          [ids[0]],
        )
      ).rows[0].claim_retry_count,
      1,
    );
    assert.equal(
      (
        await system.db.control.query(
          "SELECT claim_retry_count FROM tasks WHERE id=$1",
          [ids[1]],
        )
      ).rows[0].claim_retry_count,
      0,
    );
    assert.equal(
      (
        await system.db.control.query("SELECT status FROM tasks WHERE id=$1", [
          ids[2],
        ])
      ).rows[0].status,
      "running",
    );
    assert.equal(
      (
        await system.db.control.query("SELECT status FROM tasks WHERE id=$1", [
          ids[3],
        ])
      ).rows[0].status,
      "failed",
    );
    assert.equal(
      (
        await system.db.control.query(
          "SELECT status FROM reservations WHERE task_id=$1",
          [ids[3]],
        )
      ).rows[0].status,
      "released",
    );
    // All three table shapes share the renewal function. The running transition
    // must compile without attempting to access creative-only fields.
    await system.db.control.query(
      "UPDATE tasks SET status='running' WHERE id=$1",
      [ids[0]],
    );
    await system.db.control.query(
      "UPDATE tasks SET status='succeeded' WHERE id=$1",
      [ids[0]],
    );
    assert.equal(
      (
        await system.db.control.query(
          "SELECT retention_expires_at>now()+interval '89 days' AS renewed FROM tasks WHERE id=$1",
          [ids[0]],
        )
      ).rows[0].renewed,
      true,
    );
    const creative = (
      await system.db.control.query(
        "INSERT INTO creative_projects(tenant_id,project_id,name,kind,body,created_by,retention_expires_at) VALUES($1,$2,'Renewal fixture','poster','{}',$3,now()-interval '1 day') RETURNING id",
        [tenant, project, u.id],
      )
    ).rows[0].id;
    await system.db.control.query(
      "UPDATE creative_projects SET body='{\"changed\":true}' WHERE id=$1",
      [creative],
    );
    assert.equal(
      (
        await system.db.control.query(
          "SELECT retention_expires_at>now()+interval '89 days' AS renewed FROM creative_projects WHERE id=$1",
          [creative],
        )
      ).rows[0].renewed,
      true,
    );
  } finally {
    await boss.stop({ graceful: true, timeout: 1000 });
  }
});

test("permanent asset deletion blocks admin resurrection, body/download and cross-tenant status; erases all versions while preserving a published copy", async () => {
  const u = await user(),
    a = await admin(),
    stranger = await user(),
    w = await workspace(u);
  const create = (asset?: string) =>
    system.db.tx(
      (tx) =>
        saveAsset(tx, system.storage, {
          tenant: w.tenant.id,
          project: w.project.id,
          user: u.id,
          name: "erasure-sensitive.txt",
          mime: "text/plain",
          bytes: Buffer.from("erase private customer content"),
          asset,
          expectedVersion: asset ? 1 : undefined,
        }),
      w.tenant.id,
    );
  const file = await create();
  await create(file.id);
  const publishedCopy = await create();
  const versions = (
    await system.db.control.query(
      "SELECT storage_key FROM asset_versions WHERE asset_id=$1",
      [file.id],
    )
  ).rows;
  for (const [i, action] of ["quarantine", "restore", "delete"].entries()) {
    const r = await call(a, "POST", `/v1/admin/content/${file.id}/action`, {
      action,
      version: i + 1,
      reason: "Test deletion lifecycle",
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    if (action === "delete") assert.ok(r.data.deletion_id);
  }
  for (const action of ["restore", "metadata", "quarantine"]) {
    const r = await call(a, "POST", `/v1/admin/content/${file.id}/action`, {
      action,
      version: 4,
      reason: "Try deleted content",
      ...(action === "metadata" ? { name: "resurrect.txt" } : {}),
    });
    assert.equal(r.status, 409);
    assert.equal(r.data.error.code, "CONTENT_DELETED");
  }
  assert.equal(
    (await call(a, "GET", `/v1/admin/content/${file.id}/body`)).status,
    410,
  );
  assert.equal(
    (await call(a, "GET", `/v1/admin/content/${file.id}/download`)).status,
    410,
  );
  const job = (
    await system.db.control.query(
      "SELECT * FROM deletion_jobs WHERE target_id=$1",
      [file.id],
    )
  ).rows[0];
  assert.equal(
    (
      await call(u, "GET", `/v1/deletions/${job.id}`, undefined, randomUUID(), {
        "x-tenant-id": w.tenant.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        stranger,
        "GET",
        `/v1/deletions/${job.id}`,
        undefined,
        randomUUID(),
        { "x-tenant-id": w.tenant.id },
      )
    ).status,
    404,
  );
  await system.db.control.query(
    "UPDATE deletion_jobs SET next_attempt_at='2000-01-01' WHERE id=$1",
    [job.id],
  );
  await new ErasureService(system.db, system.storage).advance(1);
  assert.equal(
    (
      await system.db.control.query(
        "SELECT state FROM deletion_jobs WHERE id=$1",
        [job.id],
      )
    ).rows[0].state,
    "completed",
  );
  for (const v of versions)
    await assert.rejects(system.storage.get(v.storage_key), { code: "ENOENT" });
  const copyKey = (
    await system.db.control.query(
      "SELECT storage_key FROM asset_versions WHERE asset_id=$1",
      [publishedCopy.id],
    )
  ).rows[0].storage_key;
  assert.equal(
    (await system.storage.get(copyKey)).toString(),
    "erase private customer content",
  );
  // The invariant is also enforced below HTTP, including privileged SQL.
  await assert.rejects(
    system.db.control.query("UPDATE assets SET state='active' WHERE id=$1", [
      file.id,
    ]),
    { code: "23514" },
  );
});

test("erasure persists I/O failures, retries with MFA and serializes simultaneous workers", async () => {
  const u = await user(),
    a = await admin(),
    w = await workspace(u);
  const file = await system.db.tx(
    (tx) =>
      saveAsset(tx, system.storage, {
        tenant: w.tenant.id,
        project: w.project.id,
        user: u.id,
        name: "retry.txt",
        mime: "text/plain",
        bytes: Buffer.from("retry me"),
      }),
    w.tenant.id,
  );
  const r = await call(
    u,
    "POST",
    "/v1/deletions",
    {
      target_type: "asset",
      target_id: file.id,
      project_id: w.project.id,
      reason: "Customer erase request",
    },
    randomUUID(),
    { "x-tenant-id": w.tenant.id },
  );
  assert.equal(r.status, 202, JSON.stringify(r.data));
  const key = (
    await system.db.control.query(
      "SELECT storage_key FROM asset_versions WHERE asset_id=$1",
      [file.id],
    )
  ).rows[0].storage_key;
  const originalRemove = system.storage.remove.bind(system.storage);
  system.storage.remove = async (k) => {
    if (k === key)
      throw Object.assign(
        new Error("sensitive absolute path must never escape"),
        { code: "EBUSY" },
      );
    await originalRemove(k);
  };
  try {
    await system.db.control.query(
      "UPDATE deletion_jobs SET next_attempt_at='2000-01-01' WHERE id=$1",
      [r.data.id],
    );
    await new ErasureService(system.db, system.storage).advance(1);
  } finally {
    system.storage.remove = originalRemove;
  }
  const failed = (
    await call(a, "GET", `/v1/admin/deletions?tenant_id=${w.tenant.id}`)
  ).data.items[0];
  assert.equal(failed.state, "queued");
  assert.deepEqual(failed.exceptions, ["ERASURE_STORAGE_BUSY"]);
  assert.equal(failed.failures.length, 1);
  assert.ok(!JSON.stringify(failed).includes(key));
  assert.equal(
    (
      await call(a, "POST", `/v1/admin/deletions/${r.data.id}/retry`, {
        reason: "Storage lock released",
      })
    ).status,
    200,
  );
  await system.db.control.query(
    "UPDATE deletion_jobs SET next_attempt_at='2000-01-01' WHERE id=$1",
    [r.data.id],
  );
  let calls = 0;
  system.storage.remove = async (k) => {
    if (k === key) calls++;
    await originalRemove(k);
  };
  try {
    await Promise.all([
      new ErasureService(system.db, system.storage).advance(1),
      new ErasureService(system.db, system.storage).advance(1),
    ]);
  } finally {
    system.storage.remove = originalRemove;
  }
  assert.equal(calls, 1);
  assert.equal(
    (
      await system.db.control.query(
        "SELECT state FROM deletion_jobs WHERE id=$1",
        [r.data.id],
      )
    ).rows[0].state,
    "completed",
  );
  await assert.rejects(system.storage.get(key), { code: "ENOENT" });
});

test("orphan collection retains referenced/new objects and tombstones removed keys against later references", async () => {
  const u = await user(),
    w = await workspace(u);
  const asset = await system.db.tx(
    (tx) =>
      saveAsset(tx, system.storage, {
        tenant: w.tenant.id,
        project: w.project.id,
        user: u.id,
        name: "retained.txt",
        mime: "text/plain",
        bytes: Buffer.from("keep"),
      }),
    w.tenant.id,
  );
  const liveKey = (
    await system.db.control.query(
      "SELECT storage_key FROM asset_versions WHERE asset_id=$1",
      [asset.id],
    )
  ).rows[0].storage_key;
  const orphan = await system.storage.put(
    Buffer.from("rolled back"),
    "text/plain",
  );
  const fresh = await system.storage.put(
    Buffer.from("new upload"),
    "text/plain",
  );
  const old = new Date(Date.now() - 172_800_000);
  for (const key of [orphan, liveKey])
    await utimes(path.resolve(system.db.config.DATA_DIR, key), old, old);
  const erasure = new ErasureService(system.db, system.storage);
  // Pages are bounded; process enough pages for the pre-existing isolated test data.
  for (let n = 0; n < 100; n++) await erasure.sweepOrphans();
  await assert.rejects(system.storage.get(orphan), { code: "ENOENT" });
  assert.equal((await system.storage.get(liveKey)).toString(), "keep");
  assert.equal((await system.storage.get(fresh)).toString(), "new upload");
  await assert.rejects(
    system.db.control.query(
      "INSERT INTO asset_versions(tenant_id,asset_id,version,storage_key,mime_type,bytes,sha256) VALUES($1,$2,2,$3,'text/plain',1,'test')",
      [w.tenant.id, asset.id, orphan],
    ),
    { code: "23514" },
  );
  await assert.rejects(system.storage.remove("../outside"));
});

test("runtime erasure waits for active work and refuses junctions outside the owned run tree", async () => {
  const tenant = randomUUID(),
    task = randomUUID();
  const run = path.resolve(system.db.config.DATA_DIR, "runs", tenant, task);
  const outside = path.resolve(
    system.db.config.DATA_DIR,
    "erasure-test-sentinel",
    randomUUID(),
  );
  await mkdir(run, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(run, "session.json"), "private prompt");
  await writeFile(path.join(outside, "keep.txt"), "must survive");
  await symlink(outside, path.join(run, "escape"), "junction");
  await assert.rejects(
    system.storage.removeRuntime(tenant, task),
    /ERASURE_LINK_UNSAFE/,
  );
  assert.equal(
    (await readFile(path.join(outside, "keep.txt"))).toString(),
    "must survive",
  );
  await unlink(path.join(run, "escape"));
  await system.storage.removeRuntime(tenant, task);
  await assert.rejects(stat(run), { code: "ENOENT" });
  await assert.rejects(
    system.storage.removeRuntime(tenant, ".."),
    /ERASURE_PATH_INVALID/,
  );
});

test("resumable upload persists verified parts across reconnects, rejects corruption and completes exactly once above the old 25 MiB limit", async () => {
  const u = await user(),
    w = await workspace(u),
    base = `/v1/tenants/${w.tenant.id}/projects/${w.project.id}`;
  const bytes = Buffer.alloc(29 * 1024 * 1024 + 11, 65),
    manifest = {
      project_id: w.project.id,
      filename: "large-campaign.txt",
      content_type: "text/plain",
      size_bytes: bytes.length,
      sha256: hash(bytes),
    },
    requestKey = randomUUID();
  const one = await call(u, "POST", base + "/uploads", manifest, requestKey),
    two = await call(u, "POST", base + "/uploads", manifest, requestKey);
  assert.equal(one.status, 201, JSON.stringify(one.data));
  assert.equal(one.data.upload_id, two.data.upload_id);
  const url = base + "/uploads/" + one.data.upload_id;
  assert.equal(
    (
      await call(u, "POST", url + "/complete", {
        sha256: manifest.sha256,
        size_bytes: bytes.length,
      })
    ).status,
    409,
  );
  const first = bytes.subarray(0, one.data.part_size_bytes),
    part = { base64: first.toString("base64"), sha256: hash(first) };
  assert.equal(
    (
      await call(u, "POST", url + "/parts/0", {
        ...part,
        sha256: "0".repeat(64),
      })
    ).status,
    422,
  );
  for (
    let index = 0, offset = 0;
    offset < bytes.length;
    index++, offset += one.data.part_size_bytes
  ) {
    const b = bytes.subarray(offset, offset + one.data.part_size_bytes),
      p = { base64: b.toString("base64"), sha256: hash(b) };
    const r = await call(u, "POST", url + "/parts/" + index, p);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    if (!index) {
      assert.equal((await call(u, "POST", url + "/parts/0", p)).status, 200);
      const changed = Buffer.alloc(b.length, 66);
      assert.equal(
        (
          await call(u, "POST", url + "/parts/0", {
            base64: changed.toString("base64"),
            sha256: hash(changed),
          })
        ).status,
        409,
      );
    }
  }
  const resumed = await call(u, "GET", url);
  assert.equal(resumed.data.parts.length, 8);
  const completion = { size_bytes: bytes.length, sha256: manifest.sha256 };
  const [a, b] = await Promise.all([
    call(u, "POST", url + "/complete", completion),
    call(u, "POST", url + "/complete", completion),
  ]);
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.id, b.data.id);
  assert.equal(a.data.version.sha256, manifest.sha256);
  const downloaded = await call(
    u,
    "GET",
    `${base}/assets/${a.data.id}/download`,
  );
  assert.equal(downloaded.status, 200);
  assert.equal(hash(downloaded.raw.rawPayload), manifest.sha256);
  assert.equal(downloaded.raw.headers["content-length"], String(bytes.length));
  assert.equal(downloaded.raw.headers["x-content-sha256"], manifest.sha256);
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*)::int AS n FROM asset_versions WHERE metadata->>'upload_id'=$1",
        [one.data.upload_id],
      )
    ).rows[0].n,
    1,
  );
  const adminUser = await admin();
  assert.equal(
    (
      await call(adminUser, "POST", `/v1/admin/content/${a.data.id}/action`, {
        action: "delete",
        version: 1,
        reason: "Remove staging and object",
      })
    ).status,
    200,
  );
  await system.db.control.query(
    "UPDATE deletion_jobs SET next_attempt_at='2000-01-01' WHERE target_id=$1",
    [a.data.id],
  );
  await new ErasureService(system.db, system.storage).advance(1);
  assert.equal(
    (
      await system.db.control.query(
        "SELECT state FROM deletion_jobs WHERE target_id=$1",
        [a.data.id],
      )
    ).rows[0].state,
    "completed",
  );
  await assert.rejects(
    stat(
      path.resolve(system.db.config.DATA_DIR, "uploads", one.data.upload_id),
    ),
    { code: "ENOENT" },
  );
  assert.equal(
    (await call(u, "POST", url + "/complete", completion)).status,
    410,
  );
});

test("upload MIME, whole-file checksum, limits, expiry, per-owner privacy and project revocation are enforced", async () => {
  const u = await user(),
    stranger = await user(),
    w = await workspace(u),
    base = `/v1/tenants/${w.tenant.id}/projects/${w.project.id}`,
    bytes = Buffer.from("Not a PNG"),
    hashValue = hash(bytes);
  const manifest = {
    project_id: w.project.id,
    filename: "bad.png",
    content_type: "image/png",
    size_bytes: bytes.length,
    sha256: hashValue,
  };
  const created = await call(u, "POST", base + "/uploads", manifest);
  assert.equal(created.status, 201);
  const url = base + "/uploads/" + created.data.upload_id;
  assert.equal((await call(stranger, "GET", url)).status, 404);
  assert.equal(
    (
      await call(u, "POST", url + "/parts/0", {
        base64: bytes.toString("base64"),
        sha256: hashValue,
      })
    ).status,
    200,
  );
  const wrongType = await call(u, "POST", url + "/complete", {
    sha256: hashValue,
    size_bytes: bytes.length,
  });
  assert.equal(wrongType.status, 422);
  assert.equal(wrongType.data.error.code, "UPLOAD_TYPE_MISMATCH");
  const more = await call(u, "POST", base + "/uploads", {
    ...manifest,
    filename: "wrong-hash.txt",
    content_type: "text/plain",
    sha256: "0".repeat(64),
  });
  const moreUrl = base + "/uploads/" + more.data.upload_id;
  await call(u, "POST", moreUrl + "/parts/0", {
    base64: bytes.toString("base64"),
    sha256: hashValue,
  });
  assert.equal(
    (
      await call(u, "POST", moreUrl + "/complete", {
        sha256: "0".repeat(64),
        size_bytes: bytes.length,
      })
    ).data.error.code,
    "UPLOAD_CHECKSUM",
  );
  assert.equal(
    (
      await readdirForTest(
        path.resolve(system.db.config.DATA_DIR, "uploads", more.data.upload_id),
      )
    ).some((n) => n.startsWith("assembled")),
    false,
  );
  assert.equal(
    (
      await call(u, "POST", base + "/uploads", {
        ...manifest,
        size_bytes: 100 * 1024 * 1024 + 1,
      })
    ).status,
    413,
  );
  const media = await call(u, "POST", base + "/uploads", {
    ...manifest,
    filename: "large.mp4",
    content_type: "video/mp4",
    size_bytes: 1024 * 1024 * 1024,
  });
  assert.equal(media.status, 201);
  await system.db.control.query(
    "UPDATE upload_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
    [media.data.upload_id],
  );
  assert.equal(
    (await call(u, "GET", base + "/uploads/" + media.data.upload_id)).status,
    410,
  );
  assert.equal((await call(u, "DELETE", url)).status, 200);
  assert.equal((await call(u, "GET", url)).status, 410);
  await cleanUploadStaging(system.db);
  await assert.rejects(
    stat(
      path.resolve(
        system.db.config.DATA_DIR,
        "uploads",
        created.data.upload_id,
      ),
    ),
    { code: "ENOENT" },
  );
  await system.db.control.query(
    "UPDATE memberships SET status='removed' WHERE tenant_id=$1 AND user_id=$2",
    [w.tenant.id, u.id],
  );
  assert.equal(
    (
      await call(u, "POST", moreUrl + "/complete", {
        sha256: "0".repeat(64),
        size_bytes: bytes.length,
      })
    ).status,
    404,
  );
});

test("email OTP has one atomic consumer and never authenticates the admin audience", async () => {
  const address = `otp-${randomUUID()}@example.invalid`,
    c = await code(address);
  const results = await Promise.all([
    call(undefined, "POST", "/v1/auth/verify", c),
    call(undefined, "POST", "/v1/auth/verify", c),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  const chosen = results.find((r) => r.status === 200)!;
  const adminMe = await system.app.inject({
    url: "/v1/admin/me",
    headers: {
      cookie: chosen.raw.cookies[0].name + "=" + chosen.raw.cookies[0].value,
    },
  });
  assert.equal(adminMe.statusCode, 401);
});
test("five invalid OTP attempts exhaust a challenge; expired and consumed codes fail", async () => {
  const c = await code(`brute-${randomUUID()}@example.invalid`);
  const wrong = c.code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await call(undefined, "POST", "/v1/auth/verify", { ...c, code: wrong }))
        .status,
      401,
    );
  assert.equal(
    (await call(undefined, "POST", "/v1/auth/verify", c)).status,
    401,
  );
  const expired = await code(`expired-${randomUUID()}@example.invalid`);
  await system.db.control.query(
    "UPDATE auth_challenges SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [expired.challenge_id],
  );
  assert.equal(
    (await call(undefined, "POST", "/v1/auth/verify", expired)).status,
    401,
  );
});
test("CSRF, foreign origin and revoked sessions prevent writes", async () => {
  const u = await user();
  const r = await system.app.inject({
    method: "PATCH",
    url: "/v1/me",
    headers: { cookie: u.cookie, "content-type": "application/json", origin },
    payload: { name: "untrusted" },
  });
  assert.equal(r.statusCode, 403);
  assert.equal(
    (
      await system.app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { cookie: u.cookie, origin: "https://evil.example" },
      })
    ).statusCode,
    403,
  );
  assert.equal((await call(u, "POST", "/v1/auth/logout")).status, 200);
  assert.equal((await call(u, "GET", "/v1/me")).status, 401);
});
test("tenant bootstrap is idempotent and project access is isolated at API and PostgreSQL levels", async () => {
  const u = await user(),
    v = await user(),
    k = randomUUID();
  const b = { name: "Idempotent Ltd", project_name: "Launch" };
  const a = await call(u, "POST", "/v1/tenants", b, k),
    duplicate = await call(u, "POST", "/v1/tenants", b, k);
  assert.equal(a.status, 200);
  assert.equal(a.data.tenant.id, duplicate.data.tenant.id);
  assert.equal(
    (await call(u, "POST", "/v1/tenants", { ...b, name: "Changed" }, k)).status,
    409,
  );
  const base = `/v1/tenants/${a.data.tenant.id}/projects/${a.data.project.id}`;
  assert.equal((await call(v, "GET", base + "/assets")).status, 404);
  const unscoped = await system.db.app.query(
    "SELECT id FROM projects WHERE id=$1",
    [a.data.project.id],
  );
  assert.equal(unscoped.rowCount, 0);
  const ident = (
    await system.db.app.query(
      "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  assert.equal(ident.rolsuper, false);
  assert.equal(ident.rolbypassrls, false);
});
test("single-use invitation binds email and project, protects the last owner", async () => {
  const owner = await user(),
    member = await user(),
    other = await user(),
    w = await workspace(owner);
  const path = `/v1/tenants/${w.tenant.id}`;
  const invite = await call(owner, "POST", path + "/invites", {
    email: member.email,
    role: "viewer",
    project_ids: [w.project.id],
  });
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  await dispatchInvitationMail(system.db, { limit: 20 });
  const mail = JSON.parse(
    await readFile(
      `${system.db.config.DATA_DIR}/mailbox/${invite.data.id}.json`,
      "utf8",
    ),
  );
  const token = new URL(mail.text.match(/https?:\/\/\S+/)[0]).searchParams.get(
    "token",
  );
  assert.equal(
    (await call(other, "POST", "/v1/invites/accept", { token })).status,
    409,
  );
  assert.equal(
    (await call(member, "POST", "/v1/invites/accept", { token })).status,
    201,
  );
  assert.equal(
    (await call(member, "POST", "/v1/invites/accept", { token })).status,
    409,
  );
  assert.equal(
    (await call(member, "GET", path + `/projects/${w.project.id}/assets`))
      .status,
    200,
  );
  assert.equal(
    (
      await call(member, "POST", path + `/projects/${w.project.id}/creative`, {
        name: "bad",
        body: { width: 1080, height: 1350, background: "#FFFFFF", layers: [] },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(owner, "PATCH", path + "/members/" + owner.id, {
        role: "member",
        status: "active",
        version: 1,
        project_ids: [],
      })
    ).data.error.code,
    "LAST_OWNER",
  );
});
test("PKCE requires exact verifier and callback, refresh rotation detects replay", async () => {
  const u = await user();
  const verifier = randomBytes(32).toString("base64url"),
    challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirect = "http://127.0.0.1:41234/callback";
  const a = await call(u, "POST", "/v1/auth/native/authorize", {
    client_id: "desktop",
    redirect_uri: redirect,
    code_challenge: challenge,
    state: randomBytes(32).toString("base64url"),
  });
  assert.equal(a.status, 200);
  const code = new URL(a.data.redirect).searchParams.get("code");
  assert.equal(
    (
      await call(undefined, "POST", "/v1/auth/native/token", {
        client_id: "desktop",
        redirect_uri: redirect,
        code,
        code_verifier: randomBytes(32).toString("base64url"),
      })
    ).status,
    401,
  );
  const issued = await call(undefined, "POST", "/v1/auth/native/token", {
    client_id: "desktop",
    redirect_uri: redirect,
    code,
    code_verifier: verifier,
  });
  assert.equal(issued.status, 200);
  assert.equal(
    (
      await call(undefined, "POST", "/v1/auth/native/token", {
        client_id: "desktop",
        redirect_uri: redirect,
        code,
        code_verifier: verifier,
      })
    ).status,
    401,
  );
  const rotated = await call(undefined, "POST", "/v1/auth/native/refresh", {
    client_id: "desktop",
    refresh_token: issued.data.refresh_token,
  });
  assert.equal(rotated.status, 200);
  assert.equal(
    (
      await call(undefined, "POST", "/v1/auth/native/refresh", {
        client_id: "desktop",
        refresh_token: issued.data.refresh_token,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await system.app.inject({
        url: "/v1/me",
        headers: { authorization: "Bearer " + rotated.data.access_token },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await call(u, "POST", "/v1/auth/native/authorize", {
        client_id: "desktop",
        redirect_uri: "http://evil.example/callback",
        code_challenge: challenge,
        state: randomBytes(32).toString("base64url"),
      })
    ).status,
    400,
  );
});
test("admin authentication requires MFA, separate audience and explicit content permission", async () => {
  const a = await admin("support_agent"),
    u = await user(),
    w = await workspace(u);
  assert.equal((await call(a, "GET", "/v1/admin/users")).status, 200);
  assert.equal((await call(a, "GET", "/v1/me")).status, 401);
  const noMfa = await code(a.email, true);
  assert.equal(
    (await call(undefined, "POST", "/v1/admin/auth/verify", noMfa)).status,
    401,
  );
  const metadata = await system.db.tx(async (tx) => {
    const r = (
      await tx.query(
        "INSERT INTO assets(tenant_id,project_id,name,kind,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [w.tenant.id, w.project.id, "private.txt", "file", u.id],
      )
    ).rows[0];
    const key = await system.storage.put(Buffer.from("private"), "text/plain");
    await tx.query(
      "INSERT INTO asset_versions(tenant_id,asset_id,version,storage_key,mime_type,bytes,sha256) VALUES($1,$2,1,$3,$4,7,$5)",
      [w.tenant.id, r.id, key, "text/plain", hash("private")],
    );
    return r;
  }, w.tenant.id);
  assert.equal(
    (await call(a, "GET", "/v1/admin/content/" + metadata.id + "/body")).status,
    403,
  );
  const content = await admin("content_admin");
  assert.equal(
    (await call(content, "GET", "/v1/admin/content/" + metadata.id + "/body"))
      .data.text,
    "private",
  );
  const q = await call(
    content,
    "POST",
    "/v1/admin/content/" + metadata.id + "/action",
    { action: "quarantine", version: 1, reason: "QA quarantine" },
  );
  assert.equal(q.status, 200);
  assert.equal(
    (
      await call(
        u,
        "GET",
        `/v1/tenants/${w.tenant.id}/projects/${w.project.id}/assets`,
      )
    ).data.items.length,
    0,
  );
});
test("admin funding preview is side-effect-free, commit replays once, concurrent spending preserves holds", async () => {
  const u = await user(),
    w = await workspace(u),
    a = await admin(),
    reviewer = await admin();
  const base = {
    action: "billing.top_up",
    tenant_id: w.tenant.id,
    amount_micros: 100_000_000,
    reference: "QA-" + randomUUID(),
    reason: "QA confirmed payment",
  };
  const legacy = await call(a, "POST", "/v1/admin/operations/preview", base);
  assert.equal(legacy.status, 409);
  assert.equal(legacy.data.error.code, "CANONICAL_FINANCE_REQUIRED");
  const prepared = await verifiedTopUp(
      a,
      reviewer,
      u,
      w,
      "100000000",
      base.reference,
    ),
    endpoint = `/v1/admin/billing/accounts/${prepared.account.id}`;
  const preview = await call(
    a,
    "POST",
    endpoint + "/previews",
    prepared.command,
  );
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.creates_business_effect, false);
  assert.equal(
    (
      await system.db.control.query(
        "SELECT balance_micros FROM wallets WHERE tenant_id=$1",
        [w.tenant.id],
      )
    ).rows[0].balance_micros,
    "0",
  );
  const k = randomUUID(),
    headers = { "X-Admin-Preview-ID": preview.data.preview_id };
  const first = await call(
      a,
      "POST",
      endpoint + "/top-up",
      prepared.command,
      k,
      headers,
    ),
    again = await call(
      a,
      "POST",
      endpoint + "/top-up",
      prepared.command,
      k,
      headers,
    );
  assert.equal(first.status, 202, JSON.stringify(first.data));
  assert.equal(again.status, 202, JSON.stringify(again.data));
  assert.equal(first.data.id, again.data.id);
  const tasks = await system.db.tx(async (tx) => {
    const out = [];
    for (let i = 0; i < 2; i++)
      out.push(
        (
          await tx.query(
            "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
            [
              w.tenant.id,
              w.project.id,
              u.id,
              "QA reserve",
              "test prompt",
              "fullstack",
              "hash",
              80_000_000,
              randomUUID(),
            ],
          )
        ).rows[0].id,
      );
    return out;
  }, w.tenant.id);
  const holds = await Promise.allSettled(
    tasks.map((id) =>
      system.db.tx(
        (tx) => reserve(tx, w.tenant.id, id, 80_000_000),
        w.tenant.id,
      ),
    ),
  );
  assert.equal(holds.filter((r) => r.status === "fulfilled").length, 1);
  const held = tasks[holds.findIndex((r) => r.status === "fulfilled")];
  await system.db.tx(
    (tx) => settle(tx, w.tenant.id, held, 15_000_000, u.id),
    w.tenant.id,
  );
  await system.db.tx(
    (tx) => settle(tx, w.tenant.id, held, 15_000_000, u.id),
    w.tenant.id,
  );
  const balance = (
    await system.db.control.query("SELECT * FROM wallets WHERE tenant_id=$1", [
      w.tenant.id,
    ])
  ).rows[0];
  assert.equal(balance.balance_micros, "85000000");
  assert.equal(balance.reserved_micros, "0");
  assert.equal(balance.spent_micros, "15000000");
});
test("VIP validity uses real timestamps and financial limits/independent approval are enforced", async () => {
  const u = await user(),
    w = await workspace(u),
    a = await admin(),
    b = await admin("finance_admin");
  const vip = await money(a, {
    action: "entitlements.grant",
    tenant_id: w.tenant.id,
    plan: "pro",
    starts_at: new Date(Date.now() - 1000).toISOString(),
    ends_at: new Date(Date.now() + 86400000).toISOString(),
    reason: "QA VIP grant",
  });
  assert.equal(vip.status, 200, JSON.stringify(vip.data));
  assert.equal(
    (await call(u, "GET", `/v1/tenants/${w.tenant.id}/billing`)).data
      .entitlements.length,
    1,
  );
  await system.db.control.query(
    "UPDATE entitlements SET ends_at=now()-interval '1 second',starts_at=now()-interval '2 days' WHERE id=$1",
    [vip.data.result.id],
  );
  assert.equal(
    (await call(u, "GET", `/v1/tenants/${w.tenant.id}/billing`)).data
      .entitlements.length,
    0,
  );
  const high = await money(a, {
    action: "billing.gift",
    tenant_id: w.tenant.id,
    amount_micros: 10_000_000_000,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    reason: "QA high value grant",
  });
  assert.equal(high.data.state, "pending_approval");
  assert.equal(
    (
      await call(
        a,
        "POST",
        "/v1/admin/billing/operations/" + high.data.id + "/decision",
        {
          decision: "approve",
          reason: "QA self approval",
          expected_version: high.data.version,
          payload_hash: high.data.payload_hash,
        },
      )
    ).data.error.code,
    "SELF_APPROVAL_FORBIDDEN",
  );
  const s = await admin("super_admin");
  assert.equal(
    (
      await call(
        s,
        "POST",
        "/v1/admin/billing/operations/" + high.data.id + "/decision",
        {
          decision: "approve",
          reason: "QA independent review",
          expected_version: high.data.version,
          payload_hash: high.data.payload_hash,
        },
      )
    ).status,
    200,
  );
  await system.db.control.query(
    "UPDATE admin_bindings SET limits=$2 WHERE principal_id=$1",
    [b.id, { max_amount_micros: 1000000 }],
  );
  const billingAccount = (
    await system.db.control.query(
      "SELECT id,version FROM wallets WHERE tenant_id=$1",
      [w.tenant.id],
    )
  ).rows[0];
  const denied = await call(
    b,
    "POST",
    `/v1/admin/billing/accounts/${billingAccount.id}/previews`,
    {
      action: "gift",
      expected_version: billingAccount.version,
      amount: { currency: "HKD", amount_micros: "2000000" },
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      reason: "QA exceeded scope",
    },
  );
  assert.equal(denied.status, 403);
});
test("undefined ratios are null and totals divide after aggregation; CSV protects currency and exact amounts", () => {
  const csv =
    "date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency\n2026-10-01,Google,Launch,100,10,0.10,2,1.00,HKD\n2026-10-02,Google,Launch,1000,20,0.20,1,2.00,HKD";
  const d = parseMetricsCSV(csv);
  const m = metrics(d.rows);
  assert.equal(m.ctr, 30 / 1100);
  assert.equal(m.spend_micros, 300000);
  assert.equal(m.roas, 10);
  assert.equal(metrics([]).ctr, null);
  assert.equal(metrics([]).roas, null);
  assert.equal(tokenCharge(1, 1, 1000000, 1000000), 2);
  assert.throws(() => parseMetricsCSV(csv.replace(/,HKD$/, " ,USD")));
});
test("editable poster escapes script injection and preserves exact Traditional Chinese copy", () => {
  const svg = renderPoster({
    width: 1080,
    height: 1350,
    background: "#FFFFFF",
    layers: [
      {
        type: "text",
        text: "優惠 HK$128 <script>alert(1)</script>",
        x: 40,
        y: 100,
        font_size: 30,
        color: "#15171A",
      },
    ],
  });
  assert.ok(svg.includes("優惠 HK$128"));
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("&lt;script&gt;"));
});
test("task request cannot override kernel/provider and unavailable AI cannot fake success", async () => {
  const u = await user(),
    w = await workspace(u),
    url = `/v1/tenants/${w.tenant.id}/projects/${w.project.id}/tasks`;
  const b = {
    title: "Build site",
    prompt: "Build a complete business website",
    role_key: "fullstack",
    budget_micros: 1000000,
  };
  assert.equal(
    (await call(u, "POST", url, { ...b, kernel: "untrusted" })).status,
    400,
  );
  const r = await call(u, "POST", url, b);
  assert.equal(r.status, 503);
  assert.equal(r.data.error.code, "AI_SETUP_REQUIRED");
});

test("native logout revokes the refresh family and a browser cookie cannot become a bearer token", async () => {
  const u = await user();
  const cookie = u.cookie.split("=")[1];
  const invalid = await system.app.inject({
    url: "/v1/me",
    headers: { authorization: `Bearer ${cookie}` },
  });
  assert.equal(invalid.statusCode, 401);
  const verifier = randomBytes(32).toString("base64url"),
    redirect = "http://127.0.0.1:46661/callback";
  const a = await call(u, "POST", "/v1/auth/native/authorize", {
    client_id: "desktop",
    redirect_uri: redirect,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(32).toString("base64url"),
  });
  const code = new URL(a.data.redirect).searchParams.get("code");
  const issued = await call(undefined, "POST", "/v1/auth/native/token", {
    client_id: "desktop",
    redirect_uri: redirect,
    code,
    code_verifier: verifier,
  });
  assert.equal(issued.status, 200);
  const out = await system.app.inject({
    method: "POST",
    url: "/v1/auth/logout",
    headers: { authorization: `Bearer ${issued.data.access_token}` },
  });
  assert.equal(out.statusCode, 200);
  assert.equal(
    (
      await call(undefined, "POST", "/v1/auth/native/refresh", {
        client_id: "desktop",
        refresh_token: issued.data.refresh_token,
      })
    ).status,
    401,
  );
});
test("confirmed payment references cannot credit a second workspace, including with a new idempotency key", async () => {
  const u = await user(),
    w = await workspace(u),
    w2 = await workspace(u),
    a = await admin(),
    reviewer = await admin();
  const reference = "QA-PAY-" + randomUUID();
  const prepared = await verifiedTopUp(a, reviewer, u, w, "2000000", reference),
    endpoint = `/v1/admin/billing/accounts/${prepared.account.id}`,
    preview = await call(a, "POST", endpoint + "/previews", prepared.command);
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  const posted = await call(
    a,
    "POST",
    endpoint + "/top-up",
    prepared.command,
    randomUUID(),
    {
      "X-Admin-Preview-ID": preview.data.preview_id,
    },
  );
  assert.equal(posted.status, 202, JSON.stringify(posted.data));
  const second = (
    await system.db.control.query(
      "SELECT id,version FROM wallets WHERE tenant_id=$1",
      [w2.tenant.id],
    )
  ).rows[0];
  const reused = await call(
    a,
    "POST",
    `/v1/admin/billing/accounts/${second.id}/previews`,
    {
      ...prepared.command,
      expected_version: second.version,
    },
  );
  assert.equal(reused.status, 409);
  assert.equal(reused.data.error.code, "PAYMENT_ACCOUNT_MISMATCH");
  const secondEvidence = await system.db.tx(
    (tx) =>
      saveAsset(tx, system.storage, {
        tenant: w2.tenant.id,
        project: w2.project.id,
        user: u.id,
        name: "Duplicate controlled receipt.txt",
        mime: "text/plain",
        bytes: Buffer.from(
          "Controlled duplicate reference; no payment: " + reference,
        ),
      }),
    w2.tenant.id,
  );
  const duplicate = await call(a, "POST", "/v1/admin/billing/payments", {
    ...prepared.receipt,
    billing_account_id: second.id,
    evidence_asset_version_id: secondEvidence.version.id,
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.error.code, "PAYMENT_REFERENCE_DUPLICATE");
  const balance = (
    await system.db.control.query(
      "SELECT balance_micros FROM wallets WHERE tenant_id=$1",
      [w2.tenant.id],
    )
  ).rows[0];
  assert.equal(Number(balance.balance_micros), 0);
});
test("admin workspace lists redact money without billing permission and user usage honors its own scope", async () => {
  const u = await user(),
    w = await workspace(u),
    a = await admin("user_operator");
  const r = await call(a, "GET", "/v1/admin/tenants");
  assert.equal(r.status, 200);
  const row = r.data.items.find((x: any) => x.id === w.tenant.id);
  assert.ok(row);
  assert.equal(row.balance_micros, undefined);
  assert.equal(row.credit_limit_micros, undefined);
  const deny = "no_usage_" + randomUUID().replaceAll("-", "");
  await system.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [deny, JSON.stringify(["admin.usage.read"])],
  );
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,effect) VALUES($1,$2,'global','deny')",
    [a.id, deny],
  );
  const users = await call(
    a,
    "GET",
    "/v1/admin/users?q=" + encodeURIComponent(u.email),
  );
  assert.equal(users.status, 200);
  assert.equal(users.data.items[0].confirmed_customer_charges, undefined);
});
test("quarantining a dataset removes it at the API and restricted PostgreSQL layer; restore requires its new version", async () => {
  const u = await user(),
    w = await workspace(u),
    a = await admin("content_admin");
  const base = `/v1/tenants/${w.tenant.id}/projects/${w.project.id}`;
  const d = await call(u, "POST", base + "/analytics/import", {
    name: "Private campaign",
    csv: "date,channel,impressions,clicks,spend,conversions,revenue,currency\n2026-10-01,Google,100,8,10.00,2,30.00,HKD",
  });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  const inspected = await call(a, "GET", `/v1/admin/content/${d.data.id}/body`);
  assert.equal(inspected.status, 200, JSON.stringify(inspected.data));
  const sourceBody = JSON.parse(inspected.data.text);
  assert.ok(
    sourceBody.raw_csv.includes("2026-10-01,Google,100,8,10.00,2,30.00,HKD"),
  );
  assert.equal(sourceBody.source_sha256, d.data.source_sha256);
  assert.equal(sourceBody.metric_snapshot.summary.exact.roas, "3.00000000");
  assert.equal(
    (await call(u, "GET", `/v1/admin/content/${d.data.id}/body`)).status,
    401,
  );
  assert.equal(
    (
      await call(a, "POST", `/v1/admin/content/${d.data.id}/action`, {
        action: "quarantine",
        version: 1,
        reason: "Investigating incorrect source",
      })
    ).status,
    200,
  );
  assert.equal(
    (await call(u, "GET", base + "/analytics/" + d.data.id)).status,
    404,
  );
  assert.equal(
    (
      await system.db.tx(
        (tx) =>
          tx.query("SELECT id FROM analytics_datasets WHERE id=$1", [
            d.data.id,
          ]),
        w.tenant.id,
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await call(a, "POST", `/v1/admin/content/${d.data.id}/action`, {
        action: "restore",
        version: 1,
        reason: "Stale restore request",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(a, "POST", `/v1/admin/content/${d.data.id}/action`, {
        action: "restore",
        version: 2,
        reason: "Source verified correct",
      })
    ).status,
    200,
  );
  assert.equal(
    (await call(u, "GET", base + "/analytics/" + d.data.id)).status,
    200,
  );
});
test("exports recheck source authorization at download and batch status changes revoke all sessions", async () => {
  const u = await user(),
    a = await admin();
  const e = await call(a, "POST", "/v1/admin/exports", { source: "users" });
  assert.equal(e.status, 200, JSON.stringify(e.data));
  const csv = await call(a, "GET", `/v1/admin/exports/${e.data.id}/download`);
  assert.equal(csv.status, 200);
  assert.ok(csv.raw.headers["content-type"]?.includes("text/csv"));
  const binding = (
    await system.db.control.query(
      "SELECT id FROM admin_bindings WHERE principal_id=$1",
      [a.id],
    )
  ).rows[0];
  await system.db.control.query("DELETE FROM admin_bindings WHERE id=$1", [
    binding.id,
  ]);
  assert.equal(
    (await call(a, "GET", `/v1/admin/exports/${e.data.id}/download`)).status,
    403,
  );
  const b = await admin();
  const batch = await call(b, "POST", "/v1/admin/jobs/preview", {
    action: "users.status",
    ids: [u.id],
    status: "suspended",
    reason: "QA suspension batch",
  });
  assert.equal(batch.status, 200, JSON.stringify(batch.data));
  assert.equal((await call(u, "GET", "/v1/me")).status, 200);
  const changed = await call(b, "POST", "/v1/admin/jobs", {
    preview_id: batch.data.id,
    payload_hash: batch.data.payload_hash,
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.state, "succeeded");
  assert.equal((await call(u, "GET", "/v1/me")).status, 401);
});

test("personal VIP freezes its policy, enforces concurrent quotas, expires without crediting the wallet", async () => {
  const { authorizeTaskPlan } = await import("../src/plans.js");
  const u = await user(),
    w = await workspace(u),
    a = await admin();
  const grant = {
    action: "entitlements.grant",
    user_id: u.id,
    plan: "pro",
    starts_at: new Date(Date.now() - 1000).toISOString(),
    ends_at: new Date(Date.now() + 86400000).toISOString(),
    reason: "QA personal entitlement",
  };
  const g = await money(a, grant);
  assert.equal(g.status, 200, JSON.stringify(g.data));
  const duplicate = await money(a, grant);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.error.code, "ENTITLEMENT_OVERLAP");
  const effective = await call(u, "GET", `/v1/tenants/${w.tenant.id}/plan`);
  assert.equal(effective.status, 200, JSON.stringify(effective.data));
  assert.equal(effective.data.plan, "pro");
  assert.equal(effective.data.subject, "user");
  assert.equal(
    (await call(u, "GET", `/v1/tenants/${w.tenant.id}/billing`)).data.wallet
      .balance_micros,
    "0",
  );
  const role = system.catalog.role("fullstack");
  const add = () =>
    system.db.tx(async (tx) => {
      const plan = await authorizeTaskPlan(
        tx,
        w.tenant.id,
        u.id,
        role,
        1_000_000,
      );
      await tx.query(
        "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key,actor_auth_version,plan_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10)",
        [
          w.tenant.id,
          w.project.id,
          u.id,
          "Quota fixture",
          "Build a tool",
          "fullstack",
          "qa",
          1_000_000,
          randomUUID(),
          plan,
        ],
      );
    }, w.tenant.id);
  const attempts = await Promise.allSettled([
    add(),
    add(),
    add(),
    add(),
    add(),
  ]);
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 3);
  for (const r of attempts.filter((r) => r.status === "rejected"))
    assert.equal((r as PromiseRejectedResult).reason.code, "PLAN_TASK_LIMIT");
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*)::int AS n FROM entitlement_events WHERE entitlement_id=$1",
        [g.data.result.id],
      )
    ).rows[0].n,
    1,
  );
  await system.db.control.query(
    "UPDATE entitlements SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE id=$1",
    [g.data.result.id],
  );
  assert.equal(
    (await call(u, "GET", `/v1/tenants/${w.tenant.id}/plan`)).data.plan,
    "starter",
  );
});

test("scoped usage never inherits broader user visibility and explicit project deny constrains aggregates", async () => {
  const u = await user(),
    one = await workspace(u),
    two = await workspace(u),
    a = await admin();
  const role = "qa_usage_" + randomUUID().replaceAll("-", "");
  await system.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [role, JSON.stringify(["admin.usage.read", "admin.overview.read"])],
  );
  await system.db.control.query(
    "DELETE FROM admin_bindings WHERE principal_id=$1",
    [a.id],
  );
  await system.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [role + "_users", JSON.stringify(["admin.users.read"])],
  );
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'global',NULL)",
    [a.id, role + "_users"],
  );
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'tenant',$3)",
    [a.id, role, one.tenant.id],
  );
  for (const w of [one, two])
    await system.db.control.query(
      "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key,actor_auth_version,status,charged_micros) VALUES($1,$2,$3,'Scope fixture','Report','fullstack','qa',1000000,$4,1,'succeeded',100)",
      [w.tenant.id, w.project.id, u.id, randomUUID()],
    );
  const detail = await call(a, "GET", "/v1/admin/users/" + u.id);
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  assert.equal(detail.data.user.confirmed_customer_charges.amount_micros, "0");
  const context = await call(
    a,
    "GET",
    "/v1/admin/users/" + u.id + "/management-context",
  );
  assert.equal(context.status, 200, JSON.stringify(context.data));
  assert.deepEqual(
    context.data.memberships
      .filter((r: any) => r.task_count !== undefined)
      .map((r: any) => r.tenant_id),
    [one.tenant.id],
  );
  assert.equal(
    context.data.memberships.find((r: any) => r.tenant_id === one.tenant.id)
      .task_count,
    1,
  );
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')",
    [a.id, role, one.project.id],
  );
  const usage = await call(a, "GET", "/v1/admin/usage");
  assert.equal(usage.status, 200, JSON.stringify(usage.data));
  assert.equal(usage.data.total, 0);
  const summary = await call(a, "GET", "/v1/admin/overview");
  assert.equal(summary.status, 200, JSON.stringify(summary.data));
  assert.equal(summary.data.summary.tasks, 0);
});

test("admin publishes client content and role presentation without accepting executable overrides; metadata mutations reject stale versions", async () => {
  const a = await admin(),
    u = await user(),
    w = await workspace(u);
  const draft = await call(a, "POST", "/v1/admin/catalog", {
    kind: "announcement",
    key: "qa-" + randomUUID(),
    body: {
      title: "QA release",
      text: "Ready for review",
      title_en: "QA release",
      text_en: "Ready for review",
    },
  });
  assert.equal(draft.status, 200);
  assert.equal(
    (await call(a, "POST", `/v1/admin/catalog/${draft.data.id}/publish`))
      .status,
    200,
  );
  assert.ok(
    (await call(undefined, "GET", "/v1/public/content")).data.items.some(
      (r: any) => r.id === draft.data.id,
    ),
  );
  const evil = await call(a, "POST", "/v1/admin/catalog", {
    kind: "role",
    key: "fullstack",
    body: { enabled: true, engine: "other-runtime" },
  });
  assert.equal(
    (await call(a, "POST", `/v1/admin/catalog/${evil.data.id}/publish`)).status,
    400,
  );
  const asset = await system.db.tx(async (tx) => {
    const { saveAsset } = await import("../src/storage.js");
    return saveAsset(tx, system.storage, {
      tenant: w.tenant.id,
      project: w.project.id,
      user: u.id,
      name: "draft.txt",
      mime: "text/plain",
      bytes: Buffer.from("Draft"),
    });
  }, w.tenant.id);
  assert.equal(
    (
      await call(a, "POST", `/v1/admin/content/${asset.id}/action`, {
        action: "metadata",
        version: 1,
        name: "renamed.txt",
        reason: "QA rename",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(a, "POST", `/v1/admin/content/${asset.id}/action`, {
        action: "metadata",
        version: 1,
        name: "stale.txt",
        reason: "QA stale rename",
      })
    ).status,
    409,
  );
  const list = await call(a, "GET", "/v1/admin/content?page_size=1");
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.items.length, 1);
  assert.ok(list.data.total > 1);
});

test("native design compositions pin authorized image versions and reject foreign project assets", async () => {
  const u = await user(),
    w = await workspace(u),
    other = await workspace(u);
  const { pngFromSVG } = await import("../src/render.js");
  const { saveAsset } = await import("../src/storage.js");
  const image = await system.db.tx(
    (tx) =>
      saveAsset(tx, system.storage, {
        tenant: w.tenant.id,
        project: w.project.id,
        user: u.id,
        name: "approved.png",
        mime: "image/png",
        bytes: Buffer.from(
          pngFromSVG(
            '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#1F5EFF"/></svg>',
          ),
        ),
      }),
    w.tenant.id,
  );
  const body = {
    width: 512,
    height: 512,
    background: "#FFFFFF",
    layers: [
      {
        type: "image",
        asset_id: image.id,
        version: 1,
        x: 20,
        y: 20,
        width: 472,
        height: 472,
      },
    ],
  };
  const base = `/v1/tenants/${w.tenant.id}/projects/${w.project.id}`;
  const creative = await call(u, "POST", base + "/creative", {
    name: "Composed image",
    body,
  });
  assert.equal(creative.status, 200);
  const rendered = await call(
    u,
    "POST",
    base + "/creative/" + creative.data.id + "/render",
    { format: "png" },
  );
  assert.equal(rendered.status, 200, JSON.stringify(rendered.data));
  const exportKey = randomUUID(),
    pdfInput = { format: "pdf", expected_version: creative.data.version },
    pdfPath = base + "/creative/" + creative.data.id + "/render";
  const pdf = await call(u, "POST", pdfPath, pdfInput, exportKey);
  assert.equal(pdf.status, 200, JSON.stringify(pdf.data));
  assert.equal(
    (await call(u, "POST", pdfPath, pdfInput, exportKey)).data.id,
    pdf.data.id,
  );
  const pdfVersion = (
    await system.db.control.query(
      "SELECT mime_type,metadata FROM asset_versions WHERE asset_id=$1 AND version=1",
      [pdf.data.id],
    )
  ).rows[0];
  assert.equal(pdfVersion.mime_type, "application/pdf");
  assert.equal(pdfVersion.metadata.version, creative.data.version);
  assert.equal(pdfVersion.metadata.source.layers[0].asset_id, image.id);
  assert.equal(pdfVersion.metadata.source.layers[0].version, 1);
  assert.equal(pdfVersion.metadata.probe.purpose, "raster_review");
  assert.equal(pdfVersion.metadata.probe.editable_text, false);
  const downloaded = await call(
    u,
    "GET",
    base + "/assets/" + pdf.data.id + "/download",
  );
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.raw.headers["content-type"], "application/pdf");
  assert.equal(downloaded.raw.rawPayload.subarray(0, 5).toString(), "%PDF-");
  assert.equal((await call(undefined, "POST", pdfPath, pdfInput)).status, 401);
  assert.equal(
    (await call(await user(), "POST", pdfPath, pdfInput)).status,
    404,
  );
  assert.equal(
    (await call(u, "POST", pdfPath, { format: "pdf", expected_version: 999 }))
      .status,
    409,
  );
  assert.equal(
    (
      await call(u, "POST", pdfPath, {
        ...pdfInput,
        remote_url: "https://example.invalid/a.svg",
      })
    ).status,
    400,
  );
  await call(u, "PUT", base + "/creative/" + creative.data.id, {
    name: "Revised image",
    version: creative.data.version,
    body: { ...body, background: "#F6F6F4" },
  });
  assert.equal((await call(u, "POST", pdfPath, pdfInput)).status, 409);
  // A lost reply replays the accepted source version even after a later edit.
  assert.equal(
    (await call(u, "POST", pdfPath, pdfInput, exportKey)).data.id,
    pdf.data.id,
  );
  const thumbnail = await call(
    u,
    "GET",
    base + "/assets/" + image.id + "/thumbnail",
  );
  assert.equal(thumbnail.status, 200);
  assert.ok(thumbnail.data.base64.length < 100000);
  const foreignBase = `/v1/tenants/${other.tenant.id}/projects/${other.project.id}`;
  const foreign = await call(u, "POST", foreignBase + "/creative", {
    name: "Wrong project",
    body,
  });
  assert.equal(foreign.status, 200);
  const refused = await call(
    u,
    "POST",
    foreignBase + "/creative/" + foreign.data.id + "/render",
    { format: "svg" },
  );
  assert.equal(refused.status, 400);
  assert.equal(refused.data.error.code, "IMAGE_SOURCE_INVALID");
  const refusedPDF = await call(
    u,
    "POST",
    foreignBase + "/creative/" + foreign.data.id + "/render",
    { format: "pdf" },
  );
  assert.equal(refusedPDF.status, 400);
  assert.equal(refusedPDF.data.error.code, "IMAGE_SOURCE_INVALID");
});

test("admin delegation cannot widen financial limits or outlive the source grant", async () => {
  await admin();
  const suffix = randomUUID().replaceAll("-", ""),
    delegator = "delegate_" + suffix,
    child = "gift_" + suffix;
  await system.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2),($3,$3,$4)",
    [
      delegator,
      JSON.stringify(["admin.access.bindings.write", "admin.billing.gift"]),
      child,
      JSON.stringify(["admin.billing.gift"]),
    ],
  );
  const a = await admin(delegator),
    recipient = await admin("user_operator");
  const expires = new Date(Date.now() + 3600000).toISOString();
  await system.db.control.query(
    "UPDATE admin_bindings SET limits=$2,expires_at=$3 WHERE principal_id=$1",
    [a.id, { max_amount_micros: 1000000, max_batch: 5 }, expires],
  );
  const payload = {
    principal_id: recipient.id,
    role_key: child,
    scope_kind: "global",
    reason: "Delegate bounded pilot support",
  };
  for (const patch of [
    {},
    {
      limits: { max_amount_micros: 1000001, max_batch: 5 },
      expires_at: expires,
    },
    {
      limits: { max_amount_micros: 500000, max_batch: 5 },
      expires_at: new Date(Date.now() + 7200000).toISOString(),
    },
  ]) {
    const denied = await call(a, "POST", "/v1/admin/access/bindings", {
      ...payload,
      ...patch,
    });
    assert.equal(denied.status, 403, JSON.stringify(denied.data));
    assert.equal(denied.data.error.code, "DELEGATION_LIMIT");
  }
  const good = await call(a, "POST", "/v1/admin/access/bindings", {
    ...payload,
    limits: { max_amount_micros: 500000, max_batch: 3 },
    expires_at: new Date(Date.now() + 1800000).toISOString(),
  });
  assert.equal(good.status, 200, JSON.stringify(good.data));
  const own = await call(a, "POST", "/v1/admin/access/bindings", {
    ...payload,
    principal_id: a.id,
    limits: { max_amount_micros: 500000, max_batch: 3 },
    expires_at: new Date(Date.now() + 1800000).toISOString(),
  });
  assert.equal(own.status, 403);
  assert.equal(own.data.error.code, "SELF_BINDING_FORBIDDEN");
});

test("the last permanent recovery administrator cannot be revoked or disabled by a deny binding", async () => {
  const a = await admin(),
    b = await admin();
  const prior = (
    await system.db.control.query(
      "SELECT id,expires_at FROM admin_bindings WHERE role_key='super_admin' AND effect='allow' AND scope_kind='global' AND principal_id<>$1",
      [b.id],
    )
  ).rows;
  try {
    await system.db.control.query(
      "UPDATE admin_bindings SET expires_at=now()+interval '1 hour' WHERE role_key='super_admin' AND effect='allow' AND scope_kind='global' AND principal_id<>$1",
      [b.id],
    );
    const binding = (
      await system.db.control.query(
        "SELECT id FROM admin_bindings WHERE principal_id=$1 AND role_key='super_admin'",
        [b.id],
      )
    ).rows[0];
    const revoked = await call(
      a,
      "DELETE",
      "/v1/admin/access/bindings/" + binding.id,
    );
    assert.equal(revoked.status, 409, JSON.stringify(revoked.data));
    assert.equal(revoked.data.error.code, "LAST_SUPER_ADMIN");
    const denied = await call(a, "POST", "/v1/admin/access/bindings", {
      principal_id: b.id,
      role_key: "super_admin",
      scope_kind: "global",
      effect: "deny",
      reason: "Test recovery protection",
    });
    assert.equal(denied.status, 409, JSON.stringify(denied.data));
    assert.equal(denied.data.error.code, "LAST_SUPER_ADMIN");
    assert.equal(
      (
        await system.db.control.query(
          "SELECT count(*)::int AS n FROM admin_bindings WHERE principal_id=$1 AND effect='deny'",
          [b.id],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    for (const row of prior)
      await system.db.control.query(
        "UPDATE admin_bindings SET expires_at=$2 WHERE id=$1",
        [row.id, row.expires_at],
      );
  }
});
