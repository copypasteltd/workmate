import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, lstat } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { PassThrough } from "node:stream";
import {
  apiCheckInput,
  databaseCheckInput,
  runCloudApiCheck,
  runCloudDatabaseCheck,
  apiCheckDriver,
} from "../src/cloud-development-checks.js";

const root = path.resolve(".data/cloud-development-unit", randomUUID());
const files = (content: string, file = "api.cjs") => [
  { path: file, bytes: Buffer.from(content) },
];
const request = (expect: any, extra: any = {}) => ({
  name: "Actual application behavior",
  method: "GET" as const,
  path: "/",
  expect,
  ...extra,
});
const sqlCheck = (sql: string, expect: any, extra: any = {}) => ({
  name: "Actual database behavior",
  sql,
  expect,
  ...extra,
});
const native = process.platform === "win32";

test("a deeply nested native SQLite workspace preserves real transactions and exact cleanup", { skip: !native }, async () => {
  const nested = path.join(root, "owned-deep-workspace-" + "x".repeat(12));
  const result = await runCloudDatabaseCheck(nested, {
    entry: "schema.sql",
    checks: [
      sqlCheck("SELECT name FROM example WHERE id=?", { rows: [{ name: "original" }] }, { params: [1] }),
      sqlCheck("UPDATE example SET name=? WHERE id=?", { changes: 1 }, { params: ["updated", 1] }),
      sqlCheck("SELECT name FROM example WHERE id=?", { rows: [{ name: "updated" }] }, { params: [1] }),
    ],
  }, files("CREATE TABLE example(id INTEGER PRIMARY KEY,name TEXT NOT NULL); INSERT INTO example VALUES(1,'original');", "schema.sql"));
  assert.equal(result.receipt.passed, true, JSON.stringify(result.receipt));
  assert.equal(result.receipt.check_result?.checks.length, 3);
  assert.ok(result.receipt.check_result?.checks.every((row: any) => row.passed));
  assert.equal(result.receipt.host.profile_deleted, true);
  assert.equal(result.receipt.workspace_deleted, true);
});

test("HTTP startup control rejects missing, duplicate or extra readiness frames and terminates an aborted wait", async () => {
  for (const frames of [
    '{"id":"c1","end":true}\n',
    '{"ready":true,"unchecked":true}\n',
    '{"ready":true}\n{"ready":true}\n',
  ]) {
    const driver = await apiCheckDriver({
      entry: "api.cjs",
      requests: [request({ status: 200 })],
    });
    const output = new PassThrough(),
      controller = new AbortController();
    let ended = false,
      writes = 0;
    const running = driver.interact!({
      output,
      signal: controller.signal,
      write: async () => {
        writes++;
      },
      end: () => {
        ended = true;
      },
    });
    output.write(frames);
    const result = await running;
    assert.equal(result.passed, false);
    assert.equal(result.checks.length, 0);
    assert.equal(writes, 0, "Invalid startup never sends an HTTP request");
    assert.equal(ended, true);
    assert.equal(
      driver.verify!([], frames, { kind: "api", passed: true, checks: [] })
        .passed,
      false,
    );
    output.destroy();
  }
  const driver = await apiCheckDriver({
    entry: "api.cjs",
    requests: [request({ status: 200 })],
  });
  for (const reason of ["abort", "end"] as const) {
    const output = new PassThrough(),
      controller = new AbortController();
    const running = driver.interact!({
      output,
      signal: controller.signal,
      write: async () => {
        throw new Error("No request is allowed before readiness");
      },
      end: () => {},
    });
    if (reason === "abort") controller.abort();
    else output.end();
    const result = await running;
    assert.equal(result.passed, false);
    assert.equal(result.checks.length, 0);
    output.destroy();
  }
});

test(
  "actual native API module initialization can exceed the request deadline while its subsequent requests remain bounded",
  { skip: !native },
  async () => {
    const result = await runCloudApiCheck(
      root,
      {
        entry: "delayed.mjs",
        timeout_ms: 15000,
        requests: [
          request({ status: 200, text: "initialized" }),
          request({ status: 200, text: "initialized" }, { path: "/second" }),
        ],
      },
      files(
        "await new Promise(r=>setTimeout(r,5500));export default (q,s)=>s.end('initialized');",
        "delayed.mjs",
      ),
    );
    assert.equal(result.receipt.passed, true, JSON.stringify(result.receipt));
    assert.equal(result.receipt.check_result?.checks.length, 2);
    assert.equal(result.receipt.workspace_deleted, true);
    assert.equal(result.receipt.host.profile_deleted, true);
    const expired = await runCloudApiCheck(
      root,
      {
        entry: "delayed.mjs",
        timeout_ms: 1000,
        requests: [request({ status: 200 })],
      },
      files(
        "await new Promise(r=>setTimeout(r,60000));export default (q,s)=>s.end('too late');",
        "delayed.mjs",
      ),
    );
    assert.equal(expired.receipt.passed, false);
    assert.equal(expired.receipt.check_result?.checks.length, 0);
    assert.equal(expired.receipt.workspace_deleted, true);
    assert.equal(expired.receipt.host.profile_deleted, true);
  },
);

test("strict development check inputs reject outside endpoints, transport injection, external databases and unobservable SQL claims", () => {
  const api = { entry: "api.cjs", requests: [request({ status: 200 })] };
  for (const bad of [
    { ...api, url: "https://example.invalid" },
    {
      ...api,
      requests: [request({ status: 200 }, { path: "http://127.0.0.1/" })],
    },
    {
      ...api,
      requests: [request({ status: 200 }, { path: "//outside.invalid/" })],
    },
    {
      ...api,
      requests: [
        request({ status: 200 }, { headers: { connection: "upgrade" } }),
      ],
    },
    {
      ...api,
      requests: [
        request({ status: 200 }, { headers: { "x-test": "bad\r\nheader" } }),
      ],
    },
    { ...api, requests: [request({ status: 200, json: {}, text: "{}" })] },
  ])
    assert.equal(apiCheckInput.safeParse(bad).success, false);
  for (const bad of [
    {
      entry: "schema.sql",
      engine: "postgres",
      checks: [sqlCheck("SELECT 1", { rows: [] })],
    },
    {
      entry: "schema.sql",
      database_url: "postgres://outside",
      checks: [sqlCheck("SELECT 1", { rows: [] })],
    },
    { entry: "schema.sql", checks: [sqlCheck("SELECT 1", {})] },
    {
      entry: "schema.sql",
      checks: [sqlCheck("SELECT 1", { rows: [], changes: 0 })],
    },
    {
      entry: "schema.sql",
      checks: [sqlCheck("SELECT 1", { rows: [], error_code: "1" })],
    },
  ])
    assert.equal(databaseCheckInput.safeParse(bad).success, false);
});

test(
  "actual HTTP requests keep app state across closed connections, auth rejection, JSON, body, query and headers",
  { skip: !native },
  async () => {
    const source = `let total=0;module.exports=(req,res)=>{res.setHeader('connection','close');res.setHeader('content-type','application/json');res.setHeader('x-checked','actual');
if(req.headers['x-account']!=='approved'){res.statusCode=401;res.end(JSON.stringify({error:'unauthorized'}));return;}
let text='';req.on('data',b=>text+=b);req.on('end',()=>{if(req.method==='POST'){total+=JSON.parse(text).amount;res.statusCode=201;}res.end(JSON.stringify({total,path:req.url}));});};`;
    const r = await runCloudApiCheck(
      root,
      {
        entry: "api.cjs",
        requests: [
          request(
            { status: 401, json: { error: "unauthorized" } },
            { method: "POST", body: "a".repeat(15000) },
          ),
          request(
            {
              status: 201,
              json: { total: 4, path: "/orders?account=1" },
              headers: { "x-checked": "actual" },
            },
            {
              method: "POST",
              path: "/orders?account=1",
              headers: {
                "x-account": "approved",
                "content-type": "application/json",
              },
              body: '{"amount":4}',
            },
          ),
          request(
            { status: 200, json: { total: 4, path: "/orders" } },
            { path: "/orders", headers: { "x-account": "approved" } },
          ),
        ],
      },
      files(source),
    );
    assert.equal(r.receipt.passed, true, JSON.stringify(r.receipt));
    assert.equal(r.receipt.check_result?.checks.length, 3);
    const large = await runCloudApiCheck(
      root,
      {
        entry: "api.cjs",
        requests: [
          request(
            { status: 200, json: { bytes: 27000 } },
            { method: "POST", body: "漢".repeat(9000) },
          ),
          request(
            { status: 200, text: "x".repeat(15000) },
            { path: "/large-response" },
          ),
        ],
      },
      files(
        "module.exports=(q,s)=>{if(q.url==='/large-response'){s.setHeader('x-padding','a'.repeat(10000));s.end('x'.repeat(15000));return;}q.setEncoding('utf8');let b='';q.on('data',c=>b+=c);q.on('end',()=>s.end(JSON.stringify({bytes:Buffer.byteLength(b)})));};",
      ),
    );
    assert.equal(
      large.receipt.passed,
      true,
      JSON.stringify({
        exit: large.receipt.exit_code,
        error: large.receipt.check_result?.error,
        checks: large.receipt.check_result?.checks.map((v) => ({
          name: v.name,
          passed: v.passed,
          error: v.error,
          json: (v.actual as any)?.json,
        })),
      }),
    );
    assert.equal(large.receipt.check_result?.checks.length, 2);
    assert.equal(r.receipt.host.stdin_channel, true);
    assert.equal(r.receipt.workspace_deleted, true);
    assert.match(r.receipt.harness_sha256!, /^[a-f0-9]{64}$/);
    await assert.rejects(
      lstat(path.join(root, "cloud-programs", r.receipt.execution_id)),
      (e: any) => e.code === "ENOENT",
    );
  },
);

test(
  "actual TypeScript named handler, unstarted Server export, HEAD and exact text use the standard HTTP parser",
  { skip: !native },
  async () => {
    for (const [entry, export_name, source] of [
      [
        "handler.mts",
        "handle",
        "export const handle=(req: any,res: any)=>{res.statusCode=202;res.end('accepted')};",
      ],
      [
        "server.cjs",
        "default",
        "module.exports=require('node:http').createServer((req,res)=>{res.statusCode=202;res.end('accepted')});",
      ],
    ]) {
      const r = await runCloudApiCheck(
        root,
        {
          entry,
          export_name,
          requests: [
            request({ status: 202, text: "accepted" }),
            request({ status: 202, text: "" }, { method: "HEAD" }),
          ],
        },
        files(source, entry),
      );
      assert.equal(r.receipt.passed, true, JSON.stringify(r.receipt));
    }
  },
);

test(
  "failed API assertions stay failed even when the app exits successfully; invalid JSON cannot satisfy a null expectation",
  { skip: !native },
  async () => {
    const r = await runCloudApiCheck(
      root,
      {
        entry: "api.cjs",
        requests: [
          request({ status: 201, json: { ok: true } }),
          request({ status: 200, json: null }),
        ],
      },
      files("module.exports=(req,res)=>res.end('not json');"),
    );
    assert.equal(r.receipt.exit_code, 0);
    assert.equal(r.receipt.passed, false);
    assert.equal(r.receipt.check_result?.checks.length, 2);
    assert.ok(r.receipt.check_result?.checks.every((v) => v.passed === false));
    assert.equal(r.receipt.workspace_deleted, true);
  },
);

test(
  "early process success, malformed transport and excessive response bodies cannot forge API checks",
  { skip: !native },
  async () => {
    for (const source of [
      "process.exit(0)",
      "module.exports=(q,s)=>{s.end('ok');setTimeout(()=>process.stdout.write('late invalid frame\\n'),50)};",
      "process.stdout.write('not a frame\\n');module.exports=(q,s)=>s.end('ok');",
      "module.exports=(q,s)=>s.end('x'.repeat(20000));",
    ]) {
      const r = await runCloudApiCheck(
        root,
        {
          entry: "api.cjs",
          requests: [request({ status: 200 })],
          timeout_ms: 3000,
        },
        files(source),
      );
      assert.equal(r.receipt.passed, false, JSON.stringify(r.receipt));
      assert.equal(r.receipt.check_result?.passed, false);
      assert.equal(r.receipt.workspace_deleted, true);
    }
  },
);

test(
  "the HTTP request validator does not follow an external redirect",
  { skip: !native },
  async () => {
    let connections = 0;
    const server = createServer((socket) => {
      connections++;
      socket.destroy();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as { port: number };
    try {
      const location = `http://127.0.0.1:${address.port}/private`;
      const r = await runCloudApiCheck(
        root,
        {
          entry: "api.cjs",
          requests: [request({ status: 302, headers: { location } })],
        },
        files(
          `module.exports=(q,s)=>{s.statusCode=302;s.setHeader('location',${JSON.stringify(location)});s.end();};`,
        ),
      );
      assert.equal(r.receipt.passed, true, JSON.stringify(r.receipt));
      assert.equal(connections, 0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test(
  "stdin-enabled API programs cannot read a host canary or inherit secrets; native network and child restrictions stay bounded",
  { skip: !native },
  async () => {
    await mkdir(root, { recursive: true });
    const canary = path.join(root, "outside.txt");
    await writeFile(canary, "Synthetic host-only canary");
    let connections = 0;
    const server = createServer((socket) => {
      connections++;
      socket.destroy();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    try {
      const source = `const fs=require('node:fs');module.exports=(q,s)=>{
let denied=false;try{fs.readFileSync(${JSON.stringify(canary)})}catch(e){denied=['EACCES','EPERM'].includes(e.code)}
s.end(JSON.stringify({denied,secrets_absent:process.env.AI_API_KEY===undefined&&process.env.DATABASE_URL===undefined}));};`;
      const r = await runCloudApiCheck(
        root,
        {
          entry: "api.cjs",
          requests: [
            request({
              status: 200,
              json: { denied: true, secrets_absent: true },
            }),
          ],
        },
        files(source),
      );
      assert.equal(r.receipt.passed, true, JSON.stringify(r.receipt));
      for (const attack of [
        `const c=require('node:net').connect({host:'127.0.0.1',port:${port}});c.on('error',()=>{});`,
        "require('node:child_process').spawn(process.execPath,['-e','process.exit(0)']);",
      ]) {
        const blocked = await runCloudApiCheck(
          root,
          {
            entry: "api.cjs",
            timeout_ms: 1000,
            requests: [request({ status: 200 })],
          },
          files(`module.exports=(q,s)=>{${attack}};`),
        );
        assert.equal(blocked.receipt.passed, false);
        assert.equal(blocked.receipt.host.no_network_capabilities, true);
        assert.equal(blocked.receipt.host.child_processes_prohibited, true);
        assert.equal(blocked.receipt.workspace_deleted, true);
      }
      assert.equal(connections, 0);
      assert.equal(
        await readFile(canary, "utf8"),
        "Synthetic host-only canary",
      );
      assert.equal(r.receipt.host.no_network_capabilities, true);
      assert.equal(r.receipt.host.child_processes_prohibited, true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test(
  "API deadline and cancellation stop a blocked application and reclaim its native resources",
  { skip: !native },
  async () => {
    const controller = new AbortController();
    const source = files("module.exports=(q,s)=>{while(true){}};");
    const timed = await runCloudApiCheck(
      root,
      {
        entry: "api.cjs",
        requests: [request({ status: 200 })],
        timeout_ms: 1000,
      },
      source,
    );
    assert.equal(timed.receipt.passed, false);
    assert.equal(timed.receipt.host.timed_out, true);
    assert.equal(timed.receipt.workspace_deleted, true);
    const running = runCloudApiCheck(
      root,
      {
        entry: "api.cjs",
        requests: [
          request({ status: 200 }, { method: "POST", body: "x".repeat(14000) }),
        ],
      },
      source,
      controller.signal,
    );
    const timer = setTimeout(() => controller.abort(), 1000);
    try {
      const cancelled = await running;
      assert.equal(cancelled.receipt.passed, false);
      assert.equal(cancelled.receipt.stop_reason, "cancelled");
      assert.equal(cancelled.receipt.host.profile_deleted, true);
      assert.equal(cancelled.receipt.workspace_deleted, true);
    } finally {
      clearTimeout(timer);
    }
  },
);

test(
  "actual native SQLite checks cover bound CRUD, transactions, constraints, 64-bit values and blobs",
  { skip: !native },
  async () => {
    const schema =
      "CREATE TABLE accounts(id INTEGER PRIMARY KEY,name TEXT UNIQUE NOT NULL,balance INTEGER CHECK(balance>=0));CREATE TABLE orders(id INTEGER PRIMARY KEY,account_id INTEGER REFERENCES accounts(id));INSERT INTO accounts VALUES(1,'CopyPaste',10);BEGIN;UPDATE accounts SET balance=100;ROLLBACK;";
    const r = await runCloudDatabaseCheck(
      root,
      {
        entry: "schema.sql",
        checks: [
          sqlCheck(
            "SELECT balance FROM accounts WHERE id=?",
            { rows: [{ balance: 10 }] },
            { params: [1] },
          ),
          sqlCheck(
            "INSERT INTO accounts VALUES(?,?,?)",
            { changes: 1, lastInsertRowid: 2 },
            { params: [2, "x'); DROP TABLE accounts;--", 20] },
          ),
          sqlCheck("SELECT COUNT(*) AS count FROM accounts", {
            rows: [{ count: 2 }],
          }),
          sqlCheck("INSERT INTO accounts VALUES(1,'duplicate',1)", {
            error_code: "1555",
          }),
          sqlCheck("INSERT INTO orders VALUES(1,999)", { error_code: "787" }),
          sqlCheck("UPDATE accounts SET balance=-1 WHERE id=1", {
            error_code: "275",
          }),
          sqlCheck("SELECT 9223372036854775807 AS big,x'0102' AS bytes", {
            rows: [{ big: "9223372036854775807", bytes: { base64: "AQI=" } }],
          }),
        ],
      },
      files(schema, "schema.sql"),
    );
    assert.equal(r.receipt.passed, true, JSON.stringify(r.receipt));
    assert.equal(r.receipt.check_result?.checks.length, 7);
    assert.equal(r.receipt.host.stdin_channel, false);
    assert.equal(
      r.files
        .find((v) => v.path.endsWith("/database.sqlite"))!
        .bytes.subarray(0, 16)
        .toString(),
      "SQLite format 3\0",
    );
    assert.equal(r.receipt.workspace_deleted, true);
  },
);

test(
  "SQLite mismatches, unexpected successful statements and invalid schema stay observable failures",
  { skip: !native },
  async () => {
    const mismatch = await runCloudDatabaseCheck(
      root,
      {
        entry: "schema.sql",
        checks: [
          sqlCheck("SELECT value FROM records", { rows: [{ value: 99 }] }),
          sqlCheck("SELECT 1", { error_code: "1" }),
        ],
      },
      files(
        "CREATE TABLE records(value INTEGER);INSERT INTO records VALUES(1);",
        "schema.sql",
      ),
    );
    assert.equal(mismatch.receipt.passed, false);
    assert.equal(mismatch.receipt.exit_code, 1);
    assert.equal(mismatch.receipt.check_result?.checks.length, 2);
    assert.ok(mismatch.receipt.check_result?.checks.every((v) => !v.passed));
    const invalid = await runCloudDatabaseCheck(
      root,
      { entry: "schema.sql", checks: [sqlCheck("SELECT 1", { rows: [] })] },
      files("THIS IS INVALID SQL;", "schema.sql"),
    );
    assert.equal(invalid.receipt.passed, false);
    assert.equal(invalid.receipt.exit_code, 1);
    assert.match(invalid.receipt.check_result?.error ?? "", /syntax error/);
  },
);

test(
  "SQLite cannot attach a host database or load native extensions; each invocation receives a fresh database",
  { skip: !native },
  async () => {
    await mkdir(root, { recursive: true });
    const outside = path.join(root, "outside.sqlite").replaceAll("\\", "/");
    await writeFile(outside, "Synthetic outside canary");
    const input = {
      entry: "schema.sql",
      checks: [
        sqlCheck(
          `/* hidden prefix */ aTtAcH DATABASE '${outside.replaceAll("'", "''")}' AS host`,
          { error_code: "SQLITE_IO_POLICY" },
        ),
        sqlCheck("SELECT load_extension('outside.dll')", {
          error_code: "1",
          error_message: "not authorized",
        }),
        sqlCheck("SELECT COUNT(*) AS count FROM fresh", {
          rows: [{ count: 1 }],
        }),
        sqlCheck(
          "SELECT 'ATTACH; VACUUM' AS \"ATTACH\" /* ATTACH */; -- VACUUM",
          { rows: [{ ATTACH: "ATTACH; VACUUM" }] },
        ),
        sqlCheck("SELECT 1; SELECT 2", {
          error_code: "SQLITE_STATEMENT_POLICY",
        }),
      ],
    };
    for (let i = 0; i < 2; i++) {
      const r = await runCloudDatabaseCheck(
        root,
        input,
        files(
          "CREATE TABLE fresh(id INTEGER PRIMARY KEY);INSERT INTO fresh VALUES(1);",
          "schema.sql",
        ),
      );
      assert.equal(r.receipt.passed, true, JSON.stringify(r.receipt));
      assert.equal(r.receipt.workspace_deleted, true);
    }
    assert.equal(await readFile(outside, "utf8"), "Synthetic outside canary");
  },
);

test(
  "unbounded SQLite queries hit the native deadline and oversized row sets are rejected",
  { skip: !native },
  async () => {
    const slow = await runCloudDatabaseCheck(
      root,
      {
        entry: "schema.sql",
        timeout_ms: 1000,
        checks: [
          sqlCheck(
            "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n) SELECT sum(x) FROM n",
            { rows: [] },
          ),
        ],
      },
      files("CREATE TABLE seed(id INTEGER);", "schema.sql"),
    );
    assert.equal(slow.receipt.passed, false);
    assert.equal(slow.receipt.host.timed_out, true);
    assert.equal(slow.receipt.workspace_deleted, true);
    const rows = await runCloudDatabaseCheck(
      root,
      {
        entry: "schema.sql",
        checks: [
          sqlCheck(
            "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<101) SELECT x FROM n",
            { rows: [] },
          ),
        ],
      },
      files("CREATE TABLE seed(id INTEGER);", "schema.sql"),
    );
    assert.equal(rows.receipt.passed, false);
    assert.match(
      rows.receipt.check_result?.checks[0].error ?? "",
      /RESULT_ROW_LIMIT/,
    );
  },
);
