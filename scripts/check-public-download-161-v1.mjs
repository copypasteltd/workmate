import assert from "node:assert/strict";
import {chromium} from "playwright";
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {createHash, randomUUID} from "node:crypto";
import path from "node:path";

const source = process.argv[2];
assert.ok(source && path.isAbsolute(source));
const receipt = JSON.parse(await readFile(source, "utf8"));
assert.equal(receipt.status, "published");
assert.equal(receipt.release, "v0.1.0-rc.3");
assert.equal(receipt.repository_private, false);
const asset = receipt.assets.find(a => a.name === "workmate-v0.1.0-rc.3-complete.zip.sha256");
assert.ok(asset);
const out = path.resolve(".data/release-freeze-161", "browser-" + randomUUID());
await mkdir(out, {recursive: true});
const sha = b => createHash("sha256").update(b).digest("hex");
const result = {started_at: new Date().toISOString(), status: "running", release: receipt.release, release_url: receipt.release_url, page_status: null, download: null, browser_closed: false, credentials_used: false, error: null, verifier_sha256: sha(await readFile(import.meta.filename))};
let browser;
try {
  browser = await chromium.launch({executablePath: path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"), headless: true});
  const context = await browser.newContext({acceptDownloads: true});
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const response = await page.goto(receipt.release_url, {waitUntil: "domcontentloaded", timeout: 60000});
  result.page_status = response?.status();
  assert.equal(result.page_status, 200);
  const link = page.locator('a[href$="/v0.1.0-rc.3/' + asset.name + '"]');
  await link.waitFor({state: "visible"});
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  assert.equal(await download.failure(), null);
  assert.equal(download.suggestedFilename(), asset.name);
  const target = path.join(out, asset.name);
  await download.saveAs(target);
  const bytes = await readFile(target);
  assert.equal(bytes.length, 100);
  assert.equal("sha256:" + sha(bytes), asset.digest);
  assert.deepEqual(bytes, await readFile(path.resolve("release", asset.name)));
  result.download = {url: asset.browser_download_url, file: target, bytes: bytes.length, sha256: sha(bytes), matches_frozen_file: true};
  await context.close();
} catch(e) {result.error = String(e);}
finally {
  if (browser) try {await browser.close(); result.browser_closed = true;} catch(e) {result.error = (result.error ?? "") + "; close: " + e;}
  result.status = !result.error && result.download?.matches_frozen_file && result.browser_closed ? "passed" : "failed";
  result.finished_at = new Date().toISOString();
  await writeFile(path.join(out, "receipt.json"), JSON.stringify(result, null, 2) + "\n", {flag: "wx"});
  console.log(JSON.stringify({status: result.status, browser_closed: result.browser_closed, error: result.error, receipt: path.join(out, "receipt.json")}));
}
assert.equal(result.status, "passed");
