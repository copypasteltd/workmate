import {
  mkdir,
  lstat,
  open,
  readFile,
  readdir,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./db.js";
import { canonical, Problem, seal, unseal, uuid } from "./lib.js";
import { budgetDigest, budgetProtocol } from "./external-budget-model.js";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const envelope = z
  .object({
    protocol: z.literal("external-budget-receipt/1"),
    operation_id: uuid,
    tenant_id: uuid,
    project_id: uuid,
    lease_token: uuid,
    payload_sha256: sha,
    request_sha256: sha,
    data_mode: z.enum(["simulated", "configured_services"]),
    outcome: z.enum(["applied", "rejected", "unknown"]),
    body: z.record(z.string(), z.unknown()),
    body_sha256: sha,
  })
  .strict();
type Envelope = z.infer<typeof envelope>;
const filePattern = /^[a-f0-9-]{36}-[a-f0-9]{64}\.sealed$/;

async function directory(db: Database) {
  const root = path.resolve(db.config.DATA_DIR, "external-budget-receipts");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Problem(
      503,
      "BUDGET_RECEIPT_STORAGE",
      "Receipt storage is unavailable",
    );
  return root;
}
const filename = (e: Envelope) => `${e.operation_id}-${budgetDigest(e)}.sealed`;

/** AEAD-encrypted, fsynced response outbox. It never contains OAuth credentials. */
async function stage(db: Database, e: Envelope) {
  const root = await directory(db),
    target = path.join(root, filename(e));
  const temp = path.join(root, `${randomUUID()}.tmp`);
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(seal(db.config.MASTER_KEY!, canonical(e)), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
  return target;
}

async function commit(db: Database, e: Envelope) {
  await db.tx(
    async (tx) => {
      const row = (
        await tx.query(
          "SELECT * FROM external_budget_operations WHERE id=$1 AND tenant_id=$2 AND project_id=$3 FOR UPDATE",
          [e.operation_id, e.tenant_id, e.project_id],
        )
      ).rows[0];
      if (
        !row ||
        row.data_mode !== e.data_mode ||
        row.payload_sha256 !== e.payload_sha256 ||
        row.request_sha256 !== e.request_sha256 ||
        row.lease_token !== e.lease_token ||
        budgetDigest(e.body) !== e.body_sha256
      )
        throw new Problem(
          409,
          "BUDGET_RECEIPT_BINDING",
          "The receipt does not match its exact dispatched intent",
        );
      if (
        e.outcome === "applied" &&
        (e.body.protocol !== budgetProtocol ||
          e.body.request_sha256 !== e.request_sha256 ||
          e.body.resource_name !== row.specification.before.resource_name ||
          e.body.amount_micros !==
            row.specification.desired_average_daily_micros ||
          e.body.attribution !== "provider_mutation_receipt")
      )
        throw new Problem(
          409,
          "BUDGET_RECEIPT_BINDING",
          "The receipt does not confirm the dispatched budget",
        );
      const inserted = await tx.query(
        `INSERT INTO external_budget_receipts(tenant_id,operation_id,outcome,body,body_sha256)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(operation_id,body_sha256) DO NOTHING RETURNING id`,
        [e.tenant_id, e.operation_id, e.outcome, e.body, e.body_sha256],
      );
      // A late receipt remains evidence after manual closure. It never reopens a terminal operation.
      if (inserted.rowCount && ["dispatched", "unknown"].includes(row.state)) {
        await tx.query(
          `UPDATE external_budget_operations SET state=$2,version=version+1,error_code=$3,finished_at=clock_timestamp() WHERE id=$1`,
          [
            e.operation_id,
            e.outcome === "applied"
              ? "succeeded"
              : e.outcome === "rejected"
                ? "failed"
                : "unknown",
            e.outcome === "applied"
              ? null
              : String(e.body.error_code ?? "BUDGET_OUTCOME_UNKNOWN"),
          ],
        );
      }
    },
    e.tenant_id,
    true,
  );
}

export async function persistBudgetReceipt(
  db: Database,
  row: any,
  lease: string,
  outcome: Envelope["outcome"],
  body: Envelope["body"],
) {
  const e = envelope.parse({
    protocol: "external-budget-receipt/1",
    operation_id: row.id,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    lease_token: lease,
    payload_sha256: row.payload_sha256,
    request_sha256: row.request_sha256,
    data_mode: row.data_mode,
    outcome,
    body,
    body_sha256: budgetDigest(body),
  });
  // If local storage fails, the database can still retain the known outcome.
  const staged = await stage(db, e).catch(() => null);
  await commit(db, e); // A database failure keeps the exact encrypted response for recovery.
  if (staged) await unlink(staged).catch(() => {});
}

export async function recoverBudgetReceipts(db: Database) {
  const root = await directory(db);
  let recovered = 0;
  for (const name of (await readdir(root))
    .filter((n) => filePattern.test(n))
    .sort()
    .slice(0, 100)) {
    const file = path.join(root, name);
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000)
        throw new Error("Invalid receipt file");
      const e = envelope.parse(
        JSON.parse(unseal(db.config.MASTER_KEY!, await readFile(file, "utf8"))),
      );
      if (filename(e) !== name) throw new Error("Receipt filename mismatch");
      // Other configured environments cannot turn a synthetic receipt into a live one.
      if (
        e.data_mode !==
        (db.config.DEMO_MODE ? "simulated" : "configured_services")
      )
        continue;
      await commit(db, e);
      await unlink(file);
      recovered++;
    } catch (error) {
      // Preserve invalid or temporarily unavailable evidence; continue with other receipts.
      console.error(
        JSON.stringify({
          component: "external_budget.receipt_recovery",
          error_code:
            error instanceof Problem
              ? error.code
              : "BUDGET_RECEIPT_RECOVERY_FAILED",
        }),
      );
    }
  }
  return recovered;
}
