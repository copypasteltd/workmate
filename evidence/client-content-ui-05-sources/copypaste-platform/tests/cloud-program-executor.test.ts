import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdir, readFile, writeFile, lstat, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import {
  cloudProgramInput,
  runCloudProgram,
  sourceDigest,
  sourceManifest,
} from "../src/cloud-program-executor.js";

const data = path.resolve(".data/cloud-program-tests", randomUUID());
const source = (content: string, name = "main.cjs") => [
  { path: name, bytes: Buffer.from(content) },
];
const windows = process.platform === "win32";

test("structured native commands reject arbitrary binaries, environment, traversal and ambiguous source identities", async () => {
  for (const bad of [
    { program: "powershell", entry: "main.cjs" },
    { program: "node", entry: "main.cjs", env: { KEY: "secret" } },
    { program: "node", entry: "main.cjs", args: ["\0"] },
    { program: "node", entry: "main.cjs", timeout_ms: 900000 },
  ])
    assert.equal(cloudProgramInput.safeParse(bad).success, false);
  for (const name of [
    "../main.cjs",
    "C:/main.cjs",
    ".tmp/a.cjs",
    "NUL.txt",
    "node_modules/a.js",
  ])
    assert.throws(() => sourceManifest(source("", name)));
  assert.throws(() =>
    sourceManifest([...source("", "a.js"), ...source("", "A.js")]),
  );
  await assert.rejects(
    runCloudProgram(
      data,
      { program: "node_check", entry: "main.cjs", args: ["--eval"] },
      source(""),
    ),
    /do not accept/,
  );
  const a = sourceManifest([...source("a", "a.js"), ...source("b", "b.js")]);
  assert.equal(sourceDigest(a), sourceDigest([...a].reverse()));
  assert.notEqual(
    sourceDigest(a),
    sourceDigest(sourceManifest(source("changed", "a.js"))),
  );
});

test(
  "actual AppContainer Node executes sources while denying outside files, network and ambient secrets",
  { skip: !windows },
  async () => {
    await mkdir(data, { recursive: true });
    const canary = path.join(data, "outside.txt");
    await writeFile(canary, "synthetic company-only fixture", { flag: "wx" });
    let connections = 0;
    const server = createServer((s) => {
      connections++;
      s.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      const { receipt, files } = await runCloudProgram(
        data,
        { program: "node", entry: "main.cjs" },
        source(`
const assert=require('node:assert/strict'),fs=require('node:fs'),net=require('node:net');
let denied=false;try{fs.readFileSync(${JSON.stringify(canary)})}catch(e){denied=['EPERM','EACCES'].includes(e.code)}
assert.equal(denied,true);
assert.equal(process.env.AI_API_KEY,undefined);assert.equal(process.env.DATABASE_URL,undefined);
fs.writeFileSync('output.txt','Real customer program output');
const socket=net.connect({host:'127.0.0.1',port:${port}});let connected=false;
socket.setTimeout(700,()=>socket.destroy());socket.on('error',()=>{});
socket.on('connect',()=>{connected=true;socket.destroy()});
socket.on('close',()=>{assert.equal(connected,false);console.log('FILES_AND_NETWORK_VERIFIED')});`),
      );
      assert.equal(receipt.passed, true);
      assert.match(receipt.stdout, /FILES_AND_NETWORK_VERIFIED/);
      assert.equal(connections, 0);
      assert.equal(receipt.host.profile_deleted, true);
      assert.equal(receipt.workspace_deleted, true);
      await assert.rejects(
        lstat(path.join(data, "cloud-programs", receipt.execution_id)),
        (e: any) => e.code === "ENOENT",
      );
      assert.equal(receipt.host.no_network_capabilities, true);
      assert.equal(
        files.find((f) => f.path === "output.txt")?.bytes.toString(),
        "Real customer program output",
      );
      assert.equal(
        await readFile(canary, "utf8"),
        "synthetic company-only fixture",
      );
      assert.equal(receipt.source_manifest[0].path, "main.cjs");
      assert.notEqual(
        receipt.source_manifest[0].sha256,
        sourceManifest(source(""))[0].sha256,
      );
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  },
);

test(
  "Node built-in tests execute in one restricted process and preserve failing exits",
  { skip: !windows },
  async () => {
    const good = await runCloudProgram(
      data,
      { program: "node_test", entry: "suite.cjs" },
      source(
        "const t=require('node:test'),a=require('node:assert/strict');t('real business rule',()=>a.equal(2+2,4));",
        "suite.cjs",
      ),
    );
    assert.equal(good.receipt.passed, true);
    assert.match(good.receipt.stdout, /# pass 1/);
    const bad = await runCloudProgram(
      data,
      { program: "node_test", entry: "suite.cjs" },
      source(
        "require('node:test')('broken rule',()=>{throw Error('business invariant failed')});",
        "suite.cjs",
      ),
    );
    assert.equal(bad.receipt.passed, false);
    assert.equal(bad.receipt.exit_code, 1);
    assert.match(bad.receipt.stdout, /business invariant failed/);
  },
);

test(
  "real TypeScript ESM executes and script arguments cannot become Node startup options",
  { skip: !windows },
  async () => {
    const actual = await runCloudProgram(
      data,
      {
        program: "node",
        entry: "main.mts",
        args: ["--require", "& arbitrary-text"],
      },
      source(
        "import assert from 'node:assert/strict';const value:number=42;assert.equal(value,42);assert.deepEqual(process.argv.slice(2),['--require','& arbitrary-text']);console.log('TYPESCRIPT_OK');",
        "main.mts",
      ),
    );
    assert.equal(actual.receipt.passed, true, actual.receipt.stderr);
    assert.match(actual.receipt.stdout, /TYPESCRIPT_OK/);
  },
);

test(
  "syntax failure, infinite code and prohibited child creation cannot produce a passing receipt",
  { skip: !windows },
  async () => {
    const syntax = await runCloudProgram(
      data,
      { program: "node_check", entry: "main.cjs" },
      source("const = broken;"),
    );
    assert.equal(syntax.receipt.passed, false);
    assert.match(syntax.receipt.stderr, /SyntaxError/);
    const loop = await runCloudProgram(
      data,
      { program: "node", entry: "main.cjs", timeout_ms: 300 },
      source("while(true){}"),
    );
    assert.equal(loop.receipt.passed, false);
    assert.equal(loop.receipt.stop_reason, "timeout");
    assert.equal(loop.receipt.host.profile_deleted, true);
    const denied = await runCloudProgram(
      data,
      { program: "node", entry: "main.cjs", timeout_ms: 500 },
      source(
        "require('node:child_process').spawnSync(process.execPath,['-e',\"require('node:fs').writeFileSync('child-created.txt','unexpected')\"]);",
      ),
    );
    assert.equal(denied.receipt.passed, false);
    assert.equal(denied.receipt.host.child_processes_prohibited, true);
    assert.equal(denied.receipt.host.profile_deleted, true);
    assert.equal(
      denied.files.some((f) => f.path === "child-created.txt"),
      false,
    );
  },
);

test(
  "cancellation, oversized output and temporary files remain bounded and never pass",
  { skip: !windows },
  async () => {
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 400);
    try {
      const cancelled = await runCloudProgram(
        data,
        { program: "node", entry: "main.cjs" },
        source("while(true){}"),
        abort.signal,
      );
      assert.equal(cancelled.receipt.passed, false);
      assert.equal(cancelled.receipt.stop_reason, "cancelled");
      assert.equal(cancelled.receipt.host.profile_deleted, true);
    } finally {
      clearTimeout(timer);
    }
    const output = await runCloudProgram(
      data,
      { program: "node", entry: "main.cjs" },
      source("console.log('a'.repeat(200000));setInterval(()=>{},1000);"),
    );
    assert.equal(output.receipt.passed, false);
    assert.equal(output.receipt.output_truncated, true);
    assert.ok(Buffer.byteLength(output.receipt.stdout) <= 131072);
    const files = await runCloudProgram(
      data,
      { program: "node", entry: "main.cjs" },
      source(
        "require('node:fs').writeFileSync('.tmp/oversize',Buffer.alloc(5000000));setInterval(()=>{},1000);",
      ),
    );
    assert.equal(files.receipt.passed, false);
    assert.equal(files.receipt.stop_reason, "workspace_limit");
    assert.equal(files.files.length, 0);
  },
);

test(
  "an interrupted owned guardian kills its customer process and cleans the native profile and workspace without inventing success",
  { skip: !windows },
  async () => {
    const interruption = path.join(data, "interrupted");
    const abort = new AbortController();
    const run = runCloudProgram(
      interruption,
      { program: "node", entry: "main.cjs", timeout_ms: 30000 },
      source("while(true){}"),
      abort.signal,
    ).then(
      (result) => ({ result, error: null }),
      (error) => ({ result: null, error }),
    );
    let owner: any,
      root = "";
    const deadline = Date.now() + 20000;
    try {
      while (!owner && Date.now() < deadline) {
        for (const id of await readdir(
          path.join(interruption, "cloud-programs"),
        ).catch(() => [])) {
          root = path.join(interruption, "cloud-programs", id);
          try {
            owner = JSON.parse(
              await readFile(path.join(root, "owner.json"), "utf8"),
            );
          } catch {}
        }
        if (!owner) await new Promise((r) => setTimeout(r, 50));
      }
      assert.ok(
        owner,
        "The actual owned native guardian must start before interruption",
      );
      assert.match(owner.profile_name, /^cpsoftware-[a-f0-9]{32}$/);
      assert.ok(Number.isSafeInteger(owner.host_pid));
      process.kill(owner.host_pid);
      const outcome = await run;
      assert.ok(
        outcome.error,
        "An interrupted execution must reject instead of inventing a successful receipt",
      );
      await assert.rejects(lstat(root), (e: any) => e.code === "ENOENT");
    } finally {
      abort.abort();
      await run;
    }
  },
);
