import { isolatedTestEnvironment } from "./native-test-environment.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { startDemoGateway } from "../src/demo-gateway.js";
let system: Awaited<ReturnType<typeof buildApp>>;
interface Client {
  cookie: string;
  csrf: string;
  id: string;
}
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
) {
  const raw = await system.app.inject({
    method: method as any,
    url,
    headers: {
      origin: "http://localhost:4317",
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      "idempotency-key": randomUUID(),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    payload: body ? JSON.stringify(body) : undefined,
  });
  let data: any;
  try {
    data = raw.json();
  } catch {
    data = raw.rawPayload;
  }
  return { status: raw.statusCode, data, raw };
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  const env = { ...isolated.env };
  system = await buildApp(
    loadConfig({
      ...env,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      WORKER_ENABLED: "false",
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
test("the built-in demo gateway withdraws inherited video verification without changing the source configuration", async () => {
  const config = loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", AI_VIDEO_MODEL: "inherited-live-video",
    AI_VIDEO_VERIFIED: "true", AI_VIDEO_HKD_MICROS_PER_SECOND: "100000" });
  const demo = await startDemoGateway(config);
  try {
    assert.equal(config.AI_VIDEO_VERIFIED, true);
    assert.equal(demo.config.AI_VIDEO_VERIFIED, false);
    assert.equal(demo.config.AI_VERIFIED, true);
    assert.notEqual(demo.config.AI_BASE_URL, config.AI_BASE_URL);
  } finally { await demo.close(); }
});
test("simulated mode is loopback-only and forbidden in production", () => {
  assert.throws(
    () =>
      loadConfig({ ...process.env, NODE_ENV: "production", DEMO_MODE: "true" }),
    /DEMO_MODE/,
  );
  assert.throws(
    () =>
      loadConfig({
        ...process.env,
        NODE_ENV: "test",
        HOST: "0.0.0.0",
        DEMO_MODE: "true",
      }),
    /DEMO_MODE/,
  );
});
test(
  "real Codex executes designer and software tools against a labelled mock provider; synthetic credit and charges stay isolated",
  { timeout: 120000 },
  async () => {
    const email = `demo-${randomUUID()}@example.invalid`;
    const challenge = await call(undefined, "POST", "/v1/auth/challenge", {
      email,
    });
    const mail = JSON.parse(
      await readFile(
        `${system.db.config.DATA_DIR}/mailbox/${challenge.data.challenge_id}.json`,
        "utf8",
      ),
    );
    const verify = await call(undefined, "POST", "/v1/auth/verify", {
      challenge_id: challenge.data.challenge_id,
      code: mail.text.match(/\b\d{6}\b/)[0],
    });
    assert.equal(verify.status, 200, JSON.stringify(verify.data));
    const u: Client = {
      cookie: verify.raw.cookies[0].name + "=" + verify.raw.cookies[0].value,
      csrf: verify.data.csrf_token,
      id: verify.data.user.id,
    };
    const created = await call(u, "POST", "/v1/tenants", {
      name: "Simulated test team",
      project_name: "Mock campaign",
    });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.equal(created.data.tenant.data_mode, "simulated");
    const tenant = created.data.tenant.id,
      project = created.data.project.id,
      base = `/v1/tenants/${tenant}/projects/${project}`;
    const credit = await call(u, "POST", `/v1/tenants/${tenant}/demo-credit`);
    const repeat = await call(u, "POST", `/v1/tenants/${tenant}/demo-credit`);
    assert.equal(credit.status, 200, JSON.stringify(credit.data));
    assert.equal(
      repeat.data.wallet.balance_micros,
      credit.data.wallet.balance_micros,
    );
    assert.equal(
      (await call(undefined, "GET", "/v1/public/config")).data.data_mode,
      "simulated",
    );
    for (const role_key of ["designer", "fullstack"]) {
      const submitted = await call(u, "POST", base + "/tasks", {
        title: "Simulated role task",
        prompt:
          "Produce a labelled demo image and sample deliverable for the campaign.",
        role_key,
        budget_micros: 1000000,
        mode: "execute",
      });
      assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
      await system.worker.run(tenant, submitted.data.id);
      const t = await call(u, "GET", base + "/tasks/" + submitted.data.id);
      assert.equal(t.data.status, "succeeded", JSON.stringify(t.data));
      assert.match(t.data.output, /Simulated data|演示資料/);
      assert.equal(t.data.data_mode, "simulated");
      assert.ok(Number(t.data.charged_micros) > 0);
      const events = (
        await system.db.control.query(
          "SELECT kind,body FROM task_events WHERE task_id=$1",
          [t.data.id],
        )
      ).rows;
      assert.ok(events.some((e) => e.kind === "runtime.thread"));
      assert.ok(
        events.some(
          (e) => e.kind === "runtime.phase" && e.body.phase === "closed",
        ),
      );
      const charges = (
        await system.db.control.query(
          "SELECT data_mode FROM ledger WHERE task_id=$1",
          [t.data.id],
        )
      ).rows;
      assert.ok(charges.every((l) => l.data_mode === "simulated"));
    }
    const assets = (await call(u, "GET", base + "/assets")).data.items;
    assert.ok(assets.some((a: any) => a.kind === "generated_image"));
    assert.ok(assets.some((a: any) => a.kind === "source_package"));
    for (const a of assets) {
      const v = (
        await system.db.control.query(
          "SELECT metadata FROM asset_versions WHERE asset_id=$1",
          [a.id],
        )
      ).rows[0];
      assert.equal(v.metadata.data_mode, "simulated");
    }
    const png = await call(
      u,
      "GET",
      `${base}/assets/${assets.find((a: any) => a.kind === "generated_image").id}/download`,
    );
    assert.equal(png.status, 200);
    assert.equal(
      png.raw.rawPayload.subarray(0, 8).toString("hex"),
      "89504e470d0a1a0a",
    );
    const c = system.db.config;
    const unauthorized = await fetch(c.AI_BASE_URL + "/responses", {
      method: "POST",
      body: "{}",
    });
    assert.equal(unauthorized.status, 401);
    const held = await call(u, "POST", base + "/tasks", {
      title: "Mode isolation",
      prompt: "This simulated queued task must wait for its matching worker",
      role_key: "fullstack",
      budget_micros: 1000000,
    });
    assert.equal(held.status, 200);
    const productionMode = system.db.config.DEMO_MODE;
    system.db.config.DEMO_MODE = false;
    try {
      assert.equal(
        (
          await call(u, "POST", base + "/tasks", {
            title: "Must not mix",
            prompt: "Reject synthetic workspace in configured service mode",
            role_key: "fullstack",
            budget_micros: 1000000,
          })
        ).status,
        409,
      );
      await system.worker.run(tenant, held.data.id);
      const unchanged = await call(u, "GET", base + "/tasks/" + held.data.id);
      assert.equal(unchanged.data.status, "queued");
      assert.equal(unchanged.data.charged_micros, "0");
    } finally {
      system.db.config.DEMO_MODE = productionMode;
    }
    assert.equal(
      (await call(u, "POST", base + "/tasks/" + held.data.id + "/cancel"))
        .status,
      200,
    );
  },
);
