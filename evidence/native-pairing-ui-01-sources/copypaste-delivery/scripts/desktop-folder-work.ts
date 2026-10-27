import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";
import { assertDesktopLayout } from "./qa-desktop-layout.js";

function strings(value: any): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  return value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
}
/** Only Responses are synthetic. The packaged customer-local Codex process
 * must execute its own terminal, read the actual snapshot and create the output. */
export class DesktopFolderModel {
  active = false;
  private runs = new Map<string, { call?: string; question?: string; done: boolean }>();
  observations: { job_id: string; sha256: string; actual_output: true }[] = [];
  answers: { job_id: string; original_preserved: true }[] = [];
  constructor(private readonly workspace: string) {}
  next(body: any, serial: number): any | null {
    if (!this.active) return null;
    const line = strings(body.input).flatMap(text => text.split("\n")).filter(text => text.startsWith('{"job_id":')).at(-1);
    assert.ok(line, "A real native request must contain the persisted folder job and exact input digest");
    const job = JSON.parse(line), existing = this.runs.get(job.job_id);
    assert.match(job.job_id, /^[a-f0-9-]{36}$/i); assert.match(job.input_sha256, /^[a-f0-9]{64}$/);
    for (const relative of [job.input_snapshot, job.output_directory]) {
      assert.ok(relative.startsWith(".copypaste-local-jobs/")); assert.ok(!path.isAbsolute(relative)); assert.ok(!relative.split(/[\\/]/).includes(".."));
    }
    const tools = (body.tools ?? []).flatMap((namespace: any) => namespace.type === "namespace"
      ? namespace.tools.map((tool: any) => ({ ...tool, qualified: namespace.name + "." + tool.name })) : [{ ...namespace, qualified: namespace.name }]);
    if (!existing && this.runs.size === 0) {
      const tool = tools.find((item: any) => /(?:^|\.)request_user_input$/.test(item.qualified)); assert.ok(tool);
      const question = "call_folder_question_" + serial; this.runs.set(job.job_id, { question, done: false });
      return { type: "function_call", id: "fc_folder_question_" + serial, call_id: question, name: tool.qualified,
        arguments: JSON.stringify({ questions: [{ id: "preservation", header: "Original file", question: "How should the source CSV be handled?", options: [
          { label: "Preserve original", description: "Create a separate summary without changing the source." },
          { label: "Review first", description: "Inspect the source before choosing the output." },
        ] }] }) };
    }
    if (existing?.question) {
      const output = body.input.find((item: any) => item.type === "function_call_output" && item.call_id === existing.question);
      assert.ok(output, "The original native turn must receive the customer's actual answer");
      assert.deepEqual(JSON.parse(output.output).answers, { preservation: { answers: ["Preserve original"] } });
      existing.question = undefined; this.answers.push({ job_id: job.job_id, original_preserved: true });
    } else if (existing) {
      assert.equal(existing.done, false, "A completed job cannot issue another model turn");
      const output = body.input.find((item: any) => item.type === "function_call_output" && item.call_id === existing.call);
      assert.ok(output && strings(output.output).some(text => text.includes("FOLDER_WORK_WRITTEN")), "The actual native terminal must report its completed output");
      existing.done = true; this.observations.push({ job_id: job.job_id, sha256: job.input_sha256, actual_output: true });
      return { type: "message", id: "msg_folder_" + serial, role: "assistant", status: "completed",
        content: [{ type: "output_text", text: "The local CSV was checked and its summary was saved in the job's output folder. The original was preserved.", annotations: [] }] };
    }
    const tool = tools.find((item: any) => /(?:^|\.)(exec_command|shell|shell_command)$/.test(item.qualified)); assert.ok(tool);
    const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
    const source = path.resolve(this.workspace, job.input_snapshot), destination = path.resolve(this.workspace, job.output_directory, "campaign-summary.json");
    const command = "$ErrorActionPreference='Stop'; $actual=(Get-FileHash -LiteralPath " + literal(source) + " -Algorithm SHA256).Hash.ToLowerInvariant(); "
      + "if($actual -ne " + literal(job.input_sha256) + "){throw 'Changed input'}; $rows=@(Import-Csv -LiteralPath " + literal(source) + "); "
      + "$summary=@{job_id=" + literal(job.job_id) + ";input_sha256=$actual;row_count=$rows.Count;spend=($rows|Measure-Object -Property spend -Sum).Sum;clicks=($rows|Measure-Object -Property clicks -Sum).Sum}; "
      + "[IO.File]::WriteAllText(" + literal(destination) + ",($summary|ConvertTo-Json -Compress)); Write-Output 'FOLDER_WORK_WRITTEN'";
    const arguments_ = tool.parameters?.properties?.cmd ? { cmd: command, workdir: this.workspace, yield_time_ms: 1000, max_output_tokens: 1000 }
      : tool.parameters?.properties?.command?.type === "array" ? { command: ["powershell.exe", "-NoProfile", "-Command", command], workdir: this.workspace, timeout_ms: 10000 }
      : { command, workdir: this.workspace, timeout_ms: 10000 };
    const call = "call_folder_" + serial; this.runs.set(job.job_id, { call, done: false });
    return { type: "function_call", id: "fc_folder_" + serial, call_id: call, name: tool.qualified, arguments: JSON.stringify(arguments_) };
  }
}

export async function exerciseDesktopFolderWork(j: any) {
  let page = j.page, electron = j.electron;
  const { system, workspace, delivery, attempt, model, list, until, captureSurface, resize, pass, screenshots } = j;
  const input = path.join(workspace, "watch-input"); await mkdir(input);
  await writeFile(path.join(input, "baseline.csv"), "campaign,spend,clicks\nexisting,1,1\n");
  const recordings: any[] = []; let recording: WorkmateRecording | undefined;
  const rules = async () => {
    const response = await page.evaluate(async (id: string) => (window as any).copyPasteBridge.localAgent("schedule.list", { id }), session.id);
    assert.equal(response.ok, true, JSON.stringify(response)); return response.value;
  };
  const capture = async (name: string) => {
    await assertDesktopLayout(page);
    screenshots.push(await saveWorkmateScreenshot("desktop", "folders-" + attempt, name, await captureSurface(),
      "Actual packaged frameless Electron. Real filesystem watch, native Codex terminal, exact source/snapshot/output bytes and original task billing; model responses and native chooser/consent decisions are explicit fixtures.", delivery));
  };
  const startRecording = async (name: string) => {
    recording = new WorkmateRecording("desktop", name, "folders-" + attempt, captureSurface,
      "Actual folder-rule UI, native watch and local Codex. Application restart is real; source bytes and tasks are checked independently. Model and native dialog decisions are synthetic fixtures.", delivery);
    await recording.start();
  };
  const stopRecording = async () => { const current = recording; recording = undefined; if (current) recordings.push(await current.stop()); };
  const taskCount = async () => (await system.db.control.query("SELECT count(*)::int AS n FROM desktop_executions WHERE local_session_id=$1", [session.id])).rows[0].n;
  const cloudTasks = async () => (await system.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE tenant_id=$1 AND project_id=$2 AND execution_location='cloud'", [j.tenant, j.project])).rows[0].n;
  const beforeCloudTasks = await cloudTasks();
  await page.evaluate(() => { location.hash = "/app/local"; }); await page.getByLabel("Local specialist", { exact: true }).selectOption("fullstack");
  const previous = await list(); await page.getByRole("button", { name: "Choose folder to start", exact: true }).click();
  const session = await until(list, (value: any) => value.id !== previous.id, "new folder-work local session");
  await electron.evaluate(() => { (globalThis as any).__localDecision = 1; });
  await page.getByLabel("Local permission", { exact: true }).selectOption("full-access"); await page.getByRole("button", { name: "Set permission", exact: true }).click();
  await until(list, (value: any) => value.permission === "full-access", "folder rule's separate native grant");
  await electron.evaluate((_: any, folder: string) => { (globalThis as any).__localWatchInput = folder; }, input);
  model.active = true;
  try {
    await page.getByRole("button", { name: "Folder work", exact: true }).click(); await startRecording("native-folder-watch");
    await page.getByRole("button", { name: "New rule", exact: true }).click(); const form = page.getByRole("dialog");
    await form.getByLabel("Rule name", { exact: true }).fill("Campaign inbox");
    await form.getByLabel("Instructions for each file", { exact: true }).fill("Read each CSV snapshot. Check its hash and save campaign-summary.json with row count, spend and clicks inside its output folder. Preserve the original.");
    await form.getByLabel("Extensions, separated by commas", { exact: true }).fill(".csv"); await form.getByLabel("Total authorized HK$", { exact: true }).fill("2");
    await form.getByLabel("Maximum runs", { exact: true }).fill("2"); assert.equal(await form.getByRole("checkbox").isChecked(), false);
    await resize(800, 600, "actual compact new folder rule form"); await assertDesktopLayout(page);
    await form.getByRole("button", { name: "Choose input folder and create", exact: true }).focus();
    assert.equal(await form.getByRole("button", { name: "Choose input folder and create", exact: true }).evaluate((el: HTMLElement) => { const rect = el.getBoundingClientRect(); return rect.top >= 40 && rect.bottom <= innerHeight; }), true);
    await capture("new-rule-compact-en");
    await form.getByRole("button", { name: "Choose input folder and create", exact: true }).click(); await form.waitFor({ state: "detached" });
    const rule = (await until(rules, (items: any[]) => items.length === 1, "persisted paused folder rule"))[0];
    assert.equal(rule.state, "paused"); assert.equal(rule.input, input); assert.equal(await taskCount(), 0);
    await electron.evaluate(() => { (globalThis as any).__localDecision = 0; });
    await page.getByRole("button", { name: "Confirm and activate", exact: true }).click();
    await until(() => page.getByRole("button", { name: "Confirm and activate", exact: true }).isEnabled(), Boolean, "declined folder activation completed");
    assert.equal((await rules())[0].state, "paused"); assert.equal(await taskCount(), 0);
    await resize(1440, 980, "folder work native watch view"); await capture("paused-no-charge-en");
    pass("Folder rules require a separate writable native grant and default to paused; real compact form controls are reachable, and declining automatic-spend confirmation creates no task or charge");
    await electron.evaluate(() => { (globalThis as any).__localDecision = 1; }); await page.getByRole("button", { name: "Confirm and activate", exact: true }).click();
    await until(rules, (items: any[]) => items[0].state === "active", "confirmed native directory watch");
    const consent = await electron.evaluate(() => (globalThis as any).__localDialogs.at(-1));
    assert.equal(consent.defaultId, 0); assert.equal(consent.cancelId, 0); assert.ok(consent.detail.includes(input)); assert.ok(consent.detail.includes("HK$2.00"));
    for (const [spend, clicks] of [[1, 1], [10, 2], [120, 40]]) { await writeFile(path.join(input, "spring.csv"), `campaign,spend,clicks\nspring,${spend},${clicks}\n`); await new Promise(resolve => setTimeout(resolve, 100)); }
    await until(list, (value: any) => value.busy && value.inputs?.length === 1, "actual native folder task requests customer input");
    await page.getByRole("button", { name: "Answer questions", exact: true }).waitFor(); await capture("waiting-for-answer-en");
    assert.equal(await taskCount(), 1); await page.getByRole("button", { name: "Answer questions", exact: true }).click();
    const question = page.getByRole("form", { name: "Answer task questions", exact: true }); await question.waitFor();
    assert.equal(await question.getByRole("radio", { checked: true }).count(), 0);
    assert.equal(await question.getByRole("button", { name: "Answer and continue", exact: true }).isDisabled(), true);
    await resize(800, 600, "actual folder task answer in minimum window");
    await question.getByRole("radio", { name: /Preserve original/ }).check();
    const answer = question.getByRole("button", { name: "Answer and continue", exact: true }); await answer.focus();
    assert.equal(await answer.evaluate((el: HTMLElement) => { const box = el.getBoundingClientRect(); return box.top >= 40 && box.bottom <= innerHeight; }), true);
    await capture("answer-compact-en"); await answer.click(); await page.getByRole("button", { name: "Folder work", exact: true }).click();
    await resize(1440, 980, "folder output after answering the original task");
    pass("A real watched-file Codex task requests input without a duplicate task; Folder work exposes its pending question, compact Conversation accepts an unselected explicit choice and continues that same original turn");
    const firstRule = (await until(rules, (items: any[]) => items[0].jobs.some((job: any) => job.state === "succeeded"), "actual watched file and native Codex output", 90000))[0], first = firstRule.jobs[0];
    const original = await readFile(path.join(input, "spring.csv"));
    assert.equal(createHash("sha256").update(original).digest("hex"), first.input.sha256);
    const summary = JSON.parse(await readFile(path.join(workspace, first.output, "campaign-summary.json"), "utf8"));
    assert.equal(summary.job_id, first.id); assert.equal(summary.input_sha256, first.input.sha256); assert.equal(summary.spend, 120); assert.equal(summary.clicks, 40); assert.equal(summary.row_count, 1);
    const firstTask = (await system.db.control.query("SELECT * FROM tasks WHERE id=$1", [first.taskId])).rows[0];
    assert.equal(firstTask.execution_location, "desktop"); assert.equal(firstTask.status, "succeeded"); assert.equal(firstTask.charged_micros, "90"); assert.equal(firstTask.parent_id, null);
    await page.locator(".folder-work-history > summary").click(); await capture("real-native-output-and-cost-en");
    const calls = j.providerCalls(); await writeFile(path.join(input, "spring.csv"), original); await new Promise(resolve => setTimeout(resolve, 3200));
    assert.equal((await rules())[0].jobTotal, 1); assert.equal(await taskCount(), 1); assert.equal(j.providerCalls(), calls);
    await page.getByRole("button", { name: "Open output folder", exact: true }).click();
    assert.equal(await electron.evaluate(() => (globalThis as any).__openedOutputPath), path.join(workspace, first.output));
    pass("Actual native fs.watch coalesces rapid writes into one exact-byte CSV job; customer-local Codex answers, reads its snapshot and writes a verified summary, one 90-micro-HKD task settles, same bytes and product outputs create no second task");
    await page.getByRole("button", { name: "Pause new work", exact: true }).click(); await until(rules, (items: any[]) => items[0].state === "paused", "manual folder pause");
    await writeFile(path.join(input, "paused.csv"), "campaign,spend,clicks\npaused,3,4\n"); await new Promise(resolve => setTimeout(resolve, 2500));
    assert.equal(await taskCount(), 1); await rm(path.join(input, "paused.csv")); await capture("paused-new-files-held-en");
    await stopRecording(); await page.getByRole("button", { name: "Confirm and activate", exact: true }).click(); await until(rules, (items: any[]) => items[0].state === "active", "watch active before full application restart");
    const restarted = await j.restart(async () => { await writeFile(path.join(input, "after-restart.csv"), "campaign,spend,clicks\nrestart,30,6\n"); });
    page = restarted.page; electron = restarted.electron;
    await electron.evaluate((_: any, folder: string) => { const state = globalThis as any; state.__localWatchInput = folder; state.__localDecision = 1; }, input);
    await page.getByRole("button", { name: "Folder work", exact: true }).click(); await startRecording("native-folder-restart");
    const restored = (await rules())[0]; assert.equal(restored.id, rule.id); assert.equal(restored.state, "paused"); assert.equal(restored.reason, "LOCAL_SCHEDULE_APP_RESTARTED");
    assert.equal(restored.jobs[0].id, first.id); await new Promise(resolve => setTimeout(resolve, 2300)); assert.equal(await taskCount(), 1);
    await capture("app-reopened-paused-en");
    pass("The actual packaged application closes and restarts with a different owned PID; its encrypted queue, original job and limits survive, active watching reopens paused, and changes made while closed incur no automatic charge");
    await page.getByRole("button", { name: "Confirm and activate", exact: true }).click();
    const secondRule = (await until(rules, (items: any[]) => items[0].jobs.filter((job: any) => job.state === "succeeded").length === 2, "confirmed catch-up after actual application restart", 90000))[0];
    const second = secondRule.jobs.find((job: any) => job.id !== first.id), secondTask = (await system.db.control.query("SELECT * FROM tasks WHERE id=$1", [second.taskId])).rows[0];
    assert.equal(secondTask.parent_id, firstTask.id); assert.equal(secondTask.runtime_thread, firstTask.runtime_thread); assert.equal(secondTask.role_hash, firstTask.role_hash);
    assert.deepEqual(secondTask.input_context.project_configuration, firstTask.input_context.project_configuration);
    assert.equal(secondTask.charged_micros, "60"); assert.equal(secondRule.allocatedBudgetMicros, 2000000); assert.equal(secondRule.state, "paused");
    assert.equal(secondRule.reason, "LOCAL_SCHEDULE_LIMIT_REACHED"); assert.equal(await taskCount(), 2);
    const secondSummary = JSON.parse(await readFile(path.join(workspace, second.output, "campaign-summary.json"), "utf8")); assert.equal(secondSummary.spend, 30); assert.equal(secondSummary.clicks, 6);
    await writeFile(path.join(input, "over-limit.csv"), "campaign,spend,clicks\nlimit,2,3\n"); await new Promise(resolve => setTimeout(resolve, 2300)); assert.equal(await taskCount(), 2);
    pass("Explicit reactivation catches up only the new file, resumes the same actual Codex thread and pinned role/project versions, separately settles 60 micro-HKD and pauses at the two-run/HK$2 authorized cap");
    await page.locator(".folder-work-history > summary").click();
    for (const [width, height] of [[1440, 980], [1280, 800], [800, 600]]) {
      await resize(width, height, "actual folder work " + width + "x" + height); await assertDesktopLayout(page);
      const region = page.getByRole("region", { name: "Folder work", exact: true }); await region.focus(); await region.press("End");
      await until(() => region.evaluate((el: HTMLElement) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2), Boolean, "keyboard reaches final folder job");
      await capture("history-" + width + "x" + height + "-en");
    }
    await page.getByTitle("切換至繁體中文", { exact: true }).click(); await page.getByRole("heading", { name: "讓目錄接手重複工作", exact: true }).waitFor();
    await assertDesktopLayout(page); await capture("history-compact-zh"); await page.getByTitle("Switch to English", { exact: true }).click();
    pass("Folder rules and real output actions remain accessible in three actual OS window sizes and Traditional Chinese, with keyboard access, no visible scrollbar rails and no horizontal overflow");
    await page.getByRole("button", { name: "Revoke rule", exact: true }).click(); await until(rules, (items: any[]) => items[0].state === "revoked", "folder rule revoked");
    assert.equal((await rules())[0].jobTotal, 2); assert.equal((await rules())[0].jobs.filter((job: any) => job.state === "succeeded").length, 2);
    await capture("revoked-with-receipts-retained-en"); await stopRecording(); await resize(1440, 980, "restore native window after folder work");
    await page.getByRole("button", { name: "Conversation", exact: true }).click();
    pass("Revoking a folder rule preserves its two real output files and original cost receipts while preventing new automatic work");
    const additionalCloudTasks = await cloudTasks() - beforeCloudTasks; assert.equal(additionalCloudTasks, 0);
    return { recordings, application_restart: { old_pid: restarted.previous_pid, new_pid: restarted.current_pid, old_owned_process_exited: true },
      job_ids: [first.id, second.id], task_ids: [firstTask.id, secondTask.id], charged_micros: [firstTask.charged_micros, secondTask.charged_micros],
      actual_tool_outputs: model.observations, original_bytes_preserved: (await readFile(path.join(input, "spring.csv"))).equals(original), same_native_thread: true,
      answered_questions: model.answers, allocated_budget_micros: secondRule.allocatedBudgetMicros, additional_cloud_tasks: additionalCloudTasks };
  } finally { model.active = false; await stopRecording(); }
}
