import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserServer,
  type Page,
} from "playwright";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { parseEnv } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const platform = path.resolve("../copypaste-platform"),
  origin = "http://localhost:4310",
  admin = "http://localhost:4318",
  web = "http://localhost:4317",
  requirePlatform = createRequire(path.join(platform, "package.json")),
  pg = requirePlatform("pg"),
  OTPAuth = requirePlatform("otpauth"),
  sha = (data: string | Buffer) =>
    createHash("sha256").update(data).digest("hex");
type Client = { id: string; cookie: string; csrf: string; user?: boolean };
const clients: Client[] = [],
  principals: string[] = [],
  contexts: BrowserContext[] = [],
  samples: any[] = [],
  checks: any[] = [],
  errors: string[] = [],
  screenshots: string[] = [],
  screenshotFacts: any[] = [];
let db: any,
  browser: Browser | undefined,
  server: BrowserServer | undefined,
  stage = "initializing",
  closed = false,
  sessionsClosed = false,
  adminsDisabled = false,
  check: (schema: string, data: unknown) => void;
const pass = (name: string) => checks.push({ name, status: "passed" });
async function sourceSnapshot() {
  const files: string[] = [];
  for (const repo of [
    "copypaste-platform",
    "copypaste-admin",
    "copypaste-web",
    "copypaste-desktop",
    "copypaste-extension",
  ]) {
    const list = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: path.resolve("..", repo), encoding: "utf8", windowsHide: true },
    ).split("\0");
    for (const f of list)
      if (
        /^(src|renderer|migrations|catalog|contracts|public)\//.test(f) ||
        /^(package(-lock)?|tsconfig)\.json$/.test(f)
      )
        files.push(`${repo}/${f}`);
  }
  files.push("copypaste-delivery/scripts/qa-vip-layout.ts");
  return Object.fromEntries(
    await Promise.all(
      files
        .sort()
        .map(async (f) => [f, sha(await readFile(path.resolve("..", f)))]),
    ),
  );
}
const beforeSources = await sourceSnapshot();
const deadline = setTimeout(() => {
  errors.push("Owned VIP QA exceeded 360 seconds at " + stage);
  void server?.kill();
}, 360000);
async function call(
  c: Client | undefined,
  method: string,
  endpoint: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const r = await fetch(origin + endpoint, {
    method,
    headers: {
      Origin:
        c?.user ||
        endpoint.startsWith("/v1/auth/") ||
        endpoint === "/v1/tenants" ||
        endpoint.startsWith("/v1/effective-entitlements") ||
        endpoint.startsWith("/v1/plans")
          ? web
          : admin,
      "Idempotency-Key": randomUUID(),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(c ? { Cookie: c.cookie, "X-CSRF-Token": c.csrf } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, data: await r.json(), headers: r.headers };
}
function sample(
  name: string,
  operation: string,
  schema: string,
  data: unknown,
  status = 200,
) {
  check(schema, data);
  samples.push({ name, operation, schema, status, response: data });
}
async function login(email: string, secret: any) {
  const challenge = await call(undefined, "POST", "/v1/admin/auth/challenge", {
    email,
  });
  assert.equal(challenge.status, 200);
  const until = Date.now() + 15000;
  let mail: any;
  while (Date.now() < until) {
    try {
      mail = JSON.parse(
        await readFile(
          path.join(
            platform,
            ".data/mailbox",
            challenge.data.challenge_id + ".json",
          ),
          "utf8",
        ),
      );
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.equal(mail?.to, email);
  const result = await call(undefined, "POST", "/v1/admin/auth/verify", {
    challenge_id: challenge.data.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
    totp: new OTPAuth.TOTP({
      secret,
      digits: 6,
      period: 30,
      algorithm: "SHA1",
    }).generate(),
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const c = {
    id: "",
    cookie: result.headers
      .getSetCookie()
      .find((v) => v.startsWith("cp_admin_session="))!
      .split(";")[0],
    csrf: result.data.csrf_token,
  };
  clients.push(c);
  const me = await call(c, "GET", "/v1/admin/me");
  assert.equal(me.status, 200);
  c.id = me.data.user.id;
  c.csrf = me.data.csrf_token;
  return c;
}
async function pageFor(
  c: Client,
  width = 1440,
  locale = "en",
  theme = "light",
) {
  const context = await browser!.newContext({
    viewport: { width, height: 1080 },
  });
  contexts.push(context);
  context.setDefaultTimeout(15000);
  const i = c.cookie.indexOf("=");
  await context.addCookies([
    {
      name: c.cookie.slice(0, i),
      value: c.cookie.slice(i + 1),
      url: c.user ? web : admin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await context.addInitScript(
    ({ locale, theme }) => {
      localStorage.setItem("cp_locale", locale);
      localStorage.setItem("cp_theme", theme);
    },
    { locale, theme },
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
}
async function capture(page: Page, name: string, repo = "copypaste-admin") {
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    document
      .querySelectorAll(".modal-backdrop")
      .forEach((e) => (e.scrollTop = 0));
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Page must not overflow horizontally",
  );
  const folder = path.resolve("..", repo, "assets/screenshots");
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, name);
  await page.screenshot({
    path: file,
    fullPage: (await page.locator(".modal-backdrop").count()) === 0,
  });
  screenshots.push(name);
  screenshotFacts.push({
    file: "dev/" + repo + "/assets/screenshots/" + name,
    sha256: sha(await readFile(file)),
    url: page.url(),
    viewport: page.viewportSize(),
    locale: await page.evaluate(() => document.documentElement.lang),
    theme: await page.evaluate(() => document.documentElement.dataset.theme),
  });
}
async function waitResponse(
  page: Page,
  suffix: string,
  click: () => Promise<unknown>,
) {
  const pending = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname.endsWith(suffix),
  );
  await click();
  return pending;
}
try {
  const configured = await (await fetch(origin + "/v1/public/config")).json();
  assert.equal(configured.data_mode, "simulated");
  const env = parseEnv(await readFile(path.join(platform, ".env"), "utf8")),
    url = new URL(env.CONTROL_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  assert.equal(url.pathname, "/copypaste");
  db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const fixture = JSON.parse(
      await readFile(
        path.join(platform, "contracts/admin-vip-schemas.json"),
        "utf8",
      ),
    ),
    specBytes = await readFile("../../docs/contracts/openapi.json"),
    spec = JSON.parse(specBytes.toString());
  assert.equal(fixture.normative_source_sha256, sha(specBytes));
  for (const [name, schema] of Object.entries(fixture.schemas))
    assert.deepEqual(schema, spec.components.schemas[name]);
  const { Ajv2020 } = requirePlatform("ajv/dist/2020.js"),
    ajv = new Ajv2020({ allErrors: true });
  requirePlatform("ajv-formats")(ajv);
  const defs = JSON.parse(
    JSON.stringify(fixture.schemas).replaceAll(
      "#/components/schemas/",
      "#/$defs/",
    ),
  );
  check = (schema, data) => {
    const v = ajv.compile({ $defs: defs, $ref: "#/$defs/" + schema });
    assert.ok(v(data), schema + JSON.stringify(v.errors));
  };
  const { seal } = await import(
    pathToFileURL(path.join(platform, "src/lib.ts")).href
  );
  for (let n = 0; n < 2; n++) {
    const secret = new OTPAuth.Secret({ size: 20 }),
      email = `vip-ui-${randomUUID()}@example.invalid`,
      p = (
        await db.query(
          "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id",
          [
            email,
            n ? "Synthetic VIP reviewer" : "Synthetic VIP operator",
            seal(env.MASTER_KEY!, secret.base32),
          ],
        )
      ).rows[0];
    principals.push(p.id);
    await db.query(
      "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,'super_admin','global')",
      [p.id],
    );
    await login(email, secret);
  }
  const [operator, reviewer] = clients;

  stage = "375px layout measurement";
  server = await chromium.launchServer({headless:true, executablePath: process.env.CHROME_BIN ?? chromium.executablePath(), args:["--disable-gpu"]});
  browser = await chromium.connect(server.wsEndpoint());
  const page = await pageFor(operator,375,"zh-HK","dark");
  await page.goto(admin + "/entitlements");
  await page.getByRole("button",{name:"開通 VIP",exact:true}).click();
  await page.getByLabel("已發佈的固定方案版本",{exact:true}).locator("option").nth(1).waitFor({state:"attached"});
  const metrics = await page.evaluate(() => ({viewport:innerWidth, scroll:document.documentElement.scrollWidth, offenders:[...document.querySelectorAll("body *")].map(el=>{const r=el.getBoundingClientRect();return {tag:el.tagName,id:el.id,cls:el.className,width:r.width,x:r.x,right:r.right,text:el.textContent?.slice(0,80)}}).filter(x=>x.right>innerWidth+1 && x.width>0).sort((a,b)=>b.right-a.right).slice(0,25)}));
  await writeFile("evidence/vip-mobile-layout-metrics.json",JSON.stringify(metrics,null,2)+"\n");
  await page.screenshot({path:"evidence/vip-mobile-layout-original.png"});
  console.log(JSON.stringify(metrics));
  assert.ok(metrics.scroll<=metrics.viewport+1,"Actual mobile page overflows");
  pass("measured actual 375px grant form without horizontal overflow");
} catch (e) {
  errors.push(stage + ": " + (e instanceof Error ? e.message : String(e)));
} finally {
  try {
    for (const c of contexts) await c.close();
    await browser?.close();
    await server?.close();
    closed = true;
  } catch {
    await server?.kill();
    closed = true;
  }
  clearTimeout(deadline);
  if (
    server &&
    server.process().exitCode === null &&
    server.process().signalCode === null
  ) {
    closed = false;
    errors.push("Owned Chromium process did not exit");
  }
  if (db && clients.length > 1)
    try {
      const pending = (
        await db.query(
          "SELECT r.* FROM admin_approval_requests r JOIN admin_operations o ON o.id=r.operation_id WHERE o.principal_id=ANY($1::uuid[]) AND r.state='pending' AND o.state='pending_approval'",
          [principals],
        )
      ).rows;
      for (const request of pending) {
        const reviewer = clients.find((c) => c.id !== request.requester_id)!;
        assert.equal(
          (
            await call(
              reviewer,
              "POST",
              `/v1/admin/approvals/${request.id}/decisions`,
              {
                expected_version: request.version,
                payload_hash: request.payload_hash,
                decision: "reject",
                reason: "Close unexecuted synthetic VIP QA request",
              },
            )
          ).status,
          202,
        );
      }
    } catch {
      errors.push("Owned pending VIP request cleanup failed");
    }
  for (const c of clients)
    try {
      if (
        (
          await call(
            c,
            "POST",
            c.user ? "/v1/auth/logout" : "/v1/admin/auth/logout",
          )
        ).status !== 200
      )
        errors.push("Owned logout failed");
    } catch {
      errors.push("Owned logout failed");
    }
  if (db)
    try {
      await db.query(
        "UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE admin_id=ANY($1::uuid[])",
        [principals],
      );
      await db.query(
        "UPDATE admin_principals SET status='suspended',auth_version=auth_version+1,version=version+1 WHERE id=ANY($1::uuid[])",
        [principals],
      );
      sessionsClosed =
        Number(
          (
            await db.query(
              "SELECT count(*) AS n FROM sessions WHERE (admin_id=ANY($1::uuid[]) OR user_id=ANY($2::uuid[])) AND revoked_at IS NULL",
              [principals, clients.filter((c) => c.user).map((c) => c.id)],
            )
          ).rows[0].n,
        ) === 0;
      adminsDisabled =
        Number(
          (
            await db.query(
              "SELECT count(*) AS n FROM admin_principals WHERE id=ANY($1::uuid[]) AND status='active'",
              [principals],
            )
          ).rows[0].n,
        ) === 0;
    } catch {
      errors.push("Owned Admin cleanup failed");
    } finally {
      await db.end();
    }
  const afterSources = await sourceSnapshot(),
    unchanged = JSON.stringify(beforeSources) === JSON.stringify(afterSources);
  if (!unchanged) errors.push("VIP source changed during QA");
  const at = new Date().toISOString();
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/vip-layout.json",
    JSON.stringify(
      {
        at,
        status: errors.length ? "failed" : "passed",
        scope:
          "Canonical VIP lifecycle, real MFA/shared approval, frozen Admin forms and user effective rights only; seat/storage enforcement, atomic VIP plus gift and complete native/production acceptance remain separate",
        checks,
        errors,
        screenshots,
        browser_closed: closed,
        user_browser_tabs_touched: false,
        owned_sessions_closed: sessionsClosed,
        owned_admin_principals_disabled: adminsDisabled,
        source_unchanged: unchanged,
        source_files: beforeSources,
        model_calls: 0,
        external_payments: 0,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "evidence/vip-layout-contract-samples.json",
    JSON.stringify(
      {
        at,
        origin,
        scope:
          "Actual local HTTP from canonical VIP Admin forms, user reads and shared independent approval; original schemas unchanged",
        samples,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "evidence/vip-layout-screenshots.json",
    JSON.stringify(
      {
        at,
        scope:
          "Actual owned Chromium page screenshots; unedited, no synthetic UI",
        screenshots: screenshotFacts,
        source_files: beforeSources,
        browser_closed: closed,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      checks: checks.length,
      samples: samples.length,
      errors,
      browser_closed: closed,
      screenshots,
    }),
  );
  if (errors.length) process.exitCode = 1;
}
