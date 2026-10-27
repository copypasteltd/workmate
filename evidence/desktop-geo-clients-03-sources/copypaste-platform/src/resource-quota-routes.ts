import type { FastifyInstance } from "fastify";
import type { Database } from "./db.js";
import { requireAdmin, requireUser, audit } from "./auth.js";
import { tenantAccess } from "./access.js";
import { lockAdminAccess } from "./admin-access.js";
import { membershipAdminAuthority } from "./admin-memberships.js";
import { Problem, uuid } from "./lib.js";

import { resourceSnapshot } from "./resource-quotas.js";

export function registerResourceQuotas(app: FastifyInstance, db: Database) {
  app.get(
    "/v1/tenants/:tenant/resource-usage",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const tenant = uuid.parse((req.params as any).tenant);
      if (req.headers["x-tenant-id"] && req.headers["x-tenant-id"] !== tenant)
        throw new Problem(
          400,
          "TENANT_MISMATCH",
          "Workspace header does not match the path",
        );
      return db.tx(
        async (tx) => {
          await tenantAccess(tx, req.principal, tenant);
          return resourceSnapshot(tx, tenant);
        },
        tenant,
        true,
      );
    },
  );
  app.get(
    "/v1/admin/tenants/:tenant/resource-usage",
    { preHandler: requireAdmin(db) },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const tenant = uuid.parse((req.params as any).tenant);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          // This is an indivisible tenant aggregate. A project allow does not
          // authorize it, and any overlapping project deny blocks it.
          for (const key of ["admin.tenants.read", "admin.entitlements.read"])
            await membershipAdminAuthority(tx, req.principal, tenant, key);
          if (
            !(await tx.query("SELECT 1 FROM tenants WHERE id=$1", [tenant]))
              .rowCount
          )
            throw new Problem(404, "NOT_FOUND", "Workspace not found");
          const value = await resourceSnapshot(tx, tenant);
          await audit(
            tx,
            req.principal,
            "admin.tenants.resources.read",
            tenant,
            "succeeded",
            {},
            tenant,
          );
          return value;
        },
        tenant,
        true,
      );
    },
  );
}
