import type { FastifyInstance } from "fastify";
import type { Database } from "./db.js";
import { audit, requireUser } from "./auth.js";
import { key, replay, tenantAccess } from "./access.js";
import { wallet } from "./billing.js";
import { Problem, uuid } from "./lib.js";
export function registerDemo(app: FastifyInstance, db: Database) {
  if (!db.config.DEMO_MODE || db.config.NODE_ENV === "production") return;
  app.post(
    "/v1/tenants/:tenant/demo-credit",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = uuid.parse((req.params as any).tenant);
      return db.tx(async (tx) => {
        await tenantAccess(tx, req.principal, tenant, "owner");
        const t = (
          await tx.query("SELECT data_mode FROM tenants WHERE id=$1", [tenant])
        ).rows[0];
        if (t?.data_mode !== "simulated")
          throw new Problem(
            409,
            "DEMO_WORKSPACE_REQUIRED",
            "Create a simulated workspace to use demo credit",
          );
        return replay(
          tx,
          req.principal.id,
          "demo.credit",
          key(req),
          { tenant },
          async () => {
            await wallet(tx, tenant);
            const existing = await tx.query(
              "SELECT id FROM ledger WHERE tenant_id=$1 AND idempotency_key='demo-initial-credit'",
              [tenant],
            );
            if (!existing.rowCount) {
              const l = (
                await tx.query(
                  "INSERT INTO ledger(tenant_id,user_id,kind,amount_micros,idempotency_key,reason) VALUES($1,$2,'gift',100000000,'demo-initial-credit','SIMULATED CREDIT / 模擬額度 · no payment received') RETURNING id",
                  [tenant, req.principal.id],
                )
              ).rows[0];
              await tx.query(
                "INSERT INTO funding_lots(tenant_id,ledger_id,kind,remaining_micros) VALUES($1,$2,'gift',100000000)",
                [tenant, l.id],
              );
              await tx.query(
                "UPDATE wallets SET balance_micros=balance_micros+100000000,version=version+1 WHERE tenant_id=$1",
                [tenant],
              );
              await audit(
                tx,
                req.principal,
                "demo.credit",
                tenant,
                "succeeded",
                { data_mode: "simulated", amount_micros: 100000000 },
                tenant,
              );
            }
            return { data_mode: "simulated", wallet: await wallet(tx, tenant) };
          },
        );
      }, tenant);
    },
  );
}
