import type pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
export async function runMigrations(c: pg.Client, label: string) {
  // One owner runner per database. API/queue identities cannot obtain DDL.
  await c.query(
    "SELECT pg_advisory_lock(hashtextextended('copypaste-schema-migration',0))",
  );
  try {
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    await c.query(
      "ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS source_sha256 text",
    );
    const files = (await readdir("migrations"))
      .filter((f) => /^\d+.*\.sql$/.test(f))
      .sort();
    const versions = new Set<number>();
    for (const file of files) {
      const version = Number(file.split("-")[0]);
      if (versions.has(version))
        throw new Error(`Duplicate migration version ${version}`);
      versions.add(version);
      const sql = await readFile("migrations/" + file, "utf8"),
        digest = createHash("sha256").update(sql).digest("hex");
      const row = (
        await c.query(
          "SELECT source_sha256 FROM schema_migrations WHERE version=$1",
          [version],
        )
      ).rows[0];
      if (row) {
        // Null means a historical runner did not record original bytes. Do not
        // manufacture a checksum as evidence of an unverifiable execution.
        if (row.source_sha256 && row.source_sha256 !== digest)
          throw new Error(
            `Migration ${version} changed after application; add a forward migration`,
          );
        continue;
      }
      await c.query("BEGIN");
      try {
        await c.query(sql);
        await c.query(
          "INSERT INTO schema_migrations(version,source_sha256) VALUES($1,$2) ON CONFLICT(version) DO UPDATE SET source_sha256=excluded.source_sha256",
          [version, digest],
        );
        await c.query("COMMIT");
        console.log(`${label}: applied migration ${version}`);
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await c.query(
      "SELECT pg_advisory_unlock(hashtextextended('copypaste-schema-migration',0))",
    );
  }
}
