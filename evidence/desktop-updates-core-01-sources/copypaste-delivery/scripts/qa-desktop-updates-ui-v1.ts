import assert from "node:assert/strict";
import {
  chromium,
  _electron,
  type Browser,
  type ElectronApplication,
  type Page,
} from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  WorkmateRecording,
  saveWorkmateScreenshot,
} from "./record-workmate-media.js";
const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform"),
  desktop = path.resolve("../copypaste-desktop"),
  attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = path.resolve("evidence/desktop-updates-ui-" + attempt),
  owned = path.resolve(".data/desktop-updates-ui", randomUUID());
await mkdir(owned, { recursive: true });
const apiOrigin = process.env.COPYPASTE_RECOVERY_API_ORIGIN!,
  adminOrigin = process.env.COPYPASTE_RECOVERY_ADMIN_ORIGIN!,
  webOrigin = process.env.COPYPASTE_RECOVERY_WEB_ORIGIN!;
const load = (file: string) =>
    import(pathToFileURL(path.join(platform, file)).href),
  hash = (bytes: Uint8Array | string) =>
    createHash("sha256").update(bytes).digest("hex");
const checks: string[] = [],
  screenshots: any[] = [],
  recordings: any[] = [],
  layouts: any[] = [],
  errors: string[] = [];
let system: any,
  isolated: any,
  browser: Browser | undefined,
  electron: ElectronApplication | undefined,
  recording: WorkmateRecording | undefined;
let browserClosed = false,
  electronClosed = false,
  apiClosed = false,
  fixtureClosed = false,
  stage = "setup";
const pass = (label: string) => {
  checks.push(label);
  console.log("PASS: " + label);
};
async function until(
  read: () => Promise<any>,
  accept: (v: any) => boolean,
  label: string,
  timeout = 120000,
) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await read();
    if (accept(v)) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Timeout: " + label);
}
async function fits(page: Page, label: string, native = false) {
  const result = await page.evaluate(
    ({ native }) => {
      const rails = [
        ...document.querySelectorAll<HTMLElement>("body, #root, #root *"),
      ].filter((e) => {
        const r = e.getBoundingClientRect(),
          s = getComputedStyle(e);
        return (
          r.width > 0 &&
          r.height > 0 &&
          e.scrollHeight > e.clientHeight + 2 &&
          ["auto", "scroll"].includes(s.overflowY) &&
          s.scrollbarWidth !== "none" &&
          getComputedStyle(e, "::-webkit-scrollbar").display !== "none"
        );
      });
      const root = document.getElementById("root")!,
        r = root.getBoundingClientRect();
      return {
        width: innerWidth,
        height: innerHeight,
        document_horizontal:
          document.documentElement.scrollWidth > innerWidth + 2,
        root_horizontal: root.scrollWidth > root.clientWidth + 2,
        visible_vertical_rails: rails.length,
        root_top: r.top,
        body_width: document.body.scrollWidth,
      };
    },
    { native },
  );
  assert.equal(result.document_horizontal, false, label);
  assert.equal(result.root_horizontal, false, label);
  if (native) {
    assert.equal(result.visible_vertical_rails, 0, label);
    assert.equal(result.root_top, 40);
  }
  layouts.push({ label, ...result });
}
async function shot(repo: string, name: string, page: Page, source: string) {
  screenshots.push(
    await saveWorkmateScreenshot(
      repo,
      "desktop-updates-" + attempt,
      name,
      await page.screenshot(),
      source,
      delivery,
    ),
  );
}
async function request(
  page: Page,
  url: string,
  method = "GET",
  body?: unknown,
) {
  const result = await page.evaluate(
    async ({ apiOrigin, url, method, body }) => {
      const auth = await (
        await fetch(apiOrigin + "/v1/admin/me", { credentials: "include" })
      ).json();
      const r = await fetch(apiOrigin + url, {
        method,
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": auth.csrf_token,
          "idempotency-key": crypto.randomUUID(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: r.status, body: await r.json() };
    },
    { apiOrigin, url, method, body },
  );
  assert.ok(
    result.status >= 200 && result.status < 300,
    JSON.stringify(result),
  );
  return result.body;
}
try {
  const [
    { isolatedTestEnvironment },
    { buildApp },
    { loadConfig },
    { seal },
    contract,
  ] = await Promise.all([
    load("tests/native-test-environment.ts"),
    load("src/server.ts"),
    load("src/config.ts"),
    load("src/lib.ts"),
    load("src/desktop-update-contract.ts"),
  ]);
  const pair = generateKeyPairSync("ed25519"),
    key_id = hash(pair.publicKey.export({ type: "spki", format: "der" })),
    keys = {
      [key_id]: pair.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    };
  const trustFile = path.join(owned, "development-public-trust.json");
  await writeFile(trustFile, JSON.stringify({ keys, minimumSequence: 1 }));
  process.chdir(platform);
  isolated = await isolatedTestEnvironment();
  system = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEV_MAILBOX: "true",
      WORKER_ENABLED: "false",
      DEMO_MODE: "true",
      API_ORIGIN: apiOrigin,
      ADMIN_ORIGIN: adminOrigin,
      WEB_ORIGIN: webOrigin,
      DESKTOP_UPDATE_PUBLIC_KEYS: JSON.stringify(keys),
    }),
    { worker: false },
  );
  await system.app.listen({
    host: "127.0.0.1",
    port: Number(new URL(apiOrigin).port),
  });
  const signatureScript =
    "$s = Get-AuthenticodeSignature -LiteralPath $env:COPYPASTE_INSPECT_CANDIDATE; $h=[Security.Cryptography.SHA256]::Create(); [PSCustomObject]@{status=[string]$s.Status;signer=([BitConverter]::ToString($h.ComputeHash($s.SignerCertificate.RawData))).Replace('-','').ToLowerInvariant()} | ConvertTo-Json -Compress";
  const signature = JSON.parse(
    (
      await promisify(execFile)(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(signatureScript, "utf16le").toString("base64"),
        ],
        {
          env: {
            ...process.env,
            COPYPASTE_INSPECT_CANDIDATE: process.execPath,
          },
          windowsHide: true,
          timeout: 45000,
        },
      )
    ).stdout,
  );
  assert.equal(signature.status, "Valid");
  const installer = await readFile(process.execPath);
  const make = (action = "install", sequence = 1) => {
    const payload = {
      protocol: contract.updateProtocol,
      app_id: contract.updateAppId,
      channel: "stable",
      platform: "windows-x64",
      sequence,
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      action,
      rollout_basis_points: 10000,
      release:
        action === "withdraw"
          ? null
          : {
              version: "0.7.0",
              minimum_version: "0.5.0",
              sha256: hash(installer),
              bytes: installer.length,
              signer_sha256: signature.signer,
              notes: {
                en: "Workflow verification: a real signed test file is downloaded and checked. It will never be installed or executed.",
                zh: "流程核查：下載及驗證真實已簽名測試檔。此檔案不會被安裝或執行。",
              },
            },
    };
    return {
      key_id,
      payload,
      signature: sign(
        null,
        Buffer.from(contract.updateCanonical(payload)),
        pair.privateKey,
      ).toString("base64url"),
    };
  };
  const OTPAuth = createRequire(path.join(platform, "package.json"))("otpauth"),
    secret = new OTPAuth.Secret({ size: 20 }),
    email = "desktop-release-ui-" + randomUUID() + "@example.invalid";
  const admin = (
      await system.db.control.query(
        "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Release control check',$2) RETURNING id",
        [email, seal(system.db.config.MASTER_KEY, secret.base32)],
      )
    ).rows[0],
    role = "desktop_release_ui_" + randomUUID().replaceAll("-", "");
  await system.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [
      role,
      JSON.stringify([
        "admin.desktop_updates.read",
        "admin.desktop_updates.stage",
        "admin.desktop_updates.publish",
      ]),
    ],
  );
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,$2,'global')",
    [admin.id, role],
  );
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN,
    headless: true,
    args: ["--disable-gpu"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => errors.push(e.message));
  stage = "admin sign-in";
  await page.goto(adminOrigin + "/login");
  await page.locator('input[name="email"]').fill(email);
  const [challenge] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/v1/admin/auth/challenge" &&
        r.request().method() === "POST",
    ),
    page.locator('form button[type="submit"]').click(),
  ]);
  assert.ok(challenge.ok());
  const ch = await challenge.json();
  const mail = JSON.parse(
    await readFile(
      path.join(isolated.directory, "mailbox", ch.challenge_id + ".json"),
      "utf8",
    ),
  );
  await page
    .locator('input[name="code"]')
    .fill(mail.text.match(/\b\d{6}\b/)[0]);
  await page
    .locator('input[name="totp"]')
    .fill(new OTPAuth.TOTP({ secret }).generate());
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => u.pathname !== "/login");
  await page.goto(adminOrigin + "/desktop-updates");
  await page.getByRole("heading", { name: "Stage signed release" }).waitFor();
  recording = new WorkmateRecording(
    "admin",
    "desktop-release-publish",
    "desktop-updates-" + attempt,
    () => page.screenshot({ type: "jpeg", quality: 72 }),
    "Actual Admin sign-in, signed staging, chunk upload, exact preview and publication",
    delivery,
  );
  await recording.start();
  const stageUI = async (envelope: any) => {
    await page
      .locator(".desktop-release-composer textarea")
      .fill(JSON.stringify(envelope));
    await page
      .locator(".desktop-release-composer input")
      .fill("Reviewed signed workflow test release");
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === "/v1/admin/desktop-updates" &&
          r.request().method() === "POST",
      ),
      page
        .getByRole("button", { name: "Verify and stage", exact: true })
        .click(),
    ]);
    assert.ok(response.ok(), await response.text());
    return response.json();
  };
  stage = "stage and upload";
  const manifest = make(),
    release = await stageUI(manifest);
  await page
    .locator('.desktop-release-item input[type="file"]')
    .setInputFiles(process.execPath);
  await page
    .getByRole("button", { name: "Publish update", exact: true })
    .waitFor({ timeout: 180000 });
  await fits(page, "Admin release preview English 1440px");
  await shot(
    "admin",
    "release-ready",
    page,
    "Actual Admin signed release with real chunk-uploaded Windows-signed test file",
  );
  const publishUI = async (label: string) => {
    await page.getByRole("button", { name: label, exact: true }).click();
    const modal = page.getByRole("dialog");
    await modal
      .locator('input:not([type="checkbox"])')
      .fill("Checked channel, exact release, rollout and expiry");
    await modal.locator('input[type="checkbox"]').check();
    const [response] = await Promise.all([
      page.waitForResponse((r) =>
        /\/desktop-updates\/[^/]+\/publish$/.test(new URL(r.url()).pathname),
      ),
      modal
        .getByRole("button", { name: "Confirm publication", exact: true })
        .click(),
    ]);
    assert.ok(response.ok(), await response.text());
    await modal.waitFor({ state: "hidden" });
  };
  await publishUI("Publish update");
  await page.getByText("Current", { exact: true }).waitFor();
  recordings.push(await recording.stop());
  recording = undefined;
  pass(
    "Admin performs real email/TOTP sign-in, offline signature staging, bounded file chunks, exact hash finalization and audited publication through its UI",
  );
  const listing = await request(page, "/v1/admin/desktop-updates");
  assert.equal(listing.head.release_id, release.id);
  assert.equal(listing.history.length, 1);
  stage = "native Desktop";
  electron = await _electron.launch({
    executablePath: path.join(
      desktop,
      "node_modules/electron/dist/electron.exe",
    ),
    args: [desktop],
    env: {
      ...process.env,
      COPYPASTE_API_ORIGIN: apiOrigin,
      COPYPASTE_WEB_ORIGIN: webOrigin,
      COPYPASTE_USER_DATA: path.join(owned, "user-data"),
      COPYPASTE_DEV_UPDATE_TRUST_FILE: trustFile,
    },
  });
  const native = await electron.firstWindow();
  native.setDefaultTimeout(30000);
  native.on("pageerror", (e) => errors.push(e.message));
  await native.waitForSelector("#copypaste-titlebar");
  await native.evaluate(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
    location.hash = "#/updates";
    location.reload();
  });
  await native
    .getByRole("button", { name: "Check for updates", exact: true })
    .waitFor();
  recording = new WorkmateRecording(
    "desktop",
    "signed-update-download",
    "desktop-updates-" + attempt,
    () => native.screenshot({ type: "jpeg", quality: 72 }),
    "Actual frameless Electron main-process updater, signed feed, download and native WinVerifyTrust; signed test fixture never installed",
    delivery,
  );
  await recording.start();
  await native
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  await native
    .getByRole("button", { name: "Download update", exact: true })
    .waitFor();
  assert.equal(
    await native
      .getByRole("button", { name: "Install and restart", exact: true })
      .count(),
    0,
  );
  await fits(native, "Desktop available English light 1280px", true);
  await shot(
    "desktop",
    "update-available",
    native,
    "Actual frameless Desktop before sign-in: verified company feed and release notes",
  );
  await native
    .getByRole("button", { name: "Download update", exact: true })
    .click();
  await native
    .getByRole("button", { name: "Remove download", exact: true })
    .waitFor({ timeout: 180000 });
  const status = await native.evaluate(() =>
    (window as any).copyPasteBridge.desktopUpdates("status"),
  );
  assert.equal(status.state, "ready");
  assert.equal(status.installer_supported, false);
  assert.equal(status.received_bytes, installer.length);
  await fits(native, "Desktop verified English light 1280px", true);
  await shot(
    "desktop",
    "update-verified",
    native,
    "Real company feed, actual signed file hash and Windows certificate chain verified; development install remains manual",
  );
  recordings.push(await recording.stop());
  recording = undefined;
  pass(
    "Actual Electron updater checks without login, downloads from the fixed company origin and verifies signed manifest, file hash and real Windows Authenticode",
  );
  await electron.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(860, 680);
  });
  await native.locator('button[title="Theme: light / dark / system"]').click();
  await native.locator('button[title="切換至繁體中文"]').click();
  await native.getByRole("button", { name: "移除下載", exact: true }).waitFor();
  await fits(native, "Desktop verified Traditional Chinese dark 860px", true);
  await shot(
    "desktop",
    "update-zh-dark",
    native,
    "Actual Traditional Chinese dark update panel at narrow native window size with hidden rails",
  );
  const beforeScroll = await native
    .locator("#root")
    .evaluate((e) => e.scrollTop);
  await native.locator("#root").hover();
  await native.mouse.wheel(0, 800);
  await until(
    () => native.locator("#root").evaluate((e) => e.scrollTop),
    (v) => v > beforeScroll,
    "native wheel remains available",
  );
  pass(
    "Native update UI retains frameless controls, hidden vertical scrollbars, no horizontal overflow, Traditional Chinese/dark layout and wheel scrolling",
  );
  stage = "withdrawal";
  await stageUI(make("withdraw", 2));
  await publishUI("Withdraw channel update");
  await native.getByRole("button", { name: "檢查更新", exact: true }).click();
  await native
    .getByText("此更新已撤回，請等候新版本。", { exact: true })
    .waitFor();
  const withdrawn = await native.evaluate(() =>
    (window as any).copyPasteBridge.desktopUpdates("status"),
  );
  assert.equal(withdrawn.code, "UPDATE_WITHDRAWN");
  assert.equal(
    await native.getByRole("button", { name: "移除下載", exact: true }).count(),
    0,
  );
  const old = await fetch(
    apiOrigin +
      "/v1/public/desktop-updates/artifacts/" +
      manifest.payload.release!.sha256,
  );
  assert.equal(old.status, 404);
  pass(
    "Signed withdrawal invalidates a previously verified native download and stops public access to the withdrawn artifact",
  );
  await page.locator('button[title="Theme: light / dark / system"]').click();
  await page.setViewportSize({ width: 960, height: 900 });
  await fits(page, "Admin withdrawal dark 960px");
  await shot(
    "admin",
    "release-withdrawn",
    page,
    "Actual signed withdrawal and immutable publication history in Admin dark mode",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
} catch (error) {
  errors.push(stage + ": " + String(error));
} finally {
  if (recording) {
    try {
      recordings.push(await recording.stop());
    } catch (e) {
      errors.push(String(e));
    }
  }
  if (electron) {
    try {
      await electron.close();
      electronClosed = true;
    } catch (e) {
      errors.push(String(e));
    }
  }
  if (browser) {
    try {
      await browser.close();
      browserClosed = true;
    } catch (e) {
      errors.push(String(e));
    }
  }
  if (system) {
    try {
      await system.app.close();
      apiClosed = true;
    } catch (e) {
      errors.push(String(e));
    }
  }
  if (isolated) {
    try {
      await isolated.cleanup();
      fixtureClosed = true;
    } catch (e) {
      errors.push(String(e));
    }
  }
  const report = {
    at: new Date().toISOString(),
    status:
      !errors.length &&
      electronClosed &&
      browserClosed &&
      apiClosed &&
      fixtureClosed
        ? "passed"
        : "failed",
    checks,
    screenshots,
    recordings,
    layouts,
    errors,
    electron_closed: electronClosed,
    browser_closed: browserClosed,
    api_closed: apiClosed,
    fixture_closed: fixtureClosed,
    limitations: [
      "Ephemeral offline release trust and a real signed Node binary as inert installer surrogate; no product installer launched",
      "No company code-signing credential or installed-app upgrade qualification",
      "Affected UI only; no full-product or live-model acceptance",
    ],
  };
  await writeFile(
    prefix + "-journey.json",
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify(report));
  assert.equal(report.status, "passed");
}
