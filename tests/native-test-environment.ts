import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { runMigrations } from "../scripts/migration-runner.js";
import { removeOwnedUUIDDirectory } from "../src/owned-directory-cleanup.js";
import { writeFixtureOwnership } from "../scripts/test-fixture-ownership.js";

/** One native database and owned data directory per integration-test file.
 * Persistent reconciliation records must not consume another run's slots.
 * This helper never resets the demonstration, historical test or customer DB.
 */
export async function isolatedTestEnvironment(
  options: { throughVersion?: number } = {},
) {
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
    try {
      await removeOwnedUUIDDirectory(base, id);
    } catch (error: any) {
      const runDirectory = process.env.COPYPASTE_TEST_RECLAMATION_DIR;
      if (
        process.platform !== "win32" ||
        !runDirectory ||
        !["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"].includes(error.code)
      )
        throw error;
      const run = path.resolve(runDirectory);
      assert.equal(
        path.dirname(run),
        path.resolve(".data/test-fixture-reclamation"),
      );
      assert.match(
        path.basename(run),
        /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,
      );
      assert.ok(!(await lstat(run)).isSymbolicLink());
      const manifest = JSON.parse(
        await readFile(path.join(run, "manifest.json"), "utf8"),
      );
      assert.equal(
        manifest.token,
        process.env.COPYPASTE_TEST_RECLAMATION_TOKEN,
      );
      assert.ok(
        Number.isSafeInteger(manifest.owner_pid) && manifest.owner_pid > 0,
      );
      process.kill(manifest.owner_pid, 0);
      await writeFile(
        path.join(run, id + ".json"),
        JSON.stringify({
          id,
          directory,
          worker_pid: process.pid,
          token: manifest.token,
          error_code: error.code,
        }),
        { flag: "wx" },
      );
      // The parent launcher must actually reclaim this fresh fixture after this
      // worker exits. Its hard failure is included in the overall exit status.
      console.log("# owned fixture queued for post-worker reclamation " + id);
    }
    cleaned = true;
  };
  try {
    const runDirectory = process.env.COPYPASTE_TEST_RECLAMATION_DIR;
    if (runDirectory) {
      const run = path.resolve(runDirectory);
      assert.equal(path.dirname(run), path.resolve(".data/test-fixture-reclamation"));
      assert.match(path.basename(run), /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
      assert.ok(!(await lstat(run)).isSymbolicLink());
      const manifest = JSON.parse(await readFile(path.join(run, "manifest.json"), "utf8"));
      assert.equal(manifest.token, process.env.COPYPASTE_TEST_RECLAMATION_TOKEN);
      assert.ok(Number.isSafeInteger(manifest.owner_pid) && manifest.owner_pid > 0);
      process.kill(manifest.owner_pid, 0);
      // Persist ownership before creating either the directory or database.
      // This also covers a worker interrupted before its cleanup hook runs.
      const owned = path.join(run, "owned");
      await mkdir(owned, { recursive: true });
      assert.ok(!(await lstat(owned)).isSymbolicLink());
      await writeFixtureOwnership(path.join(owned, id + ".json"), {
        id, directory, worker_pid: process.pid, token: manifest.token,
      });
    }
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
      await runMigrations(setup, "isolated integration suite", options);
    } finally {
      await setup.end();
    }
    return { env, database, directory, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
