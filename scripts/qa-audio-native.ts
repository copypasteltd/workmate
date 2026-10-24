import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";
import { assertDesktopLayout } from "./qa-desktop-layout.js";

export class NativeAudioModel {
  private actions: any[] | null = null;
  private pending = "";
  results: any[] = [];
  begin(asset: any) {
    assert.equal(this.actions, null); this.results = [];
    const rights = { authorized: true, reference: "Customer-owned synthetic source and script; verified fixture voice", purpose: "Explicit synthetic native audio UI verification" };
    this.actions = [{ kind: "speech", text: "Hello Hong Kong. 你好，香港。", locale: "en", voice: "alloy", speed: 1, rights },
      { kind: "transcription", source: { asset_id: asset.id, version: asset.version.version }, locale: "zh-HK", timestamps: true, rights }];
  }
  next(body: any, serial: number) {
    if (!this.actions) return null;
    if (this.pending) {
      const result = body.input.find((entry: any) => entry.type === "function_call_output" && entry.call_id === this.pending);
      assert.ok(result, "The actual local Codex must receive the audio tool result");
      const value = JSON.parse(typeof result.output === "string" ? result.output : result.output[0].text);
      assert.equal(value.state, "completed"); assert.equal(value.delivery_state, "available"); assert.ok(value.assets.length);
      this.results.push({ tool: "audio_produce", actual_output: true, id: value.id, task_id: value.task_id, kind: value.kind }); this.pending = "";
    }
    const input = this.actions.shift();
    if (!input) { this.actions = null; return { type: "message", id: "msg_audio_ui_" + serial, role: "assistant", status: "completed",
      content: [{ type: "output_text", text: "The synthetic audio and retained transcript are ready. Review actual speech and subtitles below.", annotations: [] }] }; }
    assert.ok(body.tools.some((group: any) => group.name === "copypaste" && group.tools?.some((tool: any) => tool.name === "audio_produce")));
    this.pending = "call_audio_ui_" + serial;
    return { type: "function_call", id: "fc_audio_ui_" + serial, call_id: this.pending, namespace: "copypaste", name: "audio_produce", arguments: JSON.stringify(input) };
  }
}

export async function runNativeAudioJourney(j: any) {
  const { page, system, model, until, list, provider, resize } = j;
  const current = await page.evaluate(async () => (await (window as any).copyPasteBridge.request("/v1/session/context", {})).body);
  const { saveAsset } = await import(pathToFileURL(path.join(j.platform, "src/storage.ts")).href);
  const source = await system.db.tx((tx: any) => saveAsset(tx, system.storage, { tenant: j.tenant, project: j.project, user: current.user.id,
    name: "explicit-synthetic-tone.wav", kind: "fixture_source", mime: "audio/wav", bytes: provider.bytes }), j.tenant, false, current.user.id);
  const prior = await list(); await page.getByLabel("Local specialist", { exact: true }).selectOption("video-motion");
  await page.getByRole("button", { name: "Choose folder to start", exact: true }).click();
  await until(list, (s: any) => s.id !== prior.id, "independent local audio session");
  await page.getByLabel("Local permission", { exact: true }).selectOption("full-access"); await page.getByRole("button", { name: "Set permission", exact: true }).click();
  model.begin(source);
  const recording = new WorkmateRecording("desktop", "audio-production", "local-" + j.attempt, j.captureSurface,
    "Actual packaged frameless Desktop, local pinned Codex audio tools, decoded synthetic tone, transcript revision and save dialog. Voice/ASR content and native dialogs are explicit fixtures.", j.delivery);
  await recording.start();
  try {
    await page.getByLabel("Local task", { exact: true }).fill("Create the explicitly customer-approved synthetic speech and transcribe the owned synthetic source. Source/script rights are confirmed for this test; preserve the original audio and exact subtitle timing.");
    await page.getByRole("button", { name: "Start work", exact: true }).click();
    const state = await until(list, (s: any) => !s.busy && s.task?.status === "succeeded" && model.results.length === 2, "actual native TTS and transcription");
    assert.equal((await system.db.control.query("SELECT execution_location FROM tasks WHERE id=$1", [state.task.task_id])).rows[0].execution_location, "desktop");
    const speech = model.results.find((r: any) => r.kind === "speech"), transcript = model.results.find((r: any) => r.kind === "transcription");
    const speechCard = page.locator(`[data-audio-job="${speech.id}"]`), textCard = page.locator(`[data-audio-job="${transcript.id}"]`);
    await speechCard.getByRole("button", { name: "Review audio and subtitles", exact: true }).click();
    await speechCard.locator("audio").waitFor();
    await until(() => speechCard.locator("audio").evaluate((el: HTMLAudioElement) => el.readyState), (ready: number) => ready >= 1, "decoded actual native WAV preview");
    await speechCard.getByRole("button", { name: "AI speech WAV", exact: true }).click();
    const output = await until(() => readFile(j.downloaded).catch(() => null), (bytes: Buffer | null) => !!bytes && createHash("sha256").update(bytes).digest("hex") === createHash("sha256").update(provider.bytes).digest("hex"), "exact native WAV save");
    assert.deepEqual(output, provider.bytes);
    j.pass("Local pinned Codex creates actual synthetic WAV and transcription through company audio tools; native preview decodes and the save dialog writes exact source-bound WAV bytes without a cloud Agent");
    await textCard.getByRole("button", { name: "Review audio and subtitles", exact: true }).click();
    await textCard.getByRole("button", { name: "Revise subtitles", exact: true }).click();
    const editor = textCard.locator("form"), count = provider.calls.length;
    await editor.getByRole("textbox", { name: "Text", exact: true }).first().fill("Customer corrected caption.");
    await editor.getByLabel("Revision reason", { exact: true }).fill("Customer revised the first caption for the campaign");
    for (const [width, height] of [[1440, 980], [1280, 800], [800, 600]]) {
      await resize(width, height, "native audio editor " + width); await assertDesktopLayout(page);
      await editor.getByRole("button", { name: "Save new version", exact: true }).focus();
      await until(() => editor.getByRole("button", { name: "Save new version", exact: true }).evaluate((el: HTMLElement) => {
        const b = el.getBoundingClientRect(), p = el.closest(".local-agent-messages")!.getBoundingClientRect(); return b.left >= p.left && b.right <= p.right + 1 && b.top >= p.top && b.bottom <= p.bottom + 1;
      }), Boolean, "focused native subtitle save remains visible after resize to " + width);
      j.screenshots.push(await saveWorkmateScreenshot("desktop", "local-" + j.attempt, "audio-editor-" + width, await j.captureSurface(),
        "Actual packaged local Desktop transcript editor in a real OS window; no visible rails or horizontal overflow; final save button remains focus reachable. Synthetic audio/ASR only.", j.delivery));
    }
    await editor.getByRole("button", { name: "Save new version", exact: true }).click();
    await until(async () => (await system.db.control.query("SELECT subtitle_revision FROM ai_audio_jobs WHERE id=$1", [transcript.id])).rows[0].subtitle_revision, (v: number) => v === 2, "real subtitle revision");
    assert.equal(provider.calls.length, count);
    j.pass("Native subtitle editing retains original version, saves version two without any AI request, and keeps the final save and composer reachable at 1440x980, 1280x800 and 800x600 without scrollbar rails or horizontal overflow");
    await j.reload(); await page.getByLabel("Local specialist", { exact: true }).waitFor();
    await page.locator(`[data-audio-job="${transcript.id}"]`).waitFor();
    await page.getByTitle("切換至繁體中文", { exact: true }).click();
    for (let i = 0; i < 3 && await page.evaluate(() => document.documentElement.dataset.theme) !== "dark"; i++)
      await page.getByTitle("Theme: light / dark / system", { exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
    const localized = page.locator(`[data-audio-job="${transcript.id}"]`); await localized.getByRole("button", { name: "查看音訊與字幕", exact: true }).click();
    await localized.getByText("時間由客戶手動修訂。", { exact: true }).scrollIntoViewIfNeeded();
    await assertDesktopLayout(page);
    j.screenshots.push(await saveWorkmateScreenshot("desktop", "local-" + j.attempt, "audio-zh-dark", await j.captureSurface(), "Actual Traditional Chinese dark native audio history after renderer reload; retained subtitle version two, company cost and local Codex execution.", j.delivery));
    await page.getByTitle("Switch to English", { exact: true }).click();
    for (let i = 0; i < 3 && await page.evaluate(() => document.documentElement.dataset.theme) !== "light"; i++) await page.getByTitle("Theme: light / dark / system", { exact: true }).click();
    await resize(1440, 980, "restore native workspace after audio");
    j.pass("Actual native audio tool history and subtitle revision survive renderer reload, with Traditional Chinese dark layout and original company cost preserved");
    return await recording.stop();
  } catch (error) { await recording.stop().catch(() => {}); throw error; }
}
