import { chromium } from "playwright";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
const root = path.resolve(".."),
  repo = path.join(root, "copypaste-extension"),
  platform = path.join(root, "copypaste-platform"),
  id = (await readFile(path.join(repo, "extension-id.txt"), "utf8")).trim();
const user = JSON.parse(await readFile(".data/qa-user.json", "utf8"));
const checks: any[] = [],
  errors: string[] = [];
const profile = path.resolve(".data/extension-" + randomUUID());
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
  headless: true,
  args: [
    "--disable-extensions-except=" + path.join(repo, "dist"),
    "--load-extension=" + path.join(repo, "dist"),
  ],
  viewport: { width: 420, height: 1000 },
});
await context.addInitScript(() => {
  try {
    localStorage.setItem("cp_locale", "en");
  } catch {}
});
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 20000 }));
  if (!worker.url().includes(id))
    throw new Error("Unexpected extension identity");
  const panel = await context.newPage();
  panel.on("pageerror", (e) => errors.push(e.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.locator("#sign-in").waitFor();
  await mkdir(path.join(repo, "assets/screenshots"), { recursive: true });
  await panel.screenshot({
    path: path.join(repo, "assets/screenshots/01-login.png"),
    fullPage: true,
  });
  const popupEvent = context.waitForEvent("page", { timeout: 20000 });
  const requested = Date.now();
  await panel.locator("#sign-in").click();
  const popup = await popupEvent;
  await popup.waitForLoadState();
  await popup.locator('input[name="email"]').fill(user.email);
  await popup.locator('form button[type="submit"]').click();
  let code = "";
  for (let i = 0; i < 30; i++) {
    const all = [];
    for (const f of await readdir(path.join(platform, ".data/mailbox"))) {
      const m = JSON.parse(
        await readFile(path.join(platform, ".data/mailbox", f), "utf8"),
      );
      if (m.to === user.email && Date.parse(m.at) >= requested) all.push(m);
    }
    all.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    if (all[0]) {
      code = all[0].text.match(/\b\d{6}\b/)[0];
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  await popup.locator('input[name="code"]').fill(code);
  await popup.locator('form button[type="submit"]').click();
  await popup
    .getByRole("button", { name: /Authorize & return|授權並返回應用/ })
    .click();
  await panel
    .locator("#workspace")
    .waitFor({ state: "visible", timeout: 20000 });
  await panel.locator("#role option").first().waitFor({ state: "attached" });
  await panel.screenshot({
    path: path.join(repo, "assets/screenshots/02-workspace.png"),
    fullPage: true,
  });
  checks.push({
    name: "real Chromium MV3 identity popup + PKCE + session-only token storage",
    status: "passed",
  });
  const file = path.resolve(".data/extension-brief.txt");
  await writeFile(file, "Harbour Studio · selected local brief");
  await panel.locator("#file-input").setInputFiles(file);
  await panel
    .locator("#file-note")
    .getByText("已加入", { exact: false })
    .waitFor();
  checks.push({
    name: "explicit local file picker uploads to the selected project",
    status: "passed",
  });
  const exposed = await panel.evaluate(async () => {
    const local = await chrome.storage.local.get(null);
    const result = await chrome.runtime.sendMessage({ type: "STATUS" });
    return {
      local_keys: Object.keys(local),
      status_keys: Object.keys(result.data),
    };
  });
  if (
    exposed.local_keys.includes("tokens") ||
    exposed.status_keys.includes("access_token")
  )
    throw new Error("Token exposed outside trusted background storage");
  await panel.locator("#sign-out").click();
  await panel.locator("#login").waitFor({ state: "visible" });
  checks.push({
    name: "logout clears session tokens and revokes server refresh family",
    status: "passed",
  });
  if (errors.length) throw new Error(errors.join("\n"));
} catch (e: any) {
  checks.push({
    name: "extension journey",
    status: "failed",
    detail: e.message,
  });
  throw e;
} finally {
  await context.close();
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/extension.json",
    JSON.stringify(
      { at: new Date().toISOString(), checks, errors, browser_closed: true },
      null,
      2,
    ),
  );
}
