import {sourceDatabasePort} from "./source-demo-runtime-158.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
const root = path.resolve(
  process.env.COPYPASTE_DEV_ROOT ?? path.join(import.meta.dirname, "../.."),
);
const stateDir = path.resolve(import.meta.dirname, "../.data"),
  stateFile = path.join(stateDir, "controller.json");
const token = randomBytes(32).toString("hex"),
  children = [];
let closing = false;
const occupied = (port) =>
  new Promise((resolve) => {
    const s = createConnection({ host: "127.0.0.1", port });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
for (const port of [4310, 4317, 4318, 4319, sourceDatabasePort()])
  if (await occupied(port))
    throw new Error(
      `Port ${port} is already in use. Existing processes were preserved. Stop your prior CopyPaste controller or configure a separate deployment.`,
    );
await mkdir(path.join(stateDir, "logs"), { recursive: true });
const control = createServer((req, res) => {
  if (
    req.method !== "POST" ||
    req.url !== "/shutdown" ||
    req.headers.authorization !== "Bearer " + token
  ) {
    res.writeHead(403).end();
    return;
  }
  res.end("Stopping CopyPaste");
  void shutdown();
});
await new Promise((resolve, reject) => {
  control.once("error", reject);
  control.listen(4319, "127.0.0.1", resolve);
});
await writeFile(
  stateFile,
  JSON.stringify({ pid: process.pid, token, port: 4319, root }),
  { mode: 0o600 },
);
async function launch(name, repo, args, ready) {
  const dir = path.join(root, repo),
    log = createWriteStream(path.join(stateDir, "logs", name + ".log"), {
      flags: "a",
    });
  const child = spawn(process.execPath, args, {
    cwd: dir,
    env: {
      ...process.env,
      ...(name === "api" && process.argv.includes("--demo")
        ? { DEMO_MODE: "true" }
        : {}),
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.push({ name, child, log });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  let output = "";
  child.stdout.on("data", (b) => {
    output = (output + b.toString()).slice(-20000);
  });
  for (let n = 0; n < 600; n++) {
    if (closing) throw new Error("Startup cancelled");
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`${name} exited. Review .data/logs/${name}.log`);
    if (await ready(output)) {
      console.log(name + " ready");
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(name + " startup timed out");
}
async function stopChild(entry) {
  const { child, log } = entry;
  if (child.exitCode !== null) {
    log.end();
    return;
  }
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(
      () => {
        if (entry.name === "database") {
          reject(
            new Error(
              "PostgreSQL is still checkpointing. Its process was preserved; inspect the database log before retrying shutdown.",
            ),
          );
          return;
        }
        child.kill();
        resolve();
      },
      entry.name === "database" ? 195000 : 30000,
    );
    child.once("exit", () => {
      clearTimeout(deadline);
      resolve();
    });
    if (["api", "database"].includes(entry.name) && child.connected)
      child.send({ action: "shutdown" });
    else child.kill();
  });
  log.end();
}
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  console.log("Stopping only processes started by this controller...");
  for (const name of ["api", "admin", "web", "database"]) {
    const e = children.find((e) => e.name === name);
    if (e) await stopChild(e);
  }
  await new Promise((r) => control.close(r));
  await rm(stateFile, { force: true });
  process.exitCode = code;
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
try {
  await launch(
    "database",
    "copypaste-platform",
    ["scripts/native-db-launch.mjs"],
    async (output) => output.includes("Native PostgreSQL ready"),
  );
  await launch(
    "api",
    "copypaste-platform",
    ["--env-file=.env", "--import", "tsx", "src/server.ts"],
    async () => {
      try {
        return (await fetch("http://localhost:4310/health/ready")).ok;
      } catch {
        return false;
      }
    },
  );
  await launch(
    "web",
    "copypaste-web",
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "4317",
      "--strictPort",
    ],
    async () => occupied(4317),
  );
  await launch(
    "admin",
    "copypaste-admin",
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "4318",
      "--strictPort",
    ],
    async () => occupied(4318),
  );
  console.log(
    "Web http://localhost:4317 · Admin http://localhost:4318 · API http://localhost:4310",
  );
  console.log(
    "Leave this process running. npm run stop closes this development stack.",
  );
} catch (e) {
  console.error(e.message);
  await shutdown(1);
}
