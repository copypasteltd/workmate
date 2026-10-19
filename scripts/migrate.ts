import pg from "pg";
import { runMigrations } from "./migration-runner.js";
const owner = new URL(process.env.OWNER_DATABASE_URL!);
const bootstrap = new URL(owner);
bootstrap.pathname = "/postgres";
const b = new pg.Client({ connectionString: bootstrap.href });
await b.connect();
if (
  !(await b.query("SELECT 1 FROM pg_database WHERE datname='copypaste_test'"))
    .rowCount
)
  await b.query("CREATE DATABASE copypaste_test");
await b.end();
for (const name of ["copypaste", "copypaste_test"]) {
  const u = new URL(owner);
  u.pathname = "/" + name;
  const c = new pg.Client({ connectionString: u.href });
  await c.connect();
  try {
    await c.query(`GRANT CONNECT,CREATE ON DATABASE ${name} TO cp_queue`);
    await runMigrations(c, name);
  } finally {
    await c.end();
  }
}
