import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const receiptPath = process.argv[2];
assert.ok(receiptPath && path.isAbsolute(receiptPath));
const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
const url = "https://github.com/copypasteltd/workmate/releases/tag/v0.1.0-rc.2";
assert.equal(receipt.status, "published");
assert.equal(receipt.release_url, url);
assert.equal(receipt.repository_private, false);
const root = process.cwd();
const id = randomUUID();
const out = path.resolve(".data/release-publication-159", "browser-" + id);
await mkdir(out, { recursive: true });
const result: any = { started_at: new Date().toISOString(), url, status: "running", checks: [], screenshots: [], recordings: [], errors: [], credentials_used_in_browser: false, browser_closed: false };
let browser: Browser | undefined, recording: WorkmateRecording | undefined;
async function stopRecording() {
  if (recording) { const active = recording; recording = undefined; result.recordings.push(await active.stop()); }
}
try {
  browser = await chromium.launch({ executablePath: path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"), headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  assert.equal(response?.status(), 200);
  await page.getByRole("heading", { name: "Workmate v0.1.0-rc.2 · Complete frozen candidate", exact: true }).waitFor();
  result.checks.push("The published release page is publicly accessible without browser credentials");
  const source = "Actual public GitHub Release v0.1.0-rc.2, unchanged frozen files; no product/runtime or new client acceptance";
  const attempt = "release-publication-159-01";
  result.screenshots.push(await saveWorkmateScreenshot("delivery", attempt, "published-release", await page.screenshot(), source, root));
  const complete = receipt.assets.find((a: any) => a.name === "workmate-v0.1.0-rc.2-complete.zip");
  const checksum = receipt.assets.find((a: any) => a.name === complete.name + ".sha256");
  assert.ok(complete && checksum);
  const completeLink = page.locator('a[href$="/v0.1.0-rc.2/' + complete.name + '"]');
  await completeLink.waitFor();
  await completeLink.scrollIntoViewIfNeeded();
  const details = completeLink.locator("xpath=ancestor::details[1]");
  const summary = details.locator(":scope > summary");
  assert.equal(await details.getAttribute("open") !== null, true);
  recording = new WorkmateRecording("delivery", "release-assets-download", attempt, () => page.screenshot({ type: "jpeg", quality: 72 }), source, root);
  await recording.start();
  await summary.click();
  assert.equal(await details.getAttribute("open"), null);
  await summary.click();
  await completeLink.waitFor({ state: "visible" });
  for (const a of receipt.assets) {
    const link = page.locator('a[href$="/v0.1.0-rc.2/' + a.name + '"]');
    await link.waitFor({ state: "visible" });
    assert.equal(new URL(await link.getAttribute("href") || "", url).href, a.browser_download_url);
  }
  result.checks.push("All six verified frozen assets appear as actual download links");
  const checksumLink = page.locator('a[href$="/v0.1.0-rc.2/' + checksum.name + '"]');
  const [download] = await Promise.all([page.waitForEvent("download"), checksumLink.click()]);
  assert.equal(await download.failure(), null);
  assert.equal(download.suggestedFilename(), checksum.name);
  const downloaded = path.join(out, checksum.name);
  await download.saveAs(downloaded);
  const bytes = await readFile(downloaded);
  const actual = createHash("sha256").update(bytes).digest("hex");
  assert.equal("sha256:" + actual, checksum.digest);
  assert.deepEqual(bytes, await readFile(path.resolve("release", checksum.name)));
  result.download = { name: checksum.name, bytes: bytes.length, sha256: actual, matches_frozen_file: true };
  result.checks.push("The real public checksum download exactly matches the frozen file");
  result.screenshots.push(await saveWorkmateScreenshot("delivery", attempt, "verified-assets", await page.screenshot(), source, root));
  await stopRecording();
  await context.close();
} catch (e) { result.errors.push(String(e)); }
finally {
  try { await stopRecording(); } catch (e) { result.errors.push("recording: " + String(e)); }
  if (browser) { try { await browser.close(); result.browser_closed = true; } catch (e) { result.errors.push("close: " + String(e)); } }
  result.finished_at = new Date().toISOString();
  result.status = result.errors.length === 0 && result.checks.length === 3 && result.browser_closed ? "passed" : "failed";
  await writeFile(path.join(out, "receipt.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, checks: result.checks.length, errors: result.errors, receipt: path.join(out, "receipt.json") }));
}
assert.equal(result.status, "passed");
