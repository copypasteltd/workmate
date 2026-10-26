import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const exec = promisify(execFile);
const fixture = path.resolve(".data/electron-runtime-" + randomUUID());
if (path.dirname(fixture) !== path.resolve(".data"))
  throw new Error("Fixture escaped the owned directory");
const executable = path.resolve(
  "../copypaste-desktop/node_modules/electron/dist/electron.exe",
);
const report = {
  at: new Date().toISOString(),
  scope:
    "Isolated native Electron CJS/ESM readiness with no product modules; not product acceptance",
  cases: [],
  temporary_fixture_removed: false,
};
await mkdir(fixture, { recursive: true });
try {
  for (const format of ["cjs", "mjs"]) {
    const entry = path.join(fixture, "main." + format);
    const profile = path.join(fixture, "profile-" + format);
    await mkdir(profile);
    await writeFile(
      entry,
      (format === "cjs"
        ? 'const { app, BrowserWindow } = require("electron");\n'
        : 'import { app, BrowserWindow } from "electron";\n') +
        `
const mark = (phase, data = {}) => process.stdout.write(JSON.stringify({ phase, ...data }) + "\\n");
mark("imported", { electron: process.versions.electron, chromium: process.versions.chrome });
app.setPath("userData", process.env.COPYPASTE_USER_DATA);
app.whenReady().then(async () => {
  mark("ready");
  const window = new BrowserWindow({ show: false, width: 1440, height: 980, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  mark("window-created");
  await window.loadURL("data:text/html,<title>owned readiness fixture</title><main>ready</main>");
  mark("page-loaded");
  const ready = await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(() => resolve(document.querySelector("main").textContent), 10))');
  mark("script-executed", { value: ready });
  window.destroy();
  app.quit();
}).catch(error => { mark("error", { message: error.message }); app.exit(1); });
app.on("window-all-closed", () => app.quit());
`,
    );
    const result = {
      format,
      phases: [],
      errors: [],
      closed: false,
      timed_out: false,
    };
    const child = spawn(executable, ["--disable-gpu", entry], {
      windowsHide: true,
      env: { ...process.env, COPYPASTE_USER_DATA: profile },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "",
      stderr = "";
    child.stdout.on("data", (b) => {
      output += b;
    });
    child.stderr.on("data", (b) => {
      stderr += b;
    });
    let timer;
    try {
      const exit = await Promise.race([
        new Promise((resolve) => {
          child.once("exit", (code, signal) => resolve({ code, signal }));
          child.once("error", (error) => resolve({ error: error.message }));
        }),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), 25000);
        }),
      ]);
      result.timed_out = exit === null;
      result.exit = exit;
    } finally {
      clearTimeout(timer);
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        await exec("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
        });
        result.forced_owned_cleanup = true;
      }
      result.closed = true;
      for (const line of output.split(/\r?\n/)) {
        try {
          result.phases.push(JSON.parse(line));
        } catch {}
      }
      result.errors = stderr.split(/\r?\n/).filter(Boolean).slice(0, 12);
      result.passed =
        !result.timed_out &&
        result.exit?.code === 0 &&
        result.phases.some(
          (p) => p.phase === "script-executed" && p.value === "ready",
        );
      report.cases.push(result);
      console.log(JSON.stringify(result));
    }
  }
} finally {
  await rm(fixture, { recursive: true, force: true });
  report.temporary_fixture_removed = true;
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/auth-recovery-electron-runtime-readiness.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}
if (report.cases.length !== 2 || report.cases.some((c) => !c.passed))
  process.exitCode = 1;
