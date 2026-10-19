import { isolatedTestEnvironment } from "./native-test-environment.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal } from "../src/lib.js";
import { totp } from "../src/auth.js";
import { advanceSchedules } from "../src/schedules.js";
import { advanceWorkflows } from "../src/business.js";

let system: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string; admin?: boolean };
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  payload?: unknown,
  idempotency: string = randomUUID(),
) {
  const raw = await system.app.inject({
    method: method as any,
    url,
    headers: {
      origin: c?.admin ? "http://localhost:4318" : "http://localhost:4317",
      "idempotency-key": idempotency,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function ok(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  key?: string,
) {
  const r = await call(c, method, url, body, key);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function account(admin = false, tenant?: string): Promise<Client> {
  const email = `scheduler-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 }).base32;
  let id: string | undefined;
  if (admin) {
    id = (
      await system.db.control.query(
        "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Schedule operator',$2) RETURNING id",
        [email, seal(system.db.config.MASTER_KEY!, secret)],
      )
    ).rows[0].id;
    await system.db.control.query(
      "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,'super_admin',$2,$3)",
      [id, tenant ? "tenant" : "global", tenant ?? null],
    );
  }
  const prefix = admin ? "/v1/admin/auth" : "/v1/auth",
    c = await ok(undefined, "POST", prefix + "/challenge", { email });
  const mail = JSON.parse(
    await readFile(
      `${system.db.config.DATA_DIR}/mailbox/${c.challenge_id}.json`,
      "utf8",
    ),
  );
  const v = await call(undefined, "POST", prefix + "/verify", {
    challenge_id: c.challenge_id,
    code: mail.text.match(/code is (\d{6})/)[1],
    ...(admin ? { totp: totp(secret).generate() } : {}),
  });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  return {
    id: id ?? v.data.user.id,
    cookie: v.raw.cookies[0].name + "=" + v.raw.cookies[0].value,
    csrf: v.data.csrf_token,
    admin,
  };
}
async function fixture(options: { approval?: boolean; codex?: boolean } = {}) {
  const owner = await account(),
    w = await ok(owner, "POST", "/v1/tenants", {
      name: "Schedule test",
      project_name: "Campaign reports",
    });
  const base = `/v1/tenants/${w.tenant.id}/projects/${w.project.id}`;
  const dataset = await ok(owner, "POST", base + "/analytics/import", {
    name: "Paid campaign",
    csv: "date,channel,impressions,clicks,spend,conversions,revenue\n2026-10-01,google,1000,20,12.5,2,50",
    timezone: "Asia/Hong_Kong",
  });
  const steps: any[] = options.codex
    ? [
        {
          kind: "codex",
          role_key: "frontend",
          prompt: "Build a campaign page",
          budget_micros: 1000000,
        },
      ]
    : [{ kind: "analytics.summary", dataset_id: dataset.id }];
  if (options.approval)
    steps.push({ kind: "approval", message: "Review the calculated report" });
  const workflow = await ok(owner, "POST", base + "/workflows", {
    name: "Campaign report",
    definition: { steps },
  });
  await ok(owner, "POST", base + "/workflows/" + workflow.id + "/publish");
  return {
    owner,
    w,
    base,
    workflow,
    scheduleBase: base + "/workflow-schedules",
  };
}
async function schedule(
  f: Awaited<ReturnType<typeof fixture>>,
  overrides: any = {},
) {
  const input = {
    name: "Daily campaign report",
    workflow_id: f.workflow.id,
    calendar: { timezone: "UTC", frequency: "daily", time: "09:00" },
    catch_up: "latest",
    starts_at: new Date(Date.now() + 60000).toISOString(),
    ...overrides,
  };
  const preview = await ok(f.owner, "POST", f.scheduleBase + "/preview", input);
  const body = {
      ...preview.input,
      expected_workflow_version: preview.workflow_version,
      expected_definition_hash: preview.definition_hash,
    },
    key = randomUUID();
  const row = await ok(f.owner, "POST", f.scheduleBase, body, key);
  return { row, body, key, due: Date.parse(row.next_due_at) };
}
async function tick(now: number) {
  await advanceSchedules(system.db, system.catalog, now);
}
async function occurrences(id: string) {
  return (
    await system.db.control.query(
      "SELECT * FROM workflow_schedule_occurrences WHERE schedule_id=$1 ORDER BY created_at,scheduled_local",
      [id],
    )
  ).rows;
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  const env = {
    ...isolated.env,
    NODE_ENV: "test",
    WORKER_ENABLED: "false",
  };
  system = await buildApp(loadConfig(env), { worker: false });
});
after(async () => {
  try {
    await system?.app.close();
  } finally {
    await isolated?.cleanup();
  }
});

test("schedule preview freezes the workflow; create is atomic/idempotent and rejects stale hashes and cross-project references", async () => {
  const f = await fixture(),
    s = await schedule(f);
  assert.equal(s.row.body.workflow_version, f.workflow.version);
  assert.equal(
    (await ok(f.owner, "POST", f.scheduleBase, s.body, s.key)).id,
    s.row.id,
  );
  assert.equal(
    (
      await call(f.owner, "POST", f.scheduleBase, {
        ...s.body,
        expected_definition_hash: "0".repeat(64),
      })
    ).data.error.code,
    "WORKFLOW_VERSION_CHANGED",
  );
  const other = await fixture();
  assert.equal(
    (
      await call(f.owner, "POST", f.scheduleBase + "/preview", {
        ...s.body,
        expected_definition_hash: undefined,
        expected_workflow_version: undefined,
        workflow_id: other.workflow.id,
      })
    ).status,
    409,
  );
  await assert.rejects(
    system.db.tx(
      (tx) =>
        tx.query(
          "UPDATE workflow_schedule_versions SET body='{}' WHERE schedule_id=$1",
          [s.row.id],
        ),
      f.w.tenant.id,
    ),
    { code: "42501" },
  );
});
test("concurrent schedulers and repeated ticks launch one run; the real report persists and an unfinished review prevents overlap", async () => {
  const f = await fixture({ approval: true }),
    s = await schedule(f);
  await Promise.all([tick(s.due), tick(s.due), tick(s.due)]);
  let items = await occurrences(s.row.id);
  assert.equal(items.length, 1);
  assert.equal(items[0].state, "launched");
  const run = items[0].run_id;
  await advanceWorkflows(system.db, system.catalog, system.storage);
  await advanceWorkflows(system.db, system.catalog, system.storage);
  const detail = (
    await system.db.control.query("SELECT * FROM workflow_runs WHERE id=$1", [
      run,
    ])
  ).rows[0];
  assert.equal(detail.state, "awaiting_approval");
  const asset = (
    await system.db.control.query(
      "SELECT storage_key FROM asset_versions WHERE asset_id=$1",
      [detail.results[0].asset_id],
    )
  ).rows[0];
  const report = JSON.parse(
    (await system.storage.get(asset.storage_key)).toString("utf8"),
  );
  assert.equal(report.metrics.spend_micros, 12500000);
  assert.equal(report.metrics.roas, 4);
  await tick(s.due + 86400000);
  assert.equal((await occurrences(s.row.id))[1].state, "skipped_overlap");
  await ok(f.owner, "POST", f.base + "/workflow-runs/" + run + "/decision", {
    decision: "approve",
  });
  await advanceWorkflows(system.db, system.catalog, system.storage);
  await tick(s.due + 2 * 86400000);
  assert.equal(
    (await occurrences(s.row.id)).filter((x) => x.state === "launched").length,
    2,
  );
});
test("downtime coalesces earlier opportunities into one range and launches only the latest; skip policy and end dates never backfill charges", async () => {
  const f = await fixture(),
    s = await schedule(f);
  await tick(s.due + 1000 * 86400000 + 60000);
  const items = await occurrences(s.row.id);
  assert.equal(items.filter((x) => x.state === "launched").length, 1);
  assert.equal(items.find((x) => x.code === "COALESCED").missed_count, 1000);
  const skipped = await schedule(f, { catch_up: "skip" });
  await tick(skipped.due + 120000);
  assert.equal((await occurrences(skipped.row.id))[0].state, "skipped_missed");
  const end = new Date(Date.now() + 2 * 86400000).toISOString(),
    ended = await schedule(f, { ends_at: end });
  await tick(Date.parse(end));
  assert.equal(
    (
      await system.db.control.query(
        "SELECT state FROM workflow_schedules WHERE id=$1",
        [ended.row.id],
      )
    ).rows[0].state,
    "ended",
  );
  assert.equal((await occurrences(ended.row.id)).length, 0);
});
test("pause/resume and edits are CAS/idempotent, preserve immutable history and require a fresh delegated run identity", async () => {
  const f = await fixture(),
    s = await schedule(f),
    action = { expected_version: s.row.version, action: "pause" },
    key = randomUUID();
  const paused = await ok(
    f.owner,
    "POST",
    f.scheduleBase + "/" + s.row.id + "/status",
    action,
    key,
  );
  assert.equal(
    (
      await ok(
        f.owner,
        "POST",
        f.scheduleBase + "/" + s.row.id + "/status",
        action,
        key,
      )
    ).version,
    paused.version,
  );
  await tick(s.due);
  assert.equal((await occurrences(s.row.id)).length, 0);
  assert.equal(
    (
      await call(f.owner, "POST", f.scheduleBase + "/" + s.row.id + "/status", {
        ...action,
        action: "resume",
      })
    ).data.error.code,
    "VERSION_CONFLICT",
  );
  const resumed = await ok(
    f.owner,
    "POST",
    f.scheduleBase + "/" + s.row.id + "/status",
    { expected_version: paused.version, action: "resume" },
  );
  assert.equal(resumed.revision, 2);
  assert.equal(resumed.body.run_as, f.owner.id);
  const edited = await ok(
    f.owner,
    "POST",
    f.scheduleBase + "/" + s.row.id + "/versions",
    {
      ...s.body,
      expected_version: resumed.version,
      calendar: {
        timezone: "Asia/Hong_Kong",
        frequency: "weekly",
        time: "10:30",
        weekdays: [1, 5],
      },
    },
  );
  assert.equal(edited.revision, 3);
  assert.equal(edited.body.calendar.timezone, "Asia/Hong_Kong");
  const detail = await ok(f.owner, "GET", f.scheduleBase + "/" + s.row.id);
  assert.equal(detail.versions.length, 3);
  assert.equal(detail.versions[2].body.calendar.timezone, "UTC");
});
test("account revocation blocks future schedules; restoring the account does not revive an old authorization", async () => {
  const f = await fixture(),
    s = await schedule(f);
  await system.db.control.query(
    "UPDATE users SET auth_version=auth_version+1 WHERE id=$1",
    [f.owner.id],
  );
  await tick(s.due);
  const row = (
    await system.db.control.query(
      "SELECT * FROM workflow_schedules WHERE id=$1",
      [s.row.id],
    )
  ).rows[0];
  assert.equal(row.state, "blocked");
  assert.equal(row.last_error, "AUTHORIZATION_CHANGED");
  await tick(s.due + 86400000);
  assert.equal((await occurrences(s.row.id)).length, 1);
  assert.equal((await occurrences(s.row.id))[0].run_id, null);
  const admin = await account(true, f.w.tenant.id);
  assert.equal(
    (
      await call(
        admin,
        "POST",
        "/v1/admin/workflow-schedules/" + s.row.id + "/resume",
        {
          expected_version: row.version,
          reason: "Review original authorization",
        },
      )
    ).data.error.code,
    "RUN_AUTHORIZATION_REQUIRED",
  );
});
test("cross-workspace and viewer access is denied; restricted database roles cannot read history outside their tenant", async () => {
  const f = await fixture(),
    s = await schedule(f),
    outsider = await account();
  assert.equal((await call(outsider, "GET", f.scheduleBase)).status, 404);
  await system.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'viewer')",
    [f.w.tenant.id, outsider.id],
  );
  await system.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'viewer')",
    [f.w.tenant.id, f.w.project.id, outsider.id],
  );
  assert.equal((await call(outsider, "GET", f.scheduleBase)).status, 200);
  assert.equal(
    (
      await call(
        outsider,
        "POST",
        f.scheduleBase + "/" + s.row.id + "/status",
        { expected_version: s.row.version, action: "pause" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await system.db.tx(
        (tx) =>
          tx.query(
            "SELECT 1 FROM workflow_schedule_versions WHERE schedule_id=$1",
            [s.row.id],
          ),
        randomUUID(),
      )
    ).rowCount,
    0,
  );
});
test("admin schedule visibility honors explicit scope and pause needs MFA/CAS; content deletion scrubs version bodies and replay results", async () => {
  const f = await fixture(),
    s = await schedule(f),
    a = await account(true, f.w.tenant.id),
    other = await fixture(),
    os = await schedule(other);
  const list = await ok(a, "GET", "/v1/admin/workflow-schedules");
  assert.equal(
    list.items.some((x: any) => x.id === s.row.id),
    true,
  );
  assert.equal(
    list.items.some((x: any) => x.id === os.row.id),
    false,
  );
  assert.equal(
    (
      await call(
        a,
        "POST",
        "/v1/admin/workflow-schedules/" + os.row.id + "/pause",
        { expected_version: os.row.version, reason: "Review recurring work" },
      )
    ).status,
    403,
  );
  await ok(a, "POST", "/v1/admin/workflow-schedules/" + s.row.id + "/pause", {
    expected_version: s.row.version,
    reason: "Review recurring work",
  });
  const paused = (
    await system.db.control.query(
      "SELECT * FROM workflow_schedules WHERE id=$1",
      [s.row.id],
    )
  ).rows[0];
  await ok(a, "POST", "/v1/admin/workflow-schedules/" + s.row.id + "/resume", {
    expected_version: paused.version,
    reason: "Resume original confirmed work",
  });
  const resumed = (
    await system.db.control.query(
      "SELECT * FROM workflow_schedules WHERE id=$1",
      [s.row.id],
    )
  ).rows[0];
  assert.equal(resumed.revision, 1);
  assert.equal(resumed.state, "active");
  await system.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [a.id],
  );
  assert.equal(
    (
      await call(
        a,
        "POST",
        "/v1/admin/workflow-schedules/" + s.row.id + "/pause",
        {
          expected_version: resumed.version,
          reason: "Expired MFA must be refused",
        },
      )
    ).data.error.code,
    "MFA_REQUIRED",
  );
  await system.db.control.query(
    "UPDATE sessions SET mfa_at=now() WHERE admin_id=$1",
    [a.id],
  );
  const meta = (
    await system.db.control.query(
      "SELECT * FROM workflow_schedules WHERE id=$1",
      [s.row.id],
    )
  ).rows[0];
  await ok(a, "POST", "/v1/admin/content/" + s.row.id + "/action", {
    action: "delete",
    version: meta.moderation_version,
    reason: "Remove the saved schedule",
  });
  assert.equal(
    (await call(f.owner, "GET", f.scheduleBase + "/" + s.row.id)).status,
    404,
  );
  assert.deepEqual(
    (
      await system.db.control.query(
        "SELECT body FROM workflow_schedule_versions WHERE schedule_id=$1",
        [s.row.id],
      )
    ).rows[0].body,
    {},
  );
  assert.equal(
    (await call(f.owner, "POST", f.scheduleBase, s.body, s.key)).data.error
      .code,
    "REQUEST_RESULT_REMOVED",
  );
});
test("cancelling a scheduled review is idempotent and frees its active slot without replaying the prior report", async () => {
  const f = await fixture({ approval: true }),
    s = await schedule(f);
  await tick(s.due);
  const run = (await occurrences(s.row.id))[0].run_id;
  await advanceWorkflows(system.db, system.catalog, system.storage);
  await advanceWorkflows(system.db, system.catalog, system.storage);
  await ok(f.owner, "POST", f.base + "/workflow-runs/" + run + "/cancel");
  await ok(f.owner, "POST", f.base + "/workflow-runs/" + run + "/cancel");
  assert.equal(
    (
      await system.db.control.query(
        "SELECT state FROM workflow_runs WHERE id=$1",
        [run],
      )
    ).rows[0].state,
    "cancelled",
  );
  await tick(s.due + 86400000);
  assert.equal(
    (await occurrences(s.row.id)).filter((x) => x.state === "launched").length,
    2,
  );
});

test("uncertain child execution keeps the schedule occupied even after its workflow fails", async () => {
  const f = await fixture(),
    s = await schedule(f);
  await tick(s.due);
  const run = (await occurrences(s.row.id))[0].run_id;
  const task = (
    await system.db.control.query(
      "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key,actor_auth_version,status) VALUES($1,$2,$3,'Uncertain step','Preserve uncertain work','frontend',$4,1000000,$5,1,'reconciling') RETURNING id",
      [f.w.tenant.id, f.w.project.id, f.owner.id, "0".repeat(64), randomUUID()],
    )
  ).rows[0].id;
  await system.db.control.query(
    "UPDATE workflow_runs SET state='failed',active_task=$2 WHERE id=$1",
    [run, task],
  );
  await tick(s.due + 86400000);
  assert.equal((await occurrences(s.row.id))[1].state, "skipped_overlap");
  await system.db.control.query(
    "UPDATE tasks SET status='cancelled' WHERE id=$1",
    [task],
  );
  await tick(s.due + 2 * 86400000);
  assert.equal(
    (await occurrences(s.row.id)).filter((x) => x.state === "launched").length,
    2,
  );
});

test("a scheduled Codex role is pinned and a changed installed role blocks execution before charging", async () => {
  const f = await fixture({ codex: true }),
    s = await schedule(f);
  assert.equal(s.row.body.max_budget_micros, 1000000);
  const digest = system.catalog.digest;
  try {
    system.catalog.digest = () => "0".repeat(64);
    await tick(s.due);
  } finally {
    system.catalog.digest = digest;
  }
  const row = (
    await system.db.control.query(
      "SELECT state,last_error FROM workflow_schedules WHERE id=$1",
      [s.row.id],
    )
  ).rows[0];
  assert.equal(row.state, "blocked");
  assert.equal(row.last_error, "ROLE_VERSION_CHANGED");
  assert.equal((await occurrences(s.row.id))[0].run_id, null);
});
