import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Page, ElectronApplication } from "playwright";
import { projectUIRequest } from "./project-configuration-ui.js";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";
import { assertDesktopLayout } from "./qa-desktop-layout.js";

/** Synthetic Responses direct real local Codex tools. Tool results and written
 * files are observed, never inserted into the runtime or task database. */
export class DesktopProjectConfigurationModel {
  private run?: { publication: any; source: any; file: string; excludedHash?: string; step: number; pending?: { call: string; tool: string }; value?: any };
  observations: { tool: string; version: number; actual_output: true; sha256?: string }[] = [];
  begin(publication: any, source: any, file: string, excludedHash?: string) { this.run = { publication, source, file, excludedHash, step: 0 }; }
  end() { this.run = undefined; }
  next(body: any, serial: number): any | null {
    const run = this.run; if (!run) return null;
    if (run.step === 0) {
      const context = JSON.stringify(body.input);
      assert.ok(context.includes("Shared project brief and exact references"));
      assert.ok(context.includes(run.publication.sha256), "The frozen shared publication must reach the actual native Responses request");
      assert.ok(context.includes(run.publication.body.instructions));
      if (run.excludedHash) assert.ok(!context.includes(run.excludedHash), "An implicit publication upgrade must not enter this local thread");
    }
    if (run.pending) {
      const result = body.input.find((item: any) => item.type === "function_call_output" && item.call_id === run.pending!.call);
      assert.ok(result, "The actual Codex process must return the local/company tool output");
      const text = typeof result.output === "string" ? result.output : result.output.filter((part: any) => ["text", "input_text"].includes(part.type)).map((part: any) => part.text).join("\n");
      if (run.pending.tool === "project_reference_read") {
        const value = JSON.parse(text);
        assert.equal(value.asset_version_id, run.source.asset_version_id); assert.equal(value.sha256, run.source.sha256);
        assert.equal(value.text, "Approved fixture evidence 0: HK$120. This is synthetic campaign data.");
        run.value = { guidance_version: run.publication.version, configuration_sha256: run.publication.sha256, ...value };
      } else assert.ok(text.includes("PROJECT_GUIDANCE_WRITTEN"), "The actual native terminal must complete the file write");
      this.observations.push({ tool: run.pending.tool, version: run.publication.version, actual_output: true, ...(run.pending.tool === "project_reference_read" ? { sha256: run.source.sha256 } : {}) });
      run.pending = undefined;
    }
    const step = run.step++;
    if (step === 2) {
      this.end();
      return { type: "message", id: "msg_guidance_" + serial, role: "assistant", status: "completed", content: [{ type: "output_text", text: "The approved shared reference was read through the company tool and written to the selected local workspace. Review the recorded project version and local file.", annotations: [] }] };
    }
    const tools = (body.tools ?? []).flatMap((ns: any) => ns.type === "namespace" ? ns.tools.map((tool: any) => ({ ...tool, qualified: ns.name + "." + tool.name })) : [{ ...ns, qualified: ns.name }]);
    const name = step === 0 ? "project_reference_read" : "terminal";
    const selected = tools.find((tool: any) => step === 0 ? tool.qualified === "copypaste.project_reference_read" : /(?:^|\.)(exec_command|shell|shell_command)$/.test(tool.qualified));
    assert.ok(selected, "The real native tool declaration is required: " + name);
    const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
    // The first request has not read the reference yet. Construct the native
    // command only after the real company-tool output has been observed.
    if (step === 1) assert.ok(run.value, "A native write requires the preceding actual reference result");
    const command = step === 0 ? "" : "[IO.File]::WriteAllText(" + literal(run.file) + "," + literal(JSON.stringify(run.value)) + "); Write-Output 'PROJECT_GUIDANCE_WRITTEN'";
    const args = step === 0 ? { asset_version_id: run.source.asset_version_id }
      : selected.parameters?.properties?.cmd ? { cmd: command, workdir: path.dirname(run.file), yield_time_ms: 1000, max_output_tokens: 1000 }
      : selected.parameters?.properties?.command?.type === "array" ? { command: ["powershell.exe", "-NoProfile", "-Command", command], workdir: path.dirname(run.file), timeout_ms: 10000 }
      : { command, workdir: path.dirname(run.file), timeout_ms: 10000 };
    const call = "call_guidance_" + serial; run.pending = { call, tool: name };
    return { type: "function_call", id: "fc_guidance_" + serial, call_id: call, ...(step === 0 ? { namespace: "copypaste", name } : { name: selected.qualified }), arguments: JSON.stringify(args) };
  }
}

export async function exerciseNativeProjectConfiguration({ page, electron, system, workspace, delivery, attempt, model, list, until, captureSurface, providerCalls, pass, screenshots }: {
  page: Page; electron: ElectronApplication; system: any; workspace: string; delivery: string; attempt: string;
  model: DesktopProjectConfigurationModel; list: () => Promise<any>; until: (read: () => Promise<any>, accept: (value: any) => boolean, label: string, ms?: number) => Promise<any>;
  captureSurface: () => Promise<Buffer>; providerCalls: () => number; pass: (value: string) => void; screenshots: any[];
}) {
  const scope = await page.evaluate(() => ({ tenant: localStorage.getItem("cp_tenant"), project: localStorage.getItem("cp_project") }));
  const base = `/v1/tenants/${scope.tenant}/projects/${scope.project}`, endpoint = base + "/project-configuration";
  const request = async (url: string) => { const response = await projectUIRequest(page, "GET", url); assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body; };
  const original = (await request(endpoint)).published; assert.equal(original.version, 3);
  const source = original.body.resolved.resources.find((item: any) => item.name === "Campaign source 00.txt"); assert.ok(source);
  const actualVersion = (await system.db.control.query("SELECT * FROM asset_versions WHERE id=$1", [source.asset_version_id])).rows[0];
  assert.equal(actualVersion.sha256, source.sha256);
  const goLocal = () => page.evaluate(() => { location.hash = "/app"; });
  const capture = async (name: string) => {
    await assertDesktopLayout(page);
    screenshots.push(await saveWorkmateScreenshot("desktop", "guidance-" + attempt, name, await captureSurface(), "Actual packaged Electron and customer-device Codex, exact shared versions, authorized reference tool, native terminal/file bytes and server settlement. Responses are explicit synthetic fixtures.", delivery));
  };
  const recording = new WorkmateRecording("desktop", "native-project-guidance", "guidance-" + attempt, captureSurface,
    "Actual local Codex reads exact shared bytes and writes real workspace files. Same-thread continuation retains v3 after v4; a new local session adopts v4. Source revocation prevents a new task before inference. Synthetic Responses only.", delivery);
  let media: any;
  const beginSession = async () => {
    const previous = await list();
    await page.getByLabel("Local specialist", { exact: true }).selectOption("designer");
    await page.getByRole("button", { name: "Choose folder to start", exact: true }).click();
    const session = await until(list, value => value && value.id !== previous.id, "new native shared-guidance session");
    assert.equal(session.permission, null, "Publishing shared guidance grants no local permission");
    await electron.evaluate(() => { (globalThis as any).__localDecision = 1; });
    await page.getByLabel("Local permission", { exact: true }).selectOption("full-access");
    await page.getByRole("button", { name: "Set permission", exact: true }).click();
    await until(list, value => value.permission === "full-access", "separate explicit native permission");
    await page.getByLabel("Turn budget HK$", { exact: true }).fill("1");
    return session;
  };
  const run = async (publication: any, label: string, excludedHash?: string) => {
    const file = path.join(workspace, "shared-guidance-" + label + ".json"), previous = await list();
    model.begin(publication, source, file, excludedHash);
    await page.getByLabel("Turn budget HK$", { exact: true }).fill("1");
    await page.getByLabel("Local task", { exact: true }).fill("Read the approved shared campaign text and save its evidence to the selected local folder.");
    await page.getByRole("button", { name: "Start work", exact: true }).click();
    const session = await until(list, value => !value.busy && value.task?.status === "succeeded" && value.task.task_id !== previous.task?.task_id, "actual native shared-guidance completion", 90000);
    const task = (await system.db.control.query("SELECT * FROM tasks WHERE id=$1", [session.task.task_id])).rows[0];
    assert.equal(task.execution_location, "desktop"); assert.equal(task.input_context.project_configuration.version, publication.version);
    assert.equal(task.input_context.project_configuration.sha256, publication.sha256); assert.equal(task.charged_micros, "90");
    const bytes = JSON.parse(await readFile(file, "utf8"));
    assert.equal(bytes.guidance_version, publication.version); assert.equal(bytes.configuration_sha256, publication.sha256);
    assert.equal(bytes.asset_version_id, source.asset_version_id); assert.equal(bytes.sha256, source.sha256);
    assert.equal(bytes.text, (await system.storage.get(actualVersion.storage_key)).toString("utf8"));
    assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM task_source_reads WHERE task_id=$1 AND asset_version_id=$2", [task.id, source.asset_version_id])).rows[0].n, 1);
    await page.locator(`.local-agent-messages [data-project-brief-version="${publication.version}"]`).waitFor();
    return { session, task, file };
  };
  try {
    await goLocal(); await page.getByLabel("Local specialist", { exact: true }).waitFor(); await recording.start();
    await beginSession(); const first = await run(original, "v3-first"); await capture("native-v3-reference-file");
    pass("Actual local Codex receives project v3, reads its exact shared file through the company tool and writes verified bytes locally; separate full permission and 90-micro settlement remain enforced");
    await page.evaluate(() => { location.hash = "/app/projects"; });
    const panel = page.locator(".project-brief-panel"); await panel.getByRole("button", { name: "Edit shared guidance", exact: true }).click();
    const modal = page.getByRole("dialog"); await modal.getByLabel("Shared instructions", { exact: true }).fill("Version four applies to new local work. Preserve approved Hong Kong prices and cite the selected source.");
    await modal.getByRole("button", { name: "Preview publication", exact: true }).click(); await modal.getByRole("heading", { name: "v3 → v4", exact: true }).waitFor();
    await modal.getByRole("button", { name: "Confirm publication · v4", exact: true }).click(); await modal.waitFor({ state: "detached" });
    const next = (await request(endpoint)).published; assert.equal(next.version, 4);
    await goLocal(); const continuation = await run(original, "v3-continuation", next.sha256);
    assert.equal(continuation.task.parent_id, first.task.id); assert.equal(continuation.task.runtime_thread, first.task.runtime_thread);
    assert.equal((await request(base + `/tasks/${first.task.id}/project-configuration`)).published.version, 3);
    await page.locator('.local-agent-messages [data-project-brief-version="3"] > summary').click();
    await page.getByText("The project has a newer publication; this task keeps its original version.", { exact: true }).waitFor(); await capture("native-retained-v3-after-v4");
    pass("Publishing v4 never silently upgrades the existing native thread: its real follow-up retains v3, the original source, thread identity and separate settlement");
    await beginSession(); const fresh = await run(next, "v4-new-session", original.sha256);
    assert.notEqual(fresh.task.runtime_thread, first.task.runtime_thread); assert.equal(fresh.task.parent_id, null); await capture("native-new-session-v4");
    pass("A genuinely new local Codex session adopts shared v4 with a new actual thread while both accepted v3 tasks retain their original publication");
    await system.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1", [actualVersion.asset_id]);
    try {
      const count = (await system.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE project_id=$1", [scope.project])).rows[0].n, calls = providerCalls();
      await page.getByLabel("Local task", { exact: true }).fill("Attempt a new local turn after the shared reference has been quarantined.");
      await page.getByRole("button", { name: "Start work", exact: true }).click();
      await until(list, value => !value.busy && !!value.error, "native shared source revocation fence");
      assert.equal(providerCalls(), calls); assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE project_id=$1", [scope.project])).rows[0].n, count);
      const alert = page.getByRole("alert").filter({ hasText: "Shared project guidance is unavailable." });
      await alert.waitFor(); assert.ok((await alert.innerText()).includes("Open My projects"));
      assert.equal(await page.getByText("PROJECT_CONFIGURATION_UNAVAILABLE", { exact: true }).count(), 0);
      await page.getByTitle("切換至繁體中文", { exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "專案共用指引的資料已不可用。" }).waitFor();
      await page.getByTitle("Switch to English", { exact: true }).click();
      await alert.waitFor(); await capture("native-revoked-source-blocked");
    } finally { await system.db.control.query("UPDATE assets SET state='active' WHERE id=$1", [actualVersion.asset_id]); }
    pass("Quarantining the selected shared source blocks the next local turn before task insertion, reservation or inference and exposes an actual customer error");
    assert.equal(model.observations.length, 6);
    media = await recording.stop();
    return { media, versions: [3, 3, 4], execution_locations: [first.task.execution_location, continuation.task.execution_location, fresh.task.execution_location], task_ids: [first.task.id, continuation.task.id, fresh.task.id], charged_micros: [first.task.charged_micros, continuation.task.charged_micros, fresh.task.charged_micros], actual_tool_outputs: model.observations, current_publication: 4, cloud_replacement_created: false };
  } finally { model.end(); if (!media) await recording.stop(); }
}
