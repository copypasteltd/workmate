import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Page, ElectronApplication } from "playwright";
import { DesktopWorkflowModelFixture } from "./desktop-workflow-model-fixture.js";
import { saveWorkmateScreenshot } from "./record-workmate-media.js";

export async function runDesktopWorkflowJourney(j: {
  page: Page; electron: ElectronApplication; system: any; model: DesktopWorkflowModelFixture;
  tenant: string; project: string; workspace: string; outside: string; owned: string; delivery: string; attempt: string;
  list(): Promise<any>; until(read: () => Promise<any>, ok: (value: any) => boolean, label: string, ms?: number): Promise<any>;
  resize(width: number, height: number, label: string): Promise<void>; reload(): Promise<void>;
  pass(text: string): void; screenshots: any[]; providerCalls(): number;
}) {
  const { page, model, system } = j;
  const screenshot = async (name: string, note: string) => j.screenshots.push(await saveWorkmateScreenshot("desktop", "local-" + j.attempt, name, await page.screenshot(), note, j.delivery));
  await page.getByLabel("Local specialist", { exact: true }).selectOption("workflow-consultant");
  const previous = await j.list(); await page.getByRole("button", { name: "Choose folder to start", exact: true }).click();
  await j.until(j.list, state => state.id !== previous.id, "native workflow specialist session");
  await page.getByLabel("Local permission", { exact: true }).selectOption("full-access");
  await page.getByRole("button", { name: "Set permission", exact: true }).click();
  const calls = j.providerCalls(); model.begin("execute");
  await page.getByLabel("Local task", { exact: true }).fill("Create a bounded native launch-review workflow. Have the developer write a local checklist, wait for my approval, then have the QA specialist verify the actual file. Deliver its SOP, executable JSON and recovery notes.");
  await page.getByRole("button", { name: "Start work", exact: true }).click();
  const pending = await j.until(j.list, state => state.busy && state.inputs?.some((input: any) => input.questions[0]?.id === "workflow_decision"), "separate child-step fee confirmation", 90000);
  assert.ok(pending.inputs[0].questions[0].question.includes("HK$ 0.20"));
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE desktop_workflow_run_id IN (SELECT id FROM workflow_runs WHERE origin_task_id=$1)", [pending.task.task_id])).rows[0].n, 0);
  const form = () => page.getByRole("form", { name: "Answer task questions", exact: true });
  await form().scrollIntoViewIfNeeded(); await screenshot("workflow-fees-en", "Actual trusted-main confirmation for an immutable native workflow and HK$0.20 additional child limits; no child has been reserved or started. Model and native dialog decisions are explicit fixtures.");
  await form().getByRole("radio").first().check(); await form().getByRole("button", { name: "Answer and continue", exact: true }).click();
  const approval = await j.until(j.list, state => state.inputs?.some((input: any) => input.questions[0]?.header === "流程審批 / Workflow approval"), "human approval between real local children", 90000);
  assert.equal(await readFile(path.join(j.workspace, "native-flow-checklist.txt"), "utf8"), "native-checklist-verified");
  assert.equal(await readFile(j.outside, "utf8"), "native-child-full-access");
  await form().scrollIntoViewIfNeeded(); await screenshot("workflow-approval-en", "The real local developer child has written and checked the file, including the explicitly granted outside-workspace write. QA cannot start until this exact human approval is submitted.");
  await form().getByRole("radio").first().check(); await form().getByRole("button", { name: "Answer and continue", exact: true }).click();
  const complete = await j.until(j.list, state => !state.busy && state.task?.task_id === approval.task.task_id && state.task.status === "succeeded", "real native developer and QA plus private workflow deliveries", 90000);
  assert.equal(await readFile(path.join(j.workspace, "native-flow-qa.txt"), "utf8"), "native-checklist-verified-qa");
  const run = (await system.db.control.query("SELECT * FROM workflow_runs WHERE origin_task_id=$1", [complete.task.task_id])).rows[0];
  assert.equal(run.state, "succeeded"); assert.equal(run.cursor, 3); assert.equal(run.results[1].actor_id, run.created_by);
  const tasks = (await system.db.control.query("SELECT role_key,status,execution_location,charged_micros FROM tasks WHERE id=$1 OR desktop_workflow_run_id=$2", [complete.task.task_id, run.id])).rows;
  assert.equal(tasks.length, 3); assert.ok(tasks.every((task: any) => task.execution_location === "desktop" && task.status === "succeeded"));
  assert.equal(tasks.reduce((sum: number, task: any) => sum + Number(task.charged_micros), 0), (j.providerCalls() - calls) * 30);
  const progress = page.getByLabel("Local workflow progress", { exact: true });
  await progress.getByText("Workflow completed", { exact: true }).waitFor(); await progress.scrollIntoViewIfNeeded();
  await screenshot("workflow-completed-en", "Actual completed three-step local workflow; two native child roles have company usage receipts and real file results. Parent conversation and unfinished usage remain separately labelled.");
  const folder = path.join(j.owned, "workflow-downloads"); await mkdir(folder);
  await j.electron.evaluate(({ dialog }, folder) => {
    const previous = dialog.showSaveDialog;
    dialog.showSaveDialog = async (...args: any[]) => {
      const options = args.at(-1), filename = String(options.defaultPath ?? "").split(/[\\/]/).at(-1)!;
      return ["SOP.md", "workflow.json", "recovery.md"].includes(filename) ? { canceled: false, filePath: folder + "/" + filename } as any : (previous as any)(...args);
    };
  }, folder);
  for (const filename of ["SOP.md", "workflow.json", "recovery.md"]) {
    await page.getByLabel("Project artifacts", { exact: true }).getByRole("button", { name: filename + " · v1", exact: true }).click();
    await j.until(() => readFile(path.join(folder, filename), "utf8").catch(() => ""), Boolean, "actual native workflow download " + filename);
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(folder, "workflow.json"), "utf8")), model.definition);
  assert.match(await readFile(path.join(folder, "SOP.md"), "utf8"), /human approval/);
  assert.match(await readFile(path.join(folder, "recovery.md"), "utf8"), /Never replay/);
  await j.resize(800, 600, "actual native workflow compact window");
  const box = await page.getByRole("button", { name: "Start work", exact: true }).boundingBox();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 800 && box.y + box.height <= 600);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await screenshot("workflow-compact-en", "Actual frameless 800x600 Electron surface retains the native workflow progress and usable task composer; no CDP viewport substitute.");
  await j.resize(1280, 900, "restore native workflow window");
  await page.evaluate(() => localStorage.setItem("cp_locale", "zh")); await j.reload();
  await page.getByLabel("本機流程進度", { exact: true }).getByText("流程已完成", { exact: true }).waitFor();
  await page.getByLabel("本機流程進度", { exact: true }).scrollIntoViewIfNeeded();
  await screenshot("workflow-completed-zh", "Actual Chinese workflow progress after renderer reload; local history, real company receipts and exact workflow version are retained.");
  await page.evaluate(() => localStorage.setItem("cp_locale", "en")); await j.reload(); await page.getByRole("heading", { name: "Your local workmate" }).waitFor();
  j.pass("Native workflow fee confirmation and human step approval precede two real local Codex children; exact SOP/JSON/recovery downloads, company child fees, bilingual reload and actual 800x600 composer are verified");
}
