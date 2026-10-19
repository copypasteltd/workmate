import {
  chromium,
  _electron,
  type Browser,
  type BrowserContext,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
import { emailCode } from "./qa-auth.js";

const root = path.resolve(".."),
  platform = path.join(root, "copypaste-platform"),
  desktop = path.join(root, "copypaste-desktop"),
  extension = path.join(root, "copypaste-extension"),
  run = randomUUID(),
  email = `controls-ui-${run}@example.invalid`,
  checks: any[] = [],
  errors: string[] = [],
  occupants: string[] = [],
  created: string[] = [],
  observations: any[] = [],
  contexts: BrowserContext[] = [];
let browser: Browser | undefined,
  mv3: BrowserContext | undefined,
  app: ElectronApplication | undefined,
  db: any,
  web: Page,
  base = "",
  tenant = "",
  project = "",
  browserClosed = false,
  desktopClosed = false,
  extensionClosed = false;
const pass = (name: string) => {
  checks.push({ name, status: "passed" });
  console.log("PASS: " + name);
};
async function until<T>(
  read: () => Promise<T>,
  accept: (v: T) => boolean,
  label: string,
  limit = 20000,
) {
  const end = Date.now() + limit;
  do {
    const v = await read();
    if (accept(v)) return v;
    await new Promise((r) => setTimeout(r, 200));
  } while (Date.now() < end);
  throw new Error("Timed out: " + label);
}
async function api(url: string, method = "GET", body?: unknown) {
  return web.evaluate(
    async ({ url, method, body }) => {
      const me = await (await fetch("/v1/session/context")).json(),
        r = await fetch(url, {
          method,
          headers: {
            "X-CSRF-Token": me.csrf_token,
            "Idempotency-Key": crypto.randomUUID(),
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      const result = await r.json();
      if (!r.ok)
        throw new Error(`${method} ${url}: ${r.status} ${result.error?.code}`);
      return result;
    },
    { url, method, body },
  );
}
async function signIn(page: Page) {
  await page.locator('input[name="email"]').fill(email);
  const code = await emailCode(page, () =>
    page.locator('form button[type="submit"]').click(),
  );
  await page.locator('input[name="code"]').fill(code);
  await page.locator('form button[type="submit"]').click();
}
async function newTask(surface: string) {
  const t = await api(base + "/tasks", "POST", {
    title: `${surface} queue controls ${run.slice(0, 8)}`,
    prompt:
      "Write a clearly simulated campaign brief and deliver an editable Markdown file.",
    role_key: "assistant",
    mode: "execute",
    budget_micros: 1000000,
  });
  created.push(t.id);
  await until(
    () => api(base + "/tasks/" + t.id),
    (v) => v.capacity_wait_reason === "tenant",
    "tenant queue capacity",
  );
  return t;
}
async function snapshot(id: string) {
  const t = await api(base + "/tasks/" + id),
    r = (await db.query("SELECT * FROM reservations WHERE task_id=$1", [id]))
      .rows[0];
  return {
    id: t.id,
    status: t.status,
    attempt: t.attempt,
    budget_micros: t.budget_micros,
    reservation_status: r.status,
    reservation_micros: r.amount_micros,
    charged_micros: t.charged_micros,
    runtime_thread: t.runtime_thread,
  };
}
async function roundTrip(
  surface: string,
  page: Page,
  t: any,
  panel = false,
  cancel = true,
) {
  const pause = panel
    ? page.locator("#control-task")
    : page.getByRole("button", { name: "Pause queued task", exact: true });
  await pause.click();
  const resume = panel
    ? page.locator("#control-task").filter({ hasText: "Resume task" })
    : page.getByRole("button", { name: "Resume task", exact: true });
  await resume.waitFor();
  const first = await snapshot(t.id);
  assert.equal(first.status, "paused");
  assert.equal(first.attempt, 0);
  assert.equal(first.reservation_status, "reserved");
  assert.equal(first.reservation_micros, "1000000");
  assert.equal(first.charged_micros, "0");
  assert.equal(first.runtime_thread, null);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  const repository = panel
      ? extension
      : surface === "Desktop"
        ? desktop
        : path.join(root, "copypaste-web"),
    image = panel
      ? "10-task-paused.png"
      : surface === "Desktop"
        ? "21-task-paused.png"
        : "49-task-paused.png";
  await page.screenshot({
    path: path.join(repository, "assets/screenshots", image),
    animations: "disabled",
    fullPage: panel,
  });
  await resume.click();
  await until(
    () => snapshot(t.id),
    (v) => v.status === "queued",
    surface + " resume same task",
  );
  const resumed = await snapshot(t.id);
  assert.equal(resumed.id, first.id);
  assert.equal(resumed.reservation_micros, first.reservation_micros);
  observations.push({ surface, paused: first, resumed });
  if (cancel) {
    await (
      panel
        ? page.locator("#cancel-task")
        : page.getByRole("button", { name: "Cancel task", exact: true })
    ).click();
    await until(
      () => snapshot(t.id),
      (v) => v.status === "cancelled",
      surface + " cancellation",
    );
    assert.equal((await snapshot(t.id)).reservation_status, "released");
  }
  pass(
    `${surface}: real login and UI pause/resume preserve the original unclaimed task and reservation${cancel ? "; cancellation releases its hold" : ""}`,
  );
}
try {
  const config = await until<any>(
    async () => {
      try {
        return await (
          await fetch("http://localhost:4310/v1/public/config", {
            signal: AbortSignal.timeout(3000),
          })
        ).json();
      } catch {
        return null;
      }
    },
    Boolean,
    "native demo API readiness",
    30000,
  );
  assert.equal(
    config.data_mode,
    "simulated",
    "Only the isolated native demo may use synthetic capacity occupants",
  );
  const env = parseEnv(await readFile(path.join(platform, ".env"), "utf8")),
    url = new URL(env.CONTROL_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(url.hostname));
  assert.equal(url.pathname, "/copypaste");
  const pg = createRequire(path.join(platform, "package.json"))("pg");
  db = new pg.Client({ connectionString: url.href });
  await db.connect();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  contexts.push(context);
  await context.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  web = await context.newPage();
  web.on("pageerror", (e) => errors.push(e.message));
  await web.goto("http://localhost:4317/login");
  await signIn(web);
  await web.waitForURL("**/welcome");
  await web
    .locator('input[name="name"]')
    .fill("Synthetic queue controls studio");
  await web
    .locator('input[name="project_name"]')
    .fill("Native controls verification");
  await web.locator('form button[type="submit"]').click();
  await web.waitForURL("**/app");
  await web
    .getByRole("button", { name: "Add one-time demo credit", exact: true })
    .click();
  await web
    .getByRole("button", { name: "Demo credit added", exact: true })
    .waitFor();
  const me = await api("/v1/session/context");
  tenant = me.memberships[0].id;
  project = (await api(`/v1/tenants/${tenant}/projects`)).items[0].id;
  base = `/v1/tenants/${tenant}/projects/${project}`;
  const helper = (
    await db.query(
      "INSERT INTO users(email,name) VALUES($1,'Synthetic capacity fixture') RETURNING id",
      [`controls-occupant-${run}@example.invalid`],
    )
  ).rows[0].id;
  for (let i = 0; i < 2; i++)
    occupants.push(
      (
        await db.query(
          `INSERT INTO tasks(tenant_id,project_id,created_by,private_owner,title,prompt,role_key,role_hash,budget_micros,idempotency_key,status,attempt,fencing_token,lease_until)
     VALUES($1,$2,$3,$3,'SIMULATED queue occupant','Never dispatched; fixture occupancy only.','assistant',$4,1,$5,'running',1,$6,now()+interval '10 minutes') RETURNING id`,
          [
            tenant,
            project,
            helper,
            "0".repeat(64),
            "qa-controls-" + run + ":" + i,
            randomUUID(),
          ],
        )
      ).rows[0].id,
    );
  const first = await newTask("Web");
  await web.goto("http://localhost:4317/app/tasks/" + first.id);
  await roundTrip("Web", web, first);

  app = await _electron.launch({
    executablePath: path.join(
      desktop,
      "node_modules/electron/dist/electron.exe",
    ),
    args: [desktop],
    env: {
      ...process.env,
      COPYPASTE_USER_DATA: path.resolve(".data/controls-desktop-" + run),
    },
  });
  const native = await app.firstWindow();
  await native.waitForURL(/file:.*index\.html/);
  await native.waitForLoadState("load");
  native.on("pageerror", (e) => errors.push(e.message));
  await native.evaluate(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  await native.reload();
  await app.evaluate(({ shell }) => {
    shell.openExternal = async (value: string) => {
      (globalThis as any).__controlAuth = value;
    };
  });
  await native
    .getByRole("button", { name: "Sign in securely in your browser" })
    .click({ noWaitAfter: true });
  const authURL = await until<string>(
    () => app!.evaluate(() => (globalThis as any).__controlAuth ?? ""),
    Boolean,
    "Desktop PKCE URL",
  );
  const authContext = await browser.newContext();
  contexts.push(authContext);
  const auth = await authContext.newPage();
  await auth.addInitScript(() => localStorage.setItem("cp_locale", "en"));
  await auth.goto(authURL);
  await signIn(auth);
  await auth
    .getByRole("link", { name: /Authorize & return|授權並返回應用/ })
    .click();
  await native.waitForURL("**#/app");
  const second = await newTask("Desktop");
  await native.evaluate((id) => {
    location.hash = "/app/tasks/" + id;
  }, second.id);
  await roundTrip("Desktop", native, second);

  mv3 = await chromium.launchPersistentContext(
    path.resolve(".data/controls-extension-" + run),
    {
      executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
      headless: true,
      args: [
        "--disable-extensions-except=" + path.join(extension, "dist"),
        "--load-extension=" + path.join(extension, "dist"),
      ],
      viewport: { width: 380, height: 1050 },
    },
  );
  const worker =
      mv3.serviceWorkers()[0] ?? (await mv3.waitForEvent("serviceworker")),
    extensionId = (
      await readFile(path.join(extension, "extension-id.txt"), "utf8")
    ).trim();
  await worker.evaluate(() => chrome.storage.local.set({ locale: "en" }));
  const panel = await mv3.newPage();
  panel.on("pageerror", (e) => errors.push(e.message));
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const popupEvent = mv3.waitForEvent("page");
  await panel.locator("#sign-in").click();
  const popup = await popupEvent;
  await popup.waitForLoadState();
  await signIn(popup);
  await popup
    .getByRole("link", { name: /Authorize & return|授權並返回應用/ })
    .click();
  await panel.locator("#workspace").waitFor({ state: "visible" });
  const third = await newTask("Extension");
  await panel.reload();
  await panel
    .locator("#task-list .task-row")
    .filter({ hasText: third.title })
    .click();
  await roundTrip("Extension", panel, third, true);

  const last = await newTask("Web completion");
  await web.goto("http://localhost:4317/app/tasks/" + last.id);
  await roundTrip("Web completion", web, last, false, false);
  await db.query(
    "UPDATE tasks SET status='cancelled',lease_until=NULL WHERE id=ANY($1::uuid[]) AND idempotency_key LIKE $2",
    [occupants, "qa-controls-" + run + "%"],
  );
  const done = await until(
    () => api(base + "/tasks/" + last.id),
    (v) => v.status === "succeeded",
    "real Codex completion",
    60000,
  );
  assert.equal(done.attempt, 1);
  assert.ok(Number(done.charged_micros) > 0);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM reservations WHERE task_id=$1",
        [last.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM ledger WHERE task_id=$1 AND kind='charge'",
        [last.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal((await snapshot(last.id)).reservation_status, "settled");
  const assets = (await api(base + "/assets")).items;
  assert.ok(assets.some((a: any) => a.name === "demo-report.md"));
  pass(
    "releasing only owned synthetic occupants runs the resumed original task through real Codex, produces an actual file and settles one reservation once",
  );
  assert.deepEqual(errors, []);
} catch (e: any) {
  errors.push(e.message);
  process.exitCode = 1;
} finally {
  if (db) {
    await db
      .query(
        "UPDATE tasks SET status='cancelled',lease_until=NULL WHERE id=ANY($1::uuid[]) AND idempotency_key LIKE $2",
        [occupants, "qa-controls-" + run + "%"],
      )
      .catch((e: Error) => errors.push(e.message));
    for (const id of created) {
      try {
        const t = await api(base + "/tasks/" + id);
        if (["queued", "paused", "needs_input"].includes(t.status))
          await api(base + "/tasks/" + id + "/cancel", "POST", {});
      } catch (e: any) {
        errors.push("Owned task cleanup: " + e.message);
      }
    }
  }
  try {
    if (app) {
      await app.close();
      desktopClosed = true;
    }
  } finally {
    try {
      if (mv3) {
        await mv3.close();
        extensionClosed = true;
      }
    } finally {
      try {
        for (const c of contexts)
          await c
            .close()
            .catch((e: Error) =>
              errors.push("Owned context cleanup: " + e.message),
            );
        if (browser) {
          await browser.close();
          browserClosed = true;
        }
      } finally {
        if (db) await db.end();
        if (
          errors.length ||
          !browserClosed ||
          !desktopClosed ||
          !extensionClosed
        )
          process.exitCode = 1;
        await mkdir("evidence", { recursive: true });
        await writeFile(
          "evidence/task-controls.json",
          JSON.stringify(
            {
              at: new Date().toISOString(),
              dependency_mode: "simulated",
              real_codex: true,
              scope:
                "Initial unclaimed checkpoint only; Extension business document in isolated MV3 tab; native Side Panel appearance has separate evidence",
              checks,
              observations,
              errors,
              browser_closed: browserClosed,
              desktop_closed: desktopClosed,
              extension_closed: extensionClosed,
            },
            null,
            2,
          ) + "\n",
        );
      }
    }
  }
}
