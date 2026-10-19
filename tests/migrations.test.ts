import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { runMigrations } from "../scripts/migration-runner.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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

test("a populated 041 checkpoint upgrades without pending-trigger DDL failures or rewriting original financial facts", async () => {
  const isolated = await isolatedTestEnvironment({ throughVersion: 41 });
  const c = new pg.Client({
    connectionString: isolated.env.OWNER_DATABASE_URL,
  });
  await c.connect();
  try {
    const user = (
      await c.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
        randomUUID() + "@example.invalid",
      ])
    ).rows[0].id;
    const tenant = (
      await c.query(
        "INSERT INTO tenants(name,data_mode) VALUES('Populated upgrade','simulated') RETURNING id",
      )
    ).rows[0].id;
    const project = (
      await c.query(
        "INSERT INTO projects(tenant_id,name) VALUES($1,'Old project') RETURNING id",
        [tenant],
      )
    ).rows[0].id;
    const wallet = (
      await c.query(
        "INSERT INTO wallets(tenant_id,balance_micros) VALUES($1,100) RETURNING *",
        [tenant],
      )
    ).rows[0];
    const entry = (
      await c.query(
        "INSERT INTO ledger(tenant_id,user_id,kind,amount_micros,idempotency_key,reason) VALUES($1,$2,'gift',100,$3,'Recorded old gift') RETURNING *",
        [tenant, user, randomUUID()],
      )
    ).rows[0];
    const lot = (
      await c.query(
        "INSERT INTO funding_lots(tenant_id,ledger_id,kind,remaining_micros) VALUES($1,$2,'gift',100) RETURNING *",
        [tenant, entry.id],
      )
    ).rows[0];
    const task = (
      await c.query(
        "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key) VALUES($1,$2,$3,'Old task','Not executed','assistant','fixture',30,$4) RETURNING *",
        [tenant, project, user, randomUUID()],
      )
    ).rows[0];
    await c.query(
      "INSERT INTO reservations(task_id,tenant_id,amount_micros) VALUES($1,$2,30)",
      [task.id, tenant],
    );
    await runMigrations(c, "populated 041 upgrade");
    assert.equal(
      (await c.query("SELECT max(version) AS v FROM schema_migrations")).rows[0]
        .v,
      47,
    );
    for (const [table, old] of [
      ["wallets", wallet],
      ["ledger", entry],
      ["funding_lots", lot],
    ] as const) {
      const now = (
        await c.query(`SELECT * FROM ${table} WHERE id=$1`, [old.id])
      ).rows[0];
      assert.deepEqual(
        Object.fromEntries(Object.keys(old).map((k) => [k, now[k]])),
        old,
      );
    }
    assert.equal(
      (
        await c.query("SELECT billing_account_id FROM tasks WHERE id=$1", [
          task.id,
        ])
      ).rows[0].billing_account_id,
      wallet.id,
    );
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM wallets WHERE user_id=$1",
          [user],
        )
      ).rows[0].n,
      2,
    );
    const journal = (
      await c.query(
        "SELECT j.*,o.provenance,o.policy_version_id FROM billing_journal j JOIN billing_operations o ON o.id=j.operation_id WHERE j.id=$1",
        [entry.id],
      )
    ).rows[0];
    assert.equal(journal.actor_id, user);
    assert.equal(journal.provenance, "recorded_user_entry");
    assert.equal(journal.policy_version_id, null);
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM billing_journal WHERE kind='reserve'",
        )
      ).rows[0].n,
      0,
    );
    for (const file of [
      "042-billing-account-subjects.sql",
      "043-billing-operation-provenance.sql",
      "044-billing-subject-immutability.sql",
      "045-frozen-financial-commands.sql",
      "046-financial-preview-intent-repair.sql",
      "047-financial-approval-requests.sql",
    ]) {
      const digest = createHash("sha256")
        .update(await readFile("migrations/" + file))
        .digest("hex");
      assert.equal(
        (
          await c.query(
            "SELECT source_sha256 FROM schema_migrations WHERE version=$1",
            [Number(file.slice(0, 3))],
          )
        ).rows[0].source_sha256,
        digest,
      );
    }
    await runMigrations(c, "unchanged populated replay");
    assert.equal(
      (await c.query("SELECT count(*)::int AS n FROM billing_journal")).rows[0]
        .n,
      1,
    );
  } finally {
    await c.end();
    await isolated.cleanup();
  }
});
