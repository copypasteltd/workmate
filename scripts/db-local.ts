import { runMigrations } from "./migration-runner.js";
import EmbeddedPostgres from "embedded-postgres";
import { readFile, readdir, access } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
if (process.env.NODE_ENV === "production")
  throw new Error("Local database launcher is disabled in production");
const owner = new URL(process.env.OWNER_DATABASE_URL ?? "");
const custom = process.env.COPYPASTE_NATIVE_DATABASE_DIR;
if (custom && !/^\.data[\\/]native-qa[\\/][a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(custom))
  throw new Error("A custom native database must use an owned .data/native-qa UUID directory");
const dir = path.resolve(custom ?? ".data/postgres");
// The pinned embedded-postgres package force-kills the Windows cluster in its
// default stop(). Use PostgreSQL's own checkpointing shutdown, including when
// the library invokes stop() from its exit hook.
async function rejectRunningCluster() {
  let stamp: string;
  try { stamp = await readFile(path.join(dir, "postmaster.pid"), "utf8"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
  const pid = Number(stamp.split(/\r?\n/)[0]);
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error("Existing database ownership record is invalid; preserved for explicit recovery");
  try { process.kill(pid, 0); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ESRCH") return; throw new Error("Existing database process cannot be inspected; preserved"); }
  throw new Error("This data directory already has a live database; existing process preserved");
}
// Check before the dependency registers its exit hook. A stale, dead PID can
// still follow PostgreSQL's own recovery path; no existing PID file is removed.
await rejectRunningCluster();
class NativePostgres extends EmbeddedPostgres {
  private shutdown?: Promise<void>;
  private ownedStamp?: string;
  override async start(): Promise<void> {
    await rejectRunningCluster();
    await super.start();
    const stamp = await readFile(path.join(dir, "postmaster.pid"), "utf8");
    // embedded-postgres18.4's private runtime field identifies the child it
    // actually spawned. Matching only a directory/port would not prove ownership.
    const child = (this as unknown as { process?: { pid?: number } }).process;
    if (!child?.pid || Number(stamp.split(/\r?\n/)[0]) !== child.pid)
      throw new Error("New database child ownership could not be established; no other instance will be stopped");
    this.ownedStamp = stamp;
  }
  override stop(): Promise<void> {
    if (!this.ownedStamp) return Promise.resolve();
    this.shutdown ??= this.stopOwned();
    return this.shutdown;
  }
  private async stopOwned(): Promise<void> {
    let stamp: string;
    try { stamp = await readFile(path.join(dir, "postmaster.pid"), "utf8"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
    if (stamp !== this.ownedStamp)
      throw new Error("Database ownership changed; existing process preserved");
    await (
      process.platform === "win32"
        ? promisify(execFile)(
            path.resolve(
              "node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe",
            ),
            ["stop", "-D", dir, "-m", "fast", "-w", "-t", "180"],
            { windowsHide: true, timeout: 190000 },
          ).then(() => undefined)
        : super.stop());
  }
}
const server = new NativePostgres({
  databaseDir: dir,
  user: decodeURIComponent(owner.username),
  password: decodeURIComponent(owner.password),
  port: Number(owner.port),
  persistent: true,
  authMethod: "scram-sha-256",
  initdbFlags: ["--locale=C", "--encoding=UTF8"],
});
let started = false;
let stopping = false;
let shutdownRequested = false;
async function stop() {
  shutdownRequested = true;
  if (!started || stopping) return;
  stopping = true;
  await server.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("message", (message) => {
  if ((message as any)?.action === "shutdown") void stop();
});
// The launcher retains an early shutdown request until this control channel
// exists. Recovery may continue safely before PostgreSQL can be stopped.
if (process.connected) process.send?.({ control: "ready" });
try {
  await access(path.join(dir, "PG_VERSION"));
} catch {
  await server.initialise();
}
await server.start();
started = true;
if (shutdownRequested) await stop();
const base = new URL(owner);
base.pathname = "/postgres";
const bootstrap = new pg.Client({ connectionString: base.href });
await bootstrap.connect();
for (const key of [
  "DATABASE_URL",
  "CONTROL_DATABASE_URL",
  "QUEUE_DATABASE_URL",
]) {
  const u = new URL(process.env[key]!);
  const role = u.username,
    pass = decodeURIComponent(u.password);
  if (!/^cp_(app|control|queue)$/.test(role) || !/^[a-f\d]+$/.test(pass))
    throw new Error("Unexpected local credential format");
  if (
    !(await bootstrap.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]))
      .rowCount
  )
    await bootstrap.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${pass}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    );
}
if (
  !(
    await bootstrap.query("SELECT 1 FROM pg_database WHERE datname='copypaste'")
  ).rowCount
)
  await bootstrap.query("CREATE DATABASE copypaste");
await bootstrap.end();
const c = new pg.Client({ connectionString: owner.href });
await c.connect();
await c.query("GRANT CONNECT,CREATE ON DATABASE copypaste TO cp_queue");
// Upgrade tooling must be able to snapshot an existing cluster before any DDL.
// Normal development startup still migrates by default. This does not change
// the production guard above or start any other database/virtualized service.
if (process.env.COPYPASTE_NATIVE_DATABASE_START_ONLY !== "true")
  await runMigrations(c, "copypaste");
else
  console.log(
    "Native PostgreSQL startup only; migrations explicitly deferred.",
  );
await c.end();
console.log(
  "Native PostgreSQL ready on 127.0.0.1:" +
    owner.port +
    ". Application roles are not owners and do not bypass RLS.",
);
setInterval(() => {}, 30_000);
