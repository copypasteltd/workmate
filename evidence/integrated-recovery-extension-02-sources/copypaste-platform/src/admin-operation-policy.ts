import type { Tx } from "./db.js";
import { canonical, hash } from "./lib.js";

export async function currentAdminControl(tx: Tx) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "catalog:policy:admin-control",
  ]);
  return (
    await tx.query(
      "SELECT id,version,body FROM catalog_entries WHERE kind='policy' AND key='admin-control' AND state='published'",
    )
  ).rows[0];
}
export async function pinAdminPolicy(tx: Tx, body: unknown) {
  const digest = hash(canonical(body));
  await tx.query(
    "INSERT INTO admin_operation_policy_versions(payload_hash,body) VALUES($1,$2) ON CONFLICT(payload_hash) DO NOTHING",
    [digest, body],
  );
  return (
    await tx.query(
      "SELECT id FROM admin_operation_policy_versions WHERE payload_hash=$1",
      [digest],
    )
  ).rows[0].id as string;
}
