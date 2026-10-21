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
const dir = path.resolve(".data/postgres");
// The pinned embedded-postgres package force-kills the Windows cluster in its
// default stop(). Use PostgreSQL's own checkpointing shutdown, including when
// the library invokes stop() from its exit hook.
class NativePostgres extends EmbeddedPostgres {
  private shutdown?: Promise<void>;
  override stop(): Promise<void> {
    this.shutdown ??=
      process.platform === "win32"
        ? promisify(execFile)(
            path.resolve(
              "node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe",
            ),
            ["stop", "-D", dir, "-m", "fast", "-w", "-t", "180"],
            { windowsHide: true, timeout: 190000 },
          ).then(() => undefined)
        : super.stop();
    return this.shutdown;
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
try {
  await access(path.join(dir, "PG_VERSION"));
} catch {
  await server.initialise();
}
await server.start();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("message", (message) => {
  if ((message as any)?.action === "shutdown") void stop();
});
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
else console.log("Native PostgreSQL startup only; migrations explicitly deferred.");
await c.end();
console.log(
  "Native PostgreSQL ready on 127.0.0.1:" +
    owner.port +
    ". Application roles are not owners and do not bypass RLS.",
);
setInterval(() => {}, 30_000);
