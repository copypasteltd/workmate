import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
const base = path.resolve(".data/cloud-program-probes", randomUUID()),
  root = path.join(base, randomUUID());
const work = path.join(root, "work"),
  runtime = path.join(root, "runtime/node.exe"),
  sentinel = path.join(base, "outside.txt");
await mkdir(work, { recursive: true });
await mkdir(path.dirname(runtime));
await copyFile(process.execPath, runtime);
await writeFile(sentinel, "Fixture outside the customer grant", { flag: "wx" });
const sha = createHash("sha256")
  .update(await readFile(runtime))
  .digest("hex");
let connections = 0;
const server = createServer((socket) => {
  connections++;
  socket.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const source = `const fs=require('node:fs'),net=require('node:net');
let outside='UNEXPECTED_ACCESS';try{fs.readFileSync(${JSON.stringify(sentinel)},'utf8')}catch(e){outside=e.code}
fs.writeFileSync('output.txt','Actual AppContainer Node output');
const socket=net.connect({host:'127.0.0.1',port:${server.address().port}});let connected=false;
socket.setTimeout(1000,()=>socket.destroy());socket.on('connect',()=>{connected=true;socket.destroy()});socket.on('error',()=>{});
socket.on('close',()=>console.log(JSON.stringify({outside,output:fs.readFileSync('output.txt','utf8'),network_attempted:true,network_connected:connected,environment:process.env})));
`;
await writeFile(path.join(work, "main.cjs"), source, { flag: "wx" });
const host = path.resolve(".data/cloud-program-host/cloud-program-host.exe");
const child = spawn(
  host,
  [
    root,
    runtime,
    sha,
    "15000",
    "--preserve-symlinks",
    "--preserve-symlinks-main",
    "main.cjs",
  ],
  {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, COPYPASTE_PRIVATE_PROBE: "not-for-customer-code" },
  },
);
let output = "",
  error = "";
child.stdout.on("data", (b) => (output += b));
child.stderr.on("data", (b) => (error += b));
let report;
try {
  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const receipt = JSON.parse(
    await readFile(path.join(root, "host-receipt.json"), "utf8"),
  );
  const line = output.split(/\r?\n/).find((v) => v.startsWith("{")),
    actual = line ? JSON.parse(line) : null;
  report = { exit, receipt, actual, output, error, connections };
  await writeFile(
    path.join(base, "probe.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  assert.equal(exit, 0, JSON.stringify(report));
  assert.equal(receipt.resumed, true);
  assert.equal(receipt.profile_deleted, true);
  assert.ok(["EACCES", "EPERM"].includes(actual.outside));
  assert.equal(actual.output, "Actual AppContainer Node output");
  assert.equal(connections, 0);
  assert.equal(actual.network_attempted, true);
  assert.equal(actual.network_connected, false);
  assert.equal(actual.environment.COPYPASTE_PRIVATE_PROBE, undefined);
  console.log(
    JSON.stringify({
      status: "passed",
      receipt: path.relative(process.cwd(), path.join(base, "probe.json")),
      checks: [
        "real Node execution",
        "workspace writes",
        "outside file denied",
        "loopback network denied",
        "parent environment absent",
        "profile deleted",
      ],
    }),
  );
} finally {
  child.stdin.end();
  await new Promise((resolve) => server.close(resolve));
}
