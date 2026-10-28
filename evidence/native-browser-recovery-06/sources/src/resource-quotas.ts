import type { Tx } from "./db.js";

/** This aggregate is evaluated in an authorized control transaction. Application
 * RLS hides other users' private versions and cannot produce a tenant total. */
export async function resourceSnapshot(tx: Tx, tenant: string) {
  return (await tx.query("SELECT tenant_resource_state($1) AS value", [tenant]))
    .rows[0].value;
}

/** Reserve capacity before immutable object I/O; the INSERT guard repeats this
 * check under the same transaction lock, including direct/derived writes. */
export async function assertStorageCapacity(
  tx: Tx,
  tenant: string,
  bytes: number,
  upload?: string,
) {
  await tx.query("SELECT assert_tenant_storage_capacity($1,$2,$3)", [
    tenant,
    bytes,
    upload ?? null,
  ]);
}
