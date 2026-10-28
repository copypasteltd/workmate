import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const compiled = process.argv.includes("--compiled");
assert.deepEqual(process.argv.slice(2), compiled ? ["--compiled"] : []);
const { runCloudApiCheck, runCloudDatabaseCheck } = await import(
  compiled
    ? "../dist/src/cloud-development-checks.js"
    : "../src/cloud-development-checks.ts"
);

const data = path.resolve(".data/cloud-development-probes", randomUUID());
await mkdir(data, { recursive: true });
const application = `module.exports=(req,res)=>{res.setHeader('content-type','application/json');
if(req.headers['x-tenant-id']!=='approved'){res.statusCode=401;res.end(JSON.stringify({error:'unauthorized'}));return;}
let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{res.statusCode=req.method==='POST'?201:200;res.end(JSON.stringify({method:req.method,path:req.url,body,actual:true}));});};`;
const api = await runCloudApiCheck(
  data,
  {
    entry: "api.cjs",
    requests: [
      {
        name: "Unauthenticated request is denied",
        method: "GET",
        path: "/api/orders",
        expect: { status: 401, json: { error: "unauthorized" } },
      },
      {
        name: "Actual HTTP creation",
        method: "POST",
        path: "/api/orders",
        headers: { "x-tenant-id": "approved" },
        body: "fixture",
        expect: {
          status: 201,
          json: {
            method: "POST",
            path: "/api/orders",
            body: "fixture",
            actual: true,
          },
        },
      },
    ],
  },
  [{ path: "api.cjs", bytes: Buffer.from(application) }],
);
await writeFile(
  path.join(data, "api-receipt.json"),
  JSON.stringify(api.receipt, null, 2),
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    kind: "api",
    passed: api.receipt.passed,
    exit: api.receipt.exit_code,
    checks: api.receipt.check_result,
    stderr: api.receipt.stderr,
    stop_reason: api.receipt.stop_reason,
    receipt: path.join(data, "api-receipt.json"),
  }),
);
const sqlite = await runCloudDatabaseCheck(
  data,
  {
    entry: "schema.sql",
    checks: [
      {
        name: "Seeded data",
        sql: "SELECT name FROM customers WHERE id=?",
        params: [1],
        expect: { rows: [{ name: "CopyPaste" }] },
      },
      {
        name: "Unique keys",
        sql: "INSERT INTO customers VALUES(1,'duplicate')",
        expect: { error_code: "1555" },
      },
    ],
  },
  [
    {
      path: "schema.sql",
      bytes: Buffer.from(
        "CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT NOT NULL);INSERT INTO customers VALUES(1,'CopyPaste');",
      ),
    },
  ],
);
await writeFile(
  path.join(data, "database-receipt.json"),
  JSON.stringify(sqlite.receipt, null, 2),
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    kind: "sqlite",
    passed: sqlite.receipt.passed,
    exit: sqlite.receipt.exit_code,
    checks: sqlite.receipt.check_result,
    stderr: sqlite.receipt.stderr,
    receipt: path.join(data, "database-receipt.json"),
  }),
);
assert.equal(
  api.receipt.passed,
  true,
  api.receipt.check_result?.error ?? api.receipt.stderr,
);
assert.equal(
  sqlite.receipt.passed,
  true,
  sqlite.receipt.check_result?.error ?? sqlite.receipt.stderr,
);
assert.equal(
  sqlite.files
    .find((v) => v.path.endsWith("/database.sqlite"))
    .bytes.subarray(0, 16)
    .toString(),
  "SQLite format 3\0",
);
assert.ok(api.receipt.workspace_deleted && sqlite.receipt.workspace_deleted);
