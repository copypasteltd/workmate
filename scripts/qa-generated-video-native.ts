import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { assertDesktopLayout } from "./qa-desktop-layout.js";
import { saveWorkmateScreenshot } from "./record-workmate-media.js";

/** Explicit reasoning fixture: every next action consumes the real native tool result. */
export class GeneratedVideoNativeModel {
  private actions: string[] | null = null;
  private pending: { call: string; tool: string } | null = null;
  job = "";
  observations: { tool: string; actual_output: boolean }[] = [];
  begin() { assert.equal(this.actions, null); this.actions = ["generated_video_create", "generated_video_status"]; this.job = ""; }
  next(body: any, serial: number) {
    if (!this.actions) return null;
    if (this.pending) {
      const result = body.input.find((entry: any) => entry.type === "function_call_output" && entry.call_id === this.pending!.call);
      assert.ok(result, "Actual generated-video tool output must reach the native reasoning turn");
      const value = JSON.parse(typeof result.output === "string" ? result.output : result.output[0].text);
      assert.equal(value.state, "completed"); assert.equal(value.delivery_state, "available"); assert.equal(value.actual_micros, "400000");
      assert.equal(value.assets.length, 1); assert.equal(value.probe.fully_decoded, true);
      if (this.job) assert.equal(value.id, this.job); this.job = value.id;
      this.observations.push({ tool: this.pending.tool, actual_output: true }); this.pending = null;
    }
    const name = this.actions.shift();
    if (!name) { this.actions = null; return { type: "message", id: "msg_generated_native_ui_" + serial, role: "assistant", status: "completed",
      content: [{ type: "output_text", text: "Your synthetic four-second clip is ready. Review and save the actual video below.", annotations: [] }] }; }
    assert.ok(body.tools.some((group: any) => group.name === "copypaste" && group.tools?.some((tool: any) => tool.name === name)));
    const call = "call_generated_native_ui_" + serial; this.pending = { call, tool: name };
    return { type: "function_call", id: "fc_generated_native_ui_" + serial, call_id: call, namespace: "copypaste", name,
      arguments: JSON.stringify(name === "generated_video_create" ? { prompt: "Explicit synthetic company four-second clip", size: "1280x720", seconds: 4 } : { job_id: this.job }) };
  }
}

export async function runGeneratedVideoNativeJourney(j: any) {
  const { page, system, model, provider, list, until, resize } = j;
  const screenshot = async (name: string) => j.screenshots.push(await saveWorkmateScreenshot("desktop", "local-" + j.attempt, name,
    await j.captureSurface(), "Actual frameless packaged Electron and native Codex generated-video tools; real shared budget, reported progress, decoded MP4, local save and immutable ledger. Reasoning/video content and native dialogs are explicit fixtures.", j.delivery));
  const prior = await list(); await page.getByLabel("Local specialist", { exact: true }).selectOption("video-motion");
  await page.getByRole("button", { name: "Choose folder to start", exact: true }).click();
  await until(list, (state: any) => state.id !== prior.id, "independent generated-video native session");
  await page.getByLabel("Local permission", { exact: true }).selectOption("full-access"); await page.getByRole("button", { name: "Set permission", exact: true }).click();
  const settings = page.locator(".video-brief-options");
  assert.equal(await settings.getAttribute("open"), null, "Video settings start compact");
  await settings.locator("summary").click(); await settings.locator('[name="video_mode"]').selectOption("generated");
  for (const [width, height] of [[1440, 980], [1280, 800], [800, 600]]) {
    await resize(width, height, "actual generated video form " + width); await assertDesktopLayout(page);
    assert.ok(await page.locator(".local-agent-messages").evaluate((element: HTMLElement) => element.clientHeight >= 64));
    await settings.locator('[name="video_seconds"]').selectOption("4"); await settings.locator('[name="video_size"]').selectOption("1280x720");
    await screenshot("generated-form-" + width + "-en");
  }
  await page.getByTitle("切換至繁體中文", { exact: true }).click(); await page.getByTitle("Theme: light / dark / system", { exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark"); await assertDesktopLayout(page); await screenshot("generated-form-800-zh-dark");
  await page.getByTitle("Switch to English", { exact: true }).click();
  for (let step = 0; step < 3 && await page.evaluate(() => document.documentElement.dataset.theme) !== "light"; step++) await page.getByTitle("Theme: light / dark / system", { exact: true }).click();
  await settings.locator("summary").click(); await resize(1440, 980, "restore generated video workspace");
  j.pass("Generated-video settings fit actual 1440x980, 1280x800 and 800x600 Desktop windows and Traditional Chinese dark mode, without scrollbar rails or horizontal overflow; conversation and composer remain usable");
  provider.state.initial = "queued"; provider.state.initialUsage = null; model.begin();
  const previous = await list(), calls = j.providerCalls();
  await page.getByLabel("Local task", { exact: true }).fill("Create an explicit synthetic four-second landscape clip through the company generation service, then query its original job.");
  await page.getByRole("button", { name: "Start work", exact: true }).click();
  const row = await until(async () => (await system.db.control.query("SELECT * FROM ai_video_jobs ORDER BY created_at DESC LIMIT 1")).rows[0], (job: any) => job?.provider_id && job.state === "queued", "actual queued company video job");
  provider.update(row.operation_id, { status: "in_progress", progress: 35 });
  await until(async () => (await system.db.control.query("SELECT progress FROM ai_video_jobs WHERE id=$1", [row.id])).rows[0].progress, (value: number) => value === 35, "actual service-reported progress");
  const card = page.locator(`[data-generated-video-job="${row.id}"]`); await card.waitFor();
  await page.getByRole("button", { name: "Refresh generated videos", exact: true }).click();
  await until(() => card.locator("progress").getAttribute("value"), (value: string) => value === "35", "visible service-reported progress");
  await card.scrollIntoViewIfNeeded(); assert.equal(await card.getByRole("button", { name: "Download video", exact: true }).count(), 0); await screenshot("generated-progress-en");
  provider.complete(row.operation_id);
  const completed = await until(list, (state: any) => state.task?.task_id !== previous.task?.task_id && !state.busy && state.task?.status === "succeeded", "native generated video settlement", 90000);
  const task = (await system.db.control.query("SELECT * FROM tasks WHERE id=$1", [completed.task.task_id])).rows[0];
  assert.equal(task.execution_location, "desktop"); assert.equal(task.charged_micros, String(400000 + (j.providerCalls() - calls) * 30));
  assert.equal(provider.calls.filter((call: any) => call.path === "/v1/videos" && call.method === "POST").length, 1);
  await page.getByRole("button", { name: "Refresh generated videos", exact: true }).click();
  await card.getByRole("button", { name: "Play video", exact: true }).click(); const video = card.locator("video"); await video.waitFor();
  await until(() => video.evaluate((element: HTMLVideoElement) => element.readyState), (value: number) => value >= 2, "actual generated MP4 browser decode");
  await video.evaluate((element: HTMLVideoElement) => element.play());
  await until(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), (value: number) => value > 0, "actual generated video playback"); await video.evaluate((element: HTMLVideoElement) => element.pause());
  await card.getByRole("button", { name: "Download video", exact: true }).click();
  await until(() => readFile(path.join(j.owned, "native-generated-video.mp4")).catch(() => null), (bytes: Buffer | null) => !!bytes && createHash("sha256").update(bytes).digest("hex") === provider.sha256, "actual native generated video save");
  await resize(800, 600, "actual compact generated video playback"); await video.scrollIntoViewIfNeeded(); await assertDesktopLayout(page);
  assert.equal(await video.evaluate((element: HTMLVideoElement) => { const bounds = element.getBoundingClientRect(), parent = element.closest(".local-agent-messages")!.getBoundingClientRect(); return bounds.height >= 100 && bounds.top >= parent.top - 1 && bounds.bottom <= parent.bottom + 1; }), true);
  await screenshot("generated-playback-800-en");
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'", [task.id])).rows[0].n, 1);
  await j.reload(); await page.getByRole("heading", { name: "Your local workmate", exact: true }).waitFor();
  await page.locator(`[data-generated-video-job="${row.id}"]`).waitFor();
  assert.ok((await list()).events.some((event: any) => event.value.generated_video?.job_id === row.id));
  j.pass("Actual local Codex generates and queries one original video operation, shows real 35% progress and unknown-cost hold, decodes and saves the exact MP4 at 800x600, retains job history after reload and settles once");
  await resize(1440, 980, "restore native workspace after generated video");
  const last = await list(); await page.getByLabel("Local specialist", { exact: true }).selectOption("designer");
  await page.getByRole("button", { name: "Choose folder to start", exact: true }).click(); await until(list, (state: any) => state.id !== last.id, "restore designer after generated video");
  await page.getByLabel("Local permission", { exact: true }).selectOption("full-access"); await page.getByRole("button", { name: "Set permission", exact: true }).click();
}
