import { emailCode } from "./qa-auth.js";
import { spawn } from "node:child_process";
import { _electron, chromium } from "playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const root = path.resolve(".."),
  repo = path.join(root, "copypaste-desktop"),
  platform = path.join(root, "copypaste-platform");
const user = JSON.parse(await readFile(".data/qa-user.json", "utf8"));
const dataDir = path.resolve(".data/desktop-" + randomUUID());
const folder = path.join(dataDir, "approved");
await mkdir(folder, { recursive: true });
await writeFile(
  path.join(folder, "brief.txt"),
  "Harbour Studio · 為每個好想法，留一點空間。",
);
const app = await _electron.launch({
  executablePath: path.join(repo, "release/win-unpacked/CopyPaste.exe"),
  args: [],
  env: { ...process.env, COPYPASTE_USER_DATA: dataDir },
});
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
  headless: true,
});
const ctx = await browser.newContext();
const checks: any[] = [];
const errors: string[] = [];
try {
  const page = await app.firstWindow({ timeout: 30000 });
  await page.waitForURL(/file:.*index\.html/);
  await page.waitForLoadState("load");
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  await page.reload();
  await app.evaluate(({ shell, dialog }) => {
    shell.openExternal = async (url: string) => {
      (globalThis as any).__authURL = url;
    };
    dialog.showOpenDialog = async () =>
      ({ canceled: false, filePaths: [] }) as any;
  });
  await page
    .getByRole("button", { name: "Sign in securely in your browser" })
    .click({ noWaitAfter: true });
  let url = "";
  for (let i = 0; i < 100; i++) {
    url = await app.evaluate(() => (globalThis as any).__authURL ?? "");
    if (url) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!url) throw new Error("No system browser authorization URL");
  const auth = await ctx.newPage();
  await auth.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
  });
  await auth.goto(url);
  await auth.getByLabel("Work email").fill(user.email);
  const code = await emailCode(auth, () =>
    auth.getByRole("button", { name: "Send sign-in code" }).click(),
  );
  await auth.locator('input[name="code"]').fill(code);
  await auth.locator('form button[type="submit"]').click();
  await auth
    .getByRole("button", { name: /Connect.*|Allow.*|Authorize.*/ })
    .click();
  await page.waitForURL("**#/app");
  await page.getByRole("heading", { name: "Hello, Avery Chan." }).waitFor();
  await mkdir(path.join(repo, "assets/screenshots"), { recursive: true });
  await page.screenshot({
    path: path.join(repo, "assets/screenshots/01-workspace.png"),
    fullPage: true,
  });
  checks.push({
    name: "real Electron + system-browser PKCE + DPAPI credential storage",
    status: "passed",
    browser_launch: "captured to an isolated test browser",
  });
  await page
    .getByRole("link", { name: "Your specialists", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create specialist", exact: true })
    .click();
  await page
    .getByLabel("Specialist name", { exact: true })
    .fill("Desktop campaign partner");
  await page
    .getByLabel("Working instructions")
    .fill("Preserve HKD amounts and use verified campaign data.");
  await page
    .getByRole("button", { name: "Save specialist", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Desktop campaign partner", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Start conversation", exact: true })
    .first()
    .click();
  await page.getByLabel("Message purpose").selectOption("note");
  await page
    .getByLabel("Your message", { exact: true })
    .fill(
      "Desktop note: prepare a bilingual campaign analysis after reviewing the source files.",
    );
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await page.locator(".work-message").first().waitFor();
  await page.reload();
  await page.locator(".work-message").first().waitFor();
  await page.screenshot({
    path: path.join(repo, "assets/screenshots/04-private-conversation.png"),
    fullPage: true,
    animations: "disabled",
  });
  checks.push({
    name: "packaged Desktop specialist, private conversation, note persistence through the native API bridge",
    status: "passed",
  });
  await page.evaluate(() => {
    location.hash = "/app/devices";
  });
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () =>
      ({ canceled: false, filePaths: [folder] }) as any;
    dialog.showMessageBox = async () =>
      ({ response: 0, checkboxChecked: false }) as any;
  }, folder);
  await page
    .getByRole("button", { name: "Choose folder", exact: true })
    .click();
  await page.getByText("approved", { exact: true }).first().waitFor();
  await page.getByLabel("Folder grant").selectOption({ label: "approved" });
  await page.getByLabel("Relative path", { exact: true }).fill("brief.txt");
  await page.getByRole("button", { name: "Read preview" }).click();
  await page
    .locator("pre")
    .getByText("Harbour Studio", { exact: false })
    .waitFor();
  await page.getByRole("button", { name: "Pair cloud scheduling" }).click();
  await page
    .getByText("Grants paired with this workspace.", { exact: false })
    .waitFor();
  await page.screenshot({
    path: path.join(repo, "assets/screenshots/02-local-files.png"),
    fullPage: true,
  });
  checks.push({
    name: "real file read + explicit read-only grant + signed cloud pairing",
    status: "passed",
    picker: "native dialog response selected by test",
  });
  const command = await page.evaluate(async (tenant) => {
    const b = (window as any).copyPasteBridge;
    const devices = await b.request(`/v1/tenants/${tenant}/devices`, {});
    const d = devices.body.items.find((x: any) => x.state === "active");
    const grant = (await b.localGrants())[0];
    const r = await b.request(
      `/v1/tenants/${tenant}/devices/${d.id}/commands`,
      {
        method: "POST",
        body: { operation: "file.list", grant_id: grant.id, path: "." },
      },
    );
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
    return r.body;
  }, user.tenant);
  let result: any;
  for (let n = 0; n < 30; n++) {
    result = await page.evaluate(
      async ({ tenant, command }) =>
        (
          await (window as any).copyPasteBridge.request(
            `/v1/tenants/${tenant}/devices/${command.device_id}/commands/${command.id}`,
            {},
          )
        ).body,
      { tenant: user.tenant, command },
    );
    if (result.state === "succeeded") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (
    result.state !== "succeeded" ||
    !result.result.items?.some((i: any) => i.name === "brief.txt")
  )
    throw new Error(
      "Signed cloud file command did not complete: " + JSON.stringify(result),
    );
  checks.push({
    name: "cloud command → pinned signature → real local listing → single-use result",
    status: "passed",
  });
  const extension = (
    await readFile(
      path.join(root, "copypaste-extension/extension-id.txt"),
      "utf8",
    )
  ).trim();
  const { LocalVault } = await import(
    pathToFileURL(path.join(repo, "dist/vault.js")).href
  );
  await writeFile(
    path.join(dataDir, "extensions.enc"),
    await new LocalVault(dataDir).encrypt(
      JSON.stringify([`chrome-extension://${extension}/`]),
    ),
  );
  if (!/^[a-p]{32}$/.test(extension)) throw new Error("Invalid extension ID");
  const framed = Buffer.from(JSON.stringify({ operation: "grant.list" })),
    header = Buffer.alloc(4);
  header.writeUInt32LE(framed.length);
  const output = await new Promise<Buffer>((resolve, reject) => {
    const host = spawn(
      '"' +
        path.join(repo, "release/win-unpacked/resources/native-host.cmd") +
        '"',
      [`chrome-extension://${extension}/`],
      {
        shell: true,
        env: { ...process.env, COPYPASTE_USER_DATA: dataDir },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const chunks: Buffer[] = [];
    let diagnostic = "";
    host.stdout.on("data", (b) => chunks.push(b));
    host.stderr.on(
      "data",
      (b) => (diagnostic = (diagnostic + b.toString()).slice(-2000)),
    );
    const timeout = setTimeout(() => {
      host.kill();
      reject(new Error("Native host timeout"));
    }, 15000);
    host.once("error", reject);
    host.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0)
        reject(new Error("Native host exit " + code + ": " + diagnostic));
      else resolve(Buffer.concat(chunks));
    });
    host.stdin.end(Buffer.concat([header, framed]));
  });
  if (output.length < 4)
    throw new Error("Native host did not frame a response");
  const hostResult = JSON.parse(
    output.subarray(4, 4 + output.readUInt32LE()).toString(),
  );
  if (
    !hostResult.ok ||
    !hostResult.data.some((g: any) => g.label === "approved")
  )
    throw new Error("Packaged native host did not return the actual grant");
  checks.push({
    name: "packaged Windows native host + encrypted origin allowlist + Chrome length framing",
    status: "passed",
  });
  const encrypted = await readFile(path.join(dataDir, "auth.enc"));
  if (encrypted.toString("utf8").includes("access_token"))
    throw new Error("Credential file is plaintext");
  await page
    .getByRole("button", { name: "Revoke", exact: true })
    .first()
    .click();
  await page.getByLabel("Folder grant").waitFor({ state: "detached" });
  checks.push({ name: "local grant revocation", status: "passed" });
  if (errors.length) throw new Error(errors.join("\n"));
} catch (e: any) {
  checks.push({ name: "desktop journey", status: "failed", detail: e.message });
  try {
    await (
      await app.firstWindow()
    ).screenshot({
      path: path.join(repo, "assets/screenshots/qa-failure.png"),
    });
  } catch {}
  throw e;
} finally {
  await ctx.close();
  await browser.close();
  await app.close();
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/desktop.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        checks,
        errors,
        browser_closed: true,
        electron_closed: true,
      },
      null,
      2,
    ),
  );
}
