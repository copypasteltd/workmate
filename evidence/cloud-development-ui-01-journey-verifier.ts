import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  WorkmateRecording,
  saveWorkmateScreenshot,
} from "./record-workmate-media.js";
const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform"),
  attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = path.resolve("evidence/cloud-development-ui-" + attempt),
  checks: string[] = [],
  errors: string[] = [],
  screenshots: any[] = [];
let browser: Browser | undefined,
  system: any,
  isolated: any,
  recording: WorkmateRecording | undefined,
  media: any,
  task: any,
  providerCalls = 0,
  providerError: unknown;
let browserClosed = false,
  apiClosed = false,
  fixtureClosed = false;
const original = "module.exports=(q,s)=>{s.statusCode=500;s.end('broken');};",
  fixed =
    "module.exports=(q,s)=>{s.setHeader('content-type','application/json');if(q.headers['x-account']!=='approved'){s.statusCode=401;s.end(JSON.stringify({error:'unauthorized'}));return;}s.statusCode=201;s.end(JSON.stringify({created:true}));};";
const apiArgs = {
  entry: "api.cjs",
  requests: [
    {
      name: "Reject unauthenticated requests",
      method: "GET",
      path: "/records",
      expect: { status: 401, json: { error: "unauthorized" } },
    },
    {
      name: "Create an approved record",
      method: "POST",
      path: "/records",
      headers: { "x-account": "approved" },
      body: "{}",
      expect: { status: 201, json: { created: true } },
    },
  ],
};
const plan = [
  ["code_write", { path: "api.cjs", content: original }],
  [
    "code_write",
    {
      path: "schema.sql",
      content:
        "CREATE TABLE records(id INTEGER PRIMARY KEY,name TEXT);INSERT INTO records VALUES(1,'CopyPaste');",
    },
  ],
  ["api_test", apiArgs],
  [
    "code_write",
    {
      path: "api.cjs",
      content: fixed,
      expected_sha256: createHash("sha256").update(original).digest("hex"),
    },
  ],
  ["api_test", apiArgs],
  [
    "database_test_native",
    {
      engine: "sqlite",
      entry: "schema.sql",
      checks: [
        {
          name: "Read seeded customer data",
          sql: "SELECT name FROM records WHERE id=?",
          params: [1],
          expect: { rows: [{ name: "CopyPaste" }] },
        },
        {
          name: "Reject duplicate primary keys",
          sql: "INSERT INTO records VALUES(1,'duplicate')",
          expect: { error_code: "1555" },
        },
      ],
    },
  ],
  ["code_package", { filename: "api-database-source-and-checks.zip" }],
] as const;
const provider = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const b of req) chunks.push(Buffer.from(b));
    assert.equal(
      req.headers.authorization,
      "Bearer cloud-development-ui-fixture",
    );
    if (req.url === "/v1/responses/input_tokens") {
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(
          JSON.stringify({ object: "response.input_tokens", input_tokens: 20 }),
        );
      return;
    }
    assert.equal(req.url, "/v1/responses");
    const body = JSON.parse(Buffer.concat(chunks).toString()),
      index = providerCalls++;
    assert.ok(index <= plan.length);
    if (index === 3)
      assert.ok(
        JSON.stringify(body.input).includes("command_failed"),
        "The actual failing company tool output must reach real Codex before the repair",
      );
    if (index === 5)
      assert.ok(
        JSON.stringify(body.input).includes("command_passed"),
        "The actual passing company tool output must reach real Codex before packaging",
      );
    let item: any;
    if (index < plan.length) {
      const [name, args] = plan[index],
        tools = (body.tools ?? []).flatMap((t: any) =>
          t.type === "namespace"
            ? t.tools.map((x: any) => ({ ...x, name: t.name + "." + x.name }))
            : [t],
        );
      const declaration = tools.find(
        (t: any) => t.name === name || t.name.endsWith("." + name),
      );
      assert.ok(declaration, "The exact tool must be declared by real Codex");
      item = {
        type: "function_call",
        id: "fc_software_" + index,
        call_id: "call_software_" + index,
        name: declaration.name,
        arguments: JSON.stringify(args),
      };
    } else
      item = {
        type: "message",
        id: "msg_software",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: "The initial HTTP checks failed. I corrected the handler, reran actual requests, checked real SQLite data and constraints, and saved the exact source with detailed check records. Synthetic model response; actual execution and files.",
            annotations: [],
          },
        ],
      };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (type: string, value: any) =>
      res.write(
        `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`,
      );
    const response = {
      id: "resp_software_" + index,
      object: "response",
      status: "in_progress",
      output: [],
    };
    emit("response.created", { response });
    emit("response.output_item.added", {
      output_index: 0,
      item: item.type === "function_call" ? { ...item, arguments: "" } : item,
    });
    if (item.type === "function_call") {
      emit("response.function_call_arguments.delta", {
        output_index: 0,
        item_id: item.id,
        delta: item.arguments,
      });
      emit("response.function_call_arguments.done", {
        output_index: 0,
        item_id: item.id,
        arguments: item.arguments,
      });
    } else {
      emit("response.content_part.added", {
        output_index: 0,
        item_id: item.id,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      });
      emit("response.output_text.delta", {
        output_index: 0,
        item_id: item.id,
        content_index: 0,
        delta: item.content[0].text,
      });
      emit("response.output_text.done", {
        output_index: 0,
        item_id: item.id,
        content_index: 0,
        text: item.content[0].text,
      });
    }
    emit("response.output_item.done", { output_index: 0, item });
    emit("response.completed", {
      response: {
        ...response,
        status: "completed",
        output: [item],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
      },
    });
    res.end();
  } catch (e) {
    providerError = e;
    res.writeHead(500).end("Synthetic provider rejected an unexpected request");
  }
});
const pass = (s: string) => {
  checks.push(s);
  console.log("PASS: " + s);
};
const load = (f: string) => import(pathToFileURL(path.join(platform, f)).href);
async function until(
  fn: () => Promise<any>,
  accept: (v: any) => boolean,
  label: string,
  ms = 90000,
) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (accept(v)) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Timed out: " + label);
}
try {
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  const [
    { isolatedTestEnvironment },
    { buildApp },
    { loadConfig },
    { Worker },
  ] = await Promise.all([
    load("tests/native-test-environment.ts"),
    load("src/server.ts"),
    load("src/config.ts"),
    load("src/worker.ts"),
  ]);
  process.chdir(platform);
  isolated = await isolatedTestEnvironment();
  system = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEV_MAILBOX: "true",
      WORKER_ENABLED: "false",
      DEMO_MODE: "false",
      AI_BASE_URL: `http://127.0.0.1:${(provider.address() as any).port}/v1`,
      AI_ALLOWED_HOSTS: "127.0.0.1",
      AI_API_KEY: "cloud-development-ui-fixture",
      AI_MODEL: "cloud-development-ui-fixture",
      AI_VERIFIED: "true",
      AI_INPUT_HKD_MICROS_PER_MILLION: "1000000",
      AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000",
      AI_INPUT_COUNT_VERIFIED: "true",
      AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0",
      AI_SCOPE_TTL_MS: "300000",
    }),
    { worker: false },
  );
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN!,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1060 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem("cp_locale"))
      localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme"))
      localStorage.setItem("cp_theme", "light");
  });
  await page.goto("http://localhost:4317/login");
  await page
    .locator('input[name="email"]')
    .fill(`cloud-development-${randomUUID()}@example.invalid`);
  const [challenge] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/v1/auth/challenges",
    ),
    page.locator('form button[type="submit"]').click(),
  ]);
  const mail = JSON.parse(
    await readFile(
      path.join(
        isolated.directory,
        "mailbox",
        (await challenge.json()).challenge_id + ".json",
      ),
      "utf8",
    ),
  );
  await page
    .locator('input[name="code"]')
    .fill(mail.text.match(/\b\d{6}\b/)[0]);
  await page.locator('form button[type="submit"]').click();
  await page.locator('input[name="name"]').fill("API delivery studio");
  await page
    .locator('input[name="project_name"]')
    .fill("HTTP and SQLite acceptance");
  await page
    .getByRole("button", { name: "Create workspace & continue", exact: true })
    .click();
  await until(
    () =>
      page.evaluate(async () => {
        const r = await fetch("/v1/session/context");
        return r.json();
      }),
    (v) => v.memberships?.length === 1,
    "actual Web session",
  );
  const request = (url: string, method = "GET", body?: any, tenant?: string) =>
    page.evaluate(
      async (args) => {
        const me = await (await fetch("/v1/session/context")).json();
        const r = await fetch(args.url, {
          method: args.method,
          headers: {
            "X-CSRF-Token": me.csrf_token,
            "Idempotency-Key": crypto.randomUUID(),
            ...(args.tenant ? { "X-Tenant-ID": args.tenant } : {}),
            ...(args.body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          ...(args.body === undefined
            ? {}
            : { body: JSON.stringify(args.body) }),
        });
        if (!r.ok) throw Error(r.status + ": " + (await r.text()));
        return r.json();
      },
      { url, method, body, tenant },
    );
  const me = await request("/v1/session/context"),
    tenant = me.memberships[0].id,
    project = (await request(`/v1/tenants/${tenant}/projects`)).items[0].id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  await system.db.control.query(
    "UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",
    [tenant],
  );
  const agent = await request(
      base + "/agents",
      "POST",
      { name: "Application software specialist", role_key: "fullstack" },
      tenant,
    ),
    conversation = await request(
      base + "/conversations",
      "POST",
      {
        name: "Verify application access and database keys",
        agent_id: agent.id,
      },
      tenant,
    );
  const accepted = await request(
    base + `/conversations/${conversation.id}/messages`,
    "POST",
    {
      body: "Create api.cjs and schema.sql, run actual API checks for unauthenticated and approved requests, repair the failed handler, retest, run native SQLite row and constraint checks and package the exact sources with their records.",
      expected_version: conversation.version,
      intent: "delegate",
      mode: "execute",
      budget_micros: 1000000,
      client_message_id: randomUUID(),
    },
    tenant,
  );
  await new Worker(system.db, system.catalog, system.storage).run(
    tenant,
    accepted.task.id,
  );
  task = await request(base + "/tasks/" + accepted.task.id);
  assert.equal(
    task.status,
    "succeeded",
    JSON.stringify({
      status: task.status,
      error: task.error_code,
      providerError: String(providerError),
    }),
  );
  assert.equal(providerError, undefined);
  assert.equal(providerCalls, 8);
  const history = await request(base + `/tasks/${task.id}/software-checks`);
  assert.equal(history.items.length, 3);
  assert.equal(history.items[0].check_result.kind, "sqlite");
  assert.equal(history.items[0].passed, true);
  assert.equal(history.items[1].check_result.kind, "api");
  assert.equal(history.items[1].passed, true);
  assert.equal(history.items[2].passed, false);
  assert.equal(history.items[2].matches_current_sources, false);
  pass(
    "Real pinned cloud Codex calls actual company tools; HTTP checks fail, are repaired and pass; native SQLite data and constraints pass and packages exact-source checks through a synthetic provider",
  );
  await page.goto(`http://localhost:4317/app/tasks/${task.id}`);
  await page
    .getByRole("heading", { name: "Software checks", exact: true })
    .waitFor();
  const section = page.locator(".software-checks");
  await section.scrollIntoViewIfNeeded();
  await section.getByText("SQLite checks passed", { exact: true }).waitFor();
  await section.getByText("API checks passed", { exact: true }).waitFor();
  await section.getByText("API checks failed", { exact: true }).waitFor();
  await section
    .getByText(
      "Code has changed: this result does not apply to the current version.",
      { exact: true },
    )
    .waitFor();
  await section.scrollIntoViewIfNeeded();
  await until(
    () =>
      section
        .locator(".software-check")
        .first()
        .evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, height: innerHeight };
        }),
    (r) => r.top >= 70 && r.bottom <= r.height,
    "loaded check records inside the actual viewport",
  );
  screenshots.push(
    await saveWorkmateScreenshot(
      "web",
      "cloud-development-" + attempt,
      "checks-en",
      await page.screenshot(),
      "Actual authenticated task page: actual HTTP and SQLite checks, failed/passed records and changed-source warning; synthetic company model",
      delivery,
    ),
  );
  pass(
    "Actual task page distinguishes current passing checks, API and SQLite passes, earlier failures and stale source versions",
  );
  recording = new WorkmateRecording(
    "web",
    "cloud-development",
    attempt,
    () => page.screenshot({ type: "jpeg", quality: 80 }),
    "Actual authenticated Web task interaction and downloads; real Codex/HTTP/native SQLite execution, synthetic provider",
    delivery,
  );
  await recording.start();
  await section
    .locator(".software-check")
    .first()
    .locator(":scope > details > summary")
    .click();
  await section
    .getByText("Read seeded customer data", { exact: true })
    .waitFor();
  await section
    .getByText("Reject duplicate primary keys", { exact: true })
    .click();
  await section
    .getByLabel("Actual result", { exact: true })
    .first()
    .getByText(/1555/)
    .waitFor();
  const [recordDownload] = await Promise.all([
    page.waitForEvent("download"),
    section
      .getByRole("button", { name: "Download full record", exact: true })
      .first()
      .click(),
  ]);
  const record = JSON.parse(
    await readFile((await recordDownload.path())!, "utf8"),
  );
  assert.equal(record.passed, true);
  assert.equal(record.check_result.kind, "sqlite");
  assert.equal(record.check_result.checks.length, 2);
  assert.equal(record.workspace_deleted, true);
  assert.equal(record.source_digest, history.items[0].source_digest);
  const [filesDownload] = await Promise.all([
    page.waitForEvent("download"),
    section
      .getByRole("button", { name: "Download execution files", exact: true })
      .first()
      .click(),
  ]);
  const { unzipSync } = await import("fflate"),
    outputs = unzipSync(await readFile((await filesDownload.path())!));
  assert.equal(Buffer.from(outputs["files/api.cjs"]).toString(), fixed);
  const databaseName = Object.keys(outputs).find((name) =>
    name.endsWith("/database.sqlite"),
  );
  assert.ok(databaseName);
  assert.equal(
    Buffer.from(outputs[databaseName]).subarray(0, 16).toString(),
    "SQLite format 3\0",
  );
  assert.ok(outputs["execution-receipt.json"]);
  await page.waitForTimeout(6000);
  assert.equal(
    await section.count(),
    1,
    "automatic refresh must not duplicate the check panel",
  );
  assert.equal(
    await section.locator(".software-check").count(),
    3,
    "automatic refresh preserves exactly the three real records",
  );
  assert.equal(
    await section.locator("details").first().getAttribute("open"),
    "",
  );
  screenshots.push(
    await saveWorkmateScreenshot(
      "web",
      "cloud-development-" + attempt,
      "output-en",
      await page.screenshot(),
      "Actual SQLite row and constraint details expanded with real downloaded execution receipt and matching customer source files",
      delivery,
    ),
  );
  media = await recording.stop();
  recording = undefined;
  pass(
    "Output expansion, both browser downloads and automatic refresh preserve exact source bytes, cleanup receipt and a single check panel",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    localStorage.setItem("cp_locale", "zh-HK");
    localStorage.setItem("cp_theme", "dark");
  });
  await page.reload();
  await page
    .getByRole("heading", { name: "軟體檢查記錄", exact: true })
    .waitFor();
  await page.locator(".software-check").first().waitFor();
  await page.getByText("SQLite 檢查通過", { exact: true }).waitFor();
  await page.locator(".software-check").first().scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth > innerWidth ||
      document.body.scrollWidth > innerWidth ||
      Array.from(
        document.querySelectorAll(
          ".software-checks,.software-check,.software-check pre",
        ),
      ).some((v) => v.scrollWidth > v.clientWidth + 2),
  );
  assert.equal(overflow, false);
  screenshots.push(
    await saveWorkmateScreenshot(
      "web",
      "cloud-development-" + attempt,
      "compact-zh",
      await page.screenshot(),
      "Actual 390-pixel Chinese responsive task checks without horizontal overflow",
      delivery,
    ),
  );
  pass(
    "Chinese task checks and long test output fit an actual 390-pixel viewport without horizontal overflow",
  );
} catch (e) {
  errors.push(String(e));
  console.error(e);
} finally {
  if (recording)
    try {
      media = await recording.stop();
    } catch (e) {
      errors.push(String(e));
    }
  if (browser)
    await browser
      .close()
      .then(() => {
        browserClosed = true;
      })
      .catch((e) => errors.push(String(e)));
  if (system)
    await system.app
      .close()
      .then(() => {
        apiClosed = true;
      })
      .catch((e: any) => errors.push(String(e)));
  if (isolated)
    await isolated
      .cleanup()
      .then(() => {
        fixtureClosed = true;
      })
      .catch((e: any) => errors.push(String(e)));
  await new Promise<void>((r) => provider.close(() => r()));
  await mkdir(path.dirname(prefix), { recursive: true });
  await writeFile(
    prefix + "-journey.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: errors.length ? "failed" : "passed",
        checks,
        errors,
        screenshots,
        media,
        provider_calls: providerCalls,
        task: task
          ? {
              id: task.id,
              status: task.status,
              charged_micros: task.charged_micros,
              execution_location: task.execution_location,
            }
          : null,
        browser_closed: browserClosed,
        api_closed: apiClosed,
        fixture_closed: fixtureClosed,
        not_validated: [
          "Live customer model quality",
          "Cloud browser preview and external TCP/TLS endpoints",
          "PostgreSQL/MySQL customer application compatibility",
          "Arbitrary npm packages",
          "All-role qualification",
          "Whole product acceptance",
        ],
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  assert.equal(errors.length, 0, errors.join("\n"));
}
