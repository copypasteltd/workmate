import EmbeddedPostgres from "embedded-postgres";
import { readFile, readdir, access } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
if (process.env.NODE_ENV === "production")
  throw new Error("Local database launcher is disabled in production");
const owner = new URL(process.env.OWNER_DATABASE_URL ?? "");
const dir = path.resolve(".data/postgres");
const server = new EmbeddedPostgres({
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
for (const file of (await readdir("migrations"))
  .filter((f) => /^\d+.*\.sql$/.test(f))
  .sort()) {
  const version = Number(file.split("-")[0]);
  const has = await c.query(
    "SELECT to_regclass('public.schema_migrations') AS name",
  );
  if (
    has.rows[0].name &&
    (
      await c.query("SELECT 1 FROM schema_migrations WHERE version=$1", [
        version,
      ])
    ).rowCount
  )
    continue;
  await c.query("BEGIN");
  try {
    await c.query(await readFile("migrations/" + file, "utf8"));
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}
await c.end();
console.log(
  "Native PostgreSQL ready on 127.0.0.1:" +
    owner.port +
    ". Application roles are not owners and do not bypass RLS.",
);
setInterval(() => {}, 30_000);
