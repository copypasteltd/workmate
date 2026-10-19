import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { audit, requireUser } from "./auth.js";
import { projectAccess, replay, tenantAccess } from "./access.js";
import { email, hash, Problem, token, uuid } from "./lib.js";
import {
  queueInvitation,
  validInvitationIssuer,
} from "./invitation-delivery.js";

const role = z.enum(["owner", "admin", "member", "approver", "viewer"]);
const page = z
  .object({
    cursor: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const requestKey = (req: FastifyRequest) =>
  z.string().min(8).max(128).parse(req.headers["idempotency-key"]);
function tenantHeader(req: FastifyRequest, path?: string) {
  const tenant = uuid.parse(req.headers["x-tenant-id"]);
  if (path && path !== tenant)
    throw new Problem(
      400,
      "TENANT_MISMATCH",
      "Workspace header does not match the path",
    );
  return tenant;
}
export const lockMemberships = async (tx: Tx, tenant: string) => {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `members:${tenant}`,
  ]);
};
export const memberDTO = (m: any) => ({
  id: m.id,
  user_id: m.user_id,
  role: m.role,
  project_ids: m.project_ids ?? [],
  state: m.status,
  auth_version: m.version,
});
export const inviteDTO = (i: any) => ({
  id: i.id,
  email: i.email,
  role: i.role,
  expires_at: new Date(i.expires_at).toISOString(),
  state: i.consumed_at
    ? "accepted"
    : i.revoked_at
      ? "revoked"
      : new Date(i.expires_at).getTime() <= Date.now()
        ? "expired"
        : "pending",
});
const memberFields =
  "m.*,ARRAY(SELECT pm.project_id FROM project_members pm WHERE pm.tenant_id=m.tenant_id AND pm.user_id=m.user_id ORDER BY pm.project_id) AS project_ids";
export async function revokeRecipientInvites(
  tx: Tx,
  tenant: string,
  user: string,
  except?: string,
) {
  const ids = (
    await tx.query(
      "UPDATE invites SET revoked_at=now(),version=version+1 WHERE tenant_id=$1 AND email=(SELECT email FROM users WHERE id=$2) AND consumed_at IS NULL AND revoked_at IS NULL AND ($3::uuid IS NULL OR id<>$3) RETURNING id",
      [tenant, user, except ?? null],
    )
  ).rows.map((i) => i.id);
  if (ids.length)
    await tx.query(
      "UPDATE invitation_deliveries SET state='cancelled',token_cipher=NULL,lease_id=NULL,lease_until=NULL WHERE invite_id=ANY($1::uuid[])",
      [ids],
    );
}
export async function lastOwner(
  tx: Tx,
  tenant: string,
  old: any,
  nextRole: string,
  nextState: string,
) {
  if (
    old.role === "owner" &&
    old.status === "active" &&
    (nextRole !== "owner" || nextState !== "active")
  ) {
    const n = (
      await tx.query(
        "SELECT count(*)::int AS n FROM memberships WHERE tenant_id=$1 AND role='owner' AND status='active'",
        [tenant],
      )
    ).rows[0].n;
    if (n <= 1)
      throw new Problem(
        409,
        "LAST_OWNER",
        "Transfer ownership before removing the last owner",
      );
  }
}
export async function projectGrants(
  tx: Tx,
  tenant: string,
  user: string,
  memberRole: string,
  projects: string[],
) {
  await tx.query(
    "DELETE FROM project_members WHERE tenant_id=$1 AND user_id=$2",
    [tenant, user],
  );
  for (const id of new Set(projects))
    await tx.query(
      "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,$4)",
      [
        tenant,
        id,
        user,
        memberRole === "member"
          ? "editor"
          : memberRole === "approver"
            ? "approver"
            : "viewer",
      ],
    );
}
export function assertMemberNotSuspended(m: any) {
  if (m?.admin_suspended)
    throw new Problem(
      409,
      "ADMIN_MEMBERSHIP_SUSPENDED",
      "An administrator must restore this suspended membership",
    );
}
export function registerMemberships(app: FastifyInstance, db: Database) {
  const auth = { preHandler: requireUser(db) };
  for (const directory of [false, true])
    app.get(
      `/v1/tenants/:tenant/${directory ? "member-directory" : "members"}`,
      auth,
      async (req, reply) => {
        reply.header("Cache-Control", "no-store");
        const tenant = tenantHeader(
          req,
          uuid.parse((req.params as any).tenant),
        );
        const q = page.parse(req.query);
        return db.tx(async (tx) => {
          await tenantAccess(tx, req.principal, tenant, "manage");
          if (
            q.cursor &&
            !(
              await tx.query(
                "SELECT 1 FROM memberships WHERE tenant_id=$1 AND id=$2",
                [tenant, q.cursor],
              )
            ).rowCount
          )
            throw new Problem(410, "CURSOR_EXPIRED", "Refresh the member list");
          const rows = (
            await tx.query(
              `SELECT ${memberFields}${directory ? ",u.name,u.email" : ""} FROM memberships m ${directory ? "JOIN users u ON u.id=m.user_id" : ""} WHERE m.tenant_id=$1 AND ($2::uuid IS NULL OR m.id>$2) ORDER BY m.id LIMIT $3`,
              [tenant, q.cursor ?? null, q.limit + 1],
            )
          ).rows;
          return {
            items: rows
              .slice(0, q.limit)
              .map((m) =>
                directory
                  ? {
                      ...memberDTO(m),
                      management_state: m.admin_suspended
                        ? "suspended"
                        : m.status,
                      name: m.name,
                      email: m.email,
                    }
                  : memberDTO(m),
              ),
            next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
          };
        }, tenant);
      },
    );
  app.patch("/v1/tenants/:tenant/members/:user", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { tenant, user } = z
      .object({ tenant: uuid, user: uuid })
      .parse(req.params);
    const b = z
      .object({
        role,
        status: z.enum(["active", "removed"]),
        version: z.number().int().positive(),
        project_ids: z.array(uuid).max(100),
      })
      .strict()
      .parse(req.body);
    return db.tx(async (tx) => {
      await lockMemberships(tx, tenant);
      // Check authority after waiting for the same lock used by removal/acceptance.
      await tenantAccess(tx, req.principal, tenant, "owner");
      const old = (
        await tx.query(
          "SELECT * FROM memberships WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE",
          [tenant, user],
        )
      ).rows[0];
      if (!old || old.version !== b.version)
        throw new Problem(
          409,
          "VERSION_CONFLICT",
          "Membership changed; refresh first",
        );
      assertMemberNotSuspended(old);
      await lastOwner(tx, tenant, old, b.role, b.status);
      for (const id of new Set(b.project_ids))
        await projectAccess(tx, req.principal, tenant, id, "manage");
      const m = (
        await tx.query(
          "UPDATE memberships SET role=$3,status=$4,version=version+1 WHERE tenant_id=$1 AND user_id=$2 RETURNING *",
          [tenant, user, b.role, b.status],
        )
      ).rows[0];
      await projectGrants(
        tx,
        tenant,
        user,
        b.role,
        b.status === "active" ? b.project_ids : [],
      );
      if (b.status === "removed")
        await revokeRecipientInvites(tx, tenant, user);
      await audit(
        tx,
        req.principal,
        "membership.update",
        m.id,
        "succeeded",
        { role: b.role, status: b.status },
        tenant,
      );
      return {
        ...m,
        project_ids: b.status === "active" ? [...new Set(b.project_ids)] : [],
      };
    }, tenant);
  });
  app.delete("/v1/members/:member", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const tenant = tenantHeader(req),
      id = uuid.parse((req.params as any).member),
      k = requestKey(req);
    return db.tx(async (tx) => {
      await lockMemberships(tx, tenant);
      const actor = await tenantAccess(tx, req.principal, tenant, "manage");
      const old = (
        await tx.query(
          "SELECT * FROM memberships WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenant, id],
        )
      ).rows[0];
      if (!old) throw new Problem(404, "NOT_FOUND", "Member not found");
      assertMemberNotSuspended(old);
      if (["owner", "admin"].includes(old.role) && actor.role !== "owner")
        throw new Problem(
          403,
          "OWNER_REQUIRED",
          "Only owners can remove privileged members",
        );
      return replay(
        tx,
        req.principal.id,
        `member.remove:${tenant}:${id}`,
        k,
        {},
        async () => {
          await lastOwner(tx, tenant, old, old.role, "removed");
          if (old.status !== "removed") {
            await tx.query(
              "UPDATE memberships SET status='removed',version=version+1 WHERE tenant_id=$1 AND id=$2",
              [tenant, id],
            );
            await projectGrants(tx, tenant, old.user_id, old.role, []);
            await revokeRecipientInvites(tx, tenant, old.user_id);
            await audit(
              tx,
              req.principal,
              "membership.remove",
              id,
              "succeeded",
              {},
              tenant,
            );
          }
          return { ok: true as const };
        },
      );
    }, tenant);
  });
  app.post("/v1/tenants/:tenant/invites", auth, async (req, reply) => {
    reply.code(201).header("Cache-Control", "no-store");
    const tenant = tenantHeader(req, uuid.parse((req.params as any).tenant)),
      k = requestKey(req);
    const b = z
      .object({ email, role, project_ids: z.array(uuid).max(100) })
      .strict()
      .parse(req.body);
    return db.tx(async (tx) => {
      await lockMemberships(tx, tenant);
      const m = await tenantAccess(tx, req.principal, tenant, "manage");
      if (["owner", "admin"].includes(b.role) && m.role !== "owner")
        throw new Problem(
          403,
          "OWNER_REQUIRED",
          "Only owners can grant privileged access",
        );
      for (const id of new Set(b.project_ids))
        await projectAccess(tx, req.principal, tenant, id, "manage");
      const saved = await replay(
        tx,
        req.principal.id,
        `invite:${tenant}`,
        k,
        b,
        async () => {
          const value = token();
          const i = (
            await tx.query(
              "INSERT INTO invites(tenant_id,email,digest,role,project_ids,expires_at,created_by,issuer_version) VALUES($1,$2,$3,$4,$5,now()+interval '7 days',$6,$7) RETURNING *",
              [
                tenant,
                b.email,
                hash(value),
                b.role,
                [...new Set(b.project_ids)],
                req.principal.id,
                m.version,
              ],
            )
          ).rows[0];
          await queueInvitation(tx, db, i, value);
          await audit(
            tx,
            req.principal,
            "invite.create",
            i.id,
            "succeeded",
            { role: b.role, project_ids: b.project_ids },
            tenant,
          );
          return inviteDTO(i);
        },
      );
      const i = (
        await tx.query("SELECT * FROM invites WHERE tenant_id=$1 AND id=$2", [
          tenant,
          saved.id,
        ])
      ).rows[0];
      if (!i)
        throw new Problem(
          410,
          "INVITE_REMOVED",
          "Invitation is no longer available",
        );
      return inviteDTO(i);
    }, tenant);
  });
  app.post("/v1/invites/accept", auth, async (req, reply) => {
    reply.code(201).header("Cache-Control", "no-store");
    const b = z
        .object({ token: z.string().min(1).max(2048) })
        .strict()
        .parse(req.body),
      k = requestKey(req);
    const locator = (
      await db.control.query("SELECT tenant_id FROM invites WHERE digest=$1", [
        hash(b.token),
      ])
    ).rows[0];
    if (!locator)
      throw new Problem(404, "INVITE_NOT_FOUND", "Invitation not found");
    return db.tx(async (tx) => {
      const tenant = locator.tenant_id;
      await lockMemberships(tx, tenant);
      const i = (
        await tx.query(
          "SELECT *,expires_at>now() AS valid FROM invites WHERE digest=$1 FOR UPDATE",
          [hash(b.token)],
        )
      ).rows[0];
      if (!i || i.email !== req.principal.email)
        throw new Problem(
          409,
          "INVITE_INVALID",
          "Invitation is unavailable for this account",
        );
      const saved = await replay(
        tx,
        req.principal.id,
        "invite.accept",
        k,
        { token_hash: hash(b.token) },
        async () => {
          if (
            !i.valid ||
            i.consumed_at ||
            i.revoked_at ||
            !(await validInvitationIssuer(tx, i))
          )
            throw new Problem(
              409,
              "INVITE_INVALID",
              "Invitation expired, was used, or its permissions changed; ask for a new invitation",
            );
          const old = (
            await tx.query(
              "SELECT * FROM memberships WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE",
              [tenant, req.principal.id],
            )
          ).rows[0];
          assertMemberNotSuspended(old);
          if (old?.status === "active")
            throw new Problem(
              409,
              "ALREADY_MEMBER",
              "You already belong to this workspace",
            );
          const m = (
            await tx.query(
              "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(tenant_id,user_id) DO UPDATE SET role=EXCLUDED.role,status='active',version=memberships.version+1 RETURNING *",
              [tenant, req.principal.id, i.role],
            )
          ).rows[0];
          await projectGrants(
            tx,
            tenant,
            req.principal.id,
            i.role,
            i.project_ids,
          );
          await tx.query("UPDATE invites SET consumed_at=now() WHERE id=$1", [
            i.id,
          ]);
          await revokeRecipientInvites(tx, tenant, req.principal.id, i.id);
          await tx.query(
            "UPDATE invitation_deliveries SET state='cancelled',token_cipher=NULL,lease_id=NULL,lease_until=NULL WHERE invite_id=$1 AND state<>'delivered'",
            [i.id],
          );
          await audit(
            tx,
            req.principal,
            "invite.accept",
            i.id,
            "succeeded",
            {},
            tenant,
          );
          return memberDTO({ ...m, project_ids: i.project_ids });
        },
      );
      const current = (
        await tx.query(
          `SELECT ${memberFields} FROM memberships m WHERE m.tenant_id=$1 AND m.user_id=$2`,
          [tenant, req.principal.id],
        )
      ).rows[0];
      if (
        !current ||
        current.status !== "active" ||
        current.version !== saved.auth_version
      )
        throw new Problem(
          409,
          "MEMBERSHIP_CHANGED",
          "Membership changed after this invitation was accepted",
        );
      return memberDTO(current);
    }, locator.tenant_id);
  });
  app.get("/v1/tenants/:tenant/invites", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const tenant = tenantHeader(req, uuid.parse((req.params as any).tenant)),
      q = page.parse(req.query);
    return db.tx(async (tx) => {
      await tenantAccess(tx, req.principal, tenant, "manage");
      if (
        q.cursor &&
        !(
          await tx.query("SELECT 1 FROM invites WHERE tenant_id=$1 AND id=$2", [
            tenant,
            q.cursor,
          ])
        ).rowCount
      )
        throw new Problem(410, "CURSOR_EXPIRED", "Refresh invitations");
      const rows = (
        await tx.query(
          "SELECT i.*,d.state AS delivery_state,d.attempts,d.delivered_at FROM invites i LEFT JOIN invitation_deliveries d ON d.invite_id=i.id WHERE i.tenant_id=$1 AND ($2::uuid IS NULL OR i.id>$2) ORDER BY i.id LIMIT $3",
          [tenant, q.cursor ?? null, q.limit + 1],
        )
      ).rows;
      return {
        items: rows.slice(0, q.limit).map((i) => ({
          ...inviteDTO(i),
          version: i.version,
          project_ids: i.project_ids,
          delivery: i.delivery_state ?? "unknown",
          attempts: i.attempts ?? 0,
          delivered_at: i.delivered_at,
        })),
        next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
      };
    }, tenant);
  });
  for (const action of ["revoke", "resend"] as const)
    app.post(
      `/v1/tenants/:tenant/invites/:invite/${action}`,
      auth,
      async (req, reply) => {
        reply.header("Cache-Control", "no-store");
        const tenant = tenantHeader(
            req,
            uuid.parse((req.params as any).tenant),
          ),
          id = uuid.parse((req.params as any).invite),
          k = requestKey(req);
        const b = z
          .object({ version: z.number().int().positive() })
          .strict()
          .parse(req.body);
        return db.tx(async (tx) => {
          await lockMemberships(tx, tenant);
          const m = await tenantAccess(tx, req.principal, tenant, "manage");
          const i = (
            await tx.query(
              "SELECT * FROM invites WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
              [tenant, id],
            )
          ).rows[0];
          if (!i) throw new Problem(404, "NOT_FOUND", "Invitation not found");
          if (["owner", "admin"].includes(i.role) && m.role !== "owner")
            throw new Problem(
              403,
              "OWNER_REQUIRED",
              "Only owners can manage privileged invitations",
            );
          await replay(
            tx,
            req.principal.id,
            `invite.${action}:${id}`,
            k,
            b,
            async () => {
              if (i.version !== b.version)
                throw new Problem(
                  409,
                  "VERSION_CONFLICT",
                  "Invitation changed; refresh first",
                );
              if (i.consumed_at || i.revoked_at)
                throw new Problem(
                  409,
                  "INVITE_INVALID",
                  "Invitation is already used or revoked",
                );
              if (action === "revoke") {
                await tx.query(
                  "UPDATE invites SET revoked_at=now(),version=version+1 WHERE id=$1",
                  [id],
                );
                await tx.query(
                  "UPDATE invitation_deliveries SET state='cancelled',token_cipher=NULL,lease_id=NULL,lease_until=NULL WHERE invite_id=$1",
                  [id],
                );
              } else {
                for (const project of i.project_ids)
                  await projectAccess(
                    tx,
                    req.principal,
                    tenant,
                    project,
                    "manage",
                  );
                const value = token();
                const updated = (
                  await tx.query(
                    "UPDATE invites SET digest=$2,expires_at=now()+interval '7 days',version=version+1,created_by=$3,issuer_version=$4 WHERE id=$1 RETURNING *",
                    [id, hash(value), req.principal.id, m.version],
                  )
                ).rows[0];
                await queueInvitation(tx, db, updated, value);
              }
              await audit(
                tx,
                req.principal,
                `invite.${action}`,
                id,
                "succeeded",
                {},
                tenant,
              );
              return { ok: true };
            },
          );
          return inviteDTO(
            (await tx.query("SELECT * FROM invites WHERE id=$1", [id])).rows[0],
          );
        }, tenant);
      },
    );
}
