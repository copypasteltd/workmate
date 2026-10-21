import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { Database } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import {
  fund,
  reserve,
  setCreditLimit,
  settle,
  wallet,
} from "../src/billing.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, db: Database;
type Workspace = { tenant: string; project: string; user: string };
before(async () => {
  isolated = await isolatedTestEnvironment();
  db = new Database(loadConfig({ ...isolated.env, NODE_ENV: "test" }));
});
after(async () => {
  try {
    await db?.close();
  } finally {
    await isolated?.cleanup();
  }
});
async function fixture(credit = 100): Promise<Workspace> {
  return db.tx(
    async (tx) => {
      const user = (
        await tx.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
          `billing-${randomUUID()}@example.invalid`,
        ])
      ).rows[0].id;
      const tenant = (
        await tx.query(
          "INSERT INTO tenants(name,data_mode) VALUES('Controlled billing fixture','simulated') RETURNING id",
        )
      ).rows[0].id;
      const project = (
        await tx.query(
          "INSERT INTO projects(tenant_id,name) VALUES($1,'Billing fixture') RETURNING id",
          [tenant],
        )
      ).rows[0].id;
      await tx.query(
        "INSERT INTO wallets(tenant_id,credit_limit_micros) VALUES($1,$2)",
        [tenant, credit],
      );
      return { tenant, project, user };
    },
    undefined,
    true,
  );
}
async function task(w: Workspace, amount: number) {
  const id = await db.tx(
    async (tx) =>
      (
        await tx.query(
          "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key) VALUES($1,$2,$3,'Controlled hold','Not executed','fullstack','fixture',$4,$5) RETURNING id",
          [w.tenant, w.project, w.user, amount, randomUUID()],
        )
      ).rows[0].id,
    w.tenant,
  );
  return id as string;
}
async function hold(w: Workspace, amount: number) {
  const id = await task(w, amount);
  await db.tx((tx) => reserve(tx, w.tenant, id, amount), w.tenant);
  return id;
}
const close = (w: Workspace, id: string, amount: number, uncertain = false) =>
  db.tx((tx) => settle(tx, w.tenant, id, amount, w.user, uncertain), w.tenant);
const state = (w: Workspace) => db.tx((tx) => wallet(tx, w.tenant), w.tenant);
const pay = (
  w: Workspace,
  amount: number,
  kind: "top_up" | "gift" = "top_up",
  expiresAt = new Date(Date.now() + 86400000).toISOString(),
) =>
  db.tx(
    (tx) =>
      fund(
        tx,
        {
          tenant_id: w.tenant,
          action: kind,
          amount_micros: amount,
          reason: "Controlled fixture only; no money received",
          ...(kind === "top_up"
            ? { reference: "fixture-" + randomUUID() }
            : { expires_at: expiresAt }),
        },
        randomUUID(),
      ),
    w.tenant,
  );
async function sources(id: string) {
  return (
    await db.control.query(
      "SELECT * FROM billing_settlement_sources WHERE task_id=$1 ORDER BY kind",
      [id],
    )
  ).rows;
}
async function refund(w: Workspace, source: string, amount: number) {
  return db.tx(
    (tx) =>
      fund(
        tx,
        {
          tenant_id: w.tenant,
          action: "refund",
          source_id: source,
          amount_micros: amount,
          reference: "controlled-refund-" + randomUUID(),
          reason: "Controlled fixture only; no payment provider called",
        },
        randomUUID(),
      ),
    w.tenant,
  );
}
function failure(code: string) {
  return (e: any) => {
    assert.equal(e.code, code);
    return true;
  };
}
function balances(w: any, balance: string, reserved: string, debt: string) {
  assert.equal(w.balance_micros, balance);
  assert.equal(w.reserved_micros, reserved);
  assert.equal(w.debt_micros, debt);
}

test("a credit hold predating a top-up consumes its real paid source exactly once", async () => {
  const w = await fixture(),
    id = await hold(w, 60),
    funding = await pay(w, 100);
  await close(w, id, 40);
  await close(w, id, 40);
  balances(await state(w), "60", "0", "0");
  const rows = await sources(id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "paid");
  assert.equal(rows[0].amount_micros, "40");
  const lot = (
    await db.control.query("SELECT * FROM funding_lots WHERE ledger_id=$1", [
      funding.id,
    ])
  ).rows[0];
  assert.equal(rows[0].lot_id, lot.id);
  assert.equal(lot.remaining_micros, "60");
  assert.equal(
    (
      await db.control.query(
        "SELECT count(*)::text n FROM ledger WHERE task_id=$1 AND kind='charge'",
        [id],
      )
    ).rows[0].n,
    "1",
  );
});

test("another task's funded hold survives credit consumption; incoming credit repays gross debt", async () => {
  const w = await fixture(),
    creditTask = await hold(w, 80);
  await pay(w, 50);
  const paidTask = await hold(w, 50);
  await close(w, creditTask, 80);
  balances(await state(w), "-30", "50", "80");
  assert.deepEqual(
    (await sources(creditTask)).map((x) => [x.kind, x.amount_micros]),
    [["credit", "80"]],
  );
  const repayment = await pay(w, 40);
  balances(await state(w), "10", "50", "40");
  assert.equal(
    (
      await db.control.query(
        "SELECT amount_micros FROM billing_credit_repayments WHERE funding_entry_id=$1",
        [repayment.id],
      )
    ).rows[0].amount_micros,
    "40",
  );
  assert.equal(
    (
      await db.control.query(
        "SELECT remaining_micros FROM funding_lots WHERE ledger_id=$1",
        [repayment.id],
      )
    ).rows[0].remaining_micros,
    "0",
  );
  await pay(w, 40);
  await close(w, paidTask, 20);
  balances(await state(w), "30", "0", "0");
});

test("released funds from the same original lot merge into one immutable source", async () => {
  const w = await fixture();
  await pay(w, 20);
  const a = await hold(w, 10),
    b = await hold(w, 20);
  await close(w, a, 0);
  await close(w, b, 20);
  balances(await state(w), "0", "0", "0");
  const rows = await sources(b);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount_micros, "20");
});

test("expired gifts retain held funds and expire only the unused remainder after settlement", async () => {
  const w = await fixture(),
    funding = await pay(
      w,
      60,
      "gift",
      new Date(Date.now() + 2000).toISOString(),
    ),
    id = await hold(w, 50);
  await new Promise((resolve) => setTimeout(resolve, 2100));
  balances(await state(w), "50", "50", "0");
  await close(w, id, 20);
  await close(w, id, 20);
  await state(w);
  balances(await state(w), "0", "0", "0");
  assert.deepEqual(
    (await sources(id)).map((x) => [x.kind, x.amount_micros]),
    [["gift", "20"]],
  );
  const expiry = (
    await db.control.query(
      "SELECT count(*)::text n,sum(amount_micros)::text amount FROM ledger WHERE source_id=$1 AND kind='gift_expiry'",
      [funding.id],
    )
  ).rows[0];
  assert.deepEqual(expiry, { n: "2", amount: "-40" });
});

test("late gifts are consumed before credit, with paid funds and expiry kept separate", async () => {
  const w = await fixture(),
    id = await hold(w, 100);
  await pay(w, 20);
  await pay(w, 30, "gift");
  await close(w, id, 70);
  balances(await state(w), "-20", "0", "20");
  assert.deepEqual(
    (await sources(id)).map((x) => [x.kind, x.amount_micros]),
    [
      ["credit", "20"],
      ["gift", "30"],
      ["paid", "20"],
    ],
  );
});

test("uncertain and over-budget usage keep the original hold without inventing charge sources", async () => {
  const w = await fixture(),
    id = await hold(w, 50);
  await pay(w, 80);
  await close(w, id, 30, true);
  await close(w, id, 60);
  balances(await state(w), "80", "50", "0");
  assert.equal((await sources(id)).length, 0);
  assert.equal(
    (
      await db.control.query(
        "SELECT status FROM reservations WHERE task_id=$1",
        [id],
      )
    ).rows[0].status,
    "reconciling",
  );
  await close(w, id, 30);
  balances(await state(w), "50", "0", "0");
});

test("concurrent settlement, top-up and source refund serialize without spending another hold", async () => {
  const w = await fixture(),
    id = await hold(w, 80),
    funding = await pay(w, 100);
  const result = await Promise.allSettled([
    close(w, id, 80),
    pay(w, 40),
    refund(w, funding.id, 100),
  ]);
  assert.equal(result[0].status, "fulfilled");
  assert.equal(result[1].status, "fulfilled");
  assert.equal(result[2].status, "rejected");
  if (result[2].status === "rejected")
    assert.equal(result[2].reason.code, "FUNDS_UNAVAILABLE");
  balances(await state(w), "60", "0", "0");
});

test("accumulated balances above Number.MAX_SAFE_INTEGER retain their last micros", async () => {
  const w = await fixture(0);
  await pay(w, Number.MAX_SAFE_INTEGER);
  await pay(w, 2);
  const a = await hold(w, Number.MAX_SAFE_INTEGER),
    b = await hold(w, 2),
    extra = await task(w, 1);
  await assert.rejects(
    db.tx((tx) => reserve(tx, w.tenant, extra, 1), w.tenant),
    failure("INSUFFICIENT_CREDIT"),
  );
  balances(await state(w), "9007199254740993", "9007199254740993", "0");
  await close(w, a, Number.MAX_SAFE_INTEGER);
  balances(await state(w), "2", "2", "0");
  await close(w, b, 1);
  balances(await state(w), "1", "0", "0");
});

test("repayment cannot be refunded without independently verified evidence and credit cannot drop below actual debt", async () => {
  const repayment = await fixture(),
    id = await hold(repayment, 40);
  await close(repayment, id, 40);
  const funding = await pay(repayment, 100);
  await assert.rejects(
    refund(repayment, funding.id, 61),
    failure("FUNDS_UNAVAILABLE"),
  );
  await assert.rejects(
    refund(repayment, funding.id, 60),
    /independently verified refund evidence/,
  );
  balances(await state(repayment), "60", "0", "0");
  const w = await fixture();
  const a = await hold(w, 80);
  await pay(w, 50);
  const b = await hold(w, 50);
  await close(w, a, 80);
  await close(w, b, 0);
  balances(await state(w), "-30", "0", "80");
  await assert.rejects(
    db.tx((tx) => setCreditLimit(tx, w.tenant, 30), w.tenant),
    failure("CREDIT_RESERVED"),
  );
  await db.tx((tx) => setCreditLimit(tx, w.tenant, 80), w.tenant);
  await pay(w, 80);
  await db.tx((tx) => setCreditLimit(tx, w.tenant, 0), w.tenant);
  balances(await state(w), "50", "0", "0");
});

test("invalid internal integer amounts and settlement rollback cannot leave partial financial effects", async () => {
  const w = await fixture(),
    id = await hold(w, 40);
  await pay(w, 60);
  for (const amount of [-1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(pay(w, amount), failure("INVALID_USAGE"));
    await assert.rejects(
      db.tx((tx) => reserve(tx, w.tenant, id, amount), w.tenant),
      failure("INVALID_USAGE"),
    );
  }
  await assert.rejects(
    db.tx(async (tx) => {
      await settle(tx, w.tenant, id, 30, w.user);
      throw new Error("forced rollback");
    }, w.tenant),
    /forced rollback/,
  );
  balances(await state(w), "60", "40", "0");
  assert.equal((await sources(id)).length, 0);
  for (const amount of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(close(w, id, amount), failure("INVALID_USAGE"));
  await close(w, id, 30);
  balances(await state(w), "30", "0", "0");
});

test("database guards reject incomplete charges, incorrect task/bucket sources and immutable history changes", async () => {
  const w = await fixture(),
    id = await hold(w, 40);
  await pay(w, 60);
  await close(w, id, 30);
  const row = (await sources(id))[0],
    other = await task(w, 1);
  await assert.rejects(
    db.tx(
      (tx) =>
        tx.query(
          "INSERT INTO ledger(tenant_id,user_id,task_id,kind,amount_micros,idempotency_key,reason) VALUES($1,$2,$3,'charge',-1,$4,'Controlled incomplete fixture')",
          [w.tenant, w.user, other, randomUUID()],
        ),
      w.tenant,
    ),
    failure("23514"),
  );
  const insert = (
    taskId: string,
    kind: string,
    lot: string | null,
    amount = 1,
  ) =>
    db.tx(
      (tx) =>
        tx.query(
          "INSERT INTO billing_settlement_sources(tenant_id,task_id,charge_id,kind,lot_id,amount_micros) VALUES($1,$2,$3,$4,$5,$6)",
          [w.tenant, taskId, row.charge_id, kind, lot, amount],
        ),
      w.tenant,
    );
  await assert.rejects(insert(other, "credit", null), failure("23514"));
  await assert.rejects(insert(id, "gift", row.lot_id), failure("23514"));
  await assert.rejects(insert(id, "credit", null), failure("23514"));
  const owner = new pg.Client({
    connectionString: isolated.env.OWNER_DATABASE_URL,
  });
  await owner.connect();
  try {
    await assert.rejects(
      owner.query(
        "UPDATE billing_settlement_sources SET amount_micros=1 WHERE id=$1",
        [row.id],
      ),
      failure("42501"),
    );
    await assert.rejects(
      owner.query("DELETE FROM billing_settlement_sources WHERE id=$1", [
        row.id,
      ]),
      failure("42501"),
    );
  } finally {
    await owner.end();
  }
  balances(await state(w), "30", "0", "0");
});

test("source and credit repayment records retain tenant isolation and immutable repayment provenance", async () => {
  const a = await fixture(),
    b = await fixture(),
    id = await hold(a, 40);
  await close(a, id, 40);
  const funding = await pay(a, 50),
    rows = await sources(id);
  await db.tx(async (tx) => {
    assert.equal(
      (
        await tx.query("SELECT * FROM billing_settlement_sources WHERE id=$1", [
          rows[0].id,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await tx.query(
          "SELECT * FROM billing_credit_repayments WHERE funding_entry_id=$1",
          [funding.id],
        )
      ).rowCount,
      0,
    );
    await assert.rejects(
      tx.query(
        "INSERT INTO billing_settlement_sources(tenant_id,task_id,charge_id,kind,amount_micros) VALUES($1,$2,$3,'credit',1)",
        [a.tenant, id, rows[0].charge_id],
      ),
      failure("23514"),
    );
  }, b.tenant);
  const owner = new pg.Client({
    connectionString: isolated.env.OWNER_DATABASE_URL,
  });
  await owner.connect();
  try {
    await assert.rejects(
      owner.query(
        "UPDATE billing_credit_repayments SET amount_micros=1 WHERE funding_entry_id=$1",
        [funding.id],
      ),
      failure("42501"),
    );
    await assert.rejects(
      owner.query(
        "DELETE FROM billing_credit_repayments WHERE funding_entry_id=$1",
        [funding.id],
      ),
      failure("42501"),
    );
  } finally {
    await owner.end();
  }
});
