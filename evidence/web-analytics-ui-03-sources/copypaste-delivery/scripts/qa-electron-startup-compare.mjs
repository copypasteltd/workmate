import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
const exec = promisify(execFile),
  desktop = path.resolve("../copypaste-desktop"),
  file = path.join(desktop, "dist/main.js");
const original = await readFile(file),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const baseline = (
  await exec("git", ["show", "HEAD:src/main.ts"], {
    cwd: desktop,
    windowsHide: true,
  })
).stdout;
const { transform } = createRequire(path.join(desktop, "package.json"))(
  "esbuild",
);
const previous = await transform(baseline, {
  loader: "ts",
  format: "esm",
  target: "es2022",
});
const report = {
  at: new Date().toISOString(),
  baseline_head:(await exec("git",["rev-parse","HEAD"],{cwd:desktop,windowsHide:true})).stdout.trim(),
  current_main_sha256:sha(original),
  scope:
    "Owned raw Electron startup comparison of committed main and current built main, with the same current renderer/dependencies; compiled output restored byte-for-byte; not authentication acceptance",
  cases: [],
  restored: false,
};
try {
  for (const [name, bytes] of [
    ["committed_main", Buffer.from(previous.code)],
    ["current_main", original],
  ]) {
    await writeFile(file, bytes);
    const profile = path.resolve(".data/startup-compare-" + randomUUID());
    await mkdir(profile, { recursive: true });
    const child = spawn(
      path.join(desktop, "node_modules/electron/dist/electron.exe"),
      ["--remote-debugging-port=0", "--disable-gpu", desktop],
      {
        windowsHide: true,
        env: { ...process.env, COPYPASTE_USER_DATA: profile },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let logs = "";
    child.stdout.on("data", (b) => (logs += b));
    child.stderr.on("data", (b) => (logs += b));
    const result = {
      name,
      page_target: false,
      cdp_responded: false,
      closed: false,
      errors: [],
    };
    try {
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        try {
          const port = Number(
            (
              await readFile(path.join(profile, "DevToolsActivePort"), "utf8")
            ).split("\n")[0],
          );
          const response = await fetch(
            "http://127.0.0.1:" + port + "/json/list",
            { signal: AbortSignal.timeout(2000) },
          );
          const targets = await response.json();
          result.cdp_responded = true;
          result.page_target = targets.some((t) => t.type === "page");
          if (result.page_target) break;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } finally {
      if(child.exitCode===null)await exec("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
      }).catch(() => {});
      result.closed = true;
      result.startup_error_lines = logs
        .split("\n")
        .filter((line) => /error|exception|cannot|ERR_/i.test(line))
        .slice(0, 8);
      report.cases.push(result);
    }
  }
} finally {
  await writeFile(file, original);
  report.restored = sha(await readFile(file)) === sha(original);
  await writeFile(
    "evidence/auth-recovery-electron-startup-compare.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
