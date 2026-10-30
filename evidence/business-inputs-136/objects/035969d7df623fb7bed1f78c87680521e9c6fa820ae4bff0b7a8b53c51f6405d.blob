#!/usr/bin/env node
import { readFile, lstat, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { configuration, companyApi, check, sha256 } from "./protocol.mjs";
import { NodeJournal } from "./journal.mjs";
import { DedicatedNodeAgent } from "./agent.mjs";
import { SystemdLeaseDriver } from "./systemd-driver.mjs";

check(process.platform === "linux" && process.getuid?.() === 0, "ROOT_NATIVE_LINUX_HOST_REQUIRED");
check(process.argv.length === 3 && process.argv[2] === "/etc/copypaste-cloud-node.json", "EXPLICIT_ROOT_NODE_CONFIGURATION_REQUIRED");
const stateDirectory = "/var/lib/workmate-cloud";
if (process.env.COPYPASTE_NODE_FLOCK !== "1") {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const child = spawn("/usr/bin/flock", ["--no-fork", "--exclusive", "--nonblock", stateDirectory + "/daemon.lock", process.execPath, fileURLToPath(import.meta.url), process.argv[2]], {
    shell: false, env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", COPYPASTE_NODE_FLOCK: "1" }, stdio: "inherit",
  });
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
  child.once("error", () => { process.exitCode = 1; }); child.once("close", code => { process.exitCode = code ?? 1; });
} else {
  const stat = await lstat(process.argv[2]);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o077) === 0 && stat.size <= 16_384, "ROOT_CONFIGURATION_PERMISSION_REQUIRED");
  const config = configuration(JSON.parse(await readFile(process.argv[2], "utf8")));
  const fingerprint = sha256((await readFile("/etc/machine-id", "utf8")).trim());
  check(fingerprint === config.machine_fingerprint, "ENROLLED_PHYSICAL_HOST_CHANGED");
  const journal = new NodeJournal(stateDirectory), driver = new SystemdLeaseDriver();
  await driver.preflight(config); await mkdir(stateDirectory + "/leases", { recursive: true, mode: 0o700 });
  const agent = new DedicatedNodeAgent({ config, api: companyApi(config), driver, journal }); let closing = false, active = false, lastFrame = -Infinity;
  const shutdown = () => { closing = true; }; process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
  try {
    await agent.initialize();
    const watch = setInterval(() => { if (active) return; active = true; agent.watchdog().catch(() => { closing = true; }).finally(() => { active = false; }); }, 250);
    try {
      while (!closing) {
        if (agent.fatalError) throw agent.fatalError;
        try {
          await agent.poll();
          if (performance.now() - lastFrame >= 3000) { lastFrame = performance.now(); await agent.frame(); }
        } catch { /* Short outages cannot extend the independently enforced lease. */ }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } finally { clearInterval(watch); }
  } catch { process.stderr.write("Cloud node requires operator reconciliation; private data and credentials are omitted.\n"); process.exitCode = 1; }
  finally { await agent.close().catch(() => { process.stderr.write("Host cleanup remains unconfirmed; keep the computer unavailable.\n"); process.exitCode = 1; }); }
}
