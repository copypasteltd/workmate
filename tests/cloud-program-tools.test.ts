import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { Worker } from "../src/worker.js";
import {
  CodexRuntimeAdapter,
  type RuntimeContext,
  type RuntimeResult,
} from "../src/runtime.js";
import { TaskBusinessTools } from "../src/task-business-tools.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string };
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
) {
  const tenant = /^\/v1\/tenants\/([a-f0-9-]{36})/.exec(url)?.[1];
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: s.db.config.WEB_ORIGIN,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      "idempotency-key": randomUUID(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(
    raw.statusCode >= 200 && raw.statusCode < 300,
    `${raw.statusCode}: ${raw.body}`,
  );
  return { data: raw.json(), raw };
}
async function fixture(role = "fullstack") {
  const challenge = (
    await call(undefined, "POST", "/v1/auth/challenge", {
      email: `program-${randomUUID()}@example.invalid`,
    })
  ).data;
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${challenge.challenge_id}.json`,
      "utf8",
    ),
  );
  const verified = await call(undefined, "POST", "/v1/auth/verify", {
    challenge_id: challenge.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  const c = {
    id: verified.data.user.id,
    cookie:
      "cp_session=" +
      verified.raw.cookies.find((v) => v.name === "cp_session")!.value,
    csrf: verified.data.csrf_token,
  };
  const workspace = (
    await call(c, "POST", "/v1/tenants", {
      name: "Software tool fixture",
      project_name: "Native execution",
    })
  ).data;
  const tenant = workspace.tenant.id,
    project = workspace.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  await call(c, "POST", `/v1/tenants/${tenant}/demo-credit`, {});
  const agent = (
    await call(c, "POST", base + "/agents", {
      name: "Frozen software specialist",
      role_key: role,
    })
  ).data;
  const conversation = (
    await call(c, "POST", base + "/conversations", {
      name: "Actual native software checks",
      agent_id: agent.id,
    })
  ).data;
  return { c, tenant, project, base, agent, conversation };
}
class ControlledRuntime extends CodexRuntimeAdapter {
  failure: unknown;
  constructor(private work: (ctx: RuntimeContext) => Promise<void>) {
    super(s.db.config);
  }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    try {
      await this.work(ctx);
    } catch (e) {
      this.failure = e;
      throw e;
    }
    return {
      status: "completed",
      text: "Synthetic model; actual isolated program and downloadable files.",
      inputTokens: 20,
      outputTokens: 10,
      usageKnown: true,
      accepted: true,
      thread: "software-fixture",
      turn: randomUUID(),
    };
  }
}
async function run(
  f: Awaited<ReturnType<typeof fixture>>,
  work: (ctx: RuntimeContext) => Promise<void>,
  mode = "execute",
) {
  const conversation = (
    await call(f.c, "GET", f.base + `/conversations/${f.conversation.id}`)
  ).data;
  const accepted = (
    await call(
      f.c,
      "POST",
      f.base + `/conversations/${f.conversation.id}/messages`,
      {
        body: "Implement and verify the supplied software acceptance rule.",
        expected_version: conversation.version,
        intent: "delegate",
        mode,
        budget_micros: 1000000,
        client_message_id: randomUUID(),
      },
    )
  ).data;
  const runtime = new ControlledRuntime(work);
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    accepted.task.id,
  );
  if (runtime.failure) throw runtime.failure;
  return (await call(f.c, "GET", f.base + "/tasks/" + accepted.task.id)).data;
}
const tool = (ctx: RuntimeContext, name: string) => {
  const t = ctx.tools.find((v) => v.name === name);
  assert.ok(t, `Missing ${name}`);
  return (args: unknown, id = randomUUID()) => t.run(args, id) as Promise<any>;
};
const zip = async (result: any) => {
  const row = (
    await s.db.control.query(
      "SELECT storage_key FROM asset_versions WHERE id=$1",
      [result.version.id],
    )
  ).rows[0];
  return unzipSync(await s.storage.get(row.storage_key));
};
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
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
    await s?.app.close();
  } finally {
    await isolated?.cleanup();
  }
});

test("private software sources run actual failing/passing Node tests; only exact-source checks reach the delivered ZIP", async () => {
  const f = await fixture();
  let receiptId = "",
    lastTask = "";
  const task = await run(f, async (ctx) => {
    lastTask = ctx.taskId;
    const write = tool(ctx, "code_write"),
      read = tool(ctx, "code_read"),
      execute = tool(ctx, "process_run_allowed"),
      pack = tool(ctx, "code_package");
    await write({ path: "price.cjs", content: "exports.total=(a,b)=>a+b;" });
    await write({
      path: "price.test.cjs",
      content:
        "const t=require('node:test'),a=require('node:assert/strict');t('discount rule',()=>a.equal(require('./price.cjs').total(2,3),6));",
    });
    const failed = await execute({
      program: "node_test",
      entry: "price.test.cjs",
    });
    assert.equal(failed.receipt.passed, false);
    assert.equal(failed.receipt.exit_code, 1);
    const failedZip = await zip(await pack({ filename: "failed-check.zip" }));
    assert.equal(
      JSON.parse(Buffer.from(failedZip["copypaste-manifest.json"]).toString())
        .checks[0].passed,
      false,
    );
    const prior = await read({ path: "price.cjs" });
    await write({
      path: "price.cjs",
      content: "exports.total=(a,b)=>a*b;",
      expected_sha256: prior.sha256,
    });
    const changed = await zip(await pack({ filename: "changed-source.zip" }));
    assert.equal(
      JSON.parse(Buffer.from(changed["copypaste-manifest.json"]).toString())
        .execution_validation,
      "not_executed",
    );
    const key = randomUUID(),
      passed = await execute(
        { program: "node_test", entry: "price.test.cjs" },
        key,
      ),
      replay = await execute(
        { program: "node_test", entry: "price.test.cjs" },
        key,
      );
    assert.equal(passed.receipt.passed, true);
    assert.equal(replay.receipt.execution_id, passed.receipt.execution_id);
    receiptId = passed.record.id;
    const delivery = await pack({ filename: "verified-source.zip" }),
      files = await zip(delivery),
      manifest = JSON.parse(
        Buffer.from(files["copypaste-manifest.json"]).toString(),
      );
    assert.equal(manifest.execution_validation, "checks_recorded");
    assert.equal(manifest.checks.length, 1);
    assert.equal(manifest.checks[0].passed, true);
    assert.match(Buffer.from(files["price.cjs"]).toString(), /a\*b/);
    assert.ok(files[`copypaste-checks/${passed.receipt.execution_id}.json`]);
    assert.equal(manifest.source_digest, passed.receipt.source_digest);
  });
  assert.equal(task.status, "succeeded");
  const history = (
    await call(f.c, "GET", f.base + `/tasks/${task.id}/software-checks?limit=1`)
  ).data;
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].passed, true);
  assert.equal(history.items[0].matches_current_sources, true);
  assert.ok(history.next_cursor);
  const older = (
    await call(
      f.c,
      "GET",
      f.base +
        `/tasks/${task.id}/software-checks?limit=1&before=${history.next_cursor}`,
    )
  ).data;
  assert.equal(older.items.length, 1);
  assert.equal(older.items[0].passed, false);
  assert.equal(older.items[0].matches_current_sources, false);
  const canonical = await s.app.inject({
    method: "GET",
    url: `/v1/tasks/${task.id}/software-checks`,
    headers: { cookie: f.c.cookie, "x-tenant-id": f.tenant },
  });
  assert.equal(canonical.statusCode, 200);
  assert.equal(canonical.json().items.length, 2);
  const receipt = (
    await s.db.control.query("SELECT * FROM assets WHERE id=$1", [receiptId])
  ).rows[0];
  assert.equal(receipt.private_owner, f.c.id);
  const reads = (
    await s.db.control.query(
      "SELECT * FROM task_source_reads WHERE task_id=$1 AND kind='asset_version'",
      [lastTask],
    )
  ).rows;
  assert.ok(reads.length >= 3);
  const stranger = await fixture();
  const denied = await s.app.inject({
    method: "GET",
    url: f.base + `/assets/${receiptId}/download`,
    headers: { cookie: stranger.c.cookie, "x-tenant-id": f.tenant },
  });
  assert.ok([403, 404].includes(denied.statusCode));
  const allowed = await s.app.inject({
    method: "GET",
    url: f.base + `/assets/${receiptId}/download`,
    headers: { cookie: f.c.cookie, "x-tenant-id": f.tenant },
  });
  assert.equal(allowed.statusCode, 200);
  const hidden = await s.app.inject({
    method: "GET",
    url: f.base + `/tasks/${task.id}/software-checks`,
    headers: { cookie: stranger.c.cookie, "x-tenant-id": f.tenant },
  });
  assert.ok([403, 404].includes(hidden.statusCode));
  assert.ok(!hidden.body.includes("discount rule"));
});

test("private API and SQLite checks preserve real failures, exact-source packages, idempotency and withdrawal", async () => {
  const f = await fixture();
  const original = "module.exports=(q,s)=>{s.statusCode=500;s.end('broken');};";
  const fixed =
    "module.exports=(q,s)=>{s.setHeader('content-type','application/json');if(q.headers['x-account']!=='approved'){s.statusCode=401;s.end(JSON.stringify({error:'unauthorized'}));return;}s.statusCode=201;s.end(JSON.stringify({created:true}));};";
  const apiArgs = {
    entry: "api.cjs",
    requests: [
      {
        name: "Unauthenticated request is rejected",
        method: "GET",
        path: "/records",
        expect: { status: 401, json: { error: "unauthorized" } },
      },
      {
        name: "Approved record is created",
        method: "POST",
        path: "/records",
        headers: { "x-account": "approved" },
        body: "{}",
        expect: { status: 201, json: { created: true } },
      },
    ],
  };
  const dbArgs = {
    entry: "schema.sql",
    engine: "sqlite",
    checks: [
      {
        name: "Seeded rows are read from SQLite",
        sql: "SELECT COUNT(*) AS count FROM records",
        expect: { rows: [{ count: 1 }] },
      },
      {
        name: "Duplicate keys are rejected",
        sql: "INSERT INTO records VALUES(1,'duplicate')",
        expect: { error_code: "1555" },
      },
    ],
  };
  let sourceVersion = "",
    api: any,
    database: any,
    packaged: any;
  const task = await run(f, async (ctx) => {
    const write = tool(ctx, "code_write"),
      checkApi = tool(ctx, "api_test"),
      checkDb = tool(ctx, "database_test_native"),
      pack = tool(ctx, "code_package");
    await write({ path: "api.cjs", content: original });
    const source = await write({
      path: "schema.sql",
      content:
        "CREATE TABLE records(id INTEGER PRIMARY KEY,name TEXT);INSERT INTO records VALUES(1,'CopyPaste');",
    });
    sourceVersion = source.asset_version_id;
    assert.equal((await checkApi(apiArgs)).receipt.passed, false);
    await write({
      path: "api.cjs",
      content: fixed,
      expected_sha256: (await tool(ctx, "code_read")({ path: "api.cjs" }))
        .sha256,
    });
    const key = randomUUID();
    api = await checkApi(apiArgs, key);
    const replay = await checkApi(apiArgs, key);
    assert.equal(api.receipt.passed, true);
    assert.equal(api.receipt.execution_id, replay.receipt.execution_id);
    const wrong = await checkDb({
      ...dbArgs,
      checks: [
        {
          name: "Wrong row count stays failed",
          sql: "SELECT COUNT(*) AS count FROM records",
          expect: { rows: [{ count: 99 }] },
        },
      ],
    });
    assert.equal(wrong.receipt.passed, false);
    assert.equal(wrong.receipt.exit_code, 1);
    const dbKey = randomUUID();
    database = await checkDb(dbArgs, dbKey);
    assert.equal(database.receipt.passed, true);
    assert.equal(
      (await checkDb(dbArgs, dbKey)).receipt.execution_id,
      database.receipt.execution_id,
    );
    packaged = await pack({ filename: "api-database-source-and-checks.zip" });
    const bundle = await zip(packaged),
      manifest = JSON.parse(
        Buffer.from(bundle["copypaste-manifest.json"]).toString(),
      );
    assert.equal(manifest.checks.length, 3);
    assert.equal(manifest.checks.filter((v: any) => !v.passed).length, 1);
    assert.equal(manifest.source_digest, api.receipt.source_digest);
    assert.equal(manifest.source_digest, database.receipt.source_digest);
    assert.equal(Buffer.from(bundle["api.cjs"]).toString(), fixed);
    assert.equal(
      JSON.parse(
        Buffer.from(
          bundle[`copypaste-checks/${database.receipt.execution_id}.json`],
        ).toString(),
      ).check_result.kind,
      "sqlite",
    );
    const output = await zip(database.artifacts),
      name = Object.keys(output).find((v) => v.endsWith("/database.sqlite"))!;
    assert.equal(
      Buffer.from(output[name]).subarray(0, 16).toString(),
      "SQLite format 3\0",
    );
    assert.ok(
      database.receipt.workspace_deleted && api.receipt.workspace_deleted,
    );
  });
  assert.equal(task.status, "succeeded");
  const history = (
    await call(f.c, "GET", f.base + `/tasks/${task.id}/software-checks`)
  ).data;
  assert.equal(history.items.length, 4);
  assert.equal(
    history.items.filter((v: any) => v.check_result.kind === "api").length,
    2,
  );
  assert.equal(
    history.items.filter((v: any) => v.check_result.kind === "sqlite").length,
    2,
  );
  assert.equal(
    history.items.filter((v: any) => v.matches_current_sources === false)
      .length,
    1,
  );
  assert.ok(history.items.every((v: any) => v.check_result.checks.length > 0));
  const canonical = await s.app.inject({
    method: "GET",
    url: `/v1/tasks/${task.id}/software-checks`,
    headers: { cookie: f.c.cookie, "x-tenant-id": f.tenant },
  });
  assert.equal(canonical.statusCode, 200);
  assert.equal(canonical.json().items.length, 4);
  const stranger = await fixture();
  for (const result of [api, database]) {
    const denied = await s.app.inject({
      method: "GET",
      url: f.base + `/assets/${result.record.id}/download`,
      headers: { cookie: stranger.c.cookie, "x-tenant-id": f.tenant },
    });
    assert.ok([403, 404].includes(denied.statusCode));
    assert.equal(
      (
        await s.app.inject({
          method: "GET",
          url: f.base + `/assets/${result.record.id}/download`,
          headers: { cookie: f.c.cookie, "x-tenant-id": f.tenant },
        })
      ).statusCode,
      200,
    );
  }
  await s.db.control.query(
    "UPDATE assets SET state='deleted' WHERE id=(SELECT asset_id FROM asset_versions WHERE id=$1)",
    [sourceVersion],
  );
  for (const id of [
    api.record.id,
    api.artifacts.id,
    database.record.id,
    database.artifacts.id,
    packaged.id,
  ]) {
    const revoked = await s.app.inject({
      method: "GET",
      url: f.base + `/assets/${id}/download`,
      headers: { cookie: f.c.cookie, "x-tenant-id": f.tenant },
    });
    assert.ok(
      [404, 410].includes(revoked.statusCode),
      `${revoked.statusCode}: ${revoked.body}`,
    );
  }
  const revoked = await s.app.inject({
    method: "GET",
    url: f.base + `/tasks/${task.id}/software-checks`,
    headers: { cookie: f.c.cookie, "x-tenant-id": f.tenant },
  });
  assert.ok([404, 409, 410].includes(revoked.statusCode));
  assert.ok(!revoked.body.includes("Approved record"));
});

test("private real browser previews preserve source versions, screenshots, replay and withdrawal boundaries", async () => {
  const f = await fixture(),
    args = {
      entry: "index.html",
      actions: [{ action: "click", selector: "button" }],
      checks: [
        {
          name: "Save reaches the expected page state",
          selector: "#result",
          expect: { text: "Saved" },
        },
      ],
    };
  let result: any,
    packaged: any,
    sourceVersion = "";
  const original =
      "<!doctype html><h1>Workmate</h1><button>Save</button><p id=result>Broken</p>",
    fixed =
      "<!doctype html><h1>Workmate</h1><button onclick=\"document.querySelector('#result').textContent='Saved'\">Save</button><p id=result>Pending</p>";
  const task = await run(f, async (ctx) => {
    await tool(ctx, "code_write")({ path: "index.html", content: original });
    const preview = tool(ctx, "browser_preview"),
      failed = await preview(args);
    assert.equal(failed.receipt.passed, false);
    assert.ok(failed.preview);
    const written = await tool(
      ctx,
      "code_write",
    )({
      path: "index.html",
      content: fixed,
      expected_sha256: (await tool(ctx, "code_read")({ path: "index.html" }))
        .sha256,
    });
    sourceVersion = written.asset_version_id;
    const key = randomUUID();
    result = await preview(args, key);
    assert.equal(
      result.receipt.passed,
      true,
      JSON.stringify(result.receipt.check_result),
    );
    assert.equal(
      (await preview(args, key)).receipt.execution_id,
      result.receipt.execution_id,
    );
    packaged = await tool(
      ctx,
      "code_package",
    )({ filename: "actual-browser-checked-source.zip" });
    const bundle = await zip(packaged),
      manifest = JSON.parse(
        Buffer.from(bundle["copypaste-manifest.json"]).toString(),
      );
    assert.equal(manifest.checks.length, 1);
    assert.equal(manifest.checks[0].program, "browser_preview");
    assert.equal(manifest.source_digest, result.receipt.source_digest);
    assert.equal(Buffer.from(bundle["index.html"]).toString(), fixed);
    const output = await zip(result.artifacts);
    assert.equal(
      Buffer.from(output["files/browser-preview.png"])
        .subarray(0, 8)
        .toString("hex"),
      "89504e470d0a1a0a",
    );
    assert.ok(
      Buffer.from(output["files/page-text.txt"]).toString().includes("Saved"),
    );
  });
  const history = (
    await call(f.c, "GET", f.base + `/tasks/${task.id}/software-checks`)
  ).data;
  assert.equal(history.items.length, 2);
  assert.equal(
    history.items.filter((r: any) => r.matches_current_sources === false)
      .length,
    1,
  );
  const item = history.items.find(
    (r: any) => r.execution_id === result.receipt.execution_id,
  );
  assert.ok(item.preview);
  assert.equal(item.check_result.kind, "browser");
  const scoped =
      f.base + `/tasks/${task.id}/software-checks/${item.id}/preview`,
    canonical = `/v1/tasks/${task.id}/software-checks/${item.id}/preview`;
  for (const url of [scoped, canonical]) {
    const shot = await s.app.inject({
      method: "GET",
      url,
      headers: { cookie: f.c.cookie, "x-tenant-id": f.tenant },
    });
    assert.equal(shot.statusCode, 200, shot.body);
    assert.equal(shot.headers["cache-control"], "private, no-store");
    const json = shot.json();
    assert.equal(json.width, 1280);
    assert.equal(json.height, 800);
    assert.equal(Buffer.from(json.base64, "base64").length, json.bytes);
    assert.equal(
      Buffer.from(json.base64, "base64").subarray(0, 8).toString("hex"),
      "89504e470d0a1a0a",
    );
  }
  const other = await fixture();
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [f.tenant, other.c.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [f.tenant, f.project, other.c.id],
  );
  for (const url of [
    scoped,
    canonical,
    f.base + `/assets/${result.preview.id}/download`,
  ]) {
    const denied = await s.app.inject({
      method: "GET",
      url,
      headers: { cookie: other.c.cookie, "x-tenant-id": f.tenant },
    });
    assert.ok(
      [403, 404].includes(denied.statusCode),
      `${denied.statusCode}: ${denied.body}`,
    );
    assert.ok(!denied.body.includes("base64"));
  }
  await s.db.control.query(
    "UPDATE assets SET state='deleted' WHERE id=(SELECT asset_id FROM asset_versions WHERE id=$1)",
    [sourceVersion],
  );
  for (const url of [
    scoped,
    canonical,
    ...[
      result.record.id,
      result.artifacts.id,
      result.preview.id,
      packaged.id,
    ].map((id) => f.base + `/assets/${id}/download`),
  ]) {
    const denied = await s.app.inject({
      method: "GET",
      url,
      headers: { cookie: f.c.cookie, "x-tenant-id": f.tenant },
    });
    assert.ok(
      [404, 409, 410].includes(denied.statusCode),
      `${denied.statusCode}: ${denied.body}`,
    );
    assert.ok(!denied.body.includes("base64"));
  }
});

test("ask/plan, an ungranted role and Desktop never receive the cloud native runner", async () => {
  const f = await fixture();
  for (const mode of ["ask", "plan"])
    await run(
      f,
      async (ctx) => {
        assert.equal(
          ctx.tools.some((v) =>
            [
              "process_run_allowed",
              "api_test",
              "database_test_native",
              "browser_preview",
            ].includes(v.name),
          ),
          false,
        );
        assert.equal(
          ctx.tools.some((v) => v.name === "code_write"),
          false,
        );
      },
      mode,
    );
  const helper = await fixture("assistant");
  await run(helper, async (ctx) =>
    assert.equal(
      ctx.tools.some((v) =>
        [
          "process_run_allowed",
          "api_test",
          "database_test_native",
          "browser_preview",
        ].includes(v.name),
      ),
      false,
    ),
  );
  const forbidden = new TaskBusinessTools(s.db, s.catalog, s.storage, {
    authorize: async () => {},
    inference: async () => {},
  }).build(
    {
      id: randomUUID(),
      tenant_id: f.tenant,
      project_id: f.project,
      execution_location: "desktop",
      mode: "execute",
      input_context: {},
    },
    { id: f.c.id } as any,
    randomUUID(),
    s.catalog.role("fullstack"),
  );
  assert.equal(
    forbidden.some((v) =>
      [
        "process_run_allowed",
        "api_test",
        "database_test_native",
        "browser_preview",
      ].includes(v.name),
    ),
    false,
  );
});

test("current source deletion revokes recorded execution artifacts", async () => {
  const f = await fixture();
  let sourceVersion = "",
    receiptId = "";
  await run(f, async (ctx) => {
    const written = await tool(
      ctx,
      "code_write",
    )({ path: "main.cjs", content: "console.log('FIRST_EXACT_SOURCE');" });
    sourceVersion = written.asset_version_id;
    const result = await tool(
      ctx,
      "process_run_allowed",
    )({ program: "node", entry: "main.cjs" });
    receiptId = result.record.id;
  });
  const version = (
    await s.db.control.query(
      "SELECT asset_id FROM asset_versions WHERE id=$1",
      [sourceVersion],
    )
  ).rows[0];
  await s.db.control.query("UPDATE assets SET state='deleted' WHERE id=$1", [
    version.asset_id,
  ]);
  const download = await s.app.inject({
    method: "GET",
    url: f.base + `/assets/${receiptId}/download`,
    headers: { cookie: f.c.cookie, "x-tenant-id": f.tenant },
  });
  assert.ok([404, 410].includes(download.statusCode));
  const history = await s.app.inject({
    method: "GET",
    url:
      f.base +
      `/tasks/${(await s.db.control.query("SELECT metadata->>'task_id' AS id FROM asset_versions WHERE asset_id=$1", [receiptId])).rows[0].id}/software-checks`,
    headers: { cookie: f.c.cookie, "x-tenant-id": f.tenant },
  });
  assert.ok([404, 409, 410].includes(history.statusCode));
  assert.ok(!history.body.includes("FIRST_EXACT_SOURCE"));
});
