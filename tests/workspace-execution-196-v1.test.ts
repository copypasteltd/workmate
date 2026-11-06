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


test('browser and terminal pagination filter on the server before applying cursors and never mix execution types',async()=>{
 const f=await fixture();
 const task=await run(f,async ctx=>{
  await tool(ctx,'code_write')({path:'index.html',content:'<!doctype html><h1>Real browser record</h1>'});
  await tool(ctx,'code_write')({path:'simple.cjs',content:'console.log("actual terminal record");'});
  for(let i=0;i<3;i++)await tool(ctx,'process_run_allowed')({program:'node',entry:'simple.cjs'});
  for(let i=0;i<2;i++)await tool(ctx,'browser_preview')({entry:'index.html',checks:[{name:'actual heading',selector:'h1',expect:{text:'Real browser record'}}]});
 });
 const base=f.base+`/tasks/${task.id}/software-checks`;
 const a=(await call(f.c,'GET',base+'?view=terminal&limit=2')).data;
 assert.equal(a.items.length,2);assert.ok(a.items.every((r:any)=>r.program!=='browser_preview'));assert.ok(a.next_cursor);
 const b=(await call(f.c,'GET',base+'?view=terminal&limit=2&before='+a.next_cursor)).data;
 assert.equal(b.items.length,1);assert.equal(b.next_cursor,null);
 const c=(await call(f.c,'GET',base+'?view=browser&limit=1')).data;
 assert.equal(c.items.length,1);assert.equal(c.items[0].program,'browser_preview');assert.ok(c.next_cursor);
 const d=(await call(f.c,'GET',base+'?view=browser&limit=1&before='+c.next_cursor)).data;
 assert.equal(d.items.length,1);assert.equal(d.items[0].program,'browser_preview');assert.equal(d.next_cursor,null);
 const foreignCursor=(await call(f.c,'GET',base+'?view=browser&before='+a.next_cursor)).data;assert.equal(foreignCursor.items.length,0);
 assert.equal((await call(f.c,'GET',base+'?view=all')).data.items.length,5);
});
