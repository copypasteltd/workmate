import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";
import { assertDesktopLayout } from "./qa-desktop-layout.js";
const actualText = (output: any) => typeof output === "string" ? output : output.filter((item: any) => ["text", "input_text"].includes(item.type)).map((item: any) => item.text).join("\n");
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Synthetic model instructions only: program output, PID, file and receipt
 * must come back through the real packaged customer-device Codex process. */
export class DesktopProgramModel {
  private mode: "execute" | "failure" | "denied" | "stop" | "revoke" | null = null;
  private actions: string[] = [];
  private pending?: { call: string; tool: string };
  private program = ""; private argv: string[] = []; private receipt = "";
  observations: { tool: string; value: any; actual_output: true }[] = [];
  begin(mode: NonNullable<typeof this.mode>, program: string, argv: string[]) {
    this.mode = mode; this.program = program; this.argv = argv; this.pending = undefined; this.receipt = "";
    this.actions = mode === "execute" ? ["list", "run", "status"] : ["run"];
  }
  end() { this.mode = null; this.pending = undefined; this.actions = []; }
  next(body: any, serial: number): any | null {
    if (!this.mode) return null;
    if (this.pending) {
      const result = body.input.find((item: any) => item.type === "function_call_output" && item.call_id === this.pending!.call);
      assert.ok(result, "Actual native program result must return through Codex"); const text = actualText(result.output);
      if (this.mode === "denied") { assert.match(text, /LOCAL_PROGRAM_NOT_APPROVED/); this.observations.push({ tool: "denied", value: text, actual_output: true }); }
      else {
        const value = JSON.parse(text); this.observations.push({ tool: this.pending.tool, value, actual_output: true });
        if (this.pending.tool === "list") assert.ok(value.programs.some((p: any) => p.id === this.program));
        if (this.pending.tool === "run") {
          assert.equal(value.state, this.mode === "failure" ? "failed" : this.mode === "revoke" ? "cancelled" : "succeeded");
          assert.deepEqual(value.argv, this.argv); assert.ok(value.pid > 0); this.receipt = value.id;
          if (this.mode === "failure") assert.equal(value.exitCode, 7);
        }
        if (this.pending.tool === "status") assert.equal(value.id, this.receipt);
      }
      this.pending = undefined;
    }
    const tool = this.actions.shift();
    if (!tool) {
      const mode = this.mode; this.end();
      return { type: "message", id: "msg_program_" + serial, role: "assistant", status: "completed", content: [{ type: "output_text",
        text: mode === "execute" ? "The approved program completed. Its original receipt and exact arguments are available in Local programs."
          : mode === "failure" ? "The program exited with code 7. Review its actual error output; this run did not succeed."
          : mode === "revoke" ? "Your program approval was revoked and its owned processes stopped. The original run is recorded as stopped."
          : "This program is not approved for the current session. Choose and approve it in Local programs before a new invocation.", annotations: [] }] };
    }
    const declaration = body.tools?.find((item: any) => item.type === "namespace" && item.name === "copypaste_programs");
    assert.ok(declaration?.tools.some((item: any) => item.name === tool), "Exact native program declaration required");
    const args = tool === "list" ? {} : tool === "status" ? { receipt_id: this.receipt } : { program_id: this.program, argv: this.argv, timeout_ms: this.mode === "stop" || this.mode === "revoke" ? 120000 : 15000 };
    const call = "call_program_ui_" + serial; this.pending = { call, tool };
    return { type: "function_call", id: "fc_program_ui_" + serial, call_id: call, namespace: "copypaste_programs", name: tool, arguments: JSON.stringify(args) };
  }
}

export async function exerciseDesktopPrograms(j: any) {
  const { page, electron, model, workspace } = j;
  const observationsBefore = model.observations.length, receipts: any[] = [];
  const script = path.join(workspace, "approved-program-task.cjs"), output = path.join(workspace, "approved-program-output.json");
  await writeFile(script, "const fs=require('fs');const mode=process.argv[3];if(mode==='tree'){const child=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});fs.writeFileSync(process.argv[2],JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);}else if(mode==='failure'){console.error('ACTUAL_NATIVE_EXIT_SEVEN');process.exit(7);}else{fs.writeFileSync(process.argv[2],JSON.stringify({args:process.argv.slice(4),token:!!process.env.COPYPASTE_LOCAL_INFERENCE_TOKEN}));console.log('ACTUAL_APPROVED_PROGRAM_COMPLETE');}");
  const catalog = async () => {
    const state = await j.list(); return page.evaluate(async (id: string) => {
      const reply = await (window as any).copyPasteBridge.localAgent("program.list", { id }); assertReply(reply); return reply.value;
      function assertReply(reply: any) { if (!reply.ok) throw new Error(reply.code); }
    }, state.id);
  };
  const create = async () => {
    await page.getByRole("button", { name: "Conversation", exact: true }).click();
    await page.getByLabel("Local specialist", { exact: true }).selectOption("fullstack"); const old = (await j.list())?.id;
    await page.getByRole("button", { name: "Choose folder to start", exact: true }).click();
    return j.until(j.list, (s: any) => s.id !== old, "new customer-local program session");
  };
  const full = async () => {
    await page.getByLabel("Local permission", { exact: true }).selectOption("full-access"); await page.getByRole("button", { name: "Set permission", exact: true }).click();
    await j.until(j.list, (s: any) => s.permission === "full-access", "explicit program full permission");
  };
  const programsTab = () => page.getByRole("button", { name: "Local programs", exact: true }).click();
  const send = async (text: string) => {
    const previous = (await j.list()).task?.task_id;
    await page.getByRole("button", { name: "Conversation", exact: true }).click(); await page.getByLabel("Local task", { exact: true }).fill(text);
    await page.getByRole("button", { name: "Start work", exact: true }).click();
    return (await j.until(j.list, (s: any) => s.task?.task_id && s.task.task_id !== previous, "new original company task for program invocation")).task.task_id;
  };
  const approve = async () => {
    await programsTab(); await page.getByRole("button", { name: "Choose program", exact: true }).click();
    return (await j.until(catalog, (c: any) => c.programs.some((p: any) => p.active), "actual native program selection and approval")).programs.find((p: any) => p.active).id;
  };
  const capture = async (name: string) => j.screenshots.push(await saveWorkmateScreenshot("desktop", "local-" + j.attempt, name, await j.captureSurface(),
    "Actual packaged native Desktop program catalog/history; actual local Codex, Windows Job Object, original company task and exact output. Model text and native chooser/consent decisions are explicit fixtures.", j.delivery));
  const cloudBefore = Number((await j.system.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE execution_location='cloud'")).rows[0].n);
  const initial = await create(); await programsTab(); await page.getByRole("heading", { name: "Bring your own tools", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Choose program", exact: true }).isDisabled(), true); await full();
  await electron.evaluate(() => { (globalThis as any).__localProgramCancelled = true; });
  await page.getByRole("button", { name: "Choose program", exact: true }).click(); assert.equal((await catalog()).programs.length, 0);
  await electron.evaluate(() => { (globalThis as any).__localProgramCancelled = false; (globalThis as any).__localDecision = 0; });
  await page.getByRole("button", { name: "Choose program", exact: true }).click(); assert.equal((await catalog()).programs.length, 0);
  await electron.evaluate(() => { (globalThis as any).__localDecision = 1; }); const program = await approve();
  const dialog = await electron.evaluate(() => (globalThis as any).__localDialogs.at(-1));
  assert.equal(dialog.defaultId, 0); assert.equal(dialog.cancelId, 0); assert.match(dialog.detail, /SHA-256 [a-f0-9]{64}/); assert.ok(dialog.detail.includes(workspace));
  assert.equal((await j.list()).id, initial.id); await capture("programs-approved-en");
  j.pass("Local programs require customer full access and explicit pinned native approval; cancelled chooser and declined default-Cancel confirmation grant nothing");
  let recording: WorkmateRecording | undefined, media: any;
  try {
    recording = new WorkmateRecording("desktop", "local-programs", "local-" + j.attempt, j.captureSurface, "Actual program approval, native Codex invocation and recorded output; only model and dialog decisions are synthetic", j.delivery);
    await recording.start(); const before = j.providerCalls(), argv = [script, output, "success", "香港設計", 'literal"quote', "trailing\\", "", "$(no-shell);&|"];
    model.begin("execute", program, argv); const originalTask = await send("Use my approved local program with the exact arguments, then inspect its original receipt.");
    const done = await j.until(j.list, (s: any) => !s.busy && s.task?.task_id === originalTask && s.task.status === "succeeded", "actual approved-program result", 90000);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), { args: argv.slice(3), token: false });
    const rows = (await catalog()).receipts; assert.equal(rows.length, 1); const receipt = rows[0];
    assert.equal(receipt.taskId, done.task.task_id); assert.equal(receipt.state, "succeeded"); assert.deepEqual(receipt.argv, argv); assert.equal(receipt.exitCode, 0);
    receipts.push(receipt);
    assert.equal(Number(done.task.charged_micros), (j.providerCalls() - before) * 30);
    assert.equal((await j.system.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1", [done.task.task_id])).rows[0].n, 1);
    await programsTab(); await page.locator("[data-program-receipt]").getByText("Arguments and output", { exact: true }).click();
    await page.getByLabel("Standard output", { exact: true }).filter({ hasText: "ACTUAL_APPROVED_PROGRAM_COMPLETE" }).waitFor(); await capture("programs-output-en");
    media = await recording.stop(); recording = undefined;
    j.pass("Real packaged Codex lists/runs/inspects the approved Windows program with exact Unicode argv, real output and one original company reservation/receipt");
    const beforeFailure = j.providerCalls(); model.begin("failure", program, [script, output, "failure"]); const failedProgramTask = await send("Run the approved program and report its actual exit failure.");
    await j.until(catalog, (c: any) => c.receipts.length === 2 && c.receipts.at(-1).state === "failed", "nonzero program failure receipt", 90000);
    await j.until(j.list, (s: any) => !s.busy && s.task?.task_id === failedProgramTask && s.task.status === "succeeded", "native conversation explains program failure", 90000);
    assert.equal((await catalog()).receipts.at(-1).exitCode, 7); assert.ok(j.providerCalls() > beforeFailure);
    receipts.push((await catalog()).receipts.at(-1));
    await programsTab(); await capture("programs-failure-en");
    j.pass("A real native exit code 7 is retained as a failed program run with actual stderr, while the conversation clearly explains the failure");
    for (const language of ["en", "zh"]) {
      if (language === "zh") await page.getByTitle("切換至繁體中文", { exact: true }).click();
      await page.getByRole("heading", { name: language === "en" ? "Bring your own tools" : "把常用工具交給工作夥伴", exact: true }).waitFor();
      for (const [width, height] of [[1440, 980], [1024, 768], [800, 600]]) {
        await j.resize(width, height, "actual programs layout " + language); await assertDesktopLayout(page); await capture(`programs-${width}x${height}-${language}`);
      }
    }
    await page.getByTitle("Switch to English", { exact: true }).click(); await j.resize(1440, 980, "restore programs native layout");
    j.pass("Actual Local programs catalog/history wraps at 1440x980, 1024x768 and 800x600 in English and Traditional Chinese with no visible scroll rails or horizontal overflow");
    for (const mode of ["stop", "revoke"] as const) {
      await create(); await full(); const id = await approve(), pids = path.join(workspace, "program-" + mode + "-tree.json");
      model.begin(mode, id, [script, pids, "tree"]); await send("Run the approved tool so I can " + mode + " its owned processes.");
      const ids: number[] = await j.until(() => readFile(pids, "utf8").then(JSON.parse).catch(() => []), (value: number[]) => value.length === 2, "actual native program tree before " + mode, 90000);
      assert.ok(ids.every(alive)); const running = await j.list();
      if (mode === "stop") {
        await page.locator(".local-agent-composer").getByRole("button", { name: "Stop", exact: true }).click();
        await j.until(j.list, (s: any) => !s.busy && s.task?.task_id === running.task.task_id, "actual owned program stop", 30000); model.end();
      } else {
        await programsTab(); await page.locator("[data-program-id]").getByRole("button", { name: "Revoke", exact: true }).click();
        await j.until(j.list, (s: any) => !s.busy && s.task?.task_id === running.task.task_id, "program-only revocation returns actual stopped receipt", 30000);
      }
      await j.until(async () => ids.map(alive), (values: boolean[]) => values.every(value => !value), "actual program and descendant exit on " + mode, 10000);
      const saved = (await catalog()).receipts.at(-1); assert.equal(saved.state, "cancelled"); assert.equal(saved.taskId, running.task.task_id);
      receipts.push(saved);
      await programsTab(); await capture("programs-" + mode + "-en");
      j.pass(mode === "stop" ? "Stop during a real native program kills its owned process tree and retains the original cancelled receipt and company task"
        : "Revoking an approved program from its visible catalog kills its real owned tree and records cancellation without revoking the customer's separate full-access grant");
      if (mode === "revoke") {
        const count = (await catalog()).receipts.length; model.begin("denied", id, [script, output, "success"]); await send("Attempt the revoked program without renewing approval.");
        await j.until(j.list, (s: any) => !s.busy && s.task?.task_id !== running.task.task_id && s.task?.status === "succeeded", "revoked native program denial", 90000);
        assert.equal((await catalog()).receipts.length, count); assert.equal((await j.list()).permission, "full-access");
        j.pass("A later real Codex invocation of the revoked program is denied before creating another run, even though full local permission remains granted");
      }
    }
  } finally { model.end(); if (recording) await recording.stop(); }
  assert.equal(Number((await j.system.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE execution_location='cloud'")).rows[0].n), cloudBefore);
  assert.ok(receipts.every(receipt => !alive(receipt.pid) && !alive(receipt.hostPid)));
  return { actual_outputs: model.observations.slice(observationsBefore), receipts, media, no_cloud_replacement_tasks: true, owned_programs_closed: true, human_native_dialog_clicks: false };
}
