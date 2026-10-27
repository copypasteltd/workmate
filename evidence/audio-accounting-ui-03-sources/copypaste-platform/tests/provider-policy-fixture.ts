import type { Database } from "../src/db.js";

/** Shared legacy suites retain many independent unknown-response counterexamples.
 * Give only their isolated databases a generous immutable policy; production
 * defaults and dedicated strict admission tests remain unchanged. */
export async function installIsolatedProviderPolicy(db: Database) {
  await db.tx(
    async (tx) => {
      for (const mode of ["simulated", "configured_services"]) {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "ai-gateway:" + mode,
        ]);
        const created = await tx.query(
          `INSERT INTO ai_gateway_policy_versions(data_mode,version,reason,
          global_slots,tenant_slots,actor_slots,text_slots,image_slots,verification_slots,
          global_rpm,tenant_rpm,actor_rpm,text_rpm,image_rpm,verification_rpm,preparation_seconds)
         SELECT $1,coalesce(max(version),0)+1,'Isolated retained-counterexample test fixture',
          100,100,100,100,100,100,100000,100000,100000,100000,100000,100000,30
         FROM ai_gateway_policy_versions WHERE data_mode=$1 RETURNING id`,
          [mode],
        );
        await tx.query(
          "UPDATE ai_gateway_policy_heads SET policy_version_id=$2 WHERE data_mode=$1",
          [mode, created.rows[0].id],
        );
      }
    },
    undefined,
    true,
  );
}
