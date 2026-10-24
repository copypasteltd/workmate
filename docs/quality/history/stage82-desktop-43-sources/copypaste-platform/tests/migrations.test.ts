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
      99,
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
      "048-unified-admin-approvals.sql",
      "049-payment-evidence-and-posting.sql",
      "050-frozen-payment-record-commands.sql",
      "051-payment-preview-table-specific-fields.sql",
      "052-payment-historical-reference-guard.sql",
      "053-credit-repayment-refund-lineage.sql",
      "054-source-bound-refund-facts.sql",
      "055-independent-cash-refund-outcomes.sql",
      "056-immutable-commercial-plan-versions.sql",
      "057-canonical-vip-grant-lifecycle.sql",
      "058-enterprise-seat-and-storage-quotas.sql",
      "059-private-upload-erasure-terminal-state.sql",
      "060-atomic-vip-credit-combinations.sql",
      "061-durable-financial-notifications.sql",
      "062-controlled-support-scopes.sql",
      "063-frozen-task-capabilities.sql",
      "064-controlled-capability-releases.sql",
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

test("048 preserves real financial review history, registers frozen member/account requests and cancels unrecorded legacy commands", async () => {
  const isolated = await isolatedTestEnvironment({ throughVersion: 47 });
  const c = new pg.Client({
    connectionString: isolated.env.OWNER_DATABASE_URL,
  });
  await c.connect();
  try {
    const actor = (
      await c.query(
        "INSERT INTO admin_principals(email,name,enrollment_state) VALUES($1,'Upgrade requester','pending') RETURNING id",
        [randomUUID() + "@example.invalid"],
      )
    ).rows[0].id;
    const reviewer = (
      await c.query(
        "INSERT INTO admin_principals(email,name,enrollment_state) VALUES($1,'Recorded reviewer','pending') RETURNING id",
        [randomUUID() + "@example.invalid"],
      )
    ).rows[0].id;
    const policy = (
      await c.query(
        "INSERT INTO admin_operation_policy_versions(payload_hash,body) VALUES($1,'{}') RETURNING id",
        ["a".repeat(64)],
      )
    ).rows[0].id;
    const expires = new Date(Date.now() - 60000).toISOString();
    async function operation(
      action: string,
      frozen: boolean,
      financial = false,
    ) {
      const payload = frozen
        ? {
            actor_session_id: randomUUID(),
            actor_auth_version: 1,
            expires_at: expires,
            ...(financial ? { financial_command_version: 1 } : {}),
          }
        : { command: { reason: "Original unrecorded legacy command" } };
      return (
        await c.query(
          "INSERT INTO admin_operations(principal_id,action,payload_hash,payload,idempotency_key,state,policy_version_id) VALUES($1,$2,$3,$4,$5,'pending_approval',$6) RETURNING *",
          [
            actor,
            action,
            "b".repeat(64),
            JSON.stringify(payload),
            randomUUID(),
            frozen ? policy : null,
          ],
        )
      ).rows[0];
    }
    const financial = await operation("billing.gift", true, true);
    const oldRequest = (
      await c.query(
        "INSERT INTO admin_fee_approval_requests(operation_id,requester_id,payload_hash,policy_version_id,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [financial.id, actor, financial.payload_hash, policy, expires],
      )
    ).rows[0];
    const oldDecision = (
      await c.query(
        "INSERT INTO admin_fee_approval_decisions(approval_id,reviewer_id,expected_version,payload_hash,decision,reason) VALUES($1,$2,1,$3,'reject','Recorded independent rejection') RETURNING *",
        [oldRequest.id, reviewer, financial.payload_hash],
      )
    ).rows[0];
    await c.query(
      "UPDATE admin_fee_approval_requests SET state='rejected',version=2 WHERE id=$1",
      [oldRequest.id],
    );
    await c.query(
      "UPDATE admin_operations SET state='cancelled',version=2 WHERE id=$1",
      [financial.id],
    );
    const member = await operation("tenants.members.write", true);
    const account = await operation("users.status.write", true);
    const unknown = await operation("entitlements.extend", false);
    await runMigrations(c, "populated 047 approval upgrade");
    assert.equal(
      (await c.query("SELECT max(version) AS v FROM schema_migrations")).rows[0]
        .v,
      99,
    );
    const retainedRequest = (
      await c.query("SELECT * FROM admin_approval_requests WHERE id=$1", [
        oldRequest.id,
      ])
    ).rows[0];
    assert.deepEqual(retainedRequest, {
      ...oldRequest,
      state: "rejected",
      version: 2,
    });
    assert.deepEqual(
      (
        await c.query("SELECT * FROM admin_approval_decisions WHERE id=$1", [
          oldDecision.id,
        ])
      ).rows[0],
      oldDecision,
    );
    for (const op of [member, account]) {
      const registered = (
        await c.query(
          "SELECT * FROM admin_approval_requests WHERE operation_id=$1",
          [op.id],
        )
      ).rows[0];
      assert.ok(registered);
      assert.notEqual(registered.id, op.id);
      assert.equal(registered.requester_id, actor);
      assert.equal(registered.payload_hash, op.payload_hash);
      assert.equal(registered.policy_version_id, policy);
      assert.equal(registered.expires_at.toISOString(), expires);
      assert.equal(registered.state, "pending");
      assert.deepEqual(
        (await c.query("SELECT * FROM admin_operations WHERE id=$1", [op.id]))
          .rows[0],
        op,
      );
    }
    const cancelled = (
      await c.query("SELECT * FROM admin_operations WHERE id=$1", [unknown.id])
    ).rows[0];
    assert.equal(cancelled.state, "cancelled");
    assert.equal(cancelled.version, 2);
    assert.equal(cancelled.result.error_code, "APPROVAL_SNAPSHOT_UNRECORDED");
    assert.deepEqual(cancelled.payload, unknown.payload);
    assert.equal(cancelled.policy_version_id, null);
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM admin_approval_requests WHERE operation_id=$1",
          [unknown.id],
        )
      ).rows[0].n,
      0,
    );
    const record = (
      await c.query(
        "SELECT * FROM admin_approval_migration_records WHERE operation_id=$1",
        [unknown.id],
      )
    ).rows[0];
    assert.equal(record.original_state, "pending_approval");
    assert.equal(record.original_payload_hash, unknown.payload_hash);
    assert.equal(record.reason_code, "APPROVAL_SNAPSHOT_UNRECORDED");
    await assert.rejects(
      c.query(
        "UPDATE admin_approval_decisions SET reason='Rewrite old evidence' WHERE id=$1",
        [oldDecision.id],
      ),
      { code: "42501" },
    );
    await assert.rejects(
      c.query(
        "UPDATE admin_approval_requests SET expires_at=now()+interval '1 day' WHERE operation_id=$1",
        [member.id],
      ),
      { code: "42501" },
    );
    await runMigrations(c, "unchanged 048 approval replay");
    assert.equal(
      (await c.query("SELECT count(*)::int AS n FROM admin_approval_requests"))
        .rows[0].n,
      3,
    );
    assert.equal(
      (await c.query("SELECT count(*)::int AS n FROM admin_approval_decisions"))
        .rows[0].n,
      1,
    );
  } finally {
    await c.end();
    await isolated.cleanup();
  }
});
