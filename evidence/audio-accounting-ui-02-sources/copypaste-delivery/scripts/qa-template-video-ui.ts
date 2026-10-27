import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserServer,
  type Page,
} from "playwright";
import assert from "node:assert/strict";
import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform"),
  web = "http://localhost:4317",
  attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const requirePlatform = createRequire(path.join(platform, "package.json")),
  { Ajv2020 } = requirePlatform("ajv/dist/2020.js"),
  ajv = new Ajv2020({ allErrors: true });
requirePlatform("ajv-formats")(ajv);
const contractBytes = await readFile(
    path.resolve("../../docs/contracts/template-video-openapi.json"),
  ),
  contract = JSON.parse(contractBytes.toString()),
  defs = contract.components.schemas;
const validators = Object.fromEntries(
  Object.keys(defs).map((name) => [
    name,
    ajv.compile({ $defs: defs, $ref: "#/$defs/" + name }),
  ]),
);
const checks: any[] = [],
  errors: string[] = [],
  samples: any[] = [],
  screenshots: any[] = [],
  owned = path.resolve(".data/template-video-ui", randomUUID());
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex"),
  pass = (name: string) => {
    checks.push({ name, status: "passed" });
    console.log("PASS: " + name);
  };
let isolated: any,
  system: any,
  server: BrowserServer | undefined,
  browser: Browser | undefined,
  context: BrowserContext | undefined,
  stage = "initializing",
  browserClosed = false,
  appClosed = false,
  databaseClosed = false;
let advance: any, saveAsset: any, browserRuntime: any;
function sample(name: string, value: any, route: string) {
  assert.ok(validators[name](value), JSON.stringify(validators[name].errors));
  samples.push({ schema: name, route, response: value });
  return value;
}
async function call(
  c: { cookie: string; csrf: string },
  method: string,
  url: string,
  body?: unknown,
) {
  const raw = await system.app.inject({
    method,
    url,
    headers: {
      origin: web,
      cookie: c.cookie,
      "x-csrf-token": c.csrf,
      "idempotency-key": randomUUID(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  assert.equal(raw.statusCode, 200, method + " " + url + " " + raw.body);
  return raw.json();
}
async function operation(
  page: Page,
  method: string,
  url: string,
  action: () => Promise<unknown>,
  schema: string,
) {
  const [r] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === method && new URL(r.url()).pathname === url,
    ),
    action(),
  ]);
  assert.equal(r.status(), 200, await r.text());
  return sample(schema, await r.json(), method + " " + url);
}
async function screenshot(page: Page, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const file = path.resolve(
    "../copypaste-web/assets/screenshots",
    `template-video-${attempt}-${name}.png`,
  );
  await mkdir(path.dirname(file), { recursive: true });
  await assert.rejects(access(file), (e: any) => e.code === "ENOENT");
  await page.screenshot({
    path: file,
    fullPage: false,
    animations: "disabled",
  });
  screenshots.push({
    path: path.relative(path.resolve(".."), file).replaceAll("\\", "/"),
    sha256: sha(await readFile(file)),
  });
}
async function fit(page: Page) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Page fits viewport",
  );
  const dialog = page.getByRole("dialog");
  if (await dialog.count())
    assert.ok(
      await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      "Dialog fits viewport",
    );
}
async function finish() {
  for (let i = 0; i < 25; i++) { if (!(await advance(system.db, system.storage))) return; }
  throw new Error("Video queue did not finish within its bound");
}
const deadline = setTimeout(() => {
  errors.push("UI deadline at " + stage);
  void server?.kill();
}, 480000);
try {
  const load = async (file: string) =>
      import(pathToFileURL(path.join(platform, file)).href),
    { isolatedTestEnvironment } = await load(
      "tests/native-test-environment.ts",
    ),
    { buildApp } = await load("src/server.ts"),
    { loadConfig } = await load("src/config.ts");
  ({ advanceVideoProjects: advance } = await load(
    "src/video-projects.ts",
  ));
  ({ saveAsset } = await load("src/storage.ts"));
  process.chdir(platform);
  isolated = await isolatedTestEnvironment();
  system = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEV_MAILBOX: "true",
      DEMO_MODE: "true",
      WORKER_ENABLED: "false",
    }),
    { worker: false },
  );
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  await mkdir(owned, { recursive: true });
  const executable =
    process.env.CHROME_BIN ??
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  server = await chromium.launchServer({
    headless: true,
    executablePath: executable,
    args: ["--disable-gpu"],
    timeout: 15000,
  });
  browser = await chromium.connect(server.wsEndpoint());
  browserRuntime = {
    executable,
    sha256: sha(await readFile(executable)),
    version: browser.version(),
  };
  context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    acceptDownloads: true,
  });
  context.setDefaultTimeout(15000);
  await context.addInitScript(() => {
    if (!localStorage.getItem("cp_locale"))
      localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme"))
      localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  stage = "real customer email login and onboarding";
  await page.goto(web + "/login");
  await page
    .getByLabel("Work email")
    .fill(`video-ui-${randomUUID()}@example.invalid`);
  const [challengeResponse] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/v1/auth/challenges" &&
        r.request().method() === "POST",
    ),
    page
      .getByRole("button", { name: "Send sign-in code", exact: true })
      .click(),
  ]);
  assert.equal(challengeResponse.status(), 202);
  const challenge = await challengeResponse.json();
  const mail = JSON.parse(
    await readFile(
      path.join(
        isolated.directory,
        "mailbox",
        challenge.challenge_id + ".json",
      ),
      "utf8",
    ),
  );
  await page
    .locator('input[name="code"]')
    .fill(mail.text.match(/\b\d{6}\b/)[0]);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour video studio");
  await page.locator('input[name="project_name"]').fill("Campaign video");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/app");
  const cookie = (await context.cookies()).find(
    (c) => c.name === "cp_session",
  )!;
  const me = await page.evaluate(
      async () => await (await fetch("/v1/session/context")).json(),
    ),
    client = { cookie: "cp_session=" + cookie.value, csrf: me.csrf_token },
    tenant = me.memberships[0].id,
    project = (await call(client, "GET", `/v1/tenants/${tenant}/projects`))
      .items[0].id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  pass("actual email sign-in, user session and enterprise/project onboarding");
  const { createCanvas } = requirePlatform("@napi-rs/canvas"),
    canvas = createCanvas(400, 280),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e8f0ff";
  ctx.fillRect(0, 0, 400, 280);
  ctx.fillStyle = "#1f5eff";
  ctx.fillRect(128, 45, 144, 190);
  ctx.fillStyle = "#fff";
  ctx.font = "26px Arial";
  ctx.fillText("IDEA", 164, 154);
  const image = await system.db.tx(
    (tx: any) =>
      saveAsset(tx, system.storage, {
        tenant,
        project,
        user: me.user.id,
        name: "Campaign source.png",
        mime: "image/png",
        bytes: canvas.toBuffer("image/png"),
        metadata: { fixture: "local_composition_source" },
      }),
    tenant,
    true,
    me.user.id,
  );

  stage = "provided original audio fixture";
  const rate = 48000, frames = rate * 16, wave = Buffer.alloc(44 + frames * 2);
  wave.write("RIFF", 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8); wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(rate, 24); wave.writeUInt32LE(rate * 2, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write("data", 36); wave.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) wave.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / rate) * 7000 * Math.min(1, i / 4800, (frames - i) / 4800)), 44 + i * 2);
  const audio = await system.db.tx((tx: any) => saveAsset(tx, system.storage, { tenant, project, user: me.user.id, name: "Original acceptance tone.wav", mime: "audio/wav", bytes: wave, metadata: { fixture: "original_non_silent_test_tone", rights: "owned" } }), tenant, true, me.user.id);
  await page.goto(web + "/app/creative");
  const section = page.getByRole("region", { name: "Video production", exact: true });
  await section.getByRole("button", { name: "New video project", exact: true }).click();
  let modal = page.getByRole("dialog", { name: "New video project", exact: true });
  await modal.getByLabel("Project name", { exact: true }).fill("Harbour studio video");
  await modal.getByLabel("Script title", { exact: true }).fill("A little room for your next idea");
  await modal.getByLabel("Creative brief", { exact: true }).fill("Original supplied product image, three scenes, captions and an owned soundtrack.");
  await modal.getByLabel("Provided narration text", { exact: true }).fill("The provided script remains editable. This is not synthesized speech.");
  await modal.getByLabel("Fixed brand logo PNG", { exact: true }).selectOption(image.id + ":1");
  const headlines = ["Room for a new idea", "Made for your next move", "Let's make it happen"];
  for (let i = 0; i < 3; i++) {
    const area = modal.getByRole("group", { name: "Scene " + (i + 1), exact: true });
    await area.getByLabel("Scene headline", { exact: true }).fill(headlines[i]);
    await area.getByLabel("Scene body", { exact: true }).fill(["A Hong Kong team. A new direction.", "Supplied assets, fixed in time.", "Your next campaign starts here."][i]);
    await area.getByLabel("Scene direction", { exact: true }).fill(["Open with the brand", "Show the supplied product", "Close with the call to action"][i]);
    await area.getByLabel("Fixed scene PNG", { exact: true }).selectOption(image.id + ":1");
    await modal.getByRole("button", { name: "Add caption", exact: true }).click();
    const caption = modal.getByRole("group", { name: "Caption " + (i + 1), exact: true });
    await caption.getByLabel("End frame", { exact: true }).fill(String((i + 1) * 150));
    await caption.getByLabel("Caption text", { exact: true }).fill(["從想法，到第一步。", "每一個畫面，都有根據。", "一起完成下一個創意。 "][i]);
  }
  await modal.getByLabel("Fixed audio WAV / MP3", { exact: true }).selectOption(audio.id + ":1");
  await modal.getByLabel("Audio in point (frames)", { exact: true }).fill("15");
  await modal.getByLabel("License reference or ownership statement", { exact: true }).fill("Owned: deterministic tone authored by this local acceptance fixture.");
  const save = modal.getByRole("button", { name: "Save video project", exact: true });
  const firstScene = modal.getByRole("group", { name: "Scene 1", exact: true });
  await firstScene.getByLabel("End frame", { exact: true }).fill("151"); assert.equal(await save.isDisabled(), true);
  await firstScene.getByLabel("End frame", { exact: true }).fill("150"); assert.equal(await save.isEnabled(), true);
  pass("client timeline validation blocks a one-frame gap and enables saving only after continuous coverage is restored");
  await modal.evaluate((e) => { e.scrollTop = 0; }); await fit(page); await screenshot(page, "create-en");
  const created = await operation(page, "POST", base + "/video-projects", () => save.click(), "VideoCreated");
  const videoUrl = `${base}/video-projects/${created.id}`;
  await modal.waitFor({ state: "detached" });
  await section.getByRole("heading", { name: "Harbour studio video", exact: true }).waitFor();
  let projectState = sample("VideoDetail", await call(client, "GET", videoUrl), "GET current video");
  assert.equal(projectState.definition.storyboard.length, 3); assert.equal(projectState.definition.subtitles.length, 3); assert.equal(projectState.definition.audio.source.version, 1);
  pass("actual video editor saves separate script, three contiguous scenes, captions, fixed PNG/audio versions and rights; invalid frame gaps disable saving");
  stage = "actual native portrait rendering";
  const queued = await operation(page, "POST", videoUrl + "/renders", () => section.getByRole("button", { name: "Render video", exact: true }).click(), "VideoQueued");
  await finish();
  await page.waitForFunction((id) => !!document.querySelector(`[data-render-id="${id}"]`)?.textContent?.includes("MP4"), queued.id);
  projectState = sample("VideoDetail", await call(client, "GET", videoUrl), "GET completed video");
  const original = projectState.renders[0];
  assert.equal(original.state, "succeeded"); assert.equal(original.probe.duration_frames, 450); assert.equal(original.probe.duration_seconds, 15); assert.equal(original.probe.audio.silent, false); assert.equal(original.probe.audio.generated, false); assert.equal(original.probe.fully_decoded, true);
  await section.getByRole("button", { name: "Play video", exact: true }).click();
  const player = section.getByLabel("Rendered video preview", { exact: true }); await player.waitFor();
  await player.evaluate(async (v: HTMLVideoElement) => { if (v.readyState < 2) await new Promise<void>((r, reject) => { v.addEventListener("loadeddata", () => r(), { once: true }); v.addEventListener("error", () => reject(new Error("Actual player decode failed")), { once: true }); }); await v.play(); });
  await page.waitForFunction(() => (document.querySelector("video")?.currentTime ?? 0) > .2);
  const playback = await player.evaluate((v: HTMLVideoElement) => ({ width: v.videoWidth, height: v.videoHeight, duration: v.duration, time: v.currentTime, paused: v.paused }));
  assert.equal(playback.width, 720); assert.equal(playback.height, 1280); assert.ok(Math.abs(playback.duration - 15) < .1); assert.equal(playback.paused, false);
  await player.evaluate((v: HTMLVideoElement) => v.pause()); await player.scrollIntoViewIfNeeded(); await screenshot(page, "player-en");
  pass("actual 15 second 9:16 H264/AAC file has 450 decoded frames, burned Chinese captions, measured non-silent owned soundtrack and real Chrome playback");
  stage = "six actual downloads";
  const fixtureDirectory = path.resolve(delivery, "assets/fixtures", `template-video-${attempt}`); await mkdir(fixtureDirectory, { recursive: true });
  const deliveries: any[] = [];
  for (const [label, file] of [["MP4", "creative.mp4"], ["Project JSON", "project.json"], ["Script", "script.md"], ["Storyboard", "storyboard.json"], ["WebVTT", "subtitles.vtt"], ["Media probe", "probe.json"]]) {
    const [download] = await Promise.all([page.waitForEvent("download"), section.locator(`[data-render-id="${original.id}"]`).getByRole("button", { name: label, exact: true }).click()]);
    const target = path.join(fixtureDirectory, file); await assert.rejects(access(target), (e: any) => e.code === "ENOENT"); await download.saveAs(target);
    const bytes = await readFile(target); deliveries.push({ file, path: path.relative(delivery, target).replaceAll("\\", "/"), sha256: sha(bytes), bytes: bytes.length });
  }
  const exported = JSON.parse(await readFile(path.join(fixtureDirectory, "project.json"), "utf8")); assert.equal(exported.definition.duration_frames, 450); assert.equal(exported.sources.length, 2); assert.ok(exported.reproduction.includes("not embedded"));
  assert.equal(original.probe.sha256, deliveries.find((f) => f.file === "creative.mp4").sha256);
  await writeFile(path.join(fixtureDirectory, "manifest.json"), JSON.stringify({ scope: "Actual browser downloads of original local TC018 fixture; supplied tone is owned and is not synthesized narration", playback, deliveries }, null, 2) + "\n", { flag: "wx" });
  pass("all six real browser downloads preserve frozen sources, font/encoder hashes, separate script/storyboard/VTT/probe and actual MP4 bytes");
  stage = "edit and isolated failed render";
  await section.getByRole("button", { name: "Edit project", exact: true }).click(); modal = page.getByRole("dialog", { name: "Edit video project", exact: true });
  await modal.getByRole("group", { name: "Scene 2", exact: true }).getByLabel("Scene headline", { exact: true }).fill("A new direction, version two");
  await operation(page, "POST", videoUrl + "/edit", () => modal.getByRole("button", { name: "Save video project", exact: true }).click(), "VideoCreated");
  await modal.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.querySelector(".video-summary")?.textContent?.includes("v2"));
  await operation(page, "POST", videoUrl + "/renders", () => section.getByRole("button", { name: "Render video", exact: true }).click(), "VideoQueued");
  const realGet = system.storage.get.bind(system.storage), audioKey = (await system.db.control.query("SELECT storage_key FROM asset_versions WHERE asset_id=$1 AND version=1", [audio.id])).rows[0].storage_key;
  system.storage.get = async (key: string) => key === audioKey ? Buffer.from("Injected unavailable fixed source") : realGet(key);
  try { await finish(); } finally { system.storage.get = realGet; }
  await section.getByText("VIDEO_SOURCE_INTEGRITY", { exact: true }).waitFor();
  projectState = await call(client, "GET", videoUrl); assert.equal(projectState.renders[0].state, "failed"); assert.equal(projectState.renders[1].id, original.id); assert.equal(projectState.renders[1].probe.sha256, original.probe.sha256);
  await operation(page, "POST", videoUrl + "/renders", () => section.getByRole("button", { name: "Render video", exact: true }).click(), "VideoQueued"); await finish();
  await page.waitForFunction(() => document.querySelectorAll(".video-render .video-actions").length === 2);
  projectState = await call(client, "GET", videoUrl); assert.equal(projectState.renders.length, 3); assert.equal(projectState.renders[0].version, 2); assert.equal(projectState.renders[0].state, "succeeded"); assert.equal(projectState.renders[1].state, "failed"); assert.equal(projectState.renders[2].probe.sha256, original.probe.sha256);
  pass("actual version edit, source-integrity failure and explicit retry keep all history and leave the earlier delivered MP4 unchanged");
  await section.scrollIntoViewIfNeeded(); await screenshot(page, "workspace-en");
  stage = "actual cancellation";
  const toCancel = await operation(page, "POST", videoUrl + "/renders", () => section.getByRole("button", { name: "Render video", exact: true }).click(), "VideoQueued");
  await operation(page, "POST", `${videoUrl}/renders/${toCancel.id}/cancel`, () => section.getByRole("button", { name: "Cancel render", exact: true }).click(), "VideoCancelled"); assert.equal(await advance(system.db, system.storage), null);
  pass("actual cancel action stops the durable queued render without publishing or silently retrying");
  stage = "concurrent revision conflict";
  await section.getByRole("button", { name: "Edit project", exact: true }).click(); modal = page.getByRole("dialog", { name: "Edit video project", exact: true });
  projectState = await call(client, "GET", videoUrl);
  await call(client, "POST", videoUrl + "/edit", { name: projectState.name, expected_version: projectState.version, definition: { ...projectState.definition, script: { ...projectState.definition.script, brief: "A concurrently saved brief" } } });
  await modal.getByText("A newer project version is available. Close and reopen before saving.", { exact: true }).waitFor(); assert.equal(await modal.getByRole("button", { name: "Save video project", exact: true }).isDisabled(), true); await page.keyboard.press("Escape");
  pass("concurrent project updates preserve the user's open draft and disable stale saves");
  stage = "quarantined source restrictions";
  await system.db.control.query("UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1", [image.id]);
  await page.waitForFunction(() => document.querySelectorAll(".video-render .video-actions").length === 0); assert.equal(await section.locator("video").count(), 0);
  const denied = await system.app.inject({ url: `${videoUrl}/renders/${original.id}/preview`, headers: { cookie: client.cookie } }); assert.equal(denied.statusCode, 404);
  await system.db.control.query("UPDATE assets SET state='active',moderation_version=moderation_version+1 WHERE id=$1", [image.id]);
  await page.waitForFunction(() => document.querySelectorAll(".video-render .video-actions").length === 2);
  pass("source quarantine removes current playback/download actions and denies the protected preview; restoring the source preserves original immutable files");
  stage = "bilingual narrow and dark video editor";
  await page.evaluate(() => { localStorage.setItem("cp_locale", "zh-HK"); localStorage.setItem("cp_theme", "dark"); }); await page.reload();
  const zh = page.getByRole("region", { name: "影片製作", exact: true }); await zh.getByLabel("選擇影片工程", { exact: true }).selectOption(created.id); await zh.getByRole("button", { name: "編輯工程", exact: true }).waitFor();
  await zh.scrollIntoViewIfNeeded(); await fit(page); await screenshot(page, "workspace-zh-dark");
  await page.setViewportSize({ width: 390, height: 844 }); await fit(page); await screenshot(page, "workspace-zh-narrow");
  await zh.getByRole("button", { name: "編輯工程", exact: true }).click(); modal = page.getByRole("dialog", { name: "編輯影片工程", exact: true }); await fit(page); await screenshot(page, "editor-zh-narrow"); await page.keyboard.press("Escape"); assert.equal(await page.getByRole("dialog").count(), 0);
  sample("VideoList", await call(client, "GET", base + "/video-projects"), "GET current project list");
  pass("Traditional Chinese dark and 390-pixel video workspace/editor fit the viewport and close with Escape");
  assert.equal(errors.length, 0, errors.join("\n"));
} catch (e) {
  errors.push(stage + ": " + (e as Error).message);
} finally {
  clearTimeout(deadline);
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (server) {
    await server.close().catch(async () => server!.kill());
    browserClosed =
      server.process().exitCode !== null ||
      server.process().signalCode !== null;
  }
  if (system)
    try {
      await system.app.close();
      appClosed = true;
    } catch {
      errors.push("Owned API close failed");
    }
  if (isolated)
    try {
      process.chdir(platform);
      await isolated.cleanup();
      databaseClosed = true;
    } catch {
      errors.push("Owned fixture cleanup failed");
    }
  const passed =
    errors.length === 0 && browserClosed && appClosed && databaseClosed;
  await writeFile(
    path.join(delivery, `evidence/template-video-ui-${attempt}-journey.json`),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: passed ? "passed" : "failed",
        scope:
          "Built Web and actual API/native PostgreSQL; native FFmpeg composition with supplied original fixture media only, no AI or live-provider qualification",
        checks,
        errors,
        samples,
        screenshots,
        browser_closed: browserClosed,
        browser_runtime: browserRuntime,
        owned_api_closed: appClosed,
        isolated_database_dropped_or_deferred_fixture_queued: databaseClosed,
        supplemental_contract_sha256: sha(contractBytes),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      status: passed ? "passed" : "failed",
      checks: checks.length,
      errors,
      browser_closed: browserClosed,
      owned_api_closed: appClosed,
    }),
  );
  process.exitCode = passed ? 0 : 1;
}
