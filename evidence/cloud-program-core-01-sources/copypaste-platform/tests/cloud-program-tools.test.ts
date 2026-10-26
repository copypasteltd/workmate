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
const zip = (result: any) =>
  s.storage.get(result.version.storage_key).then((b) => unzipSync(b));
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
    receiptId = passed.record.asset.id;
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
    url: f.base + `/assets/${receiptId}`,
    headers: { cookie: stranger.c.cookie, "x-tenant-id": f.tenant },
  });
  assert.equal(denied.statusCode, 404);
});

test("ask/plan, an ungranted role and Desktop never receive the cloud native runner", async () => {
  const f = await fixture();
  for (const mode of ["ask", "plan"])
    await run(
      f,
      async (ctx) => {
        assert.equal(
          ctx.tools.some((v) => v.name === "process_run_allowed"),
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
      ctx.tools.some((v) => v.name === "process_run_allowed"),
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
    forbidden.some((v) => v.name === "process_run_allowed"),
    false,
  );
});

test("current source deletion revokes recorded execution artifacts and a fresh task sees the edited private tree", async () => {
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
    receiptId = result.record.asset.id;
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
  assert.equal(download.statusCode, 410);
});
