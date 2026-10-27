import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const report = {
  at: new Date().toISOString(),
  executable: process.env.CHROME_BIN ?? chromium.executablePath(),
  scope:
    "Owned software-rendered Chromium readiness after an initial-load/shutdown timeout, not product acceptance",
  checks: [],
  errors: [],
  closed: false,
};
const variant =
  process.argv.find((arg) => arg.startsWith("--case="))?.slice(7) ?? "full";
if (!["full", "viewport", "storage", "plain"].includes(variant))
  throw new Error("Unknown controlled diagnostic case");
report.variant = variant;
let server, browser;
const bound = setTimeout(() => {
  report.errors.push("Diagnostic exceeded its 45 second bound");
  void server?.kill();
}, 45000);
try {
  server = await chromium.launchServer({
    headless: true,
    executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
    args: ["--disable-gpu"],
    timeout: 15000,
  });
  browser = await chromium.connect(server.wsEndpoint());
  report.browser_version = browser.version();
  const context = await browser.newContext({
    viewport:
      variant === "storage" || variant === "plain"
        ? { width: 1280, height: 720 }
        : { width: 1440, height: 1000 },
  });
  if (variant === "storage" || variant === "full")
    await context.addInitScript(() => {
      localStorage.setItem("cp_locale", "en");
      localStorage.setItem("cp_theme", "light");
    });
  const page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.goto("http://localhost:4317/login", {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });
  console.log("Diagnostic reached DOMContentLoaded");
  const snapshot = await page.evaluate(() => ({
    ready: document.readyState,
    title: document.title,
    body: document.body?.innerText.slice(0, 500),
    email_fields: document.querySelectorAll('input[name="email"]').length,
  }));
  report.snapshot = snapshot;
  console.log(JSON.stringify(snapshot));
  await page.locator('input[name="email"]').waitFor({ timeout: 15000 });
  const ready = await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    return {
      ready: document.readyState,
      email_fields: document.querySelectorAll('input[name="email"]').length,
    };
  });
  report.checks.push({
    name: "real login DOM, timer and two animation frames",
    status: "passed",
    ...ready,
  });
} catch (error) {
  report.errors.push(error.message);
} finally {
  try {
    await browser?.close();
    await server?.close();
    report.closed = true;
  } catch (error) {
    report.errors.push("close: " + error.message);
    await server?.kill();
    report.closed = true;
  }
  clearTimeout(bound);
  await writeFile(
    "evidence/auth-recovery-browser-readiness-" + variant + ".json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
  if (report.errors.length) process.exitCode = 1;
}
