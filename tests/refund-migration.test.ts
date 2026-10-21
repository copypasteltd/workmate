import { reserveBeforeBudget } from "./fixtures/billing-before-budget.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { Database } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import { reserve, settle, fund, billingAccount } from "../src/billing.js";
import { inspectRefund } from "../src/billing-refunds.js";
import { runMigrations } from "../scripts/migration-runner.js";

test("a populated 052 upgrade freezes actual opening credit and preserves missing legacy provenance without inventing repayment links", async () => {
  const isolated = await isolatedTestEnvironment({ throughVersion: 52 }),
    db = new Database(
      loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true" }),
    ),
    owner = new pg.Client({
      connectionString: isolated.env.OWNER_DATABASE_URL,
    });
  await owner.connect();
  try {
    const w = await db.tx(
      async (tx) => {
        const user = (
          await tx.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
            randomUUID() + "@example.invalid",
          ])
        ).rows[0].id;
        const tenant = (
          await tx.query(
            "INSERT INTO tenants(name,data_mode) VALUES('Actual opening debt fixture','simulated') RETURNING id",
          )
        ).rows[0].id;
        const project = (
          await tx.query(
            "INSERT INTO projects(tenant_id,name) VALUES($1,'Not executed') RETURNING id",
            [tenant],
          )
        ).rows[0].id;
        const account = (
          await tx.query(
            "INSERT INTO wallets(tenant_id,credit_limit_micros) VALUES($1,100) RETURNING id",
            [tenant],
          )
        ).rows[0].id;
        return { user, tenant, project, account };
      },
      undefined,
      true,
    );
    let upgraded = false;
    const charge = (amount: number) =>
      db.tx(async (tx) => {
        const task = (
          await tx.query(
            "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key) VALUES($1,$2,$3,'Controlled credit','Not executed','assistant','fixture',$4,$5) RETURNING id",
            [w.tenant, w.project, w.user, amount, randomUUID()],
          )
        ).rows[0].id;
        await (upgraded ? reserve : reserveBeforeBudget)(
          tx,
          w.tenant,
          task,
          amount,
        );
        await settle(tx, w.tenant, task, amount, w.user);
        return (
          await tx.query(
            "SELECT * FROM billing_journal WHERE task_id=$1 AND kind='consume'",
            [task],
          )
        ).rows[0];
      }, w.tenant);
    const pay = (amount: number) =>
      db.tx(
        (tx) =>
          fund(
            tx,
            {
              tenant_id: w.tenant,
              action: "top_up",
              amount_micros: amount,
              reference: randomUUID(),
              reason: "Controlled upgrade fixture; no money received",
            },
            randomUUID(),
          ),
        w.tenant,
      );
    const oldCharge = await charge(80);
    await pay(20);
    const before = (
      await owner.query(
        "SELECT * FROM billing_settlement_sources WHERE charge_id=$1",
        [oldCharge.raw_entry_id],
      )
    ).rows;
    await runMigrations(owner, "populated 052 credit provenance upgrade");
    upgraded = true;
    assert.equal(
      (
        await owner.query(
          "SELECT amount_micros FROM billing_credit_opening_balances WHERE billing_account_id=$1",
          [w.account],
        )
      ).rows[0].amount_micros,
      "60",
    );
    assert.deepEqual(
      (
        await owner.query(
          "SELECT * FROM billing_settlement_sources WHERE charge_id=$1",
          [oldCharge.raw_entry_id],
        )
      ).rows,
      before,
    );
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM billing_credit_repayment_parts WHERE billing_account_id=$1",
          [w.account],
        )
      ).rows[0].n,
      0,
    );
    await assert.rejects(
      db.control.query(
        "INSERT INTO billing_credit_legacy_sources(billing_account_id,source_id) VALUES($1,$2)",
        [w.account, before[0].id],
      ),
      /permission denied/,
    );
    const inspect = (entry: any) =>
      db.tx(async (tx) => {
        const account = await billingAccount(tx, w.account);
        return inspectRefund(
          tx,
          account,
          {
            action: "refund",
            expected_version: account.version,
            reason: "Controlled original refund",
            destination: "paid_balance",
            amount: { currency: "HKD", amount_micros: entry.amount_micros },
            original_entry_id: entry.id,
          },
          BigInt(account.balance_micros),
        );
      }, w.tenant);
    await assert.rejects(
      inspect(oldCharge),
      (e: any) => e.code === "REFUND_RECONCILIATION_REQUIRED",
    );
    const currentCharge = await charge(10);
    await pay(65);
    const rows = (
      await owner.query(
        "SELECT p.amount_micros,s.charge_id FROM billing_credit_repayment_parts p LEFT JOIN billing_settlement_sources s ON s.id=p.credit_source_id WHERE p.billing_account_id=$1 ORDER BY p.created_at,p.id",
        [w.account],
      )
    ).rows;
    assert.deepEqual(rows, [
      { amount_micros: "60", charge_id: null },
      { amount_micros: "5", charge_id: currentCharge.raw_entry_id },
    ]);
    assert.deepEqual(
      (await inspect(currentCharge)).parts.map((p) => [
        p.kind,
        p.amount_micros,
      ]),
      [
        ["credit", "5"],
        ["paid", "5"],
      ],
    );
    // Even after opening debt is paid, no guessed old per-charge source is created.
    await assert.rejects(
      inspect(oldCharge),
      (e: any) => e.code === "REFUND_RECONCILIATION_REQUIRED",
    );
  } finally {
    await owner.end();
    await db.close();
    await isolated.cleanup();
  }
});
