import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { runMigrations } from "../scripts/migration-runner.js";
test("a changed applied migration digest stops startup and the forward-only history remains intact", async () => {
  const u = new URL(process.env.OWNER_DATABASE_URL!);
  u.pathname = "/copypaste_test";
  const c = new pg.Client({ connectionString: u.href });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "UPDATE schema_migrations SET source_sha256=$1 WHERE version=16",
      ["0".repeat(64)],
    );
    await assert.rejects(
      runMigrations(c, "checksum fixture"),
      /Migration 16 changed after application; add a forward migration/,
    );
  } finally {
    await c.query("ROLLBACK");
    await c.end();
  }
});
