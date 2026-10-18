import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
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
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const f of (await readdir("migrations"))
      .filter((f) => /^\d+.*\.sql$/.test(f))
      .sort()) {
      const v = Number(f.split("-")[0]);
      if (
        (await c.query("SELECT 1 FROM schema_migrations WHERE version=$1", [v]))
          .rowCount
      )
        continue;
      await c.query("BEGIN");
      try {
        await c.query(await readFile("migrations/" + f, "utf8"));
        // The runner owns version bookkeeping, including legacy migrations
        // which did not insert their own version row.
        await c.query(
          "INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING",
          [v],
        );
        await c.query("COMMIT");
        console.log(name + ": applied migration " + v);
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await c.end();
  }
}
