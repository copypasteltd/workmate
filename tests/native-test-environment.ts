import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { runMigrations } from "../scripts/migration-runner.js";

/** One native database and owned data directory per integration-test file.
 * Persistent reconciliation records must not consume another run's slots.
 * This helper never resets the demonstration, historical test or customer DB.
 */
export async function isolatedTestEnvironment() {
  const ownerUrl = new URL(process.env.OWNER_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(ownerUrl.hostname));
  const base = path.resolve(".data/test-runs"),
    id = randomUUID().replaceAll("-", ""),
    database = "copypaste_suite_" + id,
    directory = path.resolve(base, id),
    bootstrap = new URL(ownerUrl);
  bootstrap.pathname = "/postgres";
  let created = false,
    cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    assert.match(database, /^copypaste_suite_[a-f0-9]{32}$/);
    assert.equal(path.dirname(directory), base);
    if (created) {
      const control = new pg.Client({ connectionString: bootstrap.href });
      await control.connect();
      try {
        await control.query(
          `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`,
        );
      } finally {
        await control.end();
      }
      created = false;
    }
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    cleaned = true;
  };
  try {
    await mkdir(directory, { recursive: true });
    const control = new pg.Client({ connectionString: bootstrap.href });
    await control.connect();
    try {
      assert.match(database, /^copypaste_suite_[a-f0-9]{32}$/);
      await control.query(`CREATE DATABASE "${database}"`);
      created = true;
      await control.query(
        `GRANT CONNECT,CREATE ON DATABASE "${database}" TO cp_queue`,
      );
    } finally {
      await control.end();
    }
    const env: NodeJS.ProcessEnv = { ...process.env, DATA_DIR: directory };
    for (const key of [
      "DATABASE_URL",
      "CONTROL_DATABASE_URL",
      "QUEUE_DATABASE_URL",
      "OWNER_DATABASE_URL",
    ] as const) {
      const target = new URL(env[key]!);
      assert.equal(target.hostname, ownerUrl.hostname);
      assert.equal(target.port, ownerUrl.port);
      target.pathname = "/" + database;
      env[key] = target.href;
    }
    const setup = new pg.Client({ connectionString: env.OWNER_DATABASE_URL });
    await setup.connect();
    try {
      await runMigrations(setup, "isolated integration suite");
    } finally {
      await setup.end();
    }
    return { env, database, directory, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
