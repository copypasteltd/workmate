import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { LocalProgramController, type ProgramIO, type ProgramJournal, type ProgramOwner } from "../src/local-programs.js";
import { validateProgramCall, type ProgramToolCall } from "../src/program-contract.js";
const signal = () => new AbortController().signal;
const value = (result: any) => JSON.parse(result.contentItems[0].text);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until<T>(read: () => Promise<T>, check: (value: T) => boolean, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await read().catch(() => undefined); if (result !== undefined && check(result)) return result; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error("Actual native result did not arrive");
}
async function fixture() {
  const parent = path.resolve(".data/program-tests"); await mkdir(parent, { recursive: true }); const root = await mkdtemp(path.join(parent, "owned-"));
  const sessionId = randomUUID(), taskId = randomUUID(), owner: ProgramOwner = { actorId: randomUUID(), epoch: randomUUID(), tenant: randomUUID(), project: randomUUID(),
    workspace: root, permission: "full-access", revoked: false, grantRevision: 1, expiresAt: Date.now() + 300000, programToolsVersion: 1 };
  let journal: ProgramJournal | null = null, chosen: string | null = process.execPath, consent = true, confirmed = 0, failWrites = false, reviews = false;
  const io: ProgramIO = { read: async () => structuredClone(journal), write: async value => { if (failWrites) throw new Error("Disk unavailable"); journal = structuredClone(value); },
    owner: async id => { assert.equal(id, sessionId); return { ...owner }; }, context: async id => { assert.equal(id, sessionId); return { ...owner }; },
    choose: async () => chosen, confirm: async program => { confirmed++; assert.equal(program.workspace, root); assert.match(program.sha256, /^[a-f0-9]{64}$/); return consent; },
    review: async () => reviews, changed: () => {}, host: path.resolve(".data/native-program-host/local-program-host.exe") };
  const controllers = [new LocalProgramController(io)], controller = controllers[0];
  let authorized = true;
  const session = controller.session({ sessionId, taskId }, async () => { if (!authorized) throw new Error("Company authority withdrawn"); });
  const call = (programId: string, argv: string[], id = randomUUID(), timeout = 5000): ProgramToolCall => ({ namespace: "copypaste_programs", tool: "run", arguments: { program_id: programId, argv, timeout_ms: timeout }, callId: id, threadId: "native-thread", turnId: "native-turn" });
  const approve = async () => (await controller.approve(sessionId))!.id;
  const script = async (name: string, content: string) => { const file = path.join(root, name + ".cjs"); await writeFile(file, content); return file; };
  const clean = async () => { await Promise.all(controllers.map(item => item.close())); assert.equal(path.dirname(root), parent); await rm(root, { recursive: true, force: true, maxRetries: 3 }); };
  return { root, sessionId, taskId, owner, io, controller, session, call, approve, script, clean, confirmed: () => confirmed,
    choose: (file: string | null) => { chosen = file; }, consent: (v: boolean) => { consent = v; }, authorize: (v: boolean) => { authorized = v; }, failWrites: () => { failWrites = true; },
    journal: () => journal!, review: (v: boolean) => { reviews = v; }, restart: () => { const next = new LocalProgramController(io); controllers.push(next); return next; } };
}

test("program selection and native approval both default to no grant; an older native thread cannot silently acquire new tools", async () => {
  const f = await fixture();
  try {
    f.choose(null); assert.equal(await f.controller.approve(f.sessionId), null); assert.equal(f.confirmed(), 0);
    f.choose(process.execPath); f.consent(false); assert.equal(await f.controller.approve(f.sessionId), null); assert.equal((await f.controller.list(f.sessionId)).programs.length, 0);
    f.owner.programToolsVersion = undefined; await assert.rejects(f.controller.approve(f.sessionId), { code: "LOCAL_PROGRAM_NEW_SESSION_REQUIRED" });
  } finally { await f.clean(); }
});
test("approved native argv preserves quotes, Unicode and trailing slashes without shell expansion and keeps company credentials out of the child", async () => {
  const f = await fixture();
  const key = "COPYPASTE_LOCAL_INFERENCE_TOKEN", before = process.env[key]; process.env[key] = "SYNTHETIC_PROGRAM_CREDENTIAL_MUST_NOT_INHERIT";
  try {
    const program = await f.approve(), output = path.join(f.root, "exact.json");
    const script = await f.script("literal argv", "require('fs').writeFileSync(process.argv[2],JSON.stringify({args:process.argv.slice(3),token:!!process.env.COPYPASTE_LOCAL_INFERENCE_TOKEN}));console.log('ACTUAL_STDOUT');console.error('ACTUAL_STDERR');");
    const arguments_ = ['香港 marketing', 'literal"quote', 'two\\\\', '$(not-a-command); & | >', '', 'trailing\\'];
    const result = value(await f.session.call(f.call(program, [script, output, ...arguments_]), signal()));
    assert.equal(result.state, "succeeded"); assert.equal(result.exitCode, 0); assert.equal(result.taskId, f.taskId); assert.ok(result.pid > 0);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), { args: arguments_, token: false });
    assert.match(result.stdout, /ACTUAL_STDOUT/); assert.match(result.stderr, /ACTUAL_STDERR/); assert.ok(!result.stdout.includes("CPPROGRAM1"));
  } finally { if (before === undefined) delete process.env[key]; else process.env[key] = before; await f.clean(); }
});
test("concurrent duplicate program calls execute once and replay exact immutable receipts; changed arguments with the same ID are rejected", async () => {
  const f = await fixture();
  try {
    const id = await f.approve(), output = path.join(f.root, "counter");
    const file = await f.script("once", "require('fs').appendFileSync(process.argv[2],'one\\n');console.log('once');");
    const call = f.call(id, [file, output]);
    const [first, second] = await Promise.all([f.session.call(call, signal()), f.session.call(call, signal())]);
    assert.equal(await readFile(output, "utf8"), "one\n"); assert.equal(value(first).id, value(second).id);
    first.contentItems[0].text = "changed"; assert.equal(value(await f.session.call(call, signal())).state, "succeeded");
    await assert.rejects(f.session.call({ ...call, arguments: { ...call.arguments, argv: [file, output, "changed"] } }, signal()), { code: "LOCAL_PROGRAM_CALL_CONFLICT" });
    assert.equal(f.journal().receipts.length, 1);
  } finally { await f.clean(); }
});
test("program nonzero exit and bounded output are recorded as actual failure rather than fabricated success", async () => {
  const f = await fixture();
  try {
    const id = await f.approve(), file = await f.script("failure", "process.stdout.write('x'.repeat(70000));console.error('actual failure');process.exit(7);");
    const response = await f.session.call(f.call(id, [file]), signal()), receipt = value(response);
    assert.equal(response.success, false); assert.equal(receipt.state, "failed"); assert.equal(receipt.exitCode, 7);
    assert.equal(receipt.stdout.length, 32768); assert.equal(receipt.stdoutBytes, 70000); assert.equal(receipt.outputTruncated, true);
  } finally { await f.clean(); }
});
test("permission downgrade, account change and company revocation deny cached program output and new launches", async () => {
  const f = await fixture();
  try {
    const id = await f.approve(), call = f.call(id, ["-e", "console.log('original')"]); await f.session.call(call, signal());
    f.owner.permission = "read-only"; await assert.rejects(f.session.call(call, signal()), { code: "LOCAL_PROGRAM_FULL_ACCESS_REQUIRED" });
    f.owner.permission = "full-access"; f.owner.grantRevision++;
    await assert.rejects(f.session.call(f.call(id, ["-e", "process.exit(0)"]), signal()), { code: "LOCAL_PROGRAM_NOT_APPROVED" });
    f.authorize(false); await assert.rejects(f.session.call(call, signal()), /Company authority withdrawn/);
    f.authorize(true); f.owner.epoch = randomUUID(); await assert.rejects(f.session.call(f.call(id, []), signal()), { code: "LOCAL_PROGRAM_NOT_APPROVED" });
  } finally { await f.clean(); }
});
test("changed approved executable is rejected before another program process starts", async () => {
  const f = await fixture();
  try {
    const executable = path.join(f.root, "chosen.exe"); await copyFile(process.execPath, executable); f.choose(executable); const id = await f.approve();
    await writeFile(executable, Buffer.from("MZchanged executable"));
    const receipt = value(await f.session.call(f.call(id, ["-e", "process.exit(0)"]), signal()));
    assert.equal(receipt.state, "failed"); assert.equal(receipt.error, "LOCAL_PROGRAM_CHANGED"); assert.equal(receipt.pid, undefined);
  } finally { await f.clean(); }
});
test("a persisted running invocation becomes unknown after restart; a new call cannot bypass required customer review", async () => {
  const f = await fixture();
  try {
    const id = await f.approve(), file = path.join(f.root, "once");
    const call = f.call(id, ["-e", "require('fs').appendFileSync(process.argv[1],'one')", file]);
    const original = value(await f.session.call(call, signal())); await f.controller.close(); f.journal().receipts[0].state = "running";
    const restarted = f.restart(), session = restarted.session({ sessionId: f.sessionId, taskId: f.taskId }, async () => {});
    assert.equal(value(await session.call(call, signal())).state, "unknown"); assert.equal(await readFile(file, "utf8"), "one");
    await assert.rejects(session.call(f.call(id, call.arguments.argv as string[]), signal()), { code: "LOCAL_PROGRAM_REVIEW_REQUIRED" });
    await restarted.review(f.sessionId, original.id); assert.equal(f.journal().receipts[0].reviewedAt, undefined);
    f.review(true); await restarted.review(f.sessionId, original.id); assert.ok(f.journal().receipts[0].reviewedAt); assert.equal(f.journal().receipts[0].state, "unknown");
    const result = value(await session.call(f.call(id, call.arguments.argv as string[]), signal())); assert.equal(result.state, "succeeded"); assert.equal(await readFile(file, "utf8"), "oneone");
  } finally { await f.clean(); }
});
test("aborting a real native job kills its program and grandchild while retaining an unrelated owned test process", async () => {
  const f = await fixture(), unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", windowsHide: true });
  try {
    const id = await f.approve(), pids = path.join(f.root, "pids.json");
    const file = await f.script("owned tree", "const cp=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});require('fs').writeFileSync(process.argv[2],JSON.stringify([process.pid,cp.pid]));setInterval(()=>{},1000);");
    const abort = new AbortController(), running = f.session.call(f.call(id, [file, pids], randomUUID(), 20000), abort.signal);
    const ids = await until(() => readFile(pids, "utf8").then(JSON.parse), (ids: number[]) => ids.length === 2);
    assert.ok(ids.every((pid: number) => alive(pid))); abort.abort();
    const receipt = value(await running); assert.equal(receipt.state, "cancelled");
    await until(async () => ids.map((pid: number) => alive(pid)), values => values.every(v => !v));
    assert.ok(alive(unrelated.pid!)); assert.equal(receipt.pid, ids[0]);
  } finally { unrelated.kill("SIGKILL"); await f.clean(); }
});
test("normal root exit also closes background descendants; timeout remains a separate unsuccessful state", async () => {
  const f = await fixture();
  try {
    const id = await f.approve(), pidFile = path.join(f.root, "descendant");
    const file = await f.script("exits first", "const child=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});require('fs').writeFileSync(process.argv[2],String(child.pid));child.unref();");
    const receipt = value(await f.session.call(f.call(id, [file, pidFile]), signal())); assert.equal(receipt.state, "succeeded");
    const pid = Number(await readFile(pidFile, "utf8")); await until(async () => alive(pid), v => !v);
    const timed = value(await f.session.call(f.call(id, ["-e", "setInterval(()=>{},1000)"], randomUUID(), 300), signal()));
    assert.equal(timed.state, "timed_out"); assert.ok(!alive(timed.pid));
  } finally { await f.clean(); }
});
test("losing the owning controller cancels current programs; two admitted runs exhaust the process quota before any third launch", async () => {
  const f = await fixture();
  try {
    const id = await f.approve(), script = ["-e", "setInterval(()=>{},1000)"];
    const first = f.session.call(f.call(id, script, randomUUID(), 20000), signal()), second = f.session.call(f.call(id, script, randomUUID(), 20000), signal());
    await until(async () => f.journal()?.receipts ?? [], rows => rows.length === 2 && rows.every(r => r.state === "running"));
    await assert.rejects(f.session.call(f.call(id, script), signal()), { code: "LOCAL_PROGRAM_CONCURRENCY_LIMIT" });
    await f.controller.close(); assert.ok([value(await first).state, value(await second).state].every(state => state === "cancelled"));
  } finally { await f.clean(); }
});
test("failed intent persistence never launches a process and malformed structured arguments never become commands", async () => {
  const f = await fixture();
  try {
    const id = await f.approve(), output = path.join(f.root, "must-not-exist"); f.failWrites();
    await assert.rejects(f.session.call(f.call(id, ["-e", "require('fs').writeFileSync(process.argv[1],'bad')", output]), signal()), { code: "LOCAL_PROGRAM_STORAGE_FAILED" });
    await assert.rejects(readFile(output), { code: "ENOENT" });
    for (const args of [{ program_id: [id], argv: [] }, { program_id: id, argv: "a command" }, { program_id: id, argv: ["a\0b"] }, { program_id: id, argv: [], env: {} }, { program_id: id, argv: [], timeout_ms: 120001 }])
      assert.throws(() => validateProgramCall({ ...f.call(id, []), arguments: args }), { code: "LOCAL_PROGRAM_INPUT_INVALID" });
  } finally { await f.clean(); }
});

test("revocation still kills an actual program when saving the revocation and final receipt both fail", async () => {
  const f = await fixture();
  try {
    const id = await f.approve(), pidFile = path.join(f.root, "storage-failure.pid");
    const script = await f.script("storage failure", "require('fs').writeFileSync(process.argv[2],String(process.pid));setInterval(()=>{},1000);");
    const running = f.session.call(f.call(id, [script, pidFile], randomUUID(), 20000), signal());
    const rejected = assert.rejects(running, { code: "LOCAL_PROGRAM_STORAGE_FAILED" });
    const pid = await until(() => readFile(pidFile, "utf8").then(Number), value => value > 0);
    f.failWrites(); await assert.rejects(f.controller.revoke(f.sessionId, id), { code: "LOCAL_PROGRAM_STORAGE_FAILED" });
    await rejected; await until(async () => alive(pid), value => !value);
  } finally { await f.clean(); }
});

test("unexpected death of the owning process closes the guardian job and its real descendants, preserving unrelated processes", async () => {
  const f = await fixture(), unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", windowsHide: true });
  let parent: ReturnType<typeof spawn> | undefined, host = 0;
  try {
    const id = await f.approve(), program = f.journal().programs.find(p => p.id === id)!;
    const pids = path.join(f.root, "crash-tree.json"), hostFile = path.join(f.root, "guardian.pid");
    const script = await f.script("crash-owned tree", "const child=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});require('fs').writeFileSync(process.argv[2],JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);");
    const owner = await f.script("owning process", "const fs=require('fs'),cp=require('child_process');const host=cp.spawn(process.argv[2],JSON.parse(process.argv[3]),{cwd:process.cwd(),stdio:['pipe','ignore','ignore'],windowsHide:true});fs.writeFileSync(process.argv[4],String(host.pid));setInterval(()=>{},1000);");
    parent = spawn(process.execPath, [owner, f.io.host!, JSON.stringify([program.path, program.sha256, script, pids]), hostFile], { cwd: f.root, stdio: "ignore", windowsHide: true });
    const exited = new Promise<void>(resolve => parent!.once("close", () => resolve()));
    const ids = await until(() => readFile(pids, "utf8").then(JSON.parse), (value: number[]) => value.length === 2);
    host = Number(await readFile(hostFile, "utf8")); assert.ok([host, ...ids].every(alive));
    parent.kill("SIGKILL"); await exited;
    await until(async () => [host, ...ids].map(alive), values => values.every(value => !value));
    assert.ok(alive(unrelated.pid!));
  } finally {
    if (parent?.pid && alive(parent.pid)) parent.kill("SIGKILL"); if (host && alive(host)) process.kill(host, "SIGKILL");
    unrelated.kill("SIGKILL"); await f.clean();
  }
});
