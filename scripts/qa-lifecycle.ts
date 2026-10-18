import { spawn, execFile } from "node:child_process";
import { promisify, parseEnv } from "node:util";
import { createConnection } from "node:net";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const repo = path.resolve(import.meta.dirname, "..");
const platform = path.resolve(repo, "../copypaste-platform");
const stateFile = path.join(repo, ".data/controller.json");
const databaseLog = path.join(repo, ".data/logs/database.log");
const ports = [4310, 4317, 4318, 4319, 55432];
const checks: { name: string; status: "passed" }[] = [];
const version = JSON.parse(
  await readFile(path.join(repo, "package.json"), "utf8"),
).version;
const env = parseEnv(await readFile(path.join(platform, ".env"), "utf8"));
const pg = createRequire(path.join(platform, "package.json"))("pg");
const listening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
async function waitFor(
  check: () => Promise<boolean>,
  ms: number,
  label: string,
) {
  const until = Date.now() + ms;
  do {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < until);
  throw new Error(label + " timed out");
}
async function existingListeners() {
  if (process.platform !== "win32") return [];
  const { stdout } = await promisify(execFile)(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "@(Get-NetTCPConnection -State Listen -LocalPort 5173,5174 -ErrorAction SilentlyContinue | Select-Object LocalPort,OwningProcess | Sort-Object LocalPort,OwningProcess -Unique) | ConvertTo-Json -Compress",
    ],
    { windowsHide: true },
  );
  const data = stdout.trim() ? JSON.parse(stdout) : [];
  return (Array.isArray(data) ? data : [data]) as {
    LocalPort: number;
    OwningProcess: number;
  }[];
}
async function snapshot() {
  const client = new pg.Client({ connectionString: env.CONTROL_DATABASE_URL });
  await client.connect();
  try {
    // Read metadata only; no customer text or credentials enter this report.
    const counts = (
      await client.query(`SELECT
      (SELECT count(*)::int FROM agents) AS agents,
      (SELECT count(*)::int FROM conversations) AS conversations,
      (SELECT count(*)::int FROM conversation_messages) AS messages,
      (SELECT count(*)::int FROM memories) AS memories,
      (SELECT count(*)::int FROM workflow_schedules) AS schedules,
      (SELECT count(*)::int FROM workflow_schedule_versions) AS schedule_versions,
      (SELECT count(*)::int FROM workflow_schedule_occurrences) AS schedule_occurrences,
      (SELECT count(*)::int FROM admin_principals) AS admin_principals,
      (SELECT count(*)::int FROM admin_enrollments) AS admin_enrollments,
      (SELECT count(*)::int FROM sessions WHERE admin_id IS NOT NULL) AS admin_sessions,
      (SELECT max(version) FROM schema_migrations) AS schema_version`)
    ).rows[0];
    const identity = [];
    for (const sql of [
      "SELECT id,status,enrollment_state,auth_version,version FROM admin_principals ORDER BY id",
      "SELECT id,principal_id,purpose,issued_auth_version,delivery_state,setup_attempts,email_verified_at,setup_expires_at,expires_at,consumed_at,revoked_at FROM admin_enrollments ORDER BY id",
      "SELECT id,admin_id,auth_version,created_at,expires_at,mfa_at,revoked_at FROM sessions WHERE admin_id IS NOT NULL ORDER BY id",
      "SELECT id,principal_id,role_key,scope_kind,scope_id,effect,limits,expires_at FROM admin_bindings ORDER BY id",
      "SELECT id,tenant_id,project_id,workflow_id,version,revision,state,next_due_at,last_error,content_state FROM workflow_schedules ORDER BY id",
      "SELECT schedule_id,revision,encode(sha256(convert_to(body::text,'UTF8')),'hex') AS body_hash FROM workflow_schedule_versions ORDER BY schedule_id,revision",
      "SELECT id,schedule_id,revision,scheduled_local,scheduled_at,state,run_id,missed_count,through_local FROM workflow_schedule_occurrences ORDER BY id",
    ])
      identity.push((await client.query(sql)).rows);
    return {
      ...counts,
      persistent_metadata_sha256: createHash("sha256")
        .update(JSON.stringify(identity))
        .digest("hex"),
    };
  } finally {
    await client.end();
  }
}
let controller: ReturnType<typeof spawn> | undefined;
let controllerOutput = "";
async function start() {
  controllerOutput = "";
  controller = spawn(process.execPath, [path.join(repo, "scripts/dev.mjs")], {
    cwd: repo,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const append = (b: Buffer) => {
    controllerOutput = (controllerOutput + b.toString()).slice(-12000);
  };
  controller.stdout!.on("data", append);
  controller.stderr!.on("data", append);
  const own = controller;
  await waitFor(
    async () => {
      if (own.exitCode !== null || own.signalCode !== null)
        throw new Error(
          "Controller exited before readiness: " + controllerOutput,
        );
      if (!controllerOutput.includes("admin ready")) return false;
      const state = JSON.parse(await readFile(stateFile, "utf8"));
      if (state.pid !== own.pid)
        throw new Error("Controller identity mismatch");
      const ready = await fetch("http://localhost:4310/health/ready");
      if (!ready.ok) return false;
      const health = (await (
        await fetch("http://localhost:4310/health/live")
      ).json()) as any;
      if (health.version !== version) throw new Error("API version mismatch");
      return (await Promise.all(ports.map(listening))).every(Boolean);
    },
    60000,
    "Native readiness",
  );
}
async function stop() {
  const own = controller;
  if (!own || own.exitCode !== null || own.signalCode !== null) return;
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  if (state.pid !== own.pid)
    throw new Error("Refusing to stop a controller not created by this test");
  const response = await fetch("http://127.0.0.1:4319/shutdown", {
    method: "POST",
    headers: { Authorization: "Bearer " + state.token },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Authenticated shutdown rejected");
  await waitFor(
    async () => own.exitCode !== null || own.signalCode !== null,
    200000,
    "Graceful native shutdown",
  );
  if (own.exitCode !== 0) throw new Error("Controller shutdown failed");
  await waitFor(
    async () => !(await Promise.all(ports.map(listening))).some(Boolean),
    10000,
    "Owned ports release",
  );
  controller = undefined;
}
for (const port of ports)
  if (await listening(port))
    throw new Error(
      `Stop the existing CopyPaste controller before lifecycle QA; port ${port} was preserved`,
    );
const beforeListeners = await existingListeners();
let before: any,
  after: any,
  passed = false;
try {
  await start();
  before = await snapshot();
  const offset = (await readFile(databaseLog)).length;
  await stop();
  const shutdownLog = (await readFile(databaseLog)).subarray(offset).toString();
  if (
    !shutdownLog.includes("checkpoint complete") ||
    !shutdownLog.includes("database system is shut down")
  )
    throw new Error("PostgreSQL did not confirm a checkpointing shutdown");
  checks.push({
    name: "authenticated shutdown checkpoints PostgreSQL and releases all five owned ports",
    status: "passed",
  });
  const restartOffset = (await readFile(databaseLog)).length;
  await start();
  after = await snapshot();
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Persistent metadata changed during an idle restart");
  const restartLog = (await readFile(databaseLog))
    .subarray(restartOffset)
    .toString();
  if (
    /database system was interrupted|automatic recovery in progress|redo starts at/.test(
      restartLog,
    )
  )
    throw new Error("Clean restart unexpectedly required crash recovery");
  checks.push({
    name: "clean restart reaches current API version without crash recovery and preserves persistent records",
    status: "passed",
  });
  const afterListeners = await existingListeners();
  if (JSON.stringify(beforeListeners) !== JSON.stringify(afterListeners))
    throw new Error("Preexisting listeners changed during the test");
  checks.push({
    name: "preexisting 5173/5174 listener process identities preserved",
    status: "passed",
  });
  await stop();
  passed = true;
} finally {
  // Never fall back to taskkill for the database. A failed shutdown preserves
  // that owned process for diagnosis rather than risking its stored records.
  if (controller)
    await stop().catch(() => {
      passed = false;
    });
  await mkdir(path.join(repo, "evidence"), { recursive: true });
  await writeFile(
    path.join(repo, "evidence/native-controller.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        version,
        status: passed ? "passed" : "failed",
        checks,
        project_ports: ports,
        original_listeners: beforeListeners,
        persistent_records_before: before,
        persistent_records_after: after,
        stack_left_running: false,
        virtualization_used: false,
      },
      null,
      2,
    ) + "\n",
  );
}
console.log(
  "Native lifecycle: checkpointed shutdown, clean persistent restart and listener preservation passed.",
);
