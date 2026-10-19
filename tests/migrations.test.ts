import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { runMigrations } from "../scripts/migration-runner.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
test("a changed applied migration digest stops startup and the forward-only history remains intact", async () => {
  const isolated = await isolatedTestEnvironment();
  const c = new pg.Client({
    connectionString: isolated.env.OWNER_DATABASE_URL,
  });
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
    try {
      await c.query("ROLLBACK");
      await c.end();
    } finally {
      await isolated.cleanup();
    }
  }
});
