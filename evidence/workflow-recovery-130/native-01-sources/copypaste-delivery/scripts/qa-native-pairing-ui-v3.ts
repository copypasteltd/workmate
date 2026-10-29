import assert from "node:assert/strict";
import {
  chromium,
  _electron,
  type Browser,
  type ElectronApplication,
  type Page,
} from "playwright";
import { readFile, writeFile, mkdir, readdir, lstat } from "node:fs/promises";
import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  randomBytes,
} from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
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
const prefix = path.resolve("evidence/native-pairing-ui-" + attempt),
  owned = path.resolve(".data/native-pairing-ui", randomUUID()),
  userDir = path.join(owned, "user-data"),
  workspace = path.join(owned, "customer-workspace");
await mkdir(workspace, { recursive: true });
await mkdir(userDir, { recursive: true });
const apiOrigin = process.env.COPYPASTE_RECOVERY_API_ORIGIN!,
  adminOrigin = process.env.COPYPASTE_RECOVERY_ADMIN_ORIGIN!,
  webOrigin = process.env.COPYPASTE_RECOVERY_WEB_ORIGIN!;
const load = (file: string) =>
    import(pathToFileURL(path.join(platform, file)).href),
  hash = (bytes: string | Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");
const checks: string[] = [],
  screenshots: any[] = [],
  recordings: any[] = [],
  layouts: any[] = [],
  errors: string[] = [];
const withdrawalResponses: {route: string; status: number; code: string | null}[] = [];
let system: any,
  isolated: any,
  browser: Browser | undefined,
  electron: ElectronApplication | undefined,
  recording: WorkmateRecording | undefined,
  host: ChildProcess | undefined,
  hostClosed: Promise<number | null> | undefined;
let browserClosed = false,
  electronClosed = false,
  apiClosed = false,
  fixtureClosed = false,
  nativeHostClosed = false,
  stage = "setup",
  offline = true, legacyFailure = false, lostPairReply = false;
const pass = (text: string) => {
  checks.push(text);
  console.log("PASS: " + text);
};
async function until(
  read: () => Promise<any>,
  accept: (value: any) => boolean,
  label: string,
  timeout = 120000,
) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    let value: any;
    try { value=await read(); } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
      await new Promise((r)=>setTimeout(r,150));continue;
    }
    if (accept(value)) return value;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Timeout: " + label + (label === "cloud receipt" ? "; redacted outcomes="+JSON.stringify(withdrawalResponses) : ""));
}
async function fits(page: Page, label: string, native = false) {
  const result = await page.evaluate(() => {
    const root = document.getElementById("root")!,
      rails = [
        ...document.querySelectorAll<HTMLElement>("body,#root,#root *"),
      ].filter((e) => {
        const b = e.getBoundingClientRect(),
          s = getComputedStyle(e);
        return (
          b.width > 0 &&
          b.height > 0 &&
          e.scrollHeight > e.clientHeight + 2 &&
          ["auto", "scroll"].includes(s.overflowY) &&
          s.scrollbarWidth !== "none" &&
          getComputedStyle(e, "::-webkit-scrollbar").display !== "none"
        );
      });
    return {
      width: innerWidth,
      height: innerHeight,
      document_horizontal:
        document.documentElement.scrollWidth > innerWidth + 2,
      root_horizontal: root.scrollWidth > root.clientWidth + 2,
      visible_vertical_rails: rails.length,
      root_top: root.getBoundingClientRect().top,
    };
  });
  assert.equal(result.document_horizontal, false, label);
  assert.equal(result.root_horizontal, false, label);
  if (native) {
    assert.equal(result.visible_vertical_rails, 0, label);
    assert.equal(result.root_top, 40, label);
  }
  layouts.push({ label, ...result });
}
async function shot(repo: string, name: string, page: Page, source: string) {
  screenshots.push(
    await saveWorkmateScreenshot(
      repo,
      "native-pairing-" + attempt,
      name,
      await page.screenshot(),
      source,
      delivery,
    ),
  );
}
try {
  const [
    { isolatedTestEnvironment },
    { buildApp },
    { loadConfig },
    { hash: credentialHash },
  ] = await Promise.all([
    load("tests/native-test-environment.ts"),
    load("src/server.ts"),
    load("src/config.ts"),
    load("src/lib.ts"),
  ]);
  process.chdir(platform);
  isolated = await isolatedTestEnvironment();
  // Keep the service working directory at platform while its catalog is loaded.
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
    }),
    { worker: false },
  );
  system.app.addHook("onRequest", async (req: any, reply: any) => {
    if (legacyFailure && req.method==="DELETE" && /\/devices\/[^/]+$/.test(req.url)) return reply.code(503).send({error:{code:"SYNTHETIC_LEGACY_FAILURE"}});
    if (offline && ["/v1/auth/native/disconnect","/v1/auth/native/device-pair/retire"].includes(req.url))
      return reply.code(503).send({ error: { code: "SYNTHETIC_OFFLINE" } });
  });
  system.app.addHook("onSend",async(req:any,reply:any,payload:any)=>{
    if(lostPairReply && req.url==="/v1/auth/native/device-pair" && reply.statusCode===200){lostPairReply=false;reply.code(503);return JSON.stringify({error:{code:"SYNTHETIC_COMMITTED_REPLY_FAILURE"}});}
    if (["/v1/auth/native/disconnect","/v1/auth/native/device-pair/retire","/v1/auth/native/device-pair"].includes(req.url)) {
      let code: string | null = null;
      try { const parsed=JSON.parse(String(payload)); code=typeof parsed.error?.code === "string" ? parsed.error.code : null; } catch {}
      withdrawalResponses.push({route:req.url,status:reply.statusCode,code});
      console.log("WITHDRAWAL_RESPONSE " + JSON.stringify(withdrawalResponses.at(-1)));
    }
    return payload;
  });
  await system.app.listen({
    host: "127.0.0.1",
    port: Number(new URL(apiOrigin).port),
  });
  const user = (
    await system.db.control.query(
      "INSERT INTO users(email,name) VALUES($1,'Synthetic removal customer') RETURNING id",
      ["native-pairing-" + randomUUID() + "@example.invalid"],
    )
  ).rows[0].id;
  const tenant = (
    await system.db.control.query(
      "INSERT INTO tenants(name) VALUES('Removal workflow check') RETURNING id",
    )
  ).rows[0].id;
  await system.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
    [tenant, user],
  );
  const project = (
    await system.db.control.query(
      "INSERT INTO projects(tenant_id,name) VALUES($1,'Synthetic recovery workspace') RETURNING id",
      [tenant],
    )
  ).rows[0].id;
  const family = randomUUID(),
    access = randomBytes(32).toString("base64url"),
    refresh = randomBytes(32).toString("base64url"),
    webToken = randomBytes(32).toString("base64url"),
    epoch = randomUUID();
  const nativeSession = (
    await system.db.control.query(
      "INSERT INTO sessions(token_hash,user_id,audience,auth_version,expires_at) VALUES($1,$2,'native',1,now()+interval '1 hour') RETURNING id",
      [credentialHash(access), user],
    )
  ).rows[0].id;
  await system.db.control.query(
    "INSERT INTO refresh_tokens(digest,family_id,user_id,session_id,client_id,auth_version,expires_at) VALUES($1,$2,$3,$4,'desktop',1,now()+interval '30 days')",
    [credentialHash(refresh), family, user, nativeSession],
  );
  await system.db.control.query(
    "INSERT INTO sessions(token_hash,user_id,audience,auth_version,expires_at) VALUES($1,$2,'user',1,now()+interval '1 hour')",
    [credentialHash(webToken), user],
  );
  const pair = generateKeyPairSync("ed25519"),
    identity = {
      public_key: pair.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
      private_key: pair.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    };
  const grant = {
      id: randomUUID(),
      root: workspace,
      label: "Synthetic customer workspace",
      operations: ["file.list", "file.read"],
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    },
    origin = "chrome-extension://" + "a".repeat(32) + "/";
  const device = (
    await system.db.control.query(
      "INSERT INTO devices(tenant_id,user_id,name,client,public_key,grants) VALUES($1,$2,'This test computer','desktop',$3,$4) RETURNING id",
      [
        tenant,
        user,
        identity.public_key,
        JSON.stringify([{ ...grant, root: undefined }]),
      ],
    )
  ).rows[0].id;
  const otherDevice = (
    await system.db.control.query(
      "INSERT INTO devices(tenant_id,user_id,name,client,public_key) VALUES($1,$2,'Another test computer','desktop',$3) RETURNING id",
      [
        tenant,
        user,
        generateKeyPairSync("ed25519")
          .publicKey.export({ type: "spki", format: "pem" })
          .toString(),
      ],
    )
  ).rows[0].id;
  const { LocalVault } = await import(
      pathToFileURL(path.join(desktop, "dist/vault.js")).href
    ),
    vault = new LocalVault(userDir);
  const uncertainId = randomUUID(),
    operation = {
      createKey: randomUUID(),
      startKey: randomUUID(),
      finishKey: randomUUID(),
      cancelKey: randomUUID(),
      taskId: randomUUID(),
      prompt: "Synthetic retained uncertainty",
      budget: 1000000,
      phase: "uncertain",
      report: {
        status: "unknown",
        output: "Pending manual reconciliation",
        thread_id: "unknown",
        turn_id: "unknown",
      },
    };
  const journal = {
    schema: 1,
    deviceId: randomUUID(),
    sessions: [
      {
        id: uncertainId,
        actorId: user,
        epoch,
        tenant,
        project,
        workspace,
        workspaceHash: hash(workspace),
        role: "marketing-designer",
        revoked: false,
        uncertain: true,
        operation,
        messages: [],
      },
    ],
  };
  for (const [name, value] of [
    [
      "auth",
      {
        access_token: access,
        refresh_token: refresh,
        expires_at: Date.now() + 3600000,
        session_epoch: epoch,
        refresh_request_id: randomUUID(),
      },
    ],
    ["identity", identity],
    ["devices", { [tenant]: device }],
    ["folders", { grants: [grant], completed: {} }],
    ["extensions", [origin]],
    ["local-agent", journal],
  ] as const)
    await writeFile(
      path.join(userDir, name + ".enc"),
      await vault.encrypt(JSON.stringify(value)),
    );
  await writeFile(
    path.join(workspace, "brief.txt"),
    "Synthetic original customer file",
  );
  await mkdir(path.join(userDir, "update-cache"));
  await writeFile(
    path.join(userDir, "update-cache", "inert-cache.bin"),
    "Synthetic downloaded cache",
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
  await context.addCookies([
    {
      name: "cp_session",
      value: webToken,
      url: webOrigin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const web = await context.newPage();
  web.on("pageerror", (e) => errors.push(e.message));
  await web.goto(webOrigin + "/app/devices");
  await web
    .getByRole("heading", { name: "This test computer", exact: true })
    .waitFor();
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
      COPYPASTE_USER_DATA: userDir,
    },
  });
  const native = await electron.firstWindow();
  native.setDefaultTimeout(30000);
  native.on("pageerror", (e) => errors.push(e.message));
  await native.waitForSelector("#copypaste-titlebar");
  await electron.evaluate(({ dialog, shell }) => {
    const state: any = ((globalThis as any).__removalQA = {
      answer: 0,
      clearCache: false,
      prompts: [],
      urls: [],
    });
    dialog.showMessageBox = (async (options: any) => {
      state.prompts.push({
        title: options.title,
        defaultId: options.defaultId,
        cancelId: options.cancelId,
        buttons: options.buttons,
        checkbox: options.checkboxLabel,
      });
      return { response: state.answer, checkboxChecked: state.clearCache };
    }) as any;
    shell.openExternal = (async (url: string) => {
      state.urls.push(url);
    }) as any;
  });
  await native.evaluate(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
    location.hash = "#/computer";
    location.reload();
  });
  await native
    .getByRole("button", { name: "Disconnect this computer", exact: true })
    .waitFor();
  stage = "cancel confirmation";
  await native
    .getByRole("button", { name: "Disconnect this computer", exact: true })
    .click();
  await native
    .getByText("Cancelled. Computer permissions were not changed.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    (
      await native.evaluate(() =>
        (window as any).copyPasteBridge.desktopRemoval("status"),
      )
    ).disabled,
    false,
  );
  assert.equal(
    JSON.parse(
      await vault.decrypt(await readFile(path.join(userDir, "auth.enc"))),
    )?.access_token,
    access,
  );
  await fits(native, "Frameless Desktop English light 1280px", true);
  await shot(
    "desktop",
    "computer-permissions",
    native,
    "Actual frameless Desktop computer and uninstall panel; cancellation preserves permissions",
  );
  pass(
    "Real Electron IPC opens the native confirmation boundary; cancellation preserves auth, local grants and device state",
  );
  stage="recover pairing";
  offline=false;legacyFailure=true;
  const initialCount=(await system.db.control.query("SELECT count(*) FROM devices WHERE user_id=$1",[user])).rows[0].count;
  await native.evaluate(()=>{location.hash="#/app/devices";});
  const pairButton=native.getByRole("button",{name:"Pair cloud scheduling",exact:true});
  await pairButton.waitFor({timeout:120000});
  await pairButton.click();
  await native.getByText(/Pairing is not confirmed/).waitFor();
  assert.equal((await system.db.control.query("SELECT count(*) FROM devices WHERE user_id=$1",[user])).rows[0].count,initialCount);
  pass("A real legacy device DELETE failure blocks replacement in the actual Desktop folder UI and preserves the known device");
  legacyFailure=false;lostPairReply=true;
  recording=new WorkmateRecording("desktop","recover-pairing","native-pairing-"+attempt,()=>native.screenshot({type:"jpeg",quality:72}),"Actual Electron folder UI and HTTP; explicit synthetic post-commit 503 response retains the original encrypted pairing intent",delivery);
  await recording.start();await pairButton.click();
  await until(async()=>lostPairReply,(v)=>v===false,"first committed response observed");
  await until(async()=>JSON.parse(await vault.decrypt(await readFile(path.join(userDir,"desktop-pairings.enc")))),(j)=>j.entries.length===1 && j.entries[0].state==="prepared","prepared pairing after committed response failure");
  const firstPairing=JSON.parse(await vault.decrypt(await readFile(path.join(userDir,"desktop-pairings.enc")))).entries[0];
  const pairedDevice=(await system.db.control.query("SELECT device_id FROM desktop_pairings WHERE user_id=$1 AND id=$2",[user,firstPairing.request.input.id])).rows[0].device_id;
  await native.getByText(/Pairing is not confirmed/).waitFor();
  await shot("desktop","pairing-pending",native,"Actual Desktop folder UI after a committed create response returns synthetic 503; encrypted intent remains prepared");
  await pairButton.click();await native.getByText("Grants paired with this workspace. Bounded cloud commands can now be scheduled.",{exact:true}).waitFor();
  assert.equal(JSON.parse(await vault.decrypt(await readFile(path.join(userDir,"devices.enc"))))[tenant],pairedDevice);
  assert.equal((await system.db.control.query("SELECT count(*) FROM desktop_pairings WHERE user_id=$1",[user])).rows[0].count,"1");
  await shot("desktop","pairing-recovered",native,"Actual Desktop UI recovers the same server device from the original encrypted request");
  await fits(native,"Desktop recovered pairing English light",true);
  recordings.push(await recording.stop());recording=undefined;
  pass("The actual Desktop UI retries the exact durable request after a synthetic committed-response failure and reconnects the same single cloud device");
  // A second explicit folder grant creates a new version. Its create reply is lost
  // so the uninstall path must retire an intent whose device ID was never mapped.
  await electron.evaluate(({dialog}:any,folder:string)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},workspace);
  await native.getByRole("button",{name:"Choose folder",exact:true}).click();
  await until(async()=>JSON.parse(await vault.decrypt(await readFile(path.join(userDir,"folders.enc")))),(j)=>j.grants.length===2,"second explicitly selected folder grant");
  lostPairReply=true;await pairButton.click();await until(async()=>lostPairReply,(v)=>v===false,"replacement committed response observed");await native.getByText(/Pairing is not confirmed/).waitFor();
  const unknownIntent=JSON.parse(await vault.decrypt(await readFile(path.join(userDir,"desktop-pairings.enc")))).entries.find((e:any)=>e.state==="prepared");
  assert.ok(unknownIntent && unknownIntent.request.input.id!==firstPairing.request.input.id);
  const unknownDevice=(await system.db.control.query("SELECT device_id FROM desktop_pairings WHERE user_id=$1 AND id=$2",[user,unknownIntent.request.input.id])).rows[0].device_id;
  assert.notEqual(JSON.parse(await vault.decrypt(await readFile(path.join(userDir,"devices.enc"))))[tenant],unknownDevice);
  offline=true;await native.evaluate(()=>{location.hash="#/computer";});
  await native.getByRole("button",{name:"Disconnect this computer",exact:true}).waitFor();
  stage = "offline withdrawal";
  host = spawn(
    process.execPath,
    [path.join(desktop, "dist/native-host.cjs"), origin],
    {
      env: { ...process.env, COPYPASTE_USER_DATA: userDir },
      windowsHide: true,
      stdio: ["pipe", "ignore", "pipe"],
    },
  );
  host.stderr!.on("data", () => {});
  hostClosed = new Promise((resolve) => host!.once("close", resolve));
  await until(
    () => readdir(path.join(userDir, "native-hosts")).catch(() => []),
    (names) => names.length === 1,
    "owned file Host lease",
  );
  await electron.evaluate(() => {
    (globalThis as any).__removalQA.answer = 1;
    (globalThis as any).__removalQA.clearCache = true;
  });
  recording = new WorkmateRecording(
    "desktop",
    "disconnect-and-retry",
    "native-pairing-" + attempt,
    () => native.screenshot({ type: "jpeg", quality: 72 }),
    "Actual Electron IPC withdrawal, real encrypted store and company API; native consent response controlled by this isolated test",
    delivery,
  );
  await recording.start();
  await native
    .getByRole("button", { name: "Disconnect this computer", exact: true })
    .click();
  await native
    .getByText("Pending retry. Cloud withdrawal cannot be confirmed offline.", {
      exact: true,
    })
    .waitFor({ timeout: 120000 });
  assert.equal(await hostClosed, 0);
  nativeHostClosed = true;
  assert.equal(
    JSON.parse(
      await vault.decrypt(await readFile(path.join(userDir, "auth.enc"))),
    ),
    null,
  );
  assert.deepEqual(
    JSON.parse(
      await vault.decrypt(await readFile(path.join(userDir, "folders.enc"))),
    ).grants,
    [],
  );
  assert.equal(
    (
      await system.db.control.query("SELECT state FROM devices WHERE id=$1", [
        device,
      ])
    ).rows[0].state,
    "revoked",
  );
  assert.equal((await system.db.control.query("SELECT state FROM devices WHERE id=$1",[unknownDevice])).rows[0].state,"active");
  const pending = await readFile(path.join(userDir, "desktop-removal.enc"));
  assert.ok(!pending.includes(Buffer.from(refresh)));
  assert.equal(JSON.parse(await vault.decrypt(pending)).pending.length, 1);
  assert.equal(JSON.parse(await vault.decrypt(pending)).pairings.length,1);
  const retained = JSON.parse(
    await vault.decrypt(await readFile(path.join(userDir, "local-agent.enc"))),
  ).sessions.find((r: any) => r.id === uncertainId);
  assert.equal(retained.revoked, true);
  assert.equal(retained.uncertain, true);
  assert.deepEqual(retained.operation, operation);
  await assert.rejects(lstat(path.join(userDir, "update-cache")), {
    code: "ENOENT",
  });
  assert.equal(
    await readFile(path.join(workspace, "brief.txt"), "utf8"),
    "Synthetic original customer file",
  );
  await fits(native, "Offline withdrawal English light", true);
  await shot(
    "desktop",
    "offline-withdrawal",
    native,
    "Actual offline cloud withdrawal: local permissions removed, Host stopped, encrypted retry and uncertain receipt retained",
  );
  pass(
    "Offline company API failure leaves an explicit pending result while auth, folders and running owned Native Host are withdrawn; original files and uncertain settlement receipts survive cache cleanup",
  );
  stage = "retry cloud withdrawal";
  offline = false;
  await native
    .getByRole("button", { name: "Retry unfinished steps", exact: true })
    .click();
  await until(
    () =>
      native.evaluate(() =>
        (window as any).copyPasteBridge.desktopRemoval("status"),
      ),
    (s) => s.remote === "disconnected",
    "cloud receipt",
  );
  assert.equal(
    (
      await system.db.control.query("SELECT state FROM devices WHERE id=$1", [
        device,
      ])
    ).rows[0].state,
    "revoked",
  );
  assert.equal(
    (
      await system.db.control.query("SELECT state FROM devices WHERE id=$1", [
        otherDevice,
      ])
    ).rows[0].state,
    "active",
  );
  assert.ok(
    (
      await system.db.control.query(
        "SELECT revoked_at FROM sessions WHERE id=$1",
        [nativeSession],
      )
    ).rows[0].revoked_at,
  );
  assert.deepEqual(
    JSON.parse(
      await vault.decrypt(
        await readFile(path.join(userDir, "desktop-removal.enc")),
      ),
    ).pending,
    [],
  );
  await native
    .getByRole("button", { name: "Open Windows uninstall", exact: true })
    .click();
  assert.ok(
    (
      await electron.evaluate(() => (globalThis as any).__removalQA.urls)
    ).includes("ms-settings:appsfeatures"),
  );
  recordings.push(await recording.stop());
  recording = undefined;
  await web.reload();
  const card = web
    .locator("article.card")
    .filter({
      has: web.getByRole("heading", {
        name: "This test computer",
        exact: true,
      }),
    });
  await card.getByText("Revoked", { exact: true }).waitFor();
  await fits(web, "Web Devices reflects Desktop withdrawal English light");
  await shot(
    "web",
    "device-withdrawn",
    web,
    "Actual Web device list reflects signed Desktop withdrawal and retains another computer",
  );
  pass(
    "The same durable device signature retries against the real company API, revokes only its original native family/device, updates Web Devices and selects the fixed Windows uninstall URI",
  );
  assert.equal((await system.db.control.query("SELECT state FROM devices WHERE id=$1",[unknownDevice])).rows[0].state,"revoked");
  assert.equal((await system.db.control.query("SELECT state FROM desktop_pairings WHERE user_id=$1 AND id=$2",[user,unknownIntent.request.input.id])).rows[0].state,"retired");
  stage = "responsive theme and scroll";
  await electron.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(860, 680),
  );
  await native.locator('button[title="Theme: light / dark / system"]').click();
  await native.locator('button[title="切換至繁體中文"]').click();
  await native
    .getByRole("button", { name: "前往 Windows 卸載", exact: true })
    .waitFor();
  await fits(native, "Desktop Traditional Chinese dark 860px", true);
  await shot(
    "desktop",
    "computer-zh-dark",
    native,
    "Actual Traditional Chinese dark frameless Desktop withdrawal receipt, with hidden scroll rails and no horizontal overflow",
  );
  const before = await native.locator("#root").evaluate((e) => e.scrollTop);
  await native.locator("#root").hover();
  await native.mouse.wheel(0, 700);
  await until(
    () => native.locator("#root").evaluate((e) => e.scrollTop),
    (v) => v > before,
    "real wheel scrolling",
  );
  pass(
    "Narrow Traditional Chinese/dark Desktop retains frameless controls, hidden vertical rails, no horizontal overflow and real wheel scrolling",
  );
  stage = "new customer PKCE login";
  await native.locator('button[title="Switch to English"]').click();
  await native
    .getByRole("button", {
      name: "Sign in to this computer again",
      exact: true,
    })
    .click({ noWaitAfter: true });
  const authorize = await until(
    () => electron!.evaluate(() => (globalThis as any).__removalQA.urls),
    (urls) => urls.some((u: string) => u.startsWith(webOrigin + "/authorize?")),
    "native PKCE URL",
  );
  const authorizationUrl = authorize.findLast((u: string) =>
    u.startsWith(webOrigin + "/authorize?"),
  );
  assert.ok(authorizationUrl);
  await web.goto(authorizationUrl);
  await web
    .getByRole("link", { name: "Authorize & return", exact: true })
    .click();
  await web.getByText("Signed in.", { exact: false }).waitFor();
  await until(
    () =>
      native.evaluate(() =>
        (window as any).copyPasteBridge.desktopRemoval("status"),
      ),
    (s) => s.disabled === false,
    "fresh local activation",
  );
  const newAuth = JSON.parse(
    await vault.decrypt(await readFile(path.join(userDir, "auth.enc"))),
  );
  assert.notEqual(newAuth.refresh_token, refresh);
  assert.notEqual(newAuth.session_epoch, epoch);
  assert.deepEqual(
    JSON.parse(
      await vault.decrypt(await readFile(path.join(userDir, "folders.enc"))),
    ).grants,
    [],
  );
  assert.deepEqual(
    JSON.parse(
      await vault.decrypt(await readFile(path.join(userDir, "extensions.enc"))),
    ),
    [],
  );
  pass(
    "Actual Web authorization, PKCE callback and company token exchange reconnect a new native family without restoring old folder grants or Chrome origins",
  );
  const prompts = await electron.evaluate(
    () => (globalThis as any).__removalQA.prompts,
  );
  assert.equal(prompts.length, 2);
  assert.ok(
    prompts.every(
      (p: any) => p.defaultId === 0 && p.cancelId === 0 && p.checkbox,
    ),
  );
  assert.equal(errors.length, 0, errors.join("\n"));
} catch (error) {
  errors.push(stage + ": " + String(error));
} finally {
  if (recording)
    try {
      recordings.push(await recording.stop());
    } catch (error) {
      errors.push(String(error));
    }
  if (host && host.exitCode === null) {
    host.kill();
    if (hostClosed) await hostClosed;
    nativeHostClosed = true;
  }
  if (electron)
    try {
      await electron.close();
      electronClosed = true;
    } catch (error) {
      errors.push(String(error));
    }
  if (browser)
    try {
      await browser.close();
      browserClosed = true;
    } catch (error) {
      errors.push(String(error));
    }
  if (system)
    try {
      await system.app.close();
      apiClosed = true;
    } catch (error) {
      errors.push(String(error));
    }
  if (isolated)
    try {
      await isolated.cleanup();
      fixtureClosed = true;
    } catch (error) {
      errors.push(String(error));
    }
  const report = {
    at: new Date().toISOString(),
    status:
      !errors.length &&
      browserClosed &&
      electronClosed &&
      apiClosed &&
      fixtureClosed &&
      nativeHostClosed
        ? "passed"
        : "failed",
    checks,
    screenshots,
    recordings,
    layouts,
    errors,
    withdrawal_responses: withdrawalResponses,
    electron_closed: electronClosed,
    browser_closed: browserClosed,
    api_closed: apiClosed,
    fixture_closed: fixtureClosed,
    native_host_closed: !host || nativeHostClosed,
    limitations: [
      "Synthetic customer, credentials and gateway data; real isolated native PostgreSQL, HTTP, PKCE, DPAPI and Electron IPC",
      "Native consent answers and shell URL launches are controlled inside this owned test process; no customer consent or Windows Settings window is fabricated as manual evidence",
      "No company-signed installed app was uninstalled; this test never deletes a real installation",
      "Affected workflow only; original full-product/live acceptance gates remain open",
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
